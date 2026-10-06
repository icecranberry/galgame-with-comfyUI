import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };

const { config } = await import('../src/config.js');
config.features.schedule = false;
config.features.emotion = false;
config.user.nickname = '测试员';

const { getDb } = await import('../src/db/index.js');
const router = (await import('../src/routes/moments.js')).default;

/** 用真实 express app 托管 router 发请求 */
async function makeApp() {
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/moments', router);
  return app;
}

function request(app, url) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      http.request({ host: '127.0.0.1', port, method: 'GET', path: url }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          server.close();
          try { resolve({ status: res.statusCode, payload: data ? JSON.parse(data) : null }); }
          catch (e) { reject(e); }
        });
      }).end();
    });
  });
}

function seedPost(db, { content = '动态', prompt = '', status = 'done' } = {}) {
  const r = db.prepare(
    `INSERT INTO moment_posts (character_id, content, prompt, status) VALUES (NULL, ?, ?, ?)`
  ).run(content, prompt, status);
  return Number(r.lastInsertRowid);
}

test('列表分页契约：limit 截取最新一段，hasMore 探测，before_id 按 keyset 续拉', async () => {
  const db = getDb();
  const ids = [];
  for (let i = 1; i <= 5; i++) ids.push(seedPost(db, { content: `post${i}`, prompt: `提示词${i}` }));
  seedPost(db, { content: '生成中', status: 'pending' });   // 非 done 不进列表

  const app = await makeApp();

  // 首屏：默认只回最新一段
  const first = await request(app, '/api/moments?limit=3');
  assert.equal(first.status, 200);
  assert.deepEqual(first.payload.posts.map(p => p.id), [ids[4], ids[3], ids[2]]);
  assert.equal(first.payload.hasMore, true);

  // keyset 续拉：比 ids[2] 更旧的剩两条，hasMore 翻 false
  const second = await request(app, `/api/moments?limit=3&before_id=${ids[2]}`);
  assert.deepEqual(second.payload.posts.map(p => p.id), [ids[1], ids[0]]);
  assert.equal(second.payload.hasMore, false);

  // 恰好整除的边界：limit == 剩余条数时 hasMore 必须为 false
  const exact = await request(app, `/api/moments?limit=5`);
  assert.deepEqual(exact.payload.posts.map(p => p.id), [...ids].reverse());
  assert.equal(exact.payload.hasMore, false);

  // 列表不回传 prompt（feed 用不到，占响应体大头），单帖详情接口不受影响
  assert.ok(!('prompt' in first.payload.posts[0]));
  assert.equal(first.payload.posts[0].content, 'post5');
});

test('不传 limit 时默认 1000，超出上限被钳制', async () => {
  const app = await makeApp();
  const all = await request(app, '/api/moments?limit=99999');
  assert.equal(all.status, 200);
  assert.ok(all.payload.posts.length <= 1000);
});
