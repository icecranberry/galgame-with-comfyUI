import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('global LoRA scope defaults include town portraits but keep stickers opt-in', () => {
  const source = readFileSync(new URL('../src/components/GlobalLoraModal.vue', import.meta.url), 'utf8');
  const options = source.match(/const sceneOptions = \[[\s\S]*?\n\]/)?.[0];
  const defaults = source.match(/const defaultScenes = [^\n]+/)?.[0];
  assert.ok(options);
  assert.ok(defaults);
  const result = runInNewContext(`${options};\n${defaults};\n({ options: sceneOptions, defaults: defaultScenes() })`);
  assert.equal(result.options.find(s => s.value === 'town_portrait')?.label, '小镇立绘');
  assert.ok(result.defaults.includes('town_portrait'));
  assert.ok(result.defaults.includes('portrait'));
  assert.ok(!result.defaults.includes('sticker'));
  assert.match(source, /scenes: defaultScenes\(\)/);
  assert.match(source, /v-for="s in sceneOptions"/);
});
