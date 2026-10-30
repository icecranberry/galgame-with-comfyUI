import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { createSpeechTask } from '../src/utils/speechTask.js'
import { createSpeechPlayback } from '../src/utils/speechPlayback.js'

const source = readFileSync(new URL('../src/components/VoiceManagerModal.vue', import.meta.url), 'utf8')
const code = compileScript(parse(source).descriptor, { id: 'voice-manager-test' }).content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g, (_, names) => `const { ${names} } = Vue`)
  .replace(/^import .* from .*$/gm, '').replace('export default', 'return')
const flush = () => new Promise(resolve => setImmediate(resolve))

function fixture(t, api = async route => route === '/voices?character_id=1' ? [] : null, options = {}) {
  const props = Vue.reactive({ modelValue: true, character: { id: 1, display_name: '测试' } })
  const speechEnabled = Vue.ref(false), speechJobs = Vue.reactive({}), calls = [], events = []
  let stops = 0, state
  const speechPlayer = createSpeechPlayback()
  const deps = { Vue, speechEnabled, speechJobs, createSpeechTask, stopSpeech: () => { stops++; speechPlayer.stop() },
    speechPlayer, ttsApi: async (...args) => { calls.push(args); if (args[0] === '/settings') return options.settings ? options.settings() : { mode: 'local', enabled: false }; return api(args[0].replace('?mode=local', ''), ...args.slice(1)) }, uploadVoice: options.upload || (async () => null),
    waitSpeech: options.wait || (async job => { const ready = { ...job, status: 'completed', audio_url: '/preview.wav' }; speechJobs[job.id] = ready; return ready }),
    LinsheModal: {}, LinsheButton: {}, LinsheInput: {}, LinsheSlider: {}, LinsheSelect: {}, LinsheTabs: {}, SystemAudioRecorder: {}, VoiceAudioPlayer: {}, VoiceSamplePreview: {}, VoiceApiEditor: {} }
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps))
  const renderer = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() {
    state = component.setup(props, { expose() {}, emit: (...args) => events.push(args) })
    return () => null
  } })
  app.provide('confirm', options.confirm || (async () => true))
  app.mount({}); t.after(() => app.unmount())
  return { state, props, speechEnabled, speechJobs, speechPlayer, calls, events, stops: () => stops }
}

function readyPreview(f, play = async () => {}) {
  const actions = []
  const audio = Vue.markRaw({ currentTime: 0, pause() { actions.push('pause') },
    scrollIntoView() { actions.push('reveal') }, play() { actions.push('play'); return play() } })
  f.speechEnabled.value = true
  f.state.original.value = { id: 'original', duration: 12 }
  f.state.sample.value = { id: 'sample' }
  f.state.previewAudio.value = { media: audio }
  return { actions, audio }
}

test('character editor reads the global mode and only loads local assets in local mode', async t => {
  let mode = 'api'
  const f = fixture(t, async route => route.startsWith('/voices?') ? [{ id: 'local', character_id: 1, generation_params: { top_p: 0.7 } }] : { voice_id: 'local' },
    { settings: () => ({ mode, enabled: true }) })
  await flush()
  assert.equal(f.state.mode.value, 'api'); assert.equal(f.speechEnabled.value, true)
  assert.deepEqual(f.calls.map(([route]) => route), ['/settings'])
  f.props.modelValue = false; await flush(); mode = 'local'; f.props.modelValue = true; await flush()
  assert.equal(f.state.mode.value, 'local'); assert.equal(f.state.selected.value, 'local')
  assert.equal(f.state.generationParams.value.top_p, 0.7)
  assert.equal(f.calls.some(([, body]) => body !== undefined), false, 'character editor never writes global settings')
})

test('failed global settings load stays out of both modes and can be retried', async t => {
  let fail = true
  const f = fixture(t, undefined, { settings: () => { if (fail) throw new Error('读取失败'); return { mode: 'api', enabled: false } } })
  await flush(); assert.equal(f.state.mode.value, null); assert.equal(f.state.error.value, '读取失败')
  fail = false; await f.state.loadVoice([true, 1])
  assert.equal(f.state.mode.value, 'api'); assert.equal(f.state.error.value, '')
})

