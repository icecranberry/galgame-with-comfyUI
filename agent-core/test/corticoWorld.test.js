import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const framework = new URL('../../Cortico/src/', import.meta.url);
const available = existsSync(new URL('core/util.ts', framework));
let LinsheWorld;
if (available) {
  // The optional Cortico checkout supplies the extension's public framework imports.
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      return nextResolve(specifier.startsWith('cortico/') ? new URL(specifier.slice(8), framework).href : specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.startsWith('file:') && url.endsWith('.ts')) {
        return { format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform', sourceUrl: url }), shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
  ({ LinsheWorld } = await import('../src/cortico-bridge/world/src/world.ts'));
  hooks.deregister();
}

const worldTest = (name, fn) => test(name, { skip: available ? false : 'Install the optional Cortico checkout to test its World extension' }, fn);
const servers = new Set();
after(async () => { await Promise.all([...servers].map(server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }))); });

async function harness(handler) {
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const call = { method: req.method, url: new URL(req.url, 'http://local.test'), body };
    calls.push(call);
    try {
      const result = await handler(call, req, res);
      if (res.writableEnded || result === undefined) return;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  servers.add(server);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const world = new LinsheWorld({ cfg: { enabled: true, baseUrl, taskTimeoutSec: 30 }, timezone: 'Asia/Shanghai' });
  const run = (name, args = {}, ctx = {}) => world.tools().find(tool => tool.name === name).handler(args, ctx);
  return { world, run, calls, baseUrl };
}

worldTest('all read tools preserve selected characters, paging, dates and event IDs', async () => {
  const { run, calls } = await harness(({ url }) => ({ path: url.pathname, query: Object.fromEntries(url.searchParams), content: '邻舍生活' }));
  const cases = [
    ['characters', {}, '/characters', {}],
    ['character', { character_id: 7 }, '/character', { character_id: '7' }],
    ['appearance', { character_id: 7 }, '/appearance', { character_id: '7' }],
    ['moments', { character_id: 7, before_id: 22, limit: 2 }, '/moments', { character_id: '7', before_id: '22', limit: '2' }],
    ['moment', { post_id: 23 }, '/moments/23', {}],
    ['events', { limit: 2, offset: 4 }, '/events', { limit: '2', offset: '4' }],
    ['event', { event_id: 'town:9' }, '/events/by-id/town%3A9', {}],
    ['event', { event_id: 'bfeat:10' }, '/events/by-id/bfeat%3A10', {}],
    ['schedule', { character_id: 7 }, '/schedule', { character_id: '7' }],
    ['schedule', { character_id: 7, full: true }, '/schedule', { character_id: '7', full: 'true' }],
    ['newspaper', { date: '2026-10-25' }, '/newspaper', { date: '2026-10-25' }],
    ['diary', { character_id: 7, date: '2026-10-24' }, '/diary', { character_id: '7', date: '2026-10-24' }],
    ['world', {}, '/world', {}],
  ];
  for (const [name, args, path, query] of cases) {
    const result = JSON.parse(await run(`linshe_${name}`, args));
    assert.deepEqual(result, { path: `/api/cortico${path}`, query, content: '小镇生活' });
  }
  assert.equal(calls.length, cases.length);
});

worldTest('image generation, image recovery and TTS return sendable media bytes', async () => {
  const { run, calls } = await harness(({ url }, req, res) => {
    if (url.pathname === '/api/cortico/generate') return { task_id: 21 };
    if (url.pathname === '/api/cortico/tts') return { id: 'speech-test' };
    if (url.pathname === '/api/cortico/tasks/21') return { status: 'done', image: { url: '/images/a.png' } };
    if (url.pathname === '/api/cortico/speech/speech-test') return { status: 'completed', audio_url: '/speech/a.wav' };
    res.setHeader('content-type', url.pathname.endsWith('.wav') ? 'audio/wav' : 'image/png');
    res.end(Buffer.from([1, 2, 3]));
  });
  for (const [name, args, mime] of [
    ['linshe_generate_image', { requirement: '在花园拍照', character_id: 7 }, 'image/png'],
    ['linshe_task', { task_id: 21 }, 'image/png'],
    ['linshe_tts', { text: '晚安', character_id: 7 }, 'audio/wav'],
  ]) {
    const result = await run(name, args);
    assert.equal(result.blobs.length, 1);
    assert.equal(result.blobs[0].mime, mime);
    assert.deepEqual([...result.blobs[0].bytes], [1, 2, 3]);
  }
  assert.deepEqual(calls.find(call => call.url.pathname.endsWith('/tts')).body, { text: '晚安', character_id: 7 });
  await run('linshe_generate_image', { requirement: '在花园拍照', character_id: 7 });
  await run('linshe_generate_image', { requirement: '在花园拍照', character_id: 7, nonce: 'another' });
  const submissions = calls.filter(call => call.url.pathname.endsWith('/generate'));
  assert.equal(submissions[0].body.request_id, submissions[1].body.request_id);
  assert.notEqual(submissions[0].body.request_id, submissions[2].body.request_id);
});

worldTest('moment image sharing delivers every image and reports empty posts', async () => {
  const { run } = await harness(({ url }, req, res) => {
    if (url.pathname === '/api/cortico/moments/1/images') return { images: ['/images/a.png', '/images/b.png'] };
    if (url.pathname === '/api/cortico/moments/2/images') return { images: [] };
    res.setHeader('content-type', 'image/png');
    res.end(url.pathname);
  });
  const result = await run('linshe_moment_images', { post_id: 1 });
  assert.equal(result.blobs.length, 2);
  assert.deepEqual(result.blobs.map(blob => Buffer.from(blob.bytes).toString()), ['/images/a.png', '/images/b.png']);
  assert.match(await run('linshe_moment_images', { post_id: 2 }), /没有配图/);
  await assert.rejects(run('linshe_moment_images'), /post_id 或 paths/);
});

worldTest('tool failures preserve service errors and reject foreign or oversized media', async () => {
  const { run } = await harness(({ url }, req, res) => {
    if (url.pathname === '/api/cortico/bootstrap') return { tools: [{ name: 'linshe_moment_images' }] };
    if (url.pathname === '/api/cortico/tasks/1') return { status: 'failed', error: '绘图服务不可用' };
    if (url.pathname === '/api/cortico/character') { res.statusCode = 403; return { error: '人物卡工具已关闭' }; }
    res.setHeader('content-length', String(32 * 1024 * 1024 + 1));
    res.end();
  });
  assert.equal(JSON.parse(await run('linshe_task', { task_id: 1 })).status, 'failed');
  await assert.rejects(run('linshe_character'), /人物卡工具已关闭/);
  await assert.rejects(run('linshe_moment_images', { paths: ['//unrelated.test/a.png'] }), /不属于已配置/);
  await assert.rejects(run('linshe_moment_images', { paths: ['/images/large.png'] }), /超过 32MB/);
});

worldTest('direct moment image paths obey the current moments permission', async () => {
  let enabled = false;
  const { run, calls } = await harness(({ url }, req, res) => {
    if (url.pathname === '/api/cortico/bootstrap') return { tools: enabled ? [{ name: 'linshe_moment_images' }] : [] };
    res.setHeader('content-type', 'image/png');
    res.end('photo');
  });
  await assert.rejects(run('linshe_moment_images', { paths: ['/images/private.png'] }), /已关闭 moments/);
  assert.ok(calls.every(call => call.url.pathname === '/api/cortico/bootstrap'));
  enabled = true;
  const result = await run('linshe_moment_images', { paths: ['/images/private.png'] });
  assert.equal(result.blobs[0].mime, 'image/png');
});

worldTest('a completed speech task remains retrievable after its initial tool times out', async () => {
  const { run } = await harness(({ url }, req, res) => {
    if (url.pathname === '/api/cortico/speech/speech-later') return { status: 'done', audio_url: '/speech/later.wav' };
    res.setHeader('content-type', 'audio/wav');
    res.end('voice');
  });
  const result = await run('linshe_task', { kind: 'speech', task_id: 'speech-later' });
  assert.equal(result.blobs[0].mime, 'audio/wav');
  assert.match(result.text, /voice/);
});

worldTest('cancelled calls stop before requesting content or submitting generation', async () => {
  const { run, calls } = await harness(() => ({ ok: true }));
  for (const [name, args] of [['linshe_world', {}], ['linshe_generate_image', { requirement: '花园' }], ['linshe_tts', { text: '晚安' }]]) {
    await assert.rejects(run(name, args, { signal: AbortSignal.abort() }), /取消/);
  }
  assert.equal(calls.length, 0);
});

worldTest('cancellation interrupts an active query and a pending media download', async () => {
  for (const [name, args, target] of [
    ['linshe_world', {}, '/api/cortico/world'],
    ['linshe_task', { task_id: 1 }, '/images/pending.png'],
  ]) {
    let received;
    const ready = new Promise(resolve => { received = resolve; });
    const { run } = await harness(({ url }) => {
      if (url.pathname === '/api/cortico/tasks/1') return { status: 'done', image: { url: '/images/pending.png' } };
      if (url.pathname === target) received();
    });
    const controller = new AbortController();
    const pending = run(name, args, { signal: controller.signal });
    await ready;
    controller.abort();
    await assert.rejects(pending, /abort|取消/i);
  }
});

worldTest('pending image and speech HTTP requests respect the task deadline with a caller signal', async () => {
  const { run } = await harness(({ url }) => {
    if (url.pathname === '/api/cortico/generate') return { task_id: 1 };
    if (url.pathname === '/api/cortico/tts') return { id: 'speech-timeout' };
    // Leave the polling responses open to exercise the real fetch deadline.
  });
  const started = Date.now();
  const [image, speech] = await Promise.all([
    run('linshe_generate_image', { requirement: '花园' }, { signal: new AbortController().signal }),
    run('linshe_tts', { text: '晚安' }, { signal: new AbortController().signal }),
  ]);
  assert.ok(Date.now() - started < 35000, 'the HTTP request must not extend the 30-second task deadline');
  assert.match(image, /linshe_task\(task_id=1\)/);
  assert.match(speech, /linshe_task\(kind="speech", task_id="speech-timeout"\)/);
});
