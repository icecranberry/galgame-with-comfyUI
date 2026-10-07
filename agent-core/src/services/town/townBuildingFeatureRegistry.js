/**
 * 小镇特殊建筑模板注册表（docs/town-special-buildings-plan.md §4/§5/§6.4）。
 *
 * 只有 status==='ready' 的模板进入模型候选目录与执行入口；接口收到未知/未就绪
 * 模板一律拒绝（TEMPLATE_UNAVAILABLE）。参数校验禁止额外字段并限制数组、字符串
 * 及数值长度；模型只生成数据配置，价格用代码策略档位（free/basic/standard/premium）。
 *
 * 本次明确排除的 10 种能力（计划 §1.2）不进入本注册表，EXCLUDED_TEMPLATE_IDS
 * 供生成契约校验使用：模型把它们包装成附加奖励/隐藏步骤同样拒绝。
 *
 * temporary_state（纯状态模板）于 2026-10-07 按用户要求「暂时弃用」：注册表定义整体注释保留，
 * 不再进入 ready 目录，模型候选目录与生成编译都拿不到它（存量建筑的已编译配置仍可执行）。
 * 恢复方式：取消下方 temporary_state 定义的注释并递增 REGISTRY_VERSION。
 */
import { townError } from './townEventService.js';

export const REGISTRY_VERSION = 2;
export const SCHEMA_VERSION = 1;

export const PRICE_TIERS = Object.freeze({ free: 0, basic: 5, standard: 15, premium: 40 });
export const PAID_TIERS = Object.freeze(['basic', 'standard', 'premium']);
// 外观/状态四模板首期时长档位（计划 §4.1）
export const LIMITED_DURATION_HOURS = Object.freeze([1, 6, 24]);

/** 店铺货架类模板：外观四件套 + 交易三件套。
 * 建档时就把「店里有哪几套外观 / 哪几件商品」生成好；刷新只重抽这一类。
 * 注意 item_recycle 没有货架（它是从玩家背包收东西），但仍然跟着一起重抽估值档位。 */
export const SHOP_TEMPLATE_IDS = Object.freeze([
  'outfit_change', 'hairstyle_change', 'accessory_change', 'temporary_transform',
  'item_purchase', 'item_exchange', 'item_recycle',
]);

/** 刷新店铺货架的固定价（金币）：重抽外观 + 商品目录，并把货架补满 */
export const SHOP_REFRESH_PRICE = 10;

/** 明确排除的能力：不得注册、不得被模型选中、不得伪装成附加奖励。 */
export const EXCLUDED_TEMPLATE_IDS = Object.freeze([
  'music_request', 'timed_cultivation', 'item_storage', 'location_teleport',
  'timing_challenge', 'collection_achievement', 'effect_extend', 'effect_clear',
  'state_restore', 'recipe_crafting',
]);

