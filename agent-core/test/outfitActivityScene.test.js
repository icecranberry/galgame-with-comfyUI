/**
 * 日程配图的「按那一段选装」—— 回归测试。
 *
 * ── 为什么要有这条（用户实报，2026-10-07）──────────────────
 * 用户截图：姬子在**床上睡觉**，却穿着**常服**（白裙 + 金饰 + 高跟鞋）。
 * 原话「姬子的睡眠没有与睡衣关联上」。
 *
 * 排查结论：数据没错（日程里 `outfit:"睡衣"` 标了、`character_outfits` 里 sleep 那套也在），
 * 错在**取用** —— 日程配图走的是 `getSceneOutfitForNow(id)`，它只认 `new Date()`。
 * 用户在**白天**点「夜间安睡」那一段，就被按"此刻"选成了白天的常服。
 *
 * ★ 语义定调：**日程配图要复现的是"那一段"的样子，不是"现在"的样子。**
 *   本测试同时钉住"仍需向前回溯"这一点 —— 日程只在换装那一刻标注 outfit。
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };

const { getDb, closeDb } = await import('../src/db/index.js');
const { getLocalDateKey } = await import('../src/utils/localDate.js');
const svc = await import('../src/services/outfitScene.js');

after(() => { try { closeDb(); } catch { /* ignore */ } });

/** 造一个配了 5 套场景服装的角色 + 指定今天的日程 */
function seed(activities) {
  const db = getDb();
  db.prepare('DELETE FROM character_outfits').run();
  db.prepare('DELETE FROM daily_schedules').run();
  db.prepare("DELETE FROM characters WHERE name = 'sched-char'").run();
  db.prepare(`INSERT INTO characters (name, display_name, base_prompt) VALUES ('sched-char', '测试角色', 'x')`).run();
  const id = db.prepare("SELECT id FROM characters WHERE name = 'sched-char'").get().id;
  const ins = db.prepare(
    'INSERT INTO character_outfits (character_id, name, description, scene, body) VALUES (?, ?, ?, ?, ?)');
  ins.run(id, '全身', 'completely nude, wearing no clothing at all, bare skin visible', 'nude', 'red hair');
  ins.run(id, '日常装', 'a white halter-neck bodice, heels', 'work', 'red hair');
  ins.run(id, '便装', 'casual top and jeans', 'casual', 'red hair');
  ins.run(id, '居家', 'loungewear, indoor slippers', 'home', 'red hair');
  ins.run(id, '睡衣', 'a crimson silk slip nightdress, barefoot', 'sleep', 'red hair');
  db.prepare('INSERT INTO daily_schedules (character_id, schedule_date, schedule_json) VALUES (?, ?, ?)')
    .run(id, getLocalDateKey(), JSON.stringify({ activities }));
  return id;
}

test('★★★ 日程配图按「那一段」选装：睡眠时段必须命中睡衣（用户实报的 bug）', () => {
  const id = seed([
    { startTime: '00:00', endTime: '05:30', activity: '夜间安睡', location: '卧室', replyDelay: -1, outfit: '睡衣' },
    { startTime: '05:30', endTime: '07:00', activity: '晨起梳洗', location: '浴室', replyDelay: 0, outfit: '日常装' },
  ]);
  // 关键：**不依赖当下真实时刻** —— 无论几点跑，这一段都该是睡衣
  const r = svc.getSceneOutfitForActivity(id, { startTime: '00:00', endTime: '05:30', activity: '夜间安睡', replyDelay: -1, outfit: '睡衣' });
  assert.ok(r, '应能取到一套');
  assert.equal(r.scene, 'sleep', '睡眠时段必须命中睡衣那套');
  assert.equal(r.outfit.name, '睡衣');
});

test('★★★ 睡眠判定的依据是 replyDelay=-1（硬规则），不依赖 outfit 标注', () => {
  const id = seed([
    { startTime: '00:00', endTime: '06:00', activity: '夜间安睡', location: '卧室', replyDelay: -1, outfit: null },
    { startTime: '06:00', endTime: '07:00', activity: '晨起', location: '浴室', replyDelay: 0, outfit: '日常装' },
  ]);
  const r = svc.getSceneOutfitForActivity(id, { startTime: '00:00', endTime: '06:00', activity: '夜间安睡', replyDelay: -1, outfit: null });
  assert.equal(r.scene, 'sleep', '即使没标 outfit，睡眠时段也必须是睡衣');
});

