import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractImagePromptResponse,
  requestNonEmptyImagePrompt,
} from '../src/services/imagePromptResponse.js';

test('extractImagePromptResponse accepts plain text', () => {
  assert.equal(
    extractImagePromptResponse('Furina sitting beside a warm lamp'),
    'Furina sitting beside a warm lamp'
  );
});

test('extractImagePromptResponse unwraps legacy JSON instead of sending JSON as prompt', () => {
  assert.equal(
    extractImagePromptResponse('```json\n{"prompt":"Furina under moonlight"}\n```'),
    'Furina under moonlight'
  );
});

test('extractImagePromptResponse rejects empty or too-short responses', () => {
  assert.equal(extractImagePromptResponse('  '), null);
  assert.equal(extractImagePromptResponse('no'), null);
  assert.equal(extractImagePromptResponse(null), null);
});

test('requestNonEmptyImagePrompt retries one empty success response', async () => {
  const responses = ['', 'Furina smiling at the viewer'];
  let calls = 0;
  let emptyNotifications = 0;

  const result = await requestNonEmptyImagePrompt(
    async () => responses[calls++],
    { emptyRetries: 1, onEmpty: () => { emptyNotifications += 1; } }
  );

  assert.equal(result, 'Furina smiling at the viewer');
  assert.equal(calls, 2);
  assert.equal(emptyNotifications, 1);
});

test('requestNonEmptyImagePrompt returns empty after the retry is exhausted', async () => {
  let calls = 0;
  const result = await requestNonEmptyImagePrompt(async () => {
    calls += 1;
    return null;
  }, { emptyRetries: 1 });

  assert.equal(result, '');
  assert.equal(calls, 2);
});
