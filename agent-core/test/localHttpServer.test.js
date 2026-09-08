import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { FETCH_BAD_PORTS, listenLocalHttpServer, closeLocalHttpServer } from './fixtures/localHttpServer.js';

test('blocked random allocations are closed and retried with port zero; no fixed-port fallback',async()=>{
  const server=new EventEmitter(),allocations=[6000,10080,54321],calls=[],rejected=[];
  let port,closes=0;
  server.listen=(requested,host)=>{calls.push([requested,host]);port=allocations.shift();server.listening=true;queueMicrotask(()=>server.emit('listening'));};
  server.address=()=>({port});server.closeAllConnections=()=>{};
  server.close=callback=>{closes++;server.listening=false;callback();};
  const url=await listenLocalHttpServer(server,{onRejectedPort:value=>rejected.push(value)});
  assert.equal(url,'http://127.0.0.1:54321');assert.deepEqual(rejected,[6000,10080]);assert.equal(closes,2);
  assert.deepEqual(calls,Array.from({length:3},()=>[0,'127.0.0.1']));
  assert.equal(server.listenerCount('error'),0);await closeLocalHttpServer(server);assert.equal(closes,3);
});

test('real random localhost listener serves native fetch and closes cleanly',async t=>{
  const server=createServer((req,res)=>res.end('ok'));t.after(()=>closeLocalHttpServer(server));
  const url=await listenLocalHttpServer(server);assert.equal(FETCH_BAD_PORTS.has(Number(new URL(url).port)),false);
  assert.equal(await (await fetch(url)).text(),'ok');
});

test('listen errors reject rather than leave unresolved startup promises',async()=>{
  const server=new EventEmitter();server.listen=()=>queueMicrotask(()=>server.emit('error',new Error('bind failed')));
  await assert.rejects(listenLocalHttpServer(server),/bind failed/);assert.equal(server.listenerCount('listening'),0);
});
