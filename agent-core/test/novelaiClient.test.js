import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { zipSync } from 'fflate';
import { generateNovelaiImage, checkNovelaiConnection, novelaiEndpoint, buildNovelaiBody, normalizeNovelaiKey, describeNovelaiError } from '../src/services/novelaiClient.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64');
const options = { apiFormat: 'native', url: 'https://relay.example/prefix', apiKey: '  Bearer secret-key  ', model: 'nai-diffusion-4-5-full' };
function mock(fetch) {
  let closed = false;
  return { fetch, createDispatcher: () => ({ close: async () => { closed = true; } }), get closed() { return closed; } };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('relay accepts domain, /v1, full endpoint and prefixed endpoints without duplicate paths', () => {
  for (const suffix of ['', '/', '/v1', '/v1/', '/v1/images/generations', '/v1/models']) {
    const base = { apiFormat: 'relay', url: `https://relay.example/proxy${suffix}` };
    assert.equal(novelaiEndpoint(base), 'https://relay.example/proxy/v1/images/generations');
    assert.equal(novelaiEndpoint(base, 'health'), 'https://relay.example/proxy/v1/models');
  }
  for (const suffix of ['', '/', '/ai', '/ai/generate-image', '/user/subscription']) {
    assert.equal(novelaiEndpoint({ ...options, url: `https://relay.example/proxy${suffix}` }), 'https://relay.example/proxy/ai/generate-image');
  }
  assert.equal(novelaiEndpoint({ apiFormat: 'official', url: 'https://ignored.example' }), 'https://image.novelai.net/ai/generate-image');
  assert.throws(() => novelaiEndpoint({ ...options, url: 'file:///tmp' }), /HTTP/);
  assert.throws(() => novelaiEndpoint({ ...options, url: 'https://user:password@relay.example' }), /密码/);
});

test('native payload includes seed, negative prompt and model-specific V4/V5 structure', () => {
  for (const [model, version] of [['nai-diffusion-3', 1], ['nai-diffusion-4-5-full', 3], ['nai-diffusion-5-full', 4]]) {
    const body = buildNovelaiBody('cat', { ...options, model, negativePrompt: 'text' });
    assert.equal(body.input, 'cat');
    assert.equal(body.parameters.params_version, version);
    assert.equal(body.parameters.negative_prompt, 'text');
    assert.ok(Number.isInteger(body.parameters.seed) && body.parameters.seed >= 0 && body.parameters.seed < 2 ** 32);
    assert.equal(body.parameters.n_samples, 1);
    assert.equal(body.parameters.qualityToggle, false);
    if (version > 1) assert.equal(body.parameters.v4_negative_prompt.caption.base_caption, 'text');
    else assert.equal(body.parameters.v4_prompt, undefined);
  }
  assert.equal(normalizeNovelaiKey(' Bearer secret '), 'secret');
});

test('native generation reads ZIP (including octet-stream), does not extract files to disk, strips Bearer prefix', async () => {
  const deps = mock(async (url, init) => {
    assert.equal(url, 'https://relay.example/prefix/ai/generate-image');
    assert.equal(init.headers.Authorization, 'Bearer secret-key');
    assert.equal(init.redirect, 'manual');
    assert.equal(JSON.parse(init.body).input, 'cat');
    return new Response(zipSync({ 'image_0.png': png, 'metadata.json': Buffer.from('{}') }), { status: 201, headers: { 'content-type': 'binary/octet-stream' } });
  });
  const result = await generateNovelaiImage('cat', options, deps);
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].base64, `data:image/png;base64,${png.toString('base64')}`);
  assert.equal(deps.closed, true);
});

test('native JSON and OpenAI b64_json remain supported', async () => {
  for (const apiFormat of ['official', 'native', 'relay']) {
    const deps = mock(async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(apiFormat === 'relay' ? body.prompt : body.input, 'cat');
      return json(apiFormat === 'relay' ? { data: [{ b64_json: png.toString('base64') }], created: 123 } : { images: [{ image: png.toString('base64') }] });
    });
    const result = await generateNovelaiImage('cat', { ...options, apiFormat }, deps);
    assert.ok(result.images[0].base64.startsWith('data:image/png;base64,'));
  }
});

test('URL image responses are downloaded without the service key', async () => {
  let calls = 0;
  const deps = mock(async (url, init) => {
    calls++;
    if (calls === 1) return json({ data: [{ url: 'https://cdn.example/image.png?signature=test' }] });
    assert.equal(init.headers, undefined);
    assert.equal(url, 'https://cdn.example/image.png?signature=test');
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  });
  assert.equal((await generateNovelaiImage('cat', { ...options, apiFormat: 'relay' }, deps)).images.length, 1);
  assert.equal(calls, 2);
});

test('official health checks subscription, not the text model list', async () => {
  const deps = mock(async url => {
    assert.equal(url, 'https://image.novelai.net/user/subscription');
    return json({ tier: 3 });
  });
  const result = await checkNovelaiConnection({ ...options, apiFormat: 'official' }, deps);
  assert.equal(result.connected, true);
  assert.equal(result.modelSource, 'builtin');
  assert.ok(result.models.includes('nai-diffusion-4-5-full'));
});

test('restricted model/subscription endpoints do not declare relay generation credentials invalid', async () => {
  for (const apiFormat of ['native', 'relay']) {
    for (const status of [401, 403, 404, 405]) {
      const result = await checkNovelaiConnection({ ...options, apiFormat }, mock(async () => json({ error: { message: 'private endpoint secret-key' } }, status)));
      assert.equal(result.connected, null);
      assert.equal(result.authenticated, null);
      assert.match(result.error, /不能据此确定生图 Key 无效/);
      assert.ok(!result.error.includes('secret-key'));
    }
  }
  const official = await checkNovelaiConnection({ ...options, apiFormat: 'official' }, mock(async () => json({ message: 'bad key' }, 401)));
  assert.equal(official.connected, false);
});

