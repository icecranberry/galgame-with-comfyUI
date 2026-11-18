/* Rendering only. Game state, persistence and RPC remain in app.js. */
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const image = value => /^\/(?:images|avatars|game-media)\/[\w./%?=& -]+$/.test(value || '') ? value : '';
  const colors = ['#b2424b', '#3266a5', '#a36d20', '#477b66', '#795391', '#a85535'];
  const ranks = { critical: '大成功', extreme: '极难成功', hard: '困难成功', regular: '普通成功', failure: '失败', fumble: '大失败' };
  const difficultyLabels = { regular: '普通', hard: '困难', extreme: '极难' };
  const modeLabels = { normal: '单骰', advantage: '优势', disadvantage: '劣势' };
  const button = (action, label, cls = '', attributes = '') => `<button type="button" data-action="${action}" class="${cls}" ${attributes}>${label}</button>`;
  function avatar(c) {
    const src = image(c.avatar || c.avatar_path || c.standing || c.standing_url);
    return `<img src="${esc(src || './portrait-placeholder.svg')}" alt="" loading="lazy" data-portrait-fallback>`;
  }
  function choices(id, items, chosen, label) {
    return `<div id="${id}" class="pill-group" role="group" aria-label="${esc(label)}" data-picker data-value="${esc(chosen)}">${items.map(item => button('choice', esc(item.label), `pill ${String(item.value) === String(chosen) ? 'selected' : ''}`, `data-value="${esc(item.value)}" aria-pressed="${String(item.value) === String(chosen)}"`)).join('')}</div>`;
  }
  const rollKey = roll => roll.logId || `${roll.name}|${roll.skillName}|${roll.value}|${roll.target}`;
  function parseRoll(log) {
    if (log.roll) return log.roll;
    const match = /^(.*?) · (.*?) (\d{1,3})\/(\d{1,3}) · (.+)$/.exec(log.dialogue || '');
    if (!match) return null;
    const rank = Object.keys(ranks).find(k => ranks[k] === match[5] || k === match[5]) || 'failure';
    return { name: match[1], skillName: match[2], value: Number(match[3]), target: Number(match[4]), rank, success: rank === 'critical' || (Number(match[3]) <= Number(match[4]) && !['failure', 'fumble'].includes(rank)) };
  }
  const diceNotation = roll => `${roll.kind === 'pool' && roll.rolls.length > 1 ? roll.rolls.length : ''}D${roll.sides || 100}`;
  const resultLabel = roll => roll.kind === 'pool' ? '合计' : !roll.success && !['failure', 'fumble'].includes(roll.rank) ? '未达难度' : ranks[roll.rank];
  function rollCard(roll, secret = false) {
    const pool = roll.kind === 'pool';
    const tone = pool ? '' : !roll.success ? 'failed' : ['critical', 'extreme'].includes(roll.rank) ? 'exceptional' : 'passed';
    const d20Details = roll.sides === 20 && !pool
      ? `${roll.rolls.join('／')}${roll.mode !== 'normal' ? `（${modeLabels[roll.mode]}取 ${roll.value}）` : ''} ${roll.modifier >= 0 ? '+' : '−'} ${Math.abs(roll.modifier)} · ` : '';
    const detail = pool ? roll.rolls.join(' + ') : `${d20Details}目标 ${roll.target} <span>${roll.success ? '检定通过' : '检定未通过'}</span>`;
    return `<article class="roll-card ${tone}" data-roll-key="${esc(rollKey(roll))}"><div class="roll-card-copy"><span class="roll-overline">${secret ? '暗骰 · ' : esc(roll.name) + ' · '}${diceNotation(roll)}</span><h3>${esc(roll.skillName)}</h3><p>${detail}</p></div><div class="roll-card-score"><strong>${roll.total ?? roll.value}</strong><span>${resultLabel(roll)}</span></div></article>`;
  }
  function logs(state, list) {
    return list.map((log, index) => {
      if (log.kind === 'dice') { const roll = parseRoll(log); if (roll) return rollCard(roll); }
      const characterIndex = state?.investigators.findIndex(c => log.actorId ? c.id === log.actorId : c.name === log.speaker) ?? -1;
      const narration = ['scene', 'ending', 'encounter'].includes(log.kind);
      const color = characterIndex >= 0 ? colors[characterIndex % colors.length] : '#8b6a31';
      return `<article class="log-entry ${esc(log.kind || 'dialogue')} ${narration ? 'is-narration' : ''}" style="--speaker-color:${color}" data-log-id="${esc(log.id || `pending-${index}`)}"><span class="log-speaker">${esc(narration ? log.kind === 'ending' ? '幕落' : '环境' : log.speaker)}</span><div class="log-copy"><p>${esc(log.dialogue)}</p>${log.action ? `<span class="log-action">${esc(log.action)}</span>` : ''}</div></article>`;
    }).join('');
  }
  function hud(state) {
    return state.investigators.map((c, i) => `<article class="investigator ${c.outOfAction ? 'retired' : ''} ${c.san / c.maxSan < .3 ? 'san-critical' : ''}" style="--character-color:${colors[i % colors.length]}"><div class="hud-portrait">${avatar(c)}${c.player ? '<span class="hud-you">你</span>' : ''}</div><div class="hud-details"><div class="investigator-name">${esc(c.name)}${c.outOfAction ? '<span>退场</span>' : c.insane ? '<span>疯狂</span>' : ''}</div><div class="meter-row"><span>HP</span><meter class="hp" min="0" max="${c.maxHp}" value="${c.hp}" aria-label="${esc(c.name)} HP"></meter><b>${c.hp}</b></div><div class="meter-row"><span>SAN</span><meter class="san" min="0" max="${c.maxSan}" value="${c.san}" aria-label="${esc(c.name)} SAN"></meter><b>${c.san}</b></div></div></article>`).join('');
  }
  function castFrame(state, ui, liveLine) {
    const player = { id: 'player', ...state.player, expressions: ui.castAssets.player.expressions };
    const keeperProfile = ui.characters.find(c => c.id === state.keeperId);
    const keeper = keeperProfile && { ...keeperProfile, id: String(keeperProfile.id), name: characterName(keeperProfile) };
    const investigators = state.investigators.filter(c => !c.player);
    const characters = [keeper, ...investigators].filter(Boolean).map(c => ({
      ...c, expressions: ui.castAssets.characters[c.id] || {},
    }));
    const people = [player, ...characters];
    const byId = new Map(people.map(person => [person.id, person]));
    const partner = characters.find(person => !person.outOfAction);
    const slots = [{ actor: player, expression: 'normal' }, partner ? { actor: partner, expression: 'normal' } : null];
    let side = state.mode === 'investigator' && partner ? 1 : 0;
    let currentLine;
    for (const log of [...state.publicLog, ...(liveLine ? [liveLine] : [])]) {
      if (log.kind !== 'dialogue' || (log.sceneId && log.sceneId !== state.scene.id)) continue;
      const actor = log.actorId ? byId.get(log.actorId) : people.find(person => person.name === log.speaker) || (state.mode === 'keeper' ? player : null);
      if (!actor) continue;
      const existing = slots.findIndex(slot => slot?.actor.id === actor.id);
      side = existing < 0 ? 1 - side : existing;
      slots[side] = { actor, expression: log.expressionSlot || 'normal' };
      currentLine = log;
    }
    return { slots, side, currentLine };
  }
  function setPortrait(figure, actor, expression) {
    const expressions = actor.expressions;
    const emotion = image(expressions[expression] || expressions.normal);
    const standing = image(actor.standing || actor.standing_url);
    const partial = image(Object.values(expressions)[0]);
    const source = emotion || standing || partial || image(actor.avatar || actor.avatar_path) || './portrait-placeholder.svg';
    if (figure.dataset.source === source) return;
    figure.dataset.source = source;
    const portrait = new Image();
    portrait.alt = '';
    portrait.className = emotion || partial && !standing ? 'expression-portrait' : standing ? 'standing-portrait' : 'avatar-portrait';
    portrait.src = source;
    const swap = () => {
      if (figure.dataset.source !== source || !figure.isConnected) return;
      const previous = [...figure.querySelectorAll('img')];
      figure.append(portrait);
      if (!previous.length || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        previous.forEach(img => img.remove());
        return;
      }
      portrait.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease' }).finished
        .catch(() => {}).finally(() => previous.forEach(img => img.remove()));
    };
    portrait.decode().then(swap, () => {
      portrait.className = 'avatar-portrait';
      portrait.src = './portrait-placeholder.svg';
      swap();
    });
  }
  function updateCast(stage, state, ui, liveLine) {
    const { slots, side, currentLine } = castFrame(state, ui, liveLine);
    slots.forEach((slot, index) => {
      let figure = stage.querySelector(`[data-cast-side="${index}"]`);
      if (!slot) { figure?.remove(); return; }
      if (figure?.dataset.actor !== slot.actor.id) {
        figure?.remove();
        figure = document.createElement('figure');
        figure.dataset.castSide = index;
        figure.dataset.actor = slot.actor.id;
        figure.className = 'cast-portrait';
        stage.append(figure);
      }
      const speaking = index === side;
      figure.classList.toggle('is-active', speaking);
      figure.setAttribute('aria-label', `${slot.actor.name}${speaking && currentLine ? '，当前发言' : ''}`);
      setPortrait(figure, slot.actor, slot.expression);
    });
    const caption = stage.querySelector('.stage-line');
    caption.hidden = !currentLine;
    if (currentLine) {
      caption.querySelector('strong').textContent = currentLine.speaker;
      caption.querySelector('p').textContent = currentLine.dialogue;
    }
  }
  function consoleMarkup(state, ui) {
    const actions = state.actions || [];
    const diceBlocked = state.pendingCheck || state.pendingTurn || state.outcome || state.ended ? 'disabled' : '';
    return `<section class="keeper-console"><div class="panel-heading"><span class="eyebrow">BEHIND THE STORY</span><h2>守秘人手记</h2></div><details class="keeper-truth"><summary>翻阅模组真相</summary><p class="secret-copy">${esc(state.scenario.keeperSecrets)}</p><p class="secret-copy">${esc(state.scenario.scenes.find(s => s.id === state.scene.id)?.hiddenNotes)}</p></details>
      ${actions.length ? `<section class="control-section"><h3>本幕关键动作</h3><div class="pill-group">${actions.map(action => button('scenario-action', esc(action.label), 'pill', `data-id="${esc(action.id)}" data-network ${action.available ? '' : 'disabled'}`)).join('')}</div></section>` : ''}
      <section class="control-section"><h3>转场</h3>${choices('scene', state.scenario.scenes.map(s => ({ value: s.id, label: s.name })), ui.sceneId, '选择场景')}${button('switch-scene', '进入这个场景 ↗', 'quiet-action', 'data-network')}</section>
      <section class="control-section"><h3>点名调查员</h3>${choices('target', state.investigators.map(c => ({ value: c.id, label: `${c.name}${c.outOfAction ? ' · 退场' : ''}` })), ui.controlChar, '选择调查员')}<h3>技能</h3>${choices('skill', ui.catalog.skills.map(s => ({ value: s, label: s })), ui.controlSkill, '选择技能')}<h3>难度</h3>${choices('difficulty', Object.entries(difficultyLabels).map(([value, label]) => ({ value, label })), ui.controlDifficulty, '检定难度')}<h3>骰型</h3>${choices('check-dice', [{ value: 'd20', label: 'D20' }, { value: 'd100', label: 'D100' }], ui.controlDice, '检定骰型')}${ui.controlDice === 'd20' ? `<h3>掷骰方式</h3>${choices('check-mode', Object.entries(modeLabels).map(([value, label]) => ({ value, label })), ui.controlMode, 'D20 掷骰方式')}` : ''}<div class="control-row">${button('manual-roll', `掷 ${ui.controlDice.toUpperCase()}`, 'ink-action', `data-network ${diceBlocked}`)}<label class="checkbox-label"><input id="secret-roll" type="checkbox" ${ui.fields['secret-roll'] ? 'checked' : ''}>暗骰</label></div>${ui.secretRoll ? rollCard(ui.secretRoll, true) : ''}</section>
      <section class="control-section"><h3>随机掷骰</h3><div class="control-row"><label for="pool-count">颗数</label><input id="pool-count" type="number" min="1" max="6" value="${esc(ui.fields['pool-count'] ?? 1)}"><label class="sr-only" for="pool-reason">掷骰用途</label><input id="pool-reason" maxlength="200" placeholder="用途，如伤害或随机事件" value="${esc(ui.fields['pool-reason'])}"></div><div class="pill-group">${(ui.catalog.diceSides || []).map(sides => button('pool-roll', `D${sides}`, 'pill', `data-sides="${sides}" data-network ${diceBlocked}`)).join('')}</div></section>
      <section class="control-section"><h3>身体与理智</h3><div class="stat-controls">${['HP −1', 'HP +1', 'SAN −1', 'SAN +1'].map((label, i) => button('stat', label, i < 2 ? 'stat-hp' : 'stat-san', `data-stat="${i}" data-network`)).join('')}</div><label class="sr-only" for="stat-reason">裁决原因</label><input id="stat-reason" placeholder="这次变化的原因…" value="${esc(ui.fields['stat-reason'])}"></section>
      <section class="control-section"><h3>交付线索</h3>${choices('clue', state.scenario.clues.map(c => ({ value: c.id, label: c.title })), ui.clueId, '选择线索')}<div class="control-row">${button('reveal-all', '交给全员', '', 'data-network')}${button('reveal-private', '只给此人', '', 'data-network')}</div></section>
      <section class="control-section"><h3>悄悄递一张纸条</h3><label class="sr-only" for="handout">密信内容</label><textarea id="handout" rows="3" maxlength="3000" placeholder="只有选中的调查员会读到…">${esc(ui.fields.handout)}</textarea>${button('handout', '传递密信 →', 'quiet-action', 'data-network')}</section>
      <section class="control-section"><h3>不速之客</h3><label class="sr-only" for="encounter">遭遇描述</label><input id="encounter" placeholder="来者、危险与现场变化…" value="${esc(ui.fields.encounter)}">${button('encounter', '触发遭遇 →', 'quiet-action', 'data-network')}</section></section>`;
  }
  function highlight(clue) {
    let content = esc(clue.content);
    const tokens = [...new Set([clue.requiredSkill, clue.title?.slice(-2)].filter(t => t && /^[\p{L}\p{N}]+$/u.test(t)))];
    for (const token of tokens) content = content.split(esc(token)).join(`<mark>${esc(token)}</mark>`);
    return content;
  }
  function handoutCard(handout) {
    return `<article class="handout-note secret-ho-card"><span class="evidence-label">${esc(handout.id)}</span><h3>${esc(handout.title)}</h3>
      <h4>表层身份</h4><p>${esc(handout.publicSummary)}</p>
      ${handout.secretContent ? `<h4>秘密与任务</h4><p>${esc(handout.secretContent)}</p>
        ${handout.recommendedTrait ? `<h4>扮演建议</h4><p>${esc(handout.recommendedTrait)}</p>` : ''}` : ''}</article>`;
  }
  function secretHandouts(state) {
    const keeper = state.mode === 'keeper';
    const own = state.investigators.find(actor => actor.player);
    const content = keeper ? state.investigators.map(actor =>
      `<details class="keeper-truth secret-ho-disclosure"><summary>${esc(actor.name)} · ${esc(actor.handout ? `${actor.hoId} ${actor.handout.title}` : '未分配 HO')}</summary>
        ${actor.handout ? handoutCard(actor.handout) : ''}
        ${state.ended ? '' : button('ho-focus-kp', '在 KP 控制台选中', 'quiet-action', `data-id="${esc(actor.id)}"`)}</details>`).join('')
      : own?.handout ? handoutCard(own.handout) : '<p class="empty-copy">本局没有分配秘密 HO。</p>';
    return `<section class="evidence-collection"><div class="panel-heading"><h2>${keeper ? '全员 HO 总览' : '我的秘密 HO'}</h2></div>${content}</section>`;
  }
  function clues(state) {
    const items = state.partyItems || [];
    const pocket = items.length ? `<section class="handout-note"><h3>队伍道具</h3><p>${items.map(item => `${esc(item.label)} · ${item.status === 'spent' ? '已使用' : '持有中'}`).join('<br>')}</p></section>` : '';
    return `<section class="evidence-collection"><div class="panel-heading"><span class="eyebrow">THINGS LEFT BEHIND</span><h2>线索背包 <small>${state.clues.length}</small></h2></div>${pocket}${state.clues.length ? state.clues.map((c, i) => `<button class="evidence-card ${c.isSecret ? 'is-private' : ''}" data-action="evidence" data-id="${esc(c.id)}"><span class="evidence-label">证物 ${String(i + 1).padStart(2, '0')}<span>${c.isSecret ? '私密' : '公开'}</span></span><h3>${esc(c.title)}</h3><p>${highlight(c)}</p><span class="evidence-bottom">${esc(c.requiredSkill || '现场发现')}<span aria-hidden="true">↗</span></span></button>`).join('') : '<p class="empty-copy">还没有留下可以拼合的碎片。</p>'}${Object.entries(state.handouts).filter(([, text]) => text).map(([id, content]) => `<article class="handout-note"><span class="eyebrow">PRIVATE NOTE</span><h3>交给 ${esc(state.investigators.find(c => c.id === id)?.name || '调查员')}</h3><p>${esc(content)}</p></article>`).join('')}</section>`;
  }
  function cards(state) {
    return `<section class="character-records"><div class="panel-heading"><span class="eyebrow">THE PEOPLE AT THIS TABLE</span><h2>调查员档案</h2></div>${state.investigators.map(c => `<article class="character-sheet"><header>${avatar(c)}<div><h3>${esc(c.name)}</h3><span>${c.outOfAction ? '已退场' : c.player ? '由你扮演' : '正在调查'}</span></div></header><div class="attribute-grid">${Object.entries(c.attributes).map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div><dl class="skill-list">${Object.entries(c.skills).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl><p>HP ${c.hp}/${c.maxHp} &nbsp; SAN ${c.san}/${c.maxSan} &nbsp; MP ${c.mp}</p><p>随身物品 · ${esc(c.inventory.join('、') || '暂无记录')}</p></article>`).join('')}</section>`;
  }
  function composer(state, ui) {
    const own = state.investigators.find(c => c.player);
    const replacement = state.investigators.some(c => c.outOfAction) && !state.ended;
    const availableExpressions = ui.castAssets.slots.filter(slot => ui.castAssets.player.expressions[slot.id]);
    const chooseExpression = availableExpressions.some(slot => slot.id !== 'normal') && !own?.outOfAction;
    const eligible = ui.characters.filter(c => c.id !== state.keeperId && !state.investigators.some(i => i.id === String(c.id)));
    return `<footer class="composer" ${ui.tab !== 'narrative' && !state.pendingCheck && !state.pendingTurn && !state.outcome ? 'hidden' : ''}>
      ${Number.isInteger(state.clockRemaining) && state.clockRemaining > 0 && !state.outcome ? `<p class="archive-note">倒计时剩余 ${state.clockRemaining} 回合</p>` : ''}
      ${state.pendingCheck ? `<div class="check-request"><div><span>${esc(state.investigators.find(c => c.id === state.pendingCheck.targetChar)?.name)} · 请求检定</span><strong>${esc(state.pendingCheck.skill)} · ${esc(difficultyLabels[state.pendingCheck.difficulty] || difficultyLabels.regular)}${state.pendingCheck.mode && state.pendingCheck.mode !== 'normal' ? ` · ${esc(modeLabels[state.pendingCheck.mode])}` : ''}</strong><small>${esc(state.pendingCheck.reason)}</small></div>${state.mode === 'keeper' ? button('roll', `掷 ${(state.pendingCheck.dice || 'd100').toUpperCase()}`, 'primary', 'data-network') : ''}</div>` : ''}
      ${replacement && !state.pendingTurn && !state.outcome && eligible.length ? `<details class="replacement"><summary>有人退场 · 引入替补</summary>${choices('replacement', eligible.map(c => ({ value: c.id, label: characterName(c) })), ui.replacementId, '选择替补')}${button('replacement', '邀请加入', 'quiet-action', 'data-network')}</details>` : ''}
      ${state.ended ? '<p class="archive-note">本局已落幕。留下的线索与故事，仍可随时翻阅。</p>' : `
        ${state.pendingCheck || state.pendingTurn || state.awaitingRuling || state.outcome ? '' : own?.outOfAction ? '<p class="archive-note">你已退场，可以继续旁观调查。</p>' : `
          ${state.mode === 'keeper' || chooseExpression ? `<div class="compose-tools">
            ${state.mode === 'keeper' ? `<label class="sr-only" for="npc-speaker">发言身份</label><input id="npc-speaker" placeholder="你的发言署名（可选）" value="${esc(ui.npcSpeaker)}">` : ''}
            ${chooseExpression ? `<label class="compose-emotion" for="player-expression"><span>我的表情</span><select id="player-expression" data-network>
              ${ui.castAssets.slots.filter(slot => slot.id === 'normal' || ui.castAssets.player.expressions[slot.id])
                .map(slot => `<option value="${esc(slot.id)}" ${slot.id === ui.playerExpression ? 'selected' : ''}>${esc(slot.name)}</option>`).join('')}
            </select></label>` : ''}
          </div>` : ''}
          <div class="compose-line"><label class="sr-only" for="message">发言与行动</label><textarea id="message" rows="2" maxlength="3000" placeholder="${state.mode === 'keeper' ? '描述此刻，或以 NPC 身份开口…' : '你打算做什么？'}">${esc(ui.draft)}</textarea>${button('send', '发送', 'send-button', 'data-network')}</div>
        `}
        <div class="compose-actions">${state.pendingBatch || ui.playing ? button('pause', '暂停 / 抢麦', 'quiet-action') : '<span id="working" role="status"></span>'}
          ${state.pendingCheck ? '' : state.pendingTurn ? button('next', '续跑本轮 →', 'primary', 'data-network') : state.proposedEnding ? button('finish-dialog', '确认结团 →', 'primary', 'data-network') : button('next', state.pendingBatch ? '继续播放 →' : state.awaitingRuling ? '裁定检定 →' : state.mode === 'keeper' ? '让调查员行动 →' : '继续调查 →', 'primary', 'data-network')}
        </div>`}
      </footer>`;
  }
  function table(state, ui) {
    const background = state.imageJobs.filter(j => j.status === 'done' && j.kind === 'scene' && j.sceneId === state.scene.id).at(-1);
    const tabs = [{ id: 'narrative', label: '叙事流' }, ...(state.mode === 'keeper' ? [{ id: 'keeper', label: 'KP 控制台' }] : []), { id: 'clues', label: '线索背包' },
      ...(state.hasSecretHO ? [{ id: 'ho', label: '秘密 HO' }] : []), { id: 'cards', label: '角色卡' }];
    const hoPanel = state.hasSecretHO ? `<section id="panel-ho" class="story-panel ${ui.tabChanged ? 'is-switching' : ''}" role="tabpanel" aria-labelledby="tab-ho" ${ui.tab === 'ho' ? '' : 'hidden'}>${secretHandouts(state)}</section>` : '';
    const rendered = logs(state, state.publicLog.filter(log => !ui.pendingRolls.has(log.id)));
    const extraRolls = ui.rolls.filter(roll => !state.publicLog.some(log => log.id === roll.logId));
    return `<main class="table narrative-table ${ui.entering ? 'is-entering' : ''}"><section class="visual-stage" aria-label="场景与人物">${ui.previousBackground ? `<div class="stage-backdrop has-image" style="--scene:url('${image(ui.previousBackground)}')"></div>` : ''}<div class="stage-backdrop ${background ? 'has-image' : ''} ${ui.backgroundChanged ? 'is-new-background' : ''}" ${background ? `style="--scene:url('${image(background.url)}')"` : ''}></div><div class="stage-grain" aria-hidden="true"></div><div class="stage-vignette" aria-hidden="true"></div>${button('exit-game', '← 游戏馆', 'stage-link stage-exit')}<header class="stage-navigation"><span class="mode-badge">${state.mode === 'keeper' ? '守秘人视角' : '调查员视角'}<i></i>第 ${state.round + 1} 轮</span><div>${button('lobby', '收起卷宗', 'stage-link')}${button('finish-dialog', state.ended ? '结团回忆' : '结团', 'stage-link', 'data-network')}</div></header><section class="hud" aria-label="调查员状态">${hud(state)}</section><div class="stage-cast"><div class="stage-line" hidden><strong></strong><p></p></div></div><div class="stage-caption"><span class="eyebrow">${esc(state.title)}</span><h2>${esc(state.scene.name)}</h2><span class="stage-caption-rule"></span></div>${state.ended ? '<span class="ended-stamp">本局落幕</span>' : ''}</section><aside class="narrative-column"><header class="story-heading"><span class="eyebrow">${esc(state.title)}</span><h1>${esc(state.scene.name)}</h1><div class="story-heading-rule"><span></span><i>✦</i><span></span></div></header><nav class="story-tabs" role="tablist" aria-label="调查桌">${tabs.map(tab => button('tab', tab.label, ui.tab === tab.id ? 'is-active' : '', `data-tab="${tab.id}" id="tab-${tab.id}" role="tab" aria-selected="${ui.tab === tab.id}" aria-controls="panel-${tab.id}" tabindex="${ui.tab === tab.id ? 0 : -1}"`)).join('')}</nav><div class="story-scroll" id="story-scroll"><section id="panel-narrative" class="story-panel ${ui.tabChanged ? 'is-switching' : ''}" role="tabpanel" aria-labelledby="tab-narrative" ${ui.tab === 'narrative' ? '' : 'hidden'}><div class="transcript" id="transcript" aria-label="本幕叙事">${rendered}${extraRolls.map(roll => rollCard(roll)).join('')}</div></section>${state.mode === 'keeper' ? `<section id="panel-keeper" class="story-panel ${ui.tabChanged ? 'is-switching' : ''}" role="tabpanel" aria-labelledby="tab-keeper" ${ui.tab === 'keeper' ? '' : 'hidden'}>${consoleMarkup(state, ui)}</section>` : ''}<section id="panel-clues" class="story-panel ${ui.tabChanged ? 'is-switching' : ''}" role="tabpanel" aria-labelledby="tab-clues" ${ui.tab === 'clues' ? '' : 'hidden'}>${clues(state)}</section>${hoPanel}<section id="panel-cards" class="story-panel ${ui.tabChanged ? 'is-switching' : ''}" role="tabpanel" aria-labelledby="tab-cards" ${ui.tab === 'cards' ? '' : 'hidden'}>${cards(state)}</section></div><div class="story-utilities">${button('lobby', '卷宗目录', 'quiet-action')}${button('history', '往日记录', 'quiet-action')}${button('images', '场景印相', 'quiet-action')}</div>${composer(state, ui)}</aside></main>`;
  }
  const lobbyIcons = {
    back: '<path d="m10 5-7 7 7 7M3 12h18"/>',
    forward: '<path d="m14 5 7 7-7 7M3 12h18"/>',
    grid: '<path d="M3 3h6v6H3zm12 0h6v6h-6zM3 15h6v6H3zm12 0h6v6h-6z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
    risk: '<path d="m12 3 10 17H2zM12 9v4m0 3v.1"/>',
    check: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m7.5 12 3 3 6-6"/>',
    eye: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
    search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/>',
    user: '<circle cx="12" cy="8" r="3"/><path d="M5 20v-2a7 5 0 0 1 14 0v2"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
  };
  const icon = name => `<svg class="lobby-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${lobbyIcons[name]}</svg>`;
  const sceneNumber = index => String(index + 1).padStart(2, '0');
  const version = scenario => scenario.briefing?.version ? `v${scenario.briefing.version}` : '';
  const saveTime = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const characterCollator = new Intl.Collator('zh-CN-u-co-pinyin', { sensitivity: 'base', numeric: true });
  const characterName = character => character.display_name || character.name || '';
  function scenarioList({ scenarios, scenario }) {
    return scenarios.map((item, i) => {
      const active = item === scenario;
      const tags = item.briefing?.tags?.join(' · ') || item.meta.era || '剧本';
      return button('choose-scenario', `<span class="scenario-index">${sceneNumber(i)}</span>
        <span class="scenario-row-copy"><strong>${esc(item.meta.title)}</strong><small>${esc(tags)}</small></span>
        <span class="scenario-version">${esc(version(item))}</span>`,
      `scenario-row case-tone-${i % 3}`, `id="scenario-row-${i}" data-id="${esc(item.id)}" aria-pressed="${active}" data-network`);
    }).join('') || '<p class="lobby-empty">暂无模组，可导入外部剧本。</p>';
  }
  function savedRuns(saves) {
    const run = save => {
      const date = new Date(save.updatedAt);
      const round = Number.isInteger(save.round) && save.round >= 0 ? `<span>第 ${save.round + 1} 轮</span>` : '';
      const time = Number.isFinite(date.getTime()) ? `<time datetime="${date.toISOString()}">${saveTime.format(date)}</time>` : '';
      const open = button('load', `<span class="save-copy"><strong>${esc(save.title)}</strong><small>${round}${time}</small></span>
        <span class="save-open">${save.ended ? '回顾' : '继续'} ${icon('forward')}</span>`, 'save-resume', `data-id="${esc(save.sessionId)}" data-network`);
      const remove = button('delete-save', icon('trash'), 'save-delete', `data-id="${esc(save.sessionId)}" aria-label="删除存档 ${esc(save.title)}" data-network`);
      return `<li class="lobby-save">${open}${remove}</li>`;
    };
    const archived = saves.filter(save => save.ended);
    const ongoing = saves.filter(save => !save.ended);
    return `${ongoing.length ? `<ul class="lobby-list">${ongoing.map(run).join('')}</ul>` : '<p class="lobby-empty">暂无进行中的牌局。</p>'}
      ${archived.length ? `<details class="lobby-archive"><summary>已结案 <span>${archived.length}</span></summary><ul class="lobby-list">${archived.map(run).join('')}</ul></details>` : ''}`;
  }
  function briefing({ scenarios, scenario, mode }) {
    if (!scenario) return '<p class="lobby-empty">导入剧本后即可查看简报。</p>';
    const { meta, opening, scenes, briefing: details = {} } = scenario;
    const metrics = [['clock', '预计时长', details.duration], ['layers', '场景数', `${scenes} 幕`], ['risk', '理智风险', details.risk]];
    const checklist = [['调查目标', details.objective], ['时代背景', meta.era], ['推荐人数', details.party]];
    return `<article class="briefing-document">
      <div class="briefing-kicker"><span>模组 ${sceneNumber(scenarios.indexOf(scenario))}</span>${scenario.draftId && mode === 'keeper' ? button('edit-scenario', '编辑导入剧本', 'briefing-edit', 'data-network') : ''}</div>
      <h1>${esc(meta.title)}</h1>
      ${opening ? `<p class="briefing-intro">${esc(opening)}</p>` : ''}
      <dl class="briefing-metrics">${metrics.map(([glyph, label, value]) => `<div>${icon(glyph)}<dt>${label}</dt><dd>${esc(value || '未标注')}</dd></div>`).join('')}</dl>
      <section class="scenario-log" aria-labelledby="scenario-log-title">
        <h2 id="scenario-log-title" class="lobby-subhead">模组要素预览 <span>SCENARIO LOG</span></h2>
        ${details.note ? `<blockquote>“${esc(details.note)}”</blockquote>` : ''}
        <dl class="briefing-checklist">${checklist.map(([label, value]) => `<div>${icon('check')}<dt>${label}</dt><dd>${esc(value || '未标注')}</dd></div>`).join('')}</dl>
      </section>
    </article>`;
  }
  function partyMode({ mode }) {
    return ['keeper', 'investigator'].map((value, i) => {
      const abbreviation = i ? 'PL' : 'KP';
      const title = i ? '担任调查员' : '担任守秘人';
      return button('lobby-mode', `${title} <small>${abbreviation}</small>`, '', `id="lobby-mode-${value}" data-mode="${value}" aria-pressed="${mode === value}" data-network`);
    }).join('');
  }
  function partyStatus({ mode, selected, limit, characters }) {
    const hint = selected.length > limit ? '当前阵容超出模组容量，请移除多余角色' :
      mode === 'keeper' ? `邀请 1–${limit} 位 AI 调查员` : characters.length ? '用眼睛指定守秘人，可另选队友' : '请先招募一位邻舍担任守秘人';
    return `<span>${hint}</span><strong>${mode === 'keeper' ? '调查员' : 'AI 队友'} ${selected.length} / ${limit}</strong>`;
  }
  const standingGroups = ['表情立绘齐全', '表情立绘待补齐', '没有表情立绘'];
  function standingRank(castAssets, expressions = {}) {
    const count = Object.keys(expressions).length;
    if (castAssets.slots.length && castAssets.slots.every(slot => expressions[slot.id])) return 0;
    return count ? 1 : 2;
  }
  function orderCharacters(characters, castAssets) {
    return [...characters].sort((a, b) =>
      standingRank(castAssets, castAssets.characters[a.id]) - standingRank(castAssets, castAssets.characters[b.id]) ||
      characterCollator.compare(characterName(a), characterName(b)));
  }
  function standingButton(subject, name, complete) {
    const label = complete ? '管理立绘' : '补齐立绘';
    return button('manage-standings', label, 'party-standing-link',
      `id="party-standing-${subject}" data-subject="${subject}" data-network aria-label="${label} · ${esc(name)}"`);
  }
  function roster({ mode, characters, selected, keeperId, castAssets, hoChoices, hoRows }) {
    const player = castAssets.player;
    const playerComplete = standingRank(castAssets, player.expressions) === 0;
    const playerRow = `<li class="party-self">${avatar(player)}<span class="party-person"><strong>${esc(player.name)}</strong>
      <small>你 · ${mode === 'keeper' ? '守秘人' : '调查员'}</small></span>${standingButton('player', '我', playerComplete)}</li>`;
    const preview = hoChoices.length ? `<li class="party-ho-preview"><h3>秘密 HO 分配</h3>
      ${hoRows.length ? `<ul>${hoRows.map(({ id, name, handout }) => `<li><span>${esc(id === 'player' ? '你' : name)}</span>
        ${handout ? button('preview-ho', `${esc(handout.id)} · ${esc(handout.title)}`, 'party-standing-link', `id="ho-preview-${esc(id)}" data-id="${esc(id)}" data-network`) : '<span>未分配</span>'}</li>`).join('')}</ul>` : '<p>选择调查员后自动分配。</p>'}</li>` : '';
    if (!characters.length) return playerRow + preview + '<li class="lobby-empty">先去邻舍酒馆邀请一位角色。</li>';
    let group = -1;
    const rows = orderCharacters(characters, castAssets).map(character => {
      const { id, personaSummary } = character;
      const name = characterName(character);
      const keeper = mode === 'investigator' && id === keeperId;
      const invited = selected.includes(id);
      const role = keeper ? '守秘人' : invited ? 'AI 调查员' : '';
      const rank = standingRank(castAssets, castAssets.characters[id]);
      const heading = rank === group ? '' : `<li class="party-group"><h3>${standingGroups[rank]}</h3></li>`;
      group = rank;
      const row = button('pick', `${avatar(character)}<span class="party-person"><strong>${esc(name)}</strong>
        <small title="${esc(personaSummary)}">${esc(personaSummary?.trim() || '邻舍角色')}</small></span>
        ${invited ? `<span class="party-role" title="AI 调查员">${icon('search')}</span>` : ''}
        <span class="party-dot" aria-hidden="true"></span>`, 'party-pick',
      `id="party-char-${id}" data-id="${id}" aria-label="${esc(role ? `${name} · ${role}` : name)}" aria-pressed="${keeper || invited}" data-network ${keeper ? 'disabled' : ''}`);
      const assignKeeper = mode === 'investigator' ? button('pick-keeper', `${icon('eye')}${keeper ? '<small>KP</small>' : ''}`, 'party-role-button',
        `id="pick-keeper-${id}" data-id="${id}" aria-label="设 ${esc(name)} 为守秘人" title="设 ${esc(name)} 为守秘人" aria-pressed="${keeper}" data-network`) : '';
      const reminder = rank > 0 && (keeper || invited) ? `<div class="party-standing-note"><span>${rank === 1 ? '表情立绘未齐' : '缺少表情立绘'}</span>${standingButton(id, name, false)}</div>` : '';
      return `${heading}<li class="party-row${keeper ? ' is-keeper' : ''}"><div class="party-member">${row}${assignKeeper}</div>${reminder}</li>`;
    }).join('');
    return playerRow + preview + '<li class="party-priority">优先邀请表情立绘齐全的角色</li>' + rows;
  }
  function launch({ canStart }) {
    return button('start', `<span>开始调查 <small>BEGIN INVESTIGATION</small></span>${icon('forward')}`, 'lobby-launch', `id="lobby-start" data-network ${canStart ? '' : 'disabled'}`);
  }
  function lobby(data) {
    return `<main class="lobby">
      <header class="lobby-nav">
        ${button('exit-game', `${icon('back')} 返回游戏馆`, 'lobby-nav-action', 'data-network')}
        <div class="lobby-nav-end"><span id="scenario-count">${data.scenarios.length} 个模组</span>${button('rules', '规则说明', 'lobby-nav-action', 'data-network')}</div>
      </header>
      <div class="lobby-grid">
        <section class="lobby-pane index-pane" aria-labelledby="scenario-directory-title">
          <h2 id="scenario-directory-title" class="lobby-heading">SCENARIOS ${icon('grid')}</h2>
          <div class="index-scroll">
            <div class="scenario-list" data-lobby-part="scenarioList" role="group" aria-label="选择模组">${scenarioList(data)}</div>
            ${button('jump-party', `配置阵容 ${icon('forward')}`, 'mobile-party-link')}
            <section class="saved-runs" aria-labelledby="saved-runs-title">
              <h3 id="saved-runs-title" class="lobby-subhead">往日牌局 <span>SAVED RUNS</span></h3>
              ${savedRuns(data.saves)}
            </section>
          </div>
          <div class="index-footer">${button('import-scenario', `${icon('plus')} <span>导入外部剧本 <small>.md / .txt / .json</small></span>`, 'scenario-import', 'id="scenario-import" data-network')}
            <input id="scenario-file" type="file" accept=".md,.txt,.json" hidden>
          </div>
        </section>
        <section class="lobby-pane briefing-pane" aria-label="模组简报" data-lobby-part="briefing">${briefing(data)}</section>
        <section class="lobby-pane party-pane" aria-labelledby="party-title">
          <header class="party-heading">
            <h2 id="party-title" class="lobby-heading" tabindex="-1">PARTY &amp; ROLES</h2>
            <div class="party-mode" data-lobby-part="partyMode" role="group" aria-label="你的身份">${partyMode(data)}</div>
            <p class="party-status" data-lobby-part="partyStatus" aria-live="polite">${partyStatus(data)}</p>
          </header>
          <ul class="lobby-list party-list" data-lobby-part="roster" aria-label="邻舍阵容">${roster(data)}</ul>
          <footer class="party-footer">
            <div class="party-options"><label class="checkbox-label"><input id="images-enabled" type="checkbox" ${data.imagesEnabled ? 'checked' : ''} data-network>生成场景图</label><span id="working" role="status"></span></div>
            <div data-lobby-part="launch">${launch(data)}</div>
          </footer>
        </section>
      </div>
    </main>`;
  }
  const diceScript = new URL('./vendor/dice-3d.js', document.currentScript.src);
  let diceModule;
  function loadDice3D() {
    diceModule ??= new Promise(resolve => {
      const script = document.createElement('script');
      script.src = diceScript;
      const finish = (api) => { script.remove(); resolve(api); };
      script.onload = () => finish(window.TrpgDice3D);
      script.onerror = () => finish(null);
      document.head.append(script);
    });
    return diceModule;
  }

  async function animateDice(roll, secret) {
    const layer = document.createElement('div');
    layer.className = 'dice-overlay';
    layer.innerHTML = `<div class="dice-canvas" aria-hidden="true"></div><div class="dice-caption">${diceNotation(roll)} · ${esc(secret ? '暗骰' : roll.skillName)}</div><div class="dice-value" aria-hidden="true" hidden>00</div><div class="dice-badge" role="status"></div><button type="button" class="dice-skip">跳过动画</button>`;
    document.body.append(layer);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const skip = new AbortController(), stage = new AbortController();
    const skipped = new Promise(resolve => skip.signal.addEventListener('abort', resolve, { once: true }));
    const stageStopped = new Promise(resolve => stage.signal.addEventListener('abort', () => resolve(false), { once: true }));
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const skipButton = layer.querySelector('.dice-skip');
    const digits = layer.querySelector('.dice-value');
    const reveal = () => {
      if (skip.signal.aborted) return;
      digits.hidden = true;
      layer.querySelector('.dice-caption').hidden = true;
      layer.querySelector('.dice-badge').innerHTML = rollCard(roll, secret);
    };
    layer.addEventListener('click', () => skip.abort());
    layer.addEventListener('keydown', event => { if (event.key === 'Escape') skip.abort(); });
    skip.signal.addEventListener('abort', () => stage.abort(), { once: true });
    skipButton.focus({ preventScroll: true });
    let deadline;
    try {
      let played = false;
      if (!reduced && (roll.sides || 100) === 100 && (roll.kind !== 'pool' || roll.rolls.length === 1)) {
        deadline = setTimeout(() => stage.abort(), 4800);
        const play = loadDice3D().then(api => !stage.signal.aborted && api?.play(layer.querySelector('.dice-canvas'), roll.value, stage.signal, reveal));
        played = await Promise.race([play.catch(() => false), stageStopped]);
        clearTimeout(deadline);
      }
      if (!played && !skip.signal.aborted) {
        stage.abort();
        if (!reduced) {
          digits.hidden = false;
          const count = roll.rolls?.length || 1, sides = roll.sides || 100;
          const update = () => {
            const values = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
            digits.textContent = roll.kind === 'pool' ? values.reduce((sum, value) => sum + value, 0) : roll.mode === 'disadvantage' ? Math.min(...values) : Math.max(...values);
          };
          update();
          const tick = setInterval(update, 65);
          await Promise.race([sleep(720), skipped]);
          clearInterval(tick);
        }
        reveal();
      }
      if (!skip.signal.aborted) await Promise.race([sleep(1050), skipped]);
      if (!reduced) {
        layer.classList.add('is-closing');
        await sleep(300);
      }
    } finally {
      clearTimeout(deadline);
      stage.abort();
      layer.remove();
    }
  }
  document.addEventListener('error', event => { const el = event.target; if (el instanceof HTMLImageElement && el.hasAttribute('data-portrait-fallback') && !el.src.endsWith('/portrait-placeholder.svg')) el.src = './portrait-placeholder.svg'; }, true);
  window.TrpgPresentation = { avatar, choices, logs, table, updateCast, lobby, scenarioList, briefing, partyMode, partyStatus, roster, orderCharacters, launch, consoleMarkup, rollCard, rollKey, animateDice, highlight, handoutCard };
})();
