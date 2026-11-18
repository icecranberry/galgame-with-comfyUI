import { bad } from './gamePaths.js';
import { createHash } from 'node:crypto';
import { estimateTokens } from '../services/lorebook/engine.js';
import { appendReplay, fitNativeReplay, fitReplay, GAME_REPLAY_RULE } from './trpgReplay.js';
import { assertPromptFits, promptTokens, trpgPromptBudget } from './trpgPromptBudget.js';

export function createGameServices(gameId, repo, assertPermission) {
  const controller = new AbortController();
  const active = () => {
    const game = repo.game(gameId);
    if (!game?.installed || !game.enabled) throw bad('游戏未安装或已停用', 409);
  };
  const useReplay = input => gameId === 'trpg-simulator' && input.timeline && repo.game(gameId)?.source === 'official';

  async function prepareGamePrompt(input, built, budget, tools = []) {
    const { prepareLorebook } = await import('../services/lorebook/runtime.js');
    if (!budget) return prepareLorebook(built.messages, built.lorebook);

    const { getActiveWorldSetting, isWorldSettingHidden } = await import('../db/worldRepository.js');
    const world = isWorldSettingHidden() ? null : getActiveWorldSetting();
    const book = world && repo.db.prepare('SELECT enabled, revision FROM world_lorebooks WHERE world_id=?').get(world.id);
    const baseCount = built.lorebook.cacheBoundary.index + 1;
    const base = built.messages.slice(0, baseCount);
    const sourceKey = createHash('sha256').update(JSON.stringify([base, world?.id, book])).digest('hex');
    const saved = input.timeline.sourceKey === sourceKey ? input.timeline : null;
    const fields = input.data ? JSON.parse(input.data) : {};
    const records = input.publicHistory || [];
    const task = built.messages.at(-1);
    const replay = appendReplay(saved?.replay, records, fields, task.content);
    const prefix = saved?.prefix || base;
    const { messages, replay: fitted } = fitNativeReplay(replay, records, prefix, [], tools, budget.inputLimit);
    assertPromptFits(messages, tools, budget.inputLimit);
    const history = [
      { role: 'system', content: input.stableData }, { role: 'system', content: input.data },
      ...records.slice(fitted.start, fitted.end).map(log => ({ role: log.actorId === 'player' ? 'user' : 'assistant', name: log.speaker,
        content: [log.dialogue, log.action].filter(Boolean).join('\n') })),
      task,
    ].filter(message => message.content);
    const prepared = await prepareLorebook(messages, { ...built.lorebook, appendOnly: true,
      history, immutablePrefix: saved ? messages.length - 1 : 0,
      frozenLore: [...(saved?.frozenLore || []), ...fitted.segments.flatMap(segment => segment.frozenLore || [])],
      contextTokens: budget.inputLimit + budget.maxOutputTokens, maxOutputTokens: budget.maxOutputTokens,
      reservedTokens: promptTokens(messages, tools) - messages.reduce((total, message) => total + estimateTokens(message.content) + 4, 0),
    });
    const segment = fitted.segments.at(-1);
    const head = messages.at(-1).content.slice(0, -segment.userTail.length);
    const finalUser = prepared.messages.at(-1);
    if (finalUser?.role !== 'user' || !finalUser.content.startsWith(head) ||
      (saved && JSON.stringify(prepared.messages.slice(0, -1)) !== JSON.stringify(messages.slice(0, -1)))) {
      throw bad('跑团世界书改写了已冻结的历史，请重试', 502);
    }
    const keys = (prepared.report?.placements || []).flatMap(entry => entry.frozenKey ? [entry.frozenKey] : []);
    const frozenPrefix = saved?.prefix || prepared.messages.slice(0, -1);
    segment.userTail = finalUser.content.slice(head.length);
    if (saved && keys.length) segment.frozenLore = keys;
    const next = fitNativeReplay(fitted, records, frozenPrefix, [], tools, budget.inputLimit);
    assertPromptFits(next.messages, tools, budget.inputLimit);
    Object.assign(input.timeline, { sourceKey, prefix: frozenPrefix, replay: next.replay,
      frozenLore: saved?.frozenLore || keys });
    console.log(`[trpg-context] ${budget.model} window=${budget.contextWindow} source=${budget.source} output=${budget.maxOutputTokens} inputLimit=${budget.inputLimit} estimated=${promptTokens(next.messages, tools)} archived=${next.replay.start}`);
    return { ...prepared, messages: next.messages };
  }
  async function chat(messages, options, signal, budget) {
    active(); assertPermission('llm:chat');
    if (!Array.isArray(messages) || !messages.length || messages.some(m => !['system', 'user', 'assistant', 'tool'].includes(m.role) || typeof m.content !== 'string') ||
      (!budget && (messages.length > 100 || JSON.stringify(messages).length > 180000))) throw bad('LLM 消息格式或长度不合法');
    const { chatSync } = await import('../services/lorebook/runtime.js');
    return chatSync(messages, { temperature: Math.max(0, Math.min(2, Number(options.temperature) || 0.7)), label: `游戏:${gameId}`,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(240000), ...(signal ? [signal] : [])]), retries: 0,
      ...(options.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
      ...(budget ? { requestBudget: budget, freeEggFailover: false } : {}),
      lorebook: options.lorebook ?? false });
  }
  const llm = {
    chat(messages, options = {}, { signal } = {}) {
      return chat(messages, options, signal);
    },
    async request({ rules, personas = [], stableData = '', publicHistory = [], data = '', task, scope = 'turn', timeline }) {
      const usesReplay = useReplay({ timeline });
      const { getSystemRulesWithWorld, getWorldSetting } = await import('../db/worldRepository.js');
      const { getWorldIntegrationRule } = await import('../builtinRules.js');
      const messages = [{ role: 'system', content: getSystemRulesWithWorld({ roleplay: false }) }];
      if (getWorldSetting()) messages.push({ role: 'system', content: getWorldIntegrationRule('interaction') });
      const taskRules = usesReplay ? `${rules}\n${GAME_REPLAY_RULE}` : rules;
      messages.push({ role: 'system', content: taskRules });
      const rulesBoundary = { index: messages.length - 1, offset: taskRules.length };
      const staticTexts = messages.map(m => m.content);
      const personaTexts = personas.filter(Boolean);
      for (const persona of personaTexts) messages.push({ role: 'system', content: persona });
      if (stableData) {
        messages.push({ role: 'system', content: stableData });
        staticTexts.push(stableData);
      }
      const cacheBoundary = stableData ? { index: messages.length - 1, offset: stableData.length } : rulesBoundary;
      if (data) messages.push({ role: 'system', content: data });
      messages.push({ role: 'user', content: task });
      const history = [
        ...(stableData ? [{ role: 'system', content: stableData }] : []),
        { role: 'system', content: data },
        ...(usesReplay ? [] : publicHistory).map(log => ({ role: log.actorId === 'player' ? 'user' : 'assistant', name: log.speaker,
          content: [log.dialogue, log.action].filter(Boolean).join('\n') })),
        { role: 'user', content: task },
      ].filter(m => m.content);
      return { messages, lorebook: { scope: `game:${gameId}:${scope}`, personaTexts, staticTexts, cacheBoundary, history } };
    },
    async complete(input, { signal } = {}) {
      const built = await llm.request(input);
      if (useReplay(input)) {
        active(); assertPermission('llm:chat');
        const budget = await trpgPromptBudget();
        const prepared = await prepareGamePrompt(input, built, budget);
        const result = await chat(prepared.messages, { lorebook: false }, signal, budget);
        input.timeline.replay.segments.at(-1).responses = [{ role: 'assistant', content: result }];
        prepared.commit();
        return result;
      }
      return llm.chat(built.messages, { lorebook: built.lorebook }, { signal });
    },
    async agent(input, tools, execute, { checkpoint, save, signal } = {}) {
      active(); assertPermission('llm:chat');
      const { chatAgentStream } = await import('../llm/llm-client.js');
      const budget = useReplay(input) ? await trpgPromptBudget() : null;
      let prepared;
      if (!checkpoint?.messages && !checkpoint?.promptTail) {
        const built = await llm.request(input);
        prepared = await prepareGamePrompt(input, built, budget, tools);
        if (checkpoint) {
          signal?.throwIfAborted();
          if (budget) {
            checkpoint.promptTail = prepared.messages.at(-1);
            checkpoint.continuation = [];
          } else {
            checkpoint.messages = prepared.messages.slice();
            checkpoint.baseLength = checkpoint.messages.length;
          }
          save();
        }
      }
      const base = checkpoint?.messages?.slice(0, checkpoint.baseLength) || prepared?.messages;
      const continuation = checkpoint?.continuation || checkpoint?.messages?.slice(checkpoint.baseLength) || [];
      const persistContinuation = () => {
        if (!checkpoint) return;
        if (checkpoint.messages) checkpoint.messages = [...base, ...continuation];
        save();
      };
      while (true) {
        signal?.throwIfAborted();
        const assistantIndex = continuation.findLastIndex(message => message.role === 'assistant');
        if (assistantIndex >= 0) {
          const calls = continuation[assistantIndex].tool_calls;
          const completed = continuation.length - assistantIndex - 1;
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
              persistContinuation();
              return null;
            }
            continuation.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
            // The caller writes both the tool result and the game mutation in one save.
            persistContinuation();
          }
        }
        const toolSteps = continuation.filter(message => message.role === 'assistant').length;
        if (!checkpoint && toolSteps >= 6) throw bad('KP 工具调用超过本轮上限，已执行的裁决已保存', 502);
        let message;
        const requestTools = !checkpoint || toolSteps < 10 ? tools : [];
        let messages;
        if (checkpoint?.promptTail) {
          const { replay, prefix } = input.timeline;
          const next = replay.segments.at(-1)?.userTail !== undefined
            ? fitNativeReplay(replay, input.publicHistory, prefix, continuation, requestTools, budget.inputLimit)
            : fitReplay(replay, input.publicHistory, prefix, [checkpoint.promptTail, ...continuation], requestTools, budget.inputLimit);
          messages = next.messages;
          assertPromptFits(messages, requestTools, budget.inputLimit);
          if (next.replay !== replay) {
            input.timeline.replay = next.replay;
            persistContinuation();
          }
        } else {
          messages = [...base, ...continuation];
        }
        const requestSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(240000), ...(signal ? [signal] : [])]);
        for await (const event of chatAgentStream(messages, { tools: requestTools, forceThinking: false,
          label: `游戏:${gameId}:KP`, signal: requestSignal, requestBudget: budget })) if (event.type === 'assistant_end') message = event.message;
        if (!message) throw bad('KP 未返回完整回复', 502);
        if (!message.tool_calls?.length) {
          const segment = input.timeline?.replay?.segments?.at(-1);
          if (budget && segment?.userTail !== undefined) segment.responses = [...continuation, message];
          prepared?.commit();
          return message.content || '';
        }
        if (!requestTools.length) throw bad('KP 工具调用超过本轮上限', 502);
        continuation.push(message);
        persistContinuation();
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
