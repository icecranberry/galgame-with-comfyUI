// 神说验收的可复用隔离入口：node --import ./test/helpers/godAuditIsolation.mjs --test ...
// 只允许内存/系统临时目录，以及音频测试专用的独占临时库。真实模型验收显式开启。
import { createRequire, syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import https from 'node:https';

const require=createRequire(import.meta.url);
// 修改 require.cache 的 exports 无法可靠覆盖 Node 的 ESM CJS facade；
// 在实际打开 SQLite 文件的 native binding 上拦截，两种加载方式都受约束。
const addon=require('better-sqlite3/build/Release/better_sqlite3.node');
const temporaryRoot=path.resolve(os.tmpdir()).toLowerCase()+path.sep;
const testRoot=fileURLToPath(new URL('../',import.meta.url));
function isolatedAudioFixture(filename) {
  const parts=path.relative(testRoot,path.resolve(filename)).split(path.sep);
  if (parts.length!==2 || !/^\.tmp-linshe-api-tts-[A-Za-z0-9]+$/.test(parts[0]) || parts[1]!=='test.db') return false;
  const parent=path.resolve(testRoot,parts[0]);
  // 音频集成测试必须在项目卷使用其独占的临时目录；不接受符号链接或任意工作区路径。
  return fs.existsSync(parent) && fs.realpathSync(parent)===parent && (!fs.existsSync(filename)||!fs.lstatSync(filename).isSymbolicLink());
}
addon.Database=new Proxy(addon.Database,{
  construct(target,args) {
    const filename=args[0];
    if(filename && filename!==':memory:' && !path.resolve(String(filename)).toLowerCase().startsWith(temporaryRoot) && !isolatedAudioFixture(filename)) {
      throw new Error('验收隔离：禁止打开独立测试目录以外的数据库');
    }
    return Reflect.construct(target,args);
  },
});
process.env.DB_PATH=':memory:';

const allowedOrigins=new Set();
if(process.env.LINSHE_GOD_INTENT_LIVE==='1') {
  const {config}=await import('../../src/config.js');
  config.dbPath=':memory:';
  allowedOrigins.add(new URL(config.llm.baseURL).origin);
}
function checkUrl(url) {
  const parsed=new URL(url);
  if(!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname) && !allowedOrigins.has(parsed.origin)) {
    throw new Error('验收隔离：禁止访问未授权的外部服务');
  }
}
const nativeFetch=globalThis.fetch;
globalThis.fetch=(url,options)=>{
  checkUrl(typeof url==='string' || url instanceof URL ? url : url.url);
  return nativeFetch(url,options);
};
// OpenAI SDK 的 node-fetch 不经过 globalThis.fetch，还需要限制 Node HTTP 层。
for(const [transport,protocol] of [[http,'http:'],[https,'https:']]) {
  for(const method of ['request','get']) {
    const native=transport[method];
    transport[method]=function(first,...args) {
      if(typeof first==='string' || first instanceof URL) checkUrl(first);
      else {
        const hostname=first.hostname || first.host || 'localhost';
        const port=first.port ? `:${first.port}` : '';
        checkUrl(`${first.protocol||protocol}//${hostname}${port}`);
      }
      return native.call(this,first,...args);
    };
  }
}
syncBuiltinESMExports();
