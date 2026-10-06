// 店铺浏览器实测种子脚本（独立临时库 + 13 栋建筑各装一个模板 + 玩家金币/背包/画廊历史）。
// temporary_state（纯状态模板）2026-10-07 暂时弃用，已从注册表与下方种子清单移除。
// 用法：node seed-shop-browser-test.mjs && 独立端口启动：
//   DB_PATH="<下方打印的路径>" PORT=3277 FEATURE_TOWN_LLM=false FEATURE_TOWN_AUTO_LLM=false \
//   FEATURE_EVENTS=false FEATURE_PROACTIVE_CHAT=false FEATURE_WEATHER=false FEATURE_SCHEDULE=false \
//   FEATURE_MEMORY=false FEATURE_EMOTION=false FEATURE_GROUP_CHAT=false node app.js
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const DB_PATH = path.join(os.tmpdir(), 'shop-browser-test.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(DB_PATH + suffix, { force: true }); } catch { /* fresh start */ }
}
process.env.DB_PATH = DB_PATH;
process.env.FEATURE_TOWN_LLM = 'false';
process.env.FEATURE_TOWN_AUTO_LLM = 'false';
process.env.FEATURE_EVENTS = 'false';
process.env.FEATURE_EVENT_FREQ = '0';
process.env.FEATURE_PROACTIVE_CHAT = 'false';
process.env.FEATURE_WEATHER = 'false';
process.env.FEATURE_SCHEDULE = 'false';
process.env.FEATURE_MEMORY = 'false';
process.env.FEATURE_EMOTION = 'false';
process.env.FEATURE_GROUP_CHAT = 'false';

const { getDb, closeDb } = await import('./src/db/index.js');
const { saveMap } = await import('./src/services/town/townMapService.js');
const runtime = await import('./src/services/town/townEconomyRuntime.js');
const sourceModule = await import('./src/services/town/townBuildingFeatureSource.js');
const { createResidentCharacter, installCompiledConfig, seedPlayerWallet } =
  await import('./test/helpers/townBuildingFeatureFixture.js');

const db = getDb();
const env = { db, runtime };
const ctx = () => runtime.getTownEconomyContext();
const worldId = db.prepare('SELECT world_id FROM town_world_state WHERE singleton = 1').get().world_id;
db.prepare(`INSERT OR IGNORE INTO item_templates
  (world_id, template_id, version, effect_key, name, description, payload_json, rarity, image_url, tradable)
  VALUES (?, 'mood_patch', 1, 'mood_fix', '心情修补贴', '贴一下就会开心起来的小贴片。', '{}', 'common', NULL, 1)`)
  .run(worldId);

const SHOPS = [
  { key: 'outfit_hall', name: '裁衣铺', businessKind: 'salon', template: 'outfit_change',
    desc: '为客人换上一套合身的衣裳，穿一天正好。' },
  { key: 'hair_salon', name: '梳篦店', businessKind: 'salon', template: 'hairstyle_change',
    desc: '这里的梳篦师傅手艺极好，换个发型精神一天。' },
  { key: 'gem_shop', name: '珠翠阁', businessKind: 'salon', template: 'accessory_change',
    desc: '挑一件称心的配饰，别在身上一天。' },
  { key: 'mask_stage', name: '幻形戏台', businessKind: 'salon', template: 'temporary_transform',
    desc: '上台走一遭，变个形态娱乐一天。' },
  { key: 'grocery', name: '杂货铺', businessKind: 'supplier', template: 'item_purchase',
    desc: '出售居民日常小物，货架空了等补货。' },
  { key: 'swap_post', name: '易物斋', businessKind: 'supplier', template: 'item_exchange',
    desc: '一件指定物品换一件摊上旧货，童叟无欺。' },
  { key: 'buyback', name: '旧货回收摊', businessKind: 'supplier', template: 'item_recycle',
    desc: '按行情回收闲置旧物，当场付金币。' },
  // temporary_state 2026-10-07 暂时弃用（注册表已下线该模板，installCompiledConfig 会拒编译）
  // { key: 'tea_house', name: '茶语轩', businessKind: 'cafe', template: 'temporary_state',
  //   desc: '一杯下肚，说话都带上三分状态。' },
  { key: 'photo_studio', name: '写真馆', businessKind: 'none', template: 'portrait_single',
    desc: '选一个场景，为客人拍一张单人纪念照。' },
  { key: 'pair_pavilion', name: '合影亭', businessKind: 'none', template: 'portrait_pair',
    desc: '两位访客并肩站好，拍一张合影留念。' },
  { key: 'card_shop', name: '纪品坊', businessKind: 'none', template: 'illustrated_keepsake',
    desc: '把回忆排成一张可以收藏的纪念卡片。' },
  { key: 'gallery', name: '回廊画廊', businessKind: 'none', template: 'gallery_display',
    desc: '展示店里拍过的作品，只看不卖。' },
  { key: 'lucky_machine', name: '命运抽奖机', businessKind: 'supplier', template: 'pool_draw',
    desc: '投币转动一次，从有限奖池拿走一件。' },
  { key: 'shrine', name: '星愿神龛', businessKind: 'none', template: 'daily_fortune',
    desc: '每天抽一张签，签文写今天的小运道。' },
];

