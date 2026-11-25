import { getDb } from '../../db/index.js';
import { createLorebookRepository } from '../../db/lorebookRepository.js';
import { getSystemRules } from '../../db/worldRepository.js';
import { config } from '../../config.js';
import { chatSync } from '../../llm/llm-client.js';
import { prepareLorebook } from './runtime.js';
import { hash } from './engine.js';

let running = false;
export async function probeLorebookCache(worldId) {
  if (running) throw new Error('已有缓存实测正在进行');
  const world = getDb().prepare('SELECT id,name,content FROM world_settings WHERE id=?').get(worldId);
  const book = createLorebookRepository(getDb()).get(worldId);
  if (!world || !book?.enabled) throw new Error('请先保存并启用这套世界观的世界书');
  running = true;
  try {
    const base = [
      {role:'system',content:[getSystemRules({roleplay:false}),world.content ? `<world_setting>\n${world.content}\n</world_setting>`:''].filter(Boolean).join('\n\n')},
      {role:'system',content:'你是邻舍的世界设定检查助手。下面的世界书条目是本次检查的设定资料。任务仅是验证资料可以被读取，始终只输出“检查完成”，不要扮演角色、输出分析过程、状态栏或继续故事。'},
      {role:'system',content:'【角色资料】成年小镇居民，正在了解世界设定。'},
      {role:'user',content:'我们先在小镇广场散步。'},
      {role:'assistant',content:'广场上很安静，路边有一间咖啡馆。'},
      {role:'user',content:'现在坐下来休息。'},
      {role:'assistant',content:'我们在长椅坐下。'},
    ];
    const triggerKeyword = Object.values(book.document.entries)
      .filter(e=>!e.disable && !e.constant).sort((a,b)=>b.order-a.order)
      .flatMap(e=>e.key || []).find(k=>k && !k.startsWith('/') && !k.includes('{{')) || '世界设定';
    const cases = [
      ['首次请求','你好，请完成本次检查。'],
      ['相同请求复用','你好，请完成本次检查。'],
      ['仅变更末条输入','下午好，请完成本次检查。'],
      ['变更关键词触发',`${triggerKeyword}。只输出检查完成。`],
    ];
    const rows=[]; let previous=null;
    for(const [name,input] of cases) {
      const messages=[...base,{role:'user',content:input}];
      const prepared=await prepareLorebook(messages,{worldId,book,dryRun:true,history:messages.slice(3),historyStart:3,historyEnd:messages.length,protectedPrefix:3,characterName:'成年测试角色',maxOutputTokens:64});
      const started=Date.now();
      let commonMessages=0;
      if(previous) while(commonMessages<Math.min(previous.length,prepared.messages.length)&&JSON.stringify(previous[commonMessages])===JSON.stringify(prepared.messages[commonMessages]))commonMessages++;
      const result=await chatSync(prepared.messages,{returnMeta:true,temperature:0,thinking:{type:'disabled'},thinkingEffort:'off',label:`世界书缓存实测:${name}`,timeout:45000,maxRetries:0,retries:0,freeEggFailover:false});
      const usage=result.usage;
      const prompt=usage?.prompt_tokens??usage?.input_tokens??null;
      const cached=usage?.prompt_cache_hit_tokens??usage?.prompt_tokens_details?.cached_tokens??usage?.input_tokens_details?.cached_tokens??usage?.cache_read_input_tokens??null;
      rows.push({name,model:result.model,promptTokens:prompt,cachedTokens:cached,cacheHitRate:prompt>0&&cached!=null?cached/prompt:null,elapsedMs:Date.now()-started,activatedIds:prepared.activation.entries.map(e=>e.uid),activatedCount:prepared.activation.entries.length,requestHash:hash(prepared.messages),commonMessagesWithPrevious:commonMessages,stablePrefixHash:prepared.report.stablePrefixHash,warnings:prepared.report.warnings,usage});
      previous=prepared.messages;
    }
    return {testedAt:new Date().toISOString(),worldId,worldName:world.name,bookName:book.name,revision:book.revision,configuredModel:config.llm.model,rows,note:'真实提供商 usage；缺失缓存字段记为 null，首次请求不保证冷缓存。测试不写聊天记录或世界书持续状态。'};
  } finally { running=false; }
}
