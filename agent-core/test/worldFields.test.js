import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  WORLD_FIELD_DEFS,
  normalizeWorldFields,
  isEmptyWorldFields,
  assembleWorldContent,
  splitWorldContentIntoFields,
  extractLorebookEntries,
  suggestFieldForEntry,
  mergeLorebookAssignments,
} from '../src/services/worldFields.js';
import {
  initWorldRepository,
  createWorldSetting,
  updateWorldSetting,
  activateWorldSetting,
  getWorldSetting,
  getWorldSettingById,
} from '../src/db/worldRepository.js';

// ── assembleWorldContent：拼装顺序 / 空框跳过 / scope 档位 ──

test('assembleWorldContent：按固定顺序拼装非空框，空框跳过', () => {
  const text = assembleWorldContent({
    background: '灵气复苏的现代都市。',
    society: '',
    abilities: '妖怪能附身在旧物上。',
    reinforce: '妖怪不能主动暴露身份。',
  });
  const lines = text.split('\n');
  assert.equal(lines[0], '## 世界背景');
  assert.ok(text.includes('## 特殊能力'));
  assert.ok(!text.includes('## 社会结构')); // 空框跳过
  const order = ['## 世界背景', '## 特殊能力', '## 需要强化的设定'].map(h => text.indexOf(h));
  assert.deepEqual([...order].sort((a, b) => a - b), order); // 顺序稳定
});

test('assembleWorldContent：全空返回空串；未知 scope 回退 full', () => {
  assert.equal(assembleWorldContent(normalizeWorldFields(null)), '');
  const fields = { background: 'B', society: 'S', abilities: '', reinforce: 'R' };
  // visual 跳过社会结构；light 只取背景+强化
  const visual = assembleWorldContent(fields, 'visual');
  assert.ok(visual.includes('## 世界背景') && visual.includes('## 需要强化的设定'));
  assert.ok(!visual.includes('## 社会结构'));
  const light = assembleWorldContent(fields, 'light');
  assert.ok(light.includes('## 世界背景') && light.includes('## 需要强化的设定'));
  assert.ok(!light.includes('## 社会结构') && !light.includes('## 特殊能力'));
  const bogus = assembleWorldContent(fields, 'nonsense');
  assert.ok(bogus.includes('## 社会结构')); // 回退全量
});

// ── splitWorldContentIntoFields：老内容自动切分，零丢失 ──

test('splitWorldContentIntoFields：润色端点历史格式按标题归位', () => {
  const legacy = [
    '## 世界背景',
    '灵气复苏的现代都市。',
    '',
    '## 日常规则',
    '大家假装看不见妖怪。',
    '',
    '## 深层逻辑',
    '见怪不怪是社会默契。',
    '',
    '## 人们的行为',
    '遇到妖怪时，大家通常会绕路。',
  ].join('\n');
  const fields = splitWorldContentIntoFields(legacy);
  assert.match(fields.background, /灵气复苏/);
  assert.match(fields.background, /见怪不怪/); // 深层逻辑 → background
  assert.match(fields.society, /假装看不见/);
  assert.match(fields.society, /绕路/); // 人们的行为 → society
  assert.equal(fields.abilities, '');
  assert.equal(fields.reinforce, '');
});

test('splitWorldContentIntoFields：无结构整段归入世界背景，【】标记原样保留', () => {
  const raw = '【妖怪协会】调解纠纷的组织。\n\n一段没有任何标题的老文本。';
  const fields = splitWorldContentIntoFields(raw);
  assert.match(fields.background, /【妖怪协会】/);
  assert.match(fields.background, /一段没有任何标题的老文本。/);
  assert.equal(fields.society, '');
});

test('splitWorldContentIntoFields：新格式四框 + 未识别标题延续上一框', () => {
  const raw = '## 特殊能力\n附身旧物。\n\n## 完全陌生的标题\n神秘内容。\n\n## 需要强化的设定\n不许暴露。';
  const fields = splitWorldContentIntoFields(raw);
  assert.match(fields.abilities, /附身旧物/);
  assert.match(fields.abilities, /神秘内容/); // 未识别标题 = 上一框的延续
  assert.match(fields.reinforce, /不许暴露/);
  assert.equal(fields.background, '');
});

test('splitWorldContentIntoFields：空输入返回全空框', () => {
  assert.ok(isEmptyWorldFields(splitWorldContentIntoFields('')));
  assert.ok(isEmptyWorldFields(splitWorldContentIntoFields(null)));
});

// ── 酒馆世界书导入：条目提取 / 目标框启发式 / 合并 ──

