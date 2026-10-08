import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { config } = await import('../src/config.js');
const { getDb, closeDb, migrateNewspaperDropForeignKey } = await import('../src/db/index.js');
const { getLocalDateKey } = await import('../src/utils/localDate.js');
const svc = await import('../src/services/newspaperService.js');
const sched = await import('../src/services/momentScheduler.js');

config.dbPath = ':memory:';

/**
 * ★★ 前置：把发帖频率闸门打开（2026-10-07 本地修复）。
 *
 * `seedData.js` 的 `feature_momentFreq` 默认值是 **`'0'`（关闭）** —— 这符合本项目
 * 「长驻功能默认值一律关闭」的红线，是**正确**的产品行为。但 `momentScheduler.tick()`
 * 的第一道门就是 `if (momentFreq <= 0) return;`，于是默认配置下调度器根本不派单。
 *
 * ⚠⚠ **必须在 `getDb()` 之后调用** —— `system_settings` 里的 `feature_momentFreq='0'`
 *   会在 DB 初始化时回灌 config，把先设的值覆盖掉。
 *
 * ⚠ 同一文件里另一条「睡眠角色跳过吐槽帖」的测试**必须也打开闸门**：它断言的是
 *   `calls.length === 0`，而闸门关闭时 tick 直接 return 也得到 0 —— 那样是**假通过**，
 *   测不出「调度器真的跑到了可发性校验并正确挡住睡眠角色」。
 */
function enableMomentScheduling() {
  config.features.momentFreq = 1;
}

const VALID_EVENT = {
  title: '铁匠铺今晨提前开炉',
  content: '本报讯：铁匠铺老板娘今日提前两小时开炉，据说是为赶制一批意外涌来的订单。',
  note: '你今天一早就会被人潮堵在铁匠铺门口，订单多到打不完。',
  image_prompt: 'a blacksmith workshop at dawn, warm forge light',
};

const VALID_NEWS_ITEM = {
  category: '市集',
  title: '市集今起增设夜摊',
  content: '本报讯：市集管理处宣布今日起增设夜摊，傍晚起灯火通明。',
  image_prompt: 'a market at dusk with lanterns',
};

test('normalizeNewspaperDraft keeps valid fields and strips invalid news', () => {
  const draft = svc.normalizeNewspaperDraft({
    news: [
      VALID_NEWS_ITEM,
      { title: '无正文', content: '' },
      { title: '带别名字段', content: '内容', imagePrompt: 'english prompt alias' },
    ],
    character_event: VALID_EVENT,
  }, { withWorldState: false });

  assert.equal(draft.news.length, 2);
  assert.equal(draft.news[1].image_prompt, 'english prompt alias');
  assert.equal(draft.news[0].image, null);
  assert.equal(draft.character_event.title, VALID_EVENT.title);
  assert.equal(draft.world_state, null);
});

test('normalizeNewspaperDraft throws on missing character_event or empty news', () => {
  assert.throws(() => svc.normalizeNewspaperDraft({ news: [VALID_NEWS_ITEM] }), /character_event/);
  assert.throws(() => svc.normalizeNewspaperDraft({ news: [], character_event: VALID_EVENT }), /No valid news/);
  assert.throws(
    () => svc.normalizeNewspaperDraft({ news: [VALID_NEWS_ITEM], character_event: { title: 't', content: 'c' } }),
    /character_event/,
  );
});

test('normalizeNewspaperDraft handles world_state strictly by roll result', () => {
  const ws = {
    name: '银月潮汐',
    description: '银月升至中天，潮汐漫过石阶。',
    outfit: '全镇居民的衣摆都泛起淡淡的银色波光，像浸过月光的海水。',
    news: '号外：今夜潮汐异动。',
    effect_prompt: '今天你的情绪会随月光起伏。',
    image_prompt: 'moonlit tide over stone steps',
  };
  const withWs = svc.normalizeNewspaperDraft(
    { news: [VALID_NEWS_ITEM], character_event: VALID_EVENT, world_state: ws },
    { withWorldState: true },
  );
  assert.equal(withWs.world_state.name, '银月潮汐');
  assert.equal(withWs.world_state.outfit, '全镇居民的衣摆都泛起淡淡的银色波光，像浸过月光的海水。');

  // outfit 是可选字段：旧报纸/LLM 漏写时为空串，不阻断出报
  const noOutfit = svc.normalizeNewspaperDraft(
    { news: [VALID_NEWS_ITEM], character_event: VALID_EVENT, world_state: { ...ws, outfit: undefined } },
    { withWorldState: true },
  );
  assert.equal(noOutfit.world_state.outfit, '');

  // 未掷中时即使 LLM 输出了 world_state 也要丢弃
  const withoutWs = svc.normalizeNewspaperDraft(
    { news: [VALID_NEWS_ITEM], character_event: VALID_EVENT, world_state: ws },
    { withWorldState: false },
  );
  assert.equal(withoutWs.world_state, null);

  // 掷中但字段不完整 → 丢弃并置空，不影响出报
  const brokenWs = svc.normalizeNewspaperDraft(
    { news: [VALID_NEWS_ITEM], character_event: VALID_EVENT, world_state: { name: '残缺' } },
    { withWorldState: true },
  );
  assert.equal(brokenWs.world_state, null);
});

