import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const runtime = await import('../src/services/town/townNpcServiceRuntime.js');
const { createTownActorRegistry } = await import('../src/services/town/townActorRegistry.js');
const { getTownEconomyContext } = await import('../src/services/town/townEconomyRuntime.js');

const TALE = '她把镰刀递过来，顺手扶了一下被风吹歪的草帽，结果帽子直接扣在你头上，两人都笑出了声。';

function fakeLlm() {
  return {
    chatSync: async () => JSON.stringify({
      tale: TALE,
      prompt: 'two people pulling weeds in a sunny courtyard, warm light, wide shot, anime style',
      options: [{ label: '干得不错，继续', tone: 'normal' }, { label: '杂草太多了，奋力大干一场', tone: 'bold' }],
    }),
  };
}
const fakeImage = { generateImageRaw: async () => ({ success: true, images: [{ base64: 'aGVsbG8=', filename: 'x.png' }] }) };
const fakePersist = () => ({ imageUrl: '/images/town_service/test.png', inline: null });

function setup() {
  config.dbPath = ':memory:';
  config.features.town = true; config.features.townLLM = false; config.features.events = true;
  const db = getDb();
  db.prepare("INSERT INTO town_players(id,display_name,grid_x,grid_y) VALUES('me','玩家',0,0)").run();
  const npcId = Number(db.prepare(`INSERT INTO town_npcs(map_id,display_name,job,persona,brief,capabilities_json,town_enabled)
    VALUES(1,'奶牛娘','牧场帮工','说话软软的，一提到奶牛就停不下来。','每天挤奶的兽人姑娘','["service","work","trade"]',1)`)
    .run().lastInsertRowid);
  createTownActorRegistry(db).synchronize();
  const context = getTownEconomyContext();
  const me = context.registry.resolveAgentKey('me');
  const account = context.economy.ensureAccount({ ...context.scope, ownerKey: `actor:${me.actorId}`, actorId: me.actorId, accountType: 'actor' });
  context.economy.seed({ ...context.scope, accountId: account.accountId, amount: 500,
    idempotencyKey: 'seed-player', sourceKey: 'seed-player', reasonCode: 'TEST' });
  const now = Date.now();
  const offer = (kind, price) => Number(db.prepare(`INSERT INTO town_npc_offers
    (world_id,npc_id,kind,title,description,price,sort_order,source,created_at,updated_at)
    VALUES(?,?,?,?,?,?,0,'llm',?,?)`).run(context.scope.worldId, npcId, kind, kind === 'work' ? '清理牛棚' : '庭院除草',
      '后院的杂草已经长到膝盖高。', price, now, now).lastInsertRowid);
  return { db, context, npcId, offer };
}

test('parseServicePayload normalizes the two continue options and rejects incomplete payloads', () => {
  const payload = runtime.parseServicePayload(JSON.stringify({ tale: '趣事', prompt: 'a scene',
    options: [{ label: '继续', tone: 'bold' }, { label: '稳妥', tone: 'normal' }] }));
  assert.equal(payload.options.length, 2);
  assert.equal(payload.options[0].tone, 'normal');
  assert.equal(payload.options[0].label, '稳妥');
  assert.equal(payload.options[1].tone, 'bold');
  assert.throws(() => runtime.parseServicePayload('{"tale":"x"}'), err => err.code === 'SERVICE_PAYLOAD_INCOMPLETE');
  assert.throws(() => runtime.parseServicePayload('not json at all'), err => err.code === 'SERVICE_JSON_MISSING');
});

