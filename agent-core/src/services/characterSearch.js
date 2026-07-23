import { getDb } from '../db/index.js';

let registry = [];

export function refresh() {
  const db = getDb();
  const rows = db.prepare('SELECT id, name, display_name FROM characters').all();
  registry = rows
    .map(r => ({ id: r.id, name: r.name, display_name: r.display_name, len: r.display_name.length }))
    .sort((a, b) => b.len - a.len);
}

export function match(text, excludeId) {
  for (const entry of registry) {
    if (entry.len < 2) continue;
    if (entry.id === excludeId) continue;
    if (text.includes(entry.display_name)) return entry;
  }
  return null;
}

export function matchAll(text, excludeId) {
  const results = [];
  for (const entry of registry) {
    if (entry.len < 2) continue;
    if (entry.id === excludeId) continue;
    if (text.includes(entry.display_name)) results.push(entry);
  }
  return results;
}
