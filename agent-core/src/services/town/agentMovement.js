// 权威格位置只在完整走过一条边后改变；渲染继续用原始起点插值。
export function advanceAgentPosition(agent, now) {
  if (!agent.path?.length) {
    agent.path = null;
    return false;
  }
  const progress = Math.max(0, (now - agent.moveStartedAt) / 1000 * agent.speed);
  const completedEdges = Math.floor(progress);
  if (completedEdges >= agent.path.length) {
    Object.assign(agent, agent.path.at(-1));
    agent.path = null;
    agent.dirty = true;
    return true;
  }
  const position = completedEdges > 0 ? agent.path[completedEdges - 1] : agent.moveFrom;
  if (position) { agent.x = position.x; agent.y = position.y; }
  return false;
}