const html = (body = '<!doctype html><html><head><title>app</title></head><body>spa</body></html>') =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

test('站点只有生图接口时按「无法验证」处理，并确认生图接口在线', async () => {
  for (const apiFormat of ['native', 'relay']) {
    const calls = [];
    const deps = mock(async (url, init = {}) => {
      calls.push(`${init.method || 'GET'} ${url}`);
      // 生图接口存在：空 body 会得到参数校验错误，而不是网页
      if (url.endsWith('/ai/generate-image') || url.endsWith('/v1/images/generations')) {
        return json({ message: '请求参数不合法：action 只允许 generate' }, 400);
      }
      return html();
    });
    const result = await checkNovelaiConnection({ ...options, apiFormat }, deps);
    assert.equal(result.connected, null);
    assert.equal(result.authenticated, null);
    assert.equal(result.detectionEndpoint, false);
    assert.match(result.error, /返回的是网页/);
    assert.match(result.error, /已确认 .* 提供生图接口/);
    assert.ok(!result.error.includes('secret-key'));
  }
});

test('生图接口也没有时不会谎称「已确认提供生图接口」', async () => {
  const result = await checkNovelaiConnection({ ...options }, mock(async () => html()));
  assert.equal(result.connected, null);
  assert.match(result.error, /返回的是网页/);
  assert.ok(!result.error.includes('已确认'));
});

test('relay list is optional, returned model IDs are retained', async () => {
  const empty = await checkNovelaiConnection({ ...options, apiFormat: 'relay' }, mock(async () => json({ data: [] })));
  assert.equal(empty.connected, true);
  assert.match(empty.message, /手动填写/);
  const list = await checkNovelaiConnection({ ...options, apiFormat: 'relay' }, mock(async () => json({ data: [{ id: options.model }] })));
  assert.deepEqual(list.models, [options.model]);
  assert.equal(list.modelAvailable, true);
});

test('actual generation 401 retains endpoint/status, redacts key and never retries', async () => {
  let calls = 0;
  const deps = mock(async () => { calls++; return new Response('Denied: secret-key', { status: 401 }); });
  await assert.rejects(generateNovelaiImage('cat', options, deps), error => {
    assert.equal(error.status, 401);
    assert.match(error.message, /HTTP 401.*prefix\/ai\/generate-image/);
    assert.ok(!error.message.includes('secret-key'));
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(deps.closed, true);
});

test('redirects are rejected without forwarding the key', async () => {
  let calls = 0;
  await assert.rejects(generateNovelaiImage('cat', options, mock(async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: 'https://other.example' } });
  })), /重定向/);
  assert.equal(calls, 1);
});

test('timeouts, DNS and TLS failures have distinct actionable diagnostics', async () => {
  for (const [code, pattern] of [['UND_ERR_CONNECT_TIMEOUT', /超时/], ['ENOTFOUND', /域名解析/], ['CERT_HAS_EXPIRED', /证书/], ['ECONNREFUSED', /代理端口/]]) {
    const result = await checkNovelaiConnection(options, mock(async () => { throw new TypeError('fetch failed', { cause: { code } }); }));
    assert.equal(result.connected, false);
    assert.match(result.error, pattern);
    assert.ok(result.error.includes(code));
  }
  assert.match(describeNovelaiError({ name: 'TimeoutError' }), /后端/);
});

test('malformed successful replies and non-image data are rejected', async () => {
  for (const response of [new Response('<html>Login</html>'), json({ images: [] }), json({ images: [{ image: 'aGVsbG8=' }] })]) {
    await assert.rejects(generateNovelaiImage('cat', options, mock(async () => response)), /图片|JSON/);
  }
});

test('explicit HTTP proxy carries real native fetch requests and a slow body hits the overall timeout', async t => {
  const sockets = new Set();
  const track = socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); };
  const upstream = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer secret-key');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url.startsWith('/slow/')) { res.write('{'); return; }
    res.end(JSON.stringify({ tier: 3 }));
  });
  let tunnels = 0;
  const proxy = http.createServer();
  proxy.on('connect', (req, socket, head) => {
    tunnels++;
    const [host, port] = req.url.split(':');
    const target = net.connect(Number(port), host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) target.write(head);
      socket.pipe(target); target.pipe(socket);
    });
    track(target);
    target.on('error', () => socket.destroy());
    socket.on('error', () => target.destroy());
  });
  upstream.on('connection', track); proxy.on('connection', track);
  t.after(() => { for (const socket of sockets) socket.destroy(); upstream.close(); proxy.close(); });
  upstream.listen(0, '127.0.0.1'); proxy.listen(0, '127.0.0.1');
  await Promise.all([once(upstream, 'listening'), once(proxy, 'listening')]);
  const url = `http://127.0.0.1:${upstream.address().port}`;
  const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
  const success = await checkNovelaiConnection({ ...options, url, proxyUrl });
  assert.equal(success.connected, true);
  assert.equal(tunnels, 1);
  const names = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'];
  const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.HTTP_PROXY = proxyUrl;
    assert.equal((await checkNovelaiConnection({ ...options, url })).connected, true);
    assert.equal(tunnels, 2);
    process.env.NO_PROXY = '127.0.0.1';
    assert.equal((await checkNovelaiConnection({ ...options, url })).connected, true);
    assert.equal(tunnels, 2, 'NO_PROXY must bypass the environment proxy');
  } finally {
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  }
  const slow = await checkNovelaiConnection({ ...options, url: `${url}/slow`, proxyUrl, timeoutMs: 150 });
  assert.equal(slow.connected, false);
  assert.match(slow.error, /超时/);
});
