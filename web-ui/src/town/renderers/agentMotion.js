// Shared Canvas/HD2D motion in projected world pixels.
export function agentBob(agent, pos, nowMs) {
  if (agent.sleeping) return 0
  return pos.moving ? Math.abs(Math.sin(nowMs / 110)) * 2.2 : Math.sin(nowMs / 900 + (agent.npcId || 0)) * 1.1
}
