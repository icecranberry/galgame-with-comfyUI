/**
 * 时间 + 光线描述生成器
 *
 * 供朋友圈、奇遇事件、聊天生图、瞄一眼等模块统一使用。
 * 按当前小时映射为中文时段描述 + 中文光线关键词，直接写进 prompt。
 * 同时读取 weather_hourly 表数据，融合天气信息丰富光线描述。
 */

import { getDb } from '../db/index.js';
import { config } from '../config.js';

const LIGHT_MAP = [
  // [时间范围], 时段名, 无天气全量描述（室外+室内）, 有天气时仅室内描述
  [[0, 5], '凌晨', '夜色昏暗，若有室外场景可出现冷调月光或暖黄路灯点缀；如果醒着，室内场景以低亮度暖色人工光源为主，如果睡觉，房间里没有灯光',
    '若有室内场景以低亮度暖色人工光源为主'],
  [[5, 7], '清晨', '室外可能是淡金晨光、薄雾或阴天灰调；室内场景以窗边自然光与人工光混合',
    '若有室内场景以窗边自然光与人工光混合'],
  [[7, 12], '上午', '室外日光清亮或阴天漫反射，室内场景以窗边散射自然光为主',
    '若有室内场景以窗边散射自然光为主'],
  [[12, 13], '中午', '室外日照充足明亮，室内场景光线均匀、明亮通透',
    '若有室内场景光线均匀、明亮通透'],
  [[13, 17], '下午', '室外阳光可能偏暖但光线柔和多变（晴/阴差异大），室内场景以散射自然光为主',
    '若有室内场景以散射自然光为主'],
  [[17, 19], '傍晚', '室外或呈暖调夕照或阴天灰蓝调，室内场景暖光与窗外暮色可能交织',
    '若有室内场景暖光与窗外暮色可能交织'],
  [[19, 22], '晚上', '室外深蓝暮色或已全黑，室内场景以暖黄灯光、屏幕光、烛光等人造光源为主',
    '若有室内场景以暖黄灯光、屏幕光、烛光等人造光源为主'],
  [[22, 24], '深夜', '深夜暗光环境，月光或路灯微光，沉静冷暗氛围（深夜色调较明确，可偏冷暗）',
    '若有室内场景以暗光为主'],
];

// 天气→光线修饰。QWeather v7 天气文本 → 对画面光线的影响描述。
const WEATHER_LIGHT_MOD = {
  '晴': '阳光充足、光影分明、色调偏暖',
  '少云': '阳光充足、有少量云影',
  '晴间多云': '阳光与云影交替、光线多变',
  '多云': '云层较多、厚薄不一，光线柔和偏散，阴影较淡',
  '阴': '天色灰暗阴沉、光线平淡无强烈明暗对比，整体偏灰',
  '小雨': '天色阴沉、地面潮湿有微弱反光、远处景物稍朦胧',
  '中雨': '天色阴暗、雨幕可见、光线昏暗、远景模糊',
  '大雨': '天色昏暗、雨势较大影响能见度、地面有明显水花',
  '暴雨': '天色极为昏暗、雨势猛烈、能见度低、氛围压抑',
  '大暴雨': '天色漆黑如夜、暴雨倾盆、能见度极低',
  '特大暴雨': '天色漆黑、雨势灾难级、能见度极低',
  '阵雨': '时晴时雨、光线变化频繁、地面偶有潮湿反光',
  '雷阵雨': '天色阴沉、偶有闪电亮光、氛围紧张',
  '雷阵雨伴有冰雹': '天色阴沉、闪电亮光与冰雹敲击、氛围紧张',
  '冻雨': '天色阴沉、地面冰壳反射冷光',
  '雨夹雪': '天色阴沉、雨雪混合、地面湿滑有微弱反光',
  '小雪': '天色偏白、地面薄雪轻微反光、氛围清冷',
  '中雪': '天色灰白、积雪较厚反射冷调白光',
  '大雪': '天色暗白、积雪深厚、整体偏亮偏冷',
  '暴雪': '天色暗白、积雪极厚、高反差冷调',
  '雪': '天色灰白、积雪反光使环境偏亮偏冷',
  '雾': '能见度低、光线朦胧散射、远近景物柔化、氛围朦胧柔和',
  '霾': '能见度降低、光线昏黄浑浊、远景发灰',
  '扬沙': '天色昏黄、光线浑浊、能见度下降',
  '浮尘': '天色灰黄、光线暗淡、能见度下降',
  '沙尘暴': '天色昏黄极暗、能见度极低、光线浑浊',
  '强沙尘暴': '天色昏黑、能见度极低、光线极为浑浊',
};