test('normalizeNewspaperDraft caps news at 4 items', () => {
  const news = Array.from({ length: 6 }, (_, i) => ({
    ...VALID_NEWS_ITEM,
    title: `新闻${i}`,
  }));
  const draft = svc.normalizeNewspaperDraft({ news, character_event: VALID_EVENT });
  assert.equal(draft.news.length, 4);
});

test('buildWorldStatePromptBlock renders name and effect prompt', () => {
  const block = svc.buildWorldStatePromptBlock({
    name: '银月潮汐',
    effect_prompt: '今天你的情绪会随月光起伏。',
  });
  assert.ok(block.includes('银月潮汐'));
  assert.ok(block.includes('情绪会随月光起伏'));
  assert.equal(svc.buildWorldStatePromptBlock(null), '');
  assert.equal(svc.buildWorldStatePromptBlock({ name: 'x' }), '');
});

test('buildCharacterEventBlock wraps note for the featured character only', () => {
  const block = svc.buildCharacterEventBlock('林小姐', VALID_EVENT);
  assert.ok(block.includes('<newspaper_event>'));
  assert.ok(block.includes('铁匠铺今晨提前开炉'));
  assert.ok(block.includes(VALID_EVENT.note));
  assert.equal(svc.buildCharacterEventBlock('林小姐', { title: 't' }), '');
});

test('buildGroupNewspaperBlock shares news view and only names the featured member', () => {
  const block = svc.buildGroupNewspaperBlock({
    worldState: { name: '银月潮汐', description: '潮汐漫过石阶。' },
    characterEvent: VALID_EVENT,
    featuredMemberName: '林小姐',
  });
  assert.ok(block.includes('<newspaper_today>'));
  assert.ok(block.includes('【今日状态】'));
  assert.ok(block.includes('【今日新闻】'));
  assert.ok(block.includes('主角正是林小姐本人'));
  assert.ok(!block.includes(VALID_EVENT.note), 'second-person note must not leak into group block');

  const plain = svc.buildGroupNewspaperBlock({ characterEvent: VALID_EVENT });
  assert.ok(!plain.includes('主角正是'));
  assert.equal(svc.buildGroupNewspaperBlock({}), '');
});

test('buildFormatPrompt toggles world_state section and includes featured name', () => {
  const withWs = svc.buildFormatPrompt(true, '林小姐');
  assert.ok(withWs.includes('"world_state"'));
  assert.ok(withWs.includes('"outfit"'), 'world_state example must carry the outfit field for appearance injection');
  assert.ok(withWs.includes('林小姐'));
  const withoutWs = svc.buildFormatPrompt(false, '林小姐');
  assert.ok(!withoutWs.includes('"effect_prompt"'), 'world_state example block must be absent');
  assert.ok(!withoutWs.includes('"outfit"'), 'outfit field must be absent without the world_state roll');
  assert.ok(withoutWs.includes('不要出现它'));
});

test('buildComplaintTopic builds forced topic from event', () => {
  const topic = svc.buildComplaintTopic(VALID_EVENT, '林小姐');
  assert.equal(topic.name, '今日报纸吐槽');
  assert.ok(topic.desc.includes('铁匠铺今晨提前开炉'));
  assert.equal(svc.buildComplaintTopic(null, '林小姐'), null);
  assert.equal(svc.buildComplaintTopic({ title: 't' }, '林小姐'), null);
});

