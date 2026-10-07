/**
 * 角色日记：prompt 分层 / 输出解析 / 朋友圈随机横竖分辨率 / 一天一篇的覆盖语义。
 *
 * 遵循 docs/testing.md：内存库 + 网络禁用（LLM 必然失败），不碰用户真实存档。
 * 「一天一篇」的覆盖路径正好可以借 LLM 失败来跑：失败也会把当日那行从 generating 收敛成 failed，
 * 于是可以在不 mock LLM 的前提下断言「同日只留一行、历史日期原样保留」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };

const { config } = await import('../src/config.js');
config.dbPath = ':memory:';
// fetch 拦不住 OpenAI SDK 自带的 undici 连接，这里把 LLM 指到一个没人监听的本地端口，
// 让「生成必然失败」既快又完全不产生真实网络请求（代价约 3s 退避）。
config.llm.freeEgg = false;
config.llm.baseURL = 'http://127.0.0.1:9/';
config.llm.apiKey = 'diary-test-key';

const { getDb, closeDb } = await import('../src/db/index.js');
const diary = await import('../src/services/diaryGenerator.js');
const editTasks = await import('../src/services/imageEditTasks.js');
const { getLocalDateKey } = await import('../src/utils/localDate.js');

process.on('exit', () => { try { closeDb(); } catch {} });

const db = getDb();

let seq = 0;
function seedCharacter(extra = {}) {
  seq += 1;
  const name = `diary_test_${seq}`;
  const info = db.prepare(`
    INSERT INTO characters (name, display_name, base_prompt, short_prompt, handwriting_font)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    name,
    extra.display_name || `测试角色${seq}`,
    extra.base_prompt || '你是深海里的灯塔看守人，话少，喜欢在夜里记录星象。',
    extra.short_prompt || '灯塔看守人',
    extra.handwriting_font ?? 'lxgw_wenkai',
  );
  return Number(info.lastInsertRowid);
}

// ── 纯函数：日程文本 ──

test('formatScheduleForDiary 把当日快照写成 LLM 可读的时间线', () => {
  const text = diary.formatScheduleForDiary([
    { startTime: '07:30', endTime: '08:20', activity: '煮咖啡', location: '厨房', description: '磨豆机又卡住了' },
    { startTime: '09:00', endTime: '12:00', activity: '值班', location: '灯塔', description: '' },
  ]);
  const lines = text.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^07:30-08:20 在【厨房】煮咖啡 —— 磨豆机又卡住了$/);
  assert.match(lines[1], /^09:00-12:00 在【灯塔】值班$/);
  assert.match(diary.formatScheduleForDiary([]), /没有安排/);
});

// ── 纯函数：输出解析 ──

test('normalizeDiaryPayload 补齐 / 裁剪到 3 条配图 prompt，缺正文直接判失败', () => {
  const few = diary.normalizeDiaryPayload({ content: '今天下雨。', imagePrompts: ['only one english prompt'] });
  assert.equal(few.imagePrompts.length, 3);
  assert.equal(few.imagePrompts[0], 'only one english prompt');
  assert.ok(few.imagePrompts[1] && few.imagePrompts[2]);
  assert.equal(few.title, '无题');

  const many = diary.normalizeDiaryPayload({
    content: '正文',
    imagePrompts: ['a', 'b', 'c', 'd'],
  });
  assert.deepEqual(many.imagePrompts, ['a', 'b', 'c']);

  assert.equal(diary.normalizeDiaryPayload({ content: '   ' }), null);
  assert.equal(diary.normalizeDiaryPayload(null), null);
});

test('parseDiaryJSON 容忍代码块 / 夹杂文字，全部失败时返回 null', () => {
  const fenced = diary.parseDiaryJSON('```json\n{"title":"标题","mood":"平静","weather":"雨","content":"正文一段","imagePrompts":["p1","p2","p3"]}\n```');
  assert.equal(fenced.title, '标题');
  assert.equal(fenced.imagePrompts.length, 3);

  const noisy = diary.parseDiaryJSON('好的，这是日记：{"content":"正文","imagePrompts":["a"]} 希望你喜欢。');
  assert.equal(noisy.content, '正文');

  assert.equal(diary.parseDiaryJSON('完全不是 JSON'), null);
  assert.equal(diary.parseDiaryJSON(''), null);
});

// ── 纯函数：朋友圈参数下的随机横竖分辨率 ──

test('pickDiaryResolution 横竖各半，宽高取朋友圈参数', () => {
  const landscape = diary.pickDiaryResolution(() => 0.1);
  const portrait = diary.pickDiaryResolution(() => 0.9);
  const w = Number(config.comfyui.momentsWidth);
  const h = Number(config.comfyui.momentsHeight);
  assert.deepEqual(landscape, { width: w, height: h });
  assert.deepEqual(portrait, { width: h, height: w });
});

// ── prompt 分层（AGENTS.md 高缓存契约） ──

test('buildDiaryMessages 分层：静态前缀逐字节稳定，变量（人格 / 日程）在后、user 收尾', () => {
  const charA = { id: 1, base_prompt: '角色A的人格', short_prompt: 'A' };
  const charB = { id: 2, base_prompt: '角色B的人格', short_prompt: 'B' };

  const msgsA = diary.buildDiaryMessages({ character: charA, dateKey: '2026-10-07', scheduleText: '08:00-09:00 在【家】起床' });
  const msgsB = diary.buildDiaryMessages({ character: charB, dateKey: '2026-11-20', scheduleText: '10:00-12:00 在【码头】卸货' });

  assert.equal(msgsA[0].role, 'system');
  assert.equal(msgsA.at(-1).role, 'user');
  assert.equal(msgsA.length, msgsB.length);

  // 人格层是第一个「随调用变化」的层，它之前的全部是静态前缀
  const personaIdx = msgsA.findIndex(m => m.content.includes('角色A的人格'));
  const scheduleIdx = msgsA.findIndex(m => m.content.includes('08:00-09:00 在【家】起床'));
  assert.ok(personaIdx >= 2, '静态层（破甲/世界观/任务规范）必须在人格层之前');
  assert.equal(scheduleIdx, personaIdx + 1, '日程层紧跟人格层');

  for (let i = 0; i < personaIdx; i += 1) {
    assert.equal(msgsA[i].content, msgsB[i].content, `静态层 #${i} 不应随角色/日期变化`);
  }

  // 静态任务层必须写清日记口吻 + 完整 JSON 示例（AGENTS.md「LLM 输出」）
  const taskLayer = msgsA.slice(0, personaIdx).map(m => m.content).join('\n');
  assert.match(taskLayer, /日记/);
  assert.match(taskLayer, /imagePrompts/);
  assert.match(taskLayer, /"title"/);
  assert.match(taskLayer, /"content"/);
  assert.match(taskLayer, /严格按示例格式输出/);
  assert.doesNotMatch(taskLayer, /\d{4}-\d{2}-\d{2}/, '静态层不得内插日期');
  assert.doesNotMatch(taskLayer, /角色[AB]/, '静态层不得内插角色信息');

  // 人格层随角色变化，日程层随日期/日程变化
  assert.notEqual(msgsA[personaIdx].content, msgsB[personaIdx].content);
  assert.match(msgsB[scheduleIdx].content, /2026-11-20/);
  assert.match(msgsB[scheduleIdx].content, /10:00-12:00 在【码头】卸货/);
});

// ── 一天一篇 + 覆盖语义（借 LLM 失败跑通落库路径） ──

function diaryRow(characterId, dateKey) {
  return db.prepare('SELECT * FROM character_diaries WHERE character_id = ? AND diary_date = ?').get(characterId, dateKey);
}

async function waitForSettle(characterId, dateKey, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    const row = diaryRow(characterId, dateKey);
    if (row && row.status !== 'generating' && !diary.isDiaryGenerating(characterId, dateKey)) return row;
    if (Date.now() - start > timeoutMs) throw new Error('diary generation did not settle in time');
    await new Promise(r => setTimeout(r, 100));
  }
}

test('同日多次生成只保留一行并覆盖，历史日期原样保留；同时挂上右下角生成提示', async () => {
  const characterId = seedCharacter();
  const today = getLocalDateKey();
  const yesterday = getLocalDateKey(new Date(Date.now() - 86400000));

  // 昨天已写过的一篇（历史）与今天旧的一篇（将被覆盖）
  db.prepare(`INSERT INTO character_diaries (character_id, diary_date, title, content, images, status)
    VALUES (?, ?, '昨天', '昨天的正文', '["/images/diary/old.png"]', 'completed')`).run(characterId, yesterday);
  db.prepare(`INSERT INTO character_diaries (character_id, diary_date, title, content, status)
    VALUES (?, ?, '今天旧稿', '今天旧的正文', 'completed')`).run(characterId, today);

  const first = diary.startDiaryGeneration(characterId);
  assert.equal(first.started, true);
  assert.equal(first.date, today);
  assert.equal(first.generating, true);
  // 旧正文先留着（前端可以继续显示上一版），状态转成 generating
  assert.equal(first.diary.content, '今天旧的正文');
  assert.equal(first.diary.status, 'generating');

  // 同键在途 → 不重复起任务
  const second = diary.startDiaryGeneration(characterId);
  assert.equal(second.started, false);
  assert.equal(second.generating, true);

  // 右下角生成提示：复用 image_edit_task_* 通道的被动型任务
  const task = editTasks.listEditTasks().find(t => t.action === 'diary' && t.meta?.characterId === characterId);
  assert.ok(task, '日记生成应挂上右下角生成提示的后台任务');
  assert.equal(task.status, 'running');
  assert.equal(task.meta.date, today);
  assert.equal(editTasks.getEditTask(task.id).token, task.token);

  const settled = await waitForSettle(characterId, today);
  assert.equal(settled.status, 'failed', '网络被禁用时日记生成应落到 failed');
  assert.ok(settled.error_message, '失败要留下原因');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM character_diaries WHERE character_id = ? AND diary_date = ?')
    .get(characterId, today).n, 1, '同一天只允许留一行');

  const history = diaryRow(characterId, yesterday);
  assert.equal(history.status, 'completed');
  assert.equal(history.content, '昨天的正文');

  // 历史简目只收完成的日记，且最新在前
  const list = diary.listDiaries(characterId);
  assert.equal(list.length, 1);
  assert.equal(list[0].date, yesterday);
  assert.equal(list[0].cover, '/images/diary/old.png');

  const failedTask = editTasks.getEditTask(task.id);
  assert.equal(failedTask.status, 'failed');
  assert.ok(failedTask.error);
});

test('startDiaryGeneration 对不存在的角色抛 404', () => {
  assert.throws(() => diary.startDiaryGeneration(999999), (err) => err.status === 404);
});

test('getDiary 对没有日记的日期返回 null，DTO 带齐前端渲染字段', () => {
  const characterId = seedCharacter();
  assert.equal(diary.getDiary(characterId, '2020-01-01'), null);

  db.prepare(`INSERT INTO character_diaries
    (character_id, diary_date, title, mood, weather, content, images, resolutions, handwriting_font, status)
    VALUES (?, '2026-10-07', '标题', '平静', '小雨', '正文', '["/images/diary/a.png"]', '["1600x1200"]', 'lxgw_wenkai', 'completed')`)
    .run(characterId);

  const dto = diary.getDiary(characterId, '2026-10-07');
  assert.equal(dto.title, '标题');
  assert.equal(dto.mood, '平静');
  assert.equal(dto.weather, '小雨');
  assert.deepEqual(dto.images, ['/images/diary/a.png']);
  assert.deepEqual(dto.resolutions, ['1600x1200']);
  assert.equal(dto.handwriting_font, 'lxgw_wenkai');
  assert.equal(dto.date, '2026-10-07');
  assert.ok(dto.character_name, 'DTO 应带角色名，日记本顶栏直接可用');
});
