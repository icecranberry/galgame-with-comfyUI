/**
 * 背包/道具系统服务层
 *
 * 获取渠道：每日宝箱（16 小时冷却，开箱记录并入 gift_history（gift_type='chest'），
 * 按最近一次道具图片生成完成时间惰性计算；生成期间由 generating 道具占用冷却。
 * 冷却记录在图片生成完成（成功或兜底标记 ready）后才写入；进程中断未完成的 generating
 * 道具会在下次启动时清理，不计入冷却。
 * 道具池「效果固定 + LLM 调味」：效果类型与落地逻辑在 ITEM_EFFECTS 中固定，
 * 开箱时由 LLM 生成道具名/描述/512×512 图标 tag 串（以及服饰类的外观描述变体）。
 *
 * 掉落分布：整体四档——服装卡 45%、发型卡 25%、功能道具卡（buff/mood/favor）20%、
 * 变身形态卡 10%——类别池内均匀抽取。
 * 服装卡命中后，若当前存在世界观，另有 50% 概率转为世界观原创服装卡。
 *
 * 收下机制：开出的道具先进「待收下」（collected_at 为空，不显示在背包、不可使用），
 * 经开箱演出「收入背包」收下后才进入背包列表。
 *
 * 效果落地：
 *   - outfit    → outfitService.createTemporaryLimitedOutfit（该角色专属限时服饰，走现有注入链路）
 *   - transform → outfitService.createTemporaryExclusiveOutfit（临时专属形态，到期恢复原形态）
 *   - buff      → item_effects 行，chat.js 人格组装时经 getActiveBuffBlock 注入「临时状态」
 *   - mood      → 复用 emotionEngine 快照，写一条开心的 mood
 *   - favor     → 复用 loadAffinity/saveAffinity 直接提升亲密度
 */

import { getDb, getSystemRules, getSystemRulesWithWorld, getWorldSetting } from '../db/index.js';
import { getWorldIntegrationRule } from '../builtinRules.js';
import { chatSync } from '../llm/llm-client.js';
import { generateImageRaw } from './imageSkill.js';
import { saveBase64Image, deleteImageFileByUrl } from './imagePaths.js';
import { broadcast } from './unifiedStreamBus.js';
import {
  loadEmotionState, saveEmotionSnapshot, loadAffinity, saveAffinity,
} from './emotionEngine.js';
import {
  createTemporaryLimitedOutfit, createTemporaryExclusiveOutfit,
  setCharacterOutfitEnabled, deleteExpiredItemLimitedOutfits,
} from './outfitService.js';

// ── 常量 ──

export const CHEST_COOLDOWN_SECONDS = 16 * 3600;
const OUTFIT_DURATION_HOURS = 24;
const BUFF_DURATION_HOURS = 6;
const FAVOR_DELTA = 8;
const IMAGE_STALE_MINUTES = 30;

/** 进程内开箱锁：LLM 调味/生图期间禁止重复开箱（进程重启后由启动清理兜底） */
let chestOpening = false;


/** 世界观原创服装在「服装类别内」的概率；没有世界观时不进入该判定 */
const WORLD_OUTFIT_CHANCE = 0.4;

/** 整体掉落权重：服装卡 45 / 发型卡 20 / 功能道具卡 15 / 变身形态卡 20 */
export const DROP_WEIGHTS = { clothes: 50, hairstyle: 20, item: 10, transform: 20 };

/** 类别 → 道具池过滤（clothes = 常规服饰外观卡；transform = 变身形态；item = 功能道具） */
const DROP_POOL_FILTERS = {
  clothes: ([, e]) => e.kind === 'outfit',
  hairstyle: ([, e]) => e.kind === 'hairstyle',
  transform: ([, e]) => e.kind === 'transform',
  item: ([, e]) => !isClothesKind(e.kind),
};

/** 外观卡家族（服饰/变身/世界观服装/发型），共享外观描述调味，与功能道具相对 */
const isClothesKind = (kind) => kind === 'outfit' || kind === 'transform' || kind === 'world_outfit' || kind === 'hairstyle';

/**
 * 道具池：kind 决定使用时的落地逻辑；theme 是喂给 LLM 的调味种子；
 * effectText 是 buff 类注入聊天人格的固定状态描述。
 */
