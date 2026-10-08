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

// ─────────────────────────────────────────────────────────
// ⑦ 字段化编辑器（2026-10-07 用户口径：生成模块照「新建事件线」做）
//
//    用户实报「大纲生成我不是很满意」，要求改成**字段化表单**——
//    节点逐字段可改、可增删、可单独重写，确认后才保存。
//    随之而来的核心风险是：字段化编辑会**丢掉模型原本的字段包装**。
//    下面这几条专钉"未改动节点必须逐字节保留"。
// ─────────────────────────────────────────────────────────

test('★★★ splitOutlineRaw：切开包装与各节点原文块，且能原样拼回（逐字节一致）', () => {
  const raw = sampleRaw();
  const { prefix, suffix, blocks, separator } = svc.splitOutlineRaw(raw);
  assert.equal(blocks.length, 3, '应切出 3 个节点块');
  assert.ok(/<outline_widget/.test(prefix), '前缀应含开标签');
  assert.ok(/<\/outline_widget>/.test(suffix), '后缀应含闭标签');
  assert.ok(separator.length > 0, '必须给出块间原始分隔符（否则拼回整串不可能逐字节一致）');
  // ★ 未改动的节点原样回传 → 拼回结果必须与原文**逐字节一致**
  assert.equal(svc.composeOutlineRaw(prefix, suffix, blocks, separator), raw,
    '未改动任何节点时，拼回结果必须与原文逐字节一致（否则会吃掉模型给的未知字段）');
});

test('★★★ 只改一个节点：其余节点必须**逐字节保留**，不得被重新序列化', () => {
  const raw = sampleRaw();
  const { prefix, suffix, blocks } = svc.splitOutlineRaw(raw);
  // 第二个节点补一个"模型将来可能多给的未知字段"，看它能不能活下来
  const withExtra = blocks[1] + '\nMood: 这是模型多给的一个字段';
  const texts = [blocks[0], withExtra, blocks[2]];
  const out = svc.composeOutlineRaw(prefix, suffix, texts);
  assert.ok(out.includes('Mood: 这是模型多给的一个字段'),
    '未改动节点的未知字段必须保留 —— 这是"不重新序列化"的落点');
  // 解析层只看已知字段，未知行被宽容忽略（不该炸）
  const beats = svc.parseCompleteOutline(out);
  assert.equal(beats.length, 3, '多一个未知字段不应破坏解析');
});

test('★★ 改动过的节点按字段重新序列化：竖线与换行必须被处理（否则解析错位）', () => {
  const beat = {
    time: '第1天', title: '含|竖线', type: '冲突', line: 'A线',
    outcome: '结果', scene: '第一行\n第二行', subtext: '题记', think: '理由',
  };
  const text = svc.serializeOutlineBeat(beat);
  // 竖线会破坏 `time|title|type|line|outcome` 分段 → 必须替换成全角
  assert.ok(!/含\|竖线/.test(text), '字段内的半角竖线必须被替换（否则 Beat 分段错位）');
  const parsed = svc.parseOutline(`<outline_widget>\n${text}\n</outline_widget>`)[0];
  assert.equal(parsed.title, '含／竖线', '竖线应被替换成全角斜杠');
  assert.equal(parsed.scene, '第一行 第二行', 'Scene 内的换行必须压成空格（否则下一行会被当成新段落行）');
  assert.ok(svc.isCompleteOutlineBeat(parsed), '八项齐全的节点应被识别为有效节点');
});

test('★★★ saveOutlineFromEditor：未改动给 raw / 改动给 value / 空项 = 删除节点', () => {
  const raw = sampleRaw();
  const { prefix, suffix, blocks } = svc.splitOutlineRaw(raw);
  // 第 2 个节点被改过（只改了标题），第 3 个被删（空项）
  const items = [
    { raw: blocks[0] },
    { value: { ...svc.parseOutline(blocks[1])[0], title: '改过的标题' } },
    { raw: '' },
  ];
  const out = svc.saveOutlineFromEditor({ prefix, suffix, items });
  assert.equal(out.beatCount, 2, '空项应被视为删除该节点');
  assert.equal(out.beats[0].title, svc.parseOutline(blocks[0])[0].title, '未改动节点内容不得变化');
  assert.equal(out.beats[1].title, '改过的标题', '改动过的节点应取新值');
});

test('★★★ 字段化编辑器里一个节点都不剩 → **必须抛错**，不得把旧大纲清成空（红线 0）', () => {
  assert.throws(() => svc.saveOutlineFromEditor({ prefix: '', suffix: '', items: [] }),
    /至少要保留一个节点/, '空 items 不是"清空"，应抛错保留原状');
  assert.throws(() => svc.saveOutlineFromEditor({ items: [{ raw: '' }, { raw: '   ' }] }),
    /至少要保留一个节点/, '全是空块同样应抛错');
});

