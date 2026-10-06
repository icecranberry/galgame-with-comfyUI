import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const runtime = await import('../src/services/town/townBuildingFeatureRuntime.js');
const sourceModule = await import('../src/services/town/townBuildingFeatureSource.js');
const { buildCharacterPersona } = await import('../src/services/characterPersona.js');
const { getActiveBuffBlock } = await import('../src/services/itemService.js');
const { getActiveOutfits } = await import('../src/services/outfitService.js');
const {
  setupTownEnvironment, buildTown, createResidentCharacter, installCompiledConfig,
  arriveAt, seedPlayerWallet,
} = await import('./helpers/townBuildingFeatureFixture.js');

function appearanceConfig(templateId, options) {
  return {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '一间为客人做全身打理的美容小屋，别无其他',
    unsupported: [], resources: [],
    features: [{
      key: 'makeover', templateId, templateVersion: 1,
      title: '来一次改造', description: '挑一款喜欢的造型，店里会为你打理到位，持续一段时间。',
      evidence: { source: 'building.title', quote: '美容小屋' },
      priceTier: 'basic',
      params: { durationHours: 6, options },
      presentation: { opening: '镜子与梳子都备好了，坐下来慢慢挑吧，不着急。', success: '{targetName}换上了{optionLabel}。', empty: '今天造型师不在。' },
    }],
  };
}

