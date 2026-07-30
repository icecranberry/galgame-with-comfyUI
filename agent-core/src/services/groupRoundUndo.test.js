import test from 'node:test';
import assert from 'node:assert/strict';
import { inferLastGroupRound } from './groupRoundUndo.js';

test('infers a normal user and assistant round', () => {
  const round = inferLastGroupRound([
    { id: 4, role: 'assistant' },
    { id: 3, role: 'user' },
    { id: 2, role: 'assistant' },
  ]);
  assert.deepEqual(round, { startRawId: 3, endRawId: 4, type: 'user_round' });
});

test('includes consecutive aggregated user raws in the same round', () => {
  const round = inferLastGroupRound([
    { id: 8, role: 'assistant' },
    { id: 7, role: 'user' },
    { id: 6, role: 'user' },
    { id: 5, role: 'assistant' },
  ]);
  assert.deepEqual(round, { startRawId: 6, endRawId: 8, type: 'user_round' });
});

test('treats the latest assistant-only message as one background round', () => {
  const round = inferLastGroupRound([
    { id: 9, role: 'assistant' },
    { id: 8, role: 'assistant' },
    { id: 7, role: 'user' },
  ]);
  assert.deepEqual(round, { startRawId: 9, endRawId: 9, type: 'assistant_only' });
});

test('withdraws trailing user raws when the reply failed', () => {
  const round = inferLastGroupRound([
    { id: 12, role: 'user' },
    { id: 11, role: 'user' },
    { id: 10, role: 'assistant' },
  ]);
  assert.deepEqual(round, { startRawId: 11, endRawId: 12, type: 'user_round' });
});

test('returns null when there is no conversation history', () => {
  assert.equal(inferLastGroupRound([]), null);
});
