// 真实模型的意图路由验收；默认跳过。仅合成内存资料，遇到首个写工具即停止，不执行业务副作用。
// LINSHE_GOD_INTENT_LIVE=1；可选 LINSHE_GOD_INTENT_REPORT 指定 JSON 证据输出。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { GOD_TOOLS, validateToolArgs } from '../src/services/godSays/tools.js';
import { capabilityBoundary } from '../src/services/godSays/capabilityBoundary.js';

const cases = [
  ['天使改名','你以后叫小羽，其他设定保持不变。',['update_angel']],
  ['天使默认外观','把你自己的默认发色改成粉色，其他身体特征和衣服都保留。',['apply_angel_appearance']],
  ['天使睡衣','给你自己设计一套深蓝色睡衣，别改默认外观。',['generate_angel_outfits']],
  ['表情初始化','给验收角色甲的表情包组3初始化全部表情提示词，先不生成图片。',['initialize_emoji_prompts']],
  ['表情批量出图','验收角色甲的表情包组3已有全部提示词，请批量生成缺少的图片，不覆盖已有图片。',['generate_emoji_images']],
  ['改显示名称','把验收角色甲的显示名改成晚晴，其他都别改。',['update_character']],
  ['只改发色','把验收角色甲的基础外观改成红发，蓝眼睛和白裙都保留。',['apply_character_appearance']],
  ['生成私服','给验收角色甲设计一套橙色私服。',['generate_scene_outfits']],
  ['修改睡衣','只把验收角色甲的睡衣改成深蓝色，别动其他服装。',['generate_scene_outfits']],
  ['新增专属形态','给验收角色甲新增一个可切换的冰霜骑士专属形态，先不启用。',['create_outfit']],
  ['临时变身','让验收角色甲变成一条红龙，持续两小时。',['inject_character_state']],
  ['关闭专属外观','停用验收角色甲的外观编号7。',['set_outfit_enabled']],
  ['角色朋友圈','让验收角色甲发一条分享新书的朋友圈。',['publish_moment']],
  ['用户朋友圈','以我的身份发朋友圈：今天读完一本好书。',['publish_user_moment']],
  ['生成横图','画一张验收角色甲在图书馆读书的图，1536×1024。',['generate_image']],
  ['天使自拍','给我画一张你在云庭看书的自拍。',['generate_image']],
  ['修改世界观','把世界观1中冬天温暖改为冬天寒冷，保留其他内容。',['rewrite_world_setting','update_world_setting']],
  ['新增世界观','新增一个叫星岛的世界观：天空有浮岛，居民靠风帆旅行。不要启用。',['create_world_setting']],
  ['新增群聊','给验收角色甲和验收角色乙新建一个叫星光茶话会的群聊。',['create_group']],
  ['群聊改名','把编号1的群聊改名为晚风读书会。',['update_group']],
  ['群聊讨论','让编号1的读书会聊聊最近看过的书。',['discuss_in_group']],
  ['未来日程','给验收角色甲安排2026-11-06下午14点到15点在图书馆读书。',['set_schedule']],
  ['重排日程','重新安排验收角色甲今天的日程，下午都留给阅读。',['regenerate_schedule']],
  ['开启奇遇','给验收角色甲开启一段在旧书店发现秘密地图的奇遇。',['create_encounter']],
  ['发信','替我给验收角色甲寄信，正文：明天一起去看书吧。',['send_letter']],
  ['建立关系','把验收角色甲到验收角色乙的关系设为一起读书的朋友。',['create_relationship']],
  ['招募角色','招募一个名叫林夏的成年图书管理员，温柔认真，棕发绿眼。',['recruit_character']],
  ['创建表情包','给验收角色甲创建一套名叫阅读时光的表情包。',['create_emoji_set']],
  ['生成头像','给验收角色甲生成一个新头像候选。',['generate_character_avatar']],
  ['缺失删除工具','删除验收角色甲，确认后彻底删除她。',[]],
  ['缺失图片放大','把相册里任务12的图片放大到4K。',[]],
  ['缺失小镇工具','把小镇的咖啡店改名为星光咖啡。',[]],
];

