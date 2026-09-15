import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw Error(`player sprite fixture forbids network: ${url}`); };

const { config } = await import('../src/config.js');
config.llm.baseURL = 'http://127.0.0.1:9/v1';
config.llm.apiKey = 'player-sprite-refresh-test';
config.comfyui.url = 'http://127.0.0.1:9';
const { resetClient } = await import('../src/llm/llm-client.js');
resetClient();
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const { broadcastTownAssetsUpdated } = await import('../src/services/town/townBus.js');
const { saveMap } = await import('../src/services/town/townMapService.js');

function seedAsset(db, key) {
  const info = db.prepare(`INSERT INTO town_assets (kind, key, name, image_path, meta_json, status)
    VALUES ('player', ?, ?, ?, '{}', 'ready')`).run(key, key, `/town-assets/${key}.png`);
  return db.prepare('SELECT * FROM town_assets WHERE id = ?').get(Number(info.lastInsertRowid));
}

// 「我」的小人贴图清单只在装载那一刻算过一次：向导阶段（还没开镇、没有运行实例）里补生成的
// 正面小人不会被算进去，开镇用 reloadMap 重建地图时也不会重算 —— 结果素材库里有图，
// 地图上「我」朝下走却是占位色块。回归口径：装载后再出的小人，开镇后必须能渲染出来。
test('开镇前补生成的玩家小人也能进渲染清单', async t => {
  config.dbPath = ':memory:';
  config.features.town = true; config.features.townLLM = false;
  Object.assign(config.town, { economyEnabled: false, liquidityEnabled: false,
    playerSpeed: 1, npcSpeed: 1, maxActiveEncounters: 0, timeZone: 'Asia/Shanghai' });
  const db = getDb();
  t.after(() => { town.stopTownScheduler(); closeDb(); });

  // 1) 装载时只有背面小人（正面是后来在向导第 7 步补出来的）
  seedAsset(db, 'player_up');
  town.startTownScheduler();
  town.touchTownViewer();

  // 2) 还没有小镇、地图也没有：这时补出正面小人，素材服务提交后会广播
  const down = seedAsset(db, 'player_down');
  broadcastTownAssetsUpdated({ asset: down });

  // 3) 开镇（与 POST /init/confirm 同口径：saveMap + reloadMap + travelPlayer）
  const grid = () => Array.from({ length: 8 }, () => Array(8).fill(null));
  const { mapId } = saveMap({ create: true, name: '新镇', cols: 8, rows: 8,
    layers: { ground: grid(), road: grid(), objects: [] },
    locations: [{ key: 'plaza', name: '广场', x: 0, y: 0, radius: 1 }] });
  assert.equal(town.reloadMap(mapId).ok, true);
  town.travelPlayer({ targetMapId: mapId });

  const player = town.getTownState().player;
  assert.ok(player, '开镇后快照里要有玩家');
  assert.equal(player.sprites?.down, '/town-assets/player_down.png');
  assert.equal(player.sprites?.up, '/town-assets/player_up.png');
});
