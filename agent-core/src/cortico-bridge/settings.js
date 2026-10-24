import { getSetting, setSetting } from '../db/settings.js';

export const GROUPS = ['characters', 'images', 'tts', 'moments', 'appearance', 'events', 'schedule', 'newspaper', 'diary', 'world'];
export function getBridgeSettings() {
  const saved = JSON.parse(getSetting('cortico_bridge') || '{}');
  // 纯本地集成恒为启用；enabled 仅保留在存储里以兼容旧数据。
  return { character_id: null, inject_persona: true, tools: GROUPS,
    public_url: 'http://127.0.0.1:3099', ...saved, enabled: true };
}
export function saveBridgeSettings(body, db) {
  const next = { ...getBridgeSettings() };
  if (body.inject_persona !== undefined) {
    if (typeof body.inject_persona !== 'boolean') throw new Error('inject_persona 必须是布尔值');
    next.inject_persona = body.inject_persona;
  }
  if (body.character_id !== undefined) {
    const id = body.character_id;
    if (id !== null && (!Number.isSafeInteger(id) || id <= 0 || !db.prepare('SELECT id FROM characters WHERE id=?').get(id))) throw new Error('请选择有效的邻舍角色');
    next.character_id = id;
  }
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools) || body.tools.some(v => !GROUPS.includes(v))) throw new Error('工具分组无效');
    next.tools = [...new Set(body.tools)];
  }
  if (body.public_url !== undefined) {
    let url;
    try { url = new URL(body.public_url); }
    catch { throw new Error('请填写邻舍服务根地址，如 http://127.0.0.1:3099'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('请填写邻舍服务根地址，如 http://127.0.0.1:3099');
    next.public_url = url.origin;
  }
  if (next.inject_persona && !next.character_id) throw new Error('请先选择初始人格角色，或关闭人格注入');
  setSetting('cortico_bridge', JSON.stringify(next));
  return next;
}
