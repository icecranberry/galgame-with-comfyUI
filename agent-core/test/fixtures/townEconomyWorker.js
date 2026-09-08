import {parentPort,workerData} from 'node:worker_threads';
import Database from 'better-sqlite3';
import {createEconomyService} from '../../src/services/town/economyService.js';

const db=new Database(workerData.path,{timeout:5000}); db.pragma('foreign_keys=ON');
const service=createEconomyService({db,clock:{now:()=>1000},getWorldEpoch:()=>1,getActor:id=>({actorId:id})});
parentPort.postMessage({ready:true});
const gate=new Int32Array(workerData.gate);
Atomics.wait(gate,0,0,10000);
try {
  const result=service[workerData.method??'transfer'](workerData.command);
  parentPort.postMessage({ok:true,transactionId:result.transactionId});
} catch(error) { parentPort.postMessage({ok:false,code:error.code,message:error.message}); }
finally { db.close(); }