export const ITEM_EFFECTS = {
  maid_outfit:   { kind: 'outfit', name: '女仆装', theme: '黑白经典女仆装：蕾丝围裙、荷叶边、蕾丝头饰' },
  jk_uniform:    { kind: 'outfit', name: 'JK制服', theme: '日式JK制服：白衬衫、格纹百褶裙、领结或领带' },
  yukata:        { kind: 'outfit', name: '浴衣', theme: '夏日浴衣：印花图案、宽袖、腰封带结、木屐' },
  cheongsam:     { kind: 'outfit', name: '旗袍', theme: '修身旗袍：立领、盘扣、开衩、丝绸质感' },
  gothic_lolita: { kind: 'outfit', name: '哥特萝莉服', theme: '哥特萝莉塔：黑色蕾丝、裙撑蓬裙、蝴蝶结、蕾丝手套' },
  bunny_girl:    { kind: 'outfit', name: '兔女郎服', theme: '明确表现为 bunny girl costume、satin leotard、bunny ear headband、bow tie、detachable cuffs 与 fluffy bunny tail accessory；这是服装道具，不是兔子、动物或吉祥物' },
  miko:          { kind: 'outfit', name: '巫女服', theme: '传统巫女服：白色襦袢、绯色袴、红色发带' },
  santa_dress:   { kind: 'outfit', name: '圣诞礼服', theme: '圣诞礼服：红色连衣裙、白色毛绒边、驯鹿角发饰' },
  wedding_dress: { kind: 'outfit', name: '婚纱礼服', theme: '纯白婚纱：头纱、蕾丝花边、捧花' },
  // 不进常规掉落池；仅在服装卡命中且存在世界观时按固定概率单独选中
  world_outfit:  { kind: 'world_outfit', name: '世界观服装', theme: '从当前世界观中明确出现的社会习惯、日常材料、环境条件或技术特征取材，设计一套有鲜明审美主题、完整剪裁、华丽细节且可正常活动的原创服装；允许采用哥特、典雅、轻盈、利落等风格方向，但不能用现成制服或身份模板代替世界观设计，也不要凭空添加星辰、神殿、魔法或职业设定' },
  // 独立掉落档位（10%），不参与服装卡池与世界观服装判定
  transform:     { kind: 'transform', name: '变身形态', theme: '由你决定一种拟人变身形态，变化出一些特殊器官（如猫娘、虎耳、精灵耳、狐狸尾巴、狗耳朵，可爱猪猪鼻子，龙角、龙翅膀等），整体气质随形态改变' },
  // 发型卡：换发型一天，落地复用服饰卡的临时限时外观
  twin_tails:     { kind: 'hairstyle', name: '双马尾发型', theme: '活力高双马尾：左右对称扎起的纯色高马尾、发圈固定、发尾微微翘卷，元气感十足' },
  bob_cut:        { kind: 'hairstyle', name: '波波头发型', theme: '利落波波头：齐下巴的内扣纯色短发、圆润发尾、空气刘海' },
  high_ponytail:  { kind: 'hairstyle', name: '高马尾发型', theme: '高扎马尾：头顶高高束起的纯色马尾、发根蓬松、发尾自然垂下带一点弧度' },
  afro:           { kind: 'hairstyle', name: '蓬蓬头发型', theme: '蓬蓬头：整头蓬松炸开的纯色大卷发、体积感十足、蓬到看不见发缝' },
  pompadour:      { kind: 'hairstyle', name: '飞机头发型', theme: '飞机头：前额头发向上向后高高梳起、两侧收短、发丝根根分明有型，纯色发型展示' },
  skyward_braids: { kind: 'hairstyle', name: '朝天辫发型', theme: '朝天辫：数束小辫子俏皮地向上翘起、发梢指向天空、滑稽又可爱，纯色发型展示' },
  energy:        { kind: 'buff', name: '元气符咒', durationHours: BUFF_DURATION_HOURS,
                   effectText: '精力充沛、情绪高涨，整个人元气满满：会主动提出各种小计划、拉着人一起做，语气明快雀跃，像有使不完的劲。' },
  tsundere:      { kind: 'buff', name: '傲娇药水', durationHours: BUFF_DURATION_HOURS,
                   effectText: '说话变得口是心非、嘴硬心软：明明很在意却要说「才、才不是为了你」，被戳中心思时容易慌张否认，脸颊发烫。' },
  tipsy:         { kind: 'buff', name: '微醺糖果', durationHours: BUFF_DURATION_HOURS,
                   effectText: '处于微醺状态：脸颊微红，语气黏糊放松，话变多、更容易坦白真心话和小秘密，但意识仍清醒，不会失态。' },
  mood_fix:      { kind: 'mood',  name: '心情修复贴' },
  favor_candy:   { kind: 'favor', name: '好感糖果' },
};


// ── 工具 ──

function safeParseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/** SQLite 'YYYY-MM-DD HH:MM:SS'（UTC）→ 剩余秒数 */
function secondsUntil(sqliteDT) {
  if (!sqliteDT) return 0;
  const t = new Date(String(sqliteDT).replace(' ', 'T') + 'Z').getTime();
  return Math.max(0, Math.round((t - Date.now()) / 1000));
}

/** 当前时间 + hours，返回与 datetime('now') 同格式的 SQLite UTC 时间串 */
export function sqliteLater(hours) {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

function repairJson(text) {
  return String(text || '').replace(/\\([^"\\\/bfnrtu])/g, '$1');
}

/** 从 LLM 原始输出中截取第一个完整 JSON 对象（括号计数 + 非法转义修复），失败返回 null */
export function extractFirstJson(text) {
  const str = String(text || '');
  const start = str.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(repairJson(str.slice(start, i + 1))); } catch { return null; }
      }
    }
  }
  return null;
}

// ── 宝箱 ──

