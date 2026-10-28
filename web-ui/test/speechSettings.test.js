import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'

const source = readFileSync(new URL('../src/components/SpeechSettings.vue', import.meta.url), 'utf8')
const code = compileScript(parse(source).descriptor, { id: 'speech-settings-test' }).content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
  .replace(/^import .* from .*$/gm, '').replace('export default', 'return')

function fixture(t, api, settingsApi = async () => ({ enabled: true })) {
  let state, stops = 0
  const calls = [], speechEnabled = Vue.ref(true)
  const deps = { Vue, speechEnabled, stopSpeech: () => stops++, LocalSpeechModels: {}, LinsheButton: {}, LinsheSwitch: {}, LinsheTabs: {}, LinsheInput: {},
    ttsApi: async (...args) => { calls.push(args); return args[0] === '/settings' ? settingsApi(...args) : api(...args) } }
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps))
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {}, emit() {} }); return () => null } })
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

test('mode switches preserve connection drafts and failed saves retain secrets for retry', async t => {
  let settings = { enabled: true, mode: 'local', api: { endpoint: 'http://localhost/tts', model: 'tts', has_key: true } }, fail = false
  const f = fixture(t, async () => {}, async (route, body) => {
    if (fail) throw new Error('保存失败')
    if (body?.mode) settings.mode = body.mode
    if (body?.api) settings.api = { endpoint: body.api.endpoint, model: body.api.model, upload_endpoint: body.api.upload_endpoint, has_key: !body.api.clear_key }
    return structuredClone(settings)
  })
  await new Promise(resolve => setImmediate(resolve))
  f.state.apiKey.value = 'draft-key'; f.state.api.value.model = 'draft-model'; f.state.api.value.upload_endpoint = 'https://provider.example/v1/uploads/audio/voice'
  await f.state.switchMode('api'); await f.state.switchMode('local')
  assert.equal(f.state.mode.value, 'local'); assert.equal(f.state.api.value.model, 'draft-model'); assert.equal(f.state.apiKey.value, 'draft-key')
  fail = true; await f.state.switchMode('api'); assert.equal(f.state.mode.value, 'local')
  await f.state.saveApi(); assert.equal(f.state.apiKey.value, 'draft-key'); assert.equal(f.state.error.value, '保存失败')
  fail = false; await f.state.saveApi(); assert.equal(f.state.apiKey.value, ''); assert.equal(settings.api.model, 'draft-model')
  assert.equal(settings.api.upload_endpoint, 'https://provider.example/v1/uploads/audio/voice')
  f.state.clearKey.value = true; await f.state.saveApi(); assert.equal(settings.api.has_key, false)
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
