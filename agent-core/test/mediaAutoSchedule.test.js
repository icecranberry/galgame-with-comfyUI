import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => { throw new Error(`mediaAutoSchedule test forbids network: ${url}`); };

const {
  MEDIA_AUTO_STEPS, ALLOWED_MEDIA_AUTO_VALUES, AUTO_BATCH_SIZE,
  MEDIA_NIGHT_START_HOUR, MEDIA_NIGHT_END_HOUR, MEDIA_MIN_GAP_MS,
  nightWindowFor, isWithinNightWindow, nextAutoAt,
} = await import('../src/services/mediaService.js');

/**
 * 自动抓帖排期（2026-10-05 由「固定间隔」改为「每晚几批 + 夜间窗口内错峰随机」）。
 *
 * 这组测试钉住四件事：
 *   ① 档位表是「每晚几批」的形状（不再是分钟），且默认档 = 关闭；
 *   ② 夜间窗口跨午夜算得对（20:00→次日 02:00），且白天不落在窗口内；
 *   ③ `nextAutoAt` **永远落在某个夜间窗口内**、与 now 至少隔 MIN_GAP；
 *   ④ 长期平均批数 ≈ 档位值（"错峰随机"不能退化成"一晚零批"或"一晚几十批"）。
 */

const H = 3600_000;
/** 造一个本地时间的时间戳（避免用 UTC 字符串，测的就是本地时区语义） */
const local = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

test('档位表是「每晚几批」：0=关闭在最前，值都是正数且递增，上限 16', () => {
  assert.ok(MEDIA_AUTO_STEPS.length >= 5);
  assert.equal(MEDIA_AUTO_STEPS[0].value, 0, '第一档必须是「关闭」（长驻功能默认关）');
  assert.equal(MEDIA_AUTO_STEPS[0].label, '关闭');
  for (const s of MEDIA_AUTO_STEPS.slice(1)) {
    assert.ok(Number.isInteger(s.value) && s.value > 0, `档位 ${s.label} 的值应为正数`);
    assert.ok(typeof s.label === 'string' && s.label.includes('晚'), `档位文案应说清"每晚几批"：${s.label}`);
    assert.ok(typeof s.hint === 'string' && s.hint.length > 0);
  }
  const vals = MEDIA_AUTO_STEPS.map(s => s.value);
  assert.deepEqual(vals, [...vals].sort((a, b) => a - b), '档位应按"越靠后越频繁"排列');
  assert.equal(Math.max(...vals), 16, '最快档应为每晚 16 批');
  assert.deepEqual(ALLOWED_MEDIA_AUTO_VALUES, vals);
});

test('★ 每批只出 1 条（用户口径：一次生成不要太多帖子）', () => {
  assert.equal(AUTO_BATCH_SIZE, 1);
});

test('nightWindowFor：20:00 之后 = 今晚窗口（跨午夜到次日 02:00）', () => {
  const { start, end } = nightWindowFor(local(2026, 10, 5, 21, 30));
  assert.equal(start, local(2026, 10, 5, MEDIA_NIGHT_START_HOUR));
  assert.equal(end, local(2026, 10, 6, MEDIA_NIGHT_END_HOUR));
  assert.equal((end - start) / H, 6, '窗口应为 6 小时');
});

test('nightWindowFor：凌晨 02:00 之前仍属于"昨晚开始"的窗口', () => {
  const { start, end } = nightWindowFor(local(2026, 10, 6, 1, 10));
  assert.equal(start, local(2026, 10, 5, MEDIA_NIGHT_START_HOUR), '起点应回到前一天 20:00');
  assert.equal(end, local(2026, 10, 6, MEDIA_NIGHT_END_HOUR));
});

test('nightWindowFor：白天返回"即将到来"的窗口（今晚 20:00 起）', () => {
  for (const h of [2, 8, 12, 19]) {
    const { start, end } = nightWindowFor(local(2026, 10, 5, h, 0));
    assert.equal(start, local(2026, 10, 5, MEDIA_NIGHT_START_HOUR), `${h} 点应指向今晚 20:00`);
    assert.equal(end, local(2026, 10, 6, MEDIA_NIGHT_END_HOUR));
  }
});

