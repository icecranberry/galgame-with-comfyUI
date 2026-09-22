import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw Error(`character capability fixture forbids network: ${url}`); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const { createTownActorRegistry } = await import('../src/services/town/townActorRegistry.js');
const { resolveTownInteractionTarget } = await import('../src/services/town/townInteractionTarget.js');
const { listOfferOverview } = await import('../src/services/town/townNpcOfferService.js');

config.dbPath = ':memory:';

function seed(t) {
  const db = getDb();
  t.after(() => closeDb());
  db.prepare(`INSERT INTO town_maps (name, grid_cols, grid_rows) VALUES ('m', 10, 10)`).run();
  const mapId = db.prepare('SELECT max(id) id FROM town_maps').get().id;
  // 邀请入住的角色：关联一位只有「服务」职能的居民
  db.prepare(`INSERT INTO characters (name, display_name, base_prompt) VALUES ('lin', '林小姐', '一位住进小镇的旅客')`).run();
  const charId = db.prepare('SELECT max(id) id FROM characters').get().id;
  db.prepare(`INSERT INTO town_npcs (map_id, display_name, job, character_id, town_enabled, capabilities_json)
    VALUES (?, '茶娘阿圆', '茶摊主', ?, 1, '["service"]')`).run(mapId, charId);
  // 没有关联居民的纯角色
  db.prepare(`INSERT INTO characters (name, display_name, base_prompt) VALUES ('solo', '独行客', '路过的旅人')`).run();
  const soloId = db.prepare('SELECT max(id) id FROM characters').get().id;
  const registry = createTownActorRegistry(db);
  registry.synchronize();
  const context = { db, registry, scope: { worldId: registry.getWorldState().worldId, worldEpoch: 1 },
    player: { actorId: registry.resolveAgentKey('me').actorId } };
  return { db, registry, context, mapId, charId, soloId };
}

test('入住角色没单独配职能时继承关联居民，配过之后以角色为准', async t => {
  const { db, registry, context, charId } = seed(t);

  const before = town.listTownCharacters().find(c => c.id === charId);
  assert.deepEqual(before.capabilities, ['service'], '没配过时继承关联居民的职能');
  assert.equal(before.capabilitiesExplicit, false);
  assert.deepEqual(resolveTownInteractionTarget(context, `char:${charId}`).capabilities, ['service']);

  const saved = town.setTownCharacterCapabilities(charId, ['trade', 'work']);
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.capabilities, ['trade', 'work']);

  const after = town.listTownCharacters().find(c => c.id === charId);
  assert.deepEqual(after.capabilities, ['trade', 'work'], '角色配过就以角色为准');
  assert.equal(after.capabilitiesExplicit, true);
  assert.deepEqual(resolveTownInteractionTarget(context, `char:${charId}`).capabilities, ['trade', 'work']);

  // 配职能不能顺手把已经在镇上活动的角色踢出去
  registry.synchronize();
  assert.equal(registry.resolveAgentKey(`char:${charId}`).participating, true);
  assert.equal(db.prepare('SELECT count(*) n FROM town_characters WHERE character_id = ?').get(charId).n, 0, '配职能不该顺手把人送进小镇');
  assert.equal(db.prepare('SELECT capabilities_json FROM town_character_capabilities WHERE character_id = ?').get(charId).capabilities_json, '[\"trade\",\"work\"]');
});

test('没有关联居民的入住角色默认只有服务，单独配职能不会让人凭空入镇', async t => {
  const { registry, charId, soloId } = seed(t);
  const solo = town.listTownCharacters().find(c => c.id === soloId);
  assert.deepEqual(solo.capabilities, ['service'], '无关联居民时回退到默认职能');
  assert.equal(solo.capabilitiesExplicit, false);
  assert.equal(registry.resolveAgentKey(`char:${soloId}`).participating, false);

  assert.equal(town.setTownCharacterCapabilities(soloId, ['service', 'trade']).ok, true);
  registry.synchronize();
  assert.equal(registry.resolveAgentKey(`char:${soloId}`).participating, false, '只配职能不算入住');
  assert.deepEqual(town.listTownCharacters().find(c => c.id === soloId).capabilities, ['service', 'trade']);
  assert.deepEqual(town.listTownCharacters().find(c => c.id === charId).capabilities, ['service'], '另一个角色不受影响');
});

