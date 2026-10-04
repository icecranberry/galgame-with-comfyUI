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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  OUTLET_LAYOUTS, ALL_LAYOUT_KEYS, MEDIA_CATEGORIES, CATEGORY_LAYOUTS,
  createOutlet, updateOutlet, deleteOutlet, getOutlet, listOutlets,
  isPeriodicalLayout, publishIssue, listIssues, listPosts, hasIssueToday, generateMediaBatch,
} from '../src/services/mediaService.js';
import { getLocalDateKey, shiftDateKey } from '../src/utils/localDate.js';

/** 仓库内两个源码根：后端 agent-core/src、前端 web-ui/src（静态卫生检查用） */
const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const WEB_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web-ui/src');

/** 递归列出某目录下全部源码文件（跳过 node_modules / 构建产物） */
function walkSrc(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkSrc(p, out);
    else if (/\.(js|vue)$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * 去掉源码里的注释（行注释、块注释、HTML 注释）。
 * 静态卫生检查必须只看**代码**：注释里正当地提到旧标识符名字（解释"这里改错过"）
 * 不该被判成违规 —— 否则要么误报、要么逼着大家不敢在注释里记教训。
 */
function stripComments(s) {
  return s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

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

test('媒体形态：社交平台(feed) / 数字报刊(portal) / 海报(poster)，且各有说明', () => {
  assert.deepEqual(OUTLET_LAYOUTS.map(l => l.key), ['feed', 'portal', 'poster']);
  for (const l of OUTLET_LAYOUTS) {
    assert.ok(l.label && l.hint, `${l.key} 应有 label 与 hint`);
  }
  // weekly 是历史形态：仍可写入（老数据），但不作为新建选项
  assert.ok(!OUTLET_LAYOUTS.some(l => l.key === 'weekly'));
});

test('isPeriodicalLayout：门户/海报/旧周刊都是「按期出刊」', () => {
  for (const k of ['portal', 'poster', 'weekly']) assert.equal(isPeriodicalLayout(k), true, k);
  for (const k of ['feed', '', null, undefined, 'x']) assert.equal(isPeriodicalLayout(k), false, String(k));
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
// 数字报刊：出刊 / 每日一刊 / 期简目
// ─────────────────────────────────────────────────────────

test('出刊：非「数字报刊」形态拒绝出刊，不静默什么都不做', async () => {
  let id = null;
  try {
    const o = createOutlet({ name: '__zz_issue_feed', prompt: '测试提示词', layout: 'feed' });
    id = o.id;
    await assert.rejects(() => publishIssue(id), /不是「按期出刊」的形态/);
  } finally {
    if (id) { try { deleteOutlet(id); } catch { } }
  }
});

test('出刊：媒体不存在时报 404 语义，而不是崩掉', async () => {
  await assert.rejects(() => publishIssue(99999999), /媒体不存在/);
});

test('期简目：只包含有期号的门户帖，且最新在前', () => {
  // 直接用 SQL 造两条门户帖与一条普通帖，核对 listIssues 的过滤与排序
  const db = getDb();
  const outlet = createOutlet({ name: '__zz_issue_list', prompt: '测试提示词', layout: 'portal' });
  const mk = (issue, title, written) => db.prepare(`
    INSERT INTO media_posts (outlet_id, batch_id, title, content, tags_json,
      author_type, author_name, likes, views, comments_json, payload_json, image_status)
    VALUES (?, 'b', ?, '', '[]', 'anonymous', 'x', 0, 0, '[]', ?, 'done')
  `).run(outlet.id, title, JSON.stringify({
    portal: true, issue, title, lead: '', views: 1,
    sections: [
      { key: 'a', name: 'A', lead: '', image: null, body: written ? [{ type: 'p', text: 'x' }] : null },
      { key: 'b', name: 'B', lead: '', image: null, body: null },
    ],
    credits: {},
  }));
  try {
    mk(1, '第一期', true);
    mk(2, '第二期', false);
    // 一条没有期号的（不该被列进来）
    db.prepare(`
      INSERT INTO media_posts (outlet_id, batch_id, title, content, tags_json,
        author_type, author_name, likes, views, comments_json, payload_json, image_status)
      VALUES (?, 'b', '无期号', '', '[]', 'anonymous', 'x', 0, 0, '[]', ?, 'done')
    `).run(outlet.id, JSON.stringify({ portal: true, title: 'x', sections: [] }));

    const list = listIssues(outlet.id);
    assert.equal(list.length, 2, '只列出有期号的那两条');
    assert.deepEqual(list.map(x => x.issue), [2, 1], '最新在前');
    assert.equal(list[0].written, 0, '第二期一块正文都没写');
    assert.equal(list[1].written, 1, '第一期写了 1 块');
    assert.equal(list[0].section_count, 2);
    assert.ok(list[0].post_id > list[1].post_id);
  } finally {
    db.prepare('DELETE FROM media_posts WHERE outlet_id = ?').run(outlet.id);
    try { deleteOutlet(outlet.id); } catch { }
  }
});

test('每日一刊的去重键：当天已出过就判定为「无需出刊」', () => {
  /**
   * 这里**刻意不调 maybeGenerateDailyIssues()** —— 那个函数在"今天还没出"时
   * 会真的出一刊（调 LLM + 写库），测试不该有这种副作用。
   * 改为直接验它的判据 `hasIssueToday`：这就是"每日一刊"不重复出刊的全部依据。
   */
  const db = getDb();
  const outlet = createOutlet({ name: '__zz_daily_issue', prompt: '测试提示词', layout: 'portal' });
  try {
    assert.equal(hasIssueToday(outlet.id), false, '还没出过 → 该出刊');

    // created_at 走 SQLite 的 CURRENT_TIMESTAMP（UTC），判定里两边都用 localtime 换算 → 算作今天
    db.prepare(`
      INSERT INTO media_posts (outlet_id, batch_id, title, content, tags_json,
        author_type, author_name, likes, views, comments_json, payload_json, image_status)
      VALUES (?, 'b', '第1期', '', '[]', 'anonymous', 'x', 0, 0, '[]', ?, 'done')
    `).run(outlet.id, JSON.stringify({ portal: true, issue: 1, title: '第1期', sections: [] }));

    assert.equal(hasIssueToday(outlet.id), true, '今天已出过 → 不再出刊（这就是"每日一刊"的去重）');

    // 把日期改到前天 → 又该出刊了（跨天恢复）
    db.prepare(`UPDATE media_posts SET created_at = DATETIME('now', '-2 days') WHERE outlet_id = ?`).run(outlet.id);
    assert.equal(hasIssueToday(outlet.id), false, '到了新的一天 → 重新可出刊');
  } finally {
    db.prepare('DELETE FROM media_posts WHERE outlet_id = ?').run(outlet.id);
    try { deleteOutlet(outlet.id); } catch { }
  }
});

// ─────────────────────────────────────────────────────────
// 分类过滤：三档互不串味（print / digital / social）
// ─────────────────────────────────────────────────────────

test('分类过滤：门户归「数字报刊」、海报/旧周刊归「官方传媒」、feed 归「社交平台」', () => {
  /**
   * ★ 这条测试守的是一个**真实踩过的坑**：
   *   `routes/media.js` 里分类白名单曾硬编码 `=== 'digital' || === 'social'`，
   *   新增的 `print` 落进 else → category 变成 null → **变成"不过滤"**，
   *   于是《狸狸通讯社》的门户帖整批混进了「官方传媒」那一档。
   *   白名单改为读 `MEDIA_CATEGORIES` 后修复；这里再从行为上钉一遍：
   *   每个分类只返回属于自己形态的刊物，且 category 为 null（「全部」标签）才不过滤。
   */
  const db = getDb();
  const mkPost = (outletId, title) => db.prepare(`
    INSERT INTO media_posts (outlet_id, batch_id, title, content, tags_json,
      author_type, author_name, likes, views, comments_json, image_status)
    VALUES (?, 'b', ?, '', '[]', 'anonymous', 'x', 0, 0, '[]', 'done')
  `).run(outletId, title).lastInsertRowid;

  const made = [];
  try {
    const portal = createOutlet({ name: '__zz_cat_portal', prompt: '测试提示词', layout: 'portal' });
    const poster = createOutlet({ name: '__zz_cat_poster', prompt: '测试提示词', layout: 'poster' });
    const feed = createOutlet({ name: '__zz_cat_feed', prompt: '测试提示词', layout: 'feed' });
    const weekly = createOutlet({ name: '__zz_cat_weekly', prompt: '测试提示词', layout: 'feed' });
    made.push(portal.id, poster.id, feed.id, weekly.id);
    // weekly 是历史形态：新建时不再提供，这里直接把库里的值改成它，模拟老数据
    db.prepare(`UPDATE media_outlets SET layout = 'weekly' WHERE id = ?`).run(weekly.id);

    const ids = {
      portal: Number(mkPost(portal.id, '门户')),
      poster: Number(mkPost(poster.id, '海报')),
      feed: Number(mkPost(feed.id, '帖子')),
      weekly: Number(mkPost(weekly.id, '旧周刊')),
    };
    // 只关心"我们自己造的这几条在不在结果里"，不受真实库里已有帖子的干扰
    const hits = (category) => {
      const set = new Set(listPosts({ category, limit: 100 }).posts.map(p => Number(p.id)));
      return Object.fromEntries(Object.keys(ids).map(k => [k, set.has(ids[k])]));
    };

    assert.deepEqual(hits('digital'), { portal: true, poster: false, feed: false, weekly: false }, 'digital');
    assert.deepEqual(hits('print'), { portal: false, poster: true, feed: false, weekly: true }, 'print');
    assert.deepEqual(hits('social'), { portal: false, poster: false, feed: true, weekly: false }, 'social');

    // 不传分类 = 「全部」标签 → 不过滤；未知分类同样回落"不过滤"（由路由白名单先行挡住）
    for (const cat of [null, undefined, '不存在的分类']) {
      const set = new Set(listPosts({ category: cat, limit: 100 }).posts.map(p => Number(p.id)));
      for (const id of Object.values(ids)) assert.ok(set.has(id), `category=${cat} 不应过滤掉任何形态`);
    }
  } finally {
    for (const id of made) {
      db.prepare('DELETE FROM media_posts WHERE outlet_id = ?').run(id);
      try { deleteOutlet(id); } catch { }
    }
  }
});

test('分类白名单与 service 同源：路由里不得再硬编码分类字面量', () => {
  const s = fs.readFileSync(path.join(SRC_DIR, 'routes/media.js'), 'utf8');
  assert.match(s, /MEDIA_CATEGORIES/, '分类白名单必须来自 services/mediaService.js');
  assert.match(s, /MEDIA_CATEGORIES\.includes\(/, '应按 MEDIA_CATEGORIES 判定，而不是逐个字面量比较');
  // 三档分类是前后端共用的契约，缺一档就会整档不过滤
  assert.deepEqual([...MEDIA_CATEGORIES].sort(), ['digital', 'print', 'social']);
});

// ─────────────────────────────────────────────────────────
// 前端源码卫生：改名漏改会产生 ReferenceError，整块 UI 静默消失
// ─────────────────────────────────────────────────────────

test('MediaView：用到的 activeIs* 计算属性都必须有定义', () => {
  /**
   * ★ 踩过的坑（正是本次"出刊与期号导航没有真实出现"的根因）：
   *   `activeIsPortal` 改名成 `activeIsPeriodical` 时漏改了 `reloadIssues()` 里的一处。
   *   它不是"条件恒假"那么温和 —— 引用一个**不存在的标识符会抛 ReferenceError**，
   *   而抛出点又在 try 之外 → 期简目永远取不到（期号导航整块不渲染），
   *   且 onMounted 里 `await reloadIssues()` 之后的 loading=false / 补图 / SSE 订阅全被跳过。
   *   这类错误编译器/打包器都不会报，只能靠这种静态检查拦住。
   */
  const file = path.join(WEB_SRC, 'views/MediaView.vue');
  const s = stripComments(fs.readFileSync(file, 'utf8'));
  const used = new Set([...s.matchAll(/\bactiveIs[A-Z][A-Za-z0-9]*/g)].map(m => m[0]));
  assert.ok(used.size > 0, '应当至少有一个 activeIs* 计算属性（否则说明这个检查本身失效了）');
  const missing = [...used].filter(n => !new RegExp(`const\\s+${n}\\s*=`).test(s));
  assert.deepEqual(missing, [], `MediaView.vue 引用了未定义的标识符：${missing.join('、')}`);
});

test('前端媒体系：不再出现已改名的旧标识符与旧分类名', () => {
  // activeIsPortal 是 activeIsPeriodical 的旧名；改名后残留一处就会抛 ReferenceError。
  // 「报纸物料」是「官方传媒」的旧文案 —— 界面文案必须只有一种，否则用户会以为是两个分类。
  const bad = [];
  for (const f of walkSrc(WEB_SRC)) {
    const s = stripComments(fs.readFileSync(f, 'utf8'));
    if (/\bactiveIsPortal\b/.test(s)) bad.push(`${path.relative(WEB_SRC, f)}: activeIsPortal`);
  }
  assert.deepEqual(bad, []);

  const vu = fs.readFileSync(path.join(WEB_SRC, 'views/MediaView.vue'), 'utf8');
  assert.match(vu, /官方传媒/, '分类文案应为「官方传媒」');
  assert.ok(!/报纸物料/.test(vu), '不应再出现旧分类名「报纸物料」');
});

test('「全部」刷新只在当前分类内抽媒体（否则会抽到别的分类，白烧 token 且看不到结果）', async (t) => {
  /**
   * 老代码在 `generateMediaBatch` 里是全局 `ORDER BY RANDOM() LIMIT 1` ——
   * 站在「数字报刊」点刷新，可能抽到社交平台的媒体：生成的帖子不出现在当前分类里，
   * 用户看到的就是"点了刷新毫无反应"。
   *
   * 这里用**没有媒体的分类**来判定：若分类过滤真的生效，函数会在调 LLM 之前就抛错，
   * 所以这条测试既确定了行为、又不会真的去生成内容。
   * （本库若已有「官方传媒」媒体则跳过 —— 那种情况下这个请求会真的去出刊。）
   */
  const n = getDb().prepare(
    `SELECT COUNT(*) AS n FROM media_outlets WHERE enabled = 1 AND COALESCE(layout,'feed') IN ('poster','weekly')`
  ).get().n;
  if (n > 0) return t.skip('本库已有「官方传媒」媒体，跳过（以免真的调 LLM 出刊）');
  await assert.rejects(
    () => generateMediaBatch({ category: 'print', count: 1 }),
    /这个分类下还没有可用的媒体/,
    '分类内没有媒体时应当直接拒绝，而不是全库随机抽一个',
  );
  // 与它对照：分类过滤生效了，`print` 档确实一条都取不到
  assert.equal(listPosts({ category: 'print', limit: 1 }).total, 0);
});

test('每个形态都恰好归属一个分类（新增形态却忘记归类时，这条会失败）', () => {
  const owners = (layout) => MEDIA_CATEGORIES.filter(c => CATEGORY_LAYOUTS[c].some(l => (l || 'feed') === layout));
  for (const k of ALL_LAYOUT_KEYS) {
    assert.equal(owners(k).length, 1, `形态 ${k} 应恰好属于一个分类，实际属于：${owners(k).join('、') || '（无）'}`);
  }
  // 分区本身也要与前端标签一一对上（前端 MediaView 的 CATEGORIES 就是这三档）
  assert.deepEqual([...MEDIA_CATEGORIES].sort(), ['digital', 'print', 'social']);
  assert.deepEqual(CATEGORY_LAYOUTS.print, ['poster', 'weekly']);
  assert.deepEqual(CATEGORY_LAYOUTS.digital, ['portal'], '海报/周刊必须从「数字报刊」摘出去，否则同刊会同时在两档出现');
});

test('前端分类口径与后端布局表同步：新增形态必须在前端归类', () => {
  const s = fs.readFileSync(path.join(WEB_SRC, 'views/MediaView.vue'), 'utf8');
  const missing = ALL_LAYOUT_KEYS.filter(k => !s.includes(`'${k}'`));
  assert.deepEqual(missing, [], `MediaView.vue 未归类的形态：${missing.join('、')}`);
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
