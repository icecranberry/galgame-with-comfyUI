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
  const invalidated = []
  const calls = [], speechEnabled = Vue.ref(true)
  const deps = { invalidateSpeechCache: result => invalidated.push(result), Vue, speechEnabled, speechAutoPlay: Vue.ref(false), stopSpeech: () => stops++, LocalSpeechModels: {}, LinsheButton: {}, LinsheSwitch: {}, LinsheTabs: {}, LinsheInput: {},
    ttsApi: async (...args) => { calls.push(args); return args[0] === '/settings' ? settingsApi(...args) : api(...args) } }
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps))
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { state = component.setup({}, { expose() {}, emit() {} }); return () => null } })
  app.mount({}); t.after(() => app.unmount())
  return { state, calls, invalidated, stops: () => stops }
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

test('auto playback defaults off, saves independently and preserves state on failed saves', async t => {
  let settings = { enabled: true }, fail = false
  const f = fixture(t, async () => {}, async (_, body) => {
    if (fail) throw new Error('保存失败')
    settings = { ...settings, ...body }
    return settings
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.state.speechAutoPlay.value, false)
  await f.state.toggleAutoPlay(true)
  assert.deepEqual(f.calls.at(-1), ['/settings', { auto_play: true }, 'PUT'])
  assert.equal(f.state.speechAutoPlay.value, true)
  fail = true
  await f.state.toggleAutoPlay(false)
  assert.equal(f.state.speechAutoPlay.value, true)
  assert.equal(f.state.error.value, '保存失败')
  fail = false
  await f.state.toggleAutoPlay(false)
  assert.equal(f.state.speechAutoPlay.value, false)
  assert.equal(f.stops(), 1)
  assert.equal(settings.enabled, true)
})


test('cache cleanup works in both modes, blocks duplicate clicks, and reports failures', async t => {
  for (const mode of ['local', 'api']) {
    let finish
    const f = fixture(t, () => new Promise(resolve => { finish = resolve }))
    await new Promise(resolve => setImmediate(resolve))
    f.state.mode.value = mode
    const pending = f.state.clearCache()
    await f.state.clearCache()
    assert.equal(f.state.clearingCache.value, true)
    assert.deepEqual(f.calls.filter(([route]) => route !== '/settings'), [['/cache', {}, 'DELETE']])
    const result = { ids:['old'], files:2, bytes:1048576, failed:0 }
    finish(result); await pending
    assert.deepEqual(f.invalidated, [result])
    assert.match(f.state.notice.value, /2.*1.0 MB/)
    assert.equal(f.state.clearingCache.value, false)
  }
  const f = fixture(t, async () => { throw new Error('文件正在使用') })
  await new Promise(resolve => setImmediate(resolve))
  await f.state.clearCache()
  assert.equal(f.state.error.value, '文件正在使用')
  assert.equal(f.state.clearingCache.value, false)
  assert.deepEqual(f.invalidated, [])
})

test('emotion enhancement loads, saves independently, stops playback and preserves its value on failure', async t => {
  let settings = { enabled: true, auto_play: true, mode: 'local', emotion_enhancement: true }, fail = false
  const f = fixture(t, async () => {}, async (_, body) => {
    if (fail) throw new Error('保存失败')
    settings = { ...settings, ...body }; return settings
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.state.emotionEnhancement.value, true)
  fail = true; await f.state.toggleEmotionEnhancement(false)
  assert.equal(f.state.emotionEnhancement.value, true)
  assert.equal(f.state.error.value, '保存失败')
  fail = false; await f.state.toggleEmotionEnhancement(false)
  assert.deepEqual(f.calls.at(-1), ['/settings', { emotion_enhancement: false }, 'PUT'])
  assert.equal(f.state.emotionEnhancement.value, false)
  assert.equal(f.stops(), 1)
  assert.equal(settings.auto_play, true)
  await f.state.switchMode('api'); await f.state.switchMode('local')
  assert.equal(settings.emotion_enhancement, false)
})