test('appearance effects really inject into persona and expire; same option never re-charged', async t => {
  const env = await setupTownEnvironment(t);
  const { db } = env;
  // 用真实时钟做基线：SQLite datetime('now') 无法 mock，固定历史时间会把新外观判成已过期
  const now = { value: Date.now() };
  t.mock.method(Date, 'now', () => now.value);
  const { mapId, places } = buildTown({
    ...env,
    buildings: [{ key: 'salon', name: '美容小屋', businessKind: 'salon', operatorJob: '美容师',
      featureDesc: '为客人做服装、发型、配饰和形态的临时改造。' }],
  });
  const characterId = createResidentCharacter(env, { name: '青柠' });
  const source = sourceModule.resolveBuildingFeatureSource(env.runtime.getTownEconomyContext(), { mapId, locationKey: 'salon' });
  const compiled = await installCompiledConfig(env, source, appearanceConfig('outfit_change', [
    { key: 'dress_one', label: '星尘长裙', appearance: '缀着细碎亮片的深蓝色长裙，裙摆处有星辰刺绣，腰线收得恰到好处，袖口是轻盈的薄纱喇叭袖。' },
    { key: 'dress_two', label: '晨雾披风', appearance: '灰白色的短披风，边缘缝着一圈云纹织带，内衬是月白色的束腰长衣，上身轻便，走起路来衣摆微微扬起。' },
  ]));
  const featureId = compiled.features[0].featureId;
  seedPlayerWallet(env.runtime, 100);
  const { scope } = await arriveAt(env, now, places[0]);

  const applyOption = (key, idem) => {
    const quote = runtime.quoteTownBuildingFeature({ mapId, locationKey: 'salon', featureId,
      selection: { optionKey: key, targetActorKeys: [`char:${characterId}`] }, ...scope });
    return runtime.executeTownBuildingFeature({ ...scope, mapId, locationKey: 'salon', featureId,
      quoteId: quote.quoteId, quoteExpiresAt: quote.expiresAt, idempotencyKey: idem,
      selection: { optionKey: key, targetActorKeys: [`char:${characterId}`] } });
  };

  const op1 = applyOption('dress_one', 'salon-1');
  assert.equal(op1.status, 'committed');
  // 真实生效：现有外观服务能查到，生图人格注入包含选项描述
  const outfits = getActiveOutfits(characterId);
  assert.ok(outfits.limited.some(o => o.name === '星尘长裙'), 'limited outfit registered');
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
  const persona = buildCharacterPersona(character, { variant: 'full', outfits });
  assert.match(persona, /星辰刺绣/, `persona injection contains the applied appearance; got: ${persona.slice(0, 300)}`);
  // 同项再买：拒绝且不收费
  assert.throws(() => applyOption('dress_one', 'salon-2'), err => err.code === 'EFFECT_ALREADY_ACTIVE');
  // 不同项：同槽位互斥，旧项提前到期
  now.value += 60000;
  const op2 = applyOption('dress_two', 'salon-3');
  assert.equal(op2.status, 'committed');
  assert.ok(!getActiveOutfits(characterId).limited.some(o => o.name === '星尘长裙'),
    'old slot entry expired when a new option applied');
  assert.ok(getActiveOutfits(characterId).limited.some(o => o.name === '晨雾披风'));

  // 状态模板（temporary_state）2026-10-07 暂时弃用：注册表不再提供该模板，配置编译不出这类功能，
  // 但执行器仍为存量建筑保留（运行时按已编译的 executorKey 分发），故直接对执行器做回归。
  now.value += 60000;
  const { applyTemporaryState } = await import('../src/services/town/buildingFeatures/state.js');
  const affinityBefore = db.prepare('SELECT affinity FROM user_relationships').all();
  const snapshotsBefore = db.prepare('SELECT count(*) n FROM emotion_snapshots').get().n;
  applyTemporaryState(db, characterId, 'energy',
    { durationHours: 6, label: '元气满满', sourceRef: 'state-unit-1' });
  assert.match(getActiveBuffBlock(characterId), /元气满满|精力充沛/, 'state enters the chat persona buff block');
  assert.deepEqual(db.prepare('SELECT affinity FROM user_relationships').all(), affinityBefore,
    'no affinity writes');
  assert.equal(db.prepare('SELECT count(*) n FROM emotion_snapshots').get().n, snapshotsBefore,
    'no VAD snapshot writes');

  // 形态：互斥 + 到期恢复原形态（复用 itemScheduler 恢复链）
  now.value += 60000;
  const { createCharacterOutfit } = await import('../src/services/outfitService.js');
  createCharacterOutfit(characterId, { name: '原初形态', description: '原本的样子。' });
  db.prepare('UPDATE character_outfits SET enabled = 1 WHERE character_id = ?').run(characterId);
  const baseOutfit = db.prepare('SELECT id FROM character_outfits WHERE character_id = ? AND enabled = 1').get(characterId);
  assert.ok(baseOutfit, 'base form exists');
  const transformCompiled = await installCompiledConfig(env,
    sourceModule.resolveBuildingFeatureSource(env.runtime.getTownEconomyContext(), { mapId, locationKey: 'salon' }), {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '一间为客人做全身打理的美容小屋，别无其他',
    unsupported: [], resources: [],
    features: [{
      key: 'cat_form', templateId: 'temporary_transform', templateVersion: 1,
      title: '变身猫耳形态', description: '客人在更衣间变出猫耳与尾巴，几个小时后自动变回来。',
      evidence: { source: 'building.description', quote: '形态的临时改造' },
      priceTier: 'free',
      params: { durationHours: 6, options: [
        { key: 'cat_girl', label: '猫耳形态', appearance: '头顶冒出一对毛茸茸的三花猫耳，身后多出一条会轻轻摇摆的细长尾巴，瞳孔变成圆圆的竖线，说话尾音微微上扬。' },
      ] },
      presentation: { opening: '更衣间的帘子后面传来窸窸窣窣的声音， 等一会就能看到一个不一样的自己，别害羞。', success: '{targetName}变成了{optionLabel}。', empty: '更衣间今天整理中。' },
    }],
  });
  const transformQuote = runtime.quoteTownBuildingFeature({ mapId, locationKey: 'salon',
    featureId: transformCompiled.features[0].featureId,
    selection: { optionKey: 'cat_girl', targetActorKeys: [`char:${characterId}`] }, ...scope });
  const transformOp = runtime.executeTownBuildingFeature({ ...scope, mapId, locationKey: 'salon',
    featureId: transformCompiled.features[0].featureId, quoteId: transformQuote.quoteId,
    quoteExpiresAt: transformQuote.expiresAt, idempotencyKey: 'tf-1',
    selection: { optionKey: 'cat_girl', targetActorKeys: [`char:${characterId}`] } });
  assert.equal(transformOp.status, 'committed');
  const transform = db.prepare('SELECT * FROM character_outfits WHERE character_id = ? AND name = ?').get(characterId, '猫耳形态');
  assert.ok(transform?.enabled, 'transform active');
  const payload = JSON.parse(db.prepare(
    "SELECT payload_json FROM item_effects WHERE effect_key = 'transform' ORDER BY id DESC LIMIT 1").get().payload_json);
  assert.equal(payload.previousOutfitId, baseOutfit.id, 'restore chain points at the original form');
  // 到期恢复：沿用 itemScheduler 的恢复逻辑
  db.prepare("UPDATE item_effects SET expires_at = datetime('now', '-1 minute') WHERE effect_key = 'transform'")
    .run();
  const { restoreExpiredTransforms } = await import('../src/services/itemService.js');
  assert.equal(restoreExpiredTransforms(), 1, 'expired transform restored by the shared scheduler');
  assert.ok(db.prepare('SELECT enabled FROM character_outfits WHERE id = ?').get(baseOutfit.id).enabled,
    'original form re-enabled');
  assert.ok(!db.prepare('SELECT enabled FROM character_outfits WHERE id = ?').get(transform.id).enabled,
    'transform disabled after expiry');
});

