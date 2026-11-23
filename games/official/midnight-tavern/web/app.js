(() => {
  'use strict';
  const sdk = window.LinSheGameSDK;
  const mix = window.TavernMix;
  const view = window.TavernView;
  const el = id => document.getElementById(id);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const drinkPaper = { width: 640, height: 800, angle: 9, canvasWidth: 768, canvasHeight: 896 };
  const station = window.TavernStation;
  const audio = window.TavernAudio;
  const ui = { busy: '连接中…', error: '', target: '', reply: '', sessionId: '', reportId: '', guestPhotos: new Map() };
  let recipe = mix.empty();
  let identifyingPotion = false;
  const potionDrafts = new WeakMap();
  function potionDraft() {
    if (!potionDrafts.has(recipe)) potionDrafts.set(recipe, { open: false, text: '', error: '' });
    return potionDrafts.get(recipe);
  }
  const savedPotion = name => current()?.customPotions?.find(potion => potion.name === name);
  function drawPotionEditor(draft) {
    el('potion-editor').hidden = !draft.open;
    const field = el('potion-name');
    if (document.activeElement !== field && field.value !== draft.text) field.value = draft.text;
    const dose = mix.dose(savedPotion(draft.text.trim()));
    const preview = el('potion-preview');
    preview.style.setProperty('--ink', dose?.color || '#76c8ae');
    preview.textContent = dose ? dose.name + ' · ' + mix.potionLabels(dose).join('、') : '';
    const action = el('potion-editor').querySelector('button');
    action.textContent = identifyingPotion ? '鉴定中…' : dose ? '滴入一滴' : '鉴定魔药';
    action.disabled = !draft.text.trim() || identifyingPotion || Boolean(dose && recipe.potions.length >= mix.maxDrops) || station.locked;
  }
  function editPotionName() {
    const field = el('potion-name'), draft = potionDraft();
    const text = [...field.value].slice(0, 20).join('');
    if (field.value !== text) field.value = text;
    if (draft.text !== text) {
      draft.text = text;
      draft.error = '';
      renderMix();
    }
  }
  function addSavedPotion(name) {
    const potion = mix.dose(savedPotion(name));
    if (potion) return station.act(() => selectIngredient('potion', potion), renderMix);
  }
  async function blendPotion() {
    const draft = potionDraft(), name = draft.text.trim();
    if (!name || !save || ui.busy || leaving || identifyingPotion || station.locked) return;
    if (savedPotion(name)) return addSavedPotion(name);
    identifyingPotion = true;
    draft.error = '';
    renderMix();
    try {
      const result = await post('/potion/identify', { name });
      if (leaving) return;
      const potion = mix.dose({ ...result, name });
      if (!potion || !result?.attributes || !Number.isInteger(result.tipsyDelta)) throw new Error('魔药鉴定结果有误，请再试一次。');
      await commit(state => {
        const library = state.customPotions ??= [];
        if (!library.some(item => item.name === name)) library.push(potion);
      });
    } catch (error) {
      potionDraft().error = error.message || '魔药保存失败，请再试一次。';
    } finally {
      identifyingPotion = false;
      if (!leaving && station.mode) renderMix();
    }
  }
  async function removeSavedPotion(name, trigger) {
    if (!savedPotion(name)) return;
    const draft = potionDraft();
    draft.error = '';
    try {
      await commit(state => {
        state.customPotions = (state.customPotions || []).filter(potion => potion.name !== name);
      });
    } catch (error) {
      potionDraft().error = error.message || '魔药删除失败，请再试一次。';
    }
    if (!station.mode || leaving) return;
    const hadFocus = document.activeElement === trigger;
    renderMix();
    if (hadFocus && !trigger.isConnected) {
      (el('saved-potions').querySelector('[data-action="remove-potion"]') ||
        el('potions').querySelector('[data-action="edit-potion"]'))?.focus({ preventScroll: true });
    }
  }
  let save;
  let writes = Promise.resolve();
  let mediaTimer;
  let drawer = '';
  let closeTimer;
  let toastTimer;
  let returnFocus;
  let photoSeat;
  let leaving = false;
  let drinkAttempt;
  let readingPosition;
  let cursorWrite;
  let pageTurn;

  const current = () => save?.state;
  function readingPage(state) {
    // Navigation uses guest pages; saves and the chat service use original history indices.
    const cursors = [];
    for (const [i, line] of state.history.entries()) {
      if (line.role === 'user' && state.history[i + 1]?.role === 'assistant') continue;
      cursors.push(i);
    }
    const savedCursor = readingPosition?.cursor ?? state.cursor;
    const index = cursors.findIndex(cursor => cursor >= savedCursor);
    return { cursors, index, cursor: cursors[index] };
  }
  const title = state => '老板，八卦特浓，少冰 · Night ' + state.night;
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
    if (next?.state?.schema !== 3) throw new Error('找不到可恢复的酒馆进度。');
    const state = next.state;
    const text = state.history?.[state.cursor]?.text;
    if (!Array.isArray(state.history) || !Number.isInteger(state.cursor) ||
      typeof text !== 'string' || !text.trim() || !Array.isArray(state.quickReplies) ||
      !Array.isArray(state.guests) || !Array.isArray(state.drinks) || !state.media || !state.standingByGuest) {
      throw new Error('返回的酒馆进度不完整，请再试一次。');
    }
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
        const failed = Object.entries(latest.state.media).some(([key, entry]) =>
          entry.status === 'failed' && current().media[key]?.status !== 'failed');
        adopt(latest);
        render();
        if (failed) notice('图片生成失败，可在招牌酒单中重试。');
      }
    });
  }
  function setContent(node, html) {
    if (node.renderedHtml === html) return;
    const active = node.contains(document.activeElement) ? document.activeElement : null;
    const selection = active?.tagName === 'INPUT' && active.type === 'text' ? [active.selectionStart, active.selectionEnd] : null;
    const previousScroll = [...node.querySelectorAll('.overlay-content')].map(child => child.scrollTop);
    node.innerHTML = html;
    node.renderedHtml = html;
    node.querySelectorAll('.overlay-content').forEach((child, index) => { child.scrollTop = previousScroll[index] || 0; });
    if (active) {
      const replacement = [...node.querySelectorAll('button,input,select')].find(candidate => candidate.name && candidate.name === active.name ||
        candidate.id && candidate.id === active.id ||
        candidate.dataset.action && candidate.dataset.action === active.dataset.action && candidate.dataset.id === active.dataset.id);
      replacement?.focus({ preventScroll: true });
      if (selection) replacement?.setSelectionRange(...selection);
    }
  }

  function renderMix(state = current()) {
    const guest = state.guests.find(row => row.name === ui.target);
    const now = guest ? state.tipsy[guest.name] || 0 : 0;
    const allowed = mix.canServeDrink(now, recipe);
    setContent(el('recipients'), state.guests.map(person => {
      const value = state.tipsy[person.name] || 0;
      return view.button('recipient', view.avatar(person) + '<span>' + view.esc(person.name) +
        '<small>' + view.tipsyLabel(value) + ' · ' + value + '/100</small></span>', {
        id: person.name, disabled: !!ui.busy, attrs: 'aria-pressed="' + (ui.target === person.name) + '"',
      });
    }).join(''));
    const draft = potionDraft();
    drawPotionEditor(draft);
    const preview = view.ingredients(recipe, draft);
    for (const field of ['bases', 'potions', 'garnishes']) setContent(el(field), preview[field]);
    const library = view.potionLibrary(state.customPotions ?? [], recipe);
    el('potion-library').hidden = !library;
    setContent(el('saved-potions'), library);
    setContent(el('potion-filters'), preview.filters);
    setContent(el('potion-progress'), view.potionProgress(recipe));
    if (el('workshop').dataset.renderer === 'fallback') setContent(el('glass-model'), view.glass(recipe, 'counter-cup'));
    el('glass').dataset.base = recipe.baseLiquor;
    setContent(el('meters'), view.meters(recipe, guest, now));
    const canServe = !ui.busy && guest && recipe.baseLiquor && allowed;
    station.draw(recipe, guest, canServe, ui.busy || draft.error || (!allowed ? '醉酒度已超过 80，这位客人只收无酒精饮品。' : ''), view, setContent);
  }
  function renderStageMedia(state) {
    ui.guestPhotos.clear();
    const tonight = state.drinks.filter(drink => !drink.archived && drink.night === state.night);
    for (const drink of tonight) {
      const media = state.media['tipsy-' + drink.id];
      const url = view.image(media?.url);
      if (url) ui.guestPhotos.set(drink.guestName, { drinkId: drink.id, url });
    }
    if (ui.previewDrinkId) renderPhotoDetails(state);
    const card = tonight.at(-1);
    const photo = card && state.media[card.id];
    const cardUrl = view.image(photo?.url);
    setContent(el('special-card'), cardUrl && !photo.stowed ?
      view.button('special', '<img src="'+view.esc(cardUrl)+'" alt=""><span>当前特调<strong>'+view.esc(photo.drinkName || '特调')+'</strong></span>',{id:card.id})+
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
  function renderPhotoDetails(state) {
    const drinkMedia = state.media[ui.previewDrinkId];
    const url = view.image(drinkMedia?.url);
    const drinkName = drinkMedia?.drinkName || '配套特调';
    setContent(el('cg-drink'), url ? view.button('drink-photo',
      `<img src="${view.esc(url)}" alt="" draggable="false"><canvas width="${drinkPaper.canvasWidth}" height="${drinkPaper.canvasHeight}" aria-hidden="true" hidden></canvas>`, {
        css: 'cg-drink-print', id: ui.previewDrinkId,
        attrs: `aria-label="查看${view.esc(drinkName)}大图" aria-haspopup="dialog" aria-controls="drink-preview"`,
      }) : '');
    const photo = view.image(state.media['tipsy-' + ui.previewDrinkId]?.url);
    setContent(el('cg-wall-action'), photo ? view.button('pin', state.wall.includes(ui.previewDrinkId) ? '已钉上纪念墙' : '钉上纪念墙', {
        id: ui.previewDrinkId, css: 'album-slip', disabled: state.wall.includes(ui.previewDrinkId),
      }) : '');
  }
  function drawDrinkThumbnail(img) {
    const canvas = img.nextElementSibling;
    const context = canvas.getContext('2d');
    if (!context) return;
    // Paint the rotated paper at a higher resolution before downsampling to the on-screen thumbnail.
    const { width: paperWidth, height: paperHeight, angle } = drinkPaper;
    const inset = 16, foot = 40;
    const width = paperWidth - 2 * inset, height = paperHeight - inset - foot;
    const cropScale = Math.min(img.naturalWidth / width, img.naturalHeight / height);
    const sourceWidth = width * cropScale, sourceHeight = height * cropScale;
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(angle * Math.PI / 180);
    context.fillStyle = getComputedStyle(canvas).getPropertyValue('--photo-paper').trim();
    context.fillRect(-paperWidth / 2, -paperHeight / 2, paperWidth, paperHeight);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(img, (img.naturalWidth - sourceWidth) / 2, (img.naturalHeight - sourceHeight) / 2,
      sourceWidth, sourceHeight, inset - paperWidth / 2, inset - paperHeight / 2, width, height);
    canvas.hidden = false;
    img.hidden = true;
  }
  function photoOrigin(img, print, { rotation, widthFactor = 1, heightFactor = 1 } = {}) {
    const source = print?.getBoundingClientRect();
    const photo = img.getBoundingClientRect();
    if (!source?.width || !source.height) return 'scale(.94)';
    const x = source.left + source.width / 2 - (photo.left + photo.width / 2);
    const y = source.top + source.height / 2 - (photo.top + photo.height / 2);
    const scale = Math.min(1, print.offsetWidth * widthFactor / photo.width, print.offsetHeight * heightFactor / photo.height);
    const angle = rotation ?? getComputedStyle(print).rotate;
    return `translate(${x}px, ${y}px) rotate(${angle === 'none' ? '0deg' : angle}) scale(${scale})`;
  }
  function menuPhotoButton(drinkId) {
    return el('overlay-panel').querySelector(`.tasting-print[data-id="${CSS.escape(drinkId)}"]`);
  }
  function guestPhotoOrigin(img) {
    const source = photoSeat ? photoSeat.querySelector('.seat-photo') : menuPhotoButton(ui.previewDrinkId);
    return photoOrigin(img, source);
  }
  function drinkPhotoOrigin(img) {
    return photoOrigin(img, el('cg-drink').querySelector('.cg-drink-print'), {
      rotation: drinkPaper.angle + 'deg',
      widthFactor: drinkPaper.width / drinkPaper.canvasWidth,
      heightFactor: drinkPaper.height / drinkPaper.canvasHeight,
    });
  }
  function animatePhoto(img, transform, opacity, ease) {
    const easing = getComputedStyle(img).getPropertyValue(ease).trim();
    return img.animate({ transform, opacity }, { duration: 300, easing, fill: 'both' });
  }
  function returnPhoto(img, origin) {
    const { transform, opacity } = getComputedStyle(img);
    for (const animation of img.getAnimations()) animation.cancel();
    return animatePhoto(img, [transform, origin(img)], [opacity, opacity, 0], '--depart');
  }
  function openGuestPhoto(guestName, trigger) {
    const photo = ui.guestPhotos.get(guestName);
    if (!photo || el('overlay').open) return;
    openTastingPhoto(photo, guestName, trigger.closest('.seat'));
  }
  function openMenuPhoto(drinkId) {
    const overlay = el('overlay');
    if (!['menu', 'wall'].includes(drawer) || !overlay.open || overlay.classList.contains('closing')) return;
    const state = current();
    const drink = state.drinks.find(item => item.id === drinkId);
    const url = view.image(state.media['tipsy-' + drinkId]?.url);
    if (!drink || !url) return;
    openTastingPhoto({ drinkId, url }, drink.guestName);
  }
  function openTastingPhoto(photo, name, seat = null) {
    const preview = el('cg-preview');
    if (preview.open || el('station').open) return;
    const frame = el('cg-frame');
    const img = new Image();
    img.alt = (name || '角色') + '饮下特调后的神态';
    img.draggable = false;
    img.hidden = true;
    img.onload = () => {
      if (!preview.open || preview.classList.contains('closing') || img.parentElement !== frame) return;
      preview.classList.remove('loading');
      img.hidden = false;
      photoSeat?.setAttribute('data-photo-open', '');
      if (!reducedMotion.matches) animatePhoto(img, [guestPhotoOrigin(img), 'none'], [.75, 1, 1], '--settle');
    };
    img.onerror = () => {
      if (!preview.open || img.parentElement !== frame) return;
      void closeGuestPhoto();
      notice('这张照片暂时无法打开。');
    };
    photoSeat = seat;
    ui.previewDrinkId = photo.drinkId;
    preview.classList.add('loading');
    frame.append(img);
    renderPhotoDetails(current());
    preview.showModal();
    img.src = photo.url;
    audio?.play('scene');
  }
  async function closeGuestPhoto() {
    const preview = el('cg-preview');
    if (!preview.open || preview.classList.contains('closing') || el('drink-preview').open) return;
    preview.classList.add('closing');
    audio?.play('close');
    const img = el('cg-frame').querySelector(':scope > img');
    let exitAnimation;
    if (img && !img.hidden && !reducedMotion.matches) {
      exitAnimation = returnPhoto(img, guestPhotoOrigin);
    } else {
      exitAnimation = preview.getAnimations().find(animation => animation.animationName === 'conceal');
    }
    await exitAnimation?.finished.catch(() => {});
    preview.close();
    preview.classList.remove('closing', 'loading');
    img?.remove();
    setContent(el('cg-drink'), '');
    photoSeat?.removeAttribute('data-photo-open');
    if (!photoSeat && ['menu', 'wall'].includes(drawer)) menuPhotoButton(ui.previewDrinkId)?.focus({ preventScroll: true });
    photoSeat = null;
    ui.previewDrinkId = '';
  }
  function openDrinkPhoto(drinkId) {
    const preview = el('drink-preview');
    const guestPreview = el('cg-preview');
    const media = current()?.media[drinkId];
    const url = view.image(media?.url);
    if (!url || preview.open || !guestPreview.open || guestPreview.classList.contains('closing')) return;
    const img = new Image();
    img.alt = (media.drinkName || '特调') + '成品照';
    img.draggable = false;
    img.hidden = true;
    img.onload = () => {
      if (!preview.open || preview.classList.contains('closing') || img.parentElement !== preview) return;
      img.hidden = false;
      el('cg-drink').classList.add('expanded');
      if (!reducedMotion.matches) animatePhoto(img, [drinkPhotoOrigin(img), 'none'], [1, 1], '--settle');
    };
    img.onerror = () => {
      if (!preview.open || img.parentElement !== preview) return;
      void closeDrinkPhoto();
      notice('这张酒照暂时无法打开。');
    };
    preview.append(img);
    preview.showModal();
    img.src = url;
    audio?.play('scene');
  }
  async function closeDrinkPhoto() {
    const preview = el('drink-preview');
    if (!preview.open || preview.classList.contains('closing')) return;
    preview.classList.add('closing');
    audio?.play('close');
    const img = preview.querySelector('img');
    if (img && !img.hidden && !reducedMotion.matches) {
      await returnPhoto(img, drinkPhotoOrigin).finished.catch(() => {});
    }
    el('cg-drink').classList.remove('expanded');
    preview.close();
    preview.classList.remove('closing');
    img?.remove();
    el('cg-drink').querySelector('.cg-drink-print')?.focus({ preventScroll: true });
  }
  function renderSeats(state) {
    const seats = el('seats'), html = view.seats(state,ui);
    if (seats.renderedHtml === html) return;
    seats.renderedHtml = html;
    const template = document.createElement('template');
    template.innerHTML = html;
    const old = new Map([...seats.children].map(node => [node.dataset.guest, node]));
    let position = seats.firstElementChild;
    for (const incoming of template.content.querySelectorAll('.seat')) {
      const node = old.get(incoming.dataset.guest) || incoming;
      old.delete(incoming.dataset.guest);
      if (node !== incoming) {
        node.className = incoming.className;
        const portrait = node.querySelector('.seat-scene > .portrait'), nextPortrait = incoming.querySelector('.seat-scene > .portrait');
        const image = nextPortrait.querySelector('img');
        const previous = portrait.querySelector('img:not(.previous-sprite)');
        if (previous?.getAttribute('src') !== image?.getAttribute('src')) {
          portrait.replaceWith(nextPortrait);
          const visible = portrait.querySelector('.previous-sprite') || previous;
          if (image && visible?.naturalWidth && !visible.hidden && !reducedMotion.matches) {
            const outgoing = visible.cloneNode();
            outgoing.className = 'previous-sprite';
            image.after(outgoing);
            image.decode().then(() => outgoing.isConnected && outgoing.animate([{opacity:1},{opacity:0}],
              {duration:300, easing:'ease-out', fill:'forwards'}).finished).then(() => outgoing.remove()).catch(() => {});
          }
        } else portrait.className = nextPortrait.className;
        for (const selector of ['.seat-photo', '.seat-spell', '.seat-hit', '.seat-label']) {
          const before = node.querySelector(selector), after = incoming.querySelector(selector);
          if (before.outerHTML === after.outerHTML) continue;
          const focused = before === document.activeElement;
          before.replaceWith(after);
          if (focused) (after.matches('button') ? after : node.querySelector('.seat-hit')).focus({ preventScroll: true });
        }
        const track = node.querySelector('.tipsy-track'), nextTrack = incoming.querySelector('.tipsy-track');
        track.setAttribute('aria-valuenow', nextTrack.getAttribute('aria-valuenow'));
        track.setAttribute('aria-valuetext', nextTrack.getAttribute('aria-valuetext'));
        track.firstElementChild.style.cssText = nextTrack.firstElementChild.style.cssText;
      }
      if (node !== position) seats.insertBefore(node, position);
      position = node.nextElementSibling;
    }
    for (const node of old.values()) node.remove();
  }
  function renderConversation(state, duration = 300) {
    const { cursors, index, cursor } = readingPage(state);
    const visible = { ...state, ...readingPosition, cursor };
    el('close-night').disabled = !!ui.busy || !view.hasReadOpening(visible);
    const listen = el('listen');
    listen.disabled = !!ui.busy;
    setContent(listen, view.esc(ui.busy || '继续闲聊') + (ui.busy ? '' : view.icon('advance')));
    renderSeats(visible);
    const dialogue = el('dialogue');
    const page = `${ui.sessionId}/${state.night}/${state.turn}/${cursor}`;
    const previousPage = dialogue.dataset.page;
    dialogue.dataset.page = page;
    setContent(dialogue, view.dialogue(visible, ui, index, cursors.length));
    if (page === previousPage) return;
    pageTurn?.cancel();
    if (reducedMotion.matches) return;
    pageTurn = dialogue.animate([
      { opacity: .2, transformOrigin: 'left center', transform: 'perspective(900px) translateX(14px) rotateY(-19deg)' },
      { opacity: 1, transformOrigin: 'left center', transform: 'none' },
    ], { duration, easing: 'cubic-bezier(.22,.72,.25,1)' });
  }
  function showPage(state, next, duration) {
    readingPosition = {
      cursor: next,
      openingRead: Boolean(readingPosition?.openingRead || view.hasReadOpening(state) || view.hasReadOpening(state, next)),
    };
    audio?.play('page');
    renderConversation(state, duration);
  }
  function readBy(delta) {
    const state = current();
    const { cursors, index } = readingPage(state);
    const next = cursors[index + delta];
    if (next === undefined) return;
    showPage(state, next);
    cursorWrite ??= (async () => {
      try {
        while (readingPosition.cursor !== current().cursor || (readingPosition.openingRead && !current().openingRead)) {
          const position = readingPosition;
          await commit(state => Object.assign(state, position));
        }
      } catch (error) {
        notice(error.message);
      } finally {
        readingPosition = undefined;
        cursorWrite = undefined;
        renderConversation(current());
      }
    })();
  }
  function syncSound() {
    const state = current();
    if (!state) return;
    const mixing = station.mode === 'mix';
    const enabled = (ui.soundPreview ?? state.settings?.sound) !== false;
    const speaker = el('bgm');
    speaker.disabled = false;
    speaker.setAttribute('aria-pressed', String(enabled));
    speaker.title = enabled ? '关闭背景音乐' : '开启背景音乐';
    speaker.querySelector('use').setAttribute('href', enabled ? '#ink-speaker' : '#ink-speaker-off');
    audio?.setMusicMuted?.(!enabled);
    audio?.setScene?.(mixing ? 'mix' : 'room', Boolean(drawer) || !mixing);
  }
  async function toggleMusic() {
    if (!save || ui.soundPreview !== undefined) return;
    const enabled = current().settings?.sound === false;
    ui.soundPreview = enabled;
    syncSound();
    try {
      await commit(state => { (state.settings ??= {}).sound = enabled; });
    } catch (error) {
      notice(error.message);
    } finally {
      ui.soundPreview = undefined;
      render();
    }
  }
  function render() {
    const state = current();
    for (const button of el('tavern').querySelectorAll('.bar-nav button')) button.disabled = !state;
    el('stations').hidden = !state;
    if (!state) {
      const status = ui.error ? `<p role="alert">${view.esc(ui.error)}</p>${view.button('retry', '重新连接', { css: 'primary' })}` :
        `<p role="status">${view.esc(ui.busy)}</p>`;
      setContent(el('dialogue'), `<div class="progress-status">${status}</div>`);
      return;
    }
    const minutes = (23 * 60 + 40 + state.turn * 4) % (24 * 60);
    el('clock').textContent = 'Night ' + state.night + ' · ' + String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
    el('stations').querySelector('[data-action="station"]').disabled = !!ui.busy || !state.guests.length;
    renderStageMedia(state);
    renderConversation(state);
    if (station.mode) renderMix(state);
    if (drawer) renderOverlay();
    syncSound();
  }
  function renderOverlay() {
    setContent(el('overlay-panel'), view.drawer(current(), ui, drawer));
  }
  async function refreshGuestRoster() {
    if (ui.guestRosterPending) return;
    ui.guestRosterPending = true;
    ui.guestRosterError = '';
    renderOverlay();
    try {
      const { guests } = await post('/char/roster');
      if (!Array.isArray(guests) || guests.some(guest => !guest?.name)) throw new Error('角色名单有误，请再试一次。');
      ui.guestRoster = guests;
    }
    catch (error) { ui.guestRosterError = error.message; }
    finally {
      ui.guestRosterPending = false;
      if (drawer === 'people') renderOverlay();
    }
  }
  function openDrawer(kind) {
    const overlay = el('overlay');
    const switching = overlay.open && drawer !== kind;
    clearTimeout(closeTimer);
    overlay.classList.remove('closing');
    if (!overlay.open) returnFocus = document.activeElement;
    drawer = kind;
    overlay.classList.toggle('is-drawer', kind !== 'report');
    renderOverlay();
    if (!overlay.open) overlay.showModal();
    if (switching && !reducedMotion.matches) {
      el('overlay-panel').animate([{opacity:.55, transform:'translateY(8px)'},{opacity:1, transform:'none'}],
        {duration:300, easing:'ease-out'});
    }
    audio?.play(kind === 'report' ? 'confirm' : 'scene');
    syncSound();
    overlay.querySelector('.close')?.focus();
    if (kind === 'people') void refreshGuestRoster();
  }
  function closeDrawer() {
    const overlay = el('overlay');
    if (!overlay.open || overlay.classList.contains('closing')) return;
    overlay.classList.add('closing');
    audio?.play('close');
    closeTimer = setTimeout(() => {
      overlay.close();
      overlay.classList.remove('closing');
      drawer = '';
      returnFocus?.focus({ preventScroll: true });
      syncSound();
    }, reducedMotion.matches ? 1 : 300);
  }

  const narrator = async (label, action) => {
    if (!save || ui.busy || leaving) return;
    ui.busy = label;
    render();
    try { await cursorWrite; await action(); }
    catch (error) { notice(error.message); }
    finally { ui.busy = ''; render(); }
  };
  function updateCounter(path, data, whilePending) {
    return serial(async () => {
      const base = save;
      try {
        const request = post(path, { editVersion: base.state.editVersion, ...data });
        adopt(await (whilePending ? whilePending(request) : request));
      } catch (error) {
        const latest = await sdk.save.load(base.sessionId).catch(() => null);
        if (latest?.revision > base.revision) adopt(latest);
        if (!data.drinkId || !current().drinks.some(drink => drink.id === data.drinkId)) throw error;
      }
    });
  }

  async function chat(playerLine = '', guestName, whilePending) {
    await updateCounter('/chat/turn', { playerLine, guestName }, whilePending);
    ui.reply = '';
  }

  async function showUnreadPages(state, unread) {
    const interval = 150;
    for (const cursor of unread) {
      showPage(state, cursor, interval);
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }

  function continueChat() {
    return narrator('等角色接话…', async () => {
      const state = current();
      const { cursors, index } = readingPage(state);
      const unread = cursors.slice(index + 1);
      if (!unread.length) {
        audio?.play('page');
        return chat();
      }
      try {
        await chat('', undefined, async request => {
          const [reply, pages] = await Promise.allSettled([request, showUnreadPages(state, unread)]);
          if (reply.status === 'rejected') throw reply.reason;
          if (pages.status === 'rejected') throw pages.reason;
          return reply.value;
        });
      } catch (error) {
        const position = readingPosition;
        if (position && current().editVersion === state.editVersion) {
          await commit(draft => Object.assign(draft, position));
        }
        throw error;
      } finally {
        readingPosition = undefined;
      }
    });
  }

  function chooseGuest(guestName) {
    if (!current().guests.some(guest => guest.name === guestName)) return;
    ui.target = guestName;
    render();
  }

  function focusStation() {
    const state = current();
    if (!state || station.mode) return;
    const guest = view.featuredGuest(state, ui.target, readingPage(state).cursor);
    if (!guest) return;
    ui.target = guest.name;
    station.open(() => recipe, render);
  }

  async function pour() {
    const state = current();
    const guestName = ui.target;
    const guest = state.guests.find(guest => guest.name === guestName);
    const poured = { ...recipe, potions: [...recipe.potions] };
    if (!poured.baseLiquor || !guest || !mix.canServeDrink(state.tipsy[guestName] || 0, poured)) return;
    const key = JSON.stringify([state.night, guestName, poured]);
    if (drinkAttempt?.key !== key) drinkAttempt = { key, id: id() };
    const drinkId = drinkAttempt.id;
    const settlement = updateCounter('/drink/serve', { drinkId, guestName, recipe: poured });
    // Report even an immediate failure at the counter, after the delivery animation.
    void settlement.catch(() => {});
    await station.serve().catch(() => {});
    await station.close();
    ui.busy = `等${guest.name}尝一口…`;
    render();
    el('dialogue').focus({ preventScroll: true });
    try {
      await settlement;
    } catch (error) {
      potionDraft().error = error.message;
      station.open(() => recipe, render);
      throw error;
    }
    station.reset();
    recipe = mix.empty();
    drinkAttempt = null;
  }
  async function resumeProgress() {
    adopt(await sdk.ext.request('/progress/open', { method: 'POST' }));
    resetCounter();
    if (current().guests.some(guest => !guest.local)) {
      const refreshed = await post('/char/expressions');
      if (!Array.isArray(refreshed?.guests) || refreshed.guests.length !== current().guests.length ||
        refreshed.guests.some((g, i) => g?.name !== current().guests[i].name || !Array.isArray(g.expressions))) {
        throw new Error('角色表情数据有误，请再试一次。');
      }
      if (refreshed.guests.some((g,i)=>JSON.stringify(g.expressions)!==JSON.stringify(current().guests[i]?.expressions))) {
        await commit(state => { for (const { name, expressions } of refreshed.guests) {
          const guest = state.guests.find(row => row.name === name);
          if (guest) { guest.expressions = expressions; state.people[name].expressions = expressions; }
        } });
      }
    }
  }
  function resetCounter() {
    const state = current();
    ui.target = state.guests[0]?.name || '';
    drinkAttempt = null;
    ui.reply = '';
    recipe = mix.empty();
    station.reset();
  }
  async function advanceNight() {
    if (ui.busy || leaving) return;
    const counter = el('tavern'), mask = el('night-transition');
    const afterMotion = element => Promise.allSettled(element.getAnimations().map(animation => animation.finished));
    const night = current().night;
    let missedReservation = false;
    let errorMessage;
    ui.busy = '收拾吧台…';
    counter.inert = true;
    el('night-status').textContent = '正在准备下一夜';
    mask.hidden = false;
    try {
      await Promise.all([cursorWrite, afterMotion(mask)]);
      await serial(async () => {
        const previous = save;
        const { editVersion, reservedGuestName } = previous.state;
        try {
          adopt(await post('/night/advance', { editVersion }));
        } catch (error) {
          const latest = await sdk.save.load(previous.sessionId).catch(() => null);
          if (latest?.revision > previous.revision && latest.state.editVersion !== editVersion) adopt(latest);
          if (current().night === previous.state.night) throw error;
        }
        missedReservation = reservedGuestName && !current().guests.some(guest => guest.name === reservedGuestName);
      });
      resetCounter();
      document.scrollingElement.scrollTop = 0;
    } catch (error) {
      errorMessage = error.message;
    } finally {
      ui.busy = '';
      render();
      if (current().night !== night) {
        mask.classList.add('reopening');
        el('night-status').textContent = '营业中';
        await afterMotion(mask.querySelector('.night-sign'));
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      mask.classList.add('closing');
      await afterMotion(mask);
      mask.hidden = true;
      mask.classList.remove('closing', 'reopening');
      counter.inert = false;
      const focus = current().night === night ? el('close-night') : el('listen');
      focus?.focus({ preventScroll: true });
    }
    if (errorMessage) notice(errorMessage);
    else if (missedReservation) notice('留座的来客今晚没能到场。');
  }
  async function start() {
    try {
      if (!sdk) throw new Error('请从邻舍游戏馆打开酒馆。');
      await sdk.ready;
      sdk.on('tavern-media', ({ sessionId }) => { void syncMedia(sessionId).catch(() => {}); });
      ui.busy = '准备吧台…';
      render();
      await resumeProgress();
    } catch (error) { save = undefined; ui.error = error.message; }
    finally {
      ui.busy = '';
      render();
      if (save) audio?.open();
    }
  }
  async function exit() {
    if (leaving || ui.busy || !sdk) return;
    leaving = true;
    try { clearTimeout(mediaTimer); await cursorWrite; await writes; await sdk.ui.exit(); station.dispose(); audio?.close(); }
    catch (error) { leaving = false; notice(error.message); }
  }

  async function selectIngredient(action, key) {
    if (action === 'base' && recipe.baseLiquor === key) return;
    if (action === 'base') { recipe.baseLiquor = key; recipe.mixedDrops = 0; }
    if (action === 'potions-clear') { recipe.potions = []; recipe.mixedDrops = 0; }
    const dose = action === 'potion' ? mix.dose(key) : null;
    if (action === 'potion') {
      if (!dose) return;
      if (recipe.potions.length >= mix.maxDrops) { notice('最多三滴。点「清空魔药」可以重新配比。'); return; }
      recipe.potions.push(key);
    }
    if (action === 'garnish') recipe.garnish = recipe.garnish === key ? '' : key;
    renderMix();
    if (dose) {
      if (!reducedMotion.matches) view.animatePotionDials(el('meters'), dose);
      const { effectId, tipsyDelta, modifiesTipsy } = mix.recipeEffects(recipe);
      const effects = [mix.drinkEffects[effectId].label, modifiesTipsy && mix.tipsyEffectLabel(tipsyDelta)].filter(Boolean);
      el('dose-feedback').textContent = `${effects.join('、')}，已用 ${recipe.potions.length} 滴。`;
    } else if (action === 'potions-clear') {
      el('dose-feedback').textContent = '魔药已清空。';
    }
    if (dose && el('workshop').dataset.renderer === 'fallback' && !reducedMotion.matches) {
      const effects = el('glass-effects');
      effects.insertAdjacentHTML('beforeend', view.potionEffect(recipe, dose.color));
      const impact = effects.lastElementChild;
      setTimeout(() => impact.remove(), 880);
    }
    await station.ingredient(action,recipe);
  }
  const actions = {
    retry: () => location.reload(),
    drawer: openDrawer,
    close: closeDrawer,
    'guest-roster': refreshGuestRoster,
    reserve: guestName => narrator('安排留座…', () => commit(state => {
      if (state.reservedGuestName === guestName) delete state.reservedGuestName;
      else if (ui.guestRoster?.some(guest => guest.name === guestName)) state.reservedGuestName = guestName;
    })),
    exit,
    bgm: toggleMusic,
    guest: chooseGuest,
    station: focusStation,
    'station-close': async () => { await station.close(); syncSound(); },
    recipient: guestName => { ui.target = guestName; renderMix(); },
    step: value => { station.setStep(Number(value)); renderMix(); },
    'step-next': () => station.next(renderMix),
    ice: key => { station.setIce(recipe,Number(key)); renderMix(); },
    stir: () => station.stir(recipe,renderMix),
    'guest-photo': openGuestPhoto,
    'media-retry': async key => {
      try {
        await post('/media/retry', { key });
        await syncMedia(ui.sessionId);
      } catch (error) { notice(error.message); }
    },
    'menu-photo': openMenuPhoto,
    'photo-close': closeGuestPhoto,
    special: drinkId => { ui.cardId=drinkId; openDrawer('special'); },
    'drink-photo': openDrinkPhoto,
    stow: drinkId => narrator('收进酒单…',()=>commit(state=>{state.media[drinkId].stowed=true;})),
    previous: () => readBy(-1),
    next: () => readBy(1),
    listen: continueChat,
    reply: text => {
      const state = current();
      if (!state || ui.busy || leaving) return;
      const guest = view.replyGuest(state, readingPage(state).cursor);
      const line = text.trim();
      if (!guest || !line) return;
      audio?.play('page');
      return narrator(`等${guest.name}回应…`, () => chat(line, guest.name));
    },
    speak: () => { if (ui.reply.trim()) actions.reply(ui.reply); },
    base: key => station.act(() => selectIngredient('base', key),renderMix),
    'edit-potion': () => {
      const draft=potionDraft();draft.open=!draft.open;renderMix();
      if(draft.open) el('potion-name').focus();
    },
    'blend-potion': blendPotion,
    'saved-potion': addSavedPotion,
    'remove-potion': removeSavedPotion,
    potion: key => station.act(() => selectIngredient('potion', key),renderMix),
    'clear-potions': () => station.act(() => selectIngredient('potions-clear'),renderMix),
    garnish: key => station.act(() => selectIngredient('garnish', key),renderMix),
    pour: () => narrator('递酒中…', pour),
    'show-report': questId => { ui.reportId = questId; openDrawer('report'); },
    'next-night': advanceNight,
    pin: drinkId => narrator('钉上纪念墙…', async () => {
      await commit(state => { if (view.image(state.media['tipsy-' + drinkId]?.url) && !state.wall.includes(drinkId)) state.wall.push(drinkId); });
      notice('拍立得已钉在纪念墙。');
    }),
  };
  const ownSound = new Set(['drawer', 'close', 'show-report', 'special', 'station', 'station-close',
    'guest-photo', 'menu-photo', 'photo-close', 'drink-photo', 'step', 'step-next', 'previous', 'next', 'listen', 'reply', 'speak']);
  const confirmActions = new Set(['pin', 'stow', 'next-night']);
  const availableWhileMixing = new Set(['step', 'step-next', 'station-close']);
  document.addEventListener('click', event => { if (event.isTrusted) audio?.open(); }, true);
  document.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const { action, id: key } = button.dataset;
    if (ui.busy && !['bgm', 'close', 'drawer', 'show-report', 'guest-photo', 'menu-photo', 'photo-close', 'drink-photo', 'special'].includes(action)) return;
    if (station.locked && !availableWhileMixing.has(action)) return;
    if (!ownSound.has(action)) audio?.play(confirmActions.has(action) ? 'confirm' : 'click');
    actions[action]?.(key, button);
  });
  document.addEventListener('keydown', event => {
    if (event.isTrusted && !event.repeat && !event.isComposing) audio?.open();
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
  });
  el('potion-name').addEventListener('compositionend',editPotionName);
  el('cg-drink').addEventListener('load', event => {
    if (event.target instanceof HTMLImageElement) drawDrinkThumbnail(event.target);
  }, true);
  el('cg-preview').addEventListener('cancel', event => { event.preventDefault(); closeGuestPhoto(); });
  el('cg-preview').addEventListener('click', event => {
    if (!event.target.closest('img,button')) closeGuestPhoto();
  });
  el('drink-preview').addEventListener('cancel', event => { event.preventDefault(); void closeDrinkPhoto(); });
  el('drink-preview').addEventListener('click', event => {
    if (event.target === event.currentTarget) void closeDrinkPhoto();
  });
  el('station').addEventListener('cancel',event=>{event.preventDefault();if(!ui.busy)void actions['station-close']();});
  el('overlay').addEventListener('cancel', event => { event.preventDefault(); closeDrawer(); });
  el('overlay').addEventListener('click', event => { if (event.target === el('overlay')) closeDrawer(); });
  document.addEventListener('error', event => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    const seat = img.closest('[data-guest]');
    if (seat && img.matches('.portrait img:not(.previous-sprite)')) {
      const guest = current().guests.find(person => person.name === seat.dataset.guest);
      if (guest) {
        const tried = img.failedSources || (img.failedSources = new Set());
        tried.add(img.getAttribute('src'));
        const candidates = [...(guest.expressions || []).map(slot => slot.url), guest.portrait, guest.avatar];
        const next = candidates.map(view.image).find(src => src && !tried.has(src));
        if (next) { img.src = next; return; }
      }
    }
    if (img.matches('.cg-drink img')) img.closest('button').hidden = true;
    if (img.matches('.portrait img, .seat-photo img, .tasting-print img, .stage-art, img[data-prop]')) img.hidden = true;
  }, true);
  document.querySelectorAll('.stage-art').forEach(image => {
    if (image.complete && !image.naturalWidth) image.hidden = true;
  });
  render();
  void start();
})();
