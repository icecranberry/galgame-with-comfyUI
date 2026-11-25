import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`characterImages test forbids network: ${url}`); };
const { config } = await import('../src/config.js'); config.dbPath = ':memory:';
const { getDb } = await import('../src/db/index.js');
const { collectCharacterImageUrls } = await import('../src/services/characterImages.js');

const log = console.log;
console.log = () => {};
const db = getDb();
console.log = log;

function addCharacter(name) {
  return Number(db.prepare('INSERT INTO characters (name, display_name, base_prompt) VALUES (?, ?, ?)').run(name, name, '').lastInsertRowid);
}

test('表情立绘算作角色图片，抠图和原图都收录', () => {
  const id = addCharacter('expression_owner');
  const other = addCharacter('expression_other');
  const insert = db.prepare('INSERT INTO expression_standings (character_id, slot_id, image_url, source_url, status) VALUES (?, ?, ?, ?, ?)');
  insert.run(id, 'normal', '/images/expression_standing/char_a_normal.png', '/images/expression_standing/source_char_a_normal.png', 'done');
  insert.run(id, 'emoji:1', '/images/expression_standing/char_a_emoji_1.png', null, 'done');
  insert.run(id, 'emoji:2', null, null, 'empty');
  insert.run(other, 'normal', '/images/expression_standing/char_b_normal.png', '/images/expression_standing/source_char_b_normal.png', 'done');

  const urls = collectCharacterImageUrls(id);
  for (const url of ['/images/expression_standing/char_a_normal.png', '/images/expression_standing/source_char_a_normal.png', '/images/expression_standing/char_a_emoji_1.png']) {
    assert.ok(urls.includes(url), `missing ${url}`);
  }
  assert.ok(!urls.some(url => url.includes('char_b_')), 'another character\'s standings leaked in');
  assert.ok(!urls.includes(null) && !urls.includes(''));
});

test('玩家自己的表情立绘不会出现在角色名下', () => {
  const id = addCharacter('expression_player_check');
  db.prepare('INSERT INTO expression_standings (character_id, slot_id, image_url, status) VALUES (NULL, ?, ?, ?)').run('normal', '/images/expression_standing/player_normal.png', 'done');
  assert.ok(!collectCharacterImageUrls(id).includes('/images/expression_standing/player_normal.png'));
});
