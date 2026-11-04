/** 纯时间运算：不调用模型，不改变睡眠长度，不用姓名推断共同活动身份。 */
export function minuteOf(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) return null;
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}
export const timeOf = minute => `${String(Math.floor((minute % 1440) / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export function intervals(activity) {
  const s = minuteOf(activity.startTime), e = minuteOf(activity.endTime);
  if (s === null || e === null || s === e) return [];
  return e < s ? [[s, 1440], ...(e ? [[0, e]] : [])] : [[s, e]];
}
export function overlaps(a, b) {
  return intervals(a).some(([s, e]) => intervals(b).some(([x, y]) => s < y && x < e));
}
export function assertCompleteDay(schedule) {
  const ranges = schedule.flatMap(intervals).sort((a, b) => a[0] - b[0]);
  if (!schedule.length || schedule.some(a => !intervals(a).length)) throw new Error('日程时间格式无效');
  let end = 0;
  for (const [s, e] of ranges) {
    if (s !== end) throw new Error(s < end ? '日程时间重叠' : '日程存在空档');
    end = e;
  }
  if (end !== 1440) throw new Error('日程未覆盖完整一天');
}

/** 共同活动使用唯一标准记录覆盖模型的文字变体；遇到睡眠冲突交给模型重试。 */
export function applySharedActivities(schedule, events, characterId) {
  let result = schedule.map(a => {
    const clean = { ...a };
    delete clean.sharedEventId; delete clean.participantIds; delete clean.cohabitationBatchId;
    delete clean.sharedStartTime; delete clean.sharedEndTime; delete clean.residence; delete clean.sleepOriginalDescription;
    return clean;
  });
  for (const event of events) {
    if (!event.participantIds.includes(Number(characterId))) continue;
    if (result.some(a => a.replyDelay === -1 && overlaps(a, event))) throw new Error(`共同活动「${event.activity}」与睡眠冲突`);
    for (const [start, end] of intervals(event)) {
      const kept = [];
      for (const act of result) {
        if (!intervals(act).some(([s, e]) => s < end && start < e)) { kept.push(act); continue; }
        for (const [s, e] of intervals(act)) {
          if (e <= start || s >= end) kept.push({ ...act, startTime: timeOf(s), endTime: timeOf(e) });
          else {
            if (s < start) kept.push({ ...act, startTime: timeOf(s), endTime: timeOf(start) });
            if (e > end) kept.push({ ...act, startTime: timeOf(end), endTime: timeOf(e) });
          }
        }
      }
      kept.push({ ...event, replyDelay: 0, startTime: timeOf(start), endTime: timeOf(end) });
      result = kept;
    }
  }
  return result.sort((a, b) => minuteOf(a.startTime) - minuteOf(b.startTime));
}

const placeKey = value => String(value || '').replace(/\s+/g, '').trim();
function sleepingAtHome(act, room) {
  return act.replyDelay === -1 && act.sleepAtHome !== false && placeKey(act.location) === placeKey(room.name);
}

/** 将各人的睡眠按同居室、同地点、同时睡眠的人员集合分段。输入 / 输出均为 id -> activities。 */
export function splitResidenceSleep(schedules, rooms, names = {}) {
  const output = Object.fromEntries(Object.entries(schedules).map(([id, acts]) => [id, acts.map(a => ({ ...a }))]));
  for (const room of rooms) {
    const ids = room.memberIds.filter(id => schedules[id]);
    const homeSleep = ids.flatMap(id => schedules[id].filter(a => sleepingAtHome(a, room))
      .flatMap(a => intervals(a).map(([start, end]) => ({ id, start, end }))));
    const boundaries = [...new Set(homeSleep.flatMap(a => [a.start, a.end]))].sort((a, b) => a - b);
    for (const id of ids) {
      const result = [];
      for (const act of schedules[id]) {
        if (act.replyDelay !== -1) { result.push({ ...act }); continue; }
        const original = act.sleepOriginalDescription ?? act.description;
        const base = { ...act, residence: room, sleepOriginalDescription: original };
        delete base.participantIds;
        if (!sleepingAtHome(act, room)) {
          result.push({ ...base, description: original, participantIds: [Number(id)] }); continue;
        }
        for (const [start, end] of intervals(act)) {
          const cuts = [start, ...boundaries.filter(t => start < t && t < end), end];
          for (let i = 0; i < cuts.length - 1; i++) {
            const s = cuts[i], e = cuts[i + 1];
            const participants = [...new Set(homeSleep.filter(p => p.start <= s && p.end >= e).map(p => Number(p.id)))].sort((a, b) => a - b);
            const label = participants.map(p => names[p] || `角色${p}`).join('、');
            const description = `${label}在${room.name}${participants.length > 1 ? '一起' : '独自'}睡觉。${original || ''}`;
            const last = result.at(-1);
            // 只合并同一原始睡眠描述、地点和参与者的相邻片段。
            if (last?.replyDelay === -1 && last.endTime === timeOf(s) && last.location === act.location
              && last.sleepOriginalDescription === original && JSON.stringify(last.participantIds) === JSON.stringify(participants)) {
              last.endTime = timeOf(e);
            } else result.push({ ...base, startTime: timeOf(s), endTime: timeOf(e), participantIds: participants, description });
          }
        }
      }
      output[id] = result.sort((a, b) => minuteOf(a.startTime) - minuteOf(b.startTime));
    }
  }
  return output;
}

/** 分段只是同睡人员改变：睡眠状态应持续到连续睡眠的真正结束。 */
export function continuousSleepEnd(schedule, activity) {
  let end = activity.endTime;
  const seen = new Set([activity]);
  while (true) {
    const next = schedule.find(a => a.replyDelay === -1 && a.startTime === end && !seen.has(a));
    if (!next) return end;
    seen.add(next); end = next.endTime;
  }
}
