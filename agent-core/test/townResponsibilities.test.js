import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { getDb, closeDb } = await import('../src/db/index.js');
const { config } = await import('../src/config.js');
const { saveMap, getMapPayload } = await import('../src/services/town/townMapService.js');
const { createNpc, updateNpc } = await import('../src/services/town/townNpcService.js');
const { reconcileTownResponsibilities } = await import('../src/services/town/townResponsibilityRuntime.js');
const { prepareTownBlueprintResponsibilities, townBuildingKind } = await import('../src/services/town/townResponsibilityDefinitions.js');
const { generateLocalLayout } = await import('../src/services/town/townLayoutGenerator.js');
const { normalizeTownCapabilities, townCapabilities, TOWN_CAPABILITIES } = await import('../src/services/town/townCapabilities.js');

const fresh = t => { closeDb(); config.dbPath = ':memory:'; const db = getDb(); t.after(closeDb); return db; };
const grid = () => Array.from({ length: 20 }, () => Array(20).fill(null));
const places = [
  { key: 'plaza', name: '广场', businessKind: 'board', kind: 'outdoor' },
  { key: 'stock', name: '备料小屋', businessKind: 'supplier' },
  { key: 'craft', name: '手艺角', businessKind: 'workshop' },
  { key: 'moon', name: '月下银梳', businessKind: 'salon' },
  { key: 'rest', name: '云间歇脚', businessKind: 'massage' },
].map((p, i) => ({ ...p, x: i * 3, y: 4, radius: 1 }));
const mapInput = (locations = places) => ({ name: '职责小镇', cols: 20, rows: 20,
  layers: { ground: grid(), road: grid(), objects: [] }, locations });
const jobs = ['委托员', '供货员', '工坊师傅', '理发师', '按摩师'];
const createStaff = mapId => jobs.map((job, i) => createNpc({ mapId, displayName: `员工${i}`, job, workplaceKey: places[i].key }));

test('building-first generation binds staff to stores as they arrive; replay keeps bindings stable', t => {
  const db = fresh(t);
  const { mapId } = saveMap(mapInput());
  assert.equal(getMapPayload().locations.find(l => l.key === 'moon').businessKind, 'salon');
  // 岗位不预声明：生成只给职业，reconcile 按职业把居民绑到对应建筑。
  const staff = jobs.map((job, i) => createNpc({ mapId, displayName: `员工${i}`, job }));
  assert.ok(db.prepare('SELECT functions_json FROM town_npcs WHERE id=?').get(staff[4].id).functions_json, 'functions exist before first chat');
  const bound = reconcileTownResponsibilities({ db, allowFallback: true });
  assert.deepEqual(db.prepare('SELECT workplace_key FROM town_npcs ORDER BY id').all().map(r => r.workplace_key), places.map(p => p.key));
  assert.deepEqual(bound.pending, [], 'every generated role found its staff');
  assert.equal(db.prepare("SELECT business_kind FROM town_locations WHERE key='moon'").get().business_kind, 'salon', 'purpose survives a fantasy name');
  assert.ok(db.prepare("SELECT 1 FROM item_templates WHERE template_id='town.mood_patch'").get());
  const declarations = db.prepare('SELECT functions_json,workplace_key FROM town_npcs ORDER BY id').all();
  for (let i = 0; i < 3; i++) { saveMap(mapInput()); reconcileTownResponsibilities({ db, allowFallback: true }); }
  assert.deepEqual(db.prepare('SELECT functions_json,workplace_key FROM town_npcs ORDER BY id').all(), declarations, 'replay does not reshuffle bindings');
  const custom = { dialogue: { version: 2, job: String(staff[0].job || '帮工') },
    gift_giver: { itemPool: [{ templateId: 'town.mood_patch', templateVersion: 1 }], cooldownMs: 86400000 } };
  db.prepare('UPDATE town_npcs SET functions_json=? WHERE id=?').run(JSON.stringify(custom), staff[0].id);
  updateNpc(staff[0].id, { brief: '新的备注' });
  assert.deepEqual(JSON.parse(db.prepare('SELECT functions_json FROM town_npcs WHERE id=?').get(staff[0].id).functions_json), custom);
});

