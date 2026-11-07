/**
 * outfitScene.js — 场景服装（默认 / 私服 / 居家 / 睡衣）
 *
 * ── 解决什么问题 ──
 *
 * 角色的「## 你的外观」是一套固定描述，于是不管在上班、逛街还是睡觉，生图都用同一身衣服。
 * 本模块让角色拥有**多套场景服装**，由**日程**决定此刻该穿哪套 —— 这样朋友圈配图、聊天、
 * 立绘才会「场合正确」。
 *
 * ── 与其他换装机制的关系（三条通道，互不干扰）──
 *
 *   character_outfits.scene IS NOT NULL  → 场景服装（本模块；可多套并存，按日程选一套）
 *   character_outfits.enabled = 1        → 角色专属形态（道具变身，同时只一套，有 expires_at）
 *   global_outfits  enabled = 1          → 通用限时服饰（可多套叠加）
 *
 * 注入优先级：**限时服饰/道具 > 场景服装 > 人物卡原本外观**。
 * 也就是「用户主动用了换装道具」时不该被自动的场景服装盖掉。
 *
 * ── 睡眠是硬规则 ──
 *
 * 睡眠时段（日程里 replyDelay === -1）**强制**用 sleep 那套，不看日程里的 outfit 标注
 * —— 否则模型很容易安排角色穿着制服睡觉。
 */

import { getDb, getWorldSetting } from '../db/index.js';
import { getSystemRulesWithWorld } from '../db/worldRepository.js';
import { getWorldIntegrationRule } from '../builtinRules.js';
import { splitAppearanceSection, buildCharacterAppearanceSection } from './characterPersona.js';
import { buildSceneOutfitRequest, normalizeDesignScenes, parseSceneOutfitDesign } from './sceneOutfitPrompt.js';
import { getLocalDateKey } from '../utils/localDate.js';
import { chatSync } from './lorebook/runtime.js';
import { config } from '../config.js';

/**
 * 场景枚举。key 会落到 character_outfits.scene，改这里必须同步迁移注释。
 *
 * defaultName：界面**不再让用户填服装名**（名称对生图毫无用处，描述才是交给 ComfyUI 的东西），
 * 名称仅剩一个用途 —— 日程的 `outfit` 字段按**名称**标注「这一刻换了哪套」，
 * `getSceneOutfitForNow` 也按名称回查。所以留一组稳定的默认名，界面自动写入、用户不用管。
 */
export const OUTFIT_SCENES = [
  { key: 'work', label: '默认服饰', defaultName: '日常装', desc: '角色默认外观中描述的服饰（角色的招牌/常态形象）' },
  { key: 'casual', label: '私服', defaultName: '便装', desc: '上街、社交、休闲外出时穿的便装' },
  { key: 'home', label: '居家', defaultName: '居家服', desc: '在家中休息、做家务时穿的宽松舒适衣物' },
  { key: 'sleep', label: '睡衣', defaultName: '睡衣', desc: '睡觉时穿的睡衣或内衣，**赤脚、不穿鞋袜**。**睡眠时段强制使用这一套**' },
];

/** 场景 key → 默认服装名（界面保存时自动写入，用户看不到这个字段） */
export const DEFAULT_NAME_BY_SCENE = Object.fromEntries(OUTFIT_SCENES.map(s => [s.key, s.defaultName]));

const SCENE_KEYS = OUTFIT_SCENES.map(s => s.key);
const LABEL_BY_KEY = Object.fromEntries(OUTFIT_SCENES.map(s => [s.key, s.label]));

/** 该角色的全部场景服装（按场景顺序，便于界面展示与匹配） */
export function listSceneOutfits(characterId) {
  if (!characterId) return [];
  const rows = getDb().prepare(
    `SELECT id, name, description, scene FROM character_outfits
     WHERE character_id = ? AND scene IS NOT NULL AND scene != ''
     ORDER BY CASE scene WHEN 'work' THEN 0 WHEN 'casual' THEN 1 WHEN 'home' THEN 2 WHEN 'sleep' THEN 3 ELSE 9 END, id ASC`
  ).all(characterId);
  return rows.map(r => ({ ...r, sceneLabel: LABEL_BY_KEY[r.scene] || r.scene }));
}