test('advanced draft previews separately, saves to its voice, restores defaults and reloads on reopen', async t => {
  const defaults = { temperature: 0.8, top_k: 30, top_p: 0.9, num_beams: 3 }
  let saved = { id: 'voice', character_id: 1, name: '日常', generation_params: { ...defaults, top_p: 0.95 } }
  const f = fixture(t, async (route, body) => {
    if (route.startsWith('/voices?')) return [structuredClone(saved)]
    if (route === '/characters/1') return { voice_id: 'voice', name: '日常' }
    if (route === '/preview') return { id: 'draft', status: 'queued' }
    if (route === '/voices/voice/parameters') { saved = { ...saved, generation_params: body.generation_params }; return structuredClone(saved) }
  })
  await flush(); f.speechEnabled.value = true
  assert.equal(f.state.advancedOpen.value, false)
  assert.equal(f.state.generationParams.value.top_p, 0.95)
  assert.equal(f.state.parametersDirty.value, false)
  f.state.generationParams.value.temperature = 0.75
  assert.equal(f.state.parametersDirty.value, true)
  await f.state.preview()
  assert.equal(f.calls.find(([route]) => route === '/preview')[1].generation_params.temperature, 0.75)
  assert.equal(saved.generation_params.temperature, 0.8)
  f.state.generationParams.value.top_k = 40
  assert.equal(f.state.previewId.value, null, 'edited parameters invalidate the previous audition')
  await f.state.saveParameters()
  assert.equal(saved.generation_params.top_k, 40)
  assert.equal(f.state.parametersDirty.value, false)
  f.state.resetParameters()
  assert.deepEqual({ ...f.state.generationParams.value }, defaults)
  assert.equal(f.state.parametersDirty.value, true)
  f.state.generationParams.value.num_beams = 1.5
  assert.equal(f.state.parametersValid.value, false)
  assert.equal(f.state.canPreview.value, false)
  const count = f.calls.length
  await f.state.preview(); await f.state.saveParameters()
  assert.equal(f.calls.length, count)
  f.props.modelValue = false; await Vue.nextTick()
  f.props.modelValue = true; await flush()
  assert.equal(f.state.generationParams.value.top_k, 40)
  assert.equal(f.state.generationParams.value.num_beams, 3)
  f.state.resetParameters(); await f.state.saveParameters()
  assert.deepEqual(saved.generation_params, defaults)
})

test('new voices can save adjusted parameters without generating another preview', async t => {
  const f = fixture(t, async (route, body) => route.startsWith('/voices?') ? [] : route === '/preview' ? { id: 'new-preview', status: 'queued' } : route === '/voices' ? { id: 'new', ...body } : null)
  await flush(); readyPreview(f)
  f.state.generationParams.value.top_p = 0.95
  await f.state.preview()
  assert.equal(f.state.canSave.value, true)
  f.state.generationParams.value.temperature = 0.75
  assert.equal(f.state.canSave.value, true)
  await f.state.save()
  const payload = f.calls.find(([route]) => route === '/voices')[1]
  assert.equal(payload.generation_params.temperature, 0.75)
  assert.equal(payload.generation_params.top_p, 0.95)
})

test('completed synthesis reveals and auto-plays the visible player, closing stops it', async t => {
  const f = fixture(t, async route => route === '/preview' ? { id: 'preview', status: 'queued' } : route.startsWith('/voices?') ? [] : null)
  await flush()
  const { actions, audio } = readyPreview(f)
  await f.state.preview()
  assert.deepEqual(actions, ['reveal', 'play'])
  f.state.playPreview({ target: audio })
  assert.deepEqual(actions, ['reveal', 'play'], 'play event must not pause the adopted audio')
  f.props.modelValue = false; await Vue.nextTick()
  assert.equal(actions.at(-1), 'pause')
})

