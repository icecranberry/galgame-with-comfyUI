import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import express from 'express';

// Actual SQLite schema, HTTP route, SSE parser and Pinia store. Only slow external
// generation and the schedule clock are controlled, so races are reproducible.
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
async function until(predicate, label) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise(r => setTimeout(r, 5));
  }
}

test('私聊图片与发送锁：真实测试库、HTTP 与前端 store 联测', { timeout: 30000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'linshe-private-chat-'));
  process.env.DB_PATH = path.join(directory, 'test.db');
  process.env.IMAGES_DIR = path.join(directory, 'images');
  const { config } = await import('../src/config.js');
  config.dbPath = process.env.DB_PATH;
  const { getDb, closeDb } = await import('../src/db/index.js');
  t.mock.method(console, 'log', () => {});
  const db = getDb();
  assert.equal(db.name, process.env.DB_PATH);
  for (const key of Object.keys(config.features)) config.features[key] = false;
  Object.assign(config.llm, { apiKey: 'isolated-test', baseURL: 'http://127.0.0.1:1', model: 'fixture' });
  Object.assign(config.user, { nickname: '测试用户', appearance: '', persona: '', gender: '' });

  const traces = [];
  const contexts = [];
  let state;
  let nextCharacter = 9000;
  const mark = (name, data = {}) => traces.push({ scenario: state?.name, ms: Math.round(performance.now() - state.started), name, ...data });
  const imageResult = () => ({ success: true, source: 'fixture', images: [{ filename: 'fixture.png',
    base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6XkAAAAASUVORK5CYII=' }] });
  const fixture = {
    async *chatStream(messages) {
      contexts.push(structuredClone(messages));
      yield state.plainReply || state.reply;
    },
    chatSync: async () => 'A cup of tea on a wooden desk.',
    async *chatAgentStream(messages, options) {
      contexts.push(structuredClone(messages));
      const current = state;
      // 续写轮的判据是尾部追加了 tool 结果：实现刻意保留 tools 只为 provider 签名稳定，
      // 仅把 toolChoice 置为 none，所以不能用 options.tools 判断是否续写。
      if (messages.at(-1)?.role === 'tool') {
        mark('continuation_waiting');
        await current.textGate.promise;
        yield { type: 'text_delta', text: current.reply };
        yield { type: 'assistant_end', message: { role: 'assistant', content: current.reply } };
        return;
      }
      if (current.spoken) yield { type: 'text_delta', text: current.reply };
      yield { type: 'assistant_end', message: { role: 'assistant', content: current.spoken ? current.reply : '',
        tool_calls: [{ id: `call-${current.id}`, type: 'function', function: { name: 'request_chat_image',
          arguments: JSON.stringify({ image_source: 'camera', include_self: false, scene: '我拍桌上的红茶给你看' }) } }] } };
    },
    async generateImage() {
      const current = state;
      mark('image_waiting');
      current.imageStarted = true;
      await current.imageGate.promise;
      mark('image_released');
      if (current.fail) throw new Error('受控图片失败');
      return imageResult();
    },
    getLastWorkflowMode: () => 'fixture',
    captureImageGenerationConfig: () => ({}),
    ensureDreamOnDemand: async () => null,
    generateLiveDreamMurmur: async () => ({ talk: '唔，梦里的茶杯会飞。', imagePrompt: 'A flying cup.' }),
    decorateDreamImagePrompt: text => text,
    getReplyDelay: () => ({ delay: state.sleeping ? -1 : 0, activity: state.sleeping ? '睡觉' : '休息' }),
    formatScheduleContext: () => '', getCurrentActivity: () => null,
    isTempWoken: () => false, extendTempWake: () => {},
  };
  globalThis.__privateChatConcurrency = fixture;
  const imports = new Map([
    ['../llm/llm-client.js', ['chatStream', 'chatSync', 'chatAgentStream']],
    ['../services/lorebook/runtime.js', ['chatSync']],
    ['../services/imageSkill.js', ['generateImage', 'getLastWorkflowMode', 'captureImageGenerationConfig']],
    ['../services/dreamService.js', ['ensureDreamOnDemand', 'generateLiveDreamMurmur', 'decorateDreamImagePrompt']],
    ['../services/scheduleManager.js', ['getReplyDelay', 'formatScheduleContext', 'getCurrentActivity', 'isTempWoken', 'extendTempWake']],
  ]);
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/src/routes/chat.js') && imports.has(specifier)) {
      const code = imports.get(specifier).map(name => `export const ${name}=globalThis.__privateChatConcurrency.${name};`).join('\n');
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(code)}` };
    }
    return next(specifier, context);
  } });
  const nativeFetch = globalThis.fetch;
  let origin;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    const target = new URL(url, origin);
    assert.equal(target.origin, origin, '测试不访问外部服务');
    return nativeFetch(target, options);
  });
  const router = (await import('../src/routes/chat.js')).default;
  hooks.deregister();
  const { addClient, removeClient } = await import('../src/services/unifiedStreamBus.js');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (req.path.endsWith('/chat')) {
      mark('http_request', { message: req.body.message });
      const write = res.write.bind(res);
      res.write = (chunk, ...args) => {
        const match = String(chunk).match(/^event: (\S+)/);
        if (match) mark(`sse:${match[1]}`);
        return write(chunk, ...args);
      };
      res.on('finish', () => mark('http_finished'));
    }
    next();
  });
  app.get('/api/stream', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': ready\n\n');
    addClient(res);
    req.on('close', () => removeClient(res));
  });
  app.get('/api/characters', (_req, res) => res.json({ characters: db.prepare('SELECT id,display_name FROM characters').all() }));
  app.use('/api', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  const webRequire = createRequire(new URL('../../web-ui/package.json', import.meta.url));
  const piniaPath = path.join(path.dirname(webRequire.resolve('pinia/package.json')), 'dist/pinia.mjs');
  const { createPinia, setActivePinia } = await import(pathToFileURL(piniaPath));
  const { useChatStore } = await import('../../web-ui/src/stores/chat.js');
  const { startUnifiedStream, stopUnifiedStream, onEvent } = await import('../../web-ui/src/stores/unifiedStream.js');
  const unsubscribe = onEvent('private_chat_image', d => mark(`bus:${d.event}`, { taskId: d.taskId }));
  startUnifiedStream();
  const { clientCount } = await import('../src/services/unifiedStreamBus.js');
  await until(() => clientCount() > 0, '统一 SSE 连接');
  t.after(async () => {
    state?.textGate.resolve(); state?.imageGate.resolve();
    stopUnifiedStream(); unsubscribe(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    closeDb(); delete globalThis.__privateChatConcurrency;
    // mkdtemp owns exactly this directory; never remove a configured/live path.
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  function setup(name, options = {}) {
    state = { name, id: ++nextCharacter, started: performance.now(), imageGate: deferred(), textGate: deferred(),
      reply: `给你看红茶，这是第${nextCharacter}轮完整回复。`, spoken: true, ...options };
    db.prepare('INSERT INTO characters(id,name,display_name,base_prompt) VALUES(?,?,?,?)')
      .run(state.id, `fixture-${state.id}`, '测试角色', '成年茶艺师。\n## 你的外观\n黑发，蓝眼。');
    config.features.schedule = !!state.sleeping;
    setActivePinia(createPinia());
    const chat = useChatStore(); chat.activeCharId = state.id;
    return chat;
  }
  const tasks = () => db.prepare('SELECT * FROM image_tasks WHERE conversation_id=?').all(`char_${state.id}`);
  const raws = () => db.prepare('SELECT * FROM raw_messages WHERE conversation_id=? ORDER BY id').all(`char_${state.id}`);

  for (const mode of ['force', 'smart']) {
    await t.test(`${mode}：图片仍在等待时第二轮已完成，文件晚到仍回填第一轮`, async () => {
      const chat = setup(mode);
      const imageDirectory = path.join(directory, 'images/chat');
      const filesBefore = fs.existsSync(imageDirectory) ? fs.readdirSync(imageDirectory) : [];
      const first = chat.sendMessage('给我看看红茶', mode);
      await until(() => state.imageStarted, '图片执行开始');
      await first;
      assert.equal(chat.streaming, false);
      assert.equal(tasks()[0].status, 'running');
      await until(() => chat.messages.some(m => m.type === 'image_gen'), '文字结束后图片气泡上屏');
      assert.deepEqual(fs.existsSync(imageDirectory) ? fs.readdirSync(imageDirectory) : [], filesBefore);
      assert.equal(raws().at(-1).content, state.reply);
      const binding = db.prepare('SELECT * FROM private_chat_image_turns WHERE conversation_id=?').get(`char_${state.id}`);
      assert.equal(db.prepare('SELECT images FROM messages WHERE id=?').get(binding.message_id).images, null);
      mark('unlocked_while_image_pending');
      await chat.sendMessage('那我们继续聊茶香', 'off');
      assert.equal(raws().length, 4);
      const nextContext = JSON.stringify(contexts.at(-1));
      assert.ok(nextContext.includes(state.reply));
      assert.ok(nextContext.includes('图片尚未完成'));
      mark('second_turn_finished_before_image');
      assert.equal(await chat.loadMessages(state.id), true);
      assert.equal(chat.messages.filter(m => m.genId === binding.task_id).length, 1, '刷新后可恢复等待中的原轮次图片');
      state.imageGate.resolve();
      await until(() => tasks()[0].status === 'done' && chat.messages.some(m => m.genId === binding.task_id && m.genStatus === 'done'), '原图完成');
      const url = JSON.parse(db.prepare('SELECT images FROM messages WHERE id=?').get(binding.message_id).images)[0];
      assert.ok(fs.existsSync(path.join(directory, url)));
      assert.equal(db.prepare('SELECT images FROM messages WHERE raw_id=?').get(raws().at(-1).id).images, null);
      assert.ok(chat.messages.findIndex(m => m.genId === binding.task_id) < chat.messages.findIndex(m => m.content === '那我们继续聊茶香'));
    });
  }
  await t.test('纯工具先发图：真正阻塞点是第二次文字续写，而非图片', async () => {
    const chat = setup('tool-only', { spoken: false });
    const first = chat.sendMessage('给我看看红茶', 'smart');
    await until(() => state.imageStarted, '图已开始、文字续写未释放');
    assert.equal(chat.streaming, true);
    assert.equal(chat.messages.some(m => m.type === 'image_gen'), false, '文字续写期间后台已生图，但前台不插入图片气泡');
    assert.equal(raws().at(-1).content, '');
    await chat.sendMessage('续写完成前尝试发送', 'off');
    assert.equal(raws().length, 2, '发送守卫阻止新请求');
    mark('blocked_on_text_continuation');
    state.textGate.resolve();
    await first;
    assert.equal(chat.streaming, false);
    assert.equal(tasks()[0].status, 'running');
    assert.equal(raws().at(-1).content, state.reply);
    mark('text_saved_unlocks_before_image');
    await chat.sendMessage('续写完成后继续聊', 'off');
    state.imageGate.resolve();
    await until(() => tasks()[0].status === 'done' && chat.messages.some(m => m.genStatus === 'done'), '图片结束');
  });
  await t.test('图片先生成完：文字续写结束后才展示成图，后台无需等待文字', async () => {
    const chat = setup('image-before-text', { spoken: false });
    const first = chat.sendMessage('发张红茶照片', 'smart');
    await until(() => state.imageStarted, '后台立即生图');
    state.imageGate.resolve();
    await until(() => tasks()[0]?.status === 'done', '文字仍等待时图片已实际完成');
    assert.equal(chat.streaming, true);
    assert.equal(chat.messages.some(m => m.type === 'image_gen'), false);
    state.textGate.resolve();
    await first;
    await until(() => chat.messages.some(m => m.type === 'image_gen' && m.genStatus === 'done'), '文字结束后成图上屏');
    const image = chat.messages.find(m => m.type === 'image_gen');
    assert.ok(chat.messages.indexOf(image) > chat.messages.findIndex(m => m.content === state.reply));
    assert.equal(tasks().length, 1, '展示排队不重复生成图片');
  });
  await t.test('图片失败：不回滚已完成的第二轮文字', async () => {
    const chat = setup('image-failure', { fail: true });
    await chat.sendMessage('给我看看红茶', 'force');
    await until(() => state.imageStarted, '失败图片开始');
    await chat.sendMessage('继续聊', 'off');
    state.imageGate.resolve();
    await until(() => tasks()[0].status === 'failed' && chat.messages.some(m => m.genStatus === 'error'), '失败落库与推送');
    assert.equal(raws().length, 4);
    assert.equal(chat.streaming, false);
  });
  await t.test('反例：受理图片即强制解锁，会缺失上一轮上下文且丢失旧流文字回填', async () => {
    const chat = setup('unsafe-early-unlock', { spoken: false, plainReply: '第二轮单独回复。' });
    const first = chat.sendMessage('给我看看红茶', 'smart');
    await until(() => state.imageStarted, '首轮文字尚未生成');
    // 仅在测试中模拟提议的提前解锁；不修改生产实现。
    chat.streaming = false;
    await chat.sendMessage('提前发送第二句', 'off');
    const nextContext = JSON.stringify(contexts.at(-1));
    assert.ok(!nextContext.includes(state.reply), '第二轮确实没有第一轮完整文字');
    state.textGate.resolve();
    await first;
    await until(() => raws().some(row => row.content === state.reply), '旧轮正文最终落库');
    assert.ok(!chat.messages.some(m => m.content === state.reply), '旧轮已退出前端消费，文字没有回填');
    mark('unsafe_unlock_lost_context_and_old_stream');
    state.imageGate.resolve();
    await until(() => tasks()[0].status === 'done', '反例后台图片仍独立结束');
    assert.equal(chat.messages.some(m => m.genStatus === 'done'), false, '被强制替换的旧文字流未结束，前台图片仍在等待；需重新加载恢复');
  });
  await t.test('睡眠梦话：文字已落库，仍被 await generateImage 卡住发送', async () => {
    const chat = setup('sleeping', { sleeping: true });
    const first = chat.sendMessage('你梦到什么了', 'smart');
    await until(() => state.imageStarted, '梦话后台图片开始');
    assert.equal(chat.messages.some(m => m.type === 'image_gen'), false, '旧版流没有提前发送文字结束标记，前台继续等流结束');
    assert.equal(raws().at(-1).content, '（睡梦中的梦话）唔，梦里的茶杯会飞。');
    assert.equal(chat.streaming, true);
    assert.equal(tasks()[0].status, 'running');
    await chat.sendMessage('图片等待中尝试发言', 'off');
    assert.equal(raws().length, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM private_chat_image_turns WHERE conversation_id=?').get(`char_${state.id}`).n, 0);
    mark('dream_text_saved_but_send_locked');
    state.imageGate.resolve();
    await first;
    assert.equal(chat.streaming, false);
    assert.equal(tasks()[0].status, 'done');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reply_queue WHERE conversation_id=?').get(`char_${state.id}`).n, 1);
    mark('dream_image_finishes_then_unlocks');
  });
  for (const name of [...new Set(traces.map(row => row.scenario))]) {
    t.diagnostic(JSON.stringify({ scenario: name, timeline: traces.filter(row => row.scenario === name) }));
  }
});
