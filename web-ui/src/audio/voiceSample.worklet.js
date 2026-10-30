import { RubberBandInterface } from 'rubberband-wasm'
import { VoiceSampleEngine } from './voiceSampleEngine.js'
/* global AudioWorkletProcessor, sampleRate, registerProcessor */

class VoiceSampleProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.playing = false; this.position = 0; this.frames = 0; this.disposed = false
    this.port.onmessage = ({ data }) => {
      if (data.type === 'init') void this.initialize(data)
      else if (data.type === 'parameters') this.engine?.setParameters(data.parameters)
      else if (data.type === 'play') this.playing = true
      else if (data.type === 'pause') this.playing = false
      else if (data.type === 'seek' && this.engine) { this.position = data.seconds; this.engine.seek(data.seconds) }
      else if (data.type === 'dispose') { this.disposed = true; this.engine?.dispose(); this.engine = null }
    }
  }
  async initialize(data) {
    try {
      const rb = await RubberBandInterface.initialize(data.module)
      if (this.disposed) return
      this.engine = new VoiceSampleEngine(rb, sampleRate, data.samples, data.sampleRate, data.parameters)
      // Prime the heavier R3 analysis before playback starts, not in a render deadline.
      this.engine.warmup()
      this.duration = data.samples.length / data.sampleRate
      this.port.postMessage({ type: 'ready' })
    } catch (error) { this.port.postMessage({ type: 'error', message: error.message }) }
  }
  process(inputs, outputs) {
    if (this.disposed) return false
    const output = outputs[0][0]
    if (!output || !this.playing || !this.engine) return true
    try {
      this.engine.render(output)
      this.position = (this.position + output.length / sampleRate * this.engine.parameters.speed) % this.duration
      if (++this.frames % 8 === 0) this.port.postMessage({ type: 'position', seconds: this.position })
    } catch (error) {
      this.playing = false
      this.port.postMessage({ type: 'error', message: error.message })
    }
    return true
  }
}
registerProcessor('voice-sample', VoiceSampleProcessor)
