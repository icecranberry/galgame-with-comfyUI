(() => {
  'use strict';
  const mix = window.TavernMix;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const image = value => /^\/(?:images|avatars|game-media)\/[\w./%?=&-]+$|^\.\/(?:lin|chen|su)\.svg$/.test(value || '') && !value.includes('..') ? value : '';
  const statuses = ['清醒', '微醺', '上头', '酣醉'];
  const tipsyLabel = n => statuses[n < 12 ? 0 : n < 45 ? 1 : n < 74 ? 2 : 3];
  const resultNames = { triumph: '漂亮收场', chaotic: '一夜闹剧', twist: '意外转折' };
  const icons = { key: '⚿', star: '✶', moon: '☾', ticket: '▱', leaf: '❧', compass: '✥' };
  const button = (action, label, { id = '', css = '', disabled = false, attrs = '' } = {}) =>
    `<button type="button" data-action="${action}" data-id="${esc(id)}" class="${css}" ${disabled ? 'disabled' : ''} ${attrs}>${label}</button>`;

  function avatar(guest, large = false) {
    const url = image(large ? guest.portrait || guest.avatar : guest.avatar || guest.portrait);
    const single = esc([...guest.name][0]);
    return `<span class="portrait ${large && !image(guest.portrait) ? 'portrait-avatar' : ''}" aria-hidden="true"><span>${single}</span>${url ? `<img src="${esc(url)}" alt="" draggable="false">` : ''}</span>`;
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
      const assignee = quest?.status === 'assigned' && quest.charId === guest.id;
      const mood = talking ? line.mood : [...state.history.slice(0, state.cursor + 1)].reverse().find(item => item.charId === guest.id)?.mood;
      const css = ['seat', talking && 'is-speaking', away && 'is-away', offered && 'is-offered', picked && 'is-selected', assignee && 'is-assignee', n >= 45 && 'is-tipsy'].filter(Boolean).join(' ');
      return button('guest', `${avatar(guest, true)}
        <span class="seat-mood">${esc(away ? '奇遇途中' : offered ? '交付委托' : assignee ? '等候送行' : mood || '在座')}</span>
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
      html += esc(line.text.slice(offset, index)) + button('collect', esc(note.keyword), {
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
      <div class="speech-actions"><div class="quick-replies">${state.quickReplies.map(reply => button('reply', esc(reply), { id: reply, css: 'quiet', disabled: !!ui.busy })).join('')}</div>
        ${button('listen', esc(ui.busy || (more ? '继续倾听' : '继续闲聊')) + (!ui.busy ? ' <span aria-hidden="true">→</span>' : ''), { css: (crafting ? 'quiet' : 'primary') + ' listen', disabled: !!ui.busy })}</div>
      <div class="reply-form" id="reply-form"><input name="line" aria-label="老板搭话" placeholder="老板随口说一句…" maxlength="160" autocomplete="off" value="${esc(ui.reply)}">
      ${button('speak', '搭话 ↵', { disabled: !!ui.busy })}</div>`;
  }
  function board(state, ui) {
    const locked = !!ui.busy || state.phase !== 'CHATTING';
    const quest = state.quest;
    const shelf = state.notes.length ? state.notes.map(note => button('slot-note', `<strong>${esc(note.keyword)}</strong><small>${esc(note.summary)}</small>`, {
      id: note.id, css: 'note ' + (state.slots.includes(note.id) ? 'is-slotted' : ''),
      disabled: locked, attrs: `draggable="${!locked}" data-note="${esc(note.id)}" title="${esc(note.summary)}"`,
    })).join('') : '<p class="board-empty">从对话中点亮划线的流言，夹在这里。</p>';
    if (quest) return `<div class="board-layout"><div class="notes">${shelf}</div>
      <article class="quest-paper" draggable="${quest.status === 'draft' && !ui.busy}" data-quest="${esc(quest.questId)}">
        <span class="paper-kicker">委托 · ${{ draft: '待派单', assigned: '待送行', away: '已出发' }[quest.status]}</span>
        <h3>${esc(quest.title)}</h3><p>${esc(quest.synopsis)}</p>
        <div class="quest-stats">${quest.recommendedStats.map(id => `<span>${mix.get(mix.potions, id)?.label || ''}</span>`).join('')}</div>
        ${quest.status === 'draft' ? `<p class="quest-hint">${esc(quest.targetHint)}<br>拖给或点击高亮的来客。</p>${button('show-guests', '选接单人 ↑', { css: 'wax mobile-jump', disabled: !!ui.busy })}` : ''}
        ${quest.status === 'assigned' ? `<p class="quest-hint">为${esc(state.people[quest.charId]?.name)}调制送行特调。</p>${button('focus-workshop', '去调酒 →', { css: 'wax', disabled: !!ui.busy })}` : ''}
        ${quest.status === 'away' ? button('resolve', '等待归来 →', { css: 'wax', disabled: !!ui.busy }) : ''}
      </article></div>`;
    const filled = state.slots.filter(Boolean).length;
    return `<div class="board-layout"><div class="notes">${shelf}</div>
      <div class="quest-paper parchment"><div class="slots">${state.slots.map((id, index) => {
        const note = state.notes.find(item => item.id === id);
        return button('clear-slot', note ? `${esc(note.keyword)} <span aria-hidden="true">×</span>` : `<span>${String(index + 1).padStart(2, '0')}</span><span>放入一张便签</span>`, {
          id: index, css: 'slot' + (note ? ' is-filled' : ''), disabled: locked,
          attrs: `data-slot="${index}" aria-label="槽位 ${index + 1}${note ? '，移除' + esc(note.keyword) : '，待放入便签'}"`,
        });
      }).join('')}</div>
      ${button('synthesize', '<span aria-hidden="true">✦</span> 封成委托', { css: 'wax', disabled: locked || filled !== 3 })}</div></div>`;
  }

  const glassPaths = {
    gin_vodka: ['M25 35Q25 69 73 87L73 136Q73 141 46 143Q43 146 47 149H113Q117 146 114 143Q87 141 87 136V87Q135 69 135 35Z', 'M25 35Q25 69 80 89Q135 69 135 35Z'],
    whiskey_rum: ['M42 45H118L111 135Q110 144 100 145H60Q50 144 49 135Z', 'M42 45H118L111 131Q110 137 100 138H60Q50 137 49 131Z'],
    liqueur_sparkling: ['M60 20H100L98 69Q97 88 85 94V137Q86 141 109 143V149H51V143Q74 141 75 137V94Q63 88 62 69Z', 'M60 20H100L98 69Q97 87 80 95Q63 87 62 69Z'],
    coffee_tea: ['M40 49H120L113 118Q105 135 87 136V144H104V149H56V144H73V136Q55 135 47 118Z', 'M40 49H120L113 118Q80 149 47 118Z'],
  };
  function glass(recipe, id) {
    const [shape, bowl] = glassPaths[recipe.baseLiquor] || glassPaths.gin_vodka;
    const palette = mix.calculate(recipe).palette;
    const garnish = mix.get(mix.garnishes, recipe.garnish);
    const fills = palette.map((color, i) => `<stop offset="${15 + i * 79 / Math.max(1, palette.length - 1)}%" stop-color="${color}"/>`).join('');
    const liquid = recipe.baseLiquor ? `<g clip-path="url(#${id}-clip)">
      <path fill="url(#${id}-liquid)" fill-opacity=".86" d="M18 65Q43 54 80 62T142 61V144H18Z"/>
      <path fill="none" stroke="#ffdfb0" stroke-opacity=".7" d="M18 65Q43 54 80 62T142 61"/>
      ${[56, 70, 92, 105].map((x, i) => `<circle class="bubble" cx="${x}" cy="${84 + i * 7}" r="${2 + (i % 2)}" style="--delay:${-i * .58}s"/>`).join('')}</g>` : '';
    return `<svg class="glass-art" viewBox="0 0 160 160" aria-hidden="true">
      <defs><linearGradient id="${id}-glass"><stop stop-color="#ffead4" stop-opacity=".22"/><stop offset=".45" stop-color="#fff" stop-opacity=".02"/><stop offset="1" stop-color="#e7bdae" stop-opacity=".22"/></linearGradient>
      <linearGradient id="${id}-liquid" x2=".2" y2="1">${fills}${palette.length === 1 ? `<stop offset="1" stop-color="${palette[0]}" stop-opacity=".36"/>` : ''}</linearGradient>
      <clipPath id="${id}-clip"><path d="${bowl}"/></clipPath></defs>
      <ellipse cx="80" cy="149" rx="58" ry="7" fill="#000" opacity=".34"/>
      ${recipe.baseLiquor === 'coffee_tea' ? '<path d="M118 60C156 50 148 102 115 99" stroke="#eecaa1" fill="none" stroke-width="2"/>' : ''}
      <path d="${shape}" fill="url(#${id}-glass)" stroke="#ffe0b7" stroke-width="1.5"/>
      ${liquid}<path d="M64 69l6 10m-16-7l4 9m38-6l4-8" stroke="#fff1ca" stroke-opacity=".38" stroke-linecap="round" clip-path="url(#${id}-clip)"/>
      ${garnish ? `<text x="108" y="64" style="fill:${garnish.color}" font-size="27" transform="rotate(18 108 64)">${garnish.symbol}</text>` : ''}</svg>`;
  }
  function meters(recipe) {
    const { stats, tipsyDelta, chaos } = mix.calculate(recipe);
    const bar = (label, value, total, color = 'var(--amber)') => `<div class="meter"><span>${label}</span><i><b style="--amount:${Math.abs(value) / total * 100}%;--meter-color:${color}"></b></i></div>`;
    return `<div class="stat-list">${mix.potions.map(item => bar(item.label + ' ' + stats[item.id], stats[item.id], 3, item.color)).join('')}</div>
      <div class="effect-list">${bar('微醺 ' + (tipsyDelta < 0 ? '清零' : '+' + tipsyDelta), tipsyDelta, 100)}${bar('混乱 ' + chaos, chaos, 100, '#ec8a76')}</div>`;
  }
  function ingredients(recipe) {
    const base = mix.bases.map(item => button('base', `<i class="bottle"></i><span>${item.label}</span>`, {
      css: 'ingredient', id: item.id, attrs: `style="--ink:${item.color}" title="${item.name}" aria-label="${item.name} · ${item.label}" aria-pressed="${recipe.baseLiquor === item.id}"`,
    })).join('');
    const potion = mix.potions.map(item => {
      const n = recipe.potions.filter(id => id === item.id).length;
      return button('potion', `<i class="dropper"></i><span>${item.label}${n ? '×' + n : ''}</span>`, {
        css: 'ingredient', id: item.id, attrs: `style="--ink:${item.color}" aria-label="${item.name}，${item.label}" title="${item.name}" aria-pressed="${!!n}"`,
      });
    }).join('');
    const dots = `<div class="drop-count"><span>${recipe.potions.length}/3</span><i></i><i></i><i></i>${button('clear-potions', '×', { css: 'arrow', disabled: !recipe.potions.length, attrs: 'aria-label="清空魔药"' })}</div>`;
    const garnish = mix.garnishes.map(item => button('garnish', `<i aria-hidden="true">${item.symbol}</i><span>${item.label}</span>`, {
      css: 'ingredient', id: item.id, attrs: `style="--ink:${item.color}" title="${item.effect}" aria-pressed="${recipe.garnish === item.id}"`,
    })).join('');
    return { bases: base, potions: potion + dots, garnishes: garnish };
  }
  const chip = recipe => recipe.customIngredient ? `<span class="ingredient-chip">+ ${esc(recipe.customIngredient)}</span>` : '';
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
    const titles = { menu: '招牌酒单', wall: '纪念墙', people: '邻舍名录', saves: '存档与设置', report: '归来战报' };
    let content = '';
    if (kind === 'menu') content = `<div class="album-grid">${[...state.drinks].reverse().map(item => {
      const media = state.media[item.id];
      return `<article class="album-card">${printArt(item, media, 'drink')}<h3>${esc(media?.drinkName || mix.base(item.recipe).fallback)}</h3>
        <p>${esc(state.people[item.charId]?.name)} · Night ${item.night}</p><p>${esc(mix.recipeLabel(item.recipe))}</p>${chip(item.recipe)}
        <div class="card-actions">${promote(item.id, media)}</div></article>`;
    }).join('') || '<p class="empty">酒单空着，等第一杯特调。</p>'}</div>`;
    if (kind === 'wall') content = `<div class="album-grid wall-grid">${state.wall.map(id => state.reports.find(row => row.questId === id)).filter(Boolean).reverse().map(item =>
      `<article class="wall-card">${button('show-report', `${printArt(item, state.media[item.questId], 'photo')}
        <strong>${esc(item.outcome.polaroidCaption)}</strong><small>Night ${item.night} · ${esc(item.quest.title)}</small>`, { id: item.questId })}</article>`).join('')
      || '<p class="empty">把归来战报里的拍立得钉在这里。</p>'}</div>`;
    if (kind === 'people') content = `<div class="directory">${Object.values(state.people).map(guest => `<article>${avatar(guest)}
      <div><strong>${esc(guest.name)}</strong><small>${esc(guest.title || (state.guests.some(item => item.id === guest.id) ? '今夜来客' : '旧识'))}</small></div>
      <span>好感 ${state.affinity[guest.id] || 0} · ${tipsyLabel(state.tipsy[guest.id] || 0)}</span></article>`).join('')
      || '<p class="empty">开店后，来客就会出现在名录里。</p>'}</div>`;
    if (kind === 'saves') content = `<div class="save-controls"><label><input type="checkbox" id="illustrations" ${state.settings.illustrations ? 'checked' : ''}> 为新酒单和战报生成图片</label>
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

  window.TavernView = { esc, button, avatar, seats, dialogue, board, ingredients, glass, chip, meters, drawer, tipsyLabel };
})();
