import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const gen = await import('../src/services/town/townNpcEventGenerator.js');
const { addClient, removeClient } = await import('../src/services/unifiedStreamBus.js');

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
  await assert.rejects(gen.generateTownNpcEvent(npc, { manual: true, llm: fakeLlm({}), image: noImage }),
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

test('ambient events anchor on two townsfolk and let the player step in at branch 1', async t => {
  const db = getDb();
  t.after(() => closeDb());
  const npc = fakeNpc(db);
  db.prepare(`INSERT INTO town_npcs(map_id, display_name, persona, brief, appearance_desc, job)
    VALUES(1, '茶娘阿圆', '爱打听。', '茶摊主人', '圆脸、粗布裙', '茶摊主')`).run();
  const other = db.prepare(`SELECT * FROM town_npcs WHERE display_name = '茶娘阿圆'`).get();

  const seen = [];
  const recordingLlm = payload => ({ chatSync: async msgs => { seen.push(msgs); return JSON.stringify(payload); } });
  const llm = recordingLlm({ title: '茶摊挤爆了？！', description: '两位镇民围着茶摊忙个不停。',
    prompt: '两位镇民在茶摊', choiceA: '上前帮忙招呼', choiceB: '坐下看热闹' });

  const before = Date.now();
  const event = await gen.generateTownNpcEvent(npc, {
    customPrompt: '镇民小孙和茶娘阿圆在茶摊碰面，聊起了今天的稀罕事。',
    ambient: true,
    companionNpc: { name: other.display_name, appearance: other.appearance_desc, persona: other.persona },
    locationName: '茶摊', locationKey: 'tea', manual: true,
    worldId: 'w1', worldEpoch: 1, durationMin: 120,
    llm, image: noImage,
  });

  // 落库口径：town.ambient 类型 + 120 分钟限时
  assert.equal(event.event_type_key, 'town.ambient');
  const durationMs = new Date(event.expires_at + 'Z').getTime() - before;
  assert.ok(durationMs > 110 * 60_000 && durationMs <= 121 * 60_000, `expected ~120min, got ${durationMs}`);

  // 开场 prompt：两位镇民同框、玩家不出场，同伴资料注入
  const opening = seen.map(msgs => msgs.map(m => m.content).join('\n')).join('\n');
  assert.ok(opening.includes('茶娘阿圆'), 'companion name should be injected');
  assert.ok(opening.includes('不要描写玩家'), 'opening must keep the player out of the scene');
  assert.ok(opening.includes('注意到了这场面') || opening.includes('介入'), 'choices should be about the player stepping in');

  // 第一分支：提示玩家刚入场
  seen.length = 0;
  const branched = await gen.generateTownNpcNextBranch(npc, event, { choice: 'A', label: '上前帮忙招呼' },
    { llm: recordingLlm({ description: '玩家挤进茶摊搭了把手。', prompt: '三人同框', choiceA: '一起收拾摊子', choiceB: '先付茶钱' }), image: noImage });
  assert.equal(branched.current_branch, 1);
  const branchText = seen.map(msgs => msgs.map(m => m.content).join('\n')).join('\n');
  assert.ok(branchText.includes('玩家刚按选项介入'), 'first branch should bridge the player into the scene');
});

/**
 * 多地图拍板口径：NPC 奇遇「时间到了就到了」——玩家不在那张图（后台图）时到点直接用模板结题，
 * 不花模型钱写文学性结局。这里同时钉住两件事：这条路径**同步返回**（结构上不存在 await 模型的空间），
 * 以及归档与 SSE 结局广播照旧（奇遇不会因为没人看而卡在活跃表里）。
 */
test('后台图的镇民奇遇到点直接模板结题：归档 + 广播，且全程不 await 模型', async t => {
  const db = getDb();
  t.after(() => closeDb());

  const sent = [];
  const client = { write: chunk => { sent.push(String(chunk)); } };
  addClient(client);
  t.after(() => removeClient(client));

  const npc = fakeNpc(db);
  const event = await gen.generateTownNpcEvent(npc, {
    customPrompt: '起点是小镇的理发店。玩家和理发师小孙一起……', locationName: '理发店', manual: true,
    worldId: 'w1', worldEpoch: 3, locationKey: 'salon',
    llm: fakeLlm({ title: '这缸染膏冒泡了？！', description: '两人围着染膏缸手忙脚乱。', prompt: '场景图',
      choiceA: '一起抢救染膏', choiceB: '改约明天再做' }),
    image: noImage,
  });
  db.prepare('UPDATE town_npc_events SET engaged = 1 WHERE id = ?').run(event.id);
  const active = db.prepare('SELECT * FROM town_npc_events WHERE id = ?').get(event.id);

  const out = gen.expireTownNpcEvent(npc, active, 'completed');
  assert.equal(out instanceof Promise, false, '这条路径必须同步走完，不能 await 任何模型调用');
  assert.equal(out.outcome, 'completed');
  assert.equal(out.conclusion, '故事告一段落。理发师小孙和玩家从这次经历中各有收获。');
  assert.ok(out.summary.includes('这缸染膏冒泡了？！'), '摘要沿用事件本身，不额外请模型润色');

  // 归档口径与 LLM 收尾完全一致：活跃行删除、历史行保留原 id / 结局 / 互动标记
  assert.equal(db.prepare('SELECT count(*) n FROM town_npc_events').get().n, 0);
  const row = db.prepare('SELECT * FROM town_npc_event_history WHERE id = ?').get(event.id);
  assert.equal(row.outcome, 'completed');
  assert.equal(row.engaged, 1);
  assert.equal(row.conclusion, out.conclusion);
  assert.equal(row.summary, out.summary);

  // 没互动的际遇同样到点即结题（措辞换一版，仍然不是模型写的）
  const quietNpc = fakeNpc(db);
  const quiet = await gen.generateTownNpcEvent(quietNpc, {
    customPrompt: '起点是小镇的理发店。', locationName: '理发店', manual: true,
    worldId: 'w1', worldEpoch: 3, locationKey: 'salon',
    llm: fakeLlm({ title: '门口的信没署名', description: '一封信被塞在门缝里。', prompt: '场景图',
      choiceA: '追出去看看', choiceB: '先收进柜台' }),
    image: noImage,
  });
  const quietOut = gen.expireTownNpcEvent(quietNpc,
    db.prepare('SELECT * FROM town_npc_events WHERE id = ?').get(quiet.id), 'expired');
  assert.equal(quietOut.conclusion, '这个偶然的际遇悄然结束，没有留下太多痕迹。');
  assert.ok(quietOut.summary.includes('事件因时间流逝而自然结束。'));
  assert.equal(db.prepare('SELECT outcome FROM town_npc_event_history WHERE id = ?').get(quiet.id).outcome, 'expired');

  // 结局照旧推给前端（每归档一条推一条，后台图的奇遇也不会静默消失）；
  // 生成时那两条 new_event 不算在内
  const conclusions = sent.filter(chunk => chunk.startsWith('event: event_concluded\n'));
  assert.equal(conclusions.length, 2);
  const payload = JSON.parse(conclusions[0].slice(conclusions[0].indexOf('data: ') + 6));
  assert.equal(payload.npc_event, true);
  assert.equal(payload.npc_id, npc.id);
  assert.equal(payload.outcome, 'completed');
  assert.equal(payload.conclusion, out.conclusion);
  assert.equal(payload.character_id, null);
});

// ── M7 自动叙事接线（2026-10-01）：ambient 奇遇创建时补角色对白 ──
test('M7 自动叙事：ambient 奇遇开场补对白；契约不过/零模型不落 narrative，归档随行', async t => {
  const db = getDb();
  t.after(() => closeDb());

  // 隔离：同文件先前 ambient 用例已在叙事缓存留下同 id 的模板回退（缓存键只含来源事件与
  // 说话者 id，而每个用例的 :memory: 库自增 id 都从 1 起）——用占位行推高自增 id，
  // 保证本用例的 sourceEventId 不撞缓存、真走模型路径。
  for (const name of ['占位甲', '占位乙']) {
    db.prepare('INSERT INTO town_npcs(map_id, display_name) VALUES(1, ?)').run(name);
    db.prepare("INSERT INTO town_npc_events(npc_id, event_type_key, expires_at) VALUES((SELECT id FROM town_npcs WHERE display_name=?), 'town.custom', '2100-01-01T00:00:00')").run(name);
  }

  // 1) 模型输出过契约 → narrative_json 落库、DTO 透出对话行、归档随行
  const npc = fakeNpc(db);
  let calls = 0;
  const llmGood = { chatSync: async msgs => {
    calls += 1;
    if (calls === 1) {
      return JSON.stringify({ title: '面香飘满了街口。', description: '掌柜老周在灶前忙个不停，汤头的香气顺着街口飘出去。', prompt: '场景图', choiceA: '进店吃一碗', choiceB: '先去别处逛逛' });
    }
    const sourceEventId = String(msgs.at(-1).content).match(/【事件 ID】(\S+)/)?.[1];
    assert.ok(sourceEventId?.startsWith('town:'), '叙事提示词应带已落库事件的 ID');
    return JSON.stringify({
      sourceEventId,
      summary: '掌柜老周的面馆香气飘满街口，路过的人纷纷放慢了脚步。',
      lines: [{ speakerActorId: `npc:${npc.id}`, text: '今天的汤头熬得格外浓，可别错过了。' }],
      choices: [],
    });
  } };
  const event = await gen.generateTownNpcEvent(npc, {
    manual: true, ambient: true, companionNpc: { name: '爱走的阿快', appearance: '', persona: '' },
    worldId: 'narr-a',
    llm: llmGood, image: noImage,
  });
  assert.equal(calls, 2, 'ambient 奇遇应在事件生成后追加一次叙事调用');
  const stored = JSON.parse(event.narrative_json);
  assert.equal(stored.lines[0].speakerActorId, `npc:${npc.id}`);
  const dto = gen.townNpcEventDto(event);
  assert.equal(dto.narrative.lines[0].displayName, '理发师小孙');
  assert.equal(dto.narrative_json, undefined, '原始串不透出，前端只读解析后的 narrative');
  await gen.concludeTownNpcEvent(npc, event, 'completed',
    { llm: fakeLlm({ conclusion: '面馆的一天结束了。', summary: '香气散去，面馆打烊。' }), image: noImage });
  const hist = db.prepare('SELECT * FROM town_npc_event_history WHERE id=?').get(event.id);
  assert.equal(JSON.parse(hist.narrative_json).lines[0].text, '今天的汤头熬得格外浓，可别错过了。', '归档应携带叙事');
  assert.equal(gen.townNpcEventHistoryDto(hist).narrative.lines.length, 1);

  // 2) 自动 LLM 关闭 → 只有事件生成一次调用，不落 narrative（零模型卡片维持纯描述）
  const npc2 = fakeNpc(db);
  config.features.townAutoLLM = false;
  try {
    let calls2 = 0;
    const event2 = await gen.generateTownNpcEvent(npc2, {
      manual: true, ambient: true, companionNpc: { name: '阿快', appearance: '', persona: '' },
      worldId: 'narr-b',
      llm: { chatSync: async () => { calls2 += 1; return JSON.stringify({ title: '茶摊的水开了。', description: '描述描述描述描述描述描述描述描述描述描述。', prompt: '图', choiceA: 'A', choiceB: 'B' }); } },
      image: noImage,
    });
    assert.equal(calls2, 1, '零模型不发起叙事调用');
    assert.equal(event2.narrative_json ?? null, null);
  } finally {
    config.features.townAutoLLM = true;
  }

  // 3) 契约不过（未知说话人）→ 叙事重试 2 次后模板回退，不落 narrative（共 1+2 次调用）
  const npc3 = fakeNpc(db);
  let calls3 = 0;
  const llmBad = { chatSync: async msgs => {
    calls3 += 1;
    if (calls3 === 1) return JSON.stringify({ title: '巷口的棋局散了。', description: '描述描述描述描述描述描述描述描述描述描述。', prompt: '图', choiceA: 'A', choiceB: 'B' });
    const sourceEventId = String(msgs.at(-1).content).match(/【事件 ID】(\S+)/)?.[1];
    return JSON.stringify({ sourceEventId, summary: '这是一个足够长的摘要，超过二十个字的要求。是的。', lines: [{ speakerActorId: 'stranger', text: '这不是允许的说话人。' }], choices: [] });
  } };
  const event3 = await gen.generateTownNpcEvent(npc3, {
    manual: true, ambient: true, companionNpc: { name: '阿快', appearance: '', persona: '' },
    worldId: 'narr-c',
    llm: llmBad, image: noImage,
  });
  assert.equal(calls3, 3, '叙事最多重试 maxAttempts 次');
  assert.equal(event3.narrative_json ?? null, null, '模板回退不落 narrative_json');
});


test('NPC event creation rejects every non-manual entry before side effects', async t => {
  const db = getDb();
  t.after(() => closeDb());
  const npc = fakeNpc(db);
  let calls = 0;
  const unexpected = async () => { calls += 1; throw new Error('Unexpected generation'); };
  for (const manual of [undefined, false, null, 1, 'true']) {
    for (const ambient of [false, true]) {
      await assert.rejects(gen.generateTownNpcEvent(npc, {
        manual, ambient,
        llm: { chatSync: unexpected }, image: { generateImageRaw: unexpected },
        beforePersist: unexpected, afterPersist: unexpected,
      }), { message: 'NPC_EVENT_REQUIRES_PLAYER_ACTION' });
    }
  }
  assert.equal(calls, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM town_npc_events').get().n, 0);
});
