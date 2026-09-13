import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const gen = await import('../src/services/town/townNpcMomentGenerator.js');

config.dbPath = ':memory:';

const fakeLlm = payload => ({ chatSync: async () => JSON.stringify(payload) });
const failImage = { generateImageRaw: async () => ({ success: false, images: [] }) };

test('town npc moments post with npc authorship, day facts in the prompt, and deferral on cap', async t => {
  const db = getDb();
  t.after(() => closeDb());

  db.prepare(`INSERT INTO town_maps (name, grid_cols, grid_rows) VALUES ('m', 10, 10)`).run();
  db.prepare(`INSERT INTO town_locations (map_id, key, name, kind, grid_x, grid_y)
    VALUES (1, 'tea', '茶摊', 'place', 5, 5)`).run();
  db.prepare(`INSERT INTO town_npcs (map_id, display_name, persona, brief, appearance_desc, job)
    VALUES (1, '茶娘阿圆', '爱打听，嘴快。', '茶摊主人', '圆脸、粗布裙', '茶摊主')`).run();
  const npc = db.prepare(`SELECT * FROM town_npcs WHERE display_name = '茶娘阿圆'`).get();

  // 今天的真实素材：一场已收尾的相遇（镇民 id 以负数编码）
  db.prepare(`INSERT INTO town_encounters (map_id, char_a, char_b, location_id, status, summary, ended_at)
    VALUES (1, ?, -999, 1, 'done', ?, datetime('now'))`)
    .run(-npc.id, '阿圆和路过的货郎在茶摊聊起了南边的新鲜货');

  const seen = [];
  const broadcast = [];
  const post = await gen.generateTownNpcMoment(npc, {
    broadcastPost: info => broadcast.push(info),
    llm: { chatSync: async msgs => { seen.push(msgs); return JSON.stringify({ text: '今天的茶摊格外热闹！', imagePrompt: 'a tea stall in a small town' }); } },
    image: failImage,
  });

  // 帖子落库：镇民作者（character_id 为 NULL），状态 done
  assert.ok(post && post.id);
  const row = db.prepare(`SELECT * FROM moment_posts WHERE id = ?`).get(post.id);
  assert.equal(row.npc_id, npc.id);
  assert.equal(row.character_id, null);
  assert.equal(row.status, 'done');
  assert.equal(row.content, '今天的茶摊格外热闹！');

  // prompt 带上了今天的真实相遇素材与人设
  const promptText = seen.map(msgs => msgs.map(m => m.content).join('\n')).join('\n');
  assert.ok(promptText.includes('阿圆和路过的货郎在茶摊聊起了南边的新鲜货'), 'encounter summary should feed the prompt');
  assert.ok(promptText.includes('茶摊主'), 'job persona should be injected');
  assert.ok(promptText.includes('禁止否认或编造更大的事'), 'facts must not be contradicted or inflated');
  assert.ok(promptText.includes('单中心（最高优先级）'), 'moments prompt should enforce a single narrative center');
  assert.ok(promptText.includes('只从中选一件最想分享的事'), 'npc day facts should be framed as candidates for one main thread');
  assert.ok(promptText.includes('只围绕一个具体中心'), 'json text example should mirror the single-center rule');

  // 下次发帖时间已排上，且越过调度器的「每人 24h 一条」去重窗口；广播带了 npc 作者标识
  const nextAtRaw = db.prepare(`SELECT next_moment_at FROM town_npcs WHERE id = ?`).get(npc.id).next_moment_at;
  assert.ok(nextAtRaw);
  const nextAtMs = new Date(nextAtRaw.replace(' ', 'T') + 'Z').getTime();
  assert.ok(nextAtMs >= Date.now() + 24 * 3600_000 - 60_000, `next post should be scheduled beyond 24h, got ${nextAtRaw}`);
  assert.equal(broadcast[0].author_type, 'npc');
  assert.equal(broadcast[0].npc_id, npc.id);

  // 全镇每日上限：塞满 4 条镇民帖后，下一次发帖被顺延（返回 null 且不动 feed）
  for (let i = 0; i < (config.town.npcMoments?.dailyCap ?? 4); i++) {
    db.prepare(`INSERT INTO moment_posts (character_id, npc_id, content, status) VALUES (NULL, ?, '凑数', 'done')`).run(npc.id);
  }
  db.prepare(`UPDATE town_npcs SET next_moment_at = datetime('now', '-1 hour') WHERE id = ?`).run(npc.id);
  const deferred = await gen.generateTownNpcMoment(npc, {
    broadcastPost: () => {}, llm: fakeLlm({ text: 'x', imagePrompt: 'y' }), image: failImage,
  });
  assert.equal(deferred, null);
  assert.equal(db.prepare(`SELECT count(*) n FROM moment_posts WHERE content = 'x'`).get().n, 0);
});
