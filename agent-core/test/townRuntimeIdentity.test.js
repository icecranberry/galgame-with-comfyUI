import { test } from 'node:test';
import assert from 'node:assert/strict';

// Set before loading config/db. No production database or network can be used.
process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => {
  // comfyClient eagerly warms a read-only schema cache at import time.
  if (String(url).endsWith('/object_info')) return { ok: true, json: async () => ({}) };
  throw new Error('Network forbidden in town identity fixture');
};
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const npcs = await import('../src/services/town/townNpcService.js');
const { saveMap } = await import('../src/services/town/townMapService.js');
const { createTownActorRegistry } = await import('../src/services/town/townActorRegistry.js');

test('真实服务：邀请/启停/重载只出现一个actor，重建保留身份并递增epoch', async t => {
  assert.equal(config.dbPath, ':memory:');
  config.features.town = true;
  config.features.townLLM = false;
  t.after(() => { town.stopTownScheduler(); closeDb(); });
  const db = getDb();
  const registry = createTownActorRegistry(db);
  const world = registry.getWorldState();
  const grid = () => Array.from({ length: 4 }, () => Array(4).fill(null));
  const saved = saveMap({ name: 'fixture', cols: 4, rows: 4,
    layers: { ground: grid(), road: grid(), objects: [] },
    locations: [{ key: 'fixture_home', name: '住处', kind: 'home', x: 1, y: 1 }] });
  const npc = npcs.createNpc({ mapId: saved.mapId, displayName: '身份测试居民', persona: '你是身份测试居民。' });
  town.startTownScheduler();
  const initial = town.getTownState();
  const original = initial.agents.find(a => a.npcId === npc.id);
  assert.equal(original.agentKey, `npc:${npc.id}`);
  assert.ok(original.actorId);
  assert.equal(initial.worldId, world.worldId);
  config.features.townLLM = false;
  const greeting = await npcs.chatWithNpc(npc.id, '早上好');
  assert.equal(greeting.source, 'template');
  assert.equal(npcs.getNpcChatHistory(npc.id).length, 2);
  const invited = await npcs.inviteNpcAsCharacter(npc.id);
  const twice = await npcs.inviteNpcAsCharacter(npc.id);
  assert.equal(twice.already, true);
  assert.equal(invited.characterId, twice.characterId);
  assert.equal(invited.actorId, original.actorId);
  let related = town.getTownState().agents.filter(a => a.actorId === original.actorId);
  assert.equal(related.length, 1);
  assert.equal(related[0].agentKey, `char:${invited.characterId}`);
  assert.equal(related[0].npcId, npc.id);
  await assert.rejects(() => npcs.chatWithNpc(npc.id, '不要分叉历史'), /角色对话/);
  town.setTownCharacterEnabled(invited.characterId, { townEnabled: false });
  assert.equal(town.getTownState().agents.some(a => a.actorId === original.actorId), false);
  town.setTownCharacterEnabled(invited.characterId, { townEnabled: true });
  town.reloadTown();
  related = town.getTownState().agents.filter(a => a.actorId === original.actorId);
  assert.equal(related.length, 1);
  const result = town.resetWorld();
  assert.equal(result.worldId, world.worldId);
  assert.equal(result.worldEpoch, world.epoch + 1);
  assert.equal(town.getTownState().player, null);
  assert.equal(town.getTownState().agents.length, 0);
  assert.equal(registry.getActor(original.actorId).actorId, original.actorId);
  assert.equal(registry.getActor(original.actorId).participating, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM characters WHERE id = ?').get(invited.characterId).n, 1);
});
