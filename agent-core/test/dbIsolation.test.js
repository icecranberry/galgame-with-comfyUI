import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config, resolveDbPath } from '../src/config.js';

/**
 * 测试期数据库隔离。
 *
 * ★ 为什么要有这一组测试：
 *   2026-10-05 媒体「狸狸八卦」连同两条帖子在**一次全量测试窗口内**消失，
 *   事后无法判定是谁删的 —— 当时有一批测试文件（32 个）没设 `DB_PATH`，
 *   它们直接打开真实的 `data/agent.db`，而 `local-patch-regression.test.js`
 *   会在真库里 createOutlet / deleteOutlet / 写 system_settings。
 *   「跑一次测试 = 对生产数据做一次写操作」这件事本身就不该成立，
 *   所以在 `config.dbPath` 上加了安全阀（测试期默认 :memory:）。
 *
 * 两组断言：
 *   ① **当前进程**（就是一个真实的 node:test 子进程、且本文件没设 DB_PATH）
 *      解析出来的必须是内存库 —— 这是端到端的真验证；
 *   ② `resolveDbPath` 纯函数的边界（显式 DB_PATH / 放行开关 / 生产默认值）。
 *
 * 注：不用"起子进程 import config 再看输出"的写法 —— 本机沙箱下 spawn 会被拦（EBUSY），
 *     而且那种写法验的其实也是这套判定逻辑，纯函数已经覆盖。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

test('★ 当前测试进程解析到内存库（未显式指定 DB_PATH 时绝不碰真库）', () => {
  assert.ok(process.env.NODE_TEST_CONTEXT,
    '本测试应当运行在 node:test 子进程里（否则这条断言的场景不成立）');
  assert.ok(!process.env.DB_PATH,
    '本文件不应设置 DB_PATH —— 它正是用来验证"没设置时的兜底行为"');
  assert.equal(config.dbPath, ':memory:',
    `测试期应落到内存库，实际解析到：${config.dbPath}（若指向 data/agent.db 就是直连真库）`);
});

test('resolveDbPath：显式 DB_PATH 优先（测试自设的值原样使用）', () => {
  assert.equal(resolveDbPath({ DB_PATH: ':memory:' }, ROOT), ':memory:');
  const abs = path.join(ROOT, 'data', 'whatever.db');
  assert.equal(resolveDbPath({ DB_PATH: abs, NODE_TEST_CONTEXT: 'child-v8' }, ROOT), abs,
    '显式 DB_PATH 必须原样使用，测试期安全阀不得覆盖它');
});

test('resolveDbPath：测试期且未显式指定 → :memory:', () => {
  assert.equal(resolveDbPath({ NODE_TEST_CONTEXT: 'child-v8' }, ROOT), ':memory:');
  assert.equal(resolveDbPath({ NODE_TEST_CONTEXT: 'child-v8', DB_PATH: '' }, ROOT), ':memory:',
    '空字符串 DB_PATH 视为未设置');
});

test('resolveDbPath：只有 ALLOW_REAL_DB_IN_TESTS=1 才放行真库（集成测试用）', () => {
  const got = resolveDbPath({ NODE_TEST_CONTEXT: 'child-v8', ALLOW_REAL_DB_IN_TESTS: '1' }, ROOT);
  assert.equal(got, path.join(ROOT, 'data', 'agent.db'));
  // 任何其它值都不放行 —— 防手滑写成 'true' / '0' 产生歧义
  for (const v of ['0', 'true', 'yes']) {
    assert.equal(resolveDbPath({ NODE_TEST_CONTEXT: 'child-v8', ALLOW_REAL_DB_IN_TESTS: v }, ROOT), ':memory:',
      `ALLOW_REAL_DB_IN_TESTS=${v} 不应放行`);
  }
});

test('resolveDbPath：非测试环境仍指向真库，且是绝对路径（安全阀不影响生产）', () => {
  const got = resolveDbPath({}, ROOT);
  assert.equal(got, path.join(ROOT, 'data', 'agent.db'));
  assert.ok(path.isAbsolute(got), '默认值必须是绝对路径（不随启动 cwd 漂移）');
  // 没有 NODE_TEST_CONTEXT 时，放行开关无意义，照常走真库
  assert.equal(resolveDbPath({ ALLOW_REAL_DB_IN_TESTS: '1' }, ROOT), path.join(ROOT, 'data', 'agent.db'));
});

test('安全阀本体必须存在，且仍有一批测试依赖它', () => {
  // 意义：若将来有人把安全阀删了又没人发现，这 30+ 个文件就会重新直连真库。
  // 这条把"安全阀存在"与"确实有文件依赖它"绑在一起钉住。
  const dir = path.join(ROOT, 'test');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js'));
  assert.ok(files.length > 0, '应当能读到测试文件（否则这条检查本身失效）');

  const relyOnValve = files.filter(f => {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    return !/process\.env\.DB_PATH\s*=/.test(s);
  });
  assert.ok(relyOnValve.length > 0,
    `当前有 ${relyOnValve.length} 个测试文件依赖安全阀；若全都自设 DB_PATH 才可考虑移除安全阀`);

  const cfg = fs.readFileSync(path.join(ROOT, 'src', 'config.js'), 'utf8');
  assert.match(cfg, /NODE_TEST_CONTEXT/, 'config.js 的测试期安全阀被移除了？测试会开始直连真库');
  assert.match(cfg, /':memory:'/, "config.js 缺少测试期回落 ':memory:'");
});
