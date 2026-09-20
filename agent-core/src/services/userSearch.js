/**
 * 用户（玩家本人）提及匹配
 *
 * 与 characterSearch.js 同构，但用户不是 characters 表的一行：没有 id、没有 loras、
 * 没有 base_prompt。因此单独成模块，绝不混入 characterSearch 的 registry
 * （下游会把匹配结果的 id 当 characters.id 去查 LoRA，混入会取到错误角色）。
 *
 * 用户资料只有一个来源：config.user（无 user 表）。
 */

import { config } from '../config.js';

// config.user.nickname 缺省值就是占位名 '用户'（用户没设置昵称时的默认值）。
// 占位名不算「提到了用户」：否则正文里出现「用户」一词就会误注入，故显式排除。
const PLACEHOLDER_NAMES = new Set(['用户', 'user']);

/** 当前用户名（与 chat.js / groupChatEngine.js 的 `nickname || '用户'` 口径一致，额外去空白） */
export function getUserName() {
  return String(config.user?.nickname || '用户').trim();
}

/**
 * 文本中是否提到了用户本人。
 * @param {string} text - 待扫描文本（历史消息 + 最后一轮对话 / 画面描述）
 * @returns {boolean}
 */
export function matchUser(text) {
  if (typeof text !== 'string' || !text) return false;
  const name = getUserName();
  // 与 characterSearch 同口径：单字名太容易误命中（如「你」「我」类单字昵称）
  if (name.length < 2) return false;
  if (PLACEHOLDER_NAMES.has(name.toLowerCase())) return false;
  return text.includes(name);
}
