import test from 'node:test';
import assert from 'node:assert/strict';
import { formatGroupUserMessage, parseScriptLine } from '../src/services/groupChatEngine.js';

test('group user messages use a read-only marker distinct from character dialogue', () => {
  assert.equal(
    formatGroupUserMessage('[小冰]: 大家晚上好', '小冰'),
    '<user_message read_only="true">\n大家晚上好\n</user_message>',
  );
  assert.equal(
    formatGroupUserMessage('<user_message read_only="true">\n已经标记\n</user_message>', '小冰'),
    '<user_message read_only="true">\n已经标记\n</user_message>',
  );
});

test('group parser rejects dialogue attributed to a non-member', () => {
  const member = { id: 1, display_name: '甲' };
  const members = new Map([['甲', member]]);

  assert.equal(parseScriptLine('小冰: 这是模型模仿的用户发言', members), null);
  assert.deepEqual(parseScriptLine('甲: 这是角色发言', members), {
    speaker: member,
    text: '这是角色发言',
  });
});
