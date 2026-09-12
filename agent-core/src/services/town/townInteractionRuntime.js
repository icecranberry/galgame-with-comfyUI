import { config } from '../../config.js';
import { getTownLifeRuntime } from './townEconomyRuntime.js';
import { getTownActorPosition } from './townService.js';
import { createTownInteractionService } from './townInteractionService.js';
import { townError } from './townEventService.js';
import { broadcastTownStateUpdated } from './townBus.js';
import { resolveTownInteractionTarget } from './townInteractionTarget.js';
import { townNpcEventRef } from './townNpcEventGenerator.js';
import { townCapabilities, defaultTownCapabilities } from './townCapabilities.js';

/** 服务线索目录：建筑能办什么事，只作为奇遇的起点线索；接受后走叙事管线，不再有步骤结算。
 * 价格只是故事里的标价味道，实际不扣款。 */
const TOWN_SERVICE_LEADS = Object.freeze({
  cafe: Object.freeze([
    Object.freeze({ key: 'town.cafe.drink_coffee', title: '来一杯手冲咖啡', description: '用当季豆子现冲一杯咖啡，坐在窗边慢慢喝。', price: 18 }),
  ]),
  tavern: Object.freeze([
    Object.freeze({ key: 'town.tavern.buy_meal', title: '吃一份热食', description: '让掌柜端上一份店里现做的热食，边吃边听店里的动静。', price: 12 }),
    Object.freeze({ key: 'town.tavern.round', title: '和掌柜喝一杯', description: '在吧台要一杯麦酒，听酒保讲镇上的传闻。', price: 8 }),
  ]),
  clothing_shop: Object.freeze([
    Object.freeze({ key: 'town.clothing.custom_order', title: '定做一件衣服', description: '量体选料，和裁缝商量一件合身的新衣。', price: 40 }),
    Object.freeze({ key: 'town.clothing.mend', title: '缝补旧衣', description: '把磨损的旧衣交给裁缝，顺手聊聊布料的故事。', price: 6 }),
  ]),
  salon: Object.freeze([
    Object.freeze({ key: 'town.salon.bob_cut', title: '修剪发型', description: '坐上理发椅，让理发师给你修一个利落的发型。', price: 15 }),
  ]),
  massage: Object.freeze([
    Object.freeze({ key: 'town.massage.relax', title: '按摩放松', description: '在安静的房间里做一次放松的按摩，卸下一身疲惫。', price: 25 }),
  ]),
  inn: Object.freeze([
    Object.freeze({ key: 'town.inn.stay', title: '投宿休息', description: '开一间干净的客房，睡个好觉再来探索小镇。', price: 20 }),
    Object.freeze({ key: 'town.inn.bath', title: '泡个热水澡', description: '向掌柜借一间浴房，烧好热水好好泡一泡。', price: 10 }),
  ]),
  study: Object.freeze([
    Object.freeze({ key: 'town.study.lesson', title: '听一节课', description: '坐进书斋听先生讲一段课，顺手翻翻架子上的书。', price: 10 }),
  ]),
  workshop: Object.freeze([
    Object.freeze({ key: 'town.workshop.custom', title: '看师傅手作', description: '参观工坊，请师傅现场做一件小物件。', price: 20 }),
  ]),
});


