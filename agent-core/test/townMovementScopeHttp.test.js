import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import { createServer } from 'node:http';
import express, { Router } from 'express';
import Database from 'better-sqlite3';
import { listenLocalHttpServer, closeLocalHttpServer } from './fixtures/localHttpServer.js';

async function fixture(t) {
  const db=new Database(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE town_world_state(singleton INTEGER PRIMARY KEY,world_id TEXT,epoch INTEGER);
    INSERT INTO town_world_state VALUES(1,'world',2)`);
  const calls=[],names=[];
  const source=readFileSync(new URL('../src/routes/town.js',import.meta.url),'utf8')
    .replace(/import\s*\{([^}]+)\}\s*from\s*'[^']+';/g,(_,imports)=>{
      names.push(...imports.split(',').map(x=>x.trim()).filter(Boolean));return '';
    }).replace(/export \{ router as default \};/,'');
  const dependencies={Router,getDb:()=>db,
    movePlayerTo:(...args)=>{calls.push(['move',...args]);return {ok:true};},
    movePlayerDir:(...args)=>{calls.push(['dir',...args]);return {ok:true};}};
  const router=compileFunction(`${source}\nreturn router;`,names)(...names.map(name=>dependencies[name]??(()=>{throw new Error(`Unexpected dependency: ${name}`);})));
  const app=express();app.use(express.json());app.use('/api/town',router);
  const server=createServer(app),url=await listenLocalHttpServer(server);t.after(()=>closeLocalHttpServer(server));
  const post=async(path,body)=>{const response=await fetch(`${url}/api/town/player/${path}`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};};
  return {db,calls,post};
}

for(const path of ['move','dir']) test(`${path} route fences late scope, accepts current and legacy, rejects malformed scope without moving`,async t=>{
  const f=await fixture(t),coords=path==='move'?{x:3,y:4}:{dx:1,dy:0};
  const queued={...coords,worldId:'world',worldEpoch:2};
  f.db.exec('UPDATE town_world_state SET epoch=3');f.db.pragma('query_only=ON');
  assert.deepEqual(await f.post(path,queued),{status:409,body:{code:'STALE_WORLD',error:'小镇已变化，请刷新后再移动'}});
  assert.equal(f.calls.length,0);
  assert.equal((await f.post(path,{...coords,worldId:'world',worldEpoch:3,playerId:'evil'})).status,200);
  assert.equal((await f.post(path,coords)).status,200);assert.equal(f.calls.length,2);
  assert.deepEqual(f.calls[0],path==='move'?['move',3,4]:['dir',1,0]);
  for(const scope of [{worldId:'world'},{worldEpoch:3},{worldId:null,worldEpoch:3},
    {worldId:'',worldEpoch:3},{worldId:[],worldEpoch:3},{worldId:'world',worldEpoch:'3'},
    {worldId:'world',worldEpoch:0},{worldId:'world',worldEpoch:1.5},{worldId:'world',worldEpoch:null}]) {
    const result=await f.post(path,{...coords,...scope});assert.equal(result.status,400);assert.equal(result.body.code,'INVALID_WORLD_SCOPE');
  }
  assert.equal((await f.post(path,{...coords,worldId:'old-world',worldEpoch:3})).status,409);
  assert.equal(f.calls.length,2);
});
