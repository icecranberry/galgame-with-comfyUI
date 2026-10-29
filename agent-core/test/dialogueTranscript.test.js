import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { cleanDialogueText, readDialogueTranscript } from '../src/services/dialogueTranscript.js';
import { createStandingDisplay } from '../src/services/standingDisplayState.js';
import { withCharacterStandingStates } from '../src/services/characterStandingDisplay.js';

test('complete dialogue keeps paragraphs/actions and removes prompt protocols and registered expressions', () => {
  const source = '（抬起头）[开心]你好。\n\n这一段不能丢。\n{"prompt":"a \\"quoted\\" scene\\nwith light"}\n【害羞】再见。<needImage><br>尾声';
  assert.equal(cleanDialogueText(source, { emojiKeys: ['开心', '害羞'] }), '（抬起头）你好。\n\n这一段不能丢。\n\n再见。\n尾声');
  assert.equal(cleanDialogueText('台词{“prompt”:“secret”}继续'), '台词继续');
  assert.equal(cleanDialogueText('前文{"prompt":"a } inside", "metadata":{"x":1}}后文{"prompt":"second"}尾声'), '前文后文尾声');
  assert.equal(cleanDialogueText('台词{"prompt":"unfinished\nsecret'), '台词');
  assert.equal(cleanDialogueText('a<generate>secret\nmore</generate>b'), 'ab');
  assert.equal(cleanDialogueText('a<think>private</think>b'), 'ab');
  assert.equal(cleanDialogueText('保留 {普通正文} 和 [1, 2]。'), '保留 {普通正文} 和 [1, 2]。');
  assert.equal(cleanDialogueText('[开心]是我的原话', { role: 'user', emojiKeys: ['开心'] }), '[开心]是我的原话');
});

test('raw transcript paginates without truncating paragraphs, crossing characters, or exposing private columns', () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE raw_messages(id INTEGER PRIMARY KEY, conversation_id TEXT, role TEXT, content TEXT, prompt TEXT, thinking TEXT, created_at TEXT); CREATE TABLE emoji_categories(emoji_key TEXT); CREATE TABLE messages(id INTEGER PRIMARY KEY, conversation_id TEXT, raw_id INTEGER, images TEXT, seq INTEGER, role TEXT, content TEXT);');
    db.prepare('INSERT INTO emoji_categories VALUES (?)').run('开心');
    const insert = db.prepare('INSERT INTO raw_messages VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (let id = 1; id <= 5; id++) insert.run(id, 'char_1', id % 2 ? 'assistant' : 'user', `完整${id}\n第二段[开心]`, 'secret', 'private', '2026-10-12 10:00:00');
    insert.run(6, 'char_2', 'assistant', '其他角色', '', '', '2026-10-12 10:00:00');
    const tail = readDialogueTranscript(db, 1, { limit: 2 });
    assert.deepEqual(tail.messages.map(row => row.id), [4, 5]);
    assert.equal(tail.hasMore, true);
    assert.equal(tail.latestId, 5);
    assert.equal(tail.messages[1].content, '完整5\n第二段');
    assert.equal('prompt' in tail.messages[1], false);
    assert.equal('thinking' in tail.messages[1], false);
    assert.deepEqual(readDialogueTranscript(db, 1, { before: 4, limit: 2 }).messages.map(row => row.id), [2, 3]);
    assert.deepEqual(readDialogueTranscript(db, 1, { after: 2, limit: 2 }).messages.map(row => row.id), [3, 4]);
    assert.equal(readDialogueTranscript(db, 1, { after: 5 }).messages.length, 0);
    db.prepare('DELETE FROM raw_messages WHERE id=5').run();
    assert.equal(readDialogueTranscript(db, 1, { after: 5 }).latestId, 4);
  } finally { db.close(); }
});

