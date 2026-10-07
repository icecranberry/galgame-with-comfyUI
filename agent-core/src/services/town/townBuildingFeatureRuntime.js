/**
 * 建筑功能运行时（计划 §9、§10）：作用域/权限检查、操作幂等、状态机、恢复、
 * 配额与固定随机结果、模板奇遇事件分发。
 *
 * 纪律：
 *   - 玩家身份从服务端上下文推导（registry.resolveAgentKey('me')），客户端不能指定付款人。
 *   - 确定性操作在单事务内 pending → committed；不跨 LLM/生图请求持有事务。
 *   - 收费生成操作先真实预留（economy.reserve，接入共享经济服务），失败释放。
 *   - 重试绑定原随机结果与已生成产物：LLM 已完成不重调，产物已保存不重画。
 *   - 模板事件复用奇遇呈现（town_building_feature_events），内容可预生成、推进零调用。
 */
import { randomUUID, createHash } from 'node:crypto';
import { chatSync } from '../../llm/llm-client.js';
import { config } from '../../config.js';
import { townError, canonicalJson } from './townEventService.js';
import { broadcastTownStateUpdated } from './townBus.js';
import { getTownEconomyContext } from './townEconomyRuntime.js';
import { getTownMaps } from './townService.js';
import {
  getBuildingFeaturesView, quoteFeature, compiledConfig, effectiveStatus, checkSelection,
  computeQuoteId, setBuildingFeatureDescription, ensureProfile,
} from './townBuildingFeatureService.js';
import {
  resolveBuildingFeatureSource, sourceDrifted, listBuildingFeatureSources,
} from './townBuildingFeatureSource.js';
import { generateBuildingFeatureConfig, refreshBuildingFeatureStock as refreshFeatureStock, referencedResourceKeys } from './townBuildingFeatureGenerator.js';
import { PRICE_TIERS, getTemplate } from './townBuildingFeatureRegistry.js';
import { resolveCharacterTarget, applyAppearance, expireSameSlot } from './buildingFeatures/appearance.js';
import { applyTemporaryState } from './buildingFeatures/state.js';
import {
  purchaseOffer, exchangeOffer, recycleItem, grantGoodsItem, recycleQuote,
  findRecyclableItem, buildingStockOwnerKey, ensureOpeningResources,
} from './buildingFeatures/trade.js';
import {
  resolveMediaTargets, buildMediaMessages, buildPersonaBlocks, parseMediaOutput,
  generatePortraitImage, galleryItems,
} from './buildingFeatures/media.js';
import { createRandomSeed, drawFromPool, drawDailyFortune, dailyKey } from './buildingFeatures/draw.js';

export function getTownBuildingFeatures({ mapId, locationKey } = {}) {
  assertFeatureEnabled();
  const context = getTownEconomyContext();
  const view = getBuildingFeaturesView(context, { mapId: mapId ?? currentMapId(), locationKey });
  attachFeatureStock(context, view);
  return view;
}

/** 店铺货架库存：给交易/奖池功能附上 stock 映射（resourceKey → 当前可售件数），供前端
 * 格子化货架把缺货格置灰。getBuildingFeaturesView 是纯服务（无 economy），库存只在运行时补。
 * ensureStock 幂等；读出 0 件即缺货，刷新（补满开业档位）后恢复。读取失败不挡浏览。 */
function attachFeatureStock(context, view) {
  const { economy } = context;
  if (!economy?.getStock || !view?.buildingInstanceId) return;
  const scope = { worldId: view.worldId, worldEpoch: view.worldEpoch };
  for (const feature of view.features || []) {
    const keys = referencedResourceKeys([feature]);
    if (!keys.size) continue;
    const stock = {};
    for (const resourceKey of keys) {
      try {
        const s = economy.ensureStock({ ...scope,
          ownerKey: buildingStockOwnerKey(view.buildingInstanceId, resourceKey),
          resourceKey: `bfr:${view.buildingInstanceId}:${resourceKey}` });
        stock[resourceKey] = economy.getStock({ ...scope, stockId: s.stockId }).available;
      } catch { stock[resourceKey] = 0; }
    }
    feature.stock = stock;
  }
}

/** mapId 缺省到玩家当前地图（HTTP 入口大多不携带地图 ID） */
function currentMapId() {
  try { return getTownMaps()?.currentMapId ?? null; } catch { return null; }
}

/** 独立总开关（计划 §15）：关闭后隐藏新入口、拒绝新操作；
 * 操作查询/重试/取消不在其列，未完成任务仍按既有状态机结算或释放。 */
function assertFeatureEnabled() {
  if (!config.features.townBuildingFeatures) throw townError('CAPABILITY_DENIED');
}

// 测试注入点：runGenerativeOperation 的 LLM 与生图提供者（生产路径不受影响）
const providerOverrides = {};
export function setBuildingFeatureProviderOverrides(next = {}) {
  Object.assign(providerOverrides, next);
}

const MEDIA_TEMPLATES = ['portrait_single', 'portrait_pair', 'illustrated_keepsake'];

function parseJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function requireScopeMatch(context, input) {
  const { scope } = context;
  if (input.worldId != null && input.worldId !== scope.worldId) throw townError('STALE_EPOCH');
  if (Number(input.worldEpoch) !== scope.worldEpoch) throw townError('STALE_EPOCH');
}

/** 解析建筑 + 配置 + 功能，执行前统一检查（计划 §9.2） */
function loadFeature(context, { mapId, locationKey, featureId, profileRevision }) {
  const { db } = context;
  const source = resolveBuildingFeatureSource(context, { mapId, locationKey });
  const profile = db.prepare(
    'SELECT * FROM town_building_feature_profiles WHERE world_id = ? AND world_epoch = ? AND building_instance_id = ?')
    .get(source.worldId, source.worldEpoch, source.buildingInstanceId);
  const status = effectiveStatus(source, profile);
  if (status === 'stale') throw townError('FEATURE_STALE');
  if (status === 'disabled') throw townError('CAPABILITY_DENIED');
  if (!['ready', 'partial'].includes(status)) throw townError('FEATURE_UNCONFIGURED');
  if (profileRevision != null && Number(profileRevision) !== profile.revision) throw townError('FEATURE_STALE');
  const config = compiledConfig(profile);
  const feature = config.features.find(f => f.featureId === featureId);
  if (!feature) throw townError('INVALID_SELECTION');
  // 建筑一律无主：无经营者检查，收支走建筑自己的 business 账户
  return { source, profile, config, feature };
}

/** 玩家可见的功能内容（供模板事件与执行回执统一引用） */
function featureOptions(feature) {
  const params = feature.params || {};
  if (Array.isArray(params.options)) {
    return params.options.map(o => ({ key: o.key, label: o.label, ...(o.flavor ? { flavor: o.flavor } : {}) }));
  }
  if (Array.isArray(params.offers)) {
    return params.offers.map(o => ({ key: o.resourceKey || o.giveResourceKey, label: o.label,
      ...(o.priceTier ? { priceTier: o.priceTier } : {}) }));
  }
  if (Array.isArray(params.themes)) {
    return params.themes.map(t => ({ key: t.key, label: t.label, scene: t.scene }));
  }
  if (Array.isArray(params.entries)) {
    return params.entries.map(e => ({ key: e.key, label: e.title }));
  }
  return [];
}

