import { Vector3 } from 'three'
import { imageAlphaHit } from './imageAlpha.js'
import { visibleBodySamples } from './interactionOcclusion.js'

export const cardDepth = mesh => mesh.userData.dto.ground.x + mesh.userData.dto.ground.z
export function sortCards(cards) {
  return cards.sort((a, b) => cardDepth(a) - cardDepth(b)
    || Number(a.userData.isAgent) - Number(b.userData.isAgent)
    || String(a.userData.dto.agent?.agentKey ?? a.userData.dto.id ?? '').localeCompare(String(b.userData.dto.agent?.agentKey ?? b.userData.dto.id ?? '')))
}

export function cardOccludesAgent(building, agent, camera) {
  if (building.renderOrder <= agent.renderOrder || !building.material.map) return false
  building.updateMatrixWorld(true); agent.updateMatrixWorld(true)
  // Probe the character's body against actual building alpha, not its padded box.
  // Cards share the fixed view-facing horizontal axis and a vertical up axis.
  const near = new Vector3(-.5, -.5, 0).applyMatrix4(building.matrixWorld).project(camera)
  const far = new Vector3(.5, .5, 0).applyMatrix4(building.matrixWorld).project(camera)
  for (const { projected: point } of visibleBodySamples(agent, camera)) {
    const u = (point.x - near.x) / (far.x - near.x)
    const v = 1 - (point.y - near.y) / (far.y - near.y)
    if (imageAlphaHit(building.material.map.image, u, v, building.material.alphaTest)) return true
  }
  return false
}
