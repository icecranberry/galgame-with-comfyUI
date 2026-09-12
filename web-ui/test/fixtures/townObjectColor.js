// Browser/GPU regression: open /test/fixtures/townObjectColor.html in Vite.
// Exercises the real asset-kind routing, scene lighting, postprocessing and output.
// Synthetic textures keep this independent of saved towns and generated artwork.
import * as T from 'three'
import { Hd2dTownRenderer } from '../../src/town/renderers/Hd2dTownRenderer.js'
import { adaptObject } from '../../src/town/renderers/TownSceneAdapter.js'

const colors = ['#ff80b0', '#368354', '#f5e8c6', '#72d7dc', '#672b49', '#8e7142', '#332e2b', '#f5f5f5']
// Keep a served asset URL: adaptObject appends the asset-version query string.
const url = '/test/fixtures/townObjectColors.svg'
const reference = colors.map(color => [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16)))
const result = document.getElementById('result'), checks = []
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const renderer = new Hd2dTownRenderer()
renderer.mount(document.getElementById('scene')); renderer.resize(400, 320, 1)
let dto

function render(hour, text = '晴') {
  renderer.render({ hour, text }, [dto.ground])
  const gl = renderer.renderer.getContext(), pixels = new Uint8Array(400 * 320 * 4)
  gl.readPixels(0, 0, 400, 320, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  const mesh = renderer.objects.get('color-test')
  return colors.map((_, i) => {
    const point = new T.Vector3((i % 4 + .5) / 4 - .5, .5 - (Math.floor(i / 4) + .5) / 2, 0).applyMatrix4(mesh.matrixWorld)
    const p = renderer.project(point), offset = ((319 - Math.floor(p.y)) * 400 + Math.floor(p.x)) * 4
    return [...pixels.slice(offset, offset + 3)]
  })
}
function checkColors(samples, tolerance, label, start = 0) {
  const error = Math.max(...samples.slice(start).flatMap((rgb, i) => rgb.map((v, c) => Math.abs(v - reference[i + start][c]))))
  assert(error <= tolerance, `${label}: source channel error ${error}`)
  checks.push({ label, maxChannelError: error, samples })
}

try {
  const hdr = renderer.composer.renderTarget1.texture.type === T.HalfFloatType
  for (const kind of ['building', 'prop', 'lamp']) {
    const asset = { id: 1, kind: kind === 'lamp' ? 'prop' : kind, key: kind === 'lamp' ? 'street_lamp' : kind,
      imagePath: url, meta: { footprint: { w: 2, h: 2 }, anchor: { u: .5, v: 1 } } }
    const object = { id: 'color-test', assetId: 1, x: 0, y: 0 }
    dto = adaptObject(object, asset)
    renderer.setScene({ cols: 1, rows: 1, assets: [asset], layers: { objects: [object] } })
    renderer.setCamera({ x: dto.x, y: dto.y - 32, zoom: 2 })
    for (let attempt = 0; attempt < 120; attempt++) {
      render(14)
      if ([...renderer.textures.values()].every(entry => entry.ready)) break
      await new Promise(requestAnimationFrame)
    }
    assert([...renderer.textures.values()].every(entry => entry.ready), 'Test texture did not load')
    assert(renderer.objects.get('color-test').userData.materialKind === kind, `Wrong material for ${kind}`)
    for (const quality of ['balanced', 'low']) for (const tilt of [true, false]) {
      renderer.setQuality(quality, tilt)
      const label = `${kind}, ${quality}, tilt=${tilt}`, day = render(14)
      checkColors(day, hdr ? 10 : 30, `${label}, clear`)
      const overcast = render(12, '阴')
      // The lamp glass intentionally emits during overcast; its lower body must
      // still preserve the source color like the other painted objects.
      checkColors(overcast, hdr ? 10 : 30, `${label}, overcast`, kind === 'lamp' ? 4 : 0)
      if (kind === 'lamp') assert(overcast[2][0] > day[2][0], 'Overcast lamp glass must retain its warm glow')
      const dusk = render(18.5), night = render(22)
      assert(night[7].every((v, c) => v < day[7][c]), `${label}: night must darken the unlit body`)
      assert(dusk.every(rgb => rgb.every(Number.isFinite)), `${label}: invalid dusk output`)
      assert(JSON.stringify(render(14)) === JSON.stringify(day), `${label}: day color changed after night`)
    }
    if (hdr) {
      for (const target of [renderer.composer.renderTarget1, renderer.composer.renderTarget2]) {
        target.dispose(); target.texture.type = T.UnsignedByteType
      }
      checkColors(render(14), 30, `${kind}, 8-bit fallback`)
      for (const target of [renderer.composer.renderTarget1, renderer.composer.renderTarget2]) {
        target.dispose(); target.texture.type = T.HalfFloatType
      }
    }
  }
  assert(renderer.renderer.info.programs.every(program => program.diagnostics?.runnable !== false), 'Shader compilation failed')
  result.textContent = `PASS\n${JSON.stringify(checks, null, 2)}`
} catch (error) {
  result.textContent = `FAIL: ${error.message}\n${JSON.stringify(checks, null, 2)}`
  throw error
} finally {
  renderer.dispose()
}
