import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { parseServiceAccount, normalizeVertexRegion, vertexBaseURL, getVertexAccessToken, clearVertexTokenCache, buildVertexBody, createVertexClient, listVertexModels } from '../src/llm/vertex-client.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = { type: 'service_account', project_id: 'test-project', client_email: 'test@test-project.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const reply = { candidates: [{ content: { parts: [{ thought: true, text: 'reasoning' }, { text: '正文' }] }, finishReason: 'MAX_TOKENS' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 3, totalTokenCount: 113, cachedContentTokenCount: 80 } };

test('service account validation and fixed Google hosts reject malformed credentials and path/host injection', () => {
  for (const raw of ['', '{', '[]', '{}', { ...account, type: 'authorized_user' }, { ...account, private_key: 'secret-not-a-key' }]) assert.throws(() => parseServiceAccount(raw), { status: 400 });
  assert.deepEqual(parseServiceAccount(JSON.stringify(account)), account);
  assert.equal(vertexBaseURL('global'), 'https://aiplatform.googleapis.com');
  assert.equal(vertexBaseURL('us-central1'), 'https://us-central1-aiplatform.googleapis.com');
  for (const region of ['', '../global', 'global.evil.invalid/', 'global@evil']) assert.throws(() => normalizeVertexRegion(region));
});

test('OAuth uses a verified RS256 assertion, caches tokens, refreshes expiry, isolates accounts and honors cancellation', async t => {
  clearVertexTokenCache();
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.equal(options.redirect, 'error');
    const [header, payload, signature] = options.body.get('assertion').split('.');
    assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'RS256');
    const claim = JSON.parse(Buffer.from(payload, 'base64url'));
    assert.equal(claim.aud, url);
    assert.equal(claim.scope, 'https://www.googleapis.com/auth/cloud-platform');
    assert.equal(claim.exp - claim.iat, 3600);
    assert.equal(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')), true);
    return json({ access_token: `token-${calls}`, expires_in: 3600 });
  };
  const credential = { ...account, token_uri: 'https://evil.invalid' };
  assert.equal(await getVertexAccessToken(credential, { fetchImpl }), 'token-1');
  assert.equal(await getVertexAccessToken(credential, { fetchImpl }), 'token-1');
  await getVertexAccessToken({ ...account, client_email: 'second@example.com' }, { fetchImpl });
  assert.equal(calls, 2);
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 3600000);
  assert.equal(await getVertexAccessToken(credential, { fetchImpl }), 'token-3');
  await assert.rejects(getVertexAccessToken(account, { signal: AbortSignal.abort(), fetchImpl }), { name: 'AbortError' });
  assert.equal(calls, 3);
});

test('native body preserves stable system parts, historical positions, images and configured output limits', () => {
  const messages = [
    { role: 'system', content: 'stable rules' }, { role: 'system', content: 'persona' },
    { role: 'user', content: 'previous' }, { role: 'assistant', content: 'reply' },
    { role: 'system', content: 'dynamic tail' },
    { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } }] },
  ];
  const original = structuredClone(messages);
  const body = buildVertexBody({ model: 'gemini-2.5-flash', messages, max_tokens: 12000, thinking: { type: 'disabled' }, generationConfig: { maxOutputTokens: 42 }, response_format: { type: 'json_object' } });
  assert.deepEqual(messages, original);
  assert.deepEqual(body.systemInstruction.parts, [{ text: 'stable rules' }, { text: 'persona' }]);
  assert.deepEqual(body.contents.map(c => c.role), ['user', 'model', 'user', 'user']);
  assert.equal(body.contents[2].parts[0].text, 'dynamic tail');
  assert.deepEqual(body.contents.at(-1).parts.at(-1), { inlineData: { mimeType: 'image/png', data: 'YQ==' } });
  assert.equal(body.generationConfig.maxOutputTokens, 12000);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 0);
  assert.equal(buildVertexBody({ temperature: 0.7, generationConfig: { temperature: 1.2 } }).generationConfig.temperature, 1.2);
  assert.deepEqual(buildVertexBody({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/photo.webp' } }] }] }).contents[0].parts[0], { fileData: { fileUri: 'https://example.com/photo.webp', mimeType: 'image/webp' } });
  assert.equal(buildVertexBody({ model: 'gemini-2.5-pro', thinking: { type: 'disabled' } }).generationConfig.thinkingConfig.thinkingBudget, -1);
  assert.equal(buildVertexBody({ model: 'gemini-3.1-pro-preview', thinking: { type: 'disabled' } }).generationConfig.thinkingConfig.thinkingLevel, 'LOW');
});

test('sync and byte-fragmented SSE use native endpoints and normalize content, reasoning, finish reasons and usage', async () => {
  clearVertexTokenCache();
  const requests = [];
  const fetchImpl = async (url, options) => {
    if (String(url).includes('oauth2')) return json({ access_token: 'mock-token', expires_in: 3600 });
    requests.push({ url, options });
    assert.equal(options.headers.get('Authorization'), 'Bearer mock-token');
    if (!url.includes('streamGenerateContent')) return json(reply);
    const bytes = new TextEncoder().encode(`: keepalive\r\n\r\ndata: ${JSON.stringify(reply)}\r\n\r\ndata: [DONE]\r\n\r\n`);
    return new Response(new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } }));
  };
  const client = createVertexClient({ vertexServiceAccount: account, vertexRegion: 'global', headers: { authorization: 'wrong-token' } }, fetchImpl);
  const params = { model: 'gemini-2.5-pro', messages: [{ role: 'user', content: 'ping' }], max_tokens: 65536 };
  const result = await client.chat.completions.create(params);
  assert.equal(result.choices[0].message.content, '正文');
  assert.equal(result.choices[0].message.reasoning_content, 'reasoning');
  assert.equal(result.choices[0].finish_reason, 'length');
  assert.equal(result.usage.completion_tokens, 13);
  assert.equal(result.usage.prompt_tokens_details.cached_tokens, 80);
  assert.equal(requests[0].url, 'https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google/models/gemini-2.5-pro:generateContent');
  const stream = await client.chat.completions.create({ ...params, stream: true });
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].choices[0].delta.content, '正文');
  assert.match(requests[1].url, /:streamGenerateContent\?alt=sse$/);
  assert.equal(stream.controller.signal.aborted, true);
});

