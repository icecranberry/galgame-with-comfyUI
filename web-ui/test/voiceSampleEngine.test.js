import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RubberBandInterface } from 'rubberband-wasm'
import { VoiceSampleEngine } from '../src/audio/voiceSampleEngine.js'

const module = await WebAssembly.compile(readFileSync(new URL('../node_modules/rubberband-wasm/dist/rubberband.wasm', import.meta.url)))
const rate = 48000
const tone = (frequency, seconds = 3) => Float32Array.from({ length: rate * seconds }, (_, i) => .2 * Math.sin(2 * Math.PI * frequency * i / rate))
async function engine(t, parameters = {}, samples = tone(220)) {
  const processor = new VoiceSampleEngine(await RubberBandInterface.initialize(module), rate, samples, rate, parameters)
  t.after(() => processor.dispose())
  return processor
}
function render(processor, seconds = .5) {
  const result = new Float32Array(Math.round(seconds * rate))
  for (let i = 0; i < result.length; i += 128) processor.render(result.subarray(i, i + 128))
  assert.ok(result.every(Number.isFinite))
  return result
}
function frequency(samples) {
  const crossings = []
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] <= 0 && samples[i] > 0) crossings.push(i)
  return (crossings.length - 1) * rate / (crossings.at(-1) - crossings[0])
}

test('real WASM changes pitch while resonance and speed preserve the fundamental', async t => {
  for (const [parameters, expected] of [[{}, 220], [{ pitch: 4 }, 220 * 2 ** (4 / 12)], [{ resonance: 15 }, 220], [{ speed: 2 }, 220], [{ resonance: -15, speed: .5, pitch: -4 }, 220 * 2 ** (-4 / 12)]]) {
    const processor = await engine(t, parameters)
    render(processor, .2)
    assert.ok(Math.abs(frequency(render(processor)) - expected) < 3, JSON.stringify(parameters))
  }
})

test('parameter changes apply to an uninterrupted stream and seek resets the source position', async t => {
  const processor = await engine(t)
  render(processor)
  const state = processor.state, cursor = processor.cursor
  processor.setParameters({ pitch: -4, resonance: 10, speed: 1.4 })
  assert.equal(processor.state, state)
  assert.equal(processor.cursor, cursor)
  render(processor, .25)
  assert.ok(Math.abs(frequency(render(processor)) - 220 * 2 ** (-4 / 12)) < 3)
  processor.seek(1.25)
  assert.equal(processor.cursor, 1.25 * rate)
  render(processor, 4) // spans the loop boundary without invalid samples or EOF
})

test('speed changes the rate of source playback independently of pitch', async t => {
  const normal = await engine(t, { speed: 1 }, tone(220, 10))
  const fast = await engine(t, { speed: 2 }, tone(220, 10))
  render(normal, .25); render(fast, .25)
  const normalStart = normal.cursor, fastStart = fast.cursor
  render(normal, 1); render(fast, 1)
  assert.ok(Math.abs((fast.cursor - fastStart) / (normal.cursor - normalStart) - 2) < .08)
})

test('restored original passes decoded samples unchanged, including after warmup and a seek', async t => {
  const samples = Float32Array.from({ length: rate }, (_, i) => Math.sin(i * 1.123) * .15 + Math.sin(i * .064) * .1)
  const processor = await engine(t, {}, samples)
  processor.warmup()
  assert.equal(processor.position, 0)
  assert.deepEqual(render(processor, .1), samples.slice(0, rate / 10))
  processor.seek(.25); processor.warmup()
  assert.deepEqual(render(processor, .1), samples.slice(rate / 4, rate / 4 + rate / 10))
})

test('R3 resonance moves the vocal envelope while preserving its harmonic grid', async t => {
  const samples = new Float32Array(rate * 2)
  for (let harmonic = 1; harmonic < 35; harmonic++) {
    const amplitude = .05 * Math.exp(-(((harmonic * 100 - 900) / 150) ** 2))
    for (let i = 0; i < samples.length; i++) samples[i] += amplitude * Math.sin(2 * Math.PI * harmonic * 100 * i / rate)
  }
  for (const resonance of [-12, 12]) {
    const processor = await engine(t, { resonance }, samples)
    render(processor, .3)
    const output = render(processor, .25)
    let peak = 0, amplitude = -1
    for (let frequency = 600; frequency <= 1200; frequency += 100) {
      let re = 0, im = 0
      for (let i = 0; i < output.length; i++) { const phase = 2 * Math.PI * frequency * i / rate; re += output[i] * Math.cos(phase); im += output[i] * Math.sin(phase) }
      const strength = re * re + im * im
      if (strength > amplitude) { amplitude = strength; peak = frequency }
    }
    assert.ok(Math.abs(peak - 900 * (1 + resonance / 100)) < 45, `${resonance}%: ${peak} Hz`)
  }
})