function runtime(target, expected = {}) {
  const context = getTownLifeRuntime(), { db, registry, scope, player } = context;
  if ((expected.worldEpoch != null && expected.worldEpoch !== scope.worldEpoch)
    || (expected.worldId != null && expected.worldId !== scope.worldId)) throw townError('STALE_EPOCH');
  const source = resolveTownInteractionTarget(context, target);
  const { actor, input, npc, name, venue, locationKey, capabilities, building, location } = source;
  const functions = npc ? context.npcFunctions.functionsOf(npc.id, input).functions : {};
  // 居民目标也能带出服务线索：从 TA 的工作地点反查建筑种类。
  const workplace = npc?.workplace_key
    ? db.prepare('SELECT * FROM town_locations WHERE key=? AND map_id=?').get(npc.workplace_key, npc.map_id) : null;
  const venueLocation = location || workplace;
  const siteCapabilities = venueLocation ? townCapabilities(venueLocation, defaultTownCapabilities(venueLocation.business_kind)) : [];
  // 服务线索只来自建筑种类；没有建筑的位置（如广场摊位）按 business_kind 兜底。
  const leadKind = venue?.kind || venueLocation?.business_kind || null;
  const siteKey = locationKey || workplace?.key || null;
  const leads = (actor && TOWN_SERVICE_LEADS[leadKind] || [])
    .filter(() => siteCapabilities.includes('service'));
  function catalog() {
    // 服务邀请接受后与特殊奇遇走同一条生成管线，目录项必须带出奇遇主角。
    const storyOwner = npc ? { npcId: npc.id }
      : !building && actor?.characterId ? { characterId: actor.characterId } : {};
    const items = leads.filter(item => capabilities.includes('service'))
      .map(item => ({ key: `service:${item.key}`, kind: 'service', capability: 'service',
      title: item.title, description: item.description, price: item.price,
      serviceKey: item.key, locationKey: siteKey, businessKey: venue?.businessKey || siteKey, ...storyOwner }));
    if (npc && functions.trader && capabilities.includes('trade')) {
      for (const spec of functions.trader.sells || []) {
        const template = context.itemTemplates.getTemplate({ ...scope, templateId: spec.templateId, templateVersion: spec.templateVersion });
        if (!template) continue;
        items.push({ key: `trade:buy:${spec.templateId}`, kind: 'trade', direction: 'buy',
          title: `买一份${template.name}`,
          description: `支付 ${spec.price} 邻币，物品放进背包。`,
          price: spec.price, templateId: spec.templateId, templateVersion: spec.templateVersion });
      }
    }
    if (capabilities.includes('service') && config.features.events) {
      // 特殊奇遇的主角就是当前这位镇民：奇遇由这名居民与玩家共同展开，不再邀请外来角色。
      // 入住角色（char: 目标）仍走角色奇遇管线，保留其人格卡与记忆收益。
      if (npc) {
        items.push({ key: `story:${npc.id}`, kind: 'story', npcId: npc.id,
          title: `与${npc.display_name}展开特殊奇遇`, description: `从${name}的${building ? '场景' : '服务与谈话'}出发，和${npc.display_name}一起经历一段小镇故事。` });
      } else if (!building && actor?.characterId) {
        const character = db.prepare('SELECT id,display_name FROM characters WHERE id=? AND events_disabled=0').get(actor.characterId);
        if (character) items.push({ key: `story:${character.id}`, kind: 'story', characterId: character.id,
          title: `与${character.display_name}展开特殊奇遇`, description: `从${name}的服务与谈话出发，在奇遇页选择行动并继续故事。` });
      }
    }
    return items;
  }
  function assertPresent() {
    if (building) {
      const me = getTownActorPosition(player.actorId);
      if (!me || me.moving || !me.locationKeys?.includes(location.key)) throw townError('NOT_ARRIVED');
      return;
    }
    const liveActor = registry.getActor(actor.actorId, scope.worldId);
    if (!liveActor?.participating || liveActor.archived || liveActor.mergedInto) throw townError('ACTOR_UNAVAILABLE');
  }
  function execute(input, spec, requestId) {
    const trade = context.npcFunctions.executeTrade(npc.id, { ...input, idempotencyKey: `interaction:${requestId}`,
      templateId: spec.templateId });
    return { kind: 'trade', ...trade };
  }
  const requests = createTownInteractionService({ db, clock: { now: Date.now }, registry, catalog, assertPresent, execute });
  return { context, input, actor, name, functions, catalog, requests, locationKey, capabilities, source };
}

