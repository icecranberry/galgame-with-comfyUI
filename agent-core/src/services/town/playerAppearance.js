/**
 * 玩家形象（「我」）的生图外观口径。
 *
 * 玩家没有 characters / town_npcs 行，外观只存在用户配置（config.user）里，
 * 既没有 townAppearanceSignature 的来源指针，也不会落进素材 meta。
 * 所以生成与「重新生成」提示词都必须实时读这里，才能带上「我」的外观描述。
 */
import { getDb } from '../../db/index.js';
import { config } from '../../config.js';

/** 世界观 styleTags：优先取素材库中已存的（整套共享），保证玩家形象与小镇风格一致 */
export function getWorldStyleTags() {
  const row = getDb().prepare(`
    SELECT meta_json FROM town_assets WHERE status = 'ready' AND kind IN ('ground','road','building','prop') ORDER BY id LIMIT 1
  `).get();
  if (!row) return '';
  try { return JSON.parse(row.meta_json || '{}').styleTags || ''; } catch { return ''; }
}

/** 玩家 立绘 / 小人的「角色外观信息」文本（与 NPC 的四层结构对齐，实时读用户配置） */
export function playerAppearanceInfo() {
  const u = config.user;
  return [
    `【名字】${u.nickname || '我'}（来到小镇的玩家）`,
    u.gender ? `【性别】${u.gender}` : '',
    u.appearance ? `【外观描述】${u.appearance}` : '',
    u.persona ? `【人设】${u.persona}` : '',
    `【画风基调】${getWorldStyleTags() || 'cozy pixel town'}`,
  ].filter(Boolean).join('\n');
}