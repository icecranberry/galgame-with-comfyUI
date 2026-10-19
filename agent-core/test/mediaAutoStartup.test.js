import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { setImmediate as nextTurn } from 'node:timers/promises';

process.env.DB_PATH = ':memory:';
let requests = 0;
const imageModule = new URL('../src/services/imageSkill.js', import.meta.url).href;
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url === imageModule) return {
      format: 'module', shortCircuit: true,
      source: `export * from ${JSON.stringify(`${imageModule}?actual`)};
        export const generateImageRaw = async () => ({ success: false, images: [] });`,
    };
    return nextLoad(url, context);
  },
});
globalThis.fetch = async (url) => {
  assert.equal(String(url), 'https://media-startup-test.invalid/v1/chat/completions');
  requests++;
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ posts: [
    { title: '启动回归', content: '今天的消息', image_prompt: 'A quiet street in the morning' },
  ] }) }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
};
await import('openai/shims/web');
const { config } = await import('../src/config.js');
config.dbPath = ':memory:';
const { getDb, closeDb } = await import('../src/db/index.js');
const media = await import('../src/services/mediaService.js');
const scheduler = await import('../src/services/replyQueueScheduler.js');
const { getLocalDateKey } = await import('../src/utils/localDate.js');
const db = getDb();
config.llm.freeEgg = false;
config.llm._baseURL = 'https://media-startup-test.invalid/v1';
config.llm._apiKey = 'test-only';
db.prepare('UPDATE media_outlets SET enabled = 0').run();
db.prepare('UPDATE characters SET schedule_enabled = 0').run();
db.prepare(`INSERT INTO town_newspapers (publish_date, name, edition, items_json)
  VALUES (?, '已有日报', 1, '[]')`).run(getLocalDateKey());
const outlet = media.createOutlet({ name: '启动测试媒体', prompt: '测试媒体', layout: 'feed' });
after(async () => {
  scheduler.stopReplyQueueScheduler();
  await media.fillPendingImages(0);
  hooks.deregister();
  closeDb();
});

test('dev 启动十秒及后续分钟检查均不提前抓帖，完整间隔后仍会自动生成', async t => {
  config.isDev = true;
  config.features.mediaAutoMinutes = 5;
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
  t.after(() => scheduler.stopReplyQueueScheduler());
  const stuck = db.prepare(`INSERT INTO media_posts
    (outlet_id, title, content, image_prompt, image_status) VALUES (?, '中断帖子', '正文', 'a street', 'generating')`)
    .run(outlet.id).lastInsertRowid;
  const before = requests;
  scheduler.startReplyQueueScheduler();
  assert.equal(media.getAutoState().nextInMs, 5 * 60_000);
  assert.equal(db.prepare('SELECT image_status FROM media_posts WHERE id = ?').get(stuck).image_status, 'pending');
  t.mock.timers.tick(10_000);
  await nextTurn();
  assert.equal(requests, before, '首检不能发起传媒 LLM 请求');
  for (let minute = 1; minute < 5; minute++) {
    t.mock.timers.tick(60_000);
    await nextTurn();
    assert.equal(requests, before, `第 ${minute} 分钟不能因节流时间归零而抓帖`);
  }
  t.mock.timers.tick(60_000);
  await nextTurn();
  await media.fillPendingImages(0);
  assert.equal(requests, before + 1, '到达用户所选间隔后正常抓一批');
  const next = media.getAutoState().nextInMs;
  media.initializeMediaAutoSchedule();
  assert.equal(media.getAutoState().nextInMs, next, '重复初始化不推迟已存在的节流时间');
});

test('生产启动保留首次自动抓帖行为', async () => {
  // 独立模块实例模拟新进程，lastAutoAt 初始为 0。
  const fresh = await import('../src/services/mediaService.js?production-startup');
  config.isDev = false;
  config.features.mediaAutoMinutes = 5;
  fresh.initializeMediaAutoSchedule();
  assert.equal(fresh.getAutoState().nextInMs, 0);
  const before = requests;
  await fresh.maybeAutoGenerate();
  await fresh.fillPendingImages(0);
  assert.equal(requests, before + 1);
});

test('dev 等待期间手动刷新可用，关闭自动时不会生成', async () => {
  const fresh = await import('../src/services/mediaService.js?manual-startup');
  config.isDev = true;
  config.features.mediaAutoMinutes = 5;
  fresh.initializeMediaAutoSchedule();
  const before = requests;
  assert.equal(fresh.maybeAutoGenerate(), null);
  await fresh.generateMediaBatch({ outletId: outlet.id, count: 1, withCharacters: false, manual: true });
  await fresh.fillPendingImages(0);
  assert.equal(requests, before + 1);
  config.features.mediaAutoMinutes = 0;
  assert.equal(fresh.maybeAutoGenerate(Date.now() + 24 * 3600_000), null);
  assert.equal(fresh.getAutoState().nextInMs, null);
  assert.equal(requests, before + 1);
});
