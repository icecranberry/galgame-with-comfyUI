/**
 * 建筑功能服务层（计划 §5、§7.2、§10）：配置读写、稳定键编译、报价与对外查询。
 *
 * 关键口径：
 *   - 浏览/查看纯读，不调用 LLM、不扣费、不补库存（计划 §10 GET 职责）。
 *   - sourceHash 漂移 → 旧配置标记 stale，保留但不可执行；权限撤销立即禁止执行。
 *   - 稳定功能 ID 与配额由服务端分配；模型改 key/标题/升版本不创造新次数。
 *   - 报价是无状态收据：quoteId 为选择内容+价格+过期的哈希，execute 时在服务端
 *     重算比对，过期/不一致抛 QUOTE_EXPIRED / PRICE_CHANGED。
 */
import { randomUUID, createHash } from 'node:crypto';
import { townError, canonicalJson } from './townEventService.js';
import { getTownEconomyContext } from './townEconomyRuntime.js';
import { recycleQuote, findRecyclableItem, assertItemInCatalogs, findTradableItem } from './buildingFeatures/trade.js';
import {
  BUILDING_FEATURE_TEMPLATES, PRICE_TIERS, getTemplate, validateFeatureParams,
  findExcludedCapabilityViolations, readyTemplates, registryVersion,
} from './townBuildingFeatureRegistry.js';
import {
  resolveBuildingFeatureSource, computeSourceHash, sourceDrifted,
} from './townBuildingFeatureSource.js';

export const QUOTE_TTL_MS = 10 * 60 * 1000;

/** 渲染器与执行器按 rendererKey/executorKey 分发；未知 key 在编译期拒绝 */
const KNOWN_RENDERERS = new Set([
  'appearance_options', 'trade_offers', 'exchange_offers', 'recycle',
  'portrait_themes', 'keepsake_formats', 'gallery', 'draw', 'fortune',
]);
const KNOWN_EXECUTORS = new Set([
  'appearance.outfit', 'appearance.hairstyle', 'appearance.accessory', 'appearance.transform',
  'trade.purchase', 'trade.exchange', 'trade.recycle', 'state.apply',
  'media.portrait_single', 'media.portrait_pair', 'media.keepsake', 'media.gallery',
  'draw.pool', 'draw.fortune',
]);

export function getBuildingFeatureContext() {
  return getTownEconomyContext();
}

function parseJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

/** 取（或建）建筑实例的配置行；不触发任何生成 */
export function ensureProfile(db, source) {
  const existing = db.prepare(
    'SELECT * FROM town_building_feature_profiles WHERE world_id = ? AND world_epoch = ? AND building_instance_id = ?')
    .get(source.worldId, source.worldEpoch, source.buildingInstanceId);
  if (existing) return existing;
  db.prepare(
    `INSERT INTO town_building_feature_profiles
     (world_id, world_epoch, map_id, location_id, building_instance_id, status, source_json, source_hash)
     VALUES (?, ?, ?, ?, ?, 'unconfigured', ?, ?)`
  ).run(source.worldId, source.worldEpoch, source.mapId, source.locationId,
    source.buildingInstanceId, JSON.stringify(source), source.sourceHash);
  return db.prepare(
    'SELECT * FROM town_building_feature_profiles WHERE world_id = ? AND world_epoch = ? AND building_instance_id = ?')
    .get(source.worldId, source.worldEpoch, source.buildingInstanceId);
}

/** 有效状态：disabled > stale（来源漂移）> 库存状态 */
export function effectiveStatus(source, profile) {
  if (!profile) return 'unconfigured';
  if (profile.status === 'disabled') return 'disabled';
  if (sourceDrifted(source, profile) && ['ready', 'partial'].includes(profile.status)) return 'stale';
  return profile.status;
}

/** 已编译配置（revision 绑定执行） */
export function compiledConfig(profile) {
  if (!profile?.compiled_json) return null;
  return parseJson(profile.compiled_json, null);
}

/** 目标候选：全部招募角色（characters 里的角色卡）。
 * 不再要求「入住本镇 + 未关奇遇」：外观/状态/写真只读角色卡本身，跟奇遇开关无关。
 * 仍然排除轻量 NPC 与玩家自身，它们没有外观与生图人格适配。
 * avatarPath 供选人界面出缩略图，没有头像的角色卡由前端退回首字占位。 */
