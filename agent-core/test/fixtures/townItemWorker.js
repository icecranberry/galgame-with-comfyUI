import {parentPort,workerData} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {compileFunction} from 'node:vm';
import Database from 'better-sqlite3';
import {createEconomyService} from '../../src/services/town/economyService.js';
import {createItemTemplateService} from '../../src/services/town/itemTemplateService.js';
import * as lifecycle from '../../src/services/itemLifecycle.js';

const db=new Database(workerData.path,{timeout:5000});db.pragma('foreign_keys=ON');
const names=[];
const source=readFileSync(new URL('../../src/services/itemService.js',import.meta.url),'utf8')
  .replace(/import\s*\{([^}]+)\}\s*from\s*'[^']+';/g,(_,imports)=>{names.push(...imports.split(',').map(s=>s.trim()).filter(Boolean));return '';})
  .replace(/export (?=(?:async )?function|const)/g,'');
const deps={...lifecycle,getDb:()=>db};
const legacy=compileFunction(`${source}\nreturn {ITEM_EFFECTS,useItem};`,names)(...names.map(n=>deps[n]??(()=>{throw new Error(`Unexpected dependency ${n}`);} )));
const options={db,clock:{now:()=>1000000},getWorldEpoch:()=>1,getActor:id=>({actorId:id,playerId:id==='player'?'me':null})};
const economy=createEconomyService(options),items=createItemTemplateService({...options,effectRegistry:legacy.ITEM_EFFECTS,economy});
parentPort.postMessage({ready:true});const gate=new Int32Array(workerData.gate);Atomics.wait(gate,0,0,10000);
try {
  const result=workerData.method==='use'?legacy.useItem(workerData.itemId,1,{expectedVersion:workerData.version}):items.trade(workerData.command);
  parentPort.postMessage({ok:result.ok!==false,result});
}catch(error){parentPort.postMessage({ok:false,code:error.code,message:error.message});}
finally{db.close();}
