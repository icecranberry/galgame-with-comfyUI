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