const grid = () => Array.from({ length: 10 }, () => Array(24).fill(null));
const places = SHOPS.map((shop, i) => ({
  key: shop.key, name: shop.name, businessKind: shop.businessKind,
  x: (i % 7) * 3 + 1, y: Math.floor(i / 7) * 3 + 1, radius: 3,
}));
const { mapId } = saveMap({
  name: '店铺实测镇', cols: 24, rows: 10, create: true,
  layers: { ground: grid(), road: grid(), objects: [] }, locations: places,
});
for (const shop of SHOPS) {
  db.prepare('UPDATE town_locations SET feature_desc = ? WHERE map_id = ? AND key = ?')
    .run(shop.desc, mapId, shop.key);
}
db.prepare("INSERT OR REPLACE INTO town_players(id,display_name,grid_x,grid_y,map_id) VALUES('me','旅人',2,8,?)").run(mapId);

createResidentCharacter(env, { name: '青柠' });
createResidentCharacter(env, { name: '银雪' });

const appearanceOption = key => [{ key: `${key}_one`, label: '晨曦样式', appearance: '一身浅色的晨曦长裙，裙摆绣着细密的云纹，腰间系一条柔软的鹅黄丝带，行动轻便，不改变发型、物种与人物身份。' }];
const CONFIGS = {
  outfit_change: {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '一间为客人换装打理的晨曦裁衣铺，只租一天，到期自动归还，别无其他。',
    unsupported: [], resources: [],
    features: [{ key: 'makeover', templateId: 'outfit_change', templateVersion: 1,
      title: '换一套晨曦装', description: '挑一套喜欢的衣裳，店里为你打理到位，穿一天正好。',
      evidence: { source: 'building.title', quote: '裁衣铺' }, priceTier: 'basic',
      params: { durationHours: 24, options: appearanceOption('outfit') },
      presentation: { opening: '衣架上的晨曦装在灯下泛着柔光，换上试试？', success: '{targetName}换上了{optionLabel}。', empty: '今天裁缝不在。' } }],
  },
  hairstyle_change: {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '一间只做发型的梳篦店，铜镜与梳篦齐备，手艺极好，别无其他。',
    unsupported: [], resources: [],
    features: [{ key: 'makeover', templateId: 'hairstyle_change', templateVersion: 1,
      title: '梳一个新发式', description: '让梳篦师傅给你换个新发型，挑喜欢的样式，精神一整天。',
      evidence: { source: 'building.title', quote: '梳篦店' }, priceTier: 'basic',
      params: { durationHours: 24, options: appearanceOption('hair') },
      presentation: { opening: '铜镜和梳篦都备好了，坐下来慢慢挑一个喜欢的样式。', success: '{targetName}梳起了{optionLabel}。', empty: '发型师不在。' } }],
  },
  accessory_change: {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '一间只出租配饰的珠翠阁，绒布托盘里的物件件擦得发亮，别无其他。',
    unsupported: [], resources: [],
    features: [{ key: 'makeover', templateId: 'accessory_change', templateVersion: 1,
      title: '挑一件配饰', description: '从绒布托盘里选一件喜欢的配饰别上，点缀一整天，到期归还。',
      evidence: { source: 'building.title', quote: '珠翠阁' }, priceTier: 'standard',
      params: { durationHours: 6, options: appearanceOption('accessory') },
      presentation: { opening: '绒布托盘里的配饰闪着微微的光，挑一件喜欢的？', success: '{targetName}戴上了{optionLabel}。', empty: '掌柜不在。' } }],
  },
  temporary_transform: {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '一座可以临时变装登台的幻形戏台，谢幕后恢复原样，别无其他。',
    unsupported: [], resources: [],
    features: [{ key: 'makeover', templateId: 'temporary_transform', templateVersion: 1,
      title: '登台变个装', description: '上台走一遭，临时换一个形态，谢幕之后自动恢复原样。',
      evidence: { source: 'building.title', quote: '幻形戏台' }, priceTier: 'premium',
      params: { durationHours: 6, options: appearanceOption('form') },
      presentation: { opening: '戏台的幕布后光影流动，上台变个装要试试吗？', success: '{targetName}化上了{optionLabel}。', empty: '戏班不在。' } }],
  },
  item_purchase: {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '出售居民日常小物的杂货铺，兼卖一点怀旧小货',
    unsupported: [], resources: [{
      key: 'old_lamp', name: '旧街灯', description: '一盏擦得很亮的小旧街灯，据说到了晚上会发出暖黄色的光。',
      itemKind: 'collectible', effectProfileKey: null, appearance: null, imagePrompt: null,
    }],
    features: [{ key: 'sell_goods', templateId: 'item_purchase', templateVersion: 1,
      title: '买下旧街灯', description: '买下那盏擦得很亮的旧街灯，直接放进背包带走。',
      evidence: { source: 'building.description', quote: '货架空了等补货' }, priceTier: 'free',
      params: { offers: [{ resourceKey: 'old_lamp', label: '旧街灯', priceTier: 'basic' }] },
      presentation: { opening: '货架上摆着擦得锃亮的旧物件，愿意的话慢慢挑。', success: '{targetName}买下了{optionLabel}。', empty: '货架空了，改天再来。' } }],
  },
  item_exchange: {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '用一件指定物品换一件摊上收藏小旧货的交换小摊，童叟无欺',
    unsupported: [], resources: [{
      key: 'old_lamp', name: '旧街灯', description: '一盏擦得很亮的小旧街灯，据说到了晚上会发出暖黄色的光。',
      itemKind: 'collectible', effectProfileKey: null, appearance: null, imagePrompt: null,
    }],
    features: [{ key: 'swap', templateId: 'item_exchange', templateVersion: 1,
      title: '以物换物', description: '拿一件心情修补贴来，换走柜台上的一件小旧货。',
      evidence: { source: 'building.description', quote: '一件指定物品' }, priceTier: 'free',
      params: { offers: [{ acceptCatalogKey: 'catalog_mood_patch', giveResourceKey: 'old_lamp', label: '换走旧街灯' }] },
      presentation: { opening: '柜台边摆着装换物的小筐，规矩是一件换一件，童叟无欺。', success: '{targetName}换到了{optionLabel}。', empty: '换物筐空了。' } }],
  },
  item_recycle: {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '收购街坊闲置旧物并按行情付金币的回收小铺，绝不高价收',
    unsupported: [], resources: [],
    features: [{ key: 'recycle', templateId: 'item_recycle', templateVersion: 1,
      title: '卖掉闲置', description: '把不需要的旧物卖给铺子，按行情换几个金币。',
      evidence: { source: 'building.description', quote: '当场付金币' }, priceTier: 'free',
      params: { acceptCatalogKeys: ['catalog_mood_patch'], valuationTier: 'premium' },
      presentation: { opening: '掌柜眯着眼睛打量来客的背包，看有没有能收的旧货。', success: '收下了{itemName}，付了{price}金币。', empty: '今天不收货。' } }],
  },
  // temporary_state 2026-10-07 暂时弃用（模板已从注册表注释下线；恢复模板时一并取消注释）
  // temporary_state: {
  //   schemaVersion: 1, supportLevel: 'supported', interpretation: '一杯下肚整个人都会带上状态的小茶舍，甜味里带着刺激感，仅此而已。',
  //   unsupported: [], resources: [],
  //   features: [{ key: 'cheer_up', templateId: 'temporary_state', templateVersion: 1,
  //     title: '来份元气糖', description: '吃一颗店里特制的元气糖，整个人元气满满几个小时。',
  //     evidence: { source: 'building.description', quote: '带上三分状态' }, priceTier: 'free',
  //     params: { durationHours: 6, options: [
  //       { key: 'cheerful', label: '元气满满', stateProfileKey: 'energy', flavor: '一颗橙黄色的圆糖，甜味里带着气泡水的刺激感。' },
  //     ] },
  //     presentation: { opening: '柜台上的小糖罐闪闪发光，取一颗含在嘴里，整个人都精神起来。', success: '{targetName}吃下了{optionLabel}。', empty: '糖罐空了。' } }],
  // },
  portrait_single: {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '给客人拍单人纪念照的老铺写真馆，木窗边光线正好，仅此而已。',
    unsupported: [], resources: [],
    features: [{ key: 'portrait', templateId: 'portrait_single', templateVersion: 1,
      title: '拍一张纪念照', description: '选一个场景，由店铺为客人拍一张纪念照，当场取走。',
      evidence: { source: 'building.description', quote: '拍一张单人纪念照' }, priceTier: 'basic',
      params: { themes: [{ key: 'by_window', label: '窗边纪念照', scene: '客人站在老铺子的木窗边，下午的光线落在肩上，像一次普通的到店留念。' }],
        allowUserNote: true, userNoteMaxChars: 200 },
      presentation: { opening: '木窗边光线正好，想拍一张纪念照吗？坐好不要动。', success: '照片洗好了，请收好，常来。', empty: '画师今天休息。' } }],
  },
  portrait_pair: {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '供两位访客并肩合影留念的木亭，光线正好，别无其他。',
    unsupported: [], resources: [],
    features: [{ key: 'pair_photo', templateId: 'portrait_pair', templateVersion: 1,
      title: '亭下合影', description: '两位访客一起站到亭前，由亭子为你们拍一张合影留念。',
      evidence: { source: 'building.description', quote: '拍一张合影留念' }, priceTier: 'free',
      params: { themes: [{ key: 'pavilion_pair', label: '亭下合影', scene: '两位访客并肩站在木亭前，远处是安静的小镇街景，像一次随手的留念。' }],
        allowUserNote: false, userNoteMaxChars: 200 },
      presentation: { opening: '亭前的光线正好，两位一起站好，咔嚓一声就不要动了。', success: '合影拍好了，请收好，两位慢走。', empty: '合影亭今天闭馆。' } }],
  },
  illustrated_keepsake: {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '把客人的回忆排成可长期收藏纪念卡的纪品坊，仅此而已。',
    unsupported: [], resources: [],
    features: [{ key: 'card', templateId: 'illustrated_keepsake', templateVersion: 1,
      title: '做一张纪念卡', description: '把今天的回忆排成一张可以长期收藏的纪念卡片，带走的纪念。',
      evidence: { source: 'building.description', quote: '收藏的纪念卡片' }, priceTier: 'free',
      params: { formats: ['postcard'], themes: [{ key: 'card_one', label: '小镇纪念卡', scene: '纪品坊出品的纪念卡片，边框印着细密的云纹花纹，留白处用清秀的小字写上今天的祝语。' }],
        allowUserNote: true, userNoteMaxChars: 200 },
      presentation: { opening: '桌上摆着现成的卡片纸和一瓶墨水，可以慢慢挑一张喜欢的。', success: '卡片做好了，文字由店里排版，请收好。', empty: '卡片纸用完了。' } }],
  },
  gallery_display: {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '回廊两侧挂着装裱好的照片，展示店里拍过的作品，只看不卖。',
    unsupported: [], resources: [],
    features: [{ key: 'frames', templateId: 'gallery_display', templateVersion: 1,
      title: '看看展出的作品', description: '回廊里挂着店里拍过的照片，装裱整齐，慢慢看，只看不卖。',
      evidence: { source: 'building.description', quote: '展示店里拍过的作品' }, priceTier: 'free',
      params: { source: 'building_outputs', layout: 'frames', limit: 12 },
      presentation: { opening: '回廊两侧挂着装裱好的照片，慢慢看，喜欢可以常来。', success: '欢迎常来看看新的作品。', empty: '还没有作品。' } }],
  },
  pool_draw: {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '投币转动一次，就能从有限奖池里拿走一件小货的抽奖机，每日限量。',
    unsupported: [], resources: [
      { key: 'prize_a', name: '海星发卡', description: '一枚海星形状的发卡，别在头发上会轻轻闪。', itemKind: 'collectible', effectProfileKey: null, appearance: null, imagePrompt: null },
      { key: 'prize_b', name: '贝壳哨子', description: '一枚能吹出海浪声的小贝壳哨子，握在手里凉凉的。', itemKind: 'collectible', effectProfileKey: null, appearance: null, imagePrompt: null },
    ],
    features: [{ key: 'lucky_machine', templateId: 'pool_draw', templateVersion: 1,
      title: '转动抽奖机', description: '投币转动抽奖机，从今日奖池里拿走抽中的一件。',
      evidence: { source: 'building.description', quote: '从有限奖池' }, priceTier: 'basic',
      params: { pool: [{ resourceKey: 'prize_a', weight: 1 }, { resourceKey: 'prize_b', weight: 3 }],
        dailyLimit: 3, reveal: 'card' },
      presentation: { opening: '抽奖机的玻璃橱窗里摆满了小货品，投一枚金币就能转动一次。', success: '「{itemName}」归你了！', empty: '今日奖池已经空了。' } }],
  },
  daily_fortune: {
    schemaVersion: 1, supportLevel: 'supported', interpretation: '每天抽一支签看看今日小运道的小神龛，仅此而已',
    unsupported: [], resources: [],
    features: [{ key: 'daily_draw', templateId: 'daily_fortune', templateVersion: 1,
      title: '抽一支今日签', description: '每天抽一支签，看看今天的小运道如何，完全免费。',
      evidence: { source: 'building.description', quote: '每天抽一张签' }, priceTier: 'free',
      params: { entries: [
        { key: 'fortune_luck', title: '小吉签', text: '今天适合出门散步，说不定在街角就能捡到一件好玩的小东西，记得带回家慢慢研究。', stateProfileKey: null, durationHours: null, weight: 1 },
        { key: 'fortune_calm', title: '平稳签', text: '今天风平浪静，最适合搬个小凳坐在广场台阶上晒晒太阳，什么都想，也什么都不想。', stateProfileKey: null, durationHours: null, weight: 1 },
        { key: 'fortune_cozy', title: '安眠签', text: '今天适合早点钻进被窝，听窗外的风声慢慢入睡，梦里说不定还有一桌好吃的在等你。', stateProfileKey: null, durationHours: null, weight: 1 },
      ] },
      presentation: { opening: '签筒就摆在案上，诚心摇一支，今日的签文由神龛亲笔写就。', success: '「{optionLabel}」——今天就这样定了。', empty: '今天的签已经发完了。' } }],
  },
};