// ── 报价与执行 ──

export function quoteTownBuildingFeature({ mapId, locationKey, featureId, selection, ...expected }) {
  assertFeatureEnabled();
  const context = getTownEconomyContext();
  mapId = mapId ?? currentMapId();
  requireScopeMatch(context, expected);
  return quoteFeature(context, { mapId, locationKey, featureId, selection });
}

/**
 * 创建并执行一次功能操作。
 * 幂等：同 (世界, 代次, 建筑, 玩家, idempotencyKey) 与同请求体返回同一操作；不同请求体冲突。
 */
export function executeTownBuildingFeature(input) {
  assertFeatureEnabled();
  const context = getTownEconomyContext();
  input = { ...input, mapId: input.mapId ?? currentMapId() };
  const { db, scope, player } = context;
  requireScopeMatch(context, input);
  if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.length > 128) {
    throw Object.assign(new Error('请求标识无效'), { status: 400 });
  }
  // 建筑功能只在玩家当前地图上可办：拒绝别的地图传来的 mapId，
  // 否则两图存在同名地点时可用本图位置远程执行别图建筑（计划 §9.2）
  const activeMapId = currentMapId();
  if (activeMapId != null && input.mapId !== activeMapId) throw townError('NOT_ARRIVED');
  const { source, profile, feature } = loadFeature(context, input);
  const selection = checkSelection(context, source, feature, input.selection || {});
  const playerActorId = player.actorId;

  // 幂等键检查：同键不同请求体返回冲突（计划 §7.3）；作用域含世界代次，
  // 世界重置后旧代次的同键操作不会被误命中
  const digest = canonicalJson({ featureId: feature.featureId, revision: profile.revision, selection });
  const existing = db.prepare(
    `SELECT * FROM town_building_feature_operations
     WHERE world_id = ? AND world_epoch = ? AND building_instance_id = ? AND player_actor_id = ? AND idempotency_key = ?`)
    .get(scope.worldId, scope.worldEpoch, source.buildingInstanceId, playerActorId, input.idempotencyKey);
  if (existing) {
    if (existing.request_digest !== digest) throw townError('IDEMPOTENCY_CONFLICT');
    return operationDto(existing);
  }

  // 报价校验：quoteId + 过期时间必须与服务端重算一致（过期/价格变化拒绝，计划 §9.2）
  const price = quotePriceFor(context, feature, selection);
  verifyQuote(input, { sourceHash: source.sourceHash, featureId: feature.featureId,
    revision: profile.revision, selection, price });

  const seed = feature.templateId === 'pool_draw' ? createRandomSeed() : null;
  const operationId = randomUUID();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO town_building_feature_operations
       (operation_id, world_id, world_epoch, map_id, building_instance_id, feature_id, profile_revision,
        template_id, template_version, player_actor_id, target_json, idempotency_key, request_digest,
        input_json, execution_json, quote_json, quote_expires_at, status, stage, random_seed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'created', ?)`)
      .run(operationId, scope.worldId, scope.worldEpoch, source.mapId, source.buildingInstanceId,
        feature.featureId, profile.revision, feature.templateId, feature.templateVersion, playerActorId,
        JSON.stringify(selection.targetActorKeys || []), input.idempotencyKey, digest,
        JSON.stringify({ ...input, selection }),
        JSON.stringify(buildExecutionSnapshot(context, source, feature, selection, { seed })),
        JSON.stringify({ price, quoteId: input.quoteId || null }), Number(input.quoteExpiresAt || 0), seed);
    if (input.eventId) bindEvent(db, input.eventId, operationId);
    reserveUsage(db, scope, source.mapId, source.buildingInstanceId, feature, playerActorId, operationId);
  }).immediate();

  try {
    if (feature.executionMode === 'generative') {
      reserveGenerativeFee(context, loadOperation(db, operationId), source, price);
      const operation = loadOperation(db, operationId);
      runGenerativeOperation(context, operation).catch(() => {});
      // 生成异步推进；返回 generating 中的操作，客户端轮询/等待通知
      return operationDto(loadOperation(db, operationId));
    }
    const result = runDeterministicOperation(context, loadOperation(db, operationId));
    broadcastTownStateUpdated({ reason: 'building_feature' });
    return operationDto(loadOperation(db, operationId), result);
  } catch (err) {
    failOperation(context, operationId, err);
    throw err;
  }
}

/** 组合实例 ID（'{mapId}:{locationKey}'）反解原始地点 key */
function locationKeyOf(buildingInstanceId) {
  const index = String(buildingInstanceId).indexOf(':');
  return index >= 0 ? String(buildingInstanceId).slice(index + 1) : String(buildingInstanceId);
}

function loadOperation(db, operationId) {
  const row = db.prepare('SELECT * FROM town_building_feature_operations WHERE operation_id = ?').get(operationId);
  if (!row) throw townError('OPERATION_NOT_FOUND');
  return row;
}

/** 执行快照：不可变绑定当前配置条件（计划 §7.2「未完成操作保存自己所需的不可变执行快照」） */
function buildExecutionSnapshot(context, source, feature, selection, { seed }) {
  const config = compiledConfig(context.db.prepare(
    'SELECT compiled_json FROM town_building_feature_profiles WHERE world_id = ? AND world_epoch = ? AND building_instance_id = ?')
    .get(source.worldId, source.worldEpoch, source.buildingInstanceId));
  const resources = Object.fromEntries((config?.resources || []).map(r => [r.key, r]));
  return {
    feature: {
      featureId: feature.featureId, key: feature.key, templateId: feature.templateId,
      executionMode: feature.executionMode, title: feature.title, params: feature.params,
      presentation: feature.presentation, priceTier: feature.priceTier,
      cooldownPolicy: feature.cooldownPolicy,
    },
    building: { name: source.title, buildingInstanceId: source.buildingInstanceId },
    selection, seed, resources,
  };
}

/** 服务端权威价格（回收按物品估值，其余按价档） */
function quotePriceFor(context, feature, selection) {
  const params = feature.params || {};
  if (feature.templateId === 'item_purchase') {
    const offer = (params.offers || []).find(o => o.resourceKey === selection.offerKey);
    return offer ? PRICE_TIERS[offer.priceTier] : 0;
  }
  if (feature.templateId === 'item_recycle') {
    const item = findRecyclableItem(context.db, Number(selection.itemIds?.[0]), params.acceptCatalogKeys);
    return recycleQuote(context.db, { valuationTier: params.valuationTier, item });
  }
  return PRICE_TIERS[feature.priceTier] ?? 0;
}

/** 报价收据校验：哈希覆盖来源、功能、revision、选择、价格与过期时间 */
function verifyQuote(input, { sourceHash, featureId, revision, selection, price }) {
  if (!input.quoteId) throw townError('QUOTE_EXPIRED');
  const expiresAt = Number(input.quoteExpiresAt || 0);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < Date.now()) throw townError('QUOTE_EXPIRED');
  const expected = computeQuoteId({ sourceHash, featureId, revision, selection, price, expiresAt });
  if (expected !== input.quoteId) {
    throw Object.assign(new Error('报价与当前价格不一致'), { code: 'PRICE_CHANGED' });
  }
}

/** 稀疏配额：每日签运/奖池每日上限；预留与操作创建同事务（计划 §7.4） */
function reserveUsage(db, scope, mapId, buildingInstanceId, feature, playerActorId, operationId) {
  const policy = feature.cooldownPolicy || {};
  if (policy.kind !== 'daily') return null;
  // pool_draw 的每日上限来自建档 params.dailyLimit（1—3）；签运固定每日一签
  const dailyLimit = Number(feature.params?.dailyLimit) || policy.fixedLimit || policy.defaultLimit || 1;
  const { windowDate } = dailyKey({ worldId: scope.worldId, buildingInstanceId,
    featureId: feature.featureId, playerActorId });
  const existing = db.prepare(
    `SELECT * FROM town_building_feature_usage WHERE world_id = ? AND building_instance_id = ?
     AND feature_id = ? AND player_actor_id = ? AND window_date = ?`)
    .get(scope.worldId, buildingInstanceId, feature.featureId, playerActorId, windowDate);
  const used = (existing?.used_count || 0) + (existing?.reserved_count || 0);
  if (used >= dailyLimit) throw townError('DAILY_LIMIT');
  db.prepare(
    `INSERT INTO town_building_feature_usage
     (world_id, world_epoch, map_id, building_instance_id, feature_id, player_actor_id, window_date,
      used_count, reserved_count, last_operation_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(world_id, building_instance_id, feature_id, player_actor_id, window_date)
     DO UPDATE SET reserved_count = reserved_count + 1, last_operation_id = excluded.last_operation_id,
       updated_at = CURRENT_TIMESTAMP`)
    .run(scope.worldId, scope.worldEpoch, mapId, buildingInstanceId, feature.featureId,
      playerActorId, windowDate, operationId);
  return { windowDate };
}

function commitUsage(db, operation, feature) {
  if ((feature.cooldownPolicy || {}).kind !== 'daily') return;
  const { windowDate } = dailyKey({ worldId: operation.world_id, buildingInstanceId: operation.building_instance_id,
    featureId: operation.feature_id, playerActorId: operation.player_actor_id });
  db.prepare(
    `UPDATE town_building_feature_usage SET reserved_count = MAX(0, reserved_count - 1),
     used_count = used_count + 1, updated_at = CURRENT_TIMESTAMP
     WHERE world_id = ? AND building_instance_id = ? AND feature_id = ? AND player_actor_id = ? AND window_date = ?`)
    .run(operation.world_id, operation.building_instance_id, operation.feature_id, operation.player_actor_id, windowDate);
}

/** 失败时释放当日预留，避免一次失败锁死当天配额 */
function releaseUsage(db, operation, feature) {
  if ((feature.cooldownPolicy || {}).kind !== 'daily') return;
  const { windowDate } = dailyKey({ worldId: operation.world_id, buildingInstanceId: operation.building_instance_id,
    featureId: operation.feature_id, playerActorId: operation.player_actor_id });
  db.prepare(
    `UPDATE town_building_feature_usage SET reserved_count = MAX(0, reserved_count - 1), updated_at = CURRENT_TIMESTAMP
     WHERE world_id = ? AND building_instance_id = ? AND feature_id = ? AND player_actor_id = ? AND window_date = ?`)
    .run(operation.world_id, operation.building_instance_id, operation.feature_id, operation.player_actor_id, windowDate);
}

// ── 确定性执行 ──

function runDeterministicOperation(context, operation) {
  const { db, economy, scope } = context;
  const execution = parseJson(operation.execution_json, {});
  const feature = execution.feature;
  const selection = parseJson(operation.input_json, {}).selection || {};
  const source = resolveBuildingFeatureSource(context,
    { mapId: operation.map_id, locationKey: locationKeyOf(operation.building_instance_id) });
  return db.transaction(() => {
    // 统一收费：按操作报价真实转账（玩家 → 经营者建筑账户）。
    // 交易三模板各自在执行器内按 offer/估值结算，不走这条通用通道。
    const price = parseJson(operation.quote_json, {})?.price ?? 0;
    if (price > 0 && !['item_purchase', 'item_exchange', 'item_recycle'].includes(feature.templateId)) {
      const player = economy.ensureAccount({ ...scope, ownerKey: `actor:${operation.player_actor_id}`,
        accountType: 'actor', actorId: operation.player_actor_id });
      const operator = economy.ensureAccount({ ...scope, ownerKey: `building:${operation.building_instance_id}`,
        accountType: 'business' });
      economy.transfer({ ...scope, fromAccountId: player.accountId, toAccountId: operator.accountId,
        amount: price, idempotencyKey: `bf:${operation.idempotency_key}:pay`,
        sourceKey: `bf-op:${operation.operation_id}:pay`, reasonCode: 'BF_FEATURE_FEE' });
    }
    const outcome = executeDeterministic(context, operation, feature, selection, execution, source);
    markCommitted(db, operation.operation_id, outcome);
    commitUsage(db, operation, feature);
    completeBoundEvent(db, operation, outcome);
    return outcome;
  }).immediate();
}

/** 模板 → 真实效果（计划 §9.1 确定性分支；全部在调用方事务内） */
function executeDeterministic(context, operation, feature, selection, snapshot, source) {
  const { db, economy, scope } = context;
  const params = feature.params || {};
  const execScope = { ...scope, idempotencyKey: `bf:${operation.idempotency_key}`,
    sourceKey: `bf-op:${operation.operation_id}`, ownerRef: `bf-op:${operation.operation_id}`,
    playerActorId: operation.player_actor_id };
  switch (feature.templateId) {
    case 'outfit_change':
    case 'hairstyle_change':
    case 'accessory_change':
    case 'temporary_transform': {
      const target = resolveCharacterTarget(db, selection.targetActorKeys);
      const option = params.options.find(o => o.key === selection.optionKey);
      if (!option) throw townError('INVALID_SELECTION');
      // 同项已生效时 applyAppearance 内部拒绝（不收费不续时）；不同项先让出同槽位
      const applied = applyAppearance(db, { templateId: feature.templateId, option,
        durationHours: params.durationHours, characterId: target.characterId,
        displayName: target.displayName, sourceRef: operation.operation_id,
        expireSlot: true });
      return { kind: 'appearance', characterId: target.characterId, targetName: target.displayName, optionLabel: option.label,
        expiresAt: applied.expiresAt, effectId: applied.effectId, slot: applied.slot,
        summary: `${target.displayName} 换上了「${option.label}」` };
    }
    case 'temporary_state': {
      const target = resolveCharacterTarget(db, selection.targetActorKeys);
      const option = params.options.find(o => o.key === selection.optionKey);
      if (!option) throw townError('INVALID_SELECTION');
      const applied = applyTemporaryState(db, target.characterId, option.stateProfileKey,
        { durationHours: params.durationHours, label: option.label, sourceRef: operation.operation_id });
      return { kind: 'state', characterId: target.characterId, targetName: target.displayName, optionLabel: option.label,
        expiresAt: applied.expiresAt, effectId: applied.effectId,
        summary: `${target.displayName} 进入了「${option.label}」状态` };
    }
    case 'item_purchase': {
      const offer = params.offers.find(o => o.resourceKey === selection.offerKey);
      if (!offer) throw townError('INVALID_SELECTION');
      const resource = snapshot.resources[offer.resourceKey] || {};
      const outcome = purchaseOffer({ db, economy, scope: execScope,
        buildingInstanceId: operation.building_instance_id, offer,
        goods: { name: offer.label || resource.name, description: resource.description || offer.label } });
      return { kind: 'purchase', itemName: offer.label || resource.name, price: outcome.price,
        itemId: outcome.itemId, summary: `买下了「${offer.label || resource.name}」` };
    }
    case 'item_exchange': {
      const offer = params.offers.find(o => o.giveResourceKey === selection.optionKey) || params.offers[0];
      const resource = snapshot.resources[offer.giveResourceKey] || {};
      const outcome = exchangeOffer({ db, economy, scope: execScope,
        buildingInstanceId: operation.building_instance_id, offer,
        goods: { name: offer.label || resource.name, description: resource.description || offer.label },
        playerItemId: selection.itemIds[0] });
      return { kind: 'exchange', itemName: offer.label || resource.name, itemId: outcome.itemId,
        acceptedItemId: outcome.acceptedItemId, price: 0,
        summary: `用一件旧物换到了「${offer.label || resource.name}」` };
    }
    case 'item_recycle': {
      const outcome = recycleItem({ db, economy, scope: execScope,
        buildingInstanceId: operation.building_instance_id, playerItemId: selection.itemIds[0],
        valuationTier: params.valuationTier, acceptCatalogKeys: params.acceptCatalogKeys });
      return { kind: 'recycle', price: outcome.price, acceptedItemId: outcome.acceptedItemId,
        summary: `回收了一件物品，换到 ${outcome.price} 金币` };
    }
    case 'pool_draw': {
      const pool = params.pool;
      const stockIdByKey = {};
      const availability = {};
      for (const entry of pool) {
        const stock = economy.ensureStock({ ...scope,
          ownerKey: `building-stock:${operation.building_instance_id}:${entry.resourceKey}`,
          resourceKey: `bfr:${operation.building_instance_id}:${entry.resourceKey}` });
        stockIdByKey[entry.resourceKey] = stock.stockId;
        availability[entry.resourceKey] = economy.getStock({ ...scope, stockId: stock.stockId }).available;
      }
      // 结果在创建操作时已由持久化种子固定（重试不重抽）；费用由统一收费通道结算
      const picked = drawFromPool({ seed: operation.random_seed, pool, availability });
      const resource = snapshot.resources[picked.resourceKey] || {};
      const price = PRICE_TIERS[feature.priceTier] ?? 0;
      const reservation = economy.reserveStock({ ...scope, stockId: stockIdByKey[picked.resourceKey],
        amount: 1, ownerRef: execScope.ownerRef, idempotencyKey: execScope.idempotencyKey,
        sourceKey: execScope.sourceKey, reasonCode: 'BF_DRAW' });
      economy.captureStock({ ...scope, reservationId: reservation.reservation.reservationId,
        expectedVersion: reservation.reservation.version,
        consume: true, idempotencyKey: `${execScope.idempotencyKey}:stock`, sourceKey: `${execScope.sourceKey}:stock`,
        reasonCode: 'BF_DRAW' });
      const itemId = grantGoodsItem(db, { worldId: operation.world_id,
        buildingInstanceId: operation.building_instance_id, resourceKey: picked.resourceKey,
        name: resource.name || picked.resourceKey, description: resource.description || '奖池抽中的物品' });
      return { kind: 'draw', itemName: resource.name || picked.resourceKey, itemId, price,
        fortuneKey: null, reveal: params.reveal || 'card',
        summary: `抽中了「${resource.name || picked.resourceKey}」` };
    }
    case 'daily_fortune': {
      const { seed } = dailyKey({ worldId: operation.world_id,
        buildingInstanceId: operation.building_instance_id, featureId: operation.feature_id,
        playerActorId: operation.player_actor_id });
      const picked = drawDailyFortune({ seed, entries: params.entries });
      let stateApplied = null;
      if (picked.stateProfileKey && selection.targetActorKeys?.length) {
        const target = resolveCharacterTarget(db, selection.targetActorKeys);
        const applied = applyTemporaryState(db, target.characterId, picked.stateProfileKey,
          { durationHours: picked.durationHours, label: picked.title, sourceRef: operation.operation_id });
        stateApplied = { characterId: target.characterId, targetName: target.displayName, effectId: applied.effectId, expiresAt: applied.expiresAt };
      }
      return { kind: 'fortune', fortuneKey: picked.key, title: picked.title, text: picked.text,
        stateApplied, price: 0, summary: `抽到了「${picked.title}」签` };
    }
    default:
      throw townError('TEMPLATE_UNAVAILABLE');
  }
}

// ── 生成型操作（画像/纪念品） ──

/** 收费生成先真实预留（接入共享经济服务，其他入口花不到这笔钱，计划 §9.3）。
 * attemptSuffix 区分同操作的多次预留（失败重试后旧预留已释放，不能复用旧幂等键）。 */
function reserveGenerativeFee(context, operation, source, price, attemptSuffix = '') {
  if (price <= 0) return;
  const { db, economy, scope } = context;
  const player = economy.ensureAccount({ ...scope, ownerKey: `actor:${operation.player_actor_id}`,
    accountType: 'actor', actorId: operation.player_actor_id });
  const reservation = economy.reserve({ ...scope, accountId: player.accountId, amount: price,
    ownerRef: `bf-op:${operation.operation_id}${attemptSuffix}`,
    idempotencyKey: `bf:${operation.idempotency_key}:reserve${attemptSuffix}`,
    sourceKey: `bf-op:${operation.operation_id}:reserve${attemptSuffix}`, reasonCode: 'BF_MEDIA_RESERVE' });
  db.prepare('UPDATE town_building_feature_operations SET reservation_json = ? WHERE operation_id = ?')
    .run(JSON.stringify({ reservationId: reservation.reservation.reservationId, amount: price,
      reservationVersion: reservation.reservation.version }), operation.operation_id);
}

/** 生成管线：LLM 一次（可复用）→ 生图一次（可复用）→ 结算。进程重启后从持久化状态恢复。
 * 进程内 in-flight 守卫：惰性恢复与正常推进并发时只跑一份（LLM/生图不重复调用）。 */
const generativeInFlight = new Set();
export async function runGenerativeOperation(context, operation, { chat } = {}) {
  if (generativeInFlight.has(operation.operation_id)) return;
  const fresh = loadOperation(context.db, operation.operation_id);
  if (['committed', 'cancelled'].includes(fresh.status)) return;
  generativeInFlight.add(operation.operation_id);
  try {
    await runGenerativeOperationInner(context, fresh, { chat });
  } finally {
    generativeInFlight.delete(operation.operation_id);
  }
}

async function runGenerativeOperationInner(context, operation, { chat } = {}) {
  const { db } = context;
  const useChat = chat || providerOverrides.chat || chatSync;
  const execution = parseJson(operation.execution_json, {});
  const selection = execution.selection || {};
  const price = parseJson(operation.quote_json, {})?.price ?? 0;
  try {
    ensureGenerativeReservation(context, operation, price);
    // 阶段 1：短文与画面提示词（已生成过则复用，不重复调用 LLM —— 重试预算单列）
    let media = parseJson(operation.result_json, null);
    if (!media?.imagePrompt) {
      const targets = resolveMediaTargets(db, selection.targetActorKeys || [],
        { expectedCount: execution.feature.templateId === 'portrait_pair' ? 2 : 1 });
      const theme = (execution.feature.params.themes || []).find(t => t.key === selection.optionKey)
        || (execution.feature.params.themes || [])[0];
      if (!theme) throw townError('INVALID_SELECTION');
      setStage(db, operation.operation_id, 'generating');
      // 人物资料统一走 characterPersona（variant full + 生效外观快照，计划 §4.4/§6.6）；
      // 消息按高缓存分层：system0+格式（静态）→ 人物（稳定）→ 主题 → 玩家补充（最后）
      const messages = buildMediaMessages({ templateId: execution.feature.templateId, theme,
        userNote: selection.userNote || '', personas: buildPersonaBlocks(targets),
        buildingName: execution.building.name });
      const raw = await useChat(messages,
        { label: '建筑图文生成', temperature: 0.7, max_tokens: 1200 });
      const parsed = parseMediaOutput(raw);
      media = { caption: parsed.caption, imagePrompt: parsed.imagePrompt, themeKey: theme.key,
        themeLabel: theme.label, targets: targets.map(t => ({ id: t.id, displayName: t.display_name })) };
      db.prepare("UPDATE town_building_feature_operations SET result_json = ?, llm_calls = llm_calls + 1, updated_at = CURRENT_TIMESTAMP WHERE operation_id = ? AND status IN ('pending','generating')")
        .run(JSON.stringify(media), operation.operation_id);
    }
    // 阶段 2：生图（产物已保存则复用）
    let output = parseJson(operation.output_json, null);
    if (!output?.imageUrl) {
      setStage(db, operation.operation_id, 'rendering');
      const generate = providerOverrides.generatePortraitImage || generatePortraitImage;
      const { url } = await generate({ imagePrompt: media.imagePrompt });
      output = { imageUrl: url };
      db.prepare("UPDATE town_building_feature_operations SET output_json = ?, image_calls = image_calls + 1, updated_at = CURRENT_TIMESTAMP WHERE operation_id = ? AND status IN ('pending','generating')")
        .run(JSON.stringify(output), operation.operation_id);
    }
    // 阶段 3：结算（预留捕获 → committed）
    settleGenerative(context, loadOperation(db, operation.operation_id), media, output);
    broadcastTownStateUpdated({ reason: 'building_feature' });
  } catch (err) {
    failOperation(context, operation.operation_id, err);
    broadcastTownStateUpdated({ reason: 'building_feature' });
  }
}

/** 重试场景：预留已释放时重新预留（重试预算明确计入，不把重试当零成本） */
function ensureGenerativeReservation(context, operation, price) {
  if (price <= 0) return;
  const fresh = loadOperation(context.db, operation.operation_id);
  const reservation = parseJson(fresh.reservation_json, null);
  if (reservation?.reservationId) {
    const current = context.economy.getReservation({ ...context.scope, reservationId: reservation.reservationId });
    if (current && current.remaining > 0) return;
  }
  const source = resolveBuildingFeatureSource(context,
    { mapId: fresh.map_id, locationKey: locationKeyOf(fresh.building_instance_id) });
  context.db.prepare('UPDATE town_building_feature_operations SET reservation_json = NULL WHERE operation_id = ?')
    .run(fresh.operation_id);
  reserveGenerativeFee(context, fresh, source, price, `:${Date.now()}`);
}

/** 产物就绪后的最终结算（计划 §9.3 ready → committed） */
export function settleGenerative(context, operation, media, output) {
  const { db, economy, scope } = context;
  const execution = parseJson(operation.execution_json, {});
  db.transaction(() => {
    const reservation = parseJson(operation.reservation_json, null);
    if (reservation?.reservationId) {
      // 建筑无主：预留统一捕获进建筑自己的 business 账户（收支同户，永不因缺经营者退钱）
      const buildingAccountId = economy.ensureAccount({ ...scope,
        ownerKey: `building:${execution.building.buildingInstanceId}`,
        accountType: 'business' }).accountId;
      economy.capture({ ...scope, reservationId: reservation.reservationId,
        expectedVersion: reservation.reservationVersion, toAccountId: buildingAccountId,
        idempotencyKey: `bf:${operation.idempotency_key}:capture`,
        sourceKey: `bf-op:${operation.operation_id}:capture`, reasonCode: 'BF_MEDIA_CAPTURE' });
    }
    const outcome = { kind: 'media', caption: media.caption, imageUrl: output.imageUrl,
      themeLabel: media.themeLabel, targets: media.targets, format: execution.feature.params?.formats?.[0] || null,
      summary: media.themeLabel ? `「${media.themeLabel}」已完成` : '图片已完成' };
    markCommitted(db, operation.operation_id, outcome);
    completeBoundEvent(db, loadOperation(db, operation.operation_id), outcome);
  }).immediate();
}

// ── 操作查询 / 重试 / 取消 / 恢复 ──

/** 作品展示（gallery_display）：只读查询已有真实产物。
 * 按计划 §7.3「展示模板不为每次查看创建操作」——这里不建操作行、不扣费，纯读取。 */
export function getTownBuildingFeatureGallery({ mapId, locationKey, featureId, ...expected } = {}) {
  assertFeatureEnabled();
  const context = getTownEconomyContext();
  mapId = mapId ?? currentMapId();
  requireScopeMatch(context, expected);
  const { source, feature } = loadFeature(context, { mapId, locationKey, featureId });
  if (feature.templateId !== 'gallery_display') throw townError('INVALID_SELECTION');
  const items = galleryItems(context.db, { buildingInstanceId: source.buildingInstanceId,
    source: feature.params?.source || 'building_outputs', limit: feature.params?.limit || 12,
    playerActorId: context.player.actorId });
  return { worldId: source.worldId, worldEpoch: source.worldEpoch, mapId: source.mapId,
    buildingInstanceId: source.buildingInstanceId, featureId,
    emptyText: feature.presentation?.empty || '还没有可以展示的作品。', items };
}

export function getTownBuildingFeatureOperation(operationId) {
  const context = getTownEconomyContext();
  const { db } = context;
  const operation = loadOperation(db, operationId);
  // 惰性恢复：进程重启后卡在中间态的生成操作按持久化阶段续跑（计划 §9.3）
  if (['pending', 'generating'].includes(operation.status)) {
    const execution = parseJson(operation.execution_json, {});
    if (MEDIA_TEMPLATES.includes(execution.feature?.templateId)) {
      runGenerativeOperation(context, operation).catch(() => {});
    }
  }
  return operationDto(loadOperation(db, operationId));
}

/** 重试失败阶段：不改变抽取结果、不重复消费（计划 §10） */
export function retryTownBuildingFeatureOperation(operationId) {
  const context = getTownEconomyContext();
  const { db } = context;
  const operation = loadOperation(db, operationId);
  if (operation.status !== 'failed') throw townError('OPERATION_NOT_FAILED');
  const execution = parseJson(operation.execution_json, {});
  db.prepare("UPDATE town_building_feature_operations SET status = 'pending', error_code = NULL, error_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE operation_id = ?")
    .run(operationId);
  const fresh = loadOperation(db, operationId);
  if (MEDIA_TEMPLATES.includes(execution.feature?.templateId)) {
    runGenerativeOperation(context, fresh).catch(() => {});
    return operationDto(loadOperation(db, operationId));
  }
  try {
    runDeterministicOperation(context, fresh);
  } catch (err) {
    failOperation(context, operationId, err);
    throw err;
  }
  broadcastTownStateUpdated({ reason: 'building_feature' });
  return operationDto(loadOperation(db, operationId));
}

/** 取消未交付操作：释放预留，终态不可逆（计划 §9.4） */
export function cancelTownBuildingFeatureOperation(operationId) {
  const context = getTownEconomyContext();
  const { db, economy, scope } = context;
  const operation = loadOperation(db, operationId);
  if (['committed', 'cancelled'].includes(operation.status)) throw townError('OPERATION_UNAVAILABLE');
  db.transaction(() => {
    const reservation = parseJson(operation.reservation_json, null);
    if (reservation?.reservationId) {
      try {
        economy.release({ ...scope, reservationId: reservation.reservationId,
          expectedVersion: reservation.reservationVersion,
          idempotencyKey: `bf:${operation.idempotency_key}:release`,
          sourceKey: `bf-op:${operation.operation_id}:release`, reasonCode: 'BF_CANCEL' });
      } catch (err) {
        if (!['RESERVATION_CLOSED', 'IDEMPOTENCY_CONFLICT', 'RESERVATION_NOT_FOUND'].includes(err?.code)) throw err;
      }
    }
    db.prepare("UPDATE town_building_feature_operations SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE operation_id = ? AND status NOT IN ('committed','cancelled')")
      .run(operationId);
    releaseUsage(db, operation, parseJson(operation.execution_json, {}).feature || {});
  }).immediate();
  broadcastTownStateUpdated({ reason: 'building_feature' });
  return operationDto(loadOperation(db, operationId));
}

function markCommitted(db, operationId, outcome) {
  const changed = db.prepare(
    `UPDATE town_building_feature_operations SET status = 'committed', stage = 'done',
     random_result_json = COALESCE(random_result_json, ?), result_json = ?,
     updated_at = CURRENT_TIMESTAMP WHERE operation_id = ? AND status IN ('pending','generating','ready')`)
    .run(outcome.fortuneKey ? JSON.stringify({ fortuneKey: outcome.fortuneKey }) : null,
      JSON.stringify(outcome), operationId);
  if (!changed.changes) throw townError('OPERATION_ALREADY_SETTLED');
}

function failOperation(context, operationId, err) {
  const { db, economy, scope } = context;
  const operation = db.prepare('SELECT * FROM town_building_feature_operations WHERE operation_id = ?').get(operationId);
  if (!operation) throw err; // 创建事务已回滚（如配额拒绝）：原错误就是最终结果
  db.transaction(() => {
    // 失败释放尚未消费的预留（计划 §9.3）；与取消共用幂等键，双释放安全
    const reservation = parseJson(operation.reservation_json, null);
    if (reservation?.reservationId) {
      try {
        economy.release({ ...scope, reservationId: reservation.reservationId,
          expectedVersion: reservation.reservationVersion,
          idempotencyKey: `bf:${operation.idempotency_key}:release`,
          sourceKey: `bf-op:${operation.operation_id}:release`, reasonCode: 'BF_FAILED' });
      } catch (releaseErr) {
        if (!['RESERVATION_CLOSED', 'IDEMPOTENCY_CONFLICT', 'RESERVATION_NOT_FOUND'].includes(releaseErr?.code)) throw releaseErr;
      }
    }
    releaseUsage(db, operation, parseJson(operation.execution_json, {}).feature || {});
    db.prepare(
      `UPDATE town_building_feature_operations SET status = 'failed', error_code = ?, error_message = ?,
       updated_at = CURRENT_TIMESTAMP WHERE operation_id = ? AND status NOT IN ('committed','cancelled')`)
      .run(String(err?.code || 'OPERATION_FAILED').slice(0, 64), String(err?.message || err).slice(0, 500), operationId);
  }).immediate();
}

function setStage(db, operationId, stage) {
  db.prepare("UPDATE town_building_feature_operations SET status = 'generating', stage = ?, updated_at = CURRENT_TIMESTAMP WHERE operation_id = ? AND status IN ('pending','generating')")
    .run(stage, operationId);
}

function operationDto(row, liveResult) {
  const result = liveResult || parseJson(row.result_json, null);
  return {
    operationId: row.operation_id,
    worldId: row.world_id, worldEpoch: row.world_epoch, mapId: row.map_id,
    buildingInstanceId: row.building_instance_id,
    featureId: row.feature_id, templateId: row.template_id,
    status: row.status, stage: row.stage,
    price: parseJson(row.quote_json, {})?.price ?? 0,
    seed: row.random_seed,
    result: result || null,
    output: parseJson(row.output_json, null),
    eventRef: row.event_ref,
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
    llmCalls: row.llm_calls, imageCalls: row.image_calls,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

// ── 模板奇遇事件（building_feature 来源，计划 §2.1/§11.1） ──

const EVENT_TTL_HOURS = 24;

/** 接受建筑邀请：创建/复用模板事件（每建筑每功能同时最多一个活跃事件） */
function bindEvent(db, eventId, operationId) {
  const match = /^bfeat:(\d+)$/.exec(String(eventId || ''));
  if (!match) return;
  db.prepare("UPDATE town_building_feature_events SET operation_id = ?, status = 'engaged', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('open','engaged')")
    .run(operationId, Number(match[1]));
}

function completeBoundEvent(db, operation, outcome) {
  const match = /^bfeat:(\d+)$/.exec(String(operation.event_ref || ''));
  if (match) {
    finishEvent(db, Number(match[1]), outcome);
    return;
  }
  const row = db.prepare(
    `SELECT id FROM town_building_feature_events WHERE operation_id = ? AND status IN ('open','engaged')`)
    .get(operation.operation_id);
  if (row) finishEvent(db, row.id, outcome);
}

function finishEvent(db, eventId, outcome) {
  db.prepare(
    `UPDATE town_building_feature_events SET status = 'completed', result_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status IN ('open','engaged')`)
    .run(JSON.stringify(outcome), eventId);
}

export function dismissTownBuildingFeatureEvent(eventId) {
  const context = getTownEconomyContext();
  const { db } = context;
  const match = /^bfeat:(\d+)$/.exec(String(eventId));
  if (!match) throw townError('INVALID_SELECTION');
  db.prepare("UPDATE town_building_feature_events SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('open','engaged')")
    .run(Number(match[1]));
  return { ok: true };
}

export function listTownBuildingFeatureEvents() {
  // 总开关关闭时隐藏全部模板事件（未完成操作仍通过操作接口结算或释放）
  if (!config.features.townBuildingFeatures) return [];
  const context = getTownEconomyContext();
  const { db } = context;
  const world = context.registry.getWorldState();
  // 只展示玩家当前地图的建筑事件：别图/旧地图的邀请在奇遇页只会造成到不了现场的噪音（计划 §10）
  const mapId = currentMapId();
  if (mapId == null) return [];
  const rows = db.prepare(
    `SELECT * FROM town_building_feature_events WHERE world_id = ? AND world_epoch = ? AND map_id = ?
     ORDER BY id DESC LIMIT 100`)
    .all(world.worldId, world.epoch, mapId);
  // display_name 按「{mapId}:{locationKey}」复合实例精确解析，不再退化为统一的「建筑」
  const locations = new Map(db.prepare('SELECT map_id, key, name FROM town_locations').all()
    .map(l => [`${l.map_id}:${l.key}`, l.name]));
  return rows.map(row => buildingFeatureEventDto(row,
    locations.get(`${row.map_id}:${locationKeyOf(row.building_instance_id)}`) || '建筑'));
}

function buildingFeatureEventDto(row, buildingName) {
  const options = parseJson(row.options_json, {});
  return {
    id: `bfeat:${row.id}`,
    sourceType: 'building_feature',
    worldId: row.world_id,
    worldEpoch: row.world_epoch,
    characterId: null, npcId: null,
    display_name: buildingName,
    title: row.title,
    description: row.description,
    opening: row.opening,
    status: row.status,
    featureId: row.feature_id,
    buildingInstanceId: row.building_instance_id,
    mapId: row.map_id,
    operationId: row.operation_id,
    options: options.options || [],
    rendererKey: options.rendererKey || 'appearance_options',
    supportedTargetKinds: options.supportedTargetKinds || [],
    price: options.price ?? 0,
    result: parseJson(row.result_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

// ── 管理与生成入口 ──

/** 管理端候选清单：建筑来源 + 配置状态（纯读，不触发任何生成）。
 * 只收录特殊建筑（meta.special）；同名建筑共享一份功能，按名称去重，
 * 代表优先取已配置的实例（用户口径 2026-10-07）。 */
export function listTownBuildingFeatureCandidates({ mapId } = {}) {
  const context = getTownEconomyContext();
  mapId = mapId ?? currentMapId();
  const { db } = context;
  const sources = listBuildingFeatureSources(context, { mapId });
  const representatives = new Map();
  for (const source of sources) {
    if (!source.special) continue;
    const profile = db.prepare(
      `SELECT status, revision, generated_at, last_error, llm_calls, manual, source_hash, compiled_json
       FROM town_building_feature_profiles WHERE world_id = ? AND world_epoch = ? AND building_instance_id = ?`)
      .get(source.worldId, source.worldEpoch, source.buildingInstanceId);
    const config = compiledConfig(profile);
    const candidate = {
      worldId: source.worldId, worldEpoch: source.worldEpoch, mapId: source.mapId,
      // 管理端接口（描述/启停/生成）都以原始 location key 为路径参数
      locationKey: source.locationKey, buildingInstanceId: source.buildingInstanceId,
      title: source.title, description: source.description, descriptionSource: source.descriptionSource,
      descriptionMissing: !source.description, special: source.special,
      status: effectiveStatus(source, profile),
      revision: profile?.revision || 0,
      llmCalls: profile?.llm_calls || 0,
      manual: !!profile?.manual,
      lastError: profile?.last_error || null,
      features: (config?.features || []).map(f => ({ featureId: f.featureId, title: f.title,
        templateId: f.templateId, priceTier: f.priceTier, presentation: f.presentation })),
      unsupported: config?.unsupported || [],
    };
    const existing = representatives.get(source.title);
    // 去重代表：已配置（含失败/停用等有过建档的）优先于从未配置
    if (!existing || (candidate.revision > 0 && existing.revision === 0)) representatives.set(source.title, candidate);
  }
  return [...representatives.values()];
}

/** 同名建筑组（含本尊）：解析当前地图上与 source 同名的其余地点（用户口径：
 * 同名建筑功能一样，配置与描述整组共享）。个别地点解析失败即跳过。 */
function sameNameSiblingSources(context, source) {
  const db = context.db;
  const rows = db.prepare('SELECT key FROM town_locations WHERE map_id = ? AND key != ?')
    .all(source.mapId, source.locationKey);
  const siblings = [];
  for (const row of rows) {
    try {
      const sibling = resolveBuildingFeatureSource(context, { mapId: source.mapId, locationKey: row.key });
      if (sibling.title && sibling.title === source.title) siblings.push(sibling);
    } catch (err) {
      if (err?.code !== 'LOCATION_NOT_FOUND') throw err;
    }
  }
  return siblings;
}

/** 把代表建筑的已生效配置复制到同名建筑：同步用途描述、整份建档、并按需做开业配置。
 * 仅在代表配置处于成功状态（ready/partial/unsupported）时同步；代表无建档则只同步描述。 */
function propagateToSameNameSiblings(context, source) {
  const { db, economy, registry, scope } = context;
  const world = registry.getWorldState();
  const profile = db.prepare(
    'SELECT * FROM town_building_feature_profiles WHERE world_id = ? AND world_epoch = ? AND building_instance_id = ?')
    .get(world.worldId, world.epoch, source.buildingInstanceId);
  const copyable = profile && ['ready', 'partial', 'unsupported'].includes(profile.status);
  const compiled = copyable ? compiledConfig(profile) : null;
  const tradeResourceKeys = new Set();
  for (const feature of compiled?.features || []) {
    if (!['operator', 'operator_stock'].includes(getTemplate(feature.templateId)?.resourceRequirements)) continue;
    for (const key of referencedResourceKeys([feature])) tradeResourceKeys.add(key);
  }
  for (const sibling of sameNameSiblingSources(context, source)) {
    // 描述整组一致：先同步，再按同步后的来源落档（sourceHash 才不会立刻漂移）
    setBuildingFeatureDescription(db, { mapId: sibling.mapId, locationKey: sibling.locationKey,
      description: source.description || '' });
    const siblingSource = resolveBuildingFeatureSource(context, { mapId: sibling.mapId, locationKey: sibling.locationKey });
    if (!copyable) continue;
    const siblingProfile = ensureProfile(db, siblingSource);
    db.transaction(() => {
      // source_hash 沿用代表的值：漂移状态必须整组一致（代表 stale 时副本同样 stale），
      // source_json 保留副本自己的来源快照
      db.prepare(
        `UPDATE town_building_feature_profiles SET status = ?, source_hash = ?, generated_json = ?, compiled_json = ?,
         revision = ?, feature_ids_json = ?, resource_bindings_json = ?, manual = ?, generation_token = NULL,
         last_error = NULL, generated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(profile.status, profile.source_hash, profile.generated_json, profile.compiled_json, profile.revision,
          profile.feature_ids_json, profile.resource_bindings_json, profile.manual, siblingProfile.id);
    }).immediate();
    if (tradeResourceKeys.size) {
      ensureOpeningResources({ db, economy, scope,
        buildingInstanceId: siblingSource.buildingInstanceId, resourceKeys: [...tradeResourceKeys] });
    }
  }
}

