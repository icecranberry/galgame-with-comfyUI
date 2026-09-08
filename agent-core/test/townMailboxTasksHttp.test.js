import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import { createServer } from 'node:http';
import express, { Router } from 'express';
import { mailboxTasksFixture } from './fixtures/townMailboxTasksFixture.js';
import { listenLocalHttpServer, closeLocalHttpServer } from './fixtures/localHttpServer.js';
import { createTownMailboxTasks } from '../src/services/town/townMailboxTasks.js';
import { createTownActorRegistry } from '../src/services/town/townActorRegistry.js';
import { createEconomyService } from '../src/services/town/economyService.js';

function isolatedModule(path,dependencies,exports) {
  const names=[];
  const source=readFileSync(new URL(path,import.meta.url),'utf8')
    .replace(/import\s*\{([^}]+)\}\s*from\s*'[^']+';/g,(_,imports)=>{
      names.push(...imports.split(',').map(x=>x.trim()).filter(Boolean));return '';
    }).replace(/export (?=(?:async )?function )/g,'').replace(/export \{ router as default \};/,'');
  assert.doesNotMatch(source,/\bimport\s/);
  return compileFunction(`${source}\nreturn {${exports.join(',')}};`,[...names,'Date'])(...names.map(name=>
    dependencies[name]??(()=>{throw new Error(`Unexpected dependency: ${name}`);})),dependencies.Date??Date);
}
async function fixture(t) {
  const f=mailboxTasksFixture(t),config={features:{town:true},town:{economyEnabled:true}};
  const runtime=isolatedModule('../src/services/town/townEconomyRuntime.js',{
    getDb:()=>f.db,createTownActorRegistry,createEconomyService,createTownMailboxTasks,config,
    Date:class extends Date {static now(){return f.clock.now();}}
  },['getTownMailboxTaskCards']);
  const {router}=isolatedModule('../src/routes/town.js',{Router,...runtime},['router']);
  const app=express();app.use('/api/town',router);const server=createServer(app);
  const url=await listenLocalHttpServer(server);t.after(()=>closeLocalHttpServer(server));
  const request=async(query='')=>{const response=await fetch(`${url}/api/town/mailbox-tasks${query}`);
    return {status:response.status,body:await response.json()};};
  return {...f,config,runtime,request};
}

test('real HTTP/runtime honors query_only, returns cards and round-trips object cursor JSON',async t=>{
  const f=await fixture(t);f.publish();f.publish();const before=f.snapshot();f.db.pragma('query_only=ON');
  const page=await f.request('?limit=1&playerId=evil&worldId=evil');assert.equal(page.status,200);
  assert.equal(page.body.worldId,f.scope.worldId);assert.equal(page.body.items.length,1);
  const cursor=page.body.nextCursor;assert.equal(typeof cursor.createdAt,'number');assert.equal(typeof cursor.orderId,'string');
  const next=await f.request(`?limit=1&cursor=${encodeURIComponent(JSON.stringify(cursor))}`);
  assert.equal(next.status,200);assert.equal(next.body.items.length,1);assert.equal(next.body.nextCursor,null);
  assert.notEqual(next.body.items[0].orderId,page.body.items[0].orderId);
  assert.deepEqual(f.runtime.getTownMailboxTaskCards({limit:1}),page.body);assert.deepEqual(f.snapshot(),before);
});

test('economy off retains accepted/picked-up and town off returns empty without maintenance',async t=>{
  const f=await fixture(t);f.publish();let accepted=f.publish();accepted=f.act('accept',accepted);
  f.config.town.economyEnabled=false;f.db.pragma('query_only=ON');
  const page=await f.request();assert.equal(page.status,200);assert.equal(page.body.items.length,1);assert.equal(page.body.items[0].status,'accepted');
  f.db.pragma('query_only=OFF');f.arrive('source');f.act('pickup',accepted);f.db.pragma('query_only=ON');
  assert.equal((await f.request()).body.items[0].status,'picked_up');const before=f.snapshot();
  f.config.features.town=false;assert.deepEqual((await f.request()).body,{...f.scope,items:[],nextCursor:null});assert.deepEqual(f.snapshot(),before);
});

test('invalid JSON/shape/limits reject, and reset or expiration cannot expose stale cards',async t=>{
  const f=await fixture(t),order=f.publish();f.db.pragma('query_only=ON');
  for(const query of ['?cursor=%7B','?cursor=%7B%7D','?cursor=2','?limit=0','?limit=101']) {
    const response=await f.request(query);assert.ok([400,409].includes(response.status));assert.equal(response.body.code,'INVALID_PAGE');
  }
  f.advance(order.expiresAt-f.clock.now());const before=f.snapshot();assert.deepEqual((await f.request()).body.items,[]);assert.deepEqual(f.snapshot(),before);
  f.db.pragma('query_only=OFF');f.db.exec('UPDATE town_world_state SET epoch=2');f.db.pragma('query_only=ON');
  const current=await f.request();assert.equal(current.status,200);assert.equal(current.body.worldEpoch,2);assert.deepEqual(current.body.items,[]);
});
