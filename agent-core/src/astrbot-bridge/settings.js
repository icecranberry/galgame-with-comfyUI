import { randomBytes, timingSafeEqual } from 'node:crypto';
import { getSetting, setSetting } from '../db/settings.js';

export const GROUPS = ['characters', 'images', 'tts', 'moments', 'appearance', 'events', 'schedule', 'newspaper', 'diary', 'world'];
export function getBridgeSettings() {
  const saved = JSON.parse(getSetting('astrbot_bridge') || '{}');
  return { enabled: false, character_id: null, inject_persona: true, tools: GROUPS,
    public_url: 'http://127.0.0.1:3099', ...saved };
}
export function getBridgeToken() { return getSetting('astrbot_bridge_token') || ''; }
export function ensureBridgeToken() {
  if (!getBridgeToken()) setSetting('astrbot_bridge_token', randomBytes(32).toString('hex'));
  return getBridgeToken();
}
export function rotateBridgeToken() {
  setSetting('astrbot_bridge_token', randomBytes(32).toString('hex'));
  return getBridgeToken();
}
export function validToken(value) {
  const token = getBridgeToken();
  const a = Buffer.from(String(value || '')), b = Buffer.from(token);
  return !!token && a.length === b.length && timingSafeEqual(a, b);
}
export function saveBridgeSettings(body, db) {
  const next = { ...getBridgeSettings() };
  for (const key of ['enabled', 'inject_persona']) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== 'boolean') throw new Error(`${key} 必须是布尔值`);
      next[key] = body[key];
    }
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
  if (next.enabled && next.inject_persona && !next.character_id) throw new Error('请先选择初始人格角色，或关闭人格注入');
  ensureBridgeToken();
  setSetting('astrbot_bridge', JSON.stringify(next));
  return next;
}
