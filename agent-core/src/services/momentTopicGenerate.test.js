import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { config } = await import('../config.js');
config.dbPath = ':memory:';
config.llm.freeEgg = false;
config.llm.apiKey = 'test-only';
config.llm.baseURL = 'http://127.0.0.1:9';
config.features.town = false;
config.features.serializeBackgroundLLM = false;
const { resetClient } = await import('../llm/llm-client.js');
resetClient();
const { getDb, closeDb } = await import('../db/index.js');
const { default: router, generateMomentPost } = await import('../routes/moments.js');
const { invalidateAllCache } = await import('./scheduleManager.js');
afterEach(() => { invalidateAllCache(); closeDb(); });

function seedCharacter() {
  const db = getDb();
  return Number(db.prepare("INSERT INTO characters (name, display_name, base_prompt) VALUES ('test', '测试角色', '喜欢散步')").run().lastInsertRowid);
}

function generate(body) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, payload }); },
    };
    router.handle({ method: 'POST', url: '/generate', body }, res, err => err ? reject(err) : resolve(null));
  });
}

test('指定话题：参数错误或条目已删除时拒绝发送，不创建帖子或改变调度', async () => {
  const characterId = seedCharacter();
  const db = getDb();
  db.prepare("UPDATE characters SET next_moment_at = '2030-01-01 00:00:00' WHERE id = ?").run(characterId);
  const deletedId = Number(db.prepare("INSERT INTO moment_topics (name, source, is_active) VALUES ('已删除测试话题', 'custom', 0)").run().lastInsertRowid);
  for (const id of [0, -1, 1.5, '', '1', {}, []]) {
    assert.equal((await generate({ character_id: characterId, topic_id: id })).status, 400);
  }
  for (const id of [deletedId, 999999]) {
    assert.equal((await generate({ character_id: characterId, topic_id: id })).status, 404);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM moment_posts').get().n, 0);
  assert.equal(db.prepare('SELECT next_moment_at FROM characters WHERE id = ?').get(characterId).next_moment_at, '2030-01-01 00:00:00');
});

test('指定话题：未勾选、同名不同来源和空描述均按所选 id 进入生成提示词', async t => {
  const characterId = seedCharacter();
  const db = getDb();
  db.prepare("INSERT INTO moment_topics (name, desc, source) VALUES ('同名测试', '不应选到的系统描述', 'default')").run();
  const topicId = Number(db.prepare("INSERT INTO moment_topics (name, desc, source, checked) VALUES ('同名测试', '指定的雨后花园', 'custom', 0)").run().lastInsertRowid);
  const emptyId = Number(db.prepare("INSERT INTO moment_topics (name, desc, source) VALUES ('仅名称话题', '', 'custom')").run().lastInsertRowid);
  const requests = [];
  // 在真正的 LLM 边界截获请求后终止，不调用网络、生图或发布真实内容。
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async params => {
    requests.push(params);
    throw Object.assign(new Error('TEST_PROMPT_CAPTURED'), { status: 400 });
  });
  t.mock.method(Math, 'random', () => 0.5);
  for (const [id, name, desc] of [[topicId, '同名测试', '指定的雨后花园'], [emptyId, '仅名称话题', '仅名称话题']]) {
    const result = await generate({ character_id: characterId, topic_id: id });
    assert.equal(result.payload.error, 'TEST_PROMPT_CAPTURED');
    const { messages } = requests.at(-1);
    const selected = messages.find(m => m.content.startsWith('【用户指定的朋友圈话题】'));
    assert.equal(selected.role, 'system');
    assert.ok(selected.content.includes(`名称：${name}\n描述：${desc}`));
    assert.equal(messages.at(-1).role, 'user');
    assert.match(messages.at(-1).content, /围绕用户指定话题/);
    assert.ok(!messages.at(-1).content.includes('【此刻正在做】'));
    assert.ok(!JSON.stringify(messages).includes('不应选到的系统描述'));
    const post = db.prepare('SELECT style, status FROM moment_posts ORDER BY id DESC LIMIT 1').get();
    assert.deepEqual(post, { style: name, status: 'failed' });
  }
  assert.equal(requests.length, 2);
  // 不同指定话题保持前面的任务和人格层稳定，话题只出现在变量尾层。
  assert.deepEqual(requests[0].messages.slice(0, 3), requests[1].messages.slice(0, 3));
});