/** 管理端：更新建筑实例的用途描述（触发来源漂移 → stale）；同名建筑整组共享描述 */
export function updateTownBuildingFeatureDescription({ mapId, locationKey, description } = {}) {
  const context = getTownEconomyContext();
  mapId = mapId ?? currentMapId();
  const { db } = context;
  const text = setBuildingFeatureDescription(db, { mapId, locationKey, description });
  const source = resolveBuildingFeatureSource(context, { mapId, locationKey });
  propagateToSameNameSiblings(context, source);
  broadcastTownStateUpdated({ reason: 'building_feature' });
  return { locationKey, description: text };
}

/** 管理端：启用/停用；并维护手工维护标记（防后台重生成悄悄覆盖）。
 * 同名建筑整组共享配置，启停与手工标记同步到组内已有建档的实例。 */
export function setTownBuildingFeatureEnabled({ mapId, locationKey, enabled, manual } = {}) {
  const context = getTownEconomyContext();
  mapId = mapId ?? currentMapId();
  const { db, scope } = context;
  const source = resolveBuildingFeatureSource(context, { mapId, locationKey });
  const targetProfile = db.prepare(
    'SELECT * FROM town_building_feature_profiles WHERE world_id = ? AND world_epoch = ? AND building_instance_id = ?')
    .get(source.worldId, source.worldEpoch, source.buildingInstanceId);
  if (!targetProfile) throw townError('FEATURE_UNCONFIGURED');
  const group = [source, ...sameNameSiblingSources(context, source)];
  let lastStatus = null;
  for (const member of group) {
    const profile = member.buildingInstanceId === source.buildingInstanceId
      ? targetProfile
      : db.prepare(
          'SELECT * FROM town_building_feature_profiles WHERE world_id = ? AND world_epoch = ? AND building_instance_id = ?')
          .get(source.worldId, source.worldEpoch, member.buildingInstanceId);
    // 组内从未建档的实例没有可启停的配置，跳过（生成时会整组建档）
    if (!profile) continue;
    db.transaction(() => {
      if (enabled != null) {
        if (enabled) {
          // 从 disabled 恢复：回到来源对应的有效状态（漂移则 stale）
          const restored = sourceDrifted(member, profile) ? 'stale' : (['ready', 'partial'].includes(profile.status) ? profile.status : 'stale');
          db.prepare('UPDATE town_building_feature_profiles SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(restored, profile.id);
        } else {
          db.prepare("UPDATE town_building_feature_profiles SET status = 'disabled', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .run(profile.id);
        }
      }
      if (manual != null) {
        db.prepare('UPDATE town_building_feature_profiles SET manual = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(manual ? 1 : 0, profile.id);
      }
    }).immediate();
    lastStatus = effectiveStatus(member,
      db.prepare('SELECT * FROM town_building_feature_profiles WHERE id = ?').get(profile.id));
  }
  broadcastTownStateUpdated({ reason: 'building_feature' });
  return { locationKey: source.locationKey, status: lastStatus };
}

export function generateTownBuildingFeatures({ mapId, locationKey, force } = {}) {
  const context = getTownEconomyContext();
  mapId = mapId ?? currentMapId();
  if (!config.features.townBuildingFeatures) throw townError('CAPABILITY_DENIED');
  return generateBuildingFeatureConfig(context, { mapId, locationKey, force })
    // 同名建筑共享一份功能（用户口径 2026-10-07）：生成成功后整组复制建档。
    // 复制失败不影响本次生成结果（主建筑已建档，组内其余可下次生成时再同步）。
    .then(result => {
      try {
        propagateToSameNameSiblings(context, resolveBuildingFeatureSource(context, { mapId, locationKey }));
      } catch { /* 同步失败不阻塞生成结果 */ }
      return result;
    });
}
/** 刷新店铺货架（10 金币）：重抽外观 + 商品目录并把货架补满。固定价、不限次数。 */
export function refreshTownBuildingFeatureStock({ mapId, locationKey, chatSync } = {}) {
  const context = getTownEconomyContext();
  mapId = mapId ?? currentMapId();
  if (!config.features.townBuildingFeatures) throw townError('CAPABILITY_DENIED');
  // 与 execute/accept 同一口径：只能给自己所在的当前地图上的店铺刷新（计划 9.2）
  const activeMapId = currentMapId();
  if (activeMapId != null && mapId !== activeMapId) throw townError('NOT_ARRIVED');
  return refreshFeatureStock(context, { mapId, locationKey, chatSync });
}

export function getTownBuildingFeatureGeneration({ mapId, locationKey } = {}) {
  const context = getTownEconomyContext();
  mapId = mapId ?? currentMapId();
  const { db } = context;
  const source = resolveBuildingFeatureSource(context, { mapId, locationKey });
  const profile = db.prepare(
    `SELECT status, generation_token, revision, last_error, generated_at, llm_calls
     FROM town_building_feature_profiles WHERE world_id = ? AND world_epoch = ? AND building_instance_id = ?`)
    .get(source.worldId, source.worldEpoch, source.buildingInstanceId);
  return { worldId: source.worldId, worldEpoch: source.worldEpoch, mapId: source.mapId,
    locationKey: source.locationKey, buildingInstanceId: source.buildingInstanceId,
    generation: profile || { status: 'unconfigured' } };
}
