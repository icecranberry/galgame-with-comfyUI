import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };

const { getDb, closeDb } = await import('../src/db/index.js');
const router = (await import('../src/routes/groups.js')).default;

const AVATARS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'avatars');
// 路由不校验像素、只按 base64 落盘，所以现场拼一个 data URI，不把图片二进制塞进测试
const DATA_URI_PREFIX = 'dat' + 'a:image/png;base64,';
const PNG_BASE64 = DATA_URI_PREFIX + Buffer.from('group-avatar-test').toString('base64');

// 直接驱动 express router：handler 同步写库后 res.json 一次性返回
function callPost(id, body) {
  return new Promise((resolve, reject) => {
    const req = { method: 'POST', url: `/${id}/avatar`, params: { id: String(id) }, body };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, payload }); },
    };
    router.handle(req, res, (err) => (err ? reject(err) : resolve(null)));
  });
}

function callGetList() {
  return new Promise((resolve, reject) => {
    const req = { method: 'GET', url: '/', params: {} };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve(payload); },
    };
    router.handle(req, res, (err) => (err ? reject(err) : resolve(null)));
  });
}

function seedGroup(name = '测试群') {
  const { lastInsertRowid } = getDb().prepare(`INSERT INTO group_chats (name) VALUES (?)`).run(name);
  return lastInsertRowid;
}

function avatarFileOf(url) {
  return path.join(AVATARS_DIR, path.basename(url));
}

function storedAvatarPath(groupId) {
  return getDb().prepare('SELECT avatar_path FROM group_chats WHERE id = ?').get(groupId).avatar_path;
}

test('POST /api/groups/:id/avatar 落盘并写库；空 base64 清空头像且删文件', async t => {
  t.after(() => closeDb());
  const groupId = seedGroup();

  const saved = await callPost(groupId, { base64: PNG_BASE64 });
  assert.equal(saved.status, 200);
  assert.equal(saved.payload.ok, true);
  assert.match(saved.payload.avatar_path, /^\/avatars\/group_\d+_\d+\.png$/);
  const file = avatarFileOf(saved.payload.avatar_path);
  assert.ok(fs.existsSync(file), '头像文件应写入 data/avatars');
  assert.equal(storedAvatarPath(groupId), saved.payload.avatar_path);

  const cleared = await callPost(groupId, { base64: '' });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.payload.avatar_path, null);
  assert.equal(fs.existsSync(file), false, '恢复默认时必须删掉旧头像文件');
  assert.equal(storedAvatarPath(groupId), null);
});

test('POST /api/groups/:id/avatar 换头像时清理旧文件', async t => {
  t.after(() => closeDb());
  const groupId = seedGroup('换头像群');

  const first = await callPost(groupId, { base64: PNG_BASE64 });
  const second = await callPost(groupId, { base64: PNG_BASE64 });
  // /avatars 静态缓存 30 天，文件名不带时间戳就会一直显示旧头像
  assert.notEqual(first.payload.avatar_path, second.payload.avatar_path);
  assert.equal(fs.existsSync(avatarFileOf(first.payload.avatar_path)), false, '旧头像文件应被删除');
  assert.ok(fs.existsSync(avatarFileOf(second.payload.avatar_path)));

  await callPost(groupId, { base64: '' });
  assert.equal(fs.existsSync(avatarFileOf(second.payload.avatar_path)), false);
});

test('POST /api/groups/:id/avatar 拒绝非法 id 与不存在的群', async t => {
  t.after(() => closeDb());
  seedGroup();

  assert.equal((await callPost('abc', { base64: PNG_BASE64 })).status, 400);
  assert.equal((await callPost(-1, { base64: PNG_BASE64 })).status, 400);
  assert.equal((await callPost(9999, { base64: PNG_BASE64 })).status, 404);
});

test('群列表序列化带 avatar_path（未设置时为 null）', async t => {
  t.after(() => closeDb());
  const groupId = seedGroup('序列化群');

  const before = await callGetList();
  assert.equal(before.groups[0].avatar_path, null);

  await callPost(groupId, { base64: PNG_BASE64 });
  const after = await callGetList();
  assert.match(after.groups[0].avatar_path, /^\/avatars\/group_\d+_\d+\.png$/);

  await callPost(groupId, { base64: '' });
});