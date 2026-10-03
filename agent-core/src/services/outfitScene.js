/**
 * outfitScene.js — 场景服装（工装 / 外出 / 居家 / 睡眠）
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

import { getDb, getSystemRules, getWorldSetting } from '../db/index.js';
import { getLocalDateKey } from '../utils/localDate.js';
import { chatSync } from '../llm/llm-client.js';
import { config } from '../config.js';

/** 场景枚举。key 会落到 character_outfits.scene，改这里必须同步迁移注释 */
export const OUTFIT_SCENES = [
  { key: 'work', label: '工装', desc: '上班、出勤、执行职务时穿' },
  { key: 'casual', label: '外出服', desc: '上街、社交、休闲外出时穿' },
  { key: 'home', label: '居家服', desc: '在家中休息、做家务时穿' },
  { key: 'sleep', label: '睡眠', desc: '睡觉时穿（睡衣 / 内衣）。**睡眠时段强制使用这一套**' },
];

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

/** 取角色人设正文（截到外观段之前，控制长度） */
function cropPersona(basePrompt) {
  const base = String(basePrompt || '');
  const at = base.search(/##\s*你的外观/);
  const body = at >= 0 ? base.slice(0, at) : base;
  return body.trim().slice(0, 2000);
}

const GEN_SYSTEM_PROMPT = `你是角色服装设计助手。用户会给你一个角色的人设，请为 ta 设计四套**日常场景服装**，用于决定这个角色在不同场合穿什么。

【四套固定场景（必须全部给出，scene 字段照抄英文 key）】
- work（工装）：这个角色在**其职业/身份场合**日常穿的那身。制式职业（警察、护士、学生等）就是对应制服；自由职业者则是工作时常穿的那身。描述里要能被生图模型直接画出来。
- casual（外出服）：休息日上街、见朋友、逛街时穿的便装。
- home（居家服）：在家里做家务、放松、看书时穿的宽松舒适衣物。
- sleep（睡眠）：**睡觉时穿的睡衣或内衣**（睡裙 / 睡衣睡裤 / 吊带内衣 + 短裤 / 内裤等）。这一套是最贴身的，不要设计成能穿出门的服装。

【输出字段】
- scene：上面四个 key 之一
- name：服装名称，≤10 个字（如「警用制服」「白色睡裙」）
- description：40~90 字，**自然语言与英文 tag 混合**（如「黑色的褶边女仆裙配蕾丝头饰」→ 应写成 black frilled maid dress, lace headdress, white apron…）。
  先写整体风格与轮廓，再写材质/纹样/配饰细节。第三人称视角，**只描述服装本身**，
  不要提到穿着者的身份、性格、动作，也不要出现「用户」「她」「他」。

【要求】
1. 四套必须**彼此区分明显** —— 一眼能看出是上班、出门、在家还是睡觉。
2. 必须**贴合这个角色的人设与世界观**：颜色、风格、职业特征要呼应 ta 的身份。
   若提供了世界观，服装要符合那个世界的技术与文化（不要直接照抄现实品牌或原作品服装名）。
3. 只输出 JSON，不要解释、不要 Markdown 代码块。

## 输出格式
{"outfits":[{"scene":"work","name":"...","description":"..."},{"scene":"casual",...},{"scene":"home",...},{"scene":"sleep",...}]}`;

/**
 * 用 LLM 为角色生成四套基础场景服装（不落库，由调用方决定保存）。
 * @param {object} character - 至少含 display_name 与 base_prompt
 * @returns {Promise<Array<{scene,name,description}>>}
 */
export async function generateSceneOutfits(character) {
  const displayName = character?.display_name || '角色';
  const persona = cropPersona(character?.base_prompt);
  if (!persona) throw new Error('角色人格为空，无法生成服装');

  const worldSetting = getWorldSetting();
  const msgs = [
    { role: 'system', content: getSystemRules({ roleplay: false }) },
    { role: 'system', content: GEN_SYSTEM_PROMPT },
  ];
  if (worldSetting) msgs.push({ role: 'system', content: worldSetting });
  msgs.push({
    role: 'user',
    content: `角色名：${displayName}\n\n以下是 ta 的人设：\n${persona}\n\n请为 ${displayName} 设计四套场景服装。`,
  });

  const model = config.llm.model || 'deepseek-chat';
  const raw = await chatSync(msgs, { model, temperature: 0.8, max_tokens: 2048, response_format: { type: 'json_object' }, label: '场景服装生成' });

  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    const m = String(raw).match(/\{[\s\S]*"outfits"[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : null;
  }
  const list = Array.isArray(parsed?.outfits) ? parsed.outfits : null;
  if (!list) throw new Error('模型返回格式无法解析');

  // 规范化 + 只保留四个合法场景；缺失的场景补一套兜底，保证四类齐全
  const out = [];
  for (const scene of SCENE_KEYS) {
    const hit = list.find(o => o?.scene === scene);
    const name = String(hit?.name || '').trim().slice(0, 20);
    const description = String(hit?.description || '').trim().slice(0, 300);
    if (name && description) out.push({ scene, name, description });
    else out.push({ scene, ...FALLBACK_OUTFITS[scene] });
  }
  return out;
}

/** 模型漏给某场景时的兜底（尽量中性，避免画不出来） */
const FALLBACK_OUTFITS = {
  work: { name: '工作装', description: 'a simple practical work outfit, neat and comfortable, suitable for daily work' },
  casual: { name: '便装', description: 'casual everyday clothes, a simple top with matching bottoms, relaxed style' },
  home: { name: '居家服', description: 'comfortable loose loungewear, soft fabric, relaxed fit for staying at home' },
  sleep: { name: '睡衣', description: 'a simple sleepwear set, soft lightweight fabric, camisole and shorts' },
};

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
 *  1. 角色没有场景服装 → null（调用方回落原外观）
 *  2. 当前时段是睡眠（replyDelay=-1）→ **强制** sleep 那套
 *  3. 否则从当前时段**向前回溯**，找最近一个有 outfit 标注的时段 → 按名字匹配
 *     （日程只在「换装的那一刻」标注 outfit，其余留空，这样换装次数天然被限制）
 *  4. 都没匹配上 → 回到该角色的第一套非睡眠服装（兜底，避免没衣服穿）
 *
 * @returns {{outfit: object, scene: string, source: string}|null}
 *          source 便于排查：'sleep' | 'schedule' | 'fallback'
 */
export function getSceneOutfitForNow(characterId, date = new Date()) {
  const outfits = listSceneOutfits(characterId);
  if (!outfits.length) return null;

  const sleepOutfit = outfits.find(o => o.scene === 'sleep') || null;
  const dayOutfits = outfits.filter(o => o.scene !== 'sleep');
  const byName = new Map(outfits.map(o => [o.name, o]));
  const byId = new Map(outfits.map(o => [String(o.id), o]));

  const acts = todayActivities(characterId, date);
  if (!acts.length) {
    // 没有日程：用第一套非睡眠服装兜底（夜里则用睡衣）
    const fallback = dayOutfits[0] || sleepOutfit;
    return fallback ? { outfit: fallback, scene: fallback.scene, source: 'fallback' } : null;
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
    const o = acts[i]?.outfit;
    if (!o) continue;
    const text = String(o).trim();
    if (!text) continue;
    const hit = byName.get(text) || byId.get(text);
    if (hit) return { outfit: hit, scene: hit.scene, source: 'schedule' };
    // 标注了但匹配不到（LLM 编了个名字）→ 继续往前找，别停在一个无效值上
  }

  // ④ 兜底
  const fallback = dayOutfits[0] || sleepOutfit;
  return fallback ? { outfit: fallback, scene: fallback.scene, source: 'fallback' } : null;
}

/** 把当前场景服装包成 characterPersona 认的 outfits 结构（走 limited 通道） */
export function asPersonaOutfits(sceneOutfit) {
  if (!sceneOutfit?.outfit) return null;
  return { limited: [{ name: sceneOutfit.outfit.name, description: sceneOutfit.outfit.description }], exclusive: null };
}

// ── 日程生成时的服装标注层 ──────────────────────────────────

/**
 * 为日程生成拼一段「服装标注」提示词。
 * 只有角色配了场景服装时才调用；没配的角色日程生成保持原样（零影响）。
 * @returns {string|null}
 */
export function buildOutfitAnnotateLayer(characterId) {
  const outfits = listSceneOutfits(characterId);
  if (outfits.length < 2) return null;   // 只有一套就没什么可分配的

  const list = outfits.map(o => `- "${o.name}"（${LABEL_BY_KEY[o.scene] || o.scene}）：${o.description.slice(0, 60)}`).join('\n');
  const hasSleep = outfits.some(o => o.scene === 'sleep');
  const dayNames = outfits.filter(o => o.scene !== 'sleep').map(o => `"${o.name}"`).join(' / ') || '（无）';

  return `## 着装标注（额外要求）
这个角色在一天中会换衣服。可选服装如下：
${list}

请在生成日程时，为**每个时段**额外输出一个字段 \`outfit\`：
- 值为上面某套服装的**名称**（原样照抄，不要改写）。
- **只在「换装的那一刻」填写**，其余时段填 \`null\`（表示沿用上一段的穿着）。
  —— 也就是说，一天里 \`outfit\` 非 null 的时段应当只有 2~4 个。
- 换装必须发生在**合理的时点**：起床后、出门前、回到家、准备就寝、以及活动性质明显变化时
  （如「下班回家」「换上运动服去锻炼」）。不要在一天中频繁换装，最多 4 次。
- 外出活动不要穿居家服出门，在家不要穿工装。${hasSleep ? `
- **睡眠时段的 outfit 必须填 "睡眠" 那套**（睡觉不会穿着上面的外出装）。` : ''}
- 可用作白天的服装：${dayNames}。

示例（仅示意 outfit 字段的密度，实际按角色真实日程）：
{"startTime":"07:00","endTime":"07:30","activity":"晨间梳洗","location":"公寓浴室","replyDelay":0,"tags":["日常"],"description":"……","outfit":null}
{"startTime":"08:00","endTime":"18:00","activity":"上班","location":"公司","replyDelay":0,"tags":["工作"],"description":"……","outfit":"${outfits.find(o => o.scene === 'work')?.name || outfits[0].name}"}
{"startTime":"22:00","endTime":"07:00","activity":"就寝","location":"公寓卧室","replyDelay":-1,"tags":["睡眠"],"description":"……","outfit":${hasSleep ? `"${outfits.find(o => o.scene === 'sleep').name}"` : 'null'}}`;
}
