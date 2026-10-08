import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ★ 人设生成提示词框架：「说话方式 / 口癖 / 台词样本」必须是独立段落，且被显式要求。
 *
 * ── 为什么要有这条测试 ────────────────────────────────────────
 * 2026-10-07 用户反馈「角色人设生成提示词框架对角色口癖和台词例句需要加强」。
 * 实测当时 73 张已有角色卡里，**只有 2 张**带任何说话方式/台词类段落 ——
 * 根因是旧框架把"说话方式、口头禅"塞进「你的性格」的第 1 条括注里，
 * 模型实际只会写出**心理分析**，口癖与例句几乎必丢。
 *
 * ⚠ 本条守卫的是"框架不许回退到只写心理"。改模板时先读本文件的断言。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', 'src');
const CHARS = path.join(SRC, 'routes/characters.js');
const NPC = path.join(SRC, 'services/town/townNpcService.js');

test('★★ 人设生成模板：含独立的「## 你的说话方式」段（不许只塞在性格里）', () => {
  const src = fs.readFileSync(CHARS, 'utf8');
  assert.match(src, /## 你的说话方式/, '主模板必须有独立的说话方式段落');
});

test('★★ 说话方式表必须覆盖关键维度（自称/称呼/语气/口头禅/标点/开场/风格切换/绝不会说）', () => {
  const src = fs.readFileSync(CHARS, 'utf8');
  for (const dim of ['自称', '称呼他人', '语气基调', '标志口头禅', '标点与断句习惯', '开场模式', '风格切换', '绝不会说']) {
    assert.ok(src.includes(dim), `说话方式表缺少维度「${dim}」`);
  }
});

test('★★ 必须要求「标志口头禅」给到 ≥2 项，且写明要具体到可模仿', () => {
  const src = fs.readFileSync(CHARS, 'utf8');
  const line = src.split('\n').find(l => l.includes('标志口头禅')) || '';
  assert.match(line, /至少两项|至少 2 项|≥\s*2/, `口头禅一条必须要求多项（实得：${line.trim()}）`);
});

test('★ 必须有「### 台词样本」，且要求多条、覆盖不同情绪面', () => {
  const src = fs.readFileSync(CHARS, 'utf8');
  assert.match(src, /### 台词样本/, '必须有台词样本小节');
  const idx = src.indexOf('### 台词样本');
  const block = src.slice(idx, idx + 420);
  assert.match(block, /3\s*条|\d\s*条/, '台词样本应给出条数要求');
  assert.match(block, /不同情绪面|不同场合|不一样/, '台词样本应要求覆盖不同场合/情绪，避免三条一个调');
});

test('★ 台词样本要优先使用原作原文（有原文时不许自己编）', () => {
  const src = fs.readFileSync(CHARS, 'utf8');
  const idx = src.indexOf('### 台词样本');
  const block = src.slice(idx, idx + 420);
  assert.match(block, /原作原文|原文/, '应要求优先用原作原文，而不是凭空编台词');
});

/**
 * 取出主模板的正文（`buildPersonaSystemPrompt` 里 `【模板】` 到参考资料插值之前的那段）。
 * ⚠ 必须**限定在模板内**再查段落顺序：`## 你的外观` 在本文件别处的注释与其他接口文本里
 *   也出现过多次，直接对全文 `indexOf` 会命中注释里的那一个，断言随注释漂移。
 */
function personaTemplateBody(src) {
  const fnStart = src.indexOf('function buildPersonaSystemPrompt');
  assert.ok(fnStart >= 0, '找不到 buildPersonaSystemPrompt');
  const tplStart = src.indexOf('【模板】', fnStart);
  assert.ok(tplStart >= 0, '模板本体应从【模板】开始');
  const tplEnd = src.indexOf('${searchContext', tplStart);
  assert.ok(tplEnd > tplStart, '找不到模板结束锚点（参考资料插值处）');
  return src.slice(tplStart, tplEnd);
}

test('★★ 「## 你的外观」必须仍是人设模板的最后一段', () => {
  // characterPersona.extractAppearanceSection 的语义是「截到字符串末尾」，
  // 外观段后面再插别的段落会把那段内容吞进外观（含注入），直接污染生图提示词。
  const body = personaTemplateBody(fs.readFileSync(CHARS, 'utf8'));
  const order = ['## 你的身份', '## 你的性格', '## 你的说话方式', '## 你的好恶', '## 你的外观'];
  let last = -1;
  for (const h of order) {
    const i = body.indexOf(h);
    assert.ok(i > last, `模板段落顺序必须是 ${order.join(' → ')}（「${h}」位置不对）`);
    last = i;
  }
  // 外观段之后不应再出现别的 `## ` 标题（会被 extractAppearanceSection 吞掉）
  const tail = body.slice(body.indexOf('## 你的外观'));
  assert.equal(tail.slice(4).indexOf('\n## '), -1,
    '「## 你的外观」之后不得再有 ## 标题（会被 extractAppearanceSection 吞掉）');
});

test('★ 性格段要明确"写心理动机，口癖交给说话方式一节"（把两节职责分开）', () => {
  const src = fs.readFileSync(CHARS, 'utf8');
  const idx = src.indexOf('## 你的性格');
  const block = src.slice(idx, idx + 300);
  assert.match(block, /口头禅|语气词|说话方式/, '性格段应说明语气/口头禅归下一节，避免两处重复');
});

test('★ 小镇 NPC 模板同步具备说话方式与台词样本（NPC 也会聊天）', () => {
  const src = fs.readFileSync(NPC, 'utf8');
  assert.match(src, /## 你的说话方式/, 'NPC 模板也要有说话方式段');
  assert.match(src, /### 台词样本/, 'NPC 模板也要有台词样本');
  // NPC 卡的结构校验仍须成立（「你是」开头 + 「## 你的外观」）
  assert.match(src, /## 你的外观/, 'NPC 模板仍须保留外观段（isPersonaCard 依赖它）');
});

test('★ 核心创作原则里必须点名"口癖是辨识度的命门"（保证模型不把它当可选项）', () => {
  const src = fs.readFileSync(CHARS, 'utf8');
  assert.match(src, /口癖/, '创作原则里应点名口癖');
});

/**
 * ── 2026-10-08 用户口径（看实机产出后提的三条）────────────────
 * ① 「说话方式」原来是 markdown 表格，与其他几节的条目式文段不一致 → 改成 `- 维度：内容`；
 * ② 台词样本模型实际输出成 `- 情境·信念（v2.2）：「…」`（把资料里的版本号抄进来了）→ 定死格式并禁标注。
 * 下面三条钉住，避免改模板时回退。
 */
test('★★ 「说话方式」必须是条目式文段（`- 维度：内容`），不许再画表格', () => {
  const body = personaTemplateBody(fs.readFileSync(CHARS, 'utf8'));
  const start = body.indexOf('## 你的说话方式');
  const end = body.indexOf('## 你的好恶', start);
  assert.ok(start >= 0 && end > start, '找不到「说话方式 → 好恶」这一段');
  const block = body.slice(start, end);
  assert.equal(/\|\s*维度\s*\|/.test(block), false, '说话方式段不得再用 markdown 表格');
  assert.equal(/\|\s*:?-{2,}/.test(block), false, '说话方式段不得出现表格分隔行');
  for (const dim of ['自称', '称呼他人', '语气基调', '标志口头禅', '标点与断句习惯', '开场模式', '风格切换', '绝不会说']) {
    assert.ok(new RegExp(`^- ${dim}[：:]`, 'm').test(block), `说话方式缺少「- ${dim}：…」这一条目`);
  }
});

test('★★ 台词样本必须给出固定格式 `- 情境·<场合>：「…」`，并明令不许带版本号', () => {
  const src = fs.readFileSync(CHARS, 'utf8');
  const idx = src.indexOf('### 台词样本');
  const block = src.slice(idx, idx + 520);
  assert.match(block, /情境·/, '应给出「情境·XX」的写法（用户口径 2026-10-08）');
  assert.match(block, /版本号/, '必须点名"不许写版本号"（实测模型会输出 情境·信念（v2.2））');
  assert.match(block, /不许附带|不要附带|必须去掉|应去掉/, '应明确要求去掉版本号/出处等标注');
});

test('★ 小镇 NPC 模板同步：说话方式同样不许画表格', () => {
  const src = fs.readFileSync(NPC, 'utf8');
  const start = src.indexOf('## 你的说话方式');
  const end = src.indexOf('## 你的好恶', start);
  assert.ok(start >= 0 && end > start, 'NPC 模板找不到「说话方式 → 好恶」段');
  const block = src.slice(start, end);
  assert.equal(/\|\s*维度\s*\|/.test(block), false, 'NPC 说话方式段不得再用 markdown 表格');
});