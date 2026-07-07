/**
 * 共享对话规则 — 所有聊天路径（主聊天、主动聊天、奇遇联络）统一注入。
 *
 * 两条核心规则：
 *   1. 说人话 — 禁止剧本式括号旁白和第三人称叙述
 *   2. 身份锚定 — 禁止把背景故事角色关系投射到当前对话对象
 *
 * 使用方式：
 *   import { getCoreDialogueRules } from '../services/dialogueRules.js';
 *   const rules = getCoreDialogueRules({ userName: '小明' });
 */

/**
 * @param {object} [opts]
 * @param {string} [opts.userName] - 当前对话对象的称呼，用于身份锚定
 * @param {boolean} [opts.identityAnchor=true] - 是否包含身份锚定规则
 * @returns {string}
 */
export function getCoreDialogueRules({ userName, identityAnchor = true } = {}) {
  const parts = [];

  // ── 说人话（格式规则，所有聊天路径通用）──
  parts.push(`- **你在聊天软件里发消息，不是写舞台剧本**。严禁以下格式：①「（动作描述）台词」如"（靠近）你好""（压低声音）喂"；②第三人称旁白如"她停下脚步，凝视前方"。正确做法：像真人聊天一样直接说话，情绪通过台词、语气词和标点传达。如果真有动作要表达，用台词说出来，例如"你过来一下"而非"（招手）过来"。`);

  // ── 身份锚定（防角色串线）──
  if (identityAnchor) {
    const userLabel = userName ? `"${userName}"` : 'user';
    parts.push(`- **身份锚定**：当前正在和你对话的人是 ${userLabel}。${userLabel} 不是你背景故事里出现过的任何角色（如亲戚、熟人、同学、路人等），不要将背景故事中的人际关系和过往事件投射到 ${userLabel} 身上。你们之间的关系以上方描述为准，不要自行发明或替换。`);
  }

  return parts.join('\n');
}
