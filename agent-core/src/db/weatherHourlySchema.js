/** Call after the existing weather_hourly table is created. No fetching/backfill. */
export function migrateWeatherHourlySchema(db) {
  return db.transaction(() => {
    const columns = new Set(db.prepare('PRAGMA table_info(weather_hourly)').all().map(row => row.name));
    for (const column of ['forecast_at', 'fetched_at']) {
      if (!columns.has(column)) db.exec(`ALTER TABLE weather_hourly ADD COLUMN ${column} INTEGER`);
    }
    if (!columns.has('source_key')) db.exec('ALTER TABLE weather_hourly ADD COLUMN source_key TEXT');
  }).immediate();
}