test('residents-first generation records functions immediately and binds on map completion; later new store binds without changing older shops', t => {
  const db = fresh(t);
  const staff = createStaff(null);
  assert.ok(db.prepare('SELECT functions_json FROM town_npcs WHERE id=?').get(staff[0].id).functions_json);
  const { mapId } = saveMap({ ...mapInput(places.slice(0, 4)), assignResponsibilities: false });
  db.prepare('UPDATE town_npcs SET map_id=?').run(mapId); // wizard attaches its already-generated roster
  reconcileTownResponsibilities({ db });
  const first = db.prepare('SELECT id,workplace_key FROM town_npcs ORDER BY id').all();
  assert.ok(first.every(row => row.workplace_key), 'staff bind to the first four places');
  const tailor = createNpc({ mapId, displayName: '裁缝', job: '裁缝', workplaceKey: 'cloth' });
  saveMap(mapInput([...places, { key: 'cloth', name: '青云阁', businessKind: 'clothing_shop', x: 17, y: 4 }]));
  reconcileTownResponsibilities({ db });
  assert.deepEqual(db.prepare('SELECT id,workplace_key FROM town_npcs ORDER BY id').all().filter(r => r.id !== tailor.id), first, 'older shops keep their staff');
  assert.equal(db.prepare('SELECT workplace_key FROM town_npcs WHERE id=?').get(tailor.id).workplace_key, 'cloth');
});

test('old town inference reserves specialists, preserves hand-picked bindings and reports missing staff', t => {
  const db = fresh(t);
  const oldPlaces = [
    { key: 'old_square', name: '镇中心', kind: 'outdoor' },
    { key: 'mail_room', name: '寄存处' },
    { key: 'community_room', name: '活动室' },
    { key: 'hair_house', name: '理发店' },
    { key: 'empty_massage', name: '按摩店' },
  ].map((p, i) => ({ ...p, x: i * 3, y: 5 }));
  const { mapId } = saveMap({ ...mapInput(oldPlaces), assignResponsibilities: false });
  for (const [i, job] of ['退休居民', '园丁', '邮递员', '理发师'].entries()) createNpc({ mapId, displayName: `旧居民${i}`, job, assignResponsibilities: false });
  const ready = reconcileTownResponsibilities({ db, allowFallback: true });
  const oldLocations = db.prepare("SELECT key,business_kind FROM town_locations WHERE key IN ('mail_room','community_room')").all();
  assert.ok(oldLocations.every(l => l.business_kind === 'none'), 'existing landmarks keep their purpose');
  assert.ok(db.prepare("SELECT 1 FROM town_locations WHERE key='town_supplier_stall'").get());
  assert.ok(db.prepare("SELECT 1 FROM town_locations WHERE key='town_workshop_stall'").get());
  assert.ok(ready.pending.some(p => p.kind === 'massage'), 'unstaffed kinds still get reported');
  const barber = db.prepare("SELECT id,workplace_key FROM town_npcs WHERE job='理发师'").get();
  assert.equal(barber.workplace_key, 'hair_house', 'specialist jobs match by name');
  // A user's earlier manual binding is authoritative even if the location or job reads differently.
  db.prepare("UPDATE town_npcs SET job='新职业' WHERE id=?").run(barber.id);
  db.prepare("UPDATE town_locations SET business_kind='study' WHERE key='hair_house'").run();
  const again = reconcileTownResponsibilities({ db, allowFallback: true });
  assert.equal(again.changed, false);
  assert.equal(db.prepare('SELECT workplace_key FROM town_npcs WHERE id=?').get(barber.id).workplace_key, 'hair_house');
});

test('inactive residents never join the roster that receives bindings', t => {
  const db = fresh(t);
  const { mapId } = saveMap(mapInput());
  const disabled = createNpc({ mapId, displayName: jobs[3], job: jobs[3], workplaceKey: places[3].key, townEnabled: 0 });
  const active = createNpc({ mapId, displayName: jobs[4], job: jobs[4], workplaceKey: places[4].key });
  reconcileTownResponsibilities({ db, allowFallback: true });
  assert.equal(db.prepare('SELECT workplace_key FROM town_npcs WHERE id=?').get(disabled.id).workplace_key, places[3].key, 'declared workplaces persist regardless');
  assert.equal(db.prepare('SELECT workplace_key FROM town_npcs WHERE id=?').get(active.id).workplace_key, places[4].key);
  const roster = db.prepare('SELECT id FROM town_npcs WHERE town_enabled=1 ORDER BY id').all().map(r => r.id);
  assert.ok(roster.includes(active.id) && !roster.includes(disabled.id), 'disabled residents stay out of the roster');
});

