import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const economy = await import('../src/services/town/townEconomyRuntime.js');
const interaction = await import('../src/services/town/townInteractionRuntime.js');
const { createNpc } = await import('../src/services/town/townNpcService.js');
const { saveMap } = await import('../src/services/town/townMapService.js');
const { reconcileTownResponsibilities } = await import('../src/services/town/townResponsibilityRuntime.js');

test('store leads, special stories and direct purchases share one interaction loop', async t => {
  let now = Date.parse('2026-09-08T10:00:00+08:00'), counter = 0;
  t.mock.method(Date, 'now', () => now);
  config.dbPath = ':memory:';
  const db = getDb();
  config.features.town = true; config.features.townLLM = false; config.features.events = true;
  Object.assign(config.town, { simulation: 'legacy', playerSpeed: 1, npcSpeed: 1, maxActiveEncounters: 0, timeZone: 'Asia/Shanghai' });
  t.after(() => { town.stopTownScheduler(); closeDb(); });
  const roles = ['commissioner', 'supplier', 'workshop', 'cafe', 'clothing_shop', 'salon', 'massage', 'tavern', 'neighbor'];
  const jobs = ['委托员', '供货员', '工坊师傅', '咖啡师', '裁缝', '理发师', '按摩师', '酒馆掌柜', '散步居民'];
  const places = roles.map((role, i) => ({ key: `place-${role}`, name: `${jobs[i]}的场所`, businessKind: role === 'neighbor' ? 'none' : role,
    x: (i % 3) * 5, y: Math.floor(i / 3) * 5, radius: 0 }));
  const grid = () => Array.from({ length: 14 }, () => Array(14).fill(null));
  const { mapId } = saveMap({ name: 'Interaction test town', cols: 14, rows: 14,
    layers: { ground: grid(), road: grid(), objects: [] }, locations: places });
  const ids = places.map((place, i) => {
    createNpc({ mapId, displayName: `居民${i}`, job: jobs[i], ...(i === 8 ? { capabilities: ['service', 'trade'] } : {}) });
    const id = db.prepare('SELECT max(id) id FROM town_npcs').get().id;
    db.prepare('UPDATE town_npcs SET routine_json=? WHERE id=?').run(JSON.stringify([
      { start: '00:00', end: '24:00', locationKey: place.key, activity: '固定岗位' },
    ]), id);
    db.prepare('INSERT INTO town_agent_state(agent_key,grid_x,grid_y,current_location_id) VALUES(?,?,?,(SELECT id FROM town_locations WHERE key=?))')
      .run(`npc:${id}`, place.x, place.y, place.key);
    return id;
  });
  db.prepare("INSERT INTO town_players(id,display_name,grid_x,grid_y) VALUES('me','玩家',0,0)").run();
  reconcileTownResponsibilities({ db, allowFallback: true });
  town.startTownScheduler();
  const { scope, player } = economy.getTownEconomyContext();
  const playerBalance = () => economy.getTownWallet().balance;
  const move = index => {
    const result = town.movePlayerTo(places[index].x, places[index].y);
    assert.equal(result.ok, true); now += result.pathLength * 1000 + 1;
    assert.equal(town.getTownActorPosition(player.actorId).moving, false);
  };
  // 服务线索：目录来自建筑种类，接受后与特殊奇遇共用叙事管线展开一段奇遇
  move(5);
  const target = `npc:${ids[5]}`;
  const resident = interaction.getTownInteractions(target);
  assert.equal(resident.functions.trader, undefined, 'a barber does not randomly become a general trader');
  const lead = resident.catalog.find(item => item.key === 'service:town.salon.bob_cut');
  assert.ok(lead, 'salon kind surfaces its service lead');
  assert.equal(lead.price, 15, 'the lead keeps its flavour price');
  const invite = interaction.offerTownInteraction(target, 'service:town.salon.bob_cut', scope);
  assert.equal(interaction.offerTownInteraction(target, 'service:town.salon.bob_cut', scope).requestId, invite.requestId);
  let servicePrompt = '';
  const accepted = await interaction.respondTownInteraction(target, invite.requestId, 'accept', scope, {
    generateNpcStory: async (npc, options) => db.transaction(() => {
      assert.equal(npc.id, ids[5], 'the service encounter is anchored to the resident being talked to');
      servicePrompt = options.customPrompt;
      options.beforePersist();
      const eventId = Number(db.prepare("INSERT INTO town_npc_events(npc_id,event_type_key,status,title,expires_at) VALUES(?,'town.custom','open','理发店的意外',?)")
        .run(npc.id, '2026-09-08 03:00:00').lastInsertRowid);
      options.afterPersist(eventId);
    }).immediate(),
  });
  assert.equal(accepted.status, 'accepted');
  assert.match(String(accepted.result.eventId), /^town:\d+$/, 'the service receipt points at the resident event via town: prefix');
  assert.ok(accepted.result?.npcEvent, 'the service receipt marks a resident encounter');
  assert.match(servicePrompt, /修剪发型/, 'the service itself seeds the encounter direction');
  assert.match(servicePrompt, /不要声称已扣邻币/, 'the story never claims the paid service settled');
  // 直购：货摊交易走账本，重复确认不重复扣款
  move(8);
  const neighbor = `npc:${ids[8]}`;
  const trade = interaction.offerTownInteraction(neighbor, 'trade:buy:town.mood_patch', scope);
  const beforeTrade = playerBalance();
  const receipt = await interaction.respondTownInteraction(neighbor, trade.requestId, 'accept', scope);
  assert.equal(receipt.status, 'accepted'); assert.equal(playerBalance(), beforeTrade - 15);
  assert.deepEqual(await interaction.respondTownInteraction(neighbor, trade.requestId, 'accept', scope), receipt);
  assert.equal(playerBalance(), beforeTrade - 15, 'replay returns a receipt without another payment');
  assert.equal(interaction.getTownInteractions(neighbor).requests[0].requestId, trade.requestId, 'reopening restores the request');
  assert.throws(() => interaction.offerTownInteraction(neighbor, 'trade:buy:invented', scope), { code: 'REQUEST_UNAVAILABLE' });
  // 特殊奇遇：主角就是当前这位镇民，事件落 town_npc_events，前端以 town:{id} 引用
  const story = interaction.offerTownInteraction(neighbor, `story:${ids[8]}`, scope);
  let release, generated = 0;
  const wait = new Promise(resolve => { release = resolve; });
  const generation = interaction.respondTownInteraction(neighbor, story.requestId, 'accept', scope, {
    generateNpcStory: async (npc, options) => {
      generated++; assert.match(options.customPrompt, /真实来往|最近发生过的真实来往/);
      assert.equal(npc.id, ids[8], 'the encounter protagonist is the resident being talked to');
      await wait;
      db.transaction(() => {
        options.beforePersist();
        const eventId = Number(db.prepare("INSERT INTO town_npc_events(npc_id,event_type_key,status,title,expires_at) VALUES(?,'town.custom','open','小镇传闻',?)")
          .run(npc.id, '2026-09-08 03:00:00').lastInsertRowid);
        options.afterPersist(eventId);
      }).immediate();
    },
  });
  const duplicate = await interaction.respondTownInteraction(neighbor, story.requestId, 'accept', scope);
  assert.equal(duplicate.status, 'generating'); assert.equal(generated, 1);
  release();
  const storyReceipt = await generation;
  assert.equal(storyReceipt.status, 'accepted');
  assert.match(String(storyReceipt.result.eventId), /^town:\d+$/, 'the receipt points at the resident event via town: prefix');
  assert.ok(storyReceipt.result?.npcEvent, 'the receipt marks a resident encounter');
  const storyRawId = Number(String(storyReceipt.result.eventId).slice(5));
  assert.equal(interaction.townStoryOrigins(db).get(storyRawId).sourceName, '居民8');
  assert.equal((await interaction.respondTownInteraction(neighbor, story.requestId, 'accept', scope)).eventId, storyReceipt.eventId);
  await assert.rejects(interaction.respondTownInteraction(neighbor, story.requestId, 'accept', { ...scope, worldEpoch: scope.worldEpoch + 1 }), { code: 'STALE_EPOCH' });
  // 能力门槛：纯交易居民没有个人奇遇；建筑奇遇跟着柜台后的居民走
  move(1);
  const merchant = `npc:${ids[1]}`;
  assert.deepEqual(interaction.getTownInteractions(merchant).capabilities, ['trade']);
  assert.ok(!interaction.getTownInteractions(merchant).catalog.some(item => item.kind === 'story'));
  assert.throws(() => interaction.offerTownInteraction(merchant, `story:${ids[1]}`, scope), { code: 'REQUEST_UNAVAILABLE' });
  move(5);
  const building = `location:${places[5].key}`;
  assert.throws(() => interaction.getTownTargetTrade(building), { code: 'NOT_A_TRADER' });
  assert.throws(() => interaction.getTownTargetTrade(target), { code: 'NOT_A_TRADER' });
  db.prepare("UPDATE town_npc_events SET status='completed' WHERE npc_id=?").run(ids[5]);
  db.prepare('UPDATE town_npcs SET capabilities_json=? WHERE id=?').run('["trade"]', ids[5]);
  assert.ok(!interaction.getTownInteractions(target).catalog.some(item => item.kind === 'story'),
    'a trade-only resident no longer offers a personal encounter');
  assert.ok(interaction.getTownInteractions(building).catalog.some(item => item.kind === 'story'),
    'building permission is independent from its employee');
  assert.ok(interaction.getTownInteractions(building).catalog.some(item => item.kind === 'service'),
    'service leads belong to the building, not the employee');
  const buildingOffer = interaction.offerTownInteraction(building, `story:${ids[5]}`, scope);
  await assert.rejects(interaction.respondTownInteraction(target, buildingOffer.requestId, 'accept', scope), { code: 'REQUEST_NOT_FOUND' });
  assert.ok(!interaction.getTownInteractions(target).requests.some(item => item.requestId === buildingOffer.requestId));
  db.prepare("UPDATE town_npc_events SET status='completed' WHERE id=?").run(storyRawId);
  assert.ok(!interaction.getTownInteractions(neighbor).requests.some(item => item.requestId === story.requestId),
    'a finished story receipt no longer renders as continue');
  const beforeEvents = db.prepare('SELECT count(*) n FROM town_npc_events').get().n;
  await assert.rejects(interaction.respondTownInteraction(building, buildingOffer.requestId, 'accept', scope, {
    generateNpcStory: async (_npc, options) => {
      db.prepare('UPDATE town_locations SET capabilities_json=? WHERE key=?').run('["trade"]', places[5].key);
      options.beforePersist();
      assert.fail('revoked service permission must never persist a generated event');
    },
  }), { code: 'REQUEST_UNAVAILABLE' });
  assert.equal(db.prepare('SELECT count(*) n FROM town_npc_events').get().n, beforeEvents);
  assert.equal(interaction.getTownInteractions(building).requests[0].status, 'offered');
  assert.throws(() => interaction.offerTownInteraction(building, `story:${ids[5]}`, scope), { code: 'REQUEST_UNAVAILABLE' });
  // Restoring the permission resumes the original invitation; it does not produce another request.
  db.prepare('UPDATE town_locations SET capabilities_json=? WHERE key=?').run('["service"]', places[5].key);
  const completed = await interaction.respondTownInteraction(building, buildingOffer.requestId, 'accept', scope, {
    generateNpcStory: async (npc, options) => db.transaction(() => {
      options.beforePersist();
      assert.equal(npc.id, ids[5], 'the building encounter is anchored to its resident');
      const eventId = Number(db.prepare("INSERT INTO town_npc_events(npc_id,event_type_key,status,title,expires_at) VALUES(?,'town.custom','open','店铺奇遇',?)")
        .run(npc.id, '2026-09-09 03:00:00').lastInsertRowid);
      options.afterPersist(eventId);
    }).immediate(),
  });
  assert.equal(completed.status, 'accepted');
  const completedRawId = Number(String(completed.result.eventId).slice(5));
  assert.equal(interaction.townStoryOrigins(db).get(completedRawId).locationKey, places[5].key);
  assert.equal(interaction.townStoryOrigins(db).get(completedRawId).sourceName, places[5].name);
  assert.ok(interaction.getTownInteractions(building).catalog.some(item => item.key === `story:${ids[5]}`),
    'the encounter keeps following the resident behind the counter');
  db.prepare('UPDATE town_npcs SET town_enabled=0 WHERE id=?').run(ids[5]);
  const { createTownActorRegistry } = await import('../src/services/town/townActorRegistry.js');
  createTownActorRegistry(db).synchronize();
  const unstaffed = interaction.getTownInteractions(building);
  assert.ok(!unstaffed.catalog.some(item => item.kind === 'story'), 'no resident, no encounter — stories are never delegated to outsiders');
  assert.ok(!unstaffed.catalog.some(item => item.kind === 'service'), 'service leads still require an available employee');
});
