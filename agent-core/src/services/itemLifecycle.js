// No singleton DB import: usable by startup recovery and explicit fixture tests.
export const PLAYER_ITEM_SQL = "owner_key = 'me' AND retired_at IS NULL";
export const CHEST_ITEM_SQL = `${PLAYER_ITEM_SQL} AND source_type IN ('legacy_chest', 'chest')`;

export function hasGeneratingChest(db) {
  return Boolean(db.prepare(`SELECT id FROM backpack_items WHERE ${CHEST_ITEM_SQL} AND locked_by IS NULL AND status = 'generating' LIMIT 1`).get());
}

/** Only chest generation is disposable on restart; paid/service inventory is preserved. */
export function cleanupInterruptedChestItems(db) {
  return db.prepare(`DELETE FROM backpack_items WHERE ${CHEST_ITEM_SQL} AND source_id IS NULL AND locked_by IS NULL AND status = 'generating'`).run().changes;
}

/** CAS completion + cooldown commit together. Repeated/late/foreign callbacks are no-ops. */
export function completeChestItem(db, itemId, imageUrl = null, expectedVersion = undefined) {
  return db.transaction(() => {
    const item = db.prepare(`SELECT acquired_at,version FROM backpack_items WHERE id = ? AND ${CHEST_ITEM_SQL} AND locked_by IS NULL AND status = 'generating'`).get(itemId);
    if (!item) return false;
    if (expectedVersion !== undefined && item.version !== expectedVersion) return false;
    const updated = db.prepare(`UPDATE backpack_items SET status = 'ready', image_url = COALESCE(?, image_url), version = version + 1
      WHERE id = ? AND ${CHEST_ITEM_SQL} AND status = 'generating' AND locked_by IS NULL AND version = ?`).run(imageUrl, itemId, item.version);
    if (!updated.changes) return false;
    const last = db.prepare("SELECT created_at FROM gift_history WHERE gift_type = 'chest' ORDER BY id DESC LIMIT 1").get();
    if (!last || String(item.acquired_at) > String(last.created_at)) {
      db.prepare("INSERT INTO gift_history (gift_type) VALUES ('chest')").run();
    }
    return true;
  })();
}

export function completeStaleChestItems(db, minutes) {
  const rows = db.prepare(`SELECT id FROM backpack_items WHERE ${CHEST_ITEM_SQL} AND locked_by IS NULL
    AND status = 'generating' AND acquired_at <= datetime('now', ?)`).all(`-${minutes} minutes`);
  return rows.reduce((count, row) => count + Number(completeChestItem(db, row.id)), 0);
}
