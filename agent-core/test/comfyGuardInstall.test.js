import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('guard installer handles configured paths, repeat installs, backup, check-only and remote hosts', { skip: process.platform !== 'win32' }, t => {
  const temp = mkdtempSync(path.join(tmpdir(), '邻舍 guard '));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const source = fileURLToPath(new URL('../../tts-service/', import.meta.url));
  const service = path.join(temp, 'tts-service');
  mkdirSync(path.join(service, 'comfy_guard'), { recursive: true });
  for (const file of ['install-comfy-guard.ps1', 'comfy_guard/__init__.py']) copyFileSync(path.join(source, file), path.join(service, file));
  const bundle = path.join(temp, '绘图整合包');
  const root = path.join(bundle, 'ComfyUI');
  for (const dir of ['custom_nodes', 'comfy']) mkdirSync(path.join(root, dir), { recursive: true });
  for (const file of ['main.py', 'server.py', '__init__.py']) writeFileSync(path.join(root, file), 'original');
  const exe = path.join(bundle, '绘世启动器.exe');
  writeFileSync(exe, 'fixture');
  const config = value => writeFileSync(path.join(temp, 'launcher_config.json'), JSON.stringify({ comfyui_exe: value }));
  config(exe);
  const run = (...args) => spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(service, 'install-comfy-guard.ps1'), ...args],
    { encoding: 'utf8', windowsHide: true, timeout: 15000, env: { ...process.env, TTS_COMFYUI_URL: '' } });
  const target = path.join(root, 'custom_nodes/linshe_tts_guard/__init__.py');
  const check = run('-CheckOnly');
  assert.equal(check.status, 0, check.stderr + check.stdout);
  assert.equal(existsSync(target), false);
  assert.equal(run('-ComfyUrl', 'http://remote.invalid:8188').status, 0);
  assert.equal(existsSync(target), false);
  const installed = run();
  assert.equal(installed.status, 0, installed.stderr + installed.stdout);
  assert.deepEqual(readFileSync(target), readFileSync(path.join(source, 'comfy_guard/__init__.py')));
  assert.equal(readFileSync(path.join(root, '__init__.py'), 'utf8'), 'original');
  assert.equal(run().status, 0);
  assert.deepEqual(readdirSync(path.dirname(target)), ['__init__.py']);
  writeFileSync(target, 'old-node');
  assert.equal(run().status, 0);
  const backup = readdirSync(path.dirname(target)).find(name => name.endsWith('.bak'));
  assert.equal(readFileSync(path.join(path.dirname(target), backup), 'utf8'), 'old-node');
  config(path.join(temp, 'moved.exe'));
  writeFileSync(target, 'do-not-touch');
  assert.equal(run().status, 0);
  assert.equal(readFileSync(target, 'utf8'), 'do-not-touch');
  assert.equal(run('-ComfyRoot', temp).status, 1);
  assert.equal(run('-ComfyRoot', root).status, 0);
  // A complete offline runtime must not bypass node installation in setup.
  config(exe);
  copyFileSync(path.join(source, 'setup.ps1'), path.join(service, 'setup.ps1'));
  mkdirSync(path.join(service, 'runtime'));
  writeFileSync(path.join(service, 'runtime/runtime.json'), '{}');
  writeFileSync(path.join(service, 'runtime.ps1'), "$bundleRoot = Join-Path $PSScriptRoot 'runtime'\nfunction Initialize-TtsRuntime {}\n");
  writeFileSync(target, 'offline-old-node');
  const setup = spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(service, 'setup.ps1')],
    { encoding: 'utf8', windowsHide: true, timeout: 15000, env: { ...process.env, TTS_COMFYUI_URL: '' } });
  assert.equal(setup.status, 0, setup.stderr + setup.stdout);
  assert.deepEqual(readFileSync(target), readFileSync(path.join(source, 'comfy_guard/__init__.py')));
});
