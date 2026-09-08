import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH=':memory:';
globalThis.fetch=async url=>{
  if(String(url).endsWith('/object_info'))return {ok:true,json:async()=>({})};
  throw Error('Network forbidden in liquidity runtime test');
};
const {config}=await import('../src/config.js');
const {getDb,closeDb}=await import('../src/db/index.js');
const town=await import('../src/services/town/townService.js');
const {createNpc}=await import('../src/services/town/townNpcService.js');
const {saveMap}=await import('../src/services/town/townMapService.js');
const runtime=await import('../src/services/town/townEconomyRuntime.js');
const generation=await import('../src/services/town/townGenerationConfig.js');

test('real liquidity runtime settings, publication guard and legacy/new request retries',async t=>{
  let now=Date.parse('2026-09-08T10:00:00+08:00');t.mock.method(Date,'now',()=>now);
  const db=getDb();config.features.town=true;config.features.townLLM=false;
  config.town.economyEnabled=false;config.town.liquidityEnabled=false;config.town.maxActiveEncounters=0;
  t.after(()=>{town.stopTownScheduler();closeDb();});
  const grid=()=>Array.from({length:6},()=>Array(6).fill(null));
  const {mapId}=saveMap({name:'liquidity fixture',cols:6,rows:6,layers:{ground:grid(),road:grid(),objects:[]},
    locations:[{key:'board',name:'公告',x:0,y:0,radius:0},{key:'supplier',name:'原料',x:4,y:0,radius:0},
      {key:'workshop',name:'工坊',x:4,y:4,radius:0}]});
  for(const displayName of ['公告员','供应商','工坊'])createNpc({mapId,displayName});
  db.prepare("INSERT INTO town_players(id,display_name,grid_x,grid_y) VALUES('me','玩家',0,0)").run();
  town.startTownScheduler();
  let context=runtime.getTownEconomyContext();const {scope}=context;
  const command=idempotencyKey=>({worldEpoch:scope.worldEpoch,idempotencyKey});
  runtime.setupTownEconomy({...command('setup'),npcActorIds:{commissioner:context.registry.resolveAgentKey('npc:1').actorId,
    supplier:context.registry.resolveAgentKey('npc:2').actorId,workshop:context.registry.resolveAgentKey('npc:3').actorId},
    locationKeys:{board:'board',supplier:'supplier',workshop:'workshop'}});
  context=runtime.getTownBusinessRuntime();const slice=context.business.getSlice(scope);let sequence=0;
  const economyCommand=extra=>({...scope,idempotencyKey:`fixture:${++sequence}`,sourceKey:`fixture:${sequence}`,reasonCode:'TEST',...extra});
  const fund=()=>context.economy.getAccount({...scope,accountId:slice.accounts.fund});
  const move=(from,to,amount)=>context.economy.transfer(economyCommand({fromAccountId:from,toAccountId:to,amount}));
  const settings=()=>db.prepare("SELECT setting_value FROM system_settings WHERE setting_key='town_settings'").get()?.setting_value;
  const issued=()=>db.prepare('SELECT COALESCE(SUM(amount),0) n FROM town_liquidity_issues').get().n;
  const expire=()=>{now+=1800000;runtime.maintainTownOrders();};
  const publish=key=>runtime.executeTownOrder('publish',null,command(key));

  await t.test('standalone liquidity status is read-only even with an overdue order awaiting maintenance',()=>{
    const pending=publish('readonly-pending');now+=1800000;
    const beforeChanges=db.prepare('SELECT total_changes() n').get().n;
    const beforeConfig=JSON.stringify(config.town);
    const beforeOrder=db.prepare('SELECT * FROM town_delivery_orders WHERE order_id=?').get(pending.order.orderId);
    const beforeEvents=db.prepare('SELECT count(*) n FROM town_domain_events').get().n;
    db.pragma('query_only=ON');
    try {
      const status=runtime.getTownLiquidityStatus();
      assert.equal(status.worldId,scope.worldId);assert.equal(status.worldEpoch,scope.worldEpoch);
      assert.equal(status.liquidity.availableFund,1970);assert.equal(status.liquidity.enabled,false);
      assert.equal(status.liquidity.grossIssued,0);
      assert.equal(db.prepare('SELECT total_changes() n').get().n,beforeChanges);
      assert.deepEqual(db.prepare('SELECT * FROM town_delivery_orders WHERE order_id=?').get(pending.order.orderId),beforeOrder);
      assert.equal(db.prepare('SELECT count(*) n FROM town_domain_events').get().n,beforeEvents);
      assert.equal(JSON.stringify(config.town),beforeConfig);
    } finally {db.pragma('query_only=OFF');}
    runtime.maintainTownOrders();
    assert.equal(db.prepare('SELECT status FROM town_delivery_orders WHERE order_id=?').get(pending.order.orderId).status,'expired');
    assert.equal(fund().available,2000,'normal writes and recovery resume after query_only is disabled');
  });

  await t.test('late activation rejects whole settings patch before memory or DB changes',()=>{
    move(slice.accounts.fund,slice.accounts.player,fund().available-30);
    const beforeConfig=JSON.stringify(config.town),beforeSettings=settings();
    assert.throws(()=>town.updateTownSettings({liquidityEnabled:true,playerSpeed:2}),{code:'LIQUIDITY_ACTIVATION_RESERVE_REQUIRED'});
    assert.equal(JSON.stringify(config.town),beforeConfig);assert.equal(settings(),beforeSettings);assert.equal(issued(),0);
    move(slice.accounts.player,slice.accounts.fund,30);
  });
  await t.test('second settings write failure rolls generation and whole patch back; activation reads under transaction',st=>{
    const beforeConfig=JSON.stringify(config.town);
    const beforeRows=db.prepare("SELECT * FROM system_settings WHERE setting_key IN ('town_settings','town_generation_settings') ORDER BY setting_key").all();
    const generationRef=config.town.generation;
    let activationReads=0;
    const originalPrepare=db.prepare.bind(db);
    const spy=st.mock.method(db,'prepare',sql=>{
      const statement=originalPrepare(sql);
      if(sql!=='SELECT * FROM economy_accounts WHERE account_id=? AND world_id=?')return statement;
      return new Proxy(statement,{get(target,key){
        if(key==='get')return (...args)=>{
          if(args[0]===slice.accounts.fund){activationReads++;assert.equal(db.inTransaction,true,'activation account check must hold transaction');}
          return target.get(...args);
        };
        const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
      }});
    });
    db.exec(`CREATE TRIGGER liquidity_fail_second_settings BEFORE INSERT ON system_settings
      WHEN NEW.setting_key='town_settings' BEGIN
      SELECT CASE WHEN (SELECT json_extract(setting_value,'$.styleTags') FROM system_settings
        WHERE setting_key='town_generation_settings') <> 'liquidity-rollback-marker'
        THEN RAISE(ABORT,'generation did not reach first write') END;
      SELECT RAISE(ABORT,'injected second settings failure');END;`);
    try {
      assert.throws(()=>town.updateTownSettings({liquidityEnabled:true,playerSpeed:2,tickSeconds:31,
        generation:{styleTags:'liquidity-rollback-marker',steps:{tiles:{artist:'audit-only'}}}}),/injected second settings failure/);
      assert.ok(activationReads>0);
      assert.equal(JSON.stringify(config.town),beforeConfig);assert.equal(config.town.generation,generationRef);
      assert.deepEqual(db.prepare("SELECT * FROM system_settings WHERE setting_key IN ('town_settings','town_generation_settings') ORDER BY setting_key").all(),beforeRows);
      assert.equal(issued(),0);
    } finally {db.exec('DROP TRIGGER liquidity_fail_second_settings');spy.mock.restore();}
  });
  await t.test('standalone generation persistence failure leaves config and database untouched',()=>{
    const beforeConfig=JSON.stringify(config.town),before=generation.getTownGenerationSettings();
    const row=db.prepare("SELECT * FROM system_settings WHERE setting_key='town_generation_settings'").get();
    db.exec(`CREATE TRIGGER liquidity_fail_generation BEFORE INSERT ON system_settings
      WHEN NEW.setting_key='town_generation_settings' BEGIN SELECT RAISE(ABORT,'injected generation failure');END;`);
    try {
      assert.throws(()=>generation.updateTownGenerationSettings({styleTags:'must-not-stick'}),/injected generation failure/);
      assert.equal(JSON.stringify(config.town),beforeConfig);assert.deepEqual(generation.getTownGenerationSettings(),before);
      assert.deepEqual(db.prepare("SELECT * FROM system_settings WHERE setting_key='town_generation_settings'").get(),row);
    } finally {db.exec('DROP TRIGGER liquidity_fail_generation');}
  });
  await t.test('enabling checks reserve but does not mint, publish attaches one real30 grant',()=>{
    const result=town.updateTownSettings({liquidityEnabled:true});assert.equal(result.applied.liquidityEnabled,true);
    assert.equal(issued(),0);assert.equal(fund().available,60);
    const first=publish('policy-first');assert.equal(first.liquidity.issued,30);assert.equal(issued(),30);
    assert.equal(fund().available,60);assert.deepEqual(publish('policy-first'),first);
    const beforeCount=db.prepare('SELECT count(*) n FROM town_delivery_orders').get().n;
    assert.throws(()=>publish('active-blocked'),{code:'ACTIVE_ORDER_EXISTS'});
    assert.equal(db.prepare('SELECT count(*) n FROM town_delivery_orders').get().n,beforeCount);assert.equal(issued(),30);
  });
  await t.test('failed cooldown request leaves no pending order and same key succeeds after24h',()=>{
    expire();move(slice.accounts.fund,slice.accounts.player,30);
    const count=db.prepare('SELECT count(*) n FROM town_delivery_orders').get().n;
    assert.throws(()=>publish('retry-after-cooldown'),{code:'LIQUIDITY_COOLDOWN'});
    assert.equal(db.prepare('SELECT count(*) n FROM town_delivery_orders').get().n,count);
    assert.equal(db.prepare("SELECT count(*) n FROM town_liquidity_requests WHERE request_key='retry-after-cooldown'").get().n,0);
    assert.equal(fund().reserved,0);assert.equal(fund().available,60);
    now+=86400000-1800000;
    const result=publish('retry-after-cooldown');assert.equal(result.liquidity.issued,30);assert.equal(issued(),60);
    assert.deepEqual(publish('retry-after-cooldown'),result);
  });
  await t.test('disabled passthrough and legacy original key retry never create extra order or grant',()=>{
    expire();town.updateTownSettings({liquidityEnabled:false});
    const off=publish('disabled-new');assert.equal(off.liquidity.issued,0);assert.equal(issued(),60);
    assert.deepEqual(publish('disabled-new'),off);expire();
    const legacyKey='legacy-original';
    const legacy=context.orders.publish({...scope,idempotencyKey:legacyKey,actorId:context.player.actorId,
      sourceKey:`publish:${scope.worldEpoch}:${legacyKey}`});
    const count=db.prepare('SELECT count(*) n FROM town_delivery_orders').get().n;
    assert.deepEqual(publish(legacyKey),legacy);assert.equal(issued(),60);
    assert.equal(db.prepare('SELECT count(*) n FROM town_delivery_orders').get().n,count);
    assert.throws(()=>publish('legacy-active-blocked'),{code:'ACTIVE_ORDER_EXISTS'});expire();
    assert.deepEqual(publish(legacyKey),legacy,'historical retry returns original receipt even after expiry');
    assert.equal(db.prepare('SELECT count(*) n FROM town_delivery_orders').get().n,count);
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
  });
});