test('blocked auto-play retains successful synthesis and gives a manual-play hint', async t => {
  const f = fixture(t, async route => route === '/preview' ? { id: 'preview', status: 'queued' } : route.startsWith('/voices?') ? [] : null)
  await flush()
  const { audio } = readyPreview(f, async () => { throw new DOMException('blocked', 'NotAllowedError') })
  await f.state.preview()
  assert.equal(f.state.canSave.value, true)
  assert.equal(f.state.error.value, '')
  assert.match(f.state.playbackHint.value, /点击播放/)
  f.state.playPreview({ target: audio })
  assert.equal(f.state.playbackHint.value, '')
})

test('late synthesis never auto-plays after cancellation, closing, disabling or another playback', async t => {
  for (const action of ['cancel', 'close', 'disable', 'other']) {
    let complete
    const f = fixture(t, async route => route === '/preview' ? { id: 'preview', status: 'queued' } : route.startsWith('/voices?') ? [] : null,
      { wait: () => new Promise(resolve => { complete = resolve }) })
    await flush()
    const { actions } = readyPreview(f)
    const pending = f.state.preview(); await flush()
    if (action === 'cancel') await f.state.cancelPreview()
    if (action === 'close') { f.props.modelValue = false; await Vue.nextTick() }
    if (action === 'disable') f.speechEnabled.value = false
    if (action === 'other') f.speechPlayer.begin()
    complete({ id: 'preview', status: 'completed', audio_url: '/preview.wav' })
    await pending
    assert.deepEqual(actions, [], action)
  }
})

test('direct voice settings guide disabled speech and reject invalid clips before processing audio', async t => {
  const f = fixture(t); await flush()
  f.state.original.value = { id: 'original', duration: 20 }
  assert.equal(f.state.canPreview.value, false)
  assert.match(f.state.previewHint.value, /开启/)
  f.speechEnabled.value = true
  assert.equal(f.state.canPreview.value, true)
  f.state.end.value = 16
  assert.equal(f.state.canPreview.value, false)
  assert.match(f.state.previewHint.value, /1～15/)
  await f.state.preview()
  assert.equal(f.calls.some(([route]) => route.includes('/crop') || route === '/preview'), false)
})

test('changing a processed selection stops old audio and invalidates the saved preview', async t => {
  const f = fixture(t); await flush()
  f.state.sample.value = { id: 'old' }; f.state.previewId.value = 'preview'
  const before = f.stops()
  f.state.start.value = 2; await Vue.nextTick()
  assert.equal(f.state.sample.value, null)
  assert.equal(f.state.previewId.value, null)
  assert.ok(f.stops() > before)
})

test('failed character refresh cannot expose or bind the previous character voice', async t => {
  let offline = false
  const f = fixture(t, async route => {
    if (offline) throw new Error('offline')
    return route === '/voices?character_id=1' ? [{ id: 'old', character_id: 1, name: '旧声音' }] : { voice_id: 'old', name: '旧声音' }
  })
  await flush(); assert.equal(f.state.selected.value, 'old')
  offline = true; f.props.character = { id: 2, display_name: '另一个角色' }; await flush()
  assert.equal(f.state.selected.value, '')
  assert.equal(f.state.binding.value, null)
  assert.equal(f.state.canSave.value, false)
  assert.equal(f.state.error.value, 'offline')
})

test('closing before preview creation responds cancels the job and does not restore stale UI', async t => {
  let resolvePreview
  const cancelled = []
  const f = fixture(t, async (route, body) => {
    if (route === '/voices?character_id=1') return []
    if (route === '/preview') return new Promise(resolve => { resolvePreview = resolve })
    if (route.endsWith('/cancel')) { cancelled.push(route); return { id: 'late', status: 'cancelled' } }
    return null
  })
  await flush(); f.speechEnabled.value = true
  f.state.original.value = { id: 'original', duration: 20 }; f.state.sample.value = { id: 'sample' }
  const pending = f.state.preview()
  assert.equal(f.state.busy.value, true)
  f.props.modelValue = false; await Vue.nextTick()
  resolvePreview({ id: 'late', status: 'queued' }); await pending
  assert.deepEqual(cancelled, ['/jobs/late/cancel'])
  assert.equal(f.state.previewId.value, null)
  assert.equal(f.state.error.value, '')
  assert.equal(f.state.busy.value, false)
})

