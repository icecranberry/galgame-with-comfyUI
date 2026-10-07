/**
 * 世界观项目库 + 引擎反实例化 —— 回归测试。
 *
 * 背景（2026-10-07 用户裁定）：
 *   我把二相乐园的「幻造种不是每日仪式」写进了 `scheduleGenerator.js` 的公共提示词，
 *   而邻舍不是单一世界观项目。全量审计发现同类问题 244 处。
 *   用户裁定：**新建世界观时建立独立项目库**，引擎只读取、不内置。
 *
 * 本测试守三件事：
 *  ① 项目库机制本身（缺库回落中性、不抛错；读坏留痕；不用 slug 当身份）；
 *  ② **引擎不再内置具体世界观知识**（禁用词表护栏 —— 这是防复发的关键）；
 *  ③ 存量行为不变（没有项目库时，注入结果与"没有这套机制"一致）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`world project test forbids network: ${url}`); };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');
const AGENT_CORE = path.resolve(__dirname, '..');

const lib = await import('../src/services/worldProjectLibrary.js');
const {
  neutralProject, slugForWorld, readProject, writeProject, scaffoldProject,
  guessSlotsFromContent, projectDirFor, PROJECT_SLOTS,
} = lib;

// ─────────────────────────────────────────────────────────
// ① 项目库机制
// ─────────────────────────────────────────────────────────

test('★ 缺项目库 → 中性回落，且 exists=false（存量常态，不是异常）', () => {
  const p = readProject('__definitely_missing__');
  assert.equal(p.exists, false);
  assert.deepEqual(p.ambienceSections, []);
  assert.deepEqual(p.lexicons, []);
  assert.deepEqual(p.vocabHints, []);
});

test('★ slug 非空且不含路径分隔符（防目录穿越）', () => {
  for (const [name, id] of [['崩坏星穹铁道', 1], ['武装JK世界', 14], ['A/B:C', 9], ['', 3]]) {
    const s = slugForWorld(name, id);
    assert.ok(s.length > 0, `${name} 应能生成 slug`);
    assert.ok(!s.includes('/') && !s.includes('\\'), `slug 不得含路径分隔符: ${s}`);
    assert.match(s, /^[a-z0-9-]+$/i, `slug 只允许字母数字与连字符: ${s}`);
  }
});

test('★ slug 稳定：同 (id, name) 反复调用结果一致（重复建库不会散落目录）', () => {
  assert.equal(slugForWorld('崩坏星穹铁道', 1), slugForWorld('崩坏星穹铁道', 1));
});

test('★ 同名不同 id → slug 不同（改名/重建不撞车）', () => {
  assert.notEqual(slugForWorld('同名', 1), slugForWorld('同名', 2));
});

test('★★ 中性项目必须覆盖全部槽位（漏一个 = 存量世界观拿到 undefined）', () => {
  const n = neutralProject();
  for (const key of Object.keys(PROJECT_SLOTS)) {
    assert.ok(key in n, `neutralProject() 缺槽位 ${key} —— 存量世界观会拿到 undefined，行为分叉`);
  }
});

test('★ 写入后可回读；数组槽位被归一为数组（手工编辑写成别的类型不该炸）', () => {
  const slug = '__test_write__';
  try {
    writeProject(slug, { ambienceSections: ['A'], lexicons: [], vocabHints: [], notes: 'x' });
    assert.deepEqual(readProject(slug).ambienceSections, ['A']);

    // 人为写坏类型
    const f = path.join(projectDirFor(slug), 'project.json');
    fs.writeFileSync(f, JSON.stringify({ ambienceSections: '不是数组', lexicons: null }), 'utf8');
    const p = readProject(slug);
    assert.deepEqual(p.ambienceSections, [], '字符串应被归一为空数组');
    assert.deepEqual(p.lexicons, []);
  } finally {
    fs.rmSync(projectDirFor(slug), { recursive: true, force: true });
  }
});

test('★ project.json 解析失败 → 回落中性 + **warn 留痕**（不静默吞）', () => {
  const slug = '__test_broken__';
  try {
    fs.mkdirSync(projectDirFor(slug), { recursive: true });
    fs.writeFileSync(path.join(projectDirFor(slug), 'project.json'), '{ 这不是 json', 'utf8');
    const warns = [];
    const p = readProject(slug, { logger: { warn: (...a) => warns.push(a.join(' ')) } });
    assert.equal(p.exists, false, '坏文件应回落中性');
    assert.equal(warns.length, 1, '必须留痕，不能装看不见');
    assert.match(warns[0], /解析失败/);
  } finally {
    fs.rmSync(projectDirFor(slug), { recursive: true, force: true });
  }
});

test('★ scaffoldProject 幂等：已存在时不覆盖用户改动', () => {
  const slug = slugForWorld('__幂等测试__', 999);
  try {
    const { dir } = scaffoldProject({ name: '__幂等测试__', id: 999, content: 'v1' });
    writeProject(slug, { ...neutralProject(), ambienceSections: ['用户改过'] });
    scaffoldProject({ name: '__幂等测试__', id: 999, content: 'v2' });
    assert.deepEqual(readProject(slug).ambienceSections, ['用户改过'], '不该覆盖用户改过的槽位');
    assert.ok(fs.existsSync(path.join(dir, 'world.md')));
  } finally {
    fs.rmSync(projectDirFor(slug), { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────
// ② 猜测槽位：宁少勿多
// ─────────────────────────────────────────────────────────

test('★★ 猜测只认「人们的行为」，且必须真的存在于正文里', () => {
  const withSection = '## 世界背景\nx\n## 人们的行为\n- 例句\n## 日常规则\n- 规则\n';
  assert.deepEqual(guessSlotsFromContent(withSection).ambienceSections, ['人们的行为']);

  const without = '## 世界背景\nx\n## 日常规则\n- 规则\n';
  assert.deepEqual(guessSlotsFromContent(without).ambienceSections, [], '没有该节就不猜');
});

test('★★ 混合节（含规则/事实/画面指令）**不猜** —— 猜错的代价是静默丢内容', () => {
  // 「日常规则」实测含生图硬约束；「社会基调」实测含事实陈述
  const mixed = '## 日常规则\n- 男器整根画进画面\n## 社会基调\n- 愿宝是数字虚拟货币\n';
  assert.deepEqual(guessSlotsFromContent(mixed).ambienceSections, [],
    '混合节必须交给人裁定，引擎不得替它决定');
});

// ─────────────────────────────────────────────────────────
// ③ ★★ 引擎禁用词表 —— 防复发的核心护栏
// ─────────────────────────────────────────────────────────

/**
 * 引擎文件里**不允许出现**的世界观专有名词。
 *
 * 判据不是"出现了就是错"，而是"出现了 → 必须显式豁免并说明理由"。
 * 之所以要这条护栏：写提示词时"具体例子"比"抽象规则"好写得多，
 * 于是会顺手把某个世界的专名写进引擎 —— 换世界观后那段规则就是错的，
 * 而且**静态检查、构建、既有测试全都不报错**（这正是本次事故的成因）。
 */