test('generation plan completes essential roles before art/persona generation and layout preserves explicit purpose', () => {
  const blueprint = prepareTownBlueprintResponsibilities({ groundAssets: [], roadAssets: [], props: [],
    buildings: [{ key: 'silver', name: '银色月光', businessKind: 'salon' }, { key: 'houses', name: '居民楼', businessKind: 'none', reusable: true }],
    npcs: [{ displayName: '小银', job: '理发师', persona: 'keep', brief: 'keep' }, { displayName: '小满', job: '居民' }] });
  const original = structuredClone(blueprint);
  prepareTownBlueprintResponsibilities(blueprint);
  assert.deepEqual(blueprint, original, 'resuming the generation plan does not duplicate staff or buildings');
  assert.equal(blueprint.npcs.find(n => n.displayName === '小银').workplaceKey, 'silver');
  assert.equal(blueprint.npcs.find(n => n.displayName === '小银').persona, 'keep');
  assert.equal(blueprint.npcs.find(n => n.displayName === '小满').workplaceKey, undefined);
  const readyAssets = [{ id: 1, kind: 'ground', key: 'grass', meta: {} }, { id: 2, kind: 'road', key: 'road', meta: {} },
    ...blueprint.buildings.map((b, i) => ({ id: i + 3, key: b.key, name: b.name, kind: 'building', meta: { footprint: { w: 3, h: 2 } } }))];
  const layout = generateLocalLayout({ readyAssets, blueprint, cols: 40, rows: 40, seed: 123, buildingDensity: 0.2 });
  for (const kind of ['board', 'supplier', 'workshop', 'salon']) assert.ok(layout.locations.some(l => l.businessKind === kind), kind);
  assert.equal(layout.npcSpawns.find(s => s.npcRef === '小银').locationKey, 'silver');
  assert.equal(townBuildingKind({ name: '旧服装店', businessKind: 'none' }), 'none', 'explicit non-business is authoritative');
});

test('only service and trade permissions persist, survive editing, and transfer through generation', t => {
  const db = fresh(t);
  assert.deepEqual(TOWN_CAPABILITIES, ['service', 'trade']);
  for (const invalid of [[], ['quest'], 'trade', ['service', 'shop']]) {
    assert.throws(() => normalizeTownCapabilities(invalid), { code: 'INVALID_TOWN_CAPABILITIES' });
  }
  assert.deepEqual(townCapabilities({ capabilities_json: '{bad' }), [], 'corrupt saved permissions fail closed');
  const input = mapInput(places.map(p => ({ ...p, capabilities: ['trade', 'service'] })));
  const { mapId } = saveMap(input);
  const npc = createNpc({ mapId, displayName: '两用店员', job: '理发师', workplaceKey: 'moon', capabilities: ['trade'] });
  assert.deepEqual(npc.capabilities, ['trade'], 'explicit NPC permissions are independent from the workplace');
  updateNpc(npc.id, { job: '商贩', brief: '只修改介绍' });
  assert.deepEqual(JSON.parse(db.prepare('SELECT capabilities_json FROM town_npcs WHERE id=?').get(npc.id).capabilities_json), ['trade']);
  saveMap(mapInput());
  assert.ok(getMapPayload().locations.every(l => JSON.stringify(l.capabilities) === '["service","trade"]'), 'old map clients preserve saved permissions');
  assert.throws(() => updateNpc(npc.id, { displayName: '不应保存', capabilities: ['invented'] }), { code: 'INVALID_TOWN_CAPABILITIES' });
  assert.equal(db.prepare('SELECT display_name FROM town_npcs WHERE id=?').get(npc.id).display_name, '两用店员', 'invalid updates roll back entirely');
  const blueprint = prepareTownBlueprintResponsibilities({ groundAssets: [], roadAssets: [], props: [], npcs: [],
    buildings: [{ key: 'mystery', name: '月下小屋', businessKind: 'none', capabilities: ['trade'] }] });
  const employee = blueprint.npcs.find(n => n.workplaceKey === 'mystery');
  assert.deepEqual(employee.capabilities, ['trade'], 'even a newly named trading building receives a generated employee');
  const readyAssets = [{ id: 1, kind: 'ground', key: 'grass', meta: {} }, { id: 2, kind: 'road', key: 'road', meta: {} },
    ...blueprint.buildings.map((b, i) => ({ id: i + 3, key: b.key, name: b.name, kind: 'building', meta: { footprint: { w: 3, h: 2 } } }))];
  const layout = generateLocalLayout({ readyAssets, blueprint, cols: 40, rows: 40, seed: 123, buildingDensity: 0.2 });
  assert.deepEqual(layout.locations.find(l => l.key === 'mystery')?.capabilities, ['trade']);
});

test('old repeated buildings receive stable clickable addresses and inherit their generated permissions', t => {
  const db = fresh(t);
  const asset = { id: Number(db.prepare("INSERT INTO town_assets(kind,key,name,image_path,meta_json,status) VALUES('building','old_home','旧街小屋','',?,'ready')")
    .run(JSON.stringify({ footprint: { w: 2, h: 2 }, capabilities: ['service', 'trade'] })).lastInsertRowid) };
  const input = mapInput([]);
  input.layers.objects = [{ id: 1, assetId: asset.id, x: 3, y: 4 }, { id: 2, assetId: asset.id, x: 10, y: 4 }];
  saveMap(input);
  const before = getMapPayload().locations;
  assert.equal(before.length, 2);
  assert.deepEqual(before.map(l => l.objectId), [1, 2]);
  assert.ok(before.every(l => JSON.stringify(l.capabilities) === '["service","trade"]'));
  reconcileTownResponsibilities({ db });
  assert.deepEqual(getMapPayload().locations, before, 'reload does not add duplicate addresses');
});
