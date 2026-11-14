import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readRelationshipGraph } from '../src/db/relationshipGraphRepository.js';

test('关系图聚合保持有向文本，过滤默认角色、孤悬边、空关系和空居室', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE characters(id INTEGER PRIMARY KEY,name TEXT,display_name TEXT,avatar_path TEXT,base_prompt TEXT);
      CREATE TABLE cohabitation_rooms(id INTEGER PRIMARY KEY,name TEXT);
      CREATE TABLE cohabitation_members(character_id INTEGER,room_id INTEGER);
      CREATE TABLE character_relationships(id INTEGER PRIMARY KEY,from_character_id INTEGER,to_character_id INTEGER,relationship_text TEXT);
      CREATE TABLE user_relationships(id INTEGER PRIMARY KEY,character_id INTEGER,relationship_text TEXT);
      INSERT INTO characters VALUES(1,'a','同名',NULL,'不应返回的人设'),(2,'b','同名',NULL,''),(3,'c','孤立角色',NULL,''),(4,'default','默认',NULL,'');
      INSERT INTO cohabitation_rooms VALUES(1,'居室'),(2,'空居室');
      INSERT INTO cohabitation_members VALUES(1,1);
      INSERT INTO character_relationships VALUES(1,1,2,'老板'),(2,2,1,'下属'),(3,1,4,'默认'),(4,1,99,'缺失'),(5,1,3,'  '),(6,1,1,'自己');
      INSERT INTO user_relationships VALUES(1,1,'邻居'),(2,4,'默认'),(3,99,'缺失'),(4,2,'');`);
    const graph = readRelationshipGraph(db);
    assert.deepEqual(graph.nodes.map(node => node.id), [1, 2, 3]);
    assert.equal(graph.nodes[0].group_id, 1);
    assert.equal(graph.nodes[1].group_id, null);
    assert.ok(!('base_prompt' in graph.nodes[0]));
    assert.deepEqual(graph.edges.map(edge => edge.relationship_text), ['老板', '下属']);
    assert.deepEqual(graph.userEdges.map(edge => edge.relationship_text), ['邻居']);
    assert.deepEqual(graph.groups, [{ id: 1, name: '居室' }]);
    db.prepare('DELETE FROM character_relationships WHERE id = 2').run();
    assert.deepEqual(readRelationshipGraph(db).edges.map(edge => edge.relationship_text), ['老板']);
  } finally { db.close(); }
});
