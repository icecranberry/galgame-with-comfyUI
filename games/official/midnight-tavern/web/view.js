(() => {
  'use strict';
  const mix = window.TavernMix;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const image = value => /^\/(?:images|avatars|game-media)\/[\w./%?=&-]+$|^\.\/(?:lin|chen|su)\.svg$/.test(value || '') && !value.includes('..') ? value : '';
  const statuses = ['清醒', '微醺', '醉意朦胧', '酣醉'];
  const tipsyLabel = n => statuses[n <= 25 ? 0 : n <= 55 ? 1 : n <= 80 ? 2 : 3];
  const resultNames = { triumph: '漂亮收场', chaotic: '一夜闹剧', twist: '意外转折' };
  const icons = { key: '⚿', star: '✶', moon: '☾', ticket: '▱', leaf: '❧', compass: '✥' };
  const button = (action, label, { id = '', css = '', disabled = false, attrs = '' } = {}) =>
    `<button type="button" data-action="${action}" data-id="${esc(id)}" class="${css}" ${disabled ? 'disabled' : ''} ${attrs}>${label}</button>`;
  const bottles = {
    gin_vodka: ['bottle-spirit', 'M28 11h12v14l8 9v32H20V34l8-9Z'],
    whiskey_rum: ['bottle-aged', 'M27 20h14v13l11 8v24H16V41l11-8Z'],
    liqueur_sparkling: ['bottle-sweet', 'M28 12h12v16q-6 7 0 17 11 8 9 21H19q-2-13 9-21 6-10 0-17Z'],
    coffee_tea: ['bottle-nonalcohol', 'M24 36h20q10 9 10 22t-20 9q-20 0-20-9 0-6 2-10L6 37l13 5Zm30 7q15-7 13 6t-13 10'],
  };
  const propsPath = './assets/props/';
  function prop(name, fallback) {
    return `<span class="prop-art" aria-hidden="true"><img src="${propsPath}${name}.png" alt="" draggable="false" data-prop><svg viewBox="0 0 68 76" focusable="false">${fallback}</svg></span>`;
  }
  const seal = () => prop('wax-seal', '<path fill="#a33e35" stroke="#dc7b65" stroke-width="3" d="M34 10c15-2 26 11 25 24 5 18-12 29-25 28C15 65 7 50 9 37c-4-16 11-26 25-27Z"/><circle cx="34" cy="36" r="17" fill="none" stroke="#692721" stroke-width="3"/><path fill="#e28d70" d="m34 22 3 10 10 4-10 3-3 10-4-10-9-3 9-4Z"/>');

  // Custom expression packs supply their own names. Prefer an actual matching slot, then a related mood.
  const moodFamilies = [/笑|喜|乐|开心|高兴|愉悦|得意|happy|smile/i, /惊|讶|意外|surpris/i, /羞|脸红|微醺|害臊|shy|blush/i,
    /思|惑|疑|好奇|沉吟|困扰|think|curious/i, /生气|怒|愤|不满|angry/i, /伤心|悲|难过|失落|sad/i, /困倦|疲|醉|迷离|sleep/i];
  function spriteFor(guest,mood) {
    const sprites = (guest.expressions || []).filter(slot => image(slot.url));
    const normalized = String(mood || '').toLowerCase();
    const family = moodFamilies.find(group => group.test(normalized));
    return (sprites.find(slot => slot.name.toLowerCase() === normalized || slot.id === normalized) ||
      sprites.find(slot => normalized && (normalized.includes(slot.name.toLowerCase()) || slot.name.includes(mood))) ||
      sprites.find(slot => family?.test(slot.name)) || sprites.find(slot => slot.id === 'normal') || sprites[0])?.url;
  }
  function avatar(guest, large = false, mood = '') {
    const sprite = spriteFor(guest,mood);
    const url = image(large ? sprite || guest.portrait || guest.avatar : guest.avatar || sprite || guest.portrait);
    const single = esc([...guest.name][0]);
    const style = large && (sprite ? 'portrait-expression' : !image(guest.portrait) ? 'portrait-avatar' : url.startsWith('./') ? 'portrait-illustrated' : '');
    return `<span class="portrait${style ? ' ' + style : ''}" aria-hidden="true">${url ? `<img src="${esc(url)}" alt="" draggable="false">` : ''}<span>${single}</span></span>`;
  }
  function seats(state, ui) {
    const line = state.history[state.cursor];
    const quest = state.quest;
    return state.guests.map(guest => {
      const n = state.tipsy[guest.id] || 0;
      const talking = line?.charId === guest.id;
      const away = quest?.status === 'away' && quest.charId === guest.id;
      const picked = ui.target === guest.id;
      const offered = quest?.status === 'draft';
      const focus = ui.focusId === guest.id && ui.face;
      const assignee = quest?.status === 'assigned' && quest.charId === guest.id;
      const mood = talking ? line.mood : [...state.history.slice(0, state.cursor + 1)].reverse().find(item => item.charId === guest.id)?.mood;
      const css = ['seat', talking && 'is-speaking', away && 'is-away', offered && 'is-offered', picked && 'is-selected', assignee && 'is-assignee', n > 25 && 'is-tipsy', focus && 'is-face'].filter(Boolean).join(' ');
      return button('guest', `${avatar(guest, true, focus && n > 25 && !talking ? (n > 80 ? '困倦' : '微醺') : mood)}
        <span class="seat-mood" data-tipsy="${tipsyLabel(n)}">${esc(focus ? '品尝特调' : away ? '奇遇途中' : offered ? '交付委托' : assignee ? '等候送行' : mood || '在座')}</span>
        <span class="seat-label"><strong>${esc(guest.name)}</strong><span>${tipsyLabel(n)}</span></span>
        <span class="tipsy-track" role="meter" aria-label="微醺度" aria-valuenow="${n}" aria-valuemin="0" aria-valuemax="100"><i style="--amount:${n}%"></i></span>`, {
        id: guest.id, css, disabled: away || state.phase === 'REPORT',
        attrs: `data-guest="${esc(guest.id)}" aria-pressed="${picked}"`,
      });
    }).join('');
  }
  function lineMarkup(line, state, busy) {
    const matches = line.rumors.map(note => ({ note, index: line.text.indexOf(note.keyword) }))
      .filter(match => match.index >= 0).sort((a, b) => a.index - b.index);
    let offset = 0;
    let html = '';
    for (const { note, index } of matches) {
      if (index < offset) continue;
      const captured = state.notes.some(old => old.id === note.id || old.keyword === note.keyword);
      const firstHint = !state.notes.length && offset === 0 && !captured ? '<small class="collect-hint">＋收起</small>' : '';
      html += esc(line.text.slice(offset, index)) + button('collect', esc(note.keyword) + firstHint, {
        id: note.id, css: 'rumor' + (captured ? ' is-collected' : ''), disabled: busy || captured,
        attrs: `title="${captured ? '已收录' : '记下流言'}"`,
      });
      offset = index + note.keyword.length;
    }
    return html + esc(line.text.slice(offset));
  }
  function dialogue(state, ui) {
    if (state.phase === 'OPENING') return `<div class="opening-content"><h1><span>邻舍</span>深夜小酒馆</h1>
      ${ui.error ? `<p role="alert">${esc(ui.error)}</p>` : ''}
      ${button(ui.error ? 'retry' : 'open', ui.busy || (ui.error ? '重新连接' : '开门迎客'), { css: 'primary', disabled: !!ui.busy })}</div>`;
    if (state.phase === 'REPORT') return `<div class="after-hours"><strong>来客归席</strong><div>
      ${button('show-report', '查看战报', { id: state.reports.at(-1)?.questId, css: 'quiet' })}
      ${button('continue', '继续接待', { disabled: !!ui.busy })}
      ${button('next-night', '打烊进入下一夜', { css: 'primary', disabled: !!ui.busy })}</div></div>`;
    const line = state.history[state.cursor];
    const more = state.cursor < state.history.length - 1;
    const crafting = ['draft', 'assigned'].includes(state.quest?.status);
    return `<div class="speech-head"><strong>${esc(state.people[line?.charId]?.name || (line?.charId === 'player' ? '老板' : '吧台'))}</strong>
      ${line?.mood ? `<span>${esc(line.mood)}</span>` : ''}
      <div class="speech-progress">${!state.quest && state.reports.at(-1)?.night === state.night ? button('next-night', '打烊', { css: 'quiet', disabled: !!ui.busy }) : ''}${button('previous', '‹', { css: 'arrow', disabled: !state.cursor || !!ui.busy, attrs: 'aria-label="上一句"' })}${state.cursor + 1} / ${state.history.length}</div></div>
      <div class="speech-line" data-line="${state.cursor}">${line ? lineMarkup(line, state, !!ui.busy) : '有人推门进来了。'}</div>
      <div class="speech-controls">
        <div class="speech-actions"><div class="quick-replies">${state.quickReplies.map(reply => button('reply', esc(reply), { id: reply, css: 'quiet', disabled: !!ui.busy })).join('')}</div>
        ${button('listen', esc(ui.busy || (more ? '继续倾听' : '继续闲聊')) + (!ui.busy ? ' <span aria-hidden="true">→</span>' : ''), { css: (crafting ? 'quiet' : 'primary') + ' listen', disabled: !!ui.busy })}</div>
        <div class="reply-form" id="reply-form"><input name="line" aria-label="老板搭话" placeholder="顺口搭句话..." maxlength="160" autocomplete="off" value="${esc(ui.reply)}">
        ${button('speak', '搭话 ↵', { disabled: !!ui.busy })}</div>
      </div>`;
  }
  function board(state, ui) {
    const locked = !!ui.busy || state.phase !== 'CHATTING';
    const quest = state.quest;
    const shelf = state.notes.length ? state.notes.map(note => {
      const seed = [...note.id].reduce((hash, character) => Math.imul(hash, 31) + character.charCodeAt(0), 0) >>> 0;
      const tilt = (seed % 401) / 100 - 2;
      return button('slot-note', `<strong>${esc(note.keyword)}</strong><small>${esc(note.summary)}</small>`, {
        id: note.id, css: 'note ' + (state.slots.includes(note.id) ? 'is-slotted' : ''),
        disabled: locked, attrs: `draggable="${!locked}" data-note="${esc(note.id)}" title="${esc(note.summary)}" style="--note-tilt:${tilt}deg"`,
      });
    }).join('') : '<p class="board-empty">从对话中收起划线的流言。</p>';
    if (quest) return `<div class="board-layout"><div class="notes">${shelf}</div>
      <article class="quest-paper" draggable="${quest.status === 'draft' && !ui.busy}" data-quest="${esc(quest.questId)}">
        <span class="paper-kicker">委托 · ${{ draft: '待派单', assigned: '待送行', away: '已出发' }[quest.status]}</span>
        <h3>${esc(quest.title)}</h3><p>${esc(quest.synopsis)}</p>
        <div class="quest-stats">${quest.recommendedStats.map(id => `<span>${mix.get(mix.potions, id)?.label || ''}</span>`).join('')}</div>
        ${quest.status === 'draft' ? `<p class="quest-hint">${esc(quest.targetHint)}<br>选择一位接单人。</p><div class="assignees">${state.guests.map(guest => button('guest', esc(guest.name), { id: guest.id, css: 'wax', disabled: !!ui.busy, attrs: `data-guest="${esc(guest.id)}"` })).join('')}</div>` : ''}
        ${quest.status === 'assigned' ? `<p class="quest-hint">为${esc(state.people[quest.charId]?.name)}调制送行特调。</p>${button('focus-workshop', '去调酒 →', { css: 'wax', disabled: !!ui.busy })}` : ''}
        ${quest.status === 'away' ? button('resolve', '等待归来 →', { css: 'wax', disabled: !!ui.busy }) : ''}
      </article></div>`;
    const filled = state.slots.filter(Boolean).length;
    return `<div class="board-layout"><div class="notes">${shelf}</div>
      <div class="quest-paper parchment"><div class="slots">${state.slots.map((id, index) => {
        const note = state.notes.find(item => item.id === id);
        return button('clear-slot', note ? `${esc(note.keyword)} <span aria-hidden="true">×</span>` : `<span>${String(index + 1).padStart(2, '0')}</span><span>待贴便签</span>`, {
          id: index, css: 'slot' + (note ? ' is-filled' : ''), disabled: locked,
          attrs: `data-slot="${index}" aria-label="槽位 ${index + 1}${note ? '，移除' + esc(note.keyword) : '，待放入便签'}"`,
        });
      }).join('')}</div>
      ${button('synthesize', seal() + '<span>盖章发单</span>', { css: 'wax stamp-action', disabled: locked || filled !== 3 })}</div></div>`;
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
  function glass(recipe, id, pending = false) {
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
    const liquid = full ? `<g clip-path="url(#${id}-clip)">
      <path class="liquid-color" fill="url(#${id}-liquid)" d="${wave(shape, shape.surface)}V${shape.depth + 4}H10Z"/>
      ${ice}
      <path class="liquid-glint" fill="none" stroke="#fff0ca" stroke-opacity=".74" d="${wave(shape, shape.surface)}"/>
      ${[76, 91, 108, 124].map((x, i) => `<circle class="bubble" cx="${x}" cy="${Math.min(shape.depth - 6, shape.surface + 18 + i * 7)}" r="${1.6 + (i % 2)}" style="--delay:${-i * .52}s"/>`).join('')}</g>` : '';
    return `<svg class="glass-art" viewBox="0 0 200 180" aria-hidden="true">
      <defs><linearGradient id="${id}-glass"><stop stop-color="#fff4d3" stop-opacity=".32"/><stop offset=".35" stop-color="#fff8ed" stop-opacity=".05"/><stop offset=".66" stop-color="#f0c396" stop-opacity=".12"/><stop offset="1" stop-color="#d89c79" stop-opacity=".37"/></linearGradient>
      <linearGradient id="${id}-liquid" x1="0" y1="1" x2="0" y2="0">${fills}</linearGradient>
      <clipPath id="${id}-clip"><path d="${shape.bowl}"/></clipPath></defs>
      <ellipse cx="100" cy="171" rx="66" ry="7" fill="#090404" opacity=".44"/>
      <path d="${shape.vessel}" fill="url(#${id}-glass)" stroke="#edc4a1" stroke-opacity=".9" stroke-width="1.4"/>
      ${liquid}
      <path d="${shape.rim}" fill="none" stroke="#ffe3b8" stroke-opacity=".9" stroke-width="1.6"/>
      <path d="${shape.detail}" fill="none" stroke="#ffedce" stroke-opacity=".46" stroke-width="1.3" stroke-linecap="round"/>
      ${garnish && garnishIcons[garnish.id] ? garnishIcon(garnish, shape.ornament[0]-10, shape.ornament[1]-19, 29) :
        garnish ? `<text x="${shape.ornament[0]}" y="${shape.ornament[1]}" style="fill:${garnish.color}" font-size="27" transform="rotate(16 ${shape.ornament.join(' ')})">${garnish.symbol}</text>` : ''}
      ${pending ? `<text class="mix-pending" x="100" y="${shape.surface + 20}" text-anchor="middle">待调特调</text>` : ''}</svg>`;
  }
  function potionEffect(recipe, color) {
    const { surface, radius } = vesselFor(recipe);
    return `<g class="potion-impact" transform="translate(100 ${surface})" style="--drop-color:${color}">
      <path class="potion-drop" d="M0-16c2 4 7 8 7 12a7 7 0 0 1-14 0c0-4 5-8 7-12Z"/>
      <ellipse class="potion-ripple" rx="${Math.min(radius - 6, 40)}" ry="4"/>
      <ellipse class="potion-ripple second-ring" rx="${Math.min(radius - 8, 33)}" ry="4"/>
    </g>`;
  }
  function meters(recipe) {
    const { stats, tipsyDelta, chaos } = mix.calculate(recipe);
    const bar = (label, value, total, color = 'var(--amber)') => `<div class="meter"><span>${label}</span><i><b style="--amount:${Math.abs(value) / total * 100}%;--meter-color:${color}"></b></i></div>`;
    return `<div class="stat-list">${mix.potions.map(item => bar(item.label + ' ' + stats[item.id], stats[item.id], 3, item.color)).join('')}</div>
      <div class="effect-list">${bar('微醺 ' + (tipsyDelta < 0 ? '清零' : '+' + tipsyDelta), tipsyDelta, 100)}${bar('混乱 ' + chaos, chaos, 100, '#ec8a76')}</div>`;
  }
  function ingredients(recipe, draft = {}) {
    const base = mix.bases.map(item => {
      const [name, silhouette] = bottles[item.id];
      const art = prop(name, `<path fill="currentColor" fill-opacity=".62" stroke="currentColor" stroke-width="2" d="${silhouette}"/><path d="M27 41v14" stroke="#fff1d3" stroke-opacity=".7" stroke-width="2" stroke-linecap="round"/>`);
      return button('base', art + `<span class="prop-label">${item.label}</span>`, {
        css: 'ingredient prop-choice', id: item.id, attrs: `style="--ink:${item.color}" title="${item.name}" aria-label="${item.name} · ${item.label}" aria-pressed="${recipe.baseLiquor === item.id}"`,
      });
    }).join('');
    const potion = mix.potions.map(item => {
      const n = recipe.potions.filter(id => id === item.id).length;
      const art = prop('potion-' + item.id, '<path fill="#3a282a" stroke="#cf9b68" stroke-width="2" d="M29 25V13a5 5 0 0 1 10 0v12Z"/><path fill="currentColor" fill-opacity=".75" stroke="currentColor" stroke-width="2" d="M27 25h14v37a7 7 0 0 1-14 0Z"/><path d="M31 33v21" stroke="#fff1d3" stroke-opacity=".7" stroke-width="2" stroke-linecap="round"/>');
      return button('potion', art + `<span class="prop-label">${item.label}</span>${n ? `<span class="potion-badge" aria-hidden="true">${n}</span>` : ''}`, {
        css: 'ingredient prop-choice', id: item.id, attrs: `style="--ink:${item.color}" aria-label="${item.name}，${item.label}${n ? '，已滴 ' + n + ' 滴' : ''}" title="${item.name}" aria-pressed="${!!n}"`,
      });
    }).join('');
    const customDrops=recipe.potions.filter(drop=>typeof drop==='object').length;
    const tint=draft.result?.color || '#76c8ae';
    const customBottle=button('edit-potion', `<span class="prop-art" aria-hidden="true"><img class="elixir-bottle" data-prop src="${propsPath}potion-custom.webp" alt=""><svg viewBox="0 0 68 76"><path fill="currentColor" d="M28 8h12v15l16 28q5 15-10 17H22Q7 66 12 51l16-28Z"/></svg></span><span class="prop-label">自定义</span>${customDrops ? '<span class="potion-badge">'+customDrops+'</span>' : ''}`,{
      css:'ingredient prop-choice',attrs:`style="--ink:${tint}" aria-controls="potion-editor" aria-expanded="${!!draft.open}" title="调配自定义魔药"`,
    });
    const dots = `<div class="drop-count"><span>${recipe.potions.length}/3</span><i></i><i></i><i></i>${button('clear-potions', '清空魔药', { css: 'arrow', disabled: !recipe.potions.length, attrs: 'aria-label="清空魔药"' })}</div>`;
    const garnish = mix.garnishes.map(item => button('garnish', `<i aria-hidden="true">${garnishIcons[item.id] ? garnishIcon(item) : item.symbol}</i><span>${item.label}</span>`, {
      css: 'ingredient', id: item.id, attrs: `style="--ink:${item.color}" title="${item.effect}" aria-pressed="${recipe.garnish === item.id}"`,
    })).join('');
    return { bases: base, potions: potion + customBottle + dots, garnishes: garnish };
  }
  const chip = recipe => recipe.customIngredient ? `<span class="ingredient-chip"><span>+ ${esc(recipe.customIngredient)}</span></span>` : '';
  function printArt(item, media, kind) {
    const url = image(media?.url);
    if (url) return `<div class="print-image"><img src="${esc(url)}" alt="${kind === 'drink' ? '特调成品照' : '邻居归来的纪念照'}"></div>`;
    const pending = media?.status === 'pending';
    return `<div class="print-image illustrated ${pending ? 'developing' : ''}">
      ${kind === 'drink' ? glass(item.recipe, 'card-' + item.id) : `<svg class="instant-art" viewBox="0 0 320 216" aria-hidden="true">
      <defs><linearGradient id="sky-${item.questId}" x2="0" y2="1"><stop stop-color="#282533"/><stop offset="1" stop-color="#94604d"/></linearGradient></defs>
      <path fill="url(#sky-${item.questId})" d="M0 0h320v216H0z"/><circle cx="245" cy="52" r="24" fill="#f0c78b"/>
      <path fill="#34242b" d="M0 146l45-36 24 18 30-40 46 45 80-24 35 32 60-30v105H0z"/>
      <path fill="#201d23" d="M0 176l93-14 35-55 40 47 152 37v25H0z"/><path stroke="#e6a775" stroke-width="3" d="M186 170v-60h22"/>
      <path fill="#f1b878" d="M201 111h14l3 8h-20z"/><path fill="#876251" d="M174 216l14-46 12 4 25 42z"/>
      <circle cx="143" cy="154" r="10" fill="#2c2225"/><path d="M134 168q9-9 17 0l7 35h-30z" fill="#2c2225"/>
      <path stroke="#f7c67d" stroke-opacity=".58" stroke-width="2" d="M213 137h7m22-13h8m-48 33h10m58-15h8"/></svg>`}
      ${pending ? '<span class="developing-label">暗房显影中</span>' : ''}</div>`;
  }
  function promote(id, media) {
    return button('promote', media?.promoted ? '已保存至大相册' : '保存至大相册', {
      id, css: 'quiet', disabled: !media?.url || !!media?.promoted,
      attrs: !media?.url ? 'title="可收藏显影完成的图片"' : '',
    });
  }
  function report(state, item) {
    const media = state.media[item.questId], outcome = item.outcome;
    const drink = state.drinks.find(row => row.id === item.quest.drinkId);
    const cup = state.media[drink.id];
    return `<div class="report-grid"><div class="instant"><figure>${printArt(item, media, 'photo')}<figcaption>${esc(outcome.polaroidCaption)}</figcaption></figure>
      <span class="trinket" title="战利品"><i aria-hidden="true">${icons[outcome.trinket.iconKeyword] || '✶'}</i> ${esc(outcome.trinket.name)}</span></div>
      <div class="report-copy"><div class="report-meta"><span>${resultNames[outcome.outcomeType]}</span><strong>好感 +${outcome.affinityDelta}</strong></div>
      <h3>${esc(item.quest.title)}</h3><p>${esc(outcome.storySummary)}</p><blockquote>「${esc(outcome.charReturnQuote)}」</blockquote>
      <div class="report-drink">${printArt(drink, cup, 'drink')}<div><strong>${esc(cup?.drinkName || outcome.drinkName)}</strong><small>${esc(mix.recipeLabel(drink.recipe))} · 混乱 ${drink.chaos}</small>${chip(drink.recipe)}</div></div></div></div>
      <footer class="overlay-actions">${promote(item.questId, media)}${button('pin', state.wall.includes(item.questId) ? '已钉在纪念墙上' : '钉在纪念墙', {
        id: item.questId, css: 'primary', disabled: state.wall.includes(item.questId),
      })}</footer>`;
  }
  function drawer(state, ui, kind) {
    const titles = { menu: '招牌酒单', wall: '纪念墙', people: '邻舍名录', saves: '存档与设置', report: '归来战报', special: '当前特调' };
    let content = '';
    if (kind === 'menu') content = `<div class="album-grid">${[...state.drinks].reverse().map(item => {
      const media = state.media[item.id];
      return `<article class="album-card">${printArt(item, media, 'drink')}<h3>${esc(media?.drinkName || mix.base(item.recipe).fallback)}</h3>
        <p>${esc(state.people[item.charId]?.name)} · Night ${item.night}</p><p>${esc(mix.recipeLabel(item.recipe))}</p>${chip(item.recipe)}
        <div class="card-actions">${promote(item.id, media)}</div></article>`;
    }).join('') || '<p class="empty">酒单空着，等第一杯特调。</p>'}</div>`;
    if (kind === 'special') {
      const drink = state.drinks.find(item => item.id === ui.cardId);
      if (drink) content = `<figure class="card-closeup">${printArt(drink,state.media[drink.id],'drink')}<figcaption><strong>${esc(state.media[drink.id]?.drinkName || mix.base(drink.recipe).fallback)}</strong><p>${esc(mix.recipeLabel(drink.recipe))}</p>${chip(drink.recipe)}</figcaption></figure>`;
    }
    if (kind === 'wall') content = `<div class="album-grid wall-grid">${state.wall.map(id => state.reports.find(row => row.questId === id)).filter(Boolean).reverse().map(item =>
      `<article class="wall-card">${button('show-report', `${printArt(item, state.media[item.questId], 'photo')}
        <strong>${esc(item.outcome.polaroidCaption)}</strong><small>Night ${item.night} · ${esc(item.quest.title)}</small>`, { id: item.questId })}</article>`).join('')
      || '<p class="empty">把归来战报里的拍立得钉在这里。</p>'}</div>`;
    if (kind === 'people') content = `<div class="directory">${Object.values(state.people).map(guest => `<article>${avatar(guest)}
      <div><strong>${esc(guest.name)}</strong><small>${esc(guest.title || (state.guests.some(item => item.id === guest.id) ? '今夜来客' : '旧识'))}</small></div>
      <span>好感 ${state.affinity[guest.id] || 0} · ${tipsyLabel(state.tipsy[guest.id] || 0)}</span></article>`).join('')
      || '<p class="empty">开店后，来客就会出现在名录里。</p>'}</div>`;
    if (kind === 'saves') content = `<div class="save-controls"><label><input type="checkbox" id="illustrations" ${state.settings.illustrations ? 'checked' : ''}> 为特调、来客神态和战报生成图片</label>
      ${button('new-save', '新开一间酒馆', { css: 'quiet', disabled: !!ui.busy })}</div>
      <div class="save-list">${ui.saves.map(item => `<article><div><strong>${esc(item.title)}</strong><small>${new Date(item.updatedAt).toLocaleString('zh-CN')}</small></div>
      ${item.sessionId === ui.sessionId ? '<span>当前存档</span>' : button('load', '读档', { id: item.sessionId, disabled: !!ui.busy })}</article>`).join('') || '<p class="empty">暂无存档。</p>'}</div>
      <footer class="overlay-actions">${button('exit', '保存并返回游戏馆', { disabled: !!ui.busy, css: 'primary' })}</footer>`;
    if (kind === 'report') {
      const item = state.reports.find(row => row.questId === ui.reportId);
      content = item ? report(state, item) : '';
    }
    return `<header class="overlay-head"><h2 id="overlay-title">${titles[kind]}</h2>${button('close', '×', { css: 'close', attrs: 'aria-label="关闭浮层"' })}</header><div class="overlay-content">${content}</div>`;
  }

  window.TavernView = { image, esc, button, avatar, seats, dialogue, board, ingredients, glass, potionEffect, chip, meters, drawer, tipsyLabel };
})();
