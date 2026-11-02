import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import { readFileSync } from 'node:fs';
import { migrateLorebooks, createLorebookRepository } from '../src/db/lorebookRepository.js';
import { estimateTokens } from '../src/services/lorebook/engine.js';
import { normalizePreset, compilePreset, injectPreset } from '../src/services/presets/engine.js';
import { createPresetRuntime } from '../src/services/presets/runtime.js';
import { createNarrativeRuntime } from '../src/services/presets/narrative.js';
import { migratePresets, createPresetRepository } from '../src/db/presetRepository.js';
import { createPresetRouter } from '../src/routes/presets.js';
import { config } from '../src/config.js';

const document = (contents, extra = {}) => ({prompts:contents.map((content,i) => ({identifier:String(i),name:`Entry ${i}`,role:'user',content})),...extra});

test('cache placement keeps stable prefix and moves dynamic assignments and their entire dependent suffix to the tail', () => {
  const doc = document(['固定规则', '{{setvar::fixed::固定变量}}', '{{getvar::fixed}}',
    '{{setvar::turn::{{lastusermessage}}}}', '{{getvar::turn}}', '后续规则', '{{unknown_macro}}']);
  const a = compilePreset(doc, { lastUserMessage: '甲' });
  const b = compilePreset(doc, { lastUserMessage: '乙' });
  assert.equal(a.stableContent, '固定规则\n\n固定变量');
  assert.equal(a.stableContent, b.stableContent);
  assert.equal(a.dynamicContent, '甲\n\n后续规则\n\n{{unknown_macro}}');
  const messages = [{ role: 'system', content: 'base' }, { role: 'user', content: '旧问题' },
    { role: 'assistant', content: '旧回复' }, { role: 'user', content: [{ type: 'text', text: '新问题' }, { type: 'image_url', image_url: { url: 'test:image' } }] }];
  const result = injectPreset(messages, a, { placement: 'cache' });
  assert.equal(result[1].content, a.stableContent);
  assert.equal(result.at(-2).content, a.dynamicContent);
  assert.deepEqual(result.at(-1), messages.at(-1));
  const frozen = injectPreset(messages, b, { placement: 'cache', frozenPrefix: true });
  assert.deepEqual(frozen.slice(0, -2), messages.slice(0, -1));
  assert.equal(frozen.at(-2).content, b.dynamicContent);
  const broken = compilePreset(document(['safe', '{{broken']));
  assert.equal(broken.stableContent, 'safe');
  assert.equal(broken.dynamicContent, '{{broken');
});

test('preview traces variable sources through append, nested references and repeated reads without changing injection', () => {
  const input=document(['{{setvar::a::甲😀}}','{{addvar::a::乙}}','{{setvar::b::前{{getvar::a}}后}}','重复甲😀：{{getvar::b}} / {{getvar::a}}']);
  const traced=compilePreset(input,{},undefined,{trace:true});
  assert.equal(traced.content,compilePreset(input).content);
  assert.equal(traced.entries[0].reason,'variables');
  assert.deepEqual(traced.entries[0].ranges.map(r=>traced.content.slice(r.start,r.end)),['甲😀','甲😀']);
  assert.deepEqual(traced.entries[1].ranges.map(r=>traced.content.slice(r.start,r.end)),['乙','乙']);
  assert.deepEqual(traced.entries[2].ranges.map(r=>traced.content.slice(r.start,r.end)),['前甲😀乙后']);
  assert.ok(traced.entries[0].ranges[0].start>traced.content.indexOf('甲😀'));
});

test('preview distinguishes comments, empty expansion, overwritten and unused variables', () => {
  const input=document(['{{setvar::a::old}}','{{setvar::a::new}}','{{setvar::unused::text}}','{{getvar::a}}','{{// nested {{user}} }}','{{description}}','   ']);
  const result=compilePreset(input,{},undefined,{trace:true});
  assert.deepEqual(result.entries[0].ranges,[]);
  assert.deepEqual(result.entries[1].ranges,[{start:0,end:3}]);
  assert.deepEqual(result.entries[2].ranges,[]);
  assert.deepEqual(result.entries.slice(4).map(e=>e.emptyKind),['comment','expansion','blank']);
});