export function getTownInteractions(target) {
  const value = runtime(target);
  const { context, input, actor, name, functions, requests, catalog } = value;
  // 中断进程不会永久锁住故事；生成中的请求最多占用二十分钟。
  // 不看 event_id：finish 未跑完就崩溃的请求（事件已落库）同样卡在 generating，一并放行。
  // 旧生成若在放行后才落库，beforePersist 的状态/updatedAt 校验会以 REQUEST_EXPIRED 拒绝。
  context.db.prepare("UPDATE town_interaction_offers SET status='offered' WHERE status='generating' AND updated_at<?")
    .run(Date.now() - 20 * 60000);
  // 镇民的活跃奇遇走 town_npc_events（id 加 town: 前缀进前端）；入住角色仍看 character_events。
  const activeStory = actor?.npcId
    ? context.db.prepare(`SELECT id,title,status FROM town_npc_events WHERE npc_id=? AND status IN ('open','engaged')
        ORDER BY id DESC LIMIT 1`).get(actor.npcId)
    : actor?.characterId && context.db.prepare(`SELECT id,title,status FROM character_events WHERE character_id=?
        AND status IN ('open','engaged') ORDER BY id DESC LIMIT 1`).get(actor.characterId);
  if (activeStory && actor?.npcId) activeStory.id = townNpcEventRef(activeStory.id);
  // 已接受的奇遇回执只在对应事件仍存在、仍属该居民、仍在进行中时才下发；
  // 旧时代遗留或已收尾/已删除的回执不能再渲染成「继续这段奇遇」。
  const liveRequests = requests.list(input).filter(row => {
    if (row.status !== 'accepted') return true;
    const result = row.result || {};
    // 旧步骤机时代的纯服务收执（没有事件）直接作废。
    if (result.kind === 'service' && row.eventId == null && result.eventId == null) return false;
    if (result.kind !== 'story') return true;
    const ref = String(result.eventId ?? row.eventId ?? '');
    if (!ref) return false;
    const isTownEvent = result.npcEvent != null ? !!result.npcEvent : ref.startsWith('town:');
    const id = Number(ref.startsWith('town:') ? ref.slice(5) : ref);
    if (!Number.isSafeInteger(id)) return false;
    return isTownEvent
      ? !!context.db.prepare("SELECT 1 FROM town_npc_events WHERE id=? AND npc_id=? AND status IN ('open','engaged')")
        .get(id, actor?.npcId ?? -1)
      : !!context.db.prepare("SELECT 1 FROM character_events WHERE id=? AND character_id=? AND status IN ('open','engaged')")
        .get(id, actor?.characterId ?? -1);
  });
  return { ...input, npcId: actor?.npcId, name, functions, capabilities: value.capabilities,
    storyHint: !config.features.events ? '奇遇功能暂未开启。' : '',
    serviceHint: !value.locationKey && /理发|按摩|护理|裁缝|服装/.test(String(functions.dialogue?.job || ''))
      ? '这位居民的店铺还在筹备，建筑与岗位到齐后会自动开张。' : '',
    catalog: catalog(), requests: liveRequests, activeStory: activeStory || null };
}

export function offerTownInteraction(target, key, expected) {
  const { requests, input } = runtime(target, expected);
  return requests.offer(input, key);
}

export function getTownTargetTrade(target) {
  const value = runtime(target);
  if (!value.capabilities.includes('trade')) throw townError('NOT_A_TRADER');
  const npcId = value.source.npc?.id;
  const catalog = npcId ? value.context.npcFunctions.tradeCatalog(npcId, value.input) : { sells: [] };
  return { ...catalog, displayName: value.name, locationKey: value.locationKey,
    purchases: value.catalog().filter(item => item.kind === 'service' && item.capability === 'trade') };
}

export function executeTownTargetTrade(target, command) {
  const value = runtime(target, command);
  if (!value.source.npc) throw townError('NOT_A_TRADER');
  // Only the resolved source is forwarded. Client-supplied provider, price and permissions are ignored.
  const result = value.context.npcFunctions.executeTrade(value.source.npc.id, { ...value.input,
    idempotencyKey: command.idempotencyKey, templateId: command.templateId });
  broadcastTownStateUpdated({ reason: 'npc_trade' });
  return result;
}

