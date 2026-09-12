import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const gen = await import('../src/services/town/townNpcEventGenerator.js');

config.dbPath = ':memory:';

const fakeNpc = db => {
  db.prepare(`INSERT INTO town_npcs(map_id, display_name, persona, brief, appearance_desc, job) VALUES(1, '理发师小孙', '性格温和、爱唠家常。', '镇上的理发师', '圆脸、蓝围裙', '理发师')`).run();
  return db.prepare('SELECT * FROM town_npcs ORDER BY id DESC LIMIT 1').get();
};

const fakeLlm = payload => ({ chatSync: async () => JSON.stringify(payload) });
const noImage = { generateImageRaw: async () => ({ success: false, images: [] }) };

test('town npc events mirror the character event lifecycle without a character card', async t => {
  const db = getDb();
  t.after(() => closeDb());
  const npc = fakeNpc(db);

  // 1. 开场：LLM 输出落库，id 加 town: 前缀，初始场景进 choice_history[0]
  const event = await gen.generateTownNpcEvent(npc, {
    customPrompt: '起点是小镇的理发店。玩家和理发师小孙一起……', locationName: '理发店',
    manual: true, worldId: 'w1', worldEpoch: 3, locationKey: 'salon',
    llm: fakeLlm({ title: '这缸染膏冒泡了？！', description: '两人围着染膏缸手忙脚乱。', prompt: '场景图',
      choiceA: '一起抢救染膏', choiceB: '改约明天再做' }),
    image: noImage,
  });
  assert.ok(Number.isInteger(event.id));
  assert.equal(event.title, '这缸染膏冒泡了？！');
  assert.equal(event.npc_id, npc.id);
  assert.equal(event.world_id, 'w1'); assert.equal(event.world_epoch, 3); assert.equal(event.location_key, 'salon');
  const dto = gen.townNpcEventDto(event);
  assert.equal(dto.id, `town:${event.id}`);
  assert.equal(dto.npc_event, true);
  assert.equal(dto.display_name, '理发师小孙');
  assert.equal(JSON.parse(event.choice_history).length, 1);

  // 2. 唯一活跃约束：同一镇民不允许第二条活跃奇遇
  await assert.rejects(gen.generateTownNpcEvent(npc, { llm: fakeLlm({}), image: noImage }),
    { message: 'ALREADY_ACTIVE_EVENT' });

  // 3. processing CAS：防并发重复推进（已有请求在处理中时拒绝新的选择）
  db.prepare('UPDATE town_npc_events SET processing=1 WHERE id=?').run(event.id);
  await assert.rejects(gen.generateTownNpcNextBranch(npc, event, { choice: 'A', label: '一起抢救染膏' },
    { llm: fakeLlm({}), image: noImage }), { message: 'EVENT_ALREADY_PROCESSING' });
  db.prepare('UPDATE town_npc_events SET processing=0 WHERE id=?').run(event.id);

  // 4. 分支推进：choice_history 增长、engaged 置位、选项刷新
  const branched = await gen.generateTownNpcNextBranch(npc, event, { choice: 'A', label: '一起抢救染膏' },
    { llm: fakeLlm({ description: '染膏抢救成功，两人相视大笑。', prompt: '场景图2', choiceA: '干脆做个新发型', choiceB: '先打扫再说' }), image: noImage });
  assert.equal(branched.engaged, 1);
  assert.equal(branched.processing, 0);
  assert.equal(branched.current_branch, 1);
  const history = JSON.parse(branched.choice_history);
  assert.equal(history.length, 2);
  assert.equal(history[1].choice_label, '一起抢救染膏');
  assert.ok(history[1].prev_choice_a, 'undo payload is stored');

  // 5. 撤回口径所需的字段由路由消费（prev_*），这里只验证生成侧不丢
  assert.equal(JSON.parse(branched.choice_history)[1].summary, '染膏抢救成功，两人相视大笑。');

  // 6. 结局：移入历史表、删除活跃行、保留原始 ID
  await gen.concludeTownNpcEvent(npc, branched, 'completed',
    { llm: fakeLlm({ conclusion: '染膏缸旁的一天结束了。', summary: '玩家帮小孙抢救了染膏，两人约好下次做新发型。' }) });
  assert.equal(db.prepare('SELECT count(*) n FROM town_npc_events').get().n, 0);
  const row = db.prepare('SELECT * FROM town_npc_event_history WHERE id=?').get(event.id);
  assert.equal(row.outcome, 'completed');
  assert.equal(row.engaged, 1);
  assert.equal(row.conclusion, '染膏缸旁的一天结束了。');
  const historyDto = gen.townNpcEventHistoryDto(row);
  assert.equal(historyDto.id, `town:${event.id}`);
  assert.equal(historyDto.image, row.final_image);
  assert.ok(historyDto.expires_at, 'history rows reuse ended_at as expires_at');
});

test('town npc event id helpers only accept the town: prefix', () => {
  assert.equal(gen.parseTownNpcEventId('town:42'), 42);
  assert.equal(gen.parseTownNpcEventId('town:0'), null);
  assert.equal(gen.parseTownNpcEventId('town:abc'), null);
  assert.equal(gen.parseTownNpcEventId('42'), null);
  assert.equal(gen.parseTownNpcEventId(42), null);
  assert.equal(gen.townNpcEventRef(7), 'town:7');
});
