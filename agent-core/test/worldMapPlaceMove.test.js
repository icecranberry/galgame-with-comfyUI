import { test } from 'node:test';
import assert from 'node:assert/strict';

// 世界地图「移动地点」——`upsertPlace` 支持改 `parent_id`。
//
// 背景：早先 `upsertPlace` 的白名单只有 name/name_en/kind/summary/pois，
// **改不了 parent_id**，所以「把地点挪到另一个父级下」在界面上根本做不到
// （实测踩过：以为改了归属、其实没动）。这条能力是重构
// 「星穹列车 → 3 个车厢 → 人物房间」的前提。
//
// 移动不是改一列就完事，必须一起处理：
//   ① `level` 是冗余列（列表排序、大区/子区/场景计数都吃它）→ 整棵子树要按位移量重算
//   ② 必须防成环 —— 把父节点挪进自己的子孙里，那棵子树会从树上消失，
//      用户看到"地点凭空不见了"，而且再也点不回来（比报错严重得多）

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`worldMapPlaceMove test forbids network: ${url}`); };

const svc = await import('../src/services/worldMapService.js');
const { getDb } = await import('../src/db/index.js');

/** 建一张测试地图：A → A1 → A1a；B */
function seedMap() {
  const m = svc.createMap({ name: '__zz_move_map' });
  const A = svc.addPlace(m.id, { name: 'A' }).place;
  const A1 = svc.addPlace(m.id, { parentId: A.id, name: 'A1' }).place;
  const A1a = svc.addPlace(m.id, { parentId: A1.id, name: 'A1a' }).place;
  const B = svc.addPlace(m.id, { name: 'B' }).place;
  return { map: m, A, A1, A1a, B };
}

/** 辅助：接受 place 对象或 id 都行（测试里两种写法混着用，统一在这里收口） */
function pid(v) { return v && typeof v === 'object' ? v.id : v; }
function nameOf(v) {
  return getDb().prepare('SELECT name FROM world_map_places WHERE id = ?').pluck().get(pid(v));
}
function parentOf(v) {
  return getDb().prepare('SELECT parent_id FROM world_map_places WHERE id = ?').pluck().get(pid(v));
}
function levelOf(v) {
  return getDb().prepare('SELECT level FROM world_map_places WHERE id = ?').pluck().get(pid(v));
}
function cleanup(mapId) {
  getDb().prepare('DELETE FROM world_maps WHERE id = ?').run(mapId);
}

test('移动：把 A1（带子级 A1a）挪到 B 下，两者 level 一起 +1', () => {
  const { map, A1, A1a, B } = seedMap();
  try {
    assert.equal(levelOf(A1), 2);
    assert.equal(levelOf(A1a), 3);

    const r = svc.upsertPlace(A1.id, { parentId: B.id });
    assert.equal(r.ok, true);
    assert.equal(parentOf(A1.id), B.id);
    assert.equal(levelOf(A1), 2, 'B 还是 lv1，A1 仍是 lv2（层级没变）');

    // 换个真正的深度变化：把 A1 提到顶层
    svc.upsertPlace(A1.id, { parentId: null });
    assert.equal(levelOf(A1), 1, 'A1 升为顶层 → lv1');
    assert.equal(levelOf(A1a), 2, '★ 子树 A1a 必须跟着减 1（3 → 2）');
  } finally { cleanup(map.id); }
});

test('移动：深层嵌套整棵子树都跟着位移（不是只改一层）', () => {
  const { map, A, B } = seedMap();
  const d1 = svc.addPlace(map.id, { parentId: B.id, name: 'D1' }).place;
  const d2 = svc.addPlace(map.id, { parentId: d1.id, name: 'D2' }).place;
  const d3 = svc.addPlace(map.id, { parentId: d2.id, name: 'D3' }).place;
  try {
    assert.deepEqual([levelOf(d1), levelOf(d2), levelOf(d3)], [2, 3, 4]);
    // 把 D1 整棵挪到 A（lv1）下 —— A 也是 lv1，所以 level 不变；改挪到 A1 下才有变化
    const A1 = svc.addPlace(map.id, { parentId: A.id, name: 'A1x' }).place;
    svc.upsertPlace(d1.id, { parentId: A1.id });   // lv2 → lv3
    assert.equal(levelOf(d1), 3);
    assert.equal(levelOf(d2), 4);
    assert.equal(levelOf(d3), 5, '★ 第三层子级也要跟着动');
  } finally { cleanup(map.id); }
});

