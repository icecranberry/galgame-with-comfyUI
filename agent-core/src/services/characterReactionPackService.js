/**
 * 角色操作反馈 —— 个性化短句包（M2）。
 *
 * 只做三件事：
 *   1. 按请求事件集合组装提示词，内附**本次请求事件的完整 JSON 输出示例**
 *   2. 严格解析（根字段 / 版本 / 角色 ID / 事件集合 / 每类恰好 3 条 / 枚举 / 句长 / 占位符 / 额外字段）
 *   3. 版本化保存一份完整 JSON + 人格指纹；不保存行为流水
 *
 * 人设变化只标记「可更新」，不自动重新生成；重复使用已有包不产生任何模型调用。
 * 见 docs/character-reaction-notification-plan.md §7.3 / §11（M2）。
 */

import { getDb, getSystemRulesWithWorld } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';

export const PACK_SCHEMA_VERSION = 1;
export const PACK_TEMPLATE_VERSION = 'reaction-pack-v1';
export const PACK_LINES_PER_EVENT = 3;
export const PACK_MAX_TOKENS = 2500;
export const PACK_EMOTIONS = Object.freeze(['neutral', 'pleased', 'shy', 'surprised']);
/** 文本硬上限：与前端 characterReactionRules.js 的 MAX_VISIBLE_TEXT 保持一致 */
export const MAX_VISIBLE_TEXT = 40;

/** 归一化单条台词：折叠空白并去首尾；**不截断**，超长由解析器直接判不合格 */
function normalizeLineText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * 允许生成短句包的事件：前端注册表里真正会展示的 P0 事件。
 * 与 `characterReactionRules.js` 的 CATALOG 保持一致；新增事件时两处同时补齐。
 */
export const PACK_EVENT_TYPES = Object.freeze([
  'character.pin_enabled',
  'moment.like_enabled',
  'appearance.applied',
  'letter.reopened',
]);

/** 每个事件固定的事实边界说明（system3 内逐字稳定） */
export const PACK_EVENT_RULES = Object.freeze({
  'character.pin_enabled': '回应角色刚被置顶。不声称玩家取消了其他角色的置顶，不把置顶等同告白、誓约或承诺。',
  'moment.like_enabled': '回应玩家点赞角色发布的一条动态。不要描述动态内容；不要假定动态很旧或很新。',
  'appearance.applied': '回应玩家给角色用了一件外观类道具。不编造衣服颜色、款式、材质或后果。',
  'letter.reopened': '回应玩家重新打开了角色写来的一封已读旧信。不说玩家已经读完、读懂，也不复述信件内容。',
});

export function isPackEventType(type) {
  return PACK_EVENT_TYPES.includes(String(type || ''));
}

/** 规范化请求的事件集合：只保留白名单内的事件，保序去重 */
export function normalizePackEventTypes(types) {
  const list = Array.isArray(types) ? types : [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const type = String(raw || '').trim();
    if (!isPackEventType(type) || seen.has(type)) continue;
    seen.add(type);
    out.push(type);
  }
  return out;
}

/** 覆盖事件集合时的事件文案常量（供 §7.3 的示例教学使用） */
export function packExampleFor(type) {
  const samples = {
    'character.pin_enabled': [
      { text: '中文一句，12至32字，回应角色刚被置顶；不声称玩家取消了其他角色的置顶', emotion: 'pleased' },
      { text: '置顶反馈的第二种表达，中文一句且不超过40字；符合人设，不将置顶等同告白或誓约', emotion: 'neutral' },
      { text: '置顶反馈的第三种表达，中文一句且不超过40字；不要索取承诺，不重复系统成功提示', emotion: 'shy' },
    ],
    'moment.like_enabled': [
      { text: '中文一句，12至32字，回应玩家点赞了角色的一条动态；不描述动态内容', emotion: 'pleased' },
      { text: '点赞反馈的第二种表达，中文一句且不超过40字；不假定动态新旧，不索求更多互动', emotion: 'neutral' },
      { text: '点赞反馈的第三种表达，中文一句且不超过40字；符合人设，不要客服式答谢', emotion: 'surprised' },
    ],
    'appearance.applied': [
      { text: '中文一句，12至32字，回应玩家给角色用了一件外观道具；不编造颜色款式材质', emotion: 'pleased' },
      { text: '换装反馈的第二种表达，中文一句且不超过40字；不描述未提供的服装细节', emotion: 'shy' },
      { text: '换装反馈的第三种表达，中文一句且不超过40字；不做外貌评判，不索取夸奖', emotion: 'neutral' },
    ],
    'letter.reopened': [
      { text: '中文一句，12至32字，回应玩家重新打开了一封已读旧信；不说玩家已读完读懂', emotion: 'pleased' },
      { text: '旧信反馈的第二种表达，中文一句且不超过40字；不复述信件内容，不制造负罪感', emotion: 'surprised' },
      { text: '旧信反馈的第三种表达，中文一句且不超过40字；符合人设，不要求玩家解释', emotion: 'shy' },
    ],
  };
  return samples[type] || samples['character.pin_enabled'];
}