test('new recording replaces the audition source, clears old preview and saves the new sample', async t => {
  let uploadId = 0
  const f = fixture(t, async (route, body) => {
    if (route === '/voices?character_id=1' && !body) return [{ id: 'old', character_id: 1, name: '测试 · 日常' }]
    if (route === '/characters/1' && !body) return { voice_id: 'old', name: '旧声音' }
    if (route.includes('/crop')) return { id: `clip-${uploadId}` }
    if (route === '/preview') return { id: `preview-${uploadId}`, status: 'queued' }
    if (route === '/voices') return { id: 'new-voice', name: body.name, character_id: body.character_id }
    return { ok: true }
  }, { upload: async () => ({ id: `original-${++uploadId}`, duration: 12 }) })
  await flush(); f.speechEnabled.value = true
  f.state.sample.value = { id: 'stale-clip' }
  f.state.previewId.value = 'old-preview'; f.speechJobs['old-preview'] = { status: 'completed' }
  await f.state.importRecording({}); await Vue.nextTick()
  assert.equal(f.state.selected.value, '')
  assert.equal(f.state.binding.value.voice_id, 'old')
  assert.equal(f.state.sample.value, null)
  assert.equal(f.state.previewId.value, null)
  assert.equal(f.state.canSave.value, true)
  assert.match(f.state.auditionSource.value, /新素材.*新录音/)
  assert.equal(f.state.name.value, '测试 · 日常 2')
  await f.state.preview()
  assert.equal(f.calls.find(([route]) => route === '/preview')[1].voice_id, undefined)
  assert.equal(f.calls.find(([route]) => route === '/preview')[1].sample_id, 'clip-1')
  assert.equal(f.calls.find(([route]) => route === '/preview')[1].character_id, 1)
  assert.equal(f.calls.find(([route]) => route === '/preview')[1].language, 'zh')
  assert.equal(f.calls.find(([route]) => route === '/preview')[1].speed, 1)
  assert.equal(f.state.canSave.value, true)
  // A same-length second recording must also invalidate the previous crop.
  await f.state.importRecording({ name: 'replacement.wav' }); await Vue.nextTick()
  assert.equal(f.state.sample.value, null)
  assert.equal(f.state.canSave.value, true)
  await f.state.save()
  assert.equal(f.calls.find(([route, body]) => route === '/voices' && body)[1].sample_id, 'clip-2')
  assert.equal(f.calls.find(([route, body]) => route === '/voices' && body)[1].character_id, 1)
  assert.equal(f.calls.find(([route, body]) => route === '/voices' && body)[1].language, 'zh')
  assert.equal(f.calls.find(([route, body]) => route === '/voices' && body)[1].speed, 1)
  assert.equal(f.calls.some(([, , method]) => method === 'PUT'), false, 'saving needs no second activation request')
  assert.ok(f.events.some(([event, value]) => event === 'update:modelValue' && value === false))
})

test('failed replacement upload preserves the existing voice and reports the failure', async t => {
  const f = fixture(t, async route => route === '/voices?character_id=1' ? [{ id: 'old', character_id: 1, name: '旧声音' }]
    : { voice_id: 'old', name: '旧声音' },
  { upload: async () => { throw new Error('上传失败') } })
  await flush()
  f.state.openRecorder()
  assert.equal(f.state.recorderOpen.value, false, 'existing voices do not allow recording')
  assert.equal(f.state.selected.value, 'old')
  await f.state.importRecording({})
  assert.equal(f.state.selected.value, 'old')
  assert.equal(f.state.original.value, null)
  assert.equal(f.state.error.value, '上传失败')
})

