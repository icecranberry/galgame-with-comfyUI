/**
 * maibot-bridge/memory.js
 * 将 MaiBot 驱动的一轮对话累积在进程内存中，每 40 句整理一次，
 * 只把整理结果（最新一份记忆）覆盖写入 maibot_latest_memory。
 * 原始 QQ 句子不落任何库（邻舍不存来自 MaiBot 的对话内容），进程重启后累积周期重新开始。
 * 注意：按约定不更新情绪与好感度。
 */
import { getDb } from '../db/index.js';
import { curateAccumulatedMemory } from '../services/memoryExtractor.js';
import { cleanChatText } from './textCleaner.js';

const CURATE_EVERY_N_MESSAGES = 40;

// 进程内存中的累积状态：session_id -> { accumulated, message_count, last_client_msg_id }
const stateBySession = new Map();

export async function saveConversation({ character, user_name = '', user_message = '', reply_text = '', client_msg_id = '', session_id = '' }) {
  if (!session_id) {
    console.warn('[maibot-bridge] saveConversation: session_id 不能为空，跳过记忆累积');
    return { skipped: true, memory_saved: false };
  }

  const state = stateBySession.get(session_id);
  if (client_msg_id && state && state.last_client_msg_id === String(client_msg_id)) {
    console.log(`[maibot-bridge] idempotent: skip duplicate (client_msg_id=${client_msg_id})`);
    return { skipped: true, memory_saved: false };
  }

  // 只累积清洗后的真实发言，不写入聊天库
  const userText = cleanChatText(user_message);
  const replyText = cleanChatText(reply_text);
  // 群聊中用户昵称/ID 天然来自消息前缀，无需缺省值；为空时不写发言者前缀
  const speakerTag = user_name ? `[${user_name}] ` : '';
  const line = `${speakerTag}${userText}\n[${character.display_name || '角色'}] ${replyText}`;
  const accumulated = state ? `${state.accumulated}\n${line}` : line;
  const messageCount = (state?.message_count || 0) + 2;

  stateBySession.set(session_id, {
    accumulated,
    message_count: messageCount,
    last_client_msg_id: client_msg_id ? String(client_msg_id) : (state?.last_client_msg_id ?? null),
  });

  let memory_saved = false;
  if (messageCount >= CURATE_EVERY_N_MESSAGES) {
    memory_saved = await curateAndStore({ session_id, accumulated, characterName: character.display_name || '', userName: user_name });
  }
  return { skipped: false, memory_saved, message_count: messageCount };
}

export function clearLatestMemory(sessionId = '') {
  const db = getDb();
  if (sessionId) {
    const row = db.prepare('DELETE FROM maibot_latest_memory WHERE session_id = ?').run(String(sessionId));
    return row.changes;
  }
  const all = db.prepare('DELETE FROM maibot_latest_memory').run();
  return all.changes;
}

async function curateAndStore({ session_id, accumulated, characterName, userName }) {
  try {
    const content = await curateAccumulatedMemory({ accumulatedText: accumulated, characterName, userName });
    if (content) {
      const db = getDb();
      db.prepare(`
        INSERT INTO maibot_latest_memory (session_id, content, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(session_id) DO UPDATE SET content = excluded.content, updated_at = CURRENT_TIMESTAMP
      `).run(session_id, content);
      console.log(`[maibot-bridge] 记忆整理已更新 session=${session_id}`);
    }
    // 无论是否产生新记忆，重置累积周期（保留 last_client_msg_id 以继续幂等）
    const lastClientMsgId = stateBySession.get(session_id)?.last_client_msg_id ?? null;
    stateBySession.set(session_id, { accumulated: '', message_count: 0, last_client_msg_id: lastClientMsgId });
    return !!content;
  } catch (err) {
    console.error('[maibot-bridge] 记忆整理失败:', err.message);
    return false;
  }
}