// 天气大类归一（用于粗略兼容）
function _normalizeWeather(text) {
  if (!text) return null;
  if (text.includes('暴雨') || text.includes('大暴雨') || text.includes('特大暴雨')) return '暴雨';
  if (text.includes('大雨') || text.includes('中到大雨') || text.includes('大到暴雨')) return '大雨';
  if (text.includes('中雨') || text.includes('小到中雨')) return '中雨';
  if (text.includes('小雨')) return '小雨';
  if (text.includes('雷阵雨伴有冰雹')) return '雷阵雨伴有冰雹';
  if (text.includes('阵雨') || text.includes('雷阵雨')) return text.startsWith('雷阵') ? '雷阵雨' : '阵雨';
  if (text.includes('沙尘暴') || text.includes('强沙尘暴')) return '沙尘暴';
  if (text.includes('暴雪')) return '暴雪';
  if (text.includes('大雪')) return '大雪';
  if (text.includes('中雪')) return '中雪';
  if (text.includes('小雪')) return '小雪';
  if (text.includes('雪') || text.includes('雨夹雪') || text.includes('冻雨')) return text;
  if (text.includes('雾')) return '雾';
  if (text.includes('霾')) return '霾';
  if (text.includes('扬沙') || text.includes('浮尘') || text.includes('沙尘')) return '扬沙';
  if (text.includes('多云') || text.includes('少云') || text.includes('晴间多云')) return text;
  if (text.includes('阴')) return '阴';
  if (text.includes('晴')) return '晴';
  return text;
}

/**
 * 从 weather_hourly 表读取当前小时的天气
 * @param {number} hour 0-23
 * @returns {{ weather: string, temperature: string, windSpeed: string } | null}
 */
export function getCurrentWeather(hour) {
  if (!config.features.weather) return null;
  try {
    const db = getDb();
    const timeStr = `${String(hour).padStart(2, '0')}:00`;
    const row = db.prepare(
      'SELECT weather_text, temperature, wind_speed FROM weather_hourly WHERE weather_time = ?'
    ).get(timeStr);
    if (!row) return null;
    return { weather: row.weather_text, temperature: row.temperature, windSpeed: row.wind_speed };
  } catch {
    return null;
  }
}

/**
 * 获取当前小时的天气光线修饰词（仅返回天气对光线的影响描述，不含时间信息）
 * @param {number} hour 0-23
 * @returns {string} 天气光线描述，没有数据则返回空字符串
 */
export function getWeatherLightNote(hour) {
  const w = getCurrentWeather(hour);
  if (!w || !w.weather) return '';
  const norm = _normalizeWeather(w.weather);
  return WEATHER_LIGHT_MOD[norm] || '';
}

/**
 * 获取天气紧凑描述（不含光线修饰），供需要自定义格式的调用方拼积木。
 * 示例："天气：晴、挺热、微风"，无数据返回空字符串。
 * @param {number} hour 0-23
 * @returns {string}
 */
export function getWeatherClause(hour) {
  const weather = getCurrentWeather(hour);
  if (!weather || !weather.weather) return '';
  const weatherLight = getWeatherLightNote(hour);
  const parts = [weather.weather];
  if (weather.temperature) parts.push(weather.temperature);
  if (weather.windSpeed) parts.push(weather.windSpeed);
  if (weatherLight) parts.push(weatherLight);
  return `天气：${parts.join('、')}`;
}

/**
 * 内联时间+天气+光线从句，自然语言，同时说明室内外光线。
 * 示例（含天气）："现在是14:30，夏日下午时分。外面多云、挺热，光线柔和偏散。室内散射自然光为主"
 * 示例（无天气）："现在是14:30，夏日下午时分。室外阳光可能偏暖但光线柔和多变（晴/阴差异大），室内散射自然光为主"
 * @param {Date} [now]
 * @returns {string}
 */
export function getTimeLightInline(now = new Date()) {
  const { timeStr, timeDesc, lightNote, lightNoteIndoor, hour } = getTimeLight(now);
  const season = getSeason(now.getMonth() + 1);
  const weather = getCurrentWeather(hour);
  if (weather && weather.weather) {
    const weatherLight = getWeatherLightNote(hour);
    const parts = [weather.weather];
    if (weather.temperature) parts.push(weather.temperature);
    if (weather.windSpeed) parts.push(weather.windSpeed);
    if (weatherLight) parts.push(weatherLight);
    return `现在是${timeStr}，${season}日的${timeDesc}时分。外面${parts.join('、')}。${lightNoteIndoor}`;
  }
  return `现在是${timeStr}，${season}日的${timeDesc}时分。${lightNote}`;
}