const BANNED_TERMS = [
  // 崩坏星穹铁道 / 二相乐园
  '二相乐园', '二维市', '鸽川', '绘世学院', '幻造种', '愿宝', '花愿宝', '珠星', '海原电视塔',
  '幻月秘庭', '星际和平公司', '馋嘴胡同', '滨河道', '旧仓段', '娱乐广场', '世界尽头酒馆',
  '欢愉酒馆', '嬉步街', '喜悲街', '喜笑区', '悲泣区', '泊地站', '旧川里', '谒者', '假面愚者',
  // 少女与战车
  '战车道', '学园舰', '西住', '岛田', '黑森峰',
  // 武装JK世界
  '风纪委员',
];

/** 允许出现的地带：数据文件、种子、词库、以及本测试自身 */
const ALLOW_PATH = [
  /[\\/]data[\\/]/,            // 词库/数据（sexPositions、galleryEnvironment、yaml…）
  /seed[A-Z]/,                 // 种子数据（可编辑）
  /worldProjectLibrary\.js$/,  // 项目库机制自身会举例
  /\.test\.js$/,               // 测试文件
  /[\\/]public[\\/]/,          // 构建产物
];

/** 显式豁免：`// @world-agnostic-ok: 理由` —— 用于注释里的实测记录 */
const EXEMPT_MARK = '@world-agnostic-ok';

