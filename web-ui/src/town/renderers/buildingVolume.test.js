import test from 'node:test'
import assert from 'node:assert/strict'
import { Raycaster, Vector3 } from 'three'
import { adaptBuildingVolume, BUILDING_PROFILES } from './buildingVolumeProfile.js'
import { createBuildingVolume, setBuildingVolumeNight } from './buildingVolumeGeometry.js'
import { adaptObject } from './TownSceneAdapter.js'
import { buildBlockedCells } from './projection.js'

const instance = { id: 'prototype', assetId: 1, x: 4, y: 7 }
const asset = (profile = 'cafe', extra = {}) => ({ id: 1, kind: 'building', meta: {
  projection: 'modular_volume', modularVolumeVersion: 1, buildingProfile: profile,
  footprint: { w: 3, h: 3 }, doorOffset: { dx: 1, dy: 2 }, ...extra,
} })
const dispose = group => group.traverse(m => { m.geometry?.dispose(); m.material?.dispose() })

test('only explicit supported asset metadata opts in; legacy DTO stays unchanged', () => {
  const legacy = { id: 1, kind: 'building', meta: { footprint: { w: 3, h: 3 } } }
  const dto = adaptObject(instance, legacy)
  assert.equal(dto.render.projection, 'legacy_iso_card'); assert(!Object.hasOwn(dto, 'volume'))
  for (const changes of [{ modularVolumeVersion: 2 }, { projection: 'legacy_iso_card' }, { buildingProfile: 'toString' },
    { buildingProfile: 'unknown' }, { footprint: { w: 10000, h: 3 } }, { doorOffset: { dx: 1, dy: 1 } }]) {
    assert.equal(adaptBuildingVolume(asset('cafe', changes), instance), null)
  }
  assert.equal(adaptBuildingVolume(legacy, { ...instance, render: asset().meta }), null)
  assert.equal(adaptObject(instance, asset()).render.projection, 'modular_volume')
  assert.deepEqual(adaptBuildingVolume(asset('cafe', { updatedAt: 17, buildingTextures: { wall:'/wall.png?scale=2#face', roof:42 } }), instance).textures, { wall:'/wall.png?scale=2&v=17#face' })
})

test('all profiles and perimeter doors match blocking cells, with one shadow source and switchable windows', () => {
  for (const profile of Object.keys(BUILDING_PROFILES)) for (const [dx, dy] of [[1,2],[2,1],[1,0],[0,1]]) {
    const a = asset(profile, { doorOffset: { dx, dy } }), original = JSON.stringify(a)
    const spec = adaptBuildingVolume(a, instance), group = createBuildingVolume(spec)
    const blocked = buildBlockedCells({ cols: 12, rows: 12, assets: [a], layers: { objects: [instance] } })
    assert.deepEqual(new Set(spec.cells.map(c => `${spec.origin.x+c.x},${spec.origin.z+c.y}`)), blocked)
    group.updateMatrixWorld(true)
    // Vertical rays at walking height cannot hit walls in the exempt door cell.
    const ray = new Raycaster(new Vector3(spec.origin.x+dx+.5, .8, spec.origin.z+dy+.5), new Vector3(0,-1,0), 0, .6)
    assert.equal(ray.intersectObject(group, true).filter(h => h.object.userData.face === 'wall').length, 0)
    let shadows = 0
    group.traverse(m => { if (m.castShadow) shadows++ })
    assert.equal(shadows, 1)
    for (const roof of group.children.filter(m => m.userData.face === 'roof')) {
      assert(roof.geometry.attributes.normal.getY(0) > 0, 'roof receiver normals must face upward')
      assert.equal(roof.material.forceSinglePass, true)
    }
    setBuildingVolumeNight(group, true)
    assert(group.userData.lamps.every(m => m.emissiveIntensity === 1.4))
    setBuildingVolumeNight(group, false)
    assert(group.userData.lamps.every(m => m.emissiveIntensity === 0))
    assert.equal(JSON.stringify(a), original)
    dispose(group)
  }
})
