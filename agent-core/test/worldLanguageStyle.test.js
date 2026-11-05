import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { config } from '../src/config.js';
import { initWorldRepository, migrateWorldLanguageStyle, createWorldSetting, updateWorldSetting, activateWorldSetting, getWorldSettingById } from '../src/db/worldRepository.js';
import { appendWorldLanguageStyle } from '../src/services/worldLanguageStyle.js';
import { buildLanguageStylePolishRequest } from '../src/services/worldLanguageStylePolish.js';
import { getChatRhythmRules } from '../src/builtinRules.js';
import { MOMENT_TONE_RULES, MOMENT_COMMENT_RULES } from '../src/services/momentForms.js';
import { buildProtocolBlock } from '../src/services/groupChatEngine.js';
import { buildChatContext } from '../src/services/contextAssembler.js';
import { buildPromptProfile } from '../src/services/lorebook/promptProfile.js';
import { applyLorebookLayout } from '../src/services/lorebook/layout.js';
import { normalizeBook, evaluateBook } from '../src/services/lorebook/engine.js';

let db;
let disturb;
let disturbMode;
beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE world_settings (id INTEGER PRIMARY KEY, name TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', is_active INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, updated_at TEXT);
    INSERT INTO world_settings (name, content, is_active) VALUES ('旧世界', '旧正文', 1);`);
  migrateWorldLanguageStyle(db);
  initWorldRepository(db);
  disturb = { ...config.disturb };
  disturbMode = config.features.disturbMode;
  config.features.disturbMode = false;
});
afterEach(() => {
  config.disturb = disturb;
  config.features.disturbMode = disturbMode;
  initWorldRepository(null);
  db.close();
});

test('旧库迁移可重复执行，语言风格与世界观正文分别保存并跟随激活项', () => {
  assert.equal(getWorldSettingById(1).language_style, '');
  updateWorldSetting(1, { language_style: '含蓄幽默\n回复：你又猜中了。' });
  migrateWorldLanguageStyle(db);
  assert.equal(getWorldSettingById(1).content, '旧正文');
  assert.match(appendWorldLanguageStyle('原有示例'), /含蓄幽默/);
  const second = createWorldSetting({ name: '另一个世界', content: '', language_style: '利落直白' });
  activateWorldSetting(second.id);
  assert.match(appendWorldLanguageStyle('原有示例'), /利落直白/);
  assert.doesNotMatch(appendWorldLanguageStyle('原有示例'), /含蓄幽默/);
  updateWorldSetting(second.id, { content: '新正文', name: '新名称' });
  assert.equal(getWorldSettingById(second.id).language_style, '利落直白');
  updateWorldSetting(second.id, { language_style: '' });
  assert.equal(appendWorldLanguageStyle('原有示例'), '原有示例');
});

test('私聊、群聊、朋友圈与评论保留原有示例，只追加一次；未设置逐字相同', () => {
  const groupOriginal = buildProtocolBlock();
  const bases = [getChatRhythmRules(), MOMENT_TONE_RULES, MOMENT_COMMENT_RULES];
  for (const base of bases) assert.equal(appendWorldLanguageStyle(base), base);
  const style = '用一点含蓄幽默接话\n回复：看来我的咖啡还没你先醒。';
  updateWorldSetting(1, { language_style: style });
  for (const base of bases) {
    const actual = appendWorldLanguageStyle(base);
    assert.ok(actual.startsWith(base + '\n\n'));
    assert.equal(actual.split(style).length, 2);
    assert.equal(actual, appendWorldLanguageStyle(base));
  }
  const group = buildProtocolBlock();
  const inserted = appendWorldLanguageStyle('');
  assert.equal(group.replace(inserted, ''), groupOriginal, '群聊只插入风格，原协议逐字保留');
  assert.match(group, /禁止重复别人刚说过的意思\n\n<additional_writing_style>/);
  assert.match(group, /<\/additional_writing_style>\n- 爱发图：/);
  assert.equal(group.split(style).length, 2);
  assert.equal(appendWorldLanguageStyle('原文'), `原文\n\n<additional_writing_style>\n以下为追加的语言风格：\n${style}\n</additional_writing_style>`, '包装只有一句说明和用户保存的内容');
});

test('隐藏世界观或无激活项时不注入，隐藏不会清除保存值', () => {
  updateWorldSetting(1, { language_style: '轻松' });
  config.features.disturbMode = true;
  Object.assign(config.disturb, { hideWorld: true, startTime: '00:00', endTime: '23:59', skipWeekends: false });
  assert.equal(appendWorldLanguageStyle('原文'), '原文');
  assert.equal(getWorldSettingById(1).language_style, '轻松');
  config.features.disturbMode = false;
  db.exec('UPDATE world_settings SET is_active=0');
  assert.equal(appendWorldLanguageStyle('原文'), '原文');
});

test('私聊语言风格稳定在摘要前，改变历史和当前任务不改前缀或消息角色', () => {
  updateWorldSetting(1, { language_style: '含蓄幽默' });
  const build = current => buildChatContext({
    stableBlocks: ['世界观', '人格'],
    preSummarySystem: appendWorldLanguageStyle(getChatRhythmRules()),
    summaryBlock: '摘要',
    history: [{ role: 'user', content: '此前问题' }, { role: 'assistant', content: '此前回答' }, { role: 'user', content: current }],
    dynamicBlocks: [`现在的状态：${current}`],
  });
  const first = build('你好');
  const second = build('吃了吗');
  assert.deepEqual(first.messages.slice(0, 4), second.messages.slice(0, 4));
  assert.deepEqual(first.messages.map(message => message.role), ['system', 'system', 'system', 'system', 'user', 'assistant', 'user']);
  assert.deepEqual(first.messages.slice(4, 6), [{ role: 'user', content: '此前问题' }, { role: 'assistant', content: '此前回答' }]);
  assert.equal(first.metadata.fullPrefixHash, second.metadata.fullPrefixHash);
});

test('润色只有末条 user 携带需求，世界观与规范稳定，保存前不修改数据库', () => {
  for (const worldContent of ['', '魔法已融入日常生活']) {
    const first = buildLanguageStylePolishRequest({ content: '温柔一点', worldContent, worldId: 1 });
    const existingGuide = '## 文风要求：搞笑网文风格\n\n### 核心特征\n- 反差搞笑\n\n### 禁止事项\n- 禁止冗长的环境描写';
    const second = buildLanguageStylePolishRequest({ content: existingGuide, worldContent, worldId: 1 });
    assert.deepEqual(first.messages.slice(0, -1), second.messages.slice(0, -1));
    assert.ok(second.messages.at(-1).content.endsWith(existingGuide), '完整文风原稿的标题、换行和禁项原样传给润色请求');
    assert.equal(first.messages.filter(message => message.role === 'user').length, 1);
    assert.match(first.messages.at(-1).content, /温柔一点/);
    assert.deepEqual(first.lorebook.history, [first.messages.at(-1)]);
    const boundary = first.lorebook.cacheBoundary;
    assert.equal(boundary.index, first.messages.length - 2);
    assert.equal(boundary.offset, first.messages[boundary.index].content.length);
    assert.equal(first.lorebook.worldId, 1);
    assert.deepEqual(first.lorebook.personaTexts, []);
    assert.equal(getWorldSettingById(1).language_style, '');
    const worldText = worldContent ? `<world_setting>\n${worldContent}\n</world_setting>` : '';
    const options = { ...first.lorebook, worldText, cachePlacement: true };
    const profile = buildPromptProfile(first.messages, options);
    assert.equal(profile.cacheBoundary.index, boundary.index);
    assert.equal(profile.cacheBoundary.offset, boundary.offset);
    if (worldText) {
      assert.equal(profile.anchors.beforeAuthorNote.index, 0);
      assert.equal(first.messages[0].content.slice(profile.anchors.beforeAuthorNote.offset, profile.anchors.afterAuthorNote.offset), worldText);
    }
    const book = normalizeBook({ entries: {
      0: { uid: 0, constant: true, content: '稳定语言示例', position: 5 },
      1: { uid: 1, constant: false, key: ['温柔'], content: '动态温柔示例', position: 4, depth: 0 },
    } }).document;
    const activation = evaluateBook(book, {}, { history: first.lorebook.history });
    const injected = applyLorebookLayout(first.messages, activation, options);
    assert.deepEqual(injected.messages.map(message => message.role), first.messages.map(message => message.role));
    assert.match(injected.messages[boundary.index].content, /稳定语言示例/);
    assert.match(injected.messages.at(-1).content, /动态温柔示例[\s\S]*请把以下语言风格需求/);
    assert.ok(injected.placements.every(placement => placement.actualAnchor));
  }
});
