/**
 * 「派系与组织」模块 —— 回归测试（迁移 003 + factionService + 路由接线）。
 *
 * 来源：酒馆页从「关系图 + 世界观设置」两块扩成三块的设计稿
 * （`邻舍-local/10-投递箱/2026-10-07_派系与组织模块/`）。
 *
 * ⚠ 全程用临时库 + 临时项目库目录，不碰真库、不调 LLM：
 *   · `DB_PATH` → 临时 .db；
 *   · `LINSHE_WORLD_PROJECTS_DIR` → 临时目录（否则会往真实 data/world-projects/ 写镜像）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'linshe-factions-'));
process.env.DB_PATH = path.join(TMP_DIR, 'agent.db');
process.env.LINSHE_WORLD_PROJECTS_DIR = path.join(TMP_DIR, 'world-projects');
globalThis.fetch = async url => { throw new Error(`factions test forbids network: ${url}`); };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');

// 迁移必须显式执行（只 load 不加列；见 memoryEvidenceGate 的同款坑）
const { loadFeatureMigrations } = await import('../src/db/migrations/index.js');
const { runRegisteredMigrations } = await import('../src/db/migrationRegistry.js');
const { getDb, createWorldSetting, activateWorldSetting } = await import('../src/db/index.js');
await loadFeatureMigrations();
runRegisteredMigrations(getDb());

const svc = await import('../src/services/factionService.js');

const db = getDb();

/** 造一个激活的世界观（scaffold 会写进临时项目库目录，安全） */
const world = createWorldSetting({ name: '测试世界', content: '## 世界背景\n一个用于测试的世界。' });
activateWorldSetting(world.id);

function newCharacter(name) {
  const r = db.prepare(`
    INSERT INTO characters (name, display_name, base_prompt) VALUES (?, ?, ?)
  `).run(name, name, '你是测试角色。');
  return Number(r.lastInsertRowid);
}

// ─────────────────────────────────────────────────────────
// ① 迁移
// ─────────────────────────────────────────────────────────

test('★★★ 迁移 003：三张表都建出来了', () => {
  const names = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
  for (const t of ['factions', 'faction_members', 'faction_relations']) {
    assert.ok(names.includes(t), `缺表 ${t}`);
  }
});

test('★★ 词表是后端单一真源', () => {
  assert.ok(svc.FACTION_TYPES.includes('政权'));
  assert.ok(svc.FACTION_TYPES.includes('秘密结社'));
  assert.ok(svc.FACTION_RELATIONS.includes('同盟'));
  assert.ok(svc.FACTION_RELATIONS.includes('敌对'));
  assert.ok(!svc.DEFAULT_VISIBLE_RELATIONS.includes('中立'), '中立默认不画（否则图会糊）');
});

// ─────────────────────────────────────────────────────────
// ② 派系 CRUD
// ─────────────────────────────────────────────────────────

test('★★★ 创建派系：slug 稳定、类型受校验', () => {
  const f = svc.createFaction({ name: '幻月秘庭', type: '秘密结社', summary: '仅特许人员' });
  assert.ok(f.id > 0);
  assert.equal(f.name, '幻月秘庭');
  assert.equal(f.type, '秘密结社');
  assert.ok(f.slug.length > 0, '应生成 slug');
  assert.equal(f.memberCount, 0);
  assert.throws(() => svc.createFaction({ name: 'x', type: '不存在的类型' }), /未知的派系类型/);
  assert.throws(() => svc.createFaction({ name: '' }), /不能为空/);
});

test('★ 列表只返回当前世界的派系', () => {
  const before = svc.listFactions().length;
  assert.ok(before >= 1);
  db.prepare(`INSERT INTO factions (slug, name, type, world_slug) VALUES ('other-world-f', '别的世界帮', '军事', 'some-other-slug')`).run();
  const after = svc.listFactions();
  assert.equal(after.length, before, '别的世界的派系不该出现');
  assert.ok(!after.some(f => f.name === '别的世界帮'));
});

test('★★ 更新派系：改名 / 改类型 / 改上级', () => {
  const a = svc.createFaction({ name: '共愿帮', type: '秘密结社' });
  const b = svc.createFaction({ name: '共愿帮-南区分部', type: '秘密结社', parentId: a.id });
  const upd = svc.updateFaction(b.id, { summary: '南区据点', sortOrder: 3 });
  assert.equal(upd.summary, '南区据点');
  assert.equal(upd.sortOrder, 3);
  assert.equal(upd.parentId, a.id, '上级应保留');
});

