/**
 * 时间 + 光线描述生成器
 *
 * 供朋友圈、奇遇事件、聊天生图、瞄一眼等模块统一使用。
 * 按当前小时映射为中文时段描述 + 中文光线关键词，直接写进 prompt。
 */

const LIGHT_MAP = [
  [[0, 5], '凌晨', '深黑夜色，微弱月光，低亮度暗光氛围'],
  [[5, 7], '清晨', '黎明晨光，柔和金色日出，长阴影，薄雾氛围'],
  [[7, 12], '上午', '明亮清透的上午光线，空气感，柔和的漫反射阴影'],
  [[12, 13], '中午', '强烈正午顶光，深而短的阴影'],
  [[13, 17], '下午', '温暖下午阳光，金色时刻临近，柔和的定向光，浓郁琥珀色调'],
  [[17, 19], '傍晚', '金色时刻，戏剧性长阴影，逆光光辉'],
  [[19, 22], '晚上', '傍晚环境光，室内暖光或室外蓝色暮光，柔和阴影，温馨氛围'],
  [[22, 24], '深夜', '深夜暗光环境，月光或路灯微光，沉静氛围'],
];

/**
 * @param {Date} [now]
 * @returns {{ timeStr: string, timeDesc: string, lightNote: string, hour: number }}
 */
export function getTimeLight(now = new Date()) {
  const hour = now.getHours();
  const timeStr = `${String(hour).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const entry = LIGHT_MAP.find(([r]) => hour >= r[0] && hour < r[1]);
  const timeDesc = entry?.[1] || '未知';
  const lightNote = entry?.[2] || 'natural lighting';
  return { timeStr, timeDesc, lightNote, hour };
}

/**
 * 生成旧版兼容格式的简单时间标签
 * [当前时间 周三 07/03 14:30]
 *
 * @param {Date} [now]
 * @returns {string}
 */
export function getTimeTag(now = new Date()) {
  const weekDay = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
  return `[当前时间 ${weekDay} ${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}]`;
}

/**
 * 生成带光线描述的时间标签（用于生图 prompt 场景）
 * [当前时间 周三 07/03 14:30 / 下午 — warm afternoon sunlight, ...]
 *
 * @param {Date} [now]
 * @returns {string}
 */
export function getTimeLightTag(now = new Date()) {
  const weekDay = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
  const dateStr = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
  const { timeStr, timeDesc, lightNote } = getTimeLight(now);
  return `[当前时间 ${weekDay} ${dateStr} ${timeStr} / ${timeDesc} — 光线：${lightNote}]`;
}
