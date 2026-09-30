// 世界观「分框」模型：把一套世界观拆成固定四个要素框 + 名称框。
//
// 设计目标（2026-09 世界观改造）：让用户分框填写、分框导入世界观，而不是把一大段文字
// 一股脑塞进 content。注入方式不变：四个非空框按固定顺序拼成 Markdown 分节文本，
// 回写 world_settings.content 快照；所有既有调用点仍读 content / getWorldSetting()。
//
// 依赖方向（单向）：本模块为纯函数集，不 import db / config。

/** 四个内容框的定义（顺序即拼装顺序；label 同时用作拼装时的分节标题） */
export const WORLD_FIELD_DEFS = Object.freeze([
  {
    key: 'background',
    label: '世界背景',
    hint: '这是一个什么样的世界：时代、舞台、基本法则。',
    example: '例如：一个灵气复苏的现代都市，妖怪隐居在人类城市里，双方维持着脆弱的和平。',
  },
  {
    key: 'society',
    label: '社会结构',
    hint: '人们怎么生活、怎么相处：日常规则、行为方式、组织与群体。',
    example: '例如：妖怪协会负责调解纠纷；人类对妖怪的存在心照不宣，假装看不见。',
  },
  {
    key: 'abilities',
    label: '特殊能力',
    hint: '这个世界超越现实的能力与规则（没有可留空）。',
    example: '例如：妖怪能附身在旧物上；人类灵视者可以看见常人看不见的影子。',
  },
  {
    key: 'reinforce',
    label: '需要强化的设定',
    hint: '希望 AI 每次都严格遵守、不许偏移的关键设定。',
    example: '例如：妖怪不能主动暴露身份；任何冲突都优先用谈判解决。',
  },
]);

const WORLD_FIELD_KEYS = WORLD_FIELD_DEFS.map(d => d.key);

/** 注入场景档位：
 *  - full   全量（默认；现有 ~20 处调用点无参调用即此档，行为与改造前一致）
 *  - visual 生图类（跳过「社会结构」——人群怎么相处对画面没有信息量）
 *  - light  轻量（只取 世界背景 + 需要强化的设定；如回复猜测） */
const SCOPE_FIELD_KEYS = Object.freeze({
  full: WORLD_FIELD_KEYS,
  visual: ['background', 'abilities', 'reinforce'],
  light: ['background', 'reinforce'],
});

export function isValidWorldScope(scope) {
  return scope === 'full' || scope === 'visual' || scope === 'light';
}

/** 归一化输入为 { background, society, abilities, reinforce } 全字符串对象（多余键丢弃） */
export function normalizeWorldFields(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const key of WORLD_FIELD_KEYS) {
    const v = src[key];
    out[key] = typeof v === 'string' ? v.trim() : '';
  }
  return out;
}

export function isEmptyWorldFields(fields) {
  return WORLD_FIELD_KEYS.every(key => !String(fields?.[key] || '').trim());
}

/**
 * 把分框内容拼装为最终注入文本（即 world_settings.content 快照的生成规则）。
 * 非空框按 WORLD_FIELD_DEFS 顺序输出 `## 标题` 分节；空框跳过；全空返回 ''。
 * @param {object} fields normalizeWorldFields 形态
 * @param {'full'|'visual'|'light'} [scope='full']
 */
export function assembleWorldContent(fields, scope = 'full') {
  const keys = SCOPE_FIELD_KEYS[scope] || SCOPE_FIELD_KEYS.full;
  const src = normalizeWorldFields(fields);
  const sections = [];
  for (const def of WORLD_FIELD_DEFS) {
    if (!keys.includes(def.key)) continue;
    const body = src[def.key];
    if (body) sections.push(`## ${def.label}\n${body}`);
  }
  return sections.join('\n\n');
}

// ── 老内容自动切分（迁移 & 前端「从现有内容拆分」共用）──

