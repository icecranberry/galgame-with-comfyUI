import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { config } = await import('../src/config.js');
config.dbPath = ':memory:';
const { getDb, closeDb } = await import('../src/db/index.js');
const { pickActiveCharacters } = await import('../src/services/mediaService.js');
const { pickFeaturedCharacter } = await import('../src/services/newspaperService.js');
const { getAllOverview } = await import('../src/services/scheduleManager.js');
const scheduler = await import('../src/services/momentScheduler.js');
const router = (await import('../src/routes/characters.js')).default;

test('旧存档的角色归档标记不再屏蔽角色，独立活动开关仍生效', async t => {
  const db = getDb();
  t.after(closeDb);
  // 模拟升级前的存档；新库已不再创建此字段。
  assert.equal(db.prepare('PRAGMA table_info(characters)').all().some(c => c.name === 'archived'), false);
  db.exec('ALTER TABLE characters ADD COLUMN archived INTEGER DEFAULT 0');
  db.prepare('UPDATE characters SET moments_disabled = 1, events_disabled = 1').run();
  db.prepare('UPDATE town_npcs SET moments_disabled = 1').run();
  const { lastInsertRowid: id } = db.prepare(`
    INSERT INTO characters (name, display_name, base_prompt, archived, moments_disabled, events_disabled, next_moment_at)
    VALUES ('legacy_archived', '旧存档角色', '测试人设', 1, 0, 0, datetime('now', '-1 hour'))
  `).run();
  assert.equal(pickFeaturedCharacter(db)?.id, id);
  assert.ok(getAllOverview().some(c => c.id === id));
  // 独立最小库保证随机抽样只存在这一个候选。
  db.prepare('DELETE FROM characters WHERE id != ?').run(id);
  assert.deepEqual(pickActiveCharacters(1).map(c => c.id), [id]);

  const calls = [];
  scheduler.setMomentPostGenerator(async character => { calls.push(character.id); });
  await scheduler.runSchedulerTick();
  assert.deepEqual(calls, [id]);
  db.prepare("UPDATE characters SET moments_disabled = 1, next_moment_at = datetime('now', '-1 hour') WHERE id = ?").run(id);
  await scheduler.runSchedulerTick();
  assert.equal(calls.length, 1, '不看朋友圈的独立设置仍应拦截自动发帖');
  assert.equal(pickFeaturedCharacter(db), null, '日报仍尊重独立活动设置');
});

test('已移除的人设润色与单个/批量归档接口不再接受请求', async () => {
  for (const [method, url] of [['POST', '/refine-persona-draft'], ['POST', '/archived-all'], ['PUT', '/1/archived']]) {
    const result = await new Promise((resolve, reject) => {
      const req = { method, url, body: {} };
      const res = {
        status() { return this; },
        json() { resolve('handled'); },
      };
      router.handle(req, res, err => err ? reject(err) : resolve('not-found'));
    });
    assert.equal(result, 'not-found', `${method} ${url}`);
  }
});
