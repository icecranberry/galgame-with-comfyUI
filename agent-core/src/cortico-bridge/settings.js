import { getSetting, setSetting } from '../db/settings.js';

export const GROUPS = ['characters', 'images', 'tts', 'moments', 'appearance', 'schedule', 'newspaper', 'diary', 'world'];
// 奇遇查询已下线：旧配置里的 events 分组静默剔除，不因遗留值报错。
const RETIRED_GROUPS = ['events'];
export function getBridgeSettings() {
  const saved = JSON.parse(getSetting('cortico_bridge') || '{}');
  const merged = { character_id: null, inject_persona: true, tools: GROUPS,
    public_url: 'http://127.0.0.1:3099', webui_port: 7900, ...saved, enabled: true };
  merged.tools = (Array.isArray(merged.tools) ? merged.tools : GROUPS).filter(group => GROUPS.includes(group));
  // 行为/表达风格按角色 id 存一份 map；坏数据回退为空。
  merged.persona_styles = saved.persona_styles && typeof saved.persona_styles === 'object' && !Array.isArray(saved.persona_styles) ? saved.persona_styles : {};
  return merged;
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
    const requested = Array.isArray(body.tools) ? body.tools.filter(group => !RETIRED_GROUPS.includes(group)) : body.tools;
    if (!Array.isArray(requested) || requested.some(v => !GROUPS.includes(v))) throw new Error('工具分组无效');
    next.tools = [...new Set(requested)];
  }
  if (body.webui_port !== undefined) {
    const port = Number(body.webui_port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('webui_port 必须是 1–65535 的整数');
    next.webui_port = port;
  }
  if (body.public_url !== undefined) {
    let url;
    try { url = new URL(body.public_url); }
    catch { throw new Error('请填写邻舍服务根地址，如 http://127.0.0.1:3099'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('请填写邻舍服务根地址，如 http://127.0.0.1:3099');
    next.public_url = url.origin;
  }
  // 行为/表达风格跟随当前 character_id 存取（body 里可只带其中一段，另一段保持原值）。
  if (body.behavior_style !== undefined || body.reply_style !== undefined) {
    for (const key of ['behavior_style', 'reply_style']) {
      if (body[key] !== undefined && typeof body[key] !== 'string') throw new Error(`${key} 必须是字符串`);
    }
    if (!next.character_id) throw new Error('请先选择初始角色，再保存行为 / 表达风格');
    const current = next.persona_styles[String(next.character_id)] || {};
    next.persona_styles = {
      ...next.persona_styles,
      [String(next.character_id)]: {
        behavior_style: body.behavior_style !== undefined ? body.behavior_style.trim() : current.behavior_style || '',
        reply_style: body.reply_style !== undefined ? body.reply_style.trim() : current.reply_style || '',
      },
    };
  }
  if (next.inject_persona && !next.character_id) throw new Error('请先选择初始人格角色，或关闭人格注入');
  setSetting('cortico_bridge', JSON.stringify(next));
  return next;
}
