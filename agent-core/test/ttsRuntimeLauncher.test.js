import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../tts-service/', import.meta.url));
const python = path.join(root, 'runtime/python/cpython-3.11.13-windows-x86_64-none/python.exe');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const windows = process.platform === 'win32';

test('deployment launcher preserves argv and diagnostics without native command discovery',
  { skip: !windows || !existsSync(python) ? 'requires Windows and bundled Python' : false }, t => {
    const directory = mkdtempSync(path.join(tmpdir(), '邻舍 启动测试-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    copyFileSync(path.join(root, 'runtime.ps1'), path.join(directory, 'runtime.ps1'));
    copyFileSync(path.join(root, 'local-models.json'), path.join(directory, 'local-models.json'));
    writeFileSync(path.join(directory, 'deployment.py'), `import sys, json, os, time
assert not os.environ.get('PYTHONHOME')
assert '.EXE' in os.environ['PATHEXT'].upper().split(';')
assert os.path.isfile(os.environ['ComSpec'])
if sys.argv[1] == 'model':
    assert sys.argv[2:] == ['--model', '2.0'], repr(sys.argv)
    sys.exit(0)
if sys.argv[1] == 'sleep':
    print('before timeout', flush=True)
    time.sleep(30)
if sys.argv[1] == 'fail':
    print('真实错误信息', file=sys.stderr)
    print('stdout detail')
    sys.exit(23)
if sys.argv[1] == 'flood':
    sys.stdout.write('o' * 100000)
    sys.stderr.write('e' * 100000)
else:
    expected = ['ok', '中文 空格', 'a"b', 'C:\\\\folder with spaces\\\\']
    assert sys.argv[1:] == expected, repr(sys.argv)
`);
    const run = (executable, args, prefix = '', flags = '') => spawnSync(
      path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
        `[Console]::OutputEncoding = [Text.Encoding]::UTF8; $ErrorActionPreference = 'Stop'; . ${quote(path.join(directory, 'runtime.ps1'))}; ${prefix} try { Invoke-TtsDeploymentStep -Python ${quote(executable)} -FailMessage 'STEP FAILED' ${flags} ${args.map(quote).join(' ')}; 'STEP OK' } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`],
      { encoding: 'utf8', timeout: 20000, windowsHide: true,
        env: { ...process.env, TTS_LOCAL_MODEL: '2.0', PATHEXT: '.BAD', ComSpec: 'Z:\\missing\\cmd.exe', PYTHONHOME: 'Z:\\other-python' } });
    const ok = run(python, ['ok', '中文 空格', 'a"b', 'C:\\folder with spaces\\']);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /STEP OK/);
    const modelArgs = run(python, [], '', 'model --model 2.0');
    assert.equal(modelArgs.status, 0, modelArgs.stderr);
    const flood = run(python, ['flood']);
    assert.equal(flood.status, 0, flood.stderr || String(flood.error));
    const failure = run(python, ['fail']);
    assert.equal(failure.status, 1);
    assert.match(failure.stderr, /23/);
    assert.match(failure.stderr, /真实错误信息/);
    assert.match(failure.stderr, /stdout detail/);
    const probe = run(python, ['self-check'], '', '-Probe');
    assert.equal(probe.status, 0, probe.stderr);
    const timeout = run(python, ['sleep'], '', '-TimeoutSeconds 1');
    assert.equal(timeout.status, 1, timeout.stderr);
    assert.match(timeout.stderr, /超时/);
    for (const name of ['missing.exe', 'invalid.exe']) {
      const executable = path.join(directory, name);
      if (name === 'invalid.exe') writeFileSync(executable, 'not an executable');
      const result = run(executable, ['ok'], '$global:LASTEXITCODE = 0;');
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Win32/);
      assert.match(result.stderr, /STEP FAILED/);
      assert.ok(result.stderr.includes(executable), result.stderr);
      assert.doesNotMatch(result.stderr, /PATHEXT\/ComSpec/);
    }
    const log = readFileSync(path.join(directory, 'logs/tts-startup.log'), 'utf8');
    assert.match(log, /真实错误信息/);
    assert.match(log, /before timeout/);
    assert.match(log, /python-self-check/);
    assert.match(log, /Win32/);
    // An unwritable log destination must not replace the launch failure.
    rmSync(path.join(directory, 'logs'), { recursive: true });
    writeFileSync(path.join(directory, 'logs'), 'blocked');
    const blockedLog = run(python, ['fail']);
    assert.match(blockedLog.stderr, /真实错误信息/);
  });
