import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateGodSaysSchema } from '../src/db/godSaysSchema.js';
import { createGodRepository } from '../src/services/godSays/repository.js';
import { createGodTools } from '../src/services/godSays/tools.js';
import { runGodAgent } from '../src/services/godSays/agent.js';
import { capabilityBoundary } from '../src/services/godSays/capabilityBoundary.js';

function fixture(t,input) {
  const db=new Database(':memory:');
  db.exec('CREATE TABLE characters(id INTEGER PRIMARY KEY,name TEXT,display_name TEXT); CREATE TABLE moment_posts(id INTEGER); CREATE TABLE raw_messages(id INTEGER);');
  migrateGodSaysSchema(db);
  const repo=createGodRepository(db);
  const run=repo.start('boundary-case',input).run;
  t.after(()=>db.close());
  return {db,repo,run};
}
for(const request of ['把小镇的咖啡店改名为星光咖啡','把小镇咖啡店改叫星光咖啡','小镇咖啡店以后就叫星光咖啡','删除验收角色甲','把相册任务12的图片放大到4K']) {
  test(`能力边界在模型与写工具执行之前生效：${request}`,async t=>{
    const {db,repo,run}=fixture(t,request);
    let attempted=0;
    const tools=createGodTools(repo,{create:()=>{attempted++;}}, {api:async()=>{attempted++;}});
    await runGodAgent(run,{repo,tools,prepare:async()=>{attempted++;throw new Error('不得进入模型');},stream:async function*(){attempted++;}});
    assert.equal(attempted,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM god_tool_calls').get().n,0);
    assert.match(db.prepare("SELECT content FROM god_messages WHERE role='assistant'").get().content,/尚未接入/);
    const direct=await tools.execute({id:'substitute',function:{name:'create_world_event',arguments:'{"title":"咖啡店已改名","fact":"咖啡店已改名"}'}},run.id,0);
    assert.equal(direct.stop,true);
    assert.equal(attempted,0);
  });
}
test('小镇作为画面地点仍允许，真实世界叙事仍允许',()=>{
  for(const input of ['画一张她在小镇咖啡店看书的照片','让天空出现一道彩虹，所有人都能看到','让她发一条逛小镇的朋友圈']) assert.equal(capabilityBoundary(input),null);
});
test('未知工具终止同批后续写操作，不给模型替代执行的机会',async t=>{
  const {db,repo,run}=fixture(t,'操作一个尚未接入的模块');
  let writes=0,rounds=0,commits=0;
  const tools=createGodTools(repo, {},{api:async()=>{writes++;}});
  await runGodAgent(run,{repo,tools,prepare:async()=>({messages:[{role:'user',content:run.input}],commit:()=>commits++}),stream:async function*(){rounds++;yield {type:'assistant_end',message:{role:'assistant',content:'',tool_calls:[
    {id:'unknown',function:{name:'edit_unknown_module',arguments:'{}'}},
    {id:'fallback',function:{name:'publish_user_moment',arguments:'{"content":"已经完成修改"}'}},
  ]}};}});
  assert.equal(rounds,1);
  assert.equal(commits,1,'已完成的受阻回合仍提交本次已发送的提示词快照');
  assert.equal(writes,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM god_messages WHERE role='tool'").get().n,2);
  assert.match(db.prepare("SELECT content FROM god_messages WHERE role='assistant' ORDER BY id DESC").get().content,/尚未接入/);
});
test('能力目录声明缺失也触发停止，不能继续改其他实体',async t=>{
  const {repo,run}=fixture(t,'查看未知模块');
  const tools=createGodTools(repo, {},{});
  const result=await tools.execute({id:'capability',function:{name:'list_capabilities',arguments:'{"module":"小镇"}'}},run.id,0);
  assert.equal(result.stop,true);
});