// ── 校验工具 ──

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
function fail(code, message) { throw Object.assign(new Error(message || code), { code }); }
function isStr(v) { return typeof v === 'string'; }
/** 限定字符串长度（中文按字符计） */
function checkStr(value, field, min, max) {
  if (!isStr(value)) fail('INVALID_SELECTION', `${field} 必须是字符串`);
  if (value.length < min || value.length > max) fail('INVALID_SELECTION', `${field} 长度须在 ${min}—${max} 之间`);
  return value;
}
function checkKey(value, field) {
  checkStr(value, field, 1, 40);
  if (!KEY_PATTERN.test(value)) fail('INVALID_SELECTION', `${field} 必须以小写字母开头，只含字母数字下划线`);
  return value;
}
function checkInt(value, field, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('INVALID_SELECTION', `${field} 必须是 ${min}—${max} 的整数`);
  return value;
}
/** 禁止额外字段 */
function exactFields(obj, fields, label) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) fail('INVALID_SELECTION', `${label} 必须是对象`);
  const known = new Set(fields);
  for (const key of Object.keys(obj)) if (!known.has(key)) fail('INVALID_SELECTION', `${label} 含未知字段 ${key}`);
}
function checkArray(value, field, min, max) {
  if (!Array.isArray(value)) fail('INVALID_SELECTION', `${field} 必须是数组`);
  if (value.length < min || value.length > max) fail('INVALID_SELECTION', `${field} 数量须在 ${min}—${max} 之间`);
  return value;
}
function uniqueKeys(items, field) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.key)) fail('INVALID_SELECTION', `${field}.key 重复：${item.key}`);
    seen.add(item.key);
  }
}
function checkDuration(value, field, allowed) {
  checkInt(value, field, 1, 24 * 30);
  if (!allowed.includes(value)) fail('INVALID_SELECTION', `${field} 只能从 ${allowed.join('/')} 小时档位中选择`);
  return value;
}
/** 外观四模板共享的 options 结构 */
function checkAppearanceOptions(params, templateId) {
  exactFields(params, ['durationHours', 'options'], `${templateId}.params`);
  checkDuration(params.durationHours, 'durationHours', LIMITED_DURATION_HOURS);
  checkArray(params.options, 'options', 1, 6);
  uniqueKeys(params.options, 'options');
  for (const option of params.options) {
    exactFields(option, ['key', 'label', 'appearance'], 'options[]');
    checkKey(option.key, 'options[].key');
    checkStr(option.label, 'options[].label', 2, 12);
    checkStr(option.appearance, 'options[].appearance', 40, 120);
  }
  return params;
}
/** 画像/纪念品共享的 themes 结构 */
function checkThemes(params, extraFields) {
  exactFields(params, ['themes', 'allowUserNote', 'userNoteMaxChars', ...extraFields], 'params');
  checkArray(params.themes, 'themes', 1, 6);
  uniqueKeys(params.themes, 'themes');
  for (const theme of params.themes) {
    exactFields(theme, ['key', 'label', 'scene'], 'themes[]');
    checkKey(theme.key, 'themes[].key');
    checkStr(theme.label, 'themes[].label', 2, 12);
    checkStr(theme.scene, 'themes[].scene', 30, 120);
  }
  if (typeof params.allowUserNote !== 'boolean') fail('INVALID_SELECTION', 'allowUserNote 必须是布尔值');
  checkInt(params.userNoteMaxChars, 'userNoteMaxChars', 200, 200);
  return params;
}

// ── 模板定义（13 种启用；temporary_state 暂时弃用，见下方注释） ──

