import { getDb } from '../db/index.js';
import { retrieveImagePromptKnowledge } from './imagePromptKnowledge.js';

const DEFAULT_CATEGORY_LIMIT = 2;
const CATEGORY_LIMITS = new Map([
  ['character_vocabulary', 2],
  ['clothing_vocabulary', 3],
  ['expression_pose_vocabulary', 3],
  ['environment_vocabulary', 4],
  ['scene_vocabulary', 3],
  ['object_vocabulary', 2],
  ['camera_vocabulary', 2],
  ['visual_style_vocabulary', 2],
  ['adult_pose_vocabulary', 2],
]);

// ipk.lib.*（YAML 词库菜单）10/12 分属语素/词汤级擦边命中（「白色」蹭出 infirmary、
// long hair + dress 拼出 long dress），不注入；14+（bigram 过半/别名/短语命中）才算概念确实被提到。
// 框架条目是策展规则词，保持非零即入选。
const LIB_TAG_MIN_SCORE = 14;

const TAG_ALIASES = new Map([
  ['closed_eyes', ['eyes closed']],
  ['looking_at_viewer', ['looking at the viewer', 'direct eye contact', 'eye contact']],
  ['facing_away', ['back view', 'back facing']],
  ['from_behind', ['back view']],
  ['full_body', ['whole body']],
  ['close-up', ['closeup', 'headshot']],
  ['rain', ['rainy']],
]);

const CONFLICT_GROUPS = [
  ['close-up', 'close_up', 'full_body', 'wide_shot', 'cowboy_shot', 'upper_body'],
  ['from_front', 'from_behind'],
  ['from_above', 'from_below'],
  ['looking_at_viewer', 'facing_away', 'looking_away'],
  ['standing', 'sitting', 'lying', 'on_back'],
  ['open_mouth', 'closed_mouth'],
  ['spread_fingers', 'clenched_fist'],
  ['spread_legs', 'legs_together'],
];

function normalizeForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTagKey(value) {
  return normalizeForMatch(value).replace(/\s+/g, '_');
}

function phraseInPrompt(promptText, phrase) {
  const normalized = normalizeForMatch(phrase);
  if (!normalized) return false;
  if (/[\p{Script=Han}]/u.test(normalized)) {
    return promptText.includes(normalized);
  }
  return ` ${promptText} `.includes(` ${normalized} `);
}

function chineseHanBigrams(text) {
  const words = String(text || '').match(/[\u3400-\u9fff]+/g) || [];
  const grams = new Set();
  for (const word of words) {
    if (word.length === 1) grams.add(word);
    for (let index = 0; index < word.length - 1; index += 1) {
      grams.add(word.slice(index, index + 2));
    }
  }
  return [...grams];
}

// 中文不像英文可以用空格分词；用保守的 Han bigram 重叠容忍“地雷女/地雷系”这类近义措辞。
// 短 query 往往只与 label 共享一个 2 字词（如「初音未来口交」×「蹲姿口交」只共享「口交」），
// 单 gram 命中给中间分而不是一票否决，否则带注解/修饰的 label 永远无法被选为可执行 tag。
function scoreChineseLabelOverlap(labelText, matchText) {
  if (!/[\p{Script=Han}]/u.test(labelText || '') || !/[\p{Script=Han}]/u.test(matchText || '')) return 0;
  const labelGrams = chineseHanBigrams(labelText);
  if (labelGrams.length === 0) return 0;
  const matchGrams = new Set(chineseHanBigrams(matchText));
  const matched = labelGrams.filter(gram => matchGrams.has(gram)).length;
  if (matched === 0) return 0;
  if (matched === labelGrams.length) return 16;
  if (matched / labelGrams.length >= 0.5) return 14;
  return 10;
}

