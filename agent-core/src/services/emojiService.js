import { getDb, getSystemRules, getSetting, setSetting } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { generateImageRaw } from './imageSkill.js';
import { extractImageCrossRefInfo } from './characterImageOpts.js';
import { saveBase64Image } from './imagePaths.js';
import { invalidateGalleryCache } from '../routes/images.js';

export const DEFAULT_EMOJI_KEYS = [
  '开心', '难过', '哭', '生气', '哈哈大笑', '卖萌', '晕倒',
  '害羞', '惊讶', '委屈', '得意', '比心',
  '无语', '嫌弃', '心虚',
];

/** 读取表情类别（可编辑，默认 15 类） */
export function getEmojiCategories(db = getDb()) {
  const rows = db.prepare('SELECT emoji_key FROM emoji_categories ORDER BY sort_order, id').all();
  if (rows.length > 0) {
    const keys = rows.map(r => r.emoji_key);
    const existing = new Set(keys);
    const legacyDefaults = DEFAULT_EMOJI_KEYS.slice(0, 12);
    if (legacyDefaults.every(k => existing.has(k))) {
      const missing = DEFAULT_EMOJI_KEYS.filter(k => !existing.has(k));
      if (missing.length > 0) return [...keys, ...missing];
    }
    return keys;
  }
  return [...DEFAULT_EMOJI_KEYS];
}

/** 保存表情类别（固定 15 个，仅修改名称） */
export function saveEmojiCategories(keys, db = getDb()) {
  const list = Array.isArray(keys) ? keys.map(k => String(k || '').trim()).filter(Boolean) : [];
  if (list.length !== 15) {
    throw new Error('表情类别固定为 15 个');
  }
  if (new Set(list).size !== list.length) {
    throw new Error('表情类别不能重复');
  }

  const replace = db.transaction(() => {
    db.prepare('DELETE FROM emoji_categories').run();
    const insert = db.prepare('INSERT INTO emoji_categories (emoji_key, sort_order) VALUES (?, ?)');
    list.forEach((k, i) => insert.run(k, i + 1));
  });
  replace();
  return list;
}

/**
 * 解析分句文本中的 [表情] / 【表情】：
 * - 命中 emojiMap 的 → 文本中删除该标记，URL 放入 images
 * - 未命中的 → 整个 [xxx] 直接舍弃
 * raw_messages 不需要调用本函数，只用于分句消息表 / SSE 推流。
 */
export function parseEmojiText(text, emojiMap = new Map()) {
  const raw = String(text || '');
  const images = [];
  const markerOffsets = [];
  const cleaned = raw.replace(/[\[【]([^\]】]*)[\]】]/g, (match, key, offset) => {
    const url = emojiMap.get(String(key || '').trim());
    if (url) { images.push(url); markerOffsets.push(offset); }
    return '';
  }).replace(/\s{2,}/g, ' ').trim();
  const firstVisible = raw.search(/[^\s\[【]/);
  const leadingSticker = images.length > 0 && markerOffsets.some(offset => firstVisible < 0 || offset < firstVisible);
  return { content: cleaned, images: [...new Set(images)], leadingSticker };
}

/** 构建注入 user 层最前面的表情包注明；没有可用表情时返回空字符串 */
export function buildEmojiNote(keys) {
  const list = [...new Set(keys.filter(Boolean))];
  if (list.length === 0) return '';
  return `<emoji_stickers>\n你只拥有[${list.join('],[')}]这些表情包。对话中可以用“[开心]今天天气真好”、“好难受[委屈]吃坏了肚子疼”，“[卖萌]”这样的形式来调用表情包丰富情感，表情包发送频率不能过高，隔几句话才发一次，不得调用注明以外的表情。\n</emoji_stickers>`;
}

/**
 * 群聊表情包注入：拥有表情包的成员达到一半及以上时，注入系统默认表情包组别与调用形式
 * （与私聊一致）；不按成员细分各自名册，发送时由说话人名册检索纠错，无图视为异常跳过。
 */
export function buildGroupEmojiNote(members, db = getDb()) {
  if (!Array.isArray(members) || members.length === 0) return '';
  const owners = members.filter(m => getCharacterEmojiMap(m.id, db).size > 0);
  if (owners.length * 2 < members.length) return '';
  const keys = getEmojiCategories(db);
  if (keys.length === 0) return '';
  return `<emoji_stickers>\n群成员可以调用[${keys.join('],[')}]这些表情包。对话中可以用“[开心]今天天气真好”、“好难受[委屈]吃坏了肚子疼”，“[卖萌]”这样的形式来调用表情包丰富情感，表情包发送频率不能过高，隔几句话才发一次。方括号只允许用于调用上述表情包，不得用方括号描写动作。\n</emoji_stickers>`;
}

