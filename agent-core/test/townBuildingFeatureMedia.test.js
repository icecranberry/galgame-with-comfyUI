import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const runtime = await import('../src/services/town/townBuildingFeatureRuntime.js');
const sourceModule = await import('../src/services/town/townBuildingFeatureSource.js');
const {
  setupTownEnvironment, buildTown, createResidentCharacter, installCompiledConfig,
  arriveAt, seedPlayerWallet,
} = await import('./helpers/townBuildingFeatureFixture.js');

const VALID_MEDIA = JSON.stringify({
  caption: '在裁缝铺的木窗边，两人披着新裁的古装合影，光线像下午三点一样暖。',
  imagePrompt: 'two girls wearing traditional hanfu dresses standing side by side at a wooden window inside an old tailor shop, warm afternoon sunlight falling on their shoulders, soft pastel colors, gentle smiles, detailed fabric texture with delicate embroidery, shelves of folded cloth behind them, cozy nostalgic atmosphere, high quality anime illustration style',
});

function portraitConfig(templateId, { key = 'portrait' } = {}) {
  return {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '出租古装的裁缝铺，还可以拍一张纪念照带走留念',
    unsupported: [], resources: [],
    features: [{
      key, templateId, templateVersion: 1,
      title: '拍一张纪念照', description: '选一个场景，由店铺为客人拍一张纪念照，当场取走。',
      evidence: { source: 'building.description', quote: '拍一张纪念照' },
      priceTier: 'basic',
      params: { themes: [{ key: 'by_window', label: '窗边纪念照',
        scene: '两位客人站在老铺子的木窗边，下午的光线落在肩上，像一次普通的到店留念。' }],
        allowUserNote: true, userNoteMaxChars: 200 },
      presentation: { opening: '木窗边光线正好，想拍一张纪念照吗？坐好不要动。', success: '照片洗好了，请收好。', empty: '画师今天休息。' },
    }],
  };
}

async function pollOperation(operationId, { timeoutMs = 4000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = runtime.getTownBuildingFeatureOperation(operationId);
    if (['committed', 'failed', 'cancelled'].includes(last.status)) return last;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return last;
}

test('portrait_single: reserve, one LLM + one image, failure releases, retry reuses caption', async t => {
  const env = await setupTownEnvironment(t);
  const { db } = env;
  const now = { value: Date.now() };
  t.mock.method(Date, 'now', () => now.value);
  const { mapId, places } = buildTown({
    ...env,
    buildings: [{ key: 'tailor', name: '旧日裁缝铺', businessKind: 'clothing_shop', operatorJob: '裁缝',
      featureDesc: '出租一天的古装，还可以拍一张纪念照带走。' }],
  });
  const characterId = createResidentCharacter(env, { name: '青柠' });
  const source = sourceModule.resolveBuildingFeatureSource(env.runtime.getTownEconomyContext(), { mapId, locationKey: 'tailor' });
  const compiled = await installCompiledConfig(env, source, portraitConfig('portrait_single'));
  const featureId = compiled.features[0].featureId;
  seedPlayerWallet(env.runtime, 100);
  const { scope } = await arriveAt(env, now, places[0]);

  // 目标校验：非角色 / 重复目标被拒绝
  assert.throws(() => runtime.quoteTownBuildingFeature({ mapId, locationKey: 'tailor', featureId,
    selection: { optionKey: 'by_window', targetActorKeys: ['npc:999'] }, ...scope }),
    err => err.code === 'TARGET_UNSUPPORTED');
  assert.throws(() => runtime.quoteTownBuildingFeature({ mapId, locationKey: 'tailor', featureId,
    selection: { optionKey: 'by_window', targetActorKeys: [`char:${characterId}`, `char:${characterId}`] }, ...scope }),
    err => err.code === 'INVALID_SELECTION', 'same character twice rejected');

  // 注入模拟 LLM 与生图（runtime 提供者注入点）
  let llmCalls = 0, imageCalls = 0, imageFail = true;
  runtime.setBuildingFeatureProviderOverrides({
    chat: async () => { llmCalls += 1; return VALID_MEDIA; },
    generatePortraitImage: async () => {
      imageCalls += 1;
      if (imageFail) throw Object.assign(new Error('画师打翻了墨水'), { code: 'GENERATION_FAILED' });
      return { url: '/images/building_features/test-portrait.png', filename: 'test-portrait.png' };
    },
  });

  const balance = () => env.runtime.getTownWallet().balance;
  const before = balance();
  const quote = runtime.quoteTownBuildingFeature({ mapId, locationKey: 'tailor', featureId,
    selection: { optionKey: 'by_window', targetActorKeys: [`char:${characterId}`], userNote: '想要笑脸' }, ...scope });
  assert.equal(quote.price, 5, 'basic tier');
  const op = runtime.executeTownBuildingFeature({ ...scope, mapId, locationKey: 'tailor', featureId,
    quoteId: quote.quoteId, quoteExpiresAt: quote.expiresAt, idempotencyKey: 'pic-1',
    selection: { optionKey: 'by_window', targetActorKeys: [`char:${characterId}`], userNote: '想要笑脸' } });
  assert.equal(op.status, 'generating', 'generative operation starts asynchronously');
  const failed = await pollOperation(op.operationId);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.errorCode, 'GENERATION_FAILED');
  assert.equal(llmCalls, 1, 'LLM called exactly once');
  assert.equal(imageCalls, 1);
  assert.equal(balance(), before, 'failure releases the reservation');

  // 重试：不再调用 LLM（复用 caption/prompt），生图成功后结算
  imageFail = false;
  now.value += 60000;
  const retried = runtime.retryTownBuildingFeatureOperation(op.operationId);
  assert.ok(['pending', 'generating'].includes(retried.status), `retry resumes: ${retried.status} ${retried.errorCode || ''} ${retried.errorMessage || ''}`);
  const done = await pollOperation(op.operationId);
  assert.equal(done.status, 'committed', `retry should commit: ${done.errorCode} ${done.errorMessage}`);
  assert.equal(llmCalls, 1, 'retry never re-calls the LLM');
  assert.equal(imageCalls, 2, 'image regenerated once on retry');
  assert.equal(done.result.imageUrl, '/images/building_features/test-portrait.png');
  assert.equal(balance(), before - 5, 'settled after success');

  // 终态不可重试/取消；幂等重放同一操作
  assert.throws(() => runtime.retryTownBuildingFeatureOperation(op.operationId),
    err => err.code === 'OPERATION_NOT_FAILED');
  assert.throws(() => runtime.cancelTownBuildingFeatureOperation(op.operationId),
    err => err.code === 'OPERATION_UNAVAILABLE');
  const replay = runtime.executeTownBuildingFeature({ ...scope, mapId, locationKey: 'tailor', featureId,
    quoteId: quote.quoteId, quoteExpiresAt: quote.expiresAt, idempotencyKey: 'pic-1',
    selection: { optionKey: 'by_window', targetActorKeys: [`char:${characterId}`], userNote: '想要笑脸' } });
  assert.equal(replay.operationId, op.operationId);
  assert.equal(balance(), before - 5);
});

