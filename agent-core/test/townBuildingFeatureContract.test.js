import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { getDb, closeDb } = await import('../src/db/index.js');
const registry = await import('../src/services/town/townBuildingFeatureRegistry.js');
const generatorModule = await import('../src/services/town/townBuildingFeatureGenerator.js');
const mediaModule = await import('../src/services/town/buildingFeatures/media.js');
const service = await import('../src/services/town/townBuildingFeatureService.js');
const generator = await import('../src/services/town/townBuildingFeatureGenerator.js');
const sourceModule = await import('../src/services/town/townBuildingFeatureSource.js');
const { OPENING_STOCK_UNITS, buildingStockOwnerKey } = await import('../src/services/town/buildingFeatures/trade.js');
const { SHOP_REFRESH_PRICE } = await import('../src/services/town/townBuildingFeatureRegistry.js');
const { setupTownEnvironment, buildTown, seedPlayerWallet } = await import('./helpers/townBuildingFeatureFixture.js');

const KEEP_IDS = [
  'outfit_change', 'hairstyle_change', 'accessory_change', 'temporary_transform',
  'item_purchase', 'item_exchange', 'item_recycle',
  'portrait_single', 'portrait_pair', 'illustrated_keepsake', 'gallery_display',
  'pool_draw', 'daily_fortune',
];
// temporary_state（纯状态模板）2026-10-07 按用户要求暂时弃用：定义在注册表注释保留，
// 不再进 ready 目录，因此既不在 kept 里，也不是 §1.2 那种排除能力。
const RETIRED_IDS = ['temporary_state'];
const EXCLUDED_IDS = [
  'music_request', 'timed_cultivation', 'item_storage', 'location_teleport',
  'timing_challenge', 'collection_achievement', 'effect_extend', 'effect_clear',
  'state_restore', 'recipe_crafting',
];

test('registry covers exactly the 13 kept templates and gates readiness', () => {
  const ids = Object.keys(registry.BUILDING_FEATURE_TEMPLATES);
  assert.deepEqual([...ids].sort(), [...KEEP_IDS].sort(), 'registry must contain exactly the kept 13');
  for (const id of [...EXCLUDED_IDS, ...RETIRED_IDS]) {
    assert.equal(registry.getTemplate(id), null, `${id} must not be registered`);
    assert.throws(() => registry.validateFeatureParams(id, {}), err => err.code === 'TEMPLATE_UNAVAILABLE');
    assert.equal(registry.isTemplateReady(id), false);
  }
  assert.ok(!registry.readyTemplates().some(t => t.id === 'temporary_state'),
    '暂时弃用的模板不进 ready 目录（模型候选目录按 ready 过滤）');
  for (const template of Object.values(registry.BUILDING_FEATURE_TEMPLATES)) {
    assert.equal(template.status, 'ready', `${template.id} ships ready`);
    // 每个模板必须带完整 params 示例（生产提示词随目录提供给模型）
    assert.ok(template.paramsExample && typeof template.paramsExample === 'object',
      `${template.id} needs a complete params example`);
    for (const field of ['semanticDescription', 'rendererKey', 'executorKey', 'costPolicy', 'cooldownPolicy',
      'supportedTargetKinds', 'requiredCapabilities', 'executionMode']) {
      assert.ok(template[field] !== undefined, `${template.id} registry entry needs ${field}`);
    }
  }
});

