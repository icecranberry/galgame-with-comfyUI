import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { readAgentResponse, buildAgentRequest } from '../src/llm/agentStream.js';
import { CHAT_IMAGE_TOOLS, streamPrivateChatImages, queuePrivateImage, validateImageCall, savePrivateChatReply, getSavedPrivateChatReply, getPrivateChatImageResume } from '../src/services/privateChatImageTools.js';
import { getSplitHistory } from '../src/services/contextAssembler.js';

const call = (scene = '我拍一张厨房饼干给你', id = 'call-1', extra = {}) => ({ id, type: 'function', function: { name: 'request_chat_image', arguments: JSON.stringify({ image_source: 'camera', include_self: false, scene, ...extra }) } });
async function collect(stream) { const result = []; for await (const item of stream) result.push(item); return result; }
const textStream = async function* () { yield '纯文字'; };

test('灵性配图按现有正则切换 required/auto，关闭和导演模式跳过检测并阻止工具执行', async () => {
  const mustNotScan = { toString() { assert.fail('关闭和导演模式不得进行正则检测'); } };
  const definitions = JSON.stringify(CHAT_IMAGE_TOOLS);
  for (const [imageMode, userInput, expected] of [
    ['smart', '发张照片给我', 'required'],
    ['smart', '今天心情不错', 'auto'],
    ['off', '发张照片给我', 'none'],
    ['force', '发张照片给我', 'none'],
    ['off', mustNotScan, 'none'],
    ['force', mustNotScan, 'none'],
  ]) {
    let accepted = 0, recorded = 0;
    const nativeStream = async function* (_messages, opts) {
      assert.equal(opts.toolChoice, expected);
      assert.equal(opts.tools, CHAT_IMAGE_TOOLS);
      yield { type: 'text_delta', text: '你好' };
      // 模拟渠道在 none 下仍错误返回工具，应用层也不能执行。
      yield { type: 'assistant_end', message: { role: 'assistant', content: '你好', tool_calls: [call()] } };
    };
    const output = await collect(streamPrivateChatImages([], { imageMode, userInput, nativeStream, textStream,
      accept() { accepted++; return { ok: true, status: 'queued' }; }, record() { recorded++; } }));
    assert.deepEqual(output, ['你好']);
    assert.equal(accepted, expected === 'none' ? 0 : 1);
    assert.equal(recorded, accepted);
    assert.equal(JSON.stringify(CHAT_IMAGE_TOOLS), definitions);
  }
});

test('native fragments stream text before complete arguments and preserve signatures', async () => {
  const emitted = []; const records = [];
  const nativeStream = async function* () {
    yield* readAgentResponse((async function* () {
      yield { choices: [{ delta: { content: '给你看看。', tool_calls: [{ index: 0, id: 'a', function: { name: 'request_chat_image', arguments: '{"scene":' } }] } }] };
      assert.deepEqual(emitted, ['给你看看。']);
      assert.equal(records.length, 0);
      yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"我拍饼干给你","image_source":"camera","include_self":false}' }, extra_content: { signature: 'signed' } }] }, finish_reason: 'tool_calls' }] };
    })());
  };
  for await (const text of streamPrivateChatImages([], { nativeStream, textStream, accept: scene => ({ ok: true, scene }), record: (...args) => records.push(args) })) emitted.push(text);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0][2].scene, { scene: '我拍饼干给你', image_source: 'camera', include_self: false });
  assert.equal(records[0][1].tool_calls[0].extra_content.signature, 'signed');
});