/**
 * 群聊文本表情包解析（带异常检测）：
 * - 命中说话人 emojiMap → 与 parseEmojiText 一致：删除标记、URL 进 images
 * - 命中表情类别但说话人没有该表情 → invalidEmoji=true，调用方视为异常跳过这条消息
 * - 其余方括号内容 → 按私聊规则直接舍弃
 */
export function parseGroupEmojiText(text, emojiMap = new Map(), categoryKeys = []) {
  const raw = String(text || '');
  const categories = categoryKeys instanceof Set ? categoryKeys : new Set(categoryKeys || []);
  let invalidEmoji = false;
  for (const match of raw.matchAll(/[\[【]([^\]】]*)[\]】]/g)) {
    const key = String(match[1] || '').trim();
    if (key && categories.has(key) && !emojiMap.has(key)) { invalidEmoji = true; break; }
  }
  return { ...parseEmojiText(raw, emojiMap), invalidEmoji };
}

/** 读取角色所有 done 且已落盘的 emoji：key -> image_path */
export function getCharacterEmojiMap(characterId, db = getDb()) {
  const rows = db.prepare(`
    SELECT emoji_key, image_path FROM character_emojis
    WHERE character_id = ? AND status = 'done' AND image_path IS NOT NULL
  `).all(characterId);
  return new Map(rows.map(r => [r.emoji_key, r.image_path]));
}

