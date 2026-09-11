import { getDb } from '../db/index.js';
import { replaceWeatherHourlyCache } from './weatherHourlyCache.js';
import { captureWeatherSource, assertWeatherSourceCurrent, beginWeatherForecastRequest, assertWeatherForecastCurrent } from './weatherSource.js';
import { config } from '../config.js';
import { getTimeLight } from './timeLight.js';
import * as jose from 'jose';

const _a = '5a55721f1d70713031111260607d21390b771079712e55721f1d1f3e3a3b6b71716375003a0e6b747906210f1d7179777d3b101c6b42451b240967706a427d4517256174007d1c361e547f40775c0036195675421500666a51627c3572721f1d1f1932361b1260607d21390b771079712e55721f1d1f';
const _b = 'wx_2024';

function _d(h) {
  const kb = Buffer.from(_b, 'utf8');
  const buf = Buffer.from(h, 'hex');
  for (let i = 0; i < buf.length; i++) buf[i] ^= kb[i % kb.length];
  return buf.toString('utf8');
}

const _p   = _d('45350b75676375453f14');
const _k           = _d('233a0f637b700631320f');
const _u       = _d('1f0c2b4243081b58162b075b5a4c101269451e40515909285751465c120a3e42591c5718157055555d1b014a705159464d5814305d5b4744');
const _v   = _d('1f0c2b4243081b58162b075b5a4c101269451e40515909285751465c120a3e42591c5718157044071d4312192b5a55401b454c37');
const _w  = _d('93c0d5d48585');
const _z = 60 * 60 * 1000;

let timer = null;
let startupTimer = null;
let schedulerRunning = false;
let schedulerGeneration = 0;
let processing = false;
let resolvedCity = null;

function tempLabel(celsius) {
  if (celsius <= -20) return '冻死人';
  if (celsius <= -10) return '特别冷';
  if (celsius <= 0)   return '很冷';
  if (celsius <= 8)   return '有点冷';
  if (celsius <= 18)  return '刚刚好';
  if (celsius <= 25)  return '挺舒服';
  if (celsius <= 30)  return '有点热';
  if (celsius <= 35)  return '挺热';
  if (celsius <= 39)  return '热死了';
  return '要热得融化了';
}

function beaufortLabel(kmh) {
  if (kmh < 2)   return '没什么风';
  if (kmh <= 8)  return '风很小';
  if (kmh <= 20) return '微风';
  if (kmh <= 35) return '有点风';
  if (kmh <= 50) return '风挺大';
  if (kmh <= 70) return '大风';
  if (kmh <= 90) return '风特别大';
  return '风大得吓人';
}

