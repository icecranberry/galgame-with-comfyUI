/**
 * 剧情大纲（「面」）—— 回归测试。
 *
 * 来源：ST 插件「构画」`business/outline/` 逆向移植。
 * 移植的是**纯逻辑层**（解析 / 编辑原文 / 游标 / 注入文本 / 生成合同 / 推进判定语义），
 * **不移植**其宿主适配层（`chat_metadata` 存储、`setExtensionPrompt` 注入、UI）。
 *
 * ★★ 本测试要钉住三条最容易回退的语义：
 *   ① 注入的是"当前阶段 + 隐约方向"，且**明令勿点破**（不是给剧本照念）；
 *   ② 编辑 Beat **不重新序列化**（保留未知字段）；
 *   ③ 空结果**绝不清空**既有大纲（红线 0 / L7）。
 *
 * ⚠ 全部用内存库；不调 LLM（LLM 部分只测"契约与阈值"，不测模型输出质量）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`outline test forbids network: ${url}`); };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');
const svcSrc = fs.readFileSync(path.join(SRC, 'services/story/outlineService.js'), 'utf8');
const routeSrc = fs.readFileSync(path.join(SRC, 'routes/story.js'), 'utf8');

// 迁移在 app.js 里加载；测试不跑 app.js → 显式按同一序列跑一遍
const { loadFeatureMigrations } = await import('../src/db/migrations/index.js');
const { runRegisteredMigrations } = await import('../src/db/migrationRegistry.js');
const { getDb } = await import('../src/db/index.js');
await loadFeatureMigrations();
runRegisteredMigrations(getDb());

const svc = await import('../src/services/story/outlineService.js');

/** 造一份规范的大纲原文（三个完整节点） */
function sampleRaw() {
  const mk = (t, title, line, scene, sub, think) => [
    `Beat: ${t}|${title}|主线|${line}|结果说明`,
    `Scene: ${scene}`,
    `Subtext: ${sub}`,
    `Think: ${think}`,
  ].join('\n');
  return [
    '<outline_widget>',
    mk('第一天', '起风', 'A线', '她接到一封没署名的信', '风起于青萍之末', '为后续冲突埋因'),
    mk('第二天', '对质', 'A线', '两人在天台把话挑明', '话到嘴边又咽下', '关系第一次真正动摇'),
    mk('第三天', '收束', 'A线', '各自回到各自的位置', '往事如烟', '完成一次成长弧'),
    '</outline_widget>',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────
// ① 解析（构画 schema.js 的同口径）
// ─────────────────────────────────────────────────────────

test('★★★ 解析 Beat 五字段 + Scene/Subtext/Think 三段（构画同口径）', () => {
  const beats = svc.parseOutline(sampleRaw());
  assert.equal(beats.length, 3, '应解析出 3 个节点');
  const b = beats[0];
  assert.equal(b.time, '第一天');
  assert.equal(b.title, '起风');
  assert.equal(b.type, '主线');
  assert.equal(b.line, 'A线');
  assert.equal(b.outcome, '结果说明');
  assert.match(b.scene, /没署名的信/);
  assert.match(b.subtext, /青萍之末/);
  assert.match(b.think, /埋因/);
});

test('★★ 八项全空才算"不完整"——必须逐项判定，不能只看有没有 Beat 行', () => {
  const full = svc.parseOutline(sampleRaw())[0];
  assert.equal(svc.isCompleteOutlineBeat(full), true);
  for (const k of ['time', 'title', 'type', 'line', 'outcome', 'scene', 'subtext', 'think']) {
    const broken = { ...full, [k]: '' };
    assert.equal(svc.isCompleteOutlineBeat(broken), false, `缺 ${k} 应判为不完整`);
  }
});

test('★★ 解析要宽容：无 <outline_widget> 包装、带 markdown 装饰（> # * -）也要能读', () => {
  const messy = [
    '> **Beat: 第三天|对峙|主线|B线|摊牌了**',
    '- Scene: 雨夜的车站',
    '* Subtext: 有些话说出口就回不去了',
    '> Think: 把两人的关系推到临界',
  ].join('\n');
  const beats = svc.parseOutline(messy);
  assert.equal(beats.length, 1);
  assert.equal(beats[0].title, '对峙');
  assert.match(beats[0].scene, /雨夜的车站/);
});

test('★★ 坏输入不炸（空串 / 只有 Beat 没有三段 → 解析成功但不完整）', () => {
  assert.deepEqual(svc.parseOutline(''), []);
  assert.deepEqual(svc.parseOutline(null), []);
  const only = svc.parseOutline('Beat: 某天|标题|主线|线|结果');
  assert.equal(only.length, 1);
  assert.equal(svc.isCompleteOutlineBeat(only[0]), false, '缺三段应判不完整');
  assert.deepEqual(svc.parseCompleteOutline('Beat: 某天|标题|主线|线|结果'), [], '不完整的应被筛掉');
});

test('★★ 规范化输出：只保留完整节点，且包回 <outline_widget>（构画 normalizeOutlineResponse）', () => {
  const out = svc.normalizeOutlineResponse(sampleRaw());
  assert.match(out, /^<outline_widget>/);
  assert.match(out, /<\/outline_widget>$/);
  assert.equal(svc.parseCompleteOutline(out).length, 3, '规范化后仍应是 3 个完整节点');
});

// ─────────────────────────────────────────────────────────
// ② 编辑原文（★ 不重新序列化 —— 构画刻意为之）
// ─────────────────────────────────────────────────────────

test('★★★ 改 Scene 必须**保留未知字段与原始包装**（不重新序列化）', () => {
  // 模拟"模型将来多给了一个字段"——重新序列化会把它吃掉
  const withExtra = sampleRaw().replace(
    'Think: 为后续冲突埋因',
    'Think: 为后续冲突埋因\nTone: 克制',
  );
  const r = svc.editOutlineScene(withExtra, 0, '改过的场景描述');
  assert.equal(r.ok, true);
  assert.match(r.raw, /Tone: 克制/, '未知字段必须保留（这是不重新序列化的理由）');
  assert.match(r.raw, /<outline_widget>/, '原始包装必须保留');
  assert.match(r.raw, /Scene: 改过的场景描述/, '新值应写入');
  assert.doesNotMatch(r.raw, /Scene: 她接到一封没署名的信/, '旧值应被替换');
  // 其它节点不受影响
  assert.match(r.raw, /Scene: 两人在天台把话挑明/);
});

test('★ 越界的 Beat 下标：改返回 ok:false，删返回 null（不静默改错节点）', () => {
  const raw = sampleRaw();
  assert.equal(svc.editOutlineScene(raw, 99, 'x').ok, false);
  assert.equal(svc.deleteOutlineBeatFromRaw(raw, 99), null);
  assert.equal(svc.deleteOutlineBeatFromRaw(raw, -1), null);
});

test('★★ 删 Beat 后其余节点完整保留，且包装不破', () => {
  const next = svc.deleteOutlineBeatFromRaw(sampleRaw(), 1);
  const beats = svc.parseOutline(next);
  assert.equal(beats.length, 2, '删一个应剩两个');
  assert.equal(beats[0].title, '起风');
  assert.equal(beats[1].title, '收束', '中间那个应被删掉');
  assert.match(next, /<outline_widget>/);
});

test('★★★ 删 Beat 后游标要回退，不得指到越界处（构画 cursorAfterBeatDelete）', () => {
  assert.equal(svc.cursorAfterBeatDelete(3, 1, 2), 2, '游标在被删节点之后应前移一位');
  assert.equal(svc.cursorAfterBeatDelete(1, 1, 2), 1, '游标指向被删节点时应回到原位');
  assert.equal(svc.cursorAfterBeatDelete(0, 0, 2), 0, '未开始时保持 0');
});

// ─────────────────────────────────────────────────────────
// ③ 注入文本（★ 勿点破 —— 这是整套机制的关键）
// ─────────────────────────────────────────────────────────

test('★★★ 注入文本必须包含「当前节点」与「下个节点」，且**明令勿点破**', () => {
  const beats = svc.parseOutline(sampleRaw());
  const text = svc.buildOutlineInjectionText(beats, 1);
  assert.match(text, /当前节点/, '应给出当前节点');
  assert.match(text, /下个节点/, '应给出下一个节点（作为隐约方向）');
  assert.match(text, /切勿直接引用或点破/, '★ 必须明令"不要点破"——这是与"给剧本照念"的分界');
  // 当前节点内容要带上
  assert.match(text, /起风/);
  // 但**下个节点的 Scene 也要给**（作为方向感）
  assert.match(text, /两人在天台把话挑明/);
});

test('★★ 已在最后一个节点时应提示"可从容收束"，不再给下个节点', () => {
  const beats = svc.parseOutline(sampleRaw());
  const text = svc.buildOutlineInjectionText(beats, beats.length);
  assert.match(text, /已是.*最后.*节点|最后一个节点/);
});

test('★ 游标非法 / 没有节点 → 返回空串（调用方据此不注入）', () => {
  const beats = svc.parseOutline(sampleRaw());
  assert.equal(svc.buildOutlineInjectionText([], 1), '');
  assert.equal(svc.buildOutlineInjectionText(beats, 0), '');
  assert.equal(svc.buildOutlineInjectionText(beats, 99), '');
  assert.equal(svc.buildOutlineInjectionText(null, 1), '');
});

// ─────────────────────────────────────────────────────────
// ④ 存取与清空保护（★ 空结果绝不清空）
// ─────────────────────────────────────────────────────────

test('★★★ 保存后能读回；空/不完整结果**必须抛错而不是清空**（红线 0）', () => {
  const saved = svc.saveOutline({ raw: sampleRaw(), basisNote: '测试' });
  assert.equal(saved.beatCount, 3);
  assert.equal(saved.cursor, 1, '首次保存游标应为 1');
  assert.ok(svc.getOutline(), '应能读回');

  // ★ 关键：拿一份"没有任何完整节点"的内容去保存 → 抛错，且旧大纲仍在
  assert.throws(() => svc.saveOutline({ raw: '<outline_widget>\nBeat: 半截|标题\n</outline_widget>' }),
    /没给出可用的大纲节点/);
  assert.equal(svc.getOutline().beatCount, 3, '失败后旧大纲必须完好');
  assert.throws(() => svc.saveOutline({ raw: '' }), /没给出可用/);
});

test('★★ 游标可改且被夹在 [0, beatCount]（越界不炸）', () => {
  svc.saveOutline({ raw: sampleRaw() });
  assert.equal(svc.setOutlineCursor(2).cursor, 2);
  assert.equal(svc.setOutlineCursor(999).cursor, 3, '超过节点数应夹到末尾');
  assert.equal(svc.setOutlineCursor(-5).cursor, 0, '负数应夹到 0');
  assert.equal(svc.setOutlineCursor(1).cursor, 1);
});

test('★★★ 人工锁定后**不自动推进**（构画的人工锁线保护，同一取向）', async () => {
  svc.saveOutline({ raw: sampleRaw() });
  svc.setOutlineCursor(1);
  svc.setOutlinePin(true);
  const r = await svc.judgeOutlineAdvance({ recentText: '随便什么正文' });
  assert.equal(r.advanced, false);
  assert.match(r.reason, /锁定/);
  assert.equal(r.cursor, 1, '锁定期间游标不得被改动');
  svc.setOutlinePin(false);
});

test('★★ 已在最后一个节点时**不发起判定**（直接返回，省一次 LLM 调用）', async () => {
  svc.saveOutline({ raw: sampleRaw() });
  svc.setOutlinePin(false);
  svc.setOutlineCursor(3);
  const r = await svc.judgeOutlineAdvance({ recentText: '正文' });
  assert.equal(r.advanced, false);
  assert.match(r.reason, /最后/);
});

test('★ 没有正文可判定时不推进（不瞎猜）', async () => {
  svc.saveOutline({ raw: sampleRaw() });
  svc.setOutlineCursor(1);
  const r = await svc.judgeOutlineAdvance({ recentText: '   ' });
  assert.equal(r.advanced, false);
  assert.match(r.reason, /没有可判定/);
});

test('★ 改 Scene / 删节点走库后状态一致（raw 与 beat_json 同步）', () => {
  svc.saveOutline({ raw: sampleRaw() });
  const a = svc.updateBeatScene(0, '新的场景');
  assert.match(a.beats[0].scene, /新的场景/);
  const b = svc.deleteBeat(0);
  assert.equal(b.beatCount, 2, '删后应剩 2 个');
  assert.equal(b.beats[0].title, '对质');
});

test('★ 清空是显式操作（不与"保存空值"混淆）', () => {
  svc.saveOutline({ raw: sampleRaw() });
  assert.ok(svc.getOutline());
  svc.clearOutline();
  assert.equal(svc.getOutline(), null);
});

// ─────────────────────────────────────────────────────────
// ⑤ 路由与注入接线（静态断言）
// ─────────────────────────────────────────────────────────

test('★★★ 路由：/outline 系列已注册，且沿用约定式挂载', () => {
  for (const p of [
    "router.get('/outline'", "router.post('/outline/generate'", "router.put('/outline'",
    "router.put('/outline/cursor'", "router.put('/outline/pin'",
    "router.put('/outline/beats/:index'", "router.delete('/outline/beats/:index'",
    "router.post('/outline/advance'",
  ]) {
    assert.ok(routeSrc.includes(p), `缺少路由 ${p}`);
  }
  assert.match(routeSrc, /export default router/, '仍应默认导出 Router（约定式挂载前提）');
});

test('★★★ 注入必须放在动态层且**受开关控制**（绝不许进共享常量吃前缀缓存）', () => {
  const chatSrc = fs.readFileSync(path.join(SRC, 'routes/chat.js'), 'utf8');
  assert.match(chatSrc, /config\.features\.storyOutline/, '注入必须受开关控制（默认关）');
  assert.match(chatSrc, /dynamicBlocks\.push\(`<story_outline>/, '必须 push 进 dynamicBlocks（动态层）');
  // ★ 注入文本不得出现在 scheduleInst 那个跨角色共享常量里
  const genSrc = fs.readFileSync(path.join(SRC, 'services/scheduleGenerator.js'), 'utf8');
  assert.ok(!/story_outline/.test(genSrc), '大纲注入不得进入 scheduleGenerator 的共享常量');
});

test('★★ 开关默认关（红线 4：长驻功能默认关）+ 三处口径一致', () => {
  const cfg = fs.readFileSync(path.join(SRC, 'config.js'), 'utf8');
  const seed = fs.readFileSync(path.join(SRC, 'db/seedData.js'), 'utf8');
  assert.match(cfg, /storyOutline: process\.env\.FEATURE_STORY_OUTLINE === 'true'/, 'config 默认应为关');
  assert.match(seed, /feature_storyOutline: 'false'/, 'seedData 默认应为关（三处同步）');
  // ⚠ 开关的判断归 config / 路由层；**服务层不应自己读 env**
  //   （否则"三处同步"就变成四处，改一处漏三处）
  assert.ok(!/process\.env\.FEATURE_STORY_OUTLINE/.test(svcSrc),
    '服务层不应自己读 env —— 开关由 config 统一裁决');
});

test('★ 生成与判定都**只出草稿/只动游标**，不越权写库', () => {
  const genBody = svcSrc.slice(
    svcSrc.indexOf('export async function generateOutlineDraft'),
    svcSrc.indexOf('export async function judgeOutlineAdvance'),
  );
  const code = genBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/saveOutline\s*\(/.test(code), '生成函数不得自己落库（由调用方决定）');
  assert.ok(!/INSERT\s+INTO/i.test(code), '生成函数不得直接 INSERT');
});