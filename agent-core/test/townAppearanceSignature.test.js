import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { centralPersonaFixture } from './fixtures/townAppearanceFixture.js';
import { createTownAppearanceSignature, townAssetAppearanceStatus } from '../src/services/town/townAppearanceSignature.js';

function fixture(t) {
  const db=new Database(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY,name TEXT,display_name TEXT,base_prompt TEXT,short_prompt TEXT,created_at TEXT);
    INSERT INTO characters VALUES(1,'角色','角色','人格\n## 你的外观\n黑色短发','简述','original');
    CREATE TABLE town_npcs(id INTEGER PRIMARY KEY,character_id INTEGER,persona TEXT,display_name TEXT,job TEXT,created_at TEXT);
    INSERT INTO town_npcs VALUES(2,1,'NPC人格\n## 你的外观\n金色长发','店员','工坊','original');`);
  const central=centralPersonaFixture(db),helper=createTownAppearanceSignature({db,
    buildAppearanceSection:central.buildCharacterAppearanceSection,buildPersona:central.buildCharacterPersona});
  const capture=(extra={})=>helper.capture({sourceKind:'character',sourceId:1,mode:'sprite',...extra});
  const outfit=()=>db.exec("INSERT INTO global_outfits VALUES(1,'新发型','蓝色卷发',1,1,'2999-01-01 00:00:00')");
  return {db,central,helper,capture,outfit};
}
test('signature hashes actual central appearance/fallback; capture and status are read-only',t=>{
  const f=fixture(t);f.db.pragma('query_only=ON');const snapshot=f.capture();
  assert.match(snapshot.appearanceInfo,/黑色短发/);snapshot.assertCurrent();
  const asset={status:'ready',image_path:'/old.png',meta:{appearanceSource:snapshot.source}};
  assert.equal(townAssetAppearanceStatus(asset,f.capture()),'current');assert.equal(townAssetAppearanceStatus({meta:{}},snapshot),'unknown');
  f.db.pragma('query_only=OFF');f.db.exec("UPDATE characters SET base_prompt='',short_prompt='备用外观'");
  assert.match(f.capture().appearanceInfo,/备用外观/);assert.equal(townAssetAppearanceStatus(asset,f.capture()),'needs_update');
  assert.equal(asset.status,'ready');assert.equal(asset.image_path,'/old.png');
});
test('outfit apply/remove and lazy expiry invalidate without cleanup writes',t=>{
  const f=fixture(t),base=f.capture();f.outfit();const dressed=f.capture();assert.notEqual(dressed.signature,base.signature);
  assert.match(dressed.appearanceInfo,/蓝色卷发/);assert.throws(base.assertCurrent,{code:'TOWN_ASSET_STALE'});
  f.db.exec("UPDATE global_outfits SET expires_at='2000-01-01 00:00:00'");
  f.db.pragma('query_only=ON');assert.equal(f.capture().signature,base.signature);assert.throws(dressed.assertCurrent,{code:'TOWN_ASSET_STALE'});
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM global_outfits').get().n,1);
});
test('exclusive/limited edits and unrelated fields respect actual central input',t=>{
  const f=fixture(t),before=f.capture();f.db.exec("INSERT INTO character_outfits VALUES(1,1,'铠甲','银色铠甲',1,'original',NULL)");
  assert.notEqual(f.capture().signature,before.signature);const active=f.capture();
  f.db.exec("UPDATE characters SET short_prompt='仅修改精灵不用的简介'");assert.equal(f.capture().signature,active.signature);
  f.db.exec("UPDATE character_outfits SET description='金色铠甲'");assert.notEqual(f.capture().signature,active.signature);
});
test('linked NPC retains NPC persona/source identity and shares only effective character outfits',t=>{
  const f=fixture(t),npc=f.capture({sourceKind:'npc',sourceId:2}),char=f.capture();
  assert.match(npc.appearanceInfo,/金色长发/);assert.match(char.appearanceInfo,/黑色短发/);
  assert.equal(townAssetAppearanceStatus({meta:{appearanceSource:npc.source}},char),'needs_update');
  f.outfit();assert.match(f.capture({sourceKind:'npc',sourceId:2}).appearanceInfo,/蓝色卷发/);
  assert.throws(npc.assertCurrent,{code:'TOWN_ASSET_STALE'});
});
test('portrait fingerprints central short persona exactly; malformed schema errors are not swallowed',t=>{
  const f=fixture(t),portrait=f.capture({mode:'portrait'});
  assert.ok(portrait.appearanceInfo.includes(f.central.buildCharacterPersona(f.db.prepare('SELECT * FROM characters').get(),{variant:'short',person:'角色'})));
  assert.notEqual(portrait.signature,f.capture().signature);
  f.db.exec('DROP TABLE global_outfits');assert.throws(()=>f.capture(),/no such table/);
});

test('malformed JSON signature values are unknown without coercion or throwing',t=>{
  const f=fixture(t),captured=f.capture();
  for(const signature of [{toString:null},{},[],null,42,true,'bad']) {
    const source=JSON.parse(JSON.stringify({...captured.source,signature}));
    assert.equal(townAssetAppearanceStatus({meta:{appearanceSource:source}},captured),'unknown');
  }
});

test('deleted linked character invalidates NPC provenance and removes global outfit injection without changing NPC persona',t=>{
  const f=fixture(t);f.outfit();
  const linked=f.capture({sourceKind:'npc',sourceId:2});
  assert.equal(linked.characterId,1);assert.match(linked.appearanceInfo,/蓝色卷发/);
  f.db.exec('DELETE FROM characters WHERE id=1');f.db.pragma('query_only=ON');
  const unlinked=f.capture({sourceKind:'npc',sourceId:2});
  assert.equal(unlinked.characterId,null);assert.equal(unlinked.source.characterId,null);
  assert.match(unlinked.appearanceInfo,/金色长发/);assert.doesNotMatch(unlinked.appearanceInfo,/蓝色卷发/);
  assert.notEqual(unlinked.signature,linked.signature);
  assert.equal(townAssetAppearanceStatus({meta:{appearanceSource:linked.source}},unlinked),'needs_update');
  assert.throws(linked.assertCurrent,{code:'TOWN_ASSET_STALE'});
  assert.equal(f.db.prepare('SELECT character_id FROM town_npcs WHERE id=2').get().character_id,1);
});

test('no-section sprite intentionally uses short/base fallback instead of old display-name-only input',t=>{
  const f=fixture(t);f.db.exec("UPDATE characters SET base_prompt='没有外观标题的整卡',short_prompt='短卡棕色卷发'");
  assert.equal(f.capture().description,'短卡棕色卷发');assert.match(f.capture().appearanceInfo,/【外观描述（必以此为准）】短卡棕色卷发/);
  assert.equal(townAssetAppearanceStatus({status:'ready',meta:{}},f.capture()),'unknown');
  const first=f.capture();f.db.exec("UPDATE characters SET short_prompt=''");
  assert.equal(f.capture().description,'没有外观标题的整卡');assert.notEqual(f.capture().signature,first.signature);
  f.db.exec("UPDATE characters SET base_prompt=''");assert.equal(f.capture().description,'角色');
});
