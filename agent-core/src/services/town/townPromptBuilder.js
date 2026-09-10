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