test('dialogue joins all image bubbles, refreshes late attachments, and isolates character data', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE raw_messages(id INTEGER PRIMARY KEY, conversation_id TEXT, role TEXT, content TEXT, created_at TEXT);
      CREATE TABLE messages(id INTEGER PRIMARY KEY, conversation_id TEXT, raw_id INTEGER, images TEXT, seq INTEGER, role TEXT, content TEXT);
      CREATE TABLE emoji_categories(emoji_key TEXT);
      INSERT INTO raw_messages VALUES (1, 'char_1', 'assistant', '给你看', 'now'), (2, 'char_1', 'assistant', '', 'now'), (3, 'char_2', 'assistant', 'private', 'now');`);
    const insert = db.prepare('INSERT INTO messages(id,conversation_id,raw_id,images,seq) VALUES (?, ?, ?, ?, ?)');
    insert.run(1, 'char_1', 1, JSON.stringify(['/images/chat/one.png']), 0);
    insert.run(2, 'char_1', 1, JSON.stringify(['/images/chat/one.png', '/images/chat/two.png']), 1);
    insert.run(3, 'char_1', 2, 'broken JSON', 0);
    insert.run(4, 'char_2', 2, JSON.stringify(['/images/chat/private.png']), 0);
    const initial = readDialogueTranscript(db, 1);
    assert.deepEqual(initial.messages[0].images, ['/images/chat/one.png', '/images/chat/two.png']);
    assert.deepEqual(initial.messages[1].images, []);
    db.prepare('UPDATE messages SET images = ? WHERE id = 3').run(JSON.stringify(['/images/chat/late.png']));
    const refresh = readDialogueTranscript(db, 1, { after: 2, refreshIds: '1,2,3,invalid,-1' });
    assert.deepEqual(refresh.messages, []);
    assert.deepEqual(refresh.refreshed.map(row => row.id), [1, 2]);
    assert.equal(refresh.refreshed[1].content, '');
    assert.deepEqual(refresh.refreshed[1].images, ['/images/chat/late.png']);
    assert.equal(refresh.latestId, 2);
  } finally { db.close(); }
});

test('dialogue excludes stickers from mixed, sticker-only, and late-refreshed attachments', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE raw_messages(id INTEGER PRIMARY KEY, conversation_id TEXT, role TEXT, content TEXT, created_at TEXT);
      CREATE TABLE messages(id INTEGER PRIMARY KEY, conversation_id TEXT, raw_id INTEGER, images TEXT, seq INTEGER, role TEXT, content TEXT);
      CREATE TABLE emoji_categories(emoji_key TEXT);
      INSERT INTO emoji_categories VALUES ('开心');
      INSERT INTO raw_messages VALUES (1, 'char_1', 'assistant', '给你看[开心]', 'now'), (2, 'char_1', 'assistant', '[开心]', 'now');`);
    const insert = db.prepare('INSERT INTO messages(id,conversation_id,raw_id,images,seq) VALUES (?, ?, ?, ?, ?)');
    const photo = '/images/chat/photo.png?reference=/images/emoji/example.png';
    insert.run(1, 'char_1', 1, JSON.stringify(['/images/emoji/happy.png', photo, 'https://example.test/images/emoji/shy.png?v=1', '/images/chat/small-square.png']), 0);
    insert.run(2, 'char_1', 2, JSON.stringify(['/images/emoji/happy.png']), 0);
    const result = readDialogueTranscript(db, 1);
    assert.deepEqual(result.messages[0].images, [photo, '/images/chat/small-square.png']);
    assert.equal(result.messages[0].content, '给你看');
    assert.deepEqual(result.messages[1].images, []);
    assert.equal(result.messages[1].content, '');
    assert.equal(result.latestId, 2, 'filtering attachments must not move the raw message cursor');
    insert.run(3, 'char_1', 2, JSON.stringify(['/images/emoji/late.png', '/images/chat/late.png']), 1);
    const refresh = readDialogueTranscript(db, 1, { after: 2, refreshIds: '1,2' });
    assert.deepEqual(refresh.refreshed[1].images, ['/images/chat/late.png']);
    assert.deepEqual(JSON.parse(db.prepare('SELECT images FROM messages WHERE id=2').get().images), ['/images/emoji/happy.png'], 'normal chat keeps its original sticker attachments');
  } finally { db.close(); }
});

test('per-character expression survives global selection changes and quiet turns keep their original meaning', () => {
  const events = [];
  const options = { resolveImage: (id, slot) => ({ image_url: `${id}/${slot}` }), emit: state => events.push(state), epoch: 'test' };
  const display = withCharacterStandingStates(createStandingDisplay(options), options);
  display.select(1);
  const a = display.begin(1, 'a'); display.expression(a, 'emoji:7');
  display.select(2); display.complete(a);
  assert.equal(display.snapshot().characterId, 2);
  assert.equal(display.snapshot().slotId, 'normal');
  assert.equal(display.characterSnapshot(1).slotId, 'emoji:7');
  display.complete(display.begin(1, 'b'));
  assert.equal(display.characterSnapshot(1).slotId, 'emoji:7');
  display.complete(display.begin(1, 'c'));
  assert.equal(display.characterSnapshot(1).slotId, 'normal');
  const stale = display.begin(1, 'stale'), fresh = display.begin(1, 'fresh');
  display.expression(fresh, 'emoji:8'); display.expression(stale, 'emoji:9'); display.complete(stale);
  assert.equal(display.characterSnapshot(1).slotId, 'emoji:8');
  assert.equal(display.characterSnapshot(2).slotId, 'normal');
});


test('history exposes real ordered speech message IDs and keeps raw text intact', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE raw_messages(id INTEGER PRIMARY KEY, conversation_id TEXT, role TEXT, content TEXT, created_at TEXT);
      CREATE TABLE messages(id INTEGER PRIMARY KEY, conversation_id TEXT, raw_id INTEGER, images TEXT, seq INTEGER, role TEXT, content TEXT);
      CREATE TABLE emoji_categories(emoji_key TEXT);
      INSERT INTO emoji_categories VALUES ('开心');
      INSERT INTO raw_messages VALUES (1,'char_1','assistant','（挥手）你好。再见。[开心]','now'),(2,'char_1','user','你好','now');
      INSERT INTO messages VALUES (101,'char_1',1,NULL,1,'assistant','你好。'),(100,'char_1',1,NULL,2,'assistant','再见。[开心]'),
        (102,'char_1',1,NULL,3,'assistant','[开心]'),(103,'char_2',1,NULL,0,'assistant','private'),(104,'char_1',2,NULL,0,'user','你好');`);
    const result = readDialogueTranscript(db, 1);
    assert.equal(result.messages[0].content, '（挥手）你好。再见。');
    assert.deepEqual(result.messages[0].speech_segments, [{id:101,content:'你好。'},{id:100,content:'再见。'}]);
    assert.deepEqual(result.messages[1].speech_segments, []);
    assert.deepEqual(readDialogueTranscript(db, 1, { after:2, refreshIds:'1' }).refreshed[0].speech_segments, result.messages[0].speech_segments);
  } finally { db.close(); }
});
