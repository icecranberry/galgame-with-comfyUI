import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUTO_ACTION, resolveAutoAction } from '../src/utils/townInitAuto.js'

// 自动推进 = 把手动流程的每一步自动点一遍。
// 这里逐步覆盖状态机，确认「该推进时才推进、该等就等、出错就停」。

test('完成态直接结束，第一步之外的失败即停', () => {
  assert.equal(resolveAutoAction({ step: 'done' }).action, AUTO_ACTION.DONE)
  assert.equal(resolveAutoAction({ step: 'tiles', error: '出图失败' }).action, AUTO_ACTION.STOP)
  assert.equal(resolveAutoAction({ step: 'tiles', error: '出图失败' }).reason, '出图失败')
})

test('配置步：没有蓝图就生成，已有蓝图则同步表单，再建一座重新生成', () => {
  assert.equal(resolveAutoAction({ step: 'config', status: 'idle' }).action, AUTO_ACTION.START)
  assert.equal(resolveAutoAction({ step: 'config', status: 'failed' }).action, AUTO_ACTION.STOP)
  // 蓝图正在生成：等它，不重复触发 start
  assert.equal(resolveAutoAction({ step: 'config', status: 'blueprint' }).action, AUTO_ACTION.WAIT)
  // 蓝图已经生成、只差切步：交给 syncBpForm
  assert.equal(
    resolveAutoAction({ step: 'config', status: 'samples_pending', hasBlueprint: true }).action,
    AUTO_ACTION.SYNC,
  )
  // 「再建一座」：即使上一座已完成，也要重新生成蓝图
  assert.equal(
    resolveAutoAction({ step: 'config', status: 'done', hasBlueprint: true, addingTown: true }).action,
    AUTO_ACTION.START,
  )
})

test('working（断点恢复）等蓝图，到位后同步表单', () => {
  assert.equal(resolveAutoAction({ step: 'working', status: 'blueprint' }).action, AUTO_ACTION.WAIT)
  assert.equal(
    resolveAutoAction({ step: 'working', status: 'samples_pending', hasBlueprint: true }).action,
    AUTO_ACTION.SYNC,
  )
  assert.equal(resolveAutoAction({ step: 'working', status: 'failed' }).action, AUTO_ACTION.STOP)
})

test('清单步：提示词就绪且清单没变就跳过 LLM，否则重新生成', () => {
  assert.equal(
    resolveAutoAction({ step: 'groundList', listCanSkip: true }).action,
    AUTO_ACTION.NEXT_FROM_LIST,
  )
  assert.equal(
    resolveAutoAction({ step: 'groundList', listCanSkip: false }).action,
    AUTO_ACTION.LIST_PROMPTS,
  )
  assert.equal(
    resolveAutoAction({ step: 'buildingList', listCanSkip: true }).action,
    AUTO_ACTION.NEXT_FROM_LIST,
  )
})

test('素材步：缺图就补，齐了就下一步', () => {
  assert.equal(
    resolveAutoAction({ step: 'tiles', stepReady: 2, stepTotal: 5 }).action,
    AUTO_ACTION.GENERATE_ASSETS,
  )
  assert.equal(
    resolveAutoAction({ step: 'tiles', stepReady: 5, stepTotal: 5 }).action,
    AUTO_ACTION.NEXT_STEP,
  )
  assert.equal(
    resolveAutoAction({ step: 'buildings', stepReady: 0, stepTotal: 0 }).action,
    AUTO_ACTION.NEXT_STEP,
  )
})

test('居民步：先建人格卡，再出全员素材，最后进「我」', () => {
  assert.equal(resolveAutoAction({ step: 'npcs', npcCount: 0 }).action, AUTO_ACTION.STOP)
  assert.equal(
    resolveAutoAction({ step: 'npcs', npcCount: 4, personaReady: 2, portraitReady: 0 }).action,
    AUTO_ACTION.COMMIT_NPCS,
  )
  assert.equal(
    resolveAutoAction({ step: 'npcs', npcCount: 4, personaReady: 4, portraitReady: 1 }).action,
    AUTO_ACTION.GEN_NPC_ASSETS,
  )
  assert.equal(
    resolveAutoAction({ step: 'npcs', npcCount: 4, personaReady: 4, portraitReady: 4 }).action,
    AUTO_ACTION.NEXT_STEP,
  )
})

test('「我」步：形象齐了就规划小镇，否则先补形象', () => {
  assert.equal(resolveAutoAction({ step: 'player', playerReady: false }).action, AUTO_ACTION.GEN_PLAYER)
  assert.equal(resolveAutoAction({ step: 'player', playerReady: true }).action, AUTO_ACTION.PLAN_TOWN)
})

test('小镇步：布局没好就等规划，好了确认开镇', () => {
  assert.equal(resolveAutoAction({ step: 'town', status: 'layout_pending' }).action, AUTO_ACTION.PLAN_TOWN)
  assert.equal(resolveAutoAction({ step: 'town', status: 'confirm' }).action, AUTO_ACTION.CONFIRM)
  assert.equal(resolveAutoAction({ step: 'town', status: 'done' }).action, AUTO_ACTION.DONE)
  assert.equal(resolveAutoAction({ step: 'town', status: 'failed' }).action, AUTO_ACTION.STOP)
})

test('未知步骤先等等看，不乱动', () => {
  assert.equal(resolveAutoAction({ step: 'unknown' }).action, AUTO_ACTION.WAIT)
})