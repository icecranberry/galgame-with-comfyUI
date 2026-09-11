import * as T from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { withTownOcclusionFade } from './interactionOcclusion.js'

// Pure geometry/material construction: no DOM, requests, cache or scene mutations.
// Texture ownership remains with the renderer cache; this group owns geometries/materials.
export function createBuildingVolume(spec, entries = {}, alphaCutoff = .3) {
  const group = new T.Group(), { width: w, depth: d, palette: p, door } = spec
  const casters = [], lamps = []
  const material = (face, color) => withTownOcclusionFade(new T.MeshLambertMaterial({
    color: entries[face]?.ready ? '#ffffff' : color,
    map: entries[face]?.ready ? entries[face].texture : null,
    alphaTest: alphaCutoff, side: T.DoubleSide, transparent: true,
    // Surviving texels are opaque: no alpha blending needs a separate back pass.
    // Retain transparent-list ordering so these surfaces depth-test legacy cards.
    forceSinglePass: true,
    emissive: color, emissiveIntensity: .06,
  }))
  const add = (geometry, face, color, casts = true) => {
    const mesh = new T.Mesh(geometry, material(face, color))
    mesh.receiveShadow = true
    mesh.userData.entry = entries[face]
    mesh.userData.face = face
    group.add(mesh)
    if (casts) casters.push(geometry)
    return mesh
  }
  const box = (x, y, z, sx, sy, sz, face, color, casts = true) => add(new T.BoxGeometry(sx, sy, sz).translate(x, y, z), face, color, casts)
  // Solid columns occupy exactly the logical blocked footprint cells. The entire
  // door cell stays free at walking height, with a recessed entrance at its rear.
  for (const cell of spec.cells) {
    box(cell.x + .5, (p.height + .2) / 2, cell.y + .5, 1, p.height - .2, 1, 'wall', p.wall)
    box(cell.x + .5, .10, cell.y + .5, 1, .2, 1, 'trim', p.trim)
  }
  // Roof prism, split into separately textured roof planes and wall gables.
  const e = .12, y = p.height, ridge = y + p.roofRise
  const face = (points, kind, color) => {
    const g = new T.BufferGeometry()
    g.setAttribute('position', new T.Float32BufferAttribute(points.flat(), 3))
    g.setAttribute('uv', new T.Float32BufferAttribute(points.length === 3 ? [0,0,1,0,.5,1] : [0,0,1,0,1,1,0,1], 2))
    // Outward winding is required for receiver normalBias as well as lighting;
    // double-pass BackSide rendering previously masked inward roof normals.
    g.setIndex(points.length === 3 ? [0,2,1] : [0,2,1,0,3,2]); g.computeVertexNormals()
    return add(g, kind, color)
  }
  face([[-e,y,-e], [w/2,ridge,-e], [w/2,ridge,d+e], [-e,y,d+e]], 'roof', p.roof)
  face([[w/2,ridge,-e], [w+e,y,-e], [w+e,y,d+e], [w/2,ridge,d+e]], 'roof', p.roof)
  face([[0,y,0],[w,y,0],[w/2,ridge,0]], 'wall', p.wall)
  face([[w,y,d],[0,y,d],[w/2,ridge,d]], 'wall', p.wall)
  // Entrances support each perimeter side, using the same dx/dy as blocking.
  const south = door.side === 'south', north = door.side === 'north'
  const horizontal = south || north
  const x = door.dx + .5, z = door.dy + .5
  const rearX = horizontal ? x : x + (door.side === 'east' ? -.48 : .48)
  const rearZ = horizontal ? z + (south ? -.48 : .48) : z
  box(rearX, .7, rearZ, horizontal ? .76 : .035, 1.4, horizontal ? .035 : .76, 'door', '#5b5145', false)
  // Shallow threshold remains within the exempt door cell; never adds blocking.
  box(x, .035, z, .88, .07, .88, 'trim', '#b6a68c', false)
  const outerX = horizontal ? x : x + (door.side === 'east' ? .51 : -.51)
  const outerZ = horizontal ? z + (south ? .51 : -.51) : z
  box(outerX, p.height - .32, outerZ, horizontal ? .94 : .08, .4, horizontal ? .08 : .94, 'sign', p.sign, false)
  // Small geometric emblems distinguish the untextured prototypes without raster art.
  const emblem = (a, b, sx, sy) => box(outerX + (horizontal ? a : (door.side === 'east' ? .055 : -.055)), p.height - .32 + b,
    outerZ + (horizontal ? (south ? .055 : -.055) : a), horizontal ? sx : .02, sy, horizontal ? .02 : sx, 'emblem', '#fff1d2', false)
  if (spec.profile === 'cafe') { emblem(-.06, -.03, .22, .17); emblem(.09, 0, .09, .09); emblem(-.05, .11, .03, .06) }
  else if (spec.profile === 'workshop') { emblem(0,-.025,.045,.25); emblem(.035,.095,.27,.075) }
  else { emblem(0,0,.25,.28); emblem(.02,.045,.31,.025); emblem(.02,-.045,.31,.025) }
  // Visible south/east facade windows; skip the entrance cell on either facade.
  for (const cell of spec.cells) {
    for (const side of ['south', 'east']) {
      if (side === 'south' ? cell.y !== d - 1 : cell.x !== w - 1) continue
      const front = side === 'south'
      const wx = cell.x + (front ? .5 : 1.015), wz = cell.y + (front ? 1.015 : .5)
      box(wx, p.height * .56, wz, front ? .61 : .055, .76, front ? .055 : .61, 'trim', p.trim, false)
      const window = box(wx + (front ? 0 : .035), p.height * .56, wz + (front ? .035 : 0), front ? .49 : .02, .61, front ? .02 : .49, 'window', '#8fa6a1', false)
      lamps.push(window.material)
      box(wx + (front ? 0 : .05), p.height * .56, wz + (front ? .05 : 0), front ? .045 : .025, .64, front ? .025 : .045, 'trim', p.trim, false)
    }
  }
  // One shadow source per building, no card shadow or extra contact projection.
  // Duplicate only geometry, not textures: alpha-cut decoration doesn't cast.
  const shadow = new T.Mesh(mergeGeometries(casters), new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: T.DoubleSide }))
  shadow.castShadow = true; shadow.userData.pickIgnore = true
  group.add(shadow)
  group.position.set(spec.origin.x, 0, spec.origin.z)
  group.userData.volume = true
  group.userData.isAgent = false
  group.userData.lamps = lamps
  return group
}

const DAY_WINDOW = new T.Color('#8fa6a1')
const NIGHT_WINDOW = new T.Color('#ffdd93')
const NIGHT_WINDOW_EMISSIVE = new T.Color('#ffb954')

// Windows warm up smoothly with the night glow factor instead of snapping on/off.
export function setBuildingVolumeNight(group, glow = 0) {
  for (const lamp of group.userData.lamps) {
    lamp.color.copy(DAY_WINDOW).lerp(NIGHT_WINDOW, glow)
    lamp.emissive.setRGB(0, 0, 0).lerp(NIGHT_WINDOW_EMISSIVE, glow)
    lamp.emissiveIntensity = 1.4 * glow
  }
}
