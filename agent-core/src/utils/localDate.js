/** 本地日期键（YYYY-MM-DD）。
 * 传 timeZone 时按 IANA 时区取日（Intl en-CA 恒定输出 YYYY-MM-DD），
 * 供签运/奖池等「每日窗口」使用，不依赖浏览器或服务器操作系统时区（计划 §7.4）；
 * 不传时保持原行为（宿主本地时区）。 */
export function getLocalDateKey(date = new Date(), timeZone = '') {
  if (timeZone) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 把 `YYYY-MM-DD` 日期键前后平移若干天，仍返回日期键。
 *
 * ── 为什么需要它（2026-10-05 实测到的缺陷）──────────────────
 * 别用 SQL 的 `DATE('now','localtime', ?)` 去算日期间隔 —— 那是**另一套时间源**：
 *   日期键由 `getLocalDateKey()` 用 JS 的 Date 算，而 SQL 的 `now` 读真实时钟。
 *   两者在 **Date 被 mock（测试）/ 跨零点 / 时区差异** 下会不一致。
 * 真实事故：`snapshotTodaySchedule` 先用 JS 算出 `today` 写入快照，
 *   紧接着用 `DATE('now','-2 days')` 做清理 —— 当真实日期比 JS 日期快 3 天时，
 *   刚插入的当天快照被判成"过期两天以上"当场删掉（eventSchedule 整组 14 项测试失败）。
 *
 * 实现刻意只用 `Date.UTC` + `getUTC*`：**纯粹的日历算术**，
 * 不读本机时区、也不依赖"当前时间"，因此不受 fake timers 与时区影响。
 */
export function shiftDateKey(key, days) {
  const [y, m, d] = String(key || '').split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return key;
  const t = new Date(Date.UTC(y, m - 1, d) + Number(days || 0) * 86400000);
  const yy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(t.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