test('maybeGenerateDailyNewspaper dedupes on the existing paper of today (no hour gate since midnight refresh)', async t => {
  const db = getDb();
  t.after(() => closeDb());

  const anyTime = new Date('2026-09-28T00:00:00');

  db.prepare(`
    INSERT INTO town_newspapers (publish_date, name, edition, items_json, character_id, character_event_json, world_state_json, moment_done, complaint_after)
    VALUES (?, '邻舍日报', 1, '[]', NULL, NULL, NULL, 0, NULL)
  `).run(getLocalDateKey());
  assert.equal(svc.maybeGenerateDailyNewspaper(anyTime), null, 'existing paper wins over generation — even right after midnight');
});

test('scheduler posts the complaint as an extra moment and restores next_moment_at', async t => {
  const db = getDb();
  enableMomentScheduling();   // ⚠ 必须在 getDb() 之后（settings 会回灌 config）
  t.after(() => closeDb());

  db.prepare(`INSERT INTO characters (name, display_name, base_prompt, next_moment_at) VALUES ('lin', '林小姐', '旅客', datetime('now', '+3 hours'))`).run();
  const character = db.prepare(`SELECT * FROM characters WHERE name = 'lin'`).get();

  db.prepare(`
    INSERT INTO town_newspapers (publish_date, name, edition, items_json, character_id, character_event_json, world_state_json, moment_done, complaint_after)
    VALUES (?, '邻舍日报', 1, '[]', ?, ?, NULL, 0, datetime('now', '-1 minute'))
  `).run(getLocalDateKey(), character.id, JSON.stringify(VALID_EVENT));

  const calls = [];
  sched.setMomentPostGenerator(async (char, opts = {}) => {
    calls.push({ charId: char.id, opts });
    // 模拟 generateMomentPost 的行为：把 next_moment_at 推到未来
    db.prepare(`UPDATE characters SET next_moment_at = datetime('now', '+6 hours') WHERE id = ?`).run(char.id);
  });
  t.after(() => sched.setMomentPostGenerator(async () => {}));

  await sched.runSchedulerTick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].charId, character.id);
  assert.ok(calls[0].opts.forcedTopic?.desc.includes('铁匠铺今晨提前开炉'), 'complaint topic carries the event');

  const paper = db.prepare(`SELECT * FROM town_newspapers WHERE publish_date = ?`).get(getLocalDateKey());
  assert.equal(paper.moment_done, 1);
  const nextAt = db.prepare(`SELECT next_moment_at FROM characters WHERE id = ?`).get(character.id)?.next_moment_at;
  assert.ok(nextAt, 'next_moment_at still set');
});

test('scheduler skips complaint while the character is sleeping', async t => {
  const db = getDb();
  enableMomentScheduling();   // ⚠ 否则 tick 直接 return，本测试会假通过
  t.after(() => closeDb());

  db.prepare(`INSERT INTO characters (name, display_name, base_prompt, is_sleeping, next_moment_at) VALUES ('sleeper', '瞌睡小姐', '旅客', 1, datetime('now', '+3 hours'))`).run();
  const character = db.prepare(`SELECT * FROM characters WHERE name = 'sleeper'`).get();
  db.prepare(`
    INSERT INTO town_newspapers (publish_date, name, edition, items_json, character_id, character_event_json, world_state_json, moment_done, complaint_after)
    VALUES (?, '邻舍日报', 1, '[]', ?, ?, NULL, 0, datetime('now', '-1 minute'))
  `).run(getLocalDateKey(), character.id, JSON.stringify(VALID_EVENT));

  const calls = [];
  sched.setMomentPostGenerator(async (char, opts) => { calls.push({ char, opts }); });
  t.after(() => sched.setMomentPostGenerator(async () => {}));

  await sched.runSchedulerTick();
  assert.equal(calls.length, 0, 'sleeping character must not be woken for the complaint');
  const paper = db.prepare(`SELECT moment_done FROM town_newspapers WHERE publish_date = ?`).get(getLocalDateKey());
  assert.equal(paper.moment_done, 0, 'complaint stays pending for a later tick');
});