test('the current voice can be deleted directly without an unbind step', async t => {
  const f = fixture(t, async (route, body) => route === '/voices?character_id=1' ? [{ id: 'old', character_id: 1, name: '旧声音' }]
    : route === '/characters/1' && !body ? { voice_id: 'old', name: '旧声音' } : { ok: true, current_voice: null })
  await flush()
  await f.state.deleteSelectedVoice()
  assert.ok(f.calls.some(([route, , method]) => route === '/voices/old' && method === 'DELETE'))
  assert.equal(f.state.voices.value.length, 0)
  assert.equal(f.state.selected.value, '')
  assert.equal(f.state.binding.value, null)
})

test('selecting an old voice applies it immediately; a failed switch keeps the current voice', async t => {
  let fail = true
  const f = fixture(t, async (route, body) => {
    if (route === '/voices?character_id=1') return [{ id: 'current', character_id: 1, name: '当前声音' }, { id: 'old', character_id: 1, name: '旧声音' }]
    if (route === '/characters/1' && !body) return { voice_id: 'current', name: '当前声音' }
    if (fail) throw new Error('切换失败')
    return { ok: true }
  })
  await flush()
  await f.state.selectVoice('old')
  assert.equal(f.state.selected.value, 'current')
  assert.equal(f.state.binding.value.voice_id, 'current')
  assert.equal(f.state.error.value, '切换失败')
  fail = false
  await f.state.selectVoice('old')
  assert.equal(f.state.selected.value, 'old')
  assert.equal(f.state.binding.value.voice_id, 'old')
  assert.equal(f.state.canSave.value, false, 'there is no additional save step for an existing voice')
})

test('cancelled or stale deletion confirmation never submits deletion', async t => {
  let resolveConfirm
  const f = fixture(t, async route => route === '/voices?character_id=1' ? [{ id: 'old', character_id: 1, name: '旧声音' }]
    : null,
  { confirm: () => new Promise(resolve => { resolveConfirm = resolve }) })
  await flush()
  f.state.sourceMode.value = 'existing'
  const cancelled = f.state.deleteSelectedVoice(); resolveConfirm(false); await cancelled
  assert.equal(f.calls.some(([, , method]) => method === 'DELETE'), false)
  const pending = f.state.deleteSelectedVoice()
  f.props.modelValue = false; await Vue.nextTick(); resolveConfirm(true); await pending
  assert.equal(f.calls.some(([, , method]) => method === 'DELETE'), false)
})

test('only the current character voices appear, including after changing characters', async t => {
  const voices = [{ id: 'elysia', name: '爱莉希雅 · 日常', character_id: 1 }, { id: 'old', name: '爱莉希雅 · 旧录音', character_id: 1 }]
  const f = fixture(t, async route => route.startsWith('/voices?') ? voices : null)
  await flush()
  assert.equal(f.state.voices.value.length, 2)
  f.props.character = { id: 2, display_name: '安比' }
  await flush()
  assert.ok(f.calls.some(([route]) => route === '/voices?character_id=2'))
  assert.deepEqual(f.state.voiceOptions.value, [])
  f.state.sourceMode.value = 'existing'
  assert.equal(f.state.selected.value, '')
  assert.equal(f.state.canSave.value, false)
  assert.equal(f.state.sourceMode.value, 'new')
})