test('numeric, array, random and trim macros preserve source locations in final output', () => {
  const input=document(['{{setvar::n::2}}','{{addvar::n::3}}','{{setvar::list::[]}}','{{addvar::list::item}}','{{setvar::x::text   }}','{{pick::{{getvar::n}}}}/{{getvar::list}}/{{getvar::x}}{{trim}}']);
  const result=compilePreset(input,{random:()=>0},undefined,{trace:true});
  assert.equal(result.content,'5/["item"]/text');
  for(const row of result.entries.slice(0,5)) assert.ok(row.ranges.length);
  assert.deepEqual(result.entries[4].ranges.map(r=>result.content.slice(r.start,r.end)),['text']);
  const nested=document(['{{setvar::a::old}}','{{addvar::a::{{setvar::a::new}}tail}}','{{getvar::a}}']);
  const nestedResult=compilePreset(nested,{},undefined,{trace:true});
  assert.equal(nestedResult.content,'newtail');
  assert.deepEqual(nestedResult.entries[0].ranges,[]);
});

test('preview offsets locate expanded entries even with duplicate text, emoji and non-output entries', () => {
  const input = document(['{{setvar::word::相同😀}}',' {{getvar::word}}\n','ignored','{{getvar::word}}','placeholder','{{// comment}}']);
  input.prompts[4].marker = true;
  input.prompt_order = [{character_id:100001,order:input.prompts.map(p=>({identifier:p.identifier,enabled:p.identifier!=='2'}))}];
  const result = compilePreset(input);
  assert.equal(result.content,' 相同😀\n\n\n相同😀');
  const included = result.entries.filter(e=>e.reason==='included');
  assert.deepEqual(included.map(e=>[e.identifier,e.start,e.end]),[['1',0,6],['3',8,12]]);
  assert.deepEqual(included.map(e=>result.content.slice(e.start,e.end)),[' 相同😀\n','相同😀']);
  assert.ok(result.entries.filter(e=>e.reason!=='included').every(e=>e.start===undefined && e.end===undefined));
});

test('full documents preserve extensions and all profiles byte-for-byte as JSON values', () => {
  const input = document(['A','B'], {temperature:1.1,extensions:{unknown:{x:[1,2]}},prompt_order:[{character_id:100000,order:[{identifier:'1',enabled:true}]},{character_id:100001,order:[{identifier:'0',enabled:false},{identifier:'1',enabled:true}]}]});
  assert.deepEqual(normalizePreset(input),input);
  assert.equal(compilePreset(input).content,'B');
  assert.equal(compilePreset(input,{},100000).content,'B');
  assert.deepEqual(normalizePreset({data:input}),input);
  const flat = {...input,prompt_order:[{identifier:'0',enabled:true}]};
  assert.equal(compilePreset(flat).content,'A');
});

test('prompt order and enable flags are authoritative, absent entries are not silently enabled', () => {
  const input = document(['A','B','C'], {prompt_order:[{character_id:100001,order:[{identifier:'1',enabled:true},{identifier:'0',enabled:false}]}]});
  input.prompts[0].enabled = true;
  assert.equal(compilePreset(input).content,'B');
  input.prompt_order[0].order.unshift({identifier:'2',enabled:true});
  assert.equal(compilePreset(input).content,'C\n\nB');
});

test('ST-only injection controls are stripped without mutating source; old presets have no hidden filters', () => {
  const input = document(['history replacement','{{setvar::v::VALUE}}','{{getvar::v}}','normal']);
  input.prompts[0].identifier='chatHistory';
  Object.assign(input.prompts[1], {injection_trigger:['continue'],injection_position:1,injection_depth:4,injection_order:100,forbid_overrides:true});
  const normalized = normalizePreset(input);
  for (const field of ['injection_trigger','injection_position','injection_depth','injection_order','forbid_overrides']) assert.equal(field in normalized.prompts[1],false);
  assert.equal(normalized.prompts[1].role,'user');
  assert.deepEqual(input.prompts[1].injection_trigger,['continue']);
  assert.equal(compilePreset(input).content,'VALUE\n\nnormal');
  assert.equal(compilePreset(input,{trigger:'continue'}).content,'VALUE\n\nnormal');
});

test('sequential and nested variables, comments, trim, numbers and arrays', () => {
  const input = document(['{{// comment {{user}} }}{{setvar::text::Hello {{char}}}}','{{addvar::text::!}}{{getvar::text}}', '{{setvar::n::2}}{{incvar::n}}{{addvar::n::3}}{{decvar::n}}{{getvar::n}}', '{{setvar::a::[]}}{{addvar::a::x}}{{getvar::a}}', 'a \n{{trim}}\n b']);
  assert.equal(compilePreset(input,{characterName:'Alice'}).content,'Hello Alice!\n\n355\n\n["x"]\n\nab');
  assert.equal(compilePreset(document(['{{getvar::text}}'])).content,'','variables never leak between requests');
});

