/**
 * 「重新生图」入口的形态门控 —— 回归测试。
 *
 * 用户 2026-10-06 实报：**论坛是纯文字版面，却还挂着「重新生图」按钮**。
 *
 * 链路核查结论（本测试要守住的）：
 *  ① 后端生成论坛时**强制**把 `image_prompt` 置空（原文「论坛是纯文字版面，一律不配图」）；
 *  ② 后端 `/regenerate-image` 走 `canRegenerateImage()`，对无提示词的内容**直接拒绝**；
 *  ⇒ 所以论坛上那个按钮**点了必然报错**，本就不该渲染。
 *
 * ⚠ 关键设计：可生图与否**由后端算好下发**（`can_regenerate`），前端不得自行镜像判定 ——
 *   因为 `image_prompt` 恰恰是 `mapPostRow` **不下发**的字段，前端根本无从判断；
 *   在前端重写一套只会把同一条口径复制成两份（红线 8）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');
const WEB_SRC = path.resolve(__dirname, '../../web-ui/src');

const media = fs.readFileSync(path.join(SRC, 'services/mediaService.js'), 'utf8');
const view = fs.readFileSync(path.join(WEB_SRC, 'views/MediaView.vue'), 'utf8');

// ─────────────────────────────────────────────────────────
// ① 后端：论坛确实不配图（这是"按钮不该出现"的事实前提）
// ─────────────────────────────────────────────────────────

test('★ 前提：论坛生成时强制清空 image_prompt（纯文字版面）', () => {
  assert.match(media, /论坛是\*\*纯文字版面\*\*/, '应有"论坛是纯文字版面"的既有口径');
  assert.match(media, /image_prompt:\s*null/, '论坛出口层应把 image_prompt 置空');
});

