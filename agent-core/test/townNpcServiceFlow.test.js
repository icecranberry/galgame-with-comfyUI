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
const runtime = await import('../src/services/town/townNpcServiceRuntime.js');

const TALE = '她把挤奶桶往你脚边一放，结果惊起一只母鸡，两人追着鸡跑了大半个院子。';
const fakeLlm = { chatSync: async () => JSON.stringify({ tale: TALE, prompt: 'two people chasing a hen, sunny farmyard',
  options: [{ label: '继续干活', tone: 'normal' }, { label: '索性把鸡也喂了', tone: 'bold' }] }) };
const fakeImage = { generateImageRaw: async () => ({ success: true, images: [{ base64: 'aGVsbG8=', filename: 'x.png' }] }) };
const fakePersist = () => ({ imageUrl: '/images/town_service/test.png', inline: null });

test('service/work offers surface in the interaction catalog and settle coins on selection', async t => {
  let now = Date.parse('2026-09-08T10:00:00+08:00');
  t.mock.method(Date, 'now', () => now);
  config.dbPath = ':memory:';
  const db = getDb();
  config.features.town = true; config.features.townLLM = false; config.features.events = true;
  Object.assign(config.town, { playerSpeed: 1, npcSpeed: 1, maxActiveEncounters: 0, timeZone: 'Asia/Shanghai' });
  t.after(() => { town.stopTownScheduler(); closeDb(); });

  const grid = () => Array.from({ length: 12 }, () => Array(12).fill(null));
  const { mapId } = saveMap({ name: 'Service flow town', cols: 12, rows: 12,
    layers: { ground: grid(), road: grid(), objects: [] },
    locations: [{ key: 'farm', name: '牧场', businessKind: 'none', x: 0, y: 0, radius: 0 }] });
  createNpc({ mapId, displayName: '奶牛娘', job: '牧场帮工', persona: '说话软软的，一提到奶牛就停不下来。' });
  const npcId = db.prepare('SELECT max(id) id FROM town_npcs').get().id;
  db.prepare('UPDATE town_npcs SET routine_json=? WHERE id=?').run(JSON.stringify([
    { start: '00:00', end: '24:00', locationKey: 'farm', activity: '挤奶' }]), npcId);
  db.prepare(`INSERT INTO town_agent_state(agent_key,map_id,grid_x,grid_y,current_location_id)
    VALUES(?,?,?,?,(SELECT id FROM town_locations WHERE key=? AND map_id=?))`).run(`npc:${npcId}`, mapId, 0, 0, 'farm', mapId);
  db.prepare("INSERT INTO town_players(id,display_name,grid_x,grid_y) VALUES('me','玩家',0,0)").run();
  reconcileTownResponsibilities({ db, allowFallback: true });
  town.startTownScheduler();

  const { scope } = economy.getTownEconomyContext();
  const capabilities = JSON.parse(db.prepare('SELECT capabilities_json FROM town_npcs WHERE id=?').get(npcId).capabilities_json);
  assert.ok(capabilities.includes('work'), '牧场帮工应自动获得打工权限');

  const insertOffer = (kind, title, price) => Number(db.prepare(`INSERT INTO town_npc_offers
    (world_id,npc_id,kind,title,description,price,sort_order,source,created_at,updated_at)
    VALUES(?,?,?,?,?,?,0,'llm',?,?)`).run(scope.worldId, npcId, kind, title, '后院的活儿已经堆了一地。', price, now, now).lastInsertRowid);
  const serviceOffer = insertOffer('service', '庭院除草', 60);
  const workOffer = insertOffer('work', '清理牛棚', 45);

  const interactions = interaction.getTownInteractions(`npc:${npcId}`);
  // 服务 / 打工走独立的「瞄一眼」目录，绝不混进奇遇 catalog。
  assert.ok(!interactions.catalog.some(item => item.offerId), '服务/打工项目不应进入奇遇目录');
  const serviceItem = interactions.offers.find(item => item.offerId === serviceOffer);
  assert.ok(serviceItem, '服务项目应出现在服务/打工目录');
  assert.equal(serviceItem.kind, 'service');
  assert.equal(serviceItem.direction, 'pay');
  assert.equal(serviceItem.price, 60);
  const workItem = interactions.offers.find(item => item.offerId === workOffer);
  assert.ok(workItem, '打工项目应出现在服务/打工目录');
  assert.equal(workItem.kind, 'work');
  assert.equal(workItem.direction, 'earn');
  assert.equal(workItem.wage, 45);

  const me = economy.getTownEconomyContext().registry.resolveAgentKey('me');
  const context = economy.getTownEconomyContext();
  const playerAccount = context.economy.ensureAccount({ ...scope, ownerKey: `actor:${me.actorId}`, actorId: me.actorId, accountType: 'actor' });
  context.economy.seed({ ...scope, accountId: playerAccount.accountId, amount: 500,
    idempotencyKey: 'seed-player', sourceKey: 'seed-player', reasonCode: 'TEST' });

  const balanceBefore = economy.getTownWallet().balance;
  const ready = await runtime.startNpcService(npcId, { offerId: serviceOffer },
    { db, llm: fakeLlm, image: fakeImage, persistImage: fakePersist, awaitPipeline: true });
  assert.equal(ready.kind, 'service');
  assert.equal(ready.money.delta, -60);
  assert.equal(ready.tale, TALE);
  assert.deepEqual(ready.options.map(option => option.tone), ['normal', 'bold']);
  assert.ok(ready.images.length, '服务完成后应带回一张图');

  const wallet = economy.getTownWallet();
  assert.equal(wallet.balance, balanceBefore - 60, '服务结束后钱包应扣掉 60');
});
