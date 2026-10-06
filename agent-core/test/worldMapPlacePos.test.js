/**
 * 地图点位坐标落库 —— 回归测试
 *
 * 用户反馈（2026-10-06）：「被拖动过的点位不能保存最后点位的坐标，对 LLM 计算距离造成阻碍」。
 *
 * 原实现只写 localStorage['linshe.worldmap.pointLayout'] —— **只有本机浏览器看得见**，
 * 后端与 LLM 完全读不到。现在改为落库到 `world_map_places.pos_x / pos_y`。
 *
 * 本测试钉住几条易回退的语义：
 *   · `-1` 是"未摆放"哨兵（不能用 0 —— 0 是合法的左上角坐标）
 *   · 写入必须能持久（重读一致），否则等于没修
 *   · 坐标夹紧到 0~1，非法值不污染既有数据
 *   · 未传 pos_* 的普通更新**不得**把已有坐标清掉（最容易踩的回归）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = path.join(os.tmpdir(), `linshe-pos-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TMP;
globalThis.fetch = async url => { throw new Error(`pos test forbids network: ${url}`); };

const { getDb } = await import('../src/db/index.js');
const { addPlace, upsertPlace, getMap } = await import('../src/services/worldMapService.js');

const db = getDb();
// 建一张最小地图
db.prepare('INSERT INTO world_maps (id, name) VALUES (?, ?)').run(9001, '测试图');

test('坐标字段已随迁移创建（-1 为未摆放哨兵）', () => {
  const cols = db.prepare('PRAGMA table_info(world_map_places)').all().map(c => c.name);
  assert.ok(cols.includes('pos_x') && cols.includes('pos_y'), 'pos_x/pos_y 必须存在');
});

const A = addPlace(9001, { name: '测试地点甲' });
const B = addPlace(9001, { name: '测试地点乙' });

test('新地点默认未摆放（-1），不是 0', () => {
  const row = db.prepare('SELECT pos_x, pos_y FROM world_map_places WHERE id = ?').get(A.place.id);
  assert.equal(row.pos_x, -1);
  assert.equal(row.pos_y, -1);
});

test('★ 写入坐标必须持久（重读一致）', () => {
  upsertPlace(A.place.id, { pos_x: 0.321, pos_y: 0.654 });
  const row = db.prepare('SELECT pos_x, pos_y FROM world_map_places WHERE id = ?').get(A.place.id);
  assert.equal(row.pos_x, 0.321);
  assert.equal(row.pos_y, 0.654);
});

test('坐标夹紧到 0~1，负值视为未摆放', () => {
  upsertPlace(B.place.id, { pos_x: 5, pos_y: -3 });
  const row = db.prepare('SELECT pos_x, pos_y FROM world_map_places WHERE id = ?').get(B.place.id);
  assert.equal(row.pos_x, 1, '大于 1 应夹到 1');
  assert.equal(row.pos_y, -1, '负值应视为未摆放');
});

test('★ 不传 pos_* 的普通编辑不得清掉已有坐标（最易回退的点）', () => {
  upsertPlace(A.place.id, { summary: '只改简介' });
  const row = db.prepare('SELECT pos_x, pos_y, summary FROM world_map_places WHERE id = ?').get(A.place.id);
  assert.equal(row.pos_x, 0.321, '坐标必须原样保留');
  assert.equal(row.pos_y, 0.654);
  assert.equal(row.summary, '只改简介');
});

test('坐标随地图数据返回（LLM/前端都要能读到）', () => {
  const m = getMap(9001);
  const flat = m.map?.places || m.places || [];
  const hit = flat.find(p => p.id === A.place.id);
  assert.ok(hit, '地点应在返回里');
  assert.equal(hit.pos_x, 0.321);
  assert.equal(hit.pos_y, 0.654);
});

test('非法坐标（NaN/空串）不污染既有值', () => {
  upsertPlace(A.place.id, { pos_x: NaN, pos_y: '' });
  const row = db.prepare('SELECT pos_x, pos_y FROM world_map_places WHERE id = ?').get(A.place.id);
  assert.equal(row.pos_x, 0.321, 'NaN 应保持原值');
  assert.equal(row.pos_y, 0.654, '空串应保持原值');
});

test.after(() => { try { db.close(); } catch {} try { fs.unlinkSync(TMP); } catch {} });