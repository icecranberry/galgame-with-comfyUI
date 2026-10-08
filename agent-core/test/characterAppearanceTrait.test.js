/**
 * 外观特化（常驻种族/身体特征）+ 身体标签池扩充 —— 回归测试。
 *
 * 用户口径（2026-10-06）：
 *  ① 只有「机械化」这类**常驻**身份特征需要特化（其他角色用 anima/LoRA 即可贴合原设）；
 *  ② 把「变身 TAG」那套做成**可选的外观特化选择框**；
 *  ③ 身体基线没落实 —— 翡翠的「阴毛修剪成规整细条」「B93-W62-H91 / D 罩杯」在 app 侧**无处可填**。
 *
 * 本测试守：
 *  · 标签库确实含 阴毛/机械义体/体型/种族特征 四组（否则选择器是空的）
 *  · 目录接口只暴露给"人点选"的层级，且**不做未成年人过滤**（角色卡身体设定不该被自动删）
 *  · 前端门控与同源（点选写入 detail.body，不另立真源）
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');
const WEB_SRC = path.resolve(__dirname, '../../web-ui/src');

const yamlSrc = fs.readFileSync(path.join(SRC, 'db/data/imagePromptTags.yaml'), 'utf8');
const tagBuilder = fs.readFileSync(path.join(SRC, 'db/imagePromptTagKnowledgeData.js'), 'utf8');
const modal = fs.readFileSync(path.join(WEB_SRC, 'components/CharacterDetailModal.vue'), 'utf8');
// 标签选择器已拆成独立弹窗组件（用户要求「标签库改弹窗」）：分类真源随之
// 下沉到服务端（listAppearanceTraitCatalog + appearanceTagPartition），前端不再自带 TRAIT_SECTIONS。
const picker = fs.readFileSync(path.join(WEB_SRC, 'components/AppearanceTraitPicker.vue'), 'utf8');
const apiSrc = fs.readFileSync(path.join(WEB_SRC, 'api/index.js'), 'utf8');
const routeSrc = fs.readFileSync(path.join(SRC, 'routes/characters.js'), 'utf8');
// 「身体设计标签 vs 绘图标签」分家的唯一真源
const partitionSrc = fs.readFileSync(path.join(SRC, 'db/appearanceTagPartition.js'), 'utf8');

// ─────────────────────────────────────────────────────────
// ① 标签池：新增四组必须真的存在
// ─────────────────────────────────────────────────────────

test('★★ 标签池：新增「身体特征」段，含 阴毛/机械·义体/体型身高/种族特征 四组', () => {
  assert.match(yamlSrc, /^- name: 身体特征/m, '应有「身体特征」顶层段');
  for (const g of ['阴毛', '机械 / 义体', '体型 / 身高', '种族特征']) {
    assert.ok(yamlSrc.includes(`- name: ${g}`), `应有分组「${g}」`);
  }
});

test('★★ 用户点名的缺失维度必须有标签（阴毛浓密度 / 机械义体）', () => {
  // 用户举例：翡翠「阴毛修剪成规整细条」；真珠「机械化（可见关节机械设计元素）」
  for (const t of ['pubic hair', 'shaved pussy', 'trimmed pubic hair', 'trimmed pussy hair']) {
    assert.ok(yamlSrc.includes(t), `应有阴毛类标签 ${t}`);
  }
  for (const t of ['android', 'robot joints', 'mechanical joints', 'artificial limb', 'cyborg']) {
    assert.ok(yamlSrc.includes(t), `应有机械/义体类标签 ${t}`);
  }
  // 体型/种族也补上（此前库中完全没有）
  for (const t of ['petite', 'curvy', 'fox ears', 'fox tail', 'wings', 'halo']) {
    assert.ok(yamlSrc.includes(t), `应有 ${t}`);
  }
});

test('★★ 新增段必须登记进 TOP_LEVEL_CATEGORY（否则整段被静默丢弃）', () => {
  // 实测踩过：只写 YAML 不加映射，构建产物里一个标签都进不去
  assert.match(tagBuilder, /身体特征:\s*'character_vocabulary'/,
    '「身体特征」必须登记进 TOP_LEVEL_CATEGORY，否则该段全部被丢弃');
});

// ─────────────────────────────────────────────────────────
// ② 目录接口：给人点选，且不做未成年过滤
// ─────────────────────────────────────────────────────────

test('★ 目录接口导出 listAppearanceTraitCatalog，且保留 YAML 原始层级', () => {
  assert.match(tagBuilder, /export function listAppearanceTraitCatalog/, '应导出目录函数');
  const fn = tagBuilder.match(/export function listAppearanceTraitCatalog[\s\S]*?\n\}/)?.[0] || '';
  assert.match(fn, /sec\.groups/, '应遍历 YAML 原始分组');
  assert.match(fn, /tag: t, label:/, '应同时给出英文 tag 与中文标签');
});

test('★★ 目录接口不做 minor 过滤（角色卡身体设定是给人确认的，不该被自动删）', () => {
  const fn = tagBuilder.match(/export function listAppearanceTraitCatalog[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(!/MINOR_PATTERN/.test(fn), '目录不应套用 MINOR_PATTERN（那是给 LLM 词表用的）');
});

test('★ 路由：/appearance-trait-catalog 必须在参数路由之前注册', () => {
  const i = routeSrc.indexOf("'/appearance-trait-catalog'");
  const j = routeSrc.indexOf("router.put('/:id'");
  assert.ok(i > -1, '应注册 appearance-trait-catalog 路由');
  assert.ok(j > -1, '应存在 PUT /:id');
  assert.ok(i < j, '字面路径必须早于 /:id 注册，否则被参数路由吞掉（本项目既有约定）');
});

// ─────────────────────────────────────────────────────────
// ③ 前端：选择框与"写入身体"接线
// ─────────────────────────────────────────────────────────

/** 取某个函数的完整源码段（含嵌套花括号），用"下一个顶层函数声明"作边界。
 *  ⚠ 名称后必须紧跟 `(`，否则 `toggleTrait` 会先命中 `toggleTraitPanel`。 */