test('service session makes the player pay and work session pays the player', async t => {
  const f = setup();
  t.after(() => closeDb());
  const playerBefore = getTownEconomyContext().economy.getAccount({ ...f.context.scope,
    accountId: f.context.economy.ensureAccount({ ...f.context.scope, ownerKey: `actor:${f.context.registry.resolveAgentKey('me').actorId}`,
      actorId: f.context.registry.resolveAgentKey('me').actorId, accountType: 'actor' }).accountId }).balance;

  const serviceOffer = f.offer('service', 60);
  const serviceReady = await runtime.startNpcService(f.npcId, { offerId: serviceOffer },
    { db: f.db, llm: fakeLlm(), image: fakeImage, persistImage: fakePersist, awaitPipeline: true });
  assert.equal(serviceReady.kind, 'service');
  assert.equal(serviceReady.money.delta, -60, 'service should cost the player 60 coins');
  assert.equal(serviceReady.tale, TALE);
  assert.deepEqual(serviceReady.options.map(o => o.tone), ['normal', 'bold']);
  // 选项要带上下一轮价格：稳妥=基准价，激进=同一个确定性倍率（和服务结算同源）
  assert.equal(serviceReady.options[0].delta, -60);
  assert.ok(serviceReady.options[1].delta <= -90 && serviceReady.options[1].delta >= -180,
    `激进选项金额 ${serviceReady.options[1].delta} 不在 60 的 1.5~3 倍区间`);
  assert.ok(serviceReady.sessionId);

  const workOffer = f.offer('work', 45);
  const workReady = await runtime.startNpcService(f.npcId, { offerId: workOffer },
    { db: f.db, llm: fakeLlm(), image: fakeImage, persistImage: fakePersist, awaitPipeline: true });
  assert.equal(workReady.money.delta, 45, 'work should earn the player 45 coins');
  assert.equal(workReady.options[0].delta, 45, '打工的稳妥选项应显示 +45');
  assert.ok(workReady.options[1].delta >= 68 && workReady.options[1].delta <= 135,
    `打工激进选项金额 ${workReady.options[1].delta} 不在 45 的 1.5~3 倍区间`);

  const wallet = getTownEconomyContext().economy.getAccount({ ...f.context.scope,
    accountId: f.context.economy.ensureAccount({ ...f.context.scope, ownerKey: `actor:${f.context.registry.resolveAgentKey('me').actorId}`,
      actorId: f.context.registry.resolveAgentKey('me').actorId, accountType: 'actor' }).accountId });
  assert.equal(wallet.balance, playerBefore - 60 + 45);
});

test('turnAmount keeps the normal branch at base and bold within 1.5x~3x', () => {
  assert.equal(runtime.turnAmount({ kind: 'service', basePrice: 60, sessionId: 1, turns: 0, tone: 'normal' }), 60);
  assert.equal(runtime.turnAmount({ kind: 'work', basePrice: 45, sessionId: 7, turns: 3, tone: 'normal' }), 45);
  for (let i = 0; i < 30; i++) {
    const value = runtime.turnAmount({ kind: 'service', basePrice: 60, sessionId: i, turns: 0, tone: 'bold' });
    assert.ok(value >= 90 && value <= 180, `bold amount ${value} outside 60 x 1.5~3`);
  }
});

test('service is rejected up front when the player cannot pay, without creating a session', async t => {
  const f = setup();
  t.after(() => closeDb());
  f.db.prepare("UPDATE economy_accounts SET balance = 10 WHERE account_type = 'actor'").run();
  const offerId = f.offer('service', 60);
  assert.throws(
    () => runtime.startNpcService(f.npcId, { offerId }, { db: f.db, llm: fakeLlm(), image: fakeImage, persistImage: fakePersist, awaitPipeline: true }),
    err => err.code === 'INSUFFICIENT_FUNDS',
  );
  assert.equal(runtime.listNpcServiceSessions(f.npcId, { db: f.db }).length, 0, '拒绝后不应留下半截会话');
  assert.equal(f.context.economy.getAccount({ ...f.context.scope,
    accountId: f.context.economy.ensureAccount({ ...f.context.scope, ownerKey: `actor:${f.context.registry.resolveAgentKey('me').actorId}`,
      actorId: f.context.registry.resolveAgentKey('me').actorId, accountType: 'actor' }).accountId }).balance, 10);
});

