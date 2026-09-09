/**
 * 聊天流活跃度登记（跨模块轻量状态，无持久化）
 *
 * 用途：整理 daemon（consolidationScheduler）的空闲判定——"无活跃 SSE 聊天流"。
 * 聊天路由在流式响应开始/结束时调用 chatStreamStarted/chatStreamEnded。
 * 计数器容错：结束调用多于开始调用时不会变成负数。
 */

let activeChatStreams = 0;

export function chatStreamStarted() {
  activeChatStreams++;
}

export function chatStreamEnded() {
  activeChatStreams = Math.max(0, activeChatStreams - 1);
}

export function hasActiveChatStream() {
  return activeChatStreams > 0;
}