/** 最近一次图片生成完成时间 → 冷却状态（开箱记录并入 gift_history，gift_type='chest'） */
export function getChestState() {
  const db = getDb();
  const last = db.prepare(
    `SELECT created_at AS opened_at FROM gift_history WHERE gift_type = 'chest' ORDER BY id DESC LIMIT 1`
  ).get();
  let remainingSeconds = 0;
  if (last) {
    const openedMs = new Date(String(last.opened_at).replace(' ', 'T') + 'Z').getTime();
    remainingSeconds = Math.max(0, Math.round((openedMs + CHEST_COOLDOWN_SECONDS * 1000 - Date.now()) / 1000));
  }
  const generating = Boolean(
    chestOpening ||
    db.prepare(`SELECT id FROM backpack_items WHERE status = 'generating' LIMIT 1`).get()
  );
  return {
    canOpen: remainingSeconds <= 0 && !generating,
    remainingSeconds,
    cooldownHours: CHEST_COOLDOWN_SECONDS / 3600,
    generating,
  };
}

/** 当前开箱的图片已完成时补记冷却；已被 tick 兜底记录过的行不再重复写入 */
function recordChestOpen(itemId) {
  const db = getDb();
  try {
    const item = db.prepare('SELECT acquired_at FROM backpack_items WHERE id = ?').get(itemId);
    if (!item) return false;
    const last = db.prepare(`SELECT created_at FROM gift_history WHERE gift_type = 'chest' ORDER BY id DESC LIMIT 1`).get();
    if (last && String(item.acquired_at) <= String(last.created_at)) return false;
    db.prepare(`INSERT INTO gift_history (gift_type) VALUES ('chest')`).run();
    return true;
  } catch (err) {
    console.error('[items] 记录宝箱冷却失败:', err.message);
    return false;
  }
}

/** 池内均匀抽一个效果 key */
function pickEffect(pool) {
  const keys = pool.map(([key]) => key);
  return keys[Math.floor(Math.random() * keys.length)];
}

/** 按整体权重抽掉落类别（权重和不必为 100） */
function pickDropCategory() {
  const entries = Object.entries(DROP_WEIGHTS);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [category, weight] of entries) {
    r -= weight;
    if (r < 0) return category;
  }
  return entries[0][0];
}

/**
 * 开箱抽取：先按整体权重抽类别——服装卡 45% / 发型卡 25% / 功能道具卡 20% /
 * 变身形态卡 10%——再在类别池内均匀抽一个效果（变身形态为单选项）。
 */
export function rollEffectKey() {
  const category = pickDropCategory();
  if (category === 'clothes' && getWorldSetting() && Math.random() < WORLD_OUTFIT_CHANCE) {
    return 'world_outfit';
  }
  return pickEffect(Object.entries(ITEM_EFFECTS).filter(DROP_POOL_FILTERS[category]));
}

// ── LLM 调味 ──

