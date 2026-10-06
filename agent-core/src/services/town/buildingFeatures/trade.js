/**
 * 三种交易模板执行器与真实库存桥接（计划 §4.2、§7.5、§12）。
 *
 * 钱物来源全部复用现有经济系统：
 *   - 库存：economy.ensureStock/seedStock 的 town_resource_stocks，owner_key 按
 *     「建筑实例」而不是 npcId（同一经营者多栋建筑不混货架）。
 *   - 资金：玩家付款走 economy.transfer 进经营者 business 账户；回收支出从同一
 *     账户转出。开业资金/初始库存受一次性预算约束（opening_budget_json 消费记录），
 *     重生成文案、切版本、复制素材不会重复补货。
 *   - 物品：交付进 backpack_items（owner='me'，可直接进背包），回收/交换收走的物品
 *     retire（retired_at 标记），不物理删除保留追溯。
 * 回收报价由服务端计算：估值档位与物品已知买入价取小，不信任前端或 LLM 金额。
 */
import { townError } from '../townEventService.js';
import { PRICE_TIERS } from '../townBuildingFeatureRegistry.js';

/** 一次性开业预算：每个资源的初始库存单位与经营者初始资金（计划 §4.2「受上限约束的开业配置」） */
export const OPENING_STOCK_UNITS = 3;
export const OPENING_OPERATOR_FUNDS = 200;

export const buildingOwnerKey = buildingInstanceId => `building:${buildingInstanceId}`;
export const buildingStockOwnerKey = (buildingInstanceId, resourceKey) =>
  `building-stock:${buildingInstanceId}:${resourceKey}`;

/** 幂等开业：库存/资金只在预算未消费时 seed 一次（seedVersion 记录在 opening_budget_json） */
export function ensureOpeningResources({ db, economy, scope, buildingInstanceId, resourceKeys }) {
  const profile = db.prepare(
    'SELECT opening_budget_json FROM town_building_feature_profiles WHERE world_id = ? AND building_instance_id = ?')
    .get(scope.worldId, buildingInstanceId);
  const budget = JSON.parse(profile?.opening_budget_json || '{}');
  let dirty = false;
  for (const resourceKey of resourceKeys) {
    if (budget.stocks?.[resourceKey]) continue;
    const stock = economy.ensureStock({ ...scope, ownerKey: buildingStockOwnerKey(buildingInstanceId, resourceKey),
      resourceKey: `bfr:${buildingInstanceId}:${resourceKey}` });
    economy.seedStock({ ...scope, stockId: stock.stockId, amount: OPENING_STOCK_UNITS,
      idempotencyKey: `bf-opening:${buildingInstanceId}:${resourceKey}`,
      sourceKey: `bf-opening-stock:${buildingInstanceId}:${resourceKey}`, reasonCode: 'BF_OPENING_STOCK' });
    budget.stocks = budget.stocks || {};
    budget.stocks[resourceKey] = { stockId: stock.stockId, units: OPENING_STOCK_UNITS };
    dirty = true;
  }
  const ownerKey = buildingOwnerKey(buildingInstanceId);
  if (!budget.funds) {
    const account = economy.ensureAccount({ ...scope, ownerKey, accountType: 'business' });
    economy.seed({ ...scope, accountId: account.accountId, amount: OPENING_OPERATOR_FUNDS,
      idempotencyKey: `bf-opening-funds:${buildingInstanceId}`,
      sourceKey: `bf-opening-funds:${buildingInstanceId}`, reasonCode: 'BF_OPENING_FUNDS' });
    budget.funds = { accountId: account.accountId, amount: OPENING_OPERATOR_FUNDS };
    dirty = true;
  }
  if (dirty) {
    db.prepare(`UPDATE town_building_feature_profiles SET opening_budget_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE world_id = ? AND building_instance_id = ?`)
      .run(JSON.stringify(budget), scope.worldId, buildingInstanceId);
  }
  return budget;
}

function operatorAccount(economy, scope, buildingInstanceId) {
  return economy.ensureAccount({ ...scope, ownerKey: buildingOwnerKey(buildingInstanceId), accountType: 'business' });
}

function playerAccount(economy, scope, playerActorId) {
  return economy.ensureAccount({ ...scope, ownerKey: `actor:${playerActorId}`, accountType: 'actor', actorId: playerActorId });
}

/** 交付一件商品进背包（与 NPC 货架同构：status ready、已收下，effect_key 仅作展示标记）。
 * source_index 自增：同一资源可被多次购买，不触发 grant_source 唯一索引。 */
