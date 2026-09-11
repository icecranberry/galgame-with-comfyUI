import { Raycaster, Vector2, Vector3 } from 'three'
import { imageAlphaHit } from './imageAlpha.js'

// Pure alpha fade keeps the legacy translucent look for interaction occlusion.
// Physical shadow casters are intentionally not decorated with this UI effect.
export function withTownOcclusionFade(material) {
  const fade = material.userData.townFade = { value: 1 }
  const compile = material.onBeforeCompile, cacheKey = material.customProgramCacheKey.bind(material)
  material.onBeforeCompile = function(shader, renderer) {
    compile.call(this, shader, renderer)
    shader.uniforms.townFade = fade
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float townFade;').replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\ndiffuseColor.a *= townFade;')
  }
  material.customProgramCacheKey = () => `${cacheKey()}:interaction-alpha-v1`
  return material
}

export function setBuildingOcclusion(building, occluded) {
  building.userData.occluding = occluded
  const value = occluded ? .32 : 1
  if (building.userData.volume) building.traverse(mesh => {
    if (!mesh.userData.pickIgnore && mesh.material?.userData.townFade) mesh.material.userData.townFade.value = value
  })
  else if (building.material?.userData.townFade) building.material.userData.townFade.value = value
}

const ray = new Raycaster(), ndc = new Vector2()
// Test painted body samples, not the sprite's padded bounds. Keep partially
// visible subjects eligible, but never cast from outside the camera clip cube.
export function* visibleBodySamples(agent, camera) {
  agent.updateMatrixWorld(true)
  for (const x of [-.25, 0, .25]) for (const y of [-.35, 0, .35]) {
    const map = agent.material.map
    if (map && !imageAlphaHit(map.image, x + .5, .5 - y, agent.material.alphaTest)) continue
    const world = new Vector3(x, y, 0).applyMatrix4(agent.matrixWorld)
    const projected = world.clone().project(camera)
    // Allow only floating-point noise at the inclusive near/far/viewport edges.
    if (![projected.x, projected.y, projected.z].every(v => Number.isFinite(v) && Math.abs(v) <= 1 + 1e-10)) continue
    yield { world, projected }
  }
}
export function volumeOccludesAgent(building, agent, camera, alphaHit) {
  building.updateMatrixWorld(true)
  for (const { world, projected } of visibleBodySamples(agent, camera)) {
    ndc.set(projected.x, projected.y); ray.setFromCamera(ndc, camera)
    const distance = ray.ray.origin.distanceTo(world)
    if (ray.intersectObject(building, true).some(hit => !hit.object.userData.pickIgnore
      && hit.distance < distance - .0001 && alphaHit(hit))) return true
  }
  return false
}
