/**
 * 小镇素材的 LLM 出英文 prompt 统一结构：
 *   system0 = 破甲词 + 世界观
 *   system1 = 世界观强化
 *   system2 = 输出结构
 *   system3 = 任务要求 + 素材/角色信息
 *   user    = 执行指令；用户额外指定也放在这里
 */
import { chatSync } from '../../llm/llm-client.js';
import { getSystemRules, getWorldSetting } from '../../db/index.js';
import { STANDING_IMAGE_PROMPT_RULE, getWorldIntegrationRule } from '../../builtinRules.js';

function system0() {
  const rules = getSystemRules({ roleplay: false });
  const world = getWorldSetting();
  return [rules, world].filter(Boolean).join('\n\n');
}

function system0And1() {
  const world = getWorldSetting();
  const msgs = [{ role: 'system', content: system0() }];
  if (world) {
    msgs.push({ role: 'system', content: getWorldIntegrationRule('town_asset') });
  }
  return msgs;
}

function stripFence(content) {
  return String(content || '')
    .replace(/^\s*```(?:[a-z]+)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

// ── 立绘（900×1600 白底插画，交互时跳出展示） ──

const PORTRAIT_TASK_REQUIREMENTS = `【任务要求】
你是一个专业的二次元游戏角色立绘设计师。请在<world_setting>的背景下，为下面的小镇居民设计一张纯白色背景的立绘。

【立绘硬性要求（与生图规则冲突时，以本条为准）】
- 纯白色背景（white background, simple background），不要环境场景铺陈；可伴随光效（如逆光、辉光、漂浮粒子）或一小部分与角色职业相关的实物点缀，但主体始终是角色本身
- 画面为单人立绘（solo, 1girl/1boy 按角色性别），全身构图，头部到脚部完整入画
- 以正面展示为主，可由角色气质与职业决定最合适的角度与姿势，展现角色的生活气息
- 图片比例约 9:16（竖幅），按这个比例设计整个画面结构
- 严格基于 system 中提供的角色外观信息设计服装与外形，不得自行改动角色的发型、发色、瞳色与标志性特征`;

/**
 * 生成居民/玩家立绘英文 prompt。
 * @param {object} p - { appearanceInfo, requirement? }
 */
export async function generatePortraitPrompt({ appearanceInfo, requirement = '' }) {
  const extra = String(requirement || '').trim();
  const msgs = [
    ...system0And1(),
    { role: 'system', content: STANDING_IMAGE_PROMPT_RULE.rule_content },
    {
      role: 'system',
      content: `${PORTRAIT_TASK_REQUIREMENTS}\n\n【角色外观信息】\n${appearanceInfo}`,
    },
    {
      role: 'user',
      content: extra
        ? `【用户额外指定】\n${extra}\n\n请执行：结合额外需求设计角色立绘，并以英文 prompt 输出。`
        : '请执行：设计这位小镇居民的立绘，自由发挥姿势与镜头角度，充分展现角色的魅力，并以英文 prompt 输出。',
    },
  ];
  const out = await chatSync(msgs, {
    temperature: 0.7,
    max_tokens: 1024,
    label: '小镇立绘提示词',
  });
  const text = stripFence(out);
  if (!text || text.length < 10) throw new Error('LLM 生成的立绘提示词不完整');
  return text;
}

// ── 像素小人（600×800 白底 → 像素化 36×48，正/背两面） ──

const SPRITE_OUTPUT_STRUCTURE = `【输出结构】
Describe the requested chibi pixel character sprite in natural English as one continuous paragraph.

**MUST:** Write the character's appearance with at least 6 accurate appearance anchors (hairstyle, hair color, eye color, signature outfit, accessories, build, distinctive features), then the standing pose. State the facing direction explicitly (front view facing the viewer / back view seen from behind).

Hard Rules:
- ALL text in English. No Chinese characters anywhere.
- Output only the prompt paragraph, without headings, explanations, analysis, lists, or code fences.
- Do not use unescaped double quotation marks ("). Use single quotes (') instead.
- MAX 400 characters total.`;

const SPRITE_TASK_REQUIREMENTS = `【任务要求】
你是一个专业的像素游戏角色精灵设计师。请在<world_setting>的背景下，为下面的小镇居民设计一张像素小人精灵图。

【精灵硬性要求（与生图规则冲突时，以本条为准）】
- 纯白色背景（pure white background, no shadow on the ground）
- 单个角色（solo），Q版二头身像素小人（chibi, big head small body），全身完整入画，头部到脚部都在画面内
- 角色占画面绝大部分（character fills the frame），居中
- 干净粗像素描边、有限色板（clean thick pixel outlines, limited color palette, crisp pixel edges）
- 服装与外形严格按 system 提供的外观信息，不得自行改动标志性特征
- 画面里只有角色本身：没有地面、没有阴影投影、没有道具台座、没有文字`;

/**
 * 生成像素小人英文 prompt。
 * @param {object} p - { appearanceInfo, direction: 'down'|'up' }
 */
export async function generateSpritePrompt({ appearanceInfo, direction = 'down' }) {
  const facing = direction === 'up'
    ? '背面视角：角色背对观众（seen from behind, back view）'
    : '正面视角：角色面朝观众（front view facing the viewer）';
  const msgs = [
    ...system0And1(),
    { role: 'system', content: SPRITE_OUTPUT_STRUCTURE },
    { role: 'system', content: `${SPRITE_TASK_REQUIREMENTS}\n\n【角色外观信息】\n${appearanceInfo}` },
    { role: 'user', content: `请执行：设计这位居民的像素小人精灵（${facing}），并以英文 prompt 输出。` },
  ];
  const out = await chatSync(msgs, {
    temperature: 0.7,
    max_tokens: 500,
    label: '小镇精灵提示词',
  });
  const text = stripFence(out);
  if (!text || text.length < 10) throw new Error('LLM 生成的精灵提示词不完整');
  return text;
}

// ── 一次出齐全套（正面 / 背面 / 大立绘） ──

const NPC_SET_OUTPUT_STRUCTURE = `【输出结构】
必须严格按以下 JSON 格式输出，禁止输出 JSON 以外的任何文字（解释、注释、markdown 代码块都不允许）：

{
  "down": "chibi pixel character sprite, front view facing the viewer, short black hair, silver eyes, white apron over a brown dress, small satchel, slender build, standing straight with hands at her sides, pure white background, no shadow on the ground, clean thick pixel outlines, limited color palette, solo character centered filling the frame",
  "up": "chibi pixel character sprite, seen from behind, back view, short black hair, silver eyes, white apron tied in a bow at the back over a brown dress, small satchel across the back, slender build, standing straight with arms relaxed, pure white background, no shadow on the ground, clean thick pixel outlines, limited color palette, solo character centered filling the frame",
  "portrait": "full body anime style character illustration, short black hair, silver eyes, white apron over a brown dress with a small satchel, standing in a relaxed pose holding a tray, soft rim light, pure white background, solo, vertical 9:16 composition"
}

字段约束：
- down / up：同一个角色的像素小人精灵。先写至少 6 个准确外观锚点（发型、发色、瞳色、标志性服装、配饰、体型特征），再写站姿；down 必须是正面（front view facing the viewer），up 必须是背面（seen from behind, back view）；两者都要写清 pure white background、no shadow on the ground、chibi big head、clean thick pixel outlines、limited color palette、solo character centered filling the frame。各自 400 字符以内。
- portrait：大立绘插画。先写外观锚点与服装外形，再写姿势与镜头；必须写清 pure white background、solo、全身从头顶到脚完整入画、约 9:16 竖幅构图；可有光效或少量与职业相关的实物点缀。800 字符以内。
- 三个字段都必须有值，且各自是独立完整的英文段落；不要写「同上」「与 down 相同」这类引用。
- 三个字段里 ALL text in English：不得出现任何中文字符（用英文描述，例如 ponytail、white apron）。
- 值里不要用未转义的双引号（"），需要引号时用单引号（'）。`;

/**
 * 一次 LLM 调用生成一位居民的全套素材提示词（正面 / 背面 / 大立绘），返回 JSON 对象。
 * 单张路径仍保留：需要单独重绘某一张时走 generateSpritePrompt / generatePortraitPrompt。
 * @param {object} p - { appearanceInfo }
 * @returns {Promise<{down:string, up:string, portrait:string}>}
 */
export async function generateNpcAssetPrompts({ appearanceInfo }) {
  const msgs = [
    ...system0And1(),
    { role: 'system', content: SPRITE_OUTPUT_STRUCTURE },
    { role: 'system', content: SPRITE_TASK_REQUIREMENTS },
    { role: 'system', content: STANDING_IMAGE_PROMPT_RULE.rule_content },
    { role: 'system', content: PORTRAIT_TASK_REQUIREMENTS },
    { role: 'system', content: NPC_SET_OUTPUT_STRUCTURE },
    { role: 'system', content: `【角色外观信息】\n${appearanceInfo}` },
    { role: 'user', content: '请执行：一次输出这位居民三张素材的英文 prompt（正面像素小人 down、背面像素小人 up、大立绘 portrait），并严格按要求返回 JSON。' },
  ];
  const out = await chatSync(msgs, {
    temperature: 0.7,
    max_tokens: 1600,
    response_format: { type: 'json_object' },
    label: '小镇精灵提示词',
  });
  return parseNpcAssetPrompts(out);
}

/** 解析「一次出齐」的三张提示词：容错代码围栏与前后杂字，缺字段或过短直接抛错 */
export function parseNpcAssetPrompts(content) {
  const raw = String(content || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { /* 再试截取花括号之间的内容 */ }
  if (!parsed || typeof parsed !== 'object') {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('LLM 返回的精灵提示词不是 JSON');
    try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch { throw new Error('LLM 返回的精灵提示词 JSON 解析失败'); }
  }
  const result = {};
  for (const key of ['down', 'up', 'portrait']) {
    const value = typeof parsed[key] === 'string' ? stripFence(parsed[key]) : '';
    if (value.length < 10) throw new Error(`LLM 返回的 ${key} 提示词不完整`);
    result[key] = value;
  }
  return result;
}
// ── 建筑（等距 45°、白底、无底座地砖） ──

const BUILDING_OUTPUT_STRUCTURE = `【输出结构】
Describe the requested isometric building game sprite in natural English as one continuous paragraph.

**MUST:** Write the building type, wall materials, roof style and color, windows, door, signage or distinctive decorations, and overall color mood, matching the given footprint ratio (width x depth in tiles). End with 'isometric game sprite, pure white background, walls extending past the bottom edge of the frame as a clean cutout, no ground, no base, no platform'.

Hard Rules:
- ALL text in English. No Chinese characters anywhere.
- Output only the prompt paragraph, without headings, explanations, analysis, lists, or code fences.
- Do not use unescaped double quotation marks ("). Use single quotes (') instead.
- MAX 600 characters total.`;

const BUILDING_TASK_REQUIREMENTS = `【任务要求】
你是一个专业的等距像素游戏建筑设计师。请在<world_setting>的背景下，为小镇设计一栋建筑的游戏素材图。

【建筑硬性要求（与生图规则冲突时，以本条为准）】
- 纯白色背景（pure white background），没有环境场景
- 等距 45° 俯角视角（isometric view, 45 degree angle），能看到两面墙和屋顶
- 贴纸式裁切构图（sticker cutout）：建筑墙体一直向下延伸到画面底边、被底边直接裁断——画面底部只能看到墙体本身，绝对不出现地面、地基、底座平台、草地土块、台阶、铺装路面、围栏、树木等任何「建筑脚下」的东西；建筑不站在任何东西上
- 不要画出完整的菱形地块或小岛；画面四角必须是干净的纯白
- 完整建筑（除被底边裁切的墙脚外）居中占满画面；体量比例符合给定的等距占地格数（footprint）
- 建筑外观（材质/配色/招牌/装饰）严格符合 system 提供的描述与世界观画风`;

/**
 * 生成建筑英文 prompt。
 * @param {object} p - { name, desc, footprint: {w,h}, special, styleTags }
 */
export async function generateBuildingPrompt({ name, desc, footprint, special = false, styleTags = '' }) {
  const fp = footprint || { w: 4, h: 3 };
  const extra = String(styleTags || '').trim();
  const msgs = [
    ...system0And1(),
    { role: 'system', content: BUILDING_OUTPUT_STRUCTURE },
    {
      role: 'system',
      content: [
        BUILDING_TASK_REQUIREMENTS,
        '',
        '【建筑信息】',
        `名称：${name}`,
        `功能/外观描述：${desc || name}`,
        `等距占地：${fp.w}×${fp.h} 格（宽×深，画面里建筑底面菱形要体现这个比例）`,
        special
          ? '定位：小镇地标建筑（special landmark，外观要有辨识度、更精致）'
          : '定位：普通通用建筑（reusable，造型简洁耐看）',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        extra ? `【用户额外指定】\n${extra}` : '',
        '请执行：设计这栋建筑的等距素材图，并以英文 prompt 输出。',
      ].filter(Boolean).join('\n\n'),
    },
  ];
  const out = await chatSync(msgs, {
    temperature: 0.7,
    max_tokens: 700,
    label: '小镇建筑提示词',
  });
  const text = stripFence(out);
  if (!text || text.length < 10) throw new Error('LLM 生成的建筑提示词不完整');
  return text;
}

// ── 已有素材：根据用户要求改写当前提示词 ──
/**
 * 按用户自然语言要求改写已有素材提示词。
 * @param {object} p - { currentPrompt, requirement, kind, name }
 */
export async function regenerateAssetPrompt({ currentPrompt, requirement = '', kind = 'asset', name = '' }) {
  const source = String(currentPrompt || '').trim();
  if (!source) throw new Error('当前素材缺少提示词');
  const request = String(requirement || '').trim();
  const msgs = [
    ...system0And1(),
    {
      role: 'system',
      content: `【输出结构】
Rewrite the existing game-asset image prompt as one natural English paragraph.

Hard Rules:
- Preserve the original asset type, required composition, and technical constraints (for example white background, isometric view, sprite framing, or front/back view).
- Preserve the style unless the user explicitly asks to change it.
- Apply every explicit user request. If a request conflicts with the asset type, favor the asset type and make a conservative compromise.
- ALL text in English. No Chinese characters anywhere.
- Output only the rewritten prompt, without headings, explanations, analysis, lists, or code fences.
- Do not use unescaped double quotation marks ("). Use single quotes (') instead.
- MAX 700 characters total.`
    },
    {
      role: 'system',
      content: [`【当前素材】`, name ? `名称：${name}` : '', `类型：${kind}`, `当前提示词：${source}`].filter(Boolean).join('\n')
    },
    {
      role: 'user',
      content: request
        ? `【用户修改要求】\n${request}\n\n请执行：改写当前提示词，并以英文 prompt 输出。`
        : '请执行：在保持素材主体与技术要求的前提下优化当前提示词，并以英文 prompt 输出。'
    },
  ];
  const out = await chatSync(msgs, {
    temperature: 0.55,
    max_tokens: 700,
    label: '小镇素材提示词改写',
  });
  const text = stripFence(out);
  if (!text || text.length < 10) throw new Error('LLM 改写的提示词不完整');
  return text;
}