test('built-in voices preview without uploading, invalidate stale samples and save a fixed design', async t => {
  const builtins = [{ id: 'female', name: '基础女声' }, { id: 'male', name: '基础男声' }]
  const f = fixture(t, async (route, body) => {
    if (route === '/builtin-voices') return builtins
    if (route.startsWith('/voices?')) return []
    if (route.includes('/sample')) return { id: route.includes('female') ? 'female-sample' : 'male-sample' }
    if (route === '/preview') return { id: `preview-${body.sample_id}-${body.voice_effects.pitch}`, status: 'queued' }
    if (route === '/voices') return body
    return null
  })
  await flush(); f.speechEnabled.value = true
  assert.equal(f.state.materialMode.value, 'upload')
  assert.equal(f.state.original.value, null)
  assert.equal(f.state.canPreview.value, false)
  f.state.materialMode.value = 'builtin'
  assert.equal(f.state.canPreview.value, true)
  f.state.voiceControls.value = { pitch: 2, resonance: -5, speed: 1.15, thickness: 2, clarity: 1, air: 3 }
  await f.state.preview()
  assert.equal(f.state.canSave.value, true)
  f.state.builtinId.value = 'male'
  assert.equal(f.state.sample.value, null)
  assert.equal(f.state.canSave.value, true)
  await f.state.save()
  const payload = f.calls.find(([route]) => route === '/voices')[1]
  assert.equal(payload.sample_id, 'male-sample')
  assert.equal(payload.speed, 1.15)
  assert.deepEqual(payload.voice_effects, { pitch: 2, resonance: -5, brightness: 0, thickness: 2, clarity: 1, air: 3 })
  assert.equal(f.calls.find(([route]) => route === '/preview')[1].speed, 1.15)
  assert.equal(f.calls.some(([route]) => route.includes('/crop')), false)
})

test('voice adjustments persist after reopen, preserve drafts on failed saves and randomize only on demand', async t => {
  let fail = false
  let saved = { id: 'voice', name: '日常', character_id: 1, source: 'builtin', reference_url: '/saved-builtin.wav', base_reference_url: '/original-builtin.wav', speed: 1.1, voice_effects: { pitch: -1, resonance: 5, brightness: 2 } }
  const f = fixture(t, async (route, body) => {
    if (route.startsWith('/voices?')) return [structuredClone(saved)]
    if (route === '/characters/1') return { voice_id: 'voice' }
    if (route === '/voices/voice/parameters') {
      if (fail) throw new Error('保存失败')
      saved = { ...saved, ...body }; return structuredClone(saved)
    }
    if (route === '/preview') return { id: 'draft', status: 'queued' }
    return null
  })
  await flush(); f.speechEnabled.value = true
  assert.equal(f.state.voiceControls.value.pitch, -1)
  assert.equal(f.state.liveSource.value.src, '/original-builtin.wav', 'editing uses the unprocessed source, never the designed reference');
  f.state.voiceControls.value.pitch = 2
  f.state.voiceControls.value.thickness = 1.5
  f.state.voiceControls.value.clarity = -2
  f.state.voiceControls.value.air = 3
  f.state.voiceControls.value.speed = 1.25
  fail = true; await f.state.saveParameters()
  assert.equal(f.state.voiceControls.value.pitch, 2)
  assert.equal(saved.voice_effects.pitch, -1)
  assert.equal(f.state.parametersDirty.value, true)
  fail = false; await f.state.saveParameters()
  assert.equal(saved.voice_effects.pitch, 2)
  assert.equal(f.state.parametersDirty.value, false)
  assert.equal(f.state.liveSource.value.src, '/original-builtin.wav');
  f.props.modelValue = false; await Vue.nextTick(); f.props.modelValue = true; await flush()
  assert.deepEqual({ ...f.state.voiceControls.value }, { pitch: 2, resonance: 5, speed: 1.25, thickness: 1.5, clarity: -2, air: 3 })
  assert.equal(f.state.previewControls.value.speed, 1.25)
  assert.equal(f.state.previewControls.value.brightness, 2, 'removing the brightness slider preserves existing saved settings')
  assert.equal(f.state.voiceControlFields.some(field => field.key === 'brightness'), false)
  assert.deepEqual(f.state.voiceControlFields.find(field => field.key === 'speed'), { key: 'speed', label: '语速', min: .5, max: 2, step: .05, hint: '舒缓 ↔ 轻快 · 保持音高不变' })
  const values = []
  for (let i = 0; i < 30; i++) {
    f.state.randomizeVoice(); assert.equal(f.state.parametersValid.value, true)
    values.push(JSON.stringify(f.state.voiceControls.value))
  }
  assert.ok(new Set(values).size > 1)
  const draft = JSON.stringify(f.state.voiceControls.value)
  await f.state.preview()
  assert.equal(JSON.stringify(f.state.voiceControls.value), draft)
  assert.equal(saved.voice_effects.pitch, 2)
  f.state.resetVoiceControls()
  assert.deepEqual({ ...f.state.voiceControls.value }, { pitch: 0, resonance: 0, speed: 1, thickness: 0, clarity: 0, air: 0 })
  assert.equal(f.state.voiceDraft().speed, 1)
})

