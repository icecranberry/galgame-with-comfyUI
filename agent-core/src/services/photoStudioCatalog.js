import { isPairPose } from './photoStudioWorkflow.js';

// 无查询参数时保留照相馆页面的完整目录；神说使用有界分页，避免目录截断。
export function queryStudioCatalog(entries, query, { poses = false } = {}) {
  const allowed = ['id', 'query', 'category', 'limit', 'offset', 'compact', ...(poses ? ['system', 'angle', 'person_count'] : [])];
  for (const key of Object.keys(query)) {
    if (!allowed.includes(key)) throw Object.assign(new Error('不支持的目录筛选参数'), { status: 400 });
  }
  const invalid = () => Object.assign(new Error('目录筛选参数无效'), { status: 400 });
  for (const [key, value] of Object.entries(query)) {
    if (typeof value !== 'string' || value.length > 200) throw invalid();
    if (['limit', 'offset', 'person_count'].includes(key) && !/^\d+$/.test(value)) throw invalid();
  }
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw invalid();
  if (query.person_count !== undefined && !['1', '2'].includes(query.person_count)) throw invalid();
  if (query.compact !== undefined && query.compact !== '1') throw invalid();
  const keywords = (query.query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = entries.filter(entry => {
    if (['id', 'category', 'system', 'angle'].some(key => query[key] && entry[key] !== query[key])) return false;
    if (poses && query.person_count && (isPairPose(entry) ? 2 : 1) !== Number(query.person_count)) return false;
    const text = [entry.id, entry.name, entry.label, entry.description, entry.system, entry.category, entry.angle].filter(Boolean).join(' ').toLowerCase();
    return keywords.every(keyword => text.includes(keyword));
  });
  const page = matches.slice(offset, offset + limit);
  const selected = query.compact === '1' ? page.map(entry => poses
    ? { id: entry.id, name: entry.name, system: entry.system, category: entry.category, angle: entry.angle,
      ...(entry.characterRoles ? { characterRoles: entry.characterRoles } : {}) }
    : { id: entry.id, label: entry.label, category: entry.category, description: entry.description }) : page;
  return { entries: selected, total: matches.length, limit, offset, has_more: offset + limit < matches.length };
}
