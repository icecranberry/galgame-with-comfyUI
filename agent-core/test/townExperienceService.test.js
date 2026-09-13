import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const { createTownEventService } = await import('../src/services/town/townEventService.js');
const { createTownExperienceService, TOWN_EXPERIENCE_CONSUMER } = await import('../src/services/town/townExperienceService.js');
const { createTownActorRegistry } = await import('../src/services/town/townActorRegistry.js');

config.dbPath = ':memory:';

/** 与 townService.settleEncounterExperience 同构的事件追加（校验器保持一致）。 */
function makeEventService(db, registry) {
  return createTownEventService({
    db, clock: { now: () => Date.now() },
    getWorldEpoch: worldId => registry.getWorldEpoch(worldId),
    validators: {
      'town.encounter.happened': payload => !!payload && Number.isSafeInteger(payload.encounterId)
        && payload.encounterId > 0 && typeof payload.summary === 'string'
        && payload.summary.trim().length > 0 && payload.summary.length <= 200,
    },
  });
}

test('encounter events settle into both participants and skip memory for pure townsfolk', async t => {
  const db = getDb();
  t.after(() => closeDb());
  const registry = createTownActorRegistry(db);
  const world = registry.getWorldState();
  const scope = { worldId: world.worldId, worldEpoch: world.epoch };

  // 地点 + 两位镇民
  db.prepare(`INSERT INTO town_maps (name, grid_cols, grid_rows) VALUES ('m', 10, 10)`).run();
  db.prepare(`INSERT INTO town_locations (map_id, key, name, kind, grid_x, grid_y)
    VALUES (1, 'tea', '茶摊', 'place', 5, 5)`).run();
  db.prepare(`INSERT INTO town_npcs (map_id, display_name, persona, brief, appearance_desc, job)
    VALUES (1, '理发师小孙', '温和。', '理发师', '圆脸、蓝围裙', '理发师')`).run();
  db.prepare(`INSERT INTO town_npcs (map_id, display_name, persona, brief, appearance_desc, job)
    VALUES (1, '茶娘阿圆', '爱打听。', '茶摊主人', '圆脸、粗布裙', '茶摊主')`).run();
  const npcA = db.prepare(`SELECT * FROM town_npcs WHERE display_name = '理发师小孙'`).get();
  const npcB = db.prepare(`SELECT * FROM town_npcs WHERE display_name = '茶娘阿圆'`).get();
  registry.synchronize(); // 让后插入的镇民进入 actor 注册表
  const actorA = registry.resolveAgentKey(`npc:${npcA.id}`);
  const actorB = registry.resolveAgentKey(`npc:${npcB.id}`);
  assert.ok(actorA && actorB, 'both npc actors must be registered');

  // 已收尾且有摘要的相遇（镇民 id 以负数编码进 char_a/char_b）
  const enc = db.prepare(`INSERT INTO town_encounters (map_id, char_a, char_b, location_id, status, summary, ended_at)
    VALUES (1, ?, ?, 1, 'done', ?, datetime('now'))`)
    .run(-npcA.id, -npcB.id, '小孙和阿圆在茶摊聊了茶价和镇上的八卦');
  const encId = Number(enc.lastInsertRowid);

  const events = makeEventService(db, registry);
  events.append({
    eventId: `encounter:${encId}`, ...scope,
    type: 'town.encounter.happened', occurredAt: Date.now(),
    actorIds: [actorA.actorId, actorB.actorId], locationKey: 'tea',
    source: { system: 'town.encounters', entityId: `encounter:${encId}` },
    payload: { encounterId: encId, summary: '小孙和阿圆在茶摊聊了茶价和镇上的八卦' },
  }, [TOWN_EXPERIENCE_CONSUMER]);

  const memoryCalls = [];
  const experience = createTownExperienceService({
    db, clock: { now: () => Date.now() }, registry,
    writeMemory: (...args) => { memoryCalls.push(args); return []; },
    memoryEnabled: () => true,
  });
  experience.drain(scope);

  // 双方各入账一条经历，地点与人名齐全；镇民无角色卡 → 不写角色记忆
  const rows = db.prepare(`SELECT actor_id, summary FROM town_experiences WHERE event_id = ?`).all(`encounter:${encId}`);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.ok(row.summary.includes('理发师小孙') && row.summary.includes('茶娘阿圆') && row.summary.includes('茶摊'), row.summary);
  }
  assert.deepEqual(new Set(rows.map(r => r.actor_id)), new Set([actorA.actorId, actorB.actorId]));
  assert.equal(memoryCalls.length, 0);

  // 摘要与落库记录不符的事件不可入账（Only settled source rows authorize）
  events.append({
    eventId: `encounter:${encId}:bad`, ...scope,
    type: 'town.encounter.happened', occurredAt: Date.now(),
    actorIds: [actorA.actorId, actorB.actorId], locationKey: 'tea',
    source: { system: 'town.encounters', entityId: `encounter:${encId}:bad` },
    payload: { encounterId: encId, summary: '凭空捏造的会面' },
  }, [TOWN_EXPERIENCE_CONSUMER]);
  experience.drain(scope);
  assert.equal(db.prepare(`SELECT count(*) n FROM town_experiences WHERE event_id = ?`).get(`encounter:${encId}:bad`).n, 0);
});

