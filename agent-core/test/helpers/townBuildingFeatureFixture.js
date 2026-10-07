/**
 * 建筑功能测试夹具：内存库 + 真实生产入口 + 注入式 LLM/生图。
 * 遵循 docs/testing.md：不碰用户实际钱包、角色或素材。
 */
import assert from 'node:assert/strict';
import { getTemplate } from '../../src/services/town/townBuildingFeatureRegistry.js';

export async function setupTownEnvironment(t) {
  process.env.DB_PATH = ':memory:';
  globalThis.fetch = async () => { throw new Error('Network forbidden'); };
  const { config } = await import('../../src/config.js');
  const { getDb, closeDb } = await import('../../src/db/index.js');
  const town = await import('../../src/services/town/townService.js');
  const runtime = await import('../../src/services/town/townEconomyRuntime.js');
  const { saveMap } = await import('../../src/services/town/townMapService.js');
  const { createNpc } = await import('../../src/services/town/townNpcService.js');
  const { reconcileTownResponsibilities } = await import('../../src/services/town/townResponsibilityRuntime.js');
  config.features.town = true;
  config.features.townLLM = false;
  config.features.events = true;
  config.features.townBuildingFeatures = true;
  const db = getDb();
  t.after(() => { town.stopTownScheduler(); closeDb(); });
  return { config, db, town, runtime, saveMap, createNpc, reconcileTownResponsibilities };
}

/** 建一张带建筑地点的图（可选：为地点挂素材行与图层对象，供描述回填测试） */
export function buildTown({ db, saveMap, createNpc, town, buildings, withAssets = false, assetDesc }) {
  const grid = () => Array.from({ length: 14 }, () => Array(14).fill(null));
  const places = buildings.map((building, i) => ({
    key: building.key, name: building.name, businessKind: building.businessKind || 'none',
    x: (i % 3) * 5, y: Math.floor(i / 3) * 5, radius: 0,
    ...(building.featureDesc ? {} : {}),
  }));
  const objects = [];
  const assets = [];
  if (withAssets) {
    places.forEach((place, i) => { place.objectId = i + 1; });
    buildings.forEach((building, i) => {
      const assetId = (buildTown.assetIdCounter = (buildTown.assetIdCounter || 100)) + i;
      buildTown.assetIdCounter += 1;
      // special 默认 true 保持既有测试行为；显式传 special:false 模拟普通建筑
      assets.push({ id: assetId, key: building.key, name: building.name,
        meta: { desc: assetDesc?.[building.key] ?? null, special: building.special !== false } });
      objects.push({ id: i + 1, assetId, assetKey: building.key, x: places[i].x, y: places[i].y });
    });
  }
  const { mapId } = saveMap({ name: `建筑功能测试镇#${buildTown.counter = (buildTown.counter || 0) + 1}`,
    cols: 14, rows: 14, create: true,
    layers: { ground: grid(), road: grid(), objects }, locations: places });
  for (const asset of assets) {
    db.prepare(`INSERT INTO town_assets (id, kind, key, name, image_path, meta_json, status)
      VALUES (?, 'building', ?, ?, '', ?, 'ready')`)
      .run(asset.id, asset.key, asset.name, JSON.stringify(asset.meta));
  }
  // 用户手填用途描述（来源优先级第 1 位）
  for (const building of buildings) {
    if (building.featureDesc != null) {
      db.prepare('UPDATE town_locations SET feature_desc = ? WHERE map_id = ? AND key = ?')
        .run(building.featureDesc, mapId, building.key);
    }
  }
  if (buildings.some(b => b.operatorJob)) {
    buildings.forEach((building, i) => {
      if (!building.operatorJob) return;
      createNpc({ mapId, displayName: `${building.name}掌柜`, job: building.operatorJob });
      const npcId = db.prepare('SELECT max(id) id FROM town_npcs').get().id;
      db.prepare('UPDATE town_npcs SET workplace_key = ? WHERE id = ?').run(building.key, npcId);
    });
  }
  db.prepare("INSERT OR IGNORE INTO town_players(id,display_name,grid_x,grid_y) VALUES('me','玩家',0,0)").run();
  town.startTownScheduler();
  return { mapId, places };
}

