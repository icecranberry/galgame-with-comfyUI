import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initSettingsHandle } from '../src/db/settings.js';
import { initWorldRepository } from '../src/db/worldRepository.js';
import {
  EVENT_FACTS,
  MAX_TEXT_CHARS,
  buildMessages,
  buildTaskSystem,
  buildUserContext,
  describePromptLayers,
  formatZonedIso,
  generateInstantReaction,
  parseReactionOutput,
  validateReactionEvent,
  zonedDayKey,
} from '../src/services/characterReactionService.js';

const TZ = 'Asia/Shanghai';
const NOW = Date.parse('2026-10-03T06:32:18.000Z'); // 2026-10-03 14:32:18 +08:00

const CHARACTER = {
  id: 42,
  display_name: '小满',
  base_prompt: '你是小满，说话慢半拍，不太会把心事说满。',
  short_prompt: '短版人格',
  emotion_baseline: JSON.stringify({ label: '平静' }),
};

function fixture(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE characters (id INTEGER PRIMARY KEY, display_name TEXT, name TEXT, base_prompt TEXT, short_prompt TEXT, avatar_path TEXT, emotion_baseline TEXT);
    CREATE TABLE user_relationships (id INTEGER PRIMARY KEY, character_id INTEGER, relationship_text TEXT, affinity REAL, is_oath INTEGER);
    CREATE TABLE moment_posts (id INTEGER PRIMARY KEY, character_id INTEGER, npc_id INTEGER, author_type TEXT);
    CREATE TABLE mailbox_letters (id INTEGER PRIMARY KEY, character_id INTEGER, direction TEXT, is_read INTEGER);
    CREATE TABLE system_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT, updated_at TEXT);
    CREATE TABLE world_settings (id INTEGER PRIMARY KEY, name TEXT, content TEXT, is_active INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
    CREATE TABLE global_rules (id INTEGER PRIMARY KEY, rule_key TEXT, rule_content TEXT, is_active INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT);
  `);
  db.prepare('INSERT INTO characters (id, display_name, base_prompt, short_prompt, emotion_baseline) VALUES (?,?,?,?,?)')
    .run(CHARACTER.id, CHARACTER.display_name, CHARACTER.base_prompt, CHARACTER.short_prompt, CHARACTER.emotion_baseline);
  db.prepare('INSERT INTO user_relationships (character_id, relationship_text, affinity, is_oath) VALUES (?,?,?,?)')
    .run(CHARACTER.id, '常来串门的邻居', 68, 0);
  db.prepare('INSERT INTO moment_posts (id, character_id, npc_id, author_type) VALUES (1, 42, NULL, ?)').run('character');
  db.prepare('INSERT INTO moment_posts (id, character_id, npc_id, author_type) VALUES (2, NULL, NULL, ?)').run('user');
  db.prepare('INSERT INTO moment_posts (id, character_id, npc_id, author_type) VALUES (3, NULL, 7, ?)').run('npc');
  db.prepare('INSERT INTO moment_posts (id, character_id, npc_id, author_type) VALUES (4, 43, NULL, ?)').run('character');
  db.prepare('INSERT INTO mailbox_letters (id, character_id, direction, is_read) VALUES (11, 42, ?, 1)').run('char_to_user');
  db.prepare('INSERT INTO mailbox_letters (id, character_id, direction, is_read) VALUES (12, 42, ?, 1)').run('user_to_char');
  initSettingsHandle(db);
  initWorldRepository(db);
  return db;
}

function baseEvent(overrides = {}) {
  return {
    schemaVersion: 1,
    eventId: 'evt-1',
    type: 'character.pin_enabled',
    occurredAtMs: NOW,
    source: 'character-pin',
    initiator: 'user',
    actorKey: 'character:42',
    sourceTabId: 'tab-a1',
    worldId: null,
    subject: { kind: 'character', id: '42' },
    operationId: 'pin-operation-1',
    outcome: 'confirmed',
    payload: {},
    ...overrides,
  };
}

// ── 事实校验（§5.3 / §10.2）──

test('event validation accepts the supported facts and rejects unknown or retired ones', (t) => {
  const db = fixture(t);
  assert.ok(validateReactionEvent({ event: baseEvent() }, db).ok);
  for (const type of ['character.pin_enabled', 'moment.like_enabled', 'appearance.applied', 'appearance.restored', 'letter.reopened', 'character.avatar_changed', 'character.display_name_changed', 'moment.share_exported', 'character.relationship_changed', 'schedule.peeked']) {
    assert.ok(EVENT_FACTS[type], `${type} 缺少后端事实说明`);
  }
  assert.equal(validateReactionEvent({ event: baseEvent({ type: 'unknown.thing' }) }, db).status, 400);
  // 已退回：图片下载 / 看图组合、礼物收起
  for (const type of ['photo.download_requested', 'photo.saved_after_viewing', 'gift.selection_abandoned']) {
    assert.equal(EVENT_FACTS[type], undefined, `${type} 已退回，不应再被接受`);
  }
});

test('event validation rejects a mismatched actor, outcome and missing resource', (t) => {
  const db = fixture(t);
  assert.equal(validateReactionEvent({ event: baseEvent({ actorKey: 'npc:3' }) }, db).status, 400);
  assert.equal(validateReactionEvent({ event: baseEvent({ actorKey: 'character:999' }) }, db).status, 404);
  assert.equal(validateReactionEvent({ event: baseEvent({ outcome: 'cancelled' }) }, db).status, 400);
  assert.equal(validateReactionEvent({ event: baseEvent({ subject: { kind: 'character', id: '' } }) }, db).status, 400);
  assert.equal(validateReactionEvent({ event: baseEvent({ occurredAtMs: 0 }) }, db).status, 400);
});

test('resource ownership is re-verified on the server for likes and letters', (t) => {
  const db = fixture(t);
  const like = (postId) => validateReactionEvent({
    event: baseEvent({ type: 'moment.like_enabled', outcome: 'confirmed', subject: { kind: 'moment', id: String(postId) } }),
  }, db);

  assert.ok(like(1).ok, '角色自己的动态通过');
  assert.equal(like(2).status, 400, '用户自己的动态没有角色目标');
  assert.equal(like(3).status, 400, '镇民动态首期不接入');
  assert.equal(like(4).status, 400, '作者与反馈角色不一致');
  assert.equal(like(99).status, 404, '帖子不存在');

  const letter = (id, direction) => validateReactionEvent({
    event: baseEvent({
      type: 'letter.reopened',
      outcome: 'confirmed',
      actorKey: 'character:42',
      subject: { kind: 'letter', id: String(id) },
    }),
  }, db);
  assert.ok(letter(11).ok);
  assert.equal(letter(12).status, 400, '只能重开角色写来的回信');
});

test('the operation description follows each fact boundary and never claims more than the facts', (t) => {
  const db = fixture(t);
  const pinned = validateReactionEvent({ event: baseEvent() }, db);
  assert.match(pinned.content, /置顶/);
  const old = validateReactionEvent({
    event: baseEvent({ type: 'moment.like_enabled', outcome: 'confirmed', payload: { old: true }, subject: { kind: 'moment', id: '1' } }),
  }, db);
  assert.match(old.content, /很久以前的旧动态/);
  const restored = validateReactionEvent({
    event: baseEvent({ type: 'appearance.restored', outcome: 'applied', subject: { kind: 'outfit', id: 'outfit-a' } }),
  }, db);
  assert.match(restored.content, /换回/);
});

test('prompt layers keep the fixed order and stay identical across operations', (t) => {
  fixture(t);
  const prefix = { system1: '固定破甲与世界观文本', system2: '世界观强化文本' };
  const layersA = describePromptLayers({
    prefix,
    character: CHARACTER,
    userContext: buildUserContext({
      characterId: 42,
      content: { type: 'character.pin_enabled', content: '用户把该角色置顶了', actorKey: 'character:42' },
      occurredAtMs: NOW,
      history: [],
      nowMs: NOW,
      timeZone: TZ,
    }),
  });
  assert.deepEqual(layersA.map(l => l.role), ['system', 'system', 'system', 'system', 'user']);

  const layersB = describePromptLayers({
    prefix,
    character: CHARACTER,
    userContext: buildUserContext({
      characterId: 42,
      content: { type: 'letter.reopened', content: '用户重新打开了该角色写的一封已读旧回信', actorKey: 'character:42' },
      occurredAtMs: NOW + 3600_000,
      history: [{ type: 'character.pin_enabled', content: '用户把该角色置顶', actorKey: 'character:42', occurredAtMs: NOW - 60_000 }],
      nowMs: NOW + 3600_000,
      timeZone: TZ,
    }),
  });
  // 前四条 system 逐字一致：操作、日期、时间都只在最后一条 user 里
  for (let i = 0; i < 4; i += 1) {
    assert.equal(layersA[i].length, layersB[i].length, `第 ${i + 1} 层 system 长度必须一致`);
    assert.equal(layersA[i].head, layersB[i].head);
  }
  assert.notEqual(layersA[4].length, layersB[4].length, 'user 层随本次材料变化');

  // 今天 / 现在等动态值只能出现在最后一条 user 消息里
  const messages = buildMessages({ prefix, character: CHARACTER, userContext: '{"today":"2026-10-03"}' });
  assert.deepEqual(messages.map(m => m.role), ['system', 'system', 'system', 'system', 'user']);
  assert.ok(!messages.slice(0, 4).some(m => m.content.includes('2026-10-03')));
});

test('system3 is event-agnostic and embeds the character emoji options into the output format', () => {
  const system3 = buildTaskSystem();
  // 事件语义改由 user 层自然语言事实承载，system3 不再出现事件类型表
  for (const type of Object.keys(EVENT_FACTS)) assert.ok(!system3.includes(type), `${type} 不应再出现在 system3`);
  assert.ok(system3.includes('"emoji"'));
  assert.ok(system3.includes('没有可选表情'), '没有可选表情清单时明确填 null');
  assert.match(system3, /最多 40 个可见字符/);
  assert.equal(system3, buildTaskSystem(), 'system3 在进程内逐字稳定');

  // 可选表情写进输出格式，并带语义标记与「挑最贴合情绪」的要求
  const withOptions = buildTaskSystem(['开心', '害羞']);
  assert.ok(withOptions.includes('开心 / 害羞'), '可选表情只出现在 JSON 示例里');
  assert.match(withOptions, /最贴切/);
  assert.ok(!withOptions.includes('固定填 null'));
  assert.ok(!withOptions.includes('开心（'), '正文不再附带一堆 emoji 标记');
  assert.notEqual(withOptions, system3, '不同表情清单生成不同的 system3');
})

test('the persona layer prefers base_prompt and never leaks dynamic values', (t) => {
  fixture(t);
  const prefix = { system1: '固定破甲与世界观文本', system2: '世界观强化文本' };
  const { system1, system2, system3, system4 } = buildMessages({
    prefix,
    character: CHARACTER,
    userContext: '{"today":"2026-10-03"}',
  }).reduce((acc, message, index) => ({ ...acc, [`system${index + 1}`]: message.content }), {});
  assert.equal(system4, CHARACTER.base_prompt);
  assert.ok(!system4.includes('2026-10-03'), '日期不得进入 system 前缀');
  assert.ok(!system1.includes('2026-10-03'));
  assert.ok(!system2.includes('2026-10-03'));
  assert.ok(!system3.includes('2026-10-03'));
  // 情绪数值与生效外观查询结果也不得进入 system4
  assert.ok(!system4.includes('平静'));
  // short_prompt 仅作为 base_prompt 缺失时的回退
  const fallback = buildMessages({ prefix, character: { ...CHARACTER, base_prompt: '' }, userContext: 'x' })[3].content;
  assert.equal(fallback, CHARACTER.short_prompt);
});

test('user context is a plain natural-language log with only this character, names and phrased affinity', () => {
  const text = buildUserContext({
    characterId: 42,
    characterName: '小满',
    content: { type: 'character.pin_enabled', content: '用户把该角色置顶了', actorKey: 'character:42' },
    occurredAtMs: NOW,
    history: [
      { type: 'character.pin_enabled', content: '用户把角色42置顶', actorKey: 'character:42', occurredAtMs: NOW - 720_000 },
      { type: 'moment.like_enabled', content: '用户点赞了角色7发布的一条动态', actorKey: 'character:7', occurredAtMs: NOW - 600_000 },
      { type: 'appearance.applied', content: '用户给角色42用了外观类道具', actorKey: 'character:42', occurredAtMs: NOW - 300_000 },
      { type: 'appearance.applied', content: '用户给角色42用了外观类道具', actorKey: 'character:42', occurredAtMs: NOW - 30_000 },
    ],
    nowMs: NOW,
    timeZone: TZ,
    relationship: { relationshipText: '好闺蜜', affinity: 68, isOath: false },
    emotion: '平静',
    nameMap: { 'character:42': '小满', 'character:7': '阿七' },
  });

  assert.match(text, /^现在是 2026年10月3日 14:32。/);
  assert.match(text, /角色：小满。/);
  assert.match(text, /与玩家：你们的关系是好闺蜜，好感度不错，已经有些亲近，当前情绪基线是平静。/);
  assert.match(text, /此前操作：/);
  assert.match(text, /- 10月3日 14:20 用户把小满置顶/);
  assert.match(text, /- 10月3日 14:31 用户给小满用了外观类道具/, '同一事实去重，保留最近一次');
  assert.match(text, /本次操作：\n- 10月3日 14:32 用户把小满置顶了$/);
  // 完全自然语言：没有 JSON、字段名、数字 ID、其他角色，也不出现好感度裸数字
  assert.ok(!text.includes('{'));
  assert.ok(!text.includes('feedbackShown'));
  assert.ok(!text.includes('actorKey'));
  assert.ok(!text.includes('character:'));
  assert.ok(!text.includes('阿七'), '其他角色的历史不注入');
  assert.ok(!text.includes('68'), '好感度不出现裸数字');

  const fallback = buildUserContext({
    characterId: 42,
    content: { type: 'character.pin_enabled', content: '用户把角色42置顶' },
    occurredAtMs: NOW,
    history: [],
    nowMs: NOW,
    timeZone: TZ,
  });
  assert.match(fallback, /角色：角色。/);
  assert.match(fallback, /- 10月3日 14:32 用户把该角色置顶/);

  // 玩家昵称已设置时，日志里不再出现「用户」
  const named = buildUserContext({
    characterId: 42,
    characterName: '小满',
    userName: '小明',
    content: { type: 'character.pin_enabled', content: '用户把该角色置顶了' },
    occurredAtMs: NOW,
    history: [{ type: 'character.pin_enabled', content: '用户把角色42置顶', actorKey: 'character:42', occurredAtMs: NOW - 60_000 }],
    nowMs: NOW,
    timeZone: TZ,
    relationship: { relationshipText: '好闺蜜', affinity: 77, isOath: false },
    nameMap: { 'character:42': '小满' },
  });
  assert.match(named, /与小明：你们的关系是好闺蜜，好感度很高，相当亲近。/);
  assert.match(named, /- 10月3日 14:31 小明把小满置顶/);
  assert.match(named, /- 10月3日 14:32 小明把小满置顶了/);
  assert.ok(!named.includes('用户'), '设置昵称后不再出现「用户」');
})

test('user context omits the relationship line when there is no data and handles an empty history', () => {
  const text = buildUserContext({
    characterId: 42,
    content: { type: 'character.pin_enabled', content: '用户把该角色置顶了' },
    occurredAtMs: NOW,
    history: [],
    nowMs: NOW,
    timeZone: TZ,
  });
  assert.ok(!text.includes('与玩家'));
  assert.ok(!text.includes('此前操作'));
  assert.match(text, /本次操作：/);
})

test('zoned helpers follow the given time zone instead of the host zone', () => {
  assert.equal(zonedDayKey(NOW, TZ), '2026-10-03');
  assert.equal(formatZonedIso(NOW, TZ), '2026-10-03T14:32:18+08:00');
  assert.equal(formatZonedIso(NOW, 'UTC'), '2026-10-03T06:32:18+00:00');
  // 跨日：同一条 UTC 时刻在不同时区可能属于不同的本地日
  assert.equal(zonedDayKey(Date.parse('2026-10-02T17:00:00.000Z'), TZ), '2026-10-03');
});

test('the parser accepts only the exact contract', () => {
  const ok = parseReactionOutput('{"text":"这张你也要留着啊。","emoji":"开心"}');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { text: '这张你也要留着啊。', emoji: '开心' });
  const noEmoji = parseReactionOutput('{"text":"嗯，收着吧。","emoji":null}');
  assert.equal(noEmoji.ok, true);
  assert.equal(noEmoji.value.emoji, null);
  // 围栏与首尾解释会被剥离后再解析
  const fenced = parseReactionOutput('```json\n{"text":"嗯，收着吧。","emoji":null}\n```');
  assert.equal(fenced.ok, true);
  assert.equal(fenced.value.text, '嗯，收着吧。');
});

test('the parser rejects extra fields, malformed emoji and broken text', () => {
  const cases = [
    ['{"text":"这句台词正常。","emoji":null,"extra":1}', /额外字段/],
    ['{"text":"这句台词正常。","emoji":123}', /emoji/],
    ['{"emoji":"开心"}', /text/],
    ['{"text":"","emoji":null}', /text 为空/],
    ['{"text":"<b>加粗</b>","emoji":null}', /HTML/],
    ['{"text":"{itemName}穿上了。","emoji":null}', /占位符/],
    ['{"text":"这一句台词实在太长了，长到已经超过四十个可见字符的上限，因此必须被严格解析器直接拒绝掉而不是截断","emoji":null}', /可见字符/],
    ['not json at all', /合法 JSON/],
    ['', /为空/],
  ];
  for (const [raw, pattern] of cases) {
    const result = parseReactionOutput(raw);
    assert.equal(result.ok, false, `应当拒绝：${raw.slice(0, 24)}`);
    assert.match(result.error, pattern);
  }
  assert.ok(Array.from('好'.repeat(MAX_TEXT_CHARS)).length === 40);
});

test('a successful call returns the parsed line and consumes exactly one model call', async (t) => {
  const db = fixture(t);
  let calls = 0;
  const result = await generateInstantReaction({
    event: baseEvent(),
    db,
    nowMs: NOW,
    timeZone: TZ,
    emojis: ['开心', '害羞'],
    callLlm: async () => {
      calls += 1;
      return '{"text":"这张你也要留着啊。","emoji":"开心"}';
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.text, '这张你也要留着啊。');
  assert.equal(result.emoji, '开心');
  assert.equal(calls, 1);
});

test('instant reaction only accepts emoji keys the character actually owns', async (t) => {
  const db = fixture(t);
  const owned = await generateInstantReaction({
    event: baseEvent(), db, nowMs: NOW, timeZone: TZ, emojis: ['开心', '害羞'],
    callLlm: async () => '{"text":"给你看看。","emoji":"害羞"}',
  });
  assert.equal(owned.emoji, '害羞');

  const invented = await generateInstantReaction({
    event: baseEvent({ eventId: 'evt-2', operationId: 'op-2' }), db, nowMs: NOW + 1000, timeZone: TZ, emojis: ['开心'],
    callLlm: async () => '{"text":"给你看看。","emoji":"自创表情"}',
  });
  assert.equal(invented.emoji, null, '自造类别一律回退 null');

  const none = await generateInstantReaction({
    event: baseEvent({ eventId: 'evt-3', operationId: 'op-3' }), db, nowMs: NOW + 2000, timeZone: TZ, emojis: [],
    callLlm: async () => '{"text":"给你看看。","emoji":"开心"}',
  });
  assert.equal(none.emoji, null, '角色没有表情包时 emoji 必须为 null');
});

test('an invalid model output fails without a second attempt', async (t) => {
  const db = fixture(t);
  let calls = 0;
  const result = await generateInstantReaction({
    event: baseEvent(),
    db,
    nowMs: NOW,
    timeZone: TZ,
    callLlm: async () => {
      calls += 1;
      return '{"text":"太长了".repeat(30),"emoji":null}';
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  assert.equal(calls, 1, '非法输出不做第二次修复调用');
});

test('a rejected fact never reaches the model', async (t) => {
  const db = fixture(t);
  let calls = 0;
  const result = await generateInstantReaction({
    event: baseEvent({ actorKey: 'character:999' }),
    db,
    nowMs: NOW,
    timeZone: TZ,
    callLlm: async () => { calls += 1; return '{}'; },
  });
  assert.equal(result.status, 404);
  assert.equal(calls, 0);
});

test('a timeout is reported and does not throw', async (t) => {
  const db = fixture(t);
  const result = await generateInstantReaction({
    event: baseEvent(),
    db,
    nowMs: NOW,
    timeZone: TZ,
    timeoutMs: 10,
    callLlm: async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 504);
  assert.match(result.reason, /超时/);
});