test('★★ 用来路不明的碎片拼不出有效节点时，saveOutline 兜底抛错（双层保险）', () => {
  // 只有一个 Beat 行、没有 Scene/Subtext/Think → 不完整 → 有效节点数为 0
  const out = (() => {
    try { return svc.saveOutlineFromEditor({ items: [{ raw: 'Beat: 第一天|标题|类型|线|结果' }] }); }
    catch (err) { return err; }
  })();
  assert.ok(out instanceof Error, '不完整节点拼出来也保存不了 → 必须抛错');
  assert.match(out.message, /没给出可用的大纲节点/, '错误信息要说清是"没有可用节点"');
});

test('★★★ 细化节点：只动一个节点、不动其他节点、游标不变、且**不落库**', () => {
  // ⚠ 2026-10-08：原先用"到下一个分节标题"切片，但该锚点文案随上游更新而变
  //   （「五、推进判定」→「五、推进判定（移植构画 …）」），切片会越界到 setOutlineCursor
  //   的**定义处**而误报。改为直接取函数体本身 —— 判据不变，但不再依赖外部文案。
  const _start = svcSrc.indexOf('export async function refineOutlineBeat');
  assert.ok(_start >= 0, '应有 refineOutlineBeat 函数');
  const _endRel = svcSrc.slice(_start + 1).search(/\r?\n\}\r?\n/);
  assert.ok(_endRel > 0, '应能定位函数结尾');
  const refineBody = svcSrc.slice(_start, _start + 1 + _endRel + 3);
  const code = refineBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/saveOutline\s*\(/.test(code), '细化不得自己落库（只回草稿，由前端确认后保存）');
  assert.ok(!/setOutlineCursor/.test(code), '细化不得改游标（用户可能已经手定位了）');
  assert.match(refineBody, /serializeOutlineBeat/, '应把原节点与相邻节点一起交给模型（否则与上下文脱节）');
  assert.match(refineBody, /beats\[0\]/, '只取模型返回的第一个节点');
});

test('★★ 细化必须校验下标（越界 / 没有大纲都要明确报错，不静默返回空）', () => {
  assert.match(svcSrc, /要细化的节点不存在/, '越界下标要有明确错误');
  assert.match(svcSrc, /还没有大纲，先生成一份再来细化/, '没有大纲时要有明确错误');
});

test('★★★ 字段化编辑器的取数必须给出原文块（否则"逐字节保留"无从谈起）', () => {
  assert.match(svcSrc, /export function getOutlineForEditor/, '应导出编辑器取数函数');
  assert.match(svcSrc, /splitOutlineRaw\(cur\.raw\)/, '编辑器载荷必须来自原文切块');
  for (const k of ['prefix', 'suffix', 'blocks']) {
    assert.ok(new RegExp(`${k}\\s*[,:]`).test(svcSrc.slice(svcSrc.indexOf('getOutlineForEditor'))),
      `编辑器载荷必须包含 ${k}`);
  }
});

test('★★ 新增的字段化路由已注册（editor 取数 / 保存 / 单节点细化）', () => {
  for (const p of [
    "router.get('/outline/editor'", "router.put('/outline/editor'",
    "router.post('/outline/beat/refine'",
  ]) {
    assert.ok(routeSrc.includes(p), `缺少路由 ${p}`);
  }
  // ⚠ `/outline/editor` 必须声明在 `/outline` 之前吗？路径不同其实不冲突，
  //   但生成路由要能带上上下文（participantIds/places）—— 用源码钉住这点。
  assert.match(routeSrc, /generateOutlineDraft\(req\.body \|\| \{\}\)/, '生成路由应透传整个 body（含角色/地点上下文）');
});

test('★★ 生成与细化都要把「用户选的角色/地点」带给模型（与「新建事件线」同构）', () => {
  assert.match(svcSrc, /listParticipantOptions|listPlaceOptions/,
    '角色/地点候选必须取事件线那边的唯一真源（红线 8：同一口径只留一份定义）');
  assert.match(svcSrc, /【本次涉及角色/, '应把已选角色作为上下文块喂给模型');
  assert.match(svcSrc, /【本次涉及地点/, '应把已选地点作为上下文块喂给模型');
  // 用户没给地点时才补"可用地名清单"，给了就不干扰
  assert.match(svcSrc, /if \(!placeList\.length\)/, '仅在用户未指定地点时才给候选地名');
});