import { createHash } from 'node:crypto';
import { config } from '../config.js';

let revision = 0, forecastGeneration = 0;
export function getWeatherSourceKey(city) {
  const name = typeof city === 'string' ? city.trim() : '';
  return `weather:v1:${createHash('sha256').update(JSON.stringify(name ? ['city', name] : ['auto'])).digest('hex')}`;
}
export function notifyWeatherSourceChange(previous, next) {
  if (getWeatherSourceKey(previous) !== getWeatherSourceKey(next)) revision++;
}
export function captureWeatherSource() {
  return Object.freeze({ sourceKey: getWeatherSourceKey(config.weather.city), revision });
}
const stale = () => Object.assign(new Error('天气来源或请求已变化，已丢弃旧结果'), { code: 'WEATHER_SOURCE_STALE' });
export function assertWeatherSourceCurrent(source) {
  const current = captureWeatherSource();
  if (!source || source.sourceKey !== current.sourceKey || source.revision !== current.revision) throw stale();
}
export function beginWeatherForecastRequest() {
  return Object.freeze({ ...captureWeatherSource(), generation: ++forecastGeneration });
}
export function assertWeatherForecastCurrent(request) {
  assertWeatherSourceCurrent(request);
  if (request.generation !== forecastGeneration) throw stale();
}
