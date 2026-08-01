import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractEmbeddedGroupImagePrompt,
  formatGroupImageLine,
  parseScriptLine,
} from '../src/services/groupChatEngine.js';

const speaker = { id: 7, display_name: '飞霄' };
const members = new Map([['飞霄', speaker]]);

test('standalone brace content is parsed as an image task, not dialogue continuation', () => {
  assert.deepEqual(
    parseScriptLine('{Three people gather around a steaming hotpot table.}', members),
    {
      continuation: null,
      imagePrompt: 'Three people gather around a steaming hotpot table.',
    },
  );
});

test('brace prompt appended to dialogue is split from visible text', () => {
  assert.deepEqual(
    parseScriptLine('飞霄: 药膳锅底？？？ {Three people gather around a hotpot table.}', members),
    {
      speaker,
      text: '药膳锅底？？？',
      imagePrompt: 'Three people gather around a hotpot table.',
    },
  );
});

test('malformed prompt field inside braces is still normalized into an image task', () => {
  assert.deepEqual(
    extractEmbeddedGroupImagePrompt('{prompt: "a cozy late-night gathering"}'),
    { prompt: 'a cozy late-night gathering', text: '' },
  );
});

test('multiline brace prompt is captured as one image task', () => {
  assert.deepEqual(
    parseScriptLine('飞霄: 看这个\n{Three people gather\naround a hotpot table.}', members),
    {
      speaker,
      text: '看这个',
      imagePrompt: 'Three people gather\naround a hotpot table.',
    },
  );
});

test('multiple brace blocks are removed from dialogue and merged into one image task', () => {
  assert.deepEqual(
    parseScriptLine('飞霄: 看图 {three people} 补充 {warm hotpot lighting}', members),
    {
      speaker,
      text: '看图 补充',
      imagePrompt: 'three people, warm hotpot lighting',
    },
  );
});

test('empty or placeholder braces are suppressed instead of printed', () => {
  assert.equal(parseScriptLine('飞霄: {...}', members), null);
  assert.deepEqual(parseScriptLine('飞霄: 你看这个 {...}', members), {
    speaker,
    text: '你看这个',
  });
});

test('corrected standalone prompt is persisted with inherited speaker in the new protocol format', () => {
  assert.equal(
    formatGroupImageLine('飞霄', 'Three people gather around a hotpot table.'),
    '[飞霄]: {Three people gather around a hotpot table.}',
  );
});