export function buildFlavorFormatPrompt(needsOutfit, needsWorldOutfit = false) {
  const itemNameHint = needsWorldOutfit
    ? '道具名称（≤10个字，取当前世界观服装线索的趣味变体名，可采用「意象·款式」的组合；示例不代表当前世界观，禁止照抄，也不要直接使用「世界观服装」）'
    : '道具名称（≤10个字，主题种子的趣味变体名，例如「星尘女仆装·午夜款」，禁止照抄道具类型名）';
  const outfitFields = needsWorldOutfit
    ? `,
  "outfit_name": "世界观原创服装名称（≤10个字，采用有画面感的意象与款式/风格词组合，可用「意象·款式」的层次；禁止照抄示例、现实服装名或原IP服装名）",
  "outfit_description": "根据当前世界观原创的一套服装的完整外观描述，40-90字；以连贯、有画面感的中文为主，可在末尾补充少量英文tag。先写整体风格与轮廓，再写材质/纹样、配饰/标识等细节，细节必须来自当前世界观的规则、社会、技术或环境；第三人称视角，只描述服装外观，不要提到穿着者的身份、性格、动作或「用户」，不要输出剧情解释"`
    : needsOutfit
    ? `,
  "outfit_name": "服饰/形态/发型名称（≤10个字，与道具主题呼应）",
  "outfit_description": "换上这套服饰/变身/这个发型后该角色呈现的完整外观描述，40-90字，自然语言与英文tag混合（服饰如 black frilled maid dress, lace headdress，发型如 twintails, fluffy afro hair），发型卡重点描述发型样式、发色与发饰，第三人称视角，只描述外观本身，不要提到穿着者的身份、性格或「用户」"`
    : `,
  "outfit_name": null,
  "outfit_description": null`;

  const worldOutfitRules = needsWorldOutfit
    ? `

【world_outfit 专用设计规则】
这是“世界观原创服装”，不是给现实服装换一个幻想名字，也不许照示例换颜色。设计前必须完成以下提取（只用于构思，不要输出到 JSON）：
1. 回到上方 <world_setting> 中提取明确的世界观下的衣服设计参考，没有提到着装的话才去降级寻找可视觉化的线索（社会习惯、日常材料、气候环境、生活技术、公共标识或工作场景）。
2. 逐条把线索转化为具体可见的服装细节。每条细节都必须能回指到世界观原文，不能只写抽象氛围。
3. outfit_description 直接描写这套服装的外观，再写“使用后可以让一位角色换上这套XXXX服装，持续一天”，可补一句温柔的氛围收束；只描述服装外观，不要输出提取过程、剧情解释或穿着者信息。
4. image_prompt 先写服装种类与鲜明风格，再写衣服的细节描述，外观，材质，最后补齐固定要求；只展示这套服装作为游戏道具本体（如悬浮、折叠或平铺的服装或人台），不得出现人物、人体或者模特。除固定要求外，英文tag必须对应 outfit_description 中已经写出的服装细节。

以下 JSON 只示范字段格式、文风与细节颗粒度，与当前世界观完全无关，禁止照抄、换色或模仿其中的主题、材质、轮廓与设计方向；最终只能输出 JSON，不要输出解释：
{
  "name": "暮潮蔷薇卡",
  "description": "这是一套深蓝缎面与银灰滚边交织的交叠礼装，层叠下摆如潮痕舒展。使用后可以让一位角色换上这套XXXX服装，持续一天。",
  "image_prompt": "layered wrap dress, deep blue satin, silver trim, ornate border, game item icon, simple background, no humans, crossed bodice, flowing hem, ceramic toggles, tide emblem, elegant dark style, detailed fabric texture, item focus, soft lighting",
  "outfit_name": "暮潮蔷薇礼装",
  "outfit_description": "她身着一袭深蓝交叠礼装，缎面衣襟与银灰滚边勾勒出利落轮廓，层叠下摆像潮痕般舒展，腰间缀着陶制扣件与可拆识别牌，袖口点缀细密潮纹，整体华丽又便于行动；layered wrap dress, satin fabric, silver trim, ceramic toggles, tide emblem。"
}`
    : '';

  return `请严格按照以下 JSON 格式输出，不要输出任何解释或 JSON 以外的文字：

{
  "name": "${itemNameHint}",
  "description": "道具描述（40-80字：先一句道具外观描写，再点明使用效果——服饰类写「使用后可以让一位角色换上这套服装，持续一天」，世界观服装卡写「使用后可以让一位角色换上这套XXX服装，持续一天」，发型卡写「使用后可以让一位角色换上这个发型，持续一天」，药剂/糖果/符咒类写「使用后会让一位角色陷入XX状态，持续六小时」，心情/亲密度类写「使用后立即生效」；语气温柔可爱）",
  "image_prompt": "英文SDXL tag串（12-24个英文tag，英文逗号分隔，全部小写）：画面为单一道具主体漂浮在纯净浅色背景上的游戏物品图标构图，图片包括一个华丽的边框，必须包含 no humans, simple background, game item icon；服饰类必须先写明确的服装本体，再写主题中的关键部件与材质，避免会改变主体含义的歧义词；道具本体要与主题一致（如药剂=玻璃瓶、卡牌=华丽卡面、糖果=包装糖果、发型=发型展示），禁止出现任何人物"${outfitFields}
}

字段约束：name 不得使用英文；description 中的效果说明必须与道具类型一致；image_prompt 全英文。${worldOutfitRules}`;
}
export function buildItemDesignerRole(needsWorldOutfit) {
  return needsWorldOutfit
    ? '你是道具工坊设计师，你必须从<world_setting> 中提取明确的世界观下的衣服设计参考，没有提到着装的话才去降级寻找可视觉化的线索（社会习惯、日常材料、气候环境、生活技术、公共标识或工作场景）'
    : '你是道具工坊设计师，系统已随机决定本次道具的效果类型，你负责从<world_setting> 中学习世界观风气为它起有趣的名字、写描述，并给出道具图标的生图 tag 串。';
}

export function buildItemUserContent(effect, needsWorldOutfit) {
  return needsWorldOutfit
    ? `本次道具要求：\n- 效果类型：${effect.name}\n- 使用效果：${effectKindSummary(effect)}\n- 主题种子：以上方 <world_setting> 为唯一素材来源，先挑选至少两条明确出现、可被视觉化的线索，再转化为具体服装细节（面料、纹样、剪裁、扣件、配饰、标识等）；不要凭空添加世界观中不存在的星辰、神殿、魔法或职业设定，也不要使用现实服装、示例服装或通用模板。`
    : `本次道具要求：\n- 效果类型：${effect.name}\n- 使用效果：${effectKindSummary(effect)}\n- 主题种子：${effect.theme || '围绕道具类型自行发挥，保持温暖日常的气质'}`;
}

