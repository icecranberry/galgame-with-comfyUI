import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateTownActionSchema } from '../../src/db/townActionSchema.js';
import { migrateTownServiceSessionSchema } from '../../src/db/townServiceSessionSchema.js';
import { migrateTownAppointmentSchema } from '../../src/db/townAppointmentSchema.js';
import { createTownEventService } from '../../src/services/town/townEventService.js';
import { migrateTownItemTemplateSchema } from '../../src/db/townItemTemplateSchema.js';
import { createTownAppointmentService } from '../../src/services/town/townAppointmentService.js';

export function appointmentFixture(t) {
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON');
  migrateTownActionSchema(db); migrateTownServiceSessionSchema(db); migrateTownAppointmentSchema(db);
  db.exec(`CREATE TABLE backpack_items (id INTEGER PRIMARY KEY AUTOINCREMENT, effect_key TEXT,name TEXT,description TEXT,
    rarity TEXT,image_url TEXT,status TEXT,payload_json TEXT,collected_at TEXT,acquired_at TEXT,used_at TEXT);
    CREATE TABLE item_effects (id INTEGER PRIMARY KEY,item_id INTEGER);`);
  migrateTownItemTemplateSchema(db);
  db.exec("CREATE TABLE base_schedule (value TEXT); INSERT INTO base_schedule VALUES('work/sleep/off_town');");
  t.after(() => { assert.deepEqual(db.prepare('SELECT * FROM base_schedule').all(),[{value:'work/sleep/off_town'}]);
    assert.deepEqual(db.pragma('foreign_key_check'),[]); db.close(); });
  let time=Date.UTC(2026,8,8), epoch=1, seq=0;
  const scope={worldId:'w',worldEpoch:1}, flags={linked:true,locationId:1,free:true}, calls=[];
  const registry={getWorldEpoch:w=>w==='w'?epoch:null,resolveAgentKey:key=>key==='me'?{actorId:'player',playerId:'me'}:null,
    getActor:id=>id==='player'?{actorId:id,playerId:'me',participating:true}:
      ['provider','other'].includes(id)?{actorId:id,participating:true,characterExists:flags.linked,characterId:id==='provider'?1:2}:null};
  const clock={now:()=>time};
  const events=createTownEventService({db,clock,getWorldEpoch:registry.getWorldEpoch,
    validators:{'town.service.settled':p=>!!p.sessionId&&!!p.settlementId&&!!p.status&&!!p.outcomeKey,
      'town.dialogue':()=>true}});
  const service=createTownAppointmentService({db,clock,registry,
    getLocation:({locationKey})=>flags.locationId?{locationKey,locationId:flags.locationId}:null,
    availability:args=>{calls.push(args);return typeof flags.free==='function'?flags.free(args):flags.free;}});
  function seed({receipt:receiptExtra={},event:eventExtra={},provider='provider',player='player'}={}) {
    const sessionId=`s${++seq}`, sourceEventId=`service:${sessionId}:settled`;
    db.prepare(`INSERT INTO town_service_sessions(session_id,world_id,world_epoch,actor_id,provider_actor_id,
      status,phase,consumed,crafted,created_at,updated_at,offer_expires_at,escrow_account_id,config_json)
      VALUES(?,?,?,?,?,'completed','done',1,1,?,?,?,'escrow',?)`).run(sessionId,'w',epoch,player,provider,time,time,time,
        JSON.stringify({actorId:provider,locationKey:'workshop',template:{key:'town.workshop',version:1}}));
    const item=db.prepare(`INSERT INTO backpack_items(world_id,source_type,source_id,source_index,template_id,template_version,status)
      VALUES('w','service',?,0,'town.mood_patch',1,'ready')`).run(`service:${sessionId}:outcome:mood_patch`);
    const receipt={sessionId,settlementId:sessionId,eventId:sourceEventId,status:'completed',outcomeKey:'mood_patch',
      paid:30,payout:30,refund:0,itemIds:[Number(item.lastInsertRowid)],settledAt:time,...receiptExtra};
    db.prepare('INSERT INTO town_service_settlements VALUES(?,?)').run(sessionId,JSON.stringify(receipt));
    events.append({worldId:'w',worldEpoch:epoch,eventId:sourceEventId,type:'town.service.settled',
      actorIds:[player,provider],locationKey:'workshop',source:{system:'town.service',entityId:sessionId},
      payload:{sessionId,settlementId:sessionId,status:'completed',outcomeKey:'mood_patch'},...eventExtra});
    return sourceEventId;
  }
  const offer=(options)=>service.offerFromSettlement({scope,sourceEventId:seed(options)});
  const input=(candidate,extra={})=>({scope,candidateId:candidate.candidateId,startAt:time,expectedVersion:candidate.version,
    idempotencyKey:`a${++seq}`,...extra});
  const count=table=>db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
  return {db,service,scope,flags,calls,seed,offer,input,count,clock,registry,setEpoch:n=>{epoch=n;},advance:ms=>{time+=ms;}};
}
