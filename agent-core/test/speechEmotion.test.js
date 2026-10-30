import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { contextSentence, speechEmotionContext, speechEmotionMessages, parseSpeechEmotion, inferSpeechEmotion } from '../src/services/speechEmotion.js';
import { speechCacheKey, speechParams } from '../src/services/speechText.js';

const emotional = { happy: 0.4, angry: 0, sad: 0, afraid: 0, disgusted: 0, melancholic: 0, surprised: 0.1, calm: 0 };
test('context uses only one neighboring sentence from the same conversation, skipping cards and images', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY, display_name TEXT, name TEXT);
      INSERT INTO characters VALUES(1,'邻舍','npc');
      CREATE TABLE messages(id INTEGER PRIMARY KEY,conversation_id TEXT,role TEXT,content TEXT,speaker_character_id INTEGER,event_id INTEGER,raw_id INTEGER);
      INSERT INTO messages VALUES
      (1,'char_1','user','第一句。等你好久了！',NULL,NULL,NULL),
      (2,'char_1','assistant','分享奇遇',1,4,NULL),
      (3,'other','assistant','其他会话的秘密',1,NULL,NULL),
      (4,'char_1','assistant','你终于来了。',1,NULL,NULL),
      (5,'char_1','assistant','![图片](test.png)',1,NULL,NULL),
      (6,'char_1','system','系统信息',NULL,NULL,NULL),
      (7,'char_1','assistant','我很担心你。你吃饭了吗？',1,NULL,NULL);`);
    const context = speechEmotionContext(db, 4);
    assert.deepEqual(context.previous, { role: 'user', speaker: 'user', text: '等你好久了！' });
    assert.deepEqual(context.next, { role: 'assistant', speaker: '邻舍', text: '我很担心你。' });
    assert.equal(speechEmotionContext(db, 1).previous, null);
    assert.equal(speechEmotionContext(db, 7).next, null);
    assert.deepEqual(speechEmotionContext(db, 999), { previous: null, next: null });
    assert.equal(contextSentence('（微笑）先坐。别急！', 'previous'), '别急！');
    assert.equal(contextSentence('A'.repeat(2000), 'next').length, 400);
  } finally { db.close(); }
});

test('emotion parsing enforces eight numeric dimensions and caps total intensity', () => {
  assert.deepEqual(parseSpeechEmotion(JSON.stringify(emotional)), [0.4, 0, 0, 0, 0, 0, 0.1, 0]);
  assert.deepEqual(parseSpeechEmotion('```json\n' + JSON.stringify(emotional) + '\n```'), [0.4, 0, 0, 0, 0, 0, 0.1, 0]);
  const capped = parseSpeechEmotion(JSON.stringify({ ...emotional, happy: 0.8, sad: 0.8 }));
  assert.ok(capped.reduce((a, b) => a + b) <= 0.8);
  for (const bad of [{}, [], null, { previous: emotional, current: emotional, next: emotional }, { ...emotional, happy: '0.4' }, { ...emotional, happy: -1 }, { ...emotional, happy: 1 }, { ...emotional, arbitrary: 1 }]) {
    assert.throws(() => parseSpeechEmotion(JSON.stringify(bad)));
  }
});

test('prompt preserves the shared stable prefix and sends data separately with exactly one final user', async () => {
  const context = { speaker: '邻舍', previous: { text: '等你好久了。' }, next: null };
  const first = speechEmotionMessages('你终于来了。', context);
  const other = speechEmotionMessages('另一句', { speaker: '另一个人', previous: null, next: { text: '下文' } });
  assert.equal(first[0].content, other[0].content);
  assert.deepEqual(first.map(m => m.role), ['system', 'user']);
  assert.match(first[0].content, /只输出 current 对应的一组参数/);
  assert.match(first[1].content, /previous 和 next 仅作参考。只输出 current 的八维情绪参数/);
  const material = JSON.parse(first[1].content.split('\n')[1]);
  assert.deepEqual(material, { previous: context.previous, current: { speaker: '邻舍', text: '你终于来了。' }, next: null });
  assert.doesNotMatch(first[0].content, /等你好久了|你终于来了/);
  assert.notEqual(first[1].content, other[1].content);
  let calls = 0;
  const vector = await inferSpeechEmotion('你终于来了。', context, { chat: async (messages, options) => {
    calls++;
    assert.deepEqual(messages, first);
    assert.equal(options.retries, 0); assert.equal(options.maxRetries, 0);
    assert.equal(options.freeEggFailover, false); assert.equal(options.signal.aborted, false);
    return JSON.stringify(emotional);
  } });
  assert.equal(calls, 1); assert.equal(vector[0], 0.4);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(inferSpeechEmotion('取消', context, { signal: controller.signal, chat: async (_, options) => { options.signal.throwIfAborted(); } }), { name: 'AbortError' });
});

test('enhanced, natural and changed-context speech have independent caches', () => {
  const params = speechParams();
  const enhanced = { ...params, emotion_analysis: { version: 'v1', previous: { text: '上文' }, next: null } };
  const naturalKey = speechCacheKey('你好', 'reference', params);
  const enhancedKey = speechCacheKey('你好', 'reference', enhanced);
  assert.notEqual(naturalKey, enhancedKey);
  assert.equal(enhancedKey, speechCacheKey('你好', 'reference', structuredClone(enhanced)));
  assert.notEqual(enhancedKey, speechCacheKey('你好', 'reference', { ...enhanced, emotion_analysis: { ...enhanced.emotion_analysis, next: { text: '新下文' } } }));
});