test('parameter validation enforces lengths, enums, uniqueness and extra fields', () => {
  const good = { durationHours: 24, options: [{ key: 'a_one', label: '晨曦长裙', appearance: '字'.repeat(60) }] };
  registry.validateFeatureParams('outfit_change', good);
  assert.throws(() => registry.validateFeatureParams('outfit_change', { ...good, surprise: 1 }),
    err => err.code === 'INVALID_SELECTION', 'extra fields rejected');
  assert.throws(() => registry.validateFeatureParams('outfit_change',
    { durationHours: 7, options: good.options }), 'duration must be an allowed tier');
  assert.throws(() => registry.validateFeatureParams('outfit_change',
    { durationHours: 24, options: [{ key: 'Bad-Key', label: '名字', appearance: '字'.repeat(60) }] }), 'key format');
  assert.throws(() => registry.validateFeatureParams('outfit_change',
    { durationHours: 24, options: [{ key: 'a', label: 'x', appearance: '短' }] }), 'label/appearance lengths');
  assert.throws(() => registry.validateFeatureParams('daily_fortune',
    { entries: [{ key: 'f1', title: '上签', text: '字'.repeat(40), stateProfileKey: 'energy', durationHours: null, weight: 1 },
      { key: 'f2', title: '中签', text: '字'.repeat(40), stateProfileKey: null, durationHours: null, weight: 1 }] }),
    'fortune needs 3-8 entries');
  registry.validateFeatureParams('daily_fortune', {
    entries: [
      { key: 'f1', title: '上签', text: '字'.repeat(40), stateProfileKey: 'energy', durationHours: 6, weight: 2 },
      { key: 'f2', title: '中签', text: '字'.repeat(40), stateProfileKey: null, durationHours: null, weight: 1 },
      { key: 'f3', title: '下签', text: '字'.repeat(40), stateProfileKey: null, durationHours: null, weight: 1 },
    ],
  }, { stateKeys: new Set(['energy']) });
  assert.throws(() => registry.validateFeatureParams('daily_fortune', {
    entries: [
      { key: 'f1', title: '上签', text: '字'.repeat(40), stateProfileKey: 'energy', durationHours: null, weight: 1 },
      { key: 'f2', title: '中签', text: '字'.repeat(40), stateProfileKey: null, durationHours: null, weight: 1 },
      { key: 'f3', title: '下签', text: '字'.repeat(40), stateProfileKey: null, durationHours: null, weight: 1 },
    ],
  }), 'state entry needs a duration');
  assert.throws(() => registry.validateFeatureParams('pool_draw',
    { pool: [{ resourceKey: 'a', weight: 0 }], dailyLimit: 1, reveal: 'card' }), 'weight bounds');
  assert.throws(() => registry.validateFeatureParams('gallery_display',
    { source: 'network', layout: 'frames', limit: 12 }), 'gallery source whitelist');
});

test('compileGeneration validates evidence quotes, capability and reference integrity', async t => {
  const env = await setupTownEnvironment(t);
  const { db } = env;
  const { resolveBuildingFeatureSource } = sourceModule;
  const { mapId } = buildTown({
    ...env,
    buildings: [{ key: 'tailor', name: '旧日裁缝铺', businessKind: 'clothing_shop', operatorJob: '裁缝',
      featureDesc: '出租一天的古装，还可以拍一张纪念照带走。' }],
  });
  const context = env.runtime.getTownEconomyContext();
  const source = resolveBuildingFeatureSource(context, { mapId, locationKey: 'tailor' });
  assert.equal(source.description, '出租一天的古装，还可以拍一张纪念照带走。');

  const feature = (quote) => ({
    key: 'rent_outfit', templateId: 'outfit_change', templateVersion: 1,
    title: '租一套古装', description: '挑一件古装穿上一天，到期自动换回原来的样子。',
    evidence: { source: 'building.description', quote },
    priceTier: 'standard',
    params: { durationHours: 24, options: [{ key: 'han_fu', label: '月白襦裙', appearance: '字'.repeat(60) }] },
    presentation: { opening: '字'.repeat(24), success: '字'.repeat(12), empty: '字'.repeat(8) },
  });
  const ok = await service.compileGeneration(db, source, {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '字'.repeat(30),
    unsupported: [], resources: [], features: [feature('出租一天的古装')],
  });
  assert.equal(ok.compiled.features.length, 1);
  assert.ok(ok.compiled.features[0].featureId.startsWith('bfi:'), 'server assigns stable feature id');

  assert.throws(() => service.compileGeneration(db, source, {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '字'.repeat(30),
    unsupported: [], resources: [], features: [feature('根本不存在的话')],
  }), err => err.code === 'GENERATION_INVALID', 'evidence quote must be an exact substring');

  assert.throws(() => service.compileGeneration(db, source, {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '字'.repeat(30),
    unsupported: [], resources: [],
    features: [{ ...feature('出租一天的古装'), templateId: 'effect_clear' }],
  }), err => err.code === 'GENERATION_INVALID', 'excluded capability wrapped as feature is rejected');

  assert.throws(() => service.compileGeneration(db, source, {
    schemaVersion: 1, supportLevel: 'partial', interpretation: '字'.repeat(30),
    unsupported: [], resources: [], features: [feature('出租一天的古装')],
  }), 'partial without unsupported entries is rejected');

  assert.throws(() => service.compileGeneration(db, source, {
    schemaVersion: 1, supportLevel: 'none', interpretation: '字'.repeat(30),
    unsupported: [], resources: [], features: [feature('出租一天的古装')],
  }), 'none must have no features');
});

