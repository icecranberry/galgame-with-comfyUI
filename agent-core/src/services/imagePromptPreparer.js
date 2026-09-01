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
function scoreChineseLabelOverlap(labelText, matchText) {
  if (!/[\p{Script=Han}]/u.test(labelText || '') || !/[\p{Script=Han}]/u.test(matchText || '')) return 0;
  const labelGrams = chineseHanBigrams(labelText);
  if (labelGrams.length < 2) return 0;
  const matchGrams = new Set(chineseHanBigrams(matchText));
  const matched = labelGrams.filter(gram => matchGrams.has(gram)).length;
  if (matched < 2 || matched / labelGrams.length < 0.5) return 0;
  return matched === labelGrams.length ? 16 : 14;
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
    const multiPerson = /\b(two|three|duo|couple|group|crowd|multiple|2girls|2boys|3girls|3boys)\b/.test(matchText)
      || /\b1girl\s+1boy\b/.test(matchText);
    if (!multiPerson) {
      addRuleTag(selected, 'solo', 'ipk.count.solo', 'count_identity', 'single-subject default', promptText);
      removeSelectedTags(selected, ['2girls', '2boys', '3girls', '3boys', 'multiple_girls', 'multiple_boys'], 'ipk.count.solo', 'conflicts with solo', removedTags);
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

export function composeImagePrompt(prompt, items = [], { ragQuery = '' } = {}) {
  const selected = selectExecutableTags(prompt, items, ragQuery);
  const ruleResult = applyKnowledgeRules(prompt, items, selected, ragQuery);
  resolveSelectedConflicts(selected, ruleResult.removedTags);
  selected.sort((a, b) => b.score - a.score || b.priority - a.priority);

  const cleanedOriginal = cleanOriginalPrompt(prompt, ruleResult.removedPhrases);
  const selectedTags = selected.map(item => item.tag);
  const promptRefined = [cleanedOriginal, ...selectedTags].filter(Boolean).join(', ');
  return {
    promptRefined: promptRefined || String(prompt || '').trim(),
    selectedTags: selected.map(({ tag, category, knowledgeId, score, reason }) => ({ tag, category, knowledgeId, score, reason })),
    removedTags: ruleResult.removedTags,
    appliedRules: ruleResult.appliedRules,
  };
}

function persistPreparation(result, db = getDb()) {
  const snapshot = {
    scene: result.scene,
    query: result.ragQuery,
    selectedTags: result.selection.selectedTags,
    removedTags: result.selection.removedTags,
    appliedRules: result.selection.appliedRules,
    items: result.retrieval.items.map(item => ({
      id: item.id,
      category: item.category,
      title: item.title,
      content: item.content,
      score: item.score,
    })),
  };
  const inserted = db.prepare(`
    INSERT INTO image_prompt_preparations (
      scene, prompt_original, prompt_refined, knowledge_ids, knowledge_version,
      retrieval_mode, retrieval_snapshot, optimization_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    result.scene,
    result.promptOriginal,
    result.promptRefined,
    JSON.stringify(result.retrieval.knowledgeIds),
    result.retrieval.knowledgeVersion,
    result.retrieval.mode,
    JSON.stringify(snapshot),
    result.status,
  );
  return Number(inserted.lastInsertRowid);
}

function emptySelection() {
  return { selectedTags: [], removedTags: [], appliedRules: [] };
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
  persist = true,
  db = null,
  ragTimeoutMs = undefined,
} = {}) {
  const sceneAliases = { event: 'events', peek: 'schedule', gifts: 'gift', avatargen: 'avatar' };
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
  const selection = composeImagePrompt(original, retrieval.items, { ragQuery: retrievalQuery });
  const foundTags = selection.selectedTags.map(item => item.tag);
  console.log(`[imagePromptKnowledge] query=${JSON.stringify(retrievalQuery.slice(0, 160))} mode=${retrieval.mode} duration=${retrieval.durationMs}ms tags=${JSON.stringify(foundTags)}`);
  const status = selection.promptRefined === original ? 'fallback' : 'deterministic';
  const result = { promptOriginal: original, ragQuery: retrievalQuery, promptRefined: selection.promptRefined, status, scene, retrieval, selection };
  if (persist) result.preparationId = persistPreparation(result, database);
  return result;
}