async function generateItemFlavor(effect) {
  const needsWorldOutfit = effect.kind === 'world_outfit';
  const needsOutfit = isClothesKind(effect.kind);
  // 多层 system 组装（对齐全库规范，同 libraryGenerator）：
  //   system0 = 破甲词 + 世界观（有世界观时拼接，否则仅破甲词，创作流程不带 roleplay）
  //   system1 = 世界观强化（有世界观时才注入；world_outfit 走服装专属穿透规则）
  //   之后才是道具工坊设计师规则与本次需求
  const worldSetting = getWorldSetting();
  const msgs = [
    { role: 'system', content: worldSetting
      ? getSystemRulesWithWorld({ roleplay: false })
      : getSystemRules({ roleplay: false }) },
  ];
  if (worldSetting) msgs.push({ role: 'system', content: getWorldIntegrationRule(needsWorldOutfit ? 'world_outfit' : 'interaction') });
  msgs.push(
    { role: 'system', content: buildItemDesignerRole(needsWorldOutfit) },
    { role: 'system', content: buildFlavorFormatPrompt(needsOutfit, needsWorldOutfit) },
    { role: 'user', content: buildItemUserContent(effect, needsWorldOutfit) },
  );

  const raw = await chatSync(msgs, {
    temperature: 0.8,
    max_tokens: 800,
    response_format: { type: 'json_object' },
    label: '道具生成',
  });
  return extractFirstJson(raw) || {};
}

function effectKindSummary(effect) {
  switch (effect.kind) {
    case 'outfit': return '让一位角色换上这套服装，持续一天';
    case 'world_outfit': return '根据当前世界观原创一套这个世界观中合理存在的服装，让一位角色换上，持续一天';
    case 'hairstyle': return '让一位角色换上这个发型，持续一天';
    case 'transform': return '让一位角色变身成一种非人形态，持续一天';
    case 'buff': return '让一位角色在接下来六小时的对话中带有特定状态';
    case 'mood': return '立即把一位角色心情修复为开心';
    case 'favor': return '立即小幅提升与一位角色的亲密度';
    default: return '使用后生效';
  }
}

// ── 开箱 ──

/**
 * 开启每日宝箱：进程内锁定防重复开箱，LLM 调味后入库，
 * 图片异步生成（完成后经 item_ready SSE 事件通知前端，并在此时补记宝箱冷却）。
 * @returns {{ok: true, item: object}|{ok: false, error: string, cooldownRemaining?: number}}
 */
export async function openChest() {
  const db = getDb();
  const state = getChestState();
  if (state.generating) {
    return { ok: false, error: '道具图片生成中，请稍候' };
  }
  if (!state.canOpen) {
    return { ok: false, error: '宝箱冷却中', cooldownRemaining: state.remainingSeconds };
  }

  chestOpening = true;
  try {
    const effectKey = rollEffectKey();
    const effect = ITEM_EFFECTS[effectKey];

    // LLM 调味（失败时用兜底内容，宝箱不空手）
    let flavor = {};
    try {
      flavor = await generateItemFlavor(effect);
    } catch (err) {
      console.error('[items] 道具生成失败，使用兜底内容:', err.message);
    }
    const needsOutfit = isClothesKind(effect.kind);
    const name = (typeof flavor.name === 'string' && flavor.name.trim()) ? flavor.name.trim().slice(0, 20) : effect.name;
    const description = (typeof flavor.description === 'string' && flavor.description.trim())
      ? flavor.description.trim().slice(0, 200)
      : `${effectKindSummary(effect)}。主题：${effect.theme || effect.name}。`;
    const payload = {};
    if (needsOutfit) {
      payload.outfit_name = (typeof flavor.outfit_name === 'string' && flavor.outfit_name.trim())
        ? flavor.outfit_name.trim().slice(0, 30) : effect.name;
      payload.outfit_description = (typeof flavor.outfit_description === 'string' && flavor.outfit_description.trim())
        ? flavor.outfit_description.trim().slice(0, 400) : effect.theme || description;
    }

    const result = db.prepare(
      `INSERT INTO backpack_items (effect_key, name, description, status, payload_json)
       VALUES (?, ?, ?, 'generating', ?)`
    ).run(effectKey, name, description, JSON.stringify(payload));

    const item = db.prepare('SELECT * FROM backpack_items WHERE id = ?').get(result.lastInsertRowid);
    const imagePrompt = (typeof flavor.image_prompt === 'string' && flavor.image_prompt.trim())
      ? flavor.image_prompt.trim()
      : `game item icon, ${effect.theme || effect.name}, floating, glowing softly, no humans, simple background, best quality`;
    generateItemImageAsync(item.id, imagePrompt);

    return { ok: true, item: serializeItem(item) };
  } finally {
    chestOpening = false;
  }
}

/** 异步生成道具图标（512×512，失败时置 ready 无图，前端走兜底图标） */
async function generateItemImageAsync(itemId, imagePrompt) {
  const db = getDb();
  try {
    const result = await generateImageRaw(imagePrompt, {
      scene: 'chat',
      disableRAG: true,
      persistPreparation: false,
      width: 512,
      height: 512,
      artist: '@ebora',
    });
    if (!result.success || !result.images?.length) {
      throw new Error(result.error || 'ComfyUI 未返回图片');
    }
    const url = saveBase64Image('items', `item_${itemId}_${Date.now()}.png`, result.images[0].base64);
    const updated = db.prepare(`UPDATE backpack_items SET image_url = ?, status = 'ready' WHERE id = ? AND status = 'generating'`)
      .run(url, itemId);
    if (updated.changes > 0) recordChestOpen(itemId);
    broadcast('item_ready', { itemId, imageUrl: url });
  } catch (err) {
    console.error('[items] 道具图标生成失败:', err.message);
    const updated = db.prepare(`UPDATE backpack_items SET status = 'ready' WHERE id = ? AND status = 'generating'`).run(itemId);
    if (updated.changes > 0) recordChestOpen(itemId);
    broadcast('item_ready', { itemId, imageUrl: null });
  }
}