test('真实模型：合成需求的工具路由（不执行写操作）', {skip:process.env.LINSHE_GOD_INTENT_LIVE!=='1',timeout:900000}, async t => {
  process.env.DB_PATH=':memory:';
  const {config}=await import('../src/config.js');
  config.dbPath=':memory:';
  config.llm.maxTokens=4096;
  const {AGENT_RULES}=await import('../src/services/godSays/runtime.js');
  const {chatAgentStream}=await import('../src/llm/llm-client.js');
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY,display_name TEXT,base_prompt TEXT);
    INSERT INTO characters VALUES(101,'验收角色甲','成年图书管理员，温柔认真。\n## 你的外观\n黑发、蓝眼、白裙。'),
    (102,'验收角色乙','成年画家，好奇活泼。\n## 你的外观\n棕发、绿眼、蓝衬衫。');`);
  t.after(()=>db.close());
  const characters=db.prepare('SELECT * FROM characters').all();
  const results=[];
  t.after(()=>{if(process.env.LINSHE_GOD_INTENT_REPORT) fs.writeFileSync(process.env.LINSHE_GOD_INTENT_REPORT,JSON.stringify({model:config.llm.model,mode:'live-routing-only-no-writes',cases:results},null,2));});
  const context=`你是白金短发、金眼、白羽的成年天使。以下是测试环境已查询到的真实资料，仅供完成本轮任务：\n${JSON.stringify(characters)}\n当地日期2026-11-05。群聊1名为读书会，成员101、102。世界观1名为海岛，正文为“海岛由风帆船连接，冬天温暖”。角色101拥有专属外观7，当前启用；表情包组3属于角色101。天使为独立 god:angel 档案，没有 character_id。`;
  const readResult=name=>{
    if(name==='list_capabilities') return {tools:GOD_TOOLS.map(t=>({name:t.function.name,description:t.function.description}))};
    if(name==='read_angel') return {display_name:'天使',persona:'你是白金短发、金眼、白羽的成年天使。\n## 你的外观\n白金短发、金眼、白羽、白袍。',outfits:[{scene:'work',name:'白袍',description:'白袍'},{scene:'sleep',name:'睡衣',description:''}]};
    if(name==='read_emoji_set') return {set:{id:3,character_id:101,name:'阅读时光'},emojis:[{emoji_key:'开心',prompt:'A happy librarian.',image_path:null,status:'prompt_ready'}]};
    if(name==='list_emoji_categories') return {keys:['开心','难过']};
    if(name==='read_character_source') return characters[0];
    if(name==='inspect_neighbors') return {characters,groups:[{id:1,name:'读书会'}],localDate:'2026-11-05'};
    if(name==='list_world_settings') return {items:[{id:1,name:'海岛',content:'海岛由风帆船连接，冬天温暖'}]};
    if(name==='list_outfits') return [{id:7,character_id:101,name:'骑士',enabled:1}];
    return {characters,localDate:'2026-11-05',scheduleEnabled:true,groups:[{id:1,name:'读书会',members:characters}],outfits:[]};
  };
  const reads=new Set(['inspect_neighbors','read_character','read_character_source','list_capabilities','inspect_changes','inspect_work','recall_memory']);
  const {moduleTool}=await import('../src/services/godSays/moduleTools.js');
  for(const [label,prompt,expected] of cases) {
    if(process.env.LINSHE_GOD_INTENT_CASES && !process.env.LINSHE_GOD_INTENT_CASES.split('|').includes(label)) continue;
    if(Number(process.env.LINSHE_GOD_INTENT_GAP_MS)>0) await new Promise(resolve=>setTimeout(resolve,Math.min(30000,Number(process.env.LINSHE_GOD_INTENT_GAP_MS))));
    await t.test(label,{timeout:65000},async()=>{
      const result={label,prompt,expected,trace:[],writes:[]}; results.push(result);
      const messages=[{role:'system',content:AGENT_RULES},{role:'system',content:context},{role:'user',content:prompt}];
      const signal=AbortSignal.timeout(60000);
      try {
        const boundary=capabilityBoundary(prompt);
        if(boundary) {
          assert.equal(expected.length,0,'受支持的需求不能被边界误拦');
          result.blockedByBackend=true;
          result.trace.push({role:'assistant',content:boundary});
          result.passed=true;
          return;
        }
        for(let round=0;round<4;round++) {
          let response;
          for await(const event of chatAgentStream(messages,{tools:GOD_TOOLS,signal,requestId:`intent-audit/${label}/${round}`,temperature:0.2})) {
            if(event.type==='assistant_end') response=event.message;
          }
          assert.ok(response,'模型必须完整结束');
          result.trace.push(response); messages.push(response);
          if(!response.tool_calls?.length) break;
          for(const call of response.tool_calls) {
            const definition=GOD_TOOLS.find(t=>t.function.name===call.function.name);
            assert.ok(definition,`工具必须已注册：${call.function.name}`);
            const args=JSON.parse(call.function.arguments);
            validateToolArgs(definition.function.parameters,args);
            if(!reads.has(call.function.name) && moduleTool(call.function.name)?.method!=='GET') result.writes.push({name:call.function.name,args});
            else messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify({ok:true,value:readResult(call.function.name)})});
          }
          if(result.writes.length) break;
        }
        if(expected.length) {
          assert.ok(result.writes.some(call=>expected.includes(call.name)),`未选择预期工具，实际：${result.writes.map(c=>c.name).join(',')}`);
          const chosen=result.writes.find(call=>expected.includes(call.name));
          if(chosen.args.character_id!==undefined) assert.equal(chosen.args.character_id,101,'不得串角色');
          if(label==='生成横图') assert.deepEqual([chosen.args.width,chosen.args.height],[1536,1024]);
          if(label==='天使自拍') assert.match(chosen.args.prompt,/白金|金眼|白羽/);
          if(label==='修改睡衣') assert.deepEqual(chosen.args.scenes,['sleep']);
          if(label==='临时变身') assert.deepEqual([chosen.args.kind,chosen.args.hours],['transform',2]);
          if(label==='新增专属形态') {assert.equal(result.writes.some(c=>c.name==='set_outfit_enabled'),false);assert.equal(chosen.args.description,undefined);assert.ok(chosen.args.instruction);}
          if(label==='天使改名') {assert.equal(chosen.args.display_name,'小羽');assert.equal(chosen.args.persona,undefined);}
          if(label==='改显示名称') {assert.equal(chosen.args.display_name,'晚晴');assert.equal(chosen.args.base_prompt,undefined);}
          if(label==='天使睡衣') assert.deepEqual(chosen.args.scenes,['sleep']);
          if(label==='表情初始化'||label==='表情批量出图') assert.equal(chosen.args.set_id,3);
        } else {
          assert.equal(result.writes.length,0,'未接入的能力不得改用其他工具伪装执行');
          const reply=result.trace.map(message=>message.content||'').join('\n');
          assert.match(reply,/不能|无法|不支持|未接入|没有|不具备|做不到/,'必须说明能力边界');
          assert.doesNotMatch(reply,/已经删除|已放大|已经改名|已成功删除/,'未执行不得宣称完成');
        }
        result.passed=true;
      } catch(error) {result.passed=false;result.error=error.message;throw error;}
    });
  }
});
