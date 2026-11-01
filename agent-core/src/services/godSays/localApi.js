// 调用同进程服务监听的固定 loopback 地址；能力目录决定可访问的路由。
export function publicToolData(value) {
  let remaining = 60000; let truncated = false;
  function visit(item, depth = 0) {
    if (depth > 12 || remaining <= 0) { truncated = true; return '[内容省略，请缩小查询范围]'; }
    if (typeof item === 'string') {
      const length = Math.min(12000, remaining);
      remaining -= Math.min(item.length, length);
      if (item.length > length) { truncated = true; return item.slice(0, length) + '\n[内容省略]'; }
      return item;
    }
    if (Array.isArray(item)) {
      const output = [];
      for (const row of item.slice(0, 100)) { if (remaining <= 0) break; remaining -= 4; output.push(visit(row, depth + 1)); }
      if (output.length < item.length) truncated = true;
      return output;
    }
    if (item && typeof item === 'object') {
      const output = {};
      for (const [key, v] of Object.entries(item)) {
        if (/(?:api_?key|password|secret|credential|service_?account|access_?token|refresh_?token|base64)/i.test(key)) continue;
        if (remaining <= 0) { truncated = true; break; }
        remaining -= key.length + 4;
        output[key] = visit(v, depth + 1);
      }
      return output;
    }
    remaining -= 8;
    return item;
  }
  const result = visit(value);
  return truncated && result && !Array.isArray(result) && typeof result === 'object'
    ? { ...result, _truncated: true, _notice: '结果已截取，请使用分页或按编号进一步查询。' } : result;
}

async function readJson(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0; let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4 * 1024 * 1024) throw new Error('返回内容过多，请缩小查询范围或使用分页');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function readChatStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const messages = []; let text = ''; let buffer = ''; let bytes = 0; let failure;
  const frame = raw => {
    let type = 'message'; const lines = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) type = line.slice(6).trim();
      if (line.startsWith('data:')) lines.push(line.slice(5).trimStart());
    }
    if (!lines.length) return;
    const data = JSON.parse(lines.join('\n'));
    if (type === 'token' && typeof data.content === 'string' && text.length < 16000) text += data.content;
    if (type === 'msg_saved') messages.push(data);
    if (type === 'error') failure = data.message || data.error || '角色回复中断';
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      bytes += value?.byteLength || 0;
      if (bytes > 4 * 1024 * 1024) throw new Error('角色回复过长，请到私聊核对已保存结果');
      buffer = buffer.replace(/\r\n/g, '\n');
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) { frame(buffer.slice(0, index)); buffer = buffer.slice(index + 2); }
      if (done) { if (buffer.trim()) frame(buffer); break; }
    }
    const replies = messages.filter(m => m.role === 'assistant');
    if (!replies.length) throw Object.assign(new Error(failure || '传话已发起，但尚未确认角色完整回复，请查看私聊记录'), { uncertain: true });
    return { messages, reply: text.slice(0, 16000), partial: !!failure, ...(failure ? { error: failure } : {}) };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function createGodLocalApi({ port, fetchImpl = fetch } = {}) {
  return async function call(request, { signal, effectKey } = {}) {
    const write = request.method !== 'GET';
    const base = `http://127.0.0.1:${typeof port === 'function' ? port() : port}`;
    const url = new URL(request.path, base);
    if (url.origin !== base || !url.pathname.startsWith('/api/') || url.username || url.password || url.hash) throw new Error('业务接口地址无效');
    signal?.throwIfAborted();
    let started = false;
    try {
      started = true;
      const response = await fetchImpl(url.href, {
        method: request.method, redirect: 'error',
        headers: { Accept: request.stream ? 'application/json, text/event-stream' : 'application/json',
          ...(request.body ? { 'Content-Type': 'application/json' } : {}),
          ...(effectKey ? { 'X-Linshe-God-Operation': effectKey } : {}) },
        body: request.body ? JSON.stringify(request.body) : undefined,
        signal: AbortSignal.any([AbortSignal.timeout(540000), ...(signal ? [signal] : [])]),
      });
      const type = response.headers.get('content-type') || '';
      if (!response.ok && !type.includes('application/json')) throw Object.assign(new Error('原功能接口暂不可用，请核对服务状态'), { uncertain: write && response.status >= 500 });
      if (type.includes('text/event-stream') && request.stream && response.ok) return { status: response.status, data: publicToolData(await readChatStream(response)) };
      if (!type.includes('application/json')) throw new Error('原功能接口未返回有效结果');
      const data = await readJson(response);
      if (!response.ok || data?.ok === false || data?.success === false) throw Object.assign(new Error(data?.error || data?.message || '原功能模块未完成此项操作'), { uncertain: write && response.status >= 500, knownResponse: true });
      return { status: response.status, data: publicToolData(data) };
    } catch (error) {
      // 写请求断线/超时后，业务服务可能已经提交，不能声称明确失败或盲目重放。
      if (write && started && !error.knownResponse) error.uncertain = true;
      throw error;
    }
  };
}