/** 组装本次请求事件的完整 JSON 输出示例（字段顺序固定） */
export function buildPackOutputExample(eventTypes, characterId = 0) {
  const reactions = eventTypes.map((type) => ({
    eventType: type,
    lines: packExampleFor(type).map(line => ({ text: line.text, emotion: line.emotion })),
  }));
  return JSON.stringify({ schemaVersion: PACK_SCHEMA_VERSION, characterId, reactions }, null, 2);
}

function buildPackTaskSystem(eventTypes) {
  const rules = eventTypes.map(type => `- ${type}：${PACK_EVENT_RULES[type]}`).join('\n');
  const example = buildPackOutputExample(eventTypes, 0);
  return `你是短反馈文案助手，为指定角色生成可重复使用的界面操作短反馈。

【任务】
针对下列每一种界面操作，用该角色自己的口吻各写 ${PACK_LINES_PER_EVENT} 条短台词。这些台词会被缓存起来反复使用，所以不要提及本次、今天、刚才等时间限定，也不要暗示对话历史。

【事件含义与事实边界】
${rules}

【通用要求】
1. 只依据提供的人设、事件含义与事实边界编写；用户操作是已定义的界面互动，不创造新经历。
2. 每条台词是纯文本，通常 12 到 32 个汉字，最多 ${MAX_VISIBLE_TEXT} 个可见字符；不含 HTML、Markdown、引号包裹或未允许的占位符。
3. 不说操作成功提示，不要求玩家回复或反问，不使用「谢谢你的支持」这类客服语气，不对取消、离开或管理行为制造负罪感。
4. 同一事件的三条要给出不同语气或侧重点，允许好奇、平静、得意、害羞、惊讶，不要统一套用甜蜜语气。
5. 严格按下面完整 JSON 示例输出，不要输出解释、Markdown 或 JSON 以外的文字。示例中的字段说明必须替换成实际台词，不要照抄说明文字。

【输出格式】
schemaVersion 必须为数字 ${PACK_SCHEMA_VERSION}；characterId 必须等于请求的角色 ID；reactions 必须覆盖本次指定的全部事件且每种恰好出现一次；每种事件恰好 ${PACK_LINES_PER_EVENT} 条。emotion 只能是 neutral / pleased / shy / surprised，表示素材选择意图，不要求存在对应图片。

示例中 characterId 用 0 占位，实际输出必须写请求给出的角色 ID：
${example}`;
}

export function buildPackMessages({ character, eventTypes }) {
  const systemRules = getSystemRulesWithWorld({ roleplay: false }) || '你是一个角色扮演 AI。';
  const persona = String(character?.base_prompt || '').trim()
    || String(character?.short_prompt || '').trim()
    || '（未提供角色人格资料，请给出克制、中性的短反应）';
  const displayName = character?.display_name || character?.name || '该角色';
  const userPrompt = `角色 ID：${character?.id}\n角色名：${displayName}\n请为这个角色生成上述 ${eventTypes.length} 种事件、每种 ${PACK_LINES_PER_EVENT} 条的短反馈，characterId 必须写 ${character?.id}。`;
  return [
    { role: 'system', content: systemRules },
    { role: 'system', content: buildPackTaskSystem(eventTypes) },
    { role: 'system', content: persona },
    { role: 'user', content: userPrompt },
  ];
}

// ── 严格解析 ──

function stripCodeFence(text) {
  const trimmed = String(text || '').trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fence ? fence[1].trim() : trimmed;
}

export function visibleLength(text) {
  return Array.from(String(text || '')).length;
}

/**
 * 解析并校验短句包。任何一项不合格 → 整包拒绝，调用方保留旧包。
 * @returns `{ ok:true, pack }` 或 `{ ok:false, error }`
 */
