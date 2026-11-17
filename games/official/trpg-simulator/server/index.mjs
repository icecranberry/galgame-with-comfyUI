import { randomInt, randomUUID } from 'node:crypto';

export const SKILLS = ['侦查', '图书馆', '聆听', '话术', '说服', '心理学', '格斗', '闪避', '急救', '神秘学', '锁匠', '潜行'];
const ATTRIBUTES = ['STR', 'CON', 'DEX', 'INT', 'POW', 'APP', 'SIZ', 'EDU'];
const PLAYER_ID = 'player';
const NORMAL_SLOT = 'normal';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (v, max = 2000) => typeof v === 'string' ? v.slice(0, max) : '';
const integer = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
function json(raw) { try { return JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()); } catch { fail('模型没有返回有效 JSON，请重试', 502); } }

export function rollD100(skill, difficulty = 'regular', value = randomInt(1, 101)) {
  if (!integer(skill, 1, 99) || !integer(value, 1, 100) || !['regular', 'hard', 'extreme'].includes(difficulty)) fail('检定技能、难度或骰值无效');
  const target = difficulty === 'extreme' ? Math.floor(skill / 5) : difficulty === 'hard' ? Math.floor(skill / 2) : skill;
  const rank = value === 1 ? 'critical' : value >= 96 ? 'fumble' : value <= Math.floor(skill / 5) ? 'extreme' : value <= Math.floor(skill / 2) ? 'hard' : value <= skill ? 'regular' : 'failure';
  return { value, skill, target, difficulty, rank, success: value === 1 || (value < 96 && value <= target) };
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

export function validateScenario(value) {
  if (!value?.meta || !text(value.meta.title, 200).trim() || !Array.isArray(value.scenes) || value.scenes.length < 1 || value.scenes.length > 30) fail('剧本须包含标题和 1–30 个场景');
  const ids = new Set();
  const scenes = value.scenes.map(s => {
    if (!/^[\w-]{1,60}$/.test(s.id) || ids.has(s.id) || !s.name || !s.publicDesc) fail('场景编号重复或缺少公开描述'); ids.add(s.id);
    return { id: s.id, name: text(s.name, 100), publicDesc: text(s.publicDesc, 5000), hiddenNotes: text(s.hiddenNotes, 6000), imagePrompt: text(s.imagePrompt, 2000) };
  });
  if (!Array.isArray(value.clues) || value.clues.length > 100 || !Array.isArray(value.npcs) || value.npcs.length > 30) fail('线索与 NPC 列表无效');
  const clueIds = new Set(), npcIds = new Set();
  const clues = value.clues.map(c => {
    if (!/^[\w-]{1,60}$/.test(c.id) || clueIds.has(c.id) || !ids.has(c.sceneId) || !c.title || !c.content || (c.requiredSkill && !SKILLS.includes(c.requiredSkill))) fail('线索编号、场景或技能无效'); clueIds.add(c.id);
    return { id: c.id, title: text(c.title, 100), content: text(c.content, 3000), sceneId: c.sceneId, requiredSkill: text(c.requiredSkill, 20), isSecret: c.isSecret === true };
  });
  const npcs = value.npcs.map(n => { if (!/^[\w-]{1,60}$/.test(n.id) || npcIds.has(n.id) || !n.name) fail('NPC 编号或姓名无效'); npcIds.add(n.id); return { id: n.id, name: text(n.name, 100), persona: text(n.persona, 3000), secret: text(n.secret, 3000) }; });
  return { meta: { title: text(value.meta.title, 200), era: text(value.meta.era, 100), stylePrompt: text(value.meta.stylePrompt, 2000) }, scenes, clues, npcs, keeperSecrets: text(value.keeperSecrets, 20000) };
}
export function investigatorContext(state, investigator) {
  const minRound = Math.max(0, state.round - 14);
  // Build from an allowlist. Never serialize the state then remove secret keys.
  return { scenario: { title: state.scenario.meta.title, era: state.scenario.meta.era },
    scene: { name: state.scenario.scenes.find(s => s.id === state.sceneId).name, publicDesc: state.scenario.scenes.find(s => s.id === state.sceneId).publicDesc },
    summaries: state.summaries, publicLog: state.publicLog.filter(l => l.sceneId === state.sceneId && l.round >= minRound),
    investigators: state.investigators.map(({ id, name, hp, san, outOfAction }) => ({ id, name, hp, san, outOfAction })),
    ...(investigator ? { self: { id: investigator.id, attributes: investigator.attributes, skills: investigator.skills, inventory: investigator.inventory }, handout: state.handouts[investigator.id] || '' } : {}) };
}
const SCENARIO_RULES = `你是 CoC 短篇模组编辑。把材料提取为可运行短篇，保留原文真相与线索因果，不把秘密写进公开描述。只输出完整 JSON，不输出解释或代码围栏。严格按示例字段输出，示例字符串说明内容约束，实际填写对应正文：
{"meta":{"title":"1–40字标题","era":"1920s或现代","stylePrompt":"仅英文画面风格，不含人物外貌"},"scenes":[{"id":"s1","name":"1–20字场景名","publicDesc":"80–300字玩家可见的现场，不泄露隐藏真相","hiddenNotes":"主持用进入条件、检定后果、推进路线与结局条件","imagePrompt":"英文场景空镜，无文字、无角色"}],"clues":[{"id":"c1","title":"1–20字线索名","content":"20–200字线索正文","sceneId":"s1","requiredSkill":"侦查","isSecret":false}],"npcs":[{"id":"n1","name":"1–20字姓名","persona":"性格与公开身份，20–150字","secret":"仅KP可见的动机与真相，20–200字"}],"keeperSecrets":"完整真相、时间线、至少两种结局和推进条件，200–1500字"}
场景1–12个，线索1–30个，NPC0–12个；id唯一，sceneId须存在。requiredSkill仅能为空或：${SKILLS.join('、')}；isSecret必须为布尔值。`;
const CARD_RULES = `你是轻量CoC调查员设计师。根据每位角色人设一次生成全员卡，不复述角色外貌。每人选2–3项符合人设的特长（60–80），其余技能15–50。所有属性20–80整数。只输出JSON数组，不输出解释或代码围栏，必须完整覆盖给定角色id。严格按此完整示例：
[{"id":"材料中的原始id，不得改写","attributes":{"STR":50,"CON":50,"DEX":50,"INT":60,"POW":50,"APP":50,"SIZ":50,"EDU":60},"skills":{"侦查":65,"图书馆":65,"聆听":40,"话术":30,"说服":40,"心理学":30,"格斗":30,"闪避":25,"急救":30,"神秘学":20,"锁匠":20,"潜行":30}}]
attributes和skills字段及所有子字段不可缺失，数值为整数；不输出HP/SAN，由规则引擎计算。`;
const INVESTIGATOR_RULES = `你是跑团调查员扮演器。只使用给定公共信息和当前角色自己的密信；未知真相保持未知，不替KP叙述场景结果，不操控其他角色。排除玩家控制与已退场角色。每位指定角色至多发言两次，总计最多8条，符合人设并互相回应。需要未知结果的行动必须提出check，然后停止对结果的推测。只输出JSON数组，不输出解释或围栏，严格按完整示例：
[{"speaker":"材料中原始角色id","dialogue":"10–100字角色发言，不泄露未知真相，不含表情标记","emotion":"惊讶","action":"0–60字可观察动作，不写行动已成功","check":{"skill":"侦查","reason":"1–80字检定原因","difficulty":"regular"}},{"speaker":"材料中原始角色id","dialogue":"10–100字回应","emotion":"正常","action":"0–60字动作"}]
每条必须填写 emotion，从本轮 expressionNames 中原样选一个适合当前台词的名称，平静时选正常。无需检定时省略check；check.skill仅限${SKILLS.join('、')}；difficulty仅regular、hard、extreme；所有speaker必须来自指定扮演名单。`;
const SUMMARY_RULES = `你是幕间记录员。仅总结已公开的实际记录，不推测真相，不补写私密线索。严格输出完整JSON且无解释：{"clues":["已公开取得的线索名，每项1–40字"],"events":["已发生的关键事件，每项10–80字"],"statChanges":["实际HP/SAN变化，每项1–60字"]}。每个数组最多8项，未知时空数组。`;
const KEEPER_RULES = `你是CoC轻量跑团守秘人，按下方角色性格与口吻主持。完整模组和秘密仅供规划，叙事只公开调查员当前可以观察的信息。每轮80–250字，给出可行动的现场；不得一次剧透真相，不代替玩家行动。掷骰、状态变化、线索发放、切场景和密信必须调用对应工具，不能仅在正文声称执行；工具失败不能声称成功。检定难度regular普通、hard困难、extreme极难。检定成功后根据模组给出线索与后果，失败也允许付出代价推进。已退场角色不能行动。遇到全员退场，提示引入替补或推进结局。遇到战斗调用trigger_encounter，再按检定与状态工具裁决。结束条件满足时提出结团，由玩家确认，不写主世界记忆。
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
  tool('request_and_roll_dice', '为指定调查员执行D100检定。', { targetChar: str, skill: { type: 'string', enum: SKILLS }, difficulty: { type: 'string', enum: ['regular', 'hard', 'extreme'] } }),
  tool('update_investigator_stat', '调整HP/SAN并公开原因。', { targetChar: str, hpDelta: num, sanDelta: num, reason: str }),
  tool('reveal_clue', '发放真实线索，all公开或指定角色私有。', { clueId: str, targetCharOrAll: str }),
  tool('switch_scene', '进入模组指定场景，先生成公开幕间摘要。', { sceneId: str }),
  tool('send_secret_handout', '仅给指定调查员发送密信。', { targetChar: str, content: str }),
  tool('trigger_encounter', '触发遭遇战并异步生成事件特写。', { description: str }),
];

export default function registerGamePlugin(ctx) {
  const { router, db, llm, bridgeTools, imageService } = ctx;
  const busy = new Set(), mediaJobs = new Set(); let closed = false;
  function load(id) {
    const row = db.load(id);
    if (!row?.state?.scenario) fail('跑团存档不存在', 404);
    const s = structuredClone(row.state);
    if (s.player) return s;
    s.player = publicPlayer(ctx.playerProfile());
    s.version = 2;
    const oldCard = s.investigators.find(c => c.player);
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
    return s;
  }
  const persist = state => {
    if (closed) fail('游戏已经关闭', 409);
    const current = db.load(state.sessionId); if (!current) fail('存档已删除', 404);
    const completed = new Map((current.state.imageJobs || []).filter(j => j.status !== 'running').map(j => [j.id, j]));
    state.imageJobs = state.imageJobs.map(j => j.status === 'running' && completed.has(j.id) ? completed.get(j.id) : j);
    db.write(state.sessionId, state.title, state, current.revision);
  };
  const addLog = (s, speaker, dialogue, action = '', kind = 'dialogue', actorId, expressionSlot) => s.publicLog.push({ id: randomUUID(), round: s.round, sceneId: s.sceneId, speaker, dialogue: text(dialogue, 6000), action: text(action, 1000), kind,
    ...(actorId ? { actorId, expressionSlot: expressionSlot || NORMAL_SLOT } : {}),
  });
  const character = (s, id) => { const c = s.investigators.find(i => i.id === String(id)); if (!c) fail('调查员不存在'); return c; };
  const scene = s => s.scenario.scenes.find(x => x.id === s.sceneId);
  const working = s => { if (s.ended) fail('本局已经结团'); };
  function view(s) {
    const keeper = s.mode === 'keeper';
    const own = s.investigators.find(c => c.player);
    return { sessionId: s.sessionId, title: s.title, mode: s.mode, player: publicPlayer(s.player), scene: { id: scene(s).id, name: scene(s).name, publicDesc: scene(s).publicDesc },
      investigators: s.investigators.map(c => ({ ...c, persona: undefined, inventory: keeper || c.player ? c.inventory : [] })), publicLog: s.publicLog,
      summaries: s.summaries, round: s.round, pendingBatch: s.pendingBatch, pendingCheck: s.pendingCheck,
      clues: s.scenario.clues.filter(c => s.revealed.includes(c.id) || (own && (s.privateClues[own.id] || []).includes(c.id))),
      handouts: keeper ? s.handouts : own ? { [own.id]: s.handouts[own.id] || '' } : {},
      imageJobs: s.imageJobs, ended: s.ended, memoryWritten: !!s.memoryWritten,
      ...(keeper ? { scenario: s.scenario, kpSecrets: s.kpSecrets } : { keeperId: s.keeper?.id }),
    };
  }
  function startMedia(s, reason) {
    if (!s.imagesEnabled || closed) return;
    const id = randomUUID(), entry = { id, sceneId: s.sceneId, kind: reason === 'scene' ? 'scene' : 'event', status: 'running' };
    s.imageJobs.push(entry); persist(s);
    const sessionId = s.sessionId;
    const prompt = `${s.scenario.meta.stylePrompt}, ${scene(s).imagePrompt}, ${reason === 'scene' ? 'environment establishing shot, no people' : `dramatic object closeup, ${reason}`}, no text`;
    mediaJobs.add(id);
    imageService.generate({ sessionId, prompt, outputScope: 'game', width: 1024, height: 576 }).then(result => settle({ status: 'done', url: result.url }), error => { console.warn('[trpg media]', error.message); return settle({ status: 'failed', error: '图片生成失败，请检查生图服务后重试' }); }).catch(error => console.warn('[trpg media]', error.message)).finally(() => mediaJobs.delete(id));
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
      if (line.check) s.pendingCheck = { targetChar: line.speaker, ...line.check };
    }
    batch.acked = count;
    if (discard || s.pendingCheck || count === batch.lines.length) { s.lastBatch = { id: batch.id, count }; s.pendingBatch = null; }
  }
  function roll(s, targetChar, skill, difficulty = 'regular', secret = false) {
    const c = character(s, targetChar); if (c.outOfAction) fail('已退场调查员不能检定');
    if (!SKILLS.includes(skill)) fail('不存在这个技能');
    const result = { targetChar: c.id, name: c.name, skillName: skill, ...rollD100(c.skills[skill], difficulty) };
    if (secret) s.kpSecrets.darkRolls.push(result);
    else addLog(s, '骰子', `${c.name} · ${skill} ${result.value}/${result.target} · ${{ critical: '大成功', extreme: '极难成功', hard: '困难成功', regular: '普通成功', failure: '失败', fumble: '大失败' }[result.rank]}`, '', 'dice');
    if (s.mode === 'investigator' && !secret) ctx.events?.emit('dice', { sessionId: s.sessionId, roll: result });
    s.pendingCheck = null;
    if (['critical', 'fumble'].includes(result.rank)) startMedia(s, `${result.rank}, ominous dice on the table`);
    return result;
  }
  async function apply(s, name, args) {
    working(s);
    switch (name) {
      case 'request_and_roll_dice': return roll(s, args.targetChar, args.skill, args.difficulty, args.secret === true && s.mode === 'keeper');
      case 'update_investigator_stat': {
        const c = character(s, args.targetChar);
        if (!integer(args.hpDelta, -100, 100) || !integer(args.sanDelta, -100, 100) || !text(args.reason).trim()) fail('状态变化需要整数增减值与原因');
        normalizeStats(Object.assign(c, { hp: c.hp + args.hpDelta, san: c.san + args.sanDelta }));
        addLog(s, '裁决', `${c.name} HP ${args.hpDelta >= 0 ? '+' : ''}${args.hpDelta} / SAN ${args.sanDelta >= 0 ? '+' : ''}${args.sanDelta}：${text(args.reason, 200)}${c.outOfAction ? '（退场，可引入替补或推进结局）' : ''}`, '', 'stat'); return { hp: c.hp, san: c.san, outOfAction: c.outOfAction };
      }
      case 'reveal_clue': {
        const clue = s.scenario.clues.find(c => c.id === args.clueId); if (!clue) fail('线索不存在');
        if (args.targetCharOrAll === 'all') {
          if (!s.revealed.includes(clue.id)) { s.revealed.push(clue.id); addLog(s, '线索', `${clue.title}：${clue.content}`, '', 'clue'); }
        } else {
          const c = character(s, args.targetCharOrAll);
          const list = s.privateClues[c.id] ||= [];
          if (!list.includes(clue.id)) { list.push(clue.id); s.handouts[c.id] = `${s.handouts[c.id] || ''}\n${clue.title}：${clue.content}`.trim(); }
        }
        return { delivered: true };
      }
      case 'send_secret_handout': {
        const c = character(s, args.targetChar); if (!text(args.content, 3000).trim()) fail('密信不能为空');
        s.handouts[c.id] = `${s.handouts[c.id] || ''}\n${text(args.content, 3000)}`.slice(-12000); return { delivered: true };
      }
      case 'switch_scene': {
        const next = s.scenario.scenes.find(x => x.id === args.sceneId); if (!next) fail('场景不存在'); if (next.id === s.sceneId) return { sceneId: s.sceneId };
        const raw = await llm.complete({ rules: SUMMARY_RULES, data: JSON.stringify({ logs: s.publicLog.filter(l => l.sceneId === s.sceneId), publicClues: s.revealed }), task: '压缩上一幕公开记录，按JSON示例输出。', scope: `${s.sessionId}:summary` });
        const summary = json(raw);
        if (['clues', 'events', 'statChanges'].some(k => !Array.isArray(summary[k]) || summary[k].some(v => typeof v !== 'string'))) fail('幕间摘要格式无效', 502);
        s.summaries.push({ sceneId: s.sceneId, ...Object.fromEntries(['clues', 'events', 'statChanges'].map(k => [k, summary[k].slice(0, 8).map(v => v.slice(0, 200))])) });
        s.sceneId = next.id; addLog(s, 'KP', next.publicDesc, '', 'scene'); startMedia(s, 'scene'); return { sceneId: next.id };
      }
      case 'trigger_encounter': { const description = text(args.description, 1000); if (!description) fail('遭遇描述不能为空'); addLog(s, '遭遇', description, '', 'encounter'); startMedia(s, description); return { started: true }; }
      default: fail('未知的KP工具');
    }
  }
  async function makeCards(profiles) {
    if (!profiles.length) return [];
    const raw = await llm.complete({ rules: CARD_RULES, personas: profiles.map(p => p.base_prompt || p.short_prompt || ''), data: JSON.stringify(profiles.map(p => ({ id: String(p.id), name: p.display_name || p.name }))), task: '一次生成名单内全部调查员卡，严格输出完整JSON数组。', scope: 'cards' });
    const cards = json(raw);
    if (!Array.isArray(cards) || cards.length !== profiles.length) fail('调查员卡数量不符', 502);
    return profiles.map(p => {
      const card = cards.find(c => c?.id === String(p.id));
      if (!card || ATTRIBUTES.some(k => !integer(card.attributes?.[k], 20, 80)) || SKILLS.some(k => !integer(card.skills?.[k], 15, 80))) fail('调查员卡字段或数值不合法', 502);
      const skills = normalizeCardSkills(card.skills);
      const maxHp = Math.floor((card.attributes.CON + card.attributes.SIZ) / 10), maxSan = card.attributes.POW;
      const player = p.id === PLAYER_ID;
      return { id: String(p.id), characterId: player ? null : p.id, player, name: p.display_name || p.name, avatar: p.avatar_path, standing: p.standing_url, persona: player ? '' : p.base_prompt || p.short_prompt || '', attributes: card.attributes, skills,
        hp: maxHp, maxHp, san: maxSan, maxSan, mp: Math.floor(maxSan / 5), insane: false, outOfAction: false, inventory: [], handout: '' };
    });
  }
  async function generateBatch(s, slots) {
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
        task: '扮演指定名单，按示例输出含表情的行动与对话；需要检定时提出check。', scope: `${s.sessionId}:investigators` });
      const output = json(raw);
      if (!Array.isArray(output) || output.length > 8) fail('调查员发言格式不合法', 502);
      for (const l of output) {
        const cue = dialogueCue(text(l?.dialogue, 600), l?.emotion, slots);
        if (!group.some(c => c.id === l?.speaker) || !cue.dialogue || (l.check && (!SKILLS.includes(l.check.skill) || !['regular', 'hard', 'extreme'].includes(l.check.difficulty || 'regular')))) fail('调查员发言角色或检定不合法', 502);
        lines.push({ speaker: l.speaker, ...cue, action: text(l.action, 300), ...(l.check ? { check: { skill: l.check.skill, reason: text(l.check.reason, 200), difficulty: l.check.difficulty || 'regular' } } : {}) });
        if (l.check || lines.length === 8) break;
      }
      if (lines.some(l => l.check) || lines.length === 8) break;
    }
    if (lines.length) s.pendingBatch = { id: randomUUID(), lines, acked: 0 };
  }
  const route = (method, url, handler, { lock = true } = {}) => router[method](url, async (req, res) => {
    const id = req.body?.sessionId || req.query?.sessionId;
    if (closed) fail('游戏已经关闭', 409);
    if (lock && id && busy.has(id)) fail('当前存档正在执行另一项操作', 409);
    if (lock && id) busy.add(id);
    try { res.json(await handler(req.body || {}, req.query || {})); } finally { if (lock && id) busy.delete(id); }
  });
  route('get', '/catalog', async () => ({
    skills: SKILLS,
    scenarios: ctx.scenarios().map(s => ({ id: s.id || s.meta.title, meta: s.meta, scenes: s.scenes.length,
      opening: s.scenes[0]?.publicDesc, briefing: s.briefing })),
  }), { lock: false });
  route('get', '/cast', async () => ctx.castAssets(), { lock: false });
  route('post', '/parse-scenario', async body => {
    if (typeof body.content !== 'string' || !body.content.trim() || body.content.length > 100000) fail('请上传不超过 10 万字的剧本');
    if (body.format === 'json') { try { return validateScenario(JSON.parse(body.content)); } catch { /* Nonstandard JSON scripts use the same extraction path as text. */ } }
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
    const state = { version: 2, sessionId, title: scenario.meta.title, scenario, keeper, player: publicPlayer(player), mode: body.mode, investigators, sceneId: first.id, publicLog: [],
      kpSecrets: { truth: scenario.keeperSecrets, darkRolls: [] }, handouts: {}, privateClues: {}, revealed: [], summaries: [], round: 0, pendingBatch: null, pendingCheck: null, imageJobs: [], imagesEnabled: body.imagesEnabled === true, ended: false };
    addLog(state, 'KP', first.publicDesc, '', 'scene');
    db.write(sessionId, state.title, state); startMedia(state, 'scene'); return view(state);
  }, { lock: false });
  route('get', '/state', async (_b, q) => {
    const s = load(q.sessionId); let dirty = false;
    for (const job of s.imageJobs) if (job.status === 'running' && !mediaJobs.has(job.id)) { job.status = 'failed'; job.error = '上次生成已中断，可重试'; dirty = true; }
    if (dirty && !busy.has(q.sessionId)) persist(s);
    return view(s);
  }, { lock: false });
  route('post', '/ack', async body => { const s = load(body.sessionId); working(s); commitBatch(s, body.batchId, body.count, body.discard === true); persist(s); return view(s); });
  route('post', '/turn', async body => {
    const s = load(body.sessionId); working(s);
    const slots = ctx.expressionSlots();
    const input = dialogueCue(text(body.message, 3000), '', slots, { preferredSlot: body.expressionSlot });
    if (input.dialogue && s.investigators.some(c => c.player && c.outOfAction)) fail('你已退场，可以继续旁观调查');
    if (s.pendingBatch) commitBatch(s, body.batchId, body.count, true);
    if (s.pendingCheck) fail('请先完成当前检定');
    s.round++;
    if (input.dialogue) {
      const speaker = s.mode === 'keeper' ? text(body.speaker, 100).trim() || s.player.name : s.player.name;
      addLog(s, speaker, input.dialogue, '', 'dialogue', PLAYER_ID, input.expressionSlot);
    }
    persist(s);
    if (s.mode === 'investigator') {
      const { gender, appearance, persona } = ctx.playerProfile();
      const content = await llm.agent({ rules: KEEPER_RULES, personas: [s.keeper.base_prompt || s.keeper.short_prompt || ''],
        data: JSON.stringify({ ...investigatorContext(s), scenario: s.scenario, kpSecrets: s.kpSecrets, handouts: s.handouts, playerIdentity: { id: PLAYER_ID, name: s.player.name, gender, appearance, persona },
          investigators: s.investigators.map(({ persona, ...c }) => c), expressionNames: slots.map(slot => slot.name) }),
        task: '根据玩家刚才的行动主持下一段，按约定以表情标记开头，只给公开叙事。', scope: `${s.sessionId}:keeper` }, KP_TOOLS, async (name, args) => { const result = await apply(s, name, args); persist(s); return result; });
      const cue = dialogueCue(content.trim(), '', slots, { leadingTag: true });
      if (cue.dialogue) addLog(s, s.keeper.display_name || s.keeper.name || 'KP', cue.dialogue, '', 'dialogue', String(s.keeper.id), cue.expressionSlot);
      persist(s);
    }
    await generateBatch(s, slots); persist(s); return view(s);
  });
  route('post', '/roll', async body => {
    const s = load(body.sessionId); working(s);
    if (s.pendingBatch) fail('请先暂停发言');
    if (s.mode !== 'keeper' && !s.pendingCheck) fail('当前没有待执行检定');
    const args = s.pendingCheck || body;
    const result = roll(s, args.targetChar, args.skill, args.difficulty, s.mode === 'keeper' && body.secret === true);
    persist(s); return { ...view(s), roll: result };
  });
  route('post', '/control', async body => {
    const s = load(body.sessionId); working(s); if (s.mode !== 'keeper') fail('仅玩家KP可以使用控制台', 403);
    if (s.pendingBatch || s.pendingCheck) fail('请先暂停发言并处理检定');
    const result = await apply(s, body.tool, body.args || {}); persist(s); return { ...view(s), result };
  });
  route('post', '/replacement', async body => {
    const s = load(body.sessionId); working(s);
    if (!s.investigators.some(c => c.outOfAction)) fail('当前没有退场调查员');
    if (!integer(body.characterId, 1, 2147483647) || s.keeper?.id === body.characterId || s.investigators.some(c => c.id === String(body.characterId))) fail('请选择尚未入场的角色');
    const [card] = await makeCards([await bridgeTools.call('get_character_profile', { characterId: body.characterId })]);
    s.investigators.push(card); addLog(s, 'KP', `替补调查员「${card.name}」加入了调查。`); persist(s); return view(s);
  });
  route('post', '/retry-image', async body => { const s = load(body.sessionId); working(s); if (s.imageJobs.some(j => j.status === 'running')) fail('图片仍在生成中'); s.imagesEnabled = true; startMedia(s, 'scene'); return view(s); });
  route('post', '/finish', async body => {
    const s = load(body.sessionId);
    if (!s.ended) { s.pendingBatch = null; s.pendingCheck = null; s.ended = true; addLog(s, '落幕', text(body.ending, 1000) || '调查到此告一段落。桌上的骰子终于安静下来。', '', 'ending'); persist(s); }
    if (body.writeMemory === true && !s.memoryWritten) {
      await ctx.remember(s.sessionId, s.investigators, s.title, s.publicLog.filter(l => l.kind === 'ending').at(-1)?.dialogue || '');
      s.memoryWritten = true; persist(s);
    }
    return view(s);
  });
  return { onUnload() { closed = true; } };
}
