import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };

const { getDb, closeDb } = await import('../src/db/index.js');
const router = (await import('../src/routes/moments.js')).default;

// 直接驱动 express router：PUT /:id 是同步 handler，res.json 一次性返回
function callPut(id, body) {
  return new Promise((resolve, reject) => {
    const req = { method: 'PUT', url: `/${id}`, body };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, payload }); },
    };
    router.handle(req, res, (err) => (err ? reject(err) : resolve(null)));
  });
}

async function seedPost(content) {
  const db = getDb();
  db.prepare(`INSERT INTO characters (name, display_name, base_prompt) VALUES ('lin', '林小姐', '旅客')`).run();
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO moment_posts (character_id, content, status) VALUES (?, ?, 'done')`
  ).run(1, content);
  return lastInsertRowid;
}

test('PUT /api/moments/:id 覆盖帖子文字并落库', async t => {
  t.after(() => closeDb());
  const id = await seedPost('原始内容');

  const { status, payload } = await callPut(id, { content: '  编辑后的内容\n第二行  ' });
  assert.equal(status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.content, '编辑后的内容\n第二行');

  const row = getDb().prepare('SELECT content FROM moment_posts WHERE id = ?').get(id);
  assert.equal(row.content, '编辑后的内容\n第二行');
});

test('PUT /api/moments/:id 拒绝空内容与不存在的帖子', async t => {
  t.after(() => closeDb());

  const empty = await callPut(1, { content: '   ' });
  assert.equal(empty.status, 400);

  const missing = await callPut(9999, { content: '不存在' });
  assert.equal(missing.status, 404);
});
