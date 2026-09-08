import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileFunction} from 'node:vm';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {replaceWeatherHourlyCache} from '../src/services/weatherHourlyCache.js';

const moduleSource=name=>readFileSync(new URL(`../src/services/${name}.js`,import.meta.url),'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export /gm,'');
const sourceModule=moduleSource('weatherSource'),weatherModule=moduleSource('weatherService');
assert.doesNotMatch(sourceModule+weatherModule,/^import /m);
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const forecast=text=>({hourly:[{fxTime:'2026-09-08T10:00:00+08:00',text,temp:'23',windSpeed:'3'}]});
function fixture(t,city='甲城'){
  // All persistence is explicitly ephemeral; config is an ordinary local object.
  const db=new Database(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE system_settings(setting_key TEXT PRIMARY KEY,setting_value TEXT);
    CREATE TABLE weather_hourly(weather_time TEXT UNIQUE,weather_text,temperature,wind_speed,forecast_at,fetched_at,source_key,created_at DEFAULT CURRENT_TIMESTAMP);`);
  const config={weather:{city},features:{weather:true}};
  const source=compileFunction(`${sourceModule}\nreturn {getWeatherSourceKey,notifyWeatherSourceChange,captureWeatherSource,assertWeatherSourceCurrent,beginWeatherForecastRequest,assertWeatherForecastCurrent};`,['config','createHash'])(config,createHash);
  const ip=[],network=[],errors=[];
  const forbid=()=>assert.fail('real JWT/network/scheduler/config-file access forbidden');
  const deps={config,getDb:()=>db,...source,replaceWeatherHourlyCache,Buffer,
    fakeIP:()=>{const d=deferred();ip.push(d);return d.promise;},
    fakeQ:url=>{const d=deferred();network.push({...d,url});return d.promise;},
    forbid,fetch:forbid,jose:new Proxy({}, {get:()=>forbid}),setTimeout:forbid,setInterval:forbid,
    console:{log(){},warn(){},error:(...args)=>errors.push(args)}};
  // Only private external boundaries are replaced. Resolve, geo lookup, request
  // ordering, source checks and atomic cache replacement remain production code.
  const api=compileFunction(`${weatherModule}\nresolveCityByIP=fakeIP;fetchQWeather=fakeQ;generateJWT=forbid;\nreturn {resolveCity,getResolvedCity,triggerUpdate};`,Object.keys(deps))(...Object.values(deps));
  const switchCity=next=>{const previous=config.weather.city;config.weather.city=next;source.notifyWeatherSourceChange(previous,next);};
  const cacheGeo=city=>{
    const put=db.prepare('INSERT OR REPLACE INTO system_settings VALUES(?,?)');put.run('weather_cached_city',city);put.run('weather_location_id',`${city}-id`);
  };
  async function request(index){for(let i=0;i<30&&!network[index];i++)await Promise.resolve();assert.ok(network[index],`request ${index} reached fake boundary`);return network[index];}
  const rows=()=>db.prepare('SELECT * FROM weather_hourly').all();
  return {db,config,source,api,ip,network,errors,switchCity,cacheGeo,request,rows};
}

test('real resolveCity follows config changes and rejects old automatic IP completion before persistence',async t=>{
  const f=fixture(t,'');const old=f.api.resolveCity();const rejected=assert.rejects(old,{code:'WEATHER_SOURCE_STALE'});
  assert.equal(f.ip.length,1);f.switchCity('乙城');assert.equal((await f.api.resolveCity()).city,'乙城');
  f.ip[0].resolve({city:'旧IP城',country:'旧国家',lat:1,lon:2,source:'ip'});await rejected;
  assert.equal(f.api.getResolvedCity().city,'乙城');
  assert.equal(f.db.prepare("SELECT setting_value FROM system_settings WHERE setting_key='weather_source'").get().setting_value,'env');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM system_settings WHERE setting_key IN ('weather_lat','weather_lon','weather_country')").get().n,0);
  f.switchCity('丙城');assert.equal(f.api.getResolvedCity(),null);assert.equal((await f.api.resolveCity()).city,'丙城');
});

test('source revision rejects automatic-city ABA late IP even when final source key is identical',async t=>{
  const f=fixture(t,'');const pending=f.api.resolveCity();const rejected=assert.rejects(pending,{code:'WEATHER_SOURCE_STALE'});
  f.switchCity('临时城');f.switchCity('');f.ip[0].resolve({city:'过期IP',source:'ip'});await rejected;
  assert.equal(f.api.getResolvedCity(),null);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM system_settings').get().n,0);
});

test('different-city forecast late response cannot overwrite current city successful cache',async t=>{
  const f=fixture(t);f.cacheGeo('甲城');const old=f.api.triggerUpdate();const oldRequest=await f.request(0);
  f.switchCity('乙城');f.cacheGeo('乙城');const current=f.api.triggerUpdate();const newRequest=await f.request(1);
  newRequest.resolve(forecast('小雨'));await current;
  const expected=f.rows();assert.equal(expected.length,1);assert.equal(expected[0].source_key,f.source.getWeatherSourceKey(f.config.weather.city));
  oldRequest.resolve(forecast('暴雨'));await old;assert.deepEqual(f.rows(),expected);assert.equal(f.errors.length,1);
});

test('same-city older forecast cannot overwrite newer successful request',async t=>{
  const f=fixture(t);f.cacheGeo('甲城');const old=f.api.triggerUpdate();const oldRequest=await f.request(0);
  const latest=f.api.triggerUpdate();const latestRequest=await f.request(1);
  latestRequest.resolve(forecast('晴'));await latest;const expected=f.rows();
  oldRequest.resolve(forecast('暴雨'));await old;assert.deepEqual(f.rows(),expected);
  assert.equal(expected[0].weather_text,'晴');assert.equal(expected[0].source_key,f.source.captureWeatherSource().sourceKey);
  assert.equal(f.errors.length,1);
});

test('stale geo lookup cannot persist old city id or dispatch an additional forecast',async t=>{
  const f=fixture(t);const old=f.api.triggerUpdate();const geo=await f.request(0);
  f.switchCity('乙城');f.cacheGeo('乙城');const latest=f.api.triggerUpdate();const weather=await f.request(1);
  weather.resolve(forecast('多云'));await latest;geo.resolve({location:[{id:'old-geo-id'}]});await old;
  assert.equal(f.network.length,2);
  assert.equal(f.db.prepare("SELECT setting_value FROM system_settings WHERE setting_key='weather_location_id'").get().setting_value,'乙城-id');
  assert.equal(f.rows()[0].source_key,f.source.getWeatherSourceKey('乙城'));
});
