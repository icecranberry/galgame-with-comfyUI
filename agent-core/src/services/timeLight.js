/**
 * 时间 + 光线描述生成器
 *
 * 供朋友圈、奇遇事件、聊天生图、瞄一眼等模块统一使用。
 * 按当前小时映射为中文时段描述 + 中文光线关键词，直接写进 prompt。
 */

const LIGHT_MAP = [
  // 注意：光线描述是"可选参考"而非"强制执行"。
  // 白天时段的光线实际受天气（晴/阴/雨）、场景（室内/室外/窗边）等因素影响很大，
  // 描述只给出该时段最典型的光线特征，不作为硬性约束。
  [[0, 5], '凌晨', '夜色昏暗，若有室外场景可出现冷调月光或暖黄路灯点缀；室内以低亮度暖色人工光源为主'],
  [[5, 7], '清晨', '室外可能是淡金晨光、薄雾或阴天灰调；室内窗边自然光与人工光混合，不强制统一色调'],
  [[7, 12], '上午', '室外日光清亮或阴天漫反射，室内以窗边散射自然光为主；光线氛围自由，不强制特定色温'],
  [[12, 13], '中午', '室外日照充足明亮，室内光线均匀；整体明亮通透即可，不强制顶光或深阴影'],
  [[13, 17], '下午', '室外阳光可能偏暖但光线柔和多变（晴/阴差异大），室内散射自然光为主；不强制金色调'],
  [[17, 19], '傍晚', '室外或呈暖调夕照或阴天灰蓝调，室内暖光与窗外暮色可能交织；不强制逆光或戏剧性光影'],
  [[19, 22], '晚上', '室外深蓝暮色或已全黑，室内以暖黄灯光、屏幕光、烛光等人造光源为主；氛围自由'],
  [[22, 24], '深夜', '深夜暗光环境，月光或路灯微光，沉静冷暗氛围（深夜色调较明确，可偏冷暗）'],
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

/**
 * 生成"光线参考提示"——用于注入生图 prompt 的 system 消息。
 * 与旧版"必须体现"不同，这里使用"参考"语气，并附带室内/室外、天气变化的免责说明。
 *
 * 格式示例：
 *   【当前时间与光线】现在是14:30（下午）。参考光线氛围：室外阳光可能偏暖...
 *   （注意：室内场景以人造光源为主，天气阴晴也会显著影响光线，不必严格遵守）
 *
 * @param {Date} [now]
 * @returns {string}
 */
export function getLightHint(now = new Date()) {
  const { timeStr, timeDesc, lightNote } = getTimeLight(now);
  return `【当前时间与光线】现在是${timeStr}（${timeDesc}）。参考光线氛围：${lightNote}（注意：此为室外自然光参考，室内场景以人造光源为主；阴晴雨雪天气也会显著影响实际光线，不必严格遵守）。`;
}
