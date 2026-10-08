/**
 * 角色「体型 / 身高」推导（生图用）
 *
 * ── 要解决的问题 ────────────────────────────────────────────
 * 多人同屏时，模型不知道角色之间的体型差，会把全场最高的角色和最矮的角色画成同一高度，
 * 与角色卡设定不符（同框的两个人看不出谁高谁矮）。
 *
 * 身高本来就写在角色卡「## 你的外观」的正文里（例：「你身高157cm，……体型偏瘦」），
 * 但它有两个缺陷：
 *   ① 埋在中文自由文本中，生图提示词要求「全英文」，翻译过程中最容易把这句丢掉；
 *   ② 在 `IMAGE_PROMPT_RULE` 里 `build` 只是「≥6 个外观锚点」里的一个可选项，
 *      模型凑够 6 个（发色/发型/瞳色/服装/配饰/特征）就收工，体型经常不进画面。
 *
 * 本模块把卡里**已有**的身高/体型表述解析成一条**结构化、高显著度**的标注，
 * 供生图交叉参考与「多人同屏体型对照」使用。
 *
 * ── 原则 ───────────────────────────────────────────────────
 * - **只做读出，不发明**：卡、身体描述里既没有身高也没有体型词 → 返回 null，绝不猜数值。
 * - **用词中性**：只用 petite / short / average / tall 这类身高体型词，不推断其它任何身体属性。
 * - 纯函数可单测；只有 `collectBuildTexts` 会碰 DB，且取不到时静默降级。
 */

import { listSceneOutfits } from './outfitScene.js';

/** 身高正则：优先「身高157cm」这种明确写法，其次宽松的「157cm」 */
const HEIGHT_PATTERNS = [
  /身高[约为大概左右]?\s*(\d{3})\s*(?:cm|厘米|CM|Cm)/,
  /(\d{3})\s*(?:cm|厘米|CM|Cm)/,
];

/** 中文体型词 → 规范 tag（只在没有身高时作为兜底） */
const BUILD_KEYWORDS = [
  { tag: 'petite', re: /娇小|矮小|小个子|小只|身量小|个子小|petite/i },
  { tag: 'slender', re: /纤细|纤瘦|单薄|骨感|瘦削|瘦弱|偏瘦|slender|slim|skinny/i },
  { tag: 'curvy', re: /丰满|丰腴|有料|凹凸有致|沙漏|curvy|busty|full-figured/i },
  { tag: 'tall', re: /高挑|修长|高个|长腿|tall|long-legged/i },
  { tag: 'average', re: /匀称|中等身材|标准身材|平均身高|average/i },
];

/** 身高 → 体型档（分界取整，覆盖常见二次元角色身高带） */
export function bucketOfHeight(cm) {
  if (cm == null || !Number.isFinite(cm)) return null;
  if (cm < 152) return 'petite';
  if (cm < 160) return 'short';
  if (cm <= 168) return 'average';
  if (cm <= 175) return 'tall';
  return 'verytall';
}

/**
 * 从一段文本里读出身高（cm）。取第一个命中，120~210 之外的视为误匹配。
 * @param {string} text
 * @returns {number|null}
 */
export function extractHeightCm(text) {
  const s = String(text || '');
  for (const re of HEIGHT_PATTERNS) {
    const m = s.match(re);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (n >= 120 && n <= 210) return n;
  }
  return null;
}

/**
 * 从一段文本里读出体型词。
 * @param {string} text
 * @returns {string|null} petite / slender / curvy / tall / average
 */
export function extractBuildTag(text) {
  const s = String(text || '');
  for (const k of BUILD_KEYWORDS) {
    if (k.re.test(s)) return k.tag;
  }
  return null;
}

/** 带身高时的英文标注（生图可直接用） */
function enWithHeight(bucket, cm) {
  switch (bucket) {
    case 'petite': return `petite frame, small stature (about ${cm}cm), clearly below average adult height`;
    case 'short': return `short (about ${cm}cm), small frame`;
    case 'tall': return `tall (about ${cm}cm), long-limbed`;
    case 'verytall': return `very tall (about ${cm}cm), long-limbed`;
    default: return `average height (about ${cm}cm)`;
  }
}

