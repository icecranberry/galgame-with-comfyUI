import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`appearance backfill fixture forbids network: ${url}`); };
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const { ensureCharacterAppearanceSection } = await import('../src/services/characterAppearanceService.js');

config.dbPath = ':memory:';

const PLAIN_CARD = '琪亚娜(kiana)是来自《崩坏3》的天命卡斯兰娜家族名义上的大小姐。\n她是个不折不扣的笨蛋，喜欢用「本小姐」自称。';
const CARD_WITH_APPEARANCE = `${PLAIN_CARD}\n\n## 你的外观\n- 银白色长发扎成双麻花辫`;

function seed (t, basePrompt = PLAIN_CARD) {
  const db = getDb();
  t.after(() => closeDb());
  db.prepare(`INSERT INTO characters (name, display_name, base_prompt, short_prompt) VALUES ('kiana', '琪亚娜', ?, '短提示词')`)
    .run(basePrompt);
  return { db, characterId: db.prepare('SELECT max(id) id FROM characters').get().id };
}

test('角色卡已有外观段：直接返回，不调 LLM', async t => {
  const { characterId } = seed(t, CARD_WITH_APPEARANCE);
  let called = 0;
  const out = await ensureCharacterAppearanceSection(characterId, {
    chatSync: async () => { called++; return 'x'.repeat(60); },
  });
  assert.equal(out.generated, false);
  assert.equal(called, 0, '已有外观段时不该再花一次 LLM');
  assert.match(out.appearance, /银白色长发/);
});

test('角色卡缺外观段：LLM 推断后写回「## 你的外观」，原卡正文保留', async t => {
  const { db, characterId } = seed(t);
  const out = await ensureCharacterAppearanceSection(characterId, {
    chatSync: async () => 'kiana (honkai impact), white hair, twin braids, blue eyes, ahoge, white dress',
  });
  assert.equal(out.generated, true);
  assert.match(out.appearance, /white hair/);
  const saved = db.prepare('SELECT base_prompt FROM characters WHERE id = ?').get(characterId).base_prompt;
  assert.match(saved, /## 你的外观/);
  assert.match(saved, /white hair, twin braids/);
  assert.match(saved, /不折不扣的笨蛋/, '原卡正文要保留');
  assert.ok(saved.indexOf('不折不扣的笨蛋') < saved.indexOf('## 你的外观'), '外观段补在卡末');
});

test('LLM 输出太短：抛错且不写坏角色卡', async t => {
  const { db, characterId } = seed(t);
  await assert.rejects(
    () => ensureCharacterAppearanceSection(characterId, { chatSync: async () => '短发' }),
    /外观描述/,
  );
  const saved = db.prepare('SELECT base_prompt FROM characters WHERE id = ?').get(characterId).base_prompt;
  assert.equal(saved, PLAIN_CARD);
  assert.ok(!saved.includes('## 你的外观'));
});

test('角色不存在：返回 null', async t => {
  seed(t);
  assert.equal(await ensureCharacterAppearanceSection(999999, { chatSync: async () => 'x'.repeat(60) }), null);
});