/**
 * 轻量小镇居民（NPC）服务
 *
 * 定位：世界观生成的轻量居民——不进 characters 表、没有日程/记忆/关系全套大脑，
 * 只在镇上生活与就地对话。作息（routine_json）由 LLM 初始化时一次性生成，此后永久本地执行。
 *
 * 素材：正/背两张像素小人（npc_{id}_{down|up}，600×800→36×48）+ 一张正式立绘
 * （npc_{id}_portrait，900×1600 白底抠白）——全部走酒馆立绘同款 LLM 出 prompt 结构。
 * 就地聊天：persona + 现场语境 + 最近对话历史 → 单轮 LLM，历史存 town_npc_chat_messages。
 */
import { getDb, getSystemRules, getWorldSetting } from '../../db/index.js';
import { getWorldIntegrationRule } from '../../builtinRules.js';
import { config } from '../../config.js';
import { chatSync } from '../../llm/llm-client.js';
import { createAsset, regenerateAsset, getAssetsByKey, deleteAsset, SPRITE_DIRECTIONS } from './townAssetService.js';
import { generateSpritePrompt, generatePortraitPrompt } from './townPromptBuilder.js';
import { buildCharacterAppearanceSection } from '../characterPersona.js';
import { getMapRow } from './townMapService.js';
import { broadcastTownBubble } from './townBus.js';

// ── 查询 ──

export function listNpcs() {
  const db = getDb();
  const npcs = db.prepare('SELECT * FROM town_npcs ORDER BY id').all();
  return npcs.map(npcToDto);
}

export function getNpc(id) {
  return npcToDto(getDb().prepare('SELECT * FROM town_npcs WHERE id = ?').get(id));
}

function npcToDto(row) {
  if (!row) return null;
  let routine = [];
  let traits = {};
  try { routine = JSON.parse(row.routine_json || '[]'); } catch { /* 忽略坏数据 */ }
  try { traits = JSON.parse(row.traits_json || '{}'); } catch { /* 忽略坏数据 */ }
  const sprites = {};
  for (const dir of SPRITE_DIRECTIONS) {
    sprites[dir] = getAssetsByKey([`npc_${row.id}_${dir}`])[0] || null;
  }
  const spriteReady = SPRITE_DIRECTIONS.every(d => sprites[d]?.status === 'ready');
  const portrait = getAssetsByKey([`npc_${row.id}_portrait`])[0] || null;
  return {
    id: row.id,
    mapId: row.map_id,
    displayName: row.display_name,
    persona: row.persona || '',
    job: row.job || '',
    homeLocationId: row.home_location_id,
    routine,
    traits,
    spriteReady,
    sprites,
    portrait,
    characterId: row.character_id || null, // 已邀请入邻舍时的角色 id
    townEnabled: !!row.town_enabled,
  };
}

export function npcCount() {
  return getDb().prepare('SELECT COUNT(*) AS n FROM town_npcs').get().n;
}

// ── CRUD ──

