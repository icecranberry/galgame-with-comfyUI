import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import Database from 'better-sqlite3';
import { buildPromptProfile } from '../src/services/lorebook/promptProfile.js';

// Exercise the real context builder without opening the application DB or starting schedulers.
const source = readFileSync(new URL('../src/services/wakeService.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?\n/gm, '')
  .replace('export async function processWakeUp', 'async function processWakeUp');
const character = { id: 1, display_name: '昔涟', base_prompt: '你是昔涟，有自己的说话习惯。' };

function fixture(t, { world = '<world_setting>小镇</world_setting>', persona = character.base_prompt } = {}) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE user_relationships (character_id INTEGER, relationship_text TEXT, is_oath INTEGER);
    CREATE TABLE raw_messages (id INTEGER PRIMARY KEY, conversation_id TEXT, role TEXT, content TEXT);`);
  const build = runInNewContext(`${source}\nbuildWakeContext;`, {
    getDb: () => db, getSystemRules: () => '固定规则', getWorldSetting: () => world,
    config: { user: { nickname: '冰乐' } }, loadEmotionState: () => null,
  });
  return {
    db,
    build: (mode = 'phone', attempts = 1, dream = null, userName = '冰乐') =>
      JSON.parse(JSON.stringify(build({ ...character, base_prompt: persona }, 'char_1', userName, mode, attempts, dream))),
  };
}

test('all wake modes request short spoken lines rather than continuing a bracketed scene', t => {
  const { build } = fixture(t);
  for (const [mode, cue] of [['phone', '接通'], ['door', '上门'], ['shake', '又把你摇醒'], ['other', '把你叫醒']]) {
    const { messages } = build(mode);
    assert.equal(messages.filter(m => m.role === 'user').length, 1);
    assert.equal(messages.at(-1).role, 'user');
    assert.ok(messages.at(-1).content.includes(cue));
    assert.match(messages.at(-1).content, /1～3 句台词，最多 80 字，不要旁白或动作描写/);
    assert.ok(!messages.at(-1).content.startsWith('（'));
    const rulesIndex = messages.findIndex(m => m.content.startsWith('【叫醒回应】'));
    assert.ok(rulesIndex < messages.findIndex(m => m.content.startsWith(character.base_prompt)));
    assert.match(messages[rulesIndex].content, /不必一律撒娇或示爱/);
  }
});

test('dream and unread messages remain context, with original history packaging intact', t => {
  const { db, build } = fixture(t);
  const insert = db.prepare('INSERT INTO raw_messages(conversation_id, role, content) VALUES (?, ?, ?)');
  insert.run('char_1', 'user', '今天忙吗？');
  insert.run('char_1', 'assistant', '店里没有客人。');
  insert.run('char_1', 'user', '钥匙找不到了。');
  const { messages } = build('phone', 2, { content: '在麦田里散步' });
  assert.ok(messages.some(m => m.role === 'system' && m.content === '以下是你们睡着前的最后一段对话，可作为此刻回应的上下文参考：\n\n[冰乐]: 今天忙吗？\n[昔涟]: 店里没有客人。'));
  assert.ok(messages.some(m => m.role === 'system' && m.content === '以下是 冰乐 在你睡觉时发的未回复消息：\n\n[冰乐]: 钥匙找不到了。'));
  assert.ok(messages.some(m => m.content.includes('在麦田里散步') && m.content.includes('不复述梦境')));
  assert.equal(messages.filter(m => m.role === 'user').length, 1);
});

test('stable boundary excludes relationships, wake mode, attempts, dreams and history', t => {
  for (const world of ['', '<world_setting>小镇</world_setting>']) {
    for (const persona of ['', character.base_prompt]) {
      const { db, build } = fixture(t, { world, persona });
      const before = build();
      db.exec("INSERT INTO user_relationships VALUES(1, '朋友', 1); INSERT INTO raw_messages VALUES(1, 'char_1', 'user', '醒醒');");
      const after = build('shake', 3, { content: '另一场梦' }, '另一位用户');
      const prefix = ({ messages, cacheBoundary: { index, offset } }) =>
        [...messages.slice(0, index), { ...messages[index], content: messages[index].content.slice(0, offset) }];
      assert.deepEqual(prefix(before), prefix(after));
      assert.notDeepEqual(before.messages, after.messages);
      const profile = buildPromptProfile(after.messages, {
        personaTexts: [persona].filter(Boolean), staticTexts: after.staticTexts, cacheBoundary: after.cacheBoundary,
      });
      assert.equal(profile.cacheBoundary.index, after.cacheBoundary.index);
      assert.equal(profile.cacheBoundary.offset, after.cacheBoundary.offset);
      assert.equal(profile.personas.length, persona ? 1 : 0);
      assert.ok(!JSON.stringify(prefix(after)).includes('另一场梦'));
    }
  }
});
