import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createChangeSets } from '../src/services/godSays/changeSets.js';
import { createBatchTasks } from '../src/services/godSays/batchTasks.js';
import { createGodTools } from '../src/services/godSays/tools.js';
import { migrateGodSaysSchema } from '../src/db/godSaysSchema.js';
import { createGodRepository } from '../src/services/godSays/repository.js';

function setup(t, count = 2) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY,name TEXT,display_name TEXT,base_prompt TEXT);
    CREATE TABLE moment_posts(id INTEGER); CREATE TABLE raw_messages(id INTEGER);
    CREATE TABLE global_outfits(id INTEGER PRIMARY KEY,name TEXT,description TEXT,enabled INTEGER,character_id INTEGER,expires_at TEXT);`);
  const insert = db.prepare('INSERT INTO characters VALUES (?,?,?,?)');
  for (let i=1;i<=count;i++) insert.run(i, `c${i}`, `角色${i}`, `人格${i}\n\n## 你的外观\n黑色长发，蓝眼，白裙，配饰${i}。\n## 其他\n保留尾文${i}`);
  migrateGodSaysSchema(db);
  const repo = createGodRepository(db);
  const run = repo.start('confirmation-tests', '批量红发').run;
  t.after(() => db.close());
  return { db, repo, run };
}

function appearanceServices(db, generations = [], writes = []) {
  return {
    generateReplacement: async input => { generations.push(input); return input.source.replace('黑色', '红色'); },
    api: async request => { writes.push(request); const id = Number(request.path.split('/').at(-1)); db.prepare('UPDATE characters SET base_prompt=? WHERE id=?').run(request.body.base_prompt,id); return { data: { ok:true } }; },
  };
}

test('single and >100 character batch freeze complete drafts; approval applies exactly once, excludes later arrivals', async t => {
  const {db,repo,run} = setup(t, 121);
  const tools = createGodTools(repo, {}, {}, appearanceServices(db));
  const execute = (name,args,id) => tools.execute({id,function:{name,arguments:JSON.stringify(args)}},run.id,0);
  const result = await execute('batch_characters',{tool_name:'apply_character_appearance',arguments_json:JSON.stringify({instruction:'只把发色改红'})},'batch');
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.value.count,121);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM global_outfits').get().n,0);
  const draft = tools.changes.get(result.value.change_id);
  assert.equal(draft.items[0].preview[0].before, '黑色长发，蓝眼，白裙，配饰1。');
  assert.equal(draft.items[0].preview[0].after, '红色长发，蓝眼，白裙，配饰1。');
  assert.equal(draft.items[120].preview[0].after, '红色长发，蓝眼，白裙，配饰121。');
  db.prepare('INSERT INTO characters VALUES (122,?,?,?)').run('new','新人','新人原文');
  await assert.rejects(tools.changes.decide(draft.id,'forged','approve'), {status:409});
  const applied = await tools.changes.decide(draft.id,draft.version,'approve');
  assert.equal(applied.status,'done');
  await tools.changes.decide(draft.id,draft.version,'approve');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM global_outfits').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM global_outfits WHERE character_id=122').get().n,0);
  assert.equal(db.prepare('SELECT base_prompt FROM characters WHERE id=1').get().base_prompt,'人格1\n\n## 你的外观\n红色长发，蓝眼，白裙，配饰1。\n## 其他\n保留尾文1');
  const single = await execute('apply_character_appearance',{character_id:1,instruction:'改成蓝色'},'single');
  const cancelled = tools.changes.get(single.value.change_id);
  await tools.changes.decide(cancelled.id,cancelled.version,'reject');
  await tools.changes.decide(cancelled.id,cancelled.version,'approve');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM global_outfits').get().n,0);
});

test('edited/deleted original, duplicate targets and approval-looking model parameters cannot bypass confirmation', async t => {
  const {db,repo,run} = setup(t);
  const tools = createGodTools(repo, {}, {}, appearanceServices(db));
  const execute = (args,id) => tools.execute({id,function:{name:'apply_character_appearance',arguments:JSON.stringify(args)}},run.id,0);
  const args={character_id:1,instruction:'只把发色改红'};
  const duplicate = await tools.execute({ id: 'duplicate', function: { name: 'batch_characters', arguments: JSON.stringify({ tool_name: 'apply_character_appearance', character_ids: [1,1], arguments_json: '{"instruction":"只把发色改红"}' }) } }, run.id, 0);
  assert.equal(duplicate.ok, false);

  assert.equal((await execute({...args,confirmed:true},'forged')).ok,false);
  const result=await execute(args,'normal');
  const draft=tools.changes.get(result.value.change_id);
  db.prepare('UPDATE characters SET base_prompt=? WHERE id=1').run('用户自行修改');
  await assert.rejects(tools.changes.decide(draft.id,draft.version,'approve'),{status:409});
  assert.equal(tools.changes.get(draft.id).status,'conflict');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM global_outfits').get().n,0);
  const result2=await execute({...args,character_id:2},'deleted');
  const draft2=tools.changes.get(result2.value.change_id);
  db.prepare('DELETE FROM characters WHERE id=2').run();
  await assert.rejects(tools.changes.decide(draft2.id,draft2.version,'approve'),{status:409});
});

