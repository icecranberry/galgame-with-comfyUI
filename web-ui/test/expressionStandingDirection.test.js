import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'

const source = readFileSync(new URL('../src/components/ExpressionStandingManager.vue', import.meta.url), 'utf8')
const script = compileScript(parse(source).descriptor, { id: 'standing-direction-test' })
const bindings = Object.entries(script.imports).filter(([, entry]) => entry.source !== 'vue').map(([name]) => name)
const code = script.content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
  .replace(/^import .* from .*$/gm, '')
  .replace('export default', 'return')

async function fixture(t, policy) {
  const calls = []
  const job = { id: 'paused-job', status: 'paused', slots_json: '["normal"]', request_json: JSON.stringify({ requirement: 'original', outfitScene: 'casual' }) }
  const deps = Object.fromEntries(bindings.map(name => [name, {}]))
  Object.assign(deps, {
    api: {
      listExpressionStandings: async () => ({ slots: [{ id: 'normal' }], jobs: [{ ...job }], busy: true }),
      preflightExpressionStandings: async (...args) => { calls.push(['preflight', ...args]); return { missingCharacters: [] } },
      controlExpressionStandingTask: async (...args) => { calls.push(['control', ...args]) },
    },
    onEvent: () => () => {},
    useStandingOutfitConfirmation: () => ({
      outfitConfirmation: Vue.ref({ open: false }), chooseOutfitPolicy() {},
      confirmStandingOutfits: async preflight => { await preflight(); return policy },
    }),
  })
  const component = new Function('Vue', ...bindings, code)(Vue, ...bindings.map(name => deps[name]))
  let state
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() {
    state = component.setup(Vue.reactive({ open: true, character: { id: 7 }, initialOutfitScene: 'work' }), { expose() {}, emit() {} })
    return () => null
  } })
  app.mount({})
  t.after(() => app.unmount())
  await state.refresh()
  return { state, calls, job }
}

test('paused direction is editable; running and submitting states remain locked', async t => {
  const { state, job } = await fixture(t)
  assert.match(source, /StandingGenerationDirection[^>]*:disabled="directionLocked"/)
  assert.equal(state.requirement.value, 'original')
  assert.equal(state.outfitScene.value, 'casual')
  assert.equal(state.directionLocked.value, false)
  state.requirement.value = 'edited'
  await state.refresh()
  assert.equal(state.requirement.value, 'edited', 'polling must preserve the draft')
  state.controlling.value = true
  assert.equal(state.directionLocked.value, true)
  state.controlling.value = false
  job.status = 'stopping'
  await state.refresh()
  assert.equal(state.directionLocked.value, true)
})

test('restart submits the edited outfit and direction after preflight', async t => {
  const { state, calls } = await fixture(t, 'generate')
  state.requirement.value = 'new direction'
  state.outfitScene.value = 'sleep'
  await state.controlTask('restart')
  assert.deepEqual(calls[1], ['control', 7, 'paused-job', 'restart', { requirement: 'new direction', outfitScene: 'sleep', missingOutfitPolicy: 'generate' }])
  assert.equal(calls[0][0], 'preflight')
  assert.equal(state.controlling.value, false)
})

test('cancelling outfit confirmation leaves the paused task and draft intact', async t => {
  const { state, calls } = await fixture(t, null)
  state.requirement.value = 'keep my draft'
  await state.controlTask('restart')
  assert.equal(calls.filter(call => call[0] === 'control').length, 0)
  assert.equal(state.requirement.value, 'keep my draft')
  assert.equal(state.directionLocked.value, false)
})

test('continue sends no edited direction and does not run preflight', async t => {
  const { state, calls } = await fixture(t)
  state.requirement.value = 'unused draft'
  await state.controlTask('resume')
  assert.deepEqual(calls, [['control', 7, 'paused-job', 'resume', undefined]])
})
