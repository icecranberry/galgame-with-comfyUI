let batch = false;
const singles = new Set();
const busy = () => Object.assign(new Error('整轮日程正在准备，请完成后再修改日程'), { status: 409 });
export function isScheduleBatchRunning() { return batch; }
export function assertScheduleEditable() { if (batch) throw busy(); }
export function assertScheduleIdle(ids) {
  assertScheduleEditable();
  if (ids.some(id=>singles.has(id)||singles.has(Number(id)))) throw Object.assign(new Error('相关角色的日程仍在生成，请完成后再提交修改'),{status:409});
}
export function enterSingleSchedule(id) {
  assertScheduleEditable(); singles.add(id);
  return () => singles.delete(id);
}
export function enterScheduleBatch() {
  if (batch || singles.size) throw Object.assign(new Error('已有日程生成任务，请稍后再试'), { status: 409 });
  batch = true;
  return () => { batch = false; };
}