async function resolveCityByIP() {
  try {
    const resp = await fetch('http://ip-api.com/json?fields=city,country,countryCode,lat,lon,proxy,hosting', { signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      const data = await resp.json();
      if (data.proxy || data.hosting) {
        console.log('[weather] proxy/VPN detected via IP, falling back');
        return null;
      }
      return { city: data.city, country: data.country, lat: data.lat, lon: data.lon, source: 'ip' };
    }
  } catch {}

  try {
    const resp = await fetch('https://myip.ipip.net', { signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      const text = await resp.text();
      const m = text.match(/来自于：(.+)/);
      if (m) {
        const parts = m[1].trim().split(/\s+/);
        const city = parts[2] || parts[1] || '';
        if (city) return { city: city.replace(/市$/, ''), country: '中国', source: 'ip' };
      }
    }
  } catch {}

  return null;
}

function saveLocation(loc) {
  const db = getDb();
  try {
    const stmt = db.prepare('INSERT OR REPLACE INTO system_settings (setting_key, setting_value) VALUES (?, ?)');
    if (loc.country) stmt.run('weather_country', loc.country);
    if (loc.lat !== undefined) stmt.run('weather_lat', String(loc.lat));
    if (loc.lon !== undefined) stmt.run('weather_lon', String(loc.lon));
    stmt.run('weather_source', loc.source);
    stmt.run('weather_loc_updated_at', new Date().toISOString());
  } catch (err) {
    console.error('[weather] saveLocation failed:', err.message);
  }
}

let resolvedCitySource = null, locationGeneration = 0;
export async function resolveCity() {
  const source = captureWeatherSource(), generation = ++locationGeneration;
  const assertCurrent = () => {
    assertWeatherSourceCurrent(source);
    if (generation !== locationGeneration) throw Object.assign(new Error('天气定位请求已变化'), { code: 'WEATHER_SOURCE_STALE' });
  };
  if (resolvedCity && resolvedCitySource?.sourceKey === source.sourceKey && resolvedCitySource.revision === source.revision) {
    assertCurrent();
    return resolvedCity;
  }
  const city = typeof config.weather.city === 'string' ? config.weather.city.trim() : '';
  let location;
  if (city) location = { city, source: 'env' };
  else {
    const ipResult = await resolveCityByIP();
    assertCurrent();
    location = ipResult || { city: _w, source: 'default' };
  }
  assertCurrent();
  saveLocation(location);
  resolvedCity = location;
  resolvedCitySource = source;
  return resolvedCity;
}

async function generateJWT() {
  const pem = _d(_a);
  if (!pem) throw new Error('[weather] private key not configured');
  const privateKey = await jose.importPKCS8(pem, 'EdDSA');
  const now = Math.floor(Date.now() / 1000);
  return await new jose.SignJWT({})
    .setProtectedHeader({ alg: 'EdDSA', kid: _k })
    .setSubject(_p)
    .setIssuedAt(now)
    .setExpirationTime(now + 900)
    .sign(privateKey);
}

async function fetchQWeather(url) {
  const jwt = await generateJWT();
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${jwt}` },
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.warn(`[weather] QWeather API returned ${resp.status}: ${body.substring(0, 200)}`);
    return null;
  }

  const data = await resp.json();
  if (data.code !== '200') {
    console.warn(`[weather] QWeather API error: code=${data.code}`);
    return null;
  }

  return data;
}

async function getLocationQuery(loc, request) {
  assertWeatherForecastCurrent(request);
  if (loc.lat !== undefined && loc.lon !== undefined) {
    return `${loc.lon},${loc.lat}`;
  }

  const db = getDb();
  const cachedCity = db.prepare(`SELECT setting_value FROM system_settings WHERE setting_key = 'weather_cached_city'`).pluck().get();
  if (cachedCity === loc.city) {
    const cachedId = db.prepare(`SELECT setting_value FROM system_settings WHERE setting_key = 'weather_location_id'`).pluck().get();
    if (cachedId) return cachedId;
  }

  const geoData = await fetchQWeather(`${_u}?location=${encodeURIComponent(loc.city)}`);
  assertWeatherForecastCurrent(request);
  if (!geoData?.location?.[0]) {
    console.warn(`[weather] geo lookup failed for ${loc.city}`);
    return null;
  }
  const id = geoData.location[0].id;
  const setStmt = db.prepare('INSERT OR REPLACE INTO system_settings (setting_key, setting_value) VALUES (?, ?)');
  setStmt.run('weather_location_id', id);
  setStmt.run('weather_cached_city', loc.city);
  return id;
}

async function fetchWeatherData(loc, request) {
  assertWeatherForecastCurrent(request);
  const query = await getLocationQuery(loc, request);
  assertWeatherForecastCurrent(request);
  if (!query) return;

  const data = await fetchQWeather(`${_v}?location=${query}`);
  assertWeatherForecastCurrent(request);
  if (!data?.hourly?.length) {
    console.warn('[weather] no hourly data returned');
    return;
  }

  replaceWeatherHourlyCache({ db: getDb(), hourly: data.hourly, fetchedAt: Date.now(), tempLabel, beaufortLabel,
    sourceKey: request.sourceKey, assertCurrent: () => assertWeatherForecastCurrent(request) });

  console.log(`[weather] updated ${data.hourly.length} hours`);
}

function needsUpdate() {
  const source = captureWeatherSource();
  if (getDb().prepare('SELECT 1 FROM weather_hourly WHERE source_key IS NULL OR source_key != ? LIMIT 1').get(source.sourceKey)) return true;
  const row = getDb().prepare(
    'SELECT MAX(created_at) AS last_update FROM weather_hourly'
  ).get();

  if (!row || !row.last_update) return true;

  const lastDate = row.last_update.slice(0, 10);
  return lastDate !== new Date().toISOString().slice(0, 10);
}

async function tick() {
  if (processing) return;
  if (!config.features.weather) return;
  processing = true;
  try {
    if (!needsUpdate()) return;
    const request = beginWeatherForecastRequest();
    const loc = await resolveCity();
    assertWeatherForecastCurrent(request);
    if (!loc) return;

    await fetchWeatherData(loc, request);
  } catch (err) {
    console.error('[weather] tick failed:', err.message);
  } finally {
    processing = false;
  }
}

export function startWeatherScheduler() {
  if (schedulerRunning) return;
  if (!config.features.weather) {
    console.log('[weather] disabled via feature flag');
    return;
  }
  console.log('[weather] starting scheduler (QWeather)');
  schedulerRunning = true;
  const generation = ++schedulerGeneration;

  resolveCity().catch(() => {});
  startupTimer = setTimeout(() => {
    if (!schedulerRunning || generation !== schedulerGeneration) return;
    startupTimer = null;
    tick();
    timer = setInterval(() => {
      if (!schedulerRunning || generation !== schedulerGeneration) return;
      tick();
    }, _z);
  }, 10_000);
}

export function stopWeatherScheduler() {
  schedulerRunning = false;
  schedulerGeneration++;
  if (startupTimer !== null) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

export function restartWeatherScheduler() {
  stopWeatherScheduler();
  startWeatherScheduler();
  tick().catch(() => {});
}

export async function triggerUpdate() {
  try {
    console.log('[weather] manual trigger');
    const request = beginWeatherForecastRequest();
    const loc = await resolveCity();
    assertWeatherForecastCurrent(request);
    if (!loc) return;
    await fetchWeatherData(loc, request);
  } catch (err) {
    console.error('[weather] manual trigger failed:', err.message);
  }
}

export function getResolvedCity() {
  if (!resolvedCitySource) return null;
  const current = captureWeatherSource();
  if (current.sourceKey !== resolvedCitySource.sourceKey || current.revision !== resolvedCitySource.revision) return null;
  return resolvedCity;
}

export function getSeason(month) {
  if (month >= 3 && month <= 5) return '春';
  if (month >= 6 && month <= 8) return '夏';
  if (month >= 9 && month <= 11) return '秋';
  return '冬';
}

export function getCurrentWeather(datetime = new Date()) {
  const timeStr = `${String(datetime.getHours()).padStart(2, '0')}:00`;

  const row = getDb().prepare(
    'SELECT weather_text, temperature, wind_speed FROM weather_hourly WHERE weather_time = ?'
  ).get(timeStr);

  if (!row) return null;

  const hour = datetime.getHours();
  const isNight = hour >= 18 || hour < 6;
  let weatherText = row.weather_text;
  if (isNight && weatherText === '晴') {
    weatherText = '月朗星稀';
  }

  return {
    weather: weatherText,
    temperature: row.temperature,
    windSpeed: row.wind_speed,
  };
}

export async function getWeatherContext(now = new Date()) {
  const timeLight = getTimeLight(now);
  const season = getSeason(now.getMonth() + 1);
  let weather = null;
  try {
    weather = getCurrentWeather(now);
  } catch {}

  return {
    timeStr: timeLight.timeStr,
    timeDesc: timeLight.timeDesc,
    hour: timeLight.hour,
    season,
    lightNote: timeLight.lightNote,
    weather,
  };
}