function walkJs(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJs(p, acc);
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

test('★★★ 引擎文件不得内置任何世界观专有名词（除非显式豁免）', () => {
  const files = walkJs(path.join(AGENT_CORE, 'src'), [])
    .concat([path.join(AGENT_CORE, 'app.js')])
    .filter(f => !ALLOW_PATH.some(re => re.test(f)));

  const offenders = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.includes(EXEMPT_MARK)) return;   // 本行已声明豁免

      // ★ 判据只盯「代码与提示词文本」，**不盯注释**：
      //   注释是文档（本项目有大量实测记录，写具体地名恰恰更有说服力），
      //   风险在会被拼进 prompt 或参与判断的**正文**里。
      //   纯注释行（// 或 JSDoc 的 * 开头）跳过 —— 否则真实信号会被淹没在记录里。
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;

      for (const t of BANNED_TERMS) {
        if (line.includes(t)) {
          offenders.push(`${path.relative(AGENT_CORE, file).replace(/\\/g, '/')}:${i + 1} 含「${t}」`);
        }
      }
    });
  }

  assert.deepEqual(
    offenders, [],
    `引擎正文里出现了世界观专有名词（换世界观后这些内容就是错的）：\n  ${offenders.join('\n  ')}\n` +
    `\n→ 修法：① 改为通用表述；② 从数据层/项目库读取；③ 确属必要的，行尾加「// ${EXEMPT_MARK}: 理由」`
  );
});

test('★★ 护栏本身有效：故意在一个非注释行塞入专名必须被抓到', () => {
  // 防"护栏写错导致永远绿"：直接验证判据函数
  const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);
  assert.equal(isComment('        // 实测：鸽川区…'), true, '行注释应被跳过');
  assert.equal(isComment(' * 例如「幻造种」'), true, 'JSDoc 应被跳过');
  assert.equal(isComment("  const x = '鸽川区';"), false, '代码行不得跳过');
  assert.equal(isComment('  地点只能写：二维市、绘世学院等。'), false, '提示词正文不得跳过');
});

test('★★ 调度提示词（scheduleInst）不含任何世界观专名 —— 这是本次事故的现场', () => {
  const sg = fs.readFileSync(path.join(SRC, 'services/scheduleGenerator.js'), 'utf8');
  // 取 scheduleInst 常量原文
  const a = sg.indexOf('const scheduleInst = `');
  const b = sg.indexOf('`;', a + 30);
  assert.ok(a > 0 && b > a, '应能截出 scheduleInst');
  const inst = sg.slice(a, b);

  for (const t of ['幻造种', '愿宝', '鸽川', '二维市', '绘世学院', '人们的行为', '滨河道', '馋嘴胡同']) {
    assert.ok(!inst.includes(t), `scheduleInst 里仍含「${t}」——应改为通用表述`);
  }
});

test('★★ 世界观的"特色事物"规则仍在，但已通用化', () => {
  const sg = fs.readFileSync(path.join(SRC, 'services/scheduleGenerator.js'), 'utf8');
  assert.match(sg, /特色事物/, '通用化后的规则应保留');
  assert.match(sg, /不针对任何具体世界观/, '应显式声明它与世界观无关');
});

// ─────────────────────────────────────────────────────────
// ④ 注入层：单点收口 + 保守默认
// ─────────────────────────────────────────────────────────

test('★★ 裁剪只认"声明的氛围节"，不认具体标题', () => {
  const src = fs.readFileSync(path.join(SRC, 'db/worldRepository.js'), 'utf8');
  // 判据：不再**声明**硬编码章节名常量（注释里提到「人们的行为」作历史说明是允许的）
  assert.ok(!/^\s*const WORLD_BEHAVIOR_HEADING_RE/m.test(src), '旧的硬编码章节名正则必须已移除');
  const fn = src.slice(src.indexOf('export function adaptWorldText'), src.indexOf('export function adaptWorldText') + 2600);
  assert.match(fn, /slots\?\.ambienceSections/, '必须从槽位读声明');
  assert.match(fn, /declared\.length === 0\) return text/, '未声明时必须原样返回（保守默认）');
});

