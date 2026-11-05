import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { useDiaryStore } from '../src/stores/diary.js'

test('历史失败页恢复错误并允许重试，完成的历史页不能重写',async t=>{
  let posted=0
  let diary={date:'2026-01-01',status:'failed',content:'',error:'服务重启导致日记生成中断，请重试'}
  t.mock.method(globalThis,'fetch',async(url,opts={})=>{
    if(String(url).includes('/history')) return Response.json({diaries:[{date:'2026-01-01',status:'failed'}]})
    if(opts.method==='POST') {posted++;return Response.json({generating:true,diary:{...diary,status:'generating'}})}
    return Response.json({generating:false,diary})
  })
  setActivePinia(createPinia());const store=useDiaryStore()
  await store.openBook({characterId:1,date:'2026-01-01'})
  assert.equal(store.hasDiary,false)
  assert.match(store.error,/重启/)
  assert.equal(store.canGenerate,true)
  assert.equal(store.history[0].status,'failed')
  await store.generate();assert.equal(posted,1);assert.equal(store.generating,true)
  diary={...diary,status:'completed',content:'正文',error:''}
  await store.openBook({characterId:1,date:'2026-01-01'})
  assert.equal(store.canGenerate,false)
  await store.generate();assert.equal(posted,1)
})
