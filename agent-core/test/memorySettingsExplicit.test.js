/**
 * memory_settings 阶段开关的显式化迁移：老库里 v3 / activeSearch / contextBudget 这些键根本不存在，
 * 一直靠读取侧默认值兜底——从库里读不出实际生效值，将来改代码默认值时老库还会静默跟随。
 * 迁移只补缺失键、不覆盖用户值、不做钳制（钳制在 memoryConfig.normalizeMemorySettings）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateMemorySettingsExplicitBlocks } from '../src/db/index.js';

function createDb(settings) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE system_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  if (settings !== undefined) {
    db.prepare(`INSERT INTO system_settings(setting_key, setting_value) VALUES ('memory_settings', ?)`).run(JSON.stringify(settings));
  }
  return db;
}

const read = (db) => JSON.parse(db.prepare(`SELECT setting_value FROM system_settings WHERE setting_key = 'memory_settings'`).get().setting_value);

test('显式化：补齐 v3/activeSearch/contextBudget 与 useBuiltin，其余键逐字保留', () => {
  const db = createDb({
    enabled: true,
    topK: 9,
    embedding: { enabled: false, provider: 'custom', baseURL: '', model: '' },
    reranker: { enabled: false },
  });
  try {
    const result = migrateMemorySettingsExplicitBlocks(db);
    assert.equal(result.updated, true);
    const settings = read(db);
    // 用户已有值原样保留
    assert.equal(settings.topK, 9);
    assert.equal(settings.enabled, true);
    // 缺失块按默认补上
    assert.deepEqual(settings.v3, { enabled: true });
    assert.deepEqual(settings.activeSearch, { enabled: false, timeoutMs: 4000 });
    assert.deepEqual(settings.contextBudget, { enabled: false, dynamicTokens: 8000 });
    assert.equal(settings.recordUnengagedEvents, true);
    assert.equal(settings.embedding.useBuiltin, true);
    assert.equal(settings.reranker.useBuiltin, true);
    // 逐字保留：不得动用户填的 provider 字段
    assert.equal(settings.embedding.provider, 'custom');
  } finally {
    db.close();
  }
});

test('显式化：已有值一律不覆盖（用户手改过就以用户为准）', () => {
  const db = createDb({
    v3: { enabled: false },
    activeSearch: { enabled: true, timeoutMs: 9000 },
    contextBudget: { enabled: true, dynamicTokens: 12000 },
    recordUnengagedEvents: false,
    embedding: { enabled: true, useBuiltin: false },
  });
  try {
    const result = migrateMemorySettingsExplicitBlocks(db);
    const settings = read(db);
    assert.equal(settings.v3.enabled, false, 'v3 用户关过就不能被改回 true');
    assert.equal(settings.activeSearch.enabled, true);
    assert.equal(settings.activeSearch.timeoutMs, 9000);
    assert.equal(settings.contextBudget.dynamicTokens, 12000);
    assert.equal(settings.recordUnengagedEvents, false);
    assert.equal(settings.embedding.useBuiltin, false, '用户关掉内置服务不能被改回 true');
    // 三个阶段块与本轮涉及的字段都已存在 → 无需写库（也证明上面没有被"顺手补齐"改掉）
    assert.deepEqual(result, { skipped: 'up-to-date' });
  } finally {
    db.close();
  }
});

test('显式化：幂等（第二次运行直接跳过，不再写库）', () => {
  const db = createDb({ enabled: true });
  try {
    assert.equal(migrateMemorySettingsExplicitBlocks(db).updated, true);
    assert.deepEqual(migrateMemorySettingsExplicitBlocks(db), { skipped: 'up-to-date' });
  } finally {
    db.close();
  }
});

test('显式化：无配置行时安全跳过（不建行、不报错）', () => {
  const db = createDb(undefined);
  try {
    assert.deepEqual(migrateMemorySettingsExplicitBlocks(db), { skipped: 'no-settings' });
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM system_settings`).get().count, 0);
  } finally {
    db.close();
  }
});