test('required tool-only response continues once with none and identical tools/context', async () => {
  const messages = [{ role: 'system', content: 'stable' }, { role: 'user', content: '<active_chat_history>history</active_chat_history>task' }];
  const assistant = { role: 'assistant', content: '', reasoning_details: [{ signature: 'keep' }], tool_calls: [call()] };
  const requests = [];
  const nativeStream = async function* (context, opts) {
    requests.push({ context, opts });
    if (requests.length === 1) yield { type: 'assistant_end', message: assistant };
    else yield { type: 'text_delta', text: '正在准备。' };
  };
  assert.deepEqual(await collect(streamPrivateChatImages(messages, { userInput: '发张照片', nativeStream, textStream, accept: () => ({ ok: true, status: 'queued', task_id: 8 }), record() {} })), ['正在准备。']);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].opts.toolChoice, 'required');
  assert.equal(requests[1].opts.toolChoice, 'none');
  assert.equal(requests[1].opts.tools, requests[0].opts.tools);
  assert.deepEqual(requests[1].context.slice(0, 2), messages);
  assert.equal(requests[1].context[2], assistant);
  assert.equal(JSON.parse(requests[1].context[3].content).status, 'queued');
});

test('ordinary text does not create a task, invalid calls get paired failures', async () => {
  let count = 0; const results = [];
  for (const calls of [[], [call(''), { ...call(), function: { name: 'other', arguments: '{}' } }]]) {
    const nativeStream = async function* () { yield { type: 'text_delta', text: '你好' }; yield { type: 'assistant_end', message: { role: 'assistant', content: '你好', tool_calls: calls } }; };
    await collect(streamPrivateChatImages([], { nativeStream, textStream, accept: () => count++, record: (_c, _a, result) => results.push(result) }));
  }
  assert.equal(count, 0); assert.equal(results.length, 2); assert.ok(results.every(r => !r.ok));
  assert.throws(() => validateImageCall({ ...call(), function: { name: 'request_chat_image', arguments: '{"scene":"x","conversation_id":2}' } }));
});

test('interrupted streams and memory cancellation never accept incomplete calls', async () => {
  let accepted = 0;
  const nativeStream = async function* () { yield* readAgentResponse((async function* () { yield { choices: [{ delta: { content: '已经说的话', tool_calls: [{ index: 0, id: 'a', function: { name: 'request_chat_image', arguments: '{' } }] } }] }; })()); };
  const iterator = streamPrivateChatImages([], { nativeStream, textStream, accept: () => accepted++, record() {} });
  assert.equal((await iterator.next()).value, '已经说的话');
  await assert.rejects(iterator.next(), /提前结束/);
  assert.equal(accepted, 0);
  const abort = new AbortController();
  const recalling = async function* () { yield { type: 'text_delta', text: '@memory query\n' }; abort.abort(); yield { type: 'assistant_end', message: { tool_calls: [call()] } }; };
  await assert.rejects(collect(streamPrivateChatImages([], { nativeStream: recalling, textStream, signal: abort.signal, accept: () => accepted++, record() {} })));
  assert.equal(accepted, 0);
});

test('unsupported tools downgrade only before any visible content', async () => {
  let notices = 0;
  const nativeStream = async function* () { throw Object.assign(new Error('tools unsupported'), { status: 400 }); };
  assert.deepEqual(await collect(streamPrivateChatImages([], { nativeStream, textStream, onUnavailable: () => notices++ })), ['纯文字']);
  assert.equal(notices, 1);
  const broken = async function* () { yield { type: 'text_delta', text: '已有正文' }; yield* nativeStream(); };
  await assert.rejects(collect(streamPrivateChatImages([], { nativeStream: broken, textStream, onUnavailable: () => notices++ })));
  assert.equal(notices, 1);
});