test('★★★ 层级防环：不能挂到自己或自己的后代下面', () => {
  const a = svc.createFaction({ name: '环测A', type: '其他' });
  const b = svc.createFaction({ name: '环测B', type: '其他', parentId: a.id });
  assert.throws(() => svc.updateFaction(a.id, { parentId: a.id }), /不能把派系挂到自己下面/);
  assert.throws(() => svc.updateFaction(a.id, { parentId: b.id }), /会成环/);
});

// ─────────────────────────────────────────────────────────
// ③ 成员（多对多 + 归档不计入）
// ─────────────────────────────────────────────────────────

test('★★★ 成员多对多：同一角色可同时属两个派系', () => {
  const f1 = svc.createFaction({ name: '多属甲', type: '商业' });
  const f2 = svc.createFaction({ name: '多属乙', type: '秘密结社' });
  const cid = newCharacter('多属者');
  svc.addMember(f1.id, { characterId: cid, role: '员工', rank: 5 });
  svc.addMember(f2.id, { characterId: cid, role: '线人', rank: 3 });
  assert.equal(svc.getFaction(f1.id).memberCount, 1);
  assert.equal(svc.getFaction(f2.id).memberCount, 1);
});

test('★★★ 同一派系内同职务不重复（UNIQUE），换职务可以', () => {
  const f = svc.createFaction({ name: '去重测', type: '其他' });
  const cid = newCharacter('去重者');
  svc.addMember(f.id, { characterId: cid, role: '干部' });
  assert.throws(() => svc.addMember(f.id, { characterId: cid, role: '干部' }), /已在此派系/);
  assert.doesNotThrow(() => svc.addMember(f.id, { characterId: cid, role: '顾问' }));
});

test('★★★ 归档角色不计入成员数，但仍在成员列表里（D7）', () => {
  const f = svc.createFaction({ name: '归档测', type: '其他' });
  const cid = newCharacter('待归档者');
  svc.addMember(f.id, { characterId: cid, role: '成员' });
  assert.equal(svc.getFaction(f.id).memberCount, 1);

  db.prepare('UPDATE characters SET archived = 1 WHERE id = ?').run(cid);
  const after = svc.getFaction(f.id);
  assert.equal(after.memberCount, 0, '归档角色不该计入成员数');
  assert.equal(after.archivedMemberCount, 1);
  assert.equal(after.members.length, 1, '但详情里仍看得到');
  assert.equal(after.members[0].archived, 1);
});

test('★ 成员可改职务/等级、可移除', () => {
  const f = svc.createFaction({ name: '成员维护', type: '其他' });
  const cid = newCharacter('成员维护者');
  const afterAdd = svc.addMember(f.id, { characterId: cid, role: '成员', rank: 5 });
  const mid = afterAdd.members[0].id;
  const upd = svc.updateMember(f.id, mid, { role: '首领', rank: 9 });
  assert.equal(upd.members[0].role, '首领');
  assert.equal(upd.members[0].rank, 9);
  const rm = svc.removeMember(f.id, mid);
  assert.equal(rm.memberCount, 0);
  assert.throws(() => svc.removeMember(f.id, mid), /不存在/);
});

// ─────────────────────────────────────────────────────────
// ④ 势力关系
// ─────────────────────────────────────────────────────────

test('★★★ 势力关系 upsert：同盟可改敌对，强度受限 0-100', () => {
  const a = svc.createFaction({ name: '关系甲', type: '政权' });
  const b = svc.createFaction({ name: '关系乙', type: '军事' });
  let out = svc.upsertRelation({ fromId: a.id, toId: b.id, relation: '同盟', strength: 80 });
  assert.equal(out.relations.length, 1);
  assert.equal(out.relations[0].relation, '同盟');
  assert.equal(out.relations[0].strength, 80);

  out = svc.upsertRelation({ fromId: a.id, toId: b.id, relation: '敌对', strength: 999 });
  assert.equal(out.relations.length, 1, '同一对只留一条（upsert）');
  assert.equal(out.relations[0].relation, '敌对');
  assert.equal(out.relations[0].strength, 100, '强度应被夹到 100');
});