// 已知的分节标题 → 目标框。润色端点历史产出前两类；「深层逻辑」本质是世界观说明，归入背景。
const SECTION_HEADING_MAP = [
  { re: /^#{0,4}\s*\[?世界背景\]?[：:]?\s*$/, key: 'background' },
  { re: /^#{0,4}\s*\[?深层逻辑\]?[：:]?\s*$/, key: 'background' },
  { re: /^#{0,4}\s*\[?日常规则\]?[：:]?\s*$/, key: 'society' },
  { re: /^#{0,4}\s*\[?人们的行为\]?[：:]?\s*$/, key: 'society' },
  { re: /^#{0,4}\s*\[?社会结构\]?[：:]?\s*$/, key: 'society' },
  { re: /^#{0,4}\s*\[?特殊能力\]?[：:]?\s*$/, key: 'abilities' },
  { re: /^#{0,4}\s*\[?(?:需要强化的设定|强化设定|关键设定)\]?[：:]?\s*$/, key: 'reinforce' },
];

function headingToKey(line) {
  const text = String(line || '').trim();
  if (!text) return null;
  for (const { re, key } of SECTION_HEADING_MAP) {
    if (re.test(text)) return key;
  }
  return null;
}

/**
 * 把旧的单块世界观文本切成四框。识别 `## 标题` 与 `【标题】` 两类分节；
 * 已知标题切换目标框；识别不了的标题视为上一框的延续（首个标题之前的内容归入
 * 「世界背景」），保证内容零丢失。
 * @returns {object} normalizeWorldFields 形态
 */
export function splitWorldContentIntoFields(content) {
  const fields = normalizeWorldFields(null);
  const text = String(content || '').trim();
  if (!text) return fields;

  const paragraphs = text.split(/\n{2,}/);
  let currentKey = null;
  const buckets = { background: [], society: [], abilities: [], reinforce: [] };

  for (const para of paragraphs) {
    const firstLine = para.split('\n', 1)[0].trim();
    const headingKey = headingToKey(firstLine);
    // 无结构文本（第一段之前没有任何标题）：随段落进入 background
    if (headingKey) {
      currentKey = headingKey;
      const rest = para.split('\n').slice(1).join('\n').trim();
      if (rest) buckets[currentKey].push(rest);
      continue;
    }
    // 段首的【标题】行不算分节边界，原样保留（前端把它渲染为层级标记）
    buckets[currentKey || 'background'].push(para.trim());
  }

  for (const key of WORLD_FIELD_KEYS) {
    fields[key] = buckets[key].join('\n\n').trim();
  }
  return fields;
}

// ── 酒馆世界书（character_book / lorebook）导入 ──

// 逐条词条的目标框启发式：按标题/关键词/内容命中归类，未命中 → background。
const BOOK_ABILITY_HINTS = /(能力|法术|技能|异能|力量体系|灵力|魔力|修为|境界|blood|ability|power|magic|skill)/i;
const BOOK_SOCIETY_HINTS = /(社会|组织|势力|阵营|公会|教会|王国|帝国|规则|法律|习俗|阶层|族群|faction|guild|kingdom|society|rule)/i;

/** 从酒馆世界书卡片提取词条数组（兼容 character_book.entries / lorebook / 裸数组 / {entries:{}} 等形态） */
export function extractLorebookEntries(book) {
  if (!book || typeof book !== 'object') return [];
  let raw = null;
  if (Array.isArray(book)) raw = book;
  else if (Array.isArray(book.entries)) raw = book.entries;
  else if (book.entries && typeof book.entries === 'object') raw = Object.values(book.entries);
  else if (book.character_book?.entries) raw = Array.isArray(book.character_book.entries)
    ? book.character_book.entries
    : Object.values(book.character_book.entries);
  else if (book.data?.character_book?.entries) {
    const e = book.data.character_book.entries;
    raw = Array.isArray(e) ? e : Object.values(e);
  }
  if (!Array.isArray(raw)) return [];

  return raw.map((entry, index) => {
    const content = String(entry?.content ?? entry?.text ?? '').trim();
    const keys = Array.isArray(entry?.keys)
      ? entry.keys
      : Array.isArray(entry?.key)
        ? entry.key
        : (typeof entry?.key === 'string' && entry.key ? [entry.key] : []);
    const title = String(entry?.title ?? entry?.comment ?? entry?.name ?? keys[0] ?? `词条${index + 1}`).trim();
    return {
      title: title.slice(0, 60),
      content,
      keys: keys.map(k => String(k).trim()).filter(Boolean).slice(0, 8),
      constant: entry?.constant === true || entry?.alwaysActive === true,
      enabled: entry?.enabled !== false && entry?.disable !== true,
      index,
    };
  }).filter(e => e.content);
}

/** 单条词条的默认目标框（导入弹窗里用户可改） */
export function suggestFieldForEntry(entry) {
  const hay = [entry.title, ...entry.keys, entry.content].filter(Boolean).join('\n');
  if (BOOK_ABILITY_HINTS.test(hay)) return 'abilities';
  if (BOOK_SOCIETY_HINTS.test(hay)) return 'society';
  return 'background';
}

/**
 * 把词条按目标框合并成分框文本：每条为 `【标题】内容`（空标题退化为纯内容），条目间空行分隔。
 * @param {Array<{title,content,field}>} assignments extractLorebookEntries + 用户指定的 field
 */
export function mergeLorebookAssignments(assignments) {
  const fields = normalizeWorldFields(null);
  for (const { field, title, content } of assignments) {
    if (!WORLD_FIELD_KEYS.includes(field)) continue;
    const body = String(content || '').trim();
    if (!body) continue;
    const head = String(title || '').trim();
    const block = head ? `【${head}】${body}` : body;
    (fields[field] = fields[field] || '');
    fields[field] = fields[field] ? `${fields[field]}\n\n${block}` : block;
  }
  return fields;
}
