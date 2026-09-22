// Browser/GPU regression: open /test/fixtures/townSpriteColor.html in Vite.
// No live town, saved data, generated assets or backend requests are used.
import * as T from 'three'
import { Hd2dTownRenderer } from '../../src/town/renderers/Hd2dTownRenderer.js'
import { adaptAgent, adaptObject } from '../../src/town/renderers/TownSceneAdapter.js'

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

// Regression: characters used shadow-map occlusion while props used a lighter
// alpha projection. Compare both live rendering paths, including facing/motion.
async function checkShadowConsistency() {
  const asset = { id: 1, kind: 'prop', imagePath: '/test/fixtures/townObjectColors.svg',
    meta: { footprint: { w: 2, h: 2 }, anchor: { u: .5, v: 1 } } }
  const object = { id: 'shadow-prop', assetId: 1, x: 4, y: 3 }
  const propDto = adaptObject(object, asset)
  const agent = { agentKey: 'shadow-agent', sprites: { down: url, up: propDto.url } }
  renderer.setScene({ cols: 8, rows: 8, assets: [asset], layers: { objects: [object] } })
  for (let attempt = 0; attempt < 120; attempt++) {
    renderer.render({ hour: 12 })
    if (renderer.objects.get('shadow-prop')?.userData.entry?.ready) break
    await new Promise(requestAnimationFrame)
  }
  assert(renderer.objects.get('shadow-prop')?.userData.entry?.ready, 'Shadow prop texture did not load')
  let previous = null, liveShadow = null
  for (const quality of ['balanced', 'low']) for (const hour of [6, 12, 18.5, 22]) for (const facing of ['down', 'up']) {
    renderer.setQuality(quality, false)
    const moving = facing === 'up'
    const pose = adaptAgent(agent, { x: moving ? 2 : 1, y: 2, moving }, facing, moving ? 130 : 0)
    renderer.updateAgents([pose])
    renderer.render({ hour, text: hour === 12 ? '阴' : '晴' })
    const character = renderer.agents.get(agent.agentKey), prop = renderer.objects.get(object.id)
    const characterShadow = character.userData.projectedShadow, propShadow = prop.userData.projectedShadow
    assert(characterShadow?.visible && propShadow?.visible, 'Characters and props must both have a projected shadow')
    assert(!character.castShadow && !prop.castShadow, 'Do not overlay a second, darker shadow-map silhouette')
    assert(characterShadow.material.opacity === propShadow.material.opacity, 'Character/prop shadow opacity mismatch')
    assert(characterShadow.material.customProgramCacheKey() === propShadow.material.customProgramCacheKey(), 'Shadow tint shader mismatch')
    assert(characterShadow.material.map === character.material.map, 'Shadow must use the currently visible facing')
    const light = renderer.sun.position.clone().sub(renderer.sun.target.position)
    for (const mesh of [character, prop]) {
      const projected = mesh.userData.projectedShadow.geometry.attributes.position
      for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
        const point = new T.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i).applyMatrix4(mesh.matrixWorld)
        const delta = new T.Vector3().fromBufferAttribute(projected, i).sub(point)
        assert(Math.abs(delta.x * light.y + point.y * light.x) < .001, 'Shadow must follow the current pose and light on X')
        assert(Math.abs(delta.z * light.y + point.y * light.z) < .001, 'Shadow must follow the current pose and light on Z')
        assert(Math.abs(projected.getY(i) - .014) < .0001, 'Walking shadows must stay on the ground')
      }
    }
    const position = [...characterShadow.geometry.attributes.position.array]
    assert(JSON.stringify(position) !== JSON.stringify(previous), 'Character shadow stopped updating')
    previous = position; liveShadow = characterShadow
  }
  renderer.updateAgents([])
  assert(liveShadow.parent === null, 'A removed character must not leave a shadow behind')
  checks.push({ label: 'character/prop shadow consistency', cases: 16, walking: true, facing: true, cleanup: true })
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
  await checkShadowConsistency()
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