function fnBody(src, name) {
  const re = new RegExp(`function ${name}\\(`);
  const hit = re.exec(src);
  if (!hit) return '';
  const i = hit.index;
  const rest = src.slice(i + 10);
  const m = rest.search(/\n(?:async )?function /);
  return src.slice(i, m > -1 ? i + 10 + m : i + 3000);
}

test('★★ 前端：选择器写入 detail.body（不另立真源），并由详情弹窗调用', () => {
  // 弹窗只负责"打开选择器 + 收结果"，写入动作在 appendTagToBody/onTraitPickerConfirm 里
  assert.match(modal, /openTraitPicker|AppearanceTraitPicker/, '详情弹窗应打开独立标签选择器');
  assert.match(modal, /function onTraitPickerConfirm/, '应有点选结果回写逻辑');

  const fn = fnBody(modal, 'appendTagToBody');
  assert.ok(fn.length > 50, '应能截出 appendTagToBody 函数体');
  assert.match(fn, /detail\.body\s*=/, '点选必须写入 detail.body（身体是五套共用的单一真源）');

  // dirty 标记：写入链路（append/remove/confirm）里必须标脏，否则保存按钮不亮
  const scope = modal.slice(
    modal.indexOf('function onTraitPickerConfirm'),
    modal.indexOf('function onTraitPickerConfirm') + 2400
  );
  assert.match(scope, /detail\.dirty\s*=\s*true/, '点选应标记为已改动（否则保存按钮不亮）');
});