export function parseReactionPack(raw, { characterId, eventTypes } = {}) {
  let text = stripCodeFence(raw);
  if (!text) return { ok: false, error: '模型输出为空' };
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '模型输出不是合法 JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: '模型输出不是 JSON 对象' };
  }

  const extraRoot = Object.keys(parsed).filter(key => !['schemaVersion', 'characterId', 'reactions'].includes(key));
  if (extraRoot.length > 0) return { ok: false, error: `根对象含额外字段：${extraRoot.join(',')}` };
  if (Number(parsed.schemaVersion) !== PACK_SCHEMA_VERSION) return { ok: false, error: 'schemaVersion 与协议不符' };
  if (Number(parsed.characterId) !== Number(characterId)) return { ok: false, error: 'characterId 与请求角色不一致' };
  if (!Array.isArray(parsed.reactions)) return { ok: false, error: 'reactions 缺失或不是数组' };

  const wanted = normalizePackEventTypes(eventTypes);
  if (wanted.length === 0) return { ok: false, error: '请求的事件集合为空' };

  const seen = new Map();
  for (const item of parsed.reactions) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, error: 'reactions 元素不是对象' };
    const extraItem = Object.keys(item).filter(key => !['eventType', 'lines'].includes(key));
    if (extraItem.length > 0) return { ok: false, error: `事件含额外字段：${extraItem.join(',')}` };
    const type = String(item.eventType || '');
    if (!wanted.includes(type)) return { ok: false, error: `出现未请求的事件：${type || '(空)'}` };
    if (seen.has(type)) return { ok: false, error: `事件重复：${type}` };
    if (!Array.isArray(item.lines)) return { ok: false, error: `${type} 的 lines 不是数组` };
    if (item.lines.length !== PACK_LINES_PER_EVENT) {
      return { ok: false, error: `${type} 必须恰好 ${PACK_LINES_PER_EVENT} 条，实际 ${item.lines.length} 条` };
    }
    const lines = [];
    for (const line of item.lines) {
      if (!line || typeof line !== 'object' || Array.isArray(line)) return { ok: false, error: `${type} 的台词不是对象` };
      const extraLine = Object.keys(line).filter(key => !['text', 'emotion'].includes(key));
      if (extraLine.length > 0) return { ok: false, error: `${type} 的台词含额外字段：${extraLine.join(',')}` };
      if (typeof line.text !== 'string') return { ok: false, error: `${type} 的 text 缺失` };
      // 解析器按实际生成台词的长度验证，不做静默截断（§7.3）
      const clean = normalizeLineText(line.text);
      if (!clean) return { ok: false, error: `${type} 的 text 为空` };
      if (visibleLength(clean) > MAX_VISIBLE_TEXT) return { ok: false, error: `${type} 的 text 超过 ${MAX_VISIBLE_TEXT} 个可见字符` };
      if (/[<>]/.test(clean)) return { ok: false, error: `${type} 的 text 含 HTML 标记` };
      if (/\{[^}]*\}/.test(clean)) return { ok: false, error: `${type} 的 text 含未允许的占位符` };
      if (!PACK_EMOTIONS.includes(line.emotion)) return { ok: false, error: `${type} 的 emotion 不在允许枚举内` };
      lines.push({ text: clean, emotion: line.emotion });
    }
    seen.set(type, lines);
  }

  const missing = wanted.filter(type => !seen.has(type));
  if (missing.length > 0) return { ok: false, error: `缺少事件：${missing.join(',')}` };

  return {
    ok: true,
    pack: {
      schemaVersion: PACK_SCHEMA_VERSION,
      characterId: Number(characterId),
      reactions: wanted.map(type => ({ eventType: type, lines: seen.get(type) })),
    },
  };
}

/** 把包转成前端 `resolveCachedText` 认识的覆盖结构 `{ [phraseKey]: [{text,emotion}] }` */
export function packToOverrides(pack) {
  if (!pack || !Array.isArray(pack.reactions)) return {};
  const out = {};
  for (const item of pack.reactions) {
    if (!item?.eventType || !Array.isArray(item.lines)) continue;
    out[item.eventType] = item.lines.map(line => ({ text: line.text, emotion: line.emotion }));
  }
  return out;
}

// ── 人格指纹与持久化 ──

