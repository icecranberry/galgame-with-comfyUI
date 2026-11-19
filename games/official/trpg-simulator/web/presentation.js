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
  const resultLabel = roll => !roll.success && !['failure', 'fumble'].includes(roll.rank) ? '未达难度' : ranks[roll.rank];
  function rollCard(roll, secret = false, action = '', rolling = false) {
    const pool = roll.kind === 'pool';
    const d20 = roll.sides === 20 && !pool;
    const tone = rolling || pool ? '' : !roll.success ? 'failed' : ['critical', 'extreme'].includes(roll.rank) ? 'exceptional' : 'passed';
    const face = rolling ? '—' : roll.value;
    const score = rolling ? '—' : roll.total ?? roll.value;
    const skillValue = Number.isFinite(roll.skill)
      ? `（技能值 ${roll.skill}${roll.itemBonus ? '，含道具加成' : ''}）` : '';
    const formula = d20
      ? `<span class="roll-formula">骰面 ${face} ${roll.modifier >= 0 ? '+' : '−'} ${esc(roll.skillName)}修正 ${Math.abs(roll.modifier)}${skillValue || ' '}= ${score}</span>` : '';
    const selection = d20 && ['advantage', 'disadvantage'].includes(roll.mode)
      ? `<span>${modeLabels[roll.mode]}${rolling ? '' : ` · ${roll.rolls.join('／')}`}</span>` : '';
    const itemBonus = roll.itemBonus ? `${esc(roll.itemBonus.itemName)} +${roll.itemBonus.bonus} · ` : '';
    const checks = pool ? (rolling ? '' : roll.rolls.join(' + ')) :
      `${formula}${selection}<span>${itemBonus}目标 ${roll.target}</span>`;
    const status = rolling ? '掷骰中…' : pool ? '' : roll.success ? '检定通过' : '检定未通过';
    const label = pool ? '合计' : d20 ? '结算值' : '骰面';
    const key = rolling ? '' : ` data-roll-key="${esc(rollKey(roll))}"`;
    return `<article class="roll-card ${tone}"${key}>
      <div class="roll-card-copy">
        <span class="roll-overline">${secret ? '暗骰 · ' : esc(roll.name) + ' · '}${diceNotation(roll)}</span>
        <h3>${esc(roll.skillName)}</h3>
        <p>${checks}${status ? `<span>${status}</span>` : ''}</p>
      </div>
      <div class="roll-card-score">
        <span class="roll-score-label">${label}</span><strong>${score}</strong>${!rolling && !pool ? `<span>${resultLabel(roll)}</span>` : ''}
      </div>
      ${action ? `<div class="roll-card-actions">${action}</div>` : ''}
    </article>`;
  }
  const describeButton = (logId, checked) => button('describe-action', checked ? '描述检定结果' : '直接描述结果',
    'ink-action', `data-log="${esc(logId)}" data-network`);
  function isKeeperLine(state, log) {
    if (log?.kind !== 'dialogue') return false;
    const keeperId = state?.mode === 'keeper' ? 'player' : state?.keeperId;
    return log.actorId != null ? keeperId != null && String(log.actorId) === String(keeperId) : log.speaker === 'KP';
  }
  const speakerName = (name, keeper) => `${esc(name)}${keeper ? ' <span class="speaker-kp">KP</span>' : ''}`;
  function actionControls(state, log) {
    const action = state.declaration;
    if (!action || action.logId !== log.id || action.roll) return '';
    const actor = state.investigators.find(person => person.id === action.actorId);
    return `<div class="control-row action-ruling">${describeButton(log.id, false)}
      ${actor?.outOfAction ? '' : button('check-action', '要求检定', '', `data-log="${esc(log.id)}" data-network`)}</div>`;
  }
  function logs(state, list, { interactive = false, pendingRolls, characters = [] } = {}) {
    const jobs = new Map((state?.imageJobs || []).map(job => [job.id, job]));
    const declaration = interactive && state.declaration;
    const check = declaration?.roll;
    const pictureSource = interactive ? 'transcript' : 'history';
    const keeperName = state?.mode === 'keeper' ? state.player?.name :
      state?.publicLog?.findLast(log => isKeeperLine(state, log) && log.speaker && log.speaker !== 'KP')?.speaker ||
      characterName(characters.find(character => String(character.id) === String(state?.keeperId)));
    return list.map((log, index) => {
      if (log.kind === 'dice') {
        const roll = parseRoll(log);
        if (roll) return rollCard(roll, false, check?.logId === log.id ? describeButton(declaration.logId, true) : '');
      }
      const job = jobs.get(log.imageJobId);
      if (log.kind === 'illustration') {
        if (job?.kind === 'scene' && image(job.url)) return '';
        return `<figure class="story-illustration" data-log-id="${esc(log.id)}">${picture(job, state.ended, pictureSource)}</figure>`;
      }
      const characterIndex = state?.investigators.findIndex(c => log.actorId ? c.id === log.actorId : c.name === log.speaker) ?? -1;
      const narration = ['scene', 'ending', 'encounter'].includes(log.kind);
      const checkRequest = log.kind === 'check' && log.speaker === 'KP';
      const color = characterIndex >= 0 ? colors[characterIndex % colors.length] : '#8b6a31';
      const speaker = checkRequest ? keeperName || '检定请求' : narration ? log.kind === 'ending' ? '幕落' : '环境' : log.speaker;
      const keeper = checkRequest ? Boolean(keeperName) : isKeeperLine(state, log);
      const secretCard = check && !check.logId && declaration.logId === log.id && !pendingRolls?.has(rollKey(check))
        ? rollCard(check, true, describeButton(declaration.logId, true)) : '';
      const illustration = job ? `<figure class="story-illustration">${picture(job, state.ended, pictureSource)}</figure>` : '';
      return `<article class="log-entry ${esc(log.kind || 'dialogue')} ${narration ? 'is-narration' : ''}" style="--speaker-color:${color}" data-log-id="${esc(log.id || `pending-${index}`)}"><span class="log-speaker">${speakerName(speaker, keeper)}</span><div class="log-copy"><p>${esc(log.dialogue)}</p>${log.action ? `<span class="log-action">${esc(log.action)}</span>` : ''}${interactive ? actionControls(state, log) : ''}</div></article>${secretCard}${illustration}`;
    }).join('');
  }
  function picture(job, ended, source) {
    const url = image(job?.url);
    if (url) {
      const label = job.kind === 'scene' ? '跑团场景画面' : '跑团剧情画面';
      return button('preview-picture', `<img src="${esc(url)}" alt="${label}" loading="lazy">`, 'picture-open',
        `id="picture-${source}-${esc(job.id)}" aria-label="放大${label}" aria-haspopup="dialog"`);
    }
    if (job?.status === 'failed') {
      return `<figcaption class="picture-status">${esc(job.error || '显影中断')}${!ended && job.retryable ?
        button('retry-image', '重试', 'quiet-action', `data-id="${esc(job.id)}" data-network`) : ''}</figcaption>`;
    }
    return '<figcaption class="picture-status" role="status">正在显影…</figcaption>';
  }
  function imageCollection(state) {
    const descriptions = new Map(state.mode === 'keeper' ? state.publicLog.filter(log => log.imageJobId)
      .map(log => [log.id, log.description]) : []);
    return state.imageJobs.length ? state.imageJobs.map(job => `<figure class="image-proof">${picture(job, state.ended, 'proof')}
      ${job.url ? button('promote', '收藏到邻舍相册', '', `data-url="${esc(image(job.url))}" data-network`) : ''}
      ${descriptions.get(job.logId) ? `<details class="picture-description"><summary>画面描述</summary><p>${esc(descriptions.get(job.logId))}</p></details>` : ''}
      </figure>`).join('') : '<p class="empty-copy">还没有跑团印相。</p>';
  }
  function hud(state) {
    return state.investigators.map((c, i) => {
      const portrait = state.mode === 'keeper'
        ? button('hud-actor', avatar(c) + '<span class="hud-actor-menu" aria-hidden="true">…</span>', 'hud-portrait hud-actor-trigger',
          `id="hud-actor-${esc(c.id)}" data-target="${esc(c.id)}" aria-label="打开${esc(c.name)}的操作面板" aria-haspopup="dialog"`)
        : `<div class="hud-portrait">${avatar(c)}${c.player ? '<span class="hud-you">你</span>' : ''}</div>`;
      return `<article class="investigator ${c.outOfAction ? 'retired' : ''} ${c.san / c.maxSan < .3 ? 'san-critical' : ''}" style="--character-color:${colors[i % colors.length]}">${portrait}<div class="hud-details"><div class="investigator-name">${esc(c.name)}${c.outOfAction ? '<span>退场</span>' : c.insane ? '<span>疯狂</span>' : ''}</div><div class="meter-row"><span>HP</span><meter class="hp" min="0" max="${c.maxHp}" value="${c.hp}" aria-label="${esc(c.name)} HP"></meter><b>${c.hp}</b></div><div class="meter-row"><span>SAN</span><meter class="san" min="0" max="${c.maxSan}" value="${c.san}" aria-label="${esc(c.name)} SAN"></meter><b>${c.san}</b></div></div></article>`;
    }).join('');
  }
  function castFrame(state, ui) {
    const player = state.mode === 'investigator'
      ? { ...state.player, id: 'player', expressions: ui.castAssets.player.expressions } : null;
    const investigators = state.investigators.filter(c => !c.player).map(c => ({
      ...c, expressions: ui.castAssets.characters[c.id] || {},
    }));
    const people = player ? [player, ...investigators] : investigators;
    const byId = new Map(people.map(person => [String(person.id), person]));
    const [first, second] = people.filter(person => !person.outOfAction);
    const slots = [first, second].map(actor => actor ? { actor, expression: 'normal' } : null);
    let side = player && second ? 1 : 0;
    let currentLine, speakerId;
    for (const log of state.publicLog) {
      if (log.kind !== 'dialogue' || (log.sceneId && log.sceneId !== state.scene.id)) continue;
      const actor = isKeeperLine(state, log) ? null :
        log.actorId ? byId.get(String(log.actorId)) : people.find(person => person.name === log.speaker);
      currentLine = log;
      speakerId = actor?.id;
      if (actor) {
        const existing = slots.findIndex(slot => slot?.actor.id === actor.id);
        side = existing < 0 ? 1 - side : existing;
        slots[side] = { actor, expression: log.expressionSlot || 'normal' };
      }
      if (player && log.playerExpressionSlot && actor !== player) {
        const playerSide = slots.findIndex(slot => slot?.actor === player);
        slots[playerSide < 0 ? 1 - side : playerSide] = { actor: player, expression: log.playerExpressionSlot };
      }
    }
    return { slots, side, currentLine, speakerId };
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
  function updateCast(stage, state, ui) {
    const { slots, side, currentLine, speakerId } = castFrame(state, ui);
    const keeperSpeaking = isKeeperLine(state, currentLine);
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
      figure.classList.toggle('is-active', !keeperSpeaking && index === side);
      figure.setAttribute('aria-label', `${slot.actor.name}${slot.actor.id === speakerId ? '，当前发言' : ''}`);
      setPortrait(figure, slot.actor, slot.expression);
    });
    const caption = stage.querySelector('.stage-line');
    caption.classList.toggle('has-next-line', state.playbackRemaining > 0);
    caption.hidden = !currentLine;
    if (currentLine) {
      caption.querySelector('strong').innerHTML = speakerName(currentLine.speaker, keeperSpeaking);
      caption.querySelector('p').textContent = currentLine.dialogue;
    }
  }
  const itemPresets = {
    hp: { label: 'HP 变化', type: 'consumable', hp: true },
    san: { label: 'SAN 变化', type: 'consumable', san: true },
    recovery: { label: 'HP 和 SAN 变化', type: 'consumable', hp: true, san: true },
    tool: { label: '技能加值', type: 'tool' },
    key: { label: '关键物品', type: 'key' },
    gag: { label: '趣味杂物', type: 'gag' },
  };
  function optionList(options, current) {
    return options.map(({ value, label }) => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`).join('');
  }
  const liveActors = state => state.investigators.filter(actor => !actor.outOfAction);
  const actorOptions = actors => actors.map(actor => ({ value: actor.id, label: `${actor.name}${actor.outOfAction ? ' · 退场' : ''}` }));
  function grantItemForm(ui, target) {
    const amount = (id, label, min, max, value) => `<label>${label}<input name="${id}" type="number" min="${min}" max="${max}" value="${value}" required data-network></label>`;
    return `<form id="give-item-form" class="item-grant-form" autocomplete="off" data-target="${esc(target)}">
      <div class="item-grant-grid">
        <div class="item-grant-field"><label for="grant-preset">效果预设</label><select id="grant-preset" class="trpg-select" name="preset" data-network>${optionList(Object.entries(itemPresets).map(([value, { label }]) => ({ value, label })), 'hp')}</select></div>
        ${amount('uses', '次数（-1 为不限次）', -1, 99, 1)}
        <label class="item-full">名称<input name="name" maxlength="80" required data-network></label>
        <label class="item-full">描述<textarea name="desc" rows="2" maxlength="600" data-network></textarea></label>
        <div class="item-grant-field" data-grant-effect="hp">${amount('hp', 'HP', -100, 100, 2)}</div>
        <div class="item-grant-field" data-grant-effect="san" hidden>${amount('san', 'SAN', -100, 100, 2)}</div>
        <div class="item-grant-field" data-grant-effect="tool" hidden><label for="grant-skill">技能</label><select id="grant-skill" class="trpg-select" name="skill" data-network>${optionList(ui.catalog.skills.map(skill => ({ value: skill, label: skill })), '锁匠')}</select></div>
        <div class="item-grant-field" data-grant-effect="tool" hidden>${amount('bonus', '加值', 1, 99, 15)}</div>
      </div>
      <div class="dialog-footer">
        ${turnButton('random-item', '随机场景道具', 'quiet-action')}
        ${button('give-item', '发放', 'primary', 'id="give-item-submit" data-network')}
      </div>
    </form>`;
  }
  function checkForm(state, ui, declaration, pinnedActor) {
    const skill = declaration?.suggestedSkill || '侦查';
    const dice = skill === '理智' ? 'd100' : 'd20';
    const actors = liveActors(state);
    const target = actors.find(person => person.id === ui.controlChar) || actors[0];
    const actor = declaration && state.investigators.find(person => person.id === declaration.actorId);
    return `<section class="control-section check-form" data-log="${esc(declaration?.logId || '')}" data-target="${esc(pinnedActor?.id)}">
      ${declaration ? `<p class="field-note">${esc(actor.name)} · ${esc(declaration.reason)}</p>`
        : pinnedActor ? '' : `<h3>调查员</h3>${choices('check-target', actorOptions(actors), target?.id, '检定对象')}`}
      <h3>检定技能</h3><p class="field-note check-skill-hint">检定按角色卡上所选技能的数值判定。找线索用「侦查」，听门后的动静用「聆听」。</p>
      ${choices('skill', ui.catalog.skills.map(value => ({ value, label: value })), skill, '选择技能')}
      <h3>难度</h3>${choices('difficulty', Object.entries(difficultyLabels).map(([value, label]) => ({ value, label })), 'regular', '检定难度')}
      <h3>骰型</h3>${choices('check-dice', [{ value: 'd20', label: 'D20' }, { value: 'd100', label: 'D100' }], dice, '检定骰型')}
      <h3 data-d20 ${dice === 'd20' ? '' : 'hidden'}>掷骰方式</h3><div data-d20 ${dice === 'd20' ? '' : 'hidden'}>${choices('check-mode', Object.entries(modeLabels).map(([value, label]) => ({ value, label })), 'normal', 'D20 掷骰方式')}</div>
      <div class="control-row">${button('manual-roll', `掷 ${dice.toUpperCase()}`, 'ink-action', `data-network ${actors.length ? '' : 'disabled'}`)}<label class="checkbox-label"><input id="secret-roll" type="checkbox">暗骰</label></div>
      ${declaration || pinnedActor ? '' : `<details class="item-grant"><summary>随机掷骰</summary><div class="control-row"><label for="pool-count">颗数</label><input id="pool-count" type="number" min="1" max="6" value="1"><input id="pool-reason" aria-label="掷骰用途" placeholder="伤害或随机事件" maxlength="200"></div><div class="pill-group">${ui.catalog.diceSides.map(sides => button('pool-roll', `D${sides}`, 'pill', `data-sides="${sides}" data-network`)).join('')}</div></details>`}
    </section>`;
  }
  function privateClues(scenario) {
    const shared = new Set((scenario.rules?.items || []).map(item => item.clueId));
    return scenario.clues.filter(clue => !shared.has(clue.id));
  }
  function actorStats(actor) {
    return `<span>HP <b>${esc(actor.hp)}</b><span>/${esc(actor.maxHp)}</span></span>
      <span>SAN <b>${esc(actor.san)}</b><span>/${esc(actor.maxSan)}</span></span>`;
  }
  const keeperCommand = (tool, label, disabled, attributes) => button('keeper-tool', label, 'keeper-command',
    `data-tool="${tool}" data-network ${attributes} ${disabled ? 'disabled' : ''}`);
  function actorCommands(state, actor, pinned = false) {
    const locked = state.ended || state.outcome || state.pendingCheck;
    const attributes = tool => pinned ? `data-target="${esc(actor.id)}"` : `id="kp-command-${tool}"`;
    return `<div class="keeper-commands">
      ${button('temporary-check', '临时检定', 'keeper-command keeper-command-check', `${attributes('check')} data-network ${locked || !actor || actor.outOfAction ? 'disabled' : ''}`)}
      ${keeperCommand('stat', '调整状态', locked || !actor, attributes('stat'))}
      ${keeperCommand('give-item', '发放道具', state.ended || state.outcome || !actor || actor.outOfAction, attributes('give-item'))}
      ${keeperCommand('handout', '传递密信', locked || !actor, attributes('handout'))}
      ${keeperCommand('private-clue', '私发线索', locked || !actor || !privateClues(state.scenario).length, attributes('private-clue'))}
    </div>`;
  }
  function keeperActorPanel(state, actor) {
    return `<section class="keeper-actor-panel">
      <div class="keeper-actor-stats" aria-label="当前调查员状态">${actorStats(actor)}</div>
      ${actorCommands(state, actor, true)}
      <p class="field-note keeper-actor-wait" hidden>当前回合进行中，结束后可使用个人操作。</p>
    </section>`;
  }
  function keeperDialog(state, ui, tool) {
    const actor = state.investigators.find(person => person.id === ui.controlChar);
    const target = actor?.id;
    const footer = (action, label, attrs = '') => `<div class="dialog-footer">${button(action, label, 'primary', `data-network ${attrs}`)}</div>`;
    const targetAttr = `data-target="${esc(target)}"`;
    switch (tool) {
      case 'stat':
        return { title: `调整状态 · ${actor.name}`, content: `
          <div class="keeper-actor-stats" id="stat-current">${actorStats(actor)}</div>
          <label for="stat-reason">调整原因</label><input id="stat-reason" maxlength="200" required data-network>
          <div class="stat-controls keeper-stat-controls">${['HP −1', 'HP +1', 'SAN −1', 'SAN +1'].map((label, i) =>
            button('stat', label, i < 2 ? 'stat-hp' : 'stat-san', `data-stat="${i}" ${targetAttr} data-network`)).join('')}</div>` };
      case 'private-clue':
      case 'public-clue': {
        const shared = tool === 'public-clue';
        const clues = shared ? state.scenario.clues : privateClues(state.scenario);
        return { title: shared ? '公开线索' : `私发线索 · ${actor.name}`, content: `
          <label for="clue">线索</label><select id="clue" class="trpg-select" data-network>
            ${optionList([{ value: '', label: '请选择线索' }, ...clues.map(clue => ({ value: clue.id, label: clue.title }))], '')}</select>
          <p id="keeper-clue-preview" class="field-note" hidden></p>
          ${footer(shared ? 'reveal-all' : 'reveal-private', shared ? '公开给全桌' : '发送线索', targetAttr)}` };
      }
      case 'handout':
        return { title: `传递密信 · ${actor.name}`, content: `<label for="handout">密信内容</label>
          <textarea id="handout" rows="3" maxlength="3000" required data-network></textarea>${footer('handout', '发送密信', targetAttr)}` };
      case 'give-item':
        return { title: `发放道具 · ${actor.name}`, content: grantItemForm(ui, target) };
      case 'party-item':
        return { title: '共享道具 · 全队', content: grantItemForm(ui, 'party') };
      case 'scene':
        return { title: '切换场景', content: `<label for="scene">目标场景</label><select id="scene" class="trpg-select" data-network>
          ${optionList(state.scenario.scenes.map(scene => ({ value: scene.id, label: scene.name })), state.scene.id)}</select>
          ${footer('switch-scene', '进入场景')}` };
      case 'encounter':
        return { title: '触发遭遇', content: `<label for="encounter">遭遇描述</label>
          <textarea id="encounter" rows="3" maxlength="1000" placeholder="来者、危险与现场变化…" required data-network></textarea>${footer('encounter', '触发遭遇')}` };
    }
  }
  function consoleMarkup(state, ui) {
    const actions = state.actions || [];
    const actor = state.investigators.find(person => person.id === ui.controlChar);
    const locked = state.ended || state.outcome || state.pendingCheck;
    const command = (tool, label, disabled) => keeperCommand(tool, label, disabled, `id="kp-command-${tool}"`);
    return `<section class="keeper-console">
      <section class="keeper-workspace"><h2>调查员</h2>
        ${choices('target', actorOptions(state.investigators), ui.controlChar, '当前调查员')}
        ${actor ? `<div class="keeper-actor-stats" aria-label="当前调查员状态">${actorStats(actor)}</div>` : ''}
        ${actorCommands(state, actor)}
        ${ui.secretRoll && !ui.secretRoll.actionLogId ? rollCard(ui.secretRoll, true) : ''}
      </section>
      <section class="keeper-workspace"><h2>全桌</h2>
        <div class="keeper-commands">
          ${command('public-clue', '公开线索', locked || !state.scenario.clues.length)}
          ${command('party-item', '共享道具', state.ended || state.outcome)}
          ${command('scene', '切换场景', locked || state.scenario.scenes.length < 2)}
          ${command('encounter', '触发遭遇', locked)}
        </div>
        ${actions.length ? `<h3 class="keeper-action-heading">本幕关键动作</h3><div class="pill-group">${actions.map(action =>
          button('scenario-action', esc(action.label), 'pill', `data-id="${esc(action.id)}" data-network ${action.available ? '' : 'disabled'}`)).join('')}</div>` : ''}
      </section>
      <details id="keeper-truth" class="keeper-truth" ${ui.truthOpen ? 'open' : ''}><summary>翻阅模组真相</summary>
        <p class="secret-copy">${esc(state.scenario.keeperSecrets)}</p><p class="secret-copy">${esc(state.scenario.scenes.find(s => s.id === state.scene.id)?.hiddenNotes)}</p>
      </details>
    </section>`;
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
    return `<section class="evidence-collection">${state.clues.length ? state.clues.map((c, i) => `<button class="evidence-card ${c.isSecret ? 'is-private' : ''}" data-action="evidence" data-id="${esc(c.id)}"><span class="evidence-label">证物 ${String(i + 1).padStart(2, '0')}<span>${c.isSecret ? '私密' : '公开'}</span></span><h3>${esc(c.title)}</h3><p>${highlight(c)}</p><span class="evidence-bottom">${esc(c.requiredSkill || '现场发现')}<span aria-hidden="true">↗</span></span></button>`).join('') : '<p class="empty-copy">还没有留下可以拼合的碎片。</p>'}${Object.entries(state.handouts).filter(([, text]) => text).map(([id, content]) => `<article class="handout-note"><span class="eyebrow">PRIVATE NOTE</span><h3>交给 ${esc(state.investigators.find(c => c.id === id)?.name || '调查员')}</h3><p>${esc(content)}</p></article>`).join('')}</section>`;
  }
  const itemIcons = {
    consumable: '<path d="M4 6h16v14H4zM8 6V4h8v2m-7 7h6m-3-3v6"/>',
    tool: '<path d="M14 5a5 5 0 0 0-6 6l-5 5 3 3 5-5a5 5 0 0 0 6-6l-3 3-3-3z"/>',
    key: '<path d="M14 4a4 4 0 1 1-3.5 6L4 17v3h3v-2h2v-2l3.5-3.5"/>',
    gag: '<path d="M4 9h16v4H4zm2 4h12v8H6zm6-4v12m0-12c-7 0-6-7-2-4l2 4c7 0 6-7 2-4z"/>',
  };
  function itemCard(item, owner, actor, locked) {
    const { hpDelta, sanDelta, skillBonus } = item.effect || {};
    const badge = (label, delta) => delta ? `<span>${esc(label)} ${delta > 0 ? '+' : '−'}${Math.abs(delta)}</span>` : '';
    const effects = badge('HP', hpDelta) + badge('SAN', sanDelta) + (skillBonus ? badge(skillBonus.skill, skillBonus.bonus) : '');
    const armed = skillBonus && actor?.skillBuffs?.[skillBonus.skill];
    const disabled = locked || item.uses === 0 || !actor || actor.outOfAction || armed;
    return `<article class="pack-item pack-item--${esc(item.type)}">
      <svg class="pack-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${itemIcons[item.type] || itemIcons.key}</svg>
      <div class="pack-item-copy">
        <h3>${esc(item.name)}</h3>
        <div class="pack-item-meta"><span>${esc(owner)}</span><span>${item.uses === -1 ? '不限次' : item.uses === 0 ? '已耗尽' : `剩余 ${item.uses} 次`}</span></div>
        ${item.desc ? `<p>${esc(item.desc)}</p>` : ''}
        <div class="pack-item-effects">${effects || (item.type === 'key' ? '<span>关键物品</span>' : '<span>趣味杂物</span>')}${armed ? '<span class="pack-effect-armed">加值已备好</span>' : ''}</div>
      </div>
      ${button('use-item', '使用', 'ink-action pack-use', `data-id="${esc(item.id)}" data-target="${esc(actor?.id)}" aria-label="使用 ${esc(item.name)}" data-network ${disabled ? 'disabled' : ''}`)}
    </article>`;
  }
  function packItems(state, ui) {
    const actors = liveActors(state), personal = state.investigators;
    const keeper = state.mode === 'keeper';
    const shared = state.partyInventory || [];
    const actor = keeper ? actors.find(c => c.id === ui.packActor) || actors.find(c => c.id === ui.controlChar) || actors[0] : actors.find(c => c.player);
    const locked = state.ended || state.outcome || state.pendingTurn || state.playbackRemaining || state.awaitingItem;
    const items = [
      ...shared.map(item => ({ item, owner: '全队共享', actor })),
      ...personal.flatMap(c => (c.inventory || []).map(item => ({ item, owner: c.name, actor: c }))),
    ].sort((a, b) => Number(a.item.uses === 0) - Number(b.item.uses === 0));
    return `${keeper && shared.some(item => item.uses !== 0) && actors.length ? `<div class="pack-actor"><label for="pack-actor">共享道具使用者</label>
      <select id="pack-actor" class="trpg-select" data-network>${optionList(actorOptions(actors), actor?.id)}</select></div>` : ''}
      <div class="pack-items">${items.length ? items.map(entry => itemCard(entry.item, entry.owner, entry.actor, locked)).join('') : '<p class="empty-copy">行囊里还没有道具。</p>'}</div>`;
  }
  function backpack(state, ui) {
    const tab = ui.packTab || 'dossier';
    const tabs = [['dossier', '线索卷宗'], ['items', '随身道具']];
    return `<nav class="pack-tabs" role="tablist" aria-label="行囊背包">
      ${tabs.map(([id, title]) => button('pack-tab', title, 'pill',
        `data-tab="${id}" id="pack-tab-${id}" role="tab" aria-selected="${tab === id}" aria-controls="pack-panel-${id}" tabindex="${tab === id ? 0 : -1}"`)).join('')}
      </nav>
      ${tabs.map(([id]) => `<div id="pack-panel-${id}" class="pack-panel ${ui.packTabChanged && tab === id ? 'is-switching' : ''}"
        role="tabpanel" aria-labelledby="pack-tab-${id}" ${tab === id ? '' : 'hidden'}>
        ${tab === id ? (id === 'items' ? packItems(state, ui) : clues(state)) : ''}
      </div>`).join('')}`;
  }
  function cards(state) {
    return `<section class="character-records"><div class="panel-heading"><span class="eyebrow">THE PEOPLE AT THIS TABLE</span><h2>调查员档案</h2></div>${state.investigators.map(c => `<article class="character-sheet"><header>${avatar(c)}<div><h3>${esc(c.name)}</h3><span>${c.outOfAction ? '已退场' : c.player ? '由你扮演' : '正在调查'}</span></div></header><div class="attribute-grid">${Object.entries(c.attributes).map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div><dl class="skill-list">${Object.entries(c.skills).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl><p>HP ${c.hp}/${c.maxHp} &nbsp; SAN ${c.san}/${c.maxSan} &nbsp; MP ${c.mp}</p><p>随身物品 · ${esc(c.inventory.map(item => item.name).join('、') || '暂无记录')}</p></article>`).join('')}</section>`;
  }
  function turnButton(action, label, classes, attributes = '') {
    return button(action, `<span class="turn-button-label"><span>${label}</span></span><span class="turn-button-wait" aria-hidden="true">正在推演…</span>`,
      classes, `data-network data-wait-label ${attributes}`);
  }
  const playerTurnLabel = draft => draft.trim() ? '发送' : '继续行动';
  function composer(state, ui) {
    const own = state.investigators.find(c => c.player);
    const nextFrame = state.playbackRemaining > 0;
    const needsPlayback = nextFrame || state.pendingTurn;
    const available = !state.declaration && !needsPlayback && !state.pendingCheck && !state.awaitingRuling && !state.awaitingItem && !state.outcome && !state.proposedEnding;
    const inlineTurn = state.mode === 'investigator' && available && !own?.outOfAction;
    const eligible = ui.characters.filter(c => c.id !== state.keeperId && !state.investigators.some(i => i.id === String(c.id)));
    const replacement = available && eligible.length && state.investigators.some(c => c.outOfAction);
    let primary = '';
    if (ui.thinking && needsPlayback) primary = turnButton('waiting', '继续行动', 'primary', 'aria-busy="true" disabled');
    else if (!nextFrame) {
      if (state.pendingTurn) primary = turnButton('next', '续跑本轮 →', 'primary');
      else if (state.proposedEnding) primary = button('finish-dialog', '确认结团 →', 'primary', 'data-network');
      else if (!inlineTurn && !state.declaration && (!state.pendingCheck || state.mode === 'investigator')) {
        const label = state.awaitingItem ? '裁定道具 →' : state.pendingCheck || state.awaitingRuling ? '裁定检定 →' : state.mode === 'keeper' ? '自由行动 →' : '继续行动 →';
        primary = turnButton('next', label, 'primary');
      }
    }
    const hidden = nextFrame && !ui.thinking || ui.tab !== 'narrative' && !needsPlayback && !state.pendingCheck && !state.outcome;
    return `<footer class="composer" ${hidden ? 'hidden' : ''}>
      ${Number.isInteger(state.clockRemaining) && state.clockRemaining > 0 && !state.outcome ? `<p class="archive-note">倒计时剩余 ${state.clockRemaining} 回合</p>` : ''}
      ${state.pendingCheck ? `<div class="check-request"><div><span>${esc(state.investigators.find(c => c.id === state.pendingCheck.targetChar)?.name)} · 请求检定</span><strong>${esc(state.pendingCheck.skill)} · ${esc(difficultyLabels[state.pendingCheck.difficulty] || state.pendingCheck.difficulty)}${state.pendingCheck.mode && state.pendingCheck.mode !== 'normal' ? ` · ${esc(modeLabels[state.pendingCheck.mode])}` : ''}</strong><small>${esc(state.pendingCheck.reason)}</small></div>${state.mode === 'keeper' ? button('roll', `掷 ${(state.pendingCheck.dice || 'd100').toUpperCase()}`, 'primary', 'data-network') : ''}</div>` : ''}
      ${replacement && !state.ended ? `<details class="replacement"><summary>有人退场 · 引入替补</summary>${choices('replacement', eligible.map(c => ({ value: c.id, label: characterName(c) })), ui.replacementId, '选择替补')}${turnButton('replacement', '邀请加入', 'quiet-action')}</details>` : ''}
      ${state.ended ? '<p class="archive-note">本局已落幕。留下的线索与故事，仍可随时翻阅。</p>' : `
        ${!available ? '' : own?.outOfAction ? '<p class="archive-note">你已退场，可以继续旁观调查。</p>' : `
          <div class="action-suggestions" aria-label="行动方向" role="group">${ui.suggestions.map(suggestion => button('suggest-action', esc(suggestion), 'pill', 'data-network')).join('')}</div>
          ${state.mode === 'keeper' ? `<label class="sr-only" for="npc-speaker">发言身份</label><input id="npc-speaker" placeholder="你的发言署名（可选）" value="${esc(ui.npcSpeaker)}" data-network>` : ''}
          <div class="compose-line"><label class="sr-only" for="message">发言与行动</label><textarea id="message" rows="2" maxlength="3000" placeholder="${state.mode === 'keeper' ? '描述此刻，或以 NPC 身份开口…' : '你打算做什么？'}" data-network>${esc(ui.draft)}</textarea>${turnButton(inlineTurn ? 'next' : 'send', inlineTurn ? playerTurnLabel(ui.draft) : '发送', 'send-button', 'id="send-message"')}</div>
        `}
        <div class="compose-actions">
          ${available && state.mode === 'keeper' && state.imagesEnabled ? `<label class="checkbox-label turn-illustration"><input id="turn-illustration" type="checkbox" role="switch" ${ui.turnIllustration ? 'checked' : ''} data-network>配图</label>` : ''}
          <span id="working" role="status"></span>${primary}
        </div>`}
    </footer>`;
  }
  function table(state, ui) {
    const background = state.imageJobs.filter(j => j.status === 'done' && j.kind === 'scene' && j.sceneId === state.scene.id).at(-1);
    const tabs = [{ id: 'narrative', label: '叙事流' }, ...(state.mode === 'keeper' ? [{ id: 'keeper', label: 'KP 控制台' }] : []), { id: 'clues', label: '行囊背包' },
      ...(state.hasSecretHO ? [{ id: 'ho', label: '秘密 HO' }] : []), { id: 'cards', label: '角色卡' }];
    const hoPanel = state.hasSecretHO ? `<section id="panel-ho" class="story-panel ${ui.tabChanged ? 'is-switching' : ''}" role="tabpanel" aria-labelledby="tab-ho" ${ui.tab === 'ho' ? '' : 'hidden'}>${secretHandouts(state)}</section>` : '';
    const rendered = logs(state, state.publicLog.filter(log => !ui.pendingRolls.has(log.id)),
      { interactive: true, pendingRolls: ui.pendingRolls, characters: ui.characters });
    const extraRolls = ui.rolls.filter(roll => !state.publicLog.some(log => log.id === roll.logId));
    return `<main class="table narrative-table ${ui.entering ? 'is-entering' : ''}"><section class="visual-stage" aria-label="场景与人物">${ui.previousBackground ? `<div class="stage-backdrop has-image" style="--scene:url('${image(ui.previousBackground)}')"></div>` : ''}<div class="stage-backdrop ${background ? 'has-image' : ''} ${ui.backgroundChanged ? 'is-new-background' : ''}" ${background ? `style="--scene:url('${image(background.url)}')"` : ''}></div><div class="stage-grain" aria-hidden="true"></div><div class="stage-vignette" aria-hidden="true"></div>${button('lobby', '← 主页', 'stage-link stage-exit', 'data-network')}<header class="stage-navigation"><span class="mode-badge">${state.mode === 'keeper' ? '守秘人视角' : '调查员视角'}<i></i>第 ${state.round + 1} 轮</span><div>${button('finish-dialog', state.ended ? '结团回忆' : '结团', 'stage-link', 'data-network')}</div></header><section class="hud" aria-label="调查员状态">${hud(state)}</section><div class="stage-cast"><div class="stage-line" hidden><strong></strong><p></p></div></div><div class="stage-caption"><span class="eyebrow">${esc(state.title)}</span><h2>${esc(state.scene.name)}</h2><span class="stage-caption-rule"></span></div>${state.ended ? '<span class="ended-stamp">本局落幕</span>' : ''}</section><aside class="narrative-column"><header class="story-heading"><span class="eyebrow">${esc(state.title)}</span><h1>${esc(state.scene.name)}</h1><div class="story-heading-rule"><span></span><i>✦</i><span></span></div></header><nav class="story-tabs" role="tablist" aria-label="调查桌">${tabs.map(tab => button('tab', tab.label, ui.tab === tab.id ? 'is-active' : '', `data-tab="${tab.id}" id="tab-${tab.id}" role="tab" aria-selected="${ui.tab === tab.id}" aria-controls="panel-${tab.id}" tabindex="${ui.tab === tab.id ? 0 : -1}"`)).join('')}</nav><div class="story-scroll" id="story-scroll"><section id="panel-narrative" class="story-panel ${ui.tabChanged ? 'is-switching' : ''}" role="tabpanel" aria-labelledby="tab-narrative" ${ui.tab === 'narrative' ? '' : 'hidden'}><div class="transcript" id="transcript" aria-label="本幕叙事">${rendered}${extraRolls.map(roll => rollCard(roll)).join('')}</div></section>${state.mode === 'keeper' ? `<section id="panel-keeper" class="story-panel ${ui.tabChanged ? 'is-switching' : ''}" role="tabpanel" aria-labelledby="tab-keeper" ${ui.tab === 'keeper' ? '' : 'hidden'}>${consoleMarkup(state, ui)}</section>` : ''}<section id="panel-clues" class="story-panel ${ui.tabChanged ? 'is-switching' : ''}" role="tabpanel" aria-labelledby="tab-clues" ${ui.tab === 'clues' ? '' : 'hidden'}>${backpack(state, ui)}</section>${hoPanel}<section id="panel-cards" class="story-panel ${ui.tabChanged ? 'is-switching' : ''}" role="tabpanel" aria-labelledby="tab-cards" ${ui.tab === 'cards' ? '' : 'hidden'}>${cards(state)}</section></div><div class="story-utilities">${button('history', '往日记录', 'quiet-action')}${button('images', '场景印相', 'quiet-action')}</div>${composer(state, ui)}</aside></main>`;
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
  const characterName = character => character?.display_name || character?.name || '';
  function scenarioList({ scenarios, scenario }) {
    return scenarios.map((item, i) => {
      const active = item === scenario;
      const tags = [item.custom && '自定义', item.briefing?.tags?.join(' · ') || item.meta.era].filter(Boolean).join(' · ') || '剧本';
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
      <div class="briefing-kicker"><span>模组 ${sceneNumber(scenarios.indexOf(scenario))}</span>${scenario.custom && mode === 'keeper' ? button('edit-scenario', '编辑自定义剧本', 'briefing-edit', 'data-network') : ''}</div>
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
    return [
      ['investigator', '担任调查员', 'PL'],
      ['keeper', '担任守秘人', 'KP'],
    ].map(([value, title, abbreviation]) => {
      return button('lobby-mode', `${title} <small>${abbreviation}</small>`, '', `id="lobby-mode-${value}" data-mode="${value}" aria-pressed="${mode === value}" data-network`);
    }).join('');
  }
  function partyStatus({ mode, selected, limit, characters, keeperId, castAssets }) {
    const names = new Map(characters.map(character => [character.id, characterName(character)]));
    const member = (id, keeper = false) => {
      const name = names.get(id);
      if (!name) return '';
      if (keeper) return `<li><span class="party-selection-role">KP</span> ${esc(name)}</li>`;
      const rank = standingRank(castAssets, castAssets.characters[id]);
      const { group, label } = standingStatuses[rank];
      return `<li>${esc(name)}
        <small class="party-selection-standing" data-standing-rank="${rank}" title="${group}">${label}</small></li>`;
    };
    const lineup = [
      mode === 'investigator' ? member(keeperId, true) : '',
      ...selected.map(id => member(id)),
    ].join('');
    const hint = mode === 'keeper' ? `邀请 1–${limit} 位 AI 调查员` : characters.length ? '用眼睛指定守秘人，可另选队友' : '请先招募一位邻舍担任守秘人';
    return `<div class="party-status-line">
      ${lineup ? `<ul class="party-selection" aria-label="当前阵容">${lineup}</ul>` : `<span>${hint}</span>`}
      <strong class="party-count">${mode === 'keeper' ? '调查员' : 'AI 队友'} ${selected.length} / ${limit}</strong>
    </div>${selected.length > limit ? '<p class="party-capacity-warning">当前阵容超出模组容量，请移除多余角色</p>' : ''}`;
  }
  const standingStatuses = [
    { group: '表情立绘齐全', label: '立绘齐全' },
    { group: '表情立绘待补齐', label: '立绘未齐' },
    { group: '没有表情立绘', label: '无立绘' },
  ];
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
  function standingButton(subject, name, needsStanding) {
    const label = needsStanding ? '补齐立绘' : '管理立绘';
    return button('manage-standings', label, 'party-standing-link',
      `id="party-standing-${subject}" data-subject="${subject}" data-network aria-label="${label} · ${esc(name)}"`);
  }
  function roster({ mode, characters, selected, keeperId, castAssets }) {
    const player = castAssets.player;
    const playerNeedsStanding = mode === 'investigator' && standingRank(castAssets, player.expressions) > 0;
    const playerRow = `<li class="party-self">${avatar(player)}<span class="party-person"><strong>${esc(player.name)}</strong>
      <small>你 · ${mode === 'keeper' ? '守秘人' : '调查员'}</small></span>${standingButton('player', '我', playerNeedsStanding)}</li>`;
    if (!characters.length) return playerRow + '<li class="lobby-empty">先去邻舍酒馆邀请一位角色。</li>';
    let group = -1;
    const rows = orderCharacters(characters, castAssets).map(character => {
      const { id, personaSummary } = character;
      const name = characterName(character);
      const keeper = mode === 'investigator' && id === keeperId;
      const invited = selected.includes(id);
      const role = keeper ? '守秘人' : invited ? 'AI 调查员' : '';
      const rank = standingRank(castAssets, castAssets.characters[id]);
      const heading = rank === group ? '' : `<li class="party-group"><h3>${standingStatuses[rank].group}</h3></li>`;
      group = rank;
      const row = button('pick', `${avatar(character)}<span class="party-person"><strong>${esc(name)}</strong>
        <small title="${esc(personaSummary)}">${esc(personaSummary?.trim() || '邻舍角色')}</small></span>
        ${invited ? `<span class="party-role" title="AI 调查员">${icon('search')}</span>` : ''}
        <span class="party-dot" aria-hidden="true"></span>`, 'party-pick',
      `id="party-char-${id}" data-id="${id}" aria-label="${esc(role ? `${name} · ${role}` : name)}" aria-pressed="${keeper || invited}" data-network ${keeper ? 'disabled' : ''}`);
      const assignKeeper = mode === 'investigator' ? button('pick-keeper', `${icon('eye')}${keeper ? '<small>KP</small>' : ''}`, 'party-role-button',
        `id="pick-keeper-${id}" data-id="${id}" aria-label="设 ${esc(name)} 为守秘人" title="设 ${esc(name)} 为守秘人" aria-pressed="${keeper}" data-network`) : '';
      const reminder = rank > 0 && invited && !keeper ? `<div class="party-standing-note"><span>${rank === 1 ? '表情立绘未齐' : '缺少表情立绘'}</span>${standingButton(id, name, true)}</div>` : '';
      return `${heading}<li class="party-row${keeper ? ' is-keeper' : ''}"><div class="party-member">${row}${assignKeeper}</div>${reminder}</li>`;
    }).join('');
    return playerRow + '<li class="party-priority">优先邀请表情立绘齐全的角色</li>' + rows;
  }
  function launch({ canStart }) {
    return button('start', `<span class="lobby-launch-copy">
      <span class="lobby-launch-ready">开始调查 <small>BEGIN INVESTIGATION</small></span>
      <span class="lobby-launch-waiting">正在准备开局…</span>
    </span><span class="lobby-launch-mark" aria-hidden="true">
      ${icon('forward')}<span class="lobby-launch-pips"><span></span><span></span><span></span></span>
    </span>`, 'lobby-launch', `id="lobby-start" data-network ${canStart ? '' : 'disabled'}`);
  }
  function creatorForm({ step, idea, assessment, answers, preview, title, progress }) {
    const toolbar = (primary, secondary = '', back = '') => `<div class="creator-footer dialog-footer">${back}${secondary}${primary}</div>`;
    const next = (action, label) => button(action, label, 'primary', 'data-network');
    const back = target => button('creator-back', '上一步', 'quiet-action creator-back', `data-step="${target}" data-network`);
    const heading = ['输入想法', '补充设定', '预览剧本'][step - 1];
    let content;
    if (step === 1) {
      content = `<label class="sr-only" for="creator-idea">剧本想法</label>
        <textarea id="creator-idea" rows="9" maxlength="12000" placeholder="例如：废弃游乐园里的时间循环。也可以贴上一份完整的故事大纲。" data-network>${esc(idea)}</textarea>
        <p class="field-note creator-progress" role="status" ${progress ? '' : 'hidden'}>${esc(progress)}</p>
        ${toolbar(next('creator-assess', '分析想法 / 下一步'))}`;
    } else if (step === 2) {
      const questions = assessment.questions.map((item, index) => `<section class="creator-question">
        <label for="creator-answer-${index}">${esc(item.question)}</label>
        <span class="creator-hint" id="creator-hint-${index}">留空则由 AI 自由发挥</span>
        <div class="pill-group creator-chips" role="group" aria-label="灵感选项">${item.suggestions.map((suggestion, choice) =>
          button('creator-chip', esc(suggestion), 'pill', `data-question="${index}" data-choice="${choice}" aria-pressed="${answers[index] === suggestion}" data-network`)).join('')}</div>
        <textarea id="creator-answer-${index}" data-answer="${index}" rows="2" maxlength="2000" aria-describedby="creator-hint-${index}"
          placeholder="${esc(item.placeholder)}" data-network>${esc(answers[index])}</textarea>
      </section>`).join('');
      content = `<p class="field-note creator-assessment">${esc(assessment.assessment)}</p>${questions}
        ${toolbar(next('creator-generate', '生成剧本'), button('creator-skip', '跳过全部补充，直接生成', 'quiet-action', 'data-network'), back(1))}`;
    } else if (!preview) {
      content = `<p class="field-note creator-progress" role="status">${esc(progress || '可以重试生成，已填写的想法和答案会保留。')}</p>
        ${progress ? '' : toolbar(next('creator-retry', '重试生成'), '', back(assessment?.readyToGenerate ? 1 : 2))}`;
    } else {
      const group = (label, entries) => entries.length ? `<section class="creator-preview"><h3>${label}</h3><ul>${entries.map(([name, description]) =>
        `<li><strong>${esc(name)}</strong>${description ? `<p>${esc(description)}</p>` : ''}</li>`).join('')}</ul></section>` : '';
      content = `<label for="creator-title">剧本标题</label><input id="creator-title" maxlength="200" value="${esc(title)}" data-network>
        <p class="field-note creator-assessment">${esc(preview.meta.synopsis)}</p>
        ${group('场景', preview.scenes.map(scene => [scene.name, scene.publicDesc]))}
        ${group('NPC', preview.npcs.map(npc => [npc.name, npc.persona]))}
        ${group('调查员身份', preview.investigatorRoles.map(role => [role.title, role.publicSummary]))}
        ${group('隐匿 HO', preview.handouts.map(ho => [ho.title, ho.publicSummary]))}
        ${toolbar(next('creator-save', '保存并选中'), '', back(assessment?.readyToGenerate ? 1 : 2))}`;
    }
    return `<div class="creator-form"><h3 class="creator-step" tabindex="-1">${heading}<span>${step} / 3</span></h3>${content}</div>`;
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
          <div class="index-footer">${button('import-scenario', '导入外部剧本', 'scenario-import', 'id="scenario-import" title="支持 .md / .txt / .json" data-network')}
            ${button('open-creator', `${icon('plus')} <span>创建剧本</span>`, 'scenario-import scenario-create', 'id="scenario-create" data-network')}
          </div>
        </section>
        <section class="lobby-pane briefing-pane" aria-label="模组简报" data-lobby-part="briefing">${briefing(data)}</section>
        <section class="lobby-pane party-pane" aria-labelledby="party-title">
          <header class="party-heading">
            <div class="party-title-row">
              <h2 id="party-title" class="lobby-heading" tabindex="-1">PARTY &amp; ROLES</h2>
              ${button('random-party', '随机选人', 'lobby-nav-action party-random', `data-network ${data.characters.length ? '' : 'disabled'}`)}
            </div>
            <div class="party-mode" data-lobby-part="partyMode" role="group" aria-label="你的身份">${partyMode(data)}</div>
            <div class="party-status" data-lobby-part="partyStatus" aria-live="polite">${partyStatus(data)}</div>
          </header>
          <ul class="lobby-list party-list" data-lobby-part="roster" aria-label="邻舍阵容">${roster(data)}</ul>
          <footer class="party-footer">
            <span id="working" role="status"></span>
            <div data-lobby-part="launch">${launch(data)}</div>
          </footer>
        </section>
      </div>
    </main>`;
  }
  const diceScript = new URL('./vendor/dice-3d.js', document.currentScript.src);

  function mountAudioControls(stage, audio) {
    stage.insertAdjacentHTML('beforeend', `<div class="audio-controls">
      <button type="button" class="stage-link audio-toggle" aria-label="背景音乐静音" aria-pressed="false" aria-expanded="false" aria-controls="audio-panel" title="背景音乐静音 / 音量">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M11 4 5.5 9H2v6h3.5l5.5 5z"/>
          <path class="audio-waves" d="M15 9a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12"/>
          <path class="audio-muted" d="m16 9 6 6m0-6-6 6"/>
        </svg>
      </button>
      <div id="audio-panel" class="audio-panel" inert>
        <label><span>背景音乐</span><input type="range" min="0" max="100" step="1" data-volume="music"></label>
        <label><span>交互音效</span><input type="range" min="0" max="100" step="1" data-volume="effects"></label>
      </div>
    </div>`);
    const controls = stage.querySelector('.audio-controls');
    const toggle = controls.querySelector('.audio-toggle'), panel = controls.querySelector('.audio-panel');
    let pinned = false;
    const expand = open => {
      toggle.setAttribute('aria-expanded', String(open));
      panel.inert = !open;
    };
    const reflectMute = () => toggle.setAttribute('aria-pressed', String(audio.settings.muted));
    reflectMute();
    for (const slider of panel.querySelectorAll('input')) {
      const key = slider.dataset.volume;
      slider.value = Math.round(audio.settings[key] * 100);
      slider.addEventListener('input', () => audio.previewVolume(key, slider.valueAsNumber / 100));
      slider.addEventListener('change', () => audio.save({ [key]: slider.valueAsNumber / 100 }));
    }
    controls.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') expand(true); });
    controls.addEventListener('pointerleave', event => {
      if (event.pointerType === 'mouse' && !pinned && !panel.contains(document.activeElement)) expand(false);
    });
    toggle.addEventListener('click', () => {
      audio.save({ muted: !audio.settings.muted });
      reflectMute();
      pinned = true;
      expand(true);
    });
    controls.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' && event.target === toggle) {
        event.preventDefault();
        expand(true);
        panel.querySelector('input').focus();
      } else if (event.key === 'Escape') {
        pinned = false;
        toggle.focus();
        expand(false);
      }
    });
    controls.addEventListener('focusout', event => {
      if (event.relatedTarget && controls.contains(event.relatedTarget)) return;
      pinned = false;
      if (!controls.matches(':hover')) expand(false);
    });
    return event => {
      if (controls.contains(event.target)) return;
      pinned = false;
      expand(false);
    };
  }

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

  async function animateDice(roll, secret, onImpact, onReveal) {
    const layer = document.createElement('div');
    layer.className = 'dice-overlay';
    layer.innerHTML = `<div class="dice-canvas" aria-hidden="true"></div><div class="dice-badge" role="status">${rollCard(roll, secret, '', true)}</div><button type="button" class="dice-skip">跳过动画</button>`;
    document.body.append(layer);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const skip = new AbortController(), stage = new AbortController();
    const skipped = new Promise(resolve => skip.signal.addEventListener('abort', resolve, { once: true }));
    const stageStopped = new Promise(resolve => stage.signal.addEventListener('abort', () => resolve(false), { once: true }));
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const skipButton = layer.querySelector('.dice-skip');
    const badge = layer.querySelector('.dice-badge');
    const reveal = () => {
      if (skip.signal.aborted) return;
      badge.innerHTML = rollCard(roll, secret);
      onReveal();
    };
    layer.addEventListener('click', () => skip.abort());
    layer.addEventListener('keydown', event => { if (event.key === 'Escape') skip.abort(); });
    skip.signal.addEventListener('abort', () => stage.abort(), { once: true });
    skipButton.focus({ preventScroll: true });
    let deadline;
    try {
      let played = false;
      if (!reduced) {
        deadline = setTimeout(() => stage.abort(), 4800);
        const play = loadDice3D().then(api => !stage.signal.aborted && api?.play(layer.querySelector('.dice-canvas'), roll, stage.signal, reveal, onImpact));
        played = await Promise.race([play.catch(() => false), stageStopped]);
        clearTimeout(deadline);
      }
      if (!played && !skip.signal.aborted) {
        stage.abort();
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
  window.TrpgPresentation = { avatar, choices, logs, isKeeperLine, table, updateCast, lobby, creatorForm, scenarioList, briefing, partyMode, partyStatus, roster, orderCharacters, launch, consoleMarkup, checkForm, rollCard, rollKey, animateDice, highlight, itemPresets, imageCollection, mountAudioControls, keeperDialog, keeperActorPanel, actorStats, turnButton, playerTurnLabel };
})();
