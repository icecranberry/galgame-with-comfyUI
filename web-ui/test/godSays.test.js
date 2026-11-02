import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGodStreamEvent, useGodSaysStore } from '../src/stores/godSays.js';
import { createPinia, setActivePinia } from 'pinia';
import { webcrypto } from 'node:crypto';
import { godMessageImages } from '../src/utils/godSaysImages.js';
import { splitAngelPersona, composeAngelPersona } from '../src/utils/angelPersonaEditor.js';

function mockGlobal(t, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  });
}

test('HTTP phone clients without randomUUID can send and reuse the request ID after a network failure', async t => {
  setActivePinia(createPinia());
  const god = useGodSaysStore();
  const stored = new Map();
  mockGlobal(t, 'localStorage', {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  });
  mockGlobal(t, 'crypto', { getRandomValues: bytes => webcrypto.getRandomValues(bytes) });
  const bodies = [];
  const run = { id: 'phone-message', session_id: 1, status: 'completed' };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options?.method === 'POST') {
      bodies.push(JSON.parse(options.body));
      if (bodies.length === 1) throw new Error('offline');
      return Response.json({ run });
    }
    return Response.json({ session: { id: 1 }, current: true, runs: [run], messages: [], calls: [], worldEvents: [], cursor: 0 });
  });
  god.draft = '手机发送';
  assert.equal(await god.send(), undefined);
  assert.equal(god.error, 'offline');
  assert.equal(god.submitting, false);
  assert.equal(god.busy, false);
  assert.equal(god.draft, '手机发送');
  assert.equal((await god.send()).id, run.id);
  assert.match(bodies[0].client_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(bodies[1].client_id, bodies[0].client_id);
  assert.equal(god.submitting, false);
  assert.equal(god.draft, '');
  assert.equal(JSON.parse(stored.get('linshe.god.pending')), null);
});

test('request preparation errors release the sending state and allow retry', async t => {
  setActivePinia(createPinia());
  const god = useGodSaysStore();
  mockGlobal(t, 'crypto', { getRandomValues() { throw new Error('random source unavailable'); } });
  god.draft = '保留待发送消息';
  assert.equal(await god.send(), undefined);
  assert.equal(god.error, 'random source unavailable');
  assert.equal(god.submitting, false);
  assert.equal(god.busy, false);
  assert.equal(god.draft, '保留待发送消息');
});

test('successful sends expose the accepted run after a daily-session change; failed sends do not expose a new turn', async t => {
  setActivePinia(createPinia());
  const god = useGodSaysStore();
  const run = { id: 'midnight', session_id: 2, status: 'completed' };
  let fail = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (fail) throw new Error('offline');
    const result = options?.method === 'POST' ? { run } : {
      session: { id: 2 }, runs: [run], messages: [], calls: [], worldEvents: [], cursor: 0,
    };
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  });
  god.draft = '午夜的新一轮';
  assert.equal((await god.send()).id, 'midnight');
  assert.equal(god.state.session.id, 2);
  fail = true; god.draft = '重试';
  assert.equal(await god.send(), undefined);
  assert.equal(god.error, 'offline');
});

test('unsaved empty session can send its first message and does not request unscoped world events', async t => {
  setActivePinia(createPinia());
  const god = useGodSaysStore();
  god.state = { session: { id: null }, current: true, runs: [], messages: [], calls: [], worldEvents: [] };
  const run = { id: 'first-message', session_id: 7, input: '你好', status: 'completed' };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.ok(!url.includes('world-events'), 'draft must not request events belonging to other sessions');
    return new Response(JSON.stringify(options?.method === 'POST' ? { run } : {
      session: { id: 7 }, current: true, runs: [run], messages: [], calls: [], worldEvents: [], cursor: 0,
    }), { headers: { 'Content-Type': 'application/json' } });
  });
  await god.refreshWorld();
  god.draft = '你好';
  assert.equal((await god.send()).id, run.id);
  assert.equal(god.state.session.id, 7);
  assert.equal(god.archiveId, null);
  assert.equal(god.turns[0].input, '你好');
});

test('attached images reach the request body instead of being dropped on the way to the store', async t => {
  setActivePinia(createPinia());
  const god = useGodSaysStore();
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options?.method === 'POST') {
      bodies.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ run: { id: 'with-image', session_id: 1 } }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ session: { id: 1 }, runs: [], messages: [], calls: [], worldEvents: [], cursor: 0 }), { headers: { 'Content-Type': 'application/json' } });
  });
  god.draft = '看看这张图';
  await god.send(['data:image/jpeg;base64,AAAA', null]);
  assert.deepEqual(bodies[0].images, ['data:image/jpeg;base64,AAAA']);
});

