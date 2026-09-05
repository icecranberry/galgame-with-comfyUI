/**
 * 小镇种子数据：默认地图、POI（含日程别名映射）、参与名单同步
 *
 * 幂等：boot 时调用 ensureTownSeed()，已有数据不覆盖；
 * syncTownCharacters() 把 characters 全表同步进 town_characters
 * （新角色默认启用 town_enabled=1，家 = 公寓）。
 */
import { getDb } from '../../db/index.js';

export const MAP_COLS = 40;
export const MAP_ROWS = 30;

/**
 * 默认 POI 布局（锚点 = 门前站立点；kind=place/home 的建筑占格
 * 由 buildingCells() 生成，画在锚点上方 5×4）
 */
export const SEED_LOCATIONS = [
  { key: 'cafe', name: '临街咖啡厅', kind: 'place', x: 7, y: 7, radius: 2,
    aliases: ['咖啡厅', '咖啡馆', '咖啡店', '咖啡店打工', '临街咖啡厅'],
    ambient: '咖啡机嘶嘶作响，店里飘着烘焙豆的香气' },
  { key: 'restaurant', name: '街角小餐馆', kind: 'place', x: 14, y: 6, radius: 2,
    aliases: ['餐厅', '餐馆', '饭店', '食堂', '吃饭', '小餐馆', '下馆子'],
    ambient: '厨房飘来饭菜香，人声嘈杂而温暖' },
  { key: 'park', name: '中央公园', kind: 'outdoor', x: 31, y: 8, radius: 3,
    aliases: ['公园', '散步', '遛弯', '公园长椅', '看花'],
    ambient: '树叶沙沙作响，远处有孩子在笑' },
  { key: 'plaza', name: '小镇广场', kind: 'outdoor', x: 20, y: 15, radius: 3,
    aliases: ['广场', '小镇广场', '中心广场', '喷泉'],
    ambient: '镇中心的小广场，喷泉哗啦啦地流' },
  { key: 'library', name: '图书馆', kind: 'place', x: 6, y: 22, radius: 2,
    aliases: ['图书馆', '看书', '阅览室', '自习'],
    ambient: '安静得能听见翻书声' },
  { key: 'store', name: '便利店', kind: 'place', x: 33, y: 21, radius: 2,
    aliases: ['便利店', '超市', '商店', '购物', '小卖部', '买东西'],
    ambient: '货架整齐，门口的风铃叮当响' },
  { key: 'apartment', name: '林荫公寓', kind: 'home', x: 20, y: 26, radius: 4,
    aliases: ['公寓', '家', '家里', '卧室', '书房', '公寓书房', '公寓客厅', '住宅', '床上', '客厅', '睡觉', '小睡'],
    ambient: '温馨的小家，阳光从窗帘缝隙漏进来' },
];

/** place/home 的建筑占格：锚点上方 5×4 区域（与前端绘制保持一致） */
export function buildingCells(loc) {
  if (loc.kind === 'outdoor') return [];
  const cells = [];
  for (let dy = -4; dy <= -1; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      cells.push({ x: loc.x + dx, y: loc.y + dy });
    }
  }
  return cells;
}

/** 由 POI 布局生成可行走网格：全 1，建筑占格置 0 */
export function buildWalkGrid(cols = MAP_COLS, rows = MAP_ROWS, locations = SEED_LOCATIONS) {
  const grid = Array.from({ length: rows }, () => Array(cols).fill(1));
  for (const loc of locations) {
    for (const cell of buildingCells(loc)) {
      if (cell.x >= 0 && cell.x < cols && cell.y >= 0 && cell.y < rows) {
        grid[cell.y][cell.x] = 0;
      }
    }
  }
  return grid;
}

/**
 * 幂等种子：地图 + POI + 玩家；并同步角色名单
 */
export function ensureTownSeed() {
  const db = getDb();
  const tx = db.transaction(() => {
    let map = db.prepare('SELECT * FROM town_maps ORDER BY id LIMIT 1').get();
    if (!map) {
      db.prepare(
        'INSERT INTO town_maps (name, grid_cols, grid_rows, walk_grid) VALUES (?, ?, ?, ?)'
      ).run('邻舍小镇', MAP_COLS, MAP_ROWS, JSON.stringify(buildWalkGrid()));
      map = db.prepare('SELECT * FROM town_maps ORDER BY id LIMIT 1').get();
    }

    const count = db.prepare('SELECT COUNT(*) AS n FROM town_locations WHERE map_id = ?').get(map.id).n;
    if (count === 0) {
      const ins = db.prepare(`
        INSERT INTO town_locations (map_id, key, name, aliases_json, kind, grid_x, grid_y, radius, ambient)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const loc of SEED_LOCATIONS) {
        ins.run(map.id, loc.key, loc.name, JSON.stringify(loc.aliases), loc.kind, loc.x, loc.y, loc.radius, loc.ambient);
      }
      console.log(`[townSeed] created ${SEED_LOCATIONS.length} locations for map "${map.name}"`);
    } else {
      // 地图/POI 是代码定义的资产：以 SEED_LOCATIONS 为准同步布局与别名（不动 id，不改用户数据）
      const upd = db.prepare(`
        UPDATE town_locations SET name = ?, aliases_json = ?, kind = ?, grid_x = ?, grid_y = ?, radius = ?, ambient = ?
        WHERE key = ? AND map_id = ?
      `);
      for (const loc of SEED_LOCATIONS) {
        upd.run(loc.name, JSON.stringify(loc.aliases), loc.kind, loc.x, loc.y, loc.radius, loc.ambient, loc.key, map.id);
      }
    }

    // 玩家 token（v1 单用户）
    db.prepare(
      `INSERT INTO town_players (id, display_name, grid_x, grid_y) VALUES ('me', '我', ?, ?)
       ON CONFLICT(id) DO NOTHING`
    ).run(20, 15);
  });
  tx();

  return syncTownCharacters();
}

/**
 * characters 全表 → town_characters 同步（INSERT OR IGNORE，不覆盖用户手动关闭的 town_enabled）
 */
export function syncTownCharacters() {
  const db = getDb();
  const home = db.prepare(`SELECT id FROM town_locations WHERE key = 'apartment'`).get();
  const chars = db.prepare('SELECT id FROM characters').all();
  const ins = db.prepare(`
    INSERT INTO town_characters (character_id, home_location_id, town_enabled)
    VALUES (?, ?, 1)
    ON CONFLICT(character_id) DO NOTHING
  `);
  let added = 0;
  const tx = db.transaction(() => {
    for (const c of chars) {
      const r = ins.run(c.id, home?.id ?? null);
      added += r.changes;
    }
  });
  tx();
  if (added > 0) console.log(`[townSeed] synced town_characters (+${added} new)`);
  return added;
}