/** 建一位入住正式角色（外观/状态/画像模板的合法目标） */
export function createResidentCharacter({ db }, { name, basePrompt, shortPrompt }) {
  const info = db.prepare(
    `INSERT INTO characters (name, display_name, base_prompt, short_prompt) VALUES (?, ?, ?, ?)`)
    .run(name, name, basePrompt || `你是${name}。## 你的外观\n银发少女。`, shortPrompt || `${name}，测试角色`);
  const characterId = Number(info.lastInsertRowid);
  db.prepare('INSERT INTO town_characters (character_id, town_enabled) VALUES (?, 1)').run(characterId);
  return characterId;
}

/** 用真实编译器安装一份已通过校验的配置（绕过 LLM，专测执行面；交易模板附带开业库存） */
export async function installCompiledConfig(env, source, generated, { status } = {}) {
  const db = env.db;
  const { compileGeneration } = await import('../../src/services/town/townBuildingFeatureService.js');
  const { ensureOpeningResources } = await import('../../src/services/town/buildingFeatures/trade.js');
  const { compiled } = compileGeneration(db, source, generated);
  const revision = 1;
  compiled.revision = revision;
  const featureIds = Object.fromEntries(compiled.features.map(f => [f.key, f.featureId]));
  db.transaction(() => {
    db.prepare(
      `INSERT INTO town_building_feature_profiles
       (world_id, world_epoch, map_id, location_id, building_instance_id, status, source_json, source_hash,
        schema_version, registry_version, generated_json, compiled_json, revision, feature_ids_json,
        resource_bindings_json, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(world_id, world_epoch, building_instance_id) DO UPDATE SET
         status = excluded.status, source_hash = excluded.source_hash, compiled_json = excluded.compiled_json,
         generated_json = excluded.generated_json, revision = excluded.revision,
         feature_ids_json = excluded.feature_ids_json, generated_at = excluded.generated_at`)
      .run(source.worldId, source.worldEpoch, source.mapId, source.locationId, source.buildingInstanceId,
        status || (compiled.supportLevel === 'partial' ? 'partial' : 'ready'),
        JSON.stringify(source), source.sourceHash, JSON.stringify(generated), JSON.stringify(compiled),
        revision, JSON.stringify(featureIds),
        JSON.stringify(Object.fromEntries(compiled.resources.map(r => [r.key, r]))));
  }).immediate();
  // 与生产生成器同口径：交易类功能激活时做一次性开业配置（幂等）
  const tradeFeatures = compiled.features.filter(f => ['operator', 'operator_stock'].includes(getTemplate(f.templateId)?.resourceRequirements));
  if (tradeFeatures.length) {
    const { economy, scope } = env.runtime.getTownEconomyContext();
    const resourceKeys = new Set();
    for (const feature of tradeFeatures) {
      (feature.params.offers || feature.params.pool || []).forEach(o => resourceKeys.add(o.resourceKey || o.giveResourceKey));
    }
    ensureOpeningResources({ db, economy, scope: { ...scope, idempotencyKey: `install:${source.buildingInstanceId}` },
      buildingInstanceId: source.buildingInstanceId, resourceKeys: [...resourceKeys] });
  }
  return compiled;
}

/** 给玩家钱包一次性注入金币（economy.seed 幂等，seedVersion 区分批次） */
export function seedPlayerWallet(runtime, amount = 1000) {
  const { scope, economy, player } = runtime.getTownEconomyContext();
  const account = economy.ensureAccount({ ...scope, ownerKey: `actor:${player.actorId}`,
    accountType: 'actor', actorId: player.actorId });
  economy.seed({ ...scope, accountId: account.accountId, amount, seedVersion: 1,
    idempotencyKey: `test-seed-player:${amount}`, reasonCode: 'TEST_SEED' });
  return runtime.getTownWallet().balance;
}

/** 把玩家送到建筑门口（与 townInteractionRuntime.test 同口径） */
export async function arriveAt({ town, runtime }, nowRef, place) {
  const { scope, player } = runtime.getTownEconomyContext();
  const result = town.movePlayerTo(place.x, place.y);
  assert.equal(result.ok, true);
  nowRef.value += result.pathLength * 1000 + 1;
  assert.equal(town.getTownActorPosition(player.actorId).moving, false);
  return { scope, player };
}