test('durable acceptance is idempotent, independent of the next round, and does not wait for images', async () => {
  const db = new Database(':memory:');
  const schema = readFileSync(new URL('../src/db/index.js', import.meta.url), 'utf8');
  db.exec(schema.slice(schema.indexOf('    CREATE TABLE IF NOT EXISTS private_chat_image_turns ('), schema.indexOf('    CREATE TABLE IF NOT EXISTS image_tasks (')));
  db.exec(`CREATE TABLE raw_messages(id INTEGER PRIMARY KEY,conversation_id TEXT,role TEXT,content TEXT);
    CREATE TABLE messages(id INTEGER PRIMARY KEY,conversation_id TEXT,raw_id INTEGER,role TEXT,content TEXT,seq INTEGER);
    CREATE TABLE image_tasks(id INTEGER PRIMARY KEY,conversation_id TEXT,prompt_original TEXT,prompt_refined TEXT,status TEXT,source_msg_id INTEGER,error_message TEXT,finished_at TEXT);`);
  let release; const waiting = new Promise(resolve => { release = resolve; });
  const runs = []; const notices = [];
  const options = { conversationId: 'char_1', userRawId: 1, scene: '饼干', snapshot: { persona: '原服装', imageSource: { image_source: 'camera', include_self: false } }, notify: (...args) => notices.push(args), execute: async (binding, frozen) => { runs.push({ binding, frozen }); await waiting; } };
  const first = queuePrivateImage(db, options);
  options.snapshot.persona = '下一轮服装';
  assert.equal(first.status, 'queued');
  assert.deepEqual(queuePrivateImage(db, options), first);
  assert.equal(queuePrivateImage(db, { ...options, scene: '另一个画面' }).ok, false);
  assert.equal(queuePrivateImage(db, { ...options, snapshot: { ...options.snapshot, imageSource: { image_source: 'album', include_self: true } } }).ok, false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM image_tasks').get().n, 1);
  db.prepare("INSERT INTO messages (conversation_id,role,content) VALUES ('char_1','assistant','下一轮')").run();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runs.length, 1);
  assert.equal(runs[0].binding.messageId, 1);
  assert.equal(runs[0].frozen.persona, '原服装');
  assert.deepEqual(runs[0].frozen.imageSource, { image_source: 'camera', include_self: false });
  assert.deepEqual(JSON.parse(db.prepare('SELECT snapshot_json FROM private_chat_image_turns WHERE user_raw_id=1').get().snapshot_json).imageSource, runs[0].frozen.imageSource);
  assert.equal(notices.length, 1);
  assert.deepEqual(queuePrivateImage(db, { ...options, userRawId: 2 }), { ok: true, status: 'already_shared', task_id: first.task_id });
  assert.equal(db.prepare('SELECT count(*) AS n FROM image_tasks').get().n, 1, 'reacting to the same photo does not create another image');
  release(); await waiting;
  const failed = queuePrivateImage(db, { ...options, userRawId: 2, scene: '新的画面', execute: async () => { throw new Error('受控生图失败'); } });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(db.prepare('SELECT status FROM image_tasks WHERE id=?').get(failed.task_id).status, 'failed');
  assert.equal(notices.at(-1)[0], 'generate_error');
  assert.equal(db.prepare('SELECT count(*) AS n FROM messages').get().n, 3, 'failure preserves both rounds and the image anchor');
  db.close();
});

test('分享来源和入镜标记严格校验，保留第一人称需求', () => {
  assert.deepEqual(CHAT_IMAGE_TOOLS[0].function.parameters.required, ['image_source', 'include_self', 'scene']);
  for (const image_source of ['selfie', 'camera', 'album', 'saved']) {
    const include_self = image_source === 'selfie';
    assert.deepEqual(validateImageCall(call(' 我想发这张图 ', 'a', { image_source, include_self })), {
      image_source, include_self, scene: '我想发这张图',
    });
  }
  for (const extra of [
    { image_source: 'illustration' }, { image_source: 'selfie', include_self: false },
    { include_self: 'false' }, { image_source: null }, { other: true }, { scene: 'x'.repeat(2001) },
  ]) assert.throws(() => validateImageCall(call('我分享一张图', 'a', extra)));
  assert.throws(() => validateImageCall({ function: { name: 'request_chat_image', arguments: '{"scene":"缺少来源"}' } }));
});

test('native provider function envelope is normalized without accepting arbitrary extra fields', () => {
  const native = call();
  const args = JSON.parse(native.function.arguments);
  native.function.arguments = JSON.stringify({ request_chat_image: args });
  assert.deepEqual(validateImageCall(native), args);
  native.function.arguments = JSON.stringify({ request_chat_image: args, conversation_id: 99 });
  assert.throws(() => validateImageCall(native));
});

