/**
 * maibot-bridge/textCleaner.js
 * 聊天文本清洗：去掉 MaiBot 消息元数据、工具调用块与模型指令块，只保留真实发言。
 * 供配图判断、生图 prompt 提取、记忆整理等链路共用。
 */

const TOOL_CALL_KEYS = ['tool_call_id', 'tool_name', 'args', 'result_status', 'result'];
const INSTRUCTION_START_MARKERS = ['当前时间：', '你想要回复的消息是', '【回复信息参考】', '【关键信息参考】', '回复指引：', '关键信息参考：', '请优先依据'];

export function cleanChatText(text) {
  // 清洗聊天文本：去掉消息元数据、工具调用块和 MaiBot 指令块，只保留真实发言
  const kept = [];
  let inToolBlock = false;
  let inInstructionBlock = false;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^<message\b/.test(line)) continue; // 消息元数据标签
    if (line.startsWith('[图片')) { kept.push('[图片]'); continue; }
    if (line === '[表情包]') { kept.push('[表情包]'); continue; }
    if (line.includes('已折叠的历史工具调用') || line.startsWith('[工具调用')) { inToolBlock = true; continue; }
    if (inToolBlock) {
      if (line.startsWith('-') || line.startsWith('·') || line.startsWith('*') || TOOL_CALL_KEYS.includes(line.split(':')[0].trim())) continue;
      inToolBlock = false;
    }
    if (INSTRUCTION_START_MARKERS.some((marker) => line.startsWith(marker))) { inInstructionBlock = true; continue; }
    if (inInstructionBlock) {
      const m = line.match(/^-\s*发言内容：(.*)$/);
      if (m) kept.push(m[1].trim());
      continue;
    }
    kept.push(line);
  }
  return kept.join(' ');
}
