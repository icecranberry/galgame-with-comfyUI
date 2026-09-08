// Full runtime fixture adapted from townProductionRuntime/townLiquidityRuntime.
// Set isolation before dynamically importing anything that can initialize SQLite.
process.env.DB_PATH = ':memory:';
const networkAttempts = [];
globalThis.fetch = async url => {
  // Existing config discovery may ask for object_info; answer locally.
  if (String(url).endsWith('/object_info')) return {ok:true,json:async()=>({})};
  networkAttempts.push(String(url)); throw Error('Long-run fixture forbids network');
};
const {config} = await import('../../src/config.js');
const {getDb,closeDb} = await import('../../src/db/index.js');
const town = await import('../../src/services/town/townService.js');
const runtime = await import('../../src/services/town/townEconomyRuntime.js');
const {createNpc} = await import('../../src/services/town/townNpcService.js');
const {saveMap} = await import('../../src/services/town/townMapService.js');
import assert from 'node:assert/strict';

export const DAY = 86400000, START = Date.parse('2026-09-08T10:00:00+08:00');
export function createReplay(t) {
  let now = START, sequence = 0, ticks = 0;
  t.mock.method(Date,'now',()=>now);
  // No wall-clock scheduler callbacks: every observed tick is driven explicitly.
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  config.dbPath = ':memory:';
  const db = getDb(); assert.equal(db.name, ':memory:');
  config.features.town = true; config.features.townLLM = false;
  Object.assign(config.town,{simulation:'legacy',economyEnabled:false,liquidityEnabled:false,
    playerSpeed:1,npcSpeed:1,maxActiveEncounters:0,timeZone:'Asia/Shanghai'});
  const grid = () => Array.from({length:6},()=>Array(6).fill(null));
  const {mapId} = saveMap({name:'long-run runtime fixture',cols:6,rows:6,
    layers:{ground:grid(),road:grid(),objects:[]},locations:[
      {key:'board',name:'公告站',x:0,y:0,radius:0},
      {key:'supplier',name:'原料点',x:4,y:0,radius:0},
      {key:'workshop',name:'工坊',x:4,y:4,radius:0}]});
  for (const [displayName,key,x,y] of [['公告员','board',0,0],['备料员','supplier',4,0],['工坊师傅','workshop',4,4]]) {
    createNpc({mapId,displayName});
    const id = db.prepare('SELECT max(id) id FROM town_npcs').get().id;
    db.prepare('UPDATE town_npcs SET routine_json=? WHERE id=?').run(JSON.stringify([{start:'00:00',end:'24:00',locationKey:key,activity:'固定岗位'}]),id);
    db.prepare('INSERT INTO town_agent_state(agent_key,grid_x,grid_y,current_location_id) VALUES(?,?,?,(SELECT id FROM town_locations WHERE key=?))').run(`npc:${id}`,x,y,key);
  }
  db.prepare("INSERT INTO town_players(id,display_name,grid_x,grid_y) VALUES('me','玩家',0,0)").run();
  town.startTownScheduler();
  const c = runtime.getTownEconomyContext(), scope = c.scope;
  const cmd = () => ({worldEpoch:scope.worldEpoch,idempotencyKey:`longrun:${++sequence}`});
  runtime.setupTownEconomy({...cmd(),npcActorIds:{commissioner:c.registry.resolveAgentKey('npc:1').actorId,
    supplier:c.registry.resolveAgentKey('npc:2').actorId,workshop:c.registry.resolveAgentKey('npc:3').actorId},
    locationKeys:{board:'board',supplier:'supplier',workshop:'workshop'}});
  town.updateTownSettings({liquidityEnabled:true});
  const context = runtime.getTownBusinessRuntime(), slice = context.business.getSlice(scope);
  const scalar = (sql,...args) => db.prepare(sql).get(...args).n;
  const advance = ms => {now += ms;};
  const tick = (ms=60000) => {advance(ms);town.forceTick();ticks++;};
  const move = (x,y) => {
    const result = town.movePlayerTo(x,y); assert.equal(result.ok,true);
    const duration = result.pathLength * 1000 / config.town.playerSpeed;
    advance(duration);
    const position = town.getTownActorPosition(c.player.actorId);
    assert.equal(position.moving,false); assert.equal(position.x,x);assert.equal(position.y,y);
    return duration;
  };
  async function delivery() {
    const started = now, wallet = runtime.getTownWallet().balance;
    move(0,0);
    let order = runtime.executeTownOrder('publish',null,cmd()).order;
    const acceptedAt = now;
    order = runtime.executeTownOrder('accept',order.orderId,{...cmd(),expectedVersion:order.version}).order;
    assert.equal(runtime.getTownWallet().balance,wallet,'no upfront payment');
    for (const [method,x,y] of [['pickup',4,0],['complete',4,4]]) {
      move(x,y);
      const request = {...cmd(),expectedVersion:order.version};
      const result = runtime.executeTownOrder(method,order.orderId,request);
      const before = scalar('SELECT count(*) n FROM economy_transactions');
      assert.deepEqual(runtime.executeTownOrder(method,order.orderId,request),result);
      assert.equal(scalar('SELECT count(*) n FROM economy_transactions'),before);
      order = result.order;
    }
    assert.equal(runtime.getTownWallet().balance-wallet,30);
    return {income:30,travelMs:now-started,entryMs:acceptedAt-started,poor:wallet===0};
  }
  async function consume() {
    let s = await runtime.executeTownService('offer',null,cmd());
    s = await runtime.executeTownService('accept',s.sessionId,{...cmd(),expectedVersion:s.version});
    for (const intentKey of ['choose_theme','confirm_materials','craft','deliver']) {
      const request = {...cmd(),expectedVersion:s.version,intentKey};
      s = await runtime.executeTownService('turn',s.sessionId,request);
      assert.deepEqual(await runtime.executeTownService('turn',s.sessionId,request),s);
    }
    assert.equal(s.status,'completed'); return s;
  }
  function inspect(day) {
    const accounts = db.prepare('SELECT * FROM economy_accounts').all();
    assert.equal(accounts.reduce((s,a)=>s+a.balance,0),0);
    assert(accounts.every(a=>a.account_type==='issuance'||a.balance>=a.reserved&&a.reserved>=0));
    assert.equal(scalar('SELECT count(*) n FROM (SELECT transaction_id FROM economy_entries GROUP BY transaction_id HAVING sum(amount)<>0)'),0);
    assert.equal(scalar('SELECT count(*) n FROM town_resource_stocks WHERE quantity<reserved OR reserved<0'),0);
    assert.equal(scalar(`SELECT count(*) n FROM town_resource_stocks s WHERE quantity<>(SELECT coalesce(sum(quantity_delta),0) FROM town_resource_entries e WHERE e.stock_id=s.stock_id)`),0);
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
    const issued = scalar('SELECT coalesce(sum(amount),0) n FROM town_liquidity_issues');
    assert(issued<=600);
    const money = Object.fromEntries(Object.entries(slice.accounts).map(([role,id])=>[role,accounts.find(a=>a.account_id===id)?.balance]));
    const inventory = Object.fromEntries(Object.entries(slice.stocks).map(([role,id])=>[role,context.economy.getStock({...scope,stockId:id}).quantity]));
    const circulation = accounts.filter(a=>a.account_type!=='issuance').reduce((s,a)=>s+a.balance,0);
    const reclaimed = scalar(`SELECT coalesce(sum(e.amount),0) n FROM economy_entries e JOIN economy_accounts a ON a.account_id=e.account_id WHERE a.account_type='issuance' AND e.amount>0`);
    assert.equal(circulation,3400+issued-reclaimed);
    const statuses = table => Object.fromEntries(db.prepare(`SELECT status,count(*) n FROM ${table} GROUP BY status`).all().map(r=>[r.status,r.n]));
    const unpaid = scalar(`SELECT count(*) n FROM town_delivery_orders o JOIN economy_reservations r ON r.reservation_id=o.money_reservation_id WHERE o.status='completed' AND r.captured<>30`);
    assert.equal(unpaid,0);
    return {day,money,inventory,circulation,issued,reclaimed,unpaidCompleted:unpaid,
      moneyReserved:accounts.reduce((s,a)=>s+a.reserved,0),orders:statuses('town_delivery_orders'),
      services:statuses('town_service_sessions'),production:statuses('town_productions'),
      resource:context.production.getResourceNode(scope).remaining,
      proofs:scalar('SELECT count(*) n FROM town_production_proofs'),
      items:scalar("SELECT count(*) n FROM backpack_items WHERE source_type='service'"),ticks};
  }
  return {db,town,runtime,scope,context,slice,cmd,advance,tick,move,delivery,consume,inspect,scalar,
    get now(){return now;},setNow(value){now=value;},networkAttempts,
    close(){town.stopTownScheduler();closeDb();t.mock.restoreAll();t.mock.timers.reset();}};
}
