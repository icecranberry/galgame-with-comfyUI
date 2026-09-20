import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };

const { config } = await import('../src/config.js');
config.user.nickname = '测试员';

const { getDb, closeDb } = await import('../src/db/index.js');
const { generateUserPostComment } = await import('../src/services/momentUserPostService.js');

function flattenMessages(calls) {
  return calls.flat().map(m => Array.isArray(m.content)
    ? m.content.map(part => part.text || '').join('\n')
    : m.content).join('\n');
}

test('generateUserPostComment exposes hidden image request as reference text', async t => {
  t.after(() => closeDb());
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO characters (name, display_name, base_prompt) VALUES ('req', '看图人', '看图人的人设')`
  ).run();
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(result.lastInsertRowid));

  const messages = [];
  await generateUserPostComment(
    character,
    { content: '夜市真热闹\n[[imgreq]]雨天霓虹街角，湿地面反光[[/imgreq]]', prompt: '' },
    [],
    { chatSync: async (m) => { messages.push(m); return '好'; } }
  );

  const prompt = flattenMessages(messages);
  assert.ok(prompt.includes('夜市真热闹'));
  assert.ok(prompt.includes('（AI 配图需求：雨天霓虹街角，湿地面反光）'));
  assert.ok(!prompt.includes('[[imgreq]]'));
  assert.ok(!prompt.includes('[[/imgreq]]'));
});

test('generateUserPostComment 用描述助手的文字代替原图，标注 AI 配图身份', async t => {
  t.after(() => closeDb());
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO characters (name, display_name, base_prompt) VALUES ('gen', '看图人', '看图人的人设')`
  ).run();
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(result.lastInsertRowid));

  const messages = [];
  await generateUserPostComment(
    character,
    {
      content: '看我看到了什么\n[[imgreq]]史莱姆和湿滑反光[[/imgreq]]',
      prompt: '第1张：一个蓝色卡通史莱姆和湿滑反光',
      imageDataUris: ['[image omitted]'],
    },
    [],
    { chatSync: async (m) => { messages.push(m); return '好'; } }
  );

  // 不再有 multimodal 附图消息
  assert.ok(messages[0].every(m => typeof m.content === 'string'), '所有消息应为纯文本');
  const prompt = flattenMessages(messages);
  assert.ok(prompt.includes('第1张：一个蓝色卡通史莱姆和湿滑反光'), '描述助手结果应注入评论 prompt');
  assert.ok(prompt.includes('（AI 配图需求：史莱姆和湿滑反光）'), '隐藏需求仍应还原为参考文本');
  assert.ok(prompt.includes('<post_image>'), '配图应包裹在独立标签块');
  assert.ok(prompt.includes('AI 根据配图需求'), '应有 AI 配图身份标注');
  assert.ok(prompt.includes('图中人物不是'), '应有身份隔离标注');
  assert.ok(prompt.includes('不要把图中人物当成'), '应有防误认规则');
  assert.ok(prompt.includes('描写图中角色的外貌或行为'), '应有防归因规则');
  assert.ok(!prompt.includes('[[imgreq]]'), '标记不应泄露');
});

test('generateUserPostComment keeps ordinary posts unchanged', async t => {
  t.after(() => closeDb());
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO characters (name, display_name, base_prompt) VALUES ('plain', '普通人', '普通人的人设')`
  ).run();
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(result.lastInsertRowid));

  const messages = [];
  await generateUserPostComment(
    character,
    { content: '海边天气很好', prompt: '' },
    [],
    { chatSync: async (m) => { messages.push(m); return '好'; } }
  );

  const prompt = flattenMessages(messages);
  assert.ok(prompt.includes('海边天气很好'));
  assert.ok(!prompt.includes('配图需求：'));
});
