import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const { config } = await import('../src/config.js');
config.dbPath = ':memory:';
const detector = await import('../src/services/appointmentDetector.js');
const { getLocalDateKey } = await import('../src/utils/localDate.js');

test('appointment regex hits immediate invitations and relative times', () => {
  assert.equal(detector.matchesAppointmentIntent('走，十分钟后下楼吃宵夜'), true);
  assert.equal(detector.matchesAppointmentIntent('半小时后见'), true);
  assert.equal(detector.matchesAppointmentIntent('明天晚上六点一起吃饭'), true);
  assert.equal(detector.matchesAppointmentIntent('约好下午三点见面'), true);
  assert.equal(detector.matchesAppointmentIntent('走吧，我们去江边'), true);
  assert.equal(detector.matchesAppointmentIntent('今晚一起去吃烧烤'), true);
});

test('appointment regex ignores plain chatter', () => {
  assert.equal(detector.matchesAppointmentIntent('你吃饭了吗'), false);
  assert.equal(detector.matchesAppointmentIntent('今天天气真不错'), false);
  assert.equal(detector.matchesAppointmentIntent('改天再约吧'), false);
  assert.equal(detector.matchesAppointmentIntent('你上次说那本书好看吗'), false);
});

test('resolveAppointmentDate handles explicit dates and 明天 wording', () => {
  const now = new Date('2026-09-19T12:00:00');
  const activity = { date: '2026-09-20', startTime: '18:00' };
  assert.equal(detector.resolveAppointmentDate(activity, now), '2026-09-20');
  assert.equal(detector.resolveAppointmentDate({ date: '明天' }, now), '2026-09-20');
  assert.equal(detector.resolveAppointmentDate({ date: '明晚' }, now), '2026-09-20');
  assert.equal(detector.resolveAppointmentDate({ date: '后天下午' }, now), '2026-09-21');
  // 缺省 / 无法识别 → 今天
  assert.equal(detector.resolveAppointmentDate({ startTime: '19:00' }, now), getLocalDateKey(now));
  assert.equal(detector.resolveAppointmentDate({ date: '随便什么时候' }, now), getLocalDateKey(now));
});
