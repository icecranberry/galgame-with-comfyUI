import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { spawnSync } from 'node:child_process';

let sequence = 0;
async function processTools(execSync, platform = 'win32') {
  const key = `__startupCleanup${++sequence}`;
  globalThis[key] = { execSync, os: { platform: () => platform } };
  const mockUrl = `data:text/javascript,${encodeURIComponent(`
    export const execSync = globalThis.${key}.execSync;
    export default globalThis.${key}.os;
  `)}`;
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (['child_process', 'os'].includes(specifier)) return { url: mockUrl, shortCircuit: true };
      return next(specifier, context);
    },
  });
  try {
    return await import(`../../scripts/lib/projectProcesses.mjs?test=${sequence}`);
  } finally {
    hooks.deregister();
    delete globalThis[key];
  }
}

const clean = () => ({ tableReadable: true, leftover: [] });

test('启动门槛拒绝残留进程和无法确认的清理结果', async () => {
  const { assertCleanupSucceeded } = await processTools(() => assert.fail('失败时不应继续检查端口'));
  assert.throws(() => assertCleanupSucceeded({ tableReadable: false, leftover: [] }), /进程表读取失败/);
  assert.throws(() => assertCleanupSucceeded({ tableReadable: true, leftover: null }), /进程表读取失败/);
  assert.throws(() => assertCleanupSucceeded({ tableReadable: true, leftover: [
    { ProcessId: 42, CommandLine: 'node agent-core/app.js' },
  ] }), /PID 42.*agent-core/);
});

test('端口检查只匹配目标监听端口，支持 IPv6 和多个占用进程', async () => {
  let output = 'TCP 0.0.0.0:30990 0.0.0.0:0 LISTENING 10\nTCP 127.0.0.1:5000 127.0.0.1:3099 ESTABLISHED 11';
  const { assertCleanupSucceeded, listeningPids } = await processTools(command => {
    assert.equal(command, 'netstat -ano');
    return output;
  });
  assert.doesNotThrow(() => assertCleanupSucceeded(clean(), { ports: [3099] }));
  output += '\nTCP 0.0.0.0:3099 0.0.0.0:0 LISTENING 12\nTCP [::]:3099 [::]:0 LISTENING 13';
  assert.deepEqual(listeningPids(3099), ['12', '13']);
  assert.throws(() => assertCleanupSucceeded(clean(), { ports: [3099] }), /3099.*12, 13/);
});

test('端口查询失败不能被解释为空闲；后端重启只检查 3099', async () => {
  const failing = await processTools(() => { throw new Error('netstat unavailable'); });
  assert.throws(() => failing.assertCleanupSucceeded(clean()), /无法确认端口 3099.*netstat unavailable/);
  const available = await processTools(() => 'TCP 0.0.0.0:8765 0.0.0.0:0 LISTENING 20');
  assert.doesNotThrow(() => available.assertCleanupSucceeded(clean(), { ports: [3099] }));
  assert.throws(() => available.assertCleanupSucceeded(clean()), /8765/);
});

test('Unix 端口检查区分无匹配项和命令执行失败', async () => {
  let failure = Object.assign(new Error('no listeners'), { status: 1, stdout: '', stderr: '' });
  const { assertCleanupSucceeded } = await processTools(command => {
    assert.equal(command, 'lsof -nP -iTCP:3099 -sTCP:LISTEN -t');
    throw failure;
  }, 'linux');
  assert.doesNotThrow(() => assertCleanupSucceeded(clean(), { ports: [3099] }));
  failure = Object.assign(new Error('not found'), { status: 127, stderr: 'lsof: not found' });
  assert.throws(() => assertCleanupSucceeded(clean(), { ports: [3099] }), /无法确认端口/);
});

