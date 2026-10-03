import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initSettingsHandle } from '../src/db/settings.js';
import { initWorldRepository } from '../src/db/worldRepository.js';
import { migrateCharacterReactionPacksSchema } from '../src/db/characterReactionPackSchema.js';
import {
  PACK_EVENT_TYPES,
  PACK_LINES_PER_EVENT,
  PACK_MAX_TOKENS,
  PACK_TEMPLATE_VERSION,
  buildPackMessages,
  buildPackOutputExample,
  deleteReactionPack,
  generateReactionPack,
  getReactionPack,
  normalizePackEventTypes,
  packToOverrides,
  parseReactionPack,
  personaFingerprint,
  saveManualReactionPack,
  saveReactionPack,
} from '../src/services/characterReactionPackService.js';
import { pickReactionMarker } from '../src/services/emojiService.js';

const CHARACTER = {
  id: 42,
  display_name: '小满',
  base_prompt: '你是小满，说话慢半拍，不太会把心事说满。',
  short_prompt: '短版人格',
};

function fixture(t, { characters = [CHARACTER] } = {}) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE characters (id INTEGER PRIMARY KEY, display_name TEXT, name TEXT, base_prompt TEXT, short_prompt TEXT);
    CREATE TABLE system_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT, updated_at TEXT);
    CREATE TABLE world_settings (id INTEGER PRIMARY KEY, name TEXT, content TEXT, is_active INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
    CREATE TABLE global_rules (id INTEGER PRIMARY KEY, rule_key TEXT, rule_content TEXT, is_active INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT);
  `);
  for (const character of characters) {
    db.prepare('INSERT INTO characters (id, display_name, base_prompt, short_prompt) VALUES (?,?,?,?)')
      .run(character.id, character.display_name, character.base_prompt, character.short_prompt);
  }
  initSettingsHandle(db);
  initWorldRepository(db);
  migrateCharacterReactionPacksSchema(db);
  return db;
}

/** 构造一份合法的模型输出 */
function packJson({ characterId = 42, eventTypes = PACK_EVENT_TYPES, lines = 3, mutate = null } = {}) {
  const pack = {
    schemaVersion: 1,
    characterId,
    reactions: eventTypes.map((type, index) => ({
      eventType: type,
      lines: Array.from({ length: lines }, (_, i) => ({
        text: `${type} 的第${i + 1}条台词示例。`,
        emotion: ['pleased', 'neutral', 'shy', 'surprised'][(index + i) % 4],
      })),
    })),
  };
  if (mutate) mutate(pack);
  return JSON.stringify(pack);
}

// ── 请求集合与示例 ──

test('the event whitelist keeps only supported events, in order and deduplicated', () => {
  assert.deepEqual(normalizePackEventTypes(['appearance.applied', 'appearance.applied', 'nope']), ['appearance.applied']);
  assert.deepEqual(normalizePackEventTypes(PACK_EVENT_TYPES), PACK_EVENT_TYPES);
  assert.deepEqual(normalizePackEventTypes(null), []);
  assert.equal(PACK_EVENT_TYPES.length, 4, '只看图/礼物/寄信已退回，短句包同步收窄');
});

test('the prompt carries a complete JSON example for exactly the requested events', (t) => {
  fixture(t);
  const example = JSON.parse(buildPackOutputExample(['appearance.applied', 'character.pin_enabled'], 0));
  assert.deepEqual(Object.keys(example), ['schemaVersion', 'characterId', 'reactions']);
  assert.equal(example.schemaVersion, 1);
  assert.deepEqual(example.reactions.map(item => item.eventType), ['appearance.applied', 'character.pin_enabled']);
  for (const item of example.reactions) {
    assert.equal(item.lines.length, PACK_LINES_PER_EVENT);
    for (const line of item.lines) assert.deepEqual(Object.keys(line), ['text', 'emotion']);
  }

  const messages = buildPackMessages({ character: CHARACTER, eventTypes: ['appearance.applied', 'character.pin_enabled'] });
  assert.deepEqual(messages.map(m => m.role), ['system', 'system', 'system', 'user']);
  const task = messages[1].content;
  // 示例与说明必须完整出现在提示词里，且不包含本次角色 ID
  assert.ok(task.includes('"schemaVersion": 1'));
  assert.ok(task.includes('"eventType": "appearance.applied"'));
  assert.ok(task.includes('"eventType": "character.pin_enabled"'));
  assert.ok(!task.includes('"characterId": 42'), '固定示例用占位 ID，实际 ID 只在 user 层');
  assert.ok(task.includes(`恰好 ${PACK_LINES_PER_EVENT} 条`));
  // 每个请求事件都有事实边界说明
  for (const type of ['appearance.applied', 'character.pin_enabled']) assert.ok(task.includes(type));
  // 人格放独立 system，user 层只给 ID 与角色名
  assert.equal(messages[2].content, CHARACTER.base_prompt);
  assert.ok(messages[3].content.includes('42'));
  assert.ok(messages[3].content.includes('小满'));
});

// ── 严格解析 ──

test('a valid pack parses and preserves event order', () => {
  const parsed = parseReactionPack(packJson(), { characterId: 42, eventTypes: PACK_EVENT_TYPES });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.pack.characterId, 42);
  assert.deepEqual(parsed.pack.reactions.map(item => item.eventType), PACK_EVENT_TYPES);
  assert.equal(parsed.pack.reactions[0].lines.length, PACK_LINES_PER_EVENT);
});

test('the parser rejects wrong character id, missing events, duplicate events and bad line counts', () => {
  const cases = [
    [packJson({ characterId: 7 }), /characterId/],
    [packJson({ eventTypes: ['appearance.applied'] }), /缺少事件/],
    [packJson({ mutate: p => p.reactions.push({ ...p.reactions[0] }) }), /重复/],
    [packJson({ mutate: p => p.reactions[0].lines.pop() }), /恰好 3 条/],
    [packJson({ mutate: p => p.reactions.push({ eventType: 'moment.share_exported', lines: p.reactions[0].lines }) }), /未请求的事件/],
    [packJson({ mutate: p => { p.schemaVersion = 2 } }), /schemaVersion/],
    [packJson({ mutate: p => { p.extra = true } }), /额外字段/],
    [packJson({ mutate: p => { p.reactions[0].lines[0].emotion = 'angry' } }), /emotion/],
    [packJson({ mutate: p => { p.reactions[0].lines[0].text = '' } }), /为空/],
    [packJson({ mutate: p => { p.reactions[0].lines[0].text = '这一句台词实在是太长了，长到已经超过四十个可见字符的上限，所以必须被严格解析器直接拒绝' } }), /可见字符/],
    [packJson({ mutate: p => { p.reactions[0].lines[0].text = '<b>加粗</b>' } }), /HTML/],
    [packJson({ mutate: p => { p.reactions[0].lines[0].text = '{itemName}穿上了。' } }), /占位符/],
    [packJson({ mutate: p => { p.reactions[0].lines[0].extra = 1 } }), /额外字段/],
    ['{"schemaVersion":1,"characterId":42,"reactions":[]}', /缺少事件/],
    ['{broken', /合法 JSON/],
    ['', /为空/],
  ];
  for (const [raw, pattern] of cases) {
    const parsed = parseReactionPack(raw, { characterId: 42, eventTypes: PACK_EVENT_TYPES });
    assert.equal(parsed.ok, false, `应当拒绝：${String(raw).slice(0, 40)}`);
    assert.match(parsed.error, pattern);
  }
});

test('the parser strips a code fence before validating', () => {
  const fenced = `\`\`\`json\n${packJson()}\n\`\`\``;
  assert.equal(parseReactionPack(fenced, { characterId: 42, eventTypes: PACK_EVENT_TYPES }).ok, true);
});