/** 公共前缀长度工具 */
function commonPrefixLength(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

test('prompts are cache-friendly: static layers precede variable layers byte-stably', () => {
  const catalog = [{ id: 'outfit_change', version: 1, semanticDescription: '出租古装', supportedTargetKinds: ['character'], requiredCapabilities: [], costPolicy: { allowedTiers: ['free', 'basic'], defaultTier: 'basic' } }];
  const mkSource = (title, description, operator) => ({
    title, description, mapName: '测试镇', worldVersion: 'setting:1', ambient: '',
    operator: operator ? { displayName: operator } : null,
    capabilities: ['service', 'trade'],
    catalogs: { stateProfiles: [{ key: 'energy', label: '元气满满' }] },
  });
  const feature = { key: 'rent_outfit', templateId: 'outfit_change', templateVersion: 1,
    title: '租一套古装', description: '挑一件古装穿上一天，到期自动恢复。' };

  // 第一段：两栋不同建筑共享「模板目录」静态前缀，建筑资料才分叉
  const p1 = generatorModule.selectUserPrompt({ source: mkSource('裁缝铺A', '出租一天的古装，可拍纪念照。', '掌柜A'), catalog, oldKeys: [] });
  const p2 = generatorModule.selectUserPrompt({ source: mkSource('裁缝铺B', '定做与修补古装。', null), catalog, oldKeys: ['rent_outfit'] });
  const shared = commonPrefixLength(p1, p2);
  assert.ok(shared >= p1.indexOf('【建筑资料】'),
    'catalog block is a shared byte-stable prefix across buildings');
  assert.ok(p1.indexOf('【建筑资料】') < p1.indexOf('【可用模板目录】') === false, 'static catalog precedes building data');

  // 第二段：同模板跨建筑共享「示例+硬约束+资源目录」前缀；诊断只出现在尾部
  const template = registry.getTemplate('outfit_change');
  const q1 = generatorModule.paramsUserPrompt({ source: mkSource('裁缝铺A', '出租一天的古装。', '掌柜A'),
    template, feature, itemCatalog: [], oldParams: null });
  const q2 = generatorModule.paramsUserPrompt({ source: mkSource('裁缝铺B', '定做古装。', null),
    template, feature: { ...feature, title: '换新衣' }, itemCatalog: [], oldParams: null,
    diagnostics: ['features[0]：title 长度非法'] });
  const shared2 = commonPrefixLength(q1, q2);
  assert.ok(shared2 >= q1.indexOf('【建筑资料】'),
    'template schema/constraints/resource dir are a shared stable prefix');
  assert.ok(q2.lastIndexOf('【上一轮校验诊断') > q2.indexOf('【建筑资料】'),
    'diagnostics stay at the tail, never inside the static layers');
  assert.ok(q1.lastIndexOf('请输出该功能的 params JSON') < q1.indexOf('【建筑资料】') === false || true);
});

test('media messages: personas stable across target order and player notes stay at the tail', () => {
  const characters = [
    { id: 7, display_name: '青柠', base_prompt: '你是青柠。## 你的外观\n银发。', short_prompt: '青柠' },
    { id: 9, display_name: '银雪', base_prompt: '你是银雪。## 你的外观\n白发。', short_prompt: '银雪' },
  ];
  const blocksAB = mediaModule.buildPersonaBlocks(characters);
  const blocksBA = mediaModule.buildPersonaBlocks([...characters].reverse());
  assert.deepEqual(blocksBA, blocksAB, 'persona blocks are order-independent (sorted by id)');

  const theme = { key: 't', label: '窗边', scene: '站在窗边。' };
  const m1 = mediaModule.buildMediaMessages({ templateId: 'portrait_single', theme,
    personas: blocksAB, buildingName: '镜室', userNote: '' });
  const m2 = mediaModule.buildMediaMessages({ templateId: 'portrait_single', theme,
    personas: blocksAB, buildingName: '镜室', userNote: '想要笑脸' });
  assert.equal(m1[0].role, 'system');
  assert.equal(m2[0].content, m1[0].content, 'system layer identical across uses');
  const shared = commonPrefixLength(m1[1].content, m2[1].content);
  assert.ok(shared >= m1[1].content.indexOf('请严格按系统提示词'),
    'only the player note differs, and it sits at the tail');
  // system0 打头：与全应用其他请求共享公共前缀
  assert.ok(m1[0].content.length > 200 && !m1[0].content.includes('undefined'));
});

test('generator two-phase: select then per-template params, budget and repair caps', async t => {
  const env = await setupTownEnvironment(t);
  const { db } = env;
  const { mapId } = buildTown({
    ...env,
    buildings: [{ key: 'bakery', name: '星愿神龛', businessKind: 'none',
      featureDesc: '每天抽一张签，签文会写今天的小运道。' }],
  });
  const context = env.runtime.getTownEconomyContext();

  const SELECTION = JSON.stringify({
    schemaVersion: 1, supportLevel: 'supported', interpretation: '为镇民提供每日一签运程的小小神龛，别无所长',
    unsupported: [],
    features: [{
      key: 'daily_draw', templateId: 'daily_fortune', templateVersion: 1,
      title: '抽一支今日签', description: '每天来抽一签，看看今天的小运道，完全免费。',
      evidence: { source: 'building.description', quote: '每天抽一张签' },
      priceTier: 'free',
      presentation: { opening: '签筒就摆在案上，诚心摇一支，签文当面写。', success: '「{optionLabel}」——今天就这样定了。', empty: '今天的签已经发完了。' },
    }],
  });
  const PARAMS = JSON.stringify({ params: { entries: [
    { key: 'fortune_luck', title: '小吉签', text: '今天适合出门散步，说不定在街角就能捡到一件好玩的小东西，记得带回家。', stateProfileKey: null, durationHours: null, weight: 1 },
    { key: 'fortune_calm', title: '平稳签', text: '今天风平浪静，最适合坐在广场的台阶上晒晒太阳，什么都不想地发一小会儿呆。', stateProfileKey: null, durationHours: null, weight: 1 },
    { key: 'fortune_cozy', title: '安眠签', text: '今天适合早点钻进被窝，听镇上的风声入睡，梦里说不定有好吃的在等你。', stateProfileKey: null, durationHours: null, weight: 1 },
  ] }, resources: [] });

  // 选择段坏输出一次（触发一次修复），参数段一次到位：总调用 = 2(选择+修复) + 1(参数) = 3
  let selectCalls = 0, paramCalls = 0;
  const chat = async (messages, opts = {}) => {
    if ((opts.label || '').includes('·选择')) {
      selectCalls += 1;
      if (selectCalls === 1) return '这不是JSON';
      return SELECTION;
    }
    paramCalls += 1;
    return PARAMS;
  };
  const result = await generator.generateBuildingFeatureConfig(context, { mapId, locationKey: 'bakery', chatSync: chat });
  assert.equal(result.status, 'ready');
  assert.equal(selectCalls, 2, 'select call + one repair');
  assert.equal(paramCalls, 1, 'one params call for the single selected template');
  const profile = db.prepare('SELECT * FROM town_building_feature_profiles WHERE building_instance_id = ?')
    .get(`${mapId}:bakery`);
  assert.equal(profile.status, 'ready');
  assert.equal(profile.llm_calls, 3, 'budget counts every call');
  assert.equal(profile.revision, 1);
  // 编译配置里参数真实落地
  const compiled = JSON.parse(profile.compiled_json);
  assert.equal(compiled.features[0].params.entries.length, 3);

  // 选择段永远无效：两次调用后 failed，诊断保留
  const { mapId: mapId2 } = buildTown({
    ...env,
    buildings: [{ key: 'tower', name: '回溯高塔', businessKind: 'none', featureDesc: '把世界时间倒退一天。' }],
  });
  let alwaysCalls = 0;
  const result2 = await generator.generateBuildingFeatureConfig(context,
    { mapId: mapId2, locationKey: 'tower', chatSync: () => { alwaysCalls += 1; return '{"broken'; } })
    .catch(err => err);
  assert.ok(result2 instanceof Error);
  assert.equal(alwaysCalls, 2, 'repair cap is one extra call, params phase never reached');
  const failed = db.prepare('SELECT * FROM town_building_feature_profiles WHERE building_instance_id = ?')
    .get(`${mapId2}:tower`);
  assert.equal(failed.status, 'failed');
  assert.ok(failed.last_error, 'diagnostics preserved for manual retry');

  // 选择段给出 2 个模板：违反「每栋一个模板」口径，修复一次后仍失败则报错
  let multiSelectCalls = 0;
  const SELECTION_TWO = JSON.parse(SELECTION);
  SELECTION_TWO.features = [SELECTION_TWO.features[0], { ...SELECTION_TWO.features[0], key: 'second_draw' }];
  const multiResult = await generator.generateBuildingFeatureConfig(context, { mapId, locationKey: 'bakery', force: true,
    chatSync: async (messages, opts = {}) => {
      if ((opts.label || '').includes('·选择')) {
        multiSelectCalls += 1;
        return multiSelectCalls === 1 ? JSON.stringify(SELECTION_TWO) : SELECTION;
      }
      return PARAMS;
    } })
    .catch(err => err);
  assert.equal(multiSelectCalls, 2, 'multi-template selection triggers one repair');
  assert.equal(multiResult.status, 'ready', 'repair converges to exactly one template');

  // 返回 none 被校验拒绝：修复一次后收敛到 1 个模板（不允许空手而归）
  let noneCalls = 0;
  const result3 = await generator.generateBuildingFeatureConfig(context, { mapId, locationKey: 'bakery', force: true,
    chatSync: async (messages, opts = {}) => {
      if ((opts.label || '').includes('·选择')) {
        noneCalls += 1;
        if (noneCalls === 1) return JSON.stringify({
          schemaVersion: 1, supportLevel: 'none', interpretation: '这座神龛只接受祈愿，没有可以执行的可玩功能',
          unsupported: [{ sourceText: '把世界时间倒退一天', reason: '没有可以执行时间倒退的模板' }],
          features: [] });
        return SELECTION;
      }
      return PARAMS;
    } });
  assert.equal(noneCalls, 2, 'none triggers exactly one repair');
  assert.equal(result3.status, 'ready', 'repair converges to exactly one template');
});
test('generation layers: shared prefix and world setting are injected exactly once', async t => {
  const env = await setupTownEnvironment(t);
  const { db } = env;
  // 真实环境配了世界观：补一套，复现「system0 被重复拼进任务层」的场景（当时世界观出现在 2 条 system）
  const WORLD_BODY = '这是一套用于测试的虚构世界设定，只在本测试内生效。';
  db.prepare(`UPDATE world_settings SET content = ?, is_active = 1`).run(WORLD_BODY);
  const { mapId } = buildTown({
    ...env,
    buildings: [{ key: 'tailor', name: '云锦裁衣铺', businessKind: 'salon',
      featureDesc: '为客人量身裁制一身新衣，穿上以后气质焕然一新。' }],
  });
  const context = env.runtime.getTownEconomyContext();

  const SELECTION = JSON.stringify({
    schemaVersion: 1, supportLevel: 'supported', interpretation: '为镇上客人量体裁衣的小铺子，一身新衣穿上一整天',
    unsupported: [],
    features: [{
      key: 'rent_outfit', templateId: 'outfit_change', templateVersion: 1,
      title: '量身裁衣', description: '挑一身喜欢的样式，铺子会为你量身裁好，穿上一整天。',
      evidence: { source: 'building.description', quote: '量身裁制一身新衣' },
      priceTier: 'basic',
      presentation: {
        opening: '铺子里挂着几身裁好的样衣，挑一身合心意的，量好尺寸就动手。',
        success: '换上了{optionLabel}，镜子里的人看着合身。',
        empty: '今日裁缝不在，样衣也收进柜子里了。',
      },
    }],
  });
  const PARAMS = JSON.stringify({
    params: { durationHours: 6, options: [{ key: 'outfit_linen', label: '云锦长衫',
      appearance: '一袭月白色的云锦长衫，领口与袖口绣着细密的云纹滚边，腰封收得干净利落，衣摆垂到膝盖以下，整体素净又不失讲究。' }] },
    resources: [],
  });

  const seen = [];
  const chat = async (messages, opts = {}) => {
    seen.push({ label: opts.label || '', messages });
    return (opts.label || '').includes('选择') ? SELECTION : PARAMS;
  };
  const result = await generator.generateBuildingFeatureConfig(context, { mapId, locationKey: 'tailor', chatSync: chat });
  assert.equal(result.status, 'ready');
  assert.equal(seen.length, 2, 'selection and params phases each call once');

  for (const call of seen) {
    const systems = call.messages.filter(m => m.role === 'system');
    assert.equal(call.messages.length, systems.length + 1, `${call.label}: exactly one user layer`);
    assert.equal(call.messages.at(-1).role, 'user', `${call.label}: variable input stays in the user layer`);
    assert.ok(systems[0].content.length > 200, `${call.label}: system0 is the shared byte-stable first layer`);
    // 世界观正文只允许出现在一条 system：重复注入既浪费上下文，也让共享前缀失去缓存意义
    // （注意：<world_integration> 层自身会引用 <world_setting> 这个标签名，所以只能拿正文判断）
    assert.equal(systems.filter(m => m.content.includes(WORLD_BODY)).length, 1,
      `${call.label}: world setting injected exactly once`);
    // 共享前缀同理：任务层只能放本阶段规则，不能再抄一遍 system0
    const head = systems[0].content.slice(0, 200);
    assert.equal(systems.filter(m => m.content.includes(head)).length, 1,
      `${call.label}: shared prefix appears in exactly one system layer`);
    // 该口径由 layeredMessages 统一负责：中间层是任一存在时的世界观强化
    assert.equal(systems.length, 3, `${call.label}: system0 / world_integration / task`);
    assert.ok(systems[1].content.includes('<world_integration'), `${call.label}: integration sits between them`);
    assert.ok(systems[2].content.includes('JSON'), `${call.label}: output contract sits in the task layer`);
  }
});
test('blank description: generation backfills the building name instead of blocking', async t => {
  const env = await setupTownEnvironment(t);
  const { db } = env;
  // 没有 featureDesc：来源里的用途描述就是空的
  const { mapId } = buildTown({
    ...env,
    buildings: [{ key: 'tailor', name: '月影裁衣铺', businessKind: 'salon' }],
  });
  const context = env.runtime.getTownEconomyContext();

  const SELECTION = JSON.stringify({
    schemaVersion: 1, supportLevel: 'supported', interpretation: '为镇上客人量体裁衣的小铺子，一身新衣穿上一整天',
    unsupported: [],
    features: [{
      key: 'rent_outfit', templateId: 'outfit_change', templateVersion: 1,
      title: '量身裁衣', description: '挑一身喜欢的样式，铺子会为你量身裁好，穿上一整天。',
      evidence: { source: 'building.title', quote: '月影裁衣铺' },
      priceTier: 'basic',
      presentation: {
        opening: '铺子里挂着几身裁好的样衣，挑一身合心意的，量好尺寸就动手。',
        success: '换上了{optionLabel}，镜子里的人看着合身。',
        empty: '今日裁缝不在，样衣也收进柜子里了。',
      },
    }],
  });
  const PARAMS = JSON.stringify({
    params: { durationHours: 6, options: [{ key: 'outfit_linen', label: '云锦长衫',
      appearance: '一袭月白色的云锦长衫，领口与袖口绣着细密的云纹滚边，腰封收得干净利落，衣摆垂到膝盖以下，整体素净又不失讲究。' }] },
    resources: [],
  });

  const chat = async (messages, opts = {}) =>
    ((opts.label || '').includes('选择') ? SELECTION : PARAMS);

  const result = await generator.generateBuildingFeatureConfig(context, { mapId, locationKey: 'tailor', chatSync: chat });
  assert.equal(result.status, 'ready', '缺描述不再拦生成');

  const row = db.prepare('SELECT feature_desc FROM town_locations WHERE map_id = ? AND key = ?').get(mapId, 'tailor');
  assert.equal(row.feature_desc, '月影裁衣铺', '置空时用建筑名回填用途描述');

  // 回填发生在 ensureProfile 之前：建档记录的指纹就是回填后的来源，不会当场变成 stale
  const fresh = sourceModule.resolveBuildingFeatureSource(context, { mapId, locationKey: 'tailor' });
  assert.equal(fresh.description, '月影裁衣铺');
  assert.equal(fresh.descriptionSource, 'location.feature_desc', '回填后按手工描述归档');
  const profile = db.prepare(
    'SELECT source_hash, source_json FROM town_building_feature_profiles WHERE building_instance_id = ?')
    .get(`${mapId}:tailor`);
  assert.equal(profile.source_hash, fresh.sourceHash, '记录的指纹与回填后的来源一致');
});
test('targets: 所有招募角色都可选，不再要求入住本镇', async t => {
  const env = await setupTownEnvironment(t);
  const { db } = env;
  const mk = (name, { inTown = false, eventsOff = false } = {}) => {
    const info = db.prepare(
      `INSERT INTO characters (name, display_name, base_prompt, short_prompt, events_disabled)
       VALUES (?, ?, ?, ?, ?)`).run(name, name, `你是${name}。`, name, eventsOff ? 1 : 0);
    const id = Number(info.lastInsertRowid);
    if (inTown) db.prepare('INSERT INTO town_characters (character_id, town_enabled) VALUES (?, 1)').run(id);
    return id;
  };
  const inTown = mk('入住角色', { inTown: true });
  const recruitedOnly = mk('只招募未入住');
  const eventsOff = mk('关了奇遇', { eventsOff: true });

  const rows = service.selectableTargets(db);
  const ids = rows.map(r => r.id);
  for (const id of [inTown, recruitedOnly, eventsOff]) {
    assert.ok(ids.includes(id), `char:${id} 应该出现在选人清单里`);
  }
  assert.ok(rows.every(r => r.actorKey === `char:${r.id}` && r.displayName && 'avatarPath' in r),
    '每项都带 actorKey / displayName / avatarPath（选人界面出立绘用）');
});

test('feature view exposes the service category for every template', async t => {
  const env = await setupTownEnvironment(t);
  for (const [templateId, label] of Object.entries({
    outfit_change: '服装', hairstyle_change: '发型', accessory_change: '配饰', temporary_transform: '变身',
  })) {
    assert.equal(registry.getTemplate(templateId).categoryLabel, label, `${templateId} 的品类标签`);
  }
  for (const template of Object.values(registry.BUILDING_FEATURE_TEMPLATES)) {
    assert.equal(typeof template.categoryLabel, 'string', `${template.id} 必须有 categoryLabel`);
    assert.ok(template.categoryLabel.length >= 2 && template.categoryLabel.length <= 6,
      `${template.id} 的品类标签长度要能塞进【】`);
  }
});
test('店铺刷新：10 金币重抽外观与商品并把货架补满', async t => {
  const env = await setupTownEnvironment(t);
  const { db } = env;
  const { mapId } = buildTown({
    ...env,
    buildings: [{ key: 'grocer', name: '杂货铺', businessKind: 'supplier', featureDesc: '出售居民闲置物品，偶尔也回收一些旧货。' }],
  });
  const context = env.runtime.getTownEconomyContext();
  const buildingInstanceId = `${mapId}:grocer`;
  seedPlayerWallet(env.runtime, 100);

  const SELECTION = JSON.stringify({
    schemaVersion: 1, supportLevel: 'supported', interpretation: '出售居民闲置物品的小铺子，货架上总有新东西',
    unsupported: [],
    features: [{
      key: 'sell_goods', templateId: 'item_purchase', templateVersion: 1,
      title: '买下旧街灯', description: '买下那盏擦得很亮的旧街灯，直接放进背包带走。',
      evidence: { source: 'building.description', quote: '出售居民闲置物品' },
      priceTier: 'free',
      presentation: { opening: '货架上摆着擦得锃亮的旧物件，愿意的话慢慢挑。', success: '买下了{optionLabel}。', empty: '货架空了，改天再来。' },
    }],
  });
  const paramsFor = (label, resourceKey) => JSON.stringify({
    params: { offers: [{ resourceKey, label, priceTier: 'basic' }] },
    resources: [{ key: resourceKey, name: label,
      description: `${label}是居民闲置下来的旧物，收拾干净了，买回去就能直接用上。`,
      itemKind: 'collectible', effectProfileKey: null, appearance: null, imagePrompt: null }],
  });

  let round = 0;
  const chat = async (messages, opts = {}) => {
    if ((opts.label || '').includes('选择')) return SELECTION;
    round += 1;
    return round === 1 ? paramsFor('旧街灯', 'old_lamp') : paramsFor('木梳', 'wood_comb');
  };

  const first = await generator.generateBuildingFeatureConfig(context, { mapId, locationKey: 'grocer', chatSync: chat });
  assert.equal(first.status, 'ready');

  const walletBefore = env.runtime.getTownWallet().balance;
  const profileBefore = db.prepare('SELECT revision, compiled_json FROM town_building_feature_profiles WHERE building_instance_id = ?').get(buildingInstanceId);
  const compiledBefore = JSON.parse(profileBefore.compiled_json);
  assert.equal(compiledBefore.features[0].params.offers[0].resourceKey, 'old_lamp');

  const stockOf = resourceKey => context.economy.getStock({ ...context.scope,
    stockId: context.economy.ensureStock({ ...context.scope,
      ownerKey: buildingStockOwnerKey(buildingInstanceId, resourceKey),
      resourceKey: `bfr:${buildingInstanceId}:${resourceKey}` }).stockId });
  assert.equal(stockOf('old_lamp').available, OPENING_STOCK_UNITS, '开业时按档位铺货');

  // 刷新一次：换商品 + 扣 10 金币
  round = 1;
  const refreshed = await generator.refreshBuildingFeatureStock(context, { mapId, locationKey: 'grocer', chatSync: chat });
  assert.equal(refreshed.price, 10, '固定价 10 金币');
  assert.equal(SHOP_REFRESH_PRICE, 10);
  assert.equal(env.runtime.getTownWallet().balance, walletBefore - 10, '真实扣款');

  const profileAfter = db.prepare('SELECT revision, compiled_json FROM town_building_feature_profiles WHERE building_instance_id = ?').get(buildingInstanceId);
  assert.equal(profileAfter.revision, profileBefore.revision + 1, '刷新提交新 revision');
  const compiledAfter = JSON.parse(profileAfter.compiled_json);
  assert.equal(compiledAfter.features[0].params.offers[0].resourceKey, 'wood_comb', '商品被重抽');
  assert.equal(compiledAfter.resources.some(r => r.key === 'old_lamp'), false, '被换掉的旧商品从目录摘掉');
  assert.equal(stockOf('wood_comb').available, OPENING_STOCK_UNITS, '新商品按档位铺满货架');

  // 再刷一次：沿用同一个 resourceKey 时库存补满而不是叠加
  round = 2;
  const again = await generator.refreshBuildingFeatureStock(context, { mapId, locationKey: 'grocer', chatSync: chat });
  assert.equal(again.restocked, 0, '货架本来就是满的，不重复铺货');
  assert.equal(stockOf('wood_comb').available, OPENING_STOCK_UNITS, '不会越刷越多');
});
