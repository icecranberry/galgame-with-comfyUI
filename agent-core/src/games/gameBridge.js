import { GOD_MODULE_TOOLS, executeModuleTool } from '../services/godSays/moduleTools.js';
import { validateToolArgs } from '../services/godSays/tools.js';
import { createGodLocalApi, publicToolData } from '../services/godSays/localApi.js';
import { config } from '../config.js';
import { buildCharacterPersona } from '../services/characterPersona.js';
import { bad } from './gamePaths.js';

// Explicit names, never a method/prefix-based capability grant. Settings, vector
// administration, arbitrary URLs and all write tools are deliberately absent.
const allowed = ['read_relationships', 'read_character_standings', 'list_character_memories', 'search_character_memory', 'search_gallery', 'read_character_emotion'];
const aliases = { get_relationships: 'read_relationships', get_memories: 'list_character_memories', get_standings: 'read_character_standings', get_album: 'search_gallery' };
export function createGameBridge(db, api = createGodLocalApi({ port: () => config.port })) {
  const entries = GOD_MODULE_TOOLS.filter(t => allowed.includes(t.name) && t.method === 'GET');
  const extra = (name, description, properties = {}, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
  const characterId = { characterId: { type: 'integer', minimum: 1 } };
  const definitions = [
    extra('get_characters', '读取邻舍角色目录、头像和立绘。'),
    extra('get_character_profile', '读取指定角色原始人设和外观。', characterId, ['characterId']),
    extra('get_town_state', '读取当前小镇状态。'),
    ...entries.map(t => t.definition),
  ];
  const tavernReads = ['get_characters', 'get_character_profile', 'read_relationships', 'read_character_standings', 'list_character_memories'];
  const tavernDefinitions = [...definitions.filter(entry => tavernReads.includes(entry.function.name)),
    extra('get_recent_character_moments', '读取指定角色最近三条已完成的朋友圈正文。', characterId, ['characterId']),
    extra('get_character_image_persona', '读取用于游戏纪念照的完整角色人设与外观。', characterId, ['characterId']),
  ];
  const profileTools = ['get_character_profile', 'get_recent_character_moments', 'get_character_image_persona'];
  async function call(name, args = {}, { tavern = false } = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw bad('工具参数必须是对象');
    const canonical = aliases[name] || name;
    const converted = { ...args };
    if (!profileTools.includes(canonical) && converted.characterId !== undefined) { converted.character_id = converted.characterId; delete converted.characterId; }
    const definition = (tavern ? tavernDefinitions : definitions).find(d => d.function.name === canonical);
    if (!definition) throw bad('此工具不在游戏只读白名单中', 403);
    validateToolArgs(definition.function.parameters, converted);
    if (canonical === 'get_characters') return publicToolData(db.prepare(`SELECT id,name,display_name,avatar_path,standing_url,
      substr(short_prompt,1,120) AS personaSummary FROM characters ORDER BY id`).all());
    if (canonical === 'get_recent_character_moments') return publicToolData(db.prepare(`SELECT substr(content,1,300) AS content,created_at
      FROM moment_posts WHERE character_id=? AND npc_id IS NULL AND status='done' ORDER BY created_at DESC,id DESC LIMIT 3`).all(args.characterId));
    if (canonical === 'get_character_profile' || canonical === 'get_character_image_persona') {
      const c = db.prepare('SELECT id,name,display_name,base_prompt,short_prompt,avatar_path,standing_url FROM characters WHERE id=?').get(args.characterId);
      if (!c) throw bad('角色不存在', 404);
      return publicToolData(canonical === 'get_character_profile' ? c : buildCharacterPersona(c, { variant: 'full', outfits: null }));
    }
    if (canonical === 'get_town_state') return (await api({ method: 'GET', path: '/api/town/state' })).data;
    const entry = entries.find(t => t.name === canonical);
    return publicToolData((await executeModuleTool(entry, converted, {}, api)).data);
  }
  return { definitions, tavernDefinitions, call };
}
