import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { buildRecentGroupLogBlock } from '../src/services/groupChatEngine.js';
import { buildChatContext } from '../src/services/contextAssembler.js';

// ── 测试库：私聊群聊实况注入涉及的最小表集合 ──

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE group_chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      last_message_at DATETIME
    );
    CREATE TABLE group_members (
      group_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL
    );
    CREATE TABLE raw_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL
    );
    CREATE TABLE rolling_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      end_msg_id INTEGER NOT NULL DEFAULT 0,
      summary TEXT,
      checkpoint_version INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

function minutesAgo(min) {
  return new Date(Date.now() - min * 60000).toISOString().slice(0, 19).replace('T', ' ');
}

function addGroup(db, { name, lastMessageAtMinAgo, memberIds }) {
  const r = db.prepare('INSERT INTO group_chats (name, last_message_at) VALUES (?, ?)')
    .run(name, minutesAgo(lastMessageAtMinAgo));
  for (const cid of memberIds) {
    db.prepare('INSERT INTO group_members (group_id, character_id) VALUES (?, ?)').run(r.lastInsertRowid, cid);
  }
  return r.lastInsertRowid;
}

function addRaw(db, conversationId, role, content) {
  return db.prepare('INSERT INTO raw_messages (conversation_id, role, content) VALUES (?, ?, ?)')
    .run(conversationId, role, content).lastInsertRowid;
}

function addSummary(db, conversationId, summary, endMsgId = 10) {
  return db.prepare(`
    INSERT INTO rolling_summaries (conversation_id, end_msg_id, summary, checkpoint_version)
    VALUES (?, ?, ?, 1)
  `).run(conversationId, endMsgId, summary).lastInsertRowid;
}