function scoreExecutableTag(promptText, entry) {
  const tag = String(entry?.tag || '').trim();
  if (!tag) return 0;
  const normalizedTag = normalizeForMatch(tag);
  if (!normalizedTag) return 0;

  let score = 0;
  if (phraseInPrompt(promptText, normalizedTag)) score = 20;
  const label = normalizeForMatch(entry?.label);
  if (label && phraseInPrompt(promptText, label)) score = Math.max(score, 20);

  const key = normalizeTagKey(tag);
  for (const alias of TAG_ALIASES.get(key) || []) {
    if (phraseInPrompt(promptText, alias)) score = Math.max(score, 16);
  }

  if (score === 0) {
    score = scoreChineseLabelOverlap(label, promptText);
  }

  if (score === 0) {
    const parts = normalizedTag.split(' ').filter(part => part.length > 1);
    const matched = parts.filter(part => phraseInPrompt(promptText, part)).length;
    if (parts.length >= 2 && matched === parts.length) score = 12;
  }
  return score;
}

function exactPromptSegments(prompt) {
  return new Set(String(prompt || '')
    .split(/[,;\n]+/)
    .map(normalizeTagKey)
    .filter(Boolean));
}

function selectExecutableTags(prompt, items, ragQuery = '') {
  const promptText = normalizeForMatch(prompt);
  const ragQueryText = normalizeForMatch(ragQuery);
  const matchText = [promptText, ragQueryText].filter(Boolean).join('\n');
  const existingSegments = exactPromptSegments(prompt);
  const candidates = [];

  for (const item of items) {
    for (const entry of item.executableTags || []) {
      const tag = String(entry?.tag || '').trim();
      const tagParts = tag.split(',').map(part => part.trim()).filter(Boolean);
      const score = scoreExecutableTag(matchText, entry);
      if (score === 0) continue;
      if (String(item.id || '').startsWith('ipk.lib.') && score < LIB_TAG_MIN_SCORE) continue;
      candidates.push({
        tag,
        key: normalizeTagKey(tag),
        category: item.category,
        knowledgeId: item.id,
        score,
        priority: Number(item.priority || 0),
        reason: entry?.label ? `matched:${entry.label}` : 'matched:tag',
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || b.priority - a.priority || a.tag.length - b.tag.length);
  const selected = [];
  const seen = new Set();
  const categoryCounts = new Map();
  for (const candidate of candidates) {
    if (!candidate.key || seen.has(candidate.key) || existingSegments.has(candidate.key)) continue;
    const count = categoryCounts.get(candidate.category) || 0;
    const limit = CATEGORY_LIMITS.get(candidate.category) || DEFAULT_CATEGORY_LIMIT;
    if (count >= limit) continue;
    selected.push(candidate);
    seen.add(candidate.key);
    categoryCounts.set(candidate.category, count + 1);
  }
  return selected;
}

function addRuleTag(selected, tag, knowledgeId, category, reason, promptText) {
  if (phraseInPrompt(promptText, tag)) return;
  const key = normalizeTagKey(tag);
  const existing = selected.find(item => item.key === key);
  if (existing) {
    existing.score = Math.max(existing.score, 100);
    existing.reason = reason;
    existing.knowledgeId = knowledgeId;
    return;
  }
  selected.push({ tag, key, category, knowledgeId, score: 100, priority: 100, reason });
}

function removeSelectedTags(selected, keys, knowledgeId, reason, removedTags) {
  const removeKeys = new Set(keys.map(normalizeTagKey));
  for (let index = selected.length - 1; index >= 0; index--) {
    if (!removeKeys.has(selected[index].key)) continue;
    removedTags.push({ tag: selected[index].tag, knowledgeId, reason });
    selected.splice(index, 1);
  }
}

function applyKnowledgeRules(prompt, items, selected, ragQuery = '') {
  const promptText = normalizeForMatch(prompt);
  const ragQueryText = normalizeForMatch(ragQuery);
  const matchText = [promptText, ragQueryText].filter(Boolean).join('\n');
  const knowledgeIds = new Set(items.map(item => item.id));
  const removedTags = [];
  const removedPhrases = [];
  const appliedRules = [];

  if (knowledgeIds.has('ipk.count.solo')) {
    // ★★ 人数判定的**唯一真源** —— 这里踩过一个代价很大的坑（2026-10-05）：
    //    原判据把 `two` / `three` 当**裸词**匹配，于是 "in her **two** hands"
    //    "**two** legs raised" "**two** pigtails" 全被当成"多人" → `solo` 标签**不再添加**
    //    → 模型把**同一个角色画成两个人**（用户实报：日程/朋友圈/对话的图都出现）。
    //    84 条体位的 prompt 里有大量 "two hands/two legs"，命中率极高。
    //
    //    修法：数字词**必须后接人（或明确的复数容器）**才算多人；同时显式排除身体部位词。
    const PART_WORDS = 'hands?|arms?|legs?|feet|foot|eyes?|breasts?|nipples?|thighs?|knees?|pigs?|pigtails?|ears?|hands|pupils?';
    const NUM_WORD = '(?:two|three|four|five|both|several|multiple|many)';
    const multiPerson =
      // ① 明确的人名词（最可靠）
      /\b(?:2|3|4)girls?\b|\b(?:2|3|4)boys?\b|\b1girl\s+1boy\b|\bmultiple_(?:girls|boys)\b/.test(matchText)
      // ② duo / couple / threesome / group / crowd 这类**本身就是多人**的词
      || /\b(?:duo|couple|couple's|threesome|threesomes|group|crowd|gangbang|orgy|polyamory)\b/.test(matchText)
      // ③ 「数字词 + 人/人群」才算；`two hands` 这类身体部位**不算**
      || new RegExp(`\\b${NUM_WORD}\\s+(?!${PART_WORDS}\\b)(?:people|persons?|men|women|girls?|boys?|guys|characters?|figures?|participants?|partners?|lovers?)`, 'i').test(matchText)
      // ④ 裸 `multiple` 后接人（`multiple hands` 不算）
      || new RegExp(`\\bmultiple\\s+(?!${PART_WORDS}\\b)\\w+`, 'i').test(matchText);
    // ⑤ 反例兜底：句子明确说了单人 → 即使命中上面也按单人（"alone"/"by herself" 是强信号）
    const explicitlyAlone = /\b(?:alone|by (?:her|him|them)sel(?:f|ves)|on her own|solo)\b/i.test(matchText);
    if (!multiPerson || explicitlyAlone) {
      addRuleTag(selected, 'solo', 'ipk.count.solo', 'count_identity', 'single-subject default', promptText);
      removeSelectedTags(selected, ['2girls', '2boys', '3girls', '3boys', 'multiple_girls', 'multiple_boys'], 'ipk.count.solo', 'conflicts with solo', removedTags);
      // ★ 光从候选表里删是不够的 —— 用户**原文**里若已经写了 `2girls`，它会原样留在提示词里，
      //   结果拼成 `… 2girls, street, solo`（自相矛盾，模型照样画两个人）。
      //   `removedPhrases` 才是从原文剥词的机制，必须一并登记。
      removedPhrases.push(
        /\b(?:2|3|4)girls?\b/gi, /\b(?:2|3|4)boys?\b/gi,
        /\bmultiple_(?:girls|boys)\b/gi,
      );
      appliedRules.push('ipk.count.solo');
    }
  }

  if (knowledgeIds.has('ipk.gaze.sleep') && /\b(sleep|sleeping|asleep|unconscious|nap|napping)\b/.test(matchText)) {
    addRuleTag(selected, 'closed_eyes', 'ipk.gaze.sleep', 'gaze', 'sleep requires closed eyes', promptText);
    removeSelectedTags(selected, ['looking_at_viewer', 'direct_eye_contact', 'open_eyes'], 'ipk.gaze.sleep', 'conflicts with sleeping', removedTags);
    removedPhrases.push(/\blooking at (?:the )?viewer\b/gi, /\bdirect eye contact\b/gi, /\beye contact\b/gi);
    appliedRules.push('ipk.gaze.sleep');
  }

  if (knowledgeIds.has('ipk.camera.closeup') && /\b(close up|closeup|headshot|face focus)\b/.test(matchText)) {
    addRuleTag(selected, 'close-up', 'ipk.camera.closeup', 'camera', 'explicit close-up framing', promptText);
    removeSelectedTags(selected, ['full_body', 'wide_shot'], 'ipk.camera.closeup', 'conflicts with close-up', removedTags);
    removedPhrases.push(/\bfull body\b/gi, /\bwide shot\b/gi);
    appliedRules.push('ipk.camera.closeup');
  } else if (knowledgeIds.has('ipk.camera.fullbody') && /\b(full body|whole body)\b/.test(matchText)) {
    addRuleTag(selected, 'full_body', 'ipk.camera.fullbody', 'camera', 'explicit full-body framing', promptText);
    removeSelectedTags(selected, ['close-up', 'close_up', 'headshot'], 'ipk.camera.fullbody', 'conflicts with full body', removedTags);
    removedPhrases.push(/\bclose[ -]?up\b/gi, /\bheadshot\b/gi);
    appliedRules.push('ipk.camera.fullbody');
  }

  if (knowledgeIds.has('ipk.gaze.away') && /\b(from behind|back view|facing away)\b/.test(matchText) && !/\bover shoulder\b/.test(matchText)) {
    removeSelectedTags(selected, ['looking_at_viewer'], 'ipk.gaze.away', 'conflicts with facing away', removedTags);
    removedPhrases.push(/\blooking at (?:the )?viewer\b/gi, /\bdirect eye contact\b/gi);
    appliedRules.push('ipk.gaze.away');
  }

  if (knowledgeIds.has('ipk.environment.night') && /\b(night|nighttime|evening)\b/.test(matchText)) {
    addRuleTag(selected, 'night', 'ipk.environment.night', 'environment', 'explicit night scene', promptText);
    removeSelectedTags(selected, ['bright_sunlight', 'daytime'], 'ipk.environment.night', 'conflicts with night', removedTags);
    appliedRules.push('ipk.environment.night');
  }

  if (knowledgeIds.has('ipk.environment.day') && /\b(day|daytime|morning|afternoon)\b/.test(matchText)) {
    removeSelectedTags(selected, ['night', 'moonlight'], 'ipk.environment.day', 'conflicts with daytime', removedTags);
    appliedRules.push('ipk.environment.day');
  }

  return { removedTags, removedPhrases, appliedRules };
}

function resolveSelectedConflicts(selected, removedTags) {
  for (const group of CONFLICT_GROUPS) {
    const keys = new Set(group.map(normalizeTagKey));
    const matches = selected.filter(item => keys.has(item.key)).sort((a, b) => b.score - a.score || b.priority - a.priority);
    if (matches.length <= 1) continue;
    const keep = matches[0];
    for (const item of matches.slice(1)) {
      const index = selected.indexOf(item);
      if (index >= 0) selected.splice(index, 1);
      removedTags.push({ tag: item.tag, knowledgeId: item.knowledgeId, reason: `conflicts with ${keep.tag}` });
    }
  }
}

function cleanOriginalPrompt(prompt, removedPhrases) {
  let cleaned = String(prompt || '').trim();
  for (const pattern of removedPhrases) cleaned = cleaned.replace(pattern, '');
  return cleaned
    .replace(/\s+,/g, ',')
    .replace(/,{2,}/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s*,\s*|\s*,\s*$/g, '')
    .trim();
}

export function composeImagePrompt(prompt, items = [], { ragQuery = '', timeOfDay } = {}) {
  const selected = selectExecutableTags(prompt, items, ragQuery);
  const ruleResult = applyKnowledgeRules(prompt, items, selected, ragQuery);
  resolveSelectedConflicts(selected, ruleResult.removedTags);
  selected.sort((a, b) => b.score - a.score || b.priority - a.priority);

  const cleanedOriginal = cleanOriginalPrompt(prompt, ruleResult.removedPhrases);

  // ★ 时段锚点：把画面钉在正确光照下（用户报"凌晨生成出白天"）。
  //   ⚠ **只有调用方显式传了 timeOfDay 才注入** —— 不传时行为与改动前逐字节一致
  //     （红线：默认可不改变行为）。注意 `timeOfDayAnchor(undefined)` 会用"当前时间"，
  //     那是给直接调用者用的语义；这里必须先判空，不能把 undefined 透传进去。
  const anchor = (timeOfDay === undefined || timeOfDay === null || timeOfDay === '')
    ? null
    : timeOfDayAnchor(timeOfDay);
  let tags = selected.map(item => item.tag);
  const removedTags = ruleResult.removedTags.slice();
  let cleaned = cleanedOriginal;
  if (anchor) {
    // ① 压制相反时段词：**必须同时清理"原始描述"与"RAG 选出的标签"**，
    //    只清标签不够 —— 描述里往往就写着 daytime / bright_sunlight（实测踩到）。
    //
    // ⚠ 不能用 `\b` 做边界：下划线是 `\w`，`\bbright_sunlight\b` 在 "bright_sunlight" 上
    //   照样成立，但在"逗号相连"时反而漏配；这里统一用「前后不是字母」判定，并把
    //   下划线/空格视为等价（bright_sunlight ≡ bright sunlight）。
    // ⚠⚠ **必须先转义、再插入字符类**：反过来写会把 `[` `]` 一起转义成 `\[ \]` →
    //   正则变成字面量 `[ _]`，永远匹配不到（这个坑已实测踩到，bright_sunlight 匹配失败）。
    // ⚠⚠ **test 必须用不带 g 的正则**：带 `g` 的 RegExp 在 test() 成功后会推进 lastIndex，
    //   下一次调用从上次位置继续 → 同一正则第二次匹配同一文本会返回 false（实测踩到，
    //   表现为"第一个词能压、后续都不压"）。replace 才需要 g。
    const rxSrc = (s) => `(?<![a-z])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '[ _]')}(?![a-z])`;
    const rx = (s) => new RegExp(rxSrc(s), 'gi');      // 仅用于 replace
    const rxTest = (s) => new RegExp(rxSrc(s), 'i');   // 用于 test（无 g，避免 lastIndex 污染）
    const hitText = (text) => anchor.suppress.some(s => rxTest(s).test(String(text)));
    tags = tags.filter(t => {
      if (hitText(t)) { removedTags.push({ tag: t, reason: `时段冲突（${anchor.label}）` }); return false; }
      return true;
    });
    // 原始描述里也要剔（逐词替换，保留其余内容）
    for (const s of anchor.suppress) cleaned = cleaned.replace(rx(s), '');
    // 反复清直到稳定：一次 `/,\s*,/g` 只合并一层，删词后会**新产生**相邻逗号（实测残留 ", ,"）
    let prev;
    do {
      prev = cleaned;
      cleaned = cleaned.replace(/,\s*,/g, ',').replace(/\s{2,}/g, ' ');
    } while (cleaned !== prev);
    cleaned = cleaned.replace(/^[,\s]+|[,\s]+$/g, '').trim();
    // ② 追加本时段的画面锚点 —— 整句作为一条 tag（已不含逗号，不会被下游 split 拆碎）
    tags.push(anchor.en);
  }

  const selectedTags = selected.map(({ tag, category, knowledgeId, score, reason }) => ({ tag, category, knowledgeId, score, reason }));
  const promptRefined = [cleaned, ...tags].filter(Boolean).join(', ');

  return {
    promptRefined: promptRefined || String(prompt || '').trim(),
    selectedTags,
    removedTags,
    appliedRules: anchor ? [...ruleResult.appliedRules, `timeOfDay:${anchor.key}`] : ruleResult.appliedRules,
    timeOfDay: anchor,
  };
}

function emptySelection() {
  return { selectedTags: [], removedTags: [], appliedRules: [] };
}

/**
 * 按时钟算「时段锚点」—— 用于把生图钉在正确的光照下。
 *
 * ── 为什么需要它（2026-10-06 用户报）──────────────────────────
 * 用户报"日程写的是凌晨 2 点自慰，生图出来是白天"。
 * 根因：**生图链路完全不感知时间** —— `imageSkill` / `prepareImagePrompt` 里没有任何时段输入，
 * 而日程描述里往往**不写"深夜/凌晨"字样**（只写"在睡梦里无意识的自慰"），
 * 于是 `applyKnowledgeRules` 那条"显式出现 night 才加 night 标签"的规则也匹配不到 →
 * 模型默认按"白天、明亮"画。
 *
 * 修法：由**调用方传入的真实时刻**（不是让模型猜）推出时段，作为硬性画面锚点注入，
 * 并**压制相反时段词**（如凌晨 2 点要把 daytime / bright_sunlight 剔掉）。
 *
 * @param {Date|number|string} [at] 该画面发生的时刻；缺省用当前时间
 * @returns {{key:string, label:string, en:string, suppress:string[]}|null}
 *          null = 无法判定（不注入，行为与改动前一致）
 */
export function timeOfDayAnchor(at) {
  let h;
  if (at === undefined || at === null || at === '') {
    h = new Date().getHours();
  } else if (at instanceof Date) {
    h = at.getHours();
  } else if (typeof at === 'number' && Number.isFinite(at)) {
    h = new Date(at).getHours();
  } else if (typeof at === 'string' && /^\d{1,2}:\d{2}$/.test(at.trim())) {
    h = Number(at.split(':')[0]);                       // 直接传 "02:30" 这种日程时间
  } else {
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return null;
    h = d.getHours();
  }
  if (!Number.isFinite(h)) return null;
  h = ((h % 24) + 24) % 24;

  // 档位与压制词：**白天档压夜间词、夜晚档压白天词**，方向不能反（写反等于不压制）。
  // ⚠ 实测踩到：凌晨档曾错挂 DAY_SUPPRESS → 想压 daytime 却去压 night，等于没压。
  // 两条压制表，**命名即语义**（避免"白天用哪张表"这种混淆）：
  //   SUPPRESS_NIGHT_WORDS = 白天档用：把描述里的「夜间词」剔掉（含裸词 night）
  //   SUPPRESS_DAY_WORDS   = 夜间档用：把描述里的「白天词」剔掉（**不含 night** —— 夜晚本来就有 night）
  // ⚠ 写反方向 = 等于没压制（曾把凌晨档错挂成白天表，实测踩到）。
  const SUPPRESS_NIGHT_WORDS = ['night', 'nighttime', 'moonlight', 'darkness', 'dim lighting', 'candlelight'];
  const SUPPRESS_DAY_WORDS = ['daytime', 'bright_sunlight', 'bright sunlight', 'sunny', 'daylight', 'midday sun'];
  if (h >= 5 && h < 8)  return { key: 'dawn',    label: '清晨',   en: 'early morning soft dawn light with low sun and long shadows', suppress: SUPPRESS_NIGHT_WORDS };
  if (h >= 8 && h < 11) return { key: 'morning', label: '上午',   en: 'bright morning daylight with clear natural light', suppress: SUPPRESS_NIGHT_WORDS };
  if (h >= 11 && h < 14) return { key: 'noon',   label: '中午',   en: 'harsh midday sunlight with strong shadows and high contrast', suppress: SUPPRESS_NIGHT_WORDS };
  if (h >= 14 && h < 17) return { key: 'afternoon', label: '下午', en: 'warm afternoon light with soft golden tones', suppress: SUPPRESS_NIGHT_WORDS };
  if (h >= 17 && h < 19) return { key: 'dusk',   label: '傍晚',   en: 'golden hour dusk with orange-pink sky and long shadows', suppress: SUPPRESS_NIGHT_WORDS };
  if (h >= 19 && h < 22) return { key: 'evening', label: '夜晚',  en: 'lamplit evening interior with warm artificial light and dark windows', suppress: SUPPRESS_DAY_WORDS };
  if (h >= 22 || h < 1) return { key: 'night',   label: '深夜',   en: 'deep night with dim warm lamplight or darkness in a dark room', suppress: SUPPRESS_DAY_WORDS };
  return { key: 'late_night', label: '凌晨', en: 'late night after midnight with very dim lighting in a dark room', suppress: SUPPRESS_DAY_WORDS };
}

function emptyRetrieval() {
  return { mode: 'none', items: [], knowledgeIds: [], knowledgeVersion: '' };
}

/**
 * 业务侧传入的中文描述优先作为 RAG query；没有中文时回退英文 prompt。
 */
export function resolveImageRagQuery(prompt, ragQuery) {
  const original = String(prompt || '').trim();
  const provided = String(ragQuery || '').trim();
  return /[\p{Script=Han}]/u.test(provided) ? provided : original;
}

export async function prepareImagePrompt(prompt, {
  scene = 'chat',
  ragQuery = '',
  disableRAG = false,
  alreadyPrepared = false,
  skipOptimization = false,
  // ★ 该画面发生的时刻（Date / 毫秒 / 'HH:MM'）—— 用于注入时段光照锚点，
  //   修「凌晨的活动生成出白天图」。不传 = 不注入（行为与改动前一致）。
  timeOfDay = undefined,
  // 不再落库：检索快照只是诊断留档，全项目无读者（曾占库 68%），需要时从返回值里看即可
  db = null,
  ragTimeoutMs = undefined,
} = {}) {
  const sceneAliases = { event: 'events', peek: 'schedule', gifts: 'gift', avatargen: 'avatar', town: 'town' };
  scene = sceneAliases[scene] || scene;
  const original = String(prompt || '').trim();
  if (!original) {
    return { promptOriginal: original, promptRefined: original, ragQuery: original, status: 'empty', scene, retrieval: emptyRetrieval(), selection: emptySelection() };
  }
  if (disableRAG) {
    return { promptOriginal: original, promptRefined: original, ragQuery: original, status: 'rag_disabled', scene, retrieval: { mode: 'rag_disabled', items: [], knowledgeIds: [], knowledgeVersion: '' }, selection: emptySelection() };
  }
  if (alreadyPrepared || skipOptimization) {
    return { promptOriginal: original, promptRefined: original, ragQuery: original, status: 'skipped', scene, retrieval: emptyRetrieval(), selection: emptySelection() };
  }

  const retrievalQuery = resolveImageRagQuery(original, ragQuery);
  const database = db || getDb();
  const retrieval = await retrieveImagePromptKnowledge(retrievalQuery, { scene, db: database, timeoutMs: ragTimeoutMs });
  const selection = composeImagePrompt(original, retrieval.items, { ragQuery: retrievalQuery, timeOfDay });
  const foundTags = selection.selectedTags.map(item => item.tag);
  console.log(`[imagePromptKnowledge] query=${JSON.stringify(retrievalQuery.slice(0, 160))} mode=${retrieval.mode} duration=${retrieval.durationMs}ms tags=${JSON.stringify(foundTags)}`);
  const status = selection.promptRefined === original ? 'fallback' : 'deterministic';
  const result = { promptOriginal: original, ragQuery: retrievalQuery, promptRefined: selection.promptRefined, status, scene, retrieval, selection };
  // 结果只在内存中返回（promptRefined / retrieval 等），不写数据库
  return result;
}
