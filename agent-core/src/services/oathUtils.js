import { getDb } from '../db/index.js';

/**
 * 获取誓约角色的银白细戒指描述文本
 * @param {number} characterId
 * @param {string} userName - 用户昵称显示名
 * @param {object} [opts]
 * @param {boolean} [opts.isFirstPerson] - true=用"你", false=用角色名
 * @param {string} [opts.charName] - 第三人称时使用的角色名（默认"角色"）
 * @returns {string} 戒指描述段落，非誓约角色返回空字符串
 */
export function getOathRingDescription(characterId, userName, opts = {}) {
  const db = getDb();
  const isOath = db.prepare(
    'SELECT is_oath FROM user_relationships WHERE character_id = ?'
  ).pluck().get(characterId) || 0;

  if (!isOath) return '';

  const displayName = opts.charName || '角色';

  if (opts.isFirstPerson) {
    return `\n\n【重要外观特征】你的左手无名指上戴着一枚银白细戒指——这是${userName}送给你的誓约证明。`;
  }
  return `\n\n【重要外观特征】${displayName}的左手无名指上戴着一枚银白细戒指——这是${userName}送给${displayName}的誓约证明。`;
}

/**
 * 将誓约银白细戒指描述追加到角色人格文本末尾
 * @param {string} baseText - 原始人格文本
 * @param {number} characterId
 * @param {string} userName
 * @param {object} [opts]
 * @param {boolean} [opts.isFirstPerson] - true=用"你", false=用角色名
 * @param {string} [opts.charName] - 第三人称时使用的角色名
 * @returns {string} 追加后的完整文本
 */
export function appendOathRing(baseText, characterId, userName, opts = {}) {
  const desc = getOathRingDescription(characterId, userName, opts);
  return desc ? baseText + desc : baseText;
}