export function selectableTargets(db) {
  return db.prepare(
    `SELECT c.id, c.display_name, c.avatar_path FROM characters c ORDER BY c.id`).all()
    .map(row => ({ actorKey: `char:${row.id}`, id: row.id, displayName: row.display_name,
      avatarPath: row.avatar_path || null }));
}

/**
 * 编译生成候选：语法/引用/权限/证据逐项校验（计划 §6.5），失败抛错并携带诊断。
 * 通过后分配稳定功能 ID、绑定资源键映射。不落库（由生成器在事务内保存）。
 */
export function compileGeneration(db, source, generated) {
  const diagnostics = [];
  if (!generated || typeof generated !== 'object') throw townError('GENERATION_INVALID');
  if (generated.schemaVersion !== 1) diagnostics.push('schemaVersion 必须为 1');
  if (!['supported', 'partial', 'none'].includes(generated.supportLevel)) diagnostics.push('supportLevel 非法');
  const interpretation = String(generated.interpretation || '');
  if (interpretation.length < 20 || interpretation.length > 80) diagnostics.push('interpretation 长度须在 20—80 之间');
  const excludedViolations = findExcludedCapabilityViolations(generated);
  if (excludedViolations.length) diagnostics.push(...excludedViolations);

  const unsupported = Array.isArray(generated.unsupported) ? generated.unsupported : [];
  if (unsupported.length > 6) diagnostics.push('unsupported 最多 6 项');
  for (const item of unsupported) {
    if (!item || typeof item !== 'object') { diagnostics.push('unsupported[] 必须是对象'); continue; }
    for (const field of ['sourceText', 'reason']) {
      const value = item[field];
      if (typeof value !== 'string' || value.length < (field === 'reason' ? 10 : 1) || value.length > 160) {
        diagnostics.push(`unsupported[].${field} 长度非法`);
      }
    }
  }

  const resources = Array.isArray(generated.resources) ? generated.resources : [];
  if (resources.length > 8) diagnostics.push('resources 最多 8 项');
  const resourceKeys = new Set();
  const ITEM_KINDS = new Set(['collectible', 'outfit', 'hairstyle', 'accessory', 'transform', 'state']);
  const stateKeys = new Set(source.catalogs.stateProfiles.map(p => p.key));
  for (const resource of resources) {
    if (!resource || typeof resource !== 'object') { diagnostics.push('resources[] 必须是对象'); continue; }
    try {
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(resource.key || '')) throw new Error('key 格式非法');
      if (resourceKeys.has(resource.key)) throw new Error('key 重复');
      if (typeof resource.name !== 'string' || resource.name.length < 2 || resource.name.length > 16) throw new Error('name 长度非法');
      if (typeof resource.description !== 'string' || resource.description.length < 20 || resource.description.length > 100) throw new Error('description 长度非法');
      if (!ITEM_KINDS.has(resource.itemKind)) throw new Error('itemKind 非法');
      if (resource.itemKind === 'state') {
        if (!stateKeys.has(resource.effectProfileKey)) throw new Error('effectProfileKey 必须是合法状态档案键');
      } else if (resource.effectProfileKey !== null && resource.effectProfileKey !== undefined) {
        throw new Error('非 state 资源 effectProfileKey 必须为 null');
      }
      if (['collectible', 'state'].includes(resource.itemKind)
        && resource.appearance !== null && resource.appearance !== undefined) throw new Error('该类资源 appearance 必须为 null');
      if (resource.appearance != null && (typeof resource.appearance !== 'string'
        || resource.appearance.length < 40 || resource.appearance.length > 120)) throw new Error('appearance 长度非法');
      if (resource.imagePrompt != null && (typeof resource.imagePrompt !== 'string'
        || resource.imagePrompt.length < 40 || /https?:\/\/|`|<script/i.test(resource.imagePrompt))) {
        throw new Error('imagePrompt 非法');
      }
      resourceKeys.add(resource.key);
    } catch (err) {
      diagnostics.push(`资源 ${resource?.key || '?'}：${err.message}`);
    }
  }

  const features = Array.isArray(generated.features) ? generated.features : [];
  // 每栋建筑只有一个功能模板（用户口径，2026-10-04）
  if (features.length > 1) diagnostics.push('每栋建筑只能配置一个功能模板');
  const featureKeys = new Set();
  const compiledFeatures = [];
  // 可引用目录：世界内已发布物品模板（交换/回收的 accept 目录），键格式 catalog:{templateId}
  const catalogKeys = new Set(db.prepare('SELECT template_id FROM item_templates WHERE world_id = ?')
    .all(source.worldId).map(row => `catalog_${row.template_id}`));

  features.forEach((feature, index) => {
    const label = `features[${index}]`;
    try {
      if (!feature || typeof feature !== 'object') throw new Error('必须是对象');
      const template = getTemplate(feature.templateId);
      if (!template || template.status !== 'ready') throw new Error(`模板 ${feature.templateId} 不在 ready 目录`);
      if (typeof feature.key !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(feature.key)) throw new Error('key 格式非法');
      if (featureKeys.has(feature.key)) throw new Error('key 重复');
      if (feature.templateVersion !== template.version) throw new Error('templateVersion 与目录不一致');
      if (typeof feature.title !== 'string' || feature.title.length < 2 || feature.title.length > 16) throw new Error('title 长度非法');
      if (typeof feature.description !== 'string' || feature.description.length < 20 || feature.description.length > 80) throw new Error('description 长度非法');
      // 权限：模板要求的能力必须在建筑有效权限内（计划 §3.3：权限不足不执行）
      for (const capability of template.requiredCapabilities) {
        if (!source.capabilities.includes(capability)) throw new Error(`需要 ${capability} 权限`);
      }
      // 建筑一律无主：不检查经营者，收支走建筑自己的 business 账户
      // 证据：source 为合法路径，quote 为原文精确子串（计划 §6.2）
      const evidence = feature.evidence;
      if (!evidence || typeof evidence !== 'object') throw new Error('缺少 evidence');
      const allowedSources = source.description ? ['building.description', 'building.title', 'location.ambient'] : ['building.title'];
      if (!allowedSources.includes(evidence.source)) throw new Error(`evidence.source 只允许 ${allowedSources.join('/')}`);
      const quote = String(evidence.quote || '');
      if (quote.length < 1 || quote.length > 160) throw new Error('evidence.quote 长度非法');
      const evidenceText = evidence.source === 'building.description' ? source.description
        : evidence.source === 'building.title' ? source.title : source.ambient;
      if (!evidenceText || !evidenceText.includes(quote)) throw new Error('evidence.quote 不是原文精确子串');
      // 价档
      const priceTier = feature.priceTier ?? template.costPolicy.defaultTier;
      if (!template.costPolicy.allowedTiers.includes(priceTier)) throw new Error(`priceTier ${priceTier} 不被模板允许`);
      // 参数（含资源/目录/状态档案引用校验）
      const params = validateFeatureParams(feature.templateId, feature.params, {
        resourceKeys, catalogKeys, stateKeys,
      });
      validateTemplateReferences(template.id, params, { resourceKeys, catalogKeys, stateKeys });
      // 表现文案
      const presentation = feature.presentation;
      if (!presentation || typeof presentation !== 'object') throw new Error('缺少 presentation');
      for (const [field, min, max] of [['opening', 20, 80], ['success', 10, 60], ['empty', 5, 40]]) {
        const value = presentation[field];
        if (typeof value !== 'string' || value.length < min || value.length > max) throw new Error(`presentation.${field} 长度非法`);
      }
      featureKeys.add(feature.key);
      compiledFeatures.push({
        featureId: `bfi:${randomUUID().slice(0, 8)}`,
        key: feature.key,
        templateId: template.id,
        templateVersion: template.version,
        title: feature.title,
        description: feature.description,
        priceTier,
        params,
        presentation,
        categoryLabel: template.categoryLabel || null,
        rendererKey: template.rendererKey,
        executorKey: template.executorKey,
        executionMode: template.executionMode,
        supportedTargetKinds: template.supportedTargetKinds,
        cooldownPolicy: template.cooldownPolicy,
        costPolicy: template.costPolicy,
        requiredCapabilities: template.requiredCapabilities,
      });
    } catch (err) {
      if (err?.code === 'TEMPLATE_UNAVAILABLE') throw err;
      diagnostics.push(`${label}：${err.message}`);
    }
  });

  if (generated.supportLevel === 'none' && features.length) diagnostics.push('supportLevel=none 时 features 必须为空');
  if (generated.supportLevel === 'partial' && !unsupported.length) diagnostics.push('partial 必须列出未支持的用途');
  if (diagnostics.length) {
    throw Object.assign(new Error(diagnostics.join('；')), { code: 'GENERATION_INVALID', diagnostics });
  }

  const compiled = {
    revision: 0,
    interpretation,
    supportLevel: generated.supportLevel,
    features: compiledFeatures,
    resources: resources.filter(r => resourceKeys.has(r?.key)).map(r => ({ ...r })),
    unsupported,
    sourceHash: source.sourceHash,
    registryVersion: registryVersion(),
  };
  return { compiled, generated };
}

/** 交换/回收 accept 目录与资源/状态键的引用校验（params 结构已在注册表校验过） */
function validateTemplateReferences(templateId, params, { resourceKeys, catalogKeys, stateKeys }) {
  const ensureResource = key => {
    if (!resourceKeys.has(key) && !catalogKeys.has(key)) {
      throw Object.assign(new Error(`引用了未定义资源 ${key}`), { code: 'GENERATION_INVALID' });
    }
  };
  if (templateId === 'item_purchase') params.offers.forEach(o => ensureResource(o.resourceKey));
  if (templateId === 'item_exchange') params.offers.forEach(o => {
    if (!catalogKeys.has(o.acceptCatalogKey)) throw Object.assign(new Error(`acceptCatalogKey ${o.acceptCatalogKey} 不在允许目录`), { code: 'GENERATION_INVALID' });
    ensureResource(o.giveResourceKey);
  });
  if (templateId === 'item_recycle') params.acceptCatalogKeys.forEach(key => {
    if (!catalogKeys.has(key)) throw Object.assign(new Error(`acceptCatalogKey ${key} 不在允许目录`), { code: 'GENERATION_INVALID' });
  });
  // temporary_state 模板暂时弃用（注册表定义已注释，新配置编译不到这里）；
  // 分支保留：恢复模板或复检存量配置时口径不变
  if (templateId === 'temporary_state') params.options.forEach(o => {
    if (!stateKeys.has(o.stateProfileKey)) throw Object.assign(new Error(`状态档案 ${o.stateProfileKey} 不在目录`), { code: 'GENERATION_INVALID' });
  });
  if (templateId === 'daily_fortune') params.entries.forEach(entry => {
    if (entry.stateProfileKey !== null && !stateKeys.has(entry.stateProfileKey)) {
      throw Object.assign(new Error(`状态档案 ${entry.stateProfileKey} 不在目录`), { code: 'GENERATION_INVALID' });
    }
  });
  if (templateId === 'pool_draw') params.pool.forEach(entry => ensureResource(entry.resourceKey));
}

/**
 * 玩家视角的只读视图（GET features）：功能、状态、不可用原因。不调用 LLM。
 */
export function getBuildingFeaturesView(context, { mapId, locationKey }) {
  const { db } = context;
  const source = resolveBuildingFeatureSource(context, { mapId, locationKey });
  const profile = db.prepare(
    'SELECT * FROM town_building_feature_profiles WHERE world_id = ? AND world_epoch = ? AND building_instance_id = ?')
    .get(source.worldId, source.worldEpoch, source.buildingInstanceId) || null;
  const status = effectiveStatus(source, profile);
  const config = compiledConfig(profile);
  const targets = selectableTargets(db);
  const features = (config?.features || []).map(feature => ({
    featureId: feature.featureId,
    title: feature.title,
    description: feature.description,
    templateId: feature.templateId,
    // 服务品类：店铺要在选项目前标明这一项属于什么（【服装】【发型】【BUFF】）
    categoryLabel: feature.categoryLabel || null,
    rendererKey: feature.rendererKey,
    executionMode: feature.executionMode,
    supportedTargetKinds: feature.supportedTargetKinds,
    price: priceOf(feature),
    priceTier: feature.priceTier,
    params: feature.params,
    presentation: feature.presentation,
    capabilityDenied: feature.requiredCapabilities.some(c => !source.capabilities.includes(c)),
    targets: feature.supportedTargetKinds.some(k => k.startsWith('character')) ? targets : [],
  }));
  return {
    ...scopeOf(source),
    buildingName: source.title,
    status,
    interpretation: config?.interpretation || null,
    supportLevel: config?.supportLevel || null,
    unsupported: config?.unsupported || [],
    // 资源目录名（resourceKey → 展示名）：奖池等只带 resourceKey 的条目给前端兜底命名
    resourceNames: Object.fromEntries((config?.resources || []).map(r => [r.key, r.name || r.key])),
    descriptionMissing: !source.description,
    descriptionSource: source.descriptionSource,
    revision: profile?.revision || 0,
    features,
    lastError: profile?.last_error || null,
    canGenerate: !['generating'].includes(status),
  };
}

function scopeOf(source) {
  return { worldId: source.worldId, worldEpoch: source.worldEpoch, mapId: source.mapId,
    locationKey: source.buildingInstanceId, buildingInstanceId: source.buildingInstanceId };
}

/** 功能标价（数字价格由程序渲染；交易类按 offer 计） */
export function priceOf(feature) {
  return PRICE_TIERS[feature.priceTier] ?? 0;
}

/**
 * 计算报价：校验选项/目标/物品属于当前配置，返回服务端报价收据。
 * 不生成内容、不实际扣款（计划 §10 quote 职责）。
 */
export function quoteFeature(context, { mapId, locationKey, featureId, selection }) {
  const { db, scope } = context;
  const source = resolveBuildingFeatureSource(context, { mapId, locationKey });
  const profile = db.prepare(
    'SELECT * FROM town_building_feature_profiles WHERE world_id = ? AND world_epoch = ? AND building_instance_id = ?')
    .get(source.worldId, source.worldEpoch, source.buildingInstanceId);
  const status = effectiveStatus(source, profile);
  if (status === 'stale') throw townError('FEATURE_STALE');
  if (!['ready', 'partial'].includes(status)) throw townError('FEATURE_UNCONFIGURED');
  const config = compiledConfig(profile);
  const feature = config.features.find(f => f.featureId === featureId);
  if (!feature) throw townError('INVALID_SELECTION');
  const checked = checkSelection(context, source, feature, selection);
  const price = quotePrice(context, source, feature, selection);
  const expiresAt = Date.now() + QUOTE_TTL_MS;
  const quote = {
    quoteId: computeQuoteId({ sourceHash: source.sourceHash, featureId,
      revision: profile.revision, selection: checked, price, expiresAt }),
    featureId, featureKey: feature.key, templateId: feature.templateId,
    revision: profile.revision,
    price, priceTier: feature.priceTier,
    summary: quoteSummary(context, source, feature, selection),
    expiresAt,
  };
  return { ...quote, selection: checked };
}

/** 报价收据哈希：服务端 quote 与 execute 校验共用同一实现 */
export function computeQuoteId({ sourceHash, featureId, revision, selection, price, expiresAt }) {
  return createHash('sha256').update(canonicalJson({
    v: 1, sourceHash, featureId, revision, selection, price, expiresAt,
  })).digest('hex').slice(0, 24);
}

/** 选择内容校验：字段按模板收敛，不需要的必须为空（计划 §10 selection 规则） */
export function checkSelection(context, source, feature, selection) {
  const { db } = context;
  const input = selection || {};
  const wants = key => feature.supportedTargetKinds.some(k => k.includes(key));
  const optionKeys = optionKeysOf(feature);
  const checked = {
    optionKey: null, targetActorKeys: [], itemIds: [], userNote: '', offerKey: null,
  };
  if (feature.templateId === 'item_purchase') {
    const offers = feature.params?.offers || [];
    if (typeof input.offerKey !== 'string' || !offers.some(o => o.resourceKey === input.offerKey)) {
      throw townError('INVALID_SELECTION');
    }
    checked.offerKey = input.offerKey;
  }
  if (optionKeys.length) {
    if (typeof input.optionKey !== 'string' || !optionKeys.includes(input.optionKey)) throw townError('INVALID_SELECTION');
    checked.optionKey = input.optionKey;
  } else if (input.optionKey != null && input.optionKey !== '') {
    throw townError('INVALID_SELECTION');
  }
  if (wants('character') || wants('character_optional') || wants('character_pair')) {
    const allowed = new Set(selectableTargets(db).map(t => t.actorKey));
    const keys = Array.isArray(input.targetActorKeys) ? input.targetActorKeys : [];
    const required = feature.supportedTargetKinds.includes('character_pair') ? 2
      : feature.supportedTargetKinds.includes('character_optional') ? 0 : 1;
    if (feature.supportedTargetKinds.includes('character_optional')) {
      if (keys.length > 1) throw townError('INVALID_SELECTION');
    } else if (keys.length !== required) {
      throw townError('INVALID_SELECTION');
    }
    if (feature.supportedTargetKinds.includes('character_pair')
      && keys.length === 2 && keys[0] === keys[1]) {
      // 双人合影两位目标必须不同（计划 §4.4）——在选择校验就拒绝，不等生成阶段才发现
      throw townError('INVALID_SELECTION');
    }
    for (const key of keys) {
      if (!allowed.has(key)) throw townError('TARGET_UNSUPPORTED');
    }
    checked.targetActorKeys = keys;
  } else if (Array.isArray(input.targetActorKeys) && input.targetActorKeys.length) {
    throw townError('INVALID_SELECTION');
  }
  if (['item_exchange', 'item_recycle'].includes(feature.templateId)) {
    if (!Array.isArray(input.itemIds) || input.itemIds.length !== 1 || !Number.isSafeInteger(Number(input.itemIds[0]))) {
      throw townError('INVALID_SELECTION');
    }
    checked.itemIds = [Number(input.itemIds[0])];
    // 交换只接受该 offer 的 accept 目录物品（计划 §4.2）；执行器内还会再复核一次
    if (feature.templateId === 'item_exchange') {
      const offer = (feature.params?.offers || []).find(o => o.giveResourceKey === checked.optionKey);
      assertItemInCatalogs(findTradableItem(db, checked.itemIds[0]), offer?.acceptCatalogKey);
    }
  } else if (Array.isArray(input.itemIds) && input.itemIds.length) {
    throw townError('INVALID_SELECTION');
  }
  if (feature.params?.allowUserNote === true) {
    const note = String(input.userNote || '').slice(0, feature.params.userNoteMaxChars || 200);
    checked.userNote = note;
  } else if (input.userNote) {
    throw townError('INVALID_SELECTION');
  }
  return checked;
}

function optionKeysOf(feature) {
  const params = feature.params || {};
  if (Array.isArray(params.options)) return params.options.map(o => o.key);
  // 画像/纪念品：选项即拍摄主题
  if (Array.isArray(params.themes)) return params.themes.map(t => t.key);
  // 物物交换：选项即交换档（giveResourceKey）
  if (feature.templateId === 'item_exchange' && Array.isArray(params.offers)) {
    return params.offers.map(o => o.giveResourceKey);
  }
  return [];
}

/** 报价金额（交易执行时在事务内复核） */
function quotePrice(context, source, feature, selection) {
  if (feature.templateId === 'item_purchase') {
    const offer = feature.params.offers.find(o => o.resourceKey === selection?.offerKey)
      || feature.params.offers[0];
    return PRICE_TIERS[offer?.priceTier] ?? 0;
  }
  if (feature.templateId === 'item_recycle') {
    const item = findRecyclableItem(context.db, Number(selection?.itemIds?.[0]), feature.params.acceptCatalogKeys);
    return recycleQuote(context.db, { valuationTier: feature.params.valuationTier, item });
  }
  return PRICE_TIERS[feature.priceTier] ?? 0;
}

function quoteSummary(context, source, feature, selection) {
  const option = (feature.params?.options || []).find(o => o.key === selection?.optionKey);
  if (feature.templateId === 'item_purchase') {
    const offer = feature.params.offers.find(o => o.resourceKey === selection?.offerKey) || feature.params.offers[0];
    return `购买「${offer?.label || offer?.resourceKey}」`;
  }
  if (feature.templateId === 'item_exchange') {
    const offer = feature.params.offers[0];
    return `用一件物品交换「${offer?.label || offer?.giveResourceKey}」`;
  }
  if (feature.templateId === 'item_recycle') return '回收一件物品换取金币';
  if (feature.templateId === 'pool_draw') return '抽取一次奖池';
  if (feature.templateId === 'daily_fortune') return '抽取今日一签';
  if (option) return `${feature.title} · ${option.label}`;
  return feature.title;
}

/** 管理端：更新建筑实例的用途描述（来源优先级第 1 位） */
export function setBuildingFeatureDescription(db, { mapId, locationKey, description }) {
  const text = String(description || '').slice(0, 1000);
  const result = db.prepare('UPDATE town_locations SET feature_desc = ? WHERE map_id = ? AND key = ?')
    .run(text, mapId, locationKey);
  if (!result.changes) throw townError('LOCATION_NOT_FOUND');
  return text;
}

/** 模型候选目录（精简 schema + 完整示例，供生成器使用） */
export function templateCatalogForPrompt() {
  return readyTemplates().map(template => ({
    id: template.id,
    version: template.version,
    semanticDescription: template.semanticDescription,
    requiredCapabilities: template.requiredCapabilities,
    supportedTargetKinds: template.supportedTargetKinds,
    costPolicy: template.costPolicy,
    paramsExample: template.paramsExample,
  }));
}