/** 日程衣柜始终包含默认服饰；保留旧名称和 ID，但外观以人物卡为准，不补写服装表。 */
export function buildScheduleOutfitCandidates(outfits, character = null) {
  const savedDefault = outfits.find(o => o.scene === 'work');
  const appearance = character ? buildCharacterAppearanceSection(character, { outfits: null }).trim() : '';
  return [{
    ...savedDefault,
    scene: 'work',
    sceneLabel: LABEL_BY_KEY.work,
    name: savedDefault?.name || DEFAULT_NAME_BY_SCENE.work,
    description: appearance || savedDefault?.description || '沿用人物卡中的默认外观与服饰。',
  }, ...outfits.filter(o => o.scene !== 'work' && o.name?.trim() && o.description?.trim())];
}

function scheduleOutfits(characterId) {
  if (!characterId) return [];
  const character = getDb().prepare('SELECT base_prompt FROM characters WHERE id = ?').get(characterId);
  if (!character) return [];
  return buildScheduleOutfitCandidates(listSceneOutfits(characterId), character);
}

/** 批量写入场景服装（供「一键生成」用）。同名同场景则更新描述，避免重复堆叠 */
export function upsertSceneOutfits(characterId, outfits) {
  const db = getDb();
  const ins = db.prepare(
    `INSERT INTO character_outfits (character_id, name, description, scene) VALUES (?, ?, ?, ?)`
  );
  const upd = db.prepare(
    `UPDATE character_outfits SET name = ?, description = ? WHERE id = ?`
  );
  const find = db.prepare(
    `SELECT id FROM character_outfits WHERE character_id = ? AND scene = ? LIMIT 1`
  );
  let added = 0, updated = 0;
  const tx = db.transaction(() => {
    for (const o of outfits) {
      if (!o?.scene || !SCENE_KEYS.includes(o.scene) || !o.name || !o.description) continue;
      const exist = find.get(characterId, o.scene);
      if (exist) { upd.run(o.name, o.description, exist.id); updated++; }
      else { ins.run(characterId, o.name, o.description, o.scene); added++; }
    }
  });
  tx();
  return { added, updated };
}

// ── LLM 生成基础场景服装 ──────────────────────────────────

