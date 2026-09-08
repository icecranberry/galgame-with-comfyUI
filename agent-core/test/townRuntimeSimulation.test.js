import test from 'node:test';
import assert from 'node:assert/strict';

// Real module graph and real getDb migrations, isolated by node:test's process.
// No production DB, ComfyUI, model, or other network call is allowed.
test('real town runtime: arrival, legacy cleanup, stopped scheduler and unreachable POI', async t => {
  const realNow = Date.now, realFetch = globalThis.fetch;
  let now = Date.parse('2026-09-08T01:00:00Z');
  const requests = [];
  Date.now = () => now;
  globalThis.fetch = async input => {
    const url = String(input?.url ?? input); requests.push(url);
    if (new URL(url).pathname === '/object_info') return new Response('{}', { status: 200 });
    throw new Error(`Unexpected runtime network request: ${url}`);
  };
  let service, db;
  t.after(() => {
    service?.stopTownScheduler(); service?.resetWorldState();
    db?.close(); Date.now = realNow; globalThis.fetch = realFetch;
  });
  const { config } = await import('../src/config.js');
  config.dbPath = ':memory:';
  config.features.town = true; config.features.townLLM = false;
  config.town.simulation = 'legacy'; config.town.timeZone = 'Asia/Shanghai';
  config.town.npcSpeed = 1; config.town.maxActiveEncounters = 0;
  const { getDb } = await import('../src/db/index.js');
  db = getDb();
  service = await import('../src/services/town/townService.js');
  // Let the mocked object_info response clear its real import-time interval first.
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const mapId = Number(db.prepare('INSERT INTO town_maps(name,grid_cols,grid_rows,layers_json) VALUES(?,?,?,?)')
    .run('Runtime simulation fixture', 8, 8, JSON.stringify({ ground: [], objects: [] })).lastInsertRowid);
  const home = Number(db.prepare(`INSERT INTO town_locations(map_id,key,name,kind,grid_x,grid_y,radius)
    VALUES(?, 'runtime_home', '家', 'home', 0, 0, 0)`).run(mapId).lastInsertRowid);
  db.prepare(`INSERT INTO town_locations(map_id,key,name,kind,grid_x,grid_y,radius)
    VALUES(?, 'runtime_work', '工坊', 'place', 3, 3, 0)`).run(mapId);
  const npcId = Number(db.prepare(`INSERT INTO town_npcs(map_id,display_name,home_location_id,routine_json,traits_json,town_enabled)
    VALUES(?,?,?,?,?,1)`).run(mapId, '规则测试居民', home,
    JSON.stringify([{ start: '00:00', end: '24:00', locationKey: 'runtime_work', activity: '欣赏风景' }]),
    JSON.stringify({ workLocationKey: 'runtime_work' })).lastInsertRowid);
  const key = `npc:${npcId}`;
  const agent = snapshot => snapshot.agents.find(a => a.agentKey === key);
  const latest = () => db.prepare('SELECT * FROM town_actions ORDER BY rowid DESC LIMIT 1').get();
  const count = () => db.prepare('SELECT count(*) n FROM town_actions').get().n;

  await t.test('legacy is inert; real rules start work only after the last path edge', () => {
    service.startTownScheduler();
    assert.equal(count(), 0); service.getTownState(); assert.equal(count(), 0);
    const setting = service.updateTownSettings({ simulation: 'rules', timeZone: 'Asia/Shanghai' });
    assert.equal(setting.applied.simulation, 'rules');
    const first = agent(service.getTownState());
    assert.equal(latest().type, 'move_to'); assert.equal(latest().status, 'running');
    assert.ok(first.path.length > 0);
    t.mock.timers.tick(5000); // Execute the real scheduler's first tick without wall-clock waiting.
    assert.equal(count(), 1); assert.equal(latest().type, 'move_to');
    const arrival = first.startedAt + first.path.length / first.speed * 1000;
    now = arrival - 1;
    service.getTownState();
    assert.equal(count(), 1); assert.equal(latest().type, 'move_to');
    now = arrival;
    const arrived = agent(service.getTownState());
    assert.equal(arrived.x, 3); assert.equal(arrived.y, 3);
    assert.equal(latest().type, 'work_shift'); assert.equal(latest().status, 'running');
    assert.equal(latest().started_at, now); assert.equal(latest().due_at, now + 15 * 60000);
    assert.equal(count(), 2);
    service.updateTownSettings({ simulation: 'legacy' });
    assert.equal(latest().status, 'cancelled');
    assert.equal(db.prepare('SELECT count(*) n FROM town_resource_claims').get().n, 0);
    service.getTownState(); assert.equal(count(), 2);
    assert.equal(service.updateTownSettings({ simulation: 'typo', timeZone: 'invalid/zone' }).applied.simulation, undefined);
    assert.equal(config.town.timeZone, 'Asia/Shanghai');
  });

  await t.test('stopped scheduler snapshots cannot advance actions or expose an authoritative actor position', () => {
    service.stopTownScheduler();
    db.prepare('UPDATE town_agent_state SET grid_x=0,grid_y=0,current_location_id=? WHERE agent_key=?').run(home, key);
    now += 61000;
    service.startTownScheduler();
    service.updateTownSettings({ simulation: 'rules' });
    const moving = agent(service.getTownState());
    assert.equal(latest().type, 'move_to');
    service.stopTownScheduler();
    const before = count();
    const actionBefore = latest();
    const claimsBefore = db.prepare('SELECT * FROM town_resource_claims ORDER BY resource_key').all();
    now = moving.startedAt + moving.path.length / moving.speed * 1000;
    service.getTownState();
    assert.equal(count(), before);
    assert.deepEqual(latest(), actionBefore);
    assert.deepEqual(db.prepare('SELECT * FROM town_resource_claims ORDER BY resource_key').all(), claimsBefore);
    assert.equal(service.getTownActorPosition(moving.actorId), null);
    service.updateTownSettings({ simulation: 'legacy' });
  });

  await t.test('blocked radius-zero POI fails, releases resources and retries only after backoff', () => {
    service.stopTownScheduler();
    // Every accessible fallback cell lies outside the POI radius, regardless of random choice.
    db.prepare('UPDATE town_agent_state SET grid_x=0,grid_y=0,current_location_id=? WHERE agent_key=?').run(home, key);
    const blockOverride = Array.from({ length: 8 }, () => Array(8).fill(0));
    blockOverride[3][3] = 1;
    db.prepare('UPDATE town_maps SET layers_json=? WHERE id=?').run(JSON.stringify({ ground: [], objects: [], blockOverride }), mapId);
    now += 61000;
    service.updateTownSettings({ simulation: 'rules' });
    service.startTownScheduler();
    const first = agent(service.getTownState());
    assert.equal(latest().type, 'move_to');
    const actionId = latest().id;
    assert.equal(first.path.length, 0);
    assert.equal(latest().status, 'failed');
    assert.equal(latest().failure_reason, 'PATH_UNREACHABLE');
    assert.equal(db.prepare('SELECT count(*) n FROM town_resource_claims').get().n, 0);
    const before = count();
    now += 29999; service.getTownState();
    assert.equal(count(), before); assert.equal(latest().id, actionId);
    now += 1; service.getTownState();
    assert.equal(count(), before + 1); assert.notEqual(latest().id, actionId);
    assert.equal(latest().status, 'failed'); assert.equal(latest().failure_reason, 'PATH_UNREACHABLE');
    assert.equal(db.prepare('SELECT count(*) n FROM town_resource_claims').get().n, 0);
    now += 59999; service.getTownState(); assert.equal(count(), before + 1);
    now += 1; service.getTownState(); assert.equal(count(), before + 2);
    assert.equal(latest().status, 'failed');
    service.updateTownSettings({ simulation: 'legacy' });
    assert.equal(latest().status, 'failed'); // Disabling must preserve a terminal failure.
    assert.equal(db.prepare('SELECT count(*) n FROM town_resource_claims').get().n, 0);
  });
  assert.ok(requests.every(url => new URL(url).pathname === '/object_info'));
});
