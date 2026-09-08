import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileFunction} from 'node:vm';
import Database from 'better-sqlite3';
import {migrateTownItemTemplateSchema} from '../src/db/townItemTemplateSchema.js';
import {migrateTownActionSchema} from '../src/db/townActionSchema.js';
import {createItemTemplateService} from '../src/services/town/itemTemplateService.js';
import * as lifecycle from '../src/services/itemLifecycle.js';

const payload={outfit_name:'波波头发型',outfit_description:'利落波波头：齐下巴的内扣纯色短发、圆润发尾、空气刘海'};
function isolated(db,file,exports,extra={}) {
  const names=[];
  const source=readFileSync(new URL(`../src/services/${file}.js`,import.meta.url),'utf8')
    .replace(/import\s*\{([^}]+)\}\s*from\s*'[^']+';/g,(_,imports)=>{
      names.push(...imports.split(',').map(s=>s.trim()).filter(Boolean));return '';
    }).replace(/export (?=(?:async )?function|const)/g,'');
  const deps={...lifecycle,getDb:()=>db,...extra};
  return compileFunction(`${source}\nreturn {${exports}};`,names)(...names.map(n=>deps[n]??(()=>{throw new Error(`Unexpected dependency ${n}`);} )));
}
function fixture(t) {
  const db=new Database(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE backpack_items(id INTEGER PRIMARY KEY AUTOINCREMENT,effect_key TEXT,name TEXT,
    description TEXT,rarity TEXT DEFAULT 'common',image_url TEXT,status TEXT DEFAULT 'generating',
    payload_json TEXT,collected_at TEXT,acquired_at TEXT DEFAULT CURRENT_TIMESTAMP,used_at TEXT);
    CREATE TABLE characters(id INTEGER PRIMARY KEY,display_name TEXT);INSERT INTO characters VALUES(1,'角色');
    CREATE TABLE item_effects(id INTEGER PRIMARY KEY,item_id INTEGER,character_id INTEGER,effect_key TEXT,payload_json TEXT,expires_at TEXT);
    CREATE TABLE global_outfits(id INTEGER PRIMARY KEY,name TEXT,description TEXT,enabled INTEGER,character_id INTEGER,expires_at TEXT);`);
  migrateTownItemTemplateSchema(db);migrateTownActionSchema(db);
  const outfits=isolated(db,'outfitService','createTemporaryLimitedOutfit');
  const legacy=isolated(db,'itemService','ITEM_EFFECTS,useItem',outfits);
  const scope={worldId:'w',worldEpoch:1};
  const service=createItemTemplateService({db,clock:{now:()=>Date.now()},getWorldEpoch:w=>w==='w'?1:null,
    getActor:()=>null,effectRegistry:legacy.ITEM_EFFECTS});
  const grant=()=>service.grant({...scope,idempotencyKey:'grant',reasonCode:'SERVICE_COMPLETED',
    ownerKey:'me',templateId:'town.bob_cut',templateVersion:1,sourceType:'service',
    sourceId:'service:s1:outcome:bob_cut',quantity:1});
  return {db,scope,service,legacy,grant};
}

test('fixed bob template is explicit and idempotent; original default templates and empty payload contract remain',t=>{
  const f=fixture(t),defaults=f.service.ensureDefaultTemplates(f.scope);
  assert.deepEqual(defaults.map(x=>x.templateId),['town.mood_patch','town.energy_charm']);
  assert.equal(f.service.getTemplate({...f.scope,templateId:'town.bob_cut',version:1}),null);
  const bob=f.service.ensureBobCutTemplate(f.scope);
  assert.equal(bob.templateId,'town.bob_cut');assert.equal(bob.version,1);assert.equal(bob.effectKey,'bob_cut');assert.deepEqual(bob.payload,payload);
  assert.deepEqual(f.service.ensureBobCutTemplate(f.scope),bob);
  for(const old of defaults) {
    assert.deepEqual(old.payload,{});
    assert.throws(()=>f.service.publishTemplate({...f.scope,...old,templateId:`bad.${old.templateId}`,payload}),{code:'INVALID_TEMPLATE_PAYLOAD'});
  }
});

test('bob accepts only fixed identity/version/effect and exact payload; grant revalidates persisted payload',t=>{
  const f=fixture(t),bob=f.service.ensureBobCutTemplate(f.scope);
  for(const invalid of [{},{...payload,outfit_name:'任意发型'},{...payload,outfit_description:'任意描述'},
    {...payload,durationHours:48},{...payload,effectKey:'energy'},[],null]) {
    assert.throws(()=>f.service.publishTemplate({...f.scope,...bob,payload:invalid}),{code:'INVALID_TEMPLATE_PAYLOAD'});
  }
  for(const changes of [{templateId:'arbitrary.bob'},{version:2},{effectKey:'twin_tails'},{effectKey:'mood_fix',payload:{}}]) {
    assert.throws(()=>f.service.publishTemplate({...f.scope,...bob,...changes}),{code:'UNSUPPORTED_TEMPLATE_EFFECT'});
  }
  assert.throws(()=>f.db.prepare('UPDATE item_templates SET payload_json=? WHERE template_id=?')
    .run(JSON.stringify({...payload,durationHours:48}),'town.bob_cut'),/Immutable item record/);
  // Simulate an imported bad record without disabling the real immutability trigger.
  const imported=fixture(t);
  imported.db.prepare('INSERT INTO item_templates VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('w','town.bob_cut',1,'bob_cut',bob.name,bob.description,JSON.stringify({...payload,durationHours:48}),'common',null,1);
  assert.throws(imported.grant,{code:'INVALID_TEMPLATE_PAYLOAD'});
  assert.equal(imported.db.prepare('SELECT COUNT(*) n FROM backpack_items').get().n,0);
});

test('grant only creates a ready backpack card; real manual use applies original hairstyle for 24h exactly once',t=>{
  const f=fixture(t);f.service.ensureBobCutTemplate(f.scope);
  const receipt=f.grant(),id=receipt.itemIds[0];assert.deepEqual(f.grant(),receipt);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM global_outfits').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM item_effects').get().n,0);
  const item=f.db.prepare('SELECT * FROM backpack_items WHERE id=?').get(id);
  assert.equal(item.status,'ready');assert.equal(item.owner_key,'me');assert.ok(item.collected_at);
  assert.deepEqual(JSON.parse(item.payload_json),payload);
  const before=Date.now(),result=f.legacy.useItem(id,1),after=Date.now();assert.equal(result.ok,true);
  const outfit=f.db.prepare('SELECT * FROM global_outfits').get();
  assert.equal(outfit.character_id,1);assert.equal(outfit.name,payload.outfit_name);assert.equal(outfit.description,payload.outfit_description);
  const expiry=Date.parse(outfit.expires_at.replace(' ','T')+'Z');
  assert.ok(expiry>=before+24*3600000-1000 && expiry<=after+24*3600000);
  assert.equal(f.db.prepare('SELECT status FROM backpack_items WHERE id=?').get(id).status,'used');
  assert.equal(f.legacy.useItem(id,1).ok,false);assert.deepEqual(f.grant(),receipt);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM global_outfits').get().n,1);
});
