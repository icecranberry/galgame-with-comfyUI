// 用户验收合同：新增直接执行，修改先生成草稿，确认后提交冻结内容。
// 所有业务数据均为合成内存库，外部生成服务不在本测试中调用。
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateGodSaysSchema } from '../src/db/godSaysSchema.js';
import { createGodRepository } from '../src/services/godSays/repository.js';
import { GOD_TOOLS, createGodTools, validateToolArgs } from '../src/services/godSays/tools.js';
import { GOD_MODULE_TOOLS, buildModuleRequest } from '../src/services/godSays/moduleTools.js';
import { validateReplacement } from '../src/services/godSays/replacementPrompt.js';
import { createWorldEventService } from '../src/services/godSays/worldEvents.js';
import { godChangeFields } from '../../web-ui/src/utils/godChangeFields.js';

const original = '认真温柔的成年图书管理员。\n## 你的外观\n黑发、蓝眼、白裙。\n## 其他\n喜欢读书。';
function fixture(t) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY,name TEXT,display_name TEXT,base_prompt TEXT,schedule_enabled INTEGER);
    CREATE TABLE moment_posts(id INTEGER); CREATE TABLE raw_messages(id INTEGER);
    CREATE TABLE group_chats(id INTEGER PRIMARY KEY,name TEXT,topic TEXT);
    CREATE TABLE group_members(id INTEGER PRIMARY KEY,group_id INTEGER,character_id INTEGER);
    CREATE TABLE character_outfits(id INTEGER PRIMARY KEY,character_id INTEGER,name TEXT,description TEXT,scene TEXT,enabled INTEGER);
    CREATE TABLE global_outfits(id INTEGER PRIMARY KEY,character_id INTEGER);
    CREATE TABLE item_effects(id INTEGER PRIMARY KEY,character_id INTEGER);
    CREATE TABLE backpack_items(id INTEGER PRIMARY KEY,name TEXT,description TEXT,status TEXT);
    INSERT INTO backpack_items VALUES(1,'礼物','礼物效果','pending');
    CREATE TABLE media_posts(id INTEGER PRIMARY KEY,favorited_at INTEGER);
    INSERT INTO media_posts VALUES(1,1);
    CREATE TABLE character_diaries(id INTEGER PRIMARY KEY,character_id INTEGER,diary_date TEXT,title TEXT,content TEXT,image_prompts TEXT);
    INSERT INTO character_diaries VALUES(1,1,'2026-11-05','原题','旧日记','[]');
    CREATE TABLE emoji_sets(id INTEGER PRIMARY KEY,character_id INTEGER,name TEXT,is_active INTEGER);
    INSERT INTO emoji_sets VALUES(1,1,'旧套装',1);
    CREATE TABLE character_emojis(id INTEGER PRIMARY KEY,character_id INTEGER,set_id INTEGER,emoji_key TEXT,prompt TEXT,image_path TEXT,status TEXT);
    INSERT INTO character_emojis VALUES(1,1,1,'smile','旧提示词','/images/emoji/old.png','done');
    INSERT INTO group_chats VALUES(1,'读书会','阅读');
    INSERT INTO group_members VALUES(1,1,1);`);
  db.prepare('INSERT INTO characters VALUES(1,?,?,?,1)').run('audit-a','验收角色甲',original);
  db.prepare('INSERT INTO characters VALUES(2,?,?,?,1)').run('audit-b','验收角色乙',original);
  migrateGodSaysSchema(db);
  const repo = createGodRepository(db);
  const run = repo.start('acceptance','合成数据验收；用户原样提供的完整外观正文：蓝色斗篷').run;
  const requests = [];
  const services = {
    api: async request => {
      requests.push(request);
      if (request.path.endsWith('/expand-appearance-draft')) return {status:200,data:{appearance:'A librarian has black hair and blue eyes, wearing a blue cape.'}};
      if (request.path.endsWith('/draft')) return {status:200,data:{draft:{title:'新题',content:'新日记',imagePrompts:['one','two','three']}}};
      if (request.path.endsWith('/regenerate') && request.body.save===false) return {status:200,data:{activities:[{activity:'新安排'}]}};
      if (request.path.endsWith('/prompts') && request.body.save===false) return {status:200,data:{results:[{character_id:1,ok:true,prompts:{smile:'新提示词'}}]}};
      if (request.body?.previewOnly) return {status:200,data:{ok:true,image_path:'/images/emoji/new.png'}};
      if (request.path === '/api/characters/1' && request.method === 'PUT') {
        db.prepare('UPDATE characters SET display_name=COALESCE(?,display_name),base_prompt=COALESCE(?,base_prompt) WHERE id=1')
          .run(request.body.display_name ?? null,request.body.base_prompt ?? null);
      }
      return {status:200,data:{ok:true}};
    },
    generateReplacement: async ({source}) => source.replace('黑发','红发'),
    localDate: () => '2026-11-05', scheduleEnabled: () => true,
    changeSchedule: () => { requests.push({operation:'changeSchedule'}); return {ok:true}; },
    queueSchedule: () => {requests.push({operation:'queueSchedule'});},
  };
  const tools = createGodTools(repo, {queue: () => ({status:'pending'})}, services);
  let index=0;
  const execute = (name,args) => tools.execute({id:`accept-${++index}`,function:{name,arguments:JSON.stringify(args)}},run.id,index);
  t.after(() => db.close());
  return {db,repo,run,requests,tools,execute};
}

test('AC-01 改名确认前不写入，取消后仍不写入', async t => {
  const f=fixture(t);
  const result=await f.execute('update_character',{character_id:1,display_name:'新名字',base_prompt:original});
  assert.equal(result.value.status,'awaiting_confirmation');
  assert.equal(f.db.prepare('SELECT display_name FROM characters WHERE id=1').get().display_name,'验收角色甲');
  assert.equal(f.requests.length,0);
  const draft=f.tools.changes.get(result.value.change_id);
  await f.tools.changes.decide(draft.id,draft.version,'reject');
  await f.tools.changes.decide(draft.id,draft.version,'approve');
  assert.equal(f.requests.length,0);
});

test('AC-02 改名确认卡必须展示新旧名称', async t => {
  const f=fixture(t);
  const result=await f.execute('update_character',{character_id:1,display_name:'新名字',base_prompt:original});
  const item=f.tools.changes.get(result.value.change_id).items[0];
  assert.ok(godChangeFields(item).some(field => field.before==='验收角色甲' && field.after==='新名字'));
});

test('AC-03 改名确认后精确执行且重复确认不重复写入', async t => {
  const f=fixture(t);
  const result=await f.execute('update_character',{character_id:1,display_name:'新名字',base_prompt:original});
  const draft=f.tools.changes.get(result.value.change_id);
  assert.equal((await f.tools.changes.decide(draft.id,draft.version,'approve')).status,'done');
  await f.tools.changes.decide(draft.id,draft.version,'approve');
  assert.equal(f.requests.length,1);
  assert.deepEqual(f.db.prepare('SELECT display_name,base_prompt FROM characters WHERE id=1').get(),{display_name:'新名字',base_prompt:original});
});

test('AC-04 外观修改仅替换原外观段，确认前不写入', async t => {
  const f=fixture(t);
  const result=await f.execute('apply_character_appearance',{character_id:1,instruction:'只改成红发'});
  assert.equal(result.value.status,'awaiting_confirmation');
  assert.equal(f.requests.length,0);
  const draft=f.tools.changes.get(result.value.change_id);
  assert.deepEqual(draft.items[0].preview,[{label:'你的外观',before:'黑发、蓝眼、白裙。',after:'红发、蓝眼、白裙。'}]);
  await f.tools.changes.decide(draft.id,draft.version,'approve');
  assert.equal(f.db.prepare('SELECT base_prompt FROM characters WHERE id=1').get().base_prompt,original.replace('黑发','红发'));
});

const modifying = [
  ['regenerate_schedule',{character_id:1,direction:'改为下午读书'}],
  ['collect_item',{item_id:1}],
  ['use_item',{item_id:1,character_id:1}],
  ['wake_character',{character_id:1}],
  ['set_media_favorite',{post_id:1,favorite:false}],
  ['inject_character_state',{character_id:1,kind:'transform',name:'红龙',description:'红色龙鳞'}],
  ['generate_diary',{character_id:1,date:'2026-11-05'}],
  ['generate_emoji_prompt',{character_id:1,set_id:1,emoji_key:'smile'}],
  ['generate_emoji_image',{character_id:1,set_id:1,emoji_key:'smile'}],
];
for (const [name,args] of modifying) {
  test(`AC-05 修改已有数据不得无确认派发：${name}`, async t => {
    const f=fixture(t);
    const result=await f.execute(name,args);
    assert.equal(result.ok,true,JSON.stringify(result));
    assert.equal(result.value.status,'awaiting_confirmation');
    assert.ok(f.requests.every(request=>request.body?.save===false||request.body?.previewOnly===true||request.path.endsWith('/draft')),'确认前只能生成不写入原内容的草稿');
  });
}

test('AC-06 修改今日日程不得无确认执行', async t => {
  const f=fixture(t);
  await f.execute('set_schedule',{character_id:1,date:'2026-11-05',start_time:'14:00',end_time:'15:00',activity:'读书',location:'书房',description:'阅读一本书'});
  assert.equal(f.requests.length,0);
});

const additions = [
  ['create_group',{name:'新读书会',member_ids:[1,2]}],
  ['create_outfit',{character_id:1,name:'新斗篷',description:'蓝色斗篷'}],
  ['create_relationship',{from_character_id:1,to_character_id:2,relationship_text:'朋友'}],
  ['create_world_setting',{name:'新世界',content:'天空有浮岛。'}],
  ['create_moment_topic',{name:'读书',desc:'分享书目'}],
  ['create_event_type',{name:'遇见新书',desc:'发现新书'}],
  ['create_media_outlet',{name:'读书报',prompt:'记录阅读见闻'}],
];
for (const [name,args] of additions) {
  test(`AC-07 纯新增不应要求确认：${name}`, async t => {
    const f=fixture(t);
    const result=await f.execute(name,args);
    assert.equal(result.ok,true,JSON.stringify(result));
    assert.notEqual(result.value.status,'awaiting_confirmation');
    assert.equal(f.requests.length,1);
  });
}

for (const [name,args] of [
  ['generate_image',{prompt:'验收角色甲在书房读书',width:1024,height:768}],
  ['publish_user_moment',{content:'今天读了一本书。'}],
  ['send_letter',{character_id:1,content:'你好。'}],
]) {
  test(`AC-08 新增内容不确认且派发真实固定接口契约：${name}`, async t => {
    const f=fixture(t);
    const result=await f.execute(name,args);
    assert.equal(result.ok,true,JSON.stringify(result));
    assert.notEqual(result.value.status,'awaiting_confirmation');
    assert.equal(f.requests.length,1);
    assert.equal(f.tools.changes.list(f.run.session_id).length,0);
    if(name==='generate_image') assert.deepEqual(f.requests[0].body,{sceneDesc:args.prompt,mode:'chat',saveToChat:true,width:1024,height:768});
  });
}

test('AC-09 角色朋友圈只建立投递任务，不误报发布完成',async t => {
  const f=fixture(t);
  const result=await f.execute('publish_moment',{character_id:1,instruction:'发现一本新书，想分享阅读心得'});
  assert.equal(result.value.status,'pending');
  assert.equal(f.tools.changes.list(f.run.session_id).length,0);
});

test('AC-10 未注册工具和伪造确认字段不得触发业务接口',async t => {
  const f=fixture(t);
  for(const [name,args] of [['delete_character',{character_id:1}],['apply_character_appearance',{character_id:1,instruction:'红发',confirmed:true}]]) {
    assert.equal((await f.execute(name,args)).ok,false);
  }
  assert.equal(f.requests.length,0);
});

test('AC-11 只改名不应强迫模型重传完整人设', () => {
  const schema=GOD_TOOLS.find(t=>t.function.name==='update_character').function.parameters;
  assert.doesNotThrow(()=>validateToolArgs(schema,{character_id:1,display_name:'新名字'}));
});

for(const value of ['{"appearance":"红发蓝眼白裙"}','### 其他人格\n完全重写角色']) {
  test(`AC-12 外观替换拒绝违反正文格式的结果：${value.slice(0,20)}`,()=>{
    assert.throws(()=>validateReplacement(value,'appearance'));
  });
}

test('AC-13 每个模块工具生成的接口地址都固定在 /api/ 内，编号不泄漏到 body',()=>{
  const sample=schema=>schema.enum?.[0] ?? (schema.type==='integer'? Math.max(schema.minimum??1,1)
    :schema.type==='boolean'?true:schema.type==='array'?Array.from({length:schema.minItems??1},(_,i)=>schema.items.type==='integer'?i+1:sample(schema.items)):'audit');
  for(const entry of GOD_MODULE_TOOLS) {
    const parameters=entry.definition.function.parameters;
    const args=Object.fromEntries(Object.entries(parameters.properties).map(([key,schema])=>[key,sample(schema)]));
    validateToolArgs(parameters,args);
    const request=buildModuleRequest(entry,args,{effectKey:'audit'});
    assert.ok(request.path.startsWith('/api/'),entry.name);
    for(const [,key] of entry.path.matchAll(/:([a-z_]+)/g)) assert.equal(request.body?.[key],undefined,entry.name);
  }
});

test('AC-14 新增独立世界事件不需要确认',async t=>{
  const f=fixture(t);
  const tools=createGodTools(f.repo,createWorldEventService(f.repo), {});
  const result=await tools.execute({id:'new-world',function:{name:'create_world_event',arguments:JSON.stringify({title:'彩虹',fact:'天空出现彩虹',moment_count:0,group_count:0})}},f.run.id,0);
  assert.equal(result.ok,true);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM god_world_events').get().n,1);
  assert.equal(tools.changes.list(f.run.session_id).length,0);
});

test('AC-15 同一新增工具带替代参数时，不得无确认结束旧事件',async t=>{
  const f=fixture(t);
  const world=createWorldEventService(f.repo);
  const previous=world.create({title:'晴天',fact:'今天晴天',moment_count:0,group_count:0},{runId:f.run.id,effectKey:'previous'});
  const tools=createGodTools(f.repo,world, {});
  const result=await tools.execute({id:'replace-world',function:{name:'create_world_event',arguments:JSON.stringify({title:'雨天',fact:'现在下雨',supersedes_id:previous.id,moment_count:0,group_count:0})}},f.run.id,0);
  assert.equal(result.ok,true);
  assert.equal(f.db.prepare('SELECT status FROM god_world_events WHERE id=?').get(previous.id).status,'active');
});

test('AC-16 专属外观设计调用共享生成器，不能用模型自由编写 description 绕过',async t=>{
  const f=fixture(t);
  const fabricated=await f.execute('create_outfit',{character_id:1,name:'新斗篷',description:'模型自由编出的最终描述'});
  assert.equal(fabricated.ok,false);
  assert.equal(f.requests.length,0);
  const result=await f.execute('create_outfit',{character_id:1,name:'新斗篷',instruction:'设计一件蓝色斗篷'});
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(f.requests.length,2);
  assert.equal(f.requests[0].path,'/api/characters/expand-appearance-draft');
  assert.equal(f.requests[1].body.description,'A librarian has black hair and blue eyes, wearing a blue cape.');
});

test('AC-17 旧版改名草稿缺少名字预览时不能提交',async t=>{
  const f=fixture(t);
  const result=await f.execute('update_character',{character_id:1,display_name:'新名字'});
  const draft=f.tools.changes.get(result.value.change_id);
  draft.items[0].preview=[{label:'角色完整资料',before:original,after:original}];
  f.db.prepare('UPDATE god_changes SET items_json=? WHERE id=?').run(JSON.stringify(draft.items),draft.id);
  const applied=await f.tools.changes.decide(draft.id,draft.version,'approve');
  assert.equal(applied.status,'partial');
  assert.equal(f.requests.length,0);
  assert.match(applied.items[0].error,/未展示新名字/);
});