// ── 覆盖结构与人格指纹 ──

test('packToOverrides maps every event to a phrase-keyed override', () => {
  const parsed = parseReactionPack(packJson({ eventTypes: ['appearance.applied'] }), { characterId: 42, eventTypes: ['appearance.applied'] });
  const overrides = packToOverrides(parsed.pack);
  assert.deepEqual(Object.keys(overrides), ['appearance.applied']);
  assert.equal(overrides['appearance.applied'].length, PACK_LINES_PER_EVENT);
  assert.ok(overrides['appearance.applied'][0].text.length > 0);
});

test('the persona fingerprint tracks base_prompt and ignores unrelated fields', () => {
  const a = personaFingerprint(CHARACTER);
  const b = personaFingerprint({ ...CHARACTER, display_name: '别的名字' });
  assert.equal(a, b, '改名不改变人格指纹');
  const c = personaFingerprint({ ...CHARACTER, base_prompt: `${CHARACTER.base_prompt}多一句。` });
  assert.notEqual(a, c);
  assert.equal(personaFingerprint({ base_prompt: '', short_prompt: '只有短版' }), personaFingerprint({ base_prompt: '', short_prompt: '只有短版' }));
  assert.equal(personaFingerprint({ base_prompt: '', short_prompt: '' }), 'empty');
});

// ── 生成、保存与失效 ──

