import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitResidenceSleep, continuousSleepEnd, intervals, assertCompleteDay, applySharedActivities, overlaps } from '../src/services/cohabitationSchedule.js';
const awake = (startTime, endTime) => ({ startTime, endTime, activity: '清醒活动', location: '街区', replyDelay: 0, description: '自由安排。' });
const sleep = (startTime, endTime, location = '一号居室') => ({ startTime, endTime, activity: '睡眠', location, replyDelay: -1, description: '安稳睡眠。' });
const room = { id: 1, name: '一号居室', memberIds: [1, 2] };
const duration = acts => acts.filter(a => a.replyDelay === -1).flatMap(intervals).reduce((n, [s, e]) => n + e - s, 0);

test('跨午夜同睡按真实交集切分，连续睡眠不在同睡人员切换时结束', () => {
  const original = { 1: [awake('06:00', '22:00'), sleep('22:00', '06:00')], 2: [sleep('00:00', '08:00'), awake('08:00', '00:00')] };
  const result = splitResidenceSleep(original, [room], { 1: '甲', 2: '乙' });
  assertCompleteDay(result[1]); assertCompleteDay(result[2]);
  assert.equal(duration(result[1]), 480); assert.equal(duration(result[2]), 480);
  assert.deepEqual(result[1].filter(a => a.replyDelay === -1).map(a => [a.startTime, a.endTime, a.participantIds]), [['00:00', '06:00', [1, 2]], ['22:00', '00:00', [1]]]);
  assert.deepEqual(result[2].filter(a => a.replyDelay === -1).map(a => [a.startTime, a.endTime, a.participantIds]), [['00:00', '06:00', [1, 2]], ['06:00', '08:00', [2]]]);
  assert.equal(continuousSleepEnd(result[1], result[1].find(a => a.startTime === '22:00')), '06:00');
  assert.equal(continuousSleepEnd(result[2], result[2][0]), '08:00');
  assert.deepEqual(splitResidenceSleep(result, [room], { 1: '甲', 2: '乙' }), result, '重复计算幂等，不重复追加描述');
});

test('同居但外宿或异地补觉不算同睡；不同居室同名地点不串组', () => {
  const schedules = { 1: [sleep('00:00', '08:00'), awake('08:00', '00:00')], 2: [sleep('00:00', '08:00', '医院值班室'), awake('08:00', '00:00')], 3: [sleep('00:00', '08:00'), awake('08:00', '00:00')] };
  const result = splitResidenceSleep(schedules, [room, { id: 2, name: room.name, memberIds: [3] }]);
  assert.deepEqual(result[1][0].participantIds, [1]); assert.deepEqual(result[2][0].participantIds, [2]); assert.deepEqual(result[3][0].participantIds, [3]);
});

test('三人错峰午睡保持每人的睡眠总时长', () => {
  const schedules = { 1: [awake('00:00', '12:00'), sleep('12:00', '14:00'), awake('14:00', '00:00')],
    2: [awake('00:00', '13:00'), sleep('13:00', '15:00'), awake('15:00', '00:00')],
    3: [awake('00:00', '13:30'), sleep('13:30', '14:30'), awake('14:30', '00:00')] };
  const result = splitResidenceSleep(schedules, [{ ...room, memberIds: [1, 2, 3] }]);
  for (const id of [1, 2, 3]) { assertCompleteDay(result[id]); assert.equal(duration(result[id]), duration(schedules[id])); }
  assert.deepEqual(result[1].find(a => a.startTime === '13:30').participantIds, [1, 2, 3]);
});

test('共同活动覆盖文案变体并精确插入清醒时间，拒绝覆盖睡眠', () => {
  const schedule = [sleep('00:00', '08:00'), awake('08:00', '00:00')];
  const event = { ...awake('14:00', '15:00'), activity: '一起喝咖啡', sharedEventId: 'x', participantIds: [1, 2] };
  const result = applySharedActivities(schedule, [event], 1);
  assertCompleteDay(result); assert.equal(result.find(a => a.sharedEventId === 'x').activity, event.activity);
  assert.throws(() => applySharedActivities(schedule, [{ ...event, startTime: '07:00', endTime: '09:00' }], 1), /睡眠冲突/);
  assert.equal(overlaps({ startTime: '23:00', endTime: '02:00' }, { startTime: '01:00', endTime: '03:00' }), true);
  assert.equal(overlaps(event, { startTime: '15:00', endTime: '16:00' }), false);
});
