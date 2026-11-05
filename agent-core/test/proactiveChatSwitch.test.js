import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/services/proactiveChatScheduler.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?$/gm, '').replaceAll('export ', '');
function fixture() {
  const pending = new Map(); let seq = 0; let dbCalls = 0;
  const config = { features: { proactiveChat: false, proactiveChatFreq: 0.5 }, isDev: false };
  const context = vm.createContext({ config, console: { log() {}, warn() {}, error() {} },
    getDb() { dbCalls++; throw new Error('Disabled scheduler accessed DB'); },
    setTimeout(fn) { pending.set(++seq, fn); return seq; }, clearTimeout(id) { pending.delete(id); },
    setInterval(fn) { pending.set(++seq, fn); return seq; }, clearInterval(id) { pending.delete(id); },
  });
  vm.runInContext(source, context);
  return { context, config, pending, dbCalls: () => dbCalls };
}
test('频率调整不隐式修改或持久化主动聊天总开关', () => {
  const src = readFileSync(new URL('../src/config.js', import.meta.url), 'utf8');
  const start = src.indexOf('export function updateProactiveFreq(');
  const fn = src.slice(start, src.indexOf('\n}', start) + 2).replace('export ', '');
  const writes = [];
  const config = { features: { proactiveChat: false, proactiveChatFreq: 0 } };
  const ctx = vm.createContext({ config, persistSettingSync: (...args) => writes.push(args), console: {log(){}} });
  vm.runInContext(fn, ctx);
  ctx.updateProactiveFreq(0.8);
  assert.equal(config.features.proactiveChat, false);
  assert.deepEqual(writes, [['feature_proactiveChatFreq', '0.8']]);
  config.features.proactiveChat = true;
  ctx.updateProactiveFreq(0);
  assert.equal(config.features.proactiveChat, true);
});
test('关闭或零频率时三条自动线均不排期、不读写数据库', async () => {
  const f = fixture();
  for (const flags of [{proactiveChat:false, proactiveChatFreq:0.8}, {proactiveChat:true, proactiveChatFreq:0}]) {
    Object.assign(f.config.features, flags);
    f.context.startProactiveChatScheduler();
    f.context.restartProactiveFreq();
    f.context.startFreqLine(); f.context.startStartupLine();
    await f.context.tick();
    await f.context.forceProactiveNow(undefined, {automatic:true});
    assert.equal(f.pending.size, 0);
    assert.equal(f.dbCalls(), 0);
  }
});
test('关闭清掉启动等待，开关往返后旧回调不能拉起调度或发消息', async () => {
  const f = fixture();
  f.config.features.proactiveChat = true;
  f.context.startProactiveChatScheduler();
  const stale = [...f.pending.values()][0];
  f.context.stopProactiveChatScheduler();
  assert.equal(f.pending.size, 0);
  f.context.startProactiveChatScheduler();
  await stale();
  assert.equal(f.pending.size, 1);
  assert.equal(f.dbCalls(), 0);
  f.config.features.proactiveChat = false;
  f.context.restartProactiveFreq();
  assert.equal(f.pending.size, 0);
});
test('自动线定时回调在执行前再次检查总开关', async () => {
  const f = fixture();
  f.config.features.proactiveChat = true;
  f.context.startFreqLine(); f.context.startStartupLine();
  const callbacks = [...f.pending.values()]; f.pending.clear();
  f.config.features.proactiveChat = false;
  for (const callback of callbacks) await callback();
  assert.equal(f.pending.size, 0);
  assert.equal(f.dbCalls(), 0);
});


test('自动消息生成期间关闭再开启，旧结果不能落库或重新排期', async () => {
  const f = fixture(); f.config.features.proactiveChat = true;
  let finish, reached, writes = 0;
  const ready = new Promise(resolve => { reached = resolve; });
  const greeting = new Promise(resolve => { finish = resolve; });
  Object.assign(f.context, {
    getDb: () => ({ prepare: sql => ({ get: () => sql.includes('FROM characters') ? { id:1,display_name:'test' } : undefined }) }),
    loadAffinity:()=>50, loadEmotionState:()=>({}), getCompositeEmotion:()=>({}), loadOath:()=>null,
    getFreshUnsharedDream:()=>null,
    pendingGreeting:()=>{reached();return greeting}, recordWrite:()=>{writes++},
  });
  vm.runInContext(`generateGreeting=pendingGreeting; pickMotive=()=>({name:'test',imageGen:false});
    loadRelationshipContext=()=>''; loadUserProfile=()=>''; computeProactiveScore=()=>0.5;
    writeProactiveMessage=recordWrite;`, f.context);
  const pending = f.context.forceProactiveNow(1,{automatic:true});
  await ready;
  f.config.features.proactiveChat = false; f.context.restartProactiveFreq();
  f.config.features.proactiveChat = true; f.context.restartProactiveFreq();
  finish({greeting:'旧回复'});
  assert.equal(await pending,null);
  assert.equal(writes,0);
  f.context.stopProactiveChatScheduler();
});
