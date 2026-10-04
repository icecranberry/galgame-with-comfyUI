/**
 * outfitScene.js — 场景服装（工装 / 私服 / 居家 / 睡衣）
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

/**
 * 场景枚举。key 会落到 character_outfits.scene，改这里必须同步迁移注释。
 *
 * defaultName：界面**不再让用户填服装名**（名称对生图毫无用处，描述才是交给 ComfyUI 的东西），
 * 名称仅剩一个用途 —— 日程的 `outfit` 字段按**名称**标注「这一刻换了哪套」，
 * `getSceneOutfitForNow` 也按名称回查。所以留一组稳定的默认名，界面自动写入、用户不用管。
 */
export const OUTFIT_SCENES = [
  { key: 'work', label: '工装', defaultName: '日常装', desc: '上班、出勤、执行职务时穿（角色的招牌/常态形象）' },
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

【四套场景定义（scene 字段照抄英文 key；本次具体要哪几套以用户消息为准，别多给）】
- work（工装）：这个角色在**其职业/身份场合**日常穿的那身。制式职业（警察、护士、学生等）就是对应制服；自由职业者则是工作时常穿的那身。描述里要能被生图模型直接画出来。
- casual（私服）：休息日上街、见朋友、逛街时穿的便装。
- home（居家）：在家里做家务、放松、看书时穿的宽松舒适衣物。
- sleep（睡衣）：**睡觉时穿的睡衣或内衣**（睡裙 / 睡衣睡裤 / 吊带内衣 + 短裤 / 内裤等）。这一套是最贴身的，不要设计成能穿出门的服装。
  **★ 必须赤脚**：人睡觉时鞋子袜子早就脱了，所以这一套的 description 里**必须明确写出 barefoot（赤足）**。
  **画面里不要出现任何鞋类物体** —— 鞋、靴、拖鞋、袜、丝袜、短袜一律不写（shoes / boots / slippers / heels / sandals / socks / stockings / pantyhose / tights），
  **连「床边摆着一双没穿的拖鞋」这种也不要写**（生图模型看到 slippers 就会把它画出来）。只需交代脚本身是裸的。

【输出字段】
- scene：上面四个 key 之一
- name：服装名称，≤10 个字（如「警用制服」「白色睡裙」）
- description：40~90 字，**自然语言与英文 tag 混合**（如「黑色的褶边女仆裙配蕾丝头饰」→ 应写成 black frilled maid dress, lace headdress, white apron…）。
  先写整体风格与轮廓，再写材质/纹样/配饰细节。第三人称视角，**只描述服装本身**，
  不要提到穿着者的身份、性格、动作，也不要出现「用户」「她」「他」。

【要求】
1. 各套必须**彼此区分明显** —— 一眼能看出是上班、出门、在家还是睡觉。
2. 必须**贴合这个角色的人设与世界观**：颜色、风格、职业特征要呼应 ta 的身份。
   若提供了世界观，服装要符合那个世界的技术与文化（不要直接照抄现实品牌或原作品服装名）。
3. 只输出 JSON，不要解释、不要 Markdown 代码块。

## 输出格式
{"outfits":[{"scene":"work","name":"...","description":"..."},{"scene":"casual",...},{"scene":"home",...},{"scene":"sleep",...}]}`;

/**
 * 「以常态外观（工装）为基准」的提示层。
 *
 * 用途：私服/居家/睡衣不该从人设凭空重画，而应**基于角色已有的招牌形象**改衣服
 * ——否则四套会各画各的（发色发型都可能漂移），看着不像同一个人。
 * 这里把基准外观喂进去，并明确「身体特征原样保留、只换服装」。
 */
function buildBaseAppearanceLayer(baseAppearance, scenes) {
  const labels = scenes.map(s => LABEL_BY_KEY[s]).join('、');
  // 睡衣是唯一「脚上不该有东西」的场景，单独点一句 —— 否则模型会照搬基准外观里的鞋袜
  const sleepNote = scenes.includes('sleep')
    ? '\n5. **睡衣那一套要赤脚**：基准外观里的鞋袜不要带过去。脚上不能有任何鞋、靴、拖鞋或袜子，' +
      '**也不要写「床边摆着一双没穿的拖鞋」这类**（生图模型看到 slippers 就会画出来）——只交代脚是裸的。'
    : '';
  return `【常态外观（基准，最高优先级）】
以下是这个角色的**常态外观**，也就是她的招牌形象：
${baseAppearance}

本次要设计的（${labels}）都是**同一个人**在不同场合的穿着。因此：
1. **必须原样保持不变**：发色、发型、瞳色、五官、肤色、体型、身高等身体特征——一个字都不要改写或重新描述。
2. **只改服装相关**：衣服、鞋袜、配饰，以及随场合变化的小物件。
3. 设计出来的服装要和常态外观处在**同一套审美体系**里（相近的配色偏好、材质与气质），
   看得出是同一个人换了衣服，而不是换了一个人。
4. 不要把上面那套衣服原样再写一遍——这几套必须和它明显不同。${sleepNote}`;
}

/**
 * 用 LLM 为角色生成场景服装（不落库，由调用方决定保存）。
 * @param {object} character - 至少含 display_name 与 base_prompt
 * @param {object} [opts]
 * @param {string} [opts.baseAppearance] - 常态外观（工装描述）。传了就**以它为基准**只换衣服，
 *   身体特征保持不变；不传则退回「从人设重新设计四套」的旧口径。
 * @param {string[]} [opts.scenes] - 只生成这几套（如 ['casual','home','sleep']）；不传则四套都生成
 * @returns {Promise<Array<{scene,name,description}>>}
 */
export async function generateSceneOutfits(character, opts = {}) {
  const displayName = character?.display_name || '角色';
  const persona = cropPersona(character?.base_prompt);
  if (!persona) throw new Error('角色人格为空，无法生成服装');

  // 只生成指定场景；非法值过滤掉，全非法/未传则回落四套
  const wanted = Array.isArray(opts.scenes) ? opts.scenes.filter(s => SCENE_KEYS.includes(s)) : [];
  const targetScenes = wanted.length ? wanted : SCENE_KEYS;
  const baseAppearance = String(opts.baseAppearance || '').trim();

  const worldSetting = getWorldSetting();
  const msgs = [
    { role: 'system', content: getSystemRules({ roleplay: false }) },
    { role: 'system', content: GEN_SYSTEM_PROMPT },
  ];
  if (worldSetting) msgs.push({ role: 'system', content: worldSetting });
  // 基准外观层放在人设之后、user 之前：它是本次生成的锚点，权重比人设更直接
  if (baseAppearance) msgs.push({ role: 'system', content: buildBaseAppearanceLayer(baseAppearance, targetScenes) });
  msgs.push({
    role: 'user',
    content: `角色名：${displayName}\n\n以下是 ta 的人设：\n${persona}\n\n`
      + `本次只需要设计这 ${targetScenes.length} 套：${targetScenes.map(s => `${s}（${LABEL_BY_KEY[s]}）`).join('、')}。`
      + `\n请为 ${displayName} 输出这几套服装，outfits 数组里只放这几套，不要多给。`,
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

  // 规范化 + 只保留本次要求的场景；缺失的补兜底，保证调用方拿到的套数齐全
  const out = [];
  for (const scene of targetScenes) {
    const hit = list.find(o => o?.scene === scene);
    const description = String(hit?.description || '').trim().slice(0, 300);
    if (description) {
      out.push({ scene, name: String(hit?.name || '').trim().slice(0, 20) || DEFAULT_NAME_BY_SCENE[scene], description });
    } else {
      out.push({ scene, ...FALLBACK_OUTFITS[scene] });
    }
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
  const sleepName = outfits.find(o => o.scene === 'sleep')?.name;
  const workName = outfits.find(o => o.scene === 'work')?.name;
  const casualName = outfits.find(o => o.scene === 'casual')?.name;
  const homeName = outfits.find(o => o.scene === 'home')?.name;
  const dayNames = outfits.filter(o => o.scene !== 'sleep').map(o => `"${o.name}"`).join(' / ') || '（无）';

  // 示例用角色真实拥有的服装名，避免出现"示例里写了 A、可选清单里没有 A"的自相矛盾
  const exOut = workName || casualName || outfits[0].name;
  const exHome = homeName || outfits[0].name;

  return `## 着装标注（额外要求）
这个角色在一天中会换衣服。可选服装如下：
${list}

请在生成日程时，为**每个时段**额外输出一个字段 \`outfit\`：
- 值为上面某套服装的**名称**（原样照抄，不要改写）。
- **只在「换装的那一刻」填写**，其余时段填 \`null\`（表示沿用上一段的穿着）。

### 一、先给每个时段判断「在自己住所内 / 在住所外」
- **住所内**＝这个角色自己的住处（卧室、浴室、客厅、厨房等）。
- **住所外**＝其余一切地方：街道、商店、胡同、车站、广场、公园、河岸、酒馆、学校、公司，
  以及**别人家**（哪怕在室内，也不是"在家"）。

### 二、以下 4 个时点**必须**标 outfit，一个都不能漏
1. **入睡** → 标"${sleepName || '睡衣'}"（睡眠时段的 outfit 必须是它）。
2. **睡醒起床** → 标一套白天的衣服。
3. **从住所出门**（去任何"住所外"的地方）→ 标一套**外出**的（工装或私服）。
4. **从外面回到住所** → 标"${exHome}"。

### 三、写完自检（逐时段过，发现矛盾就补标）
- 某个"住所外"的时段，穿的却是**居家服或睡衣** → ✗ 错。在这一段补标一套外出服。
  （唯一例外：明确写的是家门口的短暂活动，如"下楼取快递""楼下便利店"，可沿用。）
- 某个"住所内"的时段，穿的却是外出服 → ✗ 错。在这一段补标居家服。
- \`outfit\` 非 null 的时段**通常是 4~6 个**；一天里出门几次、回家几次，就要标几次。
  **不要为了凑少数几次，把"出门"或"回家"漏掉** —— 漏掉的后果是角色会穿着睡衣/居家服在街上活动。
- 反过来也别无理由频繁换装（同一地点、同一活动内不要反复换）。

- 可用作白天的服装：${dayNames}。

示例（仅示意 outfit 字段的密度与位置，实际按角色真实日程；注意"出门"与"回家"两处都有标注）：
{"startTime":"07:00","endTime":"07:30","activity":"晨间梳洗","location":"公寓浴室","replyDelay":0,"tags":["日常"],"description":"……","outfit":"${exHome}"}
{"startTime":"08:00","endTime":"12:00","activity":"上班","location":"公司","replyDelay":0,"tags":["工作"],"description":"……","outfit":"${exOut}"}
{"startTime":"12:00","endTime":"13:00","activity":"午休回公寓","location":"公寓客厅","replyDelay":0,"tags":["日常"],"description":"……","outfit":"${exHome}"}
{"startTime":"13:00","endTime":"18:00","activity":"继续上班","location":"公司","replyDelay":0,"tags":["工作"],"description":"……","outfit":"${exOut}"}
{"startTime":"19:00","endTime":"22:00","activity":"在家做饭休息","location":"公寓客厅","replyDelay":0,"tags":["日常"],"description":"……","outfit":"${exHome}"}
{"startTime":"22:00","endTime":"07:00","activity":"就寝","location":"公寓卧室","replyDelay":-1,"tags":["睡眠"],"description":"……","outfit":${hasSleep ? `"${sleepName}"` : 'null'}}`;
}

