// 与日程系统一致，使用宿主本地自然日；冻结任务启动时刻，避免跨日漂移。
export function backfillDay(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export function planBackfillTimes(now, random = Math.random) {
  const { start } = backfillDay(now);
  const count = random() < 0.5 ? 2 : 3;
  const span = now.getTime() - start.getTime();
  // 分层随机采样，避免几条动态挤在同一时段；永不写入未来时间。
  return Array.from({ length: count }, (_, i) =>
    new Date(start.getTime() + Math.floor(span * (i + random()) / count)));
}

export function activityAt(schedule, at) {
  const minute = at.getHours() * 60 + at.getMinutes();
  const minutes = value => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
  return schedule?.find(act => {
    const start = minutes(act.startTime), end = minutes(act.endTime);
    return start < end ? minute >= start && minute < end : minute >= start || minute < end;
  }) || null;
}