export const BUILDING_FEATURE_TEMPLATES = {
  outfit_change: {
    id: 'outfit_change', version: 1, status: 'ready',
    // 服务品类：店铺在选项目前标给玩家看的归类
    categoryLabel: '服装',
    semanticDescription: '为一位正式角色应用一项限时服装外观，到期自动恢复；只影响后续生图注入。',
    requiredCapabilities: [], supportedTargetKinds: ['character'],
    resourceRequirements: 'none', executionMode: 'deterministic',
    costPolicy: { allowedTiers: ['free', ...PAID_TIERS], defaultTier: 'standard' },
    cooldownPolicy: { kind: 'none' },
    rendererKey: 'appearance_options', executorKey: 'appearance.outfit',
    paramsExample: { durationHours: 24, options: [{ key: 'style_one', label: '服装名，2至12字', appearance: '第三人称服装外观，40至120字，限定服装和配饰，不改发型、物种或人物身份' }] },
    paramHints: 'options 1—6 项、key 唯一、建议 2—6 项；durationHours 只能从 1/6/24 中选；appearance 用 40—120 字第三人称只描述服装与配饰，不改变发型、物种或身份，不含行为指令。',
    validateParams(params, ctx) { return checkAppearanceOptions(params, 'outfit_change'); },
  },
  hairstyle_change: {
    id: 'hairstyle_change', version: 1, status: 'ready',
    // 服务品类：店铺在选项目前标给玩家看的归类
    categoryLabel: '发型',
    semanticDescription: '为一位正式角色应用一项限时发型外观，到期自动恢复；未授权时不改变发色。',
    requiredCapabilities: [], supportedTargetKinds: ['character'],
    resourceRequirements: 'none', executionMode: 'deterministic',
    costPolicy: { allowedTiers: ['free', ...PAID_TIERS], defaultTier: 'standard' },
    cooldownPolicy: { kind: 'none' },
    rendererKey: 'appearance_options', executorKey: 'appearance.hairstyle',
    paramsExample: { durationHours: 24, options: [{ key: 'hair_one', label: '发型名，2至12字', appearance: '第三人称发型描述，40至120字，只写头发造型及发饰；未明确授权时保持角色发色' }] },
    paramHints: 'options 1—6 项、key 唯一、建议 2—6 项；durationHours 只能从 1/6/24 中选；appearance 40—120 字只写发型与发饰，未明确授权时保持角色原发色。',
    validateParams(params, ctx) { return checkAppearanceOptions(params, 'hairstyle_change'); },
  },
  accessory_change: {
    id: 'accessory_change', version: 1, status: 'ready',
    // 服务品类：店铺在选项目前标给玩家看的归类
    categoryLabel: '配饰',
    semanticDescription: '为一位正式角色应用一项限时配饰描述，到期自动恢复；不改服装主体与身份。',
    requiredCapabilities: [], supportedTargetKinds: ['character'],
    resourceRequirements: 'none', executionMode: 'deterministic',
    costPolicy: { allowedTiers: ['free', ...PAID_TIERS], defaultTier: 'basic' },
    cooldownPolicy: { kind: 'none' },
    rendererKey: 'appearance_options', executorKey: 'appearance.accessory',
    paramsExample: { durationHours: 6, options: [{ key: 'accessory_one', label: '配饰名，2至12字', appearance: '第三人称配饰描述，40至120字，只写可佩戴物品，不改服装主体、身体或身份' }] },
    paramHints: 'options 1—6 项、key 唯一、建议 2—6 项；durationHours 只能从 1/6/24 中选；appearance 40—120 字只写可佩戴物品，不改服装主体、身体或身份。',
    validateParams(params, ctx) { return checkAppearanceOptions(params, 'accessory_change'); },
  },
  temporary_transform: {
    id: 'temporary_transform', version: 1, status: 'ready',
    // 服务品类：店铺在选项目前标给玩家看的归类
    categoryLabel: '变身',
    semanticDescription: '为一位正式角色应用互斥临时形态，到期恢复原形态；不含永久变化或数值奖励。',
    requiredCapabilities: [], supportedTargetKinds: ['character'],
    resourceRequirements: 'none', executionMode: 'deterministic',
    costPolicy: { allowedTiers: ['free', ...PAID_TIERS], defaultTier: 'premium' },
    cooldownPolicy: { kind: 'none' },
    rendererKey: 'appearance_options', executorKey: 'appearance.transform',
    paramsExample: { durationHours: 6, options: [{ key: 'form_one', label: '形态名，2至12字', appearance: '第三人称临时形态描述，40至120字，明确变化部位；不含永久变化、数值奖励或新能力' }] },
    paramHints: 'options 1—6 项、key 唯一、建议 2—6 项；durationHours 只能从 1/6/24 中选；appearance 40—120 字写清变化部位，不含永久变化、数值奖励或新能力。',
    validateParams(params, ctx) { return checkAppearanceOptions(params, 'temporary_transform'); },
  },
  item_purchase: {
    id: 'item_purchase', version: 1, status: 'ready',
    // 服务品类：店铺在选项目前标给玩家看的归类
    categoryLabel: '商品',
    semanticDescription: '出售建档资源目录中的真实商品：扣玩家金币、扣经营者真实库存、物品进背包。',
    requiredCapabilities: [], supportedTargetKinds: [],
    resourceRequirements: 'operator_stock', executionMode: 'deterministic',
    costPolicy: { allowedTiers: ['free'], defaultTier: 'free', offerTiers: PAID_TIERS },
    cooldownPolicy: { kind: 'stock' },
    rendererKey: 'trade_offers', executorKey: 'trade.purchase',
    paramsExample: { offers: [{ resourceKey: 'cloth_pin', label: '商品展示名，2至16字', priceTier: 'basic' }] },
    paramHints: 'offers 1—6 项且 resourceKey 互不重复；resourceKey 必须同时在 resources 里定义（或来自输入商品目录）；offers[].priceTier 只能是 basic/standard/premium。resources 最多 3 项且只包含本功能 offers 直接引用的资源：每项含 key/name(2—16字)/description(20—100字)/itemKind(通常 collectible)/effectProfileKey(null)/appearance(null)/imagePrompt(可 null 的英文单行 40—100 词)。',
    validateParams(params, ctx) {
      exactFields(params, ['offers'], 'item_purchase.params');
      checkArray(params.offers, 'offers', 1, 6);
      const seen = new Set();
      for (const offer of params.offers) {
        exactFields(offer, ['resourceKey', 'label', 'priceTier'], 'offers[]');
        checkKey(offer.resourceKey, 'offers[].resourceKey');
        if (seen.has(offer.resourceKey)) fail('INVALID_SELECTION', 'offers[].resourceKey 重复');
        seen.add(offer.resourceKey);
        checkStr(offer.label, 'offers[].label', 2, 16);
        if (!PAID_TIERS.includes(offer.priceTier)) fail('INVALID_SELECTION', 'offers[].priceTier 只能是 basic/standard/premium');
      }
      return params;
    },
  },
  item_exchange: {
    id: 'item_exchange', version: 1, status: 'ready',
    // 服务品类：店铺在选项目前标给玩家看的归类
    categoryLabel: '交换',
    semanticDescription: '玩家用一个背包物品单位换经营者一个商品单位；固定一件换一件，无手续费。',
    requiredCapabilities: [], supportedTargetKinds: [],
    resourceRequirements: 'operator_stock', executionMode: 'deterministic',
    costPolicy: { allowedTiers: ['free'], defaultTier: 'free' },
    cooldownPolicy: { kind: 'stock' },
    rendererKey: 'exchange_offers', executorKey: 'trade.exchange',
    paramsExample: { offers: [{ acceptCatalogKey: 'input_catalog_one', giveResourceKey: 'cloth_pin', label: '交换选项，2至16字，明确一件换一件' }] },
    paramHints: 'offers 1—6 项；acceptCatalogKey 只能来自输入商品目录；acceptCatalogKey 必须逐字复制输入商品目录中列出的键，不得改写；giveResourceKey 必须同时在 resources 里定义；一件只换一件、无手续费。resources 最多 3 项且只包含本功能 offers 直接引用的资源：key/name(2—16字)/description(20—100字)/itemKind(通常 collectible)/effectProfileKey(null)/appearance(null)/imagePrompt(可 null)。',
    validateParams(params, ctx) {
      exactFields(params, ['offers'], 'item_exchange.params');
      checkArray(params.offers, 'offers', 1, 6);
      for (const offer of params.offers) {
        exactFields(offer, ['acceptCatalogKey', 'giveResourceKey', 'label'], 'offers[]');
        // acceptCatalogKey 是输入目录键的引用（可能含点号等真实模板 ID 字符），成员资格在编译期对照目录集合校验
        if (!isStr(offer.acceptCatalogKey) || offer.acceptCatalogKey.length < 1 || offer.acceptCatalogKey.length > 80) {
          fail('INVALID_SELECTION', 'offers[].acceptCatalogKey 必须是 1—80 字的目录键引用');
        }
        checkKey(offer.giveResourceKey, 'offers[].giveResourceKey');
        checkStr(offer.label, 'offers[].label', 2, 16);
      }
      return params;
    },
  },
  item_recycle: {
    id: 'item_recycle', version: 1, status: 'ready',
    // 服务品类：店铺在选项目前标给玩家看的归类
    categoryLabel: '回收',
    semanticDescription: '回收玩家背包中一件合格物品并支付金币；报价由服务端估值档位计算。',
    requiredCapabilities: [], supportedTargetKinds: [],
    resourceRequirements: 'operator', executionMode: 'deterministic',
    costPolicy: { allowedTiers: ['free'], defaultTier: 'free', valuationTiers: PAID_TIERS },
    cooldownPolicy: { kind: 'none' },
    rendererKey: 'recycle', executorKey: 'trade.recycle',
    paramsExample: { acceptCatalogKeys: ['input_catalog_one'], valuationTier: 'standard' },
    paramHints: 'acceptCatalogKeys 1—6 个且必须逐字复制输入商品目录中列出的键（不得改写大小写或分隔符）；valuationTier 只能是 basic/standard/premium。本模板通常不需要 resources，保留空数组。',
    validateParams(params, ctx) {
      exactFields(params, ['acceptCatalogKeys', 'valuationTier'], 'item_recycle.params');
      checkArray(params.acceptCatalogKeys, 'acceptCatalogKeys', 1, 6);
      // 同上：目录键引用不套自造 key 的格式校验
      for (const key of params.acceptCatalogKeys) {
        if (!isStr(key) || key.length < 1 || key.length > 80) fail('INVALID_SELECTION', 'acceptCatalogKeys[] 必须是 1—80 字的目录键引用');
      }
      if (!PAID_TIERS.includes(params.valuationTier)) fail('INVALID_SELECTION', 'valuationTier 只能是 basic/standard/premium');
      return params;
    },
  },
  // ── 暂时弃用：temporary_state（纯状态模板，只给角色表达状态，不交付任何实体产物） ──
  // 2026-10-07 按用户要求下线（用户口径：这个模板从生成池里去掉）：注释掉即可退出 ready
  // 目录——模型候选目录（templateCatalogForPrompt）与编译（compileGeneration）都按 ready
  // 过滤，因此新建筑不会再生成该模板；已建档建筑的已编译配置仍可执行（运行时按
  // executorKey/模板 id 分发，不查注册表）。执行器（buildingFeatures/state.js）、状态档案
  // 目录与前端状态台一并保留，只服务存量配置。
  // 恢复：取消本段注释并递增 REGISTRY_VERSION。
  // temporary_state: {
  //   id: 'temporary_state', version: 1, status: 'ready',
  //   // 服务品类：店铺在选项目前标给玩家看的归类
  //   categoryLabel: 'BUFF',
  //   semanticDescription: '为一位正式角色写入受约束、限时的表达状态（只影响语气与表达），到期自动回收。',
  //   requiredCapabilities: [], supportedTargetKinds: ['character'],
  //   resourceRequirements: 'none', executionMode: 'deterministic',
  //   costPolicy: { allowedTiers: ['free', ...PAID_TIERS], defaultTier: 'basic' },
  //   cooldownPolicy: { kind: 'active' },
  //   rendererKey: 'appearance_options', executorKey: 'state.apply',
  //   paramsExample: { durationHours: 6, options: [{ key: 'state_one', label: '符合建筑设定的状态商品名，2至12字', stateProfileKey: 'allowed_state_one', flavor: '状态来源的风味描述，20至80字，不增补恢复、好感、永久人格或其他数值效果' }] },
  //   paramHints: 'options 1—6 项、key 唯一；stateProfileKey 只能从输入状态档案键中选择；durationHours 只能从 1/6/24 中选；flavor 20—80 字写状态来源的风味，不增补恢复、好感、永久人格或数值效果。resources 保留空数组。',
  //   validateParams(params, ctx) {
  //     exactFields(params, ['durationHours', 'options'], 'temporary_state.params');
  //     checkDuration(params.durationHours, 'durationHours', LIMITED_DURATION_HOURS);
  //     checkArray(params.options, 'options', 1, 6);
  //     uniqueKeys(params.options, 'options');
  //     for (const option of params.options) {
  //       exactFields(option, ['key', 'label', 'stateProfileKey', 'flavor'], 'options[]');
  //       checkKey(option.key, 'options[].key');
  //       checkStr(option.label, 'options[].label', 2, 12);
  //       checkStr(option.stateProfileKey, 'options[].stateProfileKey', 1, 40);
  //       checkStr(option.flavor, 'options[].flavor', 20, 80);
  //     }
  //     return params;
  //   },
  // },
  portrait_single: {
    id: 'portrait_single', version: 1, status: 'ready',
    // 服务品类：店铺在选项目前标给玩家看的归类
    categoryLabel: '写真',
    semanticDescription: '为一位已支持的人物身份拍一张指定主题的写真，保存到既有相册并归档到操作。',
    requiredCapabilities: [], supportedTargetKinds: ['character'],
    resourceRequirements: 'none', executionMode: 'generative',
    costPolicy: { allowedTiers: ['free', ...PAID_TIERS], defaultTier: 'premium' },
    cooldownPolicy: { kind: 'none' },
    rendererKey: 'portrait_themes', executorKey: 'media.portrait_single',
    paramsExample: { themes: [{ key: 'theme_one', label: '拍摄主题，2至12字', scene: '画面场景要求，30至120字，不预填人物外观，不承诺改变真实世界状态' }], allowUserNote: true, userNoteMaxChars: 200 },
    paramHints: 'themes 1—6 项、key 唯一、建议 2—4 项；scene 30—120 字不预填人物外观、不承诺改变现实；allowUserNote 为布尔、userNoteMaxChars 固定 200。resources 保留空数组。',
    validateParams(params, ctx) { return checkThemes(params, []); },
  },
  portrait_pair: {
    id: 'portrait_pair', version: 1, status: 'ready',
    // 服务品类：店铺在选项目前标给玩家看的归类
    categoryLabel: '合影',
    semanticDescription: '为两位不同的人物身份拍一张指定主题的合影；两位目标必须不同。',
    requiredCapabilities: [], supportedTargetKinds: ['character_pair'],
    resourceRequirements: 'none', executionMode: 'generative',
    costPolicy: { allowedTiers: ['free', ...PAID_TIERS], defaultTier: 'premium' },
    cooldownPolicy: { kind: 'none' },
    rendererKey: 'portrait_themes', executorKey: 'media.portrait_pair',
    paramsExample: { themes: [{ key: 'pair_one', label: '合影主题，2至12字', scene: '双人场景要求，30至120字，限定两人，不预填具体身份或强制亲密关系' }], allowUserNote: true, userNoteMaxChars: 200 },
    paramHints: 'themes 1—6 项、key 唯一；scene 30—120 字限定两人、不预填具体身份或强制亲密关系；allowUserNote/userNoteMaxChars 同写真。resources 保留空数组。',
    validateParams(params, ctx) { return checkThemes(params, []); },
  },
  illustrated_keepsake: {
    id: 'illustrated_keepsake', version: 1, status: 'ready',
    // 服务品类：店铺在选项目前标给玩家看的归类
    categoryLabel: '纪念卡',
    semanticDescription: '生成一张有文字与图片的纪念卡；文字由程序排版，不依赖生图模型绘制中文。',
    requiredCapabilities: [], supportedTargetKinds: ['character'],
    resourceRequirements: 'none', executionMode: 'generative',
    costPolicy: { allowedTiers: ['free', ...PAID_TIERS], defaultTier: 'premium' },
    cooldownPolicy: { kind: 'none' },
    rendererKey: 'keepsake_formats', executorKey: 'media.keepsake',
    paramsExample: { formats: ['postcard'], themes: [{ key: 'card_one', label: '纪念品主题，2至12字', scene: '图文主题说明，30至120字，不虚构已经发生的共同经历' }], allowUserNote: true, userNoteMaxChars: 200 },
    paramHints: 'formats 只允许 postcard/memento_card，1—2 项；themes 1—6 项、scene 30—120 字、不虚构已发生的共同经历。resources 保留空数组。',
    validateParams(params, ctx) {
      checkThemes(params, ['formats']);
      checkArray(params.formats, 'formats', 1, 2);
      for (const format of params.formats) {
        if (!['postcard', 'memento_card'].includes(format)) fail('INVALID_SELECTION', 'formats 只允许 postcard/memento_card');
      }
      return params;
    },
  },
  gallery_display: {
    id: 'gallery_display', version: 1, status: 'ready',
    // 服务品类：店铺在选项目前标给玩家看的归类
    categoryLabel: '展柜',
    semanticDescription: '展示权限范围内已有真实作品；只读浏览与收藏，没有达成奖励或自动生成。',
    requiredCapabilities: [], supportedTargetKinds: [],
    // 展示不收费、不交付物品：无经营者的建筑也可用（计划 §7.5）
    resourceRequirements: 'none', executionMode: 'deterministic',
    costPolicy: { allowedTiers: ['free'], defaultTier: 'free' },
    cooldownPolicy: { kind: 'none' },
    rendererKey: 'gallery', executorKey: 'media.gallery',
    paramsExample: { source: 'building_outputs', layout: 'frames', limit: 12 },
    paramHints: 'source 只允许 building_outputs/player_selected；layout 固定 frames；limit 为 1—24 整数。resources 保留空数组。',
    validateParams(params, ctx) {
      exactFields(params, ['source', 'layout', 'limit'], 'gallery_display.params');
      if (!['building_outputs', 'player_selected'].includes(params.source)) fail('INVALID_SELECTION', 'source 只允许 building_outputs/player_selected');
      if (params.layout !== 'frames') fail('INVALID_SELECTION', 'layout 初版固定为 frames');
      checkInt(params.limit, 'limit', 1, 24);
      return params;
    },
  },
  pool_draw: {
    id: 'pool_draw', version: 1, status: 'ready',
    // 服务品类：店铺在选项目前标给玩家看的归类
    categoryLabel: '抽奖',
    semanticDescription: '从有限库存奖池中抽取并交付一个结果；服务端固定随机种子，空奖池禁止扣款。',
    requiredCapabilities: [], supportedTargetKinds: [],
    resourceRequirements: 'operator_stock', executionMode: 'deterministic',
    costPolicy: { allowedTiers: ['free', ...PAID_TIERS], defaultTier: 'basic' },
    cooldownPolicy: { kind: 'daily', defaultLimit: 1 },
    rendererKey: 'draw', executorKey: 'draw.pool',
    paramsExample: { pool: [{ resourceKey: 'cloth_pin', weight: 1 }], dailyLimit: 1, reveal: 'card' },
    paramHints: 'pool 1—8 项、resourceKey 互不重复且必须同时在 resources 里定义；weight 为 1—100 整数；dailyLimit 1—3；reveal 只允许 card/chest。resources 最多 3 项且只包含 pool 直接引用的资源：key/name/description/itemKind(通常 collectible)/其余 null。',
    validateParams(params, ctx) {
      exactFields(params, ['pool', 'dailyLimit', 'reveal'], 'pool_draw.params');
      checkArray(params.pool, 'pool', 1, 8);
      const seen = new Set();
      for (const entry of params.pool) {
        exactFields(entry, ['resourceKey', 'weight'], 'pool[]');
        checkKey(entry.resourceKey, 'pool[].resourceKey');
        if (seen.has(entry.resourceKey)) fail('INVALID_SELECTION', 'pool[].resourceKey 重复');
        seen.add(entry.resourceKey);
        checkInt(entry.weight, 'pool[].weight', 1, 100);
      }
      checkInt(params.dailyLimit, 'dailyLimit', 1, 3);
      if (!['card', 'chest'].includes(params.reveal)) fail('INVALID_SELECTION', 'reveal 只允许 card/chest');
      return params;
    },
  },
  daily_fortune: {
    id: 'daily_fortune', version: 1, status: 'ready',
    // 服务品类：店铺在选项目前标给玩家看的归类
    categoryLabel: '签运',
    semanticDescription: '从建档时生成的有限签文池中固定当天一签；默认免费，每日每建筑一签。',
    requiredCapabilities: [], supportedTargetKinds: ['character_optional'],
    resourceRequirements: 'none', executionMode: 'deterministic',
    costPolicy: { allowedTiers: ['free'], defaultTier: 'free' },
    cooldownPolicy: { kind: 'daily', fixedLimit: 1 },
    rendererKey: 'fortune', executorKey: 'draw.fortune',
    paramsExample: { entries: [{ key: 'fortune_one', title: '签名，2至10字', text: '趣味签文，30至100字，符合建筑设定，不预言确定事实，不承诺未实现能力', stateProfileKey: null, durationHours: null, weight: 1 }] },
    paramHints: 'entries 3—8 项、key 唯一；title 2—10 字、text 30—100 字（符合建筑设定、不预言确定事实、不承诺未实现能力）；weight 1—100；stateProfileKey 只能从输入状态档案键选或为 null（为 null 时 durationHours 必须为 null）。resources 保留空数组。',
    validateParams(params, ctx) {
      exactFields(params, ['entries'], 'daily_fortune.params');
      checkArray(params.entries, 'entries', 3, 8);
      uniqueKeys(params.entries, 'entries');
      for (const entry of params.entries) {
        exactFields(entry, ['key', 'title', 'text', 'stateProfileKey', 'durationHours', 'weight'], 'entries[]');
        checkKey(entry.key, 'entries[].key');
        checkStr(entry.title, 'entries[].title', 2, 10);
        checkStr(entry.text, 'entries[].text', 30, 100);
        checkInt(entry.weight, 'entries[].weight', 1, 100);
        if (entry.stateProfileKey === null) {
          if (entry.durationHours !== null) fail('INVALID_SELECTION', '纯签文的 durationHours 必须为 null');
        } else {
          checkStr(entry.stateProfileKey, 'entries[].stateProfileKey', 1, 40);
          checkDuration(entry.durationHours, 'entries[].durationHours', LIMITED_DURATION_HOURS);
        }
      }
      return params;
    },
  },
};

