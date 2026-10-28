import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { createSpeechTask } from '../src/utils/speechTask.js'

const source = readFileSync(new URL('../src/components/VoiceApiEditor.vue', import.meta.url), 'utf8')
const code = compileScript(parse(source).descriptor, { id: 'voice-api-test' }).content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
  .replace(/^import .* from .*$/gm, '').replace('export default', 'return')
const flush = () => new Promise(resolve => setImmediate(resolve))
function fixture(t, api, upload = async () => { throw new Error('unexpected upload') }) {
  const calls = [], events = [], props = Vue.reactive({ characterId: 1, connectionKey: 'one' })
  let state, stops = 0
  const deps = { Vue, ttsApi: async (...args) => { calls.push(args); return api(...args) }, speechEnabled: Vue.ref(true),
    speechPlayer: {}, stopSpeech: () => stops++, waitSpeech: async job => ({ ...job, status: 'completed', audio_url: '/result.mp3' }), createSpeechTask,
    uploadApiReference: upload, LinsheTabs: {}, LinsheSelect: {}, LinsheButton: {}, LinsheInput: {}, VoiceAudioPlayer: {} }
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps))
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { state = component.setup(props, { expose() {}, emit: (...args) => events.push(args) }); return () => null } })
  app.mount({}); t.after(() => app.unmount())
  return { state, calls, events, props, app, stops: () => stops }
}
test('API drafts preview without audio uploads, save independently and survive failed saves', async t => {
  let saved = null, fail = false
  const f = fixture(t, async (route, body) => {
    if (route.endsWith('/api-samples')) return []
    if (route === '/preview') return { id: 'preview', status: 'queued' }
    if (body) { if (fail) throw new Error('保存失败'); saved = structuredClone(body) }
    return saved ? { params: saved } : null
  })
  await flush(); f.state.draft.value.voice = 'nova'; f.state.extraText.value = '{"language":"zh"}'
  await flush(); assert.equal(f.state.valid.value, true); assert.equal(f.state.dirty.value, true)
  await f.state.preview(); assert.equal(f.state.audioUrl.value, '/result.mp3'); assert.equal(saved, null)
  const body = f.calls.find(([route]) => route === '/preview')[1]
  assert.equal(body.api_params.voice, 'nova'); assert.equal(body.sample_id, undefined); assert.equal(body.voice_id, undefined)
  assert.equal(f.calls.some(([route]) => route.includes('/samples')), false)
  f.props.connectionKey = 'two'; await flush(); assert.equal(f.state.audioUrl.value, '')
  fail = true; await f.state.save(); assert.equal(f.state.draft.value.voice, 'nova'); assert.equal(f.state.error.value, '保存失败')
  fail = false; await f.state.save(); assert.equal(saved.voice, 'nova'); assert.equal(f.state.dirty.value, false)
  await f.state.load(); assert.equal(f.state.draft.value.voice, 'nova')
  f.state.extraText.value = '['; assert.equal(f.state.valid.value, false)
})
test('reference uploads preview as drafts, clone into voice IDs, and retain both choices across saves', async t => {
  const sample = { id: '12345678-abcd-abcd-abcd-123456789abc', name: 'sample.wav', duration: 8, preview_url: '/ref.wav', clones: [] }
  let saved = null, fail = false, uploadFail = false
  const f = fixture(t, async (route, body) => {
    if (route.endsWith('/api-samples')) return [structuredClone(sample)]
    if (route.endsWith('/api-clones')) { if (fail) throw new Error('创建失败'); return { voice: 'speech:clone', name: '声音', model: 'model' } }
    if (route === '/preview') return { id: 'ref-preview' }
    if (body) saved = structuredClone(body)
    return saved ? { params: saved } : null
  }, async (id, file) => { assert.equal(id, 1); assert.equal(file.name, 'new.wav'); if (uploadFail) throw new Error('上传失败'); return { ...sample, name: file.name, id: '22345678-abcd-abcd-abcd-123456789abc' } })
  await flush()
  f.state.source.value = 'references'
  assert.equal(f.state.valid.value, false)
  f.state.referenceId.value = sample.id; f.state.referenceText.value = '音频原文'
  await flush(); assert.equal(f.state.valid.value, true)
  await f.state.preview(); assert.equal(saved, null)
  assert.deepEqual(f.calls.find(([r]) => r === '/preview')[1].api_params.references, [{ sample_id: sample.id, text: '音频原文' }])
  await f.state.save(); await f.state.load()
  assert.equal(f.state.source.value, 'references'); assert.equal(f.state.referenceText.value, '音频原文'); assert.equal(f.state.dirty.value, false)
  f.state.source.value = 'voice'; f.state.cloneName.value = '声音'; fail = true
  await f.state.createClone(); assert.equal(f.state.error.value, '创建失败'); assert.equal(f.state.referenceId.value, sample.id)
  fail = false; await f.state.createClone()
  assert.equal(f.state.draft.value.voice, 'speech:clone'); assert.equal(saved.source, 'references'); assert.equal(f.state.cloneOptions.value.length, 1)
  await f.state.save(); assert.equal(saved.source, 'voice'); assert.equal(saved.references[0].sample_id, sample.id)
  f.state.source.value = 'references'; assert.equal(f.state.draft.value.voice, 'speech:clone')
  uploadFail = true
  await f.state.upload({ target: { files: [{ name: 'new.wav' }], value: 'new.wav' } })
  assert.equal(f.state.referenceId.value, sample.id); assert.equal(f.state.referenceText.value, '音频原文')
  uploadFail = false
  await f.state.upload({ target: { files: [{ name: 'new.wav' }], value: 'new.wav' } })
  assert.equal(f.state.referenceText.value, ''); assert.equal(f.state.valid.value, true)
  assert.equal(f.calls.some(([r]) => r === '/settings' || r === '/voices' || r === '/samples'), false)
})
test('API cloning selects an existing local recording without re-uploading or requiring transcript/name entry', async t => {
  const local = { id: 'local-voice', name: '角色原声', duration: 10, transcript: '' }
  const sample = { id: '12345678-abcd-abcd-abcd-123456789abc', name: local.name, source: 'local', duration: 10, transcript: '', preview_url: '/local-copy.wav', clones: [] }
  let saved = null
  const f = fixture(t, async (route, body) => {
    if (route.endsWith('/api-local-voices')) return [local]
    if (route.endsWith('/api-samples/from-local')) { assert.equal(body.voice_id, local.id); return sample }
    if (route.endsWith('/api-samples')) return []
    if (route.endsWith('/api-clones')) { assert.equal(body.text, ''); assert.equal(body.name, local.name); return { voice: 'speech:local', name: local.name, model: 'index' } }
    if (route === '/preview') return { id: 'local-reference-preview' }
    if (body) saved = body
    return saved ? { params: saved } : null
  })
  await flush(); f.state.source.value = 'references'
  await f.state.useLocalReference(local.id)
  assert.equal(f.state.referenceText.value, ''); assert.equal(f.state.valid.value, true)
  assert.equal(f.state.selectedSample.value.source, 'local'); assert.equal(f.state.cloneName.value, local.name)
  await f.state.preview(); assert.equal(saved, null)
  assert.deepEqual(f.calls.find(([r]) => r === '/preview')[1].api_params.references, [{ sample_id: sample.id, text: '' }])
  await f.state.save(); assert.equal(saved.references[0].text, '')
  f.state.source.value = 'voice'; await f.state.createClone()
  assert.equal(f.state.draft.value.voice, 'speech:local')
  assert.equal(f.calls.some(([r]) => r === '/samples' || r === '/voices'), false)
})
test('late clone and upload responses cannot overwrite another character', async t => {
  let release
  const sample = { id: '12345678-abcd-abcd-abcd-123456789abc', name: 'sample', duration: 8, clones: [] }
  const f = fixture(t, async route => {
    if (route.endsWith('/api-samples')) return [sample]
    if (route.endsWith('/api-clones')) return new Promise(resolve => { release = resolve })
    return null
  }, async () => new Promise(resolve => { release = resolve }))
  await flush(); f.state.referenceId.value = sample.id; f.state.referenceText.value = '原文'; f.state.cloneName.value = 'name'
  const pending = f.state.createClone()
  f.props.characterId = 2; await flush(); release({ voice: 'late' }); await pending
  assert.equal(f.state.draft.value.voice, ''); assert.equal(f.state.busy.value, false)
  const upload = f.state.upload({ target: { files: [{}], value: '' } })
  f.props.characterId = 3; await flush(); release(sample); await upload
  assert.equal(f.state.referenceId.value, ''); assert.equal(f.state.busy.value, false)
})
test('closing during API job creation cancels the late job rather than restoring its player', async t => {
  let respond
  const f = fixture(t, async (route) => {
    if (route === '/preview') return new Promise(resolve => { respond = resolve })
    return null
  })
  await flush(); f.state.draft.value.voice = 'alloy'; await flush()
  const pending = f.state.preview()
  f.app.unmount(); respond({ id: 'late', status: 'queued' }); await pending
  assert.ok(f.calls.some(([route]) => route === '/jobs/late/cancel')); assert.equal(f.state.audioUrl.value, '')
})
