/**
 * 媒体操作日志（T5/T7）回归测试。
 *
 * 背景：曾发生「一条真实产物在界面里无故消失、无法追溯」。媒体删除不带任何痕迹，
 * 删掉的行连同 CASCADE 子行一起没了。本模块（`services/mediaOpLog.js` + `media_op_log` 表）
 * 补上这层审计。
 *
 * 本测试守的是**三类最容易回退的风险**：
 *
 *  ① **日志不能成为删除的绊脚石** —— 写日志失败必须 fail-soft（红线 0 的同源教训：
 *     "catch 里只 warn 不报 = 假成功"在这里反过来用：日志坏掉绝不能阻断删除本身）。
 *  ② **不得做只读探测**（红线 3）—— 本模块只 INSERT/SELECT，任何 DELETE 都是错。
 *  ③ **接线必须真的在** —— deleteOutlet / deletePost / deleteBoard / createOutlet /
 *     cleanupOrphanMediaImages 五处入口漏一个，"消失的东西查无实据"就复发。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, '../src');

const svcSrc = fs.readFileSync(path.join(SRC_DIR, 'services/mediaService.js'), 'utf8');
const logSrc = fs.readFileSync(path.join(SRC_DIR, 'services/mediaOpLog.js'), 'utf8');
const dbSrc = fs.readFileSync(path.join(SRC_DIR, 'db/index.js'), 'utf8');
const routeSrc = fs.readFileSync(path.join(SRC_DIR, 'routes/media.js'), 'utf8');

// ─────────────────────────────────────────────────────────
// ① mediaOpLog 模块自身：只写不删 + fail-soft
// ─────────────────────────────────────────────────────────

test('★ 只读探测红线：mediaOpLog 模块内不得出现任何 DELETE 语句', () => {
  // 本模块是"记录器"，只 INSERT/SELECT。混进 DELETE 会误删审计痕迹（红线 3 的同源风险）。
  assert.ok(!/DELETE\s+FROM/i.test(logSrc), 'mediaOpLog 不得包含 DELETE（它只写不删）');
  assert.ok(!/\.run\(\s*\)[\s\S]{0,40}DELETE/i.test(logSrc), 'mediaOpLog 不得调用删除类语句');
  // 正向：必须有 INSERT 与 SELECT
  assert.match(logSrc, /INSERT INTO media_op_log/i, '必须向 media_op_log 写记录');
  assert.match(logSrc, /SELECT \* FROM media_op_log/i, '必须能读回日志');
});

test('★★ fail-soft：recordMediaOp 全程包 try/catch，失败不抛错', () => {
  // 日志写不进去（表缺失/磁盘满）绝不能阻断删除本身 —— 删除必须成功。
  // 判据：函数体内有 catch 且 return null（而不是 rethrow）。
  // 注意：参数是多行解构，`[\s\S]*?\n}` 会停在参数括号处 —— 用下一个 export 作边界。
  const fn = logSrc.match(/export function recordMediaOp[\s\S]*?(?=\nexport function |\n\/\*\*[\s\S]*?export)/);
  assert.ok(fn, '必须导出 recordMediaOp');
  assert.match(fn[0], /try\s*\{/, 'recordMediaOp 必须有 try');
  assert.match(fn[0], /catch\s*\(/, 'recordMediaOp 必须有 catch（fail-soft）');
  assert.match(fn[0], /return null/, 'catch 后应 return null 而不是抛错');
  // 不得在 catch 里 rethrow
  assert.ok(!/catch[\s\S]{0,120}throw\b/.test(fn[0]), 'catch 内不得 rethrow（否则就不是 fail-soft 了）');
});

test('操作类型/目标类型收敛为白名单（防止拼写漂移导致过滤失效）', () => {
  assert.match(logSrc, /MEDIA_OP_TYPES\s*=/, '必须定义操作类型白名单');
  assert.match(logSrc, /MEDIA_TARGET_TYPES\s*=/, '必须定义目标类型白名单');
  // delete / create / cleanup 是最关键的三个，必须在册
  for (const t of ['create', 'delete', 'batch_delete', 'cleanup']) {
    assert.ok(new RegExp(`['"]${t}['"]`).test(logSrc), `操作类型白名单应含 ${t}`);
  }
  for (const t of ['outlet', 'board', 'post']) {
    assert.ok(new RegExp(`['"]${t}['"]`).test(logSrc), `目标类型白名单应含 ${t}`);
  }
});

// ─────────────────────────────────────────────────────────
// ② DB 迁移：表结构必须齐备
// ─────────────────────────────────────────────────────────

test('DB 迁移：media_op_log 建表存在且含快照/归属/计数等关键列', () => {
  assert.match(dbSrc, /function migrateMediaOpLog\s*\(/, '必须有 migrateMediaOpLog');
  const block = dbSrc.match(/function migrateMediaOpLog[\s\S]*?\n}/);
  assert.ok(block, 'migrateMediaOpLog 函数体应存在');
  const s = block[0];
  assert.match(s, /CREATE TABLE IF NOT EXISTS media_op_log/, '必须建 media_op_log 表');
  for (const col of ['op_type', 'target_type', 'target_name', 'outlet_name', 'count', 'detail', 'snapshot_json', 'created_at']) {
    assert.ok(new RegExp(`\\b${col}\\b`).test(s), `media_op_log 应含列 ${col}`);
  }
  // 索引：按时间倒序查最近日志要走索引
  assert.match(s, /idx_media_op_log_created/, '应按 created_at 建索引');
  assert.match(s, /idx_media_op_log_target/, '应按 target 建索引');
});

test('DB 迁移：migrateMediaOpLog 已接入启动调度（紧跟 media 迁移）', () => {
  // 未接线的迁移等于没写。必须能在启动流程里找到调用点。
  assert.match(dbSrc, /migrateMediaOpLog\(db\)/, 'migrateMediaOpLog 必须在启动流程被调用');
});

// ─────────────────────────────────────────────────────────
// ③ 接线：五处入口逐一验证
// ─────────────────────────────────────────────────────────

test('★★ 接线完整：删除/创建/批量/清理五处入口都记录日志', () => {
  // 漏任何一处，"东西消失查无实据"就会从那个口子复发。
  const outlets = svcSrc.match(/export function deleteOutlet[\s\S]*?\n}/)?.[0] || '';
  assert.match(outlets, /recordMediaOp\(\{[\s\S]*?opType:\s*'delete'[\s\S]*?targetType:\s*'outlet'/, 'deleteOutlet 必须记 outlet 删除');

  const post = svcSrc.match(/export function deletePost\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(post, /recordMediaOp\(/, 'deletePost 必须记日志');
  assert.match(post, /targetType:\s*'post'/, 'deletePost 日志应为 post 类型');

  const posts = svcSrc.match(/export function deletePosts\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(posts, /recordMediaOp\(/, 'deletePosts 批量删除必须记日志');
  assert.match(posts, /opType:\s*'batch_delete'/, '批量删除应为 batch_delete 类型');

  const board = svcSrc.match(/export function deleteBoard[\s\S]*?\n}/)?.[0] || '';
  assert.match(board, /recordMediaOp\(/, 'deleteBoard 必须记日志');

  const create = svcSrc.match(/export function createOutlet[\s\S]*?\n}/)?.[0] || '';
  assert.match(create, /recordMediaOp\(\{[\s\S]*?opType:\s*'create'/, 'createOutlet 必须记创建');

  // 清理孤儿配图也是破坏性操作
  assert.match(svcSrc, /opType:\s*'cleanup'/, '清理孤儿配图必须记日志');
});

test('★ 单条删除的批量内部调用（silent）不重复记日志 —— 由批量入口统一记一条汇总', () => {
  const post = svcSrc.match(/export function deletePost\([\s\S]*?\n\}/)?.[0] || '';
  // silent 分支下不应写日志（否则批量删 500 条会刷 500 条日志）
  assert.match(post, /if\s*\(!silent\)\s*\{[\s\S]*?recordMediaOp/, 'deletePost 的日志必须在 !silent 分支内');
});

test('删除快照留痕：删 outlet 前先取名字/形态/计数（删完 CASCADE 就查不到了）', () => {
  const outlets = svcSrc.match(/export function deleteOutlet[\s\S]*?\n}/)?.[0] || '';
  // 必须先查快照再删
  assert.match(outlets, /SELECT[\s\S]*?FROM media_outlets[\s\S]*?WHERE id = \?/, '删除前应先取 outlet 快照');
  assert.match(outlets, /postCount|boardCount/, '快照应含帖子/板块计数');
  // snapshot 字段要真的带上
  assert.match(outlets, /snapshot:\s*\{/, 'deleteOutlet 应落 snapshot');
});

// ─────────────────────────────────────────────────────────
// ④ 查询接口与前端接线
// ─────────────────────────────────────────────────────────

test('API：/media/op-log 查询接口已注册，且过滤参数走白名单', () => {
  assert.match(routeSrc, /router\.get\('\/op-log'/, '必须注册 GET /media/op-log');
  assert.match(routeSrc, /listMediaOps/, '接口应调用 listMediaOps');
  assert.match(routeSrc, /MEDIA_OP_TYPES\.includes/, 'opType 过滤参数必须走白名单防空值');
  assert.match(routeSrc, /MEDIA_TARGET_TYPES\.includes/, 'targetType 过滤参数必须走白名单');
});

test('前端：媒体设置弹窗有操作日志面板（T7 可视化查询）', () => {
  const webSrcPath = path.resolve(__dirname, '../../web-ui/src');
  const modal = fs.readFileSync(path.join(webSrcPath, 'components/MediaSettingsModal.vue'), 'utf8');
  const apiSrc = fs.readFileSync(path.join(webSrcPath, 'api/index.js'), 'utf8');
  assert.match(modal, /ms-oplog/, '弹窗应有操作日志面板');
  assert.match(modal, /loadOpLog/, '应能加载操作日志');
  assert.match(modal, /listMediaOpLog/, '应调用 listMediaOpLog API');
  assert.match(apiSrc, /export function listMediaOpLog/, 'API 层应导出 listMediaOpLog');
  assert.match(apiSrc, /\/media\/op-log/, 'API 层应指向 /media/op-log');
});