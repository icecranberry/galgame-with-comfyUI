import test from 'node:test'
import assert from 'node:assert/strict'
import { Mesh, PlaneGeometry, MeshLambertMaterial, Texture, OrthographicCamera } from 'three'
import { visibleBodySamples, volumeOccludesAgent } from './interactionOcclusion.js'
import { cardOccludesAgent } from './cardLayers.js'

// Synthetic image readback for the pure CPU helpers; no WebGL/production cleanup mocks.
const image = alpha => ({ width: 8, height: 8, data: Uint8ClampedArray.from({ length: 256 }, (_, i) => i % 4 === 3 ? alpha((i >> 2) % 8, (i >> 5)) : 255) })
test('both occlusion paths use painted, individually clipped body samples', () => {
  const previous = globalThis.document
  globalThis.document = { createElement() { let source; return { getContext() { return { drawImage(i) { source = i }, getImageData() { return source } } } } } }
  const camera = new OrthographicCamera(-1, 1, 1, -1, 1, 20)
  camera.position.z = 10; camera.lookAt(0, 0, 0); camera.updateMatrixWorld()
  const building = new Mesh(new PlaneGeometry(1, 1), new MeshLambertMaterial({ map: new Texture(image(() => 255)), alphaTest: .3 }))
  building.scale.set(8, 8, 1); building.position.z = 2; building.renderOrder = 2
  const agent = new Mesh(new PlaneGeometry(1, 1), new MeshLambertMaterial({ alphaTest: .3 })); agent.renderOrder = 1
  const samples = () => [...visibleBodySamples(agent, camera)]
  const both = expected => {
    assert.equal(cardOccludesAgent(building, agent, camera), expected, 'card')
    assert.equal(volumeOccludesAgent(building, agent, camera, () => true), expected, 'volume')
  }
  const textures = [building.material.map]
  const paint = alpha => { agent.material.map = new Texture(image(alpha)); textures.push(agent.material.map) }
  try {
    paint(() => 0); assert.equal(samples().length, 0); both(false)
    paint(() => 255); assert.equal(samples().length, 9); both(true)
    // A center-only opaque stripe must still trigger; transparent flanks cannot.
    paint(x => x === 4 ? 255 : 0); assert.equal(samples().length, 3); both(true)
    agent.position.x = 1.1; assert.equal(samples().length, 0); both(false)
    paint(x => x === 2 ? 255 : 0); assert.equal(samples().length, 3); both(true)
    paint(() => 255)
    for (const axis of ['x', 'y']) for (const sign of [-1, 1]) {
      agent.position.set(0, 0, 0); agent.position[axis] = sign * .95
      assert(samples().length > 0 && samples().length < 9); both(true)
      agent.position[axis] = sign * 1.6; assert.equal(samples().length, 0); both(false)
    }
    // The clip planes are inclusive, but genuinely outside samples are rejected.
    for (const [z, count] of [[9, 9], [9 + 1e-5, 0], [9 - 1e-5, 9], [-10, 9], [-10 - 1e-5, 0], [-10 + 1e-5, 9]]) {
      agent.position.set(0, 0, z); assert.equal(samples().length, count, `z=${z}`)
      if (!count) both(false)
    }
    // Exact viewport sample boundaries remain eligible on all four sides.
    for (const [axis, offset] of [['x', 1.25], ['x', -1.25], ['y', 1.35], ['y', -1.35]]) {
      agent.position.set(0, 0, 0); agent.position[axis] = offset
      assert.equal(samples().length, 3); both(true)
    }
  } finally {
    globalThis.document = previous
    for (const texture of textures) texture.dispose()
    for (const mesh of [agent, building]) { mesh.geometry.dispose(); mesh.material.dispose() }
  }
})