test('temporary_state executor: same state refuses re-apply; different name replaces instead of stacking', async t => {
  // temporary_state 模板 2026-10-07 暂时弃用：注册表不再提供（生成/运行时的模板路径已测不到），
  // 但执行器仍为存量建筑保留，所以这里直接对执行器做回归，覆盖「同项拒绝 + 换名替换不叠加」。
  const env = await setupTownEnvironment(t);
  const { db } = env;
  const now = { value: Date.now() };
  t.mock.method(Date, 'now', () => now.value);
  const characterId = createResidentCharacter(env, { name: '青柠' });
  const { applyTemporaryState } = await import('../src/services/town/buildingFeatures/state.js');
  const activeBuildingStates = () => db.prepare(
    `SELECT count(*) n FROM item_effects e JOIN backpack_items i ON i.id = e.item_id
     WHERE e.character_id = ? AND e.effect_key = 'tipsy' AND i.owner_key = 'me' AND i.status = 'used'
       AND i.source_type = 'feature_state' AND e.expires_at > datetime('now')`).get(characterId).n;

  applyTemporaryState(db, characterId, 'tipsy',
    { durationHours: 6, label: '微醺茶', sourceRef: 'tea-1' });
  assert.equal(activeBuildingStates(), 1, 'state really applied');
  assert.ok(getActiveBuffBlock(characterId).includes('临时状态'), 'state injects through the shared buff block');

  // 同项仍在生效：拒绝再次落地（计划 §4.3「同项仍生效时禁止收费重用」）
  assert.throws(() => applyTemporaryState(db, characterId, 'tipsy',
    { durationHours: 6, label: '微醺茶', sourceRef: 'tea-2' }), err => err.code === 'EFFECT_ALREADY_ACTIVE');

  // 不同名称的同档案：替换而非叠加——轮换名称也无法借机续时
  now.value += 3600 * 1000;
  applyTemporaryState(db, characterId, 'tipsy',
    { durationHours: 6, label: '桃花酿茶', sourceRef: 'tea-3' });
  assert.equal(activeBuildingStates(), 1, 'same-profile building state replaced, not stacked');
  assert.ok(db.prepare(
    `SELECT i.name FROM item_effects e JOIN backpack_items i ON i.id = e.item_id
     WHERE e.character_id = ? AND i.source_type = 'feature_state' AND e.expires_at > datetime('now')`
  ).all(characterId).every(row => row.name === '桃花酿茶'), 'only the newest building state stays active');
});
