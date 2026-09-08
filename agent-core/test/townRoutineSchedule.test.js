import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRoutineSlot } from '../src/services/town/routineSchedule.js';
const at = time => Date.parse(`2026-09-08T${time}:00+08:00`);

test('NPC 作息与聊天共用跨午夜、24:00及指定时区语义', () => {
  const night = { start: '23:00', end: '02:00', activity: '值夜班' };
  assert.equal(findRoutineSlot([night], at('01:59')), night);
  assert.equal(findRoutineSlot([night], at('02:00')), null);
  assert.equal(findRoutineSlot([night], at('23:00')), night);
  const day = { start: '00:00', end: '24:00' };
  assert.equal(findRoutineSlot([day], at('00:00')), day);
  assert.equal(findRoutineSlot([day], at('23:59')), day);
  assert.equal(findRoutineSlot([night], at('07:30'), { timeZone: 'UTC' }), night);
});

test('夜猫偏移跨日，非法或零长窗口不会误匹配', () => {
  const night = { start: '23:00', end: '02:00' };
  assert.equal(findRoutineSlot([night], at('00:30'), { offsetMinutes: 90 }), night);
  assert.equal(findRoutineSlot([night], at('03:30'), { offsetMinutes: 90 }), null);
  for (const invalid of [{ start: 'xx', end: '24:00' }, { start: '10:80', end: '24:00' }, { start: '24:00', end: '02:00' }, { start: '02:00', end: '02:00' }]) {
    assert.equal(findRoutineSlot([invalid], at('03:00')), null);
  }
});
