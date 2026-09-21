import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw Error(`character profile fixture forbids network: ${url}`); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const { listNpcs } = await import('../src/services/town/townNpcService.js');
const { listOfferOverview } = await import('../src/services/town/townNpcOfferService.js');

config.dbPath = ':memory:';

function seed(t) {
  const db = getDb();
  t.after(() => closeDb());
  db.prepare(`INSERT INTO town_maps (name, grid_cols, grid_rows) VALUES ('m', 10, 10)`).run();
  // 酒馆直接创建的角色：没有任何居民档案
  db.prepare(`INSERT INTO characters (name, display_name, base_prompt, short_prompt)
    VALUES ('solo', '独行客', '一位路过的旅人', '独行')`).run();
  const soloId = db.prepare('SELECT max(id) id FROM characters').get().id;
  return { db, soloId };
}

test('入住的酒馆角色可以建托管档案：字段口径正确、幂等、不进居民名单', async t => {
  const { db, soloId } = seed(t);
  town.setTownCharacterCapabilities(soloId, ['service', 'work']);

  // 还没入住：不给建
  const refused = await town.ensureCharacterNpcProfile(soloId);
  assert.equal(refused.ok, false);
  assert.equal(db.prepare('SELECT count(*) n FROM town_npcs WHERE character_id = ?').get(soloId).n, 0);

  // 入住后：先以「待建档案」出现在服务管理名单里
  town.setTownCharacterEnabled(soloId, { townEnabled: true });
  const pending = listOfferOverview().find(item => item.characterId === soloId);
  assert.equal(pending.pendingProfile, true);
  assert.equal(pending.npcId, null);
  assert.deepEqual(pending.capabilities, ['service', 'work']);

  const created = await town.ensureCharacterNpcProfile(soloId);
  assert.equal(created.ok, true);
  assert.equal(created.created, true);
  const row = db.prepare('SELECT * FROM town_npcs WHERE id = ?').get(created.npcId);
  assert.equal(row.character_id, soloId);
  assert.equal(row.character_managed, 1);
  assert.equal(row.moments_disabled, 1, '托管档案不走镇民朋友圈');
  assert.equal(row.job, '');
  assert.equal(row.workplace_key, null);
  assert.deepEqual(JSON.parse(row.capabilities_json), ['service', 'work']);

  // 幂等：重复调用不再建新行
  const again = await town.ensureCharacterNpcProfile(soloId);
  assert.equal(again.created, false);
  assert.equal(again.npcId, created.npcId);
  assert.equal(db.prepare('SELECT count(*) n FROM town_npcs WHERE character_id = ?').get(soloId).n, 1);

  // 不进居民名单；服务管理里也不再是「待建档案」
  assert.equal(listNpcs().some(npc => npc.id === created.npcId), false);
  const ready = listOfferOverview().find(item => item.characterId === soloId);
  assert.equal(ready.npcId, created.npcId);
  assert.equal(ready.pendingProfile, undefined);
  assert.equal(ready.source, 'character');
});

test('角色删除后托管档案一并清理，普通居民档案不受影响', async t => {
  const { db, soloId } = seed(t);
  db.prepare(`INSERT INTO town_npcs (map_id, display_name, job, town_enabled) VALUES (1, '面包师', '面包师', 1)`).run();
  const plainNpcId = db.prepare('SELECT max(id) id FROM town_npcs').get().id;

  town.setTownCharacterCapabilities(soloId, ['service']);
  town.setTownCharacterEnabled(soloId, { townEnabled: true });
  const created = await town.ensureCharacterNpcProfile(soloId);
  assert.equal(created.created, true);

  assert.equal(town.removeCharacterNpcProfile(soloId), 1);
  assert.equal(db.prepare('SELECT count(*) n FROM town_npcs WHERE id = ?').get(created.npcId).n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM town_npcs WHERE id = ?').get(plainNpcId).n, 1, '普通居民不受影响');
  assert.equal(town.removeCharacterNpcProfile(soloId), 0);
});