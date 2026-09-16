import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  CURATION_MAX_ACTIONS,
  buildMemoryCurationPrompt,
  parseMemoryActions,
  planCurationRecovery,
  selectMemorySourceRows,
} from './memoryExtractor.js';
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

// 输出被 max_tokens 砍断时输出的是半截 JSON（Unterminated string），json 模式补发修不好，
// 只能让模型少写几条重发；只有纯格式问题才值得补发 json 模式。
test('被截断走精简重发，格式问题才走 json 模式', () => {
  assert.equal(planCurationRecovery({ finishReason: 'length' }), 'compact');
  assert.equal(planCurationRecovery({ finishReason: 'length', parseFailed: true }), 'compact');
  assert.equal(planCurationRecovery({ finishReason: 'stop', parseFailed: true }), 'json');
  assert.equal(planCurationRecovery({ finishReason: 'stop' }), null);
  assert.equal(planCurationRecovery(), null);
});

test('prompt 里声明的条数上限与解析时的截断一致', () => {
  assert.match(buildMemoryCurationPrompt({ transcript: '[小明] 你好' }), new RegExp(`最多输出 ${CURATION_MAX_ACTIONS} 条`));
  assert.match(buildMemoryCurationPrompt({ transcript: '[小明] 你好', compact: true }), /被截断：这次最多输出 4 条/);
  // 不落库的 maibot 路径输出预算只有 1800，条数上限更小
  assert.match(buildMemoryCurationPrompt({ transcript: '[小明] 你好', v3: false, maxActions: 5 }), /最多输出 5 条/);
});

test('parseMemoryActions 解析并截断到上限', () => {
  const raw = JSON.stringify({
    memoryActions: Array.from({ length: 15 }, (_, index) => ({ action: 'create', memory: { judgment: `j${index}` } })),
  });
  assert.equal(parseMemoryActions(raw).length, CURATION_MAX_ACTIONS);
  assert.equal(parseMemoryActions('```json\n{"memoryActions":[]}\n```').length, 0);
  // 被 max_tokens 砍断的真实形状：JSON 停在某个字符串中间
  assert.throws(() => parseMemoryActions('{"memoryActions":[{"action":"create","memory":{"judgment":"被砍断的半句'), /Unterminated string/);
});