test('angel appearance editing preserves identity and trailing sections without exposing VAD', () => {
  const original = '你是天使。\n## 你的身份\n云庭信使\n\n## 你的外观\n白羽、光环\n## 其他说明\n保留这段';
  const parts = splitAngelPersona(original);
  assert.equal(parts.appearance, '白羽、光环');
  const edited = composeAngelPersona({ ...parts, appearance: '浅金头发与白色羽翼' });
  assert.match(edited, /云庭信使[\s\S]*## 你的外观\n浅金头发与白色羽翼\n## 其他说明\n保留这段/);
  assert.equal(splitAngelPersona('没有外观段').appearance, '');
  assert.equal(composeAngelPersona({ persona: '原人设', appearance: '白羽' }), '原人设\n\n## 你的外观\n白羽');
});

test('image tool results stream once into the matching reply and remain available in replayed history', () => {
  const message = { id: 1, role: 'assistant', tool_calls: [{ id: 'image-1', function: { name: 'generate_image' } }] };
  const state = { messages: [message], calls: [], runs: [{ id: 'run1' }] };
  const turn = () => ({ calls: state.calls });
  applyGodStreamEvent(state, { type: 'tool', data: { id: 'run1:0:image-1', name: 'generate_image', status: 'running' } });
  assert.deepEqual(godMessageImages(turn(), message), []);
  const event = { type: 'tool', data: { id: 'run1:0:image-1', name: 'generate_image', status: 'done', result: { ok: true, value: { data: {
    success: true, width: 832, height: 1216, images: [{ url: '/images/chat/god_123.png' }, { url: '/images/chat/god_123.png' }, { url: 'javascript:alert(1)' }, { url: 'https://example.com/fake.png' }],
  } } } } };
  applyGodStreamEvent(state, event); applyGodStreamEvent(state, event);
  assert.deepEqual(godMessageImages(turn(), message), [{ url: '/images/chat/god_123.png', width: 832, height: 1216 }]);
  assert.deepEqual(godMessageImages(structuredClone(turn()), message), godMessageImages(turn(), message));
  assert.deepEqual(godMessageImages(turn(), { tool_calls: [{ id: 'other', function: { name: 'generate_image' } }] }), []);
  applyGodStreamEvent(state, { type: 'tool', data: { ...event.data, status: 'failed', result: { ok: false, error: 'offline' } } });
  assert.deepEqual(godMessageImages(turn(), message), []);
});

test('turn deletion preserves state on failure and removes only the requested turn after acknowledgement', async t => {
  setActivePinia(createPinia());
  const god = useGodSaysStore();
  god.state = { session: { id: 1, summary: 'old summary' }, runs: [{ id: 'a', status: 'completed' }, { id: 'b', status: 'completed' }],
    messages: [{ run_id: 'a' }, { run_id: 'b' }], calls: [{ run_id: 'a' }, { run_id: 'b' }], worldEvents: [{ run_id: 'a', id: 12 }] };
  let fail = true;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/god-says/runs/a'); assert.equal(options.method, 'DELETE');
    return new Response(JSON.stringify(fail ? { error: 'busy' } : { ok: true }), { status: fail ? 409 : 200, headers: { 'Content-Type': 'application/json' } });
  });
  assert.equal(await god.deleteTurn('a'), false);
  assert.equal(god.turns.length, 2); assert.equal(god.error, 'busy');
  fail = false;
  assert.equal(await god.deleteTurn('a'), true);
  assert.deepEqual(god.turns.map(r => r.id), ['b']);
  assert.equal(god.state.messages.length, 1); assert.equal(god.state.calls.length, 1);
  assert.equal(god.state.session.summary, '');
  assert.equal(god.state.worldEvents[0].id, 12, 'committed work is not undone by deleting a conversation');
});

test('stream separates reasoning/body, final snapshot replaces deltas, tool result and terminal state survive replay', () => {
  const state = { messages: [], calls: [], runs: [{ id: 'r', status: 'running' }] };
  applyGodStreamEvent(state, { type: 'message', data: { id: 1, role: 'assistant', content: '', reasoning: '' } });
  applyGodStreamEvent(state, { type: 'delta', data: { id: 1, field: 'reasoning', text: '思考摘要' } });
  applyGodStreamEvent(state, { type: 'delta', data: { id: 1, field: 'content', text: '吾神' } });
  assert.equal(state.messages[0].content, '吾神');
  assert.equal(state.messages[0].reasoning, '思考摘要');
  const final = { type: 'message', data: { id: 1, role: 'assistant', content: '吾神，已经安排。', reasoning: '思考摘要', status: 'done' } };
  applyGodStreamEvent(state, final); applyGodStreamEvent(state, final);
  assert.equal(state.messages.length, 1);
  applyGodStreamEvent(state, { type: 'tool', data: { id: 'call', status: 'running' } });
  applyGodStreamEvent(state, { type: 'tool', data: { id: 'call', status: 'done', result: { ok: true } } });
  assert.equal(state.calls.length, 1); assert.equal(state.calls[0].result.ok, true);
  applyGodStreamEvent(state, { type: 'run_end', data: { id: 'r', status: 'completed' } });
  assert.equal(state.runs[0].status, 'completed');
});
