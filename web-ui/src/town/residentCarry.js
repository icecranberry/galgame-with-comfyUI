export const CARRY_PRESS_MS = 450
const MOVE_SLOP = 8
// 手指没有鼠标稳：触摸长按的位移容差放宽，轻微抖动不算「已经拖走了」
const TOUCH_MOVE_SLOP = 18

/** Pointer gesture + cancellable async lease. Rendering and HTTP stay in adapters. */
export function createResidentCarry({ request, scope, dropCell, changed = () => {}, started = () => {},
  settled = () => {}, error = () => {}, now = Date.now, token = () => crypto.randomUUID() }) {
  let gesture = null, pressTimer = null, renewal = null, landingTimer = null
  const counts = new Map()
  const emit = () => changed(gesture?.phase === 'waiting' ? null : gesture && { ...gesture })
  const send = (g, operation, extra = {}) => request(g.agent.actorId, { ...g.scope, token: g.token, operation, ...extra })
  const clearTimers = () => {
    clearTimeout(pressTimer); clearInterval(renewal); clearTimeout(landingTimer)
    pressTimer = renewal = landingTimer = null
  }
  function abort() {
    const g = gesture
    clearTimers(); gesture = null; emit()
    if (g && !['waiting', 'starting', 'landing'].includes(g.phase)) send(g, 'cancel').catch(() => {})
    // A begin still in flight releases its own token when it finally resolves.
  }
  async function begin(g) {
    if (gesture !== g) return
    g.phase = 'starting'; started(g); emit()
    try {
      const result = await send(g, 'begin')
      if (gesture !== g) { send(g, 'cancel').catch(() => {}); return }
      g.origin = result.position; g.phase = 'held'; g.heldAt = now()
      g.count = (counts.get(g.agent.actorId) || 0) + 1
      counts.set(g.agent.actorId, g.count); emit()
      let renewing = false
      renewal = setInterval(async () => {
        if (renewing || gesture !== g || g.phase !== 'held') return
        renewing = true
        try { await send(g, 'renew') }
        catch (e) { if (gesture === g && g.phase === 'held') { abort(); error(e) } }
        finally { renewing = false }
      }, 5000)
    } catch (e) {
      // A network timeout may hide a successful begin. Release the same token.
      send(g, 'cancel').catch(() => {})
      if (gesture === g) { abort(); error(e) }
    }
  }
  function down(point, agent, pointerType = '') {
    if (gesture) return false
    if (!agent?.actorId || agent.agentKey === 'me') return false
    const g = { agent, scope: { ...scope() }, token: token(), pointerId: point.pointerId, pointerType,
      point: { x: point.x, y: point.y }, initial: { x: point.x, y: point.y }, phase: 'waiting' }
    gesture = g
    pressTimer = setTimeout(() => begin(g), CARRY_PRESS_MS)
    return true
  }
  function move(point) {
    const g = gesture
    if (!g || point.pointerId !== g.pointerId) return false
    if (g.phase === 'waiting') {
      const slop = g.pointerType === 'touch' ? TOUCH_MOVE_SLOP : MOVE_SLOP
      if (Math.hypot(point.x - g.initial.x, point.y - g.initial.y) > slop) abort()
      return false
    }
    if (['starting', 'held'].includes(g.phase)) {
      g.point = { x: point.x, y: point.y }; emit()
    }
    return true
  }
  function up(point) {
    const g = gesture
    if (!g || point.pointerId !== g.pointerId) return false
    if (g.phase === 'waiting') { abort(); return false }
    if (g.phase === 'starting') { abort(); return true }
    if (g.phase !== 'held') return true
    g.point = { x: point.x, y: point.y }; g.phase = 'dropping'
    clearInterval(renewal); renewal = null; emit()
    const cell = dropCell(g.point)
    send(g, cell ? 'drop' : 'cancel', cell || {}).then(result => {
      if (gesture !== g) return
      settled(result, g)
      g.position = result.position; g.phase = 'landing'; g.landedAt = now(); emit()
      landingTimer = setTimeout(() => { if (gesture === g) { gesture = null; emit() } }, 300)
    }).catch(e => { if (gesture === g) { abort(); error(e) } })
    return true
  }
  return { down, move, up, abort, get active() { return !!gesture && gesture.phase !== 'waiting' },
    get pointerId() { return gesture?.pointerId }, get phase() { return gesture?.phase } }
}
