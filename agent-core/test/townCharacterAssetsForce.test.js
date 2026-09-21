import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`character assets fixture forbids network: ${url}`); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const { registerAssetFromUrl } = await import('../src/services/town/townAssetService.js');

config.dbPath = ':memory:';

function seed (t) {
  const db = getDb();
  t.after(() => closeDb());
  db.prepare(`INSERT INTO characters (name, display_name, base_prompt, short_prompt)
    VALUES ('yanagi', '星见雅', '一位住在小镇的刀匠', '短提示词')`).run();
  const characterId = db.prepare('SELECT max(id) id FROM characters').get().id;
  return { db, characterId };
}

/** 直接登记三张 ready 素材（立绘 + 正/背小人），模拟素材已齐的角色 */
function seedReadyAssets (characterId) {
  registerAssetFromUrl({ kind: 'portrait', key: `char_${characterId}_portrait`, name: '立绘', url: '/assets/town/portrait.png', desc: '已就绪' });
  for (const dir of ['down', 'up']) {
    registerAssetFromUrl({ kind: 'npc', key: `char_${characterId}_${dir}`, name: dir, url: `/assets/town/${dir}.png`, desc: '已就绪' });
  }
}

test('素材齐备时补全接口直接复用已有素材，不重绘', async t => {
  const { characterId } = seed(t);
  seedReadyAssets(characterId);
  const result = await town.ensureCharacterTownAssets(characterId);
  assert.deepEqual(result.steps, { portrait: 'ready', sprites: 'ready' });
  assert.equal(result.ready, true);
});

test('force = true 时整套重新生成：已就绪的立绘与小人也会重画', async t => {
  const { characterId } = seed(t);
  seedReadyAssets(characterId);
  const result = await town.ensureCharacterTownAssets(characterId, { force: true });
  assert.notDeepEqual(result.steps, { portrait: 'ready', sprites: 'ready' }, 'force 时不能走跳过分支');
  assert.equal(result.steps.portrait, 'failed', '禁网 fixture 下立绘重绘失败，说明确实发起了重绘');
  assert.equal(result.steps.sprites, 'regenerated', '小人整套重绘（单方向失败只告警不抛错）');
  // 重绘失败时旧图仍在，所以素材依旧是齐备状态
  assert.equal(result.ready, true);
});