/** 只有体型词、没有身高时的英文标注 */
function enTagOnly(tag) {
  switch (tag) {
    case 'petite': return 'petite frame, small stature, clearly below average adult height';
    case 'slender': return 'slender build';
    case 'curvy': return 'full-figured build';
    case 'tall': return 'tall, long-limbed';
    default: return 'average build';
  }
}

/**
 * 取该角色可用于推导体型的所有文本源（优先用卡上正文，身体描述只作兜底）。
 * 无 DB / 查不到时静默降级——本函数从不抛错。
 * @param {object} character
 * @returns {string[]}
 */
export function collectBuildTexts(character) {
  const parts = [character?.base_prompt, character?.short_prompt].filter(Boolean).map(String);
  try {
    const rows = listSceneOutfits(character?.id);
    // body 是 5 套共用的一份，取任意一行即可
    const body = rows.find(r => r.body && String(r.body).trim())?.body;
    if (body) parts.push(String(body));
  } catch { /* 单测/无 DB 环境：忽略 */ }
  return parts;
}

/**
 * 推导角色的体型信息。
 * @param {object} character - characters 表行（至少含 base_prompt；可选 id 以读取身体描述）
 * @returns {{heightCm:number|null, bucket:string|null, en:string|null, source:'height'|'keyword'|null}}
 */
export function deriveBuild(character) {
  const texts = collectBuildTexts(character);
  for (const t of texts) {
    const cm = extractHeightCm(t);
    if (cm != null) {
      const bucket = bucketOfHeight(cm);
      return { heightCm: cm, bucket, en: enWithHeight(bucket, cm), source: 'height' };
    }
  }
  for (const t of texts) {
    const tag = extractBuildTag(t);
    if (tag) return { heightCm: null, bucket: tag, en: enTagOnly(tag), source: 'keyword' };
  }
  return { heightCm: null, bucket: null, en: null, source: null };
}

/**
 * 生图交叉参考里用的体型行（中文标签 + 英文 tag，便于模型直接搬进英文提示词）。
 * 卡里读不出体型时返回 null（不加噪声）。
 * @param {object} character
 * @returns {string|null}
 */
export function buildBodySizeLine(character) {
  const d = deriveBuild(character);
  if (!d.en) return null;
  const zh = d.heightCm != null ? `身高约 ${d.heightCm}cm` : '体型';
  return `【体型】${zh}（生图 tag：${d.en}）`;
}

/** 档位的展示名（中文） */
const BUCKET_ZH = {
  petite: '矮小', short: '偏矮', average: '中等', tall: '高挑', verytall: '很高',
};

/**
 * 「多人同屏体型对照」块：把同框角色的身高排好序，明确要求画面体现高度差。
 * 只有 1 人（或全场都读不出体型）时返回 null —— 单人不存在体型差问题，不加噪声。
 * @param {Array<object>} characters - 本画面涉及的角色（表行，可含 base_prompt / id / display_name）
 * @returns {string|null}
 */
export function buildCastBodySummary(characters) {
  const list = (characters || []).filter(Boolean);
  if (list.length < 2) return null;

  const withH = [];
  const noH = [];
  const seen = new Set();
  for (const c of list) {
    const name = c.display_name || c.name || `#${c.id}`;
    if (seen.has(name)) continue;
    seen.add(name);
    const d = deriveBuild(c);
    if (d.heightCm != null) withH.push({ name, cm: d.heightCm });
    else if (d.bucket) noH.push({ name, bucket: d.bucket });
  }
  // 一条身高都没有 → 无从对比，不输出（避免让模型凭空排序）
  if (withH.length < 2) return null;

  withH.sort((a, b) => a.cm - b.cm);
  const lines = withH.map((x, i) => {
    const bucket = bucketOfHeight(x.cm);
    const mark = i === 0 ? '（全场最矮）' : (i === withH.length - 1 ? '（全场最高）' : '');
    return `- ${x.name}：约 ${x.cm}cm，${BUCKET_ZH[bucket] || '中等'}${mark}`;
  });
  const tail = noH.length
    ? `\n另有 ${noH.map(x => `${x.name}（${BUCKET_ZH[x.bucket] || x.bucket}）`).join('、')} 未标注具体身高，按其中文体型词与上表比对处理。`
    : '';

  return `【本画面人物体型对照 —— 必须体现在画面的高度差上】
${lines.join('\n')}${tail}
同框时按上述身高比例呈现，最矮的角色不得超过最高角色的肩线；**严禁把全场角色画成同一高度**。`;
}
