import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const requests = [];
let response;
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), 'https://media-designer.invalid/v1/chat/completions');
  requests.push(JSON.parse(options.body));
  return new Response(JSON.stringify({ choices: [{ message: { content: response }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
};
await import('openai/shims/web');
const { getDb, closeDb } = await import('../src/db/index.js');
const { config } = await import('../src/config.js');
const { generateMediaOutletDraft, normalizeMediaOutletDraft, MEDIA_OUTLET_DESIGN_PROMPT } = await import('../src/services/mediaOutletDesigner.js');
const { createOutlet, listBoards } = await import('../src/services/mediaService.js');
const db = getDb();
config.llm.freeEgg = false;
config.llm._baseURL = 'https://media-designer.invalid/v1';
config.llm._apiKey = 'test-only';
after(closeDb);
const draft = {
  name: '街角观察报', icon: '📰', tagline: '记录街巷里的小事', prompt: '你是街角观察报的编辑部，以不同居民的独立视角记录街巷生活。',
  boards: ['街头新鲜事', '人物访谈', '生活榜单', '读者来信'].map(name => ({ name, desc: `围绕${name}展开的独立内容` })),
};

test('draft generation leaves database untouched and keeps static prompt prefix identical across requests', async () => {
  const before = db.prepare('SELECT * FROM media_outlets').all();
  response = JSON.stringify(draft);
  const first = await generateMediaOutletDraft({ brief: '温柔的街坊周刊', layout: 'portal' });
  const second = await generateMediaOutletDraft({ brief: '热闹的街坊论坛', layout: 'feed' });
  assert.equal(first.layout, 'portal');
  assert.equal(second.layout, 'feed');
  assert.deepEqual(db.prepare('SELECT * FROM media_outlets').all(), before);
  assert.deepEqual(requests[0].messages.slice(0, -1), requests[1].messages.slice(0, -1));
  assert.equal(requests[0].messages.at(-2).content, MEDIA_OUTLET_DESIGN_PROMPT);
  assert.equal(requests[0].messages.at(-1).role, 'user');
  assert.match(requests[0].messages.at(-1).content, /温柔的街坊周刊/);
});

test('invalid requests and unusable model drafts are rejected', async () => {
  const count = requests.length;
  await assert.rejects(generateMediaOutletDraft({ brief: '' }), /栏目想法/);
  await assert.rejects(generateMediaOutletDraft({ brief: 'x', layout: 'other' }), /类型/);
  assert.equal(requests.length, count);
  assert.throws(() => normalizeMediaOutletDraft({ ...draft, boards: [] }), /4个板块/);
  assert.throws(() => normalizeMediaOutletDraft({ ...draft, boards: Array(4).fill(draft.boards[0]) }), /重复/);
  assert.throws(() => normalizeMediaOutletDraft({ ...draft, prompt: '' }), /编辑风格/);
  response = 'not JSON';
  await assert.rejects(generateMediaOutletDraft({ brief: '街坊周刊' }), /格式/);
});

test('creating a draft saves boards and enabled state atomically', () => {
  const created = createOutlet({ ...draft, layout: 'portal', enabled: false });
  assert.equal(created.enabled, false);
  assert.deepEqual(listBoards(created.id).map(({ name, desc }) => ({ name, desc })), draft.boards);
  assert.throws(() => createOutlet({ ...draft, name: '无效报', boards: [{ name: '' }] }), /板块/);
  assert.equal(db.prepare('SELECT id FROM media_outlets WHERE name = ?').get('无效报'), undefined);
  db.exec("CREATE TRIGGER reject_test_board BEFORE INSERT ON media_boards WHEN NEW.name = '失败板块' BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  assert.throws(() => createOutlet({ ...draft, name: '回滚报', boards: [{ name: '正常板块' }, { name: '失败板块' }] }), /test failure/);
  assert.equal(db.prepare('SELECT id FROM media_outlets WHERE name = ?').get('回滚报'), undefined);
});