test('5 分钟内活跃的群：注明群名，带群聊摘要 + 最近两轮记录，生图行与内联 prompt 全部剥掉', () => {
  const db = createDb();
  const groupId = addGroup(db, { name: '摸鱼群', lastMessageAtMinAgo: 1, memberIds: [7] });
  const conv = `group_${groupId}`;
  // 群摘要两份，取 end_msg_id 更大的那份；旧版本（checkpoint_version=0）不取
  addSummary(db, conv, '过期的群聊摘要', 5);
  db.prepare(`
    INSERT INTO rolling_summaries (conversation_id, end_msg_id, summary, checkpoint_version)
    VALUES (?, ?, ?, 0)
  `).run(conv, 6, '未定稿的群聊摘要');
  addSummary(db, conv, '大家下午在聊周末去哪玩', 8);
  // 第一轮：用户消息 + assistant 剧本（发图行落库时与台词拆成两行，这里同构）
  addRaw(db, conv, 'user', '<user_message read_only="true">\n大家下午好呀\n</user_message>');
  addRaw(db, conv, 'assistant', [
    '[宵宫]: 下午好！',
    '[宵宫]: {"prompt":"a girl waving hello, sunset"}',
    '[爱莉希雅]: 来啦来喵 喵~',
  ].join('\n'));
  // 第二轮：assistant 主动发起 + 剧本
  addRaw(db, conv, 'assistant', '[宵宫]: 有人要一起玩游戏吗\n[爱莉希雅]: 算我一个！');

  const block = buildRecentGroupLogBlock(db, 7, '小明');
  assert.match(block, /^<group_chat_log>\n你所在的群聊「摸鱼群」的近况：\n/);
  assert.match(block, /\[群聊摘要\]\n大家下午在聊周末去哪玩/);
  assert.doesNotMatch(block, /过期的群聊摘要/);
  assert.doesNotMatch(block, /未定稿的群聊摘要/);
  assert.match(block, /\[最近的聊天记录\]\n\[小明\]: 大家下午好呀/);
  assert.match(block, /\[宵宫\]: 下午好！/);
  assert.match(block, /\[爱莉希雅\]: 来啦来喵 喵~/);
  assert.match(block, /\[宵宫\]: 有人要一起玩游戏吗/);
  assert.match(block, /\[爱莉希雅\]: 算我一个！/);
  assert.doesNotMatch(block, /\{"prompt"/);
  assert.doesNotMatch(block, /a girl waving hello/);
  // 收尾防呆语：群聊内容不等于私聊消息
  assert.match(block, /不是小明发给你的私聊消息/);
});

test('只取最近两轮：更早的轮次不进注入块', () => {
  const db = createDb();
  const groupId = addGroup(db, { name: '闲聊群', lastMessageAtMinAgo: 2, memberIds: [7] });
  const conv = `group_${groupId}`;
  addRaw(db, conv, 'user', '<user_message read_only="true">\n最早的发言\n</user_message>');
  addRaw(db, conv, 'assistant', '[宵宫]: 最早一轮的回复');
  addRaw(db, conv, 'assistant', '[宵宫]: 倒数第二轮');
  addRaw(db, conv, 'assistant', '[宵宫]: 最新一轮');

  const block = buildRecentGroupLogBlock(db, 7, '小明');
  assert.match(block, /\[宵宫\]: 倒数第二轮/);
  assert.match(block, /\[宵宫\]: 最新一轮/);
  assert.doesNotMatch(block, /最早的发言/);
  assert.doesNotMatch(block, /最早一轮的回复/);
});

test('超过 5 分钟未活跃的群不注入', () => {
  const db = createDb();
  const groupId = addGroup(db, { name: '沉寂群', lastMessageAtMinAgo: 6, memberIds: [7] });
  addRaw(db, `group_${groupId}`, 'assistant', '[宵宫]: 有人吗');

  assert.equal(buildRecentGroupLogBlock(db, 7, '小明'), '');
});

test('没加入任何群的角色不注入', () => {
  const db = createDb();
  assert.equal(buildRecentGroupLogBlock(db, 7, '小明'), '');
});

test('剥完没有任何真实发言的群跳过，其余活跃群照常注入', () => {
  const db = createDb();
  const quietId = addGroup(db, { name: '图群', lastMessageAtMinAgo: 1, memberIds: [7] });
  addRaw(db, `group_${quietId}`, 'assistant', '[宵宫]: {"prompt":"only an image, no dialogue"}');
  const talkId = addGroup(db, { name: '话群', lastMessageAtMinAgo: 1, memberIds: [7] });
  addRaw(db, `group_${talkId}`, 'assistant', '[宵宫]: 聊聊天');

  const block = buildRecentGroupLogBlock(db, 7, '小明');
  assert.match(block, /「话群」/);
  assert.doesNotMatch(block, /「图群」/);
});

test('用户消息里内嵌的旧版 {"prompt":"..."} JSON 剥掉，正文保留', () => {
  const db = createDb();
  const groupId = addGroup(db, { name: '旧格式群', lastMessageAtMinAgo: 1, memberIds: [7] });
  addRaw(db, `group_${groupId}`, 'user', '<user_message read_only="true">\n看这张 {"prompt":"a cute cat"} 好可爱\n</user_message>');
  addRaw(db, `group_${groupId}`, 'assistant', '[宵宫]: 确实！');

  const block = buildRecentGroupLogBlock(db, 7, '小明');
  assert.match(block, /\[小明\]: 看这张 好可爱/);
  assert.doesNotMatch(block, /a cute cat/);
});

test('多个群同时活跃：各自独立成节，摘要与记录按群隔离、互不串扰', () => {
  const db = createDb();
  // 群 A：有摘要 + 两轮记录；群 B：无摘要 + 一轮记录；两群都活跃
  const groupA = addGroup(db, { name: '群A', lastMessageAtMinAgo: 1, memberIds: [7] });
  const convA = `group_${groupA}`;
  addSummary(db, convA, '群A在聊做饭', 8);
  addRaw(db, convA, 'user', '<user_message read_only="true">\n群A用户发言\n</user_message>');
  addRaw(db, convA, 'assistant', '[宵宫]: 群A回复一\n[爱莉希雅]: 群A回复二');
  addRaw(db, convA, 'assistant', '[宵宫]: 群A回复三');

  const groupB = addGroup(db, { name: '群B', lastMessageAtMinAgo: 3, memberIds: [7] });
  const convB = `group_${groupB}`;
  addSummary(db, convB, '群B在聊钓鱼', 8);
  addRaw(db, convB, 'assistant', '[宵宫]: 群B回复一\n[爱莉希雅]: 群B回复二');

  const block = buildRecentGroupLogBlock(db, 7, '小明');

  // 两个群都注入，按 last_message_at 新→旧排序（群A在前）
  const idxA = block.indexOf('「群A」');
  const idxB = block.indexOf('「群B」');
  assert.ok(idxA >= 0 && idxB >= 0, '两个群的节都存在');
  assert.ok(idxA < idxB, '群A（更新）排在群B之前');

  // 各节内容完整且按群隔离
  const sectionA = block.slice(idxA, idxB);
  const sectionB = block.slice(idxB);
  assert.match(sectionA, /\[群聊摘要\]\n群A在聊做饭/);
  assert.match(sectionA, /\[小明\]: 群A用户发言/);
  assert.match(sectionA, /\[宵宫\]: 群A回复三/);
  assert.doesNotMatch(sectionA, /群B/);
  assert.match(sectionB, /\[群聊摘要\]\n群B在聊钓鱼/);
  assert.match(sectionB, /\[宵宫\]: 群B回复一/);
  assert.doesNotMatch(sectionB, /群A/);
});

test('多个群中只有部分活跃：只有活跃的群注入，沉寂群不出现', () => {
  const db = createDb();
  const activeId = addGroup(db, { name: '活跃群', lastMessageAtMinAgo: 1, memberIds: [7] });
  addRaw(db, `group_${activeId}`, 'assistant', '[宵宫]: 群里正在聊');
  const quietId = addGroup(db, { name: '沉寂群', lastMessageAtMinAgo: 30, memberIds: [7] });
  addSummary(db, `group_${quietId}`, '沉寂群的旧摘要', 8);
  addRaw(db, `group_${quietId}`, 'assistant', '[宵宫]: 很久之前的发言');
  // 未加入但存在的第三个群也不应出现
  const otherId = addGroup(db, { name: '别人的群', lastMessageAtMinAgo: 1, memberIds: [8] });
  addRaw(db, `group_${otherId}`, 'assistant', '[宵宫]: 与角色7无关');

  const block = buildRecentGroupLogBlock(db, 7, '小明');
  assert.match(block, /「活跃群」/);
  assert.match(block, /\[宵宫\]: 群里正在聊/);
  assert.doesNotMatch(block, /沉寂群/);
  assert.doesNotMatch(block, /很久之前的发言/);
  assert.doesNotMatch(block, /别人的群/);
  assert.doesNotMatch(block, /与角色7无关/);
});

test('buildChatContext：preHistoryMessages 插在摘要之后、私聊历史之前，动态块仍附在私聊历史末条上', () => {  const groupLog = '<group_chat_log>\n「摸鱼群」的近况\n</group_chat_log>';
  const { messages } = buildChatContext({
    stableBlocks: ['稳定块'],
    preSummarySystem: ['节奏规则'],
    summaryBlock: '[对话历史摘要]',
    preHistoryMessages: [{ role: 'user', content: groupLog }],
    history: [{ role: 'user', content: '最新一条私聊消息' }],
    dynamicBlocks: ['<time_context>时间</time_context>'],
  });
  const contents = messages.map(m => m.content);
  const groupIdx = contents.findIndex(c => c.includes('<group_chat_log>'));
  const summaryIdx = contents.findIndex(c => c.includes('[对话历史摘要]'));
  const histIdx = contents.findIndex(c => c.includes('最新一条私聊消息'));
  assert.ok(groupIdx > summaryIdx, '群聊块在摘要之后');
  assert.ok(groupIdx < histIdx, '群聊块在私聊历史之前');
  // 群聊块是独立 user 消息，<dynamic_context> 只附加在最后一条 user 消息（私聊历史）上
  assert.ok(!messages[groupIdx].content.includes('<dynamic_context>'));
  assert.ok(messages.at(-1).content.includes('<dynamic_context>'));
});
