import test from 'node:test'
import assert from 'node:assert/strict'
import { OrthographicCamera, Vector3, Raycaster, Vector2, Plane } from 'three'
import { configureCamera, Hd2dTownRenderer } from './Hd2dTownRenderer.js'
import { cellCenterWorld, isoToGround, objectAnchor, buildBlockedCells, worldToCell } from './projection.js'
import { groundUvs, renderMeta } from './TownSceneAdapter.js'
import { deriveGroundPixels } from './groundTexture.js'
import { adaptObject } from './TownSceneAdapter.js'
import { daylightLook, buildingShadowGeometry } from './sceneLook.js'
import { roadEdges } from './terrainEdges.js'

test('architectural proxies retain logical anchors separately from projected image anchors', () => {
  const dto = adaptObject({ x: 4, y: 7, assetId: 1 }, { id: 1, kind: 'building', meta: { footprint: { w: 3, h: 2 } } })
  assert.deepEqual(dto.grid, { x: 4, y: 7 })
  assert.equal(dto.render.shadowMode, 'volume')
  assert.notEqual(dto.grid.x, dto.x)
  const geometry = buildingShadowGeometry(3,2,4)
  geometry.computeBoundingBox()
  assert.deepEqual(geometry.boundingBox.min.toArray(), [-1.5,0,-1])
  assert.deepEqual(geometry.boundingBox.max.toArray(), [1.5,4,1])
  geometry.dispose()
  assert.equal(renderMeta({ kind: 'building', meta: { footprint: { w: 3, h: 2 }, shadowMode: 'alpha_card' } }).shadowMode, 'alpha_card')
})
test('daylight has readable forward shadows; wet weather reduces directional contrast', () => {
  const day = daylightLook(12), wet = daylightLook(12, true)
  assert(day.sun / day.ambient > 4)
  assert(day.offset.x + day.offset.z < 0)
  assert(wet.sun < day.sun && wet.ambient > day.ambient)
})
test('road curbs follow only road/ground boundaries and leave navigation untouched', () => {
  const map = { cols: 3, rows: 3, layers: { road: [[null,null,null],[null,2,2],[null,null,null]] } }
  const original = JSON.stringify(map)
  assert.equal(roadEdges(map).length, 5)
  assert.equal(JSON.stringify(map), original)
})

test('ground derivative repairs edge fringe without changing source or interior', () => {
  const width = 64, height = 32, pixels = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < pixels.length; i += 4) pixels.set([60, 130, 60, 255], i)
  const edge = (1 * width + 32) * 4
  pixels.set([255, 255, 255, 255], edge)
  const original = pixels.slice()
  const result = deriveGroundPixels(pixels, width, height)
  assert.deepEqual(pixels, original)
  assert.deepEqual([...result.slice(edge, edge + 4)], [60,130,60,255])
  const center = (16 * width + 32) * 4
  assert.deepEqual(result.slice(center, center + 4), pixels.slice(center, center + 4))
  assert.deepEqual(deriveGroundPixels(pixels, width, height, 0.5, false), pixels)
})

test('50×50 ground centers round-trip through actual Three camera at all zoom limits', () => {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000)
  const ray = new Raycaster(), plane = new Plane(new Vector3(0, 1, 0), 0)
  for (const zoom of [0.5, 1, 2.5]) {
    const state = { x: 173, y: 741, zoom }
    configureCamera(camera, state, 1100, 650)
    for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) {
      const iso = cellCenterWorld(x, y), ground = isoToGround(iso.x, iso.y)
      const p = new Vector3(ground.x, 0, ground.z).project(camera)
      assert(Math.abs((p.x + 1) * 550 - ((iso.x - state.x) * zoom + 550)) < 1e-8)
      assert(Math.abs((1 - p.y) * 325 - ((iso.y - state.y) * zoom + 325)) < 1e-8)
      ray.setFromCamera(new Vector2(p.x, p.y), camera)
      const hit = ray.ray.intersectPlane(plane, new Vector3())
      assert(Math.abs(hit.x - x - 0.5) < 1e-8 && Math.abs(hit.z - y - 0.5) < 1e-8)
      assert.deepEqual(worldToCell(iso.x, iso.y), { x, y })
    }
  }
})
test('footprint bottom-row anchor, door and explicit clearing retain server convention', () => {
  const meta = { footprint: { w: 3, h: 2 }, doorOffset: { dx: 2, dy: 1 } }
  const obj = { assetId: 1, x: 4, y: 7 }
  assert.deepEqual(objectAnchor(obj, meta), { x: -48, y: 240, width: 160 })
  const map = { cols: 10, rows: 10, assets: [{ id: 1, meta }], layers: { objects: [obj], blockOverride: [] } }
  let cells = buildBlockedCells(map)
  assert.equal(cells.size, 5); assert(!cells.has('6,7')); assert(cells.has('4,6'))
  map.layers.blockOverride[6] = []; map.layers.blockOverride[6][4] = 0
  map.layers.blockOverride[7] = []; map.layers.blockOverride[7][6] = 1
  cells = buildBlockedCells(map)
  assert(!cells.has('4,6')); assert(cells.has('6,7'))
})

