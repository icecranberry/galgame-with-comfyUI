import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRoundMessageLimit,
  detectMentionAll,
  detectMentions,
} from '../src/services/groupChatEngine.js';

const members = [
  { id: 1, display_name: '小美' },
  { id: 2, display_name: '阿离' },
];

test('识别 @全体成员 / @所有人 / @全员 / @全体', () => {
  assert.equal(detectMentionAll('@全体成员 都出来说两句'), true);
  assert.equal(detectMentionAll('@所有人'), true);
  assert.equal(detectMentionAll('@ 全员 在吗'), true);
  assert.equal(detectMentionAll('那么 @全体 呢'), true);
});

test('普通发言与单人点名不会被误判成 @全体成员', () => {
  assert.equal(detectMentionAll('@小美 你怎么看'), false);
  assert.equal(detectMentionAll('大家晚安'), false);
  assert.equal(detectMentionAll('体全@'), false);
});

test('空值 / 非字符串不报错', () => {
  assert.equal(detectMentionAll(''), false);
  assert.equal(detectMentionAll(null), false);
  assert.equal(detectMentionAll(undefined), false);
  assert.equal(detectMentionAll(123), false);
});

test('@全体成员 与单人点名可共存，单人口径不变', () => {
  const text = '@全体成员 @小美 先说你';
  assert.equal(detectMentionAll(text), true);
  assert.deepEqual(detectMentions(text, members).map(m => m.display_name), ['小美']);
});

test('普通轮的消息上限维持原口径', () => {
  const group = { members: [{ id: 1 }, { id: 2 }] };
  assert.equal(computeRoundMessageLimit(group, {}), 9);
  assert.equal(computeRoundMessageLimit(group, { hasTopicSeed: true }), 12);
});

test('@全体成员 轮的消息上限不低于群人数', () => {
  const group = {
    members: Array.from({ length: 25 }, (_, i) => ({ id: i + 1, display_name: `角色${i + 1}` })),
  };
  assert.equal(computeRoundMessageLimit(group, {}), 18);
  assert.equal(computeRoundMessageLimit(group, { minMessages: group.members.length }), 25);
});
