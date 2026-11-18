import { randomInt, randomUUID } from 'node:crypto';

export const SKILLS = ['侦查', '图书馆', '聆听', '话术', '说服', '心理学', '格斗', '闪避', '急救', '神秘学', '锁匠', '潜行'];
const ATTRIBUTES = ['STR', 'CON', 'DEX', 'INT', 'POW', 'APP', 'SIZ', 'EDU'];
const PLAYER_ID = 'player';
const NORMAL_SLOT = 'normal';
const DIFFICULTIES = { regular: '普通', hard: '困难', extreme: '极难' };
const DC = { regular: 10, hard: 14, extreme: 18 };
const CHECK_DICE = ['d20', 'd100'];
const D20_MODES = ['normal', 'advantage', 'disadvantage'];
const DICE_SIDES = [4, 6, 8, 10, 12, 20, 100];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status, gameMessage: message }); };
const text = (v, max = 2000) => typeof v === 'string' ? v.slice(0, max) : '';
const integer = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const validId = value => typeof value === 'string' && /^[\w-]{1,80}$/.test(value);
function json(raw) { try { return JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { fail('模型没有返回有效 JSON，请重试', 502); } }

export function rollD100(skill, difficulty = 'regular', value = randomInt(1, 101)) {
  if (!integer(skill, 1, 99) || !integer(value, 1, 100) || !['regular', 'hard', 'extreme'].includes(difficulty)) fail('检定技能、难度或骰值无效');
  const target = difficulty === 'extreme' ? Math.floor(skill / 5) : difficulty === 'hard' ? Math.floor(skill / 2) : skill;
  const rank = value === 1 ? 'critical' : value >= 96 ? 'fumble' : value <= Math.floor(skill / 5) ? 'extreme' : value <= Math.floor(skill / 2) ? 'hard' : value <= skill ? 'regular' : 'failure';
  return { value, skill, target, difficulty, rank, success: value === 1 || (value < 96 && value <= target) };
}
function checkDetails({ skill, difficulty = 'regular', dice = 'd20', mode = 'normal', reason }, reasonRequired = true) {
  if (!SKILLS.includes(skill) || !Object.hasOwn(DC, difficulty) || !CHECK_DICE.includes(dice)
    || !D20_MODES.includes(mode) || (dice !== 'd20' && mode !== 'normal')) fail('检定技能、难度或骰型无效');
  const explanation = text(reason, 200).trim();
  if (reasonRequired && !explanation) fail('请说明检定原因');
  return { skill, difficulty, dice, mode, reason: explanation };
}
function rollD20(skill, difficulty, mode) {
  const rolls = Array.from({ length: mode === 'normal' ? 1 : 2 }, () => randomInt(1, 21));
  const value = mode === 'disadvantage' ? Math.min(...rolls) : Math.max(...rolls);
  const modifier = Math.floor((skill - 50) / 10);
  const total = value + modifier, target = DC[difficulty];
  const success = value === 20 || (value !== 1 && total >= target);
  const rank = value === 20 ? 'critical' : value === 1 ? 'fumble' : success ? 'regular' : 'failure';
  return { value, rolls, modifier, total, skill, target, difficulty, rank, success };
}
export function normalizeStats(c) {
  c.hp = Math.max(0, Math.min(c.maxHp, c.hp)); c.san = Math.max(0, Math.min(c.maxSan, c.san));
  c.insane = c.san <= 0 || !!c.insane; c.outOfAction = c.hp <= 0 || c.san <= 0;
  return c;
}

function normalizeCardSkills(skills) {
  const ranked = [...SKILLS].sort((a, b) => skills[b] - skills[a]);
  const count = Math.max(2, Math.min(3, ranked.filter(skill => skills[skill] >= 60).length));
  const specialties = new Set(ranked.slice(0, count));
  const normalized = { ...skills };
  for (const skill of SKILLS) {
    normalized[skill] = specialties.has(skill) ? Math.max(60, skills[skill]) : Math.min(50, skills[skill]);
  }
  return normalized;
}

function validateRules(raw, scenes, clues) {
  if (!raw || !Array.isArray(raw.items) || !Array.isArray(raw.actions) || !Array.isArray(raw.endings)
    || raw.items.length > 30 || raw.actions.length > 40 || !integer(raw.endings.length, 1, 12)) fail('剧本规则须包含道具、动作和 1–12 个结局');
  const entries = (list, normalize) => {
    const used = new Set();
    return list.map(entry => {
      if (!validId(entry?.id) || used.has(entry.id) || !text(entry.label, 100).trim()) fail('剧本规则编号重复或缺少名称');
      used.add(entry.id);
      return { id: entry.id, label: text(entry.label, 100), ...normalize(entry) };
    });
  };
  const refs = (values, allowed) => {
    if (values === undefined) return [];
    if (!Array.isArray(values) || new Set(values).size !== values.length || values.some(id => !allowed.includes(id))) fail('剧本规则引用了无效或重复的编号');
    return values;
  };
  const clueIds = clues.map(clue => clue.id);
  const items = entries(raw.items, item => ({ clueId: refs(item.clueId === undefined ? [] : [item.clueId], clues.filter(clue => !clue.isSecret).map(clue => clue.id))[0] }));
  const itemIds = items.map(item => item.id);
  const actionIds = raw.actions.map(action => action?.id);
  const actions = entries(raw.actions, action => {
    if (!scenes.some(scene => scene.id === action.sceneId) || !text(action.description, 1000).trim() || (action.checkSkill && !SKILLS.includes(action.checkSkill))) fail('剧本动作缺少有效的场景、说明或检定技能');
    const hpCost = action.hpCost ?? 0, sanCost = action.sanCost ?? 0;
    if (!integer(hpCost, 0, 100) || !integer(sanCost, 0, 100)) fail('剧本道具动作的状态代价无效');
    return { sceneId: action.sceneId, description: text(action.description, 1000), checkSkill: action.checkSkill || '',
      clues: refs(action.clues, clueIds), requiresActions: refs(action.requiresActions, actionIds.filter(id => id !== action.id)),
      requiresItems: refs(action.requiresItems, itemIds), consume: refs(action.consume, itemIds), grant: refs(action.grant, itemIds), hpCost, sanCost };
  });
  const endings = entries(raw.endings, ending => {
    const requiresActions = refs(ending.requiresActions, actionIds);
    const epilogue = text(ending.epilogue, 1000).trim();
    if (!requiresActions.length || !epilogue) fail('剧本结局须有前置动作和公开结尾');
    return { requiresActions, epilogue };
  });
  let clock;
  if (raw.clock !== undefined) {
    const action = actions.find(action => action.id === raw.clock?.actionId);
    if (!action || !integer(raw.clock.turns, 1, 20) || action.clues.length || action.requiresActions.length || action.requiresItems.length || action.consume.length || action.checkSkill) fail('剧本倒计时须指定无需其他前置条件的动作');
    clock = { actionId: action.id, sceneId: action.sceneId, turns: raw.clock.turns };
  }
  return { items, actions, endings, ...(clock ? { clock } : {}) };
}

export function validateScenario(value) {
  if (!value?.meta || !text(value.meta.title, 200).trim() || !Array.isArray(value.scenes) || value.scenes.length < 1 || value.scenes.length > 30) fail('剧本须包含标题和 1–30 个场景');
  const ids = new Set();
  const scenes = value.scenes.map(s => {
    if (!validId(s?.id) || ids.has(s.id) || !text(s.name, 100).trim() || !text(s.publicDesc, 5000).trim()) fail('场景编号重复或缺少公开描述'); ids.add(s.id);
    return { id: s.id, name: text(s.name, 100), publicDesc: text(s.publicDesc, 5000), hiddenNotes: text(s.hiddenNotes, 6000), imagePrompt: text(s.imagePrompt, 2000) };
  });
  if (!Array.isArray(value.clues) || value.clues.length > 100 || !Array.isArray(value.npcs) || value.npcs.length > 30) fail('线索与 NPC 列表无效');
  const clueIds = new Set(), npcIds = new Set();
  const clues = value.clues.map(c => {
    if (!validId(c?.id) || clueIds.has(c.id) || !ids.has(c.sceneId) || !text(c.title, 100).trim() || !text(c.content, 3000).trim() || (c.requiredSkill && !SKILLS.includes(c.requiredSkill))) fail('线索编号、场景或技能无效'); clueIds.add(c.id);
    return { id: c.id, title: text(c.title, 100), content: text(c.content, 3000), sceneId: c.sceneId, requiredSkill: text(c.requiredSkill, 20), isSecret: c.isSecret === true };
  });
  const npcs = value.npcs.map(n => { if (!validId(n?.id) || npcIds.has(n.id) || !text(n.name, 100).trim()) fail('NPC 编号或姓名无效'); npcIds.add(n.id); return { id: n.id, name: text(n.name, 100), persona: text(n.persona, 3000), secret: text(n.secret, 3000) }; });
  const rules = value.rules === undefined ? null : validateRules(value.rules, scenes, clues);
  return { meta: { title: text(value.meta.title, 200), era: text(value.meta.era, 100), stylePrompt: text(value.meta.stylePrompt, 2000) }, scenes, clues, npcs,
    keeperSecrets: text(value.keeperSecrets, 20000), ...(rules ? { rules } : {}) };
}
function partyItems(state) {
  return (state.scenario.rules?.items || []).flatMap(({ id, label }) => {
    const status = state.progress?.held.includes(id) ? 'held' : state.progress?.spent.includes(id) ? 'spent' : '';
    return status ? [{ id, label, status }] : [];
  });
}
export function investigatorContext(state, investigator) {
  const minRound = Math.max(0, state.round - 14);
  // Build from an allowlist. Never serialize the state then remove secret keys.
  return { scenario: { title: state.scenario.meta.title, era: state.scenario.meta.era },
    scene: { name: state.scenario.scenes.find(s => s.id === state.sceneId).name, publicDesc: state.scenario.scenes.find(s => s.id === state.sceneId).publicDesc },
    summaries: state.summaries.slice(-10), publicLog: state.publicLog.filter(l => l.sceneId === state.sceneId && l.round >= minRound),
    publicClues: state.scenario.clues.filter(clue => state.revealed.includes(clue.id)).map(({ title, content }) => ({ title, content })),
    partyItems: partyItems(state),
    investigators: state.investigators.map(({ id, name, hp, san, outOfAction }) => ({ id, name, hp, san, outOfAction })),
    ...(investigator ? { self: { id: investigator.id, attributes: investigator.attributes, skills: investigator.skills, inventory: investigator.inventory }, handout: state.handouts[investigator.id] || '' } : {}) };
}
const SCENARIO_RULES = `你是 CoC 短篇模组编辑。把材料提取为可运行短篇，保留原文真相与线索因果，不把秘密写进公开描述。只输出完整 JSON，不输出解释或代码围栏。严格按示例字段输出，示例字符串说明内容约束，实际填写对应正文：
{"meta":{"title":"1–40字标题","era":"1920s或现代","stylePrompt":"仅英文画面风格，不含人物外貌"},"scenes":[{"id":"s1","name":"1–20字场景名","publicDesc":"80–300字玩家可见的现场，不泄露隐藏真相","hiddenNotes":"主持用进入条件、检定后果、推进路线与结局条件","imagePrompt":"英文场景空镜，无文字、无角色"}],"clues":[{"id":"c1","title":"1–20字线索名","content":"20–200字线索正文","sceneId":"s1","requiredSkill":"侦查","isSecret":false}],"npcs":[{"id":"n1","name":"1–20字姓名","persona":"性格与公开身份，20–150字","secret":"仅KP可见的动机与真相，20–200字"}],"keeperSecrets":"完整真相、时间线、至少两种结局和推进条件，200–1500字"}
场景1–12个，线索1–30个，NPC0–12个；id唯一，sceneId须存在。requiredSkill仅能为空或：${SKILLS.join('、')}；isSecret必须为布尔值。`;
const CARD_RULES = `你是轻量CoC调查员设计师。根据每位角色人设一次生成全员卡，不复述角色外貌。每人选2–3项符合人设的特长（60–80），其余技能15–50。所有属性20–80整数。只输出JSON数组，不输出解释或代码围栏，必须完整覆盖给定角色id。严格按此完整示例：
[{"id":"材料中的原始id，不得改写","attributes":{"STR":50,"CON":50,"DEX":50,"INT":60,"POW":50,"APP":50,"SIZ":50,"EDU":60},"skills":{"侦查":65,"图书馆":65,"聆听":40,"话术":30,"说服":40,"心理学":30,"格斗":30,"闪避":25,"急救":30,"神秘学":20,"锁匠":20,"潜行":30}}]
attributes和skills字段及所有子字段不可缺失，数值为整数；不输出HP/SAN，由规则引擎计算。`;
const INVESTIGATOR_RULES = `你是跑团调查员扮演器。只使用给定公共信息和当前角色自己的密信；未知真相保持未知，不替KP叙述场景结果，不操控其他角色。排除玩家控制与已退场角色。每位指定角色至多发言两次，总计最多8条，符合人设并互相回应。只有存在实质风险且结果不确定的行动才提出check，随后停止对结果的推测。只输出JSON数组，不输出解释或围栏，严格按完整示例：
[{"speaker":"材料中原始角色id","dialogue":"10–100字角色发言，不泄露未知真相，不含表情标记","emotion":"惊讶","action":"0–60字可观察动作，不写行动已成功","check":{"skill":"侦查","reason":"1–80字具体行动和风险","difficulty":"regular","dice":"d20","mode":"normal"}},{"speaker":"材料中原始角色id","dialogue":"10–100字回应","emotion":"正常","action":"0–60字动作"}]
每条必须填写 emotion，从本轮 expressionNames 中原样选一个适合当前台词的名称，平静时选正常。无需检定时省略check；check.skill仅限${SKILLS.join('、')}；difficulty仅regular、hard、extreme。dice默认d20，仅有百分骰要求时用d100。mode默认normal，明确有利或不利时可用advantage或disadvantage，仅限d20。speaker 填本轮 actors 中对应的 id 字符串，例如 "1092"，不填角色名。`;
const KEEPER_RULES = `你是轻量跑团守秘人，按下方角色性格与口吻主持。完整模组和秘密仅供规划，叙事只公开调查员当前可以观察的信息。每轮80–250字，给出可行动的现场；不得一次剧透真相，不代替玩家行动。掷骰、状态变化、线索发放、切场景和密信必须调用对应工具，不能仅在正文声称执行；工具失败不能声称成功。只有结果不确定且有实际后果才需要检定，开虚掩的门、取得已给出的物品等确定性行动直接裁定。检定难度regular普通、hard困难、extreme极难。检定成功后根据模组给出线索与后果，失败也允许付出代价推进。已退场角色不能行动。遇到全员退场，提示引入替补或推进结局。遇到战斗调用trigger_encounter，再按检定与状态工具裁决。结束条件满足时提出结团，由玩家确认，不写主世界记忆。
只在玩家本人采取需要检定的行动时，单独调用 request_check，填写具体原因、技能和难度。引擎自动投骰，工具返回真实骰值后再裁定后果。普通技能检定优先D20，有明确情境优势或劣势时用D20的advantage或disadvantage，模组或玩家明确要求百分骰时用D100。伤害、随机表等只需要点数时用 roll_dice，按用途选骰型和数量。
玩家抵达新场景时，先调用 switch_scene，再处理该场景的检定、线索与叙事。公开线索用 all 发给全员，私密线索只给接触它的调查员，公开叙事不复述密信内容。已经公开的线索和玩家密信中已经交付的物品视为已取得，不重复问玩家是否有它。
AI 调查员自行决定行动和提出检定。玩家在原地等待或请队友观察时，玩家本人没有进行观察，不可调用 request_check。请把实际行动留给队友的发言。若有 checkToResolve，先按现有骰值和理由裁定队友检定的结果，不重复投骰。
有 scenario.rules 时，以 partyItems 为道具账本，以 progress.actions 为已经完成的剧情动作。发放道具对应的公开线索时调用 reveal_clue，规则引擎会登记道具。玩家明确执行规则列出的动作时，调用 resolve_scenario_action，由引擎验证场景、前置条件、检定和道具，结算规则内的代价并返回是否达成结局。按工具结果叙事，不提前宣告成功、消耗道具或重复扣减。一次玩家行动最多提出一次技能检定，同一调查员的HP/SAN变化合并成一次工具调用。
只在引擎返回 outcome 后为有规则的剧本调用 propose_ending，结尾必须符合该结果。无结构化规则的剧本按模组条件提议结团。调用 propose_ending 后简短告知玩家可以确认结团。
工具调用结束后，最终公开正文必须以一个方括号表情开头，例如「[惊讶]车窗外，那盏红灯又亮了。」。表情从本轮 expressionNames 中原样选一个，平静叙述用[正常]，标记后直接接叙事正文。`;

function dialogueCue(dialogue, emotion, slots, { leadingTag = false, preferredSlot } = {}) {
  const byName = new Map(slots.map(slot => [slot.name, slot.id]));
  byName.set('正常', NORMAL_SLOT);
  let inlineSlot;
  const cleaned = text(dialogue, 6000).replace(/\[([^\]\r\n]+)\]|【([^】\r\n]+)】/g, (marker, ascii, fullWidth, offset) => {
    const slot = byName.get((ascii ?? fullWidth).trim());
    if (slot) { inlineSlot ??= slot; return ''; }
    return leadingTag && offset === 0 ? '' : marker;
  }).trim();
  const chosen = slots.some(slot => slot.id === preferredSlot) ? preferredSlot : undefined;
  return { dialogue: cleaned, expressionSlot: byName.get(text(emotion, 80).trim()) || inlineSlot || chosen || NORMAL_SLOT };
}

