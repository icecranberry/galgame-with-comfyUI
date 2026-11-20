(() => {
  'use strict';
  const sdk = window.LinSheGameSDK;
  const mix = window.TavernMix;
  const view = window.TavernView;
  const el = id => document.getElementById(id);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const station = window.TavernStation;
  const ui = { busy: '连接中…', error: '', target: '', reply: '', saves: [], sessionId: '', reportId: '' };
  let recipe = mix.empty();
  const potionDrafts = new WeakMap();
  function potionDraft() {
    if (!potionDrafts.has(recipe)) potionDrafts.set(recipe, { open:false, text:'', result:null, pending:null, known:new Map() });
    return potionDrafts.get(recipe);
  }
  function drawPotionEditor(draft) {
    el('potion-editor').hidden=!draft.open;
    const field=el('potion-name');
    if(document.activeElement!==field && field.value!==draft.text) field.value=draft.text;
    const result=draft.result, stat=result && mix.dose(result);
    const color=result?.color || '#76c8ae';
    el('elixir-tint').setAttribute('flood-color',color);
    const preview=el('potion-preview');
    preview.style.setProperty('--ink',color);
    preview.textContent=stat ? stat.name+' · '+stat.label+' +1' : '';
    const action=el('potion-editor').querySelector('button');
    action.textContent=draft.pending?'鉴定中…':result?'滴入一滴':'鉴定魔药';
    action.disabled=!draft.text.trim() || !!draft.pending || recipe.potions.length>=3 || station.locked;
  }
  function editPotionName() {
    const field=el('potion-name'), draft=potionDraft();
    const text=[...field.value].slice(0,20).join('');
    if(field.value!==text) field.value=text;
    if(draft.text!==text) {
      draft.text=text;draft.result=draft.known.get(text.trim()) || null;draft.pending=null;
      renderMix();
    }
  }
  async function blendPotion() {
    const draft=potionDraft(), name=draft.text.trim(), currentRecipe=recipe;
    if (!name || draft.pending || recipe.potions.length>=3 || station.locked) return;
    if (draft.result) {
      await station.act(()=>selectIngredient('potion',draft.result),renderMix);
      return;
    }
    const request=Symbol();
    draft.pending=request;drawPotionEditor(draft);
    let result;
    try { result=await post('/potion/identify',{name}); } catch { /* Use the local tasting notes offline. */ }
    if (currentRecipe!==recipe || draft.pending!==request) return;
    const candidate={name,stat:result?.stat,color:result?.color};
    draft.result=mix.dose(candidate)?candidate:mix.localPotion(name);
    draft.known.set(name,draft.result);
    draft.pending=null;
    renderMix();
  }
  let save;
  let writes = Promise.resolve();
  let mediaTimer;
  let drawer = '';
  let closeTimer;
  let toastTimer;
  let returnFocus;
  let leaving = false;
  let drag;

  const runningImages = new Set();
  const nightStart = () => ({
    phase: 'OPENING', turn: 0, cursor: 0, guests: [], history: [], quickReplies: [],
    notes: [], slots: [null, null, null], quest: null, tipsy: {},
  });
  const fresh = () => ({
    schema: 1, editVersion: 0, night: 1, ...nightStart(),
    people: {}, affinity: {}, drinks: [], reports: [], wall: [], media: {}, settings: { illustrations: true },
  });
  const initial = fresh();
  const current = () => save?.state || initial;
  const title = state => '深夜小酒馆 · Night ' + state.night;
  // The iframe has an opaque origin; getRandomValues is available in both HTTP previews and the Android shell.
  const id = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  const post = (path, body = {}, sessionId = ui.sessionId) => sdk.ext.request(path, { method: 'POST', body: { sessionId, ...body } });

  function notice(message) {
    const node = el('notice');
    node.textContent = message;
    node.classList.add('shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('shown'), 2700);
  }
  function serial(work) {
    const next = writes.then(work);
    writes = next.catch(() => {});
    return next;
  }
  function adopt(next) {
    if (next.state?.schema !== 1) throw new Error('找不到可载入的酒馆存档。');
    save = next;
    ui.sessionId = next.sessionId;
  }
  function commit(update) {
    return serial(async () => {
      const base = save;
      let revision = base;
      for (let attempt = 0; attempt < 4; attempt++) {
        const state = structuredClone(revision.state);
        update(state);
        state.editVersion++;
        try {
          adopt(await sdk.save.write(base.sessionId, title(state), state, revision.revision));
          return;
        } catch (error) {
          const latest = await sdk.save.load(base.sessionId).catch(() => null);
          if (!latest || latest.revision === revision.revision) throw error;
          if (latest.state.editVersion !== base.state.editVersion) {
            adopt(latest);
            throw new Error('这间酒馆刚在另一个窗口更新，已载入最新进度。');
          }
          revision = latest;
        }
      }
      throw new Error('暗房正在写入新照片，请再试一次。');
    });
  }

  function syncMedia(sessionId) {
    return serial(async () => {
      if (sessionId !== ui.sessionId) return;
      const latest = await sdk.save.load(sessionId);
      if (sessionId !== ui.sessionId || leaving) return;
      if (latest.revision > save.revision && latest.state.editVersion === current().editVersion) {
        adopt(latest);
        render();
      }
    });
  }
  function generateMedia(drinkId, kind, sessionId = ui.sessionId) {
    const key = sessionId + '/' + kind + '/' + drinkId;
    if (runningImages.has(key)) return;
    runningImages.add(key);
    const path = kind === 'cg' ? '/char/generate-tipsy-cg' : '/drink/generate-card';
    void post(path, { drinkId }, sessionId).then(() => syncMedia(sessionId))
      .catch(() => { if (sessionId === ui.sessionId && !leaving) notice('暗房暂时离线，进度已保存在本局。'); })
      .finally(() => runningImages.delete(key));
  }
  function resumeMedia() {
    const sessionId = ui.sessionId, state = current();
    for (const drink of state.drinks) {
      if (state.media[drink.id]?.status === 'pending') generateMedia(drink.id, 'card', sessionId);
      if (state.media['tipsy-' + drink.id]?.status === 'pending') generateMedia(drink.id, 'cg', sessionId);
    }
    for (const item of state.reports) {
      if (state.media[item.questId]?.status === 'pending') {
        void post('/quest/resolve', { questId: item.questId }, sessionId).then(() => syncMedia(sessionId)).catch(() => {});
      }
    }
  }
  function setContent(node, html) {
    if (node.renderedHtml === html) return;
    const active = node.contains(document.activeElement) ? document.activeElement : null;
    const selection = active?.tagName === 'INPUT' && active.type === 'text' ? [active.selectionStart, active.selectionEnd] : null;
    const previousScroll = [...node.querySelectorAll('.notes,.overlay-content')].map(child => child.scrollTop);
    node.innerHTML = html;
    node.renderedHtml = html;
    node.querySelectorAll('.notes,.overlay-content').forEach((child, index) => { child.scrollTop = previousScroll[index] || 0; });
    if (active) {
      const replacement = [...node.querySelectorAll('button,input,select')].find(candidate => candidate.name && candidate.name === active.name ||
        candidate.id && candidate.id === active.id ||
        candidate.dataset.action && candidate.dataset.action === active.dataset.action && candidate.dataset.id === active.dataset.id);
      replacement?.focus({ preventScroll: true });
      if (selection) replacement?.setSelectionRange(...selection);
    }
  }

  function renderMix(state = current()) {
    const guest = state.guests.find(row => row.id === ui.target);
    const sending = state.quest?.status === 'assigned' && state.quest.charId === guest?.id;
    setContent(el('recipients'), state.guests.map(person => view.button('recipient', view.avatar(person) + view.esc(person.name) +
      (state.quest?.status === 'assigned' && state.quest.charId === person.id ? '<small>接单人</small>' : ''), {
      id:person.id, disabled:!!ui.busy || state.quest?.status === 'away' && state.quest.charId === person.id,
      attrs:'aria-pressed="' + (ui.target === person.id) + '"',
    })).join(''));
    const draft=potionDraft();
    drawPotionEditor(draft);
    const preview = view.ingredients(recipe,draft);
    for (const field of ['bases', 'potions', 'garnishes']) setContent(el(field), preview[field]);
    if (el('workshop').dataset.renderer === 'fallback') setContent(el('glass-model'), view.glass(recipe, 'counter-cup', sending));
    setContent(el('glass-detail'), view.chip(recipe));
    el('glass').dataset.base = recipe.baseLiquor;
    setContent(el('meters'), view.meters(recipe));
    el('potions').dataset.drops = recipe.potions.length;
    const canServe = !ui.busy && guest && recipe.baseLiquor && ['CHATTING','CRAFTING'].includes(state.phase) &&
      !(state.quest?.status === 'away' && state.quest.charId === guest.id);
    station.draw(recipe, guest, canServe, view, setContent);
  }
  function renderStageMedia(state) {
    const drink = state.drinks.find(row => row.id === ui.tasting && row.night === state.night);
    const media = drink && state.media['tipsy-' + drink.id];
    const url = view.image(media?.url);
    const stage = el('stage'), frame = el('cg-frame');
    ui.focusId = drink?.charId || '';
    stage.classList.toggle('face-view', !!drink && !!ui.face);
    if (frame.dataset.url !== (url || '')) {
      frame.dataset.url = url || '';
      frame.classList.remove('loaded'); frame.replaceChildren();
      if (url) {
        const img = new Image();
        img.alt = (state.people[drink.charId]?.name || '邻居') + '饮下特调后的神态';
        img.onload = () => {
          if (frame.dataset.url !== url) return;
          frame.classList.add('loaded');
          el('seats').inert = !!ui.face;
        };
        img.onerror = () => { if (frame.dataset.url === url) frame.classList.remove('loaded'); };
        frame.append(img); img.src = url;
      }
    }
    el('seats').inert = !!drink && !!ui.face && frame.classList.contains('loaded');
    const pending = ui.face && media?.status === 'pending' && media.illustrations;
    el('capture').hidden = !pending;
    setContent(el('focus-tools'), drink ? view.button('face', ui.face ? '切回群像立绘' : url ? '查看实时 CG' : '查看品尝特写') +
      (ui.face && url ? view.button('promote',media.promoted?'已存至大相册':'保存至大相册',{id:'tipsy-'+drink.id,disabled:media.promoted}) : '') : '');
    const card = [...state.drinks].reverse().find(item => item.night === state.night);
    const photo = card && state.media[card.id];
    const cardUrl = view.image(photo?.url);
    setContent(el('special-card'), cardUrl && !photo.stowed ?
      view.button('special', '<img src="'+view.esc(cardUrl)+'" alt=""><span>当前特调<strong>'+view.esc(photo.drinkName || mix.base(card.recipe).fallback)+'</strong></span>',{id:card.id})+
      view.button('stow','收进酒单',{id:card.id}) : '');
    clearTimeout(mediaTimer);
    if (!leaving && Object.values(state.media).some(entry => entry.status === 'pending')) {
      const session = ui.sessionId;
      mediaTimer = setTimeout(async () => {
        try { await syncMedia(session); } catch { /* SDK events and the next poll can still deliver the image. */ }
        if (!leaving && session === ui.sessionId) renderStageMedia(current());
      }, 5000);
    }
  }
  function renderSeats(state) {
    const seats = el('seats'), html = view.seats(state,ui);
    if (seats.renderedHtml === html) return;
    const old = new Map([...seats.querySelectorAll('[data-guest]')].map(node => [node.dataset.guest,node.querySelector('img:not(.previous-sprite)')]));
    setContent(seats,html);
    for (const node of seats.querySelectorAll('[data-guest]')) {
      const image = node.querySelector('img'), previous = old.get(node.dataset.guest);
      if (!image || !previous?.naturalWidth || previous.src === image.src || reducedMotion.matches) continue;
      previous.className = 'previous-sprite';
      image.after(previous);
      image.decode().then(() => previous.animate([{opacity:1},{opacity:0}],{duration:300}).finished)
        .then(()=>previous.remove()).catch(()=>{ if (!previous.isConnected || image.naturalWidth) previous.remove(); });
    }
  }
  function render() {
    const state = current();
    const filledSlots = state.slots.filter(Boolean).length;
    const preparingCommission = state.phase === 'CHATTING' && !state.quest;
    const minutes = (23 * 60 + 40 + state.turn * 4) % (24 * 60);
    el('clock').textContent = 'Night ' + state.night + ' · ' + String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
    el('stage').classList.toggle('is-opening', state.phase === 'OPENING');
    el('commission-board').classList.toggle('is-ready', preparingCommission && filledSlots === state.slots.length);
    el('workshop').classList.toggle('is-muted', state.quest?.status === 'draft');
    el('workshop').classList.toggle('is-focused', state.quest?.status === 'assigned');
    setContent(el('avatars'), state.guests.map(guest => '<span title="' + view.esc(guest.name) + '">' + view.avatar(guest) + '</span>').join(''));
    el('stations').hidden = state.phase === 'OPENING';
    const badge = el('note-badge');
    badge.textContent = Math.min(state.notes.length,3) + '/3';
    const boardButton = badge.parentElement;
    boardButton.classList.toggle('ready', preparingCommission && state.notes.length >= 3);
    boardButton.title = state.notes.length + ' 张传闻便签';
    const mixButton = el('stations').querySelector('[data-id="mix"]');
    mixButton.disabled = state.phase === 'REPORT' || !state.guests.some(person => !(state.quest?.status === 'away' && state.quest.charId === person.id));
    mixButton.classList.toggle('ready',state.quest?.status==='assigned');
    renderStageMedia(state);
    renderSeats(state);
    setContent(el('dialogue'), view.dialogue(state, ui));
    let noteStatus = state.notes.length ? state.notes.length + ' 张便签' : '';
    if (preparingCommission && state.notes.length) {
      noteStatus = (filledSlots ? '已入槽 ' : '点便签入槽 ') + filledSlots + '/' + state.slots.length;
    }
    el('note-count').textContent = noteStatus;
    setContent(el('board'), view.board(state, ui));
    const ingredient = el('custom');
    if (document.activeElement !== ingredient) ingredient.value = recipe.customIngredient;
    renderMix(state);
    if (drawer) renderOverlay();
  }
  function renderOverlay() {
    setContent(el('overlay-panel'), view.drawer(current(), ui, drawer));
  }
  function openDrawer(kind) {
    const overlay = el('overlay');
    clearTimeout(closeTimer);
    overlay.classList.remove('closing');
    if (!overlay.open) returnFocus = document.activeElement;
    drawer = kind;
    overlay.classList.toggle('is-drawer', kind !== 'report');
    renderOverlay();
    if (!overlay.open) overlay.showModal();
    overlay.querySelector('.close')?.focus();
    if (kind === 'saves' && sdk && save) {
      void sdk.save.list().then(rows => { ui.saves = rows; if (drawer === 'saves') renderOverlay(); }).catch(error => notice(error.message));
    }
  }
  function closeDrawer() {
    const overlay = el('overlay');
    if (!overlay.open || overlay.classList.contains('closing')) return;
    overlay.classList.add('closing');
    closeTimer = setTimeout(() => {
      overlay.close();
      overlay.classList.remove('closing');
      drawer = '';
      returnFocus?.focus({ preventScroll: true });
    }, reducedMotion.matches ? 1 : 300);
  }

  const narrator = async (label, action) => {
    if (!save || ui.busy || leaving) return;
    ui.busy = label;
    render();
    try { await action(); }
    catch (error) { notice(error.message); }
    finally { ui.busy = ''; render(); }
  };
  function addDialogue(state, result, playerLine = '') {
    const start = state.history.length;
    if (playerLine) state.history.push({ charId: 'player', text: playerLine, mood: '', rumors: [] });
    for (const line of result.dialogues) {
      state.history.push(line);
      state.tipsy[line.charId] = mix.clamp((state.tipsy[line.charId] || 0) + line.tipsyDelta, 0, 100);
    }
    const pruned = Math.max(0, state.history.length - 36);
    if (pruned) state.history.splice(0, pruned);
    state.cursor = start - pruned + Number(Boolean(playerLine));
    state.quickReplies = result.quickReplies;
    state.turn++;
  }
  async function chat(playerLine = '', drinkId = '') {
    const result = await post('/chat/turn', { playerLine, drinkId });
    await commit(state => addDialogue(state, result, playerLine));
    ui.reply = '';
  }
  function fly(origin) {
    if (reducedMotion.matches) return;
    const target = el('note-badge');
    const start = origin.getBoundingClientRect();
    const end = target.getBoundingClientRect();
    const paper = document.createElement('span');
    paper.className = 'flying-note';
    paper.textContent = origin.textContent;
    paper.setAttribute('aria-hidden', 'true');
    Object.assign(paper.style, { left: start.left + 'px', top: start.top + 'px' });
    document.body.append(paper);
    const animation = paper.animate([
      { transform: 'translate(0, 0) rotate(-5deg)', opacity: 1 },
      { transform: 'translate(' + (end.left + 22 - start.left) + 'px,' + (end.top + 22 - start.top) + 'px) rotate(12deg) scale(.55)', opacity: .15 },
    ], { duration: 420, easing: 'cubic-bezier(.3,.65,.3,1)' });
    animation.finished.catch(() => {}).finally(() => paper.remove());
  }
  function collect(noteId, origin) {
    const state = current();
    const note = state.history[state.cursor]?.rumors.find(row => row.id === noteId);
    if (!note || state.notes.some(row => row.id === noteId || row.keyword === note.keyword) || ui.busy) return;
    fly(origin);
    return narrator('收起便签…', () => commit(draft => draft.notes.push(note)));
  }
  function place(noteId, slot) {
    const state = current();
    if (ui.busy || state.phase !== 'CHATTING' || !state.notes.some(note => note.id === noteId)) return;
    const previous = state.slots.indexOf(noteId);
    const index = slot ?? state.slots.indexOf(null);
    if (index === previous && previous >= 0) return;
    if (index < 0) { notice('三个槽位都满了，点槽位取下便签。'); return; }
    return narrator('整理便签…', () => commit(draft => {
      if (previous >= 0) draft.slots[previous] = draft.slots[index];
      draft.slots[index] = noteId;
    }));
  }
  function chooseGuest(guestId) {
    const state = current();
    if (ui.busy || !state.guests.some(row => row.id === guestId) || (state.quest?.status === 'away' && state.quest.charId === guestId)) return;
    ui.target = guestId;
    if (state.quest?.status === 'draft') return narrator('交付委托…', async () => {
      await commit(draft => { Object.assign(draft.quest, { charId: guestId, status: 'assigned' }); });
      await station.close();
    });
    render();
  }
  function focusStation(kind) {
    if (current().phase === 'OPENING') return;
    station.open(kind, () => recipe, render);
  }
  async function pour() {
    const state = current();
    const charId = ui.target;
    const sending = state.quest?.status === 'assigned' && state.quest.charId === charId;
    const poured = { ...recipe, potions: [...recipe.potions], ice: recipe.iceCount > 0 };
    const effects = mix.calculate(poured);
    const drink = {
      id: id(), recipe: poured, charId, night: state.night,
      stats: effects.stats, chaos: effects.chaos, tipsyDelta: effects.tipsyDelta, colors: effects.colors,
    };
    await station.serve();
    const cgKey = 'tipsy-' + drink.id;
    try { await commit(draft => {
      draft.drinks.push(drink);
      draft.media[drink.id] = { status: 'pending', illustrations: draft.settings.illustrations };
      draft.tipsy[charId] = mix.clamp((draft.tipsy[charId] || 0) + effects.tipsyDelta, 0, 100);
      draft.media[cgKey] = { status: draft.settings.illustrations ? 'pending' : 'fallback', illustrations: draft.settings.illustrations, tipsy: draft.tipsy[charId] };
      draft.affinity[charId] = (draft.affinity[charId] || 0) + effects.affinityDelta;
      if (sending) Object.assign(draft.quest, { status: 'away', drinkId: drink.id });
    }); } catch (error) { station.restore(recipe); throw error; }
    ui.tasting = drink.id; ui.face = true;
    generateMedia(drink.id,'card');
    const tasting = post('/chat/turn', { drinkId:drink.id });
    // The stage fades while the host prepares the reaction and its illustration.
    tasting.catch(() => {});
    await station.close(); station.reset();
    recipe = mix.empty(); el('custom').value = '';
    if (sending) ui.target = current().guests.find(guest => guest.id !== charId)?.id || '';
    render();
    try {
      const result = await tasting;
      await syncMedia(ui.sessionId);
      await commit(draft => {
        const reaction = result.dialogues.find(line => line.charId === charId);
        if (reaction) result.dialogues = [reaction,...result.dialogues.filter(line => line !== reaction)];
        addDialogue(draft,result);
        Object.assign(draft.media[cgKey], { tipsy:draft.tipsy[charId], reaction:reaction?.text || '' });
      });
    } finally { if (current().media[cgKey]?.status === 'pending') generateMedia(drink.id,'cg'); }
  }
  async function resolve() {
    const quest = current().quest;
    if (quest?.status !== 'away') return;
    if (!current().media[quest.questId]) await commit(state => {
      state.media[quest.questId] = { status: 'pending', illustrations: state.settings.illustrations };
    });
    const outcome = await post('/quest/resolve', { questId: quest.questId });
    await syncMedia(ui.sessionId);
    await commit(state => {
      state.reports.push({ questId: quest.questId, night: state.night, quest, outcome });
      state.affinity[quest.charId] = (state.affinity[quest.charId] || 0) + outcome.affinityDelta;
      state.notes = state.notes.filter(note => !state.slots.includes(note.id));
      state.slots = [null, null, null];
      state.quest = null;
      state.phase = 'REPORT';
    });
    await station.close(); ui.face = false;
    ui.reportId = quest.questId;
    openDrawer('report');
  }
  async function promote(mediaId) {
    const media = current().media[mediaId];
    if (!media?.url || media.promoted) return;
    const filename = media.url.split('/').at(-1);
    await sdk.image.promote(ui.sessionId, filename);
    await commit(state => { state.media[mediaId].promoted = true; });
    notice('已经保存至大相册。');
  }
  async function load(sessionId) {
    adopt(await sdk.save.load(sessionId));
    ui.target = current().quest?.status === 'assigned' ? current().quest.charId :
      current().guests.find(guest => !(current().quest?.status === 'away' && current().quest.charId === guest.id))?.id || '';
    ui.reply = '';
    recipe = mix.empty();
    el('custom').value = '';
    station.reset(); ui.tasting = current().drinks.findLast(row => row.night === current().night && current().media['tipsy-'+row.id])?.id;
    ui.face = !!ui.tasting && current().phase !== 'REPORT';
    if (current().guests.some(guest => /^\d+$/.test(guest.id))) {
      const refreshed = await post('/char/expressions').catch(() => null);
      if (refreshed?.guests && refreshed.guests.some((g,i)=>JSON.stringify(g.expressions)!==JSON.stringify(current().guests[i]?.expressions))) {
        await commit(state => { for (const {id,expressions} of refreshed.guests) {
          const guest = state.guests.find(row => row.id === id);
          if (guest) { guest.expressions = expressions; state.people[id].expressions = expressions; }
        } });
      }
    }
    resumeMedia();
  }
  async function newSave() {
    adopt(await sdk.save.write(id(), title(initial), fresh(), 0));
    station.reset(); ui.tasting=''; ui.face=false;
    ui.target = '';
    ui.reply = '';
    recipe = mix.empty();
    el('custom').value = '';
  }
  async function start() {
    try {
      if (!sdk) throw new Error('请从邻舍游戏馆打开酒馆。');
      await sdk.ready;
      sdk.on('tavern-media', ({ sessionId }) => { void syncMedia(sessionId).catch(() => {}); });
      ui.saves = await sdk.save.list();
      if (ui.saves.length) await load(ui.saves[0].sessionId);
      else await newSave();
    } catch (error) { ui.error = error.message; }
    finally { ui.busy = ''; render(); }
  }
  async function exit() {
    if (leaving || ui.busy || !sdk) return;
    leaving = true;
    try { clearTimeout(mediaTimer); station.dispose(); await writes; await sdk.ui.exit(); }
    catch (error) { leaving = false; notice(error.message); }
  }

  async function selectIngredient(action, key) {
    if (action === 'base') { recipe.baseLiquor = key; recipe.mixedDrops = 0; }
    if (action === 'potions-clear') { recipe.potions = []; recipe.mixedDrops = 0; }
    if (action === 'potion') {
      if (recipe.potions.length === 3) { notice('最多三滴。点「清空魔药」可以重新配比。'); return; }
      recipe.potions.push(key);
    }
    if (action === 'garnish') recipe.garnish = recipe.garnish === key ? '' : key;
    renderMix();
    if (action === 'potion' && el('workshop').dataset.renderer === 'fallback' && !reducedMotion.matches) {
      const effects = el('glass-effects');
      effects.insertAdjacentHTML('beforeend', view.potionEffect(recipe, mix.dose(key).color));
      const impact = effects.lastElementChild;
      setTimeout(() => impact.remove(), 880);
    }
    await station.ingredient(action,recipe);
  }
  const actions = {
    retry: () => location.reload(),
    open: () => narrator('给来客留座…', async () => {
      const result = await post('/night/start');
      ui.target = result.guests[0].id;
      await commit(state => {
        state.guests = result.guests;
        for (const guest of result.guests) state.people[guest.id] = guest;
        state.phase = 'CHATTING';
        addDialogue(state, result);
        state.turn = 0;
      });
    }),
    drawer: openDrawer,
    close: closeDrawer,
    exit,
    guest: chooseGuest,
    station: focusStation,
    'station-close': () => station.close(),
    'focus-workshop': async () => { await station.close(); focusStation('mix'); },
    recipient: guestId => { ui.target=guestId; renderMix(); },
    step: value => { station.setStep(Number(value)); renderMix(); },
    'step-next': () => station.next(renderMix),
    ice: key => { station.setIce(recipe,Number(key)); renderMix(); },
    stir: () => station.stir(recipe,renderMix),
    face: () => { ui.face=!ui.face; render(); },
    special: drinkId => { ui.cardId=drinkId; openDrawer('special'); },
    stow: drinkId => narrator('收进酒单…',()=>commit(state=>{state.media[drinkId].stowed=true;})),
    collect,
    'slot-note': noteId => place(noteId),
    'clear-slot': index => {
      if (current().slots[index]) return narrator('整理便签…', () => commit(state => { state.slots[index] = null; }));
      const note = el('board').querySelector('.note:not(.is-slotted)');
      note?.focus();
      notice(note ? '点一张便签，它会放入空槽。' : '先从邻居的对话中收集流言。');
    },
    synthesize: () => narrator('编织传闻…', async () => {
      const state = current();
      const result = await post('/quest/synthesize', { noteIds: state.slots });
      await commit(draft => {
        draft.quest = { ...result, status: 'draft', notes: draft.slots.map(noteId => draft.notes.find(note => note.id === noteId)) };
        draft.phase = 'CRAFTING';
      });
    }),
    previous: () => narrator('回听…', () => commit(state => { state.cursor = Math.max(0, state.cursor - 1); })),
    listen: () => narrator('听邻居说…', () => current().cursor < current().history.length - 1 ? commit(state => { state.cursor++; }) : chat()),
    reply: text => narrator('听邻居说…', () => chat(text.trim())),
    speak: () => { if (ui.reply.trim()) actions.reply(ui.reply); },
    base: key => station.act(() => selectIngredient('base', key),renderMix),
    'edit-potion': () => {
      const draft=potionDraft();draft.open=!draft.open;renderMix();
      if(draft.open) el('potion-name').focus();
    },
    'blend-potion': blendPotion,
    potion: key => station.act(() => selectIngredient('potion', key),renderMix),
    'clear-potions': () => station.act(() => selectIngredient('potions-clear'),renderMix),
    garnish: key => station.act(() => selectIngredient('garnish', key),renderMix),
    pour: () => narrator('听邻居品尝…', pour),
    resolve: () => narrator('等候归来…', resolve),
    'show-report': questId => { ui.reportId = questId; openDrawer('report'); },
    continue: () => narrator('继续接待…', () => commit(state => { state.phase = 'CHATTING'; })),
    'next-night': () => narrator('收拾吧台…', async () => {
      await commit(state => { state.night++; Object.assign(state, nightStart()); });
      station.reset(); ui.face=false; ui.tasting='';
      recipe = mix.empty();
      ui.target = '';
      ui.reply = '';
      document.scrollingElement.scrollTop = 0;
    }),
    'new-save': () => narrator('预备新酒馆…', async () => { await writes; await newSave(); closeDrawer(); }),
    load: sessionId => narrator('载入酒馆…', async () => { await writes; await load(sessionId); closeDrawer(); }),
    pin: questId => narrator('钉上纪念墙…', async () => {
      await commit(state => { if (!state.wall.includes(questId)) state.wall.push(questId); });
      notice('拍立得已钉在纪念墙。');
    }),
    promote: mediaId => narrator('保存到大相册…', () => promote(mediaId)),
  };
  document.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const { action, id: key } = button.dataset;
    if (ui.busy && !['close', 'drawer', 'show-report', 'face', 'special'].includes(action)) return;
    if (station.locked) return;
    actions[action]?.(key, button);
  });
  document.addEventListener('keydown', event => {
    if(event.target.id==='potion-name' && event.key==='Enter' && !event.isComposing){
      event.preventDefault();void blendPotion();return;
    }
    if (event.target.name !== 'line' || event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    actions.speak();
  });
  document.addEventListener('input', event => {
    if(event.target.id==='potion-name' && !event.isComposing) editPotionName();
    if (event.target.name === 'line') ui.reply = event.target.value;
    if (event.target.id === 'custom' && !event.isComposing) {
      const value = [...event.target.value].slice(0, 20).join('');
      if (value !== event.target.value) event.target.value = value;
      recipe.customIngredient = mix.ingredientText(value);
      void station.ingredient('custom',recipe);
      renderMix();
    }
  });
  el('potion-name').addEventListener('compositionend',editPotionName);
  el('custom').addEventListener('compositionend', event => {
    event.target.value = mix.ingredientText(event.target.value);
    recipe.customIngredient = event.target.value;
    void station.ingredient('custom',recipe);
    renderMix();
  });
  el('station').addEventListener('cancel',event=>{event.preventDefault();if(!ui.busy&&!station.locked)void station.close();});
  el('station').addEventListener('click',event=>{if(event.target===el('station')&&station.mode==='board'&&!ui.busy&&!station.locked)void station.close();});
  el('overlay').addEventListener('change', event => {
    if (event.target.id === 'illustrations') {
      const enabled = event.target.checked;
      if (ui.busy) { event.target.checked = current().settings.illustrations; return; }
      void narrator('保存设置…', () => commit(state => { state.settings.illustrations = enabled; }));
    }
  });
  el('overlay').addEventListener('cancel', event => { event.preventDefault(); closeDrawer(); });
  el('overlay').addEventListener('click', event => { if (event.target === el('overlay')) closeDrawer(); });
  document.addEventListener('error', event => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    const seat = img.closest('[data-guest]');
    if (seat && !img.classList.contains('previous-sprite')) {
      const guest = current().guests.find(person => person.id === seat.dataset.guest);
      if (guest) {
        const tried = img.failedSources || (img.failedSources = new Set());
        tried.add(img.getAttribute('src'));
        const candidates = [...(guest.expressions || []).map(slot => slot.url), guest.portrait, guest.avatar];
        const next = candidates.map(view.image).find(src => src && !tried.has(src));
        if (next) { img.src = next; return; }
      }
    }
    if (img.matches('.portrait img, .stage-art, img[data-prop]')) img.hidden = true;
  }, true);
  document.addEventListener('dragstart', event => {
    const node = event.target.closest('[draggable="true"]');
    if (!node || ui.busy) return;
    drag = node.dataset.note ? { note: node.dataset.note } : { quest: node.dataset.quest };
    event.dataTransfer.setData('text/plain', drag.note || drag.quest);
    event.dataTransfer.effectAllowed = 'move';
  });
  const dropTarget = target => drag?.note ? target.closest('[data-slot]') : drag?.quest ? target.closest('[data-guest]:not([disabled])') : null;
  document.addEventListener('dragover', event => {
    const target = dropTarget(event.target);
    if (!target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    target.classList.add('drop-ready');
  });
  document.addEventListener('dragleave', event => {
    const target = dropTarget(event.target);
    if (target && !target.contains(event.relatedTarget)) target.classList.remove('drop-ready');
  });
  function cleanDrag() {
    drag = null;
    document.querySelectorAll('.drop-ready').forEach(node => node.classList.remove('drop-ready'));
  }
  document.addEventListener('dragend', cleanDrag);
  document.addEventListener('drop', event => {
    const target = dropTarget(event.target);
    if (!target) return;
    event.preventDefault();
    if (drag.note) void place(drag.note, Number(target.dataset.slot));
    else if (current().quest?.questId === drag.quest && current().quest.status === 'draft') void chooseGuest(target.dataset.guest);
    cleanDrag();
  });
  document.querySelectorAll('.stage-art').forEach(image => {
    if (image.complete && !image.naturalWidth) image.hidden = true;
  });
  render();
  void start();
})();