test('collectImageTasks collects only missing images in editorial order', () => {
  const row = {
    id: 1,
    items_json: JSON.stringify([
      { title: '甲', content: 'a1', image_prompt: 'p1', image: null },
      { title: '乙', content: 'b1', image_prompt: 'p2', image: '/images/newspaper/x.png' },
      { title: '丙', content: 'c1', image: null },
    ]),
    character_event_json: JSON.stringify({ title: '特稿', content: 'c', image_prompt: 'p0', image: null }),
    world_state_json: JSON.stringify({ name: '状态', description: 'd', image_prompt: 'p9', image: null }),
  };
  const tasks = svc.collectImageTasks(row);
  assert.deepEqual(tasks.map(t => t.key), ['character_event', 'news', 'world_state']);
  assert.equal(tasks[0].hasLoras, true, 'featured illustration carries character loras');
  assert.equal(tasks[1].item.title, '甲');

  const done = svc.collectImageTasks({
    items_json: JSON.stringify([{ image_prompt: 'p1', image: 'x' }]),
    character_event_json: JSON.stringify({ image_prompt: 'p0', image: 'e' }),
    world_state_json: JSON.stringify({ image_prompt: 'p9', image: 'w' }),
  });
  assert.equal(done.length, 0, 'fully illustrated paper has no refill tasks');
  assert.equal(svc.collectImageTasks(null).length, 0);
});

test('findMissingImageTask maps frontend slots to missing image tasks', () => {
  const row = {
    id: 1,
    items_json: JSON.stringify([
      { title: '甲', content: 'a1', image_prompt: 'p1', image: null },
      { title: '乙', content: 'b1', image_prompt: 'p2', image: '/images/newspaper/x.png' },
      { title: '丙', content: 'c1', image: null }, // 没有 image_prompt：LLM 漏写，走正文兜底
    ]),
    character_event_json: JSON.stringify({ title: '特稿', content: 'c', image_prompt: 'p0', image: null }),
    world_state_json: JSON.stringify({ name: '状态', description: 'd', image_prompt: 'p9', image: null }),
  };

  const lead = svc.findMissingImageTask(row, 'lead');
  assert.equal(lead.key, 'character_event');
  assert.equal(lead.image, 'p0');
  assert.equal(lead.hasLoras, true);
  assert.equal(svc.findMissingImageTask(row, 'world').image, 'p9');
  const item = svc.findMissingImageTask(row, 'item', 0);
  assert.equal(item.key, 'news');
  assert.equal(item.image, 'p1');

  // 已有图的槽位 / 越界下标 / 未知槽位：都不可补
  assert.equal(svc.findMissingImageTask(row, 'item', 1), null, 'illustrated item is not regenerable');
  assert.equal(svc.findMissingImageTask(row, 'item', 9), null);
  assert.equal(svc.findMissingImageTask(row, 'item', -1), null);
  assert.equal(svc.findMissingImageTask(row, 'unknown'), null);
  assert.equal(svc.findMissingImageTask(null, 'lead'), null);

  // LLM 漏写 image_prompt 的槽位走正文兜底：依然可补，画面描述由标题+正文拼出
  const fallback = svc.findMissingImageTask(row, 'item', 2);
  assert.ok(fallback, 'item without image_prompt falls back to body text');
  assert.equal(fallback.key, 'news');
  assert.ok(fallback.image.includes('丙'), 'fallback prompt mentions the title');
  assert.ok(fallback.image.includes('c1'), 'fallback prompt mentions the body');
  assert.equal(fallback.ragQuery, 'c1');

  // 全部配好的报纸：任何槽位都不可补（无 world_state 也一样）
  const done = {
    id: 2,
    items_json: JSON.stringify([{ image_prompt: 'p1', image: 'x' }]),
    character_event_json: JSON.stringify({ image_prompt: 'p0', image: 'e' }),
    world_state_json: null,
  };
  assert.equal(svc.findMissingImageTask(done, 'lead'), null);
  assert.equal(svc.findMissingImageTask(done, 'world'), null);

  // 特稿漏写 image_prompt 时同样兜底（保留 LoRA 标记）
  const noPromptLead = {
    id: 3,
    items_json: '[]',
    character_event_json: JSON.stringify({ title: '特稿', content: '正文' }),
    world_state_json: null,
  };
  const leadFallback = svc.findMissingImageTask(noPromptLead, 'lead');
  assert.ok(leadFallback, 'lead without image_prompt falls back to body text');
  assert.equal(leadFallback.hasLoras, true);
  assert.ok(leadFallback.image.includes('特稿'));
});