function playerCardProfile(player) {
  const { name, gender, appearance, persona, avatar } = player;
  return { id: PLAYER_ID, display_name: name, avatar_path: avatar, base_prompt: [
    `玩家身份：${name}`, gender && `性别：${gender}`, appearance && `外观：${appearance}`, persona,
  ].filter(Boolean).join('\n') };
}

const publicPlayer = ({ name, avatar }) => ({ name, avatar });
const tool = (name, description, properties, required = Object.keys(properties)) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
const str = { type: 'string' }, num = { type: 'integer', minimum: -100, maximum: 100 };
export const KP_TOOLS = [
  tool('request_check', '自动掷骰并返回玩家本人的技能检定结果。队友的行动由队友提出检定。请单独调用。', {
    skill: { type: 'string', enum: SKILLS }, difficulty: { type: 'string', enum: Object.keys(DC) }, reason: str,
    dice: { type: 'string', enum: CHECK_DICE }, mode: { type: 'string', enum: D20_MODES },
  }, ['skill', 'difficulty', 'reason']),
  tool('roll_dice', '掷随机表、伤害等点数骰。用于不需要技能或难度的随机结果。请单独调用。', {
    sides: { type: 'integer', enum: DICE_SIDES }, count: { type: 'integer', minimum: 1, maximum: 6 }, reason: str,
  }),
  tool('update_investigator_stat', '调整HP/SAN并公开原因。', { targetChar: str, hpDelta: num, sanDelta: num, reason: str }),
  tool('reveal_clue', '发放真实线索，all公开或指定角色私有。', { clueId: str, targetCharOrAll: str }),
  tool('switch_scene', '进入模组指定场景。先切幕，再处理新场景的动作和线索。', { sceneId: str }),
  tool('send_secret_handout', '仅给指定调查员发送密信。', { targetChar: str, content: str }),
  tool('trigger_encounter', '触发遭遇战并异步生成事件特写。', { description: str }),
  tool('resolve_scenario_action', '执行剧本中已定义的关键动作，验证前置条件并登记道具、代价和结局。', { actionId: str }),
  tool('propose_ending', '达到结局条件后，提交80–250字的公开结尾，等待玩家确认。', { ending: str }),
];

