import { createHash } from 'node:crypto';
import { canonicalJson, createTownEventService, requireText, townError } from './townEventService.js';
import { ensureNpcFunctions } from './townNpcFunctions.js';
import { sourceTradeCapabilities } from './townInteractionTarget.js';
import { TRADER_SELLS } from './townNpcFunctions.js';

const hash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const sync = value => { if (value?.then) throw townError('ASYNC_ADAPTER_FORBIDDEN'); return value; };

/**
 * NPC 功能点服务：赠礼（gift_giver）、卖货（trader，激活 itemTemplates.trade，玩家只能买不能卖）。
 * 模型只表达功能的存在；是否给、给什么、什么价格，全部由这里的注册表与服务端校验决定。
 */
export function createTownNpcFunctionService({ db, clock, registry, economy, itemTemplates = null,
  functionsForActor = (_actorId, functions) => functions, tradingAccount = null, consumers = [] }) {
  if (!db?.transaction || !clock?.now || !registry?.getWorldEpoch || !registry?.getActor
    || !registry?.resolveAgentKey || !economy?.ensureAccount || !economy?.transfer) throw townError('MISSING_DEPENDENCY');
  const now = () => {
    const value = sync(clock.now());
    if (!Number.isSafeInteger(value) || value < 0) throw townError('INVALID_CLOCK');
    return value;
  };
  const events = createTownEventService({ db, clock: { now }, getWorldEpoch: registry.getWorldEpoch,
    validators: { 'town.gift.given': payload => !!payload && typeof payload.npcActorId === 'string'
      && typeof payload.templateId === 'string' && typeof payload.sourceId === 'string'
      && Number.isSafeInteger(payload.itemId) } });
  const epoch = input => {
    requireText(input.worldId);
    if (!Number.isSafeInteger(input.worldEpoch) || input.worldEpoch < 1
      || sync(registry.getWorldEpoch(input.worldId)) !== input.worldEpoch) throw townError('STALE_EPOCH');
  };
  const resolveNpc = (npcId, input) => {
    epoch(input);
    const npcRow = Number.isSafeInteger(npcId)
      ? db.prepare('SELECT * FROM town_npcs WHERE id = ?').get(npcId) : null;
    if (!npcRow) throw townError('NPC_NOT_FOUND');
    const functions = ensureNpcFunctions(db, npcRow);
    const actorId = sync(registry.resolveAgentKey(`npc:${npcId}`))?.actorId ?? null;
    const actor = actorId && sync(registry.getActor(actorId, input.worldId));
    if (!actor || actor.actorId !== actorId || actor.archived || actor.mergedInto || !actor.participating) {
      throw townError('ACTOR_UNAVAILABLE');
    }
    const capabilities = sourceTradeCapabilities(db, npcRow, input);
    const effective = functionsForActor(actorId, functions);
    if (!capabilities.includes('trade')) delete effective.trader;
    else if (!effective.trader) effective.trader = { sells: TRADER_SELLS };
    if (!capabilities.includes('service')) delete effective.gift_giver;
    return { npcRow, functions: effective, capabilities, actorId, actor };
  };
  const playerAccountId = input => sync(economy.ensureAccount({ ...input, ownerKey: `actor:${sync(registry.resolveAgentKey('me')).actorId}`,
    actorId: sync(registry.resolveAgentKey('me')).actorId, accountType: 'actor' })).accountId;
  function receiveGift(npcId, input) {
    epoch(input); requireText(input.idempotencyKey);
    if (!itemTemplates?.grant) throw townError('ITEM_TEMPLATES_REQUIRED');
    return db.transaction(() => {
      const context = resolveNpc(npcId, input);
      if (!context.functions.gift_giver) throw townError('NOT_A_GIFT_GIVER');
      const time = now();
      const state = db.prepare('SELECT last_gift_at FROM town_npc_gifts WHERE world_id=? AND actor_id=?')
        .get(input.worldId, context.actorId);
      if (state && time - state.last_gift_at < context.functions.gift_giver.cooldownMs) throw townError('GIFT_COOLDOWN');
      const pool = context.functions.gift_giver.itemPool;
      const pick = pool[Math.floor(time / 3600000) % pool.length];
      sync(itemTemplates.ensureDefaultTemplates({ ...input }));
      const bucket = Math.floor(time / 600000);
      const sourceId = `npc-gift:${context.actorId}:${bucket}`;
      const grant = sync(itemTemplates.grant({ ...input, templateId: pick.templateId, templateVersion: pick.templateVersion,
        ownerKey: 'me', quantity: 1, sourceType: 'reward', sourceId, idempotencyKey: sourceId, reasonCode: 'NPC_GIFT' }));
      const itemId = grant.itemIds[0];
      db.prepare(`INSERT INTO town_npc_gifts(world_id,actor_id,last_gift_at,last_template_id,last_item_id) VALUES(?,?,?,?,?)
        ON CONFLICT(world_id,actor_id) DO UPDATE SET last_gift_at=excluded.last_gift_at,
          last_template_id=excluded.last_template_id, last_item_id=excluded.last_item_id`)
        .run(input.worldId, context.actorId, time, pick.templateId, itemId);
      events.append({ eventId: `gift:${sourceId}`, worldId: input.worldId, worldEpoch: input.worldEpoch,
        type: 'town.gift.given', occurredAt: time,
        actorIds: [...new Set([context.actorId, sync(registry.resolveAgentKey('me')).actorId])], locationKey: null,
        source: { system: 'town.npc.functions', entityId: sourceId },
        payload: { npcActorId: context.actorId, itemId, templateId: pick.templateId, sourceId } }, consumers);
      return { itemId, templateId: pick.templateId, templateName: grant.items?.[0]?.name || pick.templateId,
        fromActorId: context.actorId, nextAllowedAt: time + context.functions.gift_giver.cooldownMs };
    }).immediate();
  }
  function tradeCatalog(npcId, input) {
    epoch(input);
    const context = resolveNpc(npcId, input);
    if (!context.functions.trader) throw townError('NOT_A_TRADER');
    const nameOf = spec => itemTemplates?.getTemplate
      ? itemTemplates.getTemplate({ ...input, templateId: spec.templateId, templateVersion: spec.templateVersion })?.name ?? spec.templateId
      : spec.templateId;
    return { npcActorId: context.actorId, displayName: context.npcRow.display_name,
      sells: context.functions.trader.sells.map(spec => ({ ...spec, name: nameOf(spec) })) };
  }
  /** 玩家向 NPC 直接购买：一件起买，付钱即发货进背包，没有交易单与确认流程。 */
  function executeTrade(npcId, input) {
    epoch(input); requireText(input.idempotencyKey);
    if (!itemTemplates?.trade || !itemTemplates?.grant) throw townError('ITEM_TEMPLATES_REQUIRED');
    return db.transaction(() => {
      const context = resolveNpc(npcId, input);
      const trader = context.functions.trader;
      if (!trader) throw townError('NOT_A_TRADER');
      const spec = trader.sells.find(entry => entry.templateId === input.templateId);
      if (!spec) throw townError('INVALID_TRADE_ITEM');
      const playerAccount = playerAccountId(input);
      sync(itemTemplates.ensureDefaultTemplates({ ...input }));
      const sourceId = `npc-trade:${hash({ key: input.idempotencyKey, spec: spec.templateId })}`;
      // 居民不持有钱包：货直接发给玩家，钱从玩家账上销毁。
      const grant = sync(itemTemplates.grant({ ...input, templateId: spec.templateId, templateVersion: spec.templateVersion,
        ownerKey: 'me', quantity: 1, sourceType: 'trade', sourceId,
        idempotencyKey: `${input.idempotencyKey}:grant`, reasonCode: 'NPC_TRADE' }));
      const item = grant.items[0];
      sync(economy.burn({ ...input, accountId: playerAccount, amount: spec.price,
        idempotencyKey: input.idempotencyKey, sourceKey: `npc-trade:${input.idempotencyKey}`,
        reasonCode: 'NPC_TRADE_PURCHASE' }));
      const result = { direction: 'buy', itemId: item.id, templateId: spec.templateId, price: spec.price };
      db.prepare(`INSERT INTO town_npc_trade_receipts(world_id,world_epoch,actor_id,direction,template_id,price,item_id,occurred_at,result)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(input.worldId, input.worldEpoch, context.actorId, result.direction,
        result.templateId, result.price, result.itemId, now(), canonicalJson(result));
      return result;
    }).immediate();
  }
  return { functionsOf: (npcId, input) => { const context = resolveNpc(npcId, input); return { npcActorId: context.actorId, capabilities: context.capabilities, functions: context.functions }; }, receiveGift, tradeCatalog, executeTrade };
}