/** 从 base_prompt 中提取「## 你的外观」段（到下一个 ## 或结尾） */
export function extractAppearanceSection(basePrompt) {
  const base = String(basePrompt || '');
  const m = base.match(/##\s*你的外观([\s\S]*)$/);
  if (!m) return '';
  const next = m[1].indexOf('\n## ');
  return (next >= 0 ? m[1].slice(0, next) : m[1]).trim();
}

/**
 * 表情包固定 tag 默认值：由代码硬编码到每条 prompt 开头，不再依赖 LLM 输出（省 token 且不会丢 tag）。
 * 前置还能抬高权重：主体构图 → 风格 → 背景，后接表情内容。
 * 可在表情包管理「高级设置」中修改（存 DB system_settings，key=emoji_fixed_tags）。
 */
export const DEFAULT_EMOJI_FIXED_TAGS = [
  'chibi character, big head',
  'LINE sticker style, clean bold outlines, simple flat colors, expressive face',
  'white background',
];

const EMOJI_TAGS_SETTING_KEY = 'emoji_fixed_tags';
const EMOJI_STYLE_MODE_SETTING_KEY = 'emoji_style_mode';

/** 表情包风格模式：half_body=半身（起手式额外追加 half body）/ chibi_head=猪鼻大头（禁服装描述） */
export const EMOJI_STYLE_MODES = {
  HALF_BODY: 'half_body',
  CHIBI_HEAD: 'chibi_head',
};

/** 当前表情包风格；未设置时默认猪鼻大头（与现网行为一致） */
export function getEmojiStyleMode() {
  const saved = getSetting(EMOJI_STYLE_MODE_SETTING_KEY);
  return saved === EMOJI_STYLE_MODES.HALF_BODY ? EMOJI_STYLE_MODES.HALF_BODY : EMOJI_STYLE_MODES.CHIBI_HEAD;
}

/** 保存表情包风格 */
export function saveEmojiStyleMode(mode) {
  if (mode !== EMOJI_STYLE_MODES.HALF_BODY && mode !== EMOJI_STYLE_MODES.CHIBI_HEAD) {
    throw new Error('表情包风格仅支持 half_body / chibi_head');
  }
  setSetting(EMOJI_STYLE_MODE_SETTING_KEY, mode);
  return mode;
}

/** 当前固定 tag 文本（逗号分隔）；未自定义时回落默认值 */
export function getEmojiFixedTagsText() {
  const saved = getSetting(EMOJI_TAGS_SETTING_KEY);
  const text = typeof saved === 'string' ? saved.trim() : '';
  return text || DEFAULT_EMOJI_FIXED_TAGS.join(', ');
}

/** 保存固定 tag 文本（逗号分隔），空白折叠为单空格 */
export function saveEmojiFixedTagsText(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('固定 tag 不能为空');
  setSetting(EMOJI_TAGS_SETTING_KEY, clean);
  return clean;
}

/** 给 prompt 前置缺失的固定 tag（已存在则跳过，大小写不敏感，保留原文大小写）；tagsText 缺省读当前配置 */
function prependFixedEmojiTags(prompt, tagsText) {
  const listText = typeof tagsText === 'string' && tagsText.trim() ? tagsText : getEmojiFixedTagsText();
  const original = String(prompt || '').trim();
  const lower = original.toLowerCase();
  const tags = listText.split(',').map(t => t.trim()).filter(Boolean);
  const missing = tags.filter(tag => !lower.includes(tag.toLowerCase()));
  if (missing.length === 0) return original;
  return original ? `${missing.join(', ')}, ${original}` : missing.join(', ');
}

/** 兜底 prompt：当创造助手返回 JSON 缺某个 key 时使用，固定 tag 由 prependFixedEmojiTags 统一前置 */
function fallbackEmojiPrompt(char, key) {
  const cross = extractImageCrossRefInfo(char);
  const identity = cross.split('\n')[0] || char.display_name || 'character';
  return [
    `${key} expression`,
    'centered composition, no background objects',
    identity,
  ].join(', ');
}

/** 解析创造助手返回的 JSON object，确保当前表情类别的 key 全部存在；fixedTagsText 为按模式组装后的起手式 tag */
export function parseEmojiPromptJson(raw, char, keys = DEFAULT_EMOJI_KEYS, fixedTagsText = null) {
  let text = String(raw || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.warn('[emoji] JSON.parse failed, trying key-wise regex fallback:', err.message);
    parsed = {};
  }

  const out = {};
  for (const key of keys) {
    const val = typeof parsed?.[key] === 'string' ? parsed[key].trim() : '';
    out[key] = prependFixedEmojiTags(val || fallbackEmojiPrompt(char, key), fixedTagsText);
  }
  return out;
}

/**
 * 表情包专用生图规则（替代通用 image_prompt 全局规则）：
 * 只保留角色写法核心，去掉多人/场景/光影/氛围等表情包用不到的要求；服饰约束按模式注入。
 */
function buildEmojiImageRule(styleMode) {
  const chibi = styleMode === EMOJI_STYLE_MODES.CHIBI_HEAD;
  const anchors = chibi
    ? '发型、发色、瞳色、瞳孔/眼球特征、嘴巴、表情、头部配饰等至少 3 项'
    : '发型、发色、瞳色、标志性服装、配饰、体型、辨识特征等至少 5 项';
  const example = chibi
    ? "'Furina \\(Genshin Impact\\) \\(white hair with blue streaks, blue eyes, star-shaped pupils, gold hair ornament\\) happy grin'"
    : "'Furina \\(Genshin Impact\\) \\(white hair with blue streaks, blue eyes, blue top hat and tailcoat, gold trim\\) waving with a soft smile'";
  const modeRule = chibi
    ? '猪鼻大头风格只保留大头与表情, 角色必须转成 Q版大头。允许项：发型、发色、瞳色、眼球/瞳孔特征、眉毛、嘴巴、表情、脸型、头部配饰。禁止项：任何服装、衣着、脖颈以下身体、胸部、腹部、腰部、臀部、腿部、鞋袜、choker/项链；禁止词包括但不限于 suit, midriff, exposed midriff, build, figure, chest, breast, waist, hips, legs, boots, stockings, skirt, pants, shorts, shoes, choker, necklace, torso, clothing, outfit。'
    : '半身构图（half body 由系统前置追加），角色服装保持原设定即可，无需为场景换装。';
  return [
    '本任务生成 SDXL 表情包提示词，适用以下专用生图规则（替代通用生图规则）：',
    `1. 角色写法（核心）：每个 prompt 中的角色一律写成 'Name \\(Series\\)'，作品名后用括号注明${anchors}，随后接角色在该表情下的表情与肢体动作。示例：${example}。`,
    `2. ${modeRule}`,
    '3. 全英文，不出现中文；不使用未转义的双引号，需要引用时一律用单引号。',
  ].join('\n');
}

/** 调创造助手生成表情 prompt（json_object，温度 0.75），keys 缺省读取 DB 中可编辑的类别 */
export async function generateEmojiPrompts(char, style = '', keys = null) {
  const emojiKeys = keys || getEmojiCategories();
  const system0 = getSystemRules({ roleplay: false });
  const appearance = extractAppearanceSection(char.base_prompt);
  const styleMode = getEmojiStyleMode();
  const system1 = buildEmojiImageRule(styleMode);
  let tagsText = getEmojiFixedTagsText();
  if (styleMode === EMOJI_STYLE_MODES.HALF_BODY) {
    tagsText = `${tagsText}, half body`;
  } else {
    tagsText = `${tagsText}, only head`;
  }
  // 高缓存分层：稳定指令、角色信息拆成独立 system，用户方向单独放最后
  const requirements = [
    `prompt 生成格式遵循前面生图规则中的角色写法，${emojiKeys.length} 条 prompt 中的角色写法必须保持一致。`,
    '在此前提下，每个 prompt 只描述该表情下的表情、神态与肢体动作，英文，不超过 80 词，不出现中文，不使用双引号（需要引用时一律用单引号）。',
  ];
  requirements.push(`不要写背景、画风、构图类描述（${tagsText}）。这些固定 tag 由系统在生成后自动前置到每条 prompt 开头，你重复输出只会浪费 token。`);
  requirements.push('输出严格 JSON object：键是上面的中文表情名，值是对应 prompt 字符串。不要 Markdown 代码块，不要解释。');
  const system2 = `你是 LINE 表情包提示词生成助手。
请为角色生成 ${emojiKeys.length} 种表情的 ComfyUI 英文提示词。

表情列表：${emojiKeys.join('、')}

固定要求：
${requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
  const system3 = `${char.short_prompt || ''}\n\n角色外观：\n${appearance || '以 short_prompt 为准，保持角色原有辨识度'}`;

  const displayName = char.display_name || char.name || '目标角色';
  // user 层明确指向角色资料，防止模型跑偏到别的角色或泛化形象
  const charRef = `为上方角色资料中的角色「${displayName}」生成上述全部 ${emojiKeys.length} 种表情的 prompt。角色的名字、外观锚点与辨识特征严格以该角色资料为准，套用到每一种表情上，${emojiKeys.length} 条 prompt 必须保持同一个角色形象。`;
  const userPromptParts = [charRef];
  if (style) {
    userPromptParts.push(`用户指定表情包整体风格：${style}。必须把该风格明确写入每个 prompt 中，与 LINE 表情包风格叠加。这是本次最重要的方向，优先级最高。`);
  }
  const userPrompt = userPromptParts.join('\n');

  const raw = await chatSync(
    [
      { role: 'system', content: system0 },
      { role: 'system', content: system1 },
      { role: 'system', content: system2 },
      { role: 'system', content: system3 },
      { role: 'user', content: userPrompt },
    ],
    {
      temperature: 0.75,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      label: 'emoji-prompt',
    }
  );

  return parseEmojiPromptJson(raw, char, emojiKeys, tagsText);
}

/** 角色 loras 解析（与私聊生图保持一致） */
export function parseCharacterLoras(char) {
  if (!char?.loras) return [];
  try {
    const parsed = typeof char.loras === 'string' ? JSON.parse(char.loras) : char.loras;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(l => l.path && typeof l.path === 'string')
      .map(l => ({
        path: l.path,
        weight: typeof l.weight === 'number' ? l.weight : 0.6,
        triggerWord: l.triggerWord || '',
      }));
  } catch {
    return [];
  }
}

/**
 * 提交 ComfyUI 生成单张表情包，并写入 data/images/emoji。
 * @returns {Promise<{ok:boolean, url?:string, error?:string}>}
 */
export async function generateEmojiImage(row, char, artist = '@ebora') {
  const characterId = row.character_id;
  const emojiKey = row.emoji_key;
  const finalArtist = typeof artist === 'string' && artist.trim() ? artist.trim() : '@ebora';
  const loras = parseCharacterLoras(char);

  const result = await generateImageRaw(row.prompt, {
    scene: 'chat',                 // LoRA 场景过滤沿用私聊
    workflowScene: 'emoji',        // hybrid 模式下允许为表情包单独配置工作流
    skipOptimization: true,        // prompt 已由创造助手定稿，不再走 RAG 改写
    persistPreparation: false,
    width: 512,
    height: 512,
    artist: finalArtist,
    ...(loras.length > 0 ? { loras } : {}),
    ...(char.custom_workflow ? { customWorkflow: char.custom_workflow } : {}),
  });

  if (!result.success || result.images.length === 0) {
    return { ok: false, error: result.error || 'ComfyUI 未返回图片' };
  }

  const img = result.images[0];
  const filename = `char_${characterId}_${emojiKey}_${Date.now()}.png`;
  const url = saveBase64Image('emoji', filename, img.base64);
  try { invalidateGalleryCache(); } catch {}
  return { ok: true, url };
}