test('★ 前端：写入时去重（已存在的 tag 不重复追加）', () => {
  const fn = fnBody(modal, 'appendTagToBody');
  // 去重判据在 appendTagToBody 内部（includes 判定）或在 confirm 侧先行过滤
  const confirmScope = modal.slice(
    modal.indexOf('function onTraitPickerConfirm'),
    modal.indexOf('function onTraitPickerConfirm') + 2400
  );
  assert.ok(
    /includes\(|indexOf\(|\.test\(|RegExp/.test(fn + confirmScope),
    '应检测 body 里是否已有该 tag（去重）'
  );
});

test('★★ 前端：只展示身体设计标签（分类真源在服务端，前端不再自带体位词库）', () => {
  // ① 前端确实把分类交给服务端：选择器不得自带 TRAIT_SECTIONS 常量
  assert.ok(!/const TRAIT_SECTIONS/.test(picker), '分类真源应下沉到服务端，前端不该再维护一份');
  assert.match(picker, /getAppearanceTraitCatalog/, '选择器应从目录接口取数据');

  // ② 分家真源：appearanceTagPartition 是唯一判定处，且明确排除体位/动作类分组
  assert.match(partitionSrc, /FULLY_KEPT_SECTIONS/, '应有"整段保留"白名单');
  assert.match(partitionSrc, /MOVED_OUT_GROUPS/, '应有"移出到绘图页"黑名单');
  assert.match(partitionSrc, /身体特征/, '「身体特征」应整段保留');
  assert.ok(
    !/MOVED_OUT_GROUPS[\s\S]{0,200}身体特征/.test(partitionSrc),
    '「身体特征」不得出现在移出名单里'
  );
});

test('★ API 层接线', () => {
  assert.match(apiSrc, /export function getAppearanceTraitCatalog/, '应导出 getAppearanceTraitCatalog');
  assert.match(apiSrc, /\/characters\/appearance-trait-catalog/, 'API 应指向正确端点');
});

// ─────────────────────────────────────────────────────────
// ④ 行为验证：真跑目录函数，确认新标签可被点选
// ─────────────────────────────────────────────────────────

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`trait test forbids network: ${url}`); };

const { listAppearanceTraitCatalog } = await import('../src/db/imagePromptTagKnowledgeData.js');

test('★★ 行为：目录里能真的取到 阴毛/机械/种族 的标签项', () => {
  const sections = listAppearanceTraitCatalog();
  const bf = sections.find(s => s.name === '身体特征');
  assert.ok(bf, '目录应含「身体特征」段');
  const groups = bf.groups.map(g => g.name);
  assert.ok(groups.includes('阴毛'), '应含「阴毛」组');
  assert.ok(groups.includes('机械 / 义体'), '应含「机械 / 义体」组');
  const allTags = bf.groups.flatMap(g => g.tags.map(t => t.tag));
  for (const t of ['pubic hair', 'android', 'fox ears']) {
    assert.ok(allTags.includes(t), `目录应给出可点选的 ${t}`);
  }
  // 每个标签都要有中文可读标签（选择器是给人点的）
  const noLabel = bf.groups.flatMap(g => g.tags).filter(t => !t.label);
  assert.equal(noLabel.length, 0, '所有标签都应有中文标签（否则界面上没法读）');
});

// ─────────────────────────────────────────────────────────
// ⑤ 2026-10-07 用户口径（三项改动）
// ─────────────────────────────────────────────────────────

test('★★ 标签库：不再分「人物/身体特征」两段，统一为单一「身体特征」段', () => {
  assert.match(yamlSrc, /^- name: 身体特征$/m, '「身体特征」段必须存在');
  // 「人物」段在角色页不该再出现身体设计组（那些已并入「身体特征」）
  const personSeg = yamlSrc.slice(yamlSrc.indexOf('- name: 人物'), yamlSrc.indexOf('- name: 身体特征'));
  for (const g of ['乳房形状', '乳头 / 乳晕', '阴部', '阴毛', '体型 / 身高', '种族特征', '机械 / 义体']) {
    assert.ok(!personSeg.includes(`- name: ${g}`), `「${g}」不该留在「人物」段（应并入「身体特征」）`);
  }
});

test('★★ 组序必须按"从上到下"：体型 → 乳房形状 → 乳头/乳晕 → 阴毛 → 阴部 → 种族特征 → 机械/义体', () => {
  const want = ['体型 / 身高', '乳房形状', '乳头 / 乳晕', '阴毛', '阴部', '种族特征', '机械 / 义体'];
  const bodySeg = yamlSrc.slice(yamlSrc.indexOf('- name: 身体特征'));
  const got = want.map(n => bodySeg.indexOf(`- name: ${n}`));
  assert.ok(got.every(i => i >= 0), '身体特征段必须含全部七个组');
  for (let i = 1; i < got.length; i++) {
    assert.ok(got[i] > got[i - 1], `组序错误：「${want[i]}」应排在「${want[i-1]}」之后`);
  }
});

test('★★ 「对象」已改名「阴部」，且移除「小孩开大车」(onee-shota，「体位」不是身体特征)', () => {
  assert.ok(!yamlSrc.includes('- name: 对象'), '「对象」组应已改名');
  assert.match(yamlSrc, /- name: 阴部/);
  // 只查**数据行**（`        tag: 标签` 形态），注释里的说明文字不算
  const dataLines = yamlSrc.split('\n').filter(l => /^\s{8}\S/.test(l));
  assert.ok(!dataLines.some(l => l.includes('onee-shota')), '`小孩开大车` 必须从数据里移除');
});

test('★★ 角色页不得带折叠分组（用户：全部默认展开）', () => {
  // 目录接口不返回"默认折叠"标记；由前端全展开实现。
  assert.ok(!/defaultCollapsed|collapsedByDefault/.test(picker), '不应有"默认折叠"的模型');
  // 打开时必须把**所有**组加进 openGroups —— 曾经只展开前两组，等于要连点 7 次才看得见内容
  assert.match(picker, /function expandAll\(\)/, '应有 expandAll 展开全部组');
  assert.match(picker, /await loadCatalog\(\)\s*\n\s*expandAll\(\)/,
    '加载完目录后必须调用 expandAll（不能只展开前两组）');
  assert.ok(!/first\?\.groups\?\.\[0\]/.test(picker), '不应再有"只展开第一组"的旧逻辑');
});

test('★★ 前端不再有"已选 TAG"的 chip 与 × 交互（用户：输入框里能改，多此一举）', () => {
  assert.ok(!/class="trait-chip"/.test(modal), '角色页不该再渲染 trait-chip');
  assert.ok(!/class="trait-picked"/.test(modal), '不该再有 trait-picked 行');
  // picker 仍以输入框内容作为初始选中值（唯一真源是输入框）
  assert.match(modal, /:selected="selectedTraits"/, 'picker 初始化仍应读输入框内容');
  assert.match(modal, /parseTraitsFromBody/, '应从「身体」字段解析（真源）');
});

test('★★ 身体输入框必须有最小高度（不能被 chip 行之外的东西继续压缩）', () => {
  // 实况：`.scene-edit-desc` 原为 `min-height: 0`（让 flex 可压缩）——
  // 用户实报"外观特化把身体输入框挤没了"，实测高度只有 43.5px（约一行）。
  // 移除 chip 行后给了 96px 下限，保证 100+ 字符的英文 tag 串能看全几行。
  const css = modal.slice(modal.indexOf('/* ── 外观特化'));
  assert.ok(!/\.scene-auto-note > \.scene-edit-desc \{ flex: 1 1 auto; min-height: 0; \}/.test(modal)
            || /min-height: 96px/.test(modal), '身体输入框必须有明确的最小高度');
  assert.match(modal, /min-height: 96px/, '应有 96px 下限');
});