function serializeItem(row) {
  return {
    id: row.id,
    effect_key: row.effect_key,
    effect_name: ITEM_EFFECTS[row.effect_key]?.name || row.effect_key,
    kind: ITEM_EFFECTS[row.effect_key]?.kind || 'unknown',
    name: row.name,
    description: row.description,
    image_url: row.image_url,
    status: row.status,
    acquired_at: row.acquired_at,
  };
}

// ── 背包查询 ──

export function listBackpack() {
  const db = getDb();
  const items = db.prepare(
    'SELECT * FROM backpack_items WHERE status != \'used\' AND collected_at IS NOT NULL ORDER BY id DESC'
  ).all().map(serializeItem);
  const pendingItems = db.prepare(
    'SELECT * FROM backpack_items WHERE status != \'used\' AND collected_at IS NULL ORDER BY id DESC'
  ).all().map(serializeItem);
  return { items, pendingItems, chest: getChestState() };
}

/** 收下道具：从「待收下」进入背包列表（幂等，重复收下直接返回现状） */
export function collectItem(itemId) {
  const db = getDb();
  const item = db.prepare('SELECT * FROM backpack_items WHERE id = ?').get(itemId);
  if (!item) return { ok: false, error: '道具不存在' };
  if (item.status === 'used') return { ok: false, error: '道具已经使用过了' };
  if (!item.collected_at) {
    db.prepare(`UPDATE backpack_items SET collected_at = datetime('now') WHERE id = ?`).run(itemId);
  }
  const fresh = db.prepare('SELECT * FROM backpack_items WHERE id = ?').get(itemId);
  return { ok: true, item: serializeItem(fresh) };
}

/** 全部生效中的道具效果（背包弹窗「生效中」面板用） */
export function listActiveEffects() {
  const db = getDb();
  return db.prepare(
    `SELECT e.id, e.character_id, e.effect_key, e.expires_at,
            c.display_name AS character_name, i.name AS item_name, i.image_url AS item_image_url
     FROM item_effects e
     JOIN characters c ON c.id = e.character_id
     JOIN backpack_items i ON i.id = e.item_id
     WHERE e.expires_at IS NULL OR e.expires_at > datetime('now')
     ORDER BY e.expires_at ASC`
  ).all().map(row => ({
    ...row,
    effect_name: ITEM_EFFECTS[row.effect_key]?.name || row.effect_key,
    kind: ITEM_EFFECTS[row.effect_key]?.kind || 'unknown',
    remaining_seconds: secondsUntil(row.expires_at),
  }));
}

/**
 * 手动移除一条生效效果：除了删除 item_effects，还要撤销它落地的临时外观。
 * 变身卡被提前移除时恢复使用前的专属形态；如果期间已有更新的变身卡接管，
 * 则只清理旧形态，并把更新效果的恢复链指向更早的形态。
 */
export function removeActiveEffect(effectId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM item_effects WHERE id = ?').get(effectId);
  if (!row) return { ok: false, error: '生效效果不存在' };

  const effect = ITEM_EFFECTS[row.effect_key];
  const payload = safeParseJson(row.payload_json) || {};

  const remove = db.transaction(() => {
    if (effect?.kind === 'outfit' || effect?.kind === 'world_outfit' || effect?.kind === 'hairstyle') {
      if (payload.outfitRowId && row.character_id) {
        db.prepare('DELETE FROM global_outfits WHERE id = ? AND character_id = ?')
          .run(payload.outfitRowId, row.character_id);
      }
    } else if (effect?.kind === 'transform' && payload.outfitId && row.character_id) {
      const temporaryOutfitId = Number(payload.outfitId);
      const previousOutfitId = payload.previousOutfitId ? Number(payload.previousOutfitId) : null;
      const temporaryOutfit = db.prepare(
        'SELECT id, enabled FROM character_outfits WHERE id = ? AND character_id = ?'
      ).get(temporaryOutfitId, row.character_id);

      // 只有当前变身仍在占用外观时才恢复上一套，避免覆盖更新的变身卡。
      if (temporaryOutfit?.enabled) {
        db.prepare('UPDATE character_outfits SET enabled = 0 WHERE id = ? AND character_id = ?')
          .run(temporaryOutfitId, row.character_id);
        if (previousOutfitId) {
          db.prepare(
            `UPDATE character_outfits SET enabled = 1
             WHERE id = ? AND character_id = ?
               AND (expires_at IS NULL OR expires_at > datetime('now'))`
          ).run(previousOutfitId, row.character_id);
        }
      }

      // 若更新的变身效果原本指向这套旧形态，删除旧效果后改指向更早的形态。
      const activeTransforms = db.prepare(
        `SELECT id, payload_json FROM item_effects
         WHERE id != ? AND effect_key = 'transform'
           AND character_id = ?
           AND (expires_at IS NULL OR expires_at > datetime('now'))`
      ).all(row.id, row.character_id);
      for (const active of activeTransforms) {
        const activePayload = safeParseJson(active.payload_json) || {};
        if (Number(activePayload.previousOutfitId) !== temporaryOutfitId) continue;
        activePayload.previousOutfitId = previousOutfitId;
        db.prepare('UPDATE item_effects SET payload_json = ? WHERE id = ?')
          .run(JSON.stringify(activePayload), active.id);
      }

      db.prepare('DELETE FROM character_outfits WHERE id = ? AND character_id = ?')
        .run(temporaryOutfitId, row.character_id);
    }

    db.prepare('DELETE FROM item_effects WHERE id = ?').run(row.id);
  });
  remove();
  return { ok: true, effectId: Number(row.id), effectKey: row.effect_key };
}