// ── 生成后校验 + 一次专注修复 ────────────────────────────────

/**
 * 校验日程的 outfit 标注，不达标就用一次**只做标注**的专注调用补回来。
 *
 * ── 为什么需要这道兜底（实测，2026-10-04）────────────────────
 * 提示词已明确要求「出门/回家必须标」，但 LLM 有波动：同一角色连跑两次，
 * 一次给了 6 个换装点（含「换装出门」「回家换装」），另一次只有 3 个
 * —— 漏掉出门那一次，角色就会**穿着居家服/睡衣在街上活动**（用户报的就是这个）。
 * 只靠提示词压不住，所以加一道确定性的「生成 → 校验 → 修复」。
 *
 * 修复之所以有效：让模型**只干一件事**（对着已有日程填 outfit）比它同时
 * 编日程又填标注要可靠得多，且这份 prompt 极小、很快。
 *
 * @param {Array} schedule 已解析通过的日程数组（不改原数组）
 * @param {number} characterId
 * @returns {Promise<{schedule: Array, repaired: boolean, reason: string}>}
 */
export async function ensureOutfitAnnotations(schedule, characterId) {
  const outfits = listSceneOutfits(characterId);
  if (outfits.length < 2 || !Array.isArray(schedule) || !schedule.length) {
    return { schedule, repaired: false, reason: 'no-outfits' };
  }
  const valid = new Set(outfits.map(o => o.name));

  // ── 校验 ──
  const marked = schedule.filter(a => a?.outfit).length;
  const illegal = schedule.filter(a => a?.outfit && !valid.has(String(a.outfit).trim()));

  /**
   * 阈值取「固定 4」而不是按地点切换次数推算。
   *
   * 曾试过 `transitions - 1`（地点段变了就大概要换装），但那个估算**过于激进**：
   * 「公寓卧室 → 公寓浴室」这种同住处的移动也会被算成一次切换，于是几乎每次都触发修复
   * —— 等于每次生成日程都白跑一次 LLM 调用（实测 3 轮全部触发）。
   *
   * 一天正常至少需要 4 个换装点（入睡 / 起床 / 出门 / 回家）；低于 4 才可疑。
   * 用户报的那个 case 正是 3 个 —— 能被抓住。而 6~9 个的正常日程不会再被误触发。
   */
  const floor = 4;

  const needsRepair = illegal.length > 0 || marked < floor;
  if (!needsRepair) return { schedule, repaired: false, reason: 'ok' };

  const reason = illegal.length
    ? `非法服装名 ${illegal.length} 处`
    : `换装点偏少（${marked} < ${floor}）`;
  console.log(`[outfitScene] 标注不合格（${reason}），发起一次专注修复`);

  // ── 修复：只输出与日程等长的 outfit 数组 ──
  const list = outfits.map(o => `- "${o.name}"（${LABEL_BY_KEY[o.scene] || o.scene}）`).join('\n');
  const sleepName = outfits.find(o => o.scene === 'sleep')?.name;
  const homeName = outfits.find(o => o.scene === 'home')?.name;
  const exOut = outfits.find(o => o.scene === 'work')?.name
    || outfits.find(o => o.scene === 'casual')?.name || outfits[0].name;
  const lines = schedule.map((a, i) =>
    `${i}. ${a.startTime}-${a.endTime}　${a.activity}　@${a.location || '（未写）'}`
    + `${Number(a.replyDelay) === -1 ? '　【睡眠】' : ''}`
  ).join('\n');

  const msgs = [
    { role: 'system', content: `你是着装校对员。下面是某角色一天的日程，请为**每个时段**判定该穿哪套衣服。

可选服装：
${list}

判定规则（逐时段过）：
1. 先判断该时段在「这个角色自己的住处内」还是「住所外」。
   住所内＝自己的卧室/浴室/客厅/厨房；住所外＝其余一切地方（街道、商店、车站、广场、公园、
   河岸、酒馆、学校、公司，以及**别人家**）。
2. 睡眠时段（标了【睡眠】的）→ 必须穿${sleepName ? ` "${sleepName}"` : '睡衣'}。
3. **住所外**的时段 → 必须穿外出服（工装或私服），**绝不能是居家服或睡衣**。
4. 回到自己住处 → 穿${homeName ? ` "${homeName}"` : '居家服'}。
5. **只在穿着发生变化的那一段**给出名字，没变化就填 null（表示沿用上一段）。
   出门、回家都是变化，都要给。

⚠ 只输出 JSON，格式严格如下（数组长度必须等于 ${schedule.length}，第 i 项对应上面第 i 条）：
{"outfits": ["${exOut}", null, "..."]}
不要输出任何解释或 JSON 以外的文字。` },
    { role: 'user', content: lines },
  ];

  let fixed = null;
  try {
    const raw = await chatSync(msgs, {
      temperature: 0.2, max_tokens: 900,
      response_format: { type: 'json_object' }, label: 'schedule-gen:着装校对',
    });
    const parsed = JSON.parse(String(raw || '')
      .replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim());
    const arr = Array.isArray(parsed?.outfits) ? parsed.outfits : null;
    // 只接受「长度对齐 + 名字全合法」的结果 —— 宁可保留原样，也不拿脏数据覆盖
    if (arr && arr.length === schedule.length
      && arr.every(v => v == null || valid.has(String(v).trim()))) {
      fixed = arr;
    } else {
      console.warn('[outfitScene] 修复结果不合格，保留原标注',
        arr ? `（长度 ${arr.length}≠${schedule.length}）` : '（无数组）');
    }
  } catch (err) {
    console.warn('[outfitScene] 修复调用失败，保留原标注:', err.message);
  }

  if (!fixed) return { schedule, repaired: false, reason: 'repair-failed' };

  const next = schedule.map((a, i) => ({ ...a, outfit: fixed[i] ? String(fixed[i]).trim() : null }));
  const newMarks = next.filter(a => a.outfit).length;
  console.log(`[outfitScene] 标注已修复：${marked} → ${newMarks} 个换装点`);
  return { schedule: next, repaired: true, reason };
}
