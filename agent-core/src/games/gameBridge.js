import { GOD_MODULE_TOOLS, executeModuleTool } from '../services/godSays/moduleTools.js';
import { validateToolArgs } from '../services/godSays/tools.js';
import { createGodLocalApi, publicToolData } from '../services/godSays/localApi.js';
import { config } from '../config.js';
import { buildCharacterAppearanceSection, buildCharacterPersona } from '../services/characterPersona.js';
import { availableStandingImages, standingSlots } from '../services/expressionStandingAssets.js';
import { bad } from './gamePaths.js';

const gameCharacterName = "COALESCE(NULLIF(TRIM(display_name), ''), TRIM(name))";

export function findCharacterByDisplayName(db, name) {
  const matches = db.prepare(`SELECT id, name, ${gameCharacterName} AS display_name,
    base_prompt, short_prompt, avatar_path, standing_url, loras, artist_override, custom_workflow
    FROM characters WHERE ${gameCharacterName} = ? LIMIT 2`).all(name);
  return matches.length === 1 ? matches[0] : null;
}

export function listNamedGameCharacters(db) {
  return db.prepare(`SELECT id, ${gameCharacterName} AS name, avatar_path, standing_url, substr(short_prompt,1,120) AS personaSummary
    FROM characters WHERE ${gameCharacterName} <> '' GROUP BY 2 HAVING COUNT(*) = 1 ORDER BY id`).all();
}

function recentCharacterMoments(db, characterId, limit = 3) {
  return db.prepare(`SELECT substr(content,1,300) AS content, created_at FROM moment_posts
    WHERE character_id = ? AND npc_id IS NULL AND status = 'done' AND trim(content) <> ''
    ORDER BY created_at DESC, id DESC LIMIT ?`).all(characterId, limit);
}

function recentTavernMaterial(db, characterId) {
  const clip = (value, length) => typeof value === 'string' ? [...value.trim()].slice(0, length).join('') : '';
  const schedules = db.prepare(`SELECT schedule_date, schedule_json FROM daily_schedules
    WHERE character_id = ? ORDER BY schedule_date DESC LIMIT 1`).all(characterId).flatMap(row => {
    let schedule;
    try { schedule = JSON.parse(row.schedule_json); } catch { return []; }
    const entries = Array.isArray(schedule) ? schedule : schedule?.activities;
    if (!Array.isArray(entries)) return [];
    const activities = entries.flatMap(item => {
      const activity = clip(item?.activity, 64);
      return activity ? [{ time: clip(item.startTime, 8), activity, location: clip(item.location, 32), detail: clip(item.description, 100) }] : [];
    });
    return activities.length ? [{ date: row.schedule_date, activities }] : [];
  });
  const moments = recentCharacterMoments(db, characterId, 2).map(({ content, created_at: date }) => ({ content, date }));
  const privateSummaries = db.prepare(`SELECT substr(summary,1,600) AS summary FROM rolling_summaries
    WHERE conversation_id = ? AND end_msg_id > 0 AND checkpoint_version = 1 AND trim(summary) <> ''
    ORDER BY end_msg_id DESC, id DESC LIMIT 1`).all(`char_${characterId}`).map(row => row.summary);
  return Object.fromEntries(Object.entries({ schedules, moments, privateSummaries }).filter(([, value]) => value?.length));
}