test('unknown macros are kept and reported; dynamic content is not certified stable', () => {
  const result = compilePreset(document(['{{getglobalvar::x}} / {{user}} / {{lastUserMessage}}']),{userName:'Bob',lastUserMessage:'Hi'});
  assert.equal(result.content,'{{getglobalvar::x}} / Bob / Hi'); assert.equal(result.dynamic,true);
  assert.equal(result.warnings.length,2);
  assert.equal(compilePreset(document(['fixed {{setvar::v::rule}}{{getvar::v}}'])).dynamic,false);
});

test('invalid, duplicate and oversized imports are rejected without evaluation', () => {
  assert.throws(()=>normalizePreset({entries:{}}),/prompts/);
  assert.throws(()=>normalizePreset({prompts:[{identifier:'x'},{identifier:'x'}]}),/重复/);
  assert.throws(()=>normalizePreset(document([{}])),/文本/);
  assert.throws(()=>normalizePreset(document(['x'],{prompt_order:[{character_id:100001,order:[{identifier:'0',enabled:'false'}]}]})),/布尔/);
  assert.throws(()=>compilePreset(document(['x'.repeat(2*1024*1024+1)])),/2 MiB/);
  assert.throws(()=>compilePreset(document(['{{setvar::x::'.repeat(34)+'x'+'}}'.repeat(34)])),/32/);
});

test('one system after system0; all original messages, attachments, history and final user unchanged', () => {
  const messages = [{role:'system',content:'RULES'}, {role:'system',content:'<active_chat_history>unchanged</active_chat_history>'}, {role:'assistant',content:'hello'}, {role:'user',content:[{type:'text',text:'photo'},{type:'image_url',image_url:{url:'data:image/png;base64,AA'}}]}];
  const copy = structuredClone(messages);
  const compiled = compilePreset(document(['preset']));
  const result = injectPreset(messages,compiled);
  assert.deepEqual(result[1],{role:'system',content:'preset'});
  assert.deepEqual(result.filter((_,i)=>i!==1),copy); assert.deepEqual(messages,copy);
  assert.equal(result.at(-1),messages.at(-1));
  assert.equal(injectPreset(messages,{content:''}),messages);
  assert.equal(injectPreset([{role:'user',content:'only'}],compiled)[0].role,'system');
});

test('snapshots freeze random choices, preserve reapply, do not duplicate injection or mutate originals', async () => {
  let randomCalls=0;
  const active={id:1,name:'test',revision:1,document:document(['{{random::A::B}}']),orderId:100001};
  const runtime=createPresetRuntime({getActivePreset:async()=>active,getContext:async()=>({random:()=>{randomCalls++;return 0;}})});
  const original=[{role:'system',content:'base'},{role:'user',content:'task'}];
  const prepared=await runtime.prepare(original);
  const withLore=[original[0],{role:'system',content:'lore'},original[1]];
  const first=prepared.apply(withLore);const retry=prepared.apply(withLore);
  assert.deepEqual(first,retry);assert.equal(randomCalls,1);assert.equal(first[1].content,'A');
  assert.equal(original.length,2);assert.equal(withLore.length,3);
  assert.equal((await runtime.prepare(original,{preset:false})).messages,original);
  const off=createPresetRuntime({getActivePreset:async()=>null,getContext:async()=>{throw Error('must not load context');}});
  assert.equal((await off.prepare(original)).messages,original);
});

