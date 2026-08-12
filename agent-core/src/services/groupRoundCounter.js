/**
 * 群聊轮数统计：一轮 = 一条已完成的 assistant raw。
 * 用户触发、主动发起、冷场续聊都同样算一轮，不区分是否用户参与。
 */
export function countCompletedGroupRounds(rows) {
  return rows.filter(row => row.role === 'assistant' && String(row.content || '').trim() !== '').length;
}