test('HTTP failures never echo credentials; token is invalidated on 401; timeout covers OAuth', async () => {
  clearVertexTokenCache();
  let oauthCalls = 0;
  const client = createVertexClient({ vertexServiceAccount: account }, async url => {
    if (String(url).includes('oauth2')) { oauthCalls++; return json({ access_token: 'secret-token', expires_in: 3600 }); }
    return new Response(JSON.stringify({ error: { status: 'UNAUTHENTICATED', message: account.private_key } }), { status: 401 });
  });
  for (let i = 0; i < 2; i++) await assert.rejects(client.chat.completions.create({ model: 'gemini-2.5-pro', messages: [] }), error => error.status === 401 && !error.message.includes('PRIVATE KEY'));
  assert.equal(oauthCalls, 2);
  const slow = createVertexClient({ vertexServiceAccount: account }, async (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(slow.chat.completions.create({ model: 'gemini-2.5-pro' }, { timeout: 20 }), { name: 'TimeoutError' }); }
  finally { clearTimeout(keepAlive); }
});

test('model discovery paginates and excludes non-text Gemini models', async () => {
  clearVertexTokenCache();
  let pages = 0;
  const result = await listVertexModels({ vertexServiceAccount: account, vertexRegion: 'us-central1' }, async url => {
    if (String(url).includes('oauth2')) return json({ access_token: 'token', expires_in: 3600 });
    pages++;
    assert.equal(url.hostname, 'us-central1-aiplatform.googleapis.com');
    return pages === 1 ? json({ publisherModels: [{ name: 'publishers/google/models/gemini-2.5-pro' }, { name: 'publishers/google/models/gemini-2.5-flash-image' }], nextPageToken: 'second' }) : json({ publisherModels: [{ name: 'publishers/google/models/gemini-2.5-flash' }] });
  });
  assert.deepEqual(result.models, ['gemini-2.5-flash', 'gemini-2.5-pro']);
  assert.equal(pages, 2);
});

test('native agent tools preserve signed model parts and pair each function response', () => {
  const parts = [{ thought: true, text: 'plan' }, { functionCall: { name: 'inspect_neighbors', args: {} }, thoughtSignature: 'opaque-signature' }];
  const schema = { type: 'object', properties: {}, additionalProperties: false };
  const body = buildVertexBody({ model: 'gemini-3-pro', tools: [{ type: 'function', function: { name: 'inspect_neighbors', description: '查看', parameters: schema } }], messages: [
    { role: 'system', content: 'stable' }, { role: 'user', content: '看看' },
    { role: 'assistant', content: '', vertex_parts: parts, tool_calls: [{ id: 'unique-call', function: { name: 'inspect_neighbors', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'unique-call', content: '{"ok":true,"value":{"characters":[]}}' },
  ] });
  assert.deepEqual(body.contents[1].parts, parts);
  assert.deepEqual(body.contents[2].parts[0].functionResponse, { name: 'inspect_neighbors', response: { ok: true, value: { characters: [] } } });
  assert.deepEqual(body.tools[0].functionDeclarations[0].parametersJsonSchema, schema);
  assert.equal(body.toolConfig.functionCallingConfig.mode, 'AUTO');
});