test('★★ 自指 / 跨世界 / 未知关系一律拒绝', () => {
  const a = svc.createFaction({ name: '拒绝甲', type: '其他' });
  const b = svc.createFaction({ name: '拒绝乙', type: '其他' });
  assert.throws(() => svc.upsertRelation({ fromId: a.id, toId: a.id, relation: '同盟' }), /不能和自己/);
  assert.throws(() => svc.upsertRelation({ fromId: a.id, toId: b.id, relation: '结拜' }), /未知的势力关系/);
  const other = db.prepare(`SELECT id FROM factions WHERE slug = 'other-world-f'`).get();
  assert.throws(() => svc.upsertRelation({ fromId: a.id, toId: other.id, relation: '同盟' }), /不能跨世界观/);
});

test('★ 关系可删', () => {
  const a = svc.createFaction({ name: '删除甲', type: '其他' });
  const b = svc.createFaction({ name: '删除乙', type: '其他' });
  const out = svc.upsertRelation({ fromId: a.id, toId: b.id, relation: '竞争' });
  const rid = out.relations[0].id;
  assert.deepEqual(svc.removeRelation(rid), { deleted: rid });
  assert.equal(svc.getFaction(a.id).relations.length, 0);
});

// ─────────────────────────────────────────────────────────
// ⑤ 删除级联
// ─────────────────────────────────────────────────────────

test('★★★ 删除派系：成员与关系级联清掉，子派系上级置空（不连坐）', () => {
  const a = svc.createFaction({ name: '级联父', type: '其他' });
  const b = svc.createFaction({ name: '级联子', type: '其他', parentId: a.id });
  const c = svc.createFaction({ name: '级联友', type: '其他' });
  const cid = newCharacter('级联成员');
  svc.addMember(a.id, { characterId: cid, role: '成员' });
  svc.upsertRelation({ fromId: a.id, toId: c.id, relation: '同盟' });

  svc.deleteFaction(a.id);
  assert.throws(() => svc.getFaction(a.id), /不存在/);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM faction_members WHERE faction_id = ?').get(a.id).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM faction_relations WHERE from_faction_id = ?').get(a.id).c, 0);
  const child = svc.getFaction(b.id);
  assert.equal(child.parentId, null, '子派系不该被连坐删除，只把上级置空');
});

// ─────────────────────────────────────────────────────────
// ⑥ project.json 镜像（红线 12）
// ─────────────────────────────────────────────────────────

test('★★★ 写操作后镜像回世界观项目库的 factions 槽位（且不动其它槽位）', () => {
  const slug = svc.activeWorldSlug();
  assert.ok(slug, '应有激活世界观');

  const f = svc.createFaction({ name: '镜像测', type: '宗教', summary: '镜子里也该有' });
  const cid = newCharacter('镜像成员');
  svc.addMember(f.id, { characterId: cid, role: '信徒', rank: 6 });

  const file = path.join(process.env.LINSHE_WORLD_PROJECTS_DIR, slug, 'project.json');
  assert.ok(fs.existsSync(file), '项目库 project.json 应存在');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(Array.isArray(json.factions), 'factions 槽位应是数组');
  const mirrored = json.factions.find(x => x.name === '镜像测');
  assert.ok(mirrored, '镜像里应含新建派系');
  assert.equal(mirrored.type, '宗教');
  assert.equal(mirrored.members.length, 1);
  assert.equal(mirrored.members[0].role, '信徒');
  assert.ok('ambienceSections' in json || 'slug' in json, '其它槽位不该被整体覆盖');
});

// ─────────────────────────────────────────────────────────
// ⑦ 接线（防回退）
// ─────────────────────────────────────────────────────────

test('★★ 路由文件存在且默认导出 Router（约定式自动挂载）', async () => {
  const mod = await import('../src/routes/factions.js');
  assert.equal(typeof mod.default, 'function');
  assert.ok(Array.isArray(mod.default.stack), '应是 Express Router');
  assert.equal(mod.mount, undefined, '不需要自定义 mount：约定式挂 /api/factions');
});

test('★★ _autoMount 的约定式扫描应发现 factions.js', async () => {
  const { discoverConventionRoutes } = await import('../src/routes/_autoMount.js');
  const found = await discoverConventionRoutes();
  const hit = found.find(r => r.file === 'factions.js');
  assert.ok(hit, 'factions.js 应被约定式扫描发现');
  assert.equal(hit.base, '/api/factions');
});

