import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('media layout tests must not call external services'); };
const { getDb, closeDb, migrateMediaOutletLayouts } = await import('../src/db/index.js');
const { createOutlet, updateOutlet, getOutlet, listPosts, listPostsNeedingImage, generatePortalSection } = await import('../src/services/mediaService.js');
after(() => closeDb());

test('startup migration never overwrites a saved type on subsequent starts', () => {
  const db = getDb();
  db.prepare(`DELETE FROM system_settings WHERE setting_key = 'media_layout_editable_migrated'`).run();
  db.prepare(`UPDATE media_outlets SET layout = 'weekly' WHERE name = '狸狸通讯社'`).run();
  migrateMediaOutletLayouts(db);
  const outlet = db.prepare(`SELECT * FROM media_outlets WHERE name = '狸狸通讯社'`).get();
  assert.equal(outlet.layout, 'portal');
  updateOutlet(outlet.id, { layout: 'feed' });
  migrateMediaOutletLayouts(db);
  assert.equal(getOutlet(outlet.id).layout, 'feed');
});

test('media type can be created, changed, omitted, and rejects unsupported values', () => {
  const social = createOutlet({ name: '测试社交', prompt: '测试编辑风格' });
  const digital = createOutlet({ name: '测试报刊', prompt: '测试编辑风格', layout: 'portal' });
  assert.equal(social.layout, 'feed');
  assert.equal(digital.layout, 'portal');
  assert.equal(updateOutlet(social.id, { layout: 'portal' }).layout, 'portal');
  assert.equal(updateOutlet(social.id, { tagline: '只修改介绍' }).layout, 'portal');
  assert.equal(updateOutlet(digital.id, { layout: 'feed' }).layout, 'feed');
  assert.throws(() => updateOutlet(digital.id, { layout: 'unknown' }), { statusCode: 400 });
  assert.equal(getOutlet(digital.id).layout, 'feed');
  assert.throws(() => createOutlet({ name: '非法类型', prompt: '测试', layout: null }), { statusCode: 400 });
});

test('changing type moves old posts between categories without losing content or breaking image routing', async () => {
  const db = getDb();
  const outlet = createOutlet({ name: '分类切换回归', prompt: '测试' });
  const insert = db.prepare(`INSERT INTO media_posts (outlet_id, title, content, image_prompt, image_status, payload_json) VALUES (?, ?, ?, ?, 'pending', ?)`);
  const feedId = Number(insert.run(outlet.id, '旧帖子', '保留正文', 'photo', null).lastInsertRowid);
  const body = [{ type: 'p', text: '已缓存的正文' }];
  const portalId = Number(insert.run(outlet.id, '旧报刊', '', 'cover', JSON.stringify({ portal: true, sections: [{ key: 'a', body, image_prompt: 'section' }] })).lastInsertRowid);
  updateOutlet(outlet.id, { layout: 'portal' });
  assert.equal(listPosts({ outletId: outlet.id, category: 'digital' }).total, 2);
  assert.equal(listPosts({ outletId: outlet.id, category: 'social' }).total, 0);
  assert.equal(listPostsNeedingImage(100).some(p => p.id === feedId), true);
  assert.equal(listPostsNeedingImage(100).some(p => p.id === portalId), false);
  updateOutlet(outlet.id, { layout: 'feed' });
  const posts = listPosts({ outletId: outlet.id, category: 'social' });
  assert.equal(posts.total, 2);
  assert.equal(posts.posts.find(p => p.id === feedId).content, '保留正文');
  assert.deepEqual((await generatePortalSection(portalId, 'a')).section.body, body);
  assert.equal(listPostsNeedingImage(100).some(p => p.id === portalId), false);
});
