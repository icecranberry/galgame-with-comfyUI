import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('media unread tests must not call external services'); };
const { getDb, closeDb } = await import('../src/db/index.js');
const { createOutlet, getMediaUnread } = await import('../src/services/mediaService.js');
after(() => closeDb());

test('counts real unread rows across media categories, independent of ID gaps and images', () => {
  const db = getDb();
  db.prepare('DELETE FROM media_posts').run();
  const insert = db.prepare('INSERT INTO media_posts (outlet_id, title, content) VALUES (?, ?, ?)');
  const ids = [];
  for (const layout of ['feed', 'weekly', 'poster', 'portal']) {
    const outlet = createOutlet({ name: layout, prompt: 'test', layout: layout === 'feed' ? 'feed' : 'portal' });
    // 旧周刊/海报仍可读取，但创建入口已经统一为 portal。
    db.prepare('UPDATE media_outlets SET layout = ? WHERE id = ?').run(layout, outlet.id);
    ids.push(Number(insert.run(outlet.id, layout, 'body').lastInsertRowid));
  }
  assert.equal(getMediaUnread().count, 4);
  assert.equal(getMediaUnread().categories.digital.count, 3);
  assert.equal(getMediaUnread().categories.social.count, 1);
  // Only the viewed category is acknowledged; newer issues still accumulate.
  const seen = { digital: ids[2], social: 0 };
  assert.equal(getMediaUnread(seen).count, 2);
  db.prepare("UPDATE media_posts SET image = '/new-cover.png' WHERE id = ?").run(ids[3]);
  assert.equal(getMediaUnread(seen).count, 2);
  db.prepare('DELETE FROM media_posts WHERE id = ?').run(ids[3]);
  assert.equal(getMediaUnread(seen).count, 1);
  assert.equal(getMediaUnread({ digital: ids[3], social: ids[0] }).count, 0);
  assert.equal(getMediaUnread({ digital: 'NaN', social: -1 }).count, 3);
});