test('★ 设计稿要求的"三块"仍各自独立（静态钉住）', () => {
  const src = fs.readFileSync(path.join(SRC, 'services/factionService.js'), 'utf8');
  assert.match(src, /与「角色文件夹」的区别/, '服务里必须写明与文件夹的区别（防合并）');
  assert.match(src, /FACTION_TYPES = \[/, '类型词表必须在后端单一定义');
  assert.match(src, /FACTION_RELATIONS = \[/, '关系词表必须在后端单一定义');
});

// ─────────────────────────────────────────────────────────
// 态势与小标签（迁移 004，2026-10-07）
// 参考用户既有《剧本 开局态势》：status / stance / goal / powerPillars 才是写作抓手
// ─────────────────────────────────────────────────────────

test('★★★ 迁移 004：factions 补上 scope/status/stance/goal/tags 五列', () => {
  const cols = db.prepare('PRAGMA table_info(factions)').all().map(c => c.name);
  for (const c of ['scope', 'status', 'stance', 'goal', 'tags']) {
    assert.ok(cols.includes(c), `缺列 ${c}`);
  }
});

test('★★★ 新建/更新带态势字段：状态与立场受词表校验', () => {
  const f = svc.createFaction({
    name: '态势测', type: '政权',
    scope: '城北', status: '鼎盛', stance: '友好', goal: '把持城北货运',
  });
  assert.equal(f.scope, '城北');
  assert.equal(f.status, '鼎盛');
  assert.equal(f.stance, '友好');
  assert.equal(f.goal, '把持城北货运');

  assert.throws(() => svc.createFaction({ name: 'x', status: '爆炸' }), /未知的势力状态/);
  assert.throws(() => svc.createFaction({ name: 'x', stance: '暧昧' }), /未知的立场/);

  const upd = svc.updateFaction(f.id, { status: '困顿', goal: '收缩防线' });
  assert.equal(upd.status, '困顿');
  assert.equal(upd.goal, '收缩防线');
  assert.equal(upd.scope, '城北', '没传的字段应保留');
});

test('★★★ 权力支柱小标签：顿号/逗号都能拆、去重、截断且不校验词表（世界专属支柱要能自由填）', () => {
  const f1 = svc.createFaction({ name: '标签测A', tags: '武力威慑、财力雄厚、武力威慑' });
  assert.deepEqual(f1.tags, ['武力威慑', '财力雄厚'], '应去重');

  const f2 = svc.createFaction({ name: '标签测B', tags: '武力威慑,情报网络,信仰凝聚' });
  assert.deepEqual(f2.tags, ['武力威慑', '情报网络', '信仰凝聚'], '逗号也要能拆');

  const f3 = svc.createFaction({ name: '标签测C', tags: Array.from({ length: 12 }, (_, i) => `支柱${i}`) });
  assert.equal(f3.tags.length, 8, '最多 8 个');

  // ★ 自由文本：某世界观专属的支柱（如参考里的「欢愉愿力」）**允许**填，只是不许写进引擎代码
  const f4 = svc.createFaction({ name: '标签测D', tags: ['某世界专属支柱'] });
  assert.deepEqual(f4.tags, ['某世界专属支柱']);
});

test('★★ 坏 tags 数据不炸（解析失败按空数组）', () => {
  const f = svc.createFaction({ name: '坏标签' });
  db.prepare('UPDATE factions SET tags = ? WHERE id = ?').run('{不是数组}', f.id);
  assert.deepEqual(svc.getFaction(f.id).tags, []);
});

// ─────────────────────────────────────────────────────────
// 给 LLM 的创意写作指导块
// ─────────────────────────────────────────────────────────

test('★★★ buildPromptBlock：没有派系时返回 null（调用方整段不出现 = 默认不改行为）', () => {
  const f = svc.createFaction({ name: '唯一派系' });
  assert.ok(svc.buildPromptBlock() !== null);
  svc.deleteFaction(f.id);
  // 把前面测试建的都删掉后再验
  db.prepare('DELETE FROM factions').run();
  assert.equal(svc.buildPromptBlock(), null);
});

test('★★★ buildPromptBlock：带上状态/立场/支柱/当下目标，且明确"别照抄"', () => {
  svc.createFaction({
    name: '态势帮', type: '秘密结社', scope: '城南', status: '困顿', stance: '冷淡',
    goal: '寻找新的财源', tags: ['武力威慑', '地盘控制'],
  });
  const text = svc.buildPromptBlock();
  assert.match(text, /<factions>/);
  assert.match(text, /态势帮/);
  assert.match(text, /状态：困顿/);
  assert.match(text, /对我：冷淡/);
  assert.match(text, /支柱：武力威慑、地盘控制/);
  assert.match(text, /当下目标：寻找新的财源/);
  assert.match(text, /不要照抄|不要凭空发明/, '必须明确禁止照抄/编造');
  assert.match(text, /<\/factions>$/);
});

test('★★ buildPromptBlock：onlyWithGoal 只留"有目标"的', () => {
  svc.createFaction({ name: '无目标帮' });
  const all = svc.buildPromptBlock();
  const only = svc.buildPromptBlock({ onlyWithGoal: true });
  assert.ok(all.includes('无目标帮'));
  assert.ok(!only.includes('无目标帮'));
  assert.ok(only.includes('态势帮'));
});

test('★★★ 引擎词表里**不得**出现世界观专属的权力支柱（红线 12）', () => {
  const src = fs.readFileSync(path.join(SRC, 'services/factionService.js'), 'utf8');
  // 只查"会被拼进提示词/参与判断"的正文：注释行跳过（注释里举例说明是允许的）
  const body = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  for (const t of ['幻月游戏', '欢愉假面', '欢愉愿力', '寰宇巨企', '共愿帮', '二相乐园']) {
    assert.ok(!body.includes(t), `引擎正文不得出现世界观专名「${t}」`);
  }
  // 建议值必须存在且是通用词
  assert.ok(svc.POWER_PILLAR_SUGGESTIONS.length >= 5);
  assert.ok(svc.POWER_PILLAR_SUGGESTIONS.includes('武力威慑'));
});

// ─────────────────────────────────────────────────────────
// 接入日程生成层（约束层，**默认关**）
// ─────────────────────────────────────────────────────────

test('★★★ 默认关闭：FEATURE_FACTION_PROMPT 未设 → 约束层里没有「势力态势」（= 行为与上线前一致）', async () => {
  delete process.env.FEATURE_FACTION_PROMPT;
  const { buildScheduleConstraintBlock } = await import('../src/services/scheduleGenerator.js');
  svc.createFaction({ name: '默认不该出现帮', goal: '试一下' });
  const layer = buildScheduleConstraintBlock({});
  assert.ok(!layer || !layer.includes('势力态势'), '默认关时不得注入势力态势');
});

test('★★★ 开启后：约束层出现「势力态势」，且可用 factionsText 逐次覆盖', async () => {
  process.env.FEATURE_FACTION_PROMPT = 'true';
  try {
    const { buildScheduleConstraintBlock } = await import('../src/services/scheduleGenerator.js');
    svc.createFaction({ name: '态势注入帮', status: '困顿', stance: '冷淡', goal: '找新财源', tags: ['武力威慑'] });
    const layer = buildScheduleConstraintBlock({});
    assert.ok(layer && layer.includes('势力态势'), '开启后应注入');
    assert.ok(layer.includes('态势注入帮'));
    assert.match(layer, /<schedule_constraints priority="high">/, '仍要落在既有约束层里');

    const off = buildScheduleConstraintBlock({ factionsText: '' });
    assert.ok(!off || !off.includes('势力态势'), '显式传空串应本次不注入');
  } finally {
    delete process.env.FEATURE_FACTION_PROMPT;
  }
});

test('★★★ 势力态势绝不进共享常量 scheduleInst（否则打穿前缀缓存 + 内置世界观知识）', () => {
  const sg = fs.readFileSync(path.join(SRC, 'services/scheduleGenerator.js'), 'utf8');
  const inst = sg.slice(sg.indexOf('const scheduleInst ='), sg.indexOf('const scheduleInst =') + 6000);
  for (const t of ['势力态势', 'buildFactionPromptBlock', 'faction']) {
    assert.ok(!inst.includes(t), `scheduleInst 里不得出现「${t}」`);
  }
  // 注入必须只在约束层函数体内
  const cbi = sg.indexOf('export function buildScheduleConstraintBlock');
  const body = sg.slice(cbi, sg.indexOf('\n}', sg.indexOf('if (!parts.length) return null;', cbi)));
  assert.match(body, /isFactionPromptEnabled\(\)/, '注入判定必须在约束层里');
});
