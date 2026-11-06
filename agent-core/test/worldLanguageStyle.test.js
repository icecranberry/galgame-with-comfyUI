import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { config } from '../src/config.js';
import { initWorldRepository, migrateWorldLanguageStyle, createWorldSetting, updateWorldSetting, activateWorldSetting, getWorldSettingById } from '../src/db/worldRepository.js';
import { appendWorldLanguageStyle, hasActiveWorldLanguageStyle } from '../src/services/worldLanguageStyle.js';
import { buildLanguageStylePolishRequest } from '../src/services/worldLanguageStylePolish.js';
import { getChatRhythmRules, getCoreDialogueRules } from '../src/builtinRules.js';
import { MOMENT_TONE_RULES, MOMENT_COMMENT_RULES } from '../src/services/momentForms.js';
import { buildProtocolBlock } from '../src/services/groupChatEngine.js';
import { buildChatContext } from '../src/services/contextAssembler.js';
import { buildGodChatContext } from '../src/services/godSays/promptBuilder.js';
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
  const guidance = appendWorldLanguageStyle('原文');
  assert.match(guidance, /用户主动指定的语言风格/);
  assert.match(guidance, /不是可选参考/);
  assert.match(guidance, /不限于亲密场景/);
  assert.match(guidance, /示例是写法样本/);
  assert.match(guidance, /优先于默认文风、口语短句习惯/);
  assert.doesNotMatch(guidance, /默认回复篇幅|长度提示可随风格/);
  assert.match(guidance, /字数、篇幅和条数限制内/);
  assert.match(guidance, /禁止括号动作\/旁白/);
  assert.match(guidance, /按当前场景的篇幅调整密度/);
  assert.match(guidance, /短消息可以用一两句把感官点带出来/);
  assert.match(guidance, /JSON 字段、消息结构、工具调用协议/);
  assert.ok(guidance.endsWith(`用户指定的语言风格：\n${style}\n</additional_writing_style>`), '用户保存的风格原文完整保留');
});

test('hasActiveWorldLanguageStyle 只在配置后为真，隐藏世界观时为假', () => {
  assert.equal(hasActiveWorldLanguageStyle(), false);
  updateWorldSetting(1, { language_style: '用一点含蓄幽默接话' });
  assert.equal(hasActiveWorldLanguageStyle(), true);
  config.features.disturbMode = true;
  Object.assign(config.disturb, { hideWorld: true, startTime: '00:00', endTime: '23:59', skipWeekends: false });
  assert.equal(hasActiveWorldLanguageStyle(), false);
  config.features.disturbMode = false;
  updateWorldSetting(1, { language_style: '' });
  assert.equal(hasActiveWorldLanguageStyle(), false);
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

test('未配置风格时保持原规则字节；配置后换成允许第一人称叙述的规则变体', () => {
  assert.equal(getChatRhythmRules({ allowNarration: false }), getChatRhythmRules());
  assert.equal(getCoreDialogueRules({ userName: '吾神' }), getCoreDialogueRules({ userName: '吾神', allowNarration: false }));
  const rhythm = getChatRhythmRules({ allowNarration: true });
  assert.notEqual(rhythm, getChatRhythmRules());
  assert.match(rhythm, /角色第一人称的叙述性正文/);
  assert.match(rhythm, /口语化、短句/);
  assert.match(rhythm, /拆条后总量仍要落在给定字数范围内/);
  const format = getCoreDialogueRules({ userName: '吾神', allowNarration: true });
  assert.match(format, /角色第一人称的叙述性正文/);
  assert.doesNotMatch(format, /严禁以下格式/);
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

test('神说在原节奏示例后追加语言风格，保留历史、附件与准确的稳定边界', () => {
  const input = {
    systemRules: '世界规则', agentRules: '工具规则',
    angel: { display_name: '天使', persona: '天使人格' },
    now: new Date('2026-11-05T08:00:00Z'),
    history: { messages: [{ role: 'user', content: '之前' }, { role: 'assistant', content: '你好' }, { role: 'user', content: '现在' }] },
    images: ['data:image/png;base64,example'],
  };
  const build = (overrides = {}) => buildGodChatContext({ ...input,
    chatRhythmRules: appendWorldLanguageStyle(getChatRhythmRules({ allowNarration: hasActiveWorldLanguageStyle() })),
    hasLanguageStyle: hasActiveWorldLanguageStyle(), ...overrides });
  const original = buildGodChatContext(input);
  assert.deepEqual(build(), original);
  updateWorldSetting(1, { language_style: '含蓄幽默' });
  const styled = build();
  const boundary = styled.lorebookOptions.cacheBoundary;
  const rhythm = styled.messages[boundary.index].content;
  assert.ok(rhythm.startsWith(getChatRhythmRules({ allowNarration: true }) + '\n\n<additional_writing_style>'));
  assert.match(rhythm, /<\/additional_writing_style>\n以上节奏适用于日常交流/);
  assert.equal(boundary.offset, rhythm.length);
  assert.ok(styled.lorebookOptions.staticTexts.includes(rhythm));
  const restored = structuredClone(styled.messages);
  restored[boundary.index].content = rhythm
    .replace(appendWorldLanguageStyle(''), '')
    .replace('；<additional_writing_style> 要求的角色第一人称叙述性正文可以直接写，但字数、篇幅与上方的短句节奏限制保持原样', '')
    .replace(getChatRhythmRules({ allowNarration: true }), getChatRhythmRules());
  const formatIndex = restored.findIndex(message => typeof message.content === 'string' && message.content.includes('<dialogue_format_rules>'));
  restored[formatIndex].content = restored[formatIndex].content
    .replace(getCoreDialogueRules({ userName: '吾神', allowNarration: true }), getCoreDialogueRules({ userName: '吾神' }));
  assert.deepEqual(restored, original.messages);
  assert.deepEqual(build({ now: new Date('2026-11-06T09:00:00Z') }).messages.slice(0, boundary.index + 1), styled.messages.slice(0, boundary.index + 1));
  updateWorldSetting(1, { language_style: '' });
  assert.deepEqual(build(), original);
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