test('pickFeaturedCharacter returns a plain row (regression: was async, callers got a Promise)', async t => {
  const db = getDb();
  t.after(() => closeDb());

  db.prepare(`INSERT INTO characters (name, display_name, base_prompt) VALUES ('pickme', '抽选小姐', '旅客')`).run();
  db.prepare(`UPDATE characters SET events_disabled = 1 WHERE name != 'pickme'`).run();
  try {
    const featured = svc.pickFeaturedCharacter(db);
    assert.ok(featured, 'a character is picked');
    assert.ok(typeof featured.id === 'number', 'id must be a real value, not undefined');
    assert.ok(typeof featured.display_name === 'string', 'display_name must be present');
    assert.equal(featured.display_name, '抽选小姐');
  } finally {
    db.prepare(`UPDATE characters SET events_disabled = 0`).run();
  }
});

test('migrateNewspaperDropForeignKey keeps the featured-character link across character deletion', async t => {
  const db = getDb();
  t.after(() => closeDb());

  // 造出旧库形态：character_id 带 ON DELETE SET NULL 外键
  db.exec(`DROP TABLE town_newspapers`);
  db.exec(`
    CREATE TABLE town_newspapers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      publish_date TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      edition INTEGER NOT NULL DEFAULT 1,
      items_json TEXT NOT NULL DEFAULT '[]',
      character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
      character_event_json TEXT,
      world_state_json TEXT,
      moment_done INTEGER NOT NULL DEFAULT 0,
      complaint_after DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(`INSERT INTO characters (name, display_name, base_prompt) VALUES ('doomed', '要删的角色', 'x')`).run();
  const charId = db.prepare(`SELECT id FROM characters WHERE name = 'doomed'`).get().id;
  db.prepare(`INSERT INTO town_newspapers (publish_date, character_id, character_event_json) VALUES ('2026-09-27', ?, '{}')`).run(charId);

  migrateNewspaperDropForeignKey(db);

  const fks = db.pragma('foreign_key_list(town_newspapers)');
  assert.equal(fks.length, 0, 'foreign key must be gone after migration');
  db.prepare(`DELETE FROM characters WHERE name = 'doomed'`).run();
  const paper = db.prepare(`SELECT character_id FROM town_newspapers WHERE publish_date = '2026-09-27'`).get();
  assert.equal(paper.character_id, charId, 'deleting the character must NOT null the paper link anymore');
});

test('pickWorldLoot draws only from clothing and transform pools', () => {
  // 无世界观：world_outfit 不进候选，发型卡/功能道具永不出现
  for (let i = 0; i < 200; i++) {
    const loot = svc.pickWorldLoot(false);
    assert.ok(loot, 'pool must be non-empty');
    assert.ok(['outfit', 'transform'].includes(loot.kind), `kind must be outfit|transform, got ${loot.kind}`);
    assert.ok(loot.name && loot.theme, 'loot must carry name and theme seed');
  }
  // 有世界观：world_outfit 加入候选
  for (let i = 0; i < 200; i++) {
    const loot = svc.pickWorldLoot(true);
    assert.ok(['outfit', 'world_outfit', 'transform'].includes(loot.kind), `kind must be outfit|world_outfit|transform, got ${loot.kind}`);
  }
});

test('pickWorldLoot follows 40/60 clothing-transform split with 40% world_outfit inside clothing', () => {
  const N = 2000;
  const count = { outfit: 0, world_outfit: 0, transform: 0 };
  const formNames = new Set(svc.WORLD_TRANSFORM_FORMS.map(f => f.name));
  for (let i = 0; i < N; i++) {
    const loot = svc.pickWorldLoot(true);
    count[loot.kind]++;
    if (loot.kind === 'transform') {
      // 变身日必须从预设形态池锁定一种，不再由 LLM 自由发挥
      assert.ok(formNames.has(loot.name), `transform loot name must come from WORLD_TRANSFORM_FORMS, got ${loot.name}`);
      assert.ok(loot.theme && loot.theme.includes(loot.name === '精灵耳' ? '精灵' : loot.name), 'theme must describe the locked form');
      assert.equal(loot.key, 'transform');
    }
  }
  // 容差 ~±5pp（2000 次时单比例 6σ≈3.4pp，取整留裕量）
  const ratio = k => count[k] / N;
  assert.ok(Math.abs(ratio('transform') - 0.4) < 0.05, `transform should be ~40%, got ${(ratio('transform') * 100).toFixed(1)}%`);
  assert.ok(Math.abs(ratio('world_outfit') - 0.24) < 0.05, `world_outfit should be ~24% (60% × 40%), got ${(ratio('world_outfit') * 100).toFixed(1)}%`);
  assert.ok(Math.abs(ratio('outfit') - 0.36) < 0.05, `fixed outfits should be ~36%, got ${(ratio('outfit') * 100).toFixed(1)}%`);

  // 无世界观：40% 分支回落固定款，world_outfit 恒为 0
  const noWorld = { outfit: 0, transform: 0 };
  for (let i = 0; i < N; i++) noWorld[svc.pickWorldLoot(false).kind]++;
  assert.ok(noWorld.transform / N > 0.3 && noWorld.transform / N < 0.5, `without world setting transform should be ~40%, got ${(noWorld.transform / N * 100).toFixed(1)}%`);
  assert.ok(noWorld.outfit / N > 0.5 && noWorld.outfit / N < 0.7, `without world setting outfit should be ~60%, got ${(noWorld.outfit / N * 100).toFixed(1)}%`);
});

test('buildFormatPrompt locks world_state to the drawn loot', () => {
  const loot = { key: 'bunny_girl', kind: 'outfit', name: '兔女郎服', theme: 'bunny girl costume details' };
  const withLoot = svc.buildFormatPrompt(true, '林小姐', loot);
  assert.ok(withLoot.includes('兔女郎服'), 'format prompt must name the drawn loot');
  assert.ok(withLoot.includes('不得替换成其他类型的状态'));
  const materials = svc.buildMaterialsPrompt({ display_name: '林小姐' }, true, loot);
  assert.ok(materials.includes('bunny girl costume details'), 'theme seed must reach the materials prompt verbatim');
  assert.ok(materials.includes('【今日镇内异变】'));
  const withoutWs = svc.buildFormatPrompt(false, '林小姐', loot);
  assert.ok(!withoutWs.includes('兔女郎服'), 'no world_state roll means loot must not appear');
});

test('setWorldStateDismissed toggles today paper world state on and off', () => {
  const db = getDb();
  db.prepare('DELETE FROM town_newspapers').run();
  db.prepare(`INSERT INTO characters (name, display_name, base_prompt) VALUES ('groupLead', '群主小姐', 'x')`).run();
  const leadId = db.prepare(`SELECT id FROM characters WHERE name = 'groupLead'`).get().id;
  db.prepare(`INSERT INTO group_chats (name) VALUES ('日报开关测试群')`).run();
  const groupId = db.prepare(`SELECT id FROM group_chats WHERE name = '日报开关测试群'`).get().id;
  db.prepare(`
    INSERT INTO town_newspapers (publish_date, name, edition, items_json, character_id, character_event_json, world_state_json, world_dismissed, moment_done, complaint_after)
    VALUES (?, '邻舍日报', 1, '[]', ?, ?, ?, 0, 0, NULL)
  `).run(getLocalDateKey(), leadId,
    JSON.stringify({ title: '群主小姐的大事件', content: '特稿正文', note: 'n' }),
    JSON.stringify({ name: '全镇兔女郎', description: '全镇居民今天都换上了兔女郎装。', effect_prompt: '今天你穿着兔女郎服。' }));

  assert.ok(svc.getWorldStateBlock().includes('全镇兔女郎'), 'active world state must inject');

  // 主角不在群里 → 整块不注入（2026-09-29 起的口径：群成员聊"特稿里陌生人的事"只会出戏）
  assert.equal(
    svc.takeGroupNewspaperBlockFor({ id: groupId, members: [] }), '',
    'group without the featured character must get no newspaper block at all',
  );
  // 主角在群里 → 注入，含世界状态段与特稿新闻
  const group = { id: groupId, members: [{ id: leadId, display_name: '群主小姐' }] };
  const withLead = svc.takeGroupNewspaperBlockFor(group);
  assert.ok(withLead.includes('今日状态'), 'group block must carry the world state before dismissal');
  assert.ok(withLead.includes('今日新闻'), 'group block must carry the featured news');
  assert.ok(withLead.includes('群主小姐'), 'featured member must be named in the group block');

  assert.equal(svc.setWorldStateDismissed(true), true);
  assert.equal(svc.getWorldStateBlock(), '', 'dismissed world state must not inject into chat anymore');
  const groupBlock = svc.takeGroupNewspaperBlockFor(group);
  assert.ok(!groupBlock.includes('今日状态'), 'dismissed world state must not inject into group chats');
  assert.ok(groupBlock.includes('今日新闻'), 'featured news stays in the group block after dismissal');
  const row = db.prepare('SELECT world_dismissed FROM town_newspapers WHERE publish_date = ?').get(getLocalDateKey());
  assert.equal(row.world_dismissed, 1);
  // 再开启：影响重新注入，标记归零
  assert.equal(svc.setWorldStateDismissed(false), true);
  assert.ok(svc.getWorldStateBlock().includes('全镇兔女郎'), 'restored world state must inject again');
  assert.equal(db.prepare('SELECT world_dismissed FROM town_newspapers WHERE publish_date = ?').get(getLocalDateKey()).world_dismissed, 0);
  // 幂等：重复同向设置不再写库（changed=0 仍返回 true 表示可操作）
  assert.equal(svc.setWorldStateDismissed(false), true);

  db.prepare('DELETE FROM town_newspapers').run();
  db.prepare(`DELETE FROM group_chats WHERE id = ?`).run(groupId);
  db.prepare(`DELETE FROM characters WHERE name = 'groupLead'`).run();
});

test('group newspaper block stops after GROUP_INJECT_ROUNDS rounds for the same paper', () => {
  const db = getDb();
  db.prepare('DELETE FROM town_newspapers').run();
  db.prepare(`INSERT INTO characters (name, display_name, base_prompt) VALUES ('capLead', '限额小姐', 'x')`).run();
  db.prepare(`INSERT INTO characters (name, display_name, base_prompt) VALUES ('capBystander', '路人先生', 'x')`).run();
  const leadId = db.prepare(`SELECT id FROM characters WHERE name = 'capLead'`).get().id;
  const bystanderId = db.prepare(`SELECT id FROM characters WHERE name = 'capBystander'`).get().id;
  db.prepare(`INSERT INTO group_chats (name) VALUES ('限额测试群')`).run();
  const groupId = db.prepare(`SELECT id FROM group_chats WHERE name = '限额测试群'`).get().id;

  const insertPaper = db.prepare(`
    INSERT INTO town_newspapers (publish_date, name, edition, items_json, character_id, character_event_json, world_state_json, world_dismissed, moment_done, complaint_after)
    VALUES (?, '邻舍日报', ?, '[]', ?, ?, NULL, 0, 0, NULL)
  `);
  insertPaper.run(getLocalDateKey(), 1, leadId,
    JSON.stringify({ title: '限额小姐的大事件', content: '特稿正文', note: 'n' }));
  const paperId = db.prepare(`SELECT id FROM town_newspapers WHERE publish_date = ?`).get(getLocalDateKey()).id;

  const group = { id: groupId, members: [{ id: leadId, display_name: '限额小姐' }] };
  // 主角不在群：不发块、也不消耗轮数（之后主角入群仍能拿到完整的 4 轮）
  assert.equal(svc.takeGroupNewspaperBlockFor({ id: groupId, members: [{ id: bystanderId, display_name: '路人先生' }] }), '');
  assert.equal(
    db.prepare('SELECT newspaper_rounds_used FROM group_chats WHERE id = ?').get(groupId).newspaper_rounds_used, 0,
    'a group without the featured member must not burn rounds',
  );

  for (let round = 1; round <= svc.GROUP_INJECT_ROUNDS; round++) {
    assert.ok(
      svc.takeGroupNewspaperBlockFor(group).includes('<newspaper_today>'),
      `round ${round} must still carry the newspaper block`,
    );
  }
  // 第 5 轮起当天不再注入（用户反馈：主角在群里被反复提起）
  assert.equal(svc.takeGroupNewspaperBlockFor(group), '', 'after the limit the block must be gone for the day');
  const usage = db.prepare('SELECT newspaper_paper_id, newspaper_rounds_used FROM group_chats WHERE id = ?').get(groupId);
  assert.equal(usage.newspaper_paper_id, paperId, 'usage is recorded against the current paper');
  assert.equal(usage.newspaper_rounds_used, svc.GROUP_INJECT_ROUNDS, 'used rounds stop at the limit');
  // 记账落库：重启/换进程也不会把同一期报纸重新发放一遍
  assert.equal(db.prepare('SELECT newspaper_rounds_used FROM group_chats WHERE id = ?').get(groupId).newspaper_rounds_used, svc.GROUP_INJECT_ROUNDS);

  // 次日新一期（同一天同一行被换掉 → 新 paper_id）：计数自动归零，重新发放
  db.prepare('DELETE FROM town_newspapers').run();
  insertPaper.run(getLocalDateKey(), 2, leadId,
    JSON.stringify({ title: '限额小姐的明日事件', content: '特稿正文', note: 'n' }));
  const nextPaperId = db.prepare(`SELECT id FROM town_newspapers WHERE publish_date = ?`).get(getLocalDateKey()).id;
  assert.notEqual(nextPaperId, paperId, 'a fresh edition must have its own paper id');
  assert.ok(
    svc.takeGroupNewspaperBlockFor(group).includes('<newspaper_today>'),
    'a new paper re-arms the block',
  );
  assert.equal(
    db.prepare('SELECT newspaper_rounds_used FROM group_chats WHERE id = ?').get(groupId).newspaper_rounds_used, 1,
    'rounds restart from zero for the new paper',
  );

  db.prepare('DELETE FROM town_newspapers').run();
  db.prepare(`DELETE FROM group_chats WHERE id = ?`).run(groupId);
  db.prepare(`DELETE FROM characters WHERE name IN ('capLead', 'capBystander')`).run();
});

test('listNewspaperEditions and getNewspaperByDate support past edition browsing', () => {
  const db = getDb();
  db.prepare('DELETE FROM town_newspapers').run();
  const insert = db.prepare(`
    INSERT INTO town_newspapers (publish_date, name, edition, items_json, character_id, character_event_json, world_state_json, world_dismissed, moment_done, complaint_after)
    VALUES (?, '邻舍日报', ?, ?, NULL, ?, NULL, 0, 0, NULL)
  `);
  insert.run('2026-09-28', 1, JSON.stringify([{ category: '市集', title: 'A', content: 'x', image: 'a.png' }]),
    JSON.stringify({ title: '特稿甲', content: 'c', note: 'n' }));
  insert.run('2026-09-29', 2, JSON.stringify([{ category: '民生', title: 'B', content: 'y', image: null }]),
    JSON.stringify({ title: '特稿乙', content: 'c', note: 'n' }));

  const editions = svc.listNewspaperEditions();
  assert.equal(editions.length, 2);
  assert.deepEqual(editions.map(e => e.edition), [2, 1], 'editions must be newest first');
  assert.equal(editions[0].featured_title, '特稿乙');
  assert.equal(editions[1].item_count, 1);

  const past = svc.getNewspaperByDate('2026-09-28');
  assert.equal(past.edition, 1);
  assert.equal(past.items[0].title, 'A');
  assert.equal(past.character_event.title, '特稿甲');
  assert.equal(past.world_dismissed, false);

  // 今天期同样可按日期取（回看口径一致）；非法日期与未知日期安全返回 null
  assert.equal(svc.getNewspaperByDate('2026-09-29').edition, 2);
  assert.equal(svc.getNewspaperByDate('not-a-date'), null);
  assert.equal(svc.getNewspaperByDate('1999-01-01'), null);

  db.prepare('DELETE FROM town_newspapers').run();
});

test('failed manual regeneration preserves the published paper and releases its lock', async () => {
  const db = getDb();
  db.prepare('DELETE FROM town_newspapers').run();
  db.prepare(`INSERT INTO town_newspapers (publish_date, name, edition, items_json)
    VALUES (?, '邻舍日报', 7, '[]')`).run(getLocalDateKey());
  const original = svc.getTodayNewspaper();
  const characters = db.prepare('SELECT id, events_disabled FROM characters').all();
  db.prepare('UPDATE characters SET events_disabled = 1').run();
  try {
    await assert.rejects(svc.regenerateTodayNewspaper(), /没有可用于生成日报的角色/);
    assert.deepEqual(svc.getTodayNewspaper(), original);
    await assert.rejects(svc.regenerateTodayNewspaper(), /没有可用于生成日报的角色/);
    assert.deepEqual(svc.getTodayNewspaper(), original);
  } finally {
    for (const character of characters) {
      db.prepare('UPDATE characters SET events_disabled = ? WHERE id = ?')
        .run(character.events_disabled, character.id);
    }
    db.prepare('DELETE FROM town_newspapers').run();
  }
});