test('isWithinNightWindow：窗口内 true、白天 false（边界按左闭右开）', () => {
  assert.equal(isWithinNightWindow(local(2026, 10, 5, 20, 0)), true, '20:00 整应算窗口内');
  assert.equal(isWithinNightWindow(local(2026, 10, 5, 23, 59)), true);
  assert.equal(isWithinNightWindow(local(2026, 10, 6, 1, 59)), true);
  assert.equal(isWithinNightWindow(local(2026, 10, 6, 2, 0)), false, '02:00 整应已出窗口');
  assert.equal(isWithinNightWindow(local(2026, 10, 5, 19, 59)), false, '20:00 之前仍在白天');
  assert.equal(isWithinNightWindow(local(2026, 10, 5, 12, 0)), false);
});

test('★ nextAutoAt：结果永远落在某个夜间窗口内，且与 now 至少隔 MIN_GAP', () => {
  // 扫一整天 × 多个起始时刻 × 固定随机序列，逐点验证不变量
  const seq = [0, 0.13, 0.37, 0.5, 0.71, 0.93, 1 - 1e-9];
  let i = 0;
  const rand = () => seq[(i++) % seq.length];

  for (let h = 0; h < 24; h++) {
    for (const perNight of [1, 2, 4, 8, 16]) {
      const now = local(2026, 10, 5, h, 17);
      const t = nextAutoAt(now, perNight, rand);
      assert.ok(t > now, `h=${h} n=${perNight}：下次时刻必须在将来`);
      assert.ok(t - now >= MEDIA_MIN_GAP_MS, `h=${h} n=${perNight}：间隔不足最小间隔`);
      assert.ok(isWithinNightWindow(t), `h=${h} n=${perNight}：下次时刻落在窗口外（${new Date(t).toLocaleString()}）`);
    }
  }
});

test('★ nextAutoAt：一晚**恰好**出 perNight 批（多跑几轮验证稳定，不随机会漂）', () => {
  for (const perNight of [1, 2, 4, 8, 16]) {
    for (let round = 0; round < 6; round++) {
      // 从 19:00（窗口外）起反复到点即排下一次，统计到次日 02:30 为止能抓几批
      let t = local(2026, 10, 5, 19, 0);
      const deadline = local(2026, 10, 6, 2, 30);
      let count = 0;
      let guard = 0;
      while (guard++ < 900) {
        t = nextAutoAt(t, perNight);
        if (t >= deadline) break;
        count++;
      }
      assert.equal(count, perNight,
        `每晚 ${perNight} 批时实际抓到 ${count} 批（第 ${round + 1} 轮）—— 必须恰好等于档位值`);
    }
  }
});

test('nextAutoAt：从窗口中途起步时，只出剩下那几批（不会补跑已过去的格）', () => {
  // 23:00 起（窗口 20:00~02:00、每晚 4 批 → 格长 1.5h）：已过 2 格，剩 2 格
  let t = local(2026, 10, 5, 23, 0);
  const deadline = local(2026, 10, 6, 2, 30);
  let count = 0; let guard = 0;
  while (guard++ < 100) {
    t = nextAutoAt(t, 4);
    if (t >= deadline) break;
    count++;
  }
  assert.equal(count, 2, `23:00 起步应只剩 2 批，实际 ${count}`);
});

test('nextAutoAt：本窗口已放不下时顺延到下一个窗口（而不是硬塞回来）', () => {
  // 01:55（离窗口结束只剩 5 分钟）→ 下一次必然落到"今晚 20:00"那个窗口
  const now = local(2026, 10, 6, 1, 55);
  const t = nextAutoAt(now, 4, () => 0.5);
  assert.ok(t > now);
  const win = nightWindowFor(t);
  assert.equal(win.start, local(2026, 10, 6, MEDIA_NIGHT_START_HOUR), '应落到 10-06 晚的窗口');
  assert.ok(t - now > 5 * H, '不应在几分钟内就再来一批');
});
