import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
globalThis.fetch = async url => {
  if (String(url).endsWith('/object_info')) return { ok: true, json: async () => ({}) };
  throw new Error('Network forbidden in bob-cut chain fixture');
};
const { config } = await import('../src/config.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const town = await import('../src/services/town/townService.js');
const { createNpc } = await import('../src/services/town/townNpcService.js');
const { saveMap } = await import('../src/services/town/townMapService.js');
const runtime = await import('../src/services/town/townEconomyRuntime.js');
const { useItem } = await import('../src/services/itemService.js');
const { getActiveOutfits } = await import('../src/services/outfitService.js');
const { buildCharacterPersona, buildCharacterAppearanceSection } = await import('../src/services/characterPersona.js');
const { createTownAppearanceSignature, townAssetAppearanceStatus } = await import('../src/services/town/townAppearanceSignature.js');

test('B chain: delivery → mood service → real dual work production → bob card → manual use → central appearance stale', async t => {
  // 营业时段是北京时间 09:00–18:00；把模拟时间对齐到最近一个已过去的 10:00（北京），
  // 既落在营业时段内，又保证限时外观的 24 小时到期时间仍在真实时间之后（getActiveOutfits 用 datetime('now')）。
  const beijing = new Date(Date.now() + 8 * 3600000);
  const tenBeijing = Date.UTC(beijing.getUTCFullYear(), beijing.getUTCMonth(), beijing.getUTCDate(), 2, 0, 0);
  let now = tenBeijing <= Date.now() ? tenBeijing : tenBeijing - 24 * 3600000;
  t.mock.method(Date, 'now', () => now);
  const db = getDb(); assert.equal(config.dbPath, ':memory:');
  config.features.town = true; config.features.townLLM = false;
  config.town.simulation = 'legacy'; config.town.economyEnabled = false;
  config.town.playerSpeed = 1; config.town.npcSpeed = 1; config.town.maxActiveEncounters = 0;
  t.after(() => { town.stopTownScheduler(); closeDb(); });
  const grid = () => Array.from({length:6}, () => Array(6).fill(null));
  const { mapId } = saveMap({ name:'B链隔离',cols:6,rows:6,layers:{ground:grid(),road:grid(),objects:[]},locations:[
    {key:'board',name:'公告站',x:0,y:0,radius:0}, {key:'supplier',name:'原料点',x:4,y:0,radius:0},
    {key:'workshop',name:'工坊',x:4,y:4,radius:0},
  ] });
  for (const name of ['公告员','备料员','工坊师傅']) createNpc({mapId,displayName:name});
  // Only source/player fixture setup. Money, stock, work proofs and settlement rows
  // below are exclusively produced by formal runtime commands and simulation ticks.
  db.prepare("INSERT INTO town_players(id,display_name,grid_x,grid_y) VALUES('me','玩家',0,0)").run();
  town.startTownScheduler();
  const state = runtime.getTownEconomyState(), worldEpoch = state.worldEpoch;
  const command = idempotencyKey => ({worldEpoch,idempotencyKey});
  const actors = ['公告员','备料员','工坊师傅'].map(name => state.participants.find(a=>a.displayName===name).actorId);
  runtime.setupTownEconomy({...command('setup'),npcActorIds:{commissioner:actors[0],supplier:actors[1],workshop:actors[2]},
    locationKeys:{board:'board',supplier:'supplier',workshop:'workshop'}});
  const catalog = () => runtime.getTownEconomyState().service.catalog.find(s=>s.serviceKey==='town.workshop.bob_cut');
  assert.equal(catalog().available,false); assert.equal(catalog().reason,'SERVICE_LOCKED');
  await assert.rejects(runtime.executeTownService('offer',null,{...command('locked-bob'),serviceKey:'town.workshop.bob_cut'}),{code:'SERVICE_LOCKED'});
  const tick = () => { now += 60000; town.forceTick(); runtime.maintainTownOrders(); };
  town.forceTick(); tick();
  assert.equal(runtime.getTownEconomyState().service.open,true);
  const walk = (x,y) => { assert.equal(town.movePlayerTo(x,y).ok,true); now += 12000; town.getTownState(); };
  async function earn(prefix) {
    walk(0,0);
    let order=runtime.executeTownOrder('publish',null,command(`${prefix}-publish`)).order;
    for (const [method,x,y] of [['accept',0,0],['pickup',4,0],['complete',4,4]]) {
      walk(x,y); order=runtime.executeTownOrder(method,order.orderId,{...command(`${prefix}-${method}`),expectedVersion:order.version}).order;
    }
    assert.equal(order.status,'completed');assert.equal(runtime.getTownWallet().balance,30);
  }
  async function service(prefix, serviceKey) {
    const offer=await runtime.executeTownService('offer',null,{...command(`${prefix}-offer`),...(serviceKey?{serviceKey}:{})});
    let value=await runtime.executeTownService('accept',offer.sessionId,{...command(`${prefix}-accept`),expectedVersion:offer.version});
    assert.equal(runtime.getTownWallet().balance,0);
    for(const intentKey of ['choose_theme','confirm_materials','craft','deliver']) {
      const input={...command(`${prefix}-${intentKey}`),expectedVersion:value.version,intentKey};
      value=await runtime.executeTownService('turn',value.sessionId,input);
      assert.deepEqual(await runtime.executeTownService('turn',value.sessionId,input),value);
    }
    assert.equal(value.status,'completed',JSON.stringify({prefix,settlement:value.settlement,
      templates:db.prepare('SELECT template_id FROM item_templates').all()}));assert.equal(value.settlement.payout,30);
    assert.equal(value.settlement.itemIds.length,1);return value;
  }
  await earn('mood'); const mood=await service('mood');
  assert.equal(db.prepare('SELECT effect_key FROM backpack_items WHERE id=?').get(mood.settlement.itemIds[0]).effect_key,'mood_fix');
  assert.equal(catalog().available,false);
  let batch;
  for(let i=0;i<40;i++) {
    tick(); batch=runtime.getTownEconomyState().production.batches.find(b=>b.status==='completed');
    if(batch)break;
  }
  assert.ok(batch,'formal simulation must finish a batch without injected proofs');
  assert.equal(batch.worldEpoch,worldEpoch);
  const proofs=db.prepare('SELECT * FROM town_production_proofs WHERE production_id=?').all(batch.productionId);
  assert.equal(proofs.length,2);assert.deepEqual(proofs.map(p=>p.role).sort(),['supplier','workshop']);
  for(const proof of proofs)assert.equal(db.prepare('SELECT status FROM town_actions WHERE id=?').get(proof.action_id).status,'completed');
  assert.equal(catalog().available,true);assert.equal(catalog().price,30);
  const character=db.prepare('SELECT * FROM characters ORDER BY id LIMIT 1').get();
  const signatures=createTownAppearanceSignature({db,buildAppearanceSection:buildCharacterAppearanceSection,buildPersona:buildCharacterPersona});
  const capture=()=>signatures.capture({sourceKind:'character',sourceId:character.id,mode:'sprite'});
  const before=capture();
  // Explicit fake rendered asset: verifies real central signature comparison without image/model calls.
  const oldAsset={status:'ready',image_path:'/fixture/old-sprite.png',meta:{appearanceSource:before.source}};
  const beforeOutfits=getActiveOutfits(character.id);
  await earn('bob');const bob=await service('bob','town.workshop.bob_cut');
  assert.equal(bob.serviceKey,'town.workshop.bob_cut');
  const itemId=bob.settlement.itemIds[0],item=db.prepare('SELECT * FROM backpack_items WHERE id=?').get(itemId);
  assert.equal(item.template_id,'town.bob_cut');assert.equal(item.template_version,1);
  assert.equal(item.source_id,`service:${bob.sessionId}:outcome:bob_cut`);
  assert.equal(item.effect_key,'bob_cut');assert.equal(item.source_type,'service');assert.equal(item.status,'ready');
  assert.ok(item.collected_at);assert.deepEqual(JSON.parse(item.payload_json),{outfit_name:'波波头发型',outfit_description:'利落波波头：齐下巴的内扣纯色短发、圆润发尾、空气刘海'});
  assert.deepEqual(getActiveOutfits(character.id),beforeOutfits);
  assert.equal(townAssetAppearanceStatus(oldAsset,capture()),'current');
  runtime.maintainTownOrders();
  assert.equal(db.prepare('SELECT count(*) n FROM town_appointment_candidates WHERE session_id=?').get(bob.sessionId).n,0);
  assert.equal(useItem(itemId,character.id,{expectedVersion:item.version}).ok,true);
  assert.equal(useItem(itemId,character.id).ok,false);
  const hairstyle=getActiveOutfits(character.id).limited.find(o=>o.name==='波波头发型');
  assert.ok(hairstyle);assert.equal(hairstyle.description,'利落波波头：齐下巴的内扣纯色短发、圆润发尾、空气刘海');
  const expiration=db.prepare('SELECT expires_at FROM global_outfits WHERE id=?').get(hairstyle.id).expires_at;
  assert.equal(Date.parse(expiration.replace(' ','T')+'Z')-now,24*3600000);
  assert.match(buildCharacterPersona(character),/齐下巴的内扣纯色短发/);
  assert.equal(townAssetAppearanceStatus(oldAsset,capture()),'needs_update');
  assert.equal(oldAsset.image_path,'/fixture/old-sprite.png');assert.equal(oldAsset.status,'ready');
});
