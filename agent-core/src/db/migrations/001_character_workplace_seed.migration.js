// 迁移（一次性）: 为「名字开头且分类为办公」的地图地点回填角色工作地。
//
// ⚠ 本迁移是从 src/db/index.js 的私有函数 migrateCharacterWorkPlaceSeed() **原样搬来**的
//    样板，用于验证可插拔迁移机制。逻辑一字未改，只换了日志前缀。
//
// ── 执行顺序前提 ─────────────────────────────────────────
// 本迁移依赖 `characters.work_place` 列，而加列仍在 db/index.js 的
// migrateCharacterCadenceSchema() 里（存量迁移未搬）。启动顺序是
// **index.js 全量 schema 初始化 → 插件式迁移**，所以列一定先存在。
// 若顺序被破坏，下面的 PRAGMA 检查会返回，等下一轮再跑（不会写错数据）。

export const id = '001_character_workplace_seed';
export const description = '角色工作地回填（名字开头 + 分类含办公的地图地点，不覆盖用户已填）';

/**
 * ── 为什么要做 ────────────────────────────────────────────
 * 地图把角色的专属办公处标成 `private`（"谢绝外人"说的是别人进不去）。台账的豁免集
 * 原本只认 home_place/sleep_place/home_area，于是**在自家办公室上班**会被报成
 * "闯入受限地点" —— 实测「真珠办公室」连报 8 次（用户实报"点开全是重复"的元凶）。
 *
 * ── 口径：只认**明确证据**，绝不猜 ──────────────────────
 * 判定条件同时满足才回填：
 *   ① 地点名以某角色的 `display_name` 开头（「真珠办公室」←「真珠」）；
 *   ② 该地点 `category` 含「办公」（排除「三月七的个人房间」这类**住处**，
 *      那属于 home_place 的语义，交给用户自己填，不在这里代劳）；
 *   ③ 该角色 `work_place` 当前为空（不覆盖用户已填的值）。
 * 宁可漏填（用户可手工补），不可错填（错填会让真闯入被静默放行）。
 *
 * ⚠ 一次性标记：回填是幂等的，但每次都扫全表没意义。
 *   保留 `system_settings.character_workplace_seed_v1` 标记 —— 老库升级到本机制时
 *   schema_migrations 是空的，全靠这个标记防止重扫。
 */
export function run(db) {
  try {
    const done = db.prepare(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'character_workplace_seed_v1'`
    ).get();
    if (done) return;

    const cols = new Set(db.prepare(`PRAGMA table_info(characters)`).all().map(c => c.name));
    if (!cols.has('work_place')) return;   // 列还没加上（迁移顺序异常）→ 下轮再跑

    const places = db.prepare(
      `SELECT name, category FROM world_map_places WHERE level = 3 AND name IS NOT NULL`
    ).all();
    const chars = db.prepare(
      `SELECT id, display_name FROM characters WHERE display_name IS NOT NULL AND TRIM(display_name) != ''`
    ).all();

    const upd = db.prepare(`UPDATE characters SET work_place = ? WHERE id = ? AND (work_place IS NULL OR TRIM(work_place) = '')`);
    let n = 0;
    for (const p of places) {
      if (!/办公/.test(String(p.category || ''))) continue;   // 只认明确标注为办公的地点
      // 长名优先：避免「真」这种短名先把「真珠办公室」抢走
      const owner = [...chars]
        .filter(c => String(p.name).startsWith(String(c.display_name)))
        .sort((a, b) => String(b.display_name).length - String(a.display_name).length)[0];
      if (!owner) continue;
      if (upd.run(String(p.name).trim(), owner.id).changes > 0) n++;
    }

    db.prepare(`INSERT OR REPLACE INTO system_settings (setting_key, setting_value)
      VALUES ('character_workplace_seed_v1', '1')`).run();
    if (n) console.log(`[migration] 角色工作地回填：${n} 个角色（依据地图「名字开头 + 分类办公」）`);
  } catch (err) {
    // 吞错留痕交给 registry（它会记 schema_migrations_failed 并在下次启动重试）
    console.log('[migration] 角色工作地回填跳过:', err.message);
  }
}