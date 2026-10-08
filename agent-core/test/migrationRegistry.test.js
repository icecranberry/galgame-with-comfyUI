import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };

const {
  registerMigration,
  listRegisteredMigrations,
  registeredCount,
  runRegisteredMigrations,
  listAppliedMigrations,
  listFailedMigrations,
  isRegistryLoaded,
  markRegistryLoaded,
  __resetRegistryForTest,
} = await import('../src/db/migrationRegistry.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

function freshDb() {
  return new Database(':memory:');
}

// ── 登记与校验 ────────────────────────────────────────────

test('非法 id 拒绝登记（不静默接受）', () => {
  __resetRegistryForTest();
  assert.throws(() => registerMigration({ id: 'noPrefix', run() {} }), /非法迁移 id/);
  assert.throws(() => registerMigration({ id: '001_Bad-Case', run() {} }), /非法迁移 id/);
  assert.throws(() => registerMigration({ id: 1, run() {} }), /非法迁移 id/);
  assert.equal(registeredCount(), 0);
});

test('缺 run 拒绝登记', () => {
  __resetRegistryForTest();
  assert.throws(() => registerMigration({ id: '001_a_b' }), /缺少 run/);
});

test('重复 id 报错而不是静默覆盖', () => {
  __resetRegistryForTest();
  registerMigration({ id: '001_dup', run() {} });
  assert.throws(() => registerMigration({ id: '001_dup', run() {} }), /id 重复/);
});

test('清单按 id 升序，不再受登记顺序影响', () => {
  __resetRegistryForTest();
  registerMigration({ id: '020_second', run() {} });
  registerMigration({ id: '010_first', run() {} });
  assert.deepEqual(listRegisteredMigrations().map(m => m.id), ['010_first', '020_second']);
});

// ── 执行与失败隔离 ────────────────────────────────────────

test('按序执行并写入应用台账', () => {
  __resetRegistryForTest();
  const order = [];
  registerMigration({ id: '001_a', description: 'A', run: () => order.push('a') });
  registerMigration({ id: '002_b', description: 'B', run: () => order.push('b') });

  const db = freshDb();
  const report = runRegisteredMigrations(db, { logger: { log(){}, warn(){}, error(){} } });

  assert.deepEqual(order, ['a', 'b']);
  assert.deepEqual(report.applied, ['001_a', '002_b']);
  assert.deepEqual(report.failed, []);
  const applied = listAppliedMigrations(db);
  assert.deepEqual(applied.map(r => r.id), ['001_a', '002_b']);
  db.close();
});

test('已应用的迁移不再重复执行（幂等调度）', () => {
  __resetRegistryForTest();
  let n = 0;
  registerMigration({ id: '001_once', run: () => { n++; } });

  const db = freshDb();
  const silent = { logger: { log(){}, warn(){}, error(){} } };
  runRegisteredMigrations(db, silent);
  const second = runRegisteredMigrations(db, silent);

  assert.equal(n, 1, '第二次不得再跑');
  assert.deepEqual(second.skipped, ['001_once']);
  db.close();
});

test('★ 单条迁移抛错：不阻断后续、留痕、下次启动重试', () => {
  __resetRegistryForTest();
  registerMigration({ id: '001_ok', run() {} });
  registerMigration({ id: '002_boom', run() { throw new Error('模拟失败'); } });
  registerMigration({ id: '003_after', run() {} });

  const db = freshDb();
  const silent = { logger: { log(){}, warn(){}, error(){} } };
  const r1 = runRegisteredMigrations(db, silent);

  assert.deepEqual(r1.applied, ['001_ok', '003_after'], '失败不得中断后续迁移');
  assert.equal(r1.failed.length, 1);
  assert.equal(r1.failed[0].id, '002_boom');
  assert.match(r1.failed[0].error, /模拟失败/);

  const failed = listFailedMigrations(db);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].attempts, 1);

  // 修好之后再跑：因为没写成功记录，必然重试
  __resetRegistryForTest();
  registerMigration({ id: '001_ok', run() {} });
  registerMigration({ id: '002_boom', run() {} });
  registerMigration({ id: '003_after', run() {} });
  const r2 = runRegisteredMigrations(db, silent);
  assert.deepEqual(r2.applied, ['002_boom']);
  assert.deepEqual(r2.failed, []);
  assert.equal(listFailedMigrations(db).length, 0, '成功后失败记录应被清掉');
  db.close();
});