test('generation stores one pack per character and reads it back with overrides', async (t) => {
  const db = fixture(t);
  let calls = 0;
  const result = await generateReactionPack({
    characterId: 42,
    eventTypes: PACK_EVENT_TYPES,
    db,
    callLlm: async (messages, options) => {
      calls += 1;
      assert.deepEqual(messages.map(m => m.role), ['system', 'system', 'system', 'user']);
      assert.equal(options.max_tokens, PACK_MAX_TOKENS);
      assert.equal(options.retries, 0);
      assert.deepEqual(options.response_format, { type: 'json_object' });
      return packJson();
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  assert.equal(result.entry.status, 'ready');
  assert.equal(result.entry.stale, false);
  assert.ok(result.entry.overrides['appearance.applied']);

  // 重复读取不再产生模型调用
  const again = getReactionPack(42, db);
  assert.equal(again.status, 'ready');
  assert.equal(calls, 1);

  const rows = db.prepare('SELECT COUNT(*) AS c FROM character_reaction_packs').get();
  assert.equal(rows.c, 1, '一个角色只有一份包');
});

test('an invalid model output never overwrites the previous valid pack', async (t) => {
  const db = fixture(t);
  await generateReactionPack({ characterId: 42, eventTypes: PACK_EVENT_TYPES, db, callLlm: async () => packJson() });
  const before = getReactionPack(42, db);
  assert.equal(before.status, 'ready');

  const failed = await generateReactionPack({
    characterId: 42,
    eventTypes: PACK_EVENT_TYPES,
    db,
    callLlm: async () => '{"schemaVersion":1,"characterId":42,"reactions":[]}',
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.status, 502);
  const after = getReactionPack(42, db);
  assert.deepEqual(after.overrides, before.overrides, '旧包保持可用');
});

test('a changed persona marks the pack updatable without regenerating it', async (t) => {
  const db = fixture(t);
  await generateReactionPack({ characterId: 42, eventTypes: PACK_EVENT_TYPES, db, callLlm: async () => packJson() });
  assert.equal(getReactionPack(42, db).status, 'ready');

  db.prepare('UPDATE characters SET base_prompt = ? WHERE id = 42').run('改成了另一套完全不同的性格设定，说话很急。');
  const stale = getReactionPack(42, db);
  assert.equal(stale.status, 'updatable');
  assert.equal(stale.stale, true);
  assert.ok(stale.overrides['appearance.applied'], '人设变化后继续使用合法旧包，不自动重生成');
});

test('delete removes the pack and a manual save goes through the same validation', async (t) => {
  const db = fixture(t);
  await generateReactionPack({ characterId: 42, eventTypes: PACK_EVENT_TYPES, db, callLlm: async () => packJson() });
  assert.equal(deleteReactionPack(42, db), true);
  assert.equal(getReactionPack(42, db), null);
  assert.equal(deleteReactionPack(42, db), false);

  const manual = saveManualReactionPack({ characterId: 42, pack: JSON.parse(packJson()), db });
  assert.equal(manual.ok, true);
  assert.equal(manual.entry.status, 'ready');

  const bad = saveManualReactionPack({ characterId: 42, pack: { schemaVersion: 1, characterId: 42, reactions: [] }, db });
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 400);
  assert.ok(getReactionPack(42, db).overrides['appearance.applied'], '非法手动包不破坏已有内容');

  const missing = saveManualReactionPack({ characterId: 999, pack: JSON.parse(packJson()), db });
  assert.equal(missing.status, 404);
});

test('unknown characters and empty event sets never reach the model', async (t) => {
  const db = fixture(t);
  let calls = 0;
  const callLlm = async () => { calls += 1; return packJson(); };

  const missing = await generateReactionPack({ characterId: 999, eventTypes: PACK_EVENT_TYPES, db, callLlm });
  assert.equal(missing.status, 404);
  const empty = await generateReactionPack({ characterId: 42, eventTypes: ['nope'], db, callLlm });
  assert.equal(empty.status, 400);
  assert.equal(calls, 0);
});

test('saveReactionPack writes the template version and fingerprint for later auditing', async (t) => {
  const db = fixture(t);
  await generateReactionPack({ characterId: 42, eventTypes: PACK_EVENT_TYPES, db, callLlm: async () => packJson() });
  const row = db.prepare('SELECT prompt_template_version, persona_fingerprint, schema_version FROM character_reaction_packs WHERE character_id = 42').get();
  assert.equal(row.prompt_template_version, PACK_TEMPLATE_VERSION);
  assert.equal(row.schema_version, 1);
  assert.equal(row.persona_fingerprint, personaFingerprint(CHARACTER));

  // 直接保存非法结构必须被拒绝
  assert.throws(() => saveReactionPack({ characterId: 42, pack: { nope: true }, db }), /结构不合法/);
});

test('the semantic marker mapping gives every default category one of the four markers', () => {
  const defaults = ['开心', '难过', '哭', '生气', '哈哈大笑', '卖萌', '晕倒', '害羞', '惊讶', '委屈', '得意', '比心', '无语', '嫌弃', '心虚'];
  const mapped = Object.fromEntries(defaults.map(key => [key, pickReactionMarker(key)]));
  assert.equal(mapped['开心'], '😊');
  assert.equal(mapped['哈哈大笑'], '😊');
  assert.equal(mapped['得意'], '😊');
  assert.equal(mapped['比心'], '😊');
  assert.equal(mapped['害羞'], '😳');
  assert.equal(mapped['惊讶'], '😮');
  // 宽泛的「兴」不能把「难过」误判成开心
  assert.equal(mapped['难过'], '🙂');
  assert.equal(mapped['哭'], '🙂');
  assert.equal(mapped['生气'], '🙂');
  // 改名 / 删除后无匹配 → 中性标记，由前端回退头像
  assert.equal(pickReactionMarker('自定义表情一'), '🙂');
  assert.equal(pickReactionMarker(''), '🙂');
  assert.equal(pickReactionMarker(undefined), '🙂');
  // 一个类别只会落到一个标记
  for (const key of defaults) assert.ok(['😊', '😳', '😮', '🙂'].includes(mapped[key]));
});