test('repository enforces a single active preset, revisions and unchanged document export', () => {
  const db=new Database(':memory:');
  try {
    migratePresets(db);migratePresets(db);const repo=createPresetRepository(db);const doc=normalizePreset(document(['hi']));
    let a=repo.save(null,{name:'A',document:doc});let b=repo.save(null,{name:'B',document:doc});
    assert.equal(repo.active(),null);a=repo.activate(a.id,a.revision,true);b=repo.activate(b.id,b.revision,true);
    assert.equal(repo.active().id,b.id);assert.equal(repo.get(a.id).active,false);
    assert.throws(()=>repo.save(a.id,{name:'stale',document:doc,expectedRevision:a.revision}),/其他窗口/);
    assert.throws(()=>repo.remove(b.id,0),/其他窗口/);
    assert.deepEqual(repo.get(b.id).document,doc);
    // 读取已保存的旧预设时，不得保留不可见的触发限制。
    const legacy = structuredClone(doc);
    Object.assign(legacy.prompts[0], {injection_trigger:['quiet'],injection_depth:9,forbid_overrides:true});
    db.prepare('UPDATE prompt_presets SET document_json=? WHERE id=?').run(JSON.stringify(legacy),b.id);
    assert.deepEqual(repo.get(b.id).document,doc);
    assert.deepEqual(repo.active().document,doc);
    assert.equal(compilePreset(repo.active().document).content,'hi');
    repo.remove(b.id,b.revision);assert.equal(repo.active(),null);assert.equal(repo.list().length,1);
    assert.throws(()=>repo.save(null,{name:'bad',document:{}}),/prompts/);assert.equal(repo.list().length,1);
  } finally {db.close();}
});

test('save and enable is atomic, preserves preview content and rolls back failures', () => {
  const db=new Database(':memory:');
  try {
    migratePresets(db);const repo=createPresetRepository(db);
    const first=repo.save(null,{name:'first',document:document(['first']),activate:true});
    const input=document(['{{setvar::style::style text}}','{{getvar::style}}']);
    const saved=repo.save(null,{name:'second',document:input,activate:true});
    assert.equal(repo.active().id,saved.id);
    assert.equal(repo.get(first.id).active,false);
    assert.equal(compilePreset(repo.get(saved.id).document,{},saved.orderId,{trace:true}).content,'style text');
    const before=repo.list();
    db.exec("CREATE TRIGGER fail_activation BEFORE UPDATE OF active ON prompt_presets WHEN NEW.name='blocked' AND NEW.active=1 BEGIN SELECT RAISE(ABORT,'blocked'); END");
    assert.throws(()=>repo.save(null,{name:'blocked',document:input,activate:true}),/blocked/);
    assert.deepEqual(repo.list(),before);
    assert.throws(()=>repo.save(saved.id,{name:'stale',document:input,activate:true,expectedRevision:0}),/其他窗口/);
    assert.deepEqual(repo.list(),before);
  } finally {db.close();}
});

test('empty preview suggests disabled consumers while leaving saved enable flags untouched', () => {
  const input=document(['{{setvar::style::style text}}','{{getvar::style}}','{{// {{getvar::style}} }}']);
  input.prompt_order=[{character_id:100001,order:[{identifier:'0',enabled:true},{identifier:'1',enabled:false},{identifier:'2',enabled:false}]}];
  const before=structuredClone(input);
  const result=compilePreset(input,{},undefined,{trace:true});
  assert.equal(result.content,'');
  assert.deepEqual(result.outputSuggestions,[{identifier:'1',name:'Entry 1',variables:['style']}]);
  assert.deepEqual(input,before);
});

test('live enable/disable is observed on subsequent direct requests even when the caller reuses its array', async () => {
  let active=null;
  const runtime=createPresetRuntime({getActivePreset:async()=>active,getContext:async()=>({})});
  const messages=[{role:'system',content:'base'},{role:'user',content:'task'}];
  assert.equal((await runtime.prepare(messages)).messages,messages);
  active={document:document(['rules'])};assert.equal((await runtime.prepare(messages)).messages[1].content,'rules');
  active=null;assert.equal((await runtime.prepare(messages)).messages,messages);
});

