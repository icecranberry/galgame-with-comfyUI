import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => {
  if (String(url).endsWith('/object_info')) return { ok: true, json: async () => ({}) };
  throw new Error('Network forbidden in venue runtime fixture');
};
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const { createNpc } = await import('../src/services/town/townNpcService.js');
const { saveMap } = await import('../src/services/town/townMapService.js');
const runtime = await import('../src/services/town/townEconomyRuntime.js');

test('真实运行层：酒馆/裁缝铺走注册表接入，咖啡馆仍走冻结视图且不重复出现在通用 venue 列表', async t => {
  let now = Date.parse('2026-09-08T10:00:00+08:00');
  t.mock.method(Date, 'now', () => now);
  const db = getDb(); assert.equal(config.dbPath, ':memory:');
  config.features.town = true; config.features.townLLM = false;
  config.town.simulation = 'legacy'; config.town.economyEnabled = false;
  config.town.playerSpeed = 1; config.town.npcSpeed = 1; config.town.maxActiveEncounters = 0;
  t.after(() => { town.stopTownScheduler(); closeDb(); });
  const grid = () => Array.from({ length: 8 }, () => Array(8).fill(null));
  const { mapId } = saveMap({ name: '功能建筑隔离', cols: 8, rows: 8,
    layers: { ground: grid(), road: grid(), objects: [] }, locations: [
      { key: 'board', name: '公告站', x: 0, y: 0, radius: 0 },
      { key: 'supplier', name: '原料点', x: 6, y: 0, radius: 0 },
      { key: 'workshop', name: '工坊', x: 6, y: 6, radius: 0 },
      { key: 'cafe', name: '咖啡馆', x: 2, y: 6, radius: 0 },
      { key: 'tavern', name: '酒馆', x: 0, y: 4, radius: 0 },
      { key: 'clothing_shop', name: '裁缝铺', x: 4, y: 4, radius: 0 },
      { key: 'inn', name: '客栈', x: 2, y: 2, radius: 0 },
      { key: 'study', name: '书斋', x: 4, y: 2, radius: 0 },
    ] });
  for (const name of ['公告员', '备料员', '工坊师傅', '咖啡师', '酒馆掌柜', '裁缝', '客栈掌柜', '书斋先生']) createNpc({ mapId, displayName: name });
  db.prepare("INSERT INTO town_players(id,display_name,grid_x,grid_y) VALUES('me','玩家',0,0)").run();
  town.startTownScheduler();
  const state = runtime.getTownEconomyState(), worldEpoch = state.worldEpoch;
  const command = idempotencyKey => ({ worldEpoch, idempotencyKey });
  const names = ['公告员', '备料员', '工坊师傅', '咖啡师', '酒馆掌柜', '裁缝', '客栈掌柜', '书斋先生'];
  const actors = names.map(name => state.participants.find(a => a.displayName === name).actorId);
  runtime.setupTownEconomy({ ...command('setup'), npcActorIds: { commissioner: actors[0], supplier: actors[1],
    workshop: actors[2], cafe: actors[3], tavern: actors[4], clothing_shop: actors[5],
    inn: actors[6], study: actors[7] },
  locationKeys: { board: 'board', supplier: 'supplier', workshop: 'workshop', cafe: 'cafe',
    tavern: 'tavern', clothing_shop: 'clothing_shop', inn: 'inn', study: 'study' } });
  const overview = () => runtime.getTownEconomyState();
  // 咖啡馆仍由冻结视图提供；通用 venue 视图只列注册表里的新建筑，避免重复面板。
  assert.ok(overview().cafe, '咖啡馆必须保留独立视图');
  assert.deepEqual(overview().venues.map(item => item.businessKey).sort(), ['clothing_shop', 'inn', 'study', 'tavern']);
  const venue = businessKey => overview().venues.find(item => item.businessKey === businessKey);
  assert.deepEqual(venue('tavern').catalog.map(item => item.serviceKey).sort(),
    ['town.tavern.buy_meal', 'town.tavern.help_swap', 'town.tavern.shift']);
  assert.deepEqual(venue('clothing_shop').catalog.map(item => item.serviceKey).sort(), ['town.clothing.custom_order', 'town.clothing.shift']);
  assert.equal(venue('tavern').displayName, '镇口酒馆');
  assert.equal(venue('clothing_shop').resourceLabel, '布料');
  // 开张向导列出注册表里的全部建筑：新增建筑只改 townVenuePlaybooks.js。
  assert.deepEqual(overview().venueKinds.map(kind => kind.businessKey), ['tavern', 'clothing_shop', 'inn', 'study']);
  assert.deepEqual(venue('inn').catalog.map(item => item.serviceKey).sort(), ['town.inn.shift', 'town.inn.stay']);
  assert.deepEqual(venue('study').catalog.map(item => item.serviceKey).sort(), ['town.study.lesson', 'town.study.shift']);
  assert.equal(venue('inn').resourceLabel, '铺盖');
  assert.equal(venue('study').resourceLabel, '纸墨');
  const tick = () => { now += 60000; town.forceTick(); runtime.maintainTownOrders(); };
  const openVenue = businessKey => {
    for (let i = 0; i < 240 && venue(businessKey).open !== true; i++) tick();
    assert.equal(venue(businessKey).open, true, `${businessKey} 必须在真实模拟里开门`);
  };
  const walk = (x, y) => { assert.equal(town.movePlayerTo(x, y).ok, true); now += 12000; town.getTownState(); };
  walk(0, 4); openVenue('tavern');
  // 1) 当班：店方托管工资，完成只发钱、不发道具。
  const shift = await runtime.executeTownService('offer', null, { ...command('tavern-shift-offer'), serviceKey: 'town.tavern.shift' });
  assert.equal(shift.payer, 'venue'); assert.equal(shift.template.wage, 26); assert.equal(shift.template.price, 0);
  let value = await runtime.executeTownService('accept', shift.sessionId, { ...command('tavern-shift-accept'), expectedVersion: shift.version });
  assert.equal(value.status, 'active'); assert.equal(value.phaseKey, 'prep');
  assert.deepEqual(value.choices, ['work', 'cancel']);
  value = await runtime.executeTownService('turn', value.sessionId, { ...command('tavern-shift-work'), expectedVersion: value.version, intentKey: 'work' });
  assert.equal(value.phaseKey, 'finish'); assert.deepEqual(value.choices, ['serve', 'clarify', 'cancel']);
  value = await runtime.executeTownService('turn', value.sessionId, { ...command('tavern-shift-serve'), expectedVersion: value.version, intentKey: 'serve' });
  assert.equal(value.status, 'completed');
  assert.equal(value.settlement.payout, 26); assert.equal(value.settlement.itemIds.length, 0);
  assert.equal(runtime.getTownWallet().balance, 26);
  // 2) 以工换物：不付工钱，换成一份店里的热食道具。
  const swap = await runtime.executeTownService('offer', null, { ...command('tavern-swap-offer'), serviceKey: 'town.tavern.help_swap' });
  assert.equal(swap.template.wage, 0); assert.equal(swap.template.price, 0);
  value = await runtime.executeTownService('accept', swap.sessionId, { ...command('tavern-swap-accept'), expectedVersion: swap.version });
  value = await runtime.executeTownService('turn', value.sessionId, { ...command('tavern-swap-work'), expectedVersion: value.version, intentKey: 'work' });
  value = await runtime.executeTownService('turn', value.sessionId, { ...command('tavern-swap-serve'), expectedVersion: value.version, intentKey: 'serve' });
  assert.equal(value.status, 'completed'); assert.equal(value.settlement.payout, 0);
  assert.equal(runtime.getTownWallet().balance, 26);
  const meal = db.prepare('SELECT * FROM backpack_items WHERE id=?').get(value.settlement.itemIds[0]);
  assert.equal(meal.template_id, 'town.tavern_meal'); assert.equal(meal.effect_key, 'tipsy');
  // 再顶两班攒够定做的钱：走真实工资路径，不直接改钱包。
  for (const index of [2, 3]) {
    const extra = await runtime.executeTownService('offer', null, { ...command(`tavern-shift-offer-${index}`), serviceKey: 'town.tavern.shift' });
    let extraValue = await runtime.executeTownService('accept', extra.sessionId, { ...command(`tavern-shift-accept-${index}`), expectedVersion: extra.version });
    extraValue = await runtime.executeTownService('turn', extraValue.sessionId, { ...command(`tavern-shift-work-${index}`), expectedVersion: extraValue.version, intentKey: 'work' });
    extraValue = await runtime.executeTownService('turn', extraValue.sessionId, { ...command(`tavern-shift-serve-${index}`), expectedVersion: extraValue.version, intentKey: 'serve' });
    assert.equal(extraValue.status, 'completed'); assert.equal(extraValue.settlement.payout, 26);
  }
  assert.equal(runtime.getTownWallet().balance, 78);
  // 工坊生产队列只认工坊付费服务：完成过的酒馆会话不得让 tick 抛 PAID_SERVICE_REQUIRED。
  for (let i = 0; i < 240 && overview().service.open !== true; i++) tick();
  assert.equal(overview().service.open, true);
  runtime.maintainTownOrders();
  // 3) 定做：玩家付费、两阶段，成品进背包。
  walk(4, 4); openVenue('clothing_shop');
  const orderPiece = async index => {
    const made = await runtime.executeTownService('offer', null, { ...command(`cloth-offer-${index}`), serviceKey: 'town.clothing.custom_order' });
    assert.equal(made.payer, 'player'); assert.equal(made.template.price, 22);
    let order = await runtime.executeTownService('accept', made.sessionId, { ...command(`cloth-accept-${index}`), expectedVersion: made.version });
    assert.equal(order.phaseKey, 'brief'); assert.deepEqual(order.choices, ['choose_style', 'cancel']);
    order = await runtime.executeTownService('turn', order.sessionId, { ...command(`cloth-style-${index}`), expectedVersion: order.version, intentKey: 'choose_style' });
    assert.equal(order.phaseKey, 'make'); assert.deepEqual(order.choices, ['craft', 'clarify', 'cancel']);
    order = await runtime.executeTownService('turn', order.sessionId, { ...command(`cloth-craft-${index}`), expectedVersion: order.version, intentKey: 'craft' });
    assert.equal(order.status, 'completed');
    assert.equal(order.settlement.paid, 22); assert.equal(order.settlement.refund, 0);
    return order;
  };
  const firstPiece = await orderPiece(1);
  assert.equal(runtime.getTownWallet().balance, 56);
  const piece = db.prepare('SELECT * FROM backpack_items WHERE id=?').get(firstPiece.settlement.itemIds[0]);
  assert.equal(piece.template_id, 'town.clothing_piece'); assert.equal(piece.effect_key, 'yukata');
  assert.equal(venue('clothing_shop').regular.visits, 1);
  assert.equal(venue('clothing_shop').regular.tier, 0);
  await orderPiece(2);
  const thirdPiece = await orderPiece(3);
  const regular = venue('clothing_shop').regular;
  assert.equal(regular.visits, 3); assert.equal(regular.tier, 1);
  assert.equal(regular.nextTierAt, 6); assert.match(regular.topic, /^熟客专属：/);
  assert.equal(runtime.getTownWallet().balance, 12);
  // 熟客事件由既有经历消费者写成记忆：玩家与店主各一条，不再发钱发道具。
  runtime.maintainTownOrders();
  const memories = db.prepare("SELECT * FROM town_experiences WHERE event_id LIKE 'venue-regular:%'").all();
  assert.equal(memories.length, 2);
  assert.ok(memories.every(row => row.summary.includes('熟客')));
  // 会话读取按 serviceKey 路由回同一个通用引擎。
  assert.equal(runtime.getTownService(thirdPiece.sessionId).businessKey, 'clothing_shop');
  assert.equal(venue('tavern').stock.available, 4);
  assert.equal(venue('clothing_shop').stock.available, 5);
  // 4) 客栈：先用同一注册表的帮工挣房钱，再用投宿玩法歇一晚，退房带走醒神茶。
  walk(2, 2); openVenue('inn');
  for (const index of [1, 2]) {
    const shiftOffer = await runtime.executeTownService('offer', null, { ...command(`inn-shift-offer-${index}`), serviceKey: 'town.inn.shift' });
    let shiftValue = await runtime.executeTownService('accept', shiftOffer.sessionId, { ...command(`inn-shift-accept-${index}`), expectedVersion: shiftOffer.version });
    assert.equal(shiftValue.phaseKey, 'prep');
    shiftValue = await runtime.executeTownService('turn', shiftValue.sessionId, { ...command(`inn-shift-work-${index}`), expectedVersion: shiftValue.version, intentKey: 'work' });
    shiftValue = await runtime.executeTownService('turn', shiftValue.sessionId, { ...command(`inn-shift-serve-${index}`), expectedVersion: shiftValue.version, intentKey: 'serve' });
    assert.equal(shiftValue.status, 'completed'); assert.equal(shiftValue.settlement.payout, 24);
  }
  assert.equal(runtime.getTownWallet().balance, 60);
  const stay = await runtime.executeTownService('offer', null, { ...command('inn-stay-offer'), serviceKey: 'town.inn.stay' });
  assert.equal(stay.payer, 'player'); assert.equal(stay.template.price, 16); assert.equal(stay.template.wage, 0);
  let stayValue = await runtime.executeTownService('accept', stay.sessionId, { ...command('inn-stay-accept'), expectedVersion: stay.version });
  assert.equal(stayValue.phaseKey, 'checkin'); assert.deepEqual(stayValue.choices, ['settle_in', 'cancel']);
  stayValue = await runtime.executeTownService('turn', stayValue.sessionId, { ...command('inn-settle-in'), expectedVersion: stayValue.version, intentKey: 'settle_in' });
  assert.equal(stayValue.phaseKey, 'resting'); assert.deepEqual(stayValue.choices, ['rest_up', 'clarify', 'cancel']);
  stayValue = await runtime.executeTownService('turn', stayValue.sessionId, { ...command('inn-rest-up'), expectedVersion: stayValue.version, intentKey: 'rest_up' });
  assert.equal(stayValue.status, 'completed');
  assert.equal(stayValue.settlement.paid, 16); assert.equal(stayValue.settlement.payout, 16); assert.equal(stayValue.settlement.refund, 0);
  const tea = db.prepare('SELECT * FROM backpack_items WHERE id=?').get(stayValue.settlement.itemIds[0]);
  assert.equal(tea.template_id, 'town.inn_tea'); assert.equal(tea.effect_key, 'energy');
  assert.equal(runtime.getTownWallet().balance, 44);
  assert.equal(venue('inn').regular.visits, 1);
  assert.equal(venue('inn').regular.tier, 0);
  // 5) 书斋：先说想学什么，再跟着先生做一遍，手作就带走了。
  walk(4, 2); openVenue('study');
  const lesson = await runtime.executeTownService('offer', null, { ...command('study-lesson-offer'), serviceKey: 'town.study.lesson' });
  assert.equal(lesson.payer, 'player'); assert.equal(lesson.template.price, 14);
  let lessonValue = await runtime.executeTownService('accept', lesson.sessionId, { ...command('study-lesson-accept'), expectedVersion: lesson.version });
  assert.equal(lessonValue.phaseKey, 'ask'); assert.deepEqual(lessonValue.choices, ['ask_lesson', 'cancel']);
  lessonValue = await runtime.executeTownService('turn', lessonValue.sessionId, { ...command('study-ask-lesson'), expectedVersion: lessonValue.version, intentKey: 'ask_lesson' });
  assert.equal(lessonValue.phaseKey, 'practice'); assert.deepEqual(lessonValue.choices, ['take_lesson', 'clarify', 'cancel']);
  lessonValue = await runtime.executeTownService('turn', lessonValue.sessionId, { ...command('study-take-lesson'), expectedVersion: lessonValue.version, intentKey: 'take_lesson' });
  assert.equal(lessonValue.status, 'completed');
  assert.equal(lessonValue.settlement.paid, 14); assert.equal(lessonValue.settlement.refund, 0);
  const note = db.prepare('SELECT * FROM backpack_items WHERE id=?').get(lessonValue.settlement.itemIds[0]);
  assert.equal(note.template_id, 'town.study_note'); assert.equal(note.effect_key, 'mood_fix');
  assert.equal(runtime.getTownWallet().balance, 30);
  assert.equal(runtime.getTownService(lessonValue.sessionId).businessKey, 'study');
  assert.equal(venue('study').stock.available, 7);
});
