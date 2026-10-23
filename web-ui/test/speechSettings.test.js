import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'

const source = readFileSync(new URL('../src/components/SpeechSettings.vue', import.meta.url), 'utf8')
const code = compileScript(parse(source).descriptor, { id: 'speech-settings-test' }).content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
  .replace(/^import .* from .*$/gm, '').replace('export default', 'return')

function fixture(t, api) {
  let state, stops = 0
  const calls = [], speechEnabled = Vue.ref(true)
  const deps = { Vue, speechEnabled, stopSpeech: () => stops++, LinsheButton: {}, LinsheSwitch: {},
    ttsApi: async (...args) => { calls.push(args); return args[0] === '/settings' ? { enabled: true } : api(...args) } }
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps))
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {} }); return () => null } })
  app.mount({}); t.after(() => app.unmount())
  return { state, calls, stops: () => stops }
}

test('restart stops playback, blocks overlapping maintenance and displays verified readiness', async t => {
  let finish
  const f = fixture(t, () => new Promise(resolve => { finish = resolve }))
  const pending = f.state.restart()
  assert.equal(f.state.restarting.value, true)
  assert.equal(f.state.ready.value, false)
  await f.state.restart(); await f.state.check(); await f.state.recover()
  assert.deepEqual(f.calls.filter(([route]) => route !== '/settings'), [['/restart', {}]])
  assert.equal(f.stops(), 1)
  finish({ online: true, compatible: true, ready: true }); await pending
  assert.equal(f.state.ready.value, true)
  assert.equal(f.state.restarting.value, false)
  assert.match(f.state.notice.value, /已重启/)
})

test('restart failure and missing models remain retryable errors, never success notices', async t => {
  for (const response of [new Error('运行环境不存在'), { online: true, compatible: true, ready: false, error: '模型未就绪' }]) {
    const f = fixture(t, async () => { if (response instanceof Error) throw response; return response })
    await f.state.restart()
    assert.equal(f.state.restarting.value, false)
    assert.equal(f.state.ready.value, false)
    assert.equal(f.state.notice.value, '')
    assert.equal(f.state.error.value, response.message || response.error)
  }
})
