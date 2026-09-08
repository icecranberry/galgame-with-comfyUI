import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileFunction} from 'node:vm';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {migrateWeatherHourlySchema} from '../src/db/weatherHourlySchema.js';
import {parseWeatherForecastAt,replaceWeatherHourlyCache} from '../src/services/weatherHourlyCache.js';
import {createTownWeatherFacts} from '../src/services/town/townWeatherFacts.js';

const at=Date.UTC(2026,8,8,1),hour=3600000;
const sourceKey=`weather:v1:${'a'.repeat(64)}`;
const row=(fxTime='2026-09-08T09:00+08:00',text='小雨')=>({fxTime,text,temp:'20',windSpeed:'3'});
function fixture(t) {
  const db=new Database(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE weather_hourly(id INTEGER PRIMARY KEY,weather_time TEXT UNIQUE NOT NULL,
    weather_text TEXT NOT NULL,temperature TEXT NOT NULL,wind_speed TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  migrateWeatherHourlySchema(db);
  let now=at;
  const write=(hourly=[row()],fetchedAt=at)=>replaceWeatherHourlyCache({db,hourly,fetchedAt,sourceKey,assertCurrent:()=>{},tempLabel:v=>`temp:${v}`,beaufortLabel:v=>`wind:${v}`});
  const reader=createTownWeatherFacts({db,clock:{now:()=>now},expectedSourceKey:sourceKey});
  return {db,write,read:reader.readCurrent,time:v=>{now=v;}};
}

test('strict offset parsing preserves UTC instants and rejects normalized or zone-less dates',()=>{
  for(const value of ['2026-09-08T09:00+08:00','2026-09-08T01:00:00Z','2026-09-07T20:00-05:00']) assert.equal(parseWeatherForecastAt(value),at);
  for(const value of ['2026-02-30T09:00Z','2026-09-08T24:00Z','2026-09-08T01:00','2026-09-08 01:00Z',
    '2026-09-08T01:60Z','2026-09-08T01:00+14:30',null]) assert.throws(()=>parseWeatherForecastAt(value),TypeError);
});

test('migration is repeatable, preserves old consumer columns, and leaves legacy timestamps unknown',t=>{
  const f=fixture(t);f.db.exec("INSERT INTO weather_hourly(weather_time,weather_text,temperature) VALUES('09:00','小雨','温暖')");
  const before=f.db.prepare('SELECT * FROM weather_hourly').get();migrateWeatherHourlySchema(f.db);
  assert.deepEqual(f.db.prepare('SELECT * FROM weather_hourly').get(),before);
  assert.equal(before.forecast_at,null);assert.equal(before.fetched_at,null);
  f.db.pragma('query_only=ON');assert.equal(f.read().reason,'SOURCE_MISMATCH');
});

test('fresh next-day same-hour is not current; half-open forecast interval and 26h fetch age are independent',t=>{
  const f=fixture(t);f.write([row('2026-09-09T09:00+08:00')]);
  assert.equal(f.read().status,'unknown');
  f.write();f.db.pragma('query_only=ON');
  assert.deepEqual(f.read(),{source:'forecast',status:'known',precipitation:'rain',text:'小雨',temperature:'temp:20',forecastAt:at,fetchedAt:at,validUntil:at+hour,reason:null});
  f.time(at+hour-1);assert.equal(f.read().status,'known');
  f.time(at+hour);assert.equal(f.read().status,'unknown');
  f.db.pragma('query_only=OFF');f.time(at);f.write([row()],at-25*hour);assert.equal(f.read().status,'known');
  f.write([row()],at-26*hour);assert.equal(f.read().reason,'STALE_CACHE');
  f.write([row()],at+1);assert.equal(f.read().reason,'INVALID_TIME');
});

test('reader uses exact forecast vocabulary, rejects arbitrary prose, and never invokes a weather service',t=>{
  const f=fixture(t);
  for(const [text,expected] of [['晴','none'],['雷阵雨','rain'],['没有下雨',null],['模型说会下雨',null],['雨夹雪',null]]) {
    f.write([row(undefined,text)]);f.db.pragma('query_only=ON');assert.equal(f.read().precipitation,expected);f.db.pragma('query_only=OFF');
  }
  assert.equal(createTownWeatherFacts({db:{prepare(){throw new Error('disabled must not query');}},clock:{now:()=>at},enabled:false}).readCurrent().reason,'DISABLED');
});

test('legacy columns are detected read-only; unrelated schema errors remain visible and malformed rows stay unknown',t=>{
  const db=new Database(':memory:');t.after(()=>db.close());
  const empty=createTownWeatherFacts({db,clock:{now:()=>at},expectedSourceKey:sourceKey});
  assert.equal(empty.readCurrent().reason,'MISSING_CACHE');
  db.exec('CREATE TABLE weather_hourly(weather_text TEXT)');db.pragma('query_only=ON');
  assert.equal(empty.readCurrent().reason,'MISSING_VALID_TIME');
  db.pragma('query_only=OFF');migrateWeatherHourlySchema(db);db.pragma('query_only=ON');
  assert.throws(empty.readCurrent,/no such column/);
  const f=fixture(t);f.write();
  f.db.prepare('UPDATE weather_hourly SET fetched_at=?').run('invalid');
  f.db.pragma('query_only=ON');assert.equal(f.read().reason,'INVALID_TIME');
  f.db.pragma('query_only=OFF');f.write();
  // Historical/imported overlap remains defensive-reader coverage; writer now rejects it.
  f.db.prepare('INSERT INTO weather_hourly(weather_time,weather_text,temperature,forecast_at,fetched_at,source_key) VALUES(?,?,?,?,?,?)')
    .run('09:30','小雨','温暖',at+30*60000,at,sourceKey);
  f.time(at+30*60000);f.db.pragma('query_only=ON');assert.equal(f.read().reason,'AMBIGUOUS_FORECAST');
});

test('writer accepts local hours with half-hour offsets, but rejects nonzero local minutes or seconds atomically',t=>{
  const f=fixture(t);f.write();const before=f.db.prepare('SELECT * FROM weather_hourly').all();
  for(const timestamp of ['2026-09-08T09:30+08:00','2026-09-08T09:00:01+08:00']) {
    assert.throws(()=>f.write([row(timestamp)]),/local hour/);
    assert.deepEqual(f.db.prepare('SELECT * FROM weather_hourly').all(),before);
  }
  f.write([row('2026-09-08T09:00:00+05:30')]);
  assert.equal(f.db.prepare('SELECT forecast_at FROM weather_hourly').get().forecast_at,Date.UTC(2026,8,8,3,30));
});

test('writer deduplicates equal full-time display payloads and rejects all full-time overlaps before legacy IGNORE',t=>{
  const f=fixture(t);f.write();const before=f.db.prepare('SELECT * FROM weather_hourly').all();
  for(const batch of [
    [row(),row(undefined,'晴')],
    [row(),{...row(),temp:'40'}],
    [row(),{...row(),windSpeed:'99'}],
    [row(),row('2026-09-08T09:00+07:30')],
    [row('2026-09-08T09:00+07:30'),row()],
    [row('2026-09-08T10:00+08:30'),row()],
  ]) {
    assert.throws(()=>f.write(batch),/Conflicting|Overlapping/);
    assert.deepEqual(f.db.prepare('SELECT * FROM weather_hourly').all(),before);
  }
  f.write([row(),row('2026-09-08T01:00Z')]);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM weather_hourly').get().n,1);
  f.write([row('2026-09-08T10:00+08:00'),row()]);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM weather_hourly').get().n,2,'adjacent half-open hours allowed');
  f.write([row('2026-09-09T09:00+08:00','晴'),row()]);
  assert.equal(f.db.prepare('SELECT forecast_at FROM weather_hourly').get().forecast_at,at+24*hour,'non-overlapping same HH:mm retains original first row');
});

test('display text is recognized only; temperature is a bounded single-line label and unknown exposes neither',t=>{
  const f=fixture(t);f.write();
  for(const temperature of ['温暖（20°C）','x'.repeat(32),'x'.repeat(33),'bad\nlabel','']) {
    f.db.prepare('UPDATE weather_hourly SET temperature=?').run(temperature);
    f.db.pragma('query_only=ON');
    assert.equal(f.read().temperature,temperature && temperature.length<=32 && !temperature.includes('\n')?temperature:null);
    assert.equal(f.read().text,'小雨');f.db.pragma('query_only=OFF');
  }
  f.write([row(undefined,'模型说会下雨')]);const unknown=f.read();
  assert.equal(unknown.text,'');assert.equal(unknown.temperature,null);
});

test('invalid batch or insertion failure preserves entire previous cache; legacy duplicate hour behavior stays first-wins',t=>{
  const f=fixture(t);f.write();const before=f.db.prepare('SELECT * FROM weather_hourly').all();
  assert.throws(()=>f.write([row(),row('bad')]),TypeError);assert.deepEqual(f.db.prepare('SELECT * FROM weather_hourly').all(),before);
  f.db.exec("CREATE TRIGGER reject_weather BEFORE INSERT ON weather_hourly WHEN NEW.weather_text='阴' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  assert.throws(()=>f.write([row('2026-09-08T10:00+08:00','阴')]),/fixture failure/);
  assert.deepEqual(f.db.prepare('SELECT * FROM weather_hourly').all(),before);
  f.db.exec('DROP TRIGGER reject_weather');f.write([row(),row('2026-09-09T09:00+08:00','晴')]);
  const stored=f.db.prepare('SELECT * FROM weather_hourly').all();assert.equal(stored.length,1);assert.equal(stored[0].forecast_at,at);
  assert.equal(stored[0].weather_time,'09:00');assert.equal(stored[0].temperature,'temp:20');assert.equal(stored[0].wind_speed,'wind:3');
});

test('actual fetchWeatherData writer saves fake response times without loading credential or scheduler code',async t=>{
  const f=fixture(t);
  // Execute only this named function; never evaluate the module or credential helpers.
  const text=readFileSync(new URL('../src/services/weatherService.js',import.meta.url),'utf8');
  const source=text.slice(text.indexOf('async function fetchWeatherData(loc, request) {'),text.indexOf('\nfunction needsUpdate()'));
  const write=compileFunction(`${source}\nreturn fetchWeatherData;`,['getLocationQuery','fetchQWeather','_v','getDb','replaceWeatherHourlyCache','tempLabel','beaufortLabel','Date','assertWeatherForecastCurrent'])(
    async()=> 'fixture',async()=>({hourly:[row()]}),'fixture-only',()=>f.db,replaceWeatherHourlyCache,String,String,{now:()=>at},request=>assert.equal(request.sourceKey,sourceKey));
  await write({},{sourceKey});const stored=f.db.prepare('SELECT * FROM weather_hourly').get();
  assert.equal(stored.forecast_at,at);assert.equal(stored.fetched_at,at);
  assert.equal(stored.source_key,sourceKey);
});

test('source binding rejects missing/different/mixed source without exposing old display facts',t=>{
  const f=fixture(t);f.write();f.db.pragma('query_only=ON');
  for(const expectedSourceKey of [undefined,`weather:v1:${'b'.repeat(64)}`]) {
    const result=createTownWeatherFacts({db:f.db,clock:{now:()=>at},expectedSourceKey}).readCurrent();
    assert.equal(result.reason,'SOURCE_MISMATCH');assert.equal(result.text,'');assert.equal(result.temperature,null);
  }
  f.db.pragma('query_only=OFF');f.db.exec('UPDATE weather_hourly SET source_key=NULL');
  f.db.pragma('query_only=ON');assert.equal(f.read().reason,'SOURCE_MISMATCH');
});

test('source fence is checked again inside replacement transaction before deleting prior cache',t=>{
  const f=fixture(t);f.write();const before=f.db.prepare('SELECT * FROM weather_hourly').all();let checks=0;
  assert.throws(()=>replaceWeatherHourlyCache({db:f.db,hourly:[row()],fetchedAt:at,sourceKey,tempLabel:String,beaufortLabel:String,
    assertCurrent:()=>{if(++checks===2)throw Object.assign(new Error('stale'),{code:'WEATHER_SOURCE_STALE'});}}),{code:'WEATHER_SOURCE_STALE'});
  assert.deepEqual(f.db.prepare('SELECT * FROM weather_hourly').all(),before);
});

test('source identity is stable while revision fences ABA and latest generation supersedes same-city requests',()=>{
  const config={weather:{city:'A'}};
  const source=readFileSync(new URL('../src/services/weatherSource.js',import.meta.url),'utf8')
    .replace(/^import .*$/gm,'').replace(/export function /g,'function ');
  const api=compileFunction(`${source}\nreturn {getWeatherSourceKey,notifyWeatherSourceChange,captureWeatherSource,
    assertWeatherSourceCurrent,beginWeatherForecastRequest,assertWeatherForecastCurrent};`,['createHash','config'])(createHash,config);
  assert.equal(api.getWeatherSourceKey(' A '),api.getWeatherSourceKey('A'));
  assert.equal(api.getWeatherSourceKey(''),api.getWeatherSourceKey('  '));
  const original=api.captureWeatherSource();
  api.notifyWeatherSourceChange('A','B');config.weather.city='B';
  api.notifyWeatherSourceChange('B','A');config.weather.city='A';
  assert.equal(api.captureWeatherSource().sourceKey,original.sourceKey);
  assert.throws(()=>api.assertWeatherSourceCurrent(original),{code:'WEATHER_SOURCE_STALE'});
  const current=api.captureWeatherSource();api.notifyWeatherSourceChange('A',' A ');
  api.assertWeatherSourceCurrent(current);
  const earlier=api.beginWeatherForecastRequest(),latest=api.beginWeatherForecastRequest();
  assert.throws(()=>api.assertWeatherForecastCurrent(earlier),{code:'WEATHER_SOURCE_STALE'});
  api.assertWeatherForecastCurrent(latest);
});

test('actual needsUpdate refreshes same-UTC-day mismatched or legacy source before daily freshness check',t=>{
  const f=fixture(t);f.write();
  f.db.prepare('UPDATE weather_hourly SET created_at=?').run('2026-09-08 00:00:00');
  const text=readFileSync(new URL('../src/services/weatherService.js',import.meta.url),'utf8');
  const source=text.slice(text.indexOf('function needsUpdate() {'),text.indexOf('\nasync function tick()'));
  const needsUpdate=compileFunction(`${source}\nreturn needsUpdate;`,['getDb','captureWeatherSource','Date'])(
    ()=>f.db,()=>({sourceKey}),class extends Date {constructor(){super(at);}});
  for(const [stored,expected] of [[sourceKey,false],[null,true],[`weather:v1:${'b'.repeat(64)}`,true]]) {
    f.db.prepare('UPDATE weather_hourly SET source_key=?').run(stored);
    f.db.pragma('query_only=ON');assert.equal(needsUpdate(),expected);f.db.pragma('query_only=OFF');
  }
  f.db.exec('DELETE FROM weather_hourly');f.db.pragma('query_only=ON');assert.equal(needsUpdate(),true);
});
