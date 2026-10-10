import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const responses = [];
const requests = [];
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), 'https://media-test.invalid/v1/chat/completions');
  requests.push(JSON.parse(options.body));
  assert.ok(responses.length, 'unexpected LLM request');
  return new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content: JSON.stringify(responses.shift()) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  }), { headers: { 'content-type': 'application/json' } });
};
await import('openai/shims/web');
const { getDb, closeDb } = await import('../src/db/index.js');
const { config } = await import('../src/config.js');
const { addClient, removeClient } = await import('../src/services/unifiedStreamBus.js');
const { normalizePortalDraft, createOutlet, generateMediaBatch, maybeAutoGenerate } = await import('../src/services/mediaService.js');

after(async () => {
  // 出刊后的无配图后台回调结束后再关闭内存数据库。
  await new Promise(resolve => setTimeout(resolve, 20));
  closeDb();
});

function draft(count, issue = 1) {
  return {
    issue, title: '测试报刊', lead: '本期导语',
    sections: Array.from({ length: count }, (_, i) => ({
      key: `column${i + 1}`, name: `栏目${i + 1}`, lead: `导语${i + 1}`, image_prompt: '',
    })),
  };
}

test('new issues keep exactly four valid sections and do not mutate model input', () => {
  for (const count of [4, 5, 6, 8]) {
    const raw = draft(count);
    const snapshot = structuredClone(raw);
    const result = normalizePortalDraft(raw);
    assert.equal(result.sections.length, 4);
    assert.deepEqual(result.sections.map(s => s.key), ['column1', 'column2', 'column3', 'column4']);
    assert.deepEqual(raw, snapshot);
  }
  assert.throws(() => normalizePortalDraft(draft(3)), /4 个有效栏目/);
  const invalid = draft(4);
  invalid.sections[0].name = '';
  assert.throws(() => normalizePortalDraft(invalid), /4 个有效栏目/);
  assert.equal(normalizePortalDraft(draft(4, 99), 3).issue, 4);
  assert.equal(normalizePortalDraft(draft(4, 1), 3).issue, 4);
});

test('manual and automatic publishing insert four-section issues, notify the UI, and preserve old issues', async () => {
  const db = getDb();
  db.prepare('UPDATE media_outlets SET enabled = 0').run();
  const outlet = createOutlet({ name: '四栏目回归报', prompt: '测试用报刊', layout: 'portal' });
  config.llm.freeEgg = false;
  config.llm._baseURL = 'https://media-test.invalid/v1';
  config.llm._apiKey = 'test-only';
  config.features.mediaAutoMinutes = 5;
  const events = [];
  const client = { write: value => events.push(value) };
  addClient(client);
  try {
    // 模拟已有的五栏目历史报刊，不得在发布新一期时被裁剪。
    const old = { portal: true, ...draft(5, 7) };
    const oldJson = JSON.stringify(old);
    const insert = db.prepare('INSERT INTO media_posts (outlet_id, title, content, payload_json) VALUES (?, ?, ?, ?)');
    const oldId = Number(insert.run(outlet.id, old.title, '', oldJson).lastInsertRowid);
    // 最新一条没有期号时，也应沿用历史最大期号。
    insert.run(outlet.id, '旧社交帖', '', null);
    responses.push(draft(5, 1));
    const manual = await generateMediaBatch({ outletId: outlet.id });
    const read = id => JSON.parse(db.prepare('SELECT payload_json FROM media_posts WHERE id = ?').get(id).payload_json);
    assert.equal(manual.inserted, 1);
    assert.equal(read(manual.postId).sections.length, 4);
    assert.equal(read(manual.postId).issue, 8);

    const beforeAuto = db.prepare('SELECT id, payload_json FROM media_posts ORDER BY id').all();
    responses.push(draft(6, 1));
    await maybeAutoGenerate(Date.now());
    const newest = db.prepare('SELECT id, payload_json FROM media_posts ORDER BY id DESC LIMIT 1').get();
    assert.notEqual(newest.id, manual.postId);
    assert.equal(JSON.parse(newest.payload_json).sections.length, 4);
    assert.equal(JSON.parse(newest.payload_json).issue, 9);
    assert.deepEqual(db.prepare('SELECT id, payload_json FROM media_posts WHERE id <= ? ORDER BY id').all(manual.postId), beforeAuto);
    assert.equal(db.prepare('SELECT payload_json FROM media_posts WHERE id = ?').get(oldId).payload_json, oldJson);
    assert.equal(events.filter(e => e.startsWith('event: media_new_posts\n')).length, 2);
    assert.equal(requests.length, 2);
    assert.ok(requests.every(r => r.messages.some(m => m.content.includes('必须恰好 4 个栏目'))));
  } finally {
    removeClient(client);
  }
});