/**
 * 紧凑天气+光线描述，仅当有天气数据时返回，否则空串。
 * 示例："外面多云、挺热，光线柔和偏散。室外阳光可能偏暖但光线柔和多变，室内散射自然光为主"
 * @param {Date} [now]
 * @returns {string}
 */
export function getLightNoteWithWeather(now = new Date()) {
  const { lightNoteIndoor, hour } = getTimeLight(now);
  const weather = getCurrentWeather(hour);
  if (!weather || !weather.weather) return '';
  const weatherLight = getWeatherLightNote(hour);
  const parts = [weather.weather];
  if (weather.temperature) parts.push(weather.temperature);
  if (weather.windSpeed) parts.push(weather.windSpeed);
  if (weatherLight) parts.push(weatherLight);
  return `外面${parts.join('、')}。${lightNoteIndoor}`;
}

/**
 * @param {Date} [now]
 * @returns {{ timeStr: string, timeDesc: string, lightNote: string, lightNoteIndoor: string, hour: number }}
 */
export function getTimeLight(now = new Date()) {
  const hour = now.getHours();
  const timeStr = `${String(hour).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const entry = LIGHT_MAP.find(([r]) => hour >= r[0] && hour < r[1]);
  const timeDesc = entry?.[1] || '未知';
  const lightNote = entry?.[2] || 'natural lighting';
  const lightNoteIndoor = entry?.[3] || '室内场景以灯光为主';
  return { timeStr, timeDesc, lightNote, lightNoteIndoor, hour };
}

/**
 * 生成时间标签（用于主聊天流）含季节和天气。
 * [当前时间 周三 07/03 14:30 / 夏日下午 — 多云、挺热]
 * @param {Date} [now]
 * @param {boolean} [needWeather=true] 是否附加天气
 * @returns {string}
 */
export function getTimeTag(now = new Date(), needWeather = true) {
  const weekDay = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
  const dateStr = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const { timeDesc } = getTimeLight(now);
  const season = getSeason(now.getMonth() + 1);
  const weather = needWeather ? getCurrentWeather(now.getHours()) : null;
  if (weather && weather.weather) {
    const wParts = [weather.weather];
    if (weather.temperature) wParts.push(weather.temperature);
    return `[当前时间 ${weekDay} ${dateStr} ${timeStr} / ${season}${timeDesc} — ${wParts.join('、')}]`;
  }
  return `[当前时间 ${weekDay} ${dateStr} ${timeStr} / ${season}${timeDesc}]`;
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
  const { timeStr, timeDesc } = getTimeLight(now);
  const season = getSeason(now.getMonth() + 1);
  const weather = getCurrentWeather(now.getHours());
  if (weather && weather.weather) {
    const parts = [weather.weather];
    if (weather.temperature) parts.push(weather.temperature);
    return `[当前时间 ${weekDay} ${dateStr} ${timeStr} / ${season}${timeDesc} — 外面${parts.join('、')}]`;
  }
  return `[当前时间 ${weekDay} ${dateStr} ${timeStr} / ${season}${timeDesc}]`;
}

/**
 * 根据月份获取季节
 * @param {number} month 1-12
 * @returns {'春'|'夏'|'秋'|'冬'}
 */
export function getSeason(month) {
  if (month >= 3 && month <= 5) return '春';
  if (month >= 6 && month <= 8) return '夏';
  if (month >= 9 && month <= 11) return '秋';
  return '冬';
}

/**
 * 光线参考提示——作为系统背景环境设定，同时说明室内外光线。
 * 示例（含天气）："夏日下午时分。外面多云、挺热，光线柔和偏散。室内散射自然光为主"
 * 示例（无天气）："夏日下午时分。室外阳光可能偏暖但光线柔和多变（晴/阴差异大），室内散射自然光为主"
 *
 * @param {Date} [now]
 * @returns {string}
 */
export function getLightHint(now = new Date()) {
  const { timeDesc, lightNote, lightNoteIndoor, hour } = getTimeLight(now);
  const season = getSeason(now.getMonth() + 1);
  const weather = getCurrentWeather(hour);

  if (weather && weather.weather) {
    const weatherLight = getWeatherLightNote(hour);
    const parts = [weather.weather];
    if (weather.temperature) parts.push(weather.temperature);
    if (weather.windSpeed) parts.push(weather.windSpeed);
    if (weatherLight) parts.push(weatherLight);
    return `${season}日的${timeDesc}时分。外面${parts.join('、')}。${lightNoteIndoor}`;
  }

  return `${season}日的${timeDesc}时分。${lightNote}`;
}