test('recruitment generates preview before approval and submits the exact generated content without generating again', async t => {
  const {repo,run}=setup(t); const requests=[];
  const candidate={name:'new',display_name:'新角色',base_prompt:'完整新设定',emotion_baseline:{valence:0.5}};
  const tools=createGodTools(repo,{}, {}, {api:async request=>{requests.push(request);return {data:request.path.endsWith('/generate')?candidate:{id:3}};}});
  const result=await tools.execute({id:'recruit',function:{name:'recruit_character',arguments:JSON.stringify({description:'新角色'})}},run.id,0);
  assert.equal(requests.length,1); assert.equal(requests[0].body.save,false);
  const draft=tools.changes.get(result.value.change_id);
  await tools.changes.decide(draft.id,draft.version,'approve');
  assert.equal(requests.length,2); assert.deepEqual(requests[1].body,candidate);
});

test('batch execution is independent of confirmation and validates all items before any side effect', async t => {
  const {repo,run}=setup(t); let calls=[];
  const batches=createBatchTasks(repo,{changes:{create(){throw new Error('must not confirm reads');}},needsConfirmation:()=>false,
    validate: op=>{if(op.args.invalid)throw new Error('invalid');},execute:async op=>{calls.push(op.args.character_id);return {name:op.label};}});
  await assert.rejects(batches.start({tool_name:'read',arguments_json:'{}',per_character_json:'{"2":{"invalid":true}}'},{runId:run.id}),/invalid/);
  assert.deepEqual(calls,[]);
  const result=await batches.start({tool_name:'read',arguments_json:'{}'},{runId:run.id});
  assert.equal(result.count,2);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[1,2]); assert.equal(batches.list(run.session_id)[0].status,'done');
});

test('uncertain commit remains recorded and cannot be automatically replayed after restart', async t => {
  const {repo,run}=setup(t); let count=0;
  const options={prepare:async op=>op,snapshot:()=>null,apply:async()=>{count++;throw Object.assign(new Error('connection lost'),{uncertain:true});}};
  const changes=createChangeSets(repo,options);
  const created=await changes.create(run.id,'修改',[{name:'sample',args:{}}]);
  const draft=changes.get(created.change_id);
  assert.equal((await changes.decide(draft.id,draft.version,'approve')).items[0].status,'uncertain');
  const restarted=createChangeSets(repo,options);
  await restarted.decide(draft.id,draft.version,'approve');
  assert.equal(count,1);
});


test('world edits preview full old/new text and submit the approved version without a second generation', async t => {
  const { db,repo,run }=setup(t);
  db.exec("CREATE TABLE world_settings(id INTEGER PRIMARY KEY,name TEXT,content TEXT); INSERT INTO world_settings VALUES (1,'海岛','## 地理\n海岛。\n## 气候\n冬天温暖。');");
  const generations=[], writes=[];
  const tools=createGodTools(repo,{}, {}, {generateReplacement:async input=>{generations.push(input);return input.source.replace('温暖','寒冷');},api:async req=>{writes.push(req);db.prepare('UPDATE world_settings SET content=? WHERE id=1').run(req.body.content);return {data:{ok:true}};}});
  const result=await tools.execute({id:'world',function:{name:'rewrite_world_setting',arguments:JSON.stringify({world_id:1,instruction:'冬天改为寒冷'})}},run.id,0);
  assert.equal(result.ok,true,JSON.stringify(result));
  const draft=tools.changes.get(result.value.change_id);
  assert.equal(writes.length,0); assert.equal(generations.length,1);
  assert.equal(draft.items[0].preview[0].after,'## 地理\n海岛。\n## 气候\n冬天寒冷。');
  await tools.changes.decide(draft.id,draft.version,'approve');
  await tools.changes.decide(draft.id,draft.version,'approve');
  assert.equal(generations.length,1);assert.equal(writes.length,1);
  assert.equal(db.prepare('SELECT content FROM world_settings').get().content,draft.items[0].preview[0].after);
});

test('concurrent edits during generation and invalid generation never produce an actionable draft', async t => {
  const {db,repo,run}=setup(t);
  let mode='concurrent';
  const services=appearanceServices(db);
  services.generateReplacement=async input=>{
    if(mode==='concurrent') { db.prepare('UPDATE characters SET base_prompt=? WHERE id=1').run('用户的新资料'); return input.source.replace('黑色','红色'); }
    return '## 你的性格\n不应该覆盖这一段';
  };
  const tools=createGodTools(repo,{}, {}, services);
  const call = id=>tools.execute({id,function:{name:'apply_character_appearance',arguments:JSON.stringify({character_id:mode==='concurrent'?1:2,instruction:'改成红色'})}},run.id,0);
  assert.equal((await call('during')).ok,false);
  assert.equal(tools.changes.list(run.session_id).length,0);
  mode='invalid'; assert.equal((await call('invalid')).ok,false);
  assert.equal(tools.changes.list(run.session_id).length,0);
});
