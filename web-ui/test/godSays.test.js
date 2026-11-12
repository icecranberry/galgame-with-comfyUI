import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGodStreamEvent, useGodSaysStore } from '../src/stores/godSays.js';
import { createPinia, setActivePinia } from 'pinia';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

test('background polling on an older conversation refreshes work without reloading or scrolling', async () => {
  const source = readFileSync(new URL('../src/views/GodSaysView.vue', import.meta.url), 'utf8');
  const body = source.match(/poll = setInterval\(async \(\) => \{([\s\S]*?)\n  \}, 5000\)/)?.[1];
  assert.ok(body, 'exercise the actual page polling callback');
  const calls = [];
  const god = {
    state: { session: { id: 1, day: '2020-01-01', time_zone: 'Asia/Shanghai' }, worldEvents: [{ deliveries: [{ status: 'pending' }] }] },
    archiveId: null, loading: false, submitting: false,
    refreshWork: () => calls.push('work'), refreshActivity: () => calls.push('activity'), refreshWorld: () => calls.push('world'),
    load: () => assert.fail('background refresh must not replace the selected conversation'),
  };
  const poll = new (Object.getPrototypeOf(async function () {}).constructor)('god', 'goBottom', 'Intl', body);
  const deviceIntl = { DateTimeFormat() { assert.fail('conversation polling must not depend on device date formatting'); } };
  for (let i = 0; i < 3; i++) await poll(god, () => assert.fail('background refresh must not force the reading position'), deviceIntl);
  assert.deepEqual(calls, Array(3).fill(['work', 'activity', 'world']).flat());
  assert.equal(god.state.session.id, 1);
});

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

test('照相馆成图与后续查询复用消息图片，隔离其他工具、失败任务和外部链接', () => {
  for (const name of ['generate_studio_photo', 'read_studio_photo']) {
    const message = { tool_calls: [{ id: 'studio-1', function: { name } }] };
    const turn = { calls: [{ id: 'run:0:studio-1', name, status: 'done', result: { ok: true, value: { data: {
      success: true, width: 1152, height: 2048, images: [
        { url: '/images/photo_studio/godstudio_123.avif' }, { url: '/images/photo_studio/godstudio_123.avif' },
        { url: '/images/chat/other.png' }, { url: 'https://example.com/fake.png' }, { url: '/images/photo_studio/../fake.png' },
      ],
    } } } }] };
    const expected = [{ url: '/images/photo_studio/godstudio_123.avif', width: 1152, height: 2048 }];
    assert.deepEqual(godMessageImages(turn, message), expected);
    assert.deepEqual(godMessageImages(structuredClone(turn), message), expected);
    assert.deepEqual(godMessageImages(turn, { tool_calls: [{ id: 'other', function: { name } }] }), []);
    turn.calls[0].result.value.data.success = false;
    assert.deepEqual(godMessageImages(turn, message), []);
    turn.calls[0].result.value.data.success = true;
    turn.calls[0].status = 'failed';
    assert.deepEqual(godMessageImages(turn, message), []);
  }
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


test('new conversation reuses empty drafts, preserves input, and blocks concurrent creation', async t => {
  setActivePinia(createPinia());
  const god = useGodSaysStore();
  const empty = { session: { id: null }, current: true, runs: [], messages: [], calls: [], worldEvents: [], cursor: 0 };
  god.state = structuredClone(empty);
  god.setDraft('尚未发送的草稿');
  let posts = 0;
  let release;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options?.method === 'POST') {
      posts++;
      await new Promise(resolve => { release = resolve; });
      return Response.json({ id: null });
    }
    return Response.json(empty);
  });
  assert.equal(await god.newConversation(), false);
  assert.equal(posts, 0);
  god.state = { ...empty, session: { id: 1 }, runs: [{ id: 'previous', status: 'completed' }] };
  const creating = god.newConversation();
  assert.equal(god.creating, true);
  assert.equal(await god.newConversation(), false);
  release();
  assert.equal(await creating, true);
  assert.equal(await god.newConversation(), false);
  assert.equal(posts, 1);
  assert.equal(god.draft, '尚未发送的草稿');
  assert.equal(god.state.session.id, null);
  assert.equal(god.creating, false);
});