test('pair keepsake and gallery: two personas once, program layout, read-only gallery', async t => {
  const env = await setupTownEnvironment(t);
  const { db } = env;
  const now = { value: Date.now() };
  t.mock.method(Date, 'now', () => now.value);
  // 单模板口径：合影、纪念卡分属两栋建筑，画廊挂在合影建筑上
  const { mapId, places } = buildTown({
    ...env,
    buildings: [
      { key: 'mirror', name: '映身镜室', businessKind: 'none',
        featureDesc: '让两位访客在镜前留下合影，也可以看看别人留下的照片。' },
      { key: 'card_shop', name: '卡片工坊', businessKind: 'none',
        featureDesc: '把今天的合影做成一张可以收藏的纪念卡片。' },
    ],
  });
  const characterA = createResidentCharacter(env, { name: '青柠' });
  const characterB = createResidentCharacter(env, { name: '银雪' });
  const mirrorSource = sourceModule.resolveBuildingFeatureSource(env.runtime.getTownEconomyContext(), { mapId, locationKey: 'mirror' });
  const cardSource = sourceModule.resolveBuildingFeatureSource(env.runtime.getTownEconomyContext(), { mapId, locationKey: 'card_shop' });
  const pairCompiled = await installCompiledConfig(env, mirrorSource, {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '供两位访客在镜前合影留念的镜室，兼作展示',
    unsupported: [], resources: [],
    features: [{
      key: 'pair_photo', templateId: 'portrait_pair', templateVersion: 1,
      title: '镜前合影', description: '两位访客一起站到大镜子前面，由镜室为你们拍一张合影留念。',
      evidence: { source: 'building.description', quote: '让两位访客在镜前留下合影' },
      priceTier: 'free',
      params: { themes: [{ key: 'mirror_pair', label: '镜前合影', scene: '两位访客并肩站在大镜子前，镜面边缘泛着淡淡的微光，像在注视来客。' }],
        allowUserNote: false, userNoteMaxChars: 200 },
      presentation: { opening: '大镜子擦得雪亮，两位一起站好就不要动了。', success: '合影拍好了，请收好。', empty: '镜室今天闭馆。' },
    }],
  });
  const cardCompiled = await installCompiledConfig(env, cardSource, {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '把客人的合影排成可长期收藏纪念卡的卡片工坊，仅此而已',
    unsupported: [], resources: [],
    features: [{
      key: 'card', templateId: 'illustrated_keepsake', templateVersion: 1,
      title: '做一张纪念卡', description: '把今天的合影排成一张可以长期收藏的纪念卡片，带走的纪念。',
      evidence: { source: 'building.description', quote: '做成一张可以收藏的纪念卡片' },
      priceTier: 'free',
      params: { formats: ['postcard'], themes: [{ key: 'card_one', label: '镜室纪念卡', scene: '镜室出品的纪念卡片，边框印着细密的云纹花纹，留白处用清秀的小字写上今天的祝语。' }],
        allowUserNote: true, userNoteMaxChars: 200 },
      presentation: { opening: '桌上摆着现成的卡片纸和一瓶墨水，可以慢慢挑一张喜欢的。', success: '卡片做好了，文字由店里排版，请收好。', empty: '卡片纸用完了。' },
    }],
  });
  const pairFeature = pairCompiled.features[0];
  const cardFeature = cardCompiled.features[0];
  await arriveAt(env, now, places[0]);

  let llmCalls = 0;
  runtime.setBuildingFeatureProviderOverrides({
    chat: async () => { llmCalls += 1; return VALID_MEDIA; },
    generatePortraitImage: async () =>
      ({ url: '/images/building_features/pair.png', filename: 'pair.png' }),
  });

  // allowUserNote=false 时拒绝携带补充文字
  assert.throws(() => runtime.quoteTownBuildingFeature({ mapId, locationKey: 'mirror', featureId: pairFeature.featureId,
    selection: { optionKey: 'mirror_pair', targetActorKeys: [`char:${characterA}`, `char:${characterB}`], userNote: '笑一点' }, ...env.runtime.getTownEconomyContext().scope }),
    err => err.code === 'INVALID_SELECTION');

  const scope = env.runtime.getTownEconomyContext().scope;
  const quote = runtime.quoteTownBuildingFeature({ mapId, locationKey: 'mirror', featureId: pairFeature.featureId,
    selection: { optionKey: 'mirror_pair', targetActorKeys: [`char:${characterA}`, `char:${characterB}`] }, ...scope });
  const op = runtime.executeTownBuildingFeature({ ...scope, mapId, locationKey: 'mirror',
    featureId: pairFeature.featureId, quoteId: quote.quoteId, quoteExpiresAt: quote.expiresAt,
    idempotencyKey: 'pair-1', selection: { optionKey: 'mirror_pair', targetActorKeys: [`char:${characterA}`, `char:${characterB}`] } });
  const done = await pollOperation(op.operationId);
  assert.equal(done.status, 'committed');
  assert.equal(llmCalls, 1, 'one LLM call covers both personas');
  assert.equal(done.result.targets.length, 2, 'two distinct personas composed');

  // 纪念卡：免费也走同一管线，产物带 format 标记（排版由前端程序完成）
  now.value += 60000;
  await arriveAt(env, now, places[1]);
  const cardQuote = runtime.quoteTownBuildingFeature({ mapId, locationKey: 'card_shop', featureId: cardFeature.featureId,
    selection: { optionKey: 'card_one', targetActorKeys: [`char:${characterA}`], userNote: '写上今天的日期' }, ...scope });
  const cardOp = runtime.executeTownBuildingFeature({ ...scope, mapId, locationKey: 'card_shop',
    featureId: cardFeature.featureId, quoteId: cardQuote.quoteId, quoteExpiresAt: cardQuote.expiresAt,
    idempotencyKey: 'card-1', selection: { optionKey: 'card_one', targetActorKeys: [`char:${characterA}`], userNote: '写上今天的日期' } });
  const cardDone = await pollOperation(cardOp.operationId);
  assert.equal(cardDone.status, 'committed');
  assert.equal(cardDone.result.format, 'postcard');

  // gallery：只读展示本建筑已提交产物；玩家侧无图时为空态；展示绝不触发生图
  const media = await import('../src/services/town/buildingFeatures/media.js');
  const items = media.galleryItems(db, { buildingInstanceId: `${mapId}:mirror`, source: 'building_outputs', limit: 12 });
  assert.equal(items.length, 1, 'committed media outputs appear in the gallery');
  const playerItems = media.galleryItems(db, { buildingInstanceId: `${mapId}:mirror`, source: 'player_selected', limit: 12 });
  assert.ok(Array.isArray(playerItems));
});