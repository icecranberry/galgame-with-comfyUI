import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGroupImageNameFallback,
  collectCharacterLoras,
  matchCharactersInImagePrompt,
} from './groupImageLoraMatcher.js';

const characters = [
  { id: 1, name: 'raiden_mei', display_name: 'Mei' },
  { id: 2, name: 'elysia pink', display_name: 'Elysia' },
  { id: 3, name: 'mei', display_name: 'Other Mei' },
];

test('matches underscored and spaced names across prompt separators', () => {
  const matches = matchCharactersInImagePrompt(
    'RAIDEN MEI standing beside elysia_pink in a city street',
    characters,
  );

  assert.deepEqual(matches.map(character => character.id), [1, 2]);
});

test('can still match a shorter name when it appears separately', () => {
  const matches = matchCharactersInImagePrompt(
    'raiden_mei standing beside mei in a city street',
    characters,
  );

  assert.deepEqual(matches.map(character => character.id), [1, 3]);
});

test('uses token boundaries for short single-token names', () => {
  const matches = matchCharactersInImagePrompt('a meido waitress portrait', characters);
  assert.deepEqual(matches, []);
});

test('merges LoRAs from multiple characters and deduplicates paths', () => {
  const loras = collectCharacterLoras([
    { loras: JSON.stringify([{ path: 'mei.safetensors', weight: 0.7, triggerWord: 'mei' }]) },
    { loras: [{ path: 'elysia.safetensors', weight: 0.8 }, { path: 'mei.safetensors', weight: 1 }] },
  ]);

  assert.deepEqual(loras, [
    { path: 'mei.safetensors', weight: 0.7, triggerWord: 'mei' },
    { path: 'elysia.safetensors', weight: 0.8, triggerWord: '' },
  ]);
});

test('adds the speaker English name when a person prompt omitted all character names', () => {
  const prepared = applyGroupImageNameFallback(
    'a shy young girl taking a selfie on a summer street',
    [],
    { name: 'chinatsu' },
  );

  assert.deepEqual(prepared, {
    prompt: 'chinatsu, a shy young girl taking a selfie on a summer street',
    fallbackApplied: true,
  });
});

test('does not add a character LoRA tag to scenery or object-only prompts', () => {
  const prepared = applyGroupImageNameFallback(
    'a convenience store shelf filled with colorful drinks',
    [],
    { name: 'chinatsu' },
  );

  assert.equal(prepared.fallbackApplied, false);
});
