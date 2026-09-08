import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import OpenAI from 'openai';
import { acquireSlot, releaseSlot, setMaxConcurrency } from '../src/services/llmConcurrency.js';

const messages = [{ role: 'user',content: 'local fixture ping' }];
const once = { retries:0,maxRetries:0,timeout:1000,freeEggFailover:false };
// Keep VM-loaded application logging off the child runner's framed stdout channel.
// This is lexical injection only: never copy or replace the process console/stdio.
const fixtureConsole = { log() {}, warn() {}, error() {} };
const answer = res => { res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({choices:[{message:{content:'fixture response'}}]})); };
const fail = (res,status=500) => { res.writeHead(status,{'Content-Type':'application/json','retry-after-ms':'1'}); res.end(JSON.stringify({error:{message:'fixture failure'}})); };

async function fixture(t, handler = (_req,res)=>answer(res), overrides = {}) {
  const requests = [];
  const server = createServer(async (req,res) => {
    let body=''; for await (const part of req) body+=part;
    const input={body:JSON.parse(body),headers:req.headers}; requests.push(input);
    handler(req,res,input,requests.length);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async ()=>{ server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); });
  const config={features:{serializeBackgroundLLM:false,mergeMessages:false},llm:{
    baseURL:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'local-fixture-only',model:'owned-model',
    headers:{},extraBody:{},thinkingMode:'omit',freeEgg:false,
  }};
  const toggles=[];
  // Real llm-client source + installed OpenAI SDK, with config/telemetry/queue/logging boundaries injected.
  // Never import production config, DB, dotenv, credentials or an actual model endpoint.
  const source=readFileSync(new URL('../src/llm/llm-client.js',import.meta.url),'utf8')
    .replace(/^import .+?;\r?\n/gm,'').replace(/export /g,'');
  assert.doesNotMatch(source,/\bimport\s/);
  const deps={OpenAI,config,console:fixtureConsole,FREE_EGG_MODELS:['egg-a','egg-b'],
    updateFreeEggEnabled: enabled=>{toggles.push(enabled);config.llm.freeEgg=enabled;},
    acquireSlot,releaseSlot,recordLlmCall:()=>{},...overrides};
  const client=compileFunction(`${source}\nreturn {chatSync,resetClient,resetFreeEggFailureCount};`,Object.keys(deps))(...Object.values(deps));
  return {...client,requests,config,toggles};
}

test('per-request controls reach SDK, stay out of JSON body, and legacy success remains unchanged', async t=>{
  const f=await fixture(t);
  assert.equal(await f.chatSync(messages,once),'fixture response');
  assert.equal(await f.chatSync(messages),'fixture response');
  assert.equal(f.requests.length,2);
  assert.deepEqual(f.requests[0].body,{model:'owned-model',messages,max_tokens:2048,temperature:0.7});
  assert.equal(f.requests[0].headers['x-stainless-timeout'],'1');
});

test('pre-abort sends no request and does not enter semaphore', async t=>{
  const f=await fixture(t,undefined,{acquireSlot:()=>assert.fail('must not acquire')});
  f.config.features.serializeBackgroundLLM=true;
  const controller=new AbortController(); controller.abort();
  await assert.rejects(f.chatSync(messages,{...once,signal:controller.signal}),e=>e.name==='AbortError');
  assert.equal(f.requests.length,0);
});

test('queued abort rejects promptly; late acquired slot is returned and follower can send', async t=>{
  setMaxConcurrency(1); t.after(()=>setMaxConcurrency(null));
  await acquireSlot(); let manualHeld=true;
  t.after(()=>{if(manualHeld)releaseSlot();});
  const f=await fixture(t); f.config.features.serializeBackgroundLLM=true;
  const controller=new AbortController();
  const cancelled=f.chatSync(messages,{...once,signal:controller.signal});
  const rejected=assert.rejects(cancelled,e=>e.name==='AbortError');
  controller.abort(); await rejected;
  assert.equal(f.requests.length,0);
  const follower=f.chatSync(messages,once);
  manualHeld=false; releaseSlot();
  assert.equal(await follower,'fixture response'); assert.equal(f.requests.length,1);
  assert.equal(await f.chatSync(messages,once),'fixture response'); assert.equal(f.requests.length,2);
});

test('in-flight abort closes local HTTP request and never retries even with legacy retry defaults', async t=>{
  const controller=new AbortController(); let closedResolve;
  const closed=new Promise(resolve=>{closedResolve=resolve;});
  const f=await fixture(t,(_req,res)=>{
    res.on('close',closedResolve); controller.abort();
  });
  await assert.rejects(f.chatSync(messages,{signal:controller.signal,retryDelay:1}),e=>e.name==='AbortError');
  await closed; assert.equal(f.requests.length,1);
});

