import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('publication tests must not call external services'); };
const { getDb, closeDb } = await import('../src/db/index.js');
const { createOutlet, listOutlets, listPosts, getMediaUnread, fillPendingImages, fillPortalImages, listPostsNeedingImage } = await import('../src/services/mediaService.js');
const { publishMediaPostIfReady } = await import('../src/services/mediaPublication.js');
const { addClient, removeClient } = await import('../src/services/unifiedStreamBus.js');
after(() => closeDb());

test('drafts remain hidden until every image is ready; retry publishes exactly once', async () => {
  const db = getDb();
  db.prepare('DELETE FROM media_posts').run();
  const outlet = createOutlet({ name: '发布回归', prompt: 'test' });
  const insert = db.prepare(`INSERT INTO media_posts
    (outlet_id, title, content, image_prompt, payload_json, published_seq) VALUES (?, 'draft', 'text ready', ?, ?, NULL)`);
  const feed = Number(insert.run(outlet.id, 'cover', null).lastInsertRowid);
  const panels = { panels: [{ image_prompt: 'panel', image: null }] };
  const poster = Number(insert.run(outlet.id, 'cover', JSON.stringify(panels)).lastInsertRowid);
  const sections = { portal: true, sections: [{ key: 'a', image_prompt: 'a', image: '/a.png' }, { key: 'b', image_prompt: 'b' }] };
  const portal = Number(insert.run(outlet.id, 'a', JSON.stringify(sections)).lastInsertRowid);
  const events = [];
  const client = { write: value => events.push(value) };
  addClient(client);
  try {
    for (const id of [feed, poster, portal]) assert.equal(publishMediaPostIfReady(id), false);
    assert.equal(listPosts().total, 0);
    assert.equal(listOutlets().find(o => o.id === outlet.id).post_count, 0);
    assert.equal(getMediaUnread().count, 0);
    assert.equal(events.length, 0);
    db.prepare("UPDATE media_posts SET image_status = 'failed' WHERE id = ?").run(feed);
    assert.ok(listPostsNeedingImage().some(p => p.id === feed), 'failed unpublished cover remains retryable');
    // Main cover alone cannot publish a poster that still needs its panel.
    db.prepare("UPDATE media_posts SET image = '/cover.png' WHERE id IN (?, ?)").run(feed, poster);
    assert.equal(publishMediaPostIfReady(poster), false);
    assert.equal(publishMediaPostIfReady(feed), true);
    assert.equal(publishMediaPostIfReady(feed), false);
    panels.panels[0].image = '/panel.png';
    sections.sections[1].image = '/b.png';
    db.prepare('UPDATE media_posts SET payload_json = ? WHERE id = ?').run(JSON.stringify(panels), poster);
    db.prepare('UPDATE media_posts SET payload_json = ? WHERE id = ?').run(JSON.stringify(sections), portal);
    // Recovery paths publish persisted completed drafts, and parallel requests do not duplicate notices.
    await Promise.all([fillPendingImages(0), fillPendingImages(0), fillPortalImages(6), fillPortalImages(6)]);
    assert.equal(listPosts().total, 3);
    assert.equal(getMediaUnread().count, 3);
    assert.equal(events.filter(e => e.startsWith('event: media_new_posts\n')).length, 3);
    // Re-rendering an already published post never sends another new-post notification.
    db.prepare("UPDATE media_posts SET image = NULL, image_status = 'pending' WHERE id = ?").run(feed);
    assert.equal(publishMediaPostIfReady(feed), false);
    assert.equal(listPosts().total, 3);
  } finally { removeClient(client); }
});

test('late image completion sorts as new content and survives newer posts being marked read', () => {
  const db = getDb();
  db.prepare('DELETE FROM media_posts').run();
  const outlet = createOutlet({ name: '乱序发布回归', prompt: 'test' });
  const insert = db.prepare("INSERT INTO media_posts (outlet_id, title, content, image_prompt, published_seq) VALUES (?, 'draft', 'text', 'cover', NULL)");
  const slow = Number(insert.run(outlet.id).lastInsertRowid);
  const fast = Number(insert.run(outlet.id).lastInsertRowid);
  db.prepare("UPDATE media_posts SET image = '/fast.png' WHERE id = ?").run(fast);
  publishMediaPostIfReady(fast);
  const seen = listPosts().posts[0].published_seq;
  assert.equal(getMediaUnread({ social: seen }).count, 0);
  db.prepare("UPDATE media_posts SET image = '/slow.png' WHERE id = ?").run(slow);
  publishMediaPostIfReady(slow);
  assert.equal(getMediaUnread({ social: seen }).count, 1);
  assert.deepEqual(listPosts().posts.map(p => p.id), [slow, fast]);
  assert.ok(listPosts().posts[0].published_seq > seen);
});