// 独立进程执行真实 CLI 和清理模块，只替换系统边界；任何 spawn 都在执行前退出。
async function cliHarness(entry, scenario, dryRun = false) {
  const { registerHooks } = await import('node:module');
  const realExit = process.exit.bind(process);
  const write = process.stdout.write.bind(process.stdout);
  const result = { spawns: 0, shutdownRequests: 0, errors: [], tableReads: 0, portReads: 0, kills: 0 };
  function finish(code) { write(JSON.stringify(result)); realExit(code); }
  process.exit = finish;
  console.log = console.clear = console.warn = () => {};
  console.error = (...args) => result.errors.push(args.join(' '));
  process.stdout.write = () => true;
  globalThis.fetch = async () => { result.shutdownRequests++; return { ok: true }; };
  let elapsed = 0;
  const now = Date.now();
  Date.now = () => now + elapsed;
  globalThis.setTimeout = (fn, ms) => { elapsed += ms; queueMicrotask(fn); return { unref() {} }; };
  if (dryRun) process.argv.push('--dry');
  globalThis.__startupSystem = {
    execSync(command) {
      if (command.includes('Where-Object')) {
        result.tableReads++;
        if (scenario === 'unreadable' || (scenario === 'recheck_failed' && result.tableReads > 1)
          || (scenario === 'table_recovers' && result.tableReads <= 2)) throw new Error('access denied');
        return JSON.stringify(scenario === 'survivor' || (scenario === 'delayed_exit' && result.tableReads <= 2) ? [
          { ProcessId: 111, ParentProcessId: 0, Name: 'node.exe', CommandLine: 'node agent-core/app.js' },
        ] : []);
      }
      if (command.includes('Get-CimInstance')) return '[]';
      if (command.startsWith('taskkill')) {
        result.kills++;
        if (scenario === 'delayed_exit') return 'terminated';
        throw new Error('access denied');
      }
      if (command === 'netstat -ano') {
        result.portReads++;
        if (scenario === 'port_check_failed') throw new Error('netstat failed');
        return scenario === 'port_occupied' || (scenario === 'delayed_port_release' && result.portReads <= 4)
          ? 'TCP 0.0.0.0:3099 0.0.0.0:0 LISTENING 222' : '';
      }
      if (command.includes('Get-Process')) return 'other-app';
      if (command === 'node -v') return 'v22';
      if (command === 'python --version') return 'Python 3';
      throw new Error(`Unexpected command: ${command}`);
    },
    spawn() { result.spawns++; finish(0); },
  };
  const sources = {
    child_process: 'export const {execSync,spawn}=globalThis.__startupSystem;',
    os: "export default {platform:()=> 'win32'};",
    fs: 'export const existsSync=()=>true;',
    readline: 'export const createInterface=()=>({on(){}});',
  };
  registerHooks({ resolve(specifier, context, next) {
    const source = sources[specifier.replace(/^node:/, '')];
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return next(specifier, context);
  } });
  await import(entry);
  if (entry.endsWith('/stop.mjs')) finish(0);
}

for (const entry of ['dev', 'restart-core']) {
  for (const scenario of ['clean', 'delayed_exit', 'delayed_port_release', 'table_recovers', 'survivor', 'unreadable', 'recheck_failed', 'port_occupied', 'port_check_failed']) {
    const succeeds = ['clean', 'delayed_exit', 'delayed_port_release', 'table_recovers'].includes(scenario);
    test(`${entry}：${scenario} ${succeeds ? '允许启动' : '阻止启动并以非零状态退出'}`, () => {
      const url = new URL(`../../scripts/${entry}.mjs`, import.meta.url).href;
      const script = `(${cliHarness.toString()})(${JSON.stringify(url)},${JSON.stringify(scenario)});`;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10000 });
      assert.ifError(child.error);
      assert.equal(child.status, succeeds ? 0 : 1, child.stderr || child.stdout);
      const result = JSON.parse(child.stdout);
      assert.equal(result.spawns, succeeds ? 1 : 0);
      assert.equal(result.shutdownRequests, entry === 'dev' ? 0 : 1, '失败退出不能额外关闭旧实例');
      if (!succeeds) assert.match(result.errors.join('\n'), /已取消启动/);
      if (scenario === 'delayed_exit') {
        assert.equal(result.kills, 1, '等待退出时只复查，不反复杀进程');
        assert.ok(result.tableReads >= 3, '必须重新读取进程表，不能沿用旧快照');
      }
    });
  }
}

for (const dryRun of [false, true]) {
  test(`stop ${dryRun ? '--dry' : ''} 保持尽力清理的原行为，不套启动门槛`, () => {
    const url = new URL('../../scripts/stop.mjs', import.meta.url).href;
    const script = `(${cliHarness.toString()})(${JSON.stringify(url)},'survivor',${dryRun});`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const result = JSON.parse(child.stdout);
    assert.equal(result.spawns, 0);
    assert.equal(result.kills, dryRun ? 0 : 1);
    assert.equal(result.shutdownRequests, dryRun ? 0 : 1);
  });
}