test('extractLorebookEntries：兼容 entries 对象、character_book、裸数组三种形态', () => {
  const a = extractLorebookEntries({ entries: { 0: { key: ['妖怪协会'], content: 'C1' }, 1: { keys: ['灵视'], content: 'C2', constant: true } } });
  assert.equal(a.length, 2);
  assert.equal(a[0].keys[0], '妖怪协会');
  assert.equal(a[1].constant, true);

  const b = extractLorebookEntries({ data: { character_book: { entries: [{ keys: ['x'], content: 'B1' }] } } });
  assert.equal(b.length, 1);
  assert.equal(b[0].content, 'B1');

  const c = extractLorebookEntries([{ comment: '裸数组条目', content: 'C1' }]);
  assert.equal(c.length, 1);
  assert.equal(c[0].title, '裸数组条目');

  assert.deepEqual(extractLorebookEntries(null), []);
  assert.deepEqual(extractLorebookEntries({}), []);
  // 无 content 的条目被过滤
  assert.deepEqual(extractLorebookEntries({ entries: { 0: { key: ['k'] } } }), []);
});

test('suggestFieldForEntry：能力→特殊能力、社会→社会结构、默认→世界背景', () => {
  assert.equal(suggestFieldForEntry({ title: '灵力体系', keys: [], content: '修炼境界' }), 'abilities');
  assert.equal(suggestFieldForEntry({ title: '协会', keys: ['势力'], content: '组织结构' }), 'society');
  assert.equal(suggestFieldForEntry({ title: '城市', keys: [], content: '一条老街' }), 'background');
});

test('mergeLorebookAssignments：【标题】内容逐条追加进对应框，空框拼接用空行', () => {
  const fields = mergeLorebookAssignments([
    { field: 'background', title: '老街', content: '青石板路。' },
    { field: 'background', title: '夜市', content: '只在月圆出现。' },
    { field: 'society', title: '', content: '无标题内容。' },
    { field: 'unknown_key', title: 'x', content: '非法框丢弃' },
    { field: 'abilities', title: 'y', content: '' }, // 空 content 丢弃
  ]);
  assert.match(fields.background, /【老街】青石板路。\n\n【夜市】只在月圆出现。/);
  assert.equal(fields.society, '无标题内容。');
  assert.equal(fields.abilities, '');
});

// ── 仓储层：分框保存 → content 快照回写 → scope 注入（内存库走真实仓储）──

function createWorldDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE world_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      fields_json TEXT,
      scoped_inject INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  initWorldRepository(db);
  return db;
}

test('worldRepository：分框保存生成 content 快照，getWorldSetting 按 scope 精简', () => {
  const db = createWorldDb();
  const created = createWorldSetting({
    name: '测试世界',
    fields: { background: '背景B。', society: '社会S。', abilities: '能力A。', reinforce: '强化R。' },
  });
  assert.ok(created);
  // 快照 = 四框按序拼装
  assert.match(created.content, /^## 世界背景\n背景B。\n\n## 社会结构\n社会S。/);
  activateWorldSetting(created.id);

  // 默认无参调用 = 全量（与历史行为一致）
  const full = getWorldSetting();
  assert.ok(full.includes('<world_setting>') && full.includes('社会S。') && full.includes('能力A。'));

  // visual：跳过社会结构
  const visual = getWorldSetting({ scope: 'visual' });
  assert.ok(visual.includes('能力A。'));
  assert.ok(!visual.includes('社会S。'));

  // light：只取背景 + 强化
  const light = getWorldSetting({ scope: 'light' });
  assert.ok(light.includes('背景B。') && light.includes('强化R。'));
  assert.ok(!light.includes('社会S。') && !light.includes('能力A。'));
});

test('worldRepository：scoped_inject 关闭时任何 scope 都回退全量；旧路径整段写 content 使分框失效', () => {
  const db = createWorldDb();
  const created = createWorldSetting({
    name: '开关世界',
    fields: { background: '背景B。', society: '社会S。', abilities: '', reinforce: '' },
  });
  activateWorldSetting(created.id);

  // 关闭精简开关 → visual 也全量
  updateWorldSetting(created.id, { scopedInject: 0 });
  const scopedOff = getWorldSetting({ scope: 'visual' });
  assert.ok(scopedOff.includes('社会S。'));

  // 旧客户端只写 content → fields_json 失效，scope 回退为整段内容
  updateWorldSetting(created.id, { content: '重新变成整段的旧文本。' });
  const row = getWorldSettingById(created.id);
  assert.equal(row.fields_json, null);
  assert.equal(row.content, '重新变成整段的旧文本。');
  const legacy = getWorldSetting({ scope: 'light' });
  assert.ok(legacy.includes('重新变成整段的旧文本。'));

  // 重新分框保存即恢复按框拼装
  updateWorldSetting(created.id, { fields: { background: '新背景。', society: '', abilities: '', reinforce: '' } });
  assert.ok(getWorldSetting().includes('新背景。'));
  assert.ok(!getWorldSetting().includes('重新变成整段'));
});

test('worldRepository：快照与注入包裹保持历史格式（<world_setting> 标签不变）', () => {
  const db = createWorldDb();
  const created = createWorldSetting({ name: '格式世界', fields: { background: '只有背景。', society: '', abilities: '', reinforce: '' } });
  activateWorldSetting(created.id);
  const world = getWorldSetting();
  assert.ok(world.startsWith('<world_setting>\n## 世界背景\n只有背景。\n</world_setting>'));
});
