import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const stock = await import('../src/services/town/townNpcStockService.js');
const scheduler = await import('../src/services/town/townNpcStockScheduler.js');

function setup(t) {
  config.dbPath = ':memory:';
  config.features.town = true;
  const db = getDb();
  t.after(() => closeDb());
  const wid = db.prepare('SELECT world_id FROM town_world_state WHERE singleton=1').get().world_id;
  const npcId = Number(db.prepare(`INSERT INTO town_npcs (map_id, display_name, job, capabilities_json, town_enabled)
    VALUES (1,'奶牛娘','牧场帮工','["service","work","trade"]',1)`).run().lastInsertRowid);
  db.prepare(`INSERT INTO town_npcs (map_id, display_name, job, capabilities_json, town_enabled)
    VALUES (1,'理发师','理发师','["service"]',1)`).run();
  const now = Date.now();
  const insertStock = (name, { status = 'pending', attempts = 0, nextRollAt = now + stock.STOCK_ROLL_MS, sold = null } = {}) =>
    Number(db.prepare(`INSERT INTO town_npc_stock
      (world_id,npc_id,effect_key,price,custom_name,custom_desc,image_prompt,image_status,image_attempts,favor_delta,source,rolled_at,next_roll_at,sold_at)
      VALUES(?,?,?,?,?,?,?,?,?,3,'llm',?,?,?)`)
      .run(wid, npcId, 'favor_candy', 30, name, 'desc', 'icon', status, attempts, now, nextRollAt, sold).lastInsertRowid);
  return { db, wid, npcId, insertStock };
}

test('reading a fresh shelf is read-only and never generates on open', async t => {
  const f = setup(t);
  f.insertStock('新鲜货', { status: 'ready' });
  const view = await stock.getTownNpcStockView({ worldId: f.wid, npcId: f.npcId });
  assert.equal(view.rolling, false);
  assert.equal(view.goods.length, 1);
  assert.equal(view.goods[0].title, '新鲜货');
});

test('scheduler only considers trade-capable residents whose shelf is due', async t => {
  const f = setup(t);
  const now = Date.now();
  assert.equal(scheduler.tradeNpcsDue(f.db, f.wid, now).length, 1, '缺货的交易居民应被判定为待换货');
  f.insertStock('在售货', { status: 'ready' });
  assert.equal(scheduler.tradeNpcsDue(f.db, f.wid, now).length, 0, '货架新鲜时不该换货');
  f.db.prepare('UPDATE town_npc_stock SET next_roll_at=?').run(now - 1);
  assert.equal(scheduler.tradeNpcsDue(f.db, f.wid, now).length, 1, '超过 3 天应触发换货');
});

test('background image catch-up repaints unfinished goods and respects the attempt cap', async t => {
  const f = setup(t);
  const pending = f.insertStock('待画货', { status: 'pending', attempts: 0 });
  const exhausted = f.insertStock('次数用尽', { status: 'failed', attempts: stock.STOCK_IMAGE_MAX_ATTEMPTS });
  const ready = f.insertStock('已画好', { status: 'ready', attempts: 1 });

  let calls = 0;
  const boom = async () => { calls++; throw new Error('comfy down'); };
  const painted = await stock.ensureStockImages({ worldId: f.wid, limit: 5, minAgeMs: 0, generateImageRaw: boom });
  assert.equal(painted, 1, '只应补画那件未完成且未超次数的货');
  assert.equal(calls, 1);
  assert.equal(f.db.prepare('SELECT image_status FROM town_npc_stock WHERE id=?').get(pending).image_status, 'failed');
  assert.equal(f.db.prepare('SELECT image_attempts FROM town_npc_stock WHERE id=?').get(pending).image_attempts, 1);
  assert.equal(f.db.prepare('SELECT image_status FROM town_npc_stock WHERE id=?').get(exhausted).image_status, 'failed');
  assert.equal(f.db.prepare('SELECT image_status FROM town_npc_stock WHERE id=?').get(ready).image_status, 'ready');
});
