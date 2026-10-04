/**
 * 本地补丁回归测试
 *
 * 这几条是**看板引用为验收证据**的判据，必须能反复跑（不能只留一次性脚本）。
 * 只放**确定性、无 LLM、无网络**的部分 —— 需要真实模型或真实出刊的检查
 * （如换装标注的"专注修复"、门户出刊）留在 `docs/验证记录/` 的一次性记录里。
 *
 * 对应看板事项：
 *   · 地图页 / 导出（任意层级与任意层的生活地点）
 *   · 外观分层（身体唯一真源 / 兜底不落裸体 / 睡眠硬规则）
 *   · 提示词质量（世界观例句段裁剪）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { getDb } from '../src/db/index.js';
import { adaptWorldText } from '../src/db/worldRepository.js';
import {
  createMap, addPlace, upsertPlace, deletePlace, deleteMap, exportMarkdown,
} from '../src/services/worldMapService.js';
import {
  composeOutfitText, listSceneOutfits, upsertSceneOutfits,
  getSceneOutfitForNow, ensureOutfitAnnotations, planOutfitTargets, PRIVATE_SCENE, OUTFIT_SCENES,
  NUDE_DESCRIPTION,
} from '../src/services/outfitScene.js';
import {
  OUTLET_LAYOUTS, createOutlet, updateOutlet, deleteOutlet, getOutlet, listOutlets,
} from '../src/services/mediaService.js';
import { getLocalDateKey, shiftDateKey } from '../src/utils/localDate.js';

const db = getDb();
const CID = 99901;   // 专用测试角色，避免与真实数据相撞

function cleanup() {
  db.prepare('DELETE FROM character_outfits WHERE character_id = ?').run(CID);
  db.prepare('DELETE FROM daily_schedules WHERE character_id = ?').run(CID);
  try { db.prepare('DELETE FROM characters WHERE id = ?').run(CID); } catch { }
}
function makeChar() {
  cleanup();
  db.prepare('INSERT INTO characters (id, name, display_name, base_prompt) VALUES (?,?,?,?)')
    .run(CID, '__zz_regress', '__zz_regress', '## 人设\n回归测试\n\n## 你的外观\nlong black hair, red eyes, wearing a white shirt');
  const BODY = 'long black hair, red eyes, fair skin';
  upsertSceneOutfits(CID, [
    { scene: 'nude', name: '裸体', description: 'completely nude, wearing no clothing at all, bare skin visible', body: BODY },
    { scene: 'work', name: '工作装', description: 'black blazer, white shirt', body: BODY },
    { scene: 'casual', name: '便装', description: 'hoodie, jeans', body: BODY },
    { scene: 'home', name: '居家服', description: 'grey tee, shorts', body: BODY },
    { scene: 'sleep', name: '睡衣', description: 'white camisole, barefoot', body: BODY },
  ]);
  return BODY;
}
const atHour = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return getSceneOutfitForNow(CID, d); };

// ─────────────────────────────────────────────────────────
// 外观分层
// ─────────────────────────────────────────────────────────

test('外观五态：枚举含裸体，且 work 已改名为「常服」', () => {
  assert.equal(OUTFIT_SCENES.length, 5);
  assert.ok(OUTFIT_SCENES.some(s => s.key === PRIVATE_SCENE));
  assert.equal(OUTFIT_SCENES.find(s => s.key === 'work').label, '常服');
});

test('composeOutfitText：身体 + 服装；裸体那套只留身体', () => {
  assert.equal(composeOutfitText('long black hair', 'a red coat'), 'long black hair, a red coat');
  // 裸体套的 description 是「没穿衣服」的声明，拼出来仍以身体为主
  assert.equal(
    composeOutfitText('long black hair', 'completely nude, wearing no clothing'),
    'long black hair, completely nude, wearing no clothing',
  );
  // 只有一边时不产生多余逗号
  assert.equal(composeOutfitText('long black hair', ''), 'long black hair');
  assert.equal(composeOutfitText('', 'a red coat'), 'a red coat');
});

test('身体是五套共用的单一真源（注入文本各自以同一段身体开头）', () => {
  const BODY = makeChar();
  const list = listSceneOutfits(CID);
  assert.equal(new Set(list.map(o => String(o.body).trim())).size, 1, 'body 应只有一份');
  for (const o of list) assert.ok(o.text.startsWith(BODY), `${o.scene} 的注入文本应以身体开头`);
  cleanup();
});

test('睡眠硬规则优先于日程标注的裸体；裸体只在被标注的时段生效', () => {
  makeChar();
  const sched = [
    { startTime: '00:00', endTime: '07:00', activity: '睡觉', location: '自家卧室', replyDelay: -1, outfit: '裸体' },
    { startTime: '07:00', endTime: '08:00', activity: '淋浴', location: '自家浴室', replyDelay: 0, outfit: '裸体' },
    { startTime: '08:00', endTime: '09:00', activity: '在家', location: '自家客厅', replyDelay: 0, outfit: '居家服' },
    { startTime: '09:00', endTime: '18:00', activity: '上班', location: '公司', replyDelay: 0, outfit: '工作装' },
  ];
  db.prepare(`INSERT OR REPLACE INTO daily_schedules (character_id, schedule_date, schedule_json)
    VALUES (?, date('now','localtime'), ?)`).run(CID, JSON.stringify(sched));

  // 睡眠段即使日程标了裸体，也必须穿睡衣（硬规则）
  assert.equal(atHour(2)?.scene, 'sleep', '02:00 应被睡眠硬规则覆盖为睡衣');
  assert.equal(atHour(7)?.scene, PRIVATE_SCENE, '07:00 淋浴应为裸体');
  assert.equal(atHour(8)?.scene, 'home', '08:00 洗完后应为居家');
  assert.equal(atHour(12)?.scene, 'work', '12:00 上班应为常服');
  cleanup();
});

test('无日程时兜底不落裸体（否则角色会上街裸体）', () => {
  makeChar();
  db.prepare('DELETE FROM daily_schedules WHERE character_id = ?').run(CID);
  const fb = getSceneOutfitForNow(CID, new Date());
  assert.ok(fb, '应有兜底结果');
  assert.notEqual(fb.scene, PRIVATE_SCENE, '兜底不得落到裸体');
  cleanup();
});

test('换装点充足时直接放行 —— 不触发修复（否则每次生成都白跑一次 LLM）', async () => {
  makeChar();
  const good = [
    { startTime: '00:00', endTime: '07:00', activity: '睡觉', location: '自家卧室', replyDelay: -1, outfit: '睡衣' },
    { startTime: '07:00', endTime: '08:00', activity: '起床', location: '自家浴室', replyDelay: 0, outfit: '居家服' },
    { startTime: '08:00', endTime: '12:00', activity: '上班', location: '公司', replyDelay: 0, outfit: '工作装' },
    { startTime: '12:00', endTime: '13:00', activity: '回家午饭', location: '自家客厅', replyDelay: 0, outfit: '居家服' },
    { startTime: '13:00', endTime: '18:00', activity: '再出门', location: '公司', replyDelay: 0, outfit: '工作装' },
    { startTime: '19:00', endTime: '22:00', activity: '回家', location: '自家客厅', replyDelay: 0, outfit: '居家服' },
  ];
  const r = await ensureOutfitAnnotations(good, CID);
  assert.equal(r.repaired, false);
  assert.equal(r.reason, 'ok');
  assert.equal(r.schedule.length, good.length, '放行时不应改动原数组');
  cleanup();
});

// ─────────────────────────────────────────────────────────
// 反推目标的计算（纯函数，不需 LLM）
// ─────────────────────────────────────────────────────────

test('planOutfitTargets：只有「有服装描述」的才算已填，带了 body 不算', () => {
  const B = 'long wavy crimson red hair, red eyes, slender figure';
  // 旧前端会把 body 附在每一条上；若把"带 body"当已填，目标会被剔空 → 点了没反应
  const loose = [
    { scene: 'nude', body: B, description: '' },
    { scene: 'work', body: B, description: 'black blazer' },
    { scene: 'casual', body: B, description: 'hoodie' },
    { scene: 'home', body: B, description: '' },
    { scene: 'sleep', body: B, description: '' },
  ];
  assert.deepEqual(
    planOutfitTargets(loose, ['nude', 'home', 'sleep']),
    ['home', 'sleep'],
    '带 body 的空套必须仍算作待生成目标（否则反推静默返回空）；裸体不算目标',
  );
});

test('planOutfitTargets：已填的那些会被排除；全空则返回四套（不含裸体）', () => {
  assert.deepEqual(planOutfitTargets([{ scene: 'work', description: 'x' }], ['work', 'home']), ['home']);
  // 一套都没填（只给了身体，走 baseAppearance）→ 四套全生成
  const FOUR = ['work', 'casual', 'home', 'sleep'];
  assert.deepEqual(planOutfitTargets([], []), FOUR);
  assert.deepEqual(planOutfitTargets([{ scene: 'work', body: 'b', description: '' }], []), FOUR);
});

test('planOutfitTargets：裸体永远不是生成目标（即使被显式要求）', () => {
  // 它的描述是系统常量，让 LLM 生成纯属浪费、还可能把常量写坏
  assert.deepEqual(planOutfitTargets([], ['nude']), ['work', 'casual', 'home', 'sleep']);
  assert.deepEqual(planOutfitTargets([], ['nude', 'home']), ['home']);
  assert.deepEqual(planOutfitTargets([{ scene: 'home', description: 'x' }], ['nude', 'sleep']), ['sleep']);
});

test('planOutfitTargets：忽略非法场景名，且全部已填时返回空', () => {
  assert.deepEqual(planOutfitTargets([], ['不存在的场景', 'home']), ['home']);
  const allFilled = ['nude', 'work', 'casual', 'home', 'sleep'].map(s => ({ scene: s, description: 'x' }));
  assert.deepEqual(planOutfitTargets(allFilled, []), []);
});

// ─────────────────────────────────────────────────────────
// 裸体是「系统维护的常量」——不提供输入，且能自愈
// ─────────────────────────────────────────────────────────

test('裸体：写入时描述一律规范化成常量（自愈空描述）', () => {
  makeChar();
  // 模拟"界面把裸体传了空描述"——曾经就是这样把姬子的裸体行存成空串，
  // 注入里没了「裸体」声明，模型会照基础外观把衣服画上
  upsertSceneOutfits(CID, [{ scene: 'nude', name: '裸体', description: '' }]);
  let nude = listSceneOutfits(CID).find(o => o.scene === 'nude');
  assert.equal(nude.description, NUDE_DESCRIPTION, '空描述必须被规范化为常量');

  // 传别的内容也一样以常量为准（不接受自定义）
  upsertSceneOutfits(CID, [{ scene: 'nude', name: '裸体', description: '随便写的别的' }]);
  nude = listSceneOutfits(CID).find(o => o.scene === 'nude');
  assert.equal(nude.description, NUDE_DESCRIPTION);
  cleanup();
});

test('裸体：调用方不传它时也会自动补齐那一行（日程标注要靠它匹配）', () => {
  cleanup();
  db.prepare('INSERT INTO characters (id, name, display_name, base_prompt) VALUES (?,?,?,?)')
    .run(CID, '__zz_regress_nude', '__zz_regress_nude', '## 人设\nx\n\n## 你的外观\nlong black hair');
  // 只写四套，故意不带 nude —— 前端现在就是这样（裸体不再参与输入）
  upsertSceneOutfits(CID, [
    { scene: 'work', name: '工作装', description: 'black blazer', body: 'long black hair' },
    { scene: 'casual', name: '便装', description: 'hoodie', body: 'long black hair' },
    { scene: 'home', name: '居家服', description: 'grey tee', body: 'long black hair' },
    { scene: 'sleep', name: '睡衣', description: 'camisole, barefoot', body: 'long black hair' },
  ]);
  const list = listSceneOutfits(CID);
  const nude = list.find(o => o.scene === 'nude');
  assert.ok(nude, '裸体行必须被自动补齐 —— 否则日程标的「裸体」匹配不上');
  assert.equal(nude.description, NUDE_DESCRIPTION);
  assert.equal(nude.name, '裸体', '默认名要与日程标注口径一致');
  assert.equal(nude.body, 'long black hair', 'body 应从该角色已有行继承（五套共用）');
  cleanup();
});

// ─────────────────────────────────────────────────────────
// 提示词质量：世界观例句段裁剪
// ─────────────────────────────────────────────────────────

test('adaptWorldText：裁掉「## 人们的行为」整段，保留规则性章节', () => {
  const src = [
    '# 世界', '',
    '## 深层逻辑', '这条规则必须保留。', '',
    '## 人们的行为', '锅比我会撑，你比我敢写。', '报数报到三十七了。', '',
    '## 社会基调', '这条也要保留。',
  ].join('\n');
  const out = adaptWorldText(src);
  assert.ok(!out.includes('锅比我会撑'), '例句段应被裁掉');
  assert.ok(!out.includes('报数报到'), '例句段应被裁掉');
  assert.ok(out.includes('这条规则必须保留'), '规则章节应保留');
  assert.ok(out.includes('这条也要保留'), '社会基调应保留');
});

test('adaptWorldText：没有该段时原样返回（不误伤）', () => {
  const src = '# 世界\n\n## 深层逻辑\n只这一节。\n';
  assert.equal(adaptWorldText(src), src);
});

// ─────────────────────────────────────────────────────────
// 网络（媒体）页：产物形态
// ─────────────────────────────────────────────────────────

test('媒体形态：只提供 社交平台(feed) / 数字报刊(portal) 两种，且各有说明', () => {
  assert.equal(OUTLET_LAYOUTS.length, 2);
  assert.deepEqual(OUTLET_LAYOUTS.map(l => l.key), ['feed', 'portal']);
  for (const l of OUTLET_LAYOUTS) {
    assert.ok(l.label && l.hint, `${l.key} 应有 label 与 hint`);
  }
});

test('媒体形态：新建时可指定；未指定/非法都回落 feed（兼容旧调用方）', () => {
  const nameOf = (n) => `__zz_layout_${n}`;
  const made = [];
  try {
    const portal = createOutlet({ name: nameOf('portal'), prompt: '测试提示词', layout: 'portal' });
    made.push(portal.id);
    assert.equal(portal.layout, 'portal', '显式传 portal 应存下来');

    const feed = createOutlet({ name: nameOf('feed'), prompt: '测试提示词', layout: 'feed' });
    made.push(feed.id);
    assert.equal(feed.layout, 'feed');

    const none = createOutlet({ name: nameOf('none'), prompt: '测试提示词' });
    made.push(none.id);
    assert.equal(none.layout, 'feed', '未传应回落 feed');

    const bad = createOutlet({ name: nameOf('bad'), prompt: '测试提示词', layout: '不存在的形态' });
    made.push(bad.id);
    assert.equal(bad.layout, 'feed', '非法值应回落 feed');
  } finally {
    for (const id of made) { try { deleteOutlet(id); } catch { } }
  }
});

test('媒体形态：可改，且列表接口带回 layout（前端据此选渲染组件）', () => {
  let id = null;
  try {
    const o = createOutlet({ name: '__zz_layout_edit', prompt: '测试提示词', layout: 'feed' });
    id = o.id;
    assert.equal(getOutlet(id).layout, 'feed');
    const up = updateOutlet(id, { layout: 'portal' });
    assert.equal(up.layout, 'portal', '改形态应生效');
    // 列表里也要带上（否则前端无法分辨）
    const row = listOutlets().find(x => x.id === id);
    assert.equal(row.layout, 'portal');
  } finally {
    if (id) { try { deleteOutlet(id); } catch { } }
  }
});

// ─────────────────────────────────────────────────────────
// 日期算术：必须与 getLocalDateKey 同源（别用 SQL 的 now）
// ─────────────────────────────────────────────────────────

test('shiftDateKey：纯日历算术，跨月/跨年/闰日都正确', () => {
  assert.equal(shiftDateKey('2026-10-05', -2), '2026-10-03');
  assert.equal(shiftDateKey('2026-10-01', -2), '2026-09-29', '跨月');
  assert.equal(shiftDateKey('2026-01-01', -2), '2025-12-30', '跨年');
  assert.equal(shiftDateKey('2024-03-01', -1), '2024-02-29', '闰年 2 月');
  assert.equal(shiftDateKey('2026-10-05', 0), '2026-10-05');
  assert.equal(shiftDateKey('2026-10-05', 30), '2026-11-04');
  // 非法输入原样返回，不抛错
  assert.equal(shiftDateKey('', -2), '');
  assert.equal(shiftDateKey('不是日期', -2), '不是日期');
});

test('shiftDateKey：不受 fake timers 影响（只用 UTC 算术，不读当前时间）', (t) => {
  // 与 eventSchedule 那组测试同样的场景：Date 被 mock 到别的日期
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-02T03:00:00').getTime() });
  // 若实现里读了"当前时间"或本机时区，这里就会算错
  assert.equal(shiftDateKey('2026-10-02', -2), '2026-09-30');
  // 且它不依赖 getLocalDateKey 的 mock 行为
  assert.equal(getLocalDateKey(), '2026-10-02', '（对照）getLocalDateKey 确实受 mock 影响');
});

test('exportMarkdown：支持任意层级，且导出非叶节点自己带的生活地点', () => {
  const mid = createMap({ name: '__zz_regress_map', note: '回归测试' }).id;
  try {
    const l1 = addPlace(mid, { name: '一级' });
    const l2 = addPlace(mid, { parentId: l1.place.id, name: '二级' });
    const l3 = addPlace(mid, { parentId: l2.place.id, name: '三级' });
    const l4 = addPlace(mid, { parentId: l3.place.id, name: '四级' });
    addPlace(mid, { parentId: l4.place.id, name: '五级' });
    // 生活地点挂在**子地区**上（该节点本身是条街/市集，没有下级）——
    // 这正是原先硬编码三层循环时会被丢掉的情形
    upsertPlace(l2.place.id, { pois: [{ name: '续命一刻', type: '餐饮', blurb: '早八咖啡' }] });

    const md = exportMarkdown(mid);
    assert.ok(md.includes('一级') && md.includes('二级') && md.includes('三级'), '前三层应导出');
    assert.ok(md.includes('四级') && md.includes('五级'), '第 4、5 层也应导出（原为硬编码三层，会丢）');
    assert.ok(md.includes('续命一刻'), '子地区自己的生活地点应导出（原会丢）');

    // 删除父节点应级联删掉整棵子树
    deletePlace(l1.place.id);
    assert.equal(getDb().prepare('SELECT COUNT(*) n FROM world_map_places WHERE map_id = ?').get(mid).n, 0);
  } finally {
    deleteMap(mid);
  }
});
