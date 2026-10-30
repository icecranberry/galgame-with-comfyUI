// R3 separates the vocal envelope from pitch directly, avoiding the extra
// resampling/pitch-correction pair that smears consonants in the R2 preview.
export class VoiceSampleEngine {
  constructor(rb, rate, samples, inputRate, parameters = {}) {
    this.rb = rb; this.rate = rate; this.samples = samples; this.inputRate = inputRate
    this.capacity = 8192
    this.input = new Float32Array(this.capacity)
    this.inputPtr = rb.malloc(this.capacity * 4); this.outputPtr = rb.malloc(this.capacity * 4)
    this.inputChannels = rb.malloc(4); this.outputChannels = rb.malloc(4)
    rb.memWritePtr(this.inputChannels, this.inputPtr); rb.memWritePtr(this.outputChannels, this.outputPtr)
    this.parameters = { pitch: 0, resonance: 0, speed: 1, ...parameters }
    this.seek(0)
  }
  setParameters(parameters) {
    this.parameters = { ...this.parameters, ...parameters }
    const { pitch, resonance, speed } = this.parameters
    const pitchScale = 2 ** (pitch / 12)
    const direct = pitch === 0 && resonance === 0 && speed === 1
    if (this.hasOutput && direct !== this.direct) { this.fade = 128; this.fadeFrom = this.lastSample }
    this.direct = direct
    this.step = this.inputRate / this.rate
    this.rb.rubberband_set_time_ratio(this.state, 1 / speed)
    this.rb.rubberband_set_pitch_scale(this.state, pitchScale)
    // R3 applies this envelope correction before its overall pitch scaling.
    this.rb.rubberband_set_formant_scale(this.state, (1 + resonance / 100) / pitchScale)
  }
  seek(seconds) {
    const rb = this.rb
    if (this.state) rb.rubberband_delete(this.state)
    // R3 Finer with its standard analysis window prioritizes vocal quality.
    // No short-window / soft-transient settings from the former R2 pipeline.
    const options = 1 | 65536 | 16777216 | 536870912
    const { pitch, speed } = this.parameters
    this.state = rb.rubberband_new(this.rate, 1, options, 1 / speed, 2 ** (pitch / 12))
    rb.rubberband_set_max_process_size(this.state, this.capacity)
    this.setParameters(this.parameters)
    this.cursor = Math.max(0, seconds * this.inputRate) % this.samples.length
    this.position = this.cursor
    this.hasOutput = false; this.fade = 0
    this.padding = rb.rubberband_get_preferred_start_pad(this.state)
    this.skip = rb.rubberband_get_start_delay(this.state)
  }
  feed() {
    const rb = this.rb
    const count = Math.min(this.capacity, Math.max(128, rb.rubberband_get_samples_required(this.state)))
    for (let i = 0; i < count; i++) {
      if (this.padding > 0) { this.input[i] = 0; this.padding--; continue }
      const index = Math.floor(this.cursor), fraction = this.cursor - index
      this.input[i] = this.samples[index] * (1 - fraction) + this.samples[(index + 1) % this.samples.length] * fraction
      this.cursor = (this.cursor + this.step) % this.samples.length
    }
    rb.memWrite(this.inputPtr, this.input.subarray(0, count))
    rb.rubberband_process(this.state, this.inputChannels, count, 0)
  }
  warmup() {
    let feeds = 0
    while (this.skip > 0 || this.rb.rubberband_available(this.state) <= 0) {
      const available = this.rb.rubberband_available(this.state)
      if (available <= 0) {
        if (++feeds > 32) throw new Error('实时声音处理未能输出音频')
        this.feed()
      } else this.skip -= this.rb.rubberband_retrieve(this.state, this.outputChannels, Math.min(this.skip, available, this.capacity))
    }
  }
  render(output) {
    let written = 0, feeds = 0
    while (written < output.length) {
      const available = this.rb.rubberband_available(this.state)
      if (available <= 0) {
        // Bound work on the audio thread even if the processor fails to progress.
        if (++feeds > 32) throw new Error('实时声音处理未能输出音频')
        this.feed(); continue
      }
      const count = Math.min(available, this.capacity, this.skip || output.length - written)
      const retrieved = this.rb.rubberband_retrieve(this.state, this.outputChannels, count)
      if (!retrieved) throw new Error('实时声音处理读取失败')
      if (this.skip) this.skip -= retrieved
      else { output.set(this.rb.memReadF32(this.outputPtr, retrieved), written); written += retrieved }
    }
    // Unity settings play the decoded source unchanged. Keep R3 warm alongside
    // the dry signal so dragging away from unity doesn't cause a cold-start gap.
    if (this.direct) {
      for (let i = 0; i < output.length; i++) {
        const cursor = (this.position + i * this.step) % this.samples.length
        const index = Math.floor(cursor), fraction = cursor - index
        output[i] = this.samples[index] * (1 - fraction) + this.samples[(index + 1) % this.samples.length] * fraction
      }
    }
    for (let i = 0; i < output.length && this.fade > 0; i++, this.fade--) {
      const blend = 1 - this.fade / 128
      output[i] = this.fadeFrom * (1 - blend) + output[i] * blend
    }
    this.lastSample = output[output.length - 1]; this.hasOutput = true
    this.position = (this.position + output.length * this.step * this.parameters.speed) % this.samples.length
  }
  dispose() {
    if (!this.state) return
    this.rb.rubberband_delete(this.state); this.state = 0
    for (const ptr of [this.inputPtr, this.outputPtr, this.inputChannels, this.outputChannels]) this.rb.free(ptr)
  }
}
