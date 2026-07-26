import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildCodexImagePrompt,
  generateImageWithCodex,
  getCodexImageStatus,
  resolveCodexExecutable,
  resolveCodexHome,
  resolveReferenceImagePath,
  runProcess,
} from '../src/services/codexImageClient.js';

test('resolves local Codex configuration without reading auth secrets', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'galgame-codex-status-'));
  const previous = {
    CODEX_HOME: process.env.CODEX_HOME,
    CODEX_EXECUTABLE: process.env.CODEX_EXECUTABLE,
  };
  try {
    fs.mkdirSync(path.join(root, 'skills', '.system', 'imagegen'), { recursive: true });
    fs.writeFileSync(path.join(root, 'config.toml'), 'model = "test"\n');
    fs.writeFileSync(path.join(root, 'skills', '.system', 'imagegen', 'SKILL.md'), '# imagegen\n');
    process.env.CODEX_HOME = root;
    process.env.CODEX_EXECUTABLE = process.execPath;

    const runner = async (_executable, args) => {
      if (args[0] === '--version') return { code: 0, stdout: 'codex-cli test\n', stderr: '' };
      return { code: 0, stdout: 'Logged in using ChatGPT\n', stderr: '' };
    };
    const status = await getCodexImageStatus({ refresh: true, runner });
    assert.equal(status.available, true);
    assert.equal(status.loggedIn, true);
    assert.equal(status.skillFound, true);
    assert.equal(resolveCodexHome(), root);
    assert.equal(resolveCodexExecutable(), process.execPath);
  } finally {
    if (previous.CODEX_HOME === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous.CODEX_HOME;
    if (previous.CODEX_EXECUTABLE === undefined) delete process.env.CODEX_EXECUTABLE;
    else process.env.CODEX_EXECUTABLE = previous.CODEX_EXECUTABLE;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('builds an identity-aware Image 2 prompt', () => {
  const prompt = buildCodexImagePrompt('character reading by a window', {
    artist: 'soft anime illustration',
    width: 768,
    height: 1024,
    loras: [{ triggerWord: 'silver hair' }],
    referenceImages: ['one.png'],
    outputPath: 'C:\\workspace\\result.png',
  });
  assert.match(prompt, /Identity references: 1/);
  assert.match(prompt, /soft anime illustration, silver hair/);
  assert.match(prompt, /768x1024/);
  assert.match(prompt, /only as visual content/);
});

test('runs the Codex adapter contract and returns the generated image', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'galgame-codex-generate-'));
  const reference = path.join(root, 'reference.png');
  const previous = {
    CODEX_HOME: process.env.CODEX_HOME,
    CODEX_EXECUTABLE: process.env.CODEX_EXECUTABLE,
  };
  try {
    fs.mkdirSync(path.join(root, 'skills', '.system', 'imagegen'), { recursive: true });
    fs.writeFileSync(path.join(root, 'config.toml'), '');
    fs.writeFileSync(path.join(root, 'skills', '.system', 'imagegen', 'SKILL.md'), '# imagegen\n');
    fs.writeFileSync(reference, Buffer.from('reference'));
    process.env.CODEX_HOME = root;
    process.env.CODEX_EXECUTABLE = process.execPath;

    let execArgs = [];
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/6XyZ8QAAAABJRU5ErkJggg==', 'base64');
    const runner = async (_executable, args, options = {}) => {
      if (args[0] === '--version') return { code: 0, stdout: 'codex-cli test\n', stderr: '' };
      if (args[0] === 'login') return { code: 0, stdout: 'Logged in using ChatGPT\n', stderr: '' };
      execArgs = args;
      const outputPath = options.input.match(/exact workspace path: (.+)/)?.[1]?.trim();
      assert.ok(outputPath);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, png);
      return { code: 0, stdout: '{"type":"done"}\n', stderr: '' };
    };

    const result = await generateImageWithCodex('a calm portrait', {
      referenceImages: [reference],
      runner,
    });
    assert.equal(result.images.length, 1);
    assert.match(result.images[0].base64, /^data:image\/png;base64,/);
    assert.deepEqual(execArgs.slice(0, 3), ['exec', '--image', reference]);
    assert.equal(resolveReferenceImagePath(reference), reference);
  } finally {
    if (previous.CODEX_HOME === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous.CODEX_HOME;
    if (previous.CODEX_EXECUTABLE === undefined) delete process.env.CODEX_EXECUTABLE;
    else process.env.CODEX_EXECUTABLE = previous.CODEX_EXECUTABLE;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('spawns subprocesses without a shell', async () => {
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("ok")'], { timeoutMs: 5000 });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'ok');
});