// ── 使用道具 ──

function insertEffect({ itemId, characterId, effectKey, payload = null, expiresAt = null }) {
  const result = getDb().prepare(
    `INSERT INTO item_effects (item_id, character_id, effect_key, payload_json, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(itemId, characterId, effectKey, payload ? JSON.stringify(payload) : null, expiresAt);
  return Number(result.lastInsertRowid);
}

/**
 * 使用道具：按效果类型落地真实逻辑，并把道具标记为已使用。
 * @returns {{ok: true, summary: string, effect?: object}|{ok: false, error: string}}
 */
export function useItem(itemId, characterId) {
  const db = getDb();
  const item = db.prepare('SELECT * FROM backpack_items WHERE id = ?').get(itemId);
  if (!item) return { ok: false, error: '道具不存在' };
  if (item.status === 'used') return { ok: false, error: '道具已经使用过了' };
  if (!item.collected_at) return { ok: false, error: '道具还未收下' };
  const effect = ITEM_EFFECTS[item.effect_key];
  if (!effect) return { ok: false, error: '未知的道具效果类型' };
  const char = db.prepare('SELECT id, display_name FROM characters WHERE id = ?').get(characterId);
  if (!char) return { ok: false, error: '目标角色不存在' };

  const payload = safeParseJson(item.payload_json) || {};
  let summary = '';
  let effectId = null;
  let effectExpiresAt = null;

  if (isClothesKind(effect.kind)) {
    const name = payload.outfit_name || effect.name;
    const description = payload.outfit_description || effect.theme || item.description;
    const expiresAt = sqliteLater(OUTFIT_DURATION_HOURS);
    if (effect.kind !== 'transform') {
      const outfitRowId = createTemporaryLimitedOutfit(characterId, { name, description, expiresAt });
      effectId = insertEffect({ itemId, characterId, effectKey: item.effect_key, payload: { outfitRowId }, expiresAt });
      effectExpiresAt = expiresAt;
      summary = effect.kind === 'hairstyle'
        ? `${char.display_name} 换上了「${name}」发型，持续一天`
        : `${char.display_name} 换上了「${name}」，持续一天`;
    } else {
      const { outfitId, previousOutfitId } = createTemporaryExclusiveOutfit(characterId, { name, description, expiresAt });
      effectId = insertEffect({ itemId, characterId, effectKey: item.effect_key, payload: { outfitId, previousOutfitId }, expiresAt });
      effectExpiresAt = expiresAt;
      summary = `${char.display_name} 变成了「${name}」形态，持续一天`;
    }
  } else if (effect.kind === 'buff') {
    const expiresAt = sqliteLater(effect.durationHours || BUFF_DURATION_HOURS);
    // 同角色同效果只保留最新一条（刷新时长，不叠加）
    db.prepare('DELETE FROM item_effects WHERE character_id = ? AND effect_key = ?').run(characterId, item.effect_key);
    effectId = insertEffect({ itemId, characterId, effectKey: item.effect_key, expiresAt });
    effectExpiresAt = expiresAt;
    summary = `${char.display_name} 陷入了「${effect.name}」状态，持续 ${effect.durationHours || BUFF_DURATION_HOURS} 小时`;
  } else if (effect.kind === 'mood') {
    const convId = `char_${characterId}`;
    const latest = db.prepare(
      'SELECT after_msg_id FROM emotion_snapshots WHERE conversation_id = ?'
    ).get(convId);
    const state = {
      mood: { valence: 0.75, arousal: 0.6, dominance: 0.6 },
      instant: { valence: 0.8, arousal: 0.65, dominance: 0.6 },
    };
    saveEmotionSnapshot(convId, latest?.after_msg_id ?? 0, state, 'joy', loadAffinity(characterId), null, `心情修复贴（${item.name}）`);
    summary = `${char.display_name} 的心情被修复为开心`;
  } else if (effect.kind === 'favor') {
    const next = saveAffinity(characterId, loadAffinity(characterId) + FAVOR_DELTA, false);
    summary = `${char.display_name} 的亲密度提升了（当前 ${Math.round(next)}）`;
  } else {
    return { ok: false, error: '该道具类型尚未实现' };
  }

  db.prepare(`UPDATE backpack_items SET status = 'used', used_at = datetime('now') WHERE id = ?`).run(itemId);
  const activeEffect = effectId == null ? null : {
    id: effectId,
    character_id: characterId,
    character_name: char.display_name,
    effect_key: item.effect_key,
    item_name: item.name,
    item_image_url: item.image_url,
    effect_name: effect.name,
    kind: effect.kind,
    expires_at: effectExpiresAt,
    remaining_seconds: secondsUntil(effectExpiresAt),
  };
  return { ok: true, summary, effect: { kind: effect.kind, effect_key: item.effect_key }, activeEffect };
}

export function discardItem(itemId) {
  const db = getDb();
  const item = db.prepare('SELECT * FROM backpack_items WHERE id = ?').get(itemId);
  if (!item) return { ok: false, error: '道具不存在' };
  db.prepare('DELETE FROM item_effects WHERE item_id = ?').run(itemId);
  db.prepare('DELETE FROM backpack_items WHERE id = ?').run(itemId);
  if (item.image_url) deleteImageFileByUrl(item.image_url);
  return { ok: true };
}

// ── 聊天人格注入 ──

/**
 * 由生效 buff 效果拼「临时状态」人格注入块（纯函数，便于测试）。
 * @param {Array<{item_name: string, effect_key: string, remaining_seconds: number}>} effects
 * @returns {string} 无 buff 时返回 ''
 */
export function buildBuffBlock(effects) {
  const buffs = (effects || []).filter(e => ITEM_EFFECTS[e.effect_key]?.kind === 'buff');
  if (buffs.length === 0) return '';
  const lines = buffs.map((e, i) => {
    const hours = Math.max(1, Math.ceil((e.remaining_seconds || 0) / 3600));
    const text = ITEM_EFFECTS[e.effect_key]?.effectText || '';
    return `${i + 1}. 受「${e.item_name}」影响（剩余约 ${hours} 小时）：${text}`;
  });
  return `【道具效果 · 临时状态】\n以下状态正在影响你——这是暂时的状态变化，不是你本性的改变，效果结束后会自然恢复。请在言行中自然体现这些状态，但不要在对话中提及「道具」「效果」这些字眼：\n${lines.join('\n')}`;
}

/**
 * 目标角色当前生效的 buff「临时状态」块（chat.js 人格组装时拼入）。
 * 无生效 buff 时返回空串。
 */
export function getActiveBuffBlock(characterId) {
  if (!characterId) return '';
  const effects = listActiveEffects().filter(e => String(e.character_id) === String(characterId));
  return buildBuffBlock(effects);
}

// ── 定时清理（itemScheduler 每个 tick 调用） ──

/** 到期临时形态恢复原专属形态；返回处理条数 */
export function restoreExpiredTransforms() {
  const db = getDb();
  const expired = db.prepare(
    `SELECT id, character_id, payload_json FROM item_effects
     WHERE effect_key = 'transform' AND expires_at IS NOT NULL AND expires_at <= datetime('now')`
  ).all();
  let restored = 0;
  for (const row of expired) {
    const payload = safeParseJson(row.payload_json) || {};
    try {
      const temp = db.prepare('SELECT enabled FROM character_outfits WHERE id = ?').get(payload.outfitId);
      if (temp?.enabled) {
        if (payload.previousOutfitId) {
          db.prepare('UPDATE character_outfits SET enabled = 0 WHERE character_id = ? AND id != ?')
            .run(row.character_id, payload.previousOutfitId);
          setCharacterOutfitEnabled(row.character_id, payload.previousOutfitId, true);
        } else {
          setCharacterOutfitEnabled(row.character_id, payload.outfitId, false);
        }
        restored++;
      }
    } catch (err) {
      console.error('[items] 变身恢复失败:', err.message);
    }
    db.prepare('DELETE FROM item_effects WHERE id = ?').run(row.id);
  }
  return restored;
}

/** 调度器 tick：过期效果清理、变身恢复、卡死的生成中道具标记完成。返回统计 */
export function tickCleanup() {
  const db = getDb();
  const restoredTransforms = restoreExpiredTransforms();
  const removedEffects = db.prepare(
    `DELETE FROM item_effects WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')`
  ).run().changes;
  const removedOutfits = deleteExpiredItemLimitedOutfits();
  const staleRows = db.prepare(
    `SELECT id FROM backpack_items WHERE status = 'generating' AND acquired_at <= datetime('now', '-${IMAGE_STALE_MINUTES} minutes')`
  ).all();
  let staleImages = 0;
  for (const row of staleRows) {
    const updated = db.prepare(`UPDATE backpack_items SET status = 'ready' WHERE id = ? AND status = 'generating'`).run(row.id);
    if (updated.changes > 0) {
      recordChestOpen(row.id);
      staleImages++;
    }
  }
  if (restoredTransforms || removedEffects || removedOutfits || staleImages) {
    console.log(`[items] cleanup: transforms restored=${restoredTransforms}, effects expired=${removedEffects}, outfits expired=${removedOutfits}, stale images=${staleImages}`);
  }
  return { restoredTransforms, removedEffects, removedOutfits, staleImages };
}
