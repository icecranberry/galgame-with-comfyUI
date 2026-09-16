import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { selectMemorySourceRows } from './memoryExtractor.js';
import { buildChatLogLines, buildChatLogBlock } from './chatLogPrompt.js';
import { stripBracePromptBlocks } from '../utils/groupImagePrompt.js';

function createRawDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE raw_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME
    )
  `);
  const insert = db.prepare(`
    INSERT INTO raw_messages (conversation_id, role, content) VALUES (?, ?, ?)
  `);
  for (let i = 1; i <= 6; i++) {
    insert.run('group_1', i % 2 === 1 ? 'user' : 'assistant', `message-${i}`);
  }
  insert.run('group_2', 'user', 'other-group');
  return db;
}

test('selects only raw messages after the uploaded boundary through the completed reply', () => {
  const db = createRawDb();
  try {
    const rows = selectMemorySourceRows(db, 'group_1', { afterRawId: 2, throughRawId: 5 });
    assert.deepEqual(rows.map(row => row.id), [3, 4, 5]);
  } finally {
    db.close();
  }
});

test('does not include messages from another conversation', () => {
  const db = createRawDb();
  try {
    const rows = selectMemorySourceRows(db, 'group_1', { afterRawId: 0, throughRawId: 99 });
    assert.deepEqual(rows.map(row => row.content), [
      'message-1', 'message-2', 'message-3', 'message-4', 'message-5', 'message-6',
    ]);
  } finally {
    db.close();
  }
});

test('strips brace-wrapped image prompts from the uploaded transcript', () => {
  const messages = [
    { role: 'user', content: '今天天气不错' },
    { role: 'assistant', content: '嗯！\n{"prompt":"1girl, sunset, standing on the beach"}' },
    { role: 'assistant', content: '好啊 {a girl holding an umbrella, rain, city street}' },
    { role: 'assistant', content: '{girl sitting by the window}' },
  ];
  assert.equal(buildChatLogLines(messages, { userName: '小明', characterName: '小夏' }), [
    '[小明] 今天天气不错',
    '[小夏] 嗯！',
    '[小夏] 好啊',
  ].join('\n'));
});

test('drops messages that are nothing but an image prompt', () => {
  const messages = [
    { role: 'user', content: '发张自拍看看' },
    { role: 'assistant', content: '{selfie, morning light, bedroom}' },
    { role: 'user', content: '好看' },
  ];
  assert.equal(
    buildChatLogLines(messages, { userName: 'user', characterName: '小夏' }),
    '[user] 发张自拍看看\n[user] 好看',
  );
});

test('drops group rows whose speech was nothing but an image prompt', () => {
  const messages = [
    { role: 'assistant', content: '[小夏]: 你看这个\n[小夏]: {selfie, bedroom}' },
    { role: 'assistant', content: '[小夏]: {a cat on the sofa}' },
  ];
  assert.equal(
    buildChatLogLines(messages, { userName: '小明', characterName: '群聊记录' }),
    '[群聊记录] [小夏]: 你看这个',
  );
});

test('stripBracePromptBlocks removes legacy curly-quote JSON but keeps the same line speech', () => {
  assert.equal(
    stripBracePromptBlocks('晚上好 {“prompt”: "1girl, night, stars"} 今天有点累'),
    '晚上好 今天有点累',
  );
  assert.equal(stripBracePromptBlocks('没有花括号的普通发言'), '没有花括号的普通发言');
  assert.equal(stripBracePromptBlocks('{a,b}\n{a,b}'), '');
});
