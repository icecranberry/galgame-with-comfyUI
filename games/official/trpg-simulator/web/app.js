/* Independent, dependency-free game frontend. All durable state lives in SDK saves. */
(() => {
  const sdk = window.LinSheGameSDK, root = document.getElementById('app'), dialog = document.getElementById('drawer');
  let catalog = { scenarios: [], skills: [] }, characters = [], saves = [], state = null, busy = false, playing = false, generation = 0, ackFlight, stopping;
  let mode = 'keeper', scenarioId = '', keeperId = null, importedScenario, imagesEnabled = false, draft = '', npcSpeaker = '';
  let castAssets, playerExpression = 'normal', turnPreview;
  const lineups = { keeper: [], investigator: [] };
  const partyLimits = { keeper: 4, investigator: 5 };
  const customScenarioId = 'custom';
  const view = window.TrpgPresentation;
  let activeTab = 'narrative', diceAnimating = false, diceVersion = 0, secretRoll = null;
  const fields = {}, recentRolls = [], knownLogs = new Set(), scrollPositions = {};
  let uiSessionId, lastBackground = '';
  let controlChar = '', controlSkill = '侦查', controlDifficulty = 'regular', clueId = '', sceneId = '', replacementId = '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const image = value => /^\/(?:images|avatars|game-media)\/[\w./%?=& -]+$/.test(value || '') ? value : '';
  const button = (action, label, kind = '', extra = '') => `<button type="button" data-action="${action}" class="${kind}" ${extra}>${label}</button>`;
  const post = (url, body) => sdk.ext.request(url, { method: 'POST', body: JSON.stringify({ ...(state ? { sessionId: state.sessionId } : {}), ...body }) });
  const name = id => state?.investigators.find(c => c.id === id)?.name || '调查员';
  function notice(message, error = false) { const el = document.getElementById('notice'); el.textContent = message; el.className = error ? 'visible error' : 'visible'; clearTimeout(notice.timer); notice.timer = setTimeout(() => { el.className = ''; }, 6000); }
  async function work(fn) { if (busy) return; busy = true; refreshBusy(); try { await fn(); } catch (error) { notice(error.message, true); } finally { busy = false; refreshBusy(); } }
  function refreshBusy() { document.querySelectorAll('[data-network]').forEach(el => { el.dataset.blocked ??= String(el.disabled); el.disabled = busy || el.dataset.blocked === 'true'; }); document.body.classList.toggle('is-busy', busy); const status = document.getElementById('working'); if (status) status.textContent = busy ? '正在整理线索…' : ''; }
  function modal(title, content, wide = false) {
    dialog.classList.remove('closing'); dialog.classList.toggle('wide', wide); dialog.classList.toggle('lobby-drawer', !state);
    dialog.innerHTML = `<header><div><span class="eyebrow">CASE FILE</span><h2 id="drawer-title">${esc(title)}</h2></div>${button('close', '×', 'close', 'aria-label="关闭"')}</header><div class="drawer-body">${content}</div>`;
    wireChoices();
    if (!dialog.open) dialog.showModal();
  }
  function closeModal() { if (!dialog.open || dialog.classList.contains('closing')) return; dialog.classList.add('closing'); setTimeout(() => { dialog.close(); dialog.classList.remove('closing'); if (state?.pendingBatch && !playing && !busy) play().catch(error => notice(error.message, true)); }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 300); }
  dialog.addEventListener('cancel', e => { e.preventDefault(); closeModal(); });
  dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeModal(); } });
  function wireChoices() { document.querySelectorAll('[data-picker]').forEach(group => { group.value = group.dataset.value; }); }
  function lobbyData() {
    const scenarios = [...catalog.scenarios];
    if (importedScenario) scenarios.push({
      id: customScenarioId,
      meta: importedScenario.meta,
      scenes: importedScenario.scenes.length,
      opening: importedScenario.scenes[0].publicDesc,
      briefing: { tags: ['外部导入'] },
    });
    const scenario = scenarios.find(item => item.id === scenarioId);
    const selected = lineups[mode], limit = partyLimits[mode];
    const canStart = !!scenario && (mode === 'keeper' ? selected.length > 0 : keeperId !== null);
    return { scenarios, scenario, characters, saves, mode, selected, limit, keeperId, castAssets, imagesEnabled, canStart };
  }
  function lobby() {
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
  function assignParty(action, id) {
    const party = lineups[mode];
    if (action === 'pick-keeper') {
      if (id === keeperId) return;
      keeperId = id;
      lineups.investigator = party.filter(member => member !== id);
    } else if (party.includes(id)) {
      lineups[mode] = party.filter(member => member !== id);
    } else if (party.length < partyLimits[mode]) {
      party.push(id);
    } else {
      notice(`最多可邀请 ${partyLimits[mode]} 位调查员`);
      return;
    }
    updateLobby('partyStatus', 'roster', 'launch');
  }
  function editScenario() {
    modal('编辑导入剧本', `<label for="scenario-draft">剧本 JSON</label>
      <textarea id="scenario-draft" rows="12" spellcheck="false">${esc(JSON.stringify(importedScenario, null, 2))}</textarea>
      <p id="scenario-edit-error" class="lobby-form-error" role="alert"></p>
      <div class="dialog-footer">${button('apply-scenario', '应用修改', 'primary')}</div>`, true);
  }
  function applyScenario() {
    const field = document.getElementById('scenario-draft');
    const errorLine = document.getElementById('scenario-edit-error');
    try {
      const edited = JSON.parse(field.value);
      if (typeof edited?.meta?.title !== 'string' || !edited.meta.title.trim() ||
          !Array.isArray(edited.scenes) || !edited.scenes.length || typeof edited.scenes[0]?.publicDesc !== 'string') {
        throw new Error('请填写剧本标题和开场场景描述。');
      }
      importedScenario = edited;
      dialog.addEventListener('close', () => root.querySelector('[data-action="edit-scenario"]')?.focus({ preventScroll: true }), { once: true });
      closeModal();
      updateLobby('scenarioList', 'briefing');
    } catch (error) {
      errorLine.textContent = error instanceof SyntaxError ? 'JSON 格式有误，请检查后再应用。' : error.message;
      field.focus();
    }
  }
  function showRules() {
    modal('规则说明', `<dl class="lobby-rules">
      <div><dt>守秘人（KP）</dt><dd>描述现场、扮演 NPC、分发线索并裁定检定。受邀邻舍作为 AI 调查员行动。</dd></div>
      <div><dt>调查员（PL）</dt><dd>你以酒馆设置中的玩家身份调查。选择一位邻舍担任守秘人，也可邀请邻舍当 AI 队友。</dd></div>
      <div><dt>D100 检定</dt><dd>骰值不高于目标值即通过。普通、困难、极难分别以技能值、其一半和五分之一为目标。掷出 1 为大成功，96–100 为大失败。</dd></div>
      <div><dt>生命与理智</dt><dd>生命（HP）或理智（SAN）归零时角色退场。仍可引入替补或继续推进结局。</dd></div>
    </dl>`);
  }
  const ui = () => ({ tab: activeTab, characters, castAssets, playerExpression, catalog, controlChar, controlSkill, controlDifficulty, clueId, sceneId, replacementId, fields, secretRoll, rolls: recentRolls, draft, npcSpeaker, playing });
  function logs(list) { return view.logs(state, list); }
  function render() {
    if (!state) { lobby(); return; }
    const entering = uiSessionId !== state.sessionId;
    const previousTab = document.querySelector('[role=tab][aria-selected=true]')?.dataset.tab;
    if (entering) { lastBackground = ''; playerExpression = 'normal'; activeTab = 'narrative'; uiSessionId = state.sessionId; controlChar = ''; sceneId = state.scene.id; knownLogs.clear(); recentRolls.length = 0; secretRoll = null; }
    if (state.mode !== 'keeper' && activeTab === 'keeper') activeTab = 'narrative';
    const focus = document.activeElement?.id, pos = document.activeElement?.selectionStart;
    const oldTranscript = document.getElementById('transcript');
    const follow = !oldTranscript || oldTranscript.scrollHeight - oldTranscript.scrollTop - oldTranscript.clientHeight < 70;
    if (oldTranscript?.clientHeight) scrollPositions.narrative = oldTranscript.scrollTop;
    for (const panel of document.querySelectorAll('.story-panel:not([hidden])')) if (panel.id !== 'panel-narrative') scrollPositions[panel.id] = panel.scrollTop;
    controlChar ||= state.investigators.find(c => !c.outOfAction)?.id || '';
    sceneId ||= state.scene.id;
    const background = state.imageJobs.filter(j => j.status === 'done' && j.kind === 'scene' && j.sceneId === state.scene.id).at(-1)?.url || '';
    const previousCast = !entering && root.querySelector('.stage-cast');
    root.innerHTML = view.table(state, { ...ui(), entering, tabChanged: previousTab !== activeTab, previousBackground: lastBackground !== background ? lastBackground : '', backgroundChanged: lastBackground !== background });
    const cast = root.querySelector('.stage-cast');
    if (previousCast) cast.replaceWith(previousCast);
    view.updateCast(previousCast || cast, state, ui(), turnPreview);
    lastBackground = background;
    wireChoices(); refreshBusy();
    const transcript = document.getElementById('transcript');
    transcript.scrollTop = follow || playing ? transcript.scrollHeight : scrollPositions.narrative || 0;
    for (const panel of document.querySelectorAll('.story-panel:not([hidden])')) if (panel.id !== 'panel-narrative') panel.scrollTop = scrollPositions[panel.id] || 0;
    const fresh = [...document.querySelectorAll('[data-log-id]')].filter(el => !knownLogs.has(el.dataset.logId));
    fresh.slice(-3).forEach(el => el.classList.add('is-new'));
    state.publicLog.forEach(log => knownLogs.add(log.id));
    if (focus) { const el = document.getElementById(focus); el?.focus({ preventScroll: true }); if (typeof pos === 'number' && el?.setSelectionRange) el.setSelectionRange(pos, pos); }
  }
  async function stopQueue() {
    playing = false; generation++;
    if (stopping) return stopping;
    stopping = (async () => {
      if (ackFlight) await ackFlight;
      if (state?.pendingBatch) { const batch = state.pendingBatch; state = await post('/ack', { batchId: batch.id, count: batch.acked, discard: true }); }
    })().finally(() => { stopping = null; });
    return stopping;
  }
  async function play() {
    if (playing || !state?.pendingBatch || dialog.open || diceAnimating) return;
    playing = true; const epoch = ++generation; render();
    while (playing && generation === epoch && state.pendingBatch) {
      const batch = state.pendingBatch;
      const transcript = document.getElementById('transcript');
      const line = batch.lines[batch.acked];
      const spoken = { actorId: line.speaker, speaker: name(line.speaker), expressionSlot: line.expressionSlot, dialogue: line.dialogue, action: line.action, kind: 'dialogue' };
      transcript.insertAdjacentHTML('beforeend', logs([spoken]));
      view.updateCast(root.querySelector('.stage-cast'), state, ui(), spoken);
      transcript.scrollTop = transcript.scrollHeight;
      ackFlight = post('/ack', { batchId: batch.id, count: batch.acked + 1 });
      try { state = await ackFlight; } finally { ackFlight = null; }
      if (generation !== epoch) break;
      render(); if (state.pendingCheck) break;
      await new Promise(resolve => setTimeout(resolve, 1300));
    }
    if (generation === epoch) { playing = false; render(); }
  }
  async function turn() {
    await stopQueue();
    const retired = state.investigators.some(c => c.player && c.outOfAction);
    const message = retired ? '' : draft.trim();
    if (message) {
      const signature = state.mode === 'keeper' ? npcSpeaker.trim() : '';
      turnPreview = { actorId: 'player', speaker: signature || state.player.name,
        expressionSlot: playerExpression, kind: 'dialogue', dialogue: message };
      view.updateCast(root.querySelector('.stage-cast'), state, ui(), turnPreview);
    }
    try {
      state = await post('/turn', { message, speaker: npcSpeaker, expressionSlot: playerExpression });
      draft = '';
    } finally {
      turnPreview = null;
      render();
    }
    if (state.pendingBatch) setTimeout(() => { play().catch(error => { playing = false; notice(error.message, true); render(); }); }, 0);
  }
  async function control(tool, args) { await stopQueue(); state = await post('/control', { tool, args }); render(); }
  function readControl() { controlChar = document.getElementById('target')?.value || controlChar; controlSkill = document.getElementById('skill')?.value || controlSkill; controlDifficulty = document.getElementById('difficulty')?.value || controlDifficulty; clueId = document.getElementById('clue')?.value || clueId; sceneId = document.getElementById('scene')?.value || sceneId; replacementId = document.getElementById('replacement')?.value || replacementId; }
  async function dice(manual) {
    const secret = document.getElementById('secret-roll')?.checked;
    await stopQueue(); const result = await post('/roll', manual ? { targetChar: controlChar, skill: controlSkill, difficulty: controlDifficulty, secret } : {});
    const roll = result.roll; delete result.roll; state = result; render();
    showDice(roll, secret);
  }
  function showDice(roll, secret = false) {
    const version = ++diceVersion;
    if (secret) { secretRoll = roll; activeTab = 'keeper'; }
    else { activeTab = 'narrative'; if (!recentRolls.some(r => view.rollKey(r) === view.rollKey(roll))) recentRolls.push(roll); }
    diceAnimating = true; render();
    view.animateDice(roll, secret).finally(() => {
      if (version !== diceVersion) return;
      diceAnimating = false;
      if (state?.pendingBatch && !playing && !busy) play().catch(error => notice(error.message, true));
    });
  }
  async function reloadLobby() { saves = await sdk.save.list(); state = null; uiSessionId = null; draft = ''; lobby(); }
  document.addEventListener('input', e => {
    if (['stat-reason', 'handout', 'encounter'].includes(e.target.id)) fields[e.target.id] = e.target.value;
    if (e.target.id === 'message') { draft = e.target.value; if (playing || state?.pendingBatch) stopQueue().catch(error => notice(error.message, true)); }
    if (e.target.id === 'npc-speaker') npcSpeaker = e.target.value;
    if (e.target.id === 'scenario-draft') document.getElementById('scenario-edit-error').textContent = '';
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'secret-roll') fields['secret-roll'] = e.target.checked;
    if (e.target.id === 'images-enabled') imagesEnabled = e.target.checked;
    if (e.target.id === 'player-expression') playerExpression = e.target.value;
    readControl();
    if (e.target.id === 'scenario-file') work(async () => {
      const file = e.target.files[0]; if (!file) return;
      e.target.value = '';
      if (file.size > 512 * 1024 || !/\.(md|txt|json)$/i.test(file.name)) throw new Error('请选择不超过 512KB 的 md / txt / json 剧本');
      importedScenario = await post('/parse-scenario', { content: await file.text(), format: /\.json$/i.test(file.name) ? 'json' : 'text' });
      scenarioId = customScenarioId;
      updateLobby('scenarioList', 'briefing', 'launch');
      notice('已导入并选中外部剧本');
    });
  });
  document.addEventListener('keydown', e => {
    const group = e.target.closest('[data-picker], [role=tablist]');
    if (group && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)) { e.preventDefault(); const buttons = [...group.querySelectorAll('button:not(:disabled)')]; const i = buttons.indexOf(e.target); const n = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (['ArrowRight','ArrowDown'].includes(e.key) ? 1 : -1) + buttons.length) % buttons.length; buttons[n]?.click(); buttons[n]?.focus(); return; }
    if (e.target.id === 'message' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); work(async () => { await turn(); }); } });
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]'); if (!el || el.disabled) return; const action = el.dataset.action; readControl();
    if (action === 'choice') { const group = el.closest('[data-picker]'); group.dataset.value = el.dataset.value; group.value = el.dataset.value; group.querySelectorAll('button').forEach(item => { const chosen = item === el; item.classList.toggle('selected', chosen); item.setAttribute('aria-pressed', String(chosen)); }); readControl(); return; }
    if (action === 'tab') { activeTab = el.dataset.tab; render(); document.getElementById('tab-' + activeTab)?.focus({preventScroll:true}); return; }
    if (action === 'evidence') { const clue = state.clues.find(c => c.id === el.dataset.id); if (clue) modal(clue.title, `<article class="evidence-detail"><span class="evidence-label">${clue.isSecret ? '私密证物' : '公开证物'}</span><p>${view.highlight(clue)}</p></article>`); return; }
    if (action === 'close') { closeModal(); return; }
    if (action === 'choose-scenario') {
      if (scenarioId !== el.dataset.id) { scenarioId = el.dataset.id; updateLobby('scenarioList', 'briefing', 'launch'); }
      return;
    }
    if (action === 'lobby-mode') {
      if (mode === el.dataset.mode) return;
      mode = el.dataset.mode;
      updateLobby('partyMode', 'partyStatus', 'roster', 'launch');
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        root.querySelector('.party-list').animate([{ opacity: .5 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
      }
      return;
    }
    if (action === 'pick' || action === 'pick-keeper') { assignParty(action, Number(el.dataset.id)); return; }
    if (action === 'rules') { showRules(); return; }
    if (action === 'jump-party') {
      const heading = document.getElementById('party-title');
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      return;
    }
    if (action === 'import-scenario') { document.getElementById('scenario-file').click(); return; }
    if (action === 'edit-scenario') { editScenario(); return; }
    if (action === 'apply-scenario') { applyScenario(); return; }
    if (action === 'history') { modal('日志回溯', `<div class="history-log">${logs(state.publicLog)}</div>`, true); return; }
    if (action === 'images') { modal('场景印相', `${state.imageJobs.length ? state.imageJobs.map(j => `<article class="image-proof">${j.url ? `<img src="${esc(image(j.url))}" alt="游戏场景图">${button('promote', '收藏到邻舍相册', '', `data-url="${esc(j.url)}" data-network`)}` : `<p class="field-note">${j.status === 'running' ? '正在显影…' : esc(j.error || '显影中断')}</p>`}</article>`).join('') : '<p class="empty-copy">尚未拍下场景。生成图片会使用当前生图服务。</p>'}<div class="dialog-footer">${button('retry-image', '拍下当前场景', '', 'data-network')}</div>`); return; }
    if (action === 'finish-dialog') { modal('让这场调查落幕', `<label for="ending">这一局的结尾</label><textarea id="ending" rows="4" maxlength="1000" placeholder="留下最后一句话…">${state.ended ? esc(state.publicLog.at(-1)?.dialogue) : ''}</textarea><label class="checkbox-label"><input id="write-memory" type="checkbox" ${state.memoryWritten ? 'checked disabled' : ''}>作为“桌游／剧本杀回忆”写入角色长期记忆</label><div class="dialog-footer">${button('finish', state.ended ? '保存回忆' : '封存这份卷宗', 'primary', 'data-network')}</div>`); return; }
    if (action === 'delete-save') { modal('删除存档', '<p class="empty-copy">这份存档与对应游戏图片将一并删除。</p><div class="dialog-footer">' + button('confirm-delete', '删除存档', 'danger', `data-id="${esc(el.dataset.id)}" data-network`) + '</div>'); return; }
    if (action === 'pause') { stopQueue().then(render).catch(error => notice(error.message, true)); return; }
    if (action === 'next' && state.pendingBatch) { play().catch(error => { playing = false; notice(error.message, true); render(); }); return; }
    work(async () => {
      switch (action) {
        case 'start': {
          const { selected, canStart } = lobbyData();
          if (!canStart) return;
          state = await post('/start', { mode, characterIds: selected, scenarioId,
            scenario: scenarioId === customScenarioId ? importedScenario : undefined, keeperId, imagesEnabled });
          draft = ''; render(); break;
        }
        case 'load': state = await sdk.ext.request(`/state?sessionId=${encodeURIComponent(el.dataset.id)}`); render(); break;
        case 'manage-standings': await sdk.ui.openStandings(el.dataset.subject === 'player' ? 'player' : Number(el.dataset.subject)); break;
        case 'exit-game': await sdk.ui.exit(); break;
        case 'confirm-delete': await sdk.save.delete(el.dataset.id); closeModal(); await reloadLobby(); break;
        case 'lobby': await stopQueue(); await reloadLobby(); break;
        case 'next': await turn(); break;
        case 'send': if (draft.trim()) await turn(); break;
        case 'roll': await dice(false); break;
        case 'manual-roll': await dice(true); break;
        case 'switch-scene': await control('switch_scene', { sceneId }); break;
        case 'stat': { const i = Number(el.dataset.stat); await control('update_investigator_stat', { targetChar: controlChar, hpDelta: i < 2 ? (i === 0 ? -1 : 1) : 0, sanDelta: i >= 2 ? (i === 2 ? -1 : 1) : 0, reason: document.getElementById('stat-reason').value }); break; }
        case 'reveal-all': case 'reveal-private': await control('reveal_clue', { clueId, targetCharOrAll: action === 'reveal-all' ? 'all' : controlChar }); break;
        case 'handout': await control('send_secret_handout', { targetChar: controlChar, content: document.getElementById('handout').value }); notice('密信已送达'); break;
        case 'encounter': await control('trigger_encounter', { description: document.getElementById('encounter').value }); break;
        case 'replacement': await stopQueue(); state = await post('/replacement', { characterId: Number(replacementId) }); render(); break;
        case 'retry-image': state = await post('/retry-image', {}); closeModal(); render(); break;
        case 'promote': await sdk.image.promote(state.sessionId, el.dataset.url.split('/').at(-1)); notice('已收藏到邻舍相册'); break;
        case 'finish': await stopQueue(); state = await post('/finish', { ending: document.getElementById('ending').value, writeMemory: document.getElementById('write-memory').checked }); closeModal(); render(); break;
      }
    });
  });
  async function boot() {
    try {
      if (!sdk) throw new Error('请从邻舍游戏中心打开本游戏');
      await sdk.ready;
      [catalog, characters, saves, castAssets] = await Promise.all([sdk.ext.request('/catalog'), sdk.bridge.call('get_characters'), sdk.save.list(), sdk.ext.request('/cast')]);
      const recommended = view.orderCharacters(characters, castAssets);
      lineups.keeper = recommended.slice(0, 3).map(c => c.id);
      keeperId = recommended[0]?.id ?? null;
      lineups.investigator = recommended.slice(1, 3).map(c => c.id);
      scenarioId = catalog.scenarios[0]?.id || '';
      lobby();
      sdk.on?.('standing-assets', () => work(async () => {
        castAssets = await sdk.ext.request('/cast');
        if (!castAssets.player.expressions[playerExpression]) playerExpression = 'normal';
        if (state) render(); else updateLobby('roster');
      }));
      sdk.on?.('media', async event => { if (state?.sessionId === event.sessionId) { state.imageJobs = state.imageJobs.map(j => j.id === event.id ? event : j); if (!playing && !busy) render(); notice(event.status === 'done' ? '一张新的场景印相已放到桌上。' : '场景显影失败，可从印相中重试。', event.status !== 'done'); } });
      sdk.on?.('dice', event => { if (state?.sessionId === event.sessionId) showDice(event.roll); });
    } catch (error) {
      root.innerHTML = `<div class="loading-screen"><p>${esc(error.message)}</p>${button('boot', '重新连接')}${sdk ? button('exit-game', '返回游戏馆') : ''}</div>`;
      root.querySelector('[data-action="boot"]').addEventListener('click', () => window.location.reload());
    }
  }
  boot();
})();