test('随机梦境：单图与多图请求均强化梦内画面，普通朋友圈不注入梦境规则', async t => {
  const characterId = seedCharacter();
  const requests = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async params => {
    requests.push(params);
    throw Object.assign(new Error('TEST_PROMPT_CAPTURED'), { status: 400 });
  });
  let rolls = [];
  t.mock.method(Math, 'random', () => rolls.length ? rolls.shift() : 0.5);

  for (const imageCount of [1, 2, 3]) {
    // 模式抽签、特殊模式抽签、配图张数；后续随机不影响所选分支。
    rolls = [0.01, 0, [0, 0.5, 0.8, 0.99][imageCount]];
    const result = await generate({ character_id: characterId });
    assert.equal(result.payload.error, 'TEST_PROMPT_CAPTURED');
    const { messages } = requests.at(-1);
    const task = messages.find(m => m.content.startsWith('你正在发朋友圈。')).content;
    assert.match(task, /每个 imagePrompt 都必须以 "A surreal dreamscape scene:" 开头/);
    assert.match(task, /至少两处相互关联的非现实变化/);
    assert.match(task, /ethereal soft lighting/);
    assert.match(task, /Environment reference 只约束醒着时的叙述/);
    assert.match(task, /未采纳梦境时完全忽略本条/);
    assert.match(task, /日程为主时，仅在梦境动因自然契合日程时采用/);
    assert.match(task, /动因为主时可以直接分享梦境/);
    const example = JSON.parse(task.split('输出格式（严格 JSON）：\n')[1].split('\n')[0]);
    assert.match(example.text, /80-400字/);
    assert.equal(Object.keys(example).length, imageCount + 1);
    for (const [field, value] of Object.entries(example)) {
      if (field === 'text') continue;
      assert.match(value, /A surreal dreamscape scene:/);
      assert.match(value, /若未采纳，正常描绘当前日程/);
    }
    assert.equal(messages.filter(m => m.role === 'user').length, 1);
    assert.equal(messages.at(-1).role, 'user');
  }

  rolls = [0.5];
  assert.equal((await generate({ character_id: characterId })).payload.error, 'TEST_PROMPT_CAPTURED');
  const ordinary = requests.at(-1).messages.map(m => m.content).join('\n');
  assert.doesNotMatch(ordinary, /A surreal dreamscape scene|梦境配图（仅在采纳/);
});

test('random topic source and focus determine schedule detail in the actual LLM request', async t => {
  const characterId = seedCharacter();
  const db = getDb();
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
  db.prepare('UPDATE moment_topics SET is_active = 0').run();
  const insertTopic = db.prepare('INSERT INTO moment_topics (name, desc, source, is_active) VALUES (?, ?, ?, 0)');
  // 同名话题仍按 source 区分，不能靠名称或描述猜来源。
  const customId = Number(insertTopic.run('同名来源测试', '发现新手机壳', 'custom').lastInsertRowid);
  const systemId = Number(insertTopic.run('同名来源测试', '发现新手机壳', 'default').lastInsertRowid);
  const { createLorebookRepository } = await import('../db/lorebookRepository.js');
  const worldId = db.prepare('SELECT id FROM world_settings WHERE is_active = 1').get().id;
  createLorebookRepository(db).save(worldId, {
    document: { entries: {
      0: { uid: 0, constant: true, position: 0, content: 'FOCUS_STABLE_RULE' },
      1: { uid: 1, constant: false, key: ['独有日程细节'], position: 0, content: 'DETAIL_ONLY_LORE' },
    } },
    settings: { positionPolicy: 'cache', contextTokens: 32768, budgetPercent: 100, budgetCap: 0 },
  });
  const requests = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async params => {
    requests.push(params);
    throw Object.assign(new Error('TEST_PROMPT_CAPTURED'), { status: 400 });
  });
  let rolls = [];
  t.mock.method(Math, 'random', () => rolls.length ? rolls.shift() : 0.5);
  const activity = { location: '裁缝店', activity: '整理量尺', description: '独有日程细节：用户帮忙熨平布料' };
  for (const [id, coin, focus] of [[customId, 0, 'motive'], [systemId, 0.49, 'schedule'], [systemId, 0.5, 'motive']]) {
    db.prepare('UPDATE moment_topics SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END').run(id);
    // 模式、话题、形态、张数，然后才是系统话题的主次硬币（自定义不消耗）。
    rolls = [0.5, 0, 0.5, 0.5, coin];
    await assert.rejects(generateMomentPost(character, { backfill: true, activity }), /TEST_PROMPT_CAPTURED/);
    const messages = requests.at(-1).messages;
    const user = messages.at(-1).content;
    assert.match(user, /【此刻正在做】.*裁缝店整理量尺/);
    assert.match(user, /【本次发朋友圈动因】发现新手机壳/);
    assert.match(user, focus === 'schedule' ? /【本次内容主次】日程为主/ : /【本次内容主次】动因为主/);
    const all = messages.map(m => m.content).join('\n');
    if (focus === 'schedule') {
      assert.match(user, /独有日程细节/);
      assert.match(user, /DETAIL_ONLY_LORE/);
      assert.ok(messages.some(m => m.content.startsWith('**【此刻与你同在的人：')));
    } else {
      assert.doesNotMatch(all, /独有日程细节|熨平布料/);
      assert.doesNotMatch(all, /DETAIL_ONLY_LORE/);
      assert.ok(!messages.some(m => m.content.startsWith('**【此刻与你同在的人：')));
    }
    const task = messages.find(m => m.content.startsWith('你正在发朋友圈。')).content;
    assert.ok(task.indexOf('FOCUS_STABLE_RULE') >= 0);
    assert.ok(task.indexOf('FOCUS_STABLE_RULE') < task.indexOf('输出格式（严格 JSON）：'));
    const example = JSON.parse(task.split('输出格式（严格 JSON）：\n')[1].split('\n')[0]);
    assert.match(example.text, /字数范围：\d+-\d+字/);
    assert.equal(messages.filter(m => m.role === 'user').length, 1);
  }
  const prefixes = requests.map(r => r.messages.find(m => m.content.startsWith('你正在发朋友圈。')).content.split('输出格式（严格 JSON）：')[0]);
  assert.ok(prefixes.every(prefix => prefix === prefixes[0]), 'source/focus must not enter the static prefix');
});
