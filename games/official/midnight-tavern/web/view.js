(() => {
  'use strict';
  const mix = window.TavernMix;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const image = value => /^\/(?:images|avatars|game-media)\/[\w./%?=&-]+$|^\.\/(?:lin|chen|su)\.svg$/.test(value || '') && !value.includes('..') ? value : '';
  const tipsyLabel = n => mix.intoxication(n).label;
  const resultNames = { triumph: '漂亮收场', chaotic: '一夜闹剧', twist: '意外转折' };
  const trinketIcons = new Set(['key', 'star', 'moon', 'ticket', 'leaf', 'compass']);
  const icon = name => `<svg class="ink-icon" aria-hidden="true" focusable="false"><use href="#ink-${name}"/></svg>`;
  const button = (action, label, { id = '', css = '', disabled = false, attrs = '' } = {}) =>
    `<button type="button" data-action="${action}" data-id="${esc(id)}" class="${css}" ${disabled ? 'disabled' : ''} ${attrs}>${label}</button>`;
  const bottles = {
    gin_vodka: ['bottle-spirit', 'M28 11h12v14l8 9v32H20V34l8-9Z'],
    whiskey_rum: ['bottle-aged', 'M27 20h14v13l11 8v24H16V41l11-8Z'],
    liqueur_sparkling: ['bottle-sweet', 'M28 12h12v16q-6 7 0 17 11 8 9 21H19q-2-13 9-21 6-10 0-17Z'],
    coffee_tea: ['bottle-nonalcohol', 'M24 36h20q10 9 10 22t-20 9q-20 0-20-9 0-6 2-10L6 37l13 5Zm30 7q15-7 13 6t-13 10'],
  };
  const propsPath = './assets/props/';
  function prop(name, fallback, tint = '') {
    return `<span class="prop-art" aria-hidden="true"><img src="${propsPath}${name}.png" alt="" draggable="false" data-prop ${tint ? `style="filter:url(#tint-${tint})"` : ''}><svg viewBox="0 0 68 76" focusable="false">${fallback}</svg></span>`;
  }
  // Custom expression packs supply their own names. Prefer an actual matching slot, then a related mood.
  const moodFamilies = [/笑|喜|乐|开心|高兴|愉悦|得意|happy|smile/i, /惊|讶|意外|surpris/i, /羞|脸红|微醺|害臊|shy|blush/i,
    /思|惑|疑|好奇|沉吟|困扰|think|curious/i, /生气|怒|愤|不满|angry/i, /伤心|悲|难过|失落|sad/i, /困倦|疲|醉|迷离|sleep/i];
  function matchSprite(sprites, mood) {
    const normalized = String(mood || '').trim().toLowerCase();
    if (!normalized) return;
    const family = moodFamilies.find(group => group.test(normalized));
    return sprites.find(slot => slot.name?.toLowerCase() === normalized || slot.id === normalized) ||
      sprites.find(slot => slot.name && (normalized.includes(slot.name.toLowerCase()) || slot.name.toLowerCase().includes(normalized))) ||
      sprites.find(slot => family?.test(slot.name));
  }
  function avatar(guest, large = false, mood = '', standing = '', standingKey = '') {
    const sprites = (guest.expressions || []).filter(slot => image(slot.url));
    const expression = matchSprite(sprites, mood);
    const sprite = (expression || sprites.find(slot => slot.id === 'normal') || sprites[0])?.url;
    const usual = image(large ? sprite || guest.portrait || guest.avatar : guest.avatar || sprite || guest.portrait);
    const defaultStanding = standing && (!expression || expression.id === 'normal') ? standing : '';
    const url = defaultStanding || usual;
    const single = esc([...guest.name][0]);
    const style = large && (defaultStanding || sprite ? 'portrait-expression' : !image(guest.portrait) ? 'portrait-avatar' :
      usual.startsWith('./') ? 'portrait-illustrated' : '');
    return `<span class="portrait${style ? ' ' + style : ''}" aria-hidden="true">${url ? `<img src="${esc(url)}" alt="" draggable="false"${defaultStanding ? ` data-standing-key="${esc(standingKey)}"` : ''}>` : ''}<span>${single}</span></span>`;
  }
  const potionShapes = {
    relax: '<path d="M9 58c13-2 17-17 27-21 13-5 18 9 8 14-9 5-17-7-7-18 12-14 26-7 36-15m-36 19c10-10 25-9 39 1m-35 0c-8 10-3 22 3 26"/>',
    awaken: '<ellipse cx="49" cy="37" rx="13" ry="7"/><ellipse cx="49" cy="37" rx="26" ry="13"/><path d="M10 38C10 14 88 14 88 38S10 62 10 38Z"/>',
    warmth: '<path d="m30 41 4-13 3 10 10 2-9 5-1 11-6-8-9-3Zm29-23 1-11 4 8 9 1-8 5-2 9-4-6-8-1ZM69 53l6-8 2 9 8 4-9 2-3 8-3-8-8-3Z" fill="currentColor"/>',
    reminisce: '<path d="m49 7 28 18v28L49 68 21 53V25Zm0 0v22m28-4-28 11-28-11m28 11v32m-16-25 7-7m21 14 6-5"/><circle cx="49" cy="36" r="6" fill="currentColor"/>',
    soothe: '<path d="M49 8v56M24 22l50 28m0-28L24 50m16-35 9 8 9-8m-18 42 9-8 9 8M25 31l12-2-3-11m40 13-12-2 3-11M25 41l12 2-3 11m40-13-12 2 3 11"/>',
  };
  function potionSign(line, cursor) {
    const effect = line?.drinkEffect;
    const shape = Object.hasOwn(potionShapes, effect) ? potionShapes[effect] : '';
    return `<span class="seat-spell" aria-hidden="true">${shape ?
      `<svg viewBox="0 0 98 73" data-effect="${effect}" data-line="${cursor}" focusable="false">${shape}</svg>` : ''}</span>`;
  }
  function featuredGuest(state, targetName, cursor = state.cursor) {
    const line = state.history[cursor];
    const speaker = line?.role === 'assistant' ? line.speaker : undefined;
    return state.guests.find(guest => guest.name === speaker) ||
      state.guests.find(guest => guest.name === targetName) || state.guests[0];
  }
  function seats(state, ui) {
    const line = state.history[state.cursor];
    const latest = state.cursor === state.history.length - 1;
    const featured = featuredGuest(state, ui.target);
    return state.guests.map(guest => {
      const now = state.tipsy[guest.name] || 0;
      const status = tipsyLabel(now);
      const talking = line?.role === 'assistant' && line.speaker === guest.name;
      const picked = ui.target === guest.name;
      const spoken = talking ? line : state.history.slice(0, state.cursor + 1).findLast(item => item.role === 'assistant' && item.speaker === guest.name);
      const degree = mix.intoxication(latest ? now : spoken?.tipsy ?? now);
      const standingKey = latest && Object.hasOwn(state.standingByGuest, guest.name) ? state.standingByGuest[guest.name] : spoken?.standing;
      const entry = state.media?.[standingKey];
      const trial = ui.standingTrial && ui.standingTrial.key === standingKey && entry?.redraw?.token === ui.standingTrial.token;
      const standing = entry?.kind === 'standing' && entry.status === 'ready' ? image(trial ? entry.redraw.url : entry.url) : '';
      const recordedMood = spoken?.mood || '';
      const useDialogueExpression = talking && line.explicitMood && !(latest && line.potionReaction);
      const mood = standing ? (useDialogueExpression ? recordedMood : '') : recordedMood || degree.mood;
      const css = ['seat', guest === featured && 'is-featured', talking && 'is-speaking', picked && 'is-selected',
        !standing && degree.id !== 'sober' && 'is-tipsy'].filter(Boolean).join(' ');
      const photo = ui.guestPhotos.get(guest.name);
      const select = { id: guest.name, attrs: `aria-label="选中${esc(guest.name)}接酒，${status}，醉酒度 ${now}/100" aria-pressed="${picked}"` };
      const hit = photo ? button('guest-photo', '', {
        id: guest.name, css: 'seat-hit', attrs: `aria-label="查看${esc(guest.name)}的照片" aria-haspopup="dialog" aria-controls="cg-preview"`,
      }) : button('guest', '', { ...select, css: 'seat-hit', attrs: select.attrs + ' tabindex="-1"' });
      const print = photo ? `<span class="seat-photo" aria-hidden="true"><span class="seat-photo-image">
        <img src="${esc(photo.url)}" alt="" decoding="async" draggable="false">${icon('wall')}
      </span></span>` : '<span class="seat-photo" hidden></span>';
      const label = `<strong>${esc(guest.name)}</strong><span class="seat-status"><span>${status}</span><span class="seat-value">${now}<small>/100</small></span></span>`;
      return `<div class="${css}" data-guest="${esc(guest.name)}"><div class="seat-scene">${avatar(guest, true, mood, standing, standingKey)}${print}${potionSign(talking ? line : null, state.cursor)}${hit}</div>
        <div class="seat-plaque">
          ${button('guest', label, { ...select, css: 'seat-label' })}
          <span class="tipsy-track" role="meter" aria-label="${esc(guest.name)}的醉酒度" aria-valuenow="${now}" aria-valuetext="${status}，${now}/100" aria-valuemin="0" aria-valuemax="100"><i style="--amount:${now / 100}"></i></span>
        </div>
      </div>`;
    }).join('');
  }

  const hasReadOpening = (state, cursor = state.cursor) => state.openingRead === true ||
    (state.turn === 0 && state.history.length > 0 && cursor >= state.history.length - 1);

  function replyGuest(state, cursor = state.cursor) {
    const line = state.history[cursor];
    const reply = line?.role === 'user' ? state.history[cursor + 1] : line;
    return reply?.role === 'assistant' ? state.guests.find(guest => guest.name === reply.speaker) : undefined;
  }

  function reactionLabel(reaction) {
    if (!reaction) return '';
    const { effectId, speech, before, after } = reaction;
    const legacy = { relax: '说真心话', awaken: '笑出声', reminisce: '讲一段往事' };
    const talk = Object.hasOwn(mix.drinkEffects, effectId) ? mix.drinkEffects[effectId].label :
      Object.hasOwn(legacy, speech) ? legacy[speech] : '';
    const tipsy = Number.isInteger(before) && Number.isInteger(after) ? `醉酒度 ${before} → ${after}` : '';
    return [talk, tipsy].filter(Boolean).join(' · ');
  }

  function dialogue(state, ui, pageIndex, pageCount) {
    const line = state.history[state.cursor];
    const previous = state.history[state.cursor - 1];
    const bossLine = line?.role === 'assistant' && previous?.role === 'user' ? previous.text : '';
    const potion = reactionLabel(line?.potionReaction);
    const guest = replyGuest(state);
    const quickReplies = line?.role === 'assistant' ? line.quickReplies : undefined;
    const address = guest ? esc(`向${guest.name}搭话`) : '搭话';
    const speaker = line?.role === 'assistant' ? line.speaker : undefined;
    const currentStanding = speaker && Object.hasOwn(state.standingByGuest, speaker) ? state.standingByGuest[speaker] : undefined;
    const drawing = [currentStanding, line?.standing].some(key =>
      state.media[key]?.status === 'pending' || state.media[key]?.redraw?.status === 'pending');
    const developing = state.drinks.some(drink => drink.night === state.night && drink.guestName === speaker &&
      [state.media[drink.id], state.media['tipsy-' + drink.id]].some(entry => entry?.status === 'pending' && entry.illustrations));
    const status = [drawing && '正在绘制立绘', developing && '正在显影照片'].filter(Boolean);
    return `<div class="speech-head"><div class="speech-speaker">
      <strong>${esc(line?.speaker || '吧台')}</strong>
      ${status.length ? `<span class="speech-media" role="status">${status.join(' · ')}</span>` : ''}
      </div>
      <div class="speech-progress">${button('previous', icon('prev') + '上一句', { css: 'arrow', disabled: pageIndex === 0 || !!ui.busy })}
        <span>${pageIndex + 1}/${pageCount}</span>
        ${button('next', '下一句' + icon('next'), { css: 'arrow', disabled: pageIndex + 1 >= pageCount || !!ui.busy })}</div></div>
      <div class="speech-reading">
        <div class="speech-line">
          ${potion ? `<span class="speech-potion">${esc(potion)}</span>` : ''}
          ${bossLine ? `<span class="speech-boss">——「${esc(bossLine)}」</span>` : ''}
          ${line?.action ? `<span class="speech-action">${esc(line.action)}</span>` : ''}
          <span class="speech-copy">${esc(line?.text)}</span>
        </div>
      </div>
      <div class="speech-controls">
        ${guest && quickReplies?.length ? `<div class="quick-replies">${quickReplies.map(reply => button('reply', esc(reply), { id: reply, css: 'reply-ticket', disabled: !!ui.busy })).join('')}</div>` : ''}
        <div class="reply-form" id="reply-form"><input name="line" aria-label="${address}" placeholder="${address}…" maxlength="160" autocomplete="off" value="${esc(ui.reply)}" ${guest ? '' : 'disabled'}>
        ${button('speak', '搭话' + icon('enter'), { disabled: !!ui.busy || !guest })}</div>
      </div>`;
  }

  const glasses = {
    gin_vodka: {
      vessel: 'M34 48H166L104 116V154Q105 160 132 162Q140 169 128 170H71Q61 169 68 162Q94 160 96 154V116Z',
      bowl: 'M34 48H166L100 121Z', rim: 'M34 48Q100 41 166 48Q101 58 34 48',
      detail: 'M46 54l46 51m61-51-28 31m-23 35v35m-27 11h45', surface: 66, radius: 50, depth: 119, ornament: [139, 59],
    },
    whiskey_rum: {
      vessel: 'M48 51H152L144 148Q143 157 132 160H68Q57 157 56 148Z',
      bowl: 'M49 51H151L143 145Q140 151 130 151H70Q60 151 57 145Z',
      rim: 'M48 51Q100 41 152 51Q101 62 48 51',
      detail: 'M60 72l8 76 8-35 12 37 12-29 11 29 13-37 8 35 8-76m-82 75q42 10 84 0',
      surface: 76, radius: 49, depth: 151, ornament: [140, 68],
    },
    liqueur_sparkling: {
      vessel: 'M70 38H130C131 61 153 87 136 109Q127 123 104 127V154Q105 161 131 163V170H69V163Q95 161 96 154V127Q73 123 64 109C47 87 69 61 70 38Z',
      bowl: 'M70 38H130C131 61 153 87 136 109Q124 126 100 128Q76 126 64 109C47 87 69 61 70 38Z',
      rim: 'M70 38Q100 31 130 38Q100 45 70 38',
      detail: 'M75 48Q60 87 70 104l6 7m49-64 12 39m-34 41v28m-27 11h47',
      surface: 62, radius: 39, depth: 128, ornament: [127, 55],
    },
    coffee_tea: {
      vessel: 'M62 34H138L135 151Q135 160 127 161Q100 166 73 161Q65 160 65 151Z',
      bowl: 'M64 34H136L133 149Q100 156 67 149Z',
      rim: 'M62 34C62 24 138 24 138 34S62 44 62 34Z',
      detail: 'M68 45l2 92m62-92-1 43m-61 64q30 8 60 0m-58 5q28 6 56 0',
      surface: 66, radius: 36, depth: 154, ornament: [132, 39],
    },
  };
  const vesselFor = recipe => glasses[recipe.baseLiquor] || glasses.gin_vodka;
  const garnishIcons = {
    rosemary: '<path d="m6 28 17-24m-12 17-4-7m7 3-2-9m6 5V6m-8 16 9-2m-6-3 10-3m-5-3 8-4" fill="none" stroke="#a9c590" stroke-width="2.2" stroke-linecap="round"/>',
    popping_candy: '<path fill="#db94bc" stroke="#f5cde2" d="m3 14 7-5 5 7-5 6Zm14 5 5-3 5 5-4 6Z"/><path d="m21 3 1 4 4 1-4 2-1 4-2-4-3-2 4-1Z" fill="#f5d2ae"/>',
    chili: '<path d="M5 24q10 2 13-13 1-4 6-2t3 7Q21 29 5 26Z" fill="#c6624c" stroke="#f5a579"/><path d="M19 10q3-3 7 2l-1-4q-3-3 1-6" fill="none" stroke="#9bae76" stroke-width="2"/>',
    butterfly_pea: '<path d="M16 21Q1 18 4 10q2-4 8 1-2-10 5-9 6 0 4 9 8-6 9 1t-14 9Z" fill="#888cc8" stroke="#c6c3eb"/><path d="m11 13 5 8 6-8m-6 8-3 8" stroke="#d2d2b4" fill="none" stroke-width="1.6"/>',
    gold_leaf: '<path d="m3 16 8-10 8 5-5 12Zm15 3 6-6 5 5-4 7ZM13 4l3-2 2 4Z" fill="#e7b957" stroke="#ffe59b"/><path d="m11 7-1 10 4 5" fill="none" stroke="#ab803b"/>',
    lime_wheel: '<circle cx="16" cy="16" r="14" fill="#70a343"/><circle cx="16" cy="16" r="12" fill="#bad961" stroke="#eff1aa"/><path d="M16 4v24M4 16h24M7.5 7.5l17 17m0-17-17 17" stroke="#eff1aa"/>',
    cocktail_cherry: '<path d="m4 27 22-22" stroke="#e6b978" stroke-width="1.5"/><circle cx="15" cy="20" r="9" fill="#a9274b"/><path d="M15 13q0-8 7-11" fill="none" stroke="#97a25a" stroke-width="2"/><path d="M9 19q1-3 3-3" stroke="#ffb2bb" stroke-width="2" fill="none"/>',
    mint_sprig: '<path d="M16 29Q15 16 20 4" fill="none" stroke="#aac576" stroke-width="2"/><path d="M16 22Q3 24 3 11q12-1 13 11m1-6Q18 4 30 6q-2 12-13 10m2-7Q12 9 13 1q8 2 6 8" fill="#70ab75"/><path d="m5 13 11 9m2-7 9-7" stroke="#b9d89a" fill="none"/>',
    cinnamon_stick: '<path d="m6 25 15-21q3-3 7 1l-15 23q-4 4-7-3Z" fill="#b57747"/><path d="m10 23 13-18m-9 18L27 6" stroke="#834629"/><ellipse cx="10" cy="26" rx="4" ry="3" fill="#dba06d"/><path d="M7 26q2-4 5-1t-3 2q-2-1 1-2" fill="none" stroke="#844c31"/>',
    starfruit: '<path d="m16 2 4 10 11 1-8 7 2 11-9-6-10 6 3-11-8-7 11-1Z" fill="#e9c953" stroke="#b2a349" stroke-linejoin="round"/><path d="m13 17 1-2m4 3 1 2" stroke="#a67a3e" stroke-width="1.6" stroke-linecap="round"/>',
  };
  function garnishIcon(item, x = 0, y = 0, size = 24) {
    return `<svg aria-hidden="true" x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 32 32">${garnishIcons[item.id]}</svg>`;
  }
  function wave(shape, depth) {
    const left = 100 - shape.radius, width = shape.radius * 2;
    return `M${left - 10} ${depth}q${width / 4} -7 ${width / 2 + 10} 0t${width / 2 + 10} 0`;
  }
  function glass(recipe, id) {
    const shape = vesselFor(recipe);
    const {layers,iceCount}=window.TavernAppearance.cocktailLook(recipe);
    const garnish = mix.get(mix.garnishes, recipe.garnish);
    const full = Boolean(recipe.baseLiquor || recipe.potions.length);
    const volume=layers.reduce((sum,layer)=>sum+layer.volume,0);
    let offset=0;
    const fills=layers.map(layer=>{
      const from=offset;offset+=layer.volume/volume;
      return [from,offset].map(stop=>`<stop offset="${stop}" stop-color="${layer.color}" stop-opacity=".85"/>`).join('');
    }).join('');
    const ice=Array.from({length:iceCount},(_,i)=>{
      const x=100+[-.37,.22,.52,-.64,-.04][i]*shape.radius, y=shape.surface+[0,3,1,4,-3][i];
      return `<g transform="translate(${x} ${y}) rotate(${13*i-20})"><path d="M-8-4l4-5 11 1 3 5-3 11-11 1-5-4Z" fill="#c8edfa" fill-opacity=".49" stroke="#e5f9ff" stroke-width=".9"/><path d="M-8-4l7 3 8-7M-1-1l-2 9" stroke="#f3fcff" fill="none" opacity=".67"/></g>`;
    }).join('');
    const liquid = full ? `<g clip-path="url(#${id}-clip)"><g class="cup-contents" data-rise="${shape.depth - shape.surface + 12}">
      <path class="liquid-color" fill="url(#${id}-liquid)" d="${wave(shape, shape.surface)}V${shape.depth + 4}H10Z"/>
      ${ice}
      <path class="liquid-glint" fill="none" stroke="#fff0ca" stroke-opacity=".74" d="${wave(shape, shape.surface)}"/>
      ${[76, 91, 108, 124].map((x, i) => `<circle class="bubble" cx="${x}" cy="${Math.min(shape.depth - 6, shape.surface + 18 + i * 7)}" r="${1.6 + (i % 2)}" style="--delay:${-i * .52}s"/>`).join('')}</g></g>` : '';
    return `<svg class="glass-art" viewBox="0 0 200 180" aria-hidden="true">
      <defs><linearGradient id="${id}-glass"><stop stop-color="#fff4d3" stop-opacity=".32"/><stop offset=".35" stop-color="#fff8ed" stop-opacity=".05"/><stop offset=".66" stop-color="#f0c396" stop-opacity=".12"/><stop offset="1" stop-color="#d89c79" stop-opacity=".37"/></linearGradient>
      <linearGradient id="${id}-liquid" x1="0" y1="1" x2="0" y2="0">${fills}</linearGradient>
      <clipPath id="${id}-clip"><path d="${shape.bowl}"/></clipPath></defs>
      <ellipse cx="100" cy="171" rx="66" ry="7" fill="#090404" opacity=".44"/>
      <path d="${shape.vessel}" fill="url(#${id}-glass)" stroke="#edc4a1" stroke-opacity=".9" stroke-width="1.4"/>
      ${liquid}
      <path d="${shape.rim}" fill="none" stroke="#ffe3b8" stroke-opacity=".9" stroke-width="1.6"/>
      <path d="${shape.detail}" fill="none" stroke="#ffedce" stroke-opacity=".46" stroke-width="1.3" stroke-linecap="round"/>
      ${garnish ? garnishIcon(garnish, shape.ornament[0]-10, shape.ornament[1]-19, 29) : ''}
      </svg>`;
  }
  function potionEffect(recipe, color) {
    const { surface, radius } = vesselFor(recipe);
    return `<g class="potion-impact" transform="translate(100 ${surface})" style="--drop-color:${color}">
      <path class="potion-drop" d="M0-16c2 4 7 8 7 12a7 7 0 0 1-14 0c0-4 5-8 7-12Z"/>
      <ellipse class="potion-ripple" rx="${Math.min(radius - 6, 40)}" ry="4"/>
      <ellipse class="potion-ripple second-ring" rx="${Math.min(radius - 8, 33)}" ry="4"/>
    </g>`;
  }
  const statSigils = {
    desire: 'M12 20C8 17 2 13 3 8c1-5 7-5 9-1 2-4 8-4 9 1 1 5-5 9-9 12Z',
    shy: 'm12 2 2.8 6.6 7.2 1-5.3 5.1 1.3 7.1L12 18l-6.1 3.4 1.3-7.1L2 9.6l7.2-1Z',
    candid: 'M2 12q10-15 20 0-10 15-20 0Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    tease: 'M3 9h11c5 0 6-6 2-6M2 13h16c5 0 5 6 1 6M5 17h6',
    strength: 'm13 2-2 7-3-2c0 5-5 6-3 11 3 7 16 5 15-4-1-4-4-6-7-12Zm0 11c3 5 3 7-1 8',
  };
  const dialNumber = (stat, value) => stat === 'strength' && value > 0 ? `+${value}` : String(value);
  function statDial(stat, label, value, pointsPerMark, min = 0) {
    const marks = Array.from({ length: mix.maxDrops }, (_, index) => {
      const fill = Math.min(1, Math.max(0, Math.abs(value) / pointsPerMark - index));
      return `<i${fill ? ` class="filled" style="--fill:${fill * 100}%"` : ''}></i>`;
    }).join('');
    return `<div class="stat-dial" data-stat="${stat}" data-value="${value}" role="meter" aria-label="${esc(label)}"
      aria-valuemin="${min}" aria-valuemax="${mix.maxDrops * pointsPerMark}" aria-valuenow="${value}">
      <span class="dial-label"><svg class="stat-sigil" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${statSigils[stat]}"/></svg>${esc(label)}</span>
      <span class="dial-marks" aria-hidden="true">${marks}</span>
      <strong class="dial-value" aria-hidden="true"><span>${dialNumber(stat, value)}</span></strong>
      <span class="dial-delta" aria-hidden="true"></span></div>`;
  }
  function animatePotionDials(panel, dose) {
    for (const [key, change] of Object.entries({ ...dose.attributes, strength: dose.tipsyDelta })) {
      if (!change) continue;
      const dial = panel.querySelector(`[data-stat="${key}"]`);
      dial.querySelector('.dial-value').dataset.previous = dialNumber(key, Number(dial.dataset.value) - change);
      dial.querySelector('.dial-delta').textContent = change > 0 ? `+${change}` : String(change);
      dial.classList.add('dose-added');
    }
  }
  function meters(recipe, guest, now) {
    const { effectId, attributes, tipsyDelta } = mix.recipeEffects(recipe);
    const predicted = mix.predictTipsy(now, recipe);
    const blocked = !mix.canServeDrink(now, recipe);
    const prediction = blocked ? '仅收无酒精' : `预计 ${predicted}/100 · ${tipsyLabel(predicted)}`;
    const forecastMark = recipe.baseLiquor && !blocked && predicted !== now
      ? `<i style="--forecast:${predicted}%"></i>` : '';
    const stats = Object.entries(mix.potionAttributes).map(([key, label]) => statDial(key, label, attributes[key], 2)).join('');
    const strength = statDial('strength', '酒劲', tipsyDelta, 20, -20 * mix.maxDrops);
    return `<header class="dial-heading">
        <div class="dial-name"><span class="dial-emblem">${icon('vial')}</span><h3 id="meters-title">魔药刻度</h3></div>
        ${potionProgress(recipe)}
      </header>
      <div class="stat-list" role="group" aria-label="当前配方属性">${stats}${strength}</div>
      <div class="drink-summary">
        ${recipe.baseLiquor ? `<div class="drink-effects">${esc(mix.drinkEffects[effectId].label)}</div>` : ''}
        <div class="effect-gauge">
          <div class="tipsy-reading"><span>${guest ? esc(guest.name) + ' · 醉酒度' : '醉酒度'}</span>
            <b>${now}/100 · ${tipsyLabel(now)}</b></div>
          <div class="mix-tipsy-track" aria-hidden="true" style="--amount:${now}%">${forecastMark}</div>
          ${recipe.baseLiquor ? `<span class="tipsy-forecast${blocked ? ' is-blocked' : ''}">${prediction}</span>` : ''}
        </div>
      </div>`;
  }
  function potionTint(id, color) {
    return `<filter id="tint-${id}" color-interpolation-filters="sRGB">
      <feColorMatrix in="SourceGraphic" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -5 5 0 0 -.06" result="liquid"/>
      <feColorMatrix in="SourceGraphic" values="0 1 0 0 0  0 1 0 0 0  0 1 0 0 0  0 0 0 1 0" result="light"/>
      <feFlood flood-color="${color}" result="pigment"/>
      <feComposite in="light" in2="pigment" operator="arithmetic" k1="1"/>
      <feComposite in2="liquid" operator="in"/>
      <feComposite in2="SourceGraphic" operator="atop"/>
    </filter>`;
  }
  function potionNotes(potion) {
    return `<span class="potion-effects" aria-hidden="true">${mix.potionLabels(potion).map(label => `<span>${esc(label)}</span>`).join('')}</span>`;
  }
  function customBottleArt(filled = false) {
    return `<span class="prop-art custom-bottle" aria-hidden="true">${filled ? '<span class="bottle-color"></span>' : ''}
      <img data-prop src="${propsPath}potion-custom.webp" alt="" draggable="false"><svg viewBox="0 0 68 76" focusable="false"><path fill="currentColor" d="M28 8h12v15l16 28q5 15-10 17H22Q7 66 12 51l16-28Z"/></svg></span>`;
  }
  function potionLibrary(potions, recipe) {
    return potions.map(item => {
      const potion = mix.dose(item);
      if (!potion || typeof item === 'string') return '';
      const count = recipe.potions.filter(drop => drop?.name === potion.name).length;
      const name = esc(potion.name);
      const detail = esc(mix.potionLabels(potion).join('，'));
      const bottle = button('saved-potion', `${customBottleArt(true)}<span class="prop-label">${name}</span>${potionNotes(potion)}${count ? `<span class="potion-badge" aria-hidden="true">${count}</span>` : ''}`, {
        id: potion.name, css: 'ingredient prop-choice', disabled: recipe.potions.length >= mix.maxDrops,
        attrs: `title="${name} · ${potion.color}" aria-label="滴入${name}${count ? '，已滴 ' + count + ' 滴' : ''}" aria-description="${detail}" aria-pressed="${Boolean(count)}"`,
      });
      const remove = button('remove-potion', icon('close'), {
        id: potion.name, css: 'potion-remove', attrs: `aria-label="删除${name}" title="删除${name}"`,
      });
      return `<div class="saved-potion" style="--ink:${potion.color}">${bottle}${remove}</div>`;
    }).join('');
  }
  function potionProgress(recipe) {
    const used = recipe.potions.length;
    const slots = Array.from({ length: mix.maxDrops }, (_, i) => {
      const potion = mix.dose(recipe.potions[i]);
      return `<span${potion ? ` class="filled" style="--ink:${potion.color}"` : ''}>${icon('drop')}</span>`;
    }).join('');
    return `<div class="potion-progress" data-full="${used === mix.maxDrops}" role="meter" aria-label="已滴入魔药"
      aria-valuemin="0" aria-valuemax="${mix.maxDrops}" aria-valuenow="${used}" aria-valuetext="${used} / ${mix.maxDrops} 滴">
      <span class="potion-progress-count" aria-hidden="true"><strong>${used}</strong> / ${mix.maxDrops} 滴</span>
      <span class="potion-progress-slots" aria-hidden="true">${slots}</span>
    </div>`;
  }
  function ingredients(recipe, draft = {}) {
    const base = mix.bases.map(item => {
      const [name, silhouette] = bottles[item.id];
      const art = prop(name, `<path fill="currentColor" fill-opacity=".62" stroke="currentColor" stroke-width="2" d="${silhouette}"/><path d="M27 41v14" stroke="#fff1d3" stroke-opacity=".7" stroke-width="2" stroke-linecap="round"/>`);
      const delta = item.tipsyDelta < 0 ? `−${Math.abs(item.tipsyDelta)}` : `+${item.tipsyDelta}`;
      const tipsy = `醉酒度 ${delta}`;
      return button('base', art + `<span class="prop-label">${item.label}<b class="base-tipsy">${tipsy}</b></span>`, {
        css: 'ingredient prop-choice', id: item.id,
        attrs: `style="--ink:${item.color}" aria-label="${item.name} · ${item.label} · ${tipsy}" aria-pressed="${recipe.baseLiquor === item.id}"`,
      });
    }).join('');
    const potion = mix.potions.map(item => {
      const n = recipe.potions.filter(id => id === item.id).length;
      const sub = Boolean(item.label);
      const labels = mix.potionLabels(item);
      const detail = labels.join('，');
      const art = prop('potion-' + (sub ? 'agility' : item.id), '<path fill="#3a282a" stroke="#cf9b68" stroke-width="2" d="M29 25V13a5 5 0 0 1 10 0v12Z"/><path fill="currentColor" fill-opacity=".75" stroke="currentColor" stroke-width="2" d="M27 25h14v37a7 7 0 0 1-14 0Z"/><path d="M31 33v21" stroke="#fff1d3" stroke-opacity=".7" stroke-width="2" stroke-linecap="round"/>', sub ? item.id : '');
      return button('potion', art + `<span class="prop-label">${sub ? item.label : item.name}</span>${potionNotes(item)}${n ? `<span class="potion-badge" aria-hidden="true">${n}</span>` : ''}`, {
        css: 'ingredient prop-choice' + (sub ? ' compound-potion' : ''), id: item.id,
        attrs: `style="--ink:${item.color}" title="${detail}" aria-label="${item.name}${n ? '，已滴 ' + n + ' 滴' : ''}" aria-description="${detail}" aria-pressed="${!!n}"`,
      });
    }).join('');
    const customBottle = button('edit-potion', customBottleArt() + '<span class="prop-label">自定义</span>', {
      css: 'ingredient prop-choice', attrs: `style="--ink:#cda776" aria-controls="potion-editor" aria-expanded="${Boolean(draft.open)}" aria-label="鉴定自定义魔药"`,
    });
    const filters = mix.potions.filter(item => item.label).map(item => potionTint(item.id, item.pigment)).join('');
    const garnish = mix.garnishes.map(item => {
      return button('garnish', `<i aria-hidden="true">${garnishIcon(item)}</i><span>${item.label}</span>
        <span class="garnish-effect">${item.flavor}</span>`, {
        css: 'ingredient', id: item.id, attrs: `style="--ink:${item.color}" aria-pressed="${recipe.garnish === item.id}"`,
      });
    }).join('');
    return { bases: base, potions: potion + customBottle, garnishes: garnish, filters };
  }
  const chip = recipe => recipe.customIngredient ? `<span class="ingredient-chip"><span>+ ${esc(recipe.customIngredient)}</span></span>` : '';
  function printArt(item, media, kind) {
    const url = image(media?.url);
    if (url) return `<div class="print-image"><img src="${esc(url)}" alt="${kind === 'drink' ? '特调成品照' : '角色归来的纪念照'}"></div>`;
    if (media?.status === 'pending') return '<div class="print-image"><span class="developing-label">暗房显影中</span></div>';
    return '';
  }

  function mediaRetry(state, key, label) {
    const entry = state.media[key];
    if (!entry || !['failed', 'fallback'].includes(entry.status) || !(entry.illustrations || entry.kind === 'standing')) return '';
    return `<p class="drink-meta" role="status">${esc(label)} · ${esc(entry.error || '生成失败')}
      ${button('media-retry', '重试', { id: key, css: 'quiet', attrs: `aria-label="重新生成${esc(label)}"` })}</p>`;
  }
  function redrawControls(entry, key, ui, { standing = false, showingNew = false, canApply = true, imageError = false } = {}) {
    const job = entry?.redraw;
    const busy = ui.mediaRequests.has(key);
    const errors = ui.mediaErrors.get(key) || (imageError && '新图加载失败，请切回原图后再试。') ||
      (job?.status === 'failed' && job.error);
    const action = (name, label, disabled = false) => button(name, label, { id: key, css: 'quiet redraw-button', disabled });
    let controls = '';
    if (job?.status === 'ready' && image(job.url)) {
      controls = (standing ? '' : action('media-compare', showingNew ? '看原图' : '看新图', busy)) +
        action('media-apply', '使用新图', busy || !canApply) + action('media-keep', '保留原图', busy);
    } else if (job?.status === 'pending' || entry?.status === 'pending' || busy) {
      controls = `<span class="redraw-status" role="status">${standing ? '绘制中…' : '显影中…'}</span>`;
    } else if (entry?.status === 'ready' && image(entry.url)) {
      controls = action('media-redraw', job?.status === 'failed' ? '重试' : standing ? '重画' : '重新生成');
    } else if (['failed', 'fallback'].includes(entry?.status)) {
      controls = action('media-retry', '重试');
    }
    const error = errors || (['failed', 'fallback'].includes(entry?.status) && entry.error);
    return `${controls}${error ? `<span class="redraw-error" role="status">${esc(error)}</span>` : ''}`;
  }
  function drinkPrint(drink, media) {
    const url = image(media?.url);
    if (!url) return printArt(drink, media, 'drink');
    return button('drink-photo', `<img src="${esc(url)}" alt="" draggable="false">`, {
      id: drink.id, css: 'print-image drink-print',
      attrs: `aria-label="查看${esc(media.drinkName || '特调')}成品照" aria-haspopup="dialog" aria-controls="drink-preview"`,
    });
  }
  function report(state, item) {
    const media = state.media[item.questId], outcome = item.outcome;
    const drink = state.drinks.find(row => row.id === item.quest.drinkId);
    const cup = drink && state.media[drink.id];
    return `<div class="report-grid"><div class="instant"><figure>${printArt(item, media, 'photo')}<figcaption>${esc(outcome.polaroidCaption)}</figcaption></figure>
      <span class="trinket"><i aria-hidden="true">${icon(trinketIcons.has(outcome.trinket.iconKeyword) ? outcome.trinket.iconKeyword : 'star')}</i> ${esc(outcome.trinket.name)}</span></div>
      <div class="report-copy"><div class="report-meta"><span>${resultNames[outcome.outcomeType]}</span><strong>好感 +${outcome.affinityDelta}</strong></div>
      <h3>${esc(item.quest.title)}</h3><p>${esc(outcome.storySummary)}</p><blockquote>「${esc(outcome.charReturnQuote)}」</blockquote>
      ${drink ? `<div class="report-drink">${printArt(drink, cup, 'drink')}<div><strong>${esc(cup?.drinkName || outcome.drinkName)}</strong><small>${esc(mix.recipeLabel(drink.recipe))}</small>${chip(drink.recipe)}</div></div>` : ''}</div></div>`;
  }
  function directory(state, ui) {
    const roster = new Map((ui.guestRoster || []).map(guest => [guest.name, guest]));
    const people = { ...state.people, ...Object.fromEntries(roster) };
    const seated = new Set(state.guests.map(guest => guest.name));
    const standingByGuest = new Map();
    for (const [key, picture] of Object.entries(state.media)) {
      if (picture.kind !== 'standing' || picture.status === 'skipped') continue;
      if (!standingByGuest.has(picture.guestName)) standingByGuest.set(picture.guestName, new Map());
      const tiers = standingByGuest.get(picture.guestName);
      const priority = picture.redraw ? 2 : state.standingByGuest[picture.guestName] === key ? 1 : 0;
      if ((tiers.get(picture.tier)?.priority ?? -1) <= priority) tiers.set(picture.tier, { key, picture, priority });
    }
    const status = ui.guestRosterPending ? '<p class="empty" role="status">正在读取角色状态…</p>' :
      ui.guestRosterError ? `<p class="empty" role="status">${esc(ui.guestRosterError)} ${button('guest-roster', '重试', { css: 'quiet' })}</p>` : '';
    const entry = (guest, present) => {
      const known = Object.hasOwn(state.people, guest.name) ? state.people[guest.name] : undefined;
      const description = guest.title || (!present && known ? '旧识' : '');
      const reserved = state.reservedGuestName === guest.name;
      const preference = Object.hasOwn(state.preferences, guest.name) ? state.preferences[guest.name] : undefined;
      const label = reserved ? '取消留座' : '明晚留座';
      const reserve = roster.has(guest.name) || reserved ? button('reserve', label, {
        id: guest.name, css: 'quiet reserve-seat',
        attrs: `aria-label="${label} ${esc(guest.name)}" aria-pressed="${reserved}" aria-disabled="${!!ui.busy}"`,
      }) : '';
      const value = present ? state.tipsy[guest.name] || 0 : 0;
      const condition = tipsyLabel(value);
      const meter = present ? `<div class="directory-tipsy">
        <span>${condition}</span><span>${value}/100</span>
        <meter min="0" max="100" low="20" high="80" optimum="0" value="${value}" aria-label="${esc(guest.name)}的醉酒度"></meter>
      </div>` : '';
      const tiers = standingByGuest.get(guest.name);
      const expanded = ui.standingGuest === guest.name;
      const entries = tiers && [...tiers.values()].sort((a, b) => a.picture.tipsy - b.picture.tipsy);
      const gallery = entries?.length ? button('standing-list', '醉酒立绘' + icon(expanded ? 'prev' : 'next'), {
        id: guest.name, css: 'quiet standing-list-toggle',
        attrs: `aria-expanded="${expanded}" aria-label="${esc(guest.name)}的醉酒立绘"`,
      }) : '';
      const standing = expanded && entries?.length ? `<ul class="standing-list">${entries.map(({ key, picture }) => {
        const thumbnail = image(picture.url);
        const candidate = picture.redraw?.status === 'ready' && image(picture.redraw.url);
        const trial = candidate && ui.visibleStandings?.has(key) ? button('standing-trial', '在舞台试看', { id: key, css: 'quiet' }) : '';
        return `<li><div class="standing-row"><div class="standing-label">
          ${thumbnail ? `<img class="standing-thumbnail" src="${esc(thumbnail)}" alt="当前立绘" loading="lazy" decoding="async">` : ''}
          <strong>${esc(tipsyLabel(picture.tipsy))}</strong></div>
          <div class="redraw-controls">${trial}${redrawControls(picture, key, ui, { standing: true })}</div></div>
          ${candidate ? `<div class="standing-comparison">${[[picture.url, '原图'], [candidate, '新图']].map(([url, title]) =>
            `<figure><img src="${esc(image(url))}" alt="" decoding="async"><figcaption>${title}</figcaption></figure>`).join('')}</div>` : ''}</li>`;
      }).join('')}</ul>` : '';
      return `<article>${avatar(known ? { ...known, ...guest } : guest)}
        <div class="directory-name"><strong>${esc(guest.name)}</strong>${description ? `<small>${esc(description)}</small>` : ''}
        ${meter}${preference ? `<small>${preference.preference === 'likes' ? '偏爱' : '不爱'} · ${esc(preference.flavor)}</small>` : ''}</div>
        ${reserve}${gallery}${standing}</article>`;
    };
    const entries = Object.values(people);
    const groups = [
      ['今夜在座', entries.filter(guest => seated.has(guest.name)), true],
      ['其他角色', entries.filter(guest => !seated.has(guest.name)), false],
    ];
    return `<div class="directory">${status}${groups.map(([title, guests, present]) => guests.length ?
      `<section class="directory-group"><h3>${title}</h3>${guests.map(guest => entry(guest, present)).join('')}</section>` : '').join('')}</div>`;
  }

  function drawer(state, ui, kind) {
    const titles = { menu: '招牌酒单', wall: '纪念墙', people: '角色状态', report: '归来战报', special: '当前特调' };
    const drawerIcon = { menu: 'cocktail', wall: 'wall', people: 'people' }[kind];
    let content = '';
    if (kind === 'menu') content = `<div class="album-grid drink-menu">${[...state.drinks].reverse().map(item => {
      const media = state.media[item.id];
      const guest = item.guestName;
      const tasting = image(state.media['tipsy-' + item.id]?.url);
      return `<article class="album-card"><div class="drink-photos">${drinkPrint(item, media)}
        ${tasting ? button('menu-photo', `<img src="${esc(tasting)}" alt="" draggable="false">`, {
          id: item.id, css: 'print-image tasting-print',
          attrs: `aria-label="查看${esc(guest || '饮用者')}品尝时的照片" aria-haspopup="dialog" aria-controls="cg-preview"`,
        }) : ''}
        </div><h3>${esc(media?.drinkName || '特调')}</h3>
        <p class="drink-meta">${guest ? `<span>${esc(guest)}</span>` : ''}<span>Night ${item.night}</span></p>
        <p class="drink-recipe">${mix.recipeParts(item.recipe).map(part => `<span>${esc(part)}</span>`).join('')}</p>${chip(item.recipe)}
        ${mediaRetry(state, item.id, '特调照片')}${mediaRetry(state, 'tipsy-' + item.id, '饮后照片')}${mediaRetry(state, item.tasting?.standing, '角色立绘')}</article>`;
    }).join('') || '<p class="empty">酒单空着，等第一杯特调。</p>'}</div>`;
    if (kind === 'special') {
      const drink = state.drinks.find(item => item.id === ui.cardId);
      if (drink) content = `<figure class="card-closeup">${drinkPrint(drink, state.media[drink.id])}<figcaption><strong>${esc(state.media[drink.id]?.drinkName || '特调')}</strong><p>${esc(mix.recipeLabel(drink.recipe))}</p>${chip(drink.recipe)}</figcaption></figure>`;
    }
    if (kind === 'wall') {
      const photos = [...state.wall].reverse().flatMap(id => {
        const drink = state.drinks.find(item => item.id === id);
        const url = image(state.media['tipsy-' + id]?.url);
        if (!drink || !url) return [];
        const name = drink.guestName;
        return [`<article class="wall-card">${button('menu-photo', `<span class="print-image"><img src="${esc(url)}" alt=""></span>
          <strong>${esc(name)}</strong><small>Night ${drink.night} · ${esc(state.media[id]?.drinkName || '特调')}</small>`, {
          id, css: 'tasting-print', attrs: `aria-label="查看${esc(name)}的饮后照片" aria-haspopup="dialog" aria-controls="cg-preview"`,
        })}</article>`];
      });
      const reports = [...state.reports].sort((a, b) => {
        const pinned = state.wall.indexOf(b.questId) - state.wall.indexOf(a.questId);
        return pinned || b.night - a.night;
      }).map(item => `<article class="wall-card">${button('show-report', `${printArt(item, state.media[item.questId], 'photo')}
        <strong>${esc(item.outcome.polaroidCaption)}</strong><small>Night ${item.night} · ${esc(item.quest.title)}</small>`, { id: item.questId })}</article>`);
      content = `<div class="album-grid wall-grid">${photos.join('')}${reports.join('') || (photos.length ? '' : '<p class="empty">在饮后照片里选择「钉上纪念墙」。</p>')}</div>`;
    }
    if (kind === 'people') content = directory(state, ui);
    if (kind === 'report') {
      const item = state.reports.find(row => row.questId === ui.reportId);
      content = item ? report(state, item) : '';
    }
    return `<header class="overlay-head${drawerIcon ? ' drawer-head' : ''}"><h2 id="overlay-title">
      ${drawerIcon ? `<span class="drawer-emblem">${icon(drawerIcon)}</span>` : ''}${titles[kind]}
      </h2>${button('close', icon('close'), { css: 'close', attrs: 'aria-label="关闭浮层"' })}</header>
      <div class="overlay-content${drawerIcon ? ' drawer-content drawer-' + kind : ''}">${content}</div>`;
  }

  window.TavernView = { icon, image, esc, button, avatar, featuredGuest, seats, dialogue, hasReadOpening, replyGuest, ingredients, glass, potionEffect, potionProgress, potionLibrary, animatePotionDials, meters, drawer, tipsyLabel, redrawControls };
})();