test('only built-in sources are adjustable and uploaded voices cannot inherit a built-in draft', async t => {
  const f = fixture(t)
  await flush()
  assert.equal(f.state.designEnabled.value, false)
  f.state.original.value = { id: 'original', duration: 12, preview_url: '/original.wav' }
  f.state.start.value = 2; f.state.end.value = 7
  assert.deepEqual(f.state.liveSource.value, { src: '' })
  await Vue.nextTick()
  f.state.builtinVoices.value = [{ id: 'female', reference_url: '/builtin.wav' }]
  f.state.builtinId.value = 'female'
  f.state.materialMode.value = 'builtin'
  assert.equal(f.state.designEnabled.value, true)
  assert.deepEqual(f.state.liveSource.value, { src: '/builtin.wav' })
  const audio = { currentTime: 3, paused: false, pause() { this.paused = true } }
  f.speechPlayer.adopt(audio)
  const stops = f.stops(), requests = f.calls.length
  f.state.voiceControls.value.pitch = 2
  f.state.voiceControls.value.resonance = -5
  await Vue.nextTick()
  assert.equal(audio.paused, false)
  assert.equal(audio.currentTime, 3)
  assert.equal(f.stops(), stops)
  assert.equal(f.calls.length, requests)
  assert.equal(f.state.canSave.value, true, 'saving/local audition do not depend on speech being enabled')
  f.state.materialMode.value = 'upload'
  assert.equal(audio.paused, true)
  assert.equal(f.state.designEnabled.value, false)
  assert.deepEqual(f.state.voiceDraft().voice_effects, { pitch: 0, resonance: 0, brightness: 0, thickness: 0, clarity: 0, air: 0 })
  assert.equal(f.state.voiceDraft().speed, 1)
  assert.equal(f.state.parametersDirty.value, false)
  const draft = { ...f.state.voiceControls.value }
  f.state.randomizeVoice()
  assert.deepEqual(f.state.voiceControls.value, draft, 'randomize is guarded for uploaded recordings')
  f.state.materialMode.value = 'builtin'
  assert.equal(f.state.voiceDraft().voice_effects.pitch, 2, 'returning to built-ins restores their draft')
})

test('saved recordings hide design controls and advanced saves preserve existing settings', async t => {
  const saved = { id: 'recording', character_id: 1, source: 'upload', reference_url: '/recording.wav', speed: 1.1, voice_effects: { pitch: 1, resonance: 0, brightness: 0 } }
  const f = fixture(t, async (route, body) => route.startsWith('/voices?') ? [saved] : route === '/characters/1' ? { voice_id: saved.id } : route.endsWith('/parameters') ? { ...saved, ...body } : null)
  await flush()
  assert.equal(f.state.designEnabled.value, false)
  assert.deepEqual(f.state.liveSource.value, { src: '' })
  f.state.generationParams.value.top_k = 40
  await f.state.saveParameters()
  const body = f.calls.find(([route]) => route.endsWith('/parameters'))[1]
  assert.equal(body.generation_params.top_k, 40)
  assert.equal(body.speed, saved.speed)
  assert.deepEqual(body.voice_effects, { thickness: 0, clarity: 0, air: 0, ...saved.voice_effects })
})