test('★★ adaptWorldText 行为：未声明不裁 / 声明才裁 / keep 恒不裁', async () => {
  const { adaptWorldText } = await import('../src/db/worldRepository.js');
  const world = '## 世界背景\n内容\n## 人们的行为\n- 例句一\n- 例句二\n## 日常规则\n- 规则\n';

  // ① 没声明 → 一字不改
  assert.equal(adaptWorldText(world, 'strip', null), world);
  assert.equal(adaptWorldText(world, 'strip', { ambienceSections: [] }), world);

  // ② 声明了 → 只裁该节，其余完整
  const cut = adaptWorldText(world, 'strip', { ambienceSections: ['人们的行为'] });
  assert.ok(!cut.includes('例句一'), '声明的节应被裁掉');
  assert.ok(cut.includes('## 世界背景') && cut.includes('## 日常规则'), '其他节必须完整保留');

  // ③ keep 模式恒不裁
  assert.equal(adaptWorldText(world, 'keep', { ambienceSections: ['人们的行为'] }), world);

  // ④ 声明的节在正文里不存在 → 不动
  assert.equal(adaptWorldText(world, 'strip', { ambienceSections: ['不存在的节'] }), world);
});

test('★ 世界观的裁剪改由项目库驱动，且不认「日常规则」这类混合节', async () => {
  const { adaptWorldText } = await import('../src/db/worldRepository.js');
  const world = '## 日常规则\n- 男器整根画进画面\n- 愿宝是虚拟货币\n';
  // 即使把「日常规则」声明为氛围节会丢内容，引擎也必须照声明执行（决定权在人）
  const cut = adaptWorldText(world, 'strip', { ambienceSections: ['日常规则'] });
  assert.equal(cut, '', '声明了就该裁（哪怕内容是混合的）—— 这是人的决定');
  // 默认（猜测结果）不声明它 → 完整保留
  assert.equal(adaptWorldText(world, 'strip', { ambienceSections: [] }), world);
});

