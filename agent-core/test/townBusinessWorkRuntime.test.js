import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => {
  if (String(url).endsWith('/object_info')) return { ok: true, json: async () => ({}) };
  throw new Error('Network forbidden in delivery fixture');
};
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const { createNpc } = await import('../src/services/town/townNpcService.js');
const { saveMap } = await import('../src/services/town/townMapService.js');
const economy = await import('../src/services/town/townEconomyRuntime.js');

test('真实营业：兼容模式也按岗位行走，到达最后一步且在营业时间才开门', t => {
  let now = Date.parse('2026-09-08T10:00:00+08:00');
  t.mock.method(Date, 'now', () => now);
  const db = getDb();
  config.features.town = true; config.features.townLLM = false;
  config.town.simulation = 'legacy'; config.town.economyEnabled = false;
  config.town.npcSpeed = 1; config.town.maxActiveEncounters = 0;
  t.after(() => { town.stopTownScheduler(); closeDb(); });
  const grid = () => Array.from({ length: 8 }, () => Array(8).fill(null));
  const { mapId } = saveMap({ name: '营业fixture', cols: 8, rows: 8,
    layers: { ground: grid(), road: grid(), objects: [] }, locations: [
      { key: 'board', name: '公告站', x: 0, y: 0, radius: 0 },
      { key: 'supplier', name: '原料点', x: 6, y: 0, radius: 0 },
      { key: 'workshop', name: '工坊', x: 6, y: 6, radius: 0 },
    ] });
  for (const name of ['公告员', '备料员', '工坊师傅']) createNpc({ mapId, displayName: name });
  db.prepare("INSERT INTO town_players (id, display_name, grid_x, grid_y) VALUES ('me', '玩家', 0, 0)").run();
  town.startTownScheduler();
  const initial = economy.getTownEconomyState();
  const actors = Object.fromEntries(['公告员', '备料员', '工坊师傅'].map(name => [name, initial.participants.find(a => a.displayName === name).actorId]));
  economy.setupTownEconomy({ worldEpoch: initial.worldEpoch, idempotencyKey: 'setup',
    npcActorIds: { commissioner: actors['公告员'], supplier: actors['备料员'], workshop: actors['工坊师傅'] },
    locationKeys: { board: 'board', supplier: 'supplier', workshop: 'workshop' } });
  assert.equal(economy.getTownEconomyState().service.open, false);
  town.forceTick();
  const moving = town.getTownState().agents.find(a => a.actorId === actors['工坊师傅']);
  assert.ok(moving.path.length > 0);
  assert.equal(moving.activityText, '正在前往岗位');
  const arrival = moving.startedAt + moving.path.length / moving.speed * 1000;
  now = arrival - 1;
  assert.equal(economy.getTownEconomyState().service.open, false);
  now = arrival;
  assert.equal(economy.getTownEconomyState().service.open, true);
  town.forceTick();
  assert.equal(town.getTownState().agents.find(a => a.actorId === actors['工坊师傅']).activityText, '正在岗位上营业');
  now = Date.parse('2026-09-08T18:00:00+08:00');
  assert.equal(economy.getTownEconomyState().service.open, false);
  assert.equal(db.prepare('SELECT count(*) n FROM town_service_sessions').get().n, 0);
});
