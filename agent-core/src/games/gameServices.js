import { bad } from './gamePaths.js';

export function createGameServices(gameId, repo, assertPermission) {
  const controller = new AbortController();
  const active = () => {
    const game = repo.game(gameId);
    if (!game?.installed || !game.enabled) throw bad('游戏未安装或已停用', 409);
  };
  const llm = {
    async chat(messages, options = {}, { signal } = {}) {
      active(); assertPermission('llm:chat');
      if (!Array.isArray(messages) || !messages.length || messages.length > 100 || messages.some(m => !['system', 'user', 'assistant', 'tool'].includes(m.role) || typeof m.content !== 'string') || JSON.stringify(messages).length > 180000) throw bad('LLM 消息格式或长度不合法');
      const { chatSync } = await import('../services/lorebook/runtime.js');
      return chatSync(messages, { temperature: Math.max(0, Math.min(2, Number(options.temperature) || 0.7)), label: `游戏:${gameId}`,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(240000), ...(signal ? [signal] : [])]), retries: 0,
        ...(options.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
        lorebook: options.lorebook ?? false });
    },
    async request({ rules, personas = [], data = '', task, scope = 'turn' }) {
      const { getSystemRulesWithWorld, getWorldSetting } = await import('../db/worldRepository.js');
      const { getWorldIntegrationRule } = await import('../builtinRules.js');
      const messages = [{ role: 'system', content: getSystemRulesWithWorld({ roleplay: false }) }];
      if (getWorldSetting()) messages.push({ role: 'system', content: getWorldIntegrationRule('interaction') });
      messages.push({ role: 'system', content: rules });
      const boundary = { index: messages.length - 1, offset: rules.length };
      const staticTexts = messages.map(m => m.content);
      for (const persona of personas.filter(Boolean)) messages.push({ role: 'system', content: persona });
      if (data) messages.push({ role: 'system', content: data });
      messages.push({ role: 'user', content: task });
      return { messages, lorebook: { scope: `game:${gameId}:${scope}`, personaTexts: personas.filter(Boolean), staticTexts, cacheBoundary: boundary,
        history: [{ role: 'system', content: data }, { role: 'user', content: task }].filter(m => m.content) } };
    },
    async complete(input, { signal } = {}) {
      const built = await llm.request(input);
      return llm.chat(built.messages, { lorebook: built.lorebook }, { signal });
    },
    async agent(input, tools, execute, { checkpoint, save, signal } = {}) {
      active(); assertPermission('llm:chat');
      const { chatAgentStream } = await import('../llm/llm-client.js');
      const { prepareLorebook } = await import('../services/lorebook/runtime.js');
      let prepared;
      if (!checkpoint?.messages) {
        const built = await llm.request(input);
        prepared = await prepareLorebook(built.messages, built.lorebook);
        if (checkpoint) {
          signal?.throwIfAborted();
          checkpoint.messages = prepared.messages.slice();
          checkpoint.baseLength = checkpoint.messages.length;
          save();
        }
      }
      const messages = checkpoint?.messages || prepared.messages.slice();
      const baseLength = checkpoint?.baseLength || messages.length;
      while (true) {
        signal?.throwIfAborted();
        const assistantIndex = messages.findLastIndex(message => message.role === 'assistant');
        if (assistantIndex >= baseLength) {
          const calls = messages[assistantIndex].tool_calls;
          const completed = messages.length - assistantIndex - 1;
          for (const call of calls.slice(completed)) {
            signal?.throwIfAborted();
            active();
            let result;
            try { result = await execute(call.function.name, JSON.parse(call.function.arguments), calls); }
            catch (error) {
              if (checkpoint && !error.gameMessage) throw error;
              result = { error: error.message };
            }
            if (checkpoint && result === undefined) {
              // A tool that yields to the game UI remains unanswered until the next resume.
              save();
              return null;
            }
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
            // The caller writes both the tool result and the game mutation in one save.
            if (checkpoint) save();
          }
        }
        const toolSteps = messages.slice(baseLength).filter(message => message.role === 'assistant').length;
        if (!checkpoint && toolSteps >= 6) throw bad('KP 工具调用超过本轮上限，已执行的裁决已保存', 502);
        let message;
        const canUseTools = !checkpoint || toolSteps < 10;
        const requestSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(240000), ...(signal ? [signal] : [])]);
        for await (const event of chatAgentStream(messages, { tools: canUseTools ? tools : [], forceThinking: false, label: `游戏:${gameId}:KP`, signal: requestSignal })) if (event.type === 'assistant_end') message = event.message;
        if (!message) throw bad('KP 未返回完整回复', 502);
        if (!message.tool_calls?.length) { prepared?.commit(); return message.content || ''; }
        if (!canUseTools) throw bad('KP 工具调用超过本轮上限', 502);
        messages.push(message);
        if (checkpoint) save();
      }
    },
  };
  return { llm, dispose: () => controller.abort(new Error('游戏已停用或卸载')),
    imageService: { async generate(options = {}) {
      active(); assertPermission('image:generate');
      if (!repo.session(gameId, options.sessionId)) throw bad('请先创建当前游戏的存档', 404);
      if (typeof options.prompt !== 'string' || !options.prompt.trim() || options.prompt.length > 12000) throw bad('图片提示词为空或过长');
      const dimension = n => Math.round(Math.max(256, Math.min(2048, Number(n) || 1024)) / 8) * 8;
      const { generateImageRaw } = await import('../services/imageSkill.js');
      const result = await generateImageRaw(options.prompt, { outputScope: 'game', gameId, sessionId: options.sessionId,
        width: dimension(options.width), height: dimension(options.height || 576), negativePrompt: String(options.negativePrompt || '').slice(0, 4000),
        alreadyPrepared: true, disableRAG: true, scene: 'events', promptScene: 'events' });
      if (!result.success || !result.url) throw bad(result.error || '游戏图片生成失败', 502);
      return { url: result.url, urls: result.urls };
    } },
  };
}
