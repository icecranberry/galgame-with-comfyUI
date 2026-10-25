import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const framework = new URL('../../Cortico/src/', import.meta.url);
const available = existsSync(new URL('worlds/qq/world.ts', framework));
let definition;
let SegmentedQQWorld;
let splitLinsheChatText;
let chatTypingDelayMs;
if (available) {
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
  try {
    ({ default: definition } = await import('../src/cortico-bridge/qq-segmented/index.ts'));
    ({ SegmentedQQWorld } = await import('../src/cortico-bridge/qq-segmented/segmented-qq-world.ts'));
    ({ splitLinsheChatText, chatTypingDelayMs } = await import('../src/cortico-bridge/qq-segmented/segmented-qq-world.ts'));
  } finally {
    hooks.deregister();
  }
}

const skip = available ? false : 'Install the optional Cortico checkout to test its QQ segmentation extension';

/** 打字节奏归零的加速版；节奏本身的测试用真实节奏单独跑。 */
class NoPaceWorld extends SegmentedQQWorld {
  typingDelayMs() { return 0; }
}

function buildWorld() {
  return new NoPaceWorld({ wsUrl: 'ws://127.0.0.1:1', groups: [], privates: [12345], token: '', timezone: 'Asia/Shanghai' });
}

/** 直塞私有 host/driver 字段，避免真实 OneBot 连接；calls 记录协议端调用。 */
function attach(world, { failOn = null, blob = null } = {}) {
  const calls = [];
  let messageId = 9000;
  world.host = {
    drainPendingEvents: async () => [],
    pushEvent: async (event) => ({ ts: '2026-10-25T12:00:00+08:00', ...event }),
    blob: (handle) => (blob ? blob(handle) : undefined),
  };
  const driver = {
    identity: { selfId: 10000, nickname: 'Tester' },
    callApi: async (action, params) => {
      if (failOn !== null && calls.length === failOn) throw new Error('connection lost');
      calls.push({ action, params });
      return { message_id: ++messageId };
    },
  };
  world.driver = driver;
  return { calls, driver };
}

const tool = (world, name) => world.tools().find((def) => def.name === name);
const draft = async (world, args) => tool(world, 'qq_draft').handler(args, {});
const confirm = async (world, decision) => tool(world, 'qq_confirm').handler({ decision }, {});
const textOf = (call) => call.params.message.find((segment) => segment.type === 'text')?.data.text;

test('qq-linshe definition inherits the builtin qq shape and remaps its own section', { skip }, () => {
  assert.equal(definition.id, 'qq-linshe');
  assert.match(definition.label, /QQ/);
  assert.ok(definition.describe.tools.some((t) => t.name === 'qq_draft'));
  const defaults = definition.defaults();
  assert.equal(defaults.enabled, false);
  assert.ok(defaults.vision);
  const world = definition.create({
    cfg: { ...defaults, privates: [{ id: 1, enabled: true }] },
    secret: () => '',
    timezone: 'Asia/Shanghai',
    dataDir: '.', botDir: '.', packageDir: '.',
    persist() {}, restart: async () => {},
  });
  assert.ok(world instanceof SegmentedQQWorld);
  assert.equal(world.id, 'qq-linshe');
  const names = world.tools().map((def) => def.name);
  for (const name of ['qq_draft', 'qq_confirm', 'qq_read_history', 'qq_grep_history']) assert.ok(names.includes(name));
  const ui = world.webUi('zh');
  assert.equal(ui.panels, undefined);
  assert.equal(ui.lamps.length, 2);
  const group = ui.config[0];
  assert.equal(group.owner, 'world:qq-linshe');
  assert.ok(Object.keys(group.schema.properties).every((key) => key.startsWith('worlds.qq-linshe.')));
});

test('splitter cleans HTML breaks and blank lines like the private chat stream', { skip }, () => {
  assert.deepEqual(splitLinsheChatText('早上好。<br>今天也要好好吃饭。晚上见。'), ['早上好', '今天也要好好吃饭', '晚上见']);
  assert.deepEqual(splitLinsheChatText('第一段。\n\n\n第二段。'), ['第一段', '第二段']);
  assert.deepEqual(splitLinsheChatText('只有一句'), ['只有一句']);
  assert.deepEqual(splitLinsheChatText('<br><br>'), []);
});

test('long drafts freeze segments at draft time and confirm sends them in order', { skip }, async () => {
  const world = buildWorld();
  const { calls } = attach(world);
  const receipt = await draft(world, { to: 'private:12345', text: '今天天气不错。要不要出去走走。顺便拍几张照片。' });
  assert.match(receipt, /\[draft staged/);
  assert.match(receipt, /Will send 3 text segments in order/);
  assert.match(receipt, /Segment 2: 要不要出去走走/);
  assert.match(receipt, /Segment 3: 顺便拍几张照片/);
  const confirmReceipt = await confirm(world, 'send');
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((call) => textOf(call)), ['今天天气不错', '要不要出去走走', '顺便拍几张照片']);
  assert.match(confirmReceipt, /\[sent 3 text segments\]/);
  assert.ok(!confirmReceipt.includes('[send failed]'));
  assert.equal(await confirm(world, 'send'), '[no draft to confirm; draft one first]');
});

