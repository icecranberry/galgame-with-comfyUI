import processorUrl from './voiceSample.worklet.js?worker&url'
import wasmUrl from 'rubberband-wasm/dist/rubberband.wasm?url'

let compiledModule
function loadModule() {
  if (!compiledModule) compiledModule = fetch(wasmUrl).then(response => {
    if (!response.ok) throw new Error('无法加载本地声音处理器')
    return response.arrayBuffer()
  }).then(bytes => WebAssembly.compile(bytes)).catch(error => { compiledModule = null; throw error })
  return compiledModule
}

// A media-like transport keeps the existing accessible player and the global
// single-audio owner. Construction/parameter changes never start playback.
export function createVoiceSamplePlayback({ src, start = 0, end, parameters = {} }) {
  const events = new EventTarget(), controller = new AbortController()
  let context, node, gain, bass, treble, thickness, clarity, air, volumeGain, initialization, disposed = false, intent = 0
  let position = 0, duration = 0, paused = true, muted = false, volume = 1
  let controls = { pitch: 0, resonance: 0, brightness: 0, thickness: 0, clarity: 0, air: 0, speed: 1, ...parameters }
  const dispatch = type => events.dispatchEvent(new Event(type))
  function updateFilters() {
    if (!gain) return
    const time = context.currentTime, brightness = controls.brightness
    const headroom = Math.abs(brightness) + Math.max(0, controls.thickness) + Math.max(0, controls.clarity) + Math.max(0, controls.air)
    for (const [parameter, value] of [[gain.gain, 10 ** (-headroom / 20)], [bass.gain, -brightness / 2], [treble.gain, brightness], [thickness.gain, controls.thickness], [clarity.gain, controls.clarity], [air.gain, controls.air], [volumeGain.gain, muted ? 0 : volume]]) {
      parameter.setTargetAtTime(value, time, 0.015)
    }
  }
  async function initialize() {
    if (initialization) return initialization
    context = new AudioContext({ latencyHint: 'interactive' })
    initialization = (async () => {
      const [response, module] = await Promise.all([fetch(src, { signal: controller.signal }), loadModule(), context.audioWorklet.addModule(processorUrl)])
      if (!response.ok) throw new Error('样音加载失败')
      const buffer = await context.decodeAudioData(await response.arrayBuffer())
      if (disposed) throw new DOMException('试听已关闭', 'AbortError')
      const first = Math.max(0, Math.round(start * buffer.sampleRate)), last = Math.min(buffer.length, Math.round((end ?? buffer.duration) * buffer.sampleRate))
      if (last <= first) throw new Error('请选择有效的参考片段')
      const samples = new Float32Array(last - first)
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const input = buffer.getChannelData(channel)
        for (let i = 0; i < samples.length; i++) samples[i] += input[first + i] / buffer.numberOfChannels
      }
      duration = samples.length / buffer.sampleRate
      node = new AudioWorkletNode(context, 'voice-sample', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] })
      gain = context.createGain(); bass = context.createBiquadFilter(); treble = context.createBiquadFilter(); volumeGain = context.createGain()
      bass.type = 'lowshelf'; bass.frequency.value = 250
      treble.type = 'highshelf'; treble.frequency.value = 3000
      thickness = context.createBiquadFilter(); thickness.type = 'lowshelf'; thickness.frequency.value = 180
      clarity = context.createBiquadFilter(); clarity.type = 'peaking'; clarity.frequency.value = 2800; clarity.Q.value = 0.9
      air = context.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 8000
      // Same headroom/EQ as the saved voice, plus a final peak guard.
      const limiter = context.createWaveShaper(), curve = new Float32Array(4097)
      for (let i = 0; i < curve.length; i++) curve[i] = Math.max(-0.95, Math.min(0.95, i / (curve.length - 1) * 2 - 1))
      limiter.curve = curve
      node.connect(gain).connect(bass).connect(treble).connect(thickness).connect(clarity).connect(air).connect(limiter).connect(volumeGain).connect(context.destination)
      updateFilters()
      await new Promise((resolve, reject) => {
        const abort = () => finish(new DOMException('试听已关闭', 'AbortError'))
        const timeout = setTimeout(() => finish(new Error('本地声音处理器启动超时，请重新播放')), 15000)
        const finish = error => { clearTimeout(timeout); controller.signal.removeEventListener('abort', abort); if (error) reject(error); else resolve() }
        controller.signal.addEventListener('abort', abort, { once: true })
        node.port.onmessage = ({ data }) => {
          if (data.type === 'ready') finish()
          else if (data.type === 'position') { position = data.seconds; dispatch('timeupdate') }
          else if (data.type === 'error') { finish(new Error(data.message)); paused = true; dispatch('error') }
        }
        node.onprocessorerror = () => { finish(new Error('本地声音处理器异常')); paused = true; dispatch('error') }
        node.port.postMessage({ type: 'init', module, samples, sampleRate: buffer.sampleRate, parameters: controls }, [samples.buffer])
      })
      node.port.postMessage({ type: 'parameters', parameters: controls })
      dispatch('loadedmetadata')
    })().catch(async error => {
      node?.disconnect(); node = null
      await context?.close().catch(() => {})
      initialization = null
      throw error
    })
    return initialization
  }
  const transport = {
    addEventListener: (...args) => events.addEventListener(...args),
    removeEventListener: (...args) => events.removeEventListener(...args),
    get paused() { return paused }, get duration() { return duration },
    get currentTime() { return position },
    set currentTime(value) { position = duration ? Math.max(0, Math.min(duration, value)) % duration : 0; node?.port.postMessage({ type: 'seek', seconds: position }); dispatch('seeked') },
    get muted() { return muted }, set muted(value) { muted = !!value; updateFilters(); dispatch('volumechange') },
    get volume() { return volume }, set volume(value) { volume = Math.max(0, Math.min(1, value)); updateFilters(); dispatch('volumechange') },
    async play() {
      if (disposed) throw new DOMException('试听已关闭', 'AbortError')
      const ticket = ++intent
      // Resume within the user gesture, before fetching/compiling/decoding.
      const ready = initialize(), resumed = context.resume()
      // Claim global playback immediately; another player can then cancel a
      // pending first load instead of being interrupted when decoding finishes.
      paused = false; dispatch('play')
      try { await Promise.all([ready, resumed]) }
      catch (error) { if (ticket === intent) { paused = true; dispatch('pause') }; throw error }
      if (disposed || ticket !== intent) return
      node.port.postMessage({ type: 'play' })
    },
    pause() { intent++; paused = true; node?.port.postMessage({ type: 'pause' }); dispatch('pause') },
    setParameters(value) { controls = { ...controls, ...value }; node?.port.postMessage({ type: 'parameters', parameters: controls }); updateFilters() },
    dispose() { if (disposed) return; disposed = true; this.pause(); controller.abort(); node?.port.postMessage({ type: 'dispose' }); node?.disconnect(); void context?.close().catch(() => {}) },
  }
  return transport
}