test('职能权限校验：空选、未知值、不存在的角色都拒绝', async t => {
  const { charId } = seed(t);
  assert.deepEqual(town.setTownCharacterCapabilities(charId, []), { ok: false, error: '职能权限无效，至少要选一项。' });
  assert.equal(town.setTownCharacterCapabilities(charId, ['service', 'unknown']).ok, false);
  assert.equal(town.setTownCharacterCapabilities(999999, ['service']).ok, false);
  assert.deepEqual(town.listTownCharacters().find(c => c.id === charId).capabilities, ['service'], '非法输入不落库');
});

test('服务管理名单：无居民档案的入住角色沿用详情默认服务，显式配置仍优先', t => {
  const { db, mapId, soloId } = seed(t);
  const entry = () => listOfferOverview().find(row => row.characterId === soloId);
  assert.equal(entry(), undefined, '未入住角色不进服务管理');
  db.prepare('INSERT INTO town_characters (character_id, map_id, town_enabled) VALUES (?, ?, 1)')
    .run(soloId, mapId);

  const detail = town.listTownCharacters().find(row => row.id === soloId);
  assert.equal(detail.capabilitiesExplicit, false);
  assert.deepEqual(detail.capabilities, ['service']);
  assert.deepEqual(entry(), {
    npcId: null, mapId, characterId: soloId, source: 'character', pendingProfile: true,
    displayName: '独行客', job: '', brief: '', capabilities: detail.capabilities,
    serviceCount: 0, workCount: 0,
  });
  assert.equal(db.prepare('SELECT count(*) n FROM town_character_capabilities WHERE character_id = ?').get(soloId).n, 0,
    '读取默认权限不应写入显式配置');

  town.setTownCharacterCapabilities(soloId, ['trade']);
  assert.equal(entry(), undefined, '只开交易不进服务管理');
  town.setTownCharacterCapabilities(soloId, ['work']);
  assert.deepEqual(entry().capabilities, ['work'], '显式打工配置优先于默认服务');
  db.prepare('UPDATE town_characters SET town_enabled = 0 WHERE character_id = ?').run(soloId);
  assert.equal(entry(), undefined, '搬出后不进待建档名单');
});
test('服务管理名单：酒馆角色的职能以角色配置为准，并带出来源标记', async t => {
  const { db, charId } = seed(t);
  const npcId = db.prepare('SELECT id FROM town_npcs WHERE character_id = ?').get(charId).id;
  // 再放一位没有角色档案的原生居民
  db.prepare(`INSERT INTO town_npcs (map_id, display_name, job, town_enabled, capabilities_json)
    VALUES (1, '面包师', '面包师', 1, '["service","work"]')`).run();
  const plainNpcId = db.prepare('SELECT max(id) id FROM town_npcs').get().id;

  let rows = listOfferOverview();
  const roleRow = rows.find(r => r.npcId === npcId);
  assert.equal(roleRow.source, 'character');
  assert.equal(roleRow.characterId, charId);
  assert.deepEqual(roleRow.capabilities, ['service'], '角色没配过时用居民的权限');
  assert.equal(rows.find(r => r.npcId === plainNpcId).source, 'npc');
  assert.equal(rows.find(r => r.npcId === plainNpcId).characterId, null);

  // 角色只开打工：服务入口跟着收起，打工仍留在名单里
  town.setTownCharacterCapabilities(charId, ['work']);
  rows = listOfferOverview();
  assert.deepEqual(rows.find(r => r.npcId === npcId).capabilities, ['work']);

  // 角色只留交易：没有服务 / 打工职责，就不进这份名单
  town.setTownCharacterCapabilities(charId, ['trade']);
  rows = listOfferOverview();
  assert.equal(rows.find(r => r.npcId === npcId), undefined);
  assert.ok(rows.find(r => r.npcId === plainNpcId), '原生居民不受角色配置影响');
});