test('encounter events write character memory when a resident character took part', async t => {
  const db = getDb();
  t.after(() => closeDb());
  const registry = createTownActorRegistry(db);
  const world = registry.getWorldState();
  const scope = { worldId: world.worldId, worldEpoch: world.epoch };

  db.prepare(`INSERT INTO town_npcs (map_id, display_name, persona, brief, appearance_desc, job)
    VALUES (1, '掌柜老周', '爽朗。', '酒馆掌柜', '络腮胡', '酒馆掌柜')`).run();
  const npc = db.prepare(`SELECT * FROM town_npcs WHERE display_name = '掌柜老周'`).get();
  db.prepare(`INSERT INTO characters (name, display_name, base_prompt) VALUES ('lin', '林小姐', '一位住进小镇的旅客')`).run();
  const charId = db.prepare(`SELECT id FROM characters WHERE name = 'lin'`).get().id;
  registry.synchronize(); // 让新角色进入 actor 注册表
  const actorNpc = registry.resolveAgentKey(`npc:${npc.id}`);
  const actorChar = registry.resolveAgentKey(`char:${charId}`);
  assert.ok(actorChar?.characterExists);

  const enc = db.prepare(`INSERT INTO town_encounters (map_id, char_a, char_b, location_id, status, summary, ended_at)
    VALUES (1, ?, ?, NULL, 'done', ?, datetime('now'))`)
    .run(-npc.id, charId, '老周和林小姐在门口聊了几句天气');
  const encId = Number(enc.lastInsertRowid);

  const events = makeEventService(db, registry);
  events.append({
    eventId: `encounter:${encId}`, ...scope,
    type: 'town.encounter.happened', occurredAt: Date.now(),
    actorIds: [actorNpc.actorId, actorChar.actorId], locationKey: null,
    source: { system: 'town.encounters', entityId: `encounter:${encId}` },
    payload: { encounterId: encId, summary: '老周和林小姐在门口聊了几句天气' },
  }, [TOWN_EXPERIENCE_CONSUMER]);

  const memoryCalls = [];
  const experience = createTownExperienceService({
    db, clock: { now: () => Date.now() }, registry,
    writeMemory: input => { memoryCalls.push(input); return []; },
    memoryEnabled: () => true,
  });
  experience.drain(scope);

  const rows = db.prepare(`SELECT actor_id, character_id FROM town_experiences WHERE event_id = ?`).all(`encounter:${encId}`);
  assert.equal(rows.length, 2);
  const charRow = rows.find(r => r.actor_id === actorChar.actorId);
  assert.equal(charRow.character_id, charId);
  // 角色参与 → 记忆回写被调用，写入 char_{id} 会话
  assert.equal(memoryCalls.length, 1);
  assert.equal(memoryCalls[0].conversationId, `char_${charId}`);
  assert.ok(memoryCalls[0].actions[0].memory.judgment.includes('老周'));
});
