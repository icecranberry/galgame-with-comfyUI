// 一个原生工具循环。会话、重连和业务队列都在循环之外，避免把 agent 做成工作流引擎。
export function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new Error('已停止'));
    if (signal.aborted) { reject(signal.reason); promise.catch(() => {}); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
export async function runGodAgent(run, { repo, tools, stream, prepare, signal, maxRounds = 8, maxTools = 16 }) {
  let current;
  let prepared;
  let toolCount = 0;
  let attempt = 0;
  try {
    signal?.throwIfAborted();
    const unavailable = tools.boundary?.(run.input);
    if (unavailable) { repo.message(run, 'assistant', unavailable); repo.finish(run.id, 'completed'); return; }
    prepared = await abortable(prepare(run, signal), signal);
    const messages = [...prepared.messages];
    const logId = repo.runLogLabel?.(run) || run.id;
    // 一次模型回合：allowTools 为假时不提供工具，强制模型只能给出文本收尾。
    const turn = async allowTools => {
      signal?.throwIfAborted();
      current = repo.message(run, 'assistant', '', { status: 'streaming' });
      let response;
      for await (const event of stream(messages, { tools: allowTools ? tools.definitions : undefined, signal, requestId: `${logId}/round-${++attempt}` })) {
        if (event.type === 'text_delta') repo.delta(current.id, 'content', event.text);
        else if (event.type === 'reasoning_delta') repo.delta(current.id, 'reasoning', event.text);
        else if (event.type === 'assistant_end') response = event.message;
      }
      if (!response) throw new Error('回应未完整结束，未执行不完整的工具请求');
      const { content, tool_calls, role, ...provider } = response;
      repo.updateMessage(current.id, { content: content || '', status: 'done', tool_calls: tool_calls?.length ? JSON.stringify(tool_calls) : null, provider_json: JSON.stringify(provider) });
      current = null;
      messages.push(response);
      return response;
    };
    for (let round = 0; round < maxRounds; round++) {
      // 最后一轮不再开放工具：让模型基于已有工具结果给出最终回复，避免「执行完工具却没机会收尾」。
      const response = await turn(round < maxRounds - 1);
      if (!response.tool_calls?.length) {
        prepared.commit?.();
        repo.finish(run.id, 'completed');
        return;
      }
      if (round >= maxRounds - 1) break;
      for (const call of response.tool_calls) {
        const result = signal?.aborted ? { ok: false, error: '用户已停止，未开始的操作没有执行。' }
          : ++toolCount > maxTools ? { ok: false, error: '已达到单次工具次数上限，未执行这项操作。' }
            : await tools.execute(call, run.id, round, signal);
        const content = JSON.stringify(result);
        repo.message(run, 'tool', content, { tool_call_id: call.id });
        messages.push({ role: 'tool', tool_call_id: call.id, content });
        if (result.stop) {
          // 停止当前批次中尚未执行的调用，也不给模型机会换一个写工具绕过缺失能力。
          for (const remaining of response.tool_calls.slice(response.tool_calls.indexOf(call) + 1)) {
            repo.message(run, 'tool', JSON.stringify({ ok: false, error: '能力边界已触发，本项未执行' }), { tool_call_id: remaining.id });
          }
          repo.message(run, 'assistant', result.error);
          prepared.commit?.();
          repo.finish(run.id, 'completed');
          return;
        }
      }
      signal?.throwIfAborted();
      if (toolCount >= maxTools) {
        // 工具次数已用满：再补一次纯文本收尾，让模型读完最后一批工具结果后回答，避免结果无人消费。
        const closing = await turn(false);
        if (!closing.tool_calls?.length) {
          prepared.commit?.();
          repo.finish(run.id, 'completed');
          return;
        }
        break;
      }
    }
    repo.message(run, 'assistant', '吾神，这次需要处理的事情有些多，我已经到了本轮能够继续处理的上限。已完成的工作都保留在执行记录里，您可以让我继续查看剩下的事情。');
    repo.finish(run.id, 'limited', '已达到本轮执行上限');
  } catch (err) {
    const cancelled = signal?.aborted && signal.reason?.name !== 'TimeoutError';
    if (current) repo.updateMessage(current.id, { status: cancelled ? 'cancelled' : 'interrupted' });
    if (!cancelled) repo.message(run, 'assistant', `吾神，我暂时没能完成这次回应。${signal?.reason?.name === 'TimeoutError' ? '这次回应耗时过长，已经停止。' : err.message} 已经完成的工作会保留，您可以查看执行记录。`);
    repo.finish(run.id, cancelled ? 'cancelled' : 'failed', cancelled ? null : err.message);
  }
}