export function createNpc({ mapId, displayName, persona = '', job = '', traits = {}, routine = [], homeLocationId = null, townEnabled = 1 }) {
  const db = getDb();
  const r = db.prepare(`
    INSERT INTO town_npcs (map_id, display_name, persona, job, routine_json, traits_json, home_location_id, town_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(mapId ?? null, displayName, persona, job, JSON.stringify(routine), JSON.stringify(traits), homeLocationId, townEnabled ? 1 : 0);
  return getNpc(Number(r.lastInsertRowid));
}

export function updateNpc(id, { displayName, persona, job, routine, traits, homeLocationId, townEnabled } = {}) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM town_npcs WHERE id = ?').get(id);
  if (!row) return null;
  db.prepare(`
    UPDATE town_npcs SET
      display_name = ?, persona = ?, job = ?,
      routine_json = ?, traits_json = ?, home_location_id = ?, town_enabled = ?
    WHERE id = ?
  `).run(
    displayName ?? row.display_name,
    persona ?? row.persona,
    job ?? row.job,
    routine ? JSON.stringify(routine) : row.routine_json,
    traits ? JSON.stringify(traits) : row.traits_json,
    homeLocationId !== undefined ? homeLocationId : row.home_location_id,
    townEnabled === undefined ? row.town_enabled : (townEnabled ? 1 : 0),
    id,
  );
  return getNpc(id);
}

export function deleteNpc(id) {
  const r = getDb().prepare('DELETE FROM town_npcs WHERE id = ?').run(id);
  return { ok: r.changes > 0 };
}

// ── 精灵 / 立绘生成 ──

/** 世界观 styleTags：优先取素材库中已存的（整套共享），保证精灵与小镇风格一致 */
export function getWorldStyleTags() {
  const row = getDb().prepare(`
    SELECT meta_json FROM town_assets WHERE status = 'ready' AND kind IN ('ground','road','building','prop') ORDER BY id LIMIT 1
  `).get();
  if (!row) return '';
  try { return JSON.parse(row.meta_json || '{}').styleTags || ''; } catch { return ''; }
}

/** 统一从 NPC 人格卡的「## 你的外观」段取生图外观 */
function npcAppearanceSection(npcRow) {
  const character = { base_prompt: npcRow.persona || '' };
  if (npcRow.character_id) character.id = npcRow.character_id;
  return buildCharacterAppearanceSection(character, { outfits: npcRow.character_id ? 'auto' : null });
}

/** 组装四层结构用的「角色外观信息」文本 */
function npcAppearanceInfo(npcRow, styleTags) {
  const appearanceSection = npcAppearanceSection(npcRow);
  const activeStyleTags = styleTags !== undefined ? String(styleTags || '') : getWorldStyleTags();
  return [
    `【名字】${npcRow.display_name}`,
    npcRow.job ? `【职业】${npcRow.job}（小镇居民）` : '【身份】小镇居民',
    appearanceSection
      ? `【外观（从人格卡提取，必以此为准）】\n${appearanceSection}`
      : npcRow.persona
        ? `【人格卡（缺少标准外观段）】\n${npcRow.persona}`
        : '',
    `【画风基调】${activeStyleTags || 'cozy pixel town'}`,
  ].filter(Boolean).join('\n');
}

export function playerAppearanceInfo() {
  const u = config.user;
  return [
    `【名字】${u.nickname || '我'}（来到小镇的玩家）`,
    u.gender ? `【性别】${u.gender}` : '',
    u.appearance ? `【外观描述】${u.appearance}` : '',
    u.persona ? `【人设】${u.persona}` : '',
    `【画风基调】${getWorldStyleTags() || 'cozy pixel town'}`,
  ].filter(Boolean).join('\n');
}

/** 生成 NPC 像素小人；direction 存在时只重绘指定方向（600×800 → 36×48） */
export async function generateNpcSprites(npcId, overrides = {}) {
  const npcRow = getDb().prepare('SELECT * FROM town_npcs WHERE id = ?').get(npcId);
  if (!npcRow) throw new Error(`npc #${npcId} not found`);
  const styleTags = overrides.styleTags !== undefined ? overrides.styleTags : getWorldStyleTags();
  const appearanceInfo = npcAppearanceInfo(npcRow, styleTags);
  const directions = overrides.direction
    ? [String(overrides.direction)]
    : [...SPRITE_DIRECTIONS];
  if (directions.some(dir => !SPRITE_DIRECTIONS.includes(dir))) {
    throw new Error('invalid sprite direction');
  }

  for (const dir of directions) {
    const key = `npc_${npcId}_${dir}`;
    const existing = getAssetsByKey([key])[0];
    if (existing?.status === 'ready' && !overrides.force) continue;
    try {
      const prompt = await generateSpritePrompt({ appearanceInfo, direction: dir });
      // 保留既有素材 ID，避免前端/地图仍引用旧 image_path 时出现 404。
      if (existing) {
        await regenerateAsset(existing.id, {
          styleTags, prompt,
          promptPrefix: overrides.promptPrefix, loras: overrides.loras, artist: overrides.artist,
        });
      } else {
        await createAsset({
          kind: 'npc', key, name: `${npcRow.display_name} ${dir}`,
          desc: npcAppearanceSection(npcRow) || npcRow.display_name,
          meta: {
            direction: dir, styleTags, npcId, promptOverride: prompt,
            promptPrefix: overrides.promptPrefix, loras: overrides.loras, artist: overrides.artist,
          },
        });
      }
    } catch (err) {
      console.warn(`[townNpcs] sprite ${dir} failed:`, err?.message);
    }
  }

  const allReady = SPRITE_DIRECTIONS.every(d => getAssetsByKey([`npc_${npcId}_${d}`])[0]?.status === 'ready');
  getDb().prepare('UPDATE town_npcs SET sprite_ready = ? WHERE id = ?').run(allReady ? 1 : 0, npcId);
  return { ok: true, spriteReady: allReady };
}

/** 生成 NPC 正式立绘（900×1600 白底插画 → 抠白），交互时跳出展示 */
export async function generateNpcPortrait(npcId, overrides = {}) {
  const npcRow = getDb().prepare('SELECT * FROM town_npcs WHERE id = ?').get(npcId);
  if (!npcRow) throw new Error(`npc #${npcId} not found`);
  const key = `npc_${npcId}_portrait`;
  const existing = getAssetsByKey([key])[0];
  const styleTags = overrides.styleTags !== undefined ? overrides.styleTags : getWorldStyleTags();
  const prompt = await generatePortraitPrompt({ appearanceInfo: npcAppearanceInfo(npcRow, styleTags) });
  const asset = existing
    ? await regenerateAsset(existing.id, {
      styleTags, prompt, promptPrefix: overrides.promptPrefix, loras: overrides.loras, artist: overrides.artist,
    })
    : await createAsset({
      kind: 'portrait', key, name: `${npcRow.display_name} 立绘`,
      desc: npcAppearanceSection(npcRow) || npcRow.display_name,
      meta: { npcId, promptOverride: prompt, styleTags, promptPrefix: overrides.promptPrefix, loras: overrides.loras, artist: overrides.artist },
    });
  return { ok: true, asset };
}

/** 只重生成一位居民的完整人格卡，不改名字与职业 */
export async function regenerateNpcPersonaCard(npcId, overrides = {}) {
  const row = getDb().prepare('SELECT * FROM town_npcs WHERE id = ?').get(npcId);
  if (!row) throw new Error('NPC 不存在');
  const { card } = await generateNpcPersonaCard({
    displayName: row.display_name,
    job: row.job || '',
    worldHint: overrides.worldHint !== undefined ? overrides.worldHint : getWorldStyleTags(),
  });
  updateNpc(npcId, { persona: card });
  // 外观可能变化，让素材状态进入待重建，但保留旧图直到用户重绘。
  getDb().prepare('UPDATE town_npcs SET sprite_ready = 0 WHERE id = ?').run(npcId);
  return getNpc(npcId);
}

/** 角色立绘：复用 characters.standing_url；没有才走 LLM 生成（存素材库 char_{id}_portrait） */
export async function generateCharacterPortrait(characterId) {
  const db = getDb();
  const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
  if (!char) throw new Error('角色不存在');
  if (char.standing_url) {
    return { ok: true, reused: true, asset: null, url: char.standing_url };
  }
  const { buildCharacterPersona } = await import('../characterPersona.js');
  const appearanceInfo = [
    `【名字】${char.display_name || char.name}`,
    `【角色卡】\n${buildCharacterPersona(char, { variant: 'short', person: char.display_name || char.name })}`,
    `【画风基调】${getWorldStyleTags() || 'cozy pixel town'}`,
  ].filter(Boolean).join('\n');
  const prompt = await generatePortraitPrompt({ appearanceInfo });
  const key = `char_${characterId}_portrait`;
  const existing = getAssetsByKey([key])[0];
  if (existing) deleteAsset(existing.id);
  const asset = await createAsset({
    kind: 'portrait', key, name: `${char.display_name || char.name} 立绘`,
    desc: char.short_prompt || char.base_prompt || char.name,
    meta: { characterId, promptOverride: prompt },
  });
  return { ok: true, reused: false, asset, url: asset.image_path };
}

// ── 玩家形象套装（立绘 + 正/背小人，「我」的确认窗口用） ──

export function getPlayerKit() {
  const sprites = {};
  for (const dir of SPRITE_DIRECTIONS) {
    sprites[dir] = getAssetsByKey([`player_${dir}`])[0] || null;
  }
  return {
    sprites,
    portrait: getAssetsByKey(['player_portrait'])[0] || null,
  };
}

/** 重新生成玩家套装（LLM 出 prompt；串行队列内逐张完成，await 返回即全部 ready） */
export async function regeneratePlayerSprite(direction, overrides = {}) {
  if (!SPRITE_DIRECTIONS.includes(direction)) throw new Error('无效的小人方向');
  const key = `player_${direction}`;
  const existing = getAssetsByKey([key])[0];
  const prompt = await generateSpritePrompt({
    appearanceInfo: playerAppearanceInfo(),
    direction,
  });
  const styleTags = getWorldStyleTags();
  if (existing) {
    // 保留素材 ID；旧图会一直显示到新图生成成功。
    await regenerateAsset(existing.id, {
      styleTags, prompt, promptPrefix: overrides.promptPrefix, loras: overrides.loras, artist: overrides.artist,
    });
  } else {
    await createAsset({
      kind: 'player', key, name: `玩家 ${direction}`, desc: 'the player character',
      meta: {
        direction,
        styleTags,
        promptOverride: prompt,
        promptPrefix: overrides.promptPrefix,
        loras: overrides.loras,
        artist: overrides.artist,
      },
    });
  }
  return { ok: true, kit: getPlayerKit() };
}

export async function regeneratePlayerKit(overrides = {}) {
  const info = playerAppearanceInfo();
  const styleTags = getWorldStyleTags();
  for (const dir of SPRITE_DIRECTIONS) {
    const key = `player_${dir}`;
    const existing = getAssetsByKey([key])[0];
    const prompt = await generateSpritePrompt({ appearanceInfo: info, direction: dir });
    if (existing) {
      await regenerateAsset(existing.id, {
        styleTags, prompt, promptPrefix: overrides.promptPrefix, loras: overrides.loras, artist: overrides.artist,
      });
    } else {
      await createAsset({
        kind: 'player', key, name: `玩家 ${dir}`, desc: 'the player character',
        meta: { direction: dir, styleTags, promptOverride: prompt, promptPrefix: overrides.promptPrefix, loras: overrides.loras, artist: overrides.artist },
      });
    }
  }
  return regeneratePlayerPortrait(overrides);
}

/** Regenerate only the player's portrait, leaving both sprites untouched. */
export async function regeneratePlayerPortrait(overrides = {}) {
  const info = playerAppearanceInfo();
  const styleTags = getWorldStyleTags();
  const existingPortrait = getAssetsByKey(['player_portrait'])[0];
  const portraitPrompt = await generatePortraitPrompt({ appearanceInfo: info });
  if (existingPortrait) {
    const portrait = await regenerateAsset(existingPortrait.id, {
      styleTags, prompt: portraitPrompt, promptPrefix: overrides.promptPrefix,
      loras: overrides.portraitLoras ? overrides.loras : [], artist: overrides.artist,
    });
    return { ok: true, kit: getPlayerKit(), portrait };
  }
  const portrait = await createAsset({
    kind: 'portrait', key: 'player_portrait', name: '玩家 立绘', desc: 'the player character',
    meta: { styleTags, promptOverride: portraitPrompt, promptPrefix: overrides.promptPrefix, loras: overrides.portraitLoras ? overrides.loras : [], artist: overrides.artist },
  });
  return { ok: true, kit: getPlayerKit(), portrait };
}

// ── NPC 人格卡（对齐酒馆招募角色流程：四层 system + 结构化模板，跳过网络搜索） ──

/**
 * 为居民生成结构化人格卡（你就是她/他 第二人称模板，同 characters 人格生成器）。
 * 外观统一放在「## 你的外观」，生图时由 characterPersona 统一截取。
 * @param {object} p - { displayName, job, worldHint }
 * @returns {Promise<{card: string}>} card 为完整人格卡
 */
export async function generateNpcPersonaCard({ displayName, job = '', worldHint = '' }) {
  const world = getWorldSetting();
  const worldBlock = world || '';
  const personaMsgs = [
    {
      role: 'system',
      content: [getSystemRules({ roleplay: false }), worldBlock].filter(Boolean).join('\n\n'),
    },
  ];
  if (worldBlock) {
    personaMsgs.push({ role: 'system', content: getWorldIntegrationRule('town_asset') });
  }
  personaMsgs.push({ role: 'system', content: `【输出结构】
你是[名字]。

## 你的身份
[2-3句话：职业背景、怎么来到这座小镇、生活的关键词]

## 你的性格
- [至少4条，以"你"的口吻自然写出：表层语调 / 内因驱动 / 言行反差 / 裂缝时刻]

## 你的好恶
- 你最喜欢的两三样东西
- 你最排斥/最害怕的两三样东西

## 你的外观
- [一句话描述外貌（发型/瞳色/体型/种族特征），突出辨识度]
- [一句话描述穿着和主要装饰品]

【输出要求】
- 只输出人格卡本身（从"你是"开始），不要标题、解释或列表符号以外的格式
- 你的外观 两段必须具体（发色/瞳色/服装颜色），后续生成像素小人与立绘都以此为准` });
  personaMsgs.push({ role: 'system', content: `【任务要求】
你是一个角色人格生成器。用户会给出小镇居民的名字与职业，你为他们生成一张完整的人格卡。

你的任务：根据<world_setting>世界观，把这个居民写成有血有肉的角色。

【核心创作原则 —— 必须遵守】
A. 你就是她/他 —— 所有描述从"你"出发。全文不得出现"扮演""模仿"等旁观字眼。
B. 过去化为直觉 —— 经历塑造性格，但对话中不主动提及过去。
C. 自我认知而非外部评价 —— 写"我怎么看自己"。
D. 生活感 —— 这是小镇的日常居民，写ta的工作日常、邻里关系、生活小习惯。` });
  personaMsgs.push({
    role: 'user',
    content: [
      worldHint ? `【用户额外指定】\n${worldHint}` : '',
      `居民名字：${displayName}`,
      job ? `职业：${job}` : '',
      '请执行：生成这位居民的人格卡。',
    ].filter(Boolean).join('\n\n'),
  });
  const msgs = personaMsgs;
  const out = await chatSync(msgs, {
    temperature: 0.5, // 有明确设定（名字/职业/世界观）→ 低温稳定特征
    max_tokens: 1600,
    label: '小镇居民人格卡',
  });

  const card = String(out || '').replace(/^\s*```(?:[a-z]+)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  if (!card.startsWith('你是') || !card.includes('## 你的外观')) {
    throw new Error('人格卡缺少完整结构或「## 你的外观」');
  }
  return { card };
}

// ── 邀请入邻舍（NPC → 聊天侧角色） ──

/** 把小镇居民邀请为邻舍角色：characters 建档（人设/外观沿用 NPC 卡），NPC 记住对应关系 */
export async function inviteNpcAsCharacter(npcId) {
  const db = getDb();
  const npc = getNpc(npcId);
  if (!npc) throw new Error('NPC 不存在');
  if (npc.characterId) {
    const exists = db.prepare('SELECT id, name FROM characters WHERE id = ?').get(npc.characterId);
    if (exists) return { ok: true, characterId: exists.id, name: exists.name, already: true };
  }

  // 角色名唯一约束：重名时加后缀
  let name = npc.displayName;
  if (db.prepare('SELECT id FROM characters WHERE name = ?').get(name)) {
    name = `${name}_镇`;
    let i = 2;
    while (db.prepare('SELECT id FROM characters WHERE name = ?').get(name)) name = `${npc.displayName}_镇${i++}`;
  }

  const basePrompt = npc.persona || [
    `你是邻舍小镇的居民「${npc.displayName}」。`,
    npc.job ? `职业：${npc.job}。` : '',
    '你日常在小镇里按作息生活（工作/闲逛/回家），与邻里熟络。与用户聊天时保持角色口吻，聊小镇的日常、眼下的生活。',
  ].filter(Boolean).join('\n');

  const r = db.prepare(`
    INSERT INTO characters (name, display_name, base_prompt, short_prompt)
    VALUES (?, ?, ?, ?)
  `).run(name, npc.displayName, basePrompt, npc.persona || npc.displayName);
  const characterId = Number(r.lastInsertRowid);

  db.prepare('UPDATE town_npcs SET character_id = ? WHERE id = ?').run(characterId, npcId);
  console.log(`[townNpcs] npc #${npcId} (${npc.displayName}) invited as character #${characterId}`);
  return { ok: true, characterId, name, already: false };
}

// ── 作息生成（LLM 一次性） ──

/**
 * 生成 NPC 作息表。locationKeys：可用地点 key 列表（含 'home'）。
 * @returns {Promise<Array>} routine 数组
 */
export async function generateRoutine(npc, locationKeys) {
  const keys = locationKeys.filter(Boolean);
  const world = getWorldSetting();
  const routineMsgs = [
    {
      role: 'system',
      content: [getSystemRules({ roleplay: false }), world || ''].filter(Boolean).join('\n\n'),
    },
  ];
  if (world) {
    routineMsgs.push({ role: 'system', content: getWorldIntegrationRule('town_asset') });
  }
  routineMsgs.push({
    role: 'system',
    content: [
      '【输出结构】',
      '必须严格按以下 JSON 格式输出，禁止输出 JSON 以外的任何文字（解释、注释、markdown 代码块都不允许）：',
      '{',
      '  "routine": [',
      '    { "start": "06:30", "end": "08:00", "activity": "在后厨揉面准备开店", "locationKey": "home" },',
      '    { "start": "08:00", "end": "12:00", "activity": "在店里烤面包招呼客人", "locationKey": "bakery" },',
      '    { "start": "12:00", "end": "13:00", "activity": "吃午饭打个盹", "locationKey": "home" }',
      '  ]',
      '}',
    ].join('\n'),
  });
  routineMsgs.push({
    role: 'system',
    content: [
      '【任务要求】',
      `你是小镇的生活导演，为居民「${npc.displayName}」安排一天的作息。`,
      npc.persona ? `人设：${npc.persona}` : '',
      npc.job ? `职业：${npc.job}` : '',
      '',
      '字段约束：',
      '- start/end：24 小时制 "HH:MM"；从早上到深夜按时间升序、时间段首尾相接，覆盖全天 24 小时（最后一段 end 为 "24:00" 或次日 "06:30" 前的衔接段均可，但不能留空洞）',
      `- locationKey：只能从这些取值里选：${keys.join('、')}`,
      '- activity：中文、8~20 字、写具体在做什么，符合人设与职业；深夜段可以是睡觉',
      '- 生成 4~7 个时间段，不要碎成一大堆',
    ].filter(Boolean).join('\n'),
  });
  routineMsgs.push({
    role: 'user',
    content: `请执行：为「${npc.displayName}」生成作息 JSON。`,
  });
  const content = await chatSync(routineMsgs, {
    max_tokens: 900,
    temperature: 0.8,
    response_format: { type: 'json_object' },
    label: '小镇NPC作息',
  });

  let parsed = null;
  try { parsed = JSON.parse(String(content).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')); } catch { /* 走降级 */ }
  const routine = Array.isArray(parsed?.routine) ? parsed.routine : null;
  if (!routine || routine.length === 0) throw new Error('作息 JSON 解析失败');

  const valid = routine
    .map(r => ({
      start: String(r.start || '').trim(),
      end: String(r.end || '').trim(),
      activity: String(r.activity || '').trim().slice(0, 40),
      locationKey: keys.includes(r.locationKey) ? r.locationKey : keys[0],
    }))
    .filter(r => /^\d{1,2}:\d{2}$/.test(r.start) && /^\d{1,2}:\d{2}$/.test(r.end));
  if (valid.length === 0) throw new Error('作息条目全部无效');
  return valid;
}

// ── 重掷人设 + 作息（管理面板） ──

/** 重掷一个 NPC 的身份与完整人格卡，并重生成作息；返回更新后的 DTO */
export async function rerollNpc(npcId) {
  const row = getDb().prepare('SELECT * FROM town_npcs WHERE id = ?').get(npcId);
  if (!row) throw new Error('NPC 不存在');
  const db = getDb();
  const locations = db.prepare('SELECT key, name FROM town_locations ORDER BY id').all();

  const world = getWorldSetting();
  const rerollMsgs = [
    {
      role: 'system',
      content: [getSystemRules({ roleplay: false }), world || ''].filter(Boolean).join('\n\n'),
    },
  ];
  if (world) {
    rerollMsgs.push({ role: 'system', content: getWorldIntegrationRule('town_asset') });
  }
  rerollMsgs.push({
    role: 'system',
    content: [
      '【输出结构】',
      '必须严格按以下 JSON 格式输出，禁止输出 JSON 以外的任何文字（解释、注释、markdown 代码块都不允许）：',
      '{',
      '  "displayName": "咕噜",',
      '  "job": "面包师"',
      '}',
    ].join('\n'),
  });
  rerollMsgs.push({
    role: 'system',
    content: [
      '【任务要求】',
      '你是小镇的人事导演，为一位居民重新设计身份。',
      '',
      '字段约束：',
      '- displayName 中文 2~6 字',
      '- job 中文职业，要与小镇地点呼应（如咖啡厅/面包房/图书馆）',
      `小镇现有地点：${locations.map(l => l.name).join('、') || '（待定）'}`,
    ].join('\n'),
  });
  rerollMsgs.push({
    role: 'user',
    content: `请执行：为小镇重新设计一位居民（原名字：${row.display_name}，可以保留或换新）。`,
  });
  const content = await chatSync(rerollMsgs, {
    max_tokens: 300,
    temperature: 0.95,
    response_format: { type: 'json_object' },
    label: '小镇NPC身份重掷',
  });

  let parsed = null;
  try { parsed = JSON.parse(stripFence(content)); } catch { /* 走降级 */ }
  if (!parsed?.displayName) throw new Error('重掷 JSON 解析失败');

  const { card } = await generateNpcPersonaCard({
    displayName: String(parsed.displayName),
    job: String(parsed.job || ''),
    worldHint: getWorldStyleTags(),
  });

  updateNpc(npcId, {
    displayName: String(parsed.displayName).slice(0, 20),
    persona: card,
    job: String(parsed.job || '').slice(0, 20),
  });

  // 重掷作息（地点 key 列表 + home）
  const fresh = getNpc(npcId);
  try {
    const routine = await generateRoutine(fresh, [...locations.map(l => l.key), 'home']);
    db.prepare('UPDATE town_npcs SET routine_json = ? WHERE id = ?').run(JSON.stringify(routine), npcId);
  } catch (err) {
    console.warn(`[townNpcs] reroll routine failed:`, err?.message);
  }

  // 人格卡与外观变了 → 素材标记过期（重生成由管理面板/向导触发）
  db.prepare('UPDATE town_npcs SET sprite_ready = 0 WHERE id = ?').run(npcId);
  return getNpc(npcId);
}
function stripFence(content) {
  return String(content || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

// ── 就地聊天 ──

export function getNpcChatHistory(npcId, limit = 20) {
  const rows = getDb().prepare(`
    SELECT role, content, created_at AS createdAt FROM town_npc_chat_messages
    WHERE npc_id = ? ORDER BY id DESC LIMIT ?
  `).all(npcId, limit);
  return rows.reverse();
}

/** 求当前作息描述（供现场语境） */
export function currentRoutineLine(npc, now = new Date()) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const toMin = (t) => {
    const [h, m] = String(t).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  for (const slot of npc.routine || []) {
    const s = toMin(slot.start);
    const e = toMin(slot.end) || 24 * 60; // "24:00"
    if (minutes >= s && minutes < e) return `正在【${slot.activity}】`;
  }
  return '正在闲逛';
}

/**
 * 玩家点击 NPC 就地聊天：单轮 LLM，历史注入，落库并广播气泡
 * @returns {Promise<{reply: string}>}
 */
export async function chatWithNpc(npcId, message) {
  const npc = getNpc(npcId);
  if (!npc) throw new Error('NPC 不存在');
  const db = getDb();

  const history = getNpcChatHistory(npcId, 12);
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const scene = currentRoutineLine(npc, now);

  const reply = await chatSync([
    {
      role: 'system',
      content: [
        `你是小镇居民「${npc.displayName}」，正在镇上和来访的玩家（${config.user.nickname}）面对面聊天。`,
        npc.persona ? `你的人设：${npc.persona}` : '',
        npc.job ? `你的职业：${npc.job}` : '',
        `现在是 ${timeStr}，你${scene}。`,
        '要求：用中文回复，1~2 句话（不超过 60 字），口语化、符合人设，可以聊眼前的生活；小动作用（括号）内嵌。不要输出旁白、不要自称 AI、不要列选项。',
        '以下是你们之前在镇上的对话（可能为空）：',
        history.length
          ? history.map(h => `${h.role === 'user' ? '玩家' : npc.displayName}：${h.content}`).join('\n')
          : '（第一次交谈）',
      ].filter(Boolean).join('\n'),
    },
    { role: 'user', content: String(message).slice(0, 500) },
  ], {
    max_tokens: 300,
    temperature: 0.9,
    label: '小镇就地聊天',
  });

  const text = String(reply || '').trim().slice(0, 200);
  if (!text) throw new Error('NPC 没有回应');

  const ins = db.prepare('INSERT INTO town_npc_chat_messages (npc_id, role, content) VALUES (?, ?, ?)');
  ins.run(npcId, 'user', String(message).slice(0, 500));
  ins.run(npcId, 'npc', text);

  // 顺带冒个泡，让旁观端也能看到
  broadcastTownBubble({ charId: `npc:${npcId}`, text, ttl: 10 });
  return { reply: text };
}