/** 稳定目录版本（status/version 变化时手动递增 REGISTRY_VERSION） */
export function registryVersion() { return REGISTRY_VERSION; }

export function getTemplate(templateId) {
  return Object.prototype.hasOwnProperty.call(BUILDING_FEATURE_TEMPLATES, templateId)
    ? BUILDING_FEATURE_TEMPLATES[templateId] : null;
}

/** 仅 ready 模板进入模型候选与执行 */
export function readyTemplates() {
  return Object.values(BUILDING_FEATURE_TEMPLATES).filter(t => t.status === 'ready');
}

export function isTemplateReady(templateId) {
  const template = getTemplate(templateId);
  return !!template && template.status === 'ready';
}

/** 注册表层面参数校验入口：未知/未就绪模板直接拒绝 */
export function validateFeatureParams(templateId, params, ctx = {}) {
  const template = getTemplate(templateId);
  if (!template) throw Object.assign(new Error(`未知模板 ${templateId}`), { code: 'TEMPLATE_UNAVAILABLE' });
  if (template.status !== 'ready') throw Object.assign(new Error(`模板 ${templateId} 未就绪`), { code: 'TEMPLATE_UNAVAILABLE' });
  return template.validateParams(params, ctx);
}

/**
 * 排除能力校验：生成结果不得引用排除模板，也不得借 evidence/文案把它们伪装成附加奖励。
 * 返回违规说明数组；空数组=通过。
 */
export function findExcludedCapabilityViolations(generated) {
  const violations = [];
  const features = Array.isArray(generated?.features) ? generated.features : [];
  for (const feature of features) {
    if (EXCLUDED_TEMPLATE_IDS.includes(feature?.templateId)) {
      violations.push(`features[].templateId 引用了排除能力 ${feature.templateId}`);
    }
  }
  const text = JSON.stringify(generated?.unsupported || []);
  for (const id of EXCLUDED_TEMPLATE_IDS) {
    if (text.includes(id)) violations.push(`unsupported 中出现排除能力 ${id}`);
  }
  return violations;
}
