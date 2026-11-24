/* Independent game frontend. Campaign state lives in SDK saves. */
(() => {
  const sdk = window.LinSheGameSDK, root = document.getElementById('app'), dialog = document.getElementById('drawer');
  let pictureTriggerId = '';
  const audio = new window.TrpgAudioManager(sdk?.trpgAudio);
  let closeAudioControls;
  let catalog = { scenarios: [], skills: [] }, characters = [], saves = [], state = null, pendingAction = '', advanceFlight;
  let mode = 'investigator', scenarioId = '', keeperName = null, draft = '', npcSpeaker = '';
  let castAssets, castRequest = 0;
  const lineups = { keeper: [], investigator: [] };
  const partyLimits = { keeper: 4, investigator: 5 };
  const freshCreator = () => ({ step: 1, idea: '', answers: [] });
  let creator = freshCreator();
  const view = window.TrpgPresentation;
  const presetActions = {
    keeper: [
      '补充调查员眼前的环境',
      '让一位 NPC 主动开口',
      '请调查员说说各自的打算',
      '描述现场传来的声音',
      '补充现场的光线和气味',
      '指出一个值得细看的地方',
      '请调查员回顾已知线索',
      '让调查员对照彼此的发现',
      '问调查员打算先追哪条线索',
      '请一位调查员说明行动方法',
      '问调查员准备怎么分工',
      '说明眼前有哪些路线',
      '交代现场有没有旁人',
      '让 NPC 说说自己的见闻',
      '让 NPC 向调查员提个问题',
      '描述等待片刻后的变化',
      '交代行动前能察觉的风险',
      '提醒调查员眼下的时间限制',
      '请调查员盘点可用的装备',
      '请调查员说说目前的推测',
    ],
    investigator: [
      '问队友发现了什么',
      '仔细查看周围',
      '留在原地听一听',
      '看看附近有没有出入口',
      '找找有没有人经过的痕迹',
      '靠近一点看清楚细节',
      '退到安全处再观察',
      '记下眼前的异常之处',
      '对照一下手头的线索',
      '按时间顺序梳理已知情况',
      '问问在场的人看到了什么',
      '追问对方是怎么知道的',
      '先观察对方说话时的反应',
      '把我的发现告诉队友',
      '和队友商量怎么分工',
      '请队友留意周围的动静',
      '检查随身有哪些工具',
      '沿原路回看遗漏的地方',
      '确认现在的位置和方向',
      '等一会儿看看情况有无变化',
    ],
  };
  let actionSuggestionSample;
  let activeTab = 'narrative', packTab = 'dossier', packActor = '', diceAnimating = false, secretRoll = null;
  const recentRolls = [], knownLogs = new Set(), scrollPositions = {};
  const knownPrivateClues = new Set();
  const diceQueue = [], pendingRolls = new Set(), seenRolls = new Set();
  const pendingOperations = new Map();
  let submittedTurn, firstNewFrame, turnIllustration = false;
  let uiSessionId, lastBackground = '';
  let controlChar = '', replacementName = '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const button = (action, label, kind = '', extra = '') => `<button type="button" data-action="${action}" class="${kind}" ${extra}>${label}</button>`;
  const post = (url, body) => sdk.ext.request(url, { method: 'POST', body: JSON.stringify({ ...(state ? { sessionId: state.sessionId } : {}), ...body }) });
  const readState = sessionId => sdk.ext.request(`/state?sessionId=${encodeURIComponent(sessionId)}`);
  const newOperationId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  async function retryablePost(url, body) {
    const key = JSON.stringify([state.sessionId, url, body]);
    const operationId = pendingOperations.get(key) || newOperationId();
    pendingOperations.set(key, operationId);
    const result = await post(url, { ...body, operationId });
    pendingOperations.delete(key);
    return result;
  }
  const isThinking = () => ['send', 'next', 'submit-ruling', 'replacement', 'random-item', 'use-item'].includes(pendingAction);
  function notice(message, error = false) {
    const inline = error && dialog.open && !dialog.classList.contains('closing') && dialog.querySelector('.drawer-notice');
    if (inline) {
      inline.textContent = message;
      inline.hidden = false;
      return;
    }
    const el = document.getElementById('notice');
    el.textContent = message;
    el.className = error ? 'visible error' : 'visible';
    clearTimeout(notice.timer);
    notice.timer = setTimeout(() => { el.className = ''; }, 6000);
  }
  async function work(fn, action = 'background') {
    if (pendingAction) return;
    pendingAction = action;
    const inline = dialog.querySelector('.drawer-notice');
    if (inline) inline.hidden = true;
    refreshBusy();
    try { await fn(); }
    catch (error) { notice(error.message, true); }
    finally {
      const repaint = isThinking() && state;
      pendingAction = '';
      if (repaint) render();
      else refreshBusy();
    }
  }
  function refreshBusy() {
    const busy = Boolean(pendingAction);
    const playbackLocked = Boolean(state?.playbackRemaining || state?.pendingTurn);
    document.querySelectorAll('[data-network]').forEach(el => {
      el.dataset.blocked ??= String(el.disabled);
      el.disabled = busy || el.dataset.blocked === 'true' ||
        (playbackLocked && el.closest('.keeper-console, .keeper-actor-panel') !== null);
    });
    const actorWait = dialog.querySelector('.keeper-actor-wait');
    if (actorWait) actorWait.hidden = !playbackLocked;
    const stageAdvance = root.querySelector('.stage-advance');
    if (stageAdvance) {
      stageAdvance.hidden = !state.playbackRemaining;
      stageAdvance.setAttribute('aria-disabled', String(Boolean(advanceFlight) || diceAnimating));
    }
    document.body.classList.toggle('is-busy', busy);
    const launch = document.getElementById('lobby-start');
    const starting = pendingAction === 'start';
    launch?.setAttribute('aria-busy', String(starting));
    for (const el of document.querySelectorAll('[data-wait-label]')) {
      const waiting = isThinking() && (el.dataset.action === pendingAction || el.dataset.action === 'waiting');
      el.setAttribute('aria-busy', String(waiting));
    }
    const status = document.getElementById('working');
    if (status) {
      const startingInLobby = starting && Boolean(launch);
      status.classList.toggle('sr-only', startingInLobby || isThinking());
      status.textContent = startingInLobby ? '正在准备开局…' : isThinking() ? '正在推演…' : busy && !starting ? '正在整理线索…' : '';
    }
  }
  function modal(title, content, wide = false) {
    delete dialog.dataset.imageCollection;
    const switching = dialog.open;
    if (!switching) dialog.dataset.returnFocus = document.activeElement?.id || '';
    dialog.classList.remove('closing'); dialog.classList.toggle('wide', wide); dialog.classList.toggle('lobby-drawer', !state);
    dialog.innerHTML = `<header><div><span class="eyebrow">CASE FILE</span><h2 id="drawer-title" class="${switching ? 'drawer-switching' : ''}">${esc(title)}</h2></div>${button('close', '×', 'close', 'aria-label="关闭"')}</header><p class="drawer-notice" role="alert" hidden></p><div class="drawer-body ${switching ? 'drawer-switching' : ''}">${content}</div>`;
    wireChoices();
    refreshBusy();
    if (!switching) dialog.showModal();
  }
  function keeperToolModal(title, content, actor) {
    const back = actor ? button('hud-actor', '← 返回个人操作', 'quiet-action actor-panel-back',
      `data-target="${esc(actor.name)}" data-network`) : '';
    modal(title, back + content);
  }
  function closeModal() {
    if (!dialog.open || dialog.classList.contains('closing')) return;
    dialog.classList.add('closing');
    setTimeout(() => {
      dialog.close();
      dialog.classList.remove('closing');
      document.getElementById(dialog.dataset.returnFocus)?.focus({ preventScroll: true });
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 300);
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeModal(); });
  dialog.addEventListener('close', playReadyFrame);
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeModal();
  });
  function restorePictureFocus() {
    document.getElementById(pictureTriggerId)?.focus({ preventScroll: true });
    pictureTriggerId = '';
    playReadyFrame();
  }
  async function openPicture(trigger) {
    if (pictureTriggerId || dialog.classList.contains('closing')) return;
    pictureTriggerId = trigger.id;
    try {
      await sdk.ui.previewTrpgPicture(trigger.querySelector('img').getAttribute('src'));
    } catch (error) {
      restorePictureFocus();
      notice(error.message, true);
    }
  }
  function wireChoices() { document.querySelectorAll('[data-picker]').forEach(group => { group.value = group.dataset.value; }); }
  function lobbyData() {
    const { scenarios } = catalog;
    const scenario = scenarios.find(item => item.id === scenarioId);
    const available = characters.filter(character => ![castAssets.player.name, 'all', 'party'].includes(character.name));
    const names = new Set(available.map(character => character.name));
    const selected = lineups[mode].filter(name => names.has(name));
    const selectedKeeper = names.has(keeperName) ? keeperName : null;
    const handoutCount = scenario?.handoutCount ?? 0;
    const limit = handoutCount ? Math.min(partyLimits[mode], handoutCount - (mode === 'investigator' ? 1 : 0)) : partyLimits[mode];
    const canStart = !!scenario && selected.length <= limit && (mode === 'keeper' ? selected.length > 0 : selectedKeeper !== null);
    return { scenarios, scenario, characters: available, saves, mode, selected, limit, keeperName: selectedKeeper, castAssets, canStart };
  }
  function lobby() {
    closeAudioControls = null;
    audio.setScene(null, false);
    root.innerHTML = view.lobby(lobbyData());
    refreshBusy();
  }
  function updateLobby(...parts) {
    const data = lobbyData(), focus = document.activeElement?.id;
    for (const part of parts) {
      const area = root.querySelector(`[data-lobby-part="${part}"]`);
      const scroll = area.scrollTop;
      area.innerHTML = view[part](data);
      area.scrollTop = part === 'briefing' ? 0 : scroll;
    }
    document.getElementById('scenario-count').textContent = `${data.scenarios.length} 个模组`;
    refreshBusy();
    if (focus) document.getElementById(focus)?.focus({ preventScroll: true });
  }
  async function refreshCastAssets() {
    const request = ++castRequest;
    try {
      const [assets, roster] = await Promise.all([sdk.ext.request('/cast'), sdk.bridge.call('get_characters')]);
      if (request !== castRequest) return false;
      castAssets = assets;
      characters = roster;
      return true;
    } catch {
      if (request === castRequest) notice('表情立绘刷新失败，请稍后重试', true);
      return false;
    }
  }
  function assignParty(action, name) {
    const { selected: party, characters, limit } = lobbyData();
    if (!characters.some(character => character.name === name)) return;
    if (action === 'pick-keeper') {
      if (name === keeperName) return;
      keeperName = name;
      lineups.investigator = party.filter(member => member !== name);
    } else if (party.includes(name)) {
      lineups[mode] = party.filter(member => member !== name);
    } else if (party.length < limit) {
      lineups[mode] = [...party, name];
    } else {
      notice(`当前模组最多可邀请 ${limit} 位 AI 调查员`);
      return;
    }
    updateLobby('partyStatus', 'roster', 'launch');
  }
  function animateParty() {
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      root.querySelector('.party-list').animate([{ opacity: .5 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
    }
  }
  function randomizeParty() {
    const { scenario, limit, characters } = lobbyData();
    const pool = characters.map(character => character.name);
    if (!pool.length) return;
    const draw = () => pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    const playerSeats = mode === 'investigator' ? 1 : 0;
    if (playerSeats) keeperName = draw();
    const capacity = Math.min(limit, pool.length) + playerSeats;
    const recommendation = String(scenario?.briefing?.party ?? '').normalize('NFKC')
      .match(/^\s*([1-9]\d*)(?:\s*[-~–—至到]\s*([1-9]\d*))?\s*(?:人|名|位)?\s*(?:调查员|玩家|PL)?\s*(?=$|[(,。])/i);
    const recommendedMin = Number(recommendation?.[1]);
    const recommendedMax = Number(recommendation?.[2] ?? recommendation?.[1]);
    const hasRecommendation = Number.isSafeInteger(recommendedMax) && recommendedMin <= recommendedMax;
    const minimum = hasRecommendation ? Math.min(recommendedMin, capacity) : 1;
    const maximum = hasRecommendation ? Math.min(recommendedMax, capacity) : capacity;
    const count = minimum + Math.floor(Math.random() * (maximum - minimum + 1)) - playerSeats;
    lineups[mode] = Array.from({ length: count }, draw);
    updateLobby('partyStatus', 'roster', 'launch');
    animateParty();
  }
  async function editScenario() {
    if (mode !== 'keeper' || !lobbyData().scenario?.custom) return;
    const source = await post('/scenario-draft', { mode, scenarioId });
    modal('编辑自定义剧本', `<label for="scenario-draft">剧本 JSON</label>
      <textarea id="scenario-draft" rows="12" spellcheck="false">${esc(JSON.stringify(source, null, 2))}</textarea>
      <p id="scenario-edit-error" class="lobby-form-error" role="alert"></p>
      <div class="dialog-footer">${button('apply-scenario', '应用修改', 'primary', 'data-network')}</div>`, true);
  }
  async function applyScenario() {
    const field = document.getElementById('scenario-draft');
    const errorLine = document.getElementById('scenario-edit-error');
    try {
      const edited = JSON.parse(field.value);
      if (typeof edited?.meta?.title !== 'string' || !edited.meta.title.trim() ||
          !Array.isArray(edited.scenes) || !edited.scenes.length || typeof edited.scenes[0]?.publicDesc !== 'string') {
        throw new Error('请填写剧本标题和开场场景描述。');
      }
      selectCustomScenario(await post('/parse-scenario', { content: field.value, format: 'json', save: true, edit: true, mode, scenarioId }));
      if (dialog.open && !dialog.classList.contains('closing') && dialog.contains(field)) {
        dialog.addEventListener('close', () => root.querySelector('[data-action="edit-scenario"]')?.focus({ preventScroll: true }), { once: true });
        closeModal();
      }
    } catch (error) {
      errorLine.textContent = error instanceof SyntaxError ? 'JSON 格式有误，请检查后再应用。' : error.message;
      field.focus();
    }
  }
  function selectCustomScenario(scenario) {
    const index = catalog.scenarios.findIndex(item => item.id === scenario.id);
    if (index < 0) catalog.scenarios.push(scenario);
    else catalog.scenarios[index] = scenario;
    scenarioId = scenario.id;
    updateLobby('scenarioList', 'briefing', 'partyStatus', 'roster', 'launch');
    const area = root.querySelector('.index-scroll');
    if (area.scrollHeight > area.clientHeight) {
      area.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', container: 'nearest' });
    }
  }
  function creatorVisible() {
    return dialog.open && !dialog.classList.contains('closing') && Boolean(dialog.querySelector('.creator-step'));
  }
  function showCreator() {
    modal('创建剧本', view.creatorForm(creator));
    dialog.querySelector('.creator-step').focus({ preventScroll: true });
  }
  async function assessCreator() {
    if (!creator.idea.trim()) {
      dialog.querySelector('#creator-idea').focus();
      throw new Error('请先输入一个剧本想法');
    }
    const status = dialog.querySelector('.creator-progress');
    status.textContent = '正在分析你的想法…';
    status.hidden = false;
    try { creator.assessment = await post('/creator/assess', { idea: creator.idea }); }
    finally { status.hidden = true; }
    creator.answers = creator.assessment.questions.map(() => '');
    creator.preview = null;
    if (creator.assessment.readyToGenerate) return generateCreator(false);
    creator.step = 2;
    if (creatorVisible()) showCreator();
  }
  async function generateCreator(skip) {
    if (skip !== undefined) creator.skip = skip;
    const answers = creator.assessment.questions.map(({ question }, index) => ({ question, answer: creator.skip ? '' : creator.answers[index] }));
    Object.assign(creator, { step: 3, preview: null, progress: '正在撰写场景、线索和结局…' });
    if (creatorVisible()) showCreator();
    try {
      creator.preview = await post('/creator/generate', { idea: creator.idea, answers });
      creator.title = creator.preview.meta.title;
    } finally {
      creator.progress = '';
      if (creatorVisible()) showCreator();
    }
  }
  function updateCreatorAnswer(field) {
    const index = Number(field.dataset.answer);
    creator.answers[index] = field.value;
    field.closest('.creator-question').querySelectorAll('[data-choice]').forEach(chip => {
      const suggestion = creator.assessment.questions[index].suggestions[Number(chip.dataset.choice)];
      chip.setAttribute('aria-pressed', String(field.value === suggestion));
    });
  }
  async function startSelectedScenario() {
    const { selected, canStart, scenario, keeperName } = lobbyData();
    if (!canStart) return;
    state = await post('/start', { mode, characterNames: selected, scenarioId: scenario.id, keeperName, imagesEnabled: true });
    draft = '';
    render();
  }
  function jumpToParty() {
    const heading = document.getElementById('party-title');
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  async function saveCreator() {
    if (!creator.title.trim()) {
      dialog.querySelector('#creator-title').focus();
      throw new Error('请填写剧本标题');
    }
    const scenario = await post('/creator/save', { draftId: creator.preview.draftId, title: creator.title });
    creator = freshCreator();
    selectCustomScenario(scenario);
    if (creatorVisible()) closeModal();
    notice('剧本已保存并选中');
  }
  function showScenarioImport() {
    modal('导入外部剧本', `<div class="creator-form scenario-import-form">
      <label for="scenario-file">选择文件（.md / .txt / .json）</label>
      <input id="scenario-file" type="file" accept=".md,.txt,.json" data-network>
      <label for="scenario-source">剧本原文</label>
      <textarea id="scenario-source" rows="8" maxlength="100000" placeholder="粘贴剧本原文，或从上方选择文件" data-network></textarea>
      <p class="field-note creator-progress" role="status" hidden></p>
      <div class="dialog-footer">${button('apply-import', '整理并导入', 'primary', 'data-network')}</div>
    </div>`);
  }
  async function readScenarioFile(file, field) {
    if (file.size > 512 * 1024 || !/\.(md|txt|json)$/i.test(file.name)) throw new Error('请选择不超过 512KB 的 md / txt / json 剧本');
    const content = await file.text();
    if (!content.trim() || content.length > 100000) throw new Error('请选择包含剧本原文且不超过 10 万字的文件');
    field.value = content;
    field.dataset.format = /\.json$/i.test(file.name) ? 'json' : 'text';
  }
  async function importScenario() {
    const field = dialog.querySelector('#scenario-source');
    if (!field.value.trim()) {
      field.focus();
      throw new Error('请先粘贴剧本原文或选择文件');
    }
    const status = dialog.querySelector('.creator-progress');
    status.textContent = '正在整理剧本的场景与线索…';
    status.hidden = false;
    try {
      const scenario = await post('/parse-scenario', { content: field.value, format: field.dataset.format, save: true });
      selectCustomScenario(scenario);
      if (dialog.contains(field)) closeModal();
      notice('剧本已导入并选中');
    } finally { status.hidden = true; }
  }
  function showRules() {
    modal('规则说明', `<dl class="lobby-rules">
      <div><dt>守秘人（KP）</dt><dd>邻舍会先声明行动。在这条发言上直接描述结果，或要求检定后再描述后果。突发事件可在 KP 控制台发起临时检定。</dd></div>
      <div><dt>调查员（PL）</dt><dd>你以酒馆设置中的玩家身份调查。选择一位邻舍担任守秘人，也可邀请邻舍当 AI 队友。</dd></div>
      <div><dt>技能检定</dt><dd>通常掷 D20，点数加技能修正后需达到目标值 10／14／18。优势取两骰高值，劣势取低值。D100 按百分比判定，点数不高于目标值即通过。</dd></div>
      <div><dt>生命与理智</dt><dd>生命（HP）或理智（SAN）归零时角色退场。仍可引入替补或继续推进结局。</dd></div>
      <div><dt>音乐</dt><dd>Dark Walk、Gloom Horizon — Music by Kevin MacLeod (incompetech.com)，CC BY 3.0。</dd></div>
    </dl>`);
  }
  const ui = () => ({ tab: activeTab, packTab, packActor, characters, castAssets, catalog, controlChar, replacementName, secretRoll, rolls: recentRolls, pendingRolls, draft, npcSpeaker, turnIllustration, thinking: isThinking() });
  function logs(list) { return view.logs(state, list); }

  function animateActionChange(element) {
    if (!element || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    element.getAnimations().forEach(animation => animation.cancel());
    element.animate([{ opacity: .45 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
  }

  function setDraft(value) {
    draft = value;
    const lines = new Set(draft.split('\n').map(line => line.trim()));
    for (const chip of root.querySelectorAll('.action-suggestions > button')) {
      chip.setAttribute('aria-disabled', String(lines.has(chip.textContent)));
    }
    if (state?.mode !== 'investigator') return;
    const label = root.querySelector('#send-message .turn-button-label > span');
    const text = view.playerTurnLabel(draft);
    if (label && label.textContent !== text) {
      label.textContent = text;
      animateActionChange(label);
    }
  }

  function sampleActionSuggestions(entering) {
    const { mode, round, scene, suggestions } = state;
    const generated = [...new Set(suggestions.map(action => action.replace(/\s+/g, ' ').trim()).filter(Boolean))];
    const key = JSON.stringify([mode, round, scene.id, generated]);
    if (!entering && actionSuggestionSample?.key === key) return actionSuggestionSample.actions;

    const presets = presetActions[mode].filter(action => !generated.includes(action));
    const actions = [];
    while (actions.length < 2) {
      const pool = generated.length ? generated : presets;
      actions.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    actionSuggestionSample = { key, actions };
    return actions;
  }

  function updateAudio(entering) {
    const { scene, publicLog, investigators, ended } = state;
    const averageSan = investigators.reduce((sum, c) => sum + c.san / c.maxSan, 0) / investigators.length;
    // An encounter stays active through the current scene. The rules engine has no separate end-encounter action.
    const sceneStart = publicLog.findLastIndex(log => log.kind === 'scene');
    const encounter = publicLog.slice(sceneStart + 1).some(log => log.sceneId === scene.id && log.kind === 'encounter');
    audio.setScene(scene, !ended && (averageSan < 0.45 || encounter));

    if (entering) knownPrivateClues.clear();
    const cues = new Set();
    for (const clue of state.clues) {
      if (!clue.isSecret) continue;
      if (!entering && !knownPrivateClues.has(clue.id)) cues.add('clue_get');
      knownPrivateClues.add(clue.id);
    }
    if (entering) return;
    for (const log of publicLog) {
      if (knownLogs.has(log.id)) continue;
      if (log.kind === 'dialogue') audio.bubble(view.isKeeperLine(state, log));
      if (log.kind === 'clue') cues.add('clue_get');
      if (log.kind === 'scene') cues.add('scene_switch');
      if (log.kind === 'item' && !log.dialogue.includes('未能使用道具：')) cues.add('item_get');
      const sanLoss = log.sanDelta !== undefined ? log.sanDelta < 0 :
        (log.kind === 'stat' && / HP [+-]\d+ \/ SAN -\d+：/.test(log.dialogue)) ||
        (log.kind === 'item' && /」，(?:HP [+-]\d+ \/ )?SAN -\d+/.test(log.dialogue));
      if (sanLoss) cues.add('fumble_san');
    }
    for (const cue of cues) audio.play(cue);
  }

  function render() {
    if (!state) { lobby(); return; }
    const entering = uiSessionId !== state.sessionId;
    const previousTab = document.querySelector('[role=tab][aria-selected=true]')?.dataset.tab;
    const previousPackTab = root.querySelector('.pack-tabs [aria-selected=true]')?.dataset.tab;
    const truthOpen = !entering && root.querySelector('#keeper-truth')?.open;
    if (entering) { lastBackground = ''; activeTab = 'narrative'; packTab = 'dossier'; packActor = ''; uiSessionId = state.sessionId; controlChar = ''; knownLogs.clear(); seenRolls.clear(); recentRolls.length = 0; secretRoll = null; turnIllustration = false; }
    if (state.mode !== 'keeper' && activeTab === 'keeper') activeTab = 'narrative';
    const focus = document.activeElement?.id, pos = document.activeElement?.selectionStart;
    const oldTranscript = document.getElementById('transcript');
    const follow = !oldTranscript || oldTranscript.scrollHeight - oldTranscript.scrollTop - oldTranscript.clientHeight < 70;
    if (oldTranscript?.clientHeight) scrollPositions.narrative = oldTranscript.scrollTop;
    for (const panel of document.querySelectorAll('.story-panel:not([hidden])')) if (panel.id !== 'panel-narrative') scrollPositions[panel.id] = panel.scrollTop;
    if (!state.investigators.some(actor => actor.name === controlChar)) {
      controlChar = state.investigators.find(actor => !actor.outOfAction)?.name || state.investigators[0]?.name || '';
    }
    const background = state.imageJobs.filter(j => j.status === 'done' && j.kind === 'scene' && j.sceneId === state.scene.id).at(-1)?.url || '';
    const backgroundChanged = lastBackground !== background;
    const previousSuggestions = [...root.querySelectorAll('.action-suggestions > button')].map(chip => chip.textContent).join('\n');
    const suggestions = sampleActionSuggestions(entering);
    const markup = view.table(state, { ...ui(), suggestions, entering, truthOpen, tabChanged: previousTab !== activeTab, packTabChanged: previousPackTab !== packTab,
      previousBackground: backgroundChanged ? lastBackground : '', backgroundChanged });
    const stage = !entering && root.querySelector('.visual-stage');
    if (stage) {
      const next = document.createElement('template');
      next.innerHTML = markup;
      if (backgroundChanged) {
        stage.querySelectorAll('.stage-backdrop').forEach(el => el.remove());
        stage.prepend(...next.content.querySelectorAll('.stage-backdrop'));
      }
      for (const selector of ['.stage-navigation', '.hud', '.stage-caption', '.ended-stamp']) {
        const current = stage.querySelector(selector), updated = next.content.querySelector(selector);
        if (current?.outerHTML === updated?.outerHTML) continue;
        if (current && updated) current.replaceWith(updated);
        else if (updated) stage.append(updated);
        else current.remove();
      }
      root.querySelector('.narrative-column').replaceWith(next.content.querySelector('.narrative-column'));
    } else {
      root.innerHTML = markup;
      const stage = root.querySelector('.visual-stage');
      stage.insertAdjacentHTML('beforeend', button('next-frame', '', 'stage-advance', 'id="stage-advance" aria-label="播放下一幕" hidden'));
      closeAudioControls = view.mountAudioControls(stage, audio);
    }
    view.updateCast(root.querySelector('.stage-cast'), state, ui());
    lastBackground = background;
    setDraft(draft);
    if (entering || suggestions.join('\n') !== previousSuggestions) animateActionChange(root.querySelector('.action-suggestions'));
    wireChoices(); refreshBusy();
    const transcript = document.getElementById('transcript');
    transcript.scrollTop = follow ? transcript.scrollHeight : scrollPositions.narrative || 0;
    for (const panel of document.querySelectorAll('.story-panel:not([hidden])')) if (panel.id !== 'panel-narrative') panel.scrollTop = scrollPositions[panel.id] || 0;
    const fresh = [...document.querySelectorAll('[data-log-id]')].filter(el => !knownLogs.has(el.dataset.logId));
    fresh.slice(-3).forEach(el => el.classList.add('is-new'));
    updateAudio(entering);
    state.publicLog.forEach(log => knownLogs.add(log.id));
    if (focus) { const el = document.getElementById(focus); el?.focus({ preventScroll: true }); if (typeof pos === 'number' && el?.setSelectionRange) el.setSelectionRange(pos, pos); }
  }
  function acceptState(result) {
    if (result.sessionId !== state?.sessionId || (result.revision ?? 0) < (state.revision ?? 0)) return false;
    state = result;
    return true;
  }
  async function syncState(sessionId) {
    if (state?.sessionId !== sessionId) return;
    await advanceFlight;
    const current = await readState(sessionId);
    await advanceFlight;
    if (acceptState(current)) {
      render();
      if (dialog.open && dialog.dataset.imageCollection) {
        dialog.querySelector('.drawer-body').innerHTML = view.imageCollection(state);
        refreshBusy();
      }
      playReadyFrame();
    }
  }
  function playReadyFrame() {
    if (!state) return;
    // Tool results can arrive before the first reply and play in order with it.
    if (firstNewFrame !== undefined && state.publicLog.slice(firstNewFrame)
      .some(log => log.kind === 'dialogue' && log.speakerRole !== 'player')) firstNewFrame = undefined;
    if (!state.playbackRemaining) return;
    // Older hosts omit the hint, but queue the dice immediately after the check request.
    const checkReady = state.checkPlaybackReady ??
      (state.mode === 'investigator' && state.publicLog.at(-1)?.kind === 'check');
    if (firstNewFrame !== undefined || checkReady || state.reactionReady) advanceFrame();
  }
  function advanceFrame() {
    if (!state?.playbackRemaining || advanceFlight || diceAnimating || dialog.open || pictureTriggerId) return;
    const { sessionId, publicLog } = state;
    const after = publicLog.length;
    activeTab = 'narrative';
    let advanced = false;
    advanceFlight = post('/advance', { sessionId, after }).then(result => {
      if (!acceptState(result)) return;
      advanced = result.publicLog.length > after;
      if (!result.pendingTurn && !result.playbackRemaining) firstNewFrame = undefined;
      const roll = result.publicLog[after]?.roll;
      if (roll) showDice(roll);
      else render();
    }).catch(error => notice(error.message, true)).finally(() => {
      advanceFlight = null;
      refreshBusy();
      if (advanced) playReadyFrame();
    });
    refreshBusy();
  }
  async function turn() {
    const { pendingTurn, sessionId } = state;
    if (state.playbackRemaining && !pendingTurn) return;
    const retired = state.investigators.some(c => c.player && c.outOfAction);
    const needsRuling = state.awaitingRuling || state.awaitingItem || state.pendingCheck;
    const previous = needsRuling && submittedTurn?.message ? undefined : submittedTurn;
    const request = pendingTurn ? { turnId: pendingTurn.id, resume: true } : previous || {
      turnId: newOperationId(), message: retired || needsRuling ? '' : draft.trim(), speaker: npcSpeaker,
      ...(turnIllustration && !needsRuling && state.mode === 'keeper' && state.imagesEnabled ? { illustrate: true } : {}),
    };
    if (!pendingTurn) submittedTurn = request;
    const { message } = request;
    firstNewFrame = state.playbackRemaining ? undefined : state.publicLog.length;
    try {
      const result = await post('/turn', request);
      await advanceFlight;
      acceptState(result);
      submittedTurn = undefined;
      if (message && draft.trim() === message) draft = '';
    } catch (error) {
      await advanceFlight;
      const current = await readState(sessionId).catch(() => null);
      if (current && acceptState(current)) {
        submittedTurn = undefined;
        if (message && draft.trim() === message && (current.pendingTurn?.id === request.turnId || current.lastTurnId === request.turnId)) draft = '';
      }
      throw error;
    } finally {
      if (state.playbackRemaining) playReadyFrame();
      else firstNewFrame = undefined;
    }
  }
  async function control(tool, args) {
    state = await retryablePost('/control', { tool, args });
    if (tool === 'roll_dice') showDice(state.result, args.secret);
    render();
  }
  function syncGrantPreset(form) {
    const preset = view.itemPresets[form.elements.preset.value];
    for (const field of form.querySelectorAll('[data-grant-effect]')) {
      const mode = field.dataset.grantEffect;
      field.hidden = mode === 'tool' ? preset.type !== 'tool' : !preset[mode];
      const control = field.querySelector('[data-network]');
      control.disabled = field.hidden;
      control.dataset.blocked = String(field.hidden);
    }
  }
  function givePackItem(random) {
    const form = dialog.querySelector('#give-item-form');
    const { preset, name, desc, hp, san, skill, bonus, uses } = form.elements;
    const request = { targetChar: form.dataset.target };
    if (random) request.random = true;
    else {
      if (!form.reportValidity()) return;
      const definition = view.itemPresets[preset.value];
      const effect = {};
      if (definition.hp) effect.hpDelta = hp.valueAsNumber;
      if (definition.san) effect.sanDelta = san.valueAsNumber;
      if (definition.type === 'tool') effect.skillBonus = { skill: skill.value, bonus: bonus.valueAsNumber };
      Object.assign(request, { name: name.value.trim(), desc: desc.value.trim(), type: definition.type, effect, uses: uses.valueAsNumber });
    }
    // Read the live fields before the work lock disables the controls.
    work(async () => {
      state = await retryablePost('/give-item', request);
      notice(`已发放「${state.result.name}」`);
      if (dialog.contains(form)) closeModal();
      if (!random) render();
    }, random ? 'random-item' : 'give-item');
  }
  async function usePackItem(el) {
    state = await retryablePost('/use-item', { itemId: el.dataset.id, targetChar: el.dataset.target });
    if (state.awaitingItem) {
      activeTab = 'narrative';
      render();
      await turn();
    } else notice('已使用道具');
  }
  function readControl() { replacementName = document.getElementById('replacement')?.value || replacementName; }
  async function dice(manual) {
    const secret = manual && dialog.querySelector('#secret-roll').checked;
    const checkId = state.pendingCheck?.id;
    let request = { checkId };
    if (manual) {
      const form = dialog.querySelector('.check-form');
      const value = id => form.querySelector('#' + id).value;
      const dice = value('check-dice');
      request = { skill: value('skill'), difficulty: value('difficulty'), dice, mode: dice === 'd20' ? value('check-mode') : 'normal', secret,
        ...(form.dataset.log ? { actionLogId: form.dataset.log } : { targetChar: form.dataset.target || value('check-target') }) };
    }
    const result = await retryablePost('/roll', request);
    const roll = result.roll; delete result.roll; state = result;
    if (manual) closeModal();
    showDice(roll, secret);
  }
  function showDice(roll, secret = false) {
    if (roll.logId && seenRolls.has(roll.logId)) { render(); return; }
    if (roll.logId) seenRolls.add(roll.logId);
    pendingRolls.add(view.rollKey(roll));
    diceQueue.push({ roll, secret });
    if (!diceAnimating) drainDice().catch(error => notice(error.message, true));
  }
  async function drainDice() {
    const returnFocus = dialog.classList.contains('closing') ? dialog.dataset.returnFocus : '';
    diceAnimating = true;
    root.inert = true;
    try {
      while (diceQueue.length) {
        const { roll, secret } = diceQueue.shift();
        const key = view.rollKey(roll);
        activeTab = secret && !roll.actionLogId ? 'keeper' : 'narrative';
        render();
        let resultSoundPlayed = false;
        const playResult = () => {
          if (resultSoundPlayed) return;
          resultSoundPlayed = true;
          if (roll.rank === 'fumble') audio.play('fumble_san');
          if (roll.success && ['critical', 'extreme'].includes(roll.rank)) audio.play('crit_success');
        };
        try { await view.animateDice(roll, secret, speed => audio.impact(speed), playResult); } catch (error) { console.warn('Dice animation failed', error); }
        playResult();
        pendingRolls.delete(key);
        if (secret) secretRoll = roll;
        else if (!state.publicLog.some(log => log.id === roll.logId)) recentRolls.push(roll);
        render();
        const card = [...root.querySelectorAll('[data-roll-key]')].findLast(el => el.dataset.rollKey === key && el.getClientRects().length);
        card?.classList.add('just-landed');
        card?.scrollIntoView({ block: 'nearest' });
      }
    } finally {
      root.inert = false;
      diceAnimating = false;
      if (!dialog.open && returnFocus && document.activeElement === document.body) {
        document.getElementById(returnFocus)?.focus({ preventScroll: true });
      }
      refreshBusy();
      playReadyFrame();
    }
  }
  async function reloadLobby() {
    await advanceFlight;
    [saves] = await Promise.all([sdk.save.list(), refreshCastAssets()]);
    state = null; uiSessionId = null; submittedTurn = undefined; firstNewFrame = undefined; draft = '';
    lobby();
  }
  document.addEventListener('pointerdown', event => closeAudioControls?.(event));
  document.addEventListener('click', event => {
    if (event.isTrusted && event.target.closest('button:not(:disabled)')) audio.unlock();
  }, true);
  document.addEventListener('input', e => {
    if (e.target.id === 'creator-idea') creator.idea = e.target.value;
    if (e.target.id === 'creator-title') creator.title = e.target.value;
    if (e.target.matches('textarea[data-answer]')) updateCreatorAnswer(e.target);
    if (e.target.id === 'message') setDraft(e.target.value);
    if (e.target.id === 'npc-speaker') npcSpeaker = e.target.value;
    if (e.target.id === 'scenario-draft') document.getElementById('scenario-edit-error').textContent = '';
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'turn-illustration') turnIllustration = e.target.checked;
    if (e.target.id === 'pack-actor') { packActor = e.target.value; render(); return; }
    if (e.target.id === 'clue') {
      const preview = dialog.querySelector('#keeper-clue-preview');
      const clue = state.scenario.clues.find(item => item.id === e.target.value);
      preview.textContent = clue?.content || '';
      preview.hidden = !clue;
      return;
    }
    if (e.target.id === 'grant-preset') {
      const form = e.target.form;
      form.elements.uses.value = ['key', 'gag'].includes(e.target.value) ? -1 : 1;
      syncGrantPreset(form);
      return;
    }
    readControl();
    if (e.target.id === 'scenario-file') {
      const input = e.target, file = input.files[0]; if (!file) return;
      const field = dialog.querySelector('#scenario-source');
      work(async () => {
        try { await readScenarioFile(file, field); }
        catch (error) { input.value = ''; throw error; }
      });
    }
  });
  document.addEventListener('submit', e => {
    if (e.target.id !== 'give-item-form') return;
    e.preventDefault();
    document.getElementById('give-item-submit').click();
  });
  document.addEventListener('keydown', e => {
    const group = e.target.closest('[data-picker], [role=tablist]');
    if (group && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)) { e.preventDefault(); const buttons = [...group.querySelectorAll('button:not(:disabled)')]; const i = buttons.indexOf(e.target); const n = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (['ArrowRight','ArrowDown'].includes(e.key) ? 1 : -1) + buttons.length) % buttons.length; buttons[n]?.click(); buttons[n]?.focus(); return; }
    if (e.target.id === 'message' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      if (!draft.trim()) return;
      if (e.isTrusted) audio.unlock();
      document.getElementById('send-message')?.click();
    }
  });
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]'); if (!el || el.disabled) return; const action = el.dataset.action; readControl();
    if (action === 'choice') {
      const group = el.closest('[data-picker]');
      const previous = group.value;
      group.dataset.value = el.dataset.value;
      group.value = el.dataset.value;
      group.querySelectorAll('button').forEach(item => {
        const chosen = item === el;
        item.classList.toggle('selected', chosen);
        item.setAttribute('aria-pressed', String(chosen));
      });
      readControl();
      if (group.id === 'target' && previous !== group.value) {
        controlChar = group.value;
        render();
        root.querySelector('#target .selected')?.focus({ preventScroll: true });
        return;
      }
      if (group.id === 'skill' && previous !== group.value && [previous, group.value].includes('理智')) {
        const dice = group.value === '理智' ? 'd100' : 'd20';
        dialog.querySelector(`#check-dice [data-value="${dice}"]`).click();
      }
      if (group.id === 'check-dice') {
        for (const row of dialog.querySelectorAll('[data-d20]')) row.hidden = group.value !== 'd20';
        dialog.querySelector('[data-action="manual-roll"]').textContent = '掷 ' + group.value.toUpperCase();
      }
      return;
    }
    if (action === 'hud-actor') {
      if (state?.mode !== 'keeper' || dialog.classList.contains('closing')) return;
      const actor = state.investigators.find(person => person.name === el.dataset.target);
      if (!actor) return;
      if (!dialog.open) el.focus({ preventScroll: true });
      modal(actor.name, view.keeperActorPanel(state, actor));
      (dialog.querySelector('.keeper-command:not(:disabled)') || dialog.querySelector('.close')).focus({ preventScroll: true });
      return;
    }
    if (['temporary-check', 'check-action', 'keeper-tool'].includes(action)) {
      if (dialog.classList.contains('closing') || state?.mode !== 'keeper') return;
      const pinnedActor = el.dataset.target && state.investigators.find(person => person.name === el.dataset.target);
      if (el.dataset.target && !pinnedActor) return;
      if (action === 'keeper-tool') {
        const task = view.keeperDialog(state, { ...ui(), controlChar: pinnedActor?.name ?? controlChar }, el.dataset.tool);
        keeperToolModal(task.title, task.content, pinnedActor);
        const form = dialog.querySelector('#give-item-form');
        if (form) syncGrantPreset(form);
        dialog.querySelector('.drawer-body :is(input, select, textarea):not(:disabled)')?.focus({ preventScroll: true });
      } else {
        const declaration = action === 'check-action' ? state.declaration : null;
        if (action === 'check-action' && (!declaration || declaration.logId !== el.dataset.log || declaration.roll)) return;
        const title = declaration ? '要求检定' : pinnedActor ? `临时检定 · ${pinnedActor.name}` : '临时检定';
        keeperToolModal(title, view.checkForm(state, ui(), declaration, pinnedActor), pinnedActor);
        if (pinnedActor) dialog.querySelector('#skill .selected')?.focus({ preventScroll: true });
      }
      return;
    }
    if (action === 'describe-action') {
      const declaration = state.declaration;
      if (!declaration || declaration.logId !== el.dataset.log) return;
      const actor = state.investigators.find(person => person.name === declaration.actor);
      modal(declaration.roll ? '描述检定结果' : '直接描述结果',
        `<p class="field-note">${esc(actor.name)} · ${esc(declaration.reason)}</p>
        ${declaration.roll ? view.rollCard(declaration.roll, !declaration.roll.logId) : ''}
        <label for="action-result">行动结果</label><textarea id="action-result" rows="3" maxlength="3000" required></textarea>
        <div class="dialog-footer">${view.turnButton('submit-ruling', '发布结果', 'primary', `data-log="${esc(declaration.logId)}"`)}</div>`);
      dialog.querySelector('textarea').focus();
      return;
    }
    if (action === 'tab') { if (activeTab !== el.dataset.tab) { activeTab = el.dataset.tab; render(); } document.getElementById('tab-' + activeTab)?.focus({preventScroll:true}); return; }
    if (action === 'pack-tab') { if (packTab !== el.dataset.tab) { packTab = el.dataset.tab; render(); } document.getElementById('pack-tab-' + packTab)?.focus({ preventScroll: true }); return; }
    if (action === 'give-item' || action === 'random-item') { givePackItem(action === 'random-item'); return; }
    if (action === 'next-frame') { advanceFrame(); return; }
    if (action === 'suggest-action') {
      const input = document.getElementById('message');
      if (!input || pendingAction || el.getAttribute('aria-disabled') === 'true') return;
      const value = [draft.trimEnd(), el.textContent].filter(Boolean).join('\n');
      if (value.length > input.maxLength) return;
      input.value = value;
      setDraft(input.value);
      input.focus();
      input.setSelectionRange(draft.length, draft.length);
      return;
    }
    if (action === 'ho-focus-kp') {
      if (state.mode !== 'keeper') return;
      controlChar = el.dataset.id;
      activeTab = 'keeper';
      render();
      root.querySelector('#target .selected')?.focus({ preventScroll: true });
      return;
    }
    if (action === 'evidence') { const clue = state.clues.find(c => c.id === el.dataset.id); if (clue) modal(clue.title, `<article class="evidence-detail"><span class="evidence-label">${clue.isSecret ? '私密证物' : '公开证物'}</span><p>${view.highlight(clue)}</p></article>`); return; }
    if (action === 'preview-picture') { openPicture(el); return; }
    if (action === 'close') { closeModal(); return; }
    if (action === 'choose-scenario') {
      if (scenarioId !== el.dataset.id) { scenarioId = el.dataset.id; updateLobby('scenarioList', 'briefing', 'partyStatus', 'roster', 'launch'); }
      return;
    }
    if (action === 'lobby-mode') {
      if (mode === el.dataset.mode) return;
      mode = el.dataset.mode;
      updateLobby('partyMode', 'briefing', 'partyStatus', 'roster', 'launch');
      animateParty();
      return;
    }
    if (action === 'random-party') { randomizeParty(); return; }
    if (action === 'pick' || action === 'pick-keeper') { assignParty(action, el.dataset.name); return; }
    if (action === 'rules') { showRules(); return; }
    if (action === 'jump-party') { jumpToParty(); return; }
    if (action === 'import-scenario') { showScenarioImport(); return; }
    if (action === 'apply-import') {
      if (!dialog.classList.contains('closing')) work(importScenario);
      return;
    }
    if (action === 'open-creator') { showCreator(); return; }
    if (el.closest('.creator-form') && !creatorVisible()) return;
    if (action === 'creator-assess') { work(assessCreator); return; }
    if (action === 'creator-back') { creator.step = Number(el.dataset.step); showCreator(); return; }
    if (action === 'creator-generate' || action === 'creator-skip' || action === 'creator-retry') {
      work(() => generateCreator(action === 'creator-retry' ? undefined : action === 'creator-skip'));
      return;
    }
    if (action === 'creator-chip') {
      const field = dialog.querySelector(`#creator-answer-${el.dataset.question}`);
      const suggestion = creator.assessment.questions[Number(el.dataset.question)].suggestions[Number(el.dataset.choice)];
      field.value = el.getAttribute('aria-pressed') === 'true' ? '' : suggestion;
      updateCreatorAnswer(field);
      return;
    }
    if (action === 'creator-save') { work(saveCreator); return; }
    if (action === 'edit-scenario') { work(editScenario); return; }
    if (action === 'apply-scenario') { work(applyScenario); return; }
    if (action === 'history') { modal('日志回溯', `<div class="history-log">${logs(state.publicLog)}</div>`, true); return; }
    if (action === 'images') { modal('场景印相', view.imageCollection(state)); dialog.dataset.imageCollection = 'true'; return; }
    if (action === 'finish-dialog') {
      const abandon = state.rulesEnabled && !state.outcome && !state.ended;
      modal(state.outcome?.label || (abandon ? '提前收团' : '让这场调查落幕'), `<label for="ending">这一局的结尾</label><textarea id="ending" rows="4" maxlength="1000" placeholder="留下最后一句话…">${esc(state.ended ? state.publicLog.at(-1)?.dialogue : state.proposedEnding)}</textarea><label class="checkbox-label"><input id="write-memory" type="checkbox" ${state.memoryWritten ? 'checked disabled' : ''}>作为“桌游／剧本杀回忆”写入角色长期记忆</label><div class="dialog-footer">${button('finish', state.ended ? '保存回忆' : abandon ? '确认提前收团' : '封存这份卷宗', 'primary', `data-network data-abandon="${abandon}"`)}</div>`);
      return;
    }
    if (action === 'delete-save') { modal('删除存档', '<p class="empty-copy">这份存档及其旧版图片将一并删除。相册中的成片仍可查看。</p><div class="dialog-footer">' + button('confirm-delete', '删除存档', 'danger', `data-id="${esc(el.dataset.id)}" data-network`) + '</div>'); return; }
    if (action === 'send' && !draft.trim()) return;
    work(async () => {
      switch (action) {
        case 'start': await startSelectedScenario(); break;
        case 'load': {
          const [savedState] = await Promise.all([readState(el.dataset.id), refreshCastAssets()]);
          state = savedState;
          render();
          playReadyFrame();
          break;
        }
        case 'manage-standings': await sdk.ui.openStandings(el.dataset.player === 'true' ? { player: true } : { characterName: el.dataset.subject }); break;
        case 'exit-game': await sdk.ui.exit(); break;
        case 'confirm-delete': await sdk.save.delete(el.dataset.id); closeModal(); await reloadLobby(); break;
        case 'lobby': await reloadLobby(); break;
        case 'next': await turn(); break;
        case 'send': await turn(); break;
        case 'use-item': await usePackItem(el); break;
        case 'roll': await dice(false); break;
        case 'manual-roll': await dice(true); break;
        case 'pool-roll': {
          await control('roll_dice', { sides: Number(el.dataset.sides), count: dialog.querySelector('#pool-count').valueAsNumber,
            reason: dialog.querySelector('#pool-reason').value.trim() || '随机掷骰', secret: dialog.querySelector('#secret-roll').checked });
          closeModal(); break;
        }
        case 'submit-ruling': {
          const input = dialog.querySelector('#action-result');
          if (!input.value.trim()) { input.focus(); notice('请填写行动结果'); break; }
          state = await retryablePost('/describe-action', { logId: el.dataset.log, description: input.value.trim() });
          closeModal();
          activeTab = 'narrative';
          render();
          if (state.pendingTurn) await turn();
          break;
        }
        case 'switch-scene': {
          await control('switch_scene', { sceneId: dialog.querySelector('#scene').value });
          closeModal();
          break;
        }
        case 'scenario-action': await control('resolve_scenario_action', { actionId: el.dataset.id }); break;
        case 'stat': {
          const input = dialog.querySelector('#stat-reason');
          const reason = input.value.trim();
          if (!reason) { notice('请填写调整原因', true); input.focus(); break; }
          const i = Number(el.dataset.stat), targetChar = el.dataset.target;
          await control('update_investigator_stat', { targetChar, hpDelta: i < 2 ? (i === 0 ? -1 : 1) : 0,
            sanDelta: i >= 2 ? (i === 2 ? -1 : 1) : 0, reason });
          const actor = state.investigators.find(person => person.name === targetChar);
          const status = dialog.querySelector('#stat-current');
          if (status && actor) status.innerHTML = view.actorStats(actor);
          break;
        }
        case 'reveal-all': case 'reveal-private': {
          const input = dialog.querySelector('#clue');
          if (!input.value) { notice('请选择线索', true); input.focus(); break; }
          await control('reveal_clue', { clueId: input.value, targetCharOrAll: action === 'reveal-all' ? 'all' : el.dataset.target });
          closeModal();
          notice(action === 'reveal-all' ? '线索已公开' : '线索已发送');
          break;
        }
        case 'handout': {
          const input = dialog.querySelector('#handout');
          const content = input.value.trim();
          if (!content) { notice('请填写密信内容', true); input.focus(); break; }
          await control('send_secret_handout', { targetChar: el.dataset.target, content });
          closeModal();
          notice('密信已送达');
          break;
        }
        case 'encounter': {
          const input = dialog.querySelector('#encounter');
          const description = input.value.trim();
          if (!description) { notice('请填写遭遇描述', true); input.focus(); break; }
          await control('trigger_encounter', { description });
          closeModal();
          break;
        }
        case 'replacement': state = await post('/replacement', { characterName: replacementName }); render(); break;
        case 'retry-image': {
          acceptState(await post('/retry-image', { jobId: el.dataset.id }));
          if (dialog.dataset.imageCollection) closeModal();
          render();
          break;
        }
        case 'finish': state = await post('/finish', { ending: document.getElementById('ending').value, writeMemory: document.getElementById('write-memory').checked, abandon: el.dataset.abandon === 'true' }); closeModal(); render(); break;
      }
    }, action);
  });
  async function boot() {
    try {
      if (!sdk) throw new Error('请从邻舍游戏中心打开本游戏');
      await sdk.ready;
      [catalog, characters, saves, castAssets] = await Promise.all([sdk.ext.request('/catalog'), sdk.bridge.call('get_characters'), sdk.save.list(), sdk.ext.request('/cast'), audio.restore()]);
      const recommended = view.orderCharacters(lobbyData().characters, castAssets);
      lineups.keeper = recommended.slice(0, 3).map(c => c.name);
      keeperName = recommended[0]?.name ?? null;
      lineups.investigator = recommended.slice(1, 3).map(c => c.name);
      scenarioId = catalog.scenarios[0]?.id || '';
      lobby();
      sdk.on?.('standing-assets', async () => {
        if (!await refreshCastAssets()) return;
        if (state) view.updateCast(root.querySelector('.stage-cast'), state, ui());
        else {
          updateLobby('partyStatus', 'roster');
          animateParty();
        }
      });
      sdk.on('trpg:picture-closed', restorePictureFocus);
      sdk.on('trpg:picture-updated', view.refreshPicture);
      const sync = event => syncState(event.sessionId).catch(error => notice(error.message, true));
      sdk.on?.('turn-progress', sync);
      sdk.on?.('media', sync);
    } catch (error) {
      root.innerHTML = `<div class="loading-screen"><p>${esc(error.message)}</p>${button('boot', '重新连接')}${sdk ? button('exit-game', '返回游戏馆') : ''}</div>`;
      root.querySelector('[data-action="boot"]').addEventListener('click', () => window.location.reload());
    }
  }
  boot();
})();