test('unsplittable text keeps the upstream single-message behaviour', { skip }, async () => {
  const world = buildWorld();
  const { calls } = attach(world);
  const receipt = await draft(world, { to: 'private:12345', text: '只有一句' });
  assert.ok(!receipt.includes('Will send'));
  await confirm(world, 'send');
  assert.equal(calls.length, 1);
});

test('image and quote reply travel only with the first segment', { skip }, async () => {
  const world = buildWorld();
  world.knownMessages.set('9001', { conv: { kind: 'private', id: 12345 }, ts: '2026-10-25T11:00:00+08:00' });
  const { calls } = attach(world, { blob: () => ({ bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }) });
  await draft(world, { to: 'private:12345', text: '你看这张。特别好玩，再看这张的角落。', image: 'log:abc', reply_to: '9001' });
  await confirm(world, 'send');
  assert.equal(calls.length, 2);
  const first = JSON.stringify(calls[0].params.message);
  const second = JSON.stringify(calls[1].params.message);
  assert.ok(first.includes('"image"') && first.includes('"reply"'));
  assert.ok(!second.includes('"image"') && !second.includes('"reply"'));
  assert.equal(textOf(calls[1]), '特别好玩，再看这张的角落');
});

test('voice bars are never segmented', { skip }, async () => {
  const world = buildWorld();
  const { calls } = attach(world, { blob: () => ({ bytes: new Uint8Array([9]), mime: 'audio/wav' }) });
  await draft(world, { to: 'private:12345', voice: 'mem:voice' });
  await confirm(world, 'send');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params.message, [{ type: 'record', data: { file: 'base64://CQ==' } }]);
});

test('a failed segment keeps the rest and re-confirm only resends the remainder', { skip }, async () => {
  const world = buildWorld();
  const { calls, driver } = attach(world, { failOn: 1 });
  await draft(world, { to: 'private:12345', text: '一段。两段。三段。' });
  const failed = await confirm(world, 'send');
  assert.match(failed, /\[sent 1\/3 text segments\]/);
  assert.match(failed, /\[send failed\] connection lost/);
  assert.match(failed, /remaining 2 segments kept/);
  // 换上不再失败的协议端，再确认一次：只补发剩余两段。
  let messageId = 9100;
  world.driver = { identity: driver.identity, callApi: async (action, params) => { calls.push({ action, params }); return { message_id: ++messageId }; } };
  const retried = await confirm(world, 'send');
  assert.match(retried, /\[sent 3 text segments\]/);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.slice(1).map((call) => textOf(call)), ['两段', '三段']);
});

test('cancelling mid-batch drops the remaining segments and clears the state', { skip }, async () => {
  const world = buildWorld();
  const { calls } = attach(world, { failOn: 1 });
  await draft(world, { to: 'private:12345', text: '一段。两段。三段。' });
  await confirm(world, 'send');
  const cancelled = await confirm(world, 'cancel');
  assert.match(cancelled, /discarded; 1\/3 segments were already sent/);
  assert.equal(calls.length, 1);
  assert.equal(await confirm(world, 'send'), '[no draft to confirm; draft one first]');
});

test('turn end discards an unconfirmed split together with the upstream draft', { skip }, async () => {
  const world = buildWorld();
  const { calls } = attach(world);
  await draft(world, { to: 'private:12345', text: '一段。两段。三段。' });
  world.onTurnEnded();
  assert.equal(await confirm(world, 'send'), '[no draft to confirm; draft one first]');
  assert.equal(calls.length, 0);
});

test('typing pace bounds match the host chat rhythm', { skip }, () => {
  for (const text of ['短', '一句十个字左右的话', '这是一段很长很长很长的句子已经超过了三十个字的封顶长度了']) {
    const ms = chatTypingDelayMs(text);
    assert.ok(ms >= 300 && ms <= 900, `${ms}`);
  }
  // 长句封顶 30 字：下限必然在 600 以上；短句下限在 300 附近。
  assert.ok(chatTypingDelayMs('x'.repeat(40)) >= 600);
  assert.ok(chatTypingDelayMs('短') < 620);
});

test('segments arrive with a pacing gap scaled to the previous segment', { skip }, async () => {
  const world = buildWorld();
  world.typingDelayMs = () => 60;
  const stamps = [];
  const { calls } = attach(world);
  const driver = world.driver;
  world.driver = {
    identity: driver.identity,
    callApi: async (action, params) => {
      stamps.push(Date.now());
      return driver.callApi(action, params);
    },
  };
  await draft(world, { to: 'private:12345', text: '一段。两段。三段。' });
  await confirm(world, 'send');
  assert.equal(calls.length, 3);
  assert.ok(stamps[1] - stamps[0] >= 50, `${stamps[1] - stamps[0]}`);
  assert.ok(stamps[2] - stamps[1] >= 50, `${stamps[2] - stamps[1]}`);
});

test('turn cancellation during the pacing gap stops further sends', { skip }, async () => {
  const world = buildWorld();
  world.typingDelayMs = () => 50;
  const { calls } = attach(world);
  await draft(world, { to: 'private:12345', text: '一段。两段。三段。' });
  const ctx = { signal: AbortSignal.abort() };
  const receipt = await tool(world, 'qq_confirm').handler({ decision: 'send' }, ctx);
  assert.match(receipt, /\[sent 1\/3 text segments\]/);
  assert.match(receipt, /cancelled while typing/);
  assert.equal(calls.length, 1);
});
