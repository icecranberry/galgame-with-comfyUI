/**
 * 「人工编辑服装不被自动护栏改写」——回归测试。
 *
 * 用户实报（2026-10-07）：
 *   「玩家人工修改了绯英的**睡衣**，但是点击保存以后**自动刷新为原文段**。」
 *
 * ── 根因（已实测复现）──────────────────────────────────────
 * `PUT /api/characters/:id/outfits/scene` → `upsertSceneOutfits` → `normalizeGarment`
 * → `enforceSceneFootwear`：后者是给 **AI 产出**兜底的脚部护栏
 * （睡衣＝删掉所有含鞋的段、强制追加 `, barefoot`；居家＝换成拖鞋）。
 * 但它**无差别作用在人工编辑上**：用户在睡衣里写了 `boots`，
 * 保存时整段被删、再补 `, barefoot` —— 用户看到的正是"保存后变回原样"。
 * 实测：444 字输入 → 394 字输出，`boots` 消失。
 *
 * ── 本测试守的核心不变量 ─────────────────────────────────
 * ① **人工编辑通道必须原样落库**（不过任何自动护栏）；
 * ② **AI 产出通道必须仍然过护栏**（不能因为修 bug 把护栏一起废掉）；
 * ③ 两条通道由**显式参数**区分，不靠"猜内容像不像 AI 写的"。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TMP = path.join(os.tmpdir(), `linshe-outfit-guard-${Date.now()}.db`);
process.env.DB_PATH = TMP;
globalThis.fetch = async url => { throw new Error(`outfit guard test forbids network: ${url}`); };

// ⚠ 必须用 fileURLToPath —— 直接拿 `new URL(...).pathname` 在 Windows 上会得到
//   `/E:/xxx`，拼上盘符后变成 `E:\E:\xxx`（实测踩过）。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');
const svc = fs.readFileSync(path.join(SRC, 'services/outfitScene.js'), 'utf8');
const routeSrc = fs.readFileSync(path.join(SRC, 'routes/characters.js'), 'utf8');

const { enforceSceneFootwear } = await import('../src/services/outfitScene.js');

/** 用户截图里那段（睡衣 + boots）—— 修复前会被护栏改写 */
const USER_EDITED_SLEEP = 'a white long-sleeved collared blouse with a red ribbon bow at the neck and a black geometric chest ornament, a dark navy pleated skirt with a black waist belt bearing a round gold buckle, pink ribbon laces and a pink rabbit-shaped charm hanging at the hip, a black thigh strap with gold studs on the left leg, a red and black cape draped over the shoulders, and black lace-up platform boots with white floral accents, black bows and red straps.';

// ─────────────────────────────────────────────────────────
// ① 人工编辑通道：原样落库
// ─────────────────────────────────────────────────────────

test('★★★ 人工保存必须传 humanEdited（这是"原样落库"的唯一开关）', () => {
  // 找 PUT /:id/outfits/scene 路由体内的调用
  const hit = routeSrc.match(/router\.put\(\s*'\/:id\/outfits\/scene'[\s\S]*?\n\}\);/);
  assert.ok(hit, '应能定位 outfits/scene 的 PUT 路由');
  assert.match(hit[0], /upsertSceneOutfits\([^)]*humanEdited:\s*true/,
    '人工编辑通道必须显式传 humanEdited: true —— 否则用户的文字会被脚部护栏改写');
});

test('★★★ AI 生成通道**不得**传 humanEdited（否则护栏被废掉）', () => {
  const hit = routeSrc.match(/router\.post\(\s*'\/:id\/outfits\/generate'[\s\S]*?\n\}\);/);
  assert.ok(hit, '应能定位 outfits/generate 路由');
  assert.match(hit[0], /upsertSceneOutfits\(char\.id,\s*outfits\)/,
    'AI 产出应走默认通道（过护栏）');
  assert.ok(!/humanEdited/.test(hit[0]), 'AI 通道不应传 humanEdited');
});

test('★★★ 护栏函数本身不得被删除（它对 AI 产出仍然必要）', () => {
  assert.match(svc, /export function enforceSceneFootwear/, '护栏必须保留 —— 只是不再作用于人工编辑');
  // 且它仍在 normalizeGarment 的 AI 分支里被调用
  const fn = svc.match(/function normalizeGarment\([\s\S]*?\n\}/)?.[0] || '';
  assert.ok(fn, '应能截出 normalizeGarment');
  assert.match(fn, /humanEdited/, 'normalizeGarment 必须接受 humanEdited 开关');
  assert.match(fn, /enforceSceneFootwear\(scene, d\)/, 'AI 分支仍应调用护栏');
});

test('★★★ humanEdited 必须是**显式参数**，不能靠内容猜', () => {
  // 反面做法（容易被后人"优化"出来）：按文本里有没有 barefoot/boot 判断是谁写的 —— 不可靠。
  const fn = svc.match(/export function upsertSceneOutfits\([\s\S]*?\n\}/)?.[0] || '';
  assert.ok(fn, '应能截出 upsertSceneOutfits');
  assert.match(fn, /opts\s*=\s*\{\}/, '应有 opts 参数');
  assert.match(fn, /humanEdited\s*===\s*true/, '应显式读 humanEdited，而不是推断');
});

// ─────────────────────────────────────────────────────────
// ② 行为验证：护栏本身的行为未被改变
// ─────────────────────────────────────────────────────────

test('★★ 行为：护栏对"睡衣含靴子"确实会改写（说明它真的在起作用）', () => {
  const out = enforceSceneFootwear('sleep', USER_EDITED_SLEEP);
  assert.notEqual(out, USER_EDITED_SLEEP, '护栏应当改写它 —— 这就是必须绕过的原因');
  assert.ok(!/boot/i.test(out), '睡衣里的靴子段应被移除（护栏的设计意图）');
  assert.match(out, /barefoot/, '应强制补上 barefoot');
});

test('★★ 行为：已经合规的睡衣描述不再被改写（幂等）', () => {
  const ok = 'a thin silk camisole and soft shorts, barefoot';
  assert.equal(enforceSceneFootwear('sleep', ok), ok, '合规内容不应被改动');
});

test('★ 行为：空值原样返回（护栏不得凭空造内容）', () => {
  assert.equal(enforceSceneFootwear('sleep', ''), '');
  assert.equal(enforceSceneFootwear('home', null), null);
  assert.equal(enforceSceneFootwear('sleep', undefined), undefined);
});

test('★ 行为：非 home/sleep 场景不受护栏影响（work/casual 原样）', () => {
  const work = 'a blouse and skirt, black lace-up platform boots with white floral accents';
  assert.equal(enforceSceneFootwear('work', work), work, 'work 场景不应被动');
  assert.equal(enforceSceneFootwear('casual', work), work, 'casual 场景不应被动');
});

// ─────────────────────────────────────────────────────────
// ③ 防回退：注释里写明这条约束（后人改代码前能看到）
// ─────────────────────────────────────────────────────────

test('★★ 代码注释必须写明"护栏不得作用于人工编辑"（防再次踩坑）', () => {
  assert.match(svc, /不能作用于人工编辑|不该替人做决定|不是替人做决定/,
    'enforceSceneFootwear 附近应写明这条约束');
  assert.match(svc, /人工编辑（不过|人工编辑通道|humanEdited/,
    'upsertSceneOutfits 应说明两条通道的区别');
});