test('tool-only continuation suppresses fragmented DSML and recovers text without another image', async () => {
  let requests = 0, accepted = 0, recovered = 0;
  const nativeStream = async function* () {
    if (++requests === 1) yield { type: 'assistant_end', message: { role: 'assistant', content: '', tool_calls: [call()] } };
    else for (const text of ['<', '｜｜D', 'SM', 'L｜｜ calls>', 'secret arguments']) yield { type: 'text_delta', text };
  };
  const fallback = async function* (messages) {
    recovered++;
    assert.equal(messages.filter(m => m.role === 'tool').length, 1);
    assert.match(messages.at(-1).content, /工具已关闭/);
    yield '本小姐抢到抱枕啦！';
  };
  const text = await collect(streamPrivateChatImages([], { nativeStream, textStream: fallback,
    accept: () => { accepted++; return { ok: true, status: 'queued', task_id: 9 }; }, record() {} }));
  assert.equal(text.join(''), '本小姐抢到抱枕啦！');
  assert.equal(accepted, 1); assert.equal(requests, 2); assert.equal(recovered, 1);
});

test('tool-looking primary text is never displayed or executed; normal angle brackets stream', async () => {
  let accepted = 0;
  const nativeStream = async function* () { for (const text of ['<｜', 'DS', 'ML｜function_calls>']) yield { type: 'text_delta', text }; };
  const iterator = streamPrivateChatImages([], { nativeStream, textStream, accept: () => accepted++, record() {} });
  await assert.rejects(collect(iterator), /工具协议/);
  assert.equal(accepted, 0);
  const normal = async function* () { for (const text of ['看这里<', '3，很开心']) yield { type: 'text_delta', text }; };
  assert.equal((await collect(streamPrivateChatImages([], { nativeStream: normal, textStream, record() {} }))).join(''), '看这里<3，很开心');
});

test('completed empty text can retry, and a complete recall instruction skips every tool', async () => {
  const empty = await collect(readAgentResponse((async function* () { yield { choices: [{ delta: {}, finish_reason: 'stop' }] }; })(), { allowEmpty: true }));
  assert.equal(empty.at(-1).message.content, '');
  let accepted = 0;
  const nativeStream = async function* () { yield { type: 'text_delta', text: '@memory cookies' }; yield { type: 'assistant_end', message: { role: 'assistant', content: '@memory cookies', tool_calls: [call()] } }; };
  await collect(streamPrivateChatImages([], { nativeStream, textStream, skipTools: assistant => assistant.content.startsWith('@memory'), accept: () => accepted++, record() {} }));
  assert.equal(accepted, 0);
});

test('private tools respect configured thinking; God mode keeps its own policy', () => {
  const llm = { model: 'gpt-5', thinkingMode: 'disabled', extraBody: { reasoning_effort: 'low', tools: ['bad'], tool_choice: 'required' } };
  const params = buildAgentRequest([], CHAT_IMAGE_TOOLS, llm, { forceThinking: false });
  assert.equal(params.reasoning_effort, 'low');
  assert.equal(params.thinking.type, 'disabled');
  assert.equal(params.tool_choice, 'auto');
  for (const forceThinking of [false, true]) {
    for (const toolChoice of ['required', 'auto', 'none']) {
      const request = buildAgentRequest([], CHAT_IMAGE_TOOLS, llm, { forceThinking, toolChoice });
      assert.equal(request.tool_choice, toolChoice);
      assert.equal(request.tools, CHAT_IMAGE_TOOLS);
    }
  }
  assert.equal(llm.extraBody.tool_choice, 'required');
  const plain = buildAgentRequest([], [], llm, { forceThinking: false });
  assert.equal(plain.tools, undefined); assert.equal(plain.tool_choice, undefined);
  assert.equal(buildAgentRequest([], CHAT_IMAGE_TOOLS, llm).reasoning_effort, 'high');
});