test('work never depends on a resident wallet  the wage is always paid to the player', async t => {
  const f = setup();
  t.after(() => closeDb());
  const offerId = f.offer('work', 45);
  const playerBalance = () => f.context.economy.getAccount({ ...f.context.scope,
    accountId: f.context.economy.ensureAccount({ ...f.context.scope,
      ownerKey: `actor:${f.context.registry.resolveAgentKey('me').actorId}`,
      actorId: f.context.registry.resolveAgentKey('me').actorId, accountType: 'actor' }).accountId }).balance;
  const before = playerBalance();
  const ready = await runtime.startNpcService(f.npcId, { offerId },
    { db: f.db, llm: fakeLlm(), image: fakeImage, persistImage: fakePersist, awaitPipeline: true });
  assert.equal(ready.money.delta, 45, '打工照常给玩家发工钱');
  assert.equal(playerBalance(), before + 45);
  // 居民不再有自己的钱包账户
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM economy_accounts WHERE owner_key = ?').get(`npc:${f.npcId}`).n, 0,
    '居民不该再有 economy 账户');
});

test('bold continue is rejected when the player cannot cover the upper bound', async t => {
  const f = setup();
  t.after(() => closeDb());
  const offerId = f.offer('service', 60);
  const first = await runtime.startNpcService(f.npcId, { offerId },
    { db: f.db, llm: fakeLlm(), image: fakeImage, persistImage: fakePersist, awaitPipeline: true });
  f.db.prepare("UPDATE economy_accounts SET balance = 70 WHERE account_type = 'actor'").run();
  assert.throws(
    () => runtime.continueNpcService(f.npcId, { sessionId: first.sessionId, choice: 'bold', choiceLabel: '放手一搏' }, { db: f.db }),
    err => err.code === 'INSUFFICIENT_FUNDS',
  );
});

test('continuing with the bold option pays 1.5x~3x the base amount', async t => {
  const f = setup();
  t.after(() => closeDb());
  const offerId = f.offer('service', 60);
  const first = await runtime.startNpcService(f.npcId, { offerId },
    { db: f.db, llm: fakeLlm(), image: fakeImage, persistImage: fakePersist, awaitPipeline: true });

  const normal = await runtime.continueNpcService(f.npcId, { sessionId: first.sessionId, choice: 'normal', choiceLabel: '继续' },
    { db: f.db, llm: fakeLlm(), image: fakeImage, persistImage: fakePersist, awaitPipeline: true });
  assert.equal(normal.money.delta, -60, 'normal continue keeps the base price');

  const bold = await runtime.continueNpcService(f.npcId, { sessionId: first.sessionId, choice: 'bold', choiceLabel: '奋力大干一场' },
    { db: f.db, llm: fakeLlm(), image: fakeImage, persistImage: fakePersist, awaitPipeline: true });
  const paid = Math.abs(bold.money.delta);
  assert.ok(paid >= Math.round(60 * 1.5) && paid <= 60 * 3, `bold amount ${paid} outside 1.5x~3x`);

  const session = runtime.getNpcServiceSession(first.sessionId, { db: f.db });
  assert.equal(session.turns, 3, 'three turns should be recorded');
});

test('mint and burn only touch the player account and the issuance sink', t => {
  const f = setup();
  t.after(() => closeDb());
  const me = f.context.registry.resolveAgentKey('me');
  const accountId = f.context.economy.ensureAccount({ ...f.context.scope,
    ownerKey: `actor:${me.actorId}`, actorId: me.actorId, accountType: 'actor' }).accountId;
  const balance = () => f.context.economy.getAccount({ ...f.context.scope, accountId }).balance;
  const before = balance();

  f.context.economy.burn({ ...f.context.scope, accountId, amount: 60,
    idempotencyKey: 'burn-1', sourceKey: 'burn-1', reasonCode: 'TEST_BURN' });
  assert.equal(balance(), before - 60, '销毁：玩家少 60');

  f.context.economy.mint({ ...f.context.scope, accountId, amount: 45,
    idempotencyKey: 'mint-1', sourceKey: 'mint-1', reasonCode: 'TEST_MINT' });
  assert.equal(balance(), before - 15, '发行：玩家多 45');

  // 居民全程不产生任何账户
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM economy_accounts WHERE owner_key LIKE 'npc:%'").get().n, 0);

  assert.throws(() => f.context.economy.burn({ ...f.context.scope, accountId, amount: 999999,
    idempotencyKey: 'burn-2', sourceKey: 'burn-2', reasonCode: 'TEST_BURN' }),
    err => err.code === 'INSUFFICIENT_FUNDS');
});
