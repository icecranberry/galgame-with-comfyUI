import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import Database from 'better-sqlite3';
import { crc32 } from 'node:zlib';
import { extractPersonaIp, splitPersonaForUpgrade, isNewPersonaFormat, QUOTE_ANCHOR } from '../src/shared/personaSectionUtils.js';
import { cleanGeneratedPersona } from '../src/services/structuredPersonaPrompt.js';

process.env.DB_PATH = ':memory:';

const persona = `你是小雨(Rain)。来自《潮声》。
## 你的身份
你替港里的船抄过潮表，所以你总在出门前确认时间。
你曾错过最后一班船，所以你会给迟到的人多留一盏灯。
## 你的性格
- 你提前拨快家里的钟。
- 你嘴上催人却总等到最后。
- 你越着急越容易看错表。
- 你听到汽笛就换话题。
- 你把灯留在对方看得见的地方。
## 你的口吻
- 句式：你说短句，急时断句。
- 口癖与语气词：你开口常说「等等」。
- 称呼：你对长辈称您。
- 情绪表达：你急了会压低声音。
- 禁区：你被问起那夜就报潮时。
## 你的语录
${QUOTE_ANCHOR}
- 「慢些。」——你在岸边接人。
- 「差一分。」——你认真核对时刻。
- 「我……看反了。」——你发现失误。
- 「还等我吗？」——你试探地开口。
- 「灯给你。」——你在风暴中递出油灯。
## 你的好恶
- 喜欢：铜钟（你喜欢准时）。
- 排斥/害怕：夜雾（你担心有人迷路）。`;

test('升级保留首个外观标题到文末的每个字符，包括后续标题和 CRLF', () => {
  for (const heading of ['#你的外观', '# 你的外观', '  ## 你的外观  ', '\t###你的外观\t']) {
    for (const prefix of ['', '旧人格\r\n\r\n']) {
      for (const tail of ['', '#其他\r\n旧正文', '## 你的外观\n旧标记\t\n']) {
        const raw = heading + '\r\nShort hair.  \r\n#### 配饰\r\n铃铛。\t\r\n' + tail;
        const parts = splitPersonaForUpgrade(prefix + raw);
        assert.equal(parts.persona, prefix.trimEnd());
        assert.equal(persona + parts.suffix, persona + (prefix ? '\r\n\r\n' : '\n\n') + raw);
      }
    }
  }
  assert.deepEqual(splitPersonaForUpgrade('文中提到「## 你的外观」'), { persona: '文中提到「## 你的外观」', suffix: '' });
});

test('从身份句读取作品，原创和正文提及的作品不触发检索', () => {
  for (const card of [persona, '你是小雨，来自《潮声》系列。', '你是小雨。\r\n来自《潮声》。', '你是小雨，来自潮声。']) {
    assert.equal(extractPersonaIp(card), '潮声');
  }
  for (const card of ['你是小雨，来自原创设定。', '你是小雨。港口守灯人。', '你是小雨。\n## 你的语录\n来自《别的作品》。']) {
    assert.equal(extractPersonaIp(card), '');
  }
});

test('识别与清洗五段人设，丢弃模型自行输出的外观', () => {
  assert.ok(isNewPersonaFormat(persona));
  assert.ok(!isNewPersonaFormat(persona.replace('## 你的口吻', '提到 ## 你的口吻')));
  assert.ok(!isNewPersonaFormat('#你的外观\n' + persona));
  const hallucinated = persona.replace('## 你的语录', '#你的外观\n错误外观\n## 你的语录');
  const wrapped = '```markdown\n' + hallucinated + '\n### 你的外观\n第二份错误外观\n```';
  assert.equal(cleanGeneratedPersona(wrapped, { name: '小雨', ip: '潮声' }).persona, persona);
  assert.throws(() => cleanGeneratedPersona(persona.replace('——', ' '), {}), /语录/);
});

