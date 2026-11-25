import fs from 'node:fs';
import path from 'node:path';
import { bad, MEDIA_DIR, regularFile } from './gamePaths.js';
import { createHash } from 'node:crypto';
import { estimateTokens } from '../services/lorebook/engine.js';
import { getTimeTag } from '../services/timeLight.js';
import { appendWorldLanguageStyle } from '../services/worldLanguageStyle.js';
import { appendReplay, fitNativeReplay, GAME_REPLAY_RULE } from './trpgReplay.js';
import { assertPromptFits, promptTokens, trpgPromptBudget } from './trpgPromptBudget.js';
import { findCharacterByDisplayName, listNamedGameCharacters } from './gameBridge.js';
import { parseCharacterLoras } from '../services/groupImageLoraMatcher.js';

const JSON_OBJECT = { type: 'json_object' };

function jsonModeRejected(error) {
  if (![400, 422, 501].includes(Number(error?.status ?? error?.response?.status))) return false;
  const detail = [error.message, error.param, error.code, error.error?.message, error.error?.param, error.error?.code].join(' ');
  // Vertex only exposes the sanitized status, so retry INVALID_ARGUMENT once with the original format.
  return /response[ _]?format|response[ _]?mime[ _]?type|json[ _]?object|json mode|application\/json|Vertex AI 请求失败：HTTP 400 \(INVALID_ARGUMENT\)/i.test(detail);
}

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
      ...records.slice(fitted.start, fitted.end).map(log => ({ role: log.speakerRole === 'player' ? 'user' : 'assistant', name: log.speaker,
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
    const frozenPrefix = saved?.prefix || prepared.messages.slice(0, prepared.messages.findIndex(message => message.role !== 'system'));
    const historyStart = saved ? 0 : prefix.length;
    const preparedHistoryStart = saved ? 0 : frozenPrefix.length;
    if (finalUser?.role !== 'user' || !finalUser.content.startsWith(head) ||
      JSON.stringify(prepared.messages.slice(preparedHistoryStart, -1)) !== JSON.stringify(messages.slice(historyStart, -1))) {
      throw bad('跑团世界书改写了已冻结的历史，请重试', 502);
    }
    const keys = (prepared.report?.placements || []).flatMap(entry => entry.frozenKey ? [entry.frozenKey] : []);
    segment.userTail = finalUser.content.slice(head.length);
    if (saved && keys.length) segment.frozenLore = keys;
    const next = fitNativeReplay(fitted, records, frozenPrefix, [], tools, budget.inputLimit);
    assertPromptFits(next.messages, tools, budget.inputLimit);
    Object.assign(input.timeline, { sourceKey, prefix: frozenPrefix, replay: next.replay,
      frozenLore: saved?.frozenLore || keys });
    console.log(`[trpg-context] ${budget.model} window=${budget.contextWindow} source=${budget.source} output=${budget.maxOutputTokens} inputLimit=${budget.inputLimit} estimated=${promptTokens(next.messages, tools)} archived=${next.replay.start}`);
    return { ...prepared, messages: next.messages };
  }
  async function chat(messages, options, signal, { budget, retry, forceThinkingMode, thinkingEffort } = {}) {
    active(); assertPermission('llm:chat');
    if (!Array.isArray(messages) || !messages.length || messages.some(m => !['system', 'user', 'assistant', 'tool'].includes(m.role) || typeof m.content !== 'string') ||
      (!budget && (messages.length > 100 || JSON.stringify(messages).length > 180000))) throw bad('LLM 消息格式或长度不合法');
    const { prepareLorebook } = await import('../services/lorebook/runtime.js');
    const requestOptions = { temperature: Math.max(0, Math.min(2, Number(options.temperature) || 0.7)), label: `游戏:${gameId}`,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(240000), ...(signal ? [signal] : [])]), retries: 0,
      ...(options.responseFormat === 'json' ? { response_format: JSON_OBJECT } : {}),
      forceThinkingMode,
      ...(thinkingEffort !== undefined ? { thinkingEffort } : {}),
      ...(budget ? { requestBudget: budget } : {}),
      ...(budget || forceThinkingMode === 'enabled' ? { freeEggFailover: false } : {}) };
    const lorebook = options.lorebook ?? false;
    const prepared = await prepareLorebook(messages, lorebook === false ? false : (lorebook || {}));
    const { chatSync } = await import('../llm/llm-client.js');
    let result;
    try { result = await chatSync(prepared.messages, requestOptions); }
    catch (error) {
      if (gameId !== 'trpg-simulator' || !requestOptions.response_format || !jsonModeRejected(error)) throw error;
      requestOptions.signal.throwIfAborted();
      console.warn(`[游戏:${gameId}] 接口拒绝 JSON 模式，按普通格式重试`);
      delete requestOptions.response_format;
      result = await chatSync(prepared.messages, requestOptions);
    }
    if (retry && !retry.accepts(result)) {
      requestOptions.signal.throwIfAborted();
      const task = messages.at(-1);
      const revised = [...messages.slice(0, -1), { ...task, content: task.content + retry.taskSuffix }];
      result = await chatSync(await prepared.reapply(revised), requestOptions);
    }
    prepared.commit();
    return result;
  }
  const llm = {
    chat(messages, options = {}, { signal } = {}) {
      return chat(messages, options, signal);
    },
    async request({
      rules, taskPersona = '', personas = [], stableData = '', publicHistory = [], data = '', turnData = '', task, scope = 'turn', timeline,
      includeWorldSetting = true, worldScope = 'interaction', characterName, characterNames, expressionRules = '',
      scanData = [data, turnData].filter(Boolean).join('\n\n'),
    }) {
      const usesReplay = useReplay({ timeline });
      const tavernDialogue = gameId === 'midnight-tavern' && ['opening', 'chat', 'tasting'].includes(scope);
      const { getSystemRules, getSystemRulesWithWorld, getWorldSetting } = await import('../db/worldRepository.js');
      const { getWorldIntegrationRule, IMAGE_PROMPT_RULE_BODY } = await import('../builtinRules.js');
      const worldSetting = includeWorldSetting && getWorldSetting();
      const systemRules = worldSetting
        ? getSystemRulesWithWorld({ roleplay: false })
        : getSystemRules({ roleplay: false });
      const messages = [{ role: 'system', content: systemRules }];
      if (worldSetting) {
        messages.push({ role: 'system', content: getWorldIntegrationRule(worldScope) });
      }
      const photoRule = gameId === 'midnight-tavern' && scope === 'tipsy-cg' ? IMAGE_PROMPT_RULE_BODY : '';
      const baseTaskRules = usesReplay ? `${rules}\n${GAME_REPLAY_RULE}` : photoRule ? `${rules}\n\n${photoRule}` : rules;
      const taskRules = tavernDialogue && includeWorldSetting ? appendWorldLanguageStyle(baseTaskRules) : baseTaskRules;
      const staticTexts = [...messages.map(m => m.content), taskRules];
      messages.push({ role: 'system', content: taskPersona ? `${taskRules}\n\n${taskPersona}` : taskRules });
      const rulesBoundary = { index: messages.length - 1, offset: taskRules.length };
      const separatePersonas = personas.filter(Boolean);
      for (const persona of separatePersonas) messages.push({ role: 'system', content: persona });
      const personaTexts = taskPersona ? [taskPersona, ...separatePersonas] : separatePersonas;
      if (stableData) {
        messages.push({ role: 'system', content: stableData });
        staticTexts.push(stableData);
      }
      const cacheBoundary = stableData || tavernDialogue
        ? { index: messages.length - 1, offset: messages.at(-1).content.length }
        : rulesBoundary;
      if (tavernDialogue && expressionRules) messages.push({ role: 'system', content: expressionRules });
      if (data) messages.push({ role: 'system', content: data });
      let finalTask = gameId === 'midnight-tavern' && worldSetting
        ? task + '\n请遵循 <world_setting> 中的世界观设定。'
        : task;
      if (gameId === 'midnight-tavern' && ['opening', 'chat'].includes(scope)) {
        finalTask += `\n\n<time_context>\n当前时间：${getTimeTag()}\n</time_context>`;
      }
      const userIndex = messages.length;
      const turnHeader = '<dynamic_context>\n';
      const userContent = turnData ? `${turnHeader}${turnData}\n</dynamic_context>\n\n${finalTask}` : finalTask;
      messages.push({ role: 'user', content: userContent });
      if (!includeWorldSetting) return { messages, lorebook: false };
      const history = [
        ...(stableData ? [{ role: 'system', content: stableData }] : []),
        { role: 'system', content: scanData },
        ...(usesReplay ? [] : publicHistory).map(log => ({ role: log.role === 'user' || log.actorId === 'player' ? 'user' : 'assistant', name: log.speaker,
          content: [log.dialogue, log.action].filter(Boolean).join('\n') })),
        { role: 'user', content: finalTask },
      ].filter(m => m.content);
      const lorebook = {
        scope: `game:${gameId}:${scope}`, personaTexts, staticTexts, cacheBoundary, history,
        ...(tavernDialogue && { appendOnly: true }),
        ...(characterName && { characterName }),
        ...(characterNames?.length && { characterNames }),
      };
      if (turnData) {
        lorebook.fallbackTarget = { index: userIndex, offset: turnHeader.length + turnData.length + 1, label: '本轮任务之前' };
      }
      return { messages, lorebook };
    },
    async complete(input, { signal, responseFormat, retry, forceThinkingMode, thinkingEffort } = {}) {
      const built = await llm.request(input);
      if (useReplay(input)) {
        active(); assertPermission('llm:chat');
        const budget = await trpgPromptBudget();
        const prepared = await prepareGamePrompt(input, built, budget);
        const result = await chat(prepared.messages, { lorebook: false, responseFormat }, signal, { budget, forceThinkingMode, thinkingEffort });
        prepared.commit();
        return result;
      }
      return chat(built.messages, { lorebook: built.lorebook, responseFormat }, signal, { retry, forceThinkingMode, thinkingEffort });
    },
    async agent(input, tools, execute, { checkpoint, save, signal, responseFormat, toolChoice, forceThinkingMode, thinkingEffort } = {}) {
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
      let format = responseFormat === 'json' ? JSON_OBJECT : undefined;
      while (true) {
        signal?.throwIfAborted();
        const assistantIndex = continuation.findLastIndex(message => message.role === 'assistant');
        if (assistantIndex >= 0) {
          // A content-only assistant may sit here after an injected format-repair exchange.
          const calls = continuation[assistantIndex].tool_calls || [];
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
            if (result && typeof result === 'object' && result.__endTurn) {
              // A terminal tool hands the caller structured output and ends the loop;
              // the sentinel itself never reaches the provider transcript.
              continuation.push({ role: 'tool', tool_call_id: call.id,
                content: JSON.stringify({ ...result, __endTurn: undefined }) });
              persistContinuation();
              return continuation[assistantIndex].content || '';
            }
            continuation.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
            // The caller writes both the tool result and the game mutation in one save.
            persistContinuation();
          }
        }
        const toolSteps = continuation.filter(message => message.role === 'assistant').length;
        if (!checkpoint && toolSteps >= 6) throw bad('KP 工具调用超过本轮上限，已执行的裁决已保存', 502);
        const requestTools = !checkpoint || toolSteps < 10 ? tools : [];
        let messages;
        if (checkpoint?.promptTail) {
          const { replay, prefix } = input.timeline;
          const next = fitNativeReplay(replay, input.publicHistory, prefix, continuation, requestTools, budget.inputLimit);
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
        const ask = async () => {
          let reply;
          for await (const event of chatAgentStream(messages, { tools: requestTools, forceThinking: false, forceThinkingMode,
            ...(thinkingEffort !== undefined ? { thinkingEffort } : {}),
            label: `游戏:${gameId}:KP`, signal: requestSignal, requestBudget: budget, response_format: format,
            // toolChoice 'required' 关闭正文出口；空工具列表时必须回退 auto，否则部分接口会拒绝请求。
            ...(toolChoice && requestTools.length ? { toolChoice } : {}) })) {
            if (event.type === 'assistant_end') reply = event.message;
          }
          return reply;
        };
        let message;
        try { message = await ask(); }
        catch (error) {
          if (!format || !jsonModeRejected(error)) throw error;
          requestSignal.throwIfAborted();
          console.warn(`[游戏:${gameId}:KP] 接口拒绝 JSON 模式，本轮沿用普通格式`);
          format = undefined;
          message = await ask();
        }
        if (!message) throw bad('KP 未返回完整回复', 502);
        if (!message.tool_calls?.length) {
          prepared?.commit();
          return message.content || '';
        }
        if (!requestTools.length) throw bad('KP 工具调用超过本轮上限', 502);
        continuation.push(message);
        persistContinuation();
      }
    },
  };
  async function generateGameImage(options = {}, resolveLoras) {
    active(); assertPermission('image:generate');
    const session = repo.session(gameId, options.sessionId);
    if (!session) throw bad('请先创建当前游戏的存档', 404);
    if (typeof options.prompt !== 'string' || !options.prompt.trim() || options.prompt.length > 12000) throw bad('图片提示词为空或过长');
    const comfyOnly = options.requireComfyUI === true;
    if (comfyOnly && (await import('../config.js')).config.comfyui.imageProvider !== 'comfyui') {
      throw bad('当前未启用 ComfyUI', 409);
    }
    const loras = resolveLoras?.(session.state);
    const dimension = n => Math.round(Math.max(256, Math.min(2048, Number(n) || 1024)) / 8) * 8;
    const { generateImageRaw } = await import('../services/imageSkill.js');
    const result = await generateImageRaw(options.prompt, { outputScope: 'game', gameId, sessionId: options.sessionId,
      ...(comfyOnly ? { imageProvider: 'comfyui' } : {}), loras,
      width: dimension(options.width), height: dimension(options.height || 576), negativePrompt: String(options.negativePrompt || '').slice(0, 4000),
      normalizeComfyCountTags: options.normalizeComfyCountTags !== false,
      alreadyPrepared: true, disableRAG: true, scene: 'game', workflowScene: 'events', promptScene: 'events' });
    if (!result.success || !result.url) throw bad(result.error || '游戏图片生成失败', 502);
    return { url: result.url, urls: result.urls };
  }

  async function replayTavernImage({ sessionId, key }) {
    active(); assertPermission('image:generate');
    if (gameId !== 'midnight-tavern' || repo.game(gameId)?.source !== 'official') throw bad('该游戏无法重画酒馆图片', 403);
    const entry = repo.session(gameId, sessionId)?.state?.media?.[key];
    if (entry?.status !== 'ready' || entry.redraw?.status !== 'pending') throw bad('没有已触发的酒馆重画任务', 404);
    const album = /^\/images\/game\/([\w-]+\.(?:png|avif))$/.exec(entry.url);
    const oldPath = /^\/game-media\/midnight-tavern\/([\w-]+)\/([\w-]+\.png)$/.exec(entry.url);
    const legacy = oldPath?.[1] === sessionId ? oldPath[2] : null;
    if (!album && !legacy) return null;
    const { getImageDir } = await import('../services/imagePaths.js');
    const root = legacy ? MEDIA_DIR : getImageDir('game');
    let name = legacy ? `${gameId}/${sessionId}/${legacy}` : album[1];
    if (album && name.endsWith('.png') && !fs.existsSync(path.join(root, name))) name = name.replace(/\.png$/, '.avif');
    if (!fs.existsSync(path.join(root, name))) return null;
    const { readImageWorkflow } = await import('../services/imageWorkflowMetadata.js');
    const sourceWorkflow = await readImageWorkflow(regularFile(root, name));
    if (!sourceWorkflow) return null;
    controller.signal.throwIfAborted();
    if (entry.kind === 'standing') {
      const { renderTavernStanding } = await import('./tavernStanding.js');
      return renderTavernStanding({ gameId, sessionId, sourceWorkflow, tier: entry.tier,
        sessionExists: () => !controller.signal.aborted && !!repo.session(gameId, sessionId) });
    }
    const { generateImageRaw } = await import('../services/imageSkill.js');
    const result = await generateImageRaw('', { sourceWorkflow, globalLoraSnapshot: sourceWorkflow.generation?.globals,
      outputScope: 'game', gameId, sessionId });
    if (!result.success || !result.url) throw bad(result.error || '酒馆照片重画失败', 502);
    return { url: result.url };
  }

  async function prepareTrpgScene({ sessionId, description, characters, playerName, speakerName, style, background }) {
    active(); assertPermission('image:generate'); assertPermission('llm:chat');
    if (gameId !== 'trpg-simulator' || repo.game(gameId)?.source !== 'official') throw bad('该游戏无法调用跑团画面工具', 403);
    const session = repo.session(gameId, sessionId);
    if (!session) throw bad('跑团存档不存在', 404);
    if (typeof description !== 'string' || !description.trim() || description.length > 3000) throw bad('画面描述为空或过长');
    const { generateStudioScenePrompt } = await import('../services/imageStudioScene.js');
    const { RAG_TIMEOUT_FAST_MS } = await import('../services/imagePromptKnowledge.js');
    const { config } = await import('../config.js');
    const explicitCast = characters?.length > 0;
    let names = background ? [] : characters;
    if (!background && !explicitCast) {
      const { investigators = [], keeper } = session.state;
      const participants = new Set([keeper?.name, ...investigators.map(card => card.name)]);
      names = listNamedGameCharacters(repo.db).filter(({ name }) =>
        (name === speakerName && participants.has(name)) ||
        ((name.length >= 2 || participants.has(name)) && description.includes(name))
      ).map(({ name }) => name);
    }
    const explicitCharacters = names.filter(name => name !== playerName).map(name => {
      const character = findCharacterByDisplayName(repo.db, name);
      if (!character) throw bad(`无法唯一识别入镜角色「${name}」`);
      return character;
    });
    const includeUser = background ? false : explicitCast ? characters.includes(playerName) : undefined;
    const hints = [style, background ? '纯环境空镜，不画人物，不添加文字。' : '表现角色的动作和当前状态，不添加文字。'].filter(Boolean).join('\n');
    const { prompt, loras, characterLoraActors } = await generateStudioScenePrompt(description, { explicitCharacters, includeUser, userName: playerName, style: hints,
      roleplay: false, scope: `image:trpg:${sessionId}`, signal: controller.signal });
    controller.signal.throwIfAborted();
    const { eventArtist, eventWidth, eventHeight } = config.comfyui;
    return { prompt, options: {
      scene: 'game', workflowScene: 'events', promptScene: 'events',
      artist: eventArtist, width: eventWidth, height: eventHeight, loras, characterLoraActors, ragQuery: description, ragTimeoutMs: RAG_TIMEOUT_FAST_MS } };
  }

  return { llm, dispose: () => controller.abort(new Error('游戏已停用或卸载')),
    imageService: { generate: options => generateGameImage(options), replayTavernImage,
    async generateTavernTipsy({ key, ...options }) {
      if (gameId !== 'midnight-tavern' || repo.game(gameId)?.source !== 'official') throw bad('该游戏无法调用酒馆饮后照片工具', 403);
      return generateGameImage({ ...options, requireComfyUI: true }, state => {
        const drink = state.drinks?.find(item => `tipsy-${item.id}` === key);
        const entry = state.media?.[key];
        if (!drink || (entry?.status !== 'pending' && entry?.redraw?.status !== 'pending')) throw bad('没有已触发的酒馆饮后照片任务', 404);
        const guest = state.people?.[drink.guestName];
        if (guest?.local) return [];
        const character = findCharacterByDisplayName(repo.db, drink.guestName);
        if (!character) throw bad('客人缺少饮后照片所需的角色资料', 404);
        return parseCharacterLoras(character);
      });
    }, async generateTavernStanding({ sessionId, key, label, direction, localPersona, onPrompt }) {
      active(); assertPermission('image:generate'); assertPermission('llm:chat');
      const game = repo.game(gameId);
      if (gameId !== 'midnight-tavern' || game.source !== 'official') throw bad('该游戏无法调用酒馆立绘工具', 403);
      const entry = repo.session(gameId, sessionId)?.state?.media?.[key];
      if (entry?.kind !== 'standing' || (entry.status !== 'pending' && entry.redraw?.status !== 'pending')) {
        throw bad('没有已触发的酒馆立绘任务', 404);
      }
      if (typeof label !== 'string' || !label.trim() || label.length > 20 ||
        typeof direction !== 'string' || !direction.trim() || direction.length > 1600) {
        throw bad('临时立绘请求参数无效');
      }
      const hasLocalPersona = typeof localPersona === 'string' && !!localPersona.trim();
      const character = hasLocalPersona ? null : findCharacterByDisplayName(repo.db, entry.guestName);
      if (!character && !hasLocalPersona) throw bad('客人缺少立绘所需的角色资料', 404);
      const sessionExists = () => !controller.signal.aborted && !!repo.session(gameId, sessionId);
      const savedPrompt = entry.redraw?.prompt ?? entry.prompt;
      let prompt = typeof savedPrompt === 'string' ? savedPrompt.trim() : '';
      if (!prompt) {
        const { generateStandingPrompts } = await import('../services/expressionStandingService.js');
        const { buildCharacterPersona } = await import('../services/characterPersona.js');
        const person = character?.display_name || character?.name;
        const persona = character ? buildCharacterPersona(character, {
          variant: 'short', person, outfits: null, fallbackToBase: false,
        }) || person || '酒馆客人' : localPersona;
        const slots = [{ id: entry.tier, name: label }];
        const prompts = await generateStandingPrompts(character, slots, '', persona, 'work', {
          drinkState: { label, value: entry.tipsy, direction },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]),
        });
        if (!sessionExists()) throw bad('酒馆进度已关闭', 409);
        prompt = prompts.get(entry.tier);
        onPrompt?.(prompt);
      }
      const { renderTavernStanding } = await import('./tavernStanding.js');
      if (!sessionExists()) throw bad('酒馆进度已关闭', 409);
      return renderTavernStanding({
        gameId, sessionId, character, prompt, tier: entry.tier, sessionExists,
      });
    }, prepareTrpgScene,
    async generateScene(input) {
      const { prompt, options } = await prepareTrpgScene(input);
      const { generateImageRaw } = await import('../services/imageSkill.js');
      const result = await generateImageRaw(prompt, { ...options, outputScope: 'game', gameId, sessionId: input.sessionId });
      if (!result.success || !result.url) throw bad(result.error || '游戏图片生成失败', 502);
      return { url: result.url };
    } },
  };
}