export async function respondTownInteraction(target, requestId, decision, expected, { generateStory, generateNpcStory } = {}) {
  const { context, requests, input, name, actor, source } = runtime(target, expected);
  const result = requests.respond(input, requestId, decision);
  if (!result.startGeneration) {
    broadcastTownStateUpdated({ reason: 'interaction_changed' });
    return result;
  }
  const db = context.db;
  try {
    if (result.npcId) return await startTownNpcStory({ context, requests, input, target, requestId, result, name, actor, source,
      npcId: result.npcId, generateNpcStory });
    const character = db.prepare('SELECT * FROM characters WHERE id=? AND events_disabled=0').get(result.characterId);
    if (!config.features.events || !character) throw townError('REQUEST_UNAVAILABLE');
    const existing = db.prepare(`SELECT id,title FROM character_events WHERE character_id=? AND status IN ('pending','open','engaged') LIMIT 1`).get(character.id);
    if (existing) return requests.finish(input, requestId, { kind: 'story', eventId: existing.id }, existing.id);
    const spot = source.location?.key || getTownActorPosition(actor?.actorId)?.locationKeys?.[0];
    const location = spot && db.prepare('SELECT name FROM town_locations WHERE key=?').get(spot);
    const recent = db.prepare(`SELECT spec_json FROM town_interaction_offers WHERE world_id=? AND world_epoch=? AND actor_id=?
      AND player_actor_id=? AND status='accepted' AND kind IN ('trade','service') ORDER BY updated_at DESC LIMIT 2`)
      .all(input.worldId, input.worldEpoch, input.actorId, input.playerActorId).map(row => JSON.parse(row.spec_json).title);
    const serviceTask = result.kind === 'service' && result.title
      ? `玩家正在${name}这里想办理「${result.title}」${result.price != null ? `（标价 ${result.price} 邻币）` : ''}：${result.description}由办理这件事的过程`
      : '由这个线索';
    const prompt = `起点是小镇的${location?.name || '街边'}。玩家${source.building ? `正在${name}体验服务与探索` : `正在与居民${name}交谈并了解对方的服务`}，遇到了关于${character.display_name}的线索。
${serviceTask}展开一段适合玩家参与的生活奇遇，保持${character.display_name}原有人格。角色可以作为来访者到场，不要声称角色已经搬入小镇或改变了工作岗位。${recent.length ? `最近发生过的真实来往：${recent.join('、')}。` : ''}
可以邀请一起探索、求助或交谈。不要声称已扣邻币、增加物品或完成小镇任务。`;
    const generate = generateStory || (await import('../eventGenerator.js')).generateEvent;
    await generate(character, { customPrompt: prompt, manual: true,
      beforePersist: () => {
        requests.check(input);
        if (!config.features.events) throw townError('REQUEST_UNAVAILABLE');
        if (!db.prepare('SELECT 1 FROM characters WHERE id=? AND events_disabled=0').get(character.id)) throw townError('REQUEST_UNAVAILABLE');
        const current = resolveTownInteractionTarget(context, target);
        if (!current.capabilities.includes('service') || current.input.actorId !== input.actorId) throw townError('REQUEST_UNAVAILABLE');
        const pending = requests.get(requestId);
        if (pending?.status !== 'generating' || pending.updatedAt !== result.updatedAt) throw townError('REQUEST_EXPIRED');
      },
      afterPersist: eventId => requests.finish(input, requestId, { kind: 'story', eventId,
        locationKey: spot || null, sourceName: name }, eventId),
    });
    return requests.get(requestId);
  } catch (error) {
    db.prepare("UPDATE town_interaction_offers SET status='offered',updated_at=? WHERE request_id=? AND status='generating' AND updated_at=?")
      .run(Date.now(), requestId, result.updatedAt);
    throw error;
  }
}

