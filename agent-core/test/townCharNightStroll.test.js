import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw Error(`char night stroll fixture forbids network: ${url}`); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const { saveMap } = await import('../src/services/town/townMapService.js');
const { getLocalDateKey } = await import('../src/utils/localDate.js');

test('日程醒着的入驻角色深夜也游走，睡眠档原地不动', async t => {
  // 用本地今天凌晨 01:00 作 mocked 时钟（机器时区 = Asia/Shanghai，日程日期取真实今天）
  const base = new Date();
  const now00 = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 1, 0, 0, 0).getTime();
  let now = now00;
  t.mock.method(Date, 'now', () => now);
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  config.dbPath = ':memory:';
  config.features.town = true; config.features.townLLM = false;
  Object.assign(config.town, { economyEnabled: false, liquidityEnabled: false,
    playerSpeed: 1, npcSpeed: 1, maxActiveEncounters: 0, timeZone: 'Asia/Shanghai' });

  const db = getDb();
  const grid = () => Array.from({ length: 8 }, () => Array(8).fill(null));
  const { mapId } = saveMap({ name: 'char night stroll fixture', cols: 8, rows: 8,
    layers: { ground: grid(), road: grid(), objects: [] },
    locations: [
      { key: 'plaza', name: '广场', x: 0, y: 0, radius: 0 },
      { key: 'cafe', name: '咖啡馆', x: 7, y: 0, radius: 0 },
      { key: 'shop', name: '杂货铺', x: 7, y: 7, radius: 0 },
    ] });
  db.prepare("INSERT INTO characters (name, display_name, base_prompt, is_sleeping) VALUES ('kiana_test', '夜行琪亚娜', '测试角色', 0)").run();
  const charId = db.prepare('SELECT max(id) id FROM characters').get().id;
  db.prepare('INSERT INTO town_characters (character_id, town_enabled) VALUES (?, 1)').run(charId);
  // 今日日程：00:00-02:30 醒着（地点匹配不到任何 POI），02:30-10:30 睡觉
  const schedule = [
    { startTime: '00:00', endTime: '02:30', activity: '深夜加餐', location: '梦魔店后厨', replyDelay: 0, tags: ['夜宵'], description: '', snapshotPrompt: '' },
    { startTime: '02:30', endTime: '10:30', activity: '就寝安眠', location: '员工休息室', replyDelay: -1, tags: ['睡眠'], description: '', snapshotPrompt: '' },
  ];
  db.prepare('INSERT INTO daily_schedules (character_id, schedule_date, schedule_json) VALUES (?, ?, ?)')
    .run(charId, getLocalDateKey(), JSON.stringify(schedule));
  db.prepare('INSERT INTO town_agent_state (agent_key, map_id, grid_x, grid_y) VALUES (?, ?, 0, 0)').run(`char:${charId}`, mapId);

  town.startTownScheduler();
  t.after(() => { town.stopTownScheduler(); closeDb(); t.mock.restoreAll(); t.mock.timers.reset(); });

  const agentKey = `char:${charId}`;
  const agentOf = () => town.getTownState().agents.find(a => a.agentKey === agentKey);
  const tick = (ms = 0) => { now += ms; town.forceTick(); return agentOf(); };

  // 深夜 01:00，日程醒着：应照常游走（修复前被深夜闸门整夜冻住）
  let agent = tick();
  assert.equal(agent.path.length, 0, '入场首个时间桶不应立即起步');
  let steps = 0;
  while (!(agent.path.length > 0) && steps++ < 6) agent = tick(30_000);
  assert.ok(agent.path.length > 0, '深夜且日程醒着时应正常游走起步');

  // 走完到站
  steps = 0;
  while (agent.path.length > 0 && steps++ < 24) agent = tick(5_000);
  assert.equal(agent.path.length, 0, '应在限定时间内到站');

  // 到站停留期内不启程
  const arrivedAt = now;
  while (now < arrivedAt + 25_000) {
    agent = tick(5_000);
    assert.equal(agent.path.length, 0, '停留期内不应再次起步');
  }

  // 02:30 进入睡眠档：没有家也原地安睡，不再游走。
  // 换档后 getCurrentActivity 有 60s 缓存，先越过缓存窗口再断言静止
  const sleepStart = now00 + (2 * 60 + 30) * 60_000;
  now = sleepStart + 30_000; // 越过时段边界 + 停留期
  agent = tick();
  assert.equal(agent.sleeping, true, '睡眠档应判定为睡觉');
  for (let i = 0; i < 4; i++) agent = tick(30_000); // 越过活动缓存 TTL
  for (let i = 0; i < 3; i++) {
    agent = tick(30_000);
    assert.equal(agent.path.length, 0, '睡眠档不应游走');
  }
});
