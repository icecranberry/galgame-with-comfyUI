/**
 * 世界地图全域视图的点位登记 —— 静态回归。
 *
 * 守两类问题（都是实测踩过的）：
 *  ① **删掉的点位又出现在登记表里** —— 用户删了地图节点后，前端 `REGION_LAYOUT.spots`
 *     若还留着，会渲染成灰点（is-todo），看起来像"又冒出来了"。
 *  ② **同一节点被两个区块消费** —— 幻月秘庭移到「幻月」区块后，若悲泣区的
 *     `extras` 兜底没排除它，同一个节点会**渲染两次**（区块内 + 底部「自建子区」药丸）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC = path.join(path.resolve(__dirname, '../..'), 'web-ui/src');
const FILE = path.join(WEB_SRC, 'components/worldmap/MapPointView.vue');

function src() {
  return fs.readFileSync(FILE, 'utf8');
}

test('地图点位：用户已删的「寂灭空飨妖都」「坠星的摇篮」不得再登记（否则渲染成灰点）', () => {
  const s = src();
  // 只查 REGION_LAYOUT / MOON_LAYOUT 的登记区（注释里可以提到，但登记项不能有）
  const layoutBlock = s.slice(s.indexOf('const REGION_LAYOUT'), s.indexOf('const PLACE = {'));
  assert.ok(!/n:\s*'寂灭空飨妖都'/.test(layoutBlock), '寂灭空飨妖都 应从 REGION_LAYOUT 移除');
  assert.ok(!/n:\s*'坠星的摇篮'/.test(layoutBlock), '坠星的摇篮 应从 REGION_LAYOUT 移除');
});

test('地图点位：幻月秘庭必须登记在 MOON_LAYOUT（顶部居中区块），不在悲泣区', () => {
  const s = src();
  assert.match(s, /const MOON_LAYOUT\s*=/, '必须有 MOON_LAYOUT（幻月区块）');
  const moonBlock = s.slice(s.indexOf('const MOON_LAYOUT'), s.indexOf('const PLACE = {'));
  assert.match(moonBlock, /n:\s*'幻月秘庭'/, '幻月秘庭 必须登记在 MOON_LAYOUT');

  // 悲泣区的 spots 里不应再有幻月秘庭 —— 精确切「悲泣区: { … }」这一段
  // （不能用 `}\n}` 兜，那会越过 MOON_LAYOUT 的边界）
  const griefStart = s.indexOf('悲泣区:');
  const griefEnd = s.indexOf('MOON_LAYOUT');
  const griefBlock = s.slice(griefStart, griefEnd);
  assert.ok(!/n:\s*'幻月秘庭'/.test(griefBlock), '幻月秘庭 不应再出现在悲泣区');
});

test('地图点位：extras 兜底必须排除幻月区块已消费的节点（防同一节点渲染两次）', () => {
  const s = src();
  // 找到 extras 那一行的完整语句（正则不能写 `[^)]*` —— 过滤体里有 `moonUsed.has(...)` 的括号）
  const line = s.split('\n').find(l => l.includes('const extras = areas.value.filter'));
  assert.ok(line, '应能找到 extras 的 filter 语句');
  assert.match(line, /moonUsed/, 'extras 必须排除 moonUsed —— 否则幻月秘庭会重复渲染');
});

test('地图点位：幻月区块必须排在两翼之上（WINGS_Y > moon 底边）', () => {
  const s = src();
  assert.match(s, /const WINGS_Y = moonY \+ moonH \+ GAP/, '两翼 Y 必须由幻月区块底部推导（保证在其下方）');
  // 双翼坐标不能再直接用 ROW1_Y
  assert.ok(!/y: ROW1_Y, w: colW/.test(s), '两翼不应再直接使用 ROW1_Y');
});

test('地图点位：幻月区块有独立渲染分支与样式', () => {
  const s = src();
  assert.match(s, /g\.type === 'moon'/, '模板必须有 moon 区块分支');
  assert.match(s, /\.mpt-moon\b/, '必须有 .mpt-moon 样式');
  assert.match(s, /mpt-wing-name is-moon/, '必须有 is-moon 标题样式');
});