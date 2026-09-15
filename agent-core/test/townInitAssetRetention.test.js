import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DB_PATH = ':memory:';
// 向导存档指到临时文件，测试不碰 agent-core/data/town/init-state.json
const STATE_FILE = path.join(os.tmpdir(), `town-init-asset-retention-${process.pid}.json`);
process.env.TOWN_INIT_STATE_PATH = STATE_FILE;
globalThis.fetch = async url => { throw Error(`asset retention fixture forbids network: ${url}`); };

const { config } = await import('../src/config.js');
// 蓝图这一步一定要打模型，端点指到打不通的本地端口：清库发生在它之前，失败即可
config.llm.baseURL = 'http://127.0.0.1:9/v1';
config.llm.apiKey = 'asset-retention-test';
config.comfyui.url = 'http://127.0.0.1:9';
const { resetClient } = await import('../src/llm/llm-client.js');
resetClient();
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const init = await import('../src/services/town/townInitService.js');

function seedAsset(db, kind, key) {
  db.prepare(`INSERT INTO town_assets (kind, key, name, image_path, meta_json, status)
    VALUES (?, ?, ?, ?, '{}', 'ready')`).run(kind, key, key, `/town-assets/${key}.png`);
}

// 「生成蓝图」这一步在世界还没有任何地图时会整库清空素材（旧世界的地皮/建筑/居民素材不能混进新镇）。
// 回归背景：这条清库 SQL 把「我」的形象（player_*）与所有角色的小镇素材（char_{id}_portrait /
// char_{id}_down|up）也一起清了。玩家形象消失后向导第 7 步只剩空槽；角色素材清掉后管理面板全员
// 掉回「spirit 0/2 · 空槽」，重新入住还得整批重烧生图。地皮 / 建筑 / 居民（npc_*）仍然随世界清。
test('重建世界清空素材库时保留玩家形象与角色素材，清掉地图/居民/地皮素材', async t => {
  config.dbPath = ':memory:';
  config.features.town = true; config.features.townLLM = false;
  Object.assign(config.town, { economyEnabled: false, liquidityEnabled: false, maxActiveEncounters: 0, timeZone: 'Asia/Shanghai' });
  const db = getDb();
  t.after(() => { town.stopTownScheduler(); closeDb(); if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE); });

  // 玩家形象：立绘 + 正/背小人
  seedAsset(db, 'player', 'player_down');
  seedAsset(db, 'player', 'player_up');
  seedAsset(db, 'portrait', 'player_portrait');
  // 角色素材：立绘 + 正/背小人（char_* 与 npc_* 同为 kind 'npc'，只能按 key 前缀区分保留）
  seedAsset(db, 'portrait', 'char_1_portrait');
  seedAsset(db, 'npc', 'char_1_down');
  seedAsset(db, 'npc', 'char_1_up');
  seedAsset(db, 'portrait', 'char_2_portrait');
  seedAsset(db, 'npc', 'char_2_down');
  seedAsset(db, 'npc', 'char_2_up');
  // 旧世界美术资产：地图地皮 + 建筑 + 居民——这些随世界一起清
  seedAsset(db, 'ground', 'grass_meadow_01');
  seedAsset(db, 'building', 'cafe');
  seedAsset(db, 'npc', 'npc_1_down');
  seedAsset(db, 'portrait', 'npc_1_portrait');

  await init.startInit({ npcCount: 3, mapCols: 30, mapRows: 30 }).catch(() => {});

  const keys = db.prepare('SELECT key FROM town_assets ORDER BY key').all().map(r => r.key);
  assert.deepEqual(keys, [
    'char_1_down', 'char_1_portrait', 'char_1_up',
    'char_2_down', 'char_2_portrait', 'char_2_up',
    'player_down', 'player_portrait', 'player_up',
  ]);
});
