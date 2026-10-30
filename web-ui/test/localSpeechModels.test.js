import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'

const source = readFileSync(new URL('../src/components/LocalSpeechModels.vue', import.meta.url), 'utf8')
const code = compileScript(parse(source).descriptor, { id: 'local-model-test' }).content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
  .replace(/^import .* from .*$/gm, '').replace('export default', 'return')
const flush = () => new Promise(resolve => setImmediate(resolve))
function fixture(t, api) {
  let state, stops = 0, count = 0
  const calls = [], events = [], timers = new Map()
  const deps = { Vue, ttsApi: async (...args) => { calls.push(args); return api(...args) }, stopSpeech: () => stops++, LinsheButton: {}, LinsheModal: {},
    setTimeout: fn => { timers.set(++count, fn); return count }, clearTimeout: id => timers.delete(id) }
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps))
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {}, emit: (...args) => events.push(args) }); return () => null } })
  app.mount({}); t.after(() => app.unmount())
  return { state, calls, events, timers, app, stops: () => stops }
}
const initial = () => ({ selected: '2.0', models: [{ id: '2.0', installed: false }], installation: { status: 'idle', model: null }, using: null })
test('the UI has no model switch and only installs/applies IndexTTS 2.0', async t => {
  assert.doesNotMatch(source, /linshe-tabs|voxcpm/i)
  const status = initial()
  const f = fixture(t, async (route, body) => {
    if (route.endsWith('/install')) { assert.equal(body.model, '2.0'); status.installation = { status: 'running', model: body.model }; return status.installation }
    if (route.endsWith('/use')) { assert.equal(body.model, '2.0'); return { settings: { local_model: body.model, mode: 'local' } } }
    return structuredClone(status)
  })
  await flush(); await f.state.use(); assert.equal(f.calls.some(([r]) => r.endsWith('/use')), false)
  await f.state.install(); assert.equal(f.state.installing.value, true); assert.equal(f.timers.size, 1)
  await f.state.install(); assert.equal(f.calls.filter(([r]) => r.endsWith('/install')).length, 1)
  status.models[0].installed = true; status.installation.status = 'completed'
  await f.state.refresh(); assert.equal(f.timers.size, 0)
  await f.state.use(); assert.equal(f.stops(), 1)
  assert.equal(f.events.find(([e]) => e === 'changed')[1].local_model, '2.0')
})
test('failed activation reports the failure and permits retry', async t => {
  const status = initial(); status.models[0].installed = true
  let fail = true
  const f = fixture(t, async route => {
    if (route.endsWith('/use')) { if (fail) throw new Error('服务启动失败'); return { settings: { local_model: '2.0', mode: 'local' } } }
    return structuredClone(status)
  })
  await flush(); await f.state.use()
  assert.equal(f.state.error.value, '服务启动失败'); assert.equal(f.state.using.value, false)
  fail = false; await f.state.use(); assert.ok(f.events.some(([e]) => e === 'changed'))
})
test('background installation polling stops on close and ignores late responses', async t => {
  const status = initial(); status.installation = { status: 'running', model: '2.0' }
  let delayed = false, release
  const f = fixture(t, async () => delayed ? new Promise(resolve => { release = resolve }) : structuredClone(status))
  await flush(); assert.equal(f.timers.size, 1)
  delayed = true; const pending = f.state.refresh(); f.app.unmount()
  release({ ...status, installation: { status: 'failed', error: 'late' } }); await pending
  assert.equal(f.timers.size, 0); assert.equal(f.state.status.value.installation.status, 'running')
})
