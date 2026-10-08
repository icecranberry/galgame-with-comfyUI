/**
 * 本轮（2026-10-06 用户裁定 A1/A5/A6 + 论坛弹窗修复）的静态回归钉子。
 *
 * 均为**静态源码断言**：这几条缺陷的共同点是"运行时静默降级"（渲染成别的组件、
 * 别名表悄悄分叉），不会抛错、也不会让测试变红 —— 只能在源码层面钉住。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const WEB_SRC = path.join(ROOT, 'web-ui/src');
const BACK_SRC = path.join(ROOT, 'agent-core/src');
const read = p => fs.readFileSync(p, 'utf8');

// ─────────────────────────────────────────────────────────
// A5 别名表：必须只有一份（单一真源）
// ─────────────────────────────────────────────────────────
test('A5：别名表必须是单一真源 JSON，前端与工具脚本都读它', () => {
  const jsonPath = path.join(WEB_SRC, 'data/erxiangAlias.json');
  assert.ok(fs.existsSync(jsonPath), '必须存在 data/erxiangAlias.json（别名唯一真源）');
  const data = JSON.parse(read(jsonPath));
  assert.ok(data.toOfficial && typeof data.toOfficial === 'object', '必须含 toOfficial（本库名→官方名）');
  assert.ok(data.toLocal && typeof data.toLocal === 'object', '必须含 toLocal（官方名→本库名）');

  const vue = read(path.join(WEB_SRC, 'components/worldmap/MapPointView.vue'));
  assert.match(vue, /import aliasData from '\.\.\/\.\.\/data\/erxiangAlias\.json'/,
    '前端必须 import 该 JSON 作为别名来源');
  assert.match(vue, /aliasData\?\.toLocal|aliasData && typeof aliasData\.toLocal/,
    '前端必须从 JSON 派生 SPOT_ALIAS');
  // 不得再有硬编码的别名对象字面量（`const SPOT_ALIAS = { ... }`）
  assert.ok(!/const SPOT_ALIAS = \{\s*\S+\s*:/.test(vue),
    'SPOT_ALIAS 不得再硬编码字面量（应派生自 JSON）');

  const py = read(path.join(ROOT, '邻舍-local/0-投递箱/2026-10-05_二相乐园-地点点位图/regen_coords.py'));
  assert.match(py, /erxiangAlias\.json/, '工具脚本也必须读同一份 JSON（不得再硬编码 ALIAS）');
  assert.ok(!/^ALIAS = \{/.test(py.replace(/^\s+/gm, '')), '脚本里不得再有 ALIAS 字面量');
});

// ─────────────────────────────────────────────────────────
// A6 改归属接口
// ─────────────────────────────────────────────────────────
test('A6：必须提供 PATCH /places/:placeId/move 专用端点，且区分「显式 null」与「未传」', () => {
  const s = read(path.join(BACK_SRC, 'routes/worldMap.js'));
  assert.match(s, /router\.patch\('\/places\/:placeId\/move'/, '必须有 move 端点');
  // ★ 必须用 `in` 判断字段存在性 —— `||` 会把显式 null（移到顶层）与未传混为一谈
  assert.match(s, /'parentId' in \(req\.body/, '必须用 in 判断 parentId 是否传入（区分 null 与未传）');
  assert.match(s, /parentId: req\.body\.parentId/, '必须把 parentId 透传给 upsertPlace');
});

// ─────────────────────────────────────────────────────────
// 论坛弹窗：不得被周刊组件误渲染
// ─────────────────────────────────────────────────────────
test('论坛详情：弹窗分派不得用 isLayoutPost（它含 forum 但 componentFor 没有 forum 组件）', () => {
  const s = read(path.join(WEB_SRC, 'views/MediaView.vue'));
  // 动态组件必须用 isLayoutPostWithComponent（只含真有组件的形态）
  assert.match(s, /v-if="isLayoutPostWithComponent\(detailPost\)"/,
    '弹窗动态组件必须用 isLayoutPostWithComponent');
  assert.match(s, /function isLayoutPostWithComponent[\s\S]{0,200}KIND_COMPONENT\[postKind\(p\)\]/,
    'isLayoutPostWithComponent 必须基于 KIND_COMPONENT 判定');
  // forum / gallery 必须有各自专用分支（在动态组件之后）
  // ⚠ 注意书写顺序：模板里是 `<MediaForumThread v-else-if="postKind(...)==='forum'">`，
  //   组件名在条件**之前**，所以正则要允许"组件名先出现"。
  assert.match(s, /MediaForumThread[\s\S]{0,200}v-else-if="postKind\(detailPost\) === 'forum'"/,
    '必须有 forum 专用分支（MediaForumThread）');
  // KIND_COMPONENT 里不得含 forum/gallery（它们走专用分支，不走进动态组件）
  const m = s.match(/const KIND_COMPONENT = \{([^}]*)\}/);
  assert.ok(m, '应能取到 KIND_COMPONENT');
  assert.ok(!/forum/.test(m[1]), 'KIND_COMPONENT 不得含 forum（它会兜底到 MediaWeekly）');
  assert.ok(!/gallery/.test(m[1]), 'KIND_COMPONENT 不得含 gallery');
});

test('论坛楼层：赞/踩由服务端确定性生成（不让模型写）', () => {
  const s = read(path.join(BACK_SRC, 'services/mediaService.js'));
  const fn = s.slice(s.indexOf('export function normalizeForumDraft'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /r\.likes = base/, '楼层赞数必须由服务端派生');
  assert.match(body, /r\.dislikes = disputed/, '楼层踩数必须由服务端派生');
  // 楼层赞数必须随序号递减（真实论坛的观感），而不是随机乱给
  assert.match(body, /96 - idx \* 13|base = Math\.max/, '赞数应随楼层序号递减');
});

test('论坛楼层：前端必须展示赞/踩', () => {
  const s = read(path.join(WEB_SRC, 'components/media/MediaForumThread.vue'));
  assert.match(s, /mf-vote/, '必须有赞/踩的展示容器');
  assert.match(s, /r\.likes/, '必须渲染楼层赞数');
  assert.match(s, /r\.dislikes/, '必须渲染楼层踩数');
});

// ─────────────────────────────────────────────────────────
// A1 提级（数据层，需 DB；这里只钉前端登记）
// ─────────────────────────────────────────────────────────
test('A1：海原电视塔在前端登记为独立点位（提级后不再作为海原市的子项）', () => {
  const s = read(path.join(WEB_SRC, 'components/worldmap/MapPointView.vue'));
  assert.match(s, /{ n: '海原电视塔'/, '全域图应登记海原电视塔为独立点位');
  // 它必须出现在喜笑区（REGION_LAYOUT 的喜笑区段），而不是别的区
  const joy = s.slice(s.indexOf('喜笑区:'), s.indexOf('悲泣区:'));
  assert.match(joy, /海原电视塔/, '提级后应属于喜笑区');
});