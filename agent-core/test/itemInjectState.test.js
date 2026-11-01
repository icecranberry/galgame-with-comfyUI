import { test, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
config.dbPath = ':memory:';
const items = await import('../src/services/itemService.js');
const outfits = await import('../src/services/outfitService.js');
const { pickWorldLoot } = await import('../src/services/newspaperService.js');

function seedCharacter(name, displayName) {
  const db = getDb();
  db.prepare('DELETE FROM item_effects').run();
  db.prepare('DELETE FROM global_outfits').run();
  db.prepare("DELETE FROM backpack_items WHERE source_type = 'inject'").run();
  db.prepare('DELETE FROM character_outfits').run();
  db.prepare(`DELETE FROM characters WHERE name LIKE '${name}%'`).run();
  db.prepare('INSERT INTO characters (name, display_name, base_prompt) VALUES (?, ?, ?)').run(name, displayName, 'x');
  return db.prepare('SELECT id FROM characters WHERE name = ?').get(name).id;
}

test('outfit 注入：落临时外观、进「生效中」面板、不进背包列表', () => {
  const charId = seedCharacter('inject_outfit', '换装小姐');
  const res = items.injectCharacterState({
    characterId: charId, kind: 'outfit', name: '兔女郎装', description: '黑色缎面兔女郎装，白色领口与袖口。',
  });
  assert.equal(res.ok, true);
  assert.equal(res.activeEffect.kind, 'outfit');
  assert.ok(res.activeEffect.remaining_seconds > 86000 && res.activeEffect.remaining_seconds <= 86400, '默认持续一天');

  const limited = outfits.getActiveOutfits(charId).limited;
  assert.ok(limited.some(o => o.name === '兔女郎装'), '应写入一条限时外观');

  const active = items.listActiveEffects();
  const row = active.find(e => e.character_id === charId);
  assert.ok(row, '应出现在生效中面板');
  assert.equal(row.kind, 'outfit');
  assert.equal(row.item_name, '兔女郎装');
  assert.equal(row.effect_name, '兔女郎装', '注入类显示神写的具体名称，而不是通用标签');

  const backpack = items.listBackpack();
  assert.ok(!backpack.items.some(i => i.name === '兔女郎装'), '影子道具不应进背包列表');
  assert.ok(!backpack.pendingItems.some(i => i.name === '兔女郎装'));
});

test('buff 注入：自定义状态文本进入聊天人格临时状态块', () => {
  const charId = seedCharacter('inject_buff', '兴奋先生');
  const res = items.injectCharacterState({
    characterId: charId, kind: 'buff', name: '莫名兴奋', description: '说话节奏变快，忍不住哼歌，眼睛发亮。',
  });
  assert.equal(res.ok, true);
  assert.equal(res.activeEffect.kind, 'buff');
  const row = items.listActiveEffects().find(e => e.character_id === charId);
  assert.equal(row.kind, 'buff');
  assert.equal(row.effect_text, '说话节奏变快，忍不住哼歌，眼睛发亮。');

  const block = items.getActiveBuffBlock(charId);
  assert.ok(block.includes('莫名兴奋'), '状态块应包含注入名称');
  assert.ok(block.includes('忍不住哼歌'), '状态块应使用注入的具体描述');
});

test('transform 注入：可提前移除并清理效果', () => {
  const charId = seedCharacter('inject_transform', '变身小姐');
  const res = items.injectCharacterState({
    characterId: charId, kind: 'transform', name: '猫娘形态', description: '长出猫耳与猫尾，手脚带软垫。',
  });
  assert.equal(res.ok, true);
  assert.equal(res.activeEffect.kind, 'transform');
  assert.ok(items.listActiveEffects().some(e => e.id === res.activeEffect.id));

  const removed = items.removeActiveEffect(res.activeEffect.id);
  assert.equal(removed.ok, true);
  assert.ok(!items.listActiveEffects().some(e => e.id === res.activeEffect.id));
});

test('参数校验与时长上限', () => {
  const charId = seedCharacter('inject_guard', '校验小姐');
  assert.equal(items.injectCharacterState({ characterId: charId, kind: 'unknown', name: 'x', description: 'y' }).ok, false);
  assert.equal(items.injectCharacterState({ characterId: charId, kind: 'buff', name: '  ', description: 'y' }).ok, false);
  assert.equal(items.injectCharacterState({ characterId: 999999, kind: 'buff', name: 'x', description: 'y' }).ok, false);
  const capped = items.injectCharacterState({ characterId: charId, kind: 'buff', name: '超时状态', description: 'z', hours: 9999 });
  assert.equal(capped.ok, true);
  assert.ok(capped.activeEffect.remaining_seconds > 7 * 24 * 3600 - 120, '小时数应被限制到 7 天上限');
});

test('注入条目不会进入宝箱与日报掉落池', () => {
  for (let i = 0; i < 400; i++) {
    assert.ok(!String(items.rollEffectKey()).startsWith('god_inject'), '宝箱不应抽到注入专用条目');
    assert.ok(!String(pickWorldLoot(false).key).startsWith('god_inject'), '日报不应抽到注入专用条目');
  }
});

after(() => closeDb());