test('image-first acceptance becomes one raw assistant turn; history orders speech before its stable image carrier', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE raw_messages(id INTEGER PRIMARY KEY,conversation_id TEXT,role TEXT,content TEXT,prompt TEXT);
    CREATE TABLE messages(id INTEGER PRIMARY KEY,conversation_id TEXT,raw_id INTEGER,role TEXT,content TEXT,images TEXT,seq INTEGER);
    CREATE TABLE private_chat_replies(user_raw_id INTEGER PRIMARY KEY,raw_id INTEGER);
    CREATE TABLE private_chat_image_turns(user_raw_id INTEGER,raw_id INTEGER,message_id INTEGER);
    INSERT INTO raw_messages VALUES(1,'char_5','user','给我看',NULL),(2,'char_5','assistant','','frozen scene');
    INSERT INTO messages VALUES(1,'char_5',1,'user','给我看',NULL,0),(2,'char_5',2,'assistant','','["/photo.png"]',0);
    INSERT INTO private_chat_image_turns VALUES(1,2,2);`);
  const result = savePrivateChatReply(db, { conversationId: 'char_5', userRawId: 1, content: '给你看看！我赢啦！', segments: [
    { content: '给你看看！', images: [] }, { content: '我赢啦！', images: [] },
  ] });
  assert.equal(result.rawId, 2);
  assert.deepEqual(db.prepare("SELECT content,prompt FROM raw_messages WHERE role='assistant'").all(), [{ content: '给你看看！我赢啦！', prompt: 'frozen scene' }]);
  assert.equal(db.prepare('SELECT images FROM messages WHERE id=2').get().images, '["/photo.png"]');
  const query = readFileSync(new URL('../src/routes/chat.js', import.meta.url), 'utf8').match(/SELECT m.id, m.conversation_id[\s\S]*?ORDER BY[^`]+/)[0];
  db.exec('ALTER TABLE raw_messages ADD COLUMN client_msg_id TEXT; ALTER TABLE messages ADD COLUMN created_at TEXT; ALTER TABLE messages ADD COLUMN event_id INTEGER;');
  assert.deepEqual(db.prepare(query).all('char_5').map(m => m.id), [1,3,4,2]);
  const replay = savePrivateChatReply(db, { conversationId: 'char_5', userRawId: 1, content: '给你看看！我赢啦！', segments: [] });
  assert.deepEqual(replay.saved.map(m => m.id), [3,4]);
  assert.equal(db.prepare('SELECT count(*) AS n FROM messages').get().n, 4);
  const plain = savePrivateChatReply(db, { conversationId: 'char_6', userRawId: 8, content: '', segments: [] });
  assert.equal(plain.saved.length, 1);
  assert.equal(plain.saved[0].p.content, '...');
  db.close();
});

