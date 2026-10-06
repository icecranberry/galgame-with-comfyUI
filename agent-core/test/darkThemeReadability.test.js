/**
 * 暗夜主题可读性 —— 静态回归测试
 *
 * 用户反馈（2026-10-06）：「仔细检查每一个页面在暗夜主题下的文字、色块可视性」。
 * 实测发现的问题里，有一类是**结构性**的、会随新代码再次引入，必须在静态层面钉住：
 *
 *   ① 「accent 系当底 + accent 系当字」—— 暗夜下 --accent(#ff7a64) 与
 *      --accent-light(#ffa58f) 都是亮橙，互为底/字对比度只有 ~1.0（等同看不见）。
 *   ② 「半透明白底」—— rgba(255,255,255,.x) 在暗夜深背景上会合成出中灰，
 *      配 --text-secondary 灰字同样不可读（实测 1.78）。
 *   ③ 硬编码浅色（#f4f1ee / #fffaf5 等）—— 暗夜下不翻转，整块变成浅色。
 *
 * 本测试扫描 web-ui/src，对新引入的这类写法报警。
 * 允许用 `/* theme-ok *​/` 注释豁免单行。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'E:/邻舍.EXE-v2.3.0/web-ui/src';

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { if (f !== 'node_modules') walk(p, out); continue; }
    if (/\.(vue|css)$/.test(f)) out.push(p);
  }
  return out;
}

const files = fs.existsSync(SRC) ? walk(SRC) : [];
const read = f => fs.readFileSync(f, 'utf8');

test('前提：能扫到 web-ui 源码', () => {
  assert.ok(files.length > 50, `应扫到大量源文件，实际 ${files.length}`);
});

test('★ 不得用 --accent-light 当底色、同时用 --accent 当文字色（暗夜下同为亮橙，撞色）', () => {
  const bad = [];
  for (const f of files) {
    const txt = read(f);
    // 同一规则块内同时出现这两者即视为可疑
    const re = /\{[^{}]*background:\s*var\(--accent-light\)[^{}]*\}/g;
    for (const m of txt.match(re) || []) {
      if (/color:\s*var\(--accent\)/.test(m)) bad.push(`${path.basename(f)} → ${m.replace(/\s+/g, ' ').slice(0, 90)}`);
    }
  }
  assert.deepEqual(bad, [], `发现 accent-light 底 + accent 字：\n${bad.join('\n')}`);
});

test('★ 实心强调底（配白字）必须用 --accent-solid，不能用裸 --accent', () => {
  const bad = [];
  for (const f of files) {
    const txt = read(f);
    const re = /\{[^{}]*background:\s*var\(--accent\)[^{}]*\}/g;
    for (const m of txt.match(re) || []) {
      if (/color:\s*(var\(--on-accent\)|#fff\b|white)/i.test(m)) bad.push(path.basename(f));
    }
  }
  assert.deepEqual([...new Set(bad)], [],
    `这些文件里「var(--accent) 实底 + 白字」应改用 var(--accent-solid)：${[...new Set(bad)].join('、')}`);
});

test('★ --accent-solid 必须在暗夜下被压深（否则等于没修）', () => {
  const tokens = read(path.join(SRC, 'styles', 'tokens.css'));
  assert.match(tokens, /--accent-solid:/, '必须定义 --accent-solid');
  // 暗夜块里要有覆盖
  const dark = tokens.slice(tokens.indexOf('[data-theme="dark"]'));
  assert.match(dark, /--accent-solid:\s*color-mix/, '暗夜主题必须把 --accent-solid 压深');
});

test('★ 半透明白底不得用于承载普通文字（暗夜合成中灰后与灰字撞色）', () => {
  const bad = [];
  for (const f of files) {
    const lines = read(f).split('\n');
    lines.forEach((l, i) => {
      const m = /background:\s*rgba\(255,\s*255,\s*255,\s*(0?\.\d+)\)/.exec(l);
      if (!m) return;
      const alpha = parseFloat(m[1]);
      // 阈值 0.6：≥0.6 的白底合成后仍明显发白，配深字没问题（裁剪器按钮/字幕条等浮层）；
      // <0.6 才会在暗背景上合成出**中灰**，此时配 --text-secondary 灰字就撞了。
      if (alpha >= 0.6) return;
      if (l.includes('theme-ok')) return;              // 显式豁免
      if (/inset 0 1px 0/.test(l)) return;             // 高光描边不是底
      if (/[data-theme="dark"]/.test(l)) return;       // 已单独处理暗夜
      bad.push(`${path.basename(f)}:${i + 1}  alpha=${alpha}`);
    });
  }
  assert.deepEqual(bad, [], `半透明白底过淡（应改 var(--bg-*)）：\n${bad.join('\n')}`);
});

test('★ TownView 不得再出现硬编码浅色底（曾整页在暗夜下不翻转）', () => {
  const f = path.join(SRC, 'views', 'TownView.vue');
  if (!fs.existsSync(f)) return;
  const txt = read(f);
  const lines = txt.split('\n');
  const bad = [];
  lines.forEach((l, i) => {
    // 只在"用作 background"时报；注释行不算
    if (/^\s*\/\*/.test(l)) return;
    if (/background:\s*#(f4f1ee|fffaf5|fffaf2|fdfaf7|fcfa(?!\w))/i.test(l)) bad.push(`${i + 1}: ${l.trim().slice(0, 70)}`);
  });
  assert.deepEqual(bad, [], `TownView 仍有硬编码浅色底：\n${bad.join('\n')}`);
});

test('地图选中态必须用「半透明底 + 亮字」，不得用 accent-light 底', () => {
  const f = path.join(SRC, 'views', 'WorldMapView.vue');
  const txt = read(f);
  assert.doesNotMatch(txt, /\.wt-node\.active\s*\{[^}]*background:\s*var\(--accent-light\)/,
    '.wt-node.active 不得用 accent-light 底（暗夜下与字撞色）');
  assert.match(txt, /\.wt-node\.active\s*\{[^}]*background:\s*rgba\(var\(--accent-rgb\)/,
    '.wt-node.active 应使用 rgba(var(--accent-rgb), ...) 半透明底');
});

test('地图点位坐标必须落库（不得只写 localStorage）', () => {
  const f = path.join(SRC, 'components', 'worldmap', 'MapPointView.vue');
  const txt = read(f);
  assert.match(txt, /updateWorldMapPlace\(/, '必须调用后端保存坐标（原实现只写 localStorage，LLM 读不到）');
  assert.match(txt, /queueSave\(/, '拖拽结束应触发落库');
});