/** 仅设计三套换装；默认外观只作为基准，不进入返回值与保存流程。 */
export async function generateSceneOutfits(character, opts = {}) {
  const persona = splitAppearanceSection(character?.base_prompt).before.trim();
  if (!persona) throw new Error('角色人格为空，无法生成服装');
  const targetScenes = normalizeDesignScenes(opts.scenes);
  const world = getWorldSetting();
  const request = buildSceneOutfitRequest({
    systemRules: getSystemRulesWithWorld({ roleplay: false }),
    worldRule: world ? getWorldIntegrationRule('world_outfit') : '',
    persona,
    shortPrompt: character?.short_prompt,
    displayName: character?.display_name || '角色',
    baseAppearance: String(opts.baseAppearance || '').trim(),
    scenes: targetScenes,
    instruction: opts.instruction,
    currentOutfits: opts.instruction?.trim() ? listSceneOutfits(character.id) : [],
  });
  const raw = await chatSync(request.messages, {
    model: config.llm.model || 'deepseek-chat', temperature: 0.8, response_format: { type: 'json_object' }, label: '场景服装生成',
    lorebook: request.lorebook,
  });
  return parseSceneOutfitDesign(raw, targetScenes);
}
// ── 按日程决定此刻的服装 ──────────────────────────────────

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** 当前分钟数（本地时间） */
function nowMinutes(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

/** 取今日日程的活动数组（没生成/解析失败返回 []） */
function todayActivities(characterId, date = new Date()) {
  try {
    const row = getDb().prepare(
      'SELECT schedule_json FROM daily_schedules WHERE character_id = ? AND schedule_date = ?'
    ).get(characterId, getLocalDateKey(date));
    if (!row) return [];
    const parsed = JSON.parse(row.schedule_json);
    const arr = Array.isArray(parsed) ? parsed : (parsed?.activities || []);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * 找当前所处的时段下标。
 * 日程要求「上一个 endTime === 下一个 startTime」且覆盖完整 24 小时，所以必有命中；
 * 仍做兜底（取最后一段）以防数据异常。
 */
function findCurrentIndex(activities, minutes) {
  for (let i = 0; i < activities.length; i++) {
    const start = toMinutes(activities[i].startTime);
    let end = toMinutes(activities[i].endTime);
    if (end <= start) end += 24 * 60;                    // 跨午夜
    const cur = minutes < start ? minutes + 24 * 60 : minutes;
    if (cur >= start && cur < end) return i;
  }
  return activities.length - 1;
}

/**
 * 此刻该穿哪套场景服装。
 *
 * 判定顺序：
 *  1. 日程衣柜包含人物卡的默认服饰，不要求服装表存在 work 行
 *  2. 当前时段是睡眠（replyDelay=-1）→ **强制** sleep 那套
 *  3. 清醒时向前回溯最近的有效换装点，遇到睡眠边界停止，避免醒来后沿用睡衣
 *  4. 没日程或没匹配上 → 默认服饰；默认服饰不作为特殊换装重复注入
 *
 * @returns {{outfit: object, scene: string, source: string}|null}
 *          source 便于排查：'sleep' | 'schedule' | 'fallback'
 */
export function getSceneOutfitForNow(characterId, date = new Date()) {
  const outfits = scheduleOutfits(characterId);
  if (!outfits.length) return null;

  const sleepOutfit = outfits.find(o => o.scene === 'sleep') || null;
  const fallback = { outfit: outfits.find(o => o.scene === 'work'), scene: 'work', source: 'fallback' };
  const byName = new Map(outfits.map(o => [o.name, o]));
  const byId = new Map(outfits.filter(o => o.id != null).map(o => [String(o.id), o]));

  const acts = todayActivities(characterId, date);
  if (!acts.length) {
    // 没有日程就没有睡眠依据，不按墙钟猜测作息。
    return fallback;
  }

  const idx = findCurrentIndex(acts, nowMinutes(date));
  const cur = acts[idx] || {};

  // ② 睡眠：硬规则，优先于任何标注
  if (Number(cur.replyDelay) === -1 && sleepOutfit) {
    return { outfit: sleepOutfit, scene: 'sleep', source: 'sleep' };
  }

  // ③ 向前回溯最近的换装点（含当前段）；上限防止绕一圈
  for (let step = 0; step < acts.length; step++) {
    const i = (idx - step + acts.length) % acts.length;
    if (step > 0 && Number(acts[i]?.replyDelay) === -1) break;
    const o = acts[i]?.outfit;
    if (!o) continue;
    const text = String(o).trim();
    if (!text) continue;
    const hit = byName.get(text) || byId.get(text);
    if (hit) {
      if (hit.scene === 'sleep' && Number(cur.replyDelay) !== -1) return fallback;
      return { outfit: hit, scene: hit.scene, source: 'schedule' };
    }
    // 标注了但匹配不到（LLM 编了个名字）→ 继续往前找，别停在一个无效值上
  }

  // ④ 兜底
  return fallback;
}

/** 把当前场景服装包成 characterPersona 认的 outfits 结构（走 limited 通道） */
export function asPersonaOutfits(sceneOutfit) {
  if (!sceneOutfit?.outfit || sceneOutfit.outfit.scene === 'work') return null;
  return { limited: [{ name: sceneOutfit.outfit.name, description: sceneOutfit.outfit.description }], exclusive: null };
}

// ── 日程生成时的服装标注层 ──────────────────────────────────

/**
 * 为日程生成拼一段「服装标注」提示词。
 * 只有角色配了场景服装时才调用；没配的角色日程生成保持原样（零影响）。
 * @returns {string|null}
 */
export function buildOutfitAnnotateLayer(characterId) {
  return buildOutfitAnnotation(scheduleOutfits(characterId));
}

/** 系统角色可显式提供独立衣柜，复用同一日程着装规范。 */
export function buildOutfitAnnotation(outfits, character = null) {
  outfits = buildScheduleOutfitCandidates(outfits, character);
  if (outfits.length < 2) return null;   // 只有一套就没什么可分配的

  const list = outfits.map(o => `- ${JSON.stringify(o.name)}（${LABEL_BY_KEY[o.scene] || o.scene}）：${o.description.slice(0, 60)}`).join('\n');
  const defaultOutfit = outfits.find(o => o.scene === 'work');
  const defaultName = JSON.stringify(defaultOutfit.name);
  const sleepOutfit = outfits.find(o => o.scene === 'sleep');
  const dayNames = outfits.filter(o => o.scene !== 'sleep').map(o => JSON.stringify(o.name)).join(' / ');
  const example = { activities: [
    { startTime: '07:00', endTime: '08:00', activity: '起床整理', location: '住处', replyDelay: 0, tags: ['日常'], description: '起床洗漱后换回平日的默认服饰，整理好衣领，在窗边吃过早餐，准备开始一天的活动。', outfit: defaultOutfit.name },
    { startTime: '08:00', endTime: '18:00', activity: '日常事务与外出', location: '街区', replyDelay: 0, tags: ['日常'], description: '沿用默认服饰处理日常事务，午后沿街办事，与熟人打过招呼，傍晚收拾随身物品准备回家。', outfit: null },
    { startTime: '18:00', endTime: '22:00', activity: '回家用餐与阅读', location: '住处', replyDelay: 0, tags: ['日常'], description: '回家后继续穿着默认服饰，准备晚餐并收拾餐桌，随后坐到窗边翻阅书页，安静度过晚间。', outfit: null },
    { startTime: '22:00', endTime: '07:00', activity: '就寝', location: '住处卧室', replyDelay: -1, tags: ['睡眠'], description: '完成睡前整理后躺入柔软的被褥，闭上双眼放松身体，伴着窗外渐渐安静的夜色沉入睡眠。', outfit: sleepOutfit?.name || null },
  ] };

  return `## 着装标注（额外要求）
默认服饰是角色清醒时的常态形象，只有明确理由才换其他衣服。可选服装如下：
${list}

请在生成日程时，为**每个时段**额外输出一个字段 \`outfit\`：
- outfit 只能是候选服装的名称字符串（原样照抄）或 JSON null，不得编造名称、使用字符串 "null" 或省略字段。
- 默认服饰 ${defaultName} 是角色的招牌/常态形象，不等于工作制服；工作、普通外出、社交、短暂居家都优先穿默认服饰，在家也可以穿。
- 起床整理后的首个清醒时段优先明确填写 ${defaultName}；若当时有明确换装理由，可填写对应候选。睡醒不能因 null 沿用睡衣。
- 私服只在明确的休闲安排、约会需求或用户指定等理由下选择；不要仅因为出门或社交就自动切换。
- 居家服只在长时间居家放松、沐浴后等确有舒适需求时选择；不要仅因为回家就自动切换，外出不穿居家服。
- 选择非默认的清醒服饰时，在该活动的 description 中自然交代换装理由，保持原定字数约束。理由结束后在合适时点换回 ${defaultName}。
- 只在初始着装或实际换装时填写名称，其余清醒时段填 null，表示沿用上段；没有换装理由就持续默认服饰。不要求每天用遍衣柜，不设最低换装次数或服装占比，避免无理由的频繁换装。${sleepOutfit ? `
- 每个睡眠时段（replyDelay=-1）的 outfit 必须填写 ${JSON.stringify(sleepOutfit.name)}；睡衣只用于睡眠，不作为清醒活动的常态服饰。` : '\n- 没有睡衣候选时，不得编造睡衣名称；睡眠时段 outfit 填 null。'}
- 可用作清醒活动的服装：${dayNames}。

完整 JSON 示例（展示默认服饰贯穿清醒活动，实际活动和时段按角色日程生成）：
${JSON.stringify(example)}
字段约束：startTime/endTime 为 HH:MM，连续覆盖24小时；activity 为简短活动名；location 为实际地点；replyDelay 仅为0或-1；tags 为简短标签字符串数组；description 为26–52字的具体活动描述，省略主语或用角色名，不用我/你/她/他，非默认清醒换装需交代理由；outfit 按上述名称/null规则填写。保留其他日程要求中的附加字段。
严格按示例的 JSON 对象结构输出，不输出解释、Markdown 或 JSON 以外的文字。`;
}
