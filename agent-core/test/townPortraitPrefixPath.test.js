/**
 * 大立绘前缀口径的回归：
 * - 前缀由 resolvePromptPrefix 固定为 'full body, white background'（见 townAssetPromptPrefix.test.js）；
 * - 立绘生成路径不再把调用方传的 promptPrefix 落进素材 meta（NPC 立绘 / 玩家立绘都一样）；
 * - 像素小人的素材级 promptPrefix 保持可配，不受影响。
 *
 * 生图被网络禁止必然失败，运行时用例只检查「meta 落库口径」与调用链可执行性。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`portrait fixture forbids network: ${url}`); };

const { config } = await import('../src/config.js');
config.dbPath = ':memory:';
const { getDb, closeDb } = await import('../src/db/index.js');
const { generateNpcPortrait } = await import('../src/services/town/townNpcService.js');

const PANEL_PREFIX = 'pixel art, game sprite, mini human sized, full body';
const NPC_PERSONA = '温吞的面包师。\n\n## 你的外观\n- 亚麻色短发，围裙上总有面粉';

/** 取 townNpcService 源码里某个导出函数的函数体（玩家立绘路径无法在测试里注入 LLM，只能静态确认） */
function fnBody (name) {
  const lines = readFileSync(new URL('../src/services/town/townNpcService.js', import.meta.url), 'utf8').split(/\r?\n/);
  const at = lines.findIndex(l => l.startsWith(`export async function ${name}(`));
  assert.ok(at >= 0, `${name} 应存在`);
  const end = lines.findIndex((l, i) => i > at && l === '}');
  return lines.slice(at, end + 1).join('\n');
}

function seed (t) {
  const db = getDb();
  t.after(() => closeDb());
  db.prepare(`INSERT INTO town_npcs (map_id, display_name, job, persona) VALUES (1, '面包师', '面包师', ?)`)
    .run(NPC_PERSONA);
  return { db, npcId: db.prepare('SELECT max(id) id FROM town_npcs').get().id };
}

test('NPC 立绘：调用方传的 promptPrefix 不落素材 meta', async t => {
  const { db, npcId } = seed(t);
  // 预设 prompt 跳过 LLM；生图失败后素材行与 meta 仍在库里
  await assert.rejects(
    generateNpcPortrait(npcId, { prompt: 'a baker, white background', promptPrefix: PANEL_PREFIX }),
    err => !/is not defined|ReferenceError|TypeError/.test(String(err?.message)),
    '立绘调用链不应因变量缺失报错',
  );
  const row = db.prepare('SELECT meta_json FROM town_assets WHERE key = ?').get(`npc_${npcId}_portrait`);
  assert.ok(row, '立绘素材行应已建立');
  const meta = JSON.parse(row.meta_json);
  assert.equal(meta.promptPrefix, undefined, '立绘不写素材级 promptPrefix');
  assert.equal(meta.promptOverride, 'a baker, white background');
});

test('立绘函数体内不再写 promptPrefix', () => {
  for (const name of ['generateNpcPortrait', 'regeneratePlayerPortrait']) {
    assert.ok(!fnBody(name).includes('promptPrefix:'), `${name} 不应再写素材级 promptPrefix`);
  }
});

test('像素小人函数体仍写素材级 promptPrefix（前缀只对小人可配）', () => {
  for (const name of ['generateNpcSprites', 'regeneratePlayerSprite']) {
    assert.ok(fnBody(name).includes('promptPrefix:'), `${name} 应保留素材级 promptPrefix`);
  }
});