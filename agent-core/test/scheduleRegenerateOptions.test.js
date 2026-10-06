import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`scheduleRegenerateOptions test forbids network: ${url}`); };

const { readScheduleOptions } = await import('../src/routes/schedule.js');

// 覆盖范围：日程弹窗请求体的解析守卫。
// 重点：**非法输入既不能抛错（→500），也不能被当成有效选项**；
//       什么都没传时必须返回 {}（调用方据此不产生约束层 = 行为与上线前一致）。

test('空请求体 / 无参数 → {}（不产生约束层）', () => {
  assert.deepEqual(readScheduleOptions({}), {});
  assert.deepEqual(readScheduleOptions(), {});
  assert.deepEqual(readScheduleOptions({ direction: '随便逛逛' }), {});
});

test('areas：非数组、空串、纯空白一律忽略，不抛错', () => {
  assert.deepEqual(readScheduleOptions({ areas: '二维市' }), {});
  assert.deepEqual(readScheduleOptions({ areas: 123 }), {});
  assert.deepEqual(readScheduleOptions({ areas: null }), {});
  assert.deepEqual(readScheduleOptions({ areas: [] }), {});
  assert.deepEqual(readScheduleOptions({ areas: ['', '  ', null, undefined] }), {});
});

test('areas：正常数组 → 带 areaStrict；areaStrict 只认真值', () => {
  const a = readScheduleOptions({ areas: ['二维市'], areaStrict: false });
  assert.deepEqual(a.areas, ['二维市']);
  assert.equal(a.areaStrict, false);
  assert.deepEqual(readScheduleOptions({ areas: ['二维市'], areaStrict: 1 }).areaStrict, true);
  // 去空白
  assert.deepEqual(readScheduleOptions({ areas: ['  二维市  '] }).areas, ['二维市']);
});

test('nsfwRatio：非数字忽略；0 必须被保留（不能被当成「没传」）', () => {
  assert.equal('nsfwRatio' in readScheduleOptions({ nsfwRatio: 'abc' }), false);
  assert.equal('nsfwRatio' in readScheduleOptions({ nsfwRatio: {} }), false);
  assert.equal('nsfwRatio' in readScheduleOptions({ nsfwRatio: null }), false);
  assert.equal('nsfwRatio' in readScheduleOptions({ nsfwRatio: '' }), false);
  // ★ 0 = 用户明确选「关闭」，必须保留
  assert.equal(readScheduleOptions({ nsfwRatio: 0 }).nsfwRatio, 0);
  assert.equal(readScheduleOptions({ nsfwRatio: '75' }).nsfwRatio, 75);
  assert.equal(readScheduleOptions({ nsfwRatio: 9999 }).nsfwRatio, 9999, '越界交给 nsfwBandOf 钳制，不在这里截断');
});

test('sleepType：只认登记过的键，非法值忽略', () => {
  assert.equal(readScheduleOptions({ sleepType: 'night_heavy' }).sleepType, 'night_heavy');
  assert.equal('sleepType' in readScheduleOptions({ sleepType: '__nope__' }), false);
  assert.equal('sleepType' in readScheduleOptions({ sleepType: '' }), false);
  assert.equal('sleepType' in readScheduleOptions({ sleepType: 'constructor' }), false, '原型链上的键不算已登记');
});
