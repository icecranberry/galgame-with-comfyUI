import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse as parseSfc, compileTemplate } from '@vue/compiler-sfc'
import { parse as parseJs } from '@babel/parser'
import { ref } from 'vue'

const sfcPath = new URL('../src/components/town/TownServiceManager.vue', import.meta.url)
const descriptor = parseSfc(readFileSync(sfcPath, 'utf8')).descriptor
const script = descriptor.scriptSetup.content
const nodes = parseJs(script, { sourceType: 'module' }).program.body

test('服务管理模板能编译，并带来源筛查与来源标记', () => {
  const template = descriptor.template.content
  const compiled = compileTemplate({ source: template, filename: 'TownServiceManager.vue', id: 'service-manager' })
  assert.deepEqual(compiled.errors, [])
  assert.match(template, /<linshe-tabs[^>]*v-model="scope"[^>]*:options="scopeOptions"/)
  assert.match(template, /v-for="npc in filtered"/)
  assert.match(template, /v-if="npc\.source === 'character'"/)
  assert.match(template, /v-else-if="!filtered\.length"/)
})

test('分段筛选按来源过滤名单', () => {
  const declaration = nodes
    .filter(node => node.type === 'VariableDeclaration')
    .flatMap(node => node.declarations)
    .find(item => item.id.name === 'filtered')
  assert.ok(declaration, 'filtered computed 应存在')
  const arrow = declaration.init.arguments[0]
  const rows = [
    { npcId: 1, source: 'npc' },
    { npcId: 2, source: 'character' },
  ]
  const state = { scope: ref('all'), overview: ref(rows) }
  const compute = new Function('state', `with (state) { return (${script.slice(arrow.start, arrow.end)}) }`)(state)
  assert.equal(compute().length, 2)
  state.scope.value = 'character'
  assert.deepEqual(compute().map(r => r.npcId), [2])
  state.scope.value = 'npc'
  assert.deepEqual(compute().map(r => r.npcId), [1])
})

test('分段选项覆盖全部 / 小镇NPC / 酒馆角色', () => {
  const declaration = nodes
    .filter(node => node.type === 'VariableDeclaration')
    .flatMap(node => node.declarations)
    .find(item => item.id.name === 'scopeOptions')
  const options = new Function(`return (${script.slice(declaration.init.start, declaration.init.end)})`)()
  assert.deepEqual(options.map(option => option.value), ['all', 'npc', 'character'])
  assert.deepEqual(options.map(option => option.label), ['全部', '小镇NPC', '酒馆角色'])
})
test('待建档案的酒馆角色：名单里有建档入口，建档后回到常规流程', () => {
  const template = descriptor.template.content
  assert.match(template, /v-if="npc\.pendingProfile"/)
  assert.match(template, /@click="createProfile\(npc\)"/)
  assert.match(template, /待建档案/)
  // 缓存键统一走 npc.key：待建档案的角色还没有 npcId
  assert.match(template, /:key="npc\.key"/)
  assert.doesNotMatch(template, /:key="npc\.npcId"/)

  const scriptText = script
  assert.match(scriptText, /key: item\.npcId != null \? `npc:\$\{item\.npcId\}` : `char:\$\{item\.characterId\}`/)
  assert.match(scriptText, /ensureTownCharacterProfile\(npc\.characterId\)/)
  assert.match(scriptText, /async function createProfile\(npc\)/)
  // 生成 / 换一个 / 刷货架仍然用真正的 npcId 打接口
  assert.match(scriptText, /generateNpcOffers\(npc\.npcId, kind, props\.worldId\)/)
  assert.match(scriptText, /rerollNpcOffer\(npc\.npcId, offer\.id, props\.worldId\)/)
  assert.match(scriptText, /refreshNpcStock\(npc\.npcId, props\.worldId\)/)
})
