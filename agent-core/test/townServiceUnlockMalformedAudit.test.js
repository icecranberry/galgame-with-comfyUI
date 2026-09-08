import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createTownServiceUnlock } from '../src/services/town/townServiceUnlock.js';
import { PRODUCTION_RECIPE } from '../src/services/town/townProductionService.js';

// Regression: deliberately malformed imported history, never a valid
// unlock seed. No production mutation, real database, model, or service execution.
for (const malformed of ['locationKeys','npcActorIds']) test(`malformed historical ${malformed} locks without throwing or writing`, t => {
  const db=new Database(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE town_business_slices(world_id TEXT,world_epoch INTEGER,config TEXT);
    CREATE TABLE town_productions(production_id TEXT,world_id TEXT,world_epoch INTEGER,session_id TEXT,
      status TEXT,version INTEGER,created_at INTEGER,expires_at INTEGER,money_reservation_id TEXT,config TEXT);
    CREATE TABLE town_production_log(production_id TEXT,phase TEXT,event_id TEXT,result TEXT,occurred_at INTEGER);
    CREATE TABLE town_production_proofs(production_id TEXT);
    CREATE TABLE town_domain_events(event_id TEXT,world_id TEXT,world_epoch INTEGER,type TEXT,envelope TEXT);`);
  const scope={worldId:'audit',worldEpoch:1};
  const healthy={playerActorId:'player',locationKeys:{board:'board',supplier:'supplier',workshop:'workshop'},
    npcActorIds:{commissioner:'c',supplier:'a',workshop:'b'},
    accounts:{player:'player-account',fund:'fund',commissioner:'c-account',supplier:'a-account',workshop:'b-account'},
    stocks:{supplier:'supplier-stock',workshop:'workshop-stock'}};
  const base={...healthy,[malformed]:null};
  const config={...base,workers:{supplier:'a',workshop:'b'},recipe:PRODUCTION_RECIPE};
  const expected={productionId:'p',...scope,sessionId:'s',status:'completed',version:1,createdAt:1,
    expiresAt:100,moneyReservationId:'r',config};
  db.prepare('INSERT INTO town_business_slices VALUES(?,?,?)').run('audit',1,JSON.stringify(base));
  db.prepare('INSERT INTO town_productions VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('p','audit',1,'s','completed',1,1,100,'r',JSON.stringify(config));
  db.prepare('INSERT INTO town_production_log VALUES(?,?,?,?,?)').run('p','completed','production:p:1',JSON.stringify(expected),2);
  db.prepare('INSERT INTO town_domain_events VALUES(?,?,?,?,?)').run('production:p:1','audit',1,'town.production.changed',JSON.stringify({
    eventId:'production:p:1',...scope,type:'town.production.changed',schemaVersion:1,presentationOnly:false,
    occurredAt:2,source:{system:'town.production',entityId:'p'},locationKey:'supplier',actorIds:['a','b'],
    payload:{productionId:'p',status:'completed',quantity:1},
  }));
  const unlock=createTownServiceUnlock({db,clock:{now:()=>10},registry:{getWorldEpoch:()=>1}});
  db.pragma('query_only=ON');
  assert.equal(unlock(scope),false);
  // A healthy current slice must not make malformed production history throw.
  db.pragma('query_only=OFF');
  db.prepare('UPDATE town_business_slices SET config=?').run(JSON.stringify(healthy));
  db.pragma('query_only=ON');
  assert.equal(unlock(scope),false);
  // Genuine SQL schema failures remain visible instead of becoming SERVICE_LOCKED.
  db.pragma('query_only=OFF');
  db.exec('ALTER TABLE town_productions RENAME COLUMN world_epoch TO broken_epoch');
  db.pragma('query_only=ON');
  assert.throws(()=>unlock(scope), error => error.code === 'SQLITE_ERROR' && /world_epoch/.test(error.message));
});