test('★★★ 无 outfit 标注的时段要**向前回溯**（日程只在换装那一刻标）', () => {
  // 真实日程长这样：「洗漱换睡衣」标了睡衣，紧接着的「就寝安眠」是 null。
  // 若不回溯，那一段会兜底成日常装 —— 等于把同一个 bug 换个位置又犯一次。
  const id = seed([
    { startTime: '21:00', endTime: '21:30', activity: '洗漱换睡衣', location: '浴室', replyDelay: 0, outfit: '睡衣' },
    { startTime: '21:30', endTime: '23:59', activity: '就寝安眠', location: '卧室', replyDelay: -1, outfit: null },
  ]);
  const r = svc.getSceneOutfitForActivity(id, { startTime: '21:30', endTime: '23:59', activity: '就寝安眠', replyDelay: -1, outfit: null });
  assert.equal(r.scene, 'sleep', '应回溯到「洗漱换睡衣」那一段的睡衣标注');
});

test('★★ 白天时段按标注取对应外出服（不能被"当前时刻"带偏）', () => {
  const id = seed([
    { startTime: '00:00', endTime: '05:30', activity: '夜间安睡', location: '卧室', replyDelay: -1, outfit: '睡衣' },
    { startTime: '05:30', endTime: '07:00', activity: '晨起梳洗更衣', location: '浴室', replyDelay: 0, outfit: '日常装' },
    { startTime: '12:00', endTime: '13:00', activity: '午饭', location: '食堂', replyDelay: 0, outfit: null },
  ]);
  const r = svc.getSceneOutfitForActivity(id, { startTime: '12:00', endTime: '13:00', activity: '午饭', location: '食堂', replyDelay: 0, outfit: null });
  assert.equal(r.scene, 'work', '应回溯到「日常装」而非兜底或当前时刻');
});

test('★★ 该时段自带 outfit 时直接采信（调用方显式指定优先）', () => {
  const id = seed([
    { startTime: '00:00', endTime: '05:30', activity: '夜间安睡', location: '卧室', replyDelay: -1, outfit: '睡衣' },
  ]);
  const r = svc.getSceneOutfitForActivity(id, { startTime: '08:00', endTime: '09:00', activity: '出门', location: '街上', replyDelay: 0, outfit: '便装' });
  assert.equal(r.scene, 'casual', '传了 outfit 就按它选（即使该时段不在今日日程里）');
});

test('★★ 兜底绝不能落到「全身」（否则没标注的时段会光着）', () => {
  const id = seed([
    { startTime: '08:00', endTime: '09:00', activity: '散步', location: '公园', replyDelay: 0, outfit: null },
  ]);
  const r = svc.getSceneOutfitForActivity(id, { startTime: '08:00', endTime: '09:00', activity: '散步', replyDelay: 0, outfit: null });
  assert.notEqual(r.scene, 'nude', '兜底不能是"全身"那套（只用于私密场景）');
});

test('★ 传入空活动时退回"此刻"口径（不炸）', () => {
  const id = seed([
    { startTime: '00:00', endTime: '23:59', activity: '全天', location: '某处', replyDelay: 0, outfit: '日常装' },
  ]);
  assert.doesNotThrow(() => svc.getSceneOutfitForActivity(id, null));
  const r = svc.getSceneOutfitForActivity(id, null);
  assert.ok(r, '无活动参数时应按当前时刻给出结果');
});

test('★ 角色没有场景服装时返回 null（调用方回落原外观）', () => {
  const db = getDb();
  db.prepare('DELETE FROM character_outfits').run();
  db.prepare("DELETE FROM characters WHERE name = 'no-outfit'").run();
  db.prepare(`INSERT INTO characters (name, display_name, base_prompt) VALUES ('no-outfit', '无服装角色', 'x')`).run();
  const id = db.prepare("SELECT id FROM characters WHERE name = 'no-outfit'").get().id;
  assert.equal(svc.getSceneOutfitForActivity(id, { startTime: '00:00', endTime: '01:00', replyDelay: -1 }), null);
});