import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = globalThis.fetch; // 保留原生 fetch，集成测试要起本地 http 服务
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const { createTownEventService } = await import('../src/services/town/townEventService.js');
const { createTownExperienceService, TOWN_EXPERIENCE_CONSUMER } = await import('../src/services/town/townExperienceService.js');
const { createTownActorRegistry } = await import('../src/services/town/townActorRegistry.js');
const momentGen = await import('../src/services/town/townNpcMomentGenerator.js');

config.dbPath = ':memory:';

test('一天的小镇生态链路：相遇 → 摘要入账 → 经历 → 镇民发朋友圈 → feed 可读', async t => {
  const db = getDb();
  t.after(async () => { await new Promise(resolve => server.close(resolve)); closeDb(); });
  const registry = createTownActorRegistry(db);
  const world = registry.getWorldState();
  const scope = { worldId: world.worldId, worldEpoch: world.epoch };

  // ── 场景搭建：地点 + 一位镇民 + 一位入住角色 ──
  db.prepare(`INSERT INTO town_maps (name, grid_cols, grid_rows) VALUES ('m', 10, 10)`).run();
  db.prepare(`INSERT INTO town_locations (map_id, key, name, kind, grid_x, grid_y)
    VALUES (1, 'tea', '茶摊', 'place', 5, 5)`).run();
  db.prepare(`INSERT INTO town_npcs (map_id, display_name, persona, brief, appearance_desc, job)
    VALUES (1, '茶娘阿圆', '爱打听，嘴快。', '茶摊主人', '圆脸、粗布裙', '茶摊主')`).run();
  db.prepare(`INSERT INTO characters (name, display_name, base_prompt)
    VALUES ('lin', '林小姐', '一位住进小镇的旅客')`).run();
  registry.synchronize();
  const npc = db.prepare(`SELECT * FROM town_npcs WHERE display_name = '茶娘阿圆'`).get();
  const charId = db.prepare(`SELECT id FROM characters WHERE name = 'lin'`).get().id;
  const actorNpc = registry.resolveAgentKey(`npc:${npc.id}`);
  const actorChar = registry.resolveAgentKey(`char:${charId}`);

  // ── 1. 相遇发生并收尾（scanEncounters → runEncounterDialogue 的产物）──
  const enc = db.prepare(`INSERT INTO town_encounters (map_id, char_a, char_b, location_id, status, summary, ended_at)
    VALUES (1, ?, ?, 1, 'done', ?, datetime('now'))`)
    .run(-npc.id, charId, '阿圆和林小姐在茶摊聊起镇上新到的茶叶');
  const encId = Number(enc.lastInsertRowid);

  // ── 2. 相遇摘要入账（runEncounterSummary → settleEncounterExperience）──
  const events = createTownEventService({
    db, clock: { now: () => Date.now() },
    getWorldEpoch: worldId => registry.getWorldEpoch(worldId),
    validators: {
      'town.encounter.happened': payload => !!payload && Number.isSafeInteger(payload.encounterId)
        && payload.encounterId > 0 && typeof payload.summary === 'string'
        && payload.summary.trim().length > 0 && payload.summary.length <= 200,
    },
  });
  events.append({
    eventId: `encounter:${encId}`, ...scope,
    type: 'town.encounter.happened', occurredAt: Date.now(),
    actorIds: [actorNpc.actorId, actorChar.actorId], locationKey: 'tea',
    source: { system: 'town.encounters', entityId: `encounter:${encId}` },
    payload: { encounterId: encId, summary: '阿圆和林小姐在茶摊聊起镇上新到的茶叶' },
  }, [TOWN_EXPERIENCE_CONSUMER]);
  createTownExperienceService({
    db, clock: { now: () => Date.now() }, registry,
    writeMemory: () => [], memoryEnabled: () => true,
  }).drain(scope);
  assert.equal(db.prepare(`SELECT count(*) n FROM town_experiences WHERE event_id = ?`).get(`encounter:${encId}`).n, 2,
    '双方都应沉淀一条共同经历');

  // ── 3. 镇民把今天的事发朋友圈 ──
  const seen = [];
  const post = await momentGen.generateTownNpcMoment(npc, {
    llm: { chatSync: async msgs => { seen.push(msgs); return JSON.stringify({ text: '今天的茶摊好热闹！', imagePrompt: 'a tea stall' }); } },
    image: { generateImageRaw: async () => ({ success: false, images: [] }) },
  });
  assert.ok(post?.id);
  const promptText = seen.map(msgs => msgs.map(m => m.content).join('\n')).join('\n');
  // 相遇摘要（encounters 表）与共同经历（experiences 表）都成为发帖素材
  assert.ok(promptText.includes('阿圆和林小姐在茶摊聊起镇上新到的茶叶'), 'encounter summary feeds the post');
  assert.ok(promptText.includes('经历：'), 'settled experience feeds the post');

  // ── 4. 真实路由：镇民帖出现在朋友圈 feed，作者字段完整 ──
  const express = (await import('express')).default;
  const momentsModule = await import('../src/routes/moments.js');
  const app = express();
  app.use('/api/moments', momentsModule.default);
  const server = app.listen(0);
  const port = server.address().port;
  const feed = await (await fetch(`http://127.0.0.1:${port}/api/moments`)).json();
  const npcPost = (feed.posts || []).find(p => p.id === post.id);
  assert.ok(npcPost, 'npc post should appear in the feed');
  assert.equal(npcPost.npc_id, npc.id);
  assert.equal(npcPost.author_type, 'npc');
  assert.equal(npcPost.display_name, '茶娘阿圆');
  // 详情接口同样可读
  const detail = await (await fetch(`http://127.0.0.1:${port}/api/moments/${post.id}`)).json();
  assert.equal(detail.author_type, 'npc');
  assert.ok(Array.isArray(detail.comments));
});
