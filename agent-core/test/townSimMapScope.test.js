import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw Error(`sim map scope fixture forbids network: ${url}`); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const { createNpc } = await import('../src/services/town/townNpcService.js');
const { saveMap } = await import('../src/services/town/townMapService.js');

// 多图共享同一个世界账本（town-main）：每张图的 runtime 只能推进本图 actor。
// 回归背景：tick 不按图过滤时，别的图读不到本图 agent（allowsAction=false），
// 会以 schedule_or_target_blocked 把本图刚启动的动作取消掉，全镇走走停停。
test('多图各图只推进本图 actor：外图 tick 不取消本图动作', async t => {
  let now = Date.parse('2026-09-25T10:00:00+08:00');
  t.mock.method(Date, 'now', () => now);
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  config.dbPath = ':memory:';
  config.features.town = true; config.features.townLLM = false;
  Object.assign(config.town, { economyEnabled: false, liquidityEnabled: false,
    playerSpeed: 1, npcSpeed: 1, maxActiveEncounters: 0, timeZone: 'Asia/Shanghai' });

  const db = getDb();
  const grid = () => Array.from({ length: 8 }, () => Array(8).fill(null));
  const mkMap = (name, plazaName, teaName) => saveMap({ create: true, name, cols: 8, rows: 8,
    layers: { ground: grid(), road: grid(), objects: [] },
    locations: [
      { key: 'plaza', name: plazaName, x: 0, y: 0, radius: 0 },
      { key: 'tea', name: teaName, x: 7, y: 7, radius: 0 },
    ] });
  const { mapId: mapA } = mkMap('老镇', '中央广场', '老茶馆');
  const { mapId: mapB } = mkMap('海边的镇', '渡口', '海边茶棚');

  const npcActorIds = {};
  for (const [mapId, displayName] of [[mapA, '阿甲'], [mapB, '阿丙']]) {
    createNpc({ mapId, displayName, job: '居民',
      routine: [{ start: '00:00', end: '24:00', locationKey: 'plaza', activity: '固定岗位' }] });
    const id = db.prepare('SELECT max(id) id FROM town_npcs').get().id;
    db.prepare(`INSERT INTO town_agent_state(agent_key,map_id,grid_x,grid_y,current_location_id)
      VALUES(?,?,?,?,(SELECT id FROM town_locations WHERE key = ? AND map_id = ?))`)
      .run(`npc:${id}`, mapId, 1, 0, 'plaza', mapId);
  }
  db.prepare("INSERT INTO town_players (id, display_name, grid_x, grid_y, map_id) VALUES ('me', '玩家', 0, 0, ?)").run(mapA);

  town.startTownScheduler();
  t.after(() => { town.stopTownScheduler(); closeDb(); t.mock.restoreAll(); t.mock.timers.reset(); });

  // 推进若干拍：两张图的居民都应真正游走起来（move_to 出现且持续）
  const walked = { [mapA]: false, [mapB]: false };
  for (let i = 0; i < 10; i++) {
    now += 30_000;
    town.forceTick();
    for (const mapId of [mapA, mapB]) {
      if (town.getTownState(mapId).agents.some(a => a.path.length > 0)) walked[mapId] = true;
    }
  }
  assert.equal(walked[mapA], true, '老镇居民在走');
  assert.equal(walked[mapB], true, '海边镇居民在走');

  // 核心断言：不允许出现跨图取消。
  // schedule_or_target_blocked = 外图 runtime 读不到 agent 而取消；
  // SIMULATION_SCOPE_ENDED = 启动 reconcile 把外图 actor 当成离开作用域而取消。
  const crossCancels = db.prepare(`SELECT reason_code, COUNT(*) c FROM town_activity_log
    WHERE reason_code IN ('schedule_or_target_blocked','SIMULATION_SCOPE_ENDED')
    GROUP BY reason_code`).all();
  assert.deepEqual(crossCancels, [], `出现跨图取消: ${JSON.stringify(crossCancels)}`);

  // 动作寿命：被本图正常调度的动作不应秒建秒删（创建后 1s 内被取消）
  const shortLived = db.prepare(`SELECT COUNT(*) c FROM town_actions
    WHERE status = 'cancelled' AND updated_at - started_at < 1000`).get().c;
  assert.equal(shortLived, 0, `存在 ${shortLived} 条秒级取消的动作`);
});