test('accepted native turn resumes with the same scene and signatures; completed text replays without another LLM call', async () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE raw_messages(id INTEGER PRIMARY KEY,content TEXT);
    CREATE TABLE private_chat_image_turns(user_raw_id INTEGER,raw_id INTEGER,task_id INTEGER);
    CREATE TABLE image_tasks(id INTEGER,status TEXT);
    CREATE TABLE private_chat_tool_calls(id INTEGER PRIMARY KEY,user_raw_id INTEGER,task_id INTEGER,assistant_json TEXT,call_id TEXT,result_json TEXT);
    INSERT INTO raw_messages VALUES(2,''); INSERT INTO private_chat_image_turns VALUES(1,2,9); INSERT INTO image_tasks VALUES(9,'done');`);
  const assistant = { role: 'assistant', content: '', reasoning_content: 'native signature', tool_calls: [call('我分享纸箱里打瞌睡的小猫插画')] };
  db.prepare('INSERT INTO private_chat_tool_calls VALUES(1,1,9,?,?,?)').run(JSON.stringify(assistant), 'call-1', JSON.stringify({ ok: true, status: 'queued', task_id: 9 }));
  let requests = 0;
  const nativeStream = async function* (messages, opts) {
    requests++;
    assert.equal(opts.tools, CHAT_IMAGE_TOOLS);
    assert.equal(opts.toolChoice, 'none');
    assert.deepEqual(messages.at(-2), assistant);
    assert.equal(JSON.parse(messages.at(-1).content).status, 'done');
    yield { type: 'text_delta', text: '这只小猫像你犯困的样子。' };
  };
  const options = { nativeStream, textStream, userInput: { toString() { assert.fail('恢复任务不得重新检测索图'); } }, accept() { assert.fail('must not accept again'); }, record() { assert.fail('must not record again'); } };
  assert.equal((await collect(streamPrivateChatImages([{ role: 'user', content: '发那张猫图' }], { ...options, resume: getPrivateChatImageResume(db, 1) }))).join(''), '这只小猫像你犯困的样子。');
  assert.equal(requests, 1);
  db.prepare('UPDATE raw_messages SET content=? WHERE id=2').run('这只小猫像你犯困的样子。');
  assert.equal((await collect(streamPrivateChatImages([], { ...options, resume: getPrivateChatImageResume(db, 1) }))).join(''), '这只小猫像你犯困的样子。');
  assert.equal(requests, 1);
  assert.equal(getPrivateChatImageResume(db, 99), null);
  db.close();
});

test('retry history ends at its user input even when an image placeholder or a newer conversation turn exists', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE raw_messages(id INTEGER,conversation_id TEXT,role TEXT,content TEXT);
    CREATE TABLE rolling_summaries(id INTEGER,conversation_id TEXT,end_msg_id INTEGER,summary TEXT,checkpoint_version INTEGER);
    INSERT INTO raw_messages VALUES(1,'char_1','assistant','有一张猫图'),(2,'char_1','user','发给我吧'),(3,'char_1','assistant',''),(4,'char_1','user','下一轮');
    INSERT INTO rolling_summaries VALUES(1,'char_1',3,'晚于这轮的摘要',1);`);
  const current = getSplitHistory(db, 'char_1', 10, 10, { throughId: 2 });
  assert.equal(current.checkpoint, undefined);
  assert.deepEqual(current.checkpointHistory, [{ role: 'user', content: '发给我吧' }]);
  assert.match(current.activeText, /有一张猫图/);
  assert.doesNotMatch(current.activeText, /下一轮/);
  const latest = getSplitHistory(db, 'char_1');
  assert.equal(latest.checkpoint.end_msg_id, 3);
  assert.equal(latest.checkpointHistory.at(-1).content, '下一轮');
  db.close();
});


test('纯文字回复以原用户消息幂等，丢失完成确认后可回放而不重复落库', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE raw_messages(id INTEGER PRIMARY KEY,conversation_id TEXT,role TEXT,content TEXT);
    CREATE TABLE messages(id INTEGER PRIMARY KEY,conversation_id TEXT,raw_id INTEGER,role TEXT,content TEXT,images TEXT,seq INTEGER);
    CREATE TABLE private_chat_image_turns(user_raw_id INTEGER,raw_id INTEGER,message_id INTEGER);
    CREATE TABLE private_chat_replies(user_raw_id INTEGER PRIMARY KEY,raw_id INTEGER);
    INSERT INTO raw_messages VALUES(1,'char_1','user','你好');`);
  const first = savePrivateChatReply(db,{conversationId:'char_1',userRawId:1,content:'你好呀',segments:[{content:'你好呀',images:[]}]});
  const repeated = savePrivateChatReply(db,{conversationId:'char_1',userRawId:1,content:'不应覆盖',segments:[{content:'不应覆盖',images:[]}]});
  assert.equal(repeated.rawId,first.rawId);
  assert.equal(repeated.saved[0].p.content,'你好呀');
  assert.equal(getSavedPrivateChatReply(db,1).rawId,first.rawId);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM messages').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM raw_messages').get().n,2);
  db.close();
});