export function grantGoodsItem(db, { worldId, buildingInstanceId, resourceKey, name, description, imageUrl }) {
  const sourceId = `bf:${buildingInstanceId}:${resourceKey}`;
  const index = db.prepare(
    `SELECT COALESCE(MAX(source_index), -1) + 1 AS next FROM backpack_items
     WHERE world_id = ? AND source_type = 'trade' AND source_id = ?`).get(worldId, sourceId).next;
  const info = db.prepare(
    `INSERT INTO backpack_items
     (effect_key, name, description, rarity, image_url, status, payload_json, owner_key, source_type,
      world_id, source_id, source_index, collected_at, acquired_at, version)
     VALUES ('building_goods', ?, ?, 'common', ?, 'ready', '{}', 'me', 'trade', ?, ?, ?,
             datetime('now'), datetime('now'), 1)`
  ).run(name, description, imageUrl || null, worldId, sourceId, index);
  return Number(info.lastInsertRowid);
}

/** 取一件玩家可交易的背包物品：ready、已收下、未被其他操作锁定、未使用 */
export function findTradableItem(db, itemId) {
  const item = db.prepare(
    `SELECT * FROM backpack_items WHERE id = ? AND owner_key = 'me' AND retired_at IS NULL`).get(Number(itemId));
  if (!item || item.status !== 'ready' || !item.collected_at || item.used_at) throw townError('INVALID_SELECTION');
  if (item.locked_by) throw townError('ITEM_LOCKED');
  return item;
}

/** 校验玩家物品属于 accept 目录（键格式 catalog_{template_id}）；不合格即拒绝（计划 §4.2「合格物品」） */
export function assertItemInCatalogs(item, catalogKeys) {
  const keys = Array.isArray(catalogKeys) ? catalogKeys : [catalogKeys];
  const itemKey = item?.template_id ? `catalog_${item.template_id}` : null;
  if (!itemKey || !keys.includes(itemKey)) throw townError('INVALID_SELECTION');
}

/** 报价/执行共用的可回收物品解析：可交易 + 属于 acceptCatalogKeys 目录。
 * 报价语境下被锁定的物品同样视为不可选（INVALID_SELECTION），与既有报价语义一致。 */
export function findRecyclableItem(db, itemId, acceptCatalogKeys) {
  let item;
  try {
    item = findTradableItem(db, itemId);
  } catch (err) {
    if (err?.code === 'ITEM_LOCKED') throw townError('INVALID_SELECTION');
    throw err;
  }
  assertItemInCatalogs(item, acceptCatalogKeys);
  return item;
}

/** 物品已知买入价上限：货架来源按原价，模板商品按最低在售价，未知按 basic 档兜底 */
export function lookupBuyPriceCap(db, item) {
  const sourceId = String(item.source_id || '');
  const stockMatch = /^npc-stock:(\d+)$/.exec(sourceId);
  if (stockMatch) {
    const stock = db.prepare('SELECT price FROM town_npc_stock WHERE id = ?').get(Number(stockMatch[1]));
    if (stock?.price) return stock.price;
  }
  if (item.template_id) {
    // 经营者功能已收编为 town_npcs.functions_json 列（旧 town_npc_functions 表已废弃）
    const rows = db.prepare(`SELECT functions_json FROM town_npcs WHERE functions_json LIKE '%trader%'`).all();
    let min = null;
    for (const row of rows) {
      const functions = JSON.parse(row.functions_json || '{}');
      for (const spec of functions.trader?.sells || []) {
        if (spec.templateId === item.template_id) min = min == null ? spec.price : Math.min(min, spec.price);
      }
    }
    if (min != null) return min;
  }
  return PRICE_TIERS.basic;
}

/**
 * 商品购买：扣款（玩家→经营者账户）、扣真实库存、交付物品。
 * 库存不足抛 OUT_OF_STOCK；余额不足抛 INSUFFICIENT_FUNDS。
 */
export function purchaseOffer({ db, economy, scope, buildingInstanceId, offer, goods }) {
  const stock = economy.ensureStock({ ...scope, ownerKey: buildingStockOwnerKey(buildingInstanceId, offer.resourceKey),
    resourceKey: `bfr:${buildingInstanceId}:${offer.resourceKey}` });
  const current = economy.getStock({ ...scope, stockId: stock.stockId });
  if (current.available < 1) throw townError('OUT_OF_STOCK');
  const price = PRICE_TIERS[offer.priceTier];
  const player = playerAccount(economy, scope, scope.playerActorId);
  const operator = operatorAccount(economy, scope, buildingInstanceId);
  economy.transfer({ ...scope, fromAccountId: player.accountId, toAccountId: operator.accountId,
    amount: price, idempotencyKey: `${scope.idempotencyKey}:pay`,
    sourceKey: `${scope.sourceKey}:pay`, reasonCode: 'BF_PURCHASE' });
  const reservation = reserveStockUnit({ db, economy, scope,
    stockId: stock.stockId, keySuffix: 'reserve' });
  economy.captureStock({ ...scope, reservationId: reservation.reservation.reservationId,
    expectedVersion: reservation.reservation.version,
    consume: true, idempotencyKey: `${scope.idempotencyKey}:stock`,
    sourceKey: `${scope.sourceKey}:stock`, reasonCode: 'BF_PURCHASE' });
  const itemId = grantGoodsItem(db, { worldId: scope.worldId, buildingInstanceId,
    resourceKey: offer.resourceKey, name: goods.name, description: goods.description, imageUrl: goods.imageUrl });
  return { price, stockId: stock.stockId, itemId };
}