/** 镇民特殊奇遇：主角就是当前 NPC，生成结果进 town_npc_events（前端以 town:{id} 引用）。 */
async function startTownNpcStory({ context, requests, input, target, requestId, result, name, actor, source, npcId, generateNpcStory }) {
  const db = context.db;
  try {
    const npc = db.prepare('SELECT * FROM town_npcs WHERE id=? AND town_enabled=1').get(npcId);
    if (!config.features.events || !npc) throw townError('REQUEST_UNAVAILABLE');
    const existing = db.prepare(`SELECT id,title FROM town_npc_events WHERE npc_id=? AND status IN ('open','engaged') LIMIT 1`).get(npc.id);
    if (existing) return requests.finish(input, requestId,
      { kind: 'story', eventId: townNpcEventRef(existing.id), npcEvent: true }, existing.id);
    const spot = source.location?.key || getTownActorPosition(actor?.actorId)?.locationKeys?.[0];
    const location = spot && db.prepare('SELECT name,ambient FROM town_locations WHERE key=?').get(spot);
    const recent = db.prepare(`SELECT spec_json FROM town_interaction_offers WHERE world_id=? AND world_epoch=? AND actor_id=?
      AND player_actor_id=? AND status='accepted' AND kind IN ('trade','service') ORDER BY updated_at DESC LIMIT 2`)
      .all(input.worldId, input.worldEpoch, input.actorId, input.playerActorId).map(row => JSON.parse(row.spec_json).title);
    // 服务邀请（店里能办什么）与特殊奇遇共用这条管线：服务只是奇遇的起点线索，
    // 故事里不得声称已扣款或已交付物品。
    const serviceTask = result.kind === 'service' && result.title
      ? `玩家想在小店办理「${result.title}」${result.price != null ? `（标价 ${result.price} 邻币）` : ''}：${result.description}请围绕两人一起办理这件事的过程`
      : '请从两人当下的交谈与现场出发，';
    const prompt = `起点是小镇的${location?.name || '街边'}${location?.ambient ? `（${location.ambient}）` : ''}。玩家${source.building ? `正在${name}体验服务与探索` : `正在与镇民${name}交谈并了解对方的服务`}。
${serviceTask}展开一段玩家和${npc.display_name}一起经历、一起行动的生活奇遇：${npc.display_name}是这段奇遇的主角之一，玩家也是参与者，两人的行动共同推进故事。${recent.length ? `最近发生过的真实来往：${recent.join('、')}。` : ''}
保持${npc.display_name}原有人格与小镇岗位职责。不要声称已扣邻币、增加物品或完成小镇任务。`;
    const generate = generateNpcStory || ((npcArg, opts) =>
      import('./townNpcEventGenerator.js').then(module => module.generateTownNpcEvent(npcArg, opts)));
    await generate(npc, {
      customPrompt: prompt, manual: true,
      worldId: input.worldId, worldEpoch: input.worldEpoch, locationKey: spot || null,
      beforePersist: () => {
        requests.check(input);
        if (!config.features.events) throw townError('REQUEST_UNAVAILABLE');
        const currentNpc = db.prepare('SELECT 1 FROM town_npcs WHERE id=? AND town_enabled=1').get(npc.id);
        if (!currentNpc) throw townError('REQUEST_UNAVAILABLE');
        const current = resolveTownInteractionTarget(context, target);
        if (!current.capabilities.includes('service') || current.input.actorId !== input.actorId) throw townError('REQUEST_UNAVAILABLE');
        const pending = requests.get(requestId);
        if (pending?.status !== 'generating' || pending.updatedAt !== result.updatedAt) throw townError('REQUEST_EXPIRED');
      },
      afterPersist: eventId => requests.finish(input, requestId, { kind: 'story', eventId: townNpcEventRef(eventId),
        npcEvent: true, locationKey: spot || null, sourceName: name }, eventId),
    });
    return requests.get(requestId);
  } catch (error) {
    db.prepare("UPDATE town_interaction_offers SET status='offered',updated_at=? WHERE request_id=? AND status='generating' AND updated_at=?")
      .run(Date.now(), requestId, result.updatedAt);
    throw error;
  }
}

export function townStoryOrigins(db) {
  const rows = db.prepare(`SELECT r.event_id,r.world_id,r.world_epoch,r.result_json FROM town_interaction_offers r
    WHERE r.kind IN ('story','service') AND r.status='accepted' AND r.event_id IS NOT NULL ORDER BY r.created_at`).all();
  const origins = new Map();
  for (const row of rows) {
    const result = JSON.parse(row.result_json || '{}');
    if (result.sourceName) origins.set(row.event_id, { worldId: row.world_id, worldEpoch: row.world_epoch,
      locationKey: result.locationKey, sourceName: result.sourceName });
  }
  return origins;
}
