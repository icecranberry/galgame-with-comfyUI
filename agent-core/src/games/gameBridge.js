import { GOD_MODULE_TOOLS, executeModuleTool } from '../services/godSays/moduleTools.js';
import { validateToolArgs } from '../services/godSays/tools.js';
import { createGodLocalApi, publicToolData } from '../services/godSays/localApi.js';
import { config } from '../config.js';
import { bad } from './gamePaths.js';

// Explicit names, never a method/prefix-based capability grant. Settings, vector
// administration, arbitrary URLs and all write tools are deliberately absent.
const allowed = ['read_relationships', 'read_character_standings', 'list_character_memories', 'search_character_memory', 'search_gallery', 'read_character_emotion'];
const aliases = { get_relationships: 'read_relationships', get_memories: 'list_character_memories', get_standings: 'read_character_standings', get_album: 'search_gallery' };
export function createGameBridge(db, api = createGodLocalApi({ port: () => config.port })) {
  const entries = GOD_MODULE_TOOLS.filter(t => allowed.includes(t.name) && t.method === 'GET');
  const extra = (name, description, properties = {}, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
  const definitions = [
    extra('get_characters', '读取邻舍角色目录、头像和立绘。'),
    extra('get_character_profile', '读取指定角色原始人设和外观。', { characterId: { type: 'integer', minimum: 1 } }, ['characterId']),
    extra('get_town_state', '读取当前小镇状态。'),
    ...entries.map(t => t.definition),
  ];
  async function call(name, args = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw bad('工具参数必须是对象');
    const canonical = aliases[name] || name;
    const converted = { ...args };
    if (canonical !== 'get_character_profile' && converted.characterId !== undefined) { converted.character_id = converted.characterId; delete converted.characterId; }
    const definition = definitions.find(d => d.function.name === canonical);
    if (!definition) throw bad('此工具不在游戏只读白名单中', 403);
    validateToolArgs(definition.function.parameters, converted);
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
  return { definitions, call };
}