test('★ 前提：canRegenerateImage 对无提示词的内容返回 false（按钮点了会报错）', () => {
  const fn = media.match(/export function canRegenerateImage[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(fn, 'canRegenerateImage 应存在');
  assert.match(fn, /image_prompt/, '判据应基于 image_prompt');
  assert.match(fn, /return false|return true/, '应有明确的真假返回');
});

// ─────────────────────────────────────────────────────────
// ② 后端：把「能否重新生图」算好下发（避免前端镜像口径）
// ─────────────────────────────────────────────────────────

test('★★ 后端下发 can_regenerate（复用端点同一函数，口径不漂）', () => {
  assert.match(media, /can_regenerate:\s*canRegenerateImage\(r\)/,
    'mapPostRow 应用 canRegenerateImage(r) 算出 can_regenerate 下发');
  // ⚠ 不得改成前端自己拼一套：判据必须来自这个函数
  const mapFn = media.match(/function mapPostRow[\s\S]*?\n\}/)?.[0] || '';
  assert.match(mapFn, /can_regenerate/, 'mapPostRow 必须含 can_regenerate 字段');
});

test('★ 重新生图端点仍走同一判据（下发的标志与端点行为必须同源）', () => {
  const fn = media.match(/export function regeneratePostImage[\s\S]*?const payload = safeParse/)?.[0] || '';
  assert.ok(fn, '应能截出 regeneratePostImage 的开头段');
  assert.match(fn, /canRegenerateImage\(post\)/, '端点应复用 canRegenerateImage（与下发标志同源）');
});

// ─────────────────────────────────────────────────────────
// ③ 前端：三处单条入口 + 批量入口都要按标志门控
// ─────────────────────────────────────────────────────────

test('★★ 前端：单条「重新生图」入口按 can_regenerate 门控（详情/版式/悬浮三处）', () => {
  // 详情弹窗
  assert.match(view, /v-if="canRegenerate\(detailPost\)"/, '详情弹窗的重新生图应门控');
  // 周刊/海报版式下方
  assert.match(view, /v-if="canRegenerate\(p\)"/, '版式下方与卡片悬浮的入口应门控');
  const guarded = (view.match(/v-if="canRegenerate\(/g) || []).length;
  assert.ok(guarded >= 3, `至少 3 处可生图入口要门控（实际 ${guarded} 处）`);
  // 前端只读后端标志，不自己判断 image_prompt
  const fn = view.match(/function canRegenerate[\s\S]*?\n\}/)?.[0] || '';
  assert.match(fn, /can_regenerate/, 'canRegenerate 应只读后端下发的 can_regenerate');
  assert.ok(!/image_prompt/.test(fn), '前端不应自己去看 image_prompt（那是后端不下发的字段）');
});

test('★★ 前端：批量入口在纯文字档不渲染，且只提交可生图项', () => {
  // 批量按钮的显示条件（允许 v-if 与 class 之间有其它属性）
  assert.match(view, /v-if="categoryHasImages"/, '批量按钮应按分类可生图性显示');
  // 提交时必须过滤
  const fn = view.match(/async function batchRegenerate[\s\S]*?\n\}/)?.[0] || '';
  assert.match(fn, /regenerableSelectedIds\.value/, '批量提交应只送可生图项');
  assert.ok(!/const ids = \[\.\.\.selectedPostIds\.value\]/.test(fn),
    '不得直接提交全部选中项（会把纯文字内容一起送去报错）');
  // 计数与禁用态也要用过滤后的集合
  assert.match(view, /regenerableSelectedIds\.length/, '按钮禁用态/计数应基于过滤后的集合');
});

test('★ 前端：纯文字档的判据只写一处（categoryHasImages），供批量入口用', () => {
  // computed 可能跨多行，截到"const categoryHasImages"后的一段
  const i = view.indexOf('const categoryHasImages');
  assert.ok(i > -1, '应有 categoryHasImages');
  const seg = view.slice(i, i + 200);
  assert.match(seg, /forum/, 'categoryHasImages 判据应体现"论坛是纯文字档"');
});

// ─────────────────────────────────────────────────────────
// ④ 行为验证：真跑 canRegenerateImage，证明论坛被拒、社交通过
// ─────────────────────────────────────────────────────────

const { canRegenerateImage } = await import('../src/services/mediaService.js');

test('★★ 行为：论坛帖（image_prompt 为空）→ canRegenerateImage 为 false', () => {
  const forumPost = { id: 1, image_prompt: null, payload_json: JSON.stringify({ forum: { replies: [] } }) };
  assert.equal(canRegenerateImage(forumPost), false, '论坛帖不该允许重新生图');
});

test('★★ 行为：社交帖（有 image_prompt）→ true；门户按板块判定', () => {
  const social = { id: 2, image_prompt: 'neon alley, wet asphalt', payload_json: null };
  assert.equal(canRegenerateImage(social), true, '有提示词的内容应允许重新生图');
  // 门户：需要 payload.portal 标记 + sections；任一块有提示词即可
  const portalWith = {
    id: 3, image_prompt: null,
    payload_json: JSON.stringify({ portal: true, sections: [{ image_prompt: 'city skyline' }, { image_prompt: '' }] }),
  };
  assert.equal(canRegenerateImage(portalWith), true, '门户任一块有提示词即可重申');
  const portalWithout = {
    id: 4, image_prompt: null,
    payload_json: JSON.stringify({ portal: true, sections: [{ image_prompt: '' }] }),
  };
  assert.equal(canRegenerateImage(portalWithout), false, '门户全无提示词则不可重申');
});

test('★ 行为：panels 形态（周刊/海报）按小图提示词判定', () => {
  const withPanels = { id: 5, image_prompt: null, payload_json: JSON.stringify({ panels: [{ image_prompt: 'mascot' }] }) };
  assert.equal(canRegenerateImage(withPanels), true);
  const emptyPanels = { id: 6, image_prompt: null, payload_json: JSON.stringify({ panels: [{ image_prompt: '' }] }) };
  assert.equal(canRegenerateImage(emptyPanels), false);
});