test('failed creation preserves conversation and draft; history can return to the one new draft', async t => {
  setActivePinia(createPinia());
  const god = useGodSaysStore();
  god.state = { session: { id: 5 }, runs: [{ id: 'old', status: 'completed' }], messages: [], calls: [], worldEvents: [] };
  god.archiveId = 5;
  god.setDraft('不要丢掉');
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  assert.equal(await god.newConversation(), false);
  assert.equal(god.archiveId, 5);
  assert.equal(god.state.session.id, 5);
  assert.equal(god.draft, '不要丢掉');
  assert.equal(god.creating, false);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ session: { id: null }, current: true, runs: [], messages: [], calls: [], worldEvents: [], cursor: 0 }));
  assert.equal(await god.newConversation(), true);
  assert.equal(god.archiveId, null);
  assert.equal(god.state.session.id, null);
});


test('older non-current sessions can send, retain selection and bind retries to the selected session', async t => {
  setActivePinia(createPinia());
  const god = useGodSaysStore();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const stored = new Map();
  mockGlobal(t, 'localStorage', { getItem: k => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v) });
  const bodies = [], reads = [];
  let fail = true;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options?.method === 'POST') {
      const body = JSON.parse(options.body); bodies.push(body);
      if (fail) throw new Error('offline');
      return Response.json({ run: { id: 'resumed', session_id: body.session_id, status: 'completed' } });
    }
    reads.push(url);
    const id = Number(new URL(url, 'http://localhost').searchParams.get('session'));
    assert.ok(id, 'reload must keep the selected session instead of loading the default');
    return Response.json({ session: { id, day: '2020-01-01', time_zone: 'Asia/Shanghai', status: 'archived' }, today,
      current: false, writable: true, runs: [], messages: [], calls: [], worldEvents: [], cursor: 0 });
  });
  await god.load(1);
  assert.equal(god.archiveId, null);
  god.setDraft('继续聊');
  await god.send();
  await god.send();
  assert.equal(bodies[0].client_id, bodies[1].client_id);
  await god.load(2);
  fail = false;
  assert.equal((await god.send()).session_id, 2);
  assert.notEqual(bodies[2].client_id, bodies[0].client_id, 'same text in another conversation is a new request');
  assert.deepEqual(bodies.map(b => b.session_id), [1, 1, 2]);
  assert.equal(god.state.session.id, 2);
  assert.equal(god.archiveId, null);
  assert.equal(reads.at(-1), '/api/god-says/state?session=2');
  assert.equal(god.draft, '');
});

test('explicit server read-only state blocks sends and failed sends preserve the draft', async t => {
  setActivePinia(createPinia());
  const god = useGodSaysStore();
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options?.method === 'POST') posts++;
    return Response.json({ session: { id: 1, day: '2020-01-01', time_zone: 'Asia/Shanghai' }, current: false, writable: false,
      runs: [], messages: [], calls: [], worldEvents: [], cursor: 0 });
  });
  await god.load(1);
  god.setDraft('保留内容');
  assert.equal(god.archiveId, 1);
  assert.equal(await god.send(), undefined);
  assert.equal(posts, 0);
  god.archiveId = null;
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  assert.equal(await god.send(), undefined);
  assert.equal(god.draft, '保留内容');
  assert.equal(god.error, 'offline');
});


test('整段删除仅在删除当前会话时刷新，失败保留内容', async t => {
  setActivePinia(createPinia());
  const god = useGodSaysStore();
  god.state = { session: { id: 1 }, runs: [], messages: [], calls: [] };
  const calls = [];
  let fail = false;
  mockGlobal(t, 'fetch', async (url, options) => {
    calls.push([url, options?.method]);
    if (fail) return new Response(JSON.stringify({ error: '仍有工作正在执行' }), { status: 409 });
    return new Response(JSON.stringify(options?.method === 'DELETE' ? { ok: true } : { session: { id: null }, runs: [], messages: [], calls: [], cursor: 0 }));
  });
  assert.equal(await god.deleteSession(2), true);
  assert.equal(god.state.session.id, 1);
  assert.equal(calls.length, 1);
  fail = true;
  assert.equal(await god.deleteSession(1), false);
  assert.equal(god.state.session.id, 1);
  assert.equal(god.deleting, false);
  fail = false;
  assert.equal(await god.deleteSession(1), true);
  assert.equal(god.state.session.id, null);
  assert.deepEqual(calls.at(-1), ['/api/god-says/state', 'GET']);
});
