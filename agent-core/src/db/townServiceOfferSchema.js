/** 镇民 NPC 服务/打工项目、交易货品、服务会话、好感度四张表。
 * 服务（service）= 玩家花钱买 NPC 的服务；打工（work）= 玩家出力，NPC 付钱。
 * 货品（stock）= 有交易权限的 NPC 每 7 天换一次的货架；服务会话 = 一次「瞄一眼」式的图片叙事。
 * Requires the town schema (town_npcs) first. */
export function migrateTownServiceOfferSchema(db) {
  return db.transaction(() => {
    const columns = new Set(db.prepare('PRAGMA table_info(town_npcs)').all().map(r => r.name));
    if (!columns.has('id')) throw new Error('Incompatible town_npcs schema');

    db.exec(`
      CREATE TABLE IF NOT EXISTS town_npc_offers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        world_id TEXT NOT NULL,
        npc_id INTEGER NOT NULL REFERENCES town_npcs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('service','work')),
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        price INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'llm',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS town_npc_offers_npc ON town_npc_offers(world_id, npc_id, kind, sort_order);

      CREATE TABLE IF NOT EXISTS town_npc_stock (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        world_id TEXT NOT NULL,
        npc_id INTEGER NOT NULL REFERENCES town_npcs(id) ON DELETE CASCADE,
        template_id TEXT NOT NULL DEFAULT '',
        template_version INTEGER NOT NULL DEFAULT 1,
        effect_key TEXT NOT NULL DEFAULT '',
        price INTEGER NOT NULL DEFAULT 0,
        custom_name TEXT NOT NULL DEFAULT '',
        custom_desc TEXT NOT NULL DEFAULT '',
        image_prompt TEXT NOT NULL DEFAULT '',
        image_url TEXT,
        image_status TEXT NOT NULL DEFAULT 'pending',
        image_attempts INTEGER NOT NULL DEFAULT 0,
        favor_delta INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'llm',
        rolled_at INTEGER NOT NULL,
        next_roll_at INTEGER NOT NULL,
        sold_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS town_npc_stock_npc ON town_npc_stock(world_id, npc_id, next_roll_at);

      CREATE TABLE IF NOT EXISTS town_npc_service_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        world_id TEXT NOT NULL,
        world_epoch INTEGER NOT NULL DEFAULT 0,
        npc_id INTEGER NOT NULL REFERENCES town_npcs(id) ON DELETE CASCADE,
        player_actor_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('service','work')),
        offer_id INTEGER,
        offer_title TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'generating',
        last_tale TEXT NOT NULL DEFAULT '',
        last_image_path TEXT,
        last_choice TEXT,
        turns INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS town_npc_service_sessions_actor
        ON town_npc_service_sessions(world_id, world_epoch, npc_id, player_actor_id, created_at);

      CREATE TABLE IF NOT EXISTS town_npc_favor (
        world_id TEXT NOT NULL,
        npc_id INTEGER NOT NULL REFERENCES town_npcs(id) ON DELETE CASCADE,
        favor INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (world_id, npc_id)
      );
    `);

    // 兼容早期草稿：老库可能已建表但缺少后补列。
    const stockColumns = new Set(db.prepare('PRAGMA table_info(town_npc_stock)').all().map(r => r.name));
    for (const [name, definition] of Object.entries({
      effect_key: "TEXT NOT NULL DEFAULT ''",
      image_url: 'TEXT',
      image_status: "TEXT NOT NULL DEFAULT 'pending'",
      image_attempts: 'INTEGER NOT NULL DEFAULT 0',
      source: "TEXT NOT NULL DEFAULT 'llm'",
    })) {
      if (!stockColumns.has(name)) db.exec(`ALTER TABLE town_npc_stock ADD COLUMN ${name} ${definition}`);
    }
    return { version: 1 };
  }).immediate();
}