test('footprinted props block all cells only when marked blocking', () => {
  const makeMap = blocking => ({
    cols: 6, rows: 6,
    assets: [{ id: 1, kind: 'prop', meta: { footprint: { w: 2, h: 2 }, footprintKind: 'prop', blocking } }],
    layers: { objects: [{ assetId: 1, x: 2, y: 3 }], blockOverride: [] },
  })
  const blockingCells = buildBlockedCells(makeMap(true))
  assert.equal(blockingCells.size, 4)
  for (const cell of ['2,2', '3,2', '2,3', '3,3']) assert(blockingCells.has(cell))
  assert.equal(buildBlockedCells(makeMap(false)).size, 0)
})
test('legacy diamond UVs use cropped height, authored calibration and topdown bypass', () => {
  const uv = groundUvs({}, 64, 32)
  assert.equal(uv[0][0], 0.5); assert.equal(uv[1][1], 0.5)
  assert(uv[0][1] < 1 && uv[2][1] > 0)
  assert.equal(groundUvs({ meta: { groundAnchorY: 0.6 } }, 64, 64)[1][1], 0.4)
  const authored = [[0.5, 0.9], [0.9, 0.5], [0.5, 0.1], [0.1, 0.5]]
  assert.deepEqual(groundUvs({ meta: { contentDiamondUv: authored } }), authored)
  assert.deepEqual(groundUvs({ meta: { projection: 'topdown_square' } }), [[0,1],[1,1],[1,0],[0,0]])
  assert.equal(renderMeta({ meta: { alphaCutoff: -2, worldHeight: -1, shadowMode: 'script' } }).worldHeight, null)
  assert.equal(renderMeta({ meta: { alphaCutoff: -2 } }).alphaCutoff, 0.01)
})
test('ground ray rejects outside map; card alpha hit rejects transparent pixels', () => {
  const renderer = Object.create(Hd2dTownRenderer.prototype)
  renderer.camera = new OrthographicCamera(-1,1,1,-1,0.1,1000)
  renderer.width = 1100; renderer.height = 650; renderer.map = { cols: 16, rows: 16 }
  renderer.scene = { updateMatrixWorld() {} }; renderer.ray = new Raycaster()
  renderer.groundPlane = new Plane(new Vector3(0,1,0),0)
  configureCamera(renderer.camera, { x: 0, y: 256, zoom: 1 }, 1100, 650)
  const outside = renderer.project({ x: -4, y: 0, z: -4 })
  assert.equal(renderer.pick(outside, { groundOnly: true }), null)
  const inside = renderer.project({ x: 8.5, y: 0, z: 7.5 })
  assert.deepEqual(renderer.pick(inside, { groundOnly: true }).cell, { x: 8, y: 7 })
  const hit = { uv: { x: 0.25, y: 0.5 }, object: { material: { alphaTest: 0.3 }, userData: { entry: { ready: true, alpha: { width: 2, height: 1, data: [0,0,0,0,0,0,0,255] } } } } }
  assert.equal(renderer.alphaHit(hit), false)
  hit.uv.x = 0.75; assert.equal(renderer.alphaHit(hit), true)
})


test('prop feet ignore transparent padding and alpha fringe, authored anchors win', async () => {
  const { alphaFootV } = await import('./imageAlpha.js')
  const data = new Uint8ClampedArray(4 * 10 * 4)
  data[(6 * 4 + 2) * 4 + 3] = 255
  data[(9 * 4 + 1) * 4 + 3] = 20
  assert.equal(alphaFootV({ data, width: 4, height: 10 }), .7)
  assert.equal(alphaFootV({ data, width: 4, height: 10 }, .05), 1)
  assert.equal(alphaFootV({ data: new Uint8ClampedArray(160), width: 4, height: 10 }), 1)
  assert.equal(renderMeta({ kind: 'prop' }).autoFoot, true)
  assert.equal(renderMeta({ kind: 'prop', meta: { anchor: { v: .8 } } }).autoFoot, false)
  assert.equal(renderMeta({ kind: 'prop' }, { render: { anchor: { v: .6 } } }).autoFoot, false)
})


test('shared agent motion restores walking hops and keeps sleepers still', async () => {
  const { agentBob } = await import('./agentMotion.js')
  assert.equal(agentBob({}, { moving: true }, 0), 0)
  assert.equal(agentBob({}, { moving: true }, Math.PI * 55), 2.2)
  assert.equal(agentBob({ sleeping: true }, { moving: true }, Math.PI * 55), 0)
  assert(Math.abs(agentBob({}, { moving: false }, Math.PI * 450) - 1.1) < 1e-8)
})


test('fixed camera ignores old saved elevation and keeps ground picking exact', () => {
  const camera = new OrthographicCamera(-1, 1, 1, -1, .1, 1000)
  const ray = new Raycaster(), plane = new Plane(new Vector3(0, 1, 0), 0)
  for (const pitch of [20, 45, 60]) {
    configureCamera(camera, { x: 42, y: 256, zoom: 1.5, pitch }, 1100, 650)
    assert(Math.abs(camera.position.y - Math.sqrt(2 / 3) * 100) < 1e-8)
    for (const [x, z] of [[1.5, 2.5], [8.5, 9.5], [15.5, 3.5]]) {
      const ndc = new Vector3(x, 0, z).project(camera)
      ray.setFromCamera(new Vector2(ndc.x, ndc.y), camera)
      const hit = ray.ray.intersectPlane(plane, new Vector3())
      assert(Math.abs(hit.x - x) < 1e-8 && Math.abs(hit.z - z) < 1e-8)
    }
  }
})


test('card layers use ground depth with stable ties, independent of walking height', async () => {
  const { sortCards } = await import('./cardLayers.js')
  const card = (id, x, z, isAgent) => ({ position: { y: 0 }, userData: { isAgent, dto: { id, ground: { x, z } } } })
  const house = card('house', 6.5, 6.5, false), front = card('front', 6.5, 6.5, true), back = card('back', 5.5, 5.5, true)
  for (const hop of [0, .02, .056, .03, 0]) {
    front.position.y = hop
    assert.deepEqual(sortCards([front, house, back]), [back, house, front])
  }
})
