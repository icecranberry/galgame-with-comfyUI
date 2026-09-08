import Database from 'better-sqlite3';
import { migrateTownSchema } from '../../src/db/townSchema.js';
import { migrateTownActionSchema } from '../../src/db/townActionSchema.js';
import { migrateTownEconomySchema } from '../../src/db/townEconomySchema.js';
import { migrateTownBusinessSchema } from '../../src/db/townBusinessSchema.js';
import { createTownActorRegistry } from '../../src/services/town/townActorRegistry.js';
import { createEconomyService } from '../../src/services/town/economyService.js';
import { createTownBusinessService } from '../../src/services/town/townBusinessService.js';
import { createTownOrderService } from '../../src/services/town/townOrderService.js';
import { createTownMailboxTasks } from '../../src/services/town/townMailboxTasks.js';

export function mailboxTasksFixture(t) {
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');t.after(()=>db.close());
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY);
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY,character_id INTEGER,town_enabled INTEGER DEFAULT 1);
    CREATE TABLE town_characters(character_id INTEGER PRIMARY KEY,town_enabled INTEGER);
    CREATE TABLE town_locations(id INTEGER PRIMARY KEY,key TEXT,name TEXT);
    INSERT INTO town_npcs(id) VALUES(1),(2),(3);
    INSERT INTO town_locations VALUES(1,'board','公告板'),(2,'source','原料站'),(3,'workshop','工坊');`);
  migrateTownSchema(db);migrateTownActionSchema(db);migrateTownEconomySchema(db);migrateTownBusinessSchema(db);
  const registry=createTownActorRegistry(db),world=registry.getWorldState(),scope={worldId:world.worldId,worldEpoch:world.epoch};
  let now=1000,seq=0,arrived='board';const clock={now:()=>now};
  const economy=createEconomyService({db,clock,getWorldEpoch:registry.getWorldEpoch,getActor:registry.getActor});
  const position={getLocation:({locationKey})=>db.prepare('SELECT key AS locationKey FROM town_locations WHERE key=?').get(locationKey),
    hasArrived:({locationKey})=>arrived===locationKey};
  const deps={db,clock,registry,economy,position};
  const business=createTownBusinessService(deps),orders=createTownOrderService(deps);
  const input=(extra={})=>({...scope,idempotencyKey:`key${++seq}`,sourceKey:`source${seq}`,...extra});
  const config=business.setup(input({npcActorIds:{commissioner:registry.resolveAgentKey(-1).actorId,
    supplier:registry.resolveAgentKey(-2).actorId,workshop:registry.resolveAgentKey(-3).actorId},
    locationKeys:{board:'board',supplier:'source',workshop:'workshop'}}));
  const service=createTownMailboxTasks({db,clock,registry}),list=(extra={})=>service.list({...scope,...extra});
  const publish=()=>orders.publish(input()).order;
  const act=(command,order)=>orders[command](input({orderId:order.orderId,expectedVersion:order.version,actorId:config.playerActorId})).order;
  const snapshot=()=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
    .map(({name})=>({name,rows:db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()}));
  return {db,registry,clock,scope,service,list,publish,act,input,orders,config,snapshot,
    arrive:key=>{arrived=key;},advance:ms=>{now+=ms;}};
}