test('lorebook reserves preset budget without shifting original anchors, and recall reuses the same snapshot', async t => {
  const db=new Database(':memory:');
  db.exec('CREATE TABLE world_settings(id INTEGER PRIMARY KEY,content TEXT); INSERT INTO world_settings VALUES(1,\'\'); CREATE TABLE characters(id INTEGER PRIMARY KEY,name TEXT,display_name TEXT,base_prompt TEXT,short_prompt TEXT)');
  migrateLorebooks(db);
  createLorebookRepository(db).save(1,{document:{entries:{0:{uid:0,constant:true,content:'WORLD',position:4,depth:0}}},settings:{contextTokens:8192,budgetPercent:100,budgetCap:0}});
  let rolls=0;
  const runtime=createPresetRuntime({getActivePreset:async()=>({document:document(['规则'.repeat(100)+'{{random::A::B}}'])}),getContext:async()=>({random:()=>{rolls++;return 0;}})});
  const key='__presetLoreIntegration';globalThis[key]={db,runtime};
  t.after(()=>{db.close();delete globalThis[key];});
  const stub=source=>`data:text/javascript,${encodeURIComponent(source)}`;
  const runtimeUrl=new URL('../src/services/lorebook/runtime.js',import.meta.url);
  const substitutions={
    '../../db/index.js':stub(`export const getDb=()=>globalThis.${key}.db;`),
    '../../db/worldRepository.js':stub(`export const getActiveWorldSetting=()=>({id:1,content:''});export const isWorldSettingHidden=()=>false;export const getSystemRules=()=> 'base';`),
    '../../config.js':stub('export const config={user:{nickname:"User"}};'),
  };
  const source=readFileSync(runtimeUrl,'utf8').replace(/(['"])(\.\.?\/[^'"]+)\1/g,(_,quote,path)=>JSON.stringify(substitutions[path]||new URL(path,runtimeUrl).href));
  const {prepareLorebook}=await import(stub(source));
  const messages=[{role:'system',content:'base'},{role:'system',content:'fixed persona'},{role:'user',content:'task'}];
  const narrative=createNarrativeRuntime({preset:runtime.prepare,lorebook:prepareLorebook});
  const prepared=await narrative.prepareNarrativePrompt(messages,{staticTexts:['base','fixed persona'],cacheBoundary:{index:1,offset:13},maxOutputTokens:64});
  const final={messages:prepared.messages,report:prepared.presetReport};
  const expectedBudget=8192-64-estimateTokens(final.report.content)-4-messages.reduce((n,m)=>n+estimateTokens(m.content)+4,0);
  assert.equal(prepared.activation.budget,expectedBudget);
  assert.equal(final.messages[1].content,'规则'.repeat(100)+'A');
  assert.match(final.messages[2].content,/fixed persona[\s\S]*WORLD/);
  const recalled=await prepared.reapply([messages[0],messages[1],{role:'system',content:'extra memory'},messages[2]]);
  assert.equal(recalled[1].content,final.messages[1].content);
  assert.ok(!prepared.lorebookMessages.some(m=>m.content===final.messages[1].content),'planner context excludes preset');
  const plain=await prepareLorebook(messages,{staticTexts:['base','fixed persona'],cacheBoundary:{index:1,offset:13},maxOutputTokens:64});
  assert.equal(plain.activation.budget,expectedBudget+estimateTokens(final.report.content)+4);
  assert.ok(!plain.messages.some(m=>m.content===final.messages[1].content),'worldbook-only calls never load presets');
  assert.equal(rolls,1);assert.equal(messages.length,3);assert.equal(messages[1].content,'fixed persona');
});

test('HTTP create/save/activate/export/preview/delete and conflicts use isolated persistence', async t => {
  const db=new Database(':memory:');migratePresets(db);const repo=createPresetRepository(db);
  const app=express();app.use(express.json());app.use('/api/presets',createPresetRouter(()=>repo));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const base=`http://127.0.0.1:${server.address().port}/api/presets`;
  const call=async(path='',method='GET',body)=>{const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  let result=await call('','POST',{name:'test',document:document(['rule'])});assert.equal(result.status,201);let item=result.data.item;
  result=await call(`/${item.id}/active`,'PUT',{active:true,expectedRevision:item.revision});assert.equal(result.data.item.active,true);item=result.data.item;
  assert.equal((await call(`/${item.id}`,'PUT',{name:'oops',document:document(['changed']),expectedRevision:0})).status,409);
  assert.deepEqual((await call(`/${item.id}/export`)).data,item.document);
  const preview=await call('/preview','POST',{document:document(['rule'])});assert.equal(preview.data.messages[1].content,'rule');
  const automatic=await call('/preview','POST',{document:document(['Hi {{user}} / {{lastUserMessage}}'])});
  assert.equal(automatic.data.content,`Hi ${config.user.nickname || '用户'} / `);
  assert.equal(automatic.data.messages[1].content,automatic.data.content);
  const overridden=await call('/preview','POST',{document:document(['{{user}}']),context:{userName:'Preview user'}});
  assert.equal(overridden.data.content,'Preview user');
  assert.equal((await call('/preview','POST',{document:{}})).status,400);
  assert.equal((await call(`/${item.id}`,'DELETE',{expectedRevision:item.revision})).status,200);
  assert.deepEqual((await call()).data.items,[]);
});