test('★★ getWorldSetting 已单点收口（22 处裸调用一次性获得保护）', () => {
  const src = fs.readFileSync(path.join(SRC, 'db/worldRepository.js'), 'utf8');
  const fn = src.slice(src.indexOf('export function getWorldSetting()'), src.indexOf('export function getWorldSettingRaw()'));
  assert.match(fn, /adaptWorldText\(/, 'getWorldSetting 内部必须走裁剪');
  assert.match(fn, /safeActiveSlots\(\)/, '裁剪需按当前世界观的槽位');
  assert.match(src, /export function getWorldSettingRaw\(\)/, '必须保留原文逃生口');
});

test('★★ getWorldSetting 返回的内容必须已裁剪（行为级验证）', async () => {
  const db = await import('../src/db/index.js');
  db.getDb();   // ⚠ 必须先打开库：worldRepository 的句柄由它注入，否则 handle() 抛错
  const { createWorldSetting, updateWorldSetting, activateWorldSetting, getWorldSetting } = db;
  const name = '__注入收口测试__';
  const content = '## 世界背景\n内容保留\n## 人们的行为\n- 例句不该出现\n';
  let created;
  try {
    created = createWorldSetting({ name, content });
    // 声明该节为氛围节（直接写项目库，模拟用户配置）
    const slug = slugForWorld(name, created.id);
    writeProject(slug, { ...neutralProject(), ambienceSections: ['人们的行为'] });
    activateWorldSetting(created.id);

    const out = getWorldSetting();
    assert.ok(out.includes('内容保留'), '未被裁的节应保留');
    assert.ok(!out.includes('例句不该出现'), '声明的氛围节必须已被裁掉');
  } finally {
    if (created) {
      try { fs.rmSync(projectDirFor(slugForWorld(name, created.id)), { recursive: true, force: true }); } catch {}
    }
  }
});

test('★★ 静默兜底必须能区分"数据层未就绪"与"真出错"（本次踩过的坑）', () => {
  // 实况：forumAlias 里写了空 catch 吞掉 ReferenceError（漏 import 导致 getActiveWorldSlots 未定义），
  // 表现成"专属取材维度神秘消失"，排查时才发现。空 catch 是红线 0 的同源陷阱。
  const fa = fs.readFileSync(path.join(SRC, 'services/forumAlias.js'), 'utf8');
  const fn = fa.slice(fa.indexOf('export function aliasSourcesNow'), fa.indexOf('export function aliasSourcesNow') + 1200);
  assert.match(fn, /catch\s*\(\w+\)/, '必须捕获变量，不能是空 catch');
  assert.match(fn, /console\.warn/, '真出错时必须留痕');
  assert.match(fn, /notReady|is not defined/, '要能区分"未就绪"（正常回落）与"真出错"（必须喊）');
  assert.match(fa, /^import \{ getActiveWorldSlots \}/m, '依赖必须真的 import（漏了会被 catch 吞成"没有项目库"）');
});

test('★ 同类兜底：scheduleLedger 也得真 import，不能靠 catch 兜', () => {
  const sl = fs.readFileSync(path.join(SRC, 'services/scheduleLedger.js'), 'utf8');
  assert.match(sl, /^import \{ getActiveWorldSlots \}/m, 'scheduleLedger 依赖必须真的 import');
});

// ─────────────────────────────────────────────────────────
// 前端护栏（2026-10-07 补）
// ─────────────────────────────────────────────────────────
// ⚠ 上面那条护栏只扫 `agent-core/src` 的 `.js` —— 于是**前端**成了缺口：
//   我在「派系与组织」的输入框里写了「如：幻月秘庭 / 共愿帮」（某世界观的专名），
//   构建、全部测试**都是绿的**，但那句话对任何别的世界观都是错的 —— 用户当场指出。
//   这里把**同一份词表**扩展到 `web-ui/src`（`.vue` + `.js`）。
//   存量违规列成**具名豁免**（文件 → 允许的词集合）：棘轮式，只许减少不许增加。

const WEB_UI_SRC = path.resolve(__dirname, '../../web-ui/src');

/**
 * 前端**存量**违规豁免：文件（相对 `web-ui/src`）→ 允许出现的词集合。
 * 只放"本次修复时已存在、且不宜顺手机械改"的；**新增违规一律不要补进这里**。
 */
const FRONTEND_LEGACY_ALLOW = {
  // 该地图功能的点位/坐标表：属"某个具体地图"的数据，待迁到数据层（同 transitSeed 的做法）
  'components/worldmap/MapPointView.vue': ['二相乐园', '二维市', '鸽川', '绘世学院', '珠星', '海原电视塔', '幻月秘庭', '世界尽头酒馆', '喜悲街', '喜笑区', '悲泣区', '泊地站'],
  // 报纸入口副标题写死了世界观名 —— 存量文案，宜改由数据/设置驱动
  'views/MediaView.vue': ['二相乐园'],
  // 媒体持牌人称谓（该世界观的词汇）—— 存量文案
  'components/media/MediaWeekly.vue': ['谒者'],
  // 故事页占位符举例 —— 另一个会话正在改该文件，暂不介入
  'views/StoryView.vue': ['鸽川', '嬉步街'],
};

function walkFrontend(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFrontend(p, acc);
    else if (/\.(vue|js)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

test('★★★ 前端（web-ui）也不得内置世界观专有名词（存量已在豁免表内，新增即失败）', () => {
  const offenders = [];
  for (const file of walkFrontend(WEB_UI_SRC, [])) {
    const rel = path.relative(WEB_UI_SRC, file).replace(/\\/g, '/');
    const allowed = new Set(FRONTEND_LEGACY_ALLOW[rel] || []);
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (line.includes(EXEMPT_MARK)) return;
      // 模板注释 <!-- --> 与脚本注释同等对待
      if (/^\s*(\/\/|\*|\/\*|<!--)/.test(line)) return;
      for (const t of BANNED_TERMS) {
        if (!line.includes(t) || allowed.has(t)) continue;
        offenders.push(`web-ui/src/${rel}:${i + 1} 含「${t}」`);
      }
    });
  }
  assert.deepEqual(
    offenders, [],
    `前端出现了世界观专有名词（换世界观后这些文案就是错的）：\n  ${offenders.join('\n  ')}\n` +
    `\n→ 修法：① 改通用表述（占位符/示例尤其容易犯）；② 从数据层/项目库读取；③ 确属必要的，行尾加「${EXEMPT_MARK}: 理由」` +
    `（⚠ 存量豁免见本文件 FRONTEND_LEGACY_ALLOW，只许减少，不要往里加）`
  );
});

test('★★ 护栏本身有效：前端占位符里塞专名必须被抓到（防"豁免表写太宽导致永远绿"）', () => {
  // 直接验判据：造一行前端占位符，应命中；且豁免表里没有它
  const fakeLine = 'placeholder="如：幻月秘庭 / 共愿帮"';
  const hit = BANNED_TERMS.filter(t => fakeLine.includes(t));
  assert.ok(hit.includes('幻月秘庭'), '词表应能命中占位符里的专名');
  assert.ok(!Object.keys(FRONTEND_LEGACY_ALLOW).some(f => f.endsWith('FactionManagerModal.vue')),
    '我刚修好的组件不该在豁免表里');
});
