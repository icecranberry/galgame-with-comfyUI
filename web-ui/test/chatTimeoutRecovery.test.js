import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { useChatStore } from '../src/stores/chat.js'
import { readChatRecovery } from '../src/utils/chatRecovery.js'

const settle = () => new Promise(resolve => setImmediate(resolve))
function fixture(t) {
  t.mock.timers.enable({apis:['setTimeout']})
  const previous = Object.getOwnPropertyDescriptor(globalThis,'localStorage')
  const storage = new Map()
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:key=>storage.get(key), setItem:(key,value)=>storage.set(key,value), removeItem:key=>storage.delete(key),
  }})
  t.after(()=>{ if(previous) Object.defineProperty(globalThis,'localStorage',previous); else delete globalThis.localStorage })
  const requests=[]; let history=[]; let completed=[]
  t.mock.method(globalThis,'fetch',async (url,opts={})=>{
    if(String(url).endsWith('/chat')) {
      const entry={body:JSON.parse(opts.body),signal:opts.signal}
      const stream=new ReadableStream({start(controller){
        entry.controller=controller
        opts.signal.addEventListener('abort',()=>controller.error(new DOMException('Aborted','AbortError')),{once:true})
      }})
      requests.push(entry)
      return new Response(stream,{headers:{'Content-Type':'text/event-stream'}})
    }
    if(String(url).endsWith('/messages')) return Response.json({messages:history,completedClientMsgIds:completed})
    return Response.json({characters:[]})
  })
  setActivePinia(createPinia())
  const store=useChatStore();store.activeCharId=1
  return {store,requests,history(rows,keys=[]){history=rows;completed=keys},
    event(name,data={}) {requests.at(-1).controller.enqueue(new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`))},
    close(){requests.at(-1).controller.close()},
    async tick(ms){t.mock.timers.tick(ms);await settle()},
  }
}
test('首字等待超过30秒、连续输出超过总时长限制都不误中断',async t=>{
  const f=fixture(t);const pending=f.store.sendMessage('慢慢说')
  await settle();await f.tick(90000)
  assert.equal(f.requests[0].signal.aborted,false)
  for(let i=0;i<5;i++) {
    f.event('token',{content:'正在回复。'});await settle();await f.tick(20000)
    assert.equal(f.requests[0].signal.aborted,false)
  }
  f.event('dialogue_saved',{raw_id:2});await settle();f.close();await pending
  assert.equal(f.store.failedTurn,null)
  assert.equal(readChatRecovery(1),null)
  assert.equal(f.store.streaming,false)
})
test('空闲超时确实中止响应体，刷新保留半截回复，重试复用client_msg_id',async t=>{
  const f=fixture(t);const pending=f.store.sendMessage('继续说')
  await settle();const key=f.requests[0].body.client_msg_id
  f.event('msg_saved',{id:10,role:'user',client_msg_id:key})
  f.event('token',{content:'尚未完成的回复'});await settle()
  await f.tick(30001);await pending
  assert.equal(f.requests[0].signal.aborted,true)
  assert.equal(f.store.failedTurn.partial,'尚未完成的回复')
  assert.equal(readChatRecovery(1).clientMsgId,key)
  f.history([{id:10,raw_id:1,role:'user',content:'继续说',client_msg_id:key}])
  setActivePinia(createPinia());const reopened=useChatStore();reopened.activeCharId=1
  await reopened.loadMessages(1)
  assert.equal(reopened.messages.filter(m=>m.role==='user').length,1)
  assert.ok(reopened.messages.some(m=>m.interrupted && m.content==='尚未完成的回复'))
  const retry=reopened.retryFailedMessage();await settle()
  assert.equal(f.requests[1].body.client_msg_id,key)
  f.event('token',{content:'完整回复'});f.event('dialogue_saved',{raw_id:2});await settle()
  f.history([{id:10,raw_id:1,role:'user',content:'继续说',client_msg_id:key},{id:11,raw_id:2,role:'assistant',content:'完整回复'}],[key])
  f.close();await retry
  assert.equal(reopened.messages.filter(m=>m.role==='assistant').length,1)
  assert.equal(readChatRecovery(1),null)
})
test('任意SSE事件续期；完全静默仍在首字超时后退出',async t=>{
  const f=fixture(t);const pending=f.store.sendMessage('你好')
  await settle();await f.tick(110000)
  f.event('context_status',{stage:'thinking'});await settle()
  await f.tick(110000);assert.equal(f.requests[0].signal.aborted,false)
  await f.tick(10001);await pending
  assert.equal(f.requests[0].signal.aborted,true)
  assert.ok(f.store.failedTurn)
})
test('后台已完成但确认事件丢失时，刷新以服务端结果为准清理本机恢复记录',async t=>{
  const f=fixture(t);const pending=f.store.sendMessage('你好')
  await settle();const key=f.requests[0].body.client_msg_id
  f.event('token',{content:'已完成'});await settle();await f.tick(30001);await pending
  f.history([{id:1,role:'user',content:'你好',client_msg_id:key},{id:2,role:'assistant',content:'已完成'}],[key])
  await f.store.loadMessages(1)
  assert.equal(f.store.failedTurn,null)
  assert.equal(f.store.messages.length,2)
  assert.equal(readChatRecovery(1),null)
})

test('梦话流的done收尾与排队响应不留下虚假的重试记录',async t=>{
  const f=fixture(t)
  for(const queued of [false,true]) {
    const pending=f.store.sendMessage('睡了吗')
    await settle()
    if(queued) f.event('queued',{currentActivity:'睡觉',delayMinutes:-1})
    else {f.event('token',{content:'梦话'});f.event('bubble_break');f.event('done')}
    await settle();f.close();await pending
    assert.equal(f.store.failedTurn,null)
    assert.equal(readChatRecovery(1),null)
  }
})
