import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { selectMemorySourceRows } from './memoryExtractor.js';

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
