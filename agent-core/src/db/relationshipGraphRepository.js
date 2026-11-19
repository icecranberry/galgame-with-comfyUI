/** 关系图只读取展示资料，不把完整人设发到浏览器，也不把好感度当成关系边。 */
export function readRelationshipGraph(db) {
  const nodes = db.prepare(`
    SELECT c.id, c.display_name, c.avatar_path, m.room_id AS group_id
    FROM characters c
    LEFT JOIN cohabitation_members m ON m.character_id = c.id
    ORDER BY c.id
  `).all();
  const ids = new Set(nodes.map(node => node.id));
  const edges = db.prepare(`SELECT id, from_character_id, to_character_id, relationship_text
    FROM character_relationships WHERE TRIM(relationship_text) != '' ORDER BY id`).all()
    .filter(edge => ids.has(edge.from_character_id) && ids.has(edge.to_character_id)
      && edge.from_character_id !== edge.to_character_id);
  const userEdges = db.prepare(`SELECT id, character_id, relationship_text
    FROM user_relationships WHERE TRIM(relationship_text) != '' ORDER BY id`).all()
    .filter(edge => ids.has(edge.character_id));
  const occupied = new Set(nodes.map(node => node.group_id));
  const groups = db.prepare('SELECT id, name FROM cohabitation_rooms ORDER BY id').all()
    .filter(group => occupied.has(group.id));
  return { nodes, edges, userEdges, groups };
}
