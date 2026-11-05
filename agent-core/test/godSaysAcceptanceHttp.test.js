import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { once } from 'node:events';
import { GOD_MODULE_TOOLS } from '../src/services/godSays/moduleTools.js';
import { GOD_TOOLS, createGodTools } from '../src/services/godSays/tools.js';
import { CONFIRMED_TOOLS } from '../src/services/godSays/changePolicy.js';
import { createGodRepository } from '../src/services/godSays/repository.js';
import { createGodLocalApi } from '../src/services/godSays/localApi.js';
import { godCommitGuard } from '../src/services/godSays/commitGuard.js';

test('全量真实路由清点与业务数据落库验收（合成内存库）',async t=>{
  process.env.DB_PATH=':memory:';
  const imageDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'god-repair-http-'));
  process.env.IMAGES_DIR=imageDirectory;
  t.mock.method(console,'log',()=>{});
  const nativeFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',(url,options)=>{
    if(String(url).endsWith('/object_info')) return Promise.resolve(new Response('{}',{headers:{'Content-Type':'application/json'}}));
    if(!String(url).startsWith('http://127.0.0.1:')) throw new Error('验收禁止外部生成请求');
    return nativeFetch(url,options);
  });
  const {config}=await import('../src/config.js'); config.dbPath=':memory:';
  const {getDb,closeDb}=await import('../src/db/index.js');
  const db=getDb();
  assert.equal(db.name,':memory:');
  const persona='成年图书管理员。\n## 你的外观\n黑发蓝眼白裙。';
  db.prepare('INSERT INTO characters(id,name,display_name,base_prompt) VALUES(101,?,?,?),(102,?,?,?)')
    .run('audit-a','验收角色甲',persona,'audit-b','验收角色乙',persona);
  const app=express(); app.use(express.json()); app.use(godCommitGuard);
  // 所有文本生成固定到本地 fixture，不能走开发环境模型。
  const shortPrompt='晚晴(audit-a)是来自《测试世界》的成年图书管理员。';
  let outfitGenerations=0,promptGenerations=0,imageGenerations=0,scheduleGenerations=0,diaryGenerations=0,appearanceGenerations=0;
  const scheduleDraft=[
    {startTime:'00:00',endTime:'08:00',activity:'睡觉',location:'卧室',replyDelay:-1,tags:['睡眠'],description:'在柔软的床铺上闭眼安睡，呼吸平稳，直到清晨再慢慢睁开双眼。'},
    {startTime:'08:00',endTime:'00:00',activity:'读书',location:'书房',replyDelay:0,tags:['阅读'],description:'坐在书房窗边翻阅厚厚的书籍，偶尔停下来记下阅读时的心得。'},
  ];
  app.post('/audit-model/chat/completions',(req,res)=>{
    const task=req.body.messages.at(-1).content;
    const scenes=typeof task==='string' && task.match(/请设计 ([a-z、]+)，/);
    if(scenes) outfitGenerations++;
    const isSchedule=typeof task==='string'&&task.includes('完整的今日日程安排');
    const isDiary=typeof task==='string'&&task.includes('写一篇今天的日记');
    const isAppearance=typeof task==='string'&&task.includes('用户想要的外观要点');
    if(isSchedule) scheduleGenerations++;
    if(isDiary) diaryGenerations++;
    if(isAppearance) appearanceGenerations++;
    const content=scenes?JSON.stringify({outfits:scenes[1].split('、').map(scene=>({scene,name:'蓝色服装',description:'An angel has golden hair and blue eyes, wearing a deep blue nightdress, barefoot.'}))}):isSchedule?JSON.stringify({activities:scheduleDraft}):isDiary?JSON.stringify({title:'日记新稿',mood:'平静',weather:'晴',content:'已经按规则生成的完整日记新正文。',imagePrompts:['one','two','three']}):isAppearance?'Librarian has black hair and blue eyes, wearing an orange cape.':shortPrompt;
    res.json({choices:[{message:{role:'assistant',content},finish_reason:'stop'}]});
  });
  const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const imports=new Map([...source.matchAll(/import (\w+) from '(\.\/src\/[^']+)';/g)].map(m=>[m[1],m[2]]));
  const normalize=value=>value.replace(/:[a-zA-Z_][\w]*/g,':id');
  const routes=[];
  for(const match of source.matchAll(/app\.use\('([^']+)', wrapRouterAsync\((\w+)\)\)/g)) {
    const [,mount,name]=match;
    const file=imports.get(name);
    assert.ok(file,`实际 app 挂载必须可追溯：${name}`);
    const imported=await import(new URL(`../${file}`,import.meta.url));
    const router=name==='emojiRoutes'?imported.createEmojiRouter({
      generateEmojiPrompts:async(_character,_style,keys)=>{promptGenerations++;return Object.fromEntries(keys.map(key=>[key,`A librarian with black hair and blue eyes, ${key}, generation ${promptGenerations}.`]));},
      generateEmojiImage:async()=>{imageGenerations++;const {saveBase64Image}=await import('../src/services/imagePaths.js');return {ok:true,url:saveBase64Image('emoji',`draft-${imageGenerations}.png`,'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=')};},
    }):imported.default;
    const walk=stack=>stack.flatMap(layer=>layer.handle?.stack && layer.regexp?.fast_slash ? walk(layer.handle.stack) : [layer]);
    for(const layer of walk(router.stack)) {
      if(!layer.route || typeof layer.route.path!=='string') continue;
      const path=mount+(layer.route.path==='/'?'':layer.route.path);
      for(const method of Object.keys(layer.route.methods)) {
        const coveredBy=GOD_MODULE_TOOLS.filter(entry=>entry.method===method.toUpperCase() && normalize(entry.path)===normalize(path)).map(entry=>entry.name);
        routes.push({file,mount,method:method.toUpperCase(),path,coveredBy});
      }
    }
    app.use(mount,router);
  }
  for(const entry of GOD_MODULE_TOOLS) assert.ok(routes.some(r=>r.coveredBy.includes(entry.name)),entry.name);
  if(process.env.LINSHE_GOD_AUDIT_INVENTORY) fs.writeFileSync(process.env.LINSHE_GOD_AUDIT_INVENTORY,JSON.stringify({
    note:'接口覆盖仅指已注册模块工具的 HTTP 方法和路径；不等价于参数、响应及业务语义全覆盖。核心服务工具另列，不按 HTTP 工具统计。',
    tools:GOD_TOOLS.map(tool=>{const entry=GOD_MODULE_TOOLS.find(e=>e.name===tool.function.name);return {name:tool.function.name,module:entry?.module??'神说核心',method:entry?.method,path:entry?.path,confirmation:CONFIRMED_TOOLS.has(tool.function.name),description:tool.function.description};}),routes,
  },null,2));
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  config.port=server.address().port;
  Object.assign(config.llm,{freeEgg:false,apiKey:'audit-fixture',baseURL:`http://127.0.0.1:${server.address().port}/audit-model`,model:'audit-fixture',headers:{},extraBody:{}});
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));closeDb();assert.equal(path.dirname(imageDirectory),fs.realpathSync(os.tmpdir()));fs.rmSync(imageDirectory,{recursive:true});});
  const api=createGodLocalApi({port:server.address().port});
  const repo=createGodRepository(db);
  const run=repo.start('http-acceptance','合成业务验收；用户原样提供的完整外观正文：蓝色斗篷').run;
  const tools=createGodTools(repo, {},{api,generateReplacement:async({source})=>source.replace('黑发','红发')});
  let index=0;
  const execute=(name,args)=>tools.execute({id:`http-audit-${++index}`,function:{name,arguments:JSON.stringify(args)}},run.id,index);
  const approve=async result=>{const draft=tools.changes.get(result.value.change_id);return (await api({method:'POST',path:`/api/god-says/changes/${draft.id}/decision`,body:{version:draft.version,decision:'approve'}})).data;};

  await t.test('AC-H01 真实改名接口确认前零变更，确认后改名且保留人设',async()=>{
    const result=await execute('update_character',{character_id:101,display_name:'晚晴'});
    assert.equal(result.value.status,'awaiting_confirmation');
    assert.equal(db.prepare('SELECT display_name FROM characters WHERE id=101').get().display_name,'验收角色甲');
    assert.equal((await approve(result)).status,'done');
    assert.deepEqual(db.prepare('SELECT display_name,base_prompt FROM characters WHERE id=101').get(),{display_name:'晚晴',base_prompt:persona});
  });
  await t.test('AC-H02 新增独立外观无需确认真实落库，仍未启用',async()=>{
    const result=await execute('create_outfit',{character_id:101,name:'蓝斗篷',description:'蓝色斗篷'});
    assert.equal(result.ok,true,JSON.stringify(result));
    assert.notEqual(result.value.status,'awaiting_confirmation');
    assert.equal(db.prepare("SELECT enabled FROM character_outfits WHERE name='蓝斗篷'").get().enabled,0);
  });
  await t.test('AC-H03 临时变身不能绕过已有外观修改确认',async()=>{
    const outfitId=db.prepare("SELECT id FROM character_outfits WHERE name='蓝斗篷'").get().id;
    db.prepare('UPDATE character_outfits SET enabled=1 WHERE id=?').run(outfitId);
    const result=await execute('inject_character_state',{character_id:101,kind:'transform',name:'红龙',description:'红色龙鳞',hours:2});
    assert.equal(result.ok,true,JSON.stringify(result));
    assert.equal(db.prepare('SELECT enabled FROM character_outfits WHERE id=?').get(outfitId).enabled,1);
    assert.equal(result.value.status,'awaiting_confirmation');
    assert.equal((await approve(result)).status,'done');
    assert.equal(db.prepare('SELECT enabled FROM character_outfits WHERE id=?').get(outfitId).enabled,0);
  });
  let setId;
  await t.test('AC-H04 新建表情包后，已注册工具应能准备第一个表情',async()=>{
    const created=await execute('create_emoji_set',{character_id:101,name:'阅读时光'});
    assert.equal(created.ok,true);
    setId=created.value.data.set.id;
    assert.equal(db.prepare('SELECT COUNT(*) n FROM character_emojis WHERE set_id=?').get(setId).n,0);
    const result=await execute('initialize_emoji_prompts',{character_id:101,set_id:setId});
    assert.equal(result.ok,true,JSON.stringify(result));
    assert.notEqual(result.value.status,'awaiting_confirmation');
    const first=db.prepare('SELECT prompt FROM character_emojis WHERE set_id=? ORDER BY id LIMIT 1').get(setId).prompt;
    const replacement=await execute('initialize_emoji_prompts',{character_id:101,set_id:setId,style:'蓝色调'});
    assert.equal(replacement.value.status,'awaiting_confirmation');
    assert.equal(db.prepare('SELECT prompt FROM character_emojis WHERE set_id=? ORDER BY id LIMIT 1').get(setId).prompt,first);
    const generations=promptGenerations;
    assert.equal((await approve(replacement)).status,'done');
    assert.equal(promptGenerations,generations,'确认后不重新生成提示词');
    assert.notEqual(db.prepare('SELECT prompt FROM character_emojis WHERE set_id=? ORDER BY id LIMIT 1').get(setId).prompt,first);
  });
  await t.test('AC-H05 批量表情出图、状态读取与冻结图片确认',async()=>{
    const started=await execute('generate_emoji_images',{character_id:101,set_id:setId,keys:['开心','难过']});
    assert.equal(started.value.status,'accepted',JSON.stringify(started));
    const deadline=Date.now()+3000;
    while(db.prepare("SELECT COUNT(*) n FROM character_emojis WHERE set_id=? AND status='done'").get(setId).n!==2){assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,10));}
    const read=await execute('read_emoji_set',{set_id:setId});
    assert.equal(read.value.data.emojis.filter(e=>e.status==='done').length,2);
    const old=db.prepare("SELECT image_path FROM character_emojis WHERE set_id=? AND emoji_key='开心'").get(setId).image_path;
    const draft=await execute('generate_emoji_images',{character_id:101,set_id:setId,keys:['开心'],overwrite:true});
    assert.equal(draft.value.status,'awaiting_confirmation',JSON.stringify(draft));
    assert.equal(db.prepare("SELECT image_path FROM character_emojis WHERE set_id=? AND emoji_key='开心'").get(setId).image_path,old);
    const count=imageGenerations;
    assert.equal((await approve(draft)).status,'done');
    assert.equal(imageGenerations,count);
    assert.notEqual(db.prepare("SELECT image_path FROM character_emojis WHERE set_id=? AND emoji_key='开心'").get(setId).image_path,old);
    const mismatch=await execute('initialize_emoji_prompts',{character_id:102,set_id:setId});
    assert.equal(mismatch.ok,false,'不能向另一位角色的套装写入');
  });
  await t.test('AC-H06 天使改名、默认外观与场景服装只修改独立档案',async()=>{
    const residents=db.prepare('SELECT * FROM characters ORDER BY id').all();
    repo.ensureAngel();
    repo.updateAngel({display_name:'验收天使',persona});
    const name=await execute('update_angel',{display_name:'小羽'});
    assert.equal(name.value.status,'awaiting_confirmation');
    assert.equal(repo.ensureAngel().display_name,'验收天使');
    assert.equal((await approve(name)).status,'done');
    assert.equal(repo.ensureAngel().display_name,'小羽');
    const appearance=await execute('apply_angel_appearance',{instruction:'只改红发'});
    assert.equal(repo.ensureAngel().persona,persona);
    assert.equal((await approve(appearance)).status,'done');
    assert.equal(repo.ensureAngel().persona,persona.replace('黑发','红发'));
    const clothes=await execute('generate_angel_outfits',{scenes:['sleep'],instruction:'深蓝睡衣'});
    assert.equal(clothes.value.status,'awaiting_confirmation',JSON.stringify(clothes));
    assert.equal(repo.ensureAngel().outfits.find(o=>o.scene==='sleep').description,'');
    const generations=outfitGenerations;
    assert.equal((await approve(clothes)).status,'done');
    assert.equal(outfitGenerations,generations);
    assert.match(repo.ensureAngel().outfits.find(o=>o.scene==='sleep').description,/deep blue/);
    assert.deepEqual(db.prepare('SELECT * FROM characters ORDER BY id').all(),residents);
  });
  await t.test('AC-H07 日程草稿不覆盖旧安排，确认后不再次调用生成器',async()=>{
    const old=JSON.stringify([{...scheduleDraft[0],activity:'原有睡眠'},{...scheduleDraft[1],activity:'原有安排'}]);
    db.prepare('INSERT INTO schedule_templates(character_id,schedule_json,version) VALUES(?,?,1) ON CONFLICT(character_id) DO UPDATE SET schedule_json=excluded.schedule_json').run(101,old);
    const proposal=await execute('regenerate_schedule',{character_id:101,direction:'下午读书'});
    assert.equal(proposal.value.status,'awaiting_confirmation',JSON.stringify(proposal));
    assert.equal(db.prepare('SELECT schedule_json FROM schedule_templates WHERE character_id=101').get().schedule_json,old);
    const count=scheduleGenerations;
    assert.equal((await approve(proposal)).status,'done');
    assert.equal(scheduleGenerations,count);
    const schedule=JSON.parse(db.prepare('SELECT schedule_json FROM schedule_templates WHERE character_id=101').get().schedule_json);
    assert.equal(schedule[1].activity,'读书');
  });
  await t.test('AC-H08 已有日记只准备完整草稿，取消不会覆盖正文',async()=>{
    db.prepare("INSERT INTO character_diaries(character_id,diary_date,title,content,status) VALUES(101,'2026-11-04','旧题','旧正文','completed')").run();
    const proposal=await execute('generate_diary',{character_id:101,date:'2026-11-04'});
    assert.equal(proposal.value.status,'awaiting_confirmation',JSON.stringify(proposal));
    const draft=tools.changes.get(proposal.value.change_id);
    assert.equal(draft.items[0].preview[0].after,'已经按规则生成的完整日记新正文。');
    assert.equal(db.prepare("SELECT content FROM character_diaries WHERE character_id=101 AND diary_date='2026-11-04'").get().content,'旧正文');
    assert.equal(diaryGenerations,1);
    await tools.changes.decide(draft.id,draft.version,'reject');
    assert.equal(db.prepare("SELECT content FROM character_diaries WHERE character_id=101 AND diary_date='2026-11-04'").get().content,'旧正文');
  });
  await t.test('AC-H09 专属形态设计通过原扩写接口并保存生成的规范正文',async()=>{
    const result=await execute('create_outfit',{character_id:101,name:'橙色斗篷',instruction:'设计一件橙色斗篷'});
    assert.equal(result.ok,true,JSON.stringify(result));
    assert.notEqual(result.value.status,'awaiting_confirmation');
    const saved=db.prepare("SELECT description,enabled FROM character_outfits WHERE character_id=101 AND name='橙色斗篷'").get();
    assert.equal(saved.description,'Librarian has black hair and blue eyes, wearing an orange cape.');
    assert.equal(saved.enabled,0);
    assert.equal(appearanceGenerations,1);
  });
  await t.test('AC-H10 正在生成的日程不能被确认稿抢先覆盖',async()=>{
    const {enterSingleSchedule}=await import('../src/services/scheduleGenerationLock.js');
    const release=enterSingleSchedule(101);
    try {
      const version=db.prepare('SELECT version FROM schedule_templates WHERE character_id=101').get().version;
      const proposal=await execute('regenerate_schedule',{character_id:101,direction:'清晨读书'});
      const applied=await approve(proposal);
      assert.equal(applied.items[0].status,'failed');
      assert.match(applied.items[0].error,/仍在生成/);
      assert.equal(db.prepare('SELECT version FROM schedule_templates WHERE character_id=101').get().version,version);
    } finally {release();}
  });
  await t.test('AC-H11 已有日记任务运行时，确认稿返回冲突而不假报已提交',async()=>{
    const {startDiaryGeneration,isDiaryGenerating}=await import('../src/services/diaryGenerator.js');
    const {getLocalDateKey}=await import('../src/utils/localDate.js');
    const date=getLocalDateKey();
    db.prepare("UPDATE characters SET handwriting_font='lxgw_wenkai' WHERE id=101").run();
    let release;
    const pending=new Promise(resolve=>{release=resolve;});
    const draft={title:'已确认',mood:'平静',weather:'晴',content:'已经确认的日记正文。',imagePrompts:['one','two','three']};
    startDiaryGeneration(101,{date,dependencies:{chat:async()=>JSON.stringify(draft),generateImages:async()=>{await pending;return {ok:[],failedCount:3};}}});
    try {
      assert.equal(isDiaryGenerating(101,date),true);
      await assert.rejects(api({method:'POST',path:'/api/diaries/101/generate',body:{date,draft}}),/仍在生成/);
    } finally {
      release();
      const deadline=Date.now()+3000;
      while(isDiaryGenerating(101,date)){assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,10));}
    }
  });
});