// Explicit names, never a method/prefix-based capability grant. Settings, vector
// administration, arbitrary URLs and all write tools are deliberately absent.
const allowed = ['read_relationships', 'read_character_standings', 'list_character_memories', 'search_character_memory', 'search_gallery', 'read_character_emotion'];
const aliases = { get_relationships: 'read_relationships', get_memories: 'list_character_memories', get_standings: 'read_character_standings', get_album: 'search_gallery' };
export function createGameBridge(db, api = createGodLocalApi({ port: () => config.port })) {
  const entries = GOD_MODULE_TOOLS.filter(t => allowed.includes(t.name) && t.method === 'GET');
  const extra = (name, description, properties = {}, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
  const characterId = { characterId: { type: 'integer', minimum: 1 } };
  const characterName = { characterName: { type: 'string', minLength: 1 } };
  const definitions = [
    extra('get_characters', '读取邻舍角色目录、头像和立绘。'),
    extra('get_character_profile', '读取指定角色原始人设和外观。', characterId, ['characterId']),
    extra('get_town_state', '读取当前小镇状态。'),
    ...entries.map(t => t.definition),
  ];
  const tavernDefinitions = [
    extra('get_characters', '读取可按姓名唯一识别的酒馆客人和立绘。'),
    extra('get_expression_sprites', '读取已有文件的表情立绘与对应情绪名称。', characterName, ['characterName']),
    extra('get_tavern_dialogue_material', '读取指定酒馆角色最新一天日程、两条朋友圈和一条最新私聊总结。', characterName, ['characterName']),
    extra('get_tavern_guest_persona', '读取以角色名指代客人的酒馆人物资料。', characterName, ['characterName']),
    extra('get_character_image_persona', '读取游戏生图人设，或仅取角色的外观描述。',
      { ...characterName, appearanceOnly: { type: 'boolean' } }, ['characterName']),
  ];
  const trpgDefinitions = [
    extra('get_characters', '读取可按姓名唯一识别的跑团角色和立绘。'),
    extra('get_character_profile', '按显示名读取跑团角色人设和外观。', characterName, ['characterName']),
  ];
  async function call(name, args = {}, { tavern = false, trpg = false } = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw bad('工具参数必须是对象');
    const canonical = aliases[name] || name;
    const converted = { ...args };
    if (!tavern && !trpg && canonical !== 'get_character_profile' && converted.characterId !== undefined) { converted.character_id = converted.characterId; delete converted.characterId; }
    const definition = (tavern ? tavernDefinitions : trpg ? trpgDefinitions : definitions).find(d => d.function.name === canonical);
    if (!definition) throw bad('此工具不在游戏只读白名单中', 403);
    validateToolArgs(definition.function.parameters, converted);
    if ((tavern || trpg) && canonical === 'get_characters') {
      const roster = listNamedGameCharacters(db).map(({ name, avatar_path, standing_url, personaSummary }) => ({
        name, avatar_path, standing_url, ...(trpg ? { personaSummary } : {}),
      }));
      return publicToolData(roster);
    }
    if (trpg) {
      const character = findCharacterByDisplayName(db, args.characterName);
      if (!character) throw bad('无法按名字唯一识别跑团角色', 404);
      const { display_name: name, base_prompt, short_prompt, avatar_path, standing_url } = character;
      return publicToolData({ name, base_prompt, short_prompt, avatar_path, standing_url });
    }
    if (tavern) {
      const character = findCharacterByDisplayName(db, args.characterName);
      if (!character) throw bad('无法按名字唯一识别酒馆客人', 404);
      if (canonical === 'get_expression_sprites') {
        const slots = standingSlots(db);
        const rows = db.prepare('SELECT slot_id,image_url FROM expression_standings WHERE character_id=?').all(character.id);
        const images = availableStandingImages(rows, slots);
        return slots.filter(slot => images[slot.id]).map(slot => ({ id: slot.id, name: slot.name, url: images[slot.id] }));
      }
      if (canonical === 'get_tavern_dialogue_material') return publicToolData(recentTavernMaterial(db, character.id));
      const person = character.display_name;
      if (args.appearanceOnly) return publicToolData(buildCharacterAppearanceSection(character, { person, outfits: null, includeHeading: false }));
      const persona = buildCharacterPersona(character, { variant: 'full', person, outfits: null });
      return publicToolData(canonical === 'get_tavern_guest_persona' ? { name: character.name, persona } : persona);
    }
    if (canonical === 'get_characters') return publicToolData(db.prepare(`SELECT id,name,display_name,avatar_path,standing_url,
      substr(short_prompt,1,120) AS personaSummary FROM characters ORDER BY id`).all());
    if (canonical === 'get_character_profile') {
      const c = db.prepare('SELECT id,name,display_name,base_prompt,short_prompt,avatar_path,standing_url FROM characters WHERE id=?').get(args.characterId);
      if (!c) throw bad('角色不存在', 404);
      return publicToolData(c);
    }
    if (canonical === 'get_town_state') return (await api({ method: 'GET', path: '/api/town/state' })).data;
    const entry = entries.find(t => t.name === canonical);
    return publicToolData((await executeModuleTool(entry, converted, {}, api)).data);
  }
  return { definitions, tavernDefinitions, trpgDefinitions, call };
}