test('新库不创建备份表，旧库仅清理空表及预览时期的空作品列', async () => {
  const { migrateCharacterPersonaSchema } = await import('../src/db/index.js');
  const db = new Database(':memory:');
  try {
    db.exec("CREATE TABLE characters(id INTEGER PRIMARY KEY, base_prompt TEXT); INSERT INTO characters VALUES (42, '旧卡')");
    migrateCharacterPersonaSchema(db);
    migrateCharacterPersonaSchema(db);
    assert.deepEqual(db.prepare('SELECT * FROM characters').get(), { id: 42, base_prompt: '旧卡' });
    assert.equal(db.pragma('table_info(character_persona_backups)').length, 0);
    db.exec("ALTER TABLE characters ADD COLUMN ip TEXT; CREATE TABLE character_persona_backups (character_id INTEGER PRIMARY KEY, base_prompt TEXT, ip TEXT)");
    db.prepare("UPDATE characters SET ip = '手动填写的旧值'").run();
    migrateCharacterPersonaSchema(db);
    assert.equal(db.prepare('SELECT ip FROM characters').get().ip, '手动填写的旧值');
    db.prepare('UPDATE characters SET ip = NULL').run();
    migrateCharacterPersonaSchema(db);
    assert.deepEqual(db.prepare('SELECT * FROM characters').get(), { id: 42, base_prompt: '旧卡' });
    assert.equal(db.pragma('table_info(character_persona_backups)').length, 0);
  } finally { db.close(); }
});

