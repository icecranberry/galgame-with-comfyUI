export function migrateGallerySchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS gallery_image_times (
    image_key TEXT PRIMARY KEY,
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms > 0),
    time_source TEXT NOT NULL
  )`);
}