/** 人格指纹：base_prompt 缺失时回退 short_prompt；只做稳定短哈希，不保存正文 */
export function personaFingerprint(character) {
  const source = String(character?.base_prompt || '').trim() || String(character?.short_prompt || '').trim();
  if (!source) return 'empty';
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${source.length}-${(hash >>> 0).toString(36)}`;
}

function rowToPack(row, character) {
  if (!row) return null;
  let pack = null;
  try {
    pack = JSON.parse(row.pack_json);
  } catch {
    return { status: 'invalid', error: '已保存的短句包无法解析' };
  }
  const currentFingerprint = personaFingerprint(character);
  const stale = !!row.persona_fingerprint && row.persona_fingerprint !== currentFingerprint;
  return {
    characterId: row.character_id,
    schemaVersion: row.schema_version,
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
    personaFingerprint: row.persona_fingerprint,
    stale,
    status: stale ? 'updatable' : 'ready',
    pack,
    overrides: packToOverrides(pack),
  };
}

function readRow(characterId, db) {
  return db.prepare(`
    SELECT character_id, schema_version, pack_json, persona_fingerprint, prompt_template_version, generated_at, updated_at
    FROM character_reaction_packs WHERE character_id = ?
  `).get(characterId) || null;
}

function requireCharacter(characterId, db) {
  const id = parseInt(characterId, 10);
  if (!Number.isInteger(id)) return null;
  return db.prepare('SELECT id, display_name, name, base_prompt, short_prompt FROM characters WHERE id = ?').get(id) || null;
}

/** 读取某个角色的短句包（含失效标记）；没有则返回 null */
export function getReactionPack(characterId, db = getDb()) {
  const character = requireCharacter(characterId, db);
  if (!character) return null;
  return rowToPack(readRow(character.id, db), character);
}

/** 保存一份通过校验的包；非法包不覆盖旧包 */
export function saveReactionPack({ characterId, pack, personaFingerprint: fingerprint, db = getDb() }) {
  const character = requireCharacter(characterId, db);
  if (!character) throw Object.assign(new Error('角色不存在'), { status: 404 });
  if (!pack || !Array.isArray(pack.reactions)) throw Object.assign(new Error('短句包结构不合法'), { status: 400 });
  db.prepare(`
    INSERT INTO character_reaction_packs (character_id, schema_version, pack_json, persona_fingerprint, prompt_template_version, generated_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(character_id) DO UPDATE SET
      schema_version = excluded.schema_version,
      pack_json = excluded.pack_json,
      persona_fingerprint = excluded.persona_fingerprint,
      prompt_template_version = excluded.prompt_template_version,
      generated_at = datetime('now'),
      updated_at = datetime('now')
  `).run(
    character.id,
    PACK_SCHEMA_VERSION,
    JSON.stringify(pack),
    String(fingerprint || personaFingerprint(character)),
    PACK_TEMPLATE_VERSION,
  );
  return getReactionPack(character.id, db);
}

/** 删除某个角色的短句包 */
export function deleteReactionPack(characterId, db = getDb()) {
  const id = parseInt(characterId, 10);
  if (!Number.isInteger(id)) return false;
  const info = db.prepare('DELETE FROM character_reaction_packs WHERE character_id = ?').run(id);
  return info.changes > 0;
}

/**
 * 生成并保存一份短句包。
 * 单次请求、输出上限约 ${PACK_MAX_TOKENS} tokens；截断或不满足契约时整包不覆盖旧包。
 */
export async function generateReactionPack({
  characterId,
  eventTypes,
  db = getDb(),
  callLlm = chatSync,
} = {}) {
  const character = requireCharacter(characterId, db);
  if (!character) return { ok: false, status: 404, error: '角色不存在' };

  const wanted = normalizePackEventTypes(eventTypes);
  if (wanted.length === 0) return { ok: false, status: 400, error: '请求的事件集合为空' };

  try {
    const raw = await callLlm(buildPackMessages({ character, eventTypes: wanted }), {
      temperature: 0.9,
      max_tokens: PACK_MAX_TOKENS,
      response_format: { type: 'json_object' },
      label: '角色短句包',
      retries: 0,
    });
    const parsed = parseReactionPack(raw, { characterId: character.id, eventTypes: wanted });
    if (!parsed.ok) return { ok: false, status: 502, error: parsed.error };
    const saved = saveReactionPack({ characterId: character.id, pack: parsed.pack, db });
    return { ok: true, entry: saved };
  } catch (error) {
    return { ok: false, status: 502, error: error.message || '短句包生成失败' };
  }
}

/** 保存用户手动编辑的短句包（同一套严格校验） */
export function saveManualReactionPack({ characterId, pack, db = getDb() }) {
  const character = requireCharacter(characterId, db);
  if (!character) return { ok: false, status: 404, error: '角色不存在' };
  const eventTypes = Array.isArray(pack?.reactions) ? pack.reactions.map(item => item?.eventType) : [];
  const parsed = parseReactionPack(JSON.stringify(pack), { characterId: character.id, eventTypes });
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  return { ok: true, entry: saveReactionPack({ characterId: character.id, pack: parsed.pack, db }) };
}