test('实际 HTTP 招募、预览、取消与确认替换；百科与模型使用隔离替身', { timeout: 30000 }, async t => {
  const { config } = await import('../src/config.js');
  config.dbPath = ':memory:';
  config.features.schedule = false;
  config.comfyui.url = 'http://127.0.0.1:1';
  const { getDb, closeDb } = await import('../src/db/index.js');
  const db = getDb();
  assert.equal(db.name, ':memory:');
  const router = (await import('../src/routes/characters.js')).default;
  const app = express();
  app.use(express.json());
  let reply = persona, onWrite;
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
  const vision = 'Rain has short black hair and wears a red coat with brass buttons.';
  const tasks = [];
  app.post('/model/chat/completions', async (req, res) => {
    const task = req.body.messages.at(-1).content;
    tasks.push(task);
    let content;
    if (Array.isArray(task)) {
      assert.match(task.find(item => item.type === 'image_url').image_url.url, /^data:image\/.+;base64,/);
      content = vision;
    } else if (task === '潮声里的小雨') {
      content = '小雨|潮声';
    } else if (task.includes('英文标识')) {
      content = JSON.stringify({ name: 'rain', appearance: '- 黑发。\n- 红外套。', emotion_baseline: { valence: 0.5, arousal: 0.3, dominance: 0.4 } });
    } else if (task.includes('五段 Markdown')) {
      if (onWrite) await onWrite();
      content = reply;
    } else if (req.body.messages.some(m => m.content.includes('font_id'))) content = '{"font_id":"lxgw_bright"}';
    else content = '小雨来自《潮声》，她常在港口为人留灯。';
    res.json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
  });
  app.use('/api/characters', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); closeDb(); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  Object.assign(config.llm, { apiKey: 'test', baseURL: origin + '/model', model: 'fixture', headers: {}, extraBody: {} });
  const nativeFetch = globalThis.fetch;
  const requests = [];
  let offline = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const target = new URL(url);
    if (target.origin === origin) return nativeFetch(url, options);
    requests.push(target);
    if (offline) throw new Error('模拟检索离线');
    if (target.hostname === 'www.bing.com') return new Response('');
    if (target.hostname === 'mzh.moegirl.org.cn') {
      return Response.json({ query: { pages: { 1: { title: '小雨', extract: '小雨是作品《潮声》中给过往船只记录时间的守灯人。' } } } });
    }
    if (target.pathname === '/scrape') return Response.json({ content: '来自《潮声》的守灯人', infobox: '角色资料', reference_image: image });
    throw new Error('测试禁止外部访问 ' + target.origin);
  });
  const call = (path, body, headers) => fetch(origin + '/api/characters' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const generated = await call('/generate', { description: '潮声里的小雨', save: false });
  const draft = await generated.json();
  assert.equal(generated.status, 200, JSON.stringify(draft));
  assert.equal(extractPersonaIp(draft.base_prompt), '潮声');
  assert.ok(!('ip' in draft));
  assert.ok(isNewPersonaFormat(draft.base_prompt));
  assert.equal(draft.reference_image, image);
  assert.match(draft.base_prompt, /## 你的外观\n- 黑发/);
  const visual = await call('/refine-appearance-draft', { ...draft, image: draft.reference_image });
  const refined = await visual.json();
  assert.equal(visual.status, 200, JSON.stringify(refined));
  assert.equal(refined.base_prompt, persona + '\n\n## 你的外观\n' + vision);
  draft.base_prompt = refined.base_prompt;
  const created = await call('/', draft);
  assert.equal(created.status, 201);
  const { id: newId } = await created.json();
  assert.deepEqual(db.prepare('SELECT base_prompt FROM characters WHERE id = ?').get(newId), { base_prompt: draft.base_prompt });

  const card = { data: { name: 'rain', display_name: '小雨', base_prompt: draft.base_prompt + '\r\n' } };
  const json = Buffer.from(JSON.stringify(card));
  const external = { data: { name: '小雨', description: card.data.base_prompt } };
  const payload = Buffer.from('chara\0' + Buffer.from(JSON.stringify(external)).toString('base64'));
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length);
  chunk.write('tEXt', 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  const pixel = Buffer.from(image.split(',')[1], 'base64');
  const png = Buffer.concat([pixel.subarray(0, -12), chunk, pixel.subarray(-12)]);
  for (const [filename, data] of [['rain.png', png], ['rain.json', json]]) {
    const response = await call('/import-card', { filename, data: data.toString('base64') });
    const imported = await response.json();
    assert.equal(response.status, 200, JSON.stringify(imported));
    assert.ok(!('ip' in imported));
    assert.equal(imported.base_prompt, card.data.base_prompt);
  }

  const appearance = '  ###你的外观 \r\n#### 头发\r\nblack hair  \r\n';
  const suffix = '\r\n' + appearance + '## 其他标记\r\n旧资料\t\r\n';
  const old = '你是小雨。\r\n来自《潮声》。' + suffix;
  const id = db.prepare(`INSERT INTO characters (name, display_name, base_prompt, short_prompt, avatar_path, standing_url, loras)
    VALUES ('old', '小雨', ?, '旧摘要', '/avatar', '/standing', '["original"]')`).run(old).lastInsertRowid;
  db.prepare("INSERT INTO memory_fragments (conversation_id, fragment_type, content) VALUES (?, 'fact', '一起守过灯')").run('char_' + id);
  db.prepare("INSERT INTO user_relationships (character_id, affinity) VALUES (?, 83)").run(id);
  const select = () => db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
  const before = select();
  const assets = () => [
    db.prepare('SELECT * FROM user_relationships WHERE character_id = ?').get(id),
    db.prepare('SELECT * FROM memory_fragments WHERE conversation_id = ?').all('char_' + id),
  ];
  const savedAssets = assets();
  requests.length = 0;
  const metadataCalls = () => tasks.filter(task => task.includes('英文标识')).length;
  const creationCalls = metadataCalls();
  const route = '/' + id;
  let retries = 0;
  onWrite = () => { reply = retries++ ? persona + '\n#你的外观\n错误版本' : '缺标题'; };
  const upgraded = await call(route + '/persona-draft', { expected_base_prompt: old });
  const result = await upgraded.json();
  assert.equal(upgraded.status, 200, JSON.stringify(result));
  assert.equal(retries, 2);
  assert.ok(requests.some(url => url.searchParams.get('titles') === '小雨'));
  assert.ok(requests.every(url => url.hostname === 'mzh.moegirl.org.cn'));
  assert.equal(result.persona, persona);
  assert.ok(result.source_revision);
  assert.equal(result.source, 'network');
  const fetchesAfterLookup = requests.length;
  const reorganized = await call(route + '/persona-draft', { expected_base_prompt: old, search_context: result.search_context }, { Accept: 'text/event-stream' });
  const reorganizedEvents = await reorganized.text();
  assert.match(reorganizedEvents, /"stage":"reference","source":"network"/);
  assert.doesNotMatch(reorganizedEvents, /"stage":"search"/);
  assert.match(reorganizedEvents, /event: result/);
  assert.equal(requests.length, fetchesAfterLookup);
  assert.deepEqual(select(), before); // 放弃预览，无需给后端发取消请求。
  assert.deepEqual(assets(), savedAssets);
  const apply = (preview, overrides) => call(route + '/apply-persona', {
    persona: preview.persona, source_revision: preview.source_revision, ...overrides,
  });
  assert.equal((await apply(result, { source_revision: '过期' })).status, 409);
  assert.equal((await apply(result, { persona: '不是生成的人设' })).status, 400);
  assert.deepEqual(select(), before);
  // 模拟升级前已有的历史备份。只有确认替换的角色会清理自己的旧记录。
  assert.equal(db.pragma('table_info(character_persona_backups)').length, 0);
  db.exec('CREATE TABLE character_persona_backups(character_id INTEGER PRIMARY KEY, base_prompt TEXT)');
  const legacy = db.prepare('INSERT INTO character_persona_backups VALUES (?, ?)');
  legacy.run(id, '之前留下的备份');
  legacy.run(newId, '另一个角色的备份');
  const callsBeforeApply = tasks.length;
  const committed = await apply(result);
  const saved = await committed.json();
  assert.equal(committed.status, 200, JSON.stringify(saved));
  assert.equal(saved.base_prompt, persona + suffix);
  assert.deepEqual(await (await apply(result)).json(), saved);
  assert.deepEqual(select(), { ...before, base_prompt: saved.base_prompt, short_prompt: saved.short_prompt });
  assert.deepEqual(assets(), savedAssets);
  assert.equal(tasks.length, callsBeforeApply);
  assert.deepEqual(db.prepare('SELECT * FROM character_persona_backups').all(), [{ character_id: newId, base_prompt: '另一个角色的备份' }]);
  onWrite = null;
  reply = '始终缺少标题';
  assert.equal((await call(route + '/persona-draft', {})).status, 502);
  assert.equal(select().base_prompt, saved.base_prompt);

  db.prepare("UPDATE characters SET base_prompt = '原创草稿' WHERE id = ?").run(id);
  requests.length = 0;
  reply = persona.replace('(Rain)。来自《潮声》。', '。你是河畔的守灯人。');
  let enter, resume;
  const writing = new Promise(resolve => { enter = resolve; });
  const paused = new Promise(resolve => { resume = resolve; });
  onWrite = async () => { enter(); await paused; };
  const inFlight = call(route + '/persona-draft', {});
  await writing;
  try {
    assert.equal((await call(route + '/persona-draft', {})).status, 409);
    db.prepare("UPDATE characters SET base_prompt = '同时编辑的人设' WHERE id = ?").run(id);
  } finally { resume(); }
  assert.equal((await inFlight).status, 409);
  assert.equal(select().base_prompt, '同时编辑的人设');
  onWrite = null;
  const streamed = await call(route + '/persona-draft', {}, { Accept: 'text/event-stream' });
  const events = await streamed.text();
  assert.match(events, /event: stage\ndata: {"stage":"write-local"}/);
  assert.match(events, /event: result/);
  assert.deepEqual(requests, []);
  assert.equal(metadataCalls(), creationCalls);
  assert.equal(select().base_prompt, '同时编辑的人设');
  const localDraft = JSON.parse(/event: result\ndata: ([^\n]+)/.exec(events)[1]);
  assert.equal((await apply(localDraft)).status, 200);
  assert.equal(select().base_prompt, reply);

  offline = true;
  reply = persona;
  db.prepare('UPDATE characters SET base_prompt = ? WHERE id = ?').run('你是小雨，来自《潮声》。', id);
  const fallback = await call(route + '/persona-draft', {});
  const fallbackCard = await fallback.json();
  assert.equal(fallback.status, 200, JSON.stringify(fallbackCard));
  assert.equal(fallbackCard.search_found, false);
  assert.equal(fallbackCard.source, 'not-found');
  const fetchesAfterMiss = requests.length;
  const localOnly = await call(route + '/persona-draft', { search_context: '' });
  assert.equal(localOnly.status, 200);
  assert.equal(requests.length, fetchesAfterMiss);
  assert.equal(fallbackCard.persona, persona);
  assert.equal(extractPersonaIp(select().base_prompt), '潮声');
  assert.equal(tasks.filter(Array.isArray).length, 1);
});