test('SDK maxRetries zero and outer retries zero produce exactly one failed request', async t=>{
  const f=await fixture(t,(_req,res)=>fail(res));
  await assert.rejects(f.chatSync(messages,once),e=>e.status===500);
  assert.equal(f.requests.length,1);
});

test('per-request timeout aborts a stalled local server without hidden retries under once options', async t=>{
  let closedResolve;const closed=new Promise(resolve=>{closedResolve=resolve;});
  const f=await fixture(t,(_req,res)=>res.on('close',closedResolve));
  await assert.rejects(f.chatSync(messages,{...once,timeout:80}),e=>/timeout|timed out/i.test(e.message));
  await closed; assert.equal(f.requests.length,1);
});

test('abort during outer backoff interrupts waiting and does not send a second request', async t=>{
  const controller=new AbortController(); let retryStarted;
  const reachedBackoff=new Promise(resolve=>{retryStarted=resolve;});
  // Capture only this module's warning to deterministically abort at backoff entry.
  // Avoid replacing global console: compileFunction accepts a lexical console dependency.
  const g=await fixture(t,(_req,res)=>fail(res,401),{console:{...fixtureConsole,warn:(...args)=>{
    if (String(args[0]).includes('后退避')) { retryStarted(); setImmediate(()=>controller.abort()); }
  }}});
  const pending=g.chatSync(messages,{signal:controller.signal,retries:2,maxRetries:0,retryDelay:10000});
  const rejection=assert.rejects(pending,e=>e.name==='AbortError');
  await reachedBackoff; await rejection;
  assert.equal(g.requests.length,1);
});

test('abort in freeEgg in-flight request neither rotates nor disables freeEgg', async t=>{
  const controller=new AbortController();
  const f=await fixture(t,()=>controller.abort()); f.config.llm.freeEgg=true;
  await assert.rejects(f.chatSync(messages,{signal:controller.signal,maxRetries:0}),e=>e.name==='AbortError');
  assert.deepEqual(f.requests.map(r=>r.body.model),['egg-a']); assert.deepEqual(f.toggles,[]);
  assert.equal(f.config.llm.freeEgg,true);
});

test('single freeEgg request does not rotate or fall back on 500; default rotation remains intact', async t=>{
  const f=await fixture(t,(_req,res)=>fail(res)); f.config.llm.freeEgg=true;
  await assert.rejects(f.chatSync(messages,once),e=>e.status===500);
  assert.equal(f.requests.length,1); assert.deepEqual(f.toggles,[]);
  const g=await fixture(t,(_req,res,input)=>input.body.model==='owned-model'?answer(res):fail(res)); g.config.llm.freeEgg=true;
  assert.equal(await g.chatSync(messages,{retries:0,maxRetries:0}),'fixture response');
  assert.deepEqual(g.requests.map(r=>r.body.model),['egg-a','egg-b','owned-model']);
  assert.deepEqual(g.toggles,[false]);
});

test('legacy outer retry count and SDK defaults remain independently unchanged', async t=>{
  const f=await fixture(t,(_req,res)=>fail(res,401));
  await assert.rejects(f.chatSync(messages,{retryDelay:1}),e=>e.status===401);
  assert.equal(f.requests.length,3); // outer default retries=2; SDK does not retry 401
  const g=await fixture(t,(_req,res)=>fail(res,500));
  await assert.rejects(g.chatSync(messages,{retries:0}),e=>e.status===500);
  assert.equal(g.requests.length,3); // untouched SDK default retries=2
});

test('slot release uses acquisition-time config even if feature toggles while request runs', async t=>{
  let acquired=0,released=0,f;
  f=await fixture(t,(_req,res)=>{f.config.features.serializeBackgroundLLM=false;answer(res);},
    {acquireSlot:async()=>{acquired++;},releaseSlot:()=>{released++;}});
  f.config.features.serializeBackgroundLLM=true;
  assert.equal(await f.chatSync(messages,once),'fixture response');
  assert.equal(acquired,1);assert.equal(released,1);
});

test('abort exactly before freeEgg own-endpoint fallback prevents the fallback request', async t=>{
  const controller=new AbortController();
  const f=await fixture(t,(_req,res)=>fail(res),{updateFreeEggEnabled:()=>controller.abort()});
  f.config.llm.freeEgg=true;
  await assert.rejects(f.chatSync(messages,{signal:controller.signal,maxRetries:0,retries:0}),e=>e.name==='AbortError');
  assert.deepEqual(f.requests.map(r=>r.body.model),['egg-a','egg-b']);
});