/** 为一次操作预留一个库存单位（同事务内复核，计划 §9.3） */
export function reserveStockUnit({ db, economy, scope, stockId, keySuffix = 'reserve' }) {
  const current = economy.getStock({ ...scope, stockId });
  if (current.available < 1) throw townError('OUT_OF_STOCK');
  return economy.reserveStock({ ...scope, stockId, amount: 1, ownerRef: scope.ownerRef,
    idempotencyKey: `${scope.idempotencyKey}:${keySuffix}`,
    sourceKey: `${scope.sourceKey}:${keySuffix}`, reasonCode: 'BF_RESERVE_STOCK' });
}

/** 物物交换：玩家一件物品 ⇄ 经营者一件商品（原子、一件换一件、无手续费、物品须属 accept 目录） */
export function exchangeOffer({ db, economy, scope, buildingInstanceId, offer, goods, playerItemId }) {
  const item = findTradableItem(db, playerItemId);
  assertItemInCatalogs(item, offer.acceptCatalogKey);
  const stock = economy.ensureStock({ ...scope, ownerKey: buildingStockOwnerKey(buildingInstanceId, offer.giveResourceKey),
    resourceKey: `bfr:${buildingInstanceId}:${offer.giveResourceKey}` });
  const current = economy.getStock({ ...scope, stockId: stock.stockId });
  if (current.available < 1) throw townError('OUT_OF_STOCK');
  // 收走玩家物品（retire 保留追溯），库存扣减与交付在同一事务
  const reservation = economy.reserveStock({ ...scope, stockId: stock.stockId, amount: 1, ownerRef: scope.ownerRef,
    idempotencyKey: scope.idempotencyKey, sourceKey: scope.sourceKey, reasonCode: 'BF_EXCHANGE' });
  economy.captureStock({ ...scope, reservationId: reservation.reservation.reservationId,
    expectedVersion: reservation.reservation.version,
    consume: true, idempotencyKey: `${scope.idempotencyKey}:stock`,
    sourceKey: `${scope.sourceKey}:stock`, reasonCode: 'BF_EXCHANGE' });
  db.prepare('UPDATE backpack_items SET retired_at = CURRENT_TIMESTAMP, locked_by = ? WHERE id = ?')
    .run(scope.ownerRef, item.id);
  const itemId = grantGoodsItem(db, { worldId: scope.worldId, buildingInstanceId,
    resourceKey: offer.giveResourceKey, name: goods.name, description: goods.description, imageUrl: goods.imageUrl });
  return { acceptedItemId: item.id, stockId: stock.stockId, itemId };
}

/**
 * 回收兑换：收走一件合格物品，按服务端报价支付金币（经营者账户转出）。
 * 报价 = min(估值档位, 物品已知买入价上限)，杜绝「低价买入→高价回收」套利。
 */
export function recycleQuote(db, { valuationTier, item }) {
  const tierValue = PRICE_TIERS[valuationTier];
  return Math.min(tierValue, lookupBuyPriceCap(db, item));
}

export function recycleItem({ db, economy, scope, buildingInstanceId, playerItemId, valuationTier, acceptCatalogKeys }) {
  const item = findRecyclableItem(db, playerItemId, acceptCatalogKeys);
  const price = recycleQuote(db, { valuationTier, item });
  if (price <= 0) throw townError('OUT_OF_STOCK');
  const player = playerAccount(economy, scope, scope.playerActorId);
  const operator = operatorAccount(economy, scope, buildingInstanceId);
  db.prepare('UPDATE backpack_items SET retired_at = CURRENT_TIMESTAMP, locked_by = ? WHERE id = ?')
    .run(scope.ownerRef, item.id);
  economy.transfer({ ...scope, fromAccountId: operator.accountId, toAccountId: player.accountId,
    amount: price, idempotencyKey: scope.idempotencyKey,
    sourceKey: scope.sourceKey, reasonCode: 'BF_RECYCLE' });
  return { acceptedItemId: item.id, price };
}