export default function registerGamePlugin(ctx) {
  const { router, db, llm, bridgeTools, imageService } = ctx;
  const busy = new Set(), mediaJobs = new Set(); let closed = false;
  function load(id) {
    const row = db.load(id);
    if (!row?.state?.scenario) fail('跑团存档不存在', 404);
    const s = structuredClone(row.state);
    const oldCard = !s.player && s.investigators.find(c => c.player);
    s.player ||= publicPlayer(ctx.playerProfile());
    if (s.mode === 'investigator' && oldCard) {
      const previousId = oldCard.id, previousName = oldCard.name;
      Object.assign(oldCard, { id: PLAYER_ID, characterId: null, name: s.player.name, avatar: s.player.avatar, standing: null, persona: '' });
      for (const notes of [s.handouts, s.privateClues]) {
        if (Object.hasOwn(notes, previousId)) { notes[PLAYER_ID] = notes[previousId]; delete notes[previousId]; }
      }
      if (s.pendingCheck?.targetChar === previousId) s.pendingCheck.targetChar = PLAYER_ID;
      for (const line of s.pendingBatch?.lines || []) if (line.speaker === previousId) line.speaker = PLAYER_ID;
      for (const log of s.publicLog) if (log.kind === 'dialogue' && log.speaker === previousName) log.actorId = PLAYER_ID;
    }
    if (s.version < 3 || !s.version) {
      const sceneSignature = scenario => JSON.stringify(scenario.scenes.map(scene => [scene.id, scene.publicDesc]));
      const clueSignature = scenario => JSON.stringify(scenario.clues.map(clue => [clue.id, clue.isSecret === true]));
      const preset = ctx.scenarios().find(item => item.rules && item.meta.title === s.title
        && sceneSignature(item) === sceneSignature(s.scenario) && clueSignature(item) === clueSignature(s.scenario));
      if (preset && !s.scenario.rules) s.scenario.rules = validateRules(preset.rules, s.scenario.scenes, s.scenario.clues);
      s.version = 3;
    }
    initProgress(s);
    return s;
  }
  const persist = state => {
    if (closed) fail('游戏已经关闭', 409);
    const current = db.load(state.sessionId); if (!current) fail('存档已删除', 404);
    const completed = new Map((current.state.imageJobs || []).filter(j => j.status !== 'running').map(j => [j.id, j]));
    state.imageJobs = state.imageJobs.map(j => j.status === 'running' && completed.has(j.id) ? completed.get(j.id) : j);
    db.write(state.sessionId, state.title, state, current.revision);
  };
  function saveWithEffects(s, effects) {
    persist(s);
    for (const effect of effects.splice(0)) effect();
  }
  const addLog = (s, speaker, dialogue, action = '', kind = 'dialogue', actorId, expressionSlot) => s.publicLog.push({ id: randomUUID(), round: s.round, sceneId: s.sceneId, speaker, dialogue: text(dialogue, 6000), action: text(action, 1000), kind,
    ...(actorId ? { actorId, expressionSlot: expressionSlot || NORMAL_SLOT } : {}),
  });
  const character = (s, id) => { const c = s.investigators.find(i => i.id === String(id)); if (!c) fail('调查员不存在'); return c; };
  const scene = s => s.scenario.scenes.find(x => x.id === s.sceneId);
  const working = s => { if (s.ended) fail('本局已经结团'); };
  const betweenTurns = s => { if (s.turn) fail('请先续跑当前回合', 409); };
  function initProgress(s) {
    const rules = s.scenario.rules;
    if (!rules || s.progress) return;
    const discovered = new Set([...s.revealed, ...Object.values(s.privateClues).flat()]);
    s.progress = { held: rules.items.filter(item => discovered.has(item.clueId)).map(item => item.id),
      spent: [], actions: [], ...(rules.clock ? { clockRemaining: rules.clock.turns } : {}) };
  }
  function grantItem(s, id) {
    const { held, spent } = s.progress;
    if (held.includes(id) || spent.includes(id)) return;
    held.push(id);
    const item = s.scenario.rules.items.find(item => item.id === id);
    addLog(s, '道具', `获得「${item.label}」。`, '', 'item');
  }
  function actionBlock(s, action, automatic = false) {
    if (s.sceneId !== action.sceneId) return '该动作不在当前场景';
    if (s.scenario.rules.clock?.actionId === action.id && !automatic) return '由倒计时自动结算';
    if (action.requiresActions.some(id => !s.progress.actions.includes(id))) return '尚未完成前置动作';
    if (action.clues.some(id => !s.revealed.includes(id) && !Object.values(s.privateClues).some(clues => clues.includes(id)))) return '尚未取得所需线索';
    if ([...action.requiresItems, ...action.consume].some(id => !s.progress.held.includes(id))) return '队伍没有所需道具';
    if (action.checkSkill && !s.publicLog.some(log => log.sceneId === s.sceneId && log.roll?.skillName === action.checkSkill && log.roll.success
      && (log.round === s.round || log.id === s.checkToResolve?.logId))) return `需要在本幕通过「${action.checkSkill}」检定`;
    if (!automatic && (action.hpCost || action.sanCost) && s.turn?.stats.length) return '本轮已有单独的 HP/SAN 裁决，请下一轮执行这个自带代价的动作';
    return '';
  }
  function resolveAction(s, actionId, automatic = false) {
    const action = s.scenario.rules?.actions.find(action => action.id === actionId);
    if (!action) fail('剧本未定义这个动作');
    if (s.progress.actions.includes(action.id)) return { completed: true, alreadyRecorded: true, outcome: s.outcome || null };
    if (s.outcome) fail('结局条件已达成，请确认结团');
    const blocked = actionBlock(s, action, automatic);
    if (blocked) fail(blocked);
    for (const itemId of action.consume) {
      s.progress.held = s.progress.held.filter(id => id !== itemId);
      s.progress.spent.push(itemId);
      addLog(s, '道具', `使用「${s.scenario.rules.items.find(item => item.id === itemId).label}」。`, '', 'item');
    }
    s.progress.actions.push(action.id);
    addLog(s, '裁决', action.description, '', 'objective');
    for (const id of action.grant) grantItem(s, id);
    if (action.hpCost || action.sanCost) {
      for (const c of s.investigators.filter(c => !c.outOfAction)) {
        adjustStats(s, c, -action.hpCost, -action.sanCost, action.label);
        if (s.turn) s.turn.scenarioCostActors.push(c.id);
      }
    }
    const ending = s.scenario.rules.endings.find(ending => ending.requiresActions.every(id => s.progress.actions.includes(id)));
    if (ending) s.outcome = { id: ending.id, label: ending.label, epilogue: ending.epilogue };
    return { completed: true, outcome: s.outcome || null };
  }
  function tickClock(s, startScene) {
    const clock = s.scenario.rules?.clock;
    if (!clock || s.outcome || s.sceneId !== clock.sceneId || startScene !== clock.sceneId) return;
    if (--s.progress.clockRemaining === 0) resolveAction(s, clock.actionId, true);
  }
  function view(s) {
    const keeper = s.mode === 'keeper';
    const own = s.investigators.find(c => c.player);
    return { sessionId: s.sessionId, title: s.title, mode: s.mode, player: publicPlayer(s.player), scene: { id: scene(s).id, name: scene(s).name, publicDesc: scene(s).publicDesc },
      investigators: s.investigators.map(c => ({ ...c, persona: undefined, inventory: keeper || c.player ? c.inventory : [] })), publicLog: s.publicLog,
      summaries: s.summaries, round: s.round, pendingBatch: s.pendingBatch, pendingCheck: s.pendingCheck, awaitingRuling: !!s.checkToResolve,
      clues: s.scenario.clues.filter(c => s.revealed.includes(c.id) || (own && (s.privateClues[own.id] || []).includes(c.id)))
        .map(c => ({ ...c, isSecret: !s.revealed.includes(c.id) })),
      handouts: keeper ? s.handouts : own ? { [own.id]: s.handouts[own.id] || '' } : {},
      imageJobs: s.imageJobs, ended: s.ended, proposedEnding: s.proposedEnding || s.outcome?.epilogue || '', memoryWritten: !!s.memoryWritten,
      partyItems: partyItems(s), outcome: s.outcome || null, rulesEnabled: !!s.progress, abandoned: !!s.abandoned,
      clockRemaining: s.sceneId === s.scenario.rules?.clock?.sceneId ? s.progress.clockRemaining : null,
      pendingTurn: s.turn ? { id: s.turn.id, autoRollId: s.turn.autoRollId || null } : null, lastTurnId: s.lastTurnId || null,
      ...(keeper ? { scenario: s.scenario, kpSecrets: s.kpSecrets,
        actions: (s.scenario.rules?.actions || []).filter(action => action.sceneId === s.sceneId && action.id !== s.scenario.rules.clock?.actionId)
          .map(action => ({ id: action.id, label: action.label, available: !s.ended && !s.turn && !s.pendingCheck && !s.outcome && !s.progress.actions.includes(action.id) && !actionBlock(s, action) })),
      } : { keeperId: s.keeper?.id }),
    };
  }
  function queueMedia(s, reason, effects) {
    if (!s.imagesEnabled || closed) return;
    const id = randomUUID(), entry = { id, sceneId: s.sceneId, kind: reason === 'scene' ? 'scene' : 'event', status: 'running' };
    s.imageJobs.push(entry);
    const sessionId = s.sessionId;
    const prompt = `${s.scenario.meta.stylePrompt}, ${scene(s).imagePrompt}, ${reason === 'scene' ? 'environment establishing shot, no people' : `dramatic object closeup, ${reason}`}, no text`;
    effects.push(() => {
      mediaJobs.add(id);
      imageService.generate({ sessionId, prompt, outputScope: 'game', width: 1024, height: 576 }).then(result => settle({ status: 'done', url: result.url }), error => { console.warn('[trpg media]', error.message); return settle({ status: 'failed', error: '图片生成失败，请检查生图服务后重试' }); }).catch(error => console.warn('[trpg media]', error.message)).finally(() => mediaJobs.delete(id));
    });
    function settle(result) {
      if (closed || !db.load(sessionId)) return;
      // Other turns may have been committed during rendering; always merge into
      // the latest persisted state instead of overwriting with the old snapshot.
      const current = load(sessionId), job = current.imageJobs.find(j => j.id === id);
      if (!job) return;
      Object.assign(job, result); persist(current); ctx.events?.emit('media', { sessionId, ...job });
    }
  }
  function commitBatch(s, batchId, count, discard = false) {
    const batch = s.pendingBatch;
    if (!batch) { if (s.lastBatch?.id === batchId && s.lastBatch.count === count) return; fail('发言队列已变化，请重新读取', 409); }
    if (batch.id !== batchId || !integer(count, batch.acked, batch.lines.length)) fail('发言截断点无效', 409);
    const firstCheck = batch.lines.findIndex(line => line.check);
    if (firstCheck >= 0 && count > firstCheck + 1) fail('不能越过检定断点', 409);
    for (const line of batch.lines.slice(batch.acked, count)) {
      addLog(s, character(s, line.speaker).name, line.dialogue, line.action, 'dialogue', line.speaker, line.expressionSlot);
      if (line.check) s.pendingCheck = { id: randomUUID(), targetChar: line.speaker, ...line.check };
    }
    batch.acked = count;
    if (discard || s.pendingCheck || count === batch.lines.length) { s.lastBatch = { id: batch.id, count }; s.pendingBatch = null; }
  }
  function recordRoll(s, result, secret, effects) {
    if (secret) s.kpSecrets.darkRolls.push(result);
    else {
      const notation = result.kind === 'pool' && result.rolls.length > 1 ? `${result.rolls.length}D${result.sides}` : `D${result.sides}`;
      const labels = { critical: '大成功', extreme: '极难成功', hard: '困难成功', regular: '通过', failure: '失败', fumble: '大失败' };
      const outcome = !result.success && !['failure', 'fumble'].includes(result.rank) ? '未达难度' : labels[result.rank];
      const description = result.kind === 'pool' ? String(result.total) : `${result.total ?? result.value}/${result.target} · ${outcome}`;
      addLog(s, '骰子', `${result.name} · ${notation} · ${result.skillName} · ${description}`, '', 'dice');
      const log = s.publicLog.at(-1);
      result.logId = log.id;
      log.roll = result;
      if (s.mode === 'investigator') effects.push(() => ctx.events?.emit('dice', { sessionId: s.sessionId, roll: result }));
    }
    return result;
  }
  function roll(s, targetChar, check, secret, effects) {
    const c = character(s, targetChar); if (c.outOfAction) fail('已退场调查员不能检定');
    const { skill, difficulty, dice, mode, reason } = checkDetails(check, false);
    const sides = dice === 'd20' ? 20 : 100;
    const rolled = sides === 20 ? rollD20(c.skills[skill], difficulty, mode) : rollD100(c.skills[skill], difficulty);
    const result = recordRoll(s, { kind: 'check', targetChar: c.id, name: c.name, skillName: skill, sides, mode, reason, ...rolled }, secret, effects);
    if (['critical', 'fumble'].includes(result.rank)) queueMedia(s, `${result.rank}, ominous dice on the table`, effects);
    return result;
  }
  function rollPending(s, secret, effects) {
    const check = s.pendingCheck;
    const result = roll(s, check.targetChar, { dice: 'd100', ...check }, secret, effects);
    s.pendingCheck = null;
    if (s.mode === 'investigator') {
      if (s.turn && check.targetChar === PLAYER_ID) s.turn.dice = result;
      else s.checkToResolve = result;
    }
    return result;
  }
  function rollPool(s, { sides, count = 1, reason, secret }, effects) {
    const skillName = text(reason, 200).trim();
    if (!DICE_SIDES.includes(sides) || !integer(count, 1, 6) || !skillName) fail('请选择有效骰型、1–6 颗骰子并说明用途');
    if (s.turn?.poolRoll) {
      if (s.turn.poolRoll.sides === sides && s.turn.poolRoll.rolls.length === count) return s.turn.poolRoll;
      fail('本轮已有随机掷骰，请用结果继续裁定');
    }
    const rolls = Array.from({ length: count }, () => randomInt(1, sides + 1));
    const total = rolls.reduce((sum, value) => sum + value, 0);
    const result = recordRoll(s, { kind: 'pool', name: s.mode === 'keeper' ? s.player.name : (s.keeper.display_name || s.keeper.name || 'KP'),
      skillName, sides, rolls, value: total, total }, secret === true && s.mode === 'keeper', effects);
    if (s.turn) s.turn.poolRoll = result;
    return result;
  }
  function adjustStats(s, c, hpDelta, sanDelta, reason) {
    const { hp, san } = c;
    normalizeStats(Object.assign(c, { hp: hp + hpDelta, san: san + sanDelta }));
    hpDelta = c.hp - hp;
    sanDelta = c.san - san;
    const signed = delta => delta >= 0 ? `+${delta}` : String(delta);
    addLog(s, '裁决', `${c.name} HP ${signed(hpDelta)} / SAN ${signed(sanDelta)}：${reason}${c.outOfAction ? '（退场，可引入替补或推进结局）' : ''}`, '', 'stat');
    return { hp: c.hp, san: c.san, hpDelta, sanDelta, outOfAction: c.outOfAction };
  }
  function apply(s, name, args, effects) {
    working(s);
    switch (name) {
      case 'request_and_roll_dice': return roll(s, args.targetChar, { dice: 'd100', ...args }, args.secret === true && s.mode === 'keeper', effects);
      case 'roll_dice': return rollPool(s, args, effects);
      case 'update_investigator_stat': {
        const c = character(s, args.targetChar);
        if (!integer(args.hpDelta, -100, 100) || !integer(args.sanDelta, -100, 100) || !text(args.reason).trim()) fail('状态变化需要整数增减值与原因');
        const previous = s.turn?.stats.find(stat => stat.target === c.id);
        if (previous) {
          if (previous.hpDelta === args.hpDelta && previous.sanDelta === args.sanDelta) return previous.result;
          fail('本轮已结算该调查员的 HP/SAN');
        }
        if (s.turn?.scenarioCostActors.includes(c.id)) fail('规则引擎已结算该调查员的道具或剧情代价');
        const result = adjustStats(s, c, args.hpDelta, args.sanDelta, text(args.reason, 200));
        if (s.turn) s.turn.stats.push({ target: c.id, hpDelta: args.hpDelta, sanDelta: args.sanDelta, result });
        return result;
      }
      case 'reveal_clue': {
        const clue = s.scenario.clues.find(c => c.id === args.clueId); if (!clue) fail('线索不存在');
        if (s.mode === 'investigator') {
          if (clue.sceneId !== s.sceneId) fail('线索属于其他场景，请先切换到该场景');
          if (clue.isSecret && args.targetCharOrAll === 'all') fail('这条线索只能私下交给接触它的调查员');
        }
        const items = s.scenario.rules?.items.filter(item => item.clueId === clue.id) || [];
        if (items.length && args.targetCharOrAll !== 'all') fail('关键道具属于队伍，请公开发放对应线索');
        if (args.targetCharOrAll === 'all') {
          if (!s.revealed.includes(clue.id)) { s.revealed.push(clue.id); addLog(s, '线索', `${clue.title}：${clue.content}`, '', 'clue'); }
        } else {
          const c = character(s, args.targetCharOrAll);
          const list = s.privateClues[c.id] ||= [];
          if (!list.includes(clue.id)) { list.push(clue.id); s.handouts[c.id] = `${s.handouts[c.id] || ''}\n${clue.title}：${clue.content}`.trim(); }
        }
        for (const item of items) grantItem(s, item.id);
        return { delivered: true, ...(items.length ? { partyItems: partyItems(s) } : {}) };
      }
      case 'send_secret_handout': {
        const c = character(s, args.targetChar); if (!text(args.content, 3000).trim()) fail('密信不能为空');
        s.handouts[c.id] = `${s.handouts[c.id] || ''}\n${text(args.content, 3000)}`.slice(-12000); return { delivered: true };
      }
      case 'switch_scene': {
        const next = s.scenario.scenes.find(x => x.id === args.sceneId); if (!next) fail('场景不存在'); if (next.id === s.sceneId) return { sceneId: s.sceneId };
        const sceneStart = s.publicLog.findLastIndex(log => log.kind === 'scene');
        const logs = s.publicLog.slice(Math.max(0, sceneStart));
        const excerpt = selected => selected.slice(-8).map(log => text(`${log.speaker}：${log.dialogue}${log.action ? `（${log.action}）` : ''}`, 500));
        s.summaries.push({ sceneId: s.sceneId,
          clues: excerpt(logs.filter(log => log.kind === 'clue')),
          events: excerpt(logs.filter(log => !['clue', 'stat'].includes(log.kind))),
          statChanges: excerpt(logs.filter(log => log.kind === 'stat')),
        });
        s.sceneId = next.id; addLog(s, 'KP', next.publicDesc, '', 'scene'); queueMedia(s, 'scene', effects);
        return { sceneId: next.id, name: next.name, publicDesc: next.publicDesc };
      }
      case 'trigger_encounter': { const description = text(args.description, 1000); if (!description) fail('遭遇描述不能为空'); addLog(s, '遭遇', description, '', 'encounter'); queueMedia(s, description, effects); return { started: true }; }
      case 'resolve_scenario_action': return resolveAction(s, args.actionId);
      case 'propose_ending': {
        if (s.mode !== 'investigator') fail('玩家守秘人可以直接结团');
        if (s.scenario.rules && !s.outcome) fail('尚未达成剧本结局条件');
        const ending = text(args.ending, 1000).replace(/\\n/g, '\n').trim();
        if (!ending) fail('结尾不能为空');
        s.proposedEnding = ending;
        return { awaitingConfirmation: true };
      }
      default: fail('未知的KP工具');
    }
  }
  async function makeCards(profiles) {
    if (!profiles.length) return [];
    const request = { rules: CARD_RULES, personas: profiles.map(p => p.base_prompt || p.short_prompt || ''), data: JSON.stringify(profiles.map(p => ({ id: String(p.id), name: p.display_name || p.name }))), task: '一次生成名单内全部调查员卡，严格输出完整JSON数组。', scope: 'cards' };
    function readCards(raw) {
      const cards = json(raw);
      if (!Array.isArray(cards) || cards.length !== profiles.length) fail('调查员卡数量不符，请重新开团', 502);
      return profiles.map(profile => {
        const card = cards.find(c => ['string', 'number'].includes(typeof c?.id) && String(c.id) === String(profile.id));
        if (!card || ATTRIBUTES.some(k => !integer(card.attributes?.[k], 20, 80)) || SKILLS.some(k => !integer(card.skills?.[k], 15, 80))) fail('模型生成的调查员卡缺少字段或数值超限，请重新开团', 502);
        return card;
      });
    }
    let raw = await llm.complete(request);
    let cards;
    try { cards = readCards(raw); } catch (error) {
      if (!error.gameMessage) throw error;
      raw = await llm.complete({ ...request, task: '为名单逐一出卡。检查原始 id、卡片数量、每项属性和技能，返回严格的完整 JSON 数组。' });
      cards = readCards(raw);
    }
    return profiles.map((p, index) => {
      const card = cards[index];
      const skills = normalizeCardSkills(Object.fromEntries(SKILLS.map(k => [k, card.skills[k]])));
      const attributes = Object.fromEntries(ATTRIBUTES.map(k => [k, card.attributes[k]]));
      const maxHp = Math.floor((attributes.CON + attributes.SIZ) / 10), maxSan = attributes.POW;
      const player = p.id === PLAYER_ID;
      return { id: String(p.id), characterId: player ? null : p.id, player, name: p.display_name || p.name, avatar: p.avatar_path, standing: p.standing_url, persona: player ? '' : p.base_prompt || p.short_prompt || '', attributes, skills,
        hp: maxHp, maxHp, san: maxSan, maxSan, mp: Math.floor(maxSan / 5), insane: false, outOfAction: false, inventory: [], handout: '' };
    });
  }
  async function generateBatch(s, slots, signal) {
    const actors = s.investigators.filter(c => !c.player && !c.outOfAction);
    if (!actors.length) return;
    // Public batch has no private knowledge at all. A holder of private clues is
    // generated in a separate request with only their own handout, so a shared
    // model call cannot disclose one investigator's knowledge to another.
    const groups = [actors.filter(c => !s.handouts[c.id]), ...actors.filter(c => s.handouts[c.id]).map(c => [c])].filter(g => g.length);
    const lines = [];
    for (const group of groups) {
      const raw = await llm.complete({ rules: INVESTIGATOR_RULES, personas: group.map(c => c.persona),
        data: JSON.stringify({ context: investigatorContext(s, group.length === 1 ? group[0] : null), actors: group.map(c => ({ id: c.id, name: c.name, skills: c.skills })), expressionNames: slots.map(slot => slot.name) }),
        task: '扮演指定名单，按示例输出含表情的行动与对话；需要检定时提出check。', scope: `${s.sessionId}:investigators` }, { signal });
      const output = json(raw);
      if (!Array.isArray(output) || output.length > 8) fail('调查员发言格式不合法', 502);
      for (const l of output) {
        const identity = ['string', 'number'].includes(typeof l?.speaker) ? String(l.speaker).trim() : '';
        const byName = group.filter(actor => actor.name === identity);
        const actor = group.find(actor => actor.id === identity) || (byName.length === 1 ? byName[0] : null);
        const cue = dialogueCue(text(l?.dialogue, 600), l?.emotion, slots);
        const action = text(l?.action, 300).trim();
        if (!actor || (!cue.dialogue && !action)) fail('调查员发言角色或检定不合法', 502);
        let check;
        if (l.check != null) {
          try { check = checkDetails({ ...l.check, reason: l.check.reason || action || cue.dialogue }); } catch { fail('调查员检定格式不合法，请续跑本轮', 502); }
        }
        lines.push({ speaker: actor.id, ...cue, action, ...(check ? { check } : {}) });
        if (l.check || lines.length === 8) break;
      }
      if (lines.some(l => l.check) || lines.length === 8) break;
    }
    if (lines.length) s.pendingBatch = { id: randomUUID(), lines, acked: 0 };
  }
  const route = (method, url, handler, { lock = true, disconnect = false } = {}) => router[method](url, async (req, res) => {
    const id = req.body?.sessionId || req.query?.sessionId;
    if (closed) fail('游戏已经关闭', 409);
    if (lock && id && busy.has(id)) fail('当前存档正在执行另一项操作', 409);
    if (lock && id) busy.add(id);
    const controller = disconnect ? new AbortController() : null;
    const cancel = () => controller.abort();
    if (controller) res.once('close', cancel);
    try {
      const result = await handler(req.body || {}, req.query || {}, controller?.signal);
      if (!res.destroyed) res.json(result);
    } catch (error) {
      if (!controller?.signal.aborted) throw error;
    } finally {
      if (controller) res.off('close', cancel);
      if (lock && id) busy.delete(id);
    }
  });
  function receipt(s, body, type) {
    const id = body.operationId;
    if (id === undefined) return null;
    if (!validId(id)) fail('操作编号无效');
    return (s.receipts || []).find(entry => entry.id === id && entry.type === type);
  }
  function recordReceipt(s, body, type, result) {
    if (body.operationId !== undefined) (s.receipts ||= []).push({ id: body.operationId, type, result });
  }
  route('get', '/catalog', async () => ({
    skills: SKILLS, diceSides: DICE_SIDES,
    scenarios: ctx.scenarios().map(s => ({ id: s.id || s.meta.title, meta: s.meta, scenes: s.scenes.length,
      opening: s.scenes[0]?.publicDesc, briefing: s.briefing })),
  }), { lock: false });
  route('get', '/cast', async () => ctx.castAssets(), { lock: false });
  route('post', '/parse-scenario', async body => {
    if (typeof body.content !== 'string' || !body.content.trim() || body.content.length > 100000) fail('请上传不超过 10 万字的剧本');
    if (body.format === 'json') {
      let parsed;
      try { parsed = JSON.parse(body.content); } catch { /* Free-form material goes through the extractor. */ }
      if (parsed?.rules !== undefined) return validateScenario(parsed);
      try { if (parsed) return validateScenario(parsed); } catch { /* Nonstandard JSON goes through the extractor. */ }
    }
    return validateScenario(json(await llm.complete({ rules: SCENARIO_RULES, data: body.content, task: '提取剧本，按完整示例输出JSON。', scope: 'parse' })));
  }, { lock: false });
  route('post', '/start', async body => {
    if (!['keeper', 'investigator'].includes(body.mode)) fail('请选择游玩模式');
    const isKeeper = body.mode === 'keeper';
    if (!Array.isArray(body.characterIds) || !integer(body.characterIds.length, isKeeper ? 1 : 0, isKeeper ? 4 : 5) || new Set(body.characterIds).size !== body.characterIds.length || body.characterIds.some(id => !integer(id, 1, 2147483647))) {
      fail(isKeeper ? '请选择 1–4 位不同的 AI 调查员' : '请选择至多 5 位不同的 AI 队友');
    }
    if (!isKeeper && (!integer(body.keeperId, 1, 2147483647) || body.characterIds.includes(body.keeperId))) fail('请指定一位未加入调查员阵容的守秘人');
    const presets = ctx.scenarios();
    const scenario = validateScenario(body.scenario || presets.find(s => (s.id || s.meta.title) === body.scenarioId));
    const player = ctx.playerProfile();
    const profiles = await Promise.all(body.characterIds.map(characterId => bridgeTools.call('get_character_profile', { characterId })));
    const keeper = isKeeper ? null : await bridgeTools.call('get_character_profile', { characterId: body.keeperId });
    const investigators = await makeCards(isKeeper ? profiles : [playerCardProfile(player), ...profiles]);
    const sessionId = randomUUID(), first = scenario.scenes[0];
    const state = { version: 3, sessionId, title: scenario.meta.title, scenario, keeper, player: publicPlayer(player), mode: body.mode, investigators, sceneId: first.id, publicLog: [],
      kpSecrets: { truth: scenario.keeperSecrets, darkRolls: [] }, handouts: {}, privateClues: {}, revealed: [], summaries: [], round: 0, pendingBatch: null, pendingCheck: null, imageJobs: [], imagesEnabled: body.imagesEnabled === true, ended: false };
    initProgress(state);
    addLog(state, 'KP', first.publicDesc, '', 'scene');
    const effects = [];
    queueMedia(state, 'scene', effects);
    db.write(sessionId, state.title, state);
    for (const effect of effects) effect();
    return view(state);
  }, { lock: false });
  route('get', '/state', async (_b, q) => {
    const s = load(q.sessionId); let dirty = false;
    for (const job of s.imageJobs) if (job.status === 'running' && !mediaJobs.has(job.id)) { job.status = 'failed'; job.error = '上次生成已中断，可重试'; dirty = true; }
    if (dirty && !busy.has(q.sessionId)) persist(s);
    return view(s);
  }, { lock: false });
  route('post', '/ack', async body => {
    const s = load(body.sessionId); working(s);
    commitBatch(s, body.batchId, body.count, body.discard === true);
    const effects = [];
    const roll = s.mode === 'investigator' && s.pendingCheck && s.pendingCheck.targetChar !== PLAYER_ID ? rollPending(s, false, effects) : null;
    saveWithEffects(s, effects);
    return { ...view(s), ...(roll ? { roll } : {}) };
  });
  route('post', '/turn', async (body, _query, signal) => {
    const s = load(body.sessionId);
    const requestedId = body.turnId;
    if (requestedId !== undefined && !validId(requestedId)) fail('回合编号无效');
    if (requestedId !== undefined && s.turnIds?.includes(requestedId) && s.turn?.id !== requestedId) return view(s);
    working(s);
    const slots = ctx.expressionSlots();
    if (s.turn) {
      if (requestedId !== s.turn.id) fail('请先续跑当前回合', 409);
      if (s.mode === 'investigator' && s.pendingCheck?.targetChar === PLAYER_ID) {
        const effects = [];
        s.turn.autoRollId = rollPending(s, false, effects).logId;
        saveWithEffects(s, effects);
        return view(s);
      }
      if (s.turn.autoRollId) {
        delete s.turn.autoRollId;
        persist(s);
      }
    } else {
      if (body.resume === true) fail('该回合已不存在，请重新读取卷宗', 409);
      if (s.outcome) fail('结局条件已达成，请确认结团');
      const input = dialogueCue(text(body.message, 3000), '', slots, { preferredSlot: body.expressionSlot });
      if (s.checkToResolve && input.dialogue) fail('请先裁定队友的检定', 409);
      if (input.dialogue && s.investigators.some(c => c.player && c.outOfAction)) fail('你已退场，可以继续旁观调查');
      if (s.pendingBatch) commitBatch(s, body.batchId, body.count, true);
      if (s.pendingCheck) fail('请先完成当前检定');
      const rulingOnly = !!s.checkToResolve && !input.dialogue;
      if (!rulingOnly) s.round++;
      delete s.proposedEnding;
      if (input.dialogue) {
        const speaker = s.mode === 'keeper' ? text(body.speaker, 100).trim() || s.player.name : s.player.name;
        addLog(s, speaker, input.dialogue, '', 'dialogue', PLAYER_ID, input.expressionSlot);
      }
      const id = requestedId ?? randomUUID();
      s.turn = { id, phase: s.mode === 'investigator' ? 'keeper' : 'investigators',
        startScene: s.sceneId, rulingOnly, stats: [], scenarioCostActors: [], agent: {} };
      (s.turnIds ||= []).push(id);
      s.lastTurnId = id;
      persist(s);
    }
    const { rulingOnly } = s.turn;
    if (s.turn.phase === 'keeper') {
      const effects = [];
      const { gender, appearance, persona } = ctx.playerProfile();
      const content = await llm.agent({ rules: KEEPER_RULES, personas: [s.keeper.base_prompt || s.keeper.short_prompt || ''],
        data: JSON.stringify({ ...investigatorContext(s), scenario: s.scenario, progress: s.progress, kpSecrets: s.kpSecrets, handouts: s.handouts, checkToResolve: s.checkToResolve, playerIdentity: { id: PLAYER_ID, name: s.player.name, gender, appearance, persona },
          investigators: s.investigators.map(({ persona, ...c }) => c), expressionNames: slots.map(slot => slot.name) }),
        task: rulingOnly ? '裁定 checkToResolve 中的检定，按约定以表情标记开头，只给公开叙事。' : '根据玩家行动主持下一段，按约定以表情标记开头，只给公开叙事。', scope: `${s.sessionId}:keeper` }, KP_TOOLS, (name, args, calls) => {
          if (s.proposedEnding) fail('结尾已备好，等待玩家确认');
          if (s.outcome && name !== 'propose_ending') fail('结局条件已达成，请提交结尾');
          if (calls.length > 1 && calls.some(call => ['request_check', 'roll_dice'].includes(call.function.name))) fail('请单独调用掷骰工具，收到点数后再裁定');
          if (name === 'request_check' || name === 'request_and_roll_dice') {
            if (rulingOnly) fail('请使用已有队友骰值裁定');
            const details = checkDetails(name === 'request_and_roll_dice' ? { ...args, dice: 'd100', reason: '判定本轮行动能否完成' } : args);
            if (s.turn.dice) {
              const prior = s.turn.dice;
              if (prior.skillName === details.skill && prior.difficulty === details.difficulty && (prior.sides || 100) === Number(details.dice.slice(1)) && (prior.mode || 'normal') === details.mode) return prior;
              fail('本轮已有玩家骰值，请继续裁定');
            }
            if (character(s, PLAYER_ID).outOfAction) fail('已退场调查员不能检定');
            const diceLabel = details.dice.toUpperCase();
            addLog(s, 'KP', `${details.reason} · ${details.skill} · ${DIFFICULTIES[details.difficulty]} · ${diceLabel}`, '', 'check');
            s.turn.dice = roll(s, PLAYER_ID, details, false, effects);
            s.turn.autoRollId = s.turn.dice.logId;
            return;
          }
          const firstPoolRoll = name === 'roll_dice' && !s.turn.poolRoll;
          const result = apply(s, name, args, effects);
          if (firstPoolRoll) {
            s.turn.autoRollId = result.logId;
            return;
          }
          return result;
        }, { checkpoint: s.turn.agent, save: () => saveWithEffects(s, effects), signal });
      signal.throwIfAborted();
      if (content === null) return view(s);
      const cue = dialogueCue(content.trim(), '', slots, { leadingTag: true });
      if (cue.dialogue && !s.proposedEnding) addLog(s, s.keeper.display_name || s.keeper.name || 'KP', cue.dialogue, '', 'dialogue', String(s.keeper.id), cue.expressionSlot);
      delete s.checkToResolve;
      delete s.turn.agent;
      s.turn.phase = 'investigators';
      persist(s);
    }
    if (!rulingOnly) tickClock(s, s.turn.startScene);
    if (!s.outcome && !s.proposedEnding && !rulingOnly) await generateBatch(s, slots, signal);
    signal.throwIfAborted();
    delete s.turn;
    persist(s); return view(s);
  }, { disconnect: true });
  route('post', '/roll', async body => {
    const s = load(body.sessionId);
    const cached = receipt(s, body, 'roll');
    if (cached) return { ...view(s), roll: cached.result };
    working(s);
    if (s.mode !== 'keeper' && !s.pendingCheck) fail('角色守秘人会自动掷骰');
    betweenTurns(s);
    if (s.outcome) fail('结局条件已达成，请确认结团');
    if (s.pendingBatch) fail('请先暂停发言');
    if (body.checkId !== undefined && body.checkId !== s.pendingCheck?.id) fail('待执行检定已经变化', 409);
    const effects = [];
    const secret = s.mode === 'keeper' && body.secret === true;
    const result = s.pendingCheck ? rollPending(s, secret, effects) : roll(s, body.targetChar, body, secret, effects);
    recordReceipt(s, body, 'roll', result);
    saveWithEffects(s, effects);
    return { ...view(s), roll: result };
  });
  route('post', '/control', async body => {
    const s = load(body.sessionId); if (s.mode !== 'keeper') fail('仅玩家KP可以使用控制台', 403);
    const cached = receipt(s, body, 'control');
    if (cached) return { ...view(s), result: cached.result };
    working(s); betweenTurns(s);
    if (s.outcome) fail('结局条件已达成，请确认结团');
    if (s.pendingBatch || s.pendingCheck) fail('请先暂停发言并处理检定');
    const effects = [];
    const result = apply(s, body.tool, body.args || {}, effects);
    recordReceipt(s, body, 'control', result);
    saveWithEffects(s, effects);
    return { ...view(s), result };
  });
  route('post', '/replacement', async body => {
    const s = load(body.sessionId); working(s); betweenTurns(s);
    if (!s.investigators.some(c => c.outOfAction)) fail('当前没有退场调查员');
    if (!integer(body.characterId, 1, 2147483647) || s.keeper?.id === body.characterId || s.investigators.some(c => c.id === String(body.characterId))) fail('请选择尚未入场的角色');
    const [card] = await makeCards([await bridgeTools.call('get_character_profile', { characterId: body.characterId })]);
    s.investigators.push(card); addLog(s, 'KP', `替补调查员「${card.name}」加入了调查。`); persist(s); return view(s);
  });
  route('post', '/retry-image', async body => {
    const s = load(body.sessionId); working(s); betweenTurns(s);
    if (s.imageJobs.some(j => j.status === 'running')) fail('图片仍在生成中');
    s.imagesEnabled = true;
    const effects = [];
    queueMedia(s, 'scene', effects);
    saveWithEffects(s, effects);
    return view(s);
  });
  route('post', '/finish', async body => {
    const s = load(body.sessionId);
    if (!s.ended) {
      if (s.scenario.rules && !s.outcome && body.abandon !== true) fail('尚未达成剧本结局条件，可继续调查或提前收团', 409);
      s.abandoned = !!s.scenario.rules && !s.outcome;
      delete s.turn;
      s.pendingBatch = null; s.pendingCheck = null; s.ended = true;
      delete s.checkToResolve;
      addLog(s, '落幕', text(body.ending, 1000).trim() || s.proposedEnding || s.outcome?.epilogue || (s.abandoned ? '调查提前收束，谜题留待后来人。' : '调查到此告一段落。桌上的骰子终于安静下来。'), '', 'ending');
      delete s.proposedEnding;
      persist(s);
    }
    if (body.writeMemory === true && !s.memoryWritten) {
      await ctx.remember(s.sessionId, s.investigators, s.title, s.publicLog.filter(l => l.kind === 'ending').at(-1)?.dialogue || '');
      s.memoryWritten = true; persist(s);
    }
    return view(s);
  });
  return { onUnload() { closed = true; } };
}
