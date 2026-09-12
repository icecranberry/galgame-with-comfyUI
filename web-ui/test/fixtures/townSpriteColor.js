// Browser/GPU regression: open /test/fixtures/townSpriteColor.html in Vite.
// No live town, saved data, generated assets or backend requests are used.
import * as T from 'three'
import { Hd2dTownRenderer } from '../../src/town/renderers/Hd2dTownRenderer.js'
import { adaptAgent } from '../../src/town/renderers/TownSceneAdapter.js'

const colors = ['#ffe6dd', '#ebb3a3', '#cd9283', '#f5f5f5', '#838c92', '#74283c', '#171e22', '#365f92']
const source = document.createElement('canvas')
source.width = 256; source.height = 128
const ctx = source.getContext('2d')
colors.forEach((color, i) => { ctx.fillStyle = color; ctx.fillRect(i % 4 * 64, Math.floor(i / 4) * 64, 64, 64) })
const url = source.toDataURL()
const frame = adaptAgent({ agentKey: 'color-test', sprites: { down: url } }, { x: 0, y: 0 }, 'down', 0)
const reference = colors.map(color => [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16)))
const result = document.getElementById('result'), checks = []
const assert = (condition, message) => { if (!condition) throw new Error(message) }

const renderer = new Hd2dTownRenderer()
renderer.mount(document.getElementById('scene'))
renderer.resize(400, 320, 1)
renderer.setCamera({ x: 0, y: -20, zoom: 2 })

function render(hour, text = '晴') {
  renderer.updateAgents([frame]); renderer.render({ hour, text }, [frame.ground])
  const gl = renderer.renderer.getContext(), pixels = new Uint8Array(400 * 320 * 4)
  gl.readPixels(0, 0, 400, 320, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  const mesh = renderer.agents.get('color-test')
  return colors.map((_, i) => {
    const point = new T.Vector3((i % 4 + .5) / 4 - .5, .5 - (Math.floor(i / 4) + .5) / 2, 0).applyMatrix4(mesh.matrixWorld)
    const p = renderer.project(point), offset = ((319 - Math.floor(p.y)) * 400 + Math.floor(p.x)) * 4
    return [...pixels.slice(offset, offset + 3)]
  })
}
function checkColors(samples, maxError, label) {
  const errors = samples.flatMap((rgb, i) => rgb.map((v, c) => Math.abs(v - reference[i][c])))
  assert(Math.max(...errors) <= maxError, `${label}: source channel error ${Math.max(...errors)}`)
  // Skin must retain its authored warm undertone instead of converging to grey.
  for (const i of [0, 1, 2]) {
    const redGreen = samples[i][0] - samples[i][1], original = reference[i][0] - reference[i][1]
    assert(Math.abs(redGreen - original) <= 8, `${label}: skin red-green separation ${redGreen}, expected near ${original}`)
  }
  checks.push({ label, maxChannelError: Math.max(...errors), samples })
}

try {
  for (let attempt = 0; attempt < 120; attempt++) {
    render(14)
    if ([...renderer.textures.values()].every(entry => entry.ready)) break
    await new Promise(requestAnimationFrame)
  }
  assert([...renderer.textures.values()].every(entry => entry.ready), 'Test texture did not load')
  const hdr = renderer.composer.renderTarget1.texture.type === T.HalfFloatType
  for (const quality of ['balanced', 'low']) for (const tilt of [true, false]) {
    renderer.setQuality(quality, tilt)
    const day = render(14)
    checkColors(day, hdr ? 10 : 30, `${quality}, tilt=${tilt}, clear`)
    checkColors(render(12, '阴'), hdr ? 10 : 30, `${quality}, tilt=${tilt}, overcast`)
    const dusk = render(18.5), night = render(22)
    assert(night[3].every((v, i) => v < day[3][i]), 'Night white cloth should be darker than daylight')
    assert(dusk.every(rgb => rgb.every(Number.isFinite)), 'Dusk output must remain finite')
    assert(JSON.stringify(render(14)) === JSON.stringify(day), 'Returning from night must restore identical daytime color')
  }
  if (hdr) {
    for (const target of [renderer.composer.renderTarget1, renderer.composer.renderTarget2]) {
      target.dispose(); target.texture.type = T.UnsignedByteType
    }
    checkColors(render(14), 30, '8-bit fallback')
  }
  assert(renderer.renderer.info.programs.every(program => program.diagnostics?.runnable !== false), 'Shader compilation failed')
  result.textContent = `PASS\n${JSON.stringify(checks, null, 2)}`
} catch (error) {
  result.textContent = `FAIL: ${error.message}\n${JSON.stringify(checks, null, 2)}`
  throw error
} finally {
  renderer.dispose()
}