test('失败次数累加（同一迁移反复失败可见）', () => {
  __resetRegistryForTest();
  registerMigration({ id: '001_always_fail', run() { throw new Error('x'); } });
  const db = freshDb();
  const silent = { logger: { log(){}, warn(){}, error(){} } };
  runRegisteredMigrations(db, silent);
  runRegisteredMigrations(db, silent);
  assert.equal(listFailedMigrations(db)[0].attempts, 2);
  db.close();
});

test('台账写入未变时 checksum 不告警；实现被改后告警但不阻断', () => {
  __resetRegistryForTest();
  registerMigration({ id: '001_x', run() {} });
  const db = freshDb();
  const silent = { logger: { log(){}, warn(){}, error(){} } };
  assert.deepEqual(runRegisteredMigrations(db, silent).warnings, []);

  // 换掉实现（id 不变）→ 应告警，且因为已应用所以不重跑
  __resetRegistryForTest();
  let ran = 0;
  registerMigration({ id: '001_x', run() { ran++; } });
  const r = runRegisteredMigrations(db, silent);
  assert.equal(ran, 0, '已应用的迁移不得因代码改动而重跑');
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /001_x/);
  db.close();
});

test('空清单是**静默空跑**——因此 isRegistryLoaded 必须能区分"没加载"', () => {
  __resetRegistryForTest();
  const db = freshDb();
  const report = runRegisteredMigrations(db, { logger: { log(){}, warn(){}, error(){} } });
  assert.deepEqual(report.applied, [], '空清单不报错（存量迁移还没搬进来是正常态）');
  assert.equal(isRegistryLoaded(), false, '未调用 loadFeatureMigrations 时标记必须为 false');
  markRegistryLoaded();
  assert.equal(isRegistryLoaded(), true);
  db.close();
});

// ── 与磁盘清单的一致性（防止"文件加了但没被扫到"）────────────

test('★ 磁盘上每个 *.migration.js 都被 loadFeatureMigrations 登记，且无多余登记', async () => {
  __resetRegistryForTest();
  const { loadFeatureMigrations } = await import('../src/db/migrations/index.js');
  const report = await loadFeatureMigrations();

  const onDisk = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.migration.js'))
    .map(f => f.replace(/\.migration\.js$/, ''))
    .sort();

  assert.deepEqual(
    [...report.loaded].sort(),
    onDisk,
    '登记的 id 集合必须与磁盘文件名集合逐项相等'
  );
  assert.deepEqual(
    listRegisteredMigrations().map(m => m.id).sort(),
    onDisk,
    '注册表内容必须与磁盘一致（多一个少一个都说明扫描有漏）'
  );
  assert.equal(isRegistryLoaded(), true);
});

test('★ 注册表中每个迁移都能在空库上跑通（含依赖表缺失的兜底）', async () => {
  __resetRegistryForTest();
  const { loadFeatureMigrations } = await import('../src/db/migrations/index.js');
  await loadFeatureMigrations();

  const db = freshDb();
  const silent = { logger: { log(){}, warn(){}, error(){} } };
  const report = runRegisteredMigrations(db, silent);

  // 空库（无任何业务表）应该不崩；迁移内部该 try/catch 的都该 catch 住
  assert.deepEqual(
    report.failed.map(f => `${f.id}: ${f.error}`),
    [],
    '迁移在空库上不得抛错（依赖表不存在要自己兜底）'
  );
  db.close();
});

test('迁移文件名必须以导出 id 开头（防排序与声明不一致）', () => {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.migration.js'));
  for (const f of files) {
    const stem = f.replace(/\.migration\.js$/, '');
    const src = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8');
    const m = src.match(/export\s+const\s+id\s*=\s*['"]([^'"]+)['"]/);
    assert.ok(m, `${f} 必须以 export const id = '...' 声明 id`);
    assert.equal(m[1], stem, `${f} 的 id 必须与文件名一致`);
  }
});