const compiledByShop = {};
for (const shop of SHOPS) {
  const source = sourceModule.resolveBuildingFeatureSource(ctx(), { mapId, locationKey: shop.key });
  const compiled = await installCompiledConfig(env, source, CONFIGS[shop.template]);
  compiledByShop[shop.key] = compiled;
  console.log(`[seed] ${shop.key} (${shop.template}) -> ${compiled.features.map(f => f.featureId).join(',')}`);
}

seedPlayerWallet(runtime, 10000);
for (let i = 0; i < 2; i++) {
  db.prepare(`INSERT INTO backpack_items (effect_key, name, description, rarity, status, payload_json, owner_key,
      source_type, world_id, source_id, source_index, template_id, collected_at, acquired_at, version)
     VALUES ('mood_fix', ?, '贴一下就会开心起来。', 'common', 'ready', '{}', 'me',
       'trade', ?, 'shop-test-seed', ?, 'mood_patch', datetime('now'), datetime('now'), 1)`)
    .run(i === 0 ? '心情修补贴·甲' : '心情修补贴·乙', worldId, i + 1);
}

const svg = label => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#d8c7a8"/><rect x="12" y="12" width="296" height="216" fill="none" stroke="#8a5a2b" stroke-width="8"/><text x="160" y="128" font-size="28" text-anchor="middle" fill="#5a3d1e" font-family="sans-serif">${label}</text></svg>`
).toString('base64');
const galleryFeatureId = compiledByShop.gallery.features[0].featureId;
const { worldEpoch } = ctx().scope;
for (const [n, caption] of [['壹', '窗边的午后'], ['贰', '亭下时光']]) {
  db.prepare(`INSERT INTO town_building_feature_operations
    (operation_id, world_id, world_epoch, map_id, building_instance_id, feature_id, profile_revision,
     template_id, template_version, player_actor_id, idempotency_key, request_digest, status, output_json)
    VALUES (?, ?, ?, ?, ?, ?, 1,
     'portrait_single', 1, 'me', ?, 'seed', 'committed', ?)`)
    .run(`seed-op-${n}`, worldId, worldEpoch, mapId, `${mapId}:gallery`, galleryFeatureId, `seed-${n}`,
      JSON.stringify({ imageUrl: `data:image/svg+xml;base64,${svg(`作品 ${n}`)}`, caption }));
}

console.log('[seed] wallet =', runtime.getTownWallet().balance);
console.log('[seed] done. DB =', DB_PATH);
closeDb();