test('★ 防成环：不能把地点移动到自己的下级里', () => {
  const { map, A, A1, A1a } = seedMap();
  try {
    const r = svc.upsertPlace(A.id, { parentId: A1a.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /自己的下级/);
    // 什么都没变（事务回滚），树依然完整
    assert.equal(parentOf(A.id), null, '拒绝后 parent_id 不得被改动');
    assert.equal(levelOf(A1a), 3, '拒绝后子树 level 不得被改动');

    // 移到自己下也不行
    assert.equal(svc.upsertPlace(A.id, { parentId: A.id }).ok, false);
    void A1;
  } finally { cleanup(map.id); }
});

test('★ 防成环：子级挪到自己的直接父级下（无变化）必须放行', () => {
  const { map, A1, A } = seedMap();
  try {
    const r = svc.upsertPlace(A1.id, { parentId: A.id });
    assert.equal(r.ok, true, '同父级 = 无操作，不该报错');
    assert.equal(parentOf(A1.id), A.id);
  } finally { cleanup(map.id); }
});

test('移动：目标上级不存在 / 跨图 → 拒绝且不改动', () => {
  const { map, A1 } = seedMap();
  const other = svc.createMap({ name: '__zz_move_other' });
  const foreign = svc.addPlace(other.id, { name: '他图的节点' }).place;
  try {
    assert.equal(svc.upsertPlace(A1.id, { parentId: 99999999 }).ok, false);
    assert.equal(parentOf(A1.id), svc.getMap(map.id).places.find(p => p.name === 'A').id, '拒绝后不该被挪走');

    const cross = svc.upsertPlace(A1.id, { parentId: foreign.id });
    assert.equal(cross.ok, false, '不能把地点挪进另一张图');
    assert.match(cross.error, /不存在/);
  } finally { cleanup(map.id); cleanup(other.id); }
});

test('移动：parentId 传 "" / 0 / null 都当"提到顶层"', () => {
  const { map, A1 } = seedMap();
  try {
    for (const v of ['', 0, null]) {
      svc.upsertPlace(A1.id, { parentId: '1' });      // 先挪回 A（占位，parentId 会按 id 解析）
      const r = svc.upsertPlace(A1.id, { parentId: v });
      assert.equal(r.ok, true, `parentId=${JSON.stringify(v)} 应被视为顶层`);
      assert.equal(parentOf(A1.id), null);
      assert.equal(levelOf(A1.id), 1);
    }
  } finally { cleanup(map.id); }
});

test('移动后仍能改名（两个动作可在同一次调用里完成）', () => {
  const { map, A1, B } = seedMap();
  try {
    const r = svc.upsertPlace(A1.id, { parentId: B.id, name: '挪过来还改了名' });
    assert.equal(r.ok, true);
    assert.equal(r.place.name, '挪过来还改了名');
    assert.equal(parentOf(A1.id), B.id);
  } finally { cleanup(map.id); }
});

test('移动：新父级下排到最后（不插队，保持已有顺序）', () => {
  const { map, B, A1 } = seedMap();
  const e1 = svc.addPlace(map.id, { parentId: B.id, name: 'E1' }).place;
  const e2 = svc.addPlace(map.id, { parentId: B.id, name: 'E2' }).place;
  try {
    svc.upsertPlace(A1.id, { parentId: B.id });
    const kids = getDb().prepare(
      'SELECT name FROM world_map_places WHERE parent_id = ? ORDER BY sort_order, id'
    ).all(B.id).map(r => r.name);
    assert.deepEqual(kids, ['E1', 'E2', 'A1'], '搬家应追加到末尾');
    void e1; void e2;
  } finally { cleanup(map.id); }
});

test('移动后 getMap 的树结构与统计一致（level 冗余列没写坏）', async () => {
  const { map, A1, B } = seedMap();
  try {
    svc.upsertPlace(A1.id, { parentId: B.id });
    const m = svc.getMap(map.id);
    const b = m.tree.find(n => n.name === 'B');
    assert.deepEqual(b.children.map(c => c.name), ['A1']);
    assert.equal(b.children[0].children[0].name, 'A1a');
    // 统计按 level 算 —— 层级没写坏才对得上
    assert.equal(m.stats.region, m.places.filter(p => p.level === 1).length);
    assert.equal(m.stats.scene, m.places.filter(p => p.level === 3).length);
    assert.equal(m.stats.scene, 1, 'A1a 是唯一 lv3');
  } finally { cleanup(map.id); }
});

test('回归：不传 parentId 时行为逐字不变（纯改字段）', () => {
  const { map, A1 } = seedMap();
  const parentBefore = parentOf(A1.id);
  try {
    const r = svc.upsertPlace(A1.id, { name: '只改名', kind: '测试', summary: '简介' });
    assert.equal(r.ok, true);
    assert.equal(r.place.name, '只改名');
    assert.equal(r.place.kind, '测试');
    assert.equal(parentOf(A1.id), parentBefore, '没传 parentId 就不该动归属');
    assert.equal(nameOf(A1.id), '只改名');
  } finally { cleanup(map.id); }
});
