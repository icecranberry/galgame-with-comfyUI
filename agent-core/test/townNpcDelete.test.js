import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const { createNpc, deleteNpc } = await import('../src/services/town/townNpcService.js');
const { saveMap } = await import('../src/services/town/townMapService.js');
const { generateTownNpcMoment } = await import('../src/services/town/townNpcMomentGenerator.js');

const grid = () => Array.from({ length: 12 }, () => Array(12).fill(null));

function setupTown() {
  config.dbPath = ':memory:';
  config.features.town = true;
  Object.assign(config.town, { playerSpeed: 1, npcSpeed: 1, maxActiveEncounters: 0, timeZone: 'Asia/Shanghai' });
  if (config.comfyui) Object.assign(config.comfyui, { momentsWidth: 1024, momentsHeight: 768, momentsArtist: 'anime' });
  const db = getDb();
  const { mapId } = saveMap({ name: '删除测试小镇', cols: 12, rows: 12,
    layers: { ground: grid(), road: grid(), objects: [] }, locations: [] });
  return { db, mapId };
}

test('deleteNpc 显式清理该居民的朋友圈帖、评论与点赞，且不影响其他居民', () => {
  const { db, mapId } = setupTown();

  createNpc({ mapId, displayName: '阿秀', job: '杂货铺', persona: '说话软软的。' });
  const npcId = db.prepare('SELECT max(id) id FROM town_npcs').get().id;
  const p1 = Number(db.prepare("INSERT INTO moment_posts (npc_id, content, status) VALUES (?, '帖子一', 'done')").run(npcId).lastInsertRowid);
  db.prepare("INSERT INTO moment_posts (npc_id, content, status) VALUES (?, '', 'generating')").run(npcId);
  db.prepare("INSERT INTO moment_comments (post_id, author_type, content) VALUES (?, 'user', '好看')").run(p1);
  db.prepare('INSERT INTO moment_likes (post_id) VALUES (?)').run(p1);

  createNpc({ mapId, displayName: '阿强', job: '铁匠', persona: '沉默寡言。' });
  const otherId = db.prepare('SELECT max(id) id FROM town_npcs').get().id;
  const otherPost = Number(db.prepare("INSERT INTO moment_posts (npc_id, content, status) VALUES (?, '别人的帖', 'done')").run(otherId).lastInsertRowid);

  const res = deleteNpc(npcId);
  assert.equal(res.ok, true);
  assert.equal(db.prepare('SELECT count(*) n FROM town_npcs WHERE id = ?').get(npcId).n, 0, '居民应被删除');
  assert.equal(db.prepare('SELECT count(*) n FROM moment_posts WHERE npc_id = ?').get(npcId).n, 0, '该居民帖子应被清理');
  assert.equal(db.prepare('SELECT count(*) n FROM moment_comments WHERE post_id = ?').get(p1).n, 0, '点赞/评论应被清理');
  assert.equal(db.prepare('SELECT count(*) n FROM moment_likes WHERE post_id = ?').get(p1).n, 0, '点赞应被清理');

  assert.equal(db.prepare('SELECT count(*) n FROM moment_posts WHERE id = ?').get(otherPost).n, 1, '其他居民的帖子不受影响');
  assert.equal(db.prepare('SELECT count(*) n FROM town_npcs WHERE id = ?').get(otherId).n, 1, '其他居民不受影响');

  assert.equal(deleteNpc(999999).ok, false, '删除不存在的居民应返回 ok:false');
  closeDb();
});

test('生成朋友圈期间居民被删除：不落帖、不广播，返回 null', async () => {
  const { db, mapId } = setupTown();

  createNpc({ mapId, displayName: '小满', job: '花匠', persona: '爱笑。' });
  const npcId = db.prepare('SELECT max(id) id FROM town_npcs').get().id;
  const npc = db.prepare('SELECT * FROM town_npcs WHERE id = ?').get(npcId);

  let deletedDuring = false;
  let broadcasted = 0;
  const llm = { chatSync: async () => {
    // 模拟 LLM 耗时期间，用户在管理面板删除了该居民
    deleteNpc(npcId);
    deletedDuring = true;
    return JSON.stringify({ text: '今晚的月亮很好，院子里的花都开了。', imagePrompt: 'moon over a small town garden' });
  } };
  const image = { generateImageRaw: async () => ({ success: false, images: [] }) };

  const out = await generateTownNpcMoment(npc, { llm, image, broadcastPost: () => { broadcasted += 1; } });

  assert.equal(deletedDuring, true, '前置条件：生成期间确实删除了居民');
  assert.equal(out, null, '居民已删除，不应返回可广播的帖子');
  assert.equal(broadcasted, 0, '居民已删除，不应发生 new_post 广播');
  assert.equal(db.prepare('SELECT count(*) n FROM moment_posts WHERE npc_id = ?').get(npcId).n, 0, '不应残留该居民的帖子');
  assert.equal(db.prepare('SELECT count(*) n FROM town_npcs WHERE id = ?').get(npcId).n, 0, '居民已删除');
  closeDb();
});
