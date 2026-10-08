import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { config } = await import('../src/config.js');
config.dbPath = ':memory:';
config.llm.freeEgg = false;
config.llm.apiKey = undefined;
delete process.env.OPENAI_API_KEY;
const { getDb, closeDb } = await import('../src/db/index.js');
const { concludeEvent } = await import('../src/services/eventGenerator.js');
const { normalizeMemorySettings } = await import('../src/services/memory/memoryConfig.js');

test('旧配置或旧客户端不能重新开启未参与奇遇记忆', () => {
  assert.equal(normalizeMemorySettings().recordUnengagedEvents, false);
  assert.equal(normalizeMemorySettings({ recordUnengagedEvents: true }).recordUnengagedEvents, false);
  assert.equal(normalizeMemorySettings({}, { ...normalizeMemorySettings(), recordUnengagedEvents: true }).recordUnengagedEvents, false);
});

test('结算仅将参与过的奇遇写入 RAG，未参与奇遇仍正常归档', async t => {
  const db = getDb();
  t.after(() => closeDb());
  db.prepare(`INSERT INTO characters(name, display_name, base_prompt) VALUES('event-memory-test', '测试角色', '温和的旅人')`).run();
  const character = db.prepare(`SELECT * FROM characters WHERE name = 'event-memory-test'`).get();
  // 模拟遗留开启配置，确保写入入口本身也强制检查参与标记。
  db.prepare(`UPDATE system_settings SET setting_value = ? WHERE setting_key = 'memory_settings'`)
    .run(JSON.stringify({ recordUnengagedEvents: true }));

  for (const [engaged, outcome] of [[0, 'expired'], [0, 'completed'], [1, 'completed'], [1, 'expired']]) {
    const title = `奇遇-${engaged}-${outcome}`;
    const history = [{ branch: 0, choice_label: '开场', summary: '在路上偶遇' }];
    if (engaged) history.push({ branch: 1, choice_label: '一起探索', summary: '找到花园' });
    const result = db.prepare(`INSERT INTO character_events(character_id, event_type_key, title, description, engaged, choice_history, expires_at)
      VALUES(?, 'test', ?, '在路上偶遇', ?, ?, '2020-01-01 00:00:00')`)
      .run(character.id, title, engaged, JSON.stringify(history));
    const event = db.prepare('SELECT * FROM character_events WHERE id = ?').get(result.lastInsertRowid);
    await concludeEvent(character, event, outcome);
    const memories = db.prepare('SELECT * FROM memory_fragments WHERE conversation_id = ? AND judgment LIKE ?')
      .all(`char_${character.id}`, `%${title}%`);
    assert.equal(memories.length, engaged, title);
    if (engaged) assert.match(memories[0].reasoning, /一起探索/);
    assert.equal(db.prepare('SELECT engaged FROM event_history WHERE id = ?').get(event.id).engaged, engaged);
    assert.equal(db.prepare('SELECT id FROM character_events WHERE id = ?').get(event.id), undefined);
  }
});
