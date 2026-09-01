import test from 'node:test';
import assert from 'node:assert/strict';

import {
  composeImagePrompt,
  prepareImagePrompt,
  resolveImageRagQuery,
} from '../src/services/imagePromptPreparer.js';

test('resolveImageRagQuery prefers a Chinese scene description', () => {
  assert.equal(resolveImageRagQuery('1girl, cafe', '两人在咖啡店并肩坐着'), '两人在咖啡店并肩坐着');
});

test('resolveImageRagQuery falls back without Chinese input', () => {
  assert.equal(resolveImageRagQuery('1girl, cafe', ''), '1girl, cafe');
  assert.equal(resolveImageRagQuery('1girl, cafe', 'cafe seating'), '1girl, cafe');
});

test('composeImagePrompt can select executable tags from the Chinese query', () => {
  const items = [{
    id: 'test.pose.selfie',
    category: 'pose_geometry',
    priority: 10,
    executableTags: [{ tag: 'selfie', label: '自拍', group: 'pose' }],
  }];

  const result = composeImagePrompt('1girl, standing', items, { ragQuery: '她正在自拍' });
  assert.ok(result.promptRefined.includes('selfie'));
  assert.equal(result.selectedTags[0].knowledgeId, 'test.pose.selfie');
});

test('disableRAG bypasses retrieval and keeps the prompt unchanged', async () => {
  const result = await prepareImagePrompt('1girl, cafe, standing', {
    ragQuery: '两人在咖啡店并肩坐着',
    disableRAG: true,
    persist: false,
  });

  assert.equal(result.status, 'rag_disabled');
  assert.equal(result.retrieval.mode, 'rag_disabled');
  assert.equal(result.promptOriginal, '1girl, cafe, standing');
  assert.equal(result.promptRefined, '1girl, cafe, standing');
  assert.deepEqual(result.selection.selectedTags, []);
});
