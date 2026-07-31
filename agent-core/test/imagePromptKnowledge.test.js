import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { seedImagePromptKnowledge } from '../src/db/index.js';
import { IMAGE_PROMPT_KNOWLEDGE, IMAGE_PROMPT_KNOWLEDGE_VERSION } from '../src/db/imagePromptKnowledgeData.js';
import {
  IMAGE_PROMPT_TAG_KNOWLEDGE,
  IMAGE_PROMPT_TAG_KNOWLEDGE_STATS,
  IMAGE_PROMPT_TAG_SOURCE_SHA256,
} from '../src/db/imagePromptTagKnowledgeData.js';
import { keywordSearchImagePromptKnowledge } from '../src/services/imagePromptKnowledge.js';
import { composeImagePrompt, prepareImagePrompt } from '../src/services/imagePromptPreparer.js';
import { recordCompletedImageTask } from '../src/services/imageTaskRecorder.js';

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE system_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE image_prompt_preparations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scene TEXT NOT NULL DEFAULT 'chat',
      prompt_original TEXT NOT NULL,
      prompt_refined TEXT NOT NULL,
      knowledge_ids TEXT NOT NULL DEFAULT '[]',
      knowledge_version TEXT,
      retrieval_mode TEXT NOT NULL DEFAULT 'fallback',
      retrieval_snapshot TEXT NOT NULL DEFAULT '{}',
      optimization_status TEXT NOT NULL DEFAULT 'fallback',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE image_prompt_knowledge (
      knowledge_id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      search_terms TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      executable_tags TEXT NOT NULL DEFAULT '[]',
      scenes TEXT NOT NULL DEFAULT '[]',
      is_default INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 0,
      version TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

test('image prompt knowledge seed is idempotent, deactivates stale built-ins, and preserves custom rows', () => {
  const db = createDb();
  db.prepare(`INSERT INTO image_prompt_knowledge
    (knowledge_id, category, title, search_terms, content, scenes, version)
    VALUES ('ipk.lib.legacy.old.001', 'camera_vocabulary', 'legacy', 'legacy', 'legacy', '[]', 'old')`).run();
  seedImagePromptKnowledge(db);
  db.prepare(`INSERT INTO image_prompt_knowledge
    (knowledge_id, category, title, search_terms, content, scenes, version)
    VALUES ('ipk.custom', 'camera', 'custom', 'custom', 'custom rule', '["chat"]', 'user')`).run();
  seedImagePromptKnowledge(db);

  assert.equal(db.prepare('SELECT count(*) FROM image_prompt_knowledge WHERE is_active = 1').pluck().get(), IMAGE_PROMPT_KNOWLEDGE.length + 1);
  assert.equal(db.prepare(`SELECT is_active FROM image_prompt_knowledge WHERE knowledge_id = 'ipk.lib.legacy.old.001'`).pluck().get(), 0);
  assert.equal(db.prepare(`SELECT count(*) FROM image_prompt_knowledge WHERE knowledge_id = 'ipk.custom' AND is_active = 1`).pluck().get(), 1);
  assert.equal(db.prepare(`SELECT setting_value FROM system_settings WHERE setting_key = 'image_prompt_knowledge_version'`).pluck().get(), IMAGE_PROMPT_KNOWLEDGE_VERSION);
  const executableTags = JSON.parse(db.prepare(`SELECT executable_tags FROM image_prompt_knowledge WHERE knowledge_id LIKE 'ipk.lib.%' AND is_active = 1 LIMIT 1`).pluck().get());
  assert.ok(executableTags.length > 0);
  assert.ok(executableTags[0].tag);
  db.close();
});

test('custom tag library is reproducible, chunked, deduplicated, and safety-filtered', () => {
  assert.equal(IMAGE_PROMPT_TAG_SOURCE_SHA256, '8cfbd98da782da29bd0cfecf5c260142ee2ce4d46db311c13d4e1cb7b5cc3f8f');
  assert.equal(IMAGE_PROMPT_TAG_KNOWLEDGE_STATS.sourceTags, 4961);
  assert.equal(IMAGE_PROMPT_TAG_KNOWLEDGE_STATS.retainedTags, 4470);
  assert.equal(IMAGE_PROMPT_TAG_KNOWLEDGE_STATS.knowledgeItems, 284);
  assert.equal(IMAGE_PROMPT_KNOWLEDGE.length - IMAGE_PROMPT_TAG_KNOWLEDGE.length, 24);
  assert.equal(IMAGE_PROMPT_TAG_KNOWLEDGE_STATS.skipped.minor, 9);
  assert.equal(IMAGE_PROMPT_TAG_KNOWLEDGE_STATS.skipped.model_directive, 11);
  assert.equal(new Set(IMAGE_PROMPT_TAG_KNOWLEDGE.map(item => item.knowledgeId)).size, IMAGE_PROMPT_TAG_KNOWLEDGE.length);

  const serialized = JSON.stringify(IMAGE_PROMPT_TAG_KNOWLEDGE);
  assert.doesNotMatch(serialized, /<\s*lora:/i);
  assert.doesNotMatch(serialized, /(?:\b(?:child|underage|toddler|kindergartener|loli|shota)\b|未成年|幼童|儿童|小孩|萝莉|正太)/i);
  for (const item of IMAGE_PROMPT_TAG_KNOWLEDGE) {
    assert.match(item.knowledgeId, /^ipk\.lib\.[a-z0-9-]+\.[a-z0-9-]+\.\d{3}$/);
    assert.ok((item.content.match(/→/g) || []).length <= 20);
    assert.ok(item.content.length <= 1600);
  }
  for (const item of IMAGE_PROMPT_TAG_KNOWLEDGE) {
    assert.ok(item.executableTags.length > 0);
    assert.ok(item.executableTags.every(entry => entry.tag && entry.label !== undefined));
  }
  assert.match(serialized, /锁骨 → collarbone/);
  assert.match(serialized, /叹气 → sigh/);
  assert.match(serialized, /瓷砖地板 → tile_floor/);
  assert.match(serialized, /卧室 → bedroom/);
  assert.doesNotMatch(serialized, /木质地板 → tile_floor/);
  for (const term of ['flaccid', 'ass_grab', 'moaning']) {
    const item = IMAGE_PROMPT_TAG_KNOWLEDGE.find(entry => entry.content.includes(term));
    assert.ok(item?.category.startsWith('adult_'), `${term} must stay behind the adult query gate`);
  }
  assert.ok(IMAGE_PROMPT_TAG_KNOWLEDGE
    .filter(item => item.title.startsWith('表情动作 ·'))
    .some(item => item.category === 'adult_pose_vocabulary'));
});

test('adult tag vocabulary requires an explicit adult query', () => {
  const db = createDb();
  seedImagePromptKnowledge(db);
  const normal = keywordSearchImagePromptKnowledge('胸部构图，微笑，花园', { scene: 'chat', limit: 100, db });
  assert.ok(normal.every(item => !item.category.startsWith('adult_')));
  const explicit = keywordSearchImagePromptKnowledge('fellatio 口交', { scene: 'chat', limit: 100, db });
  assert.ok(explicit.some(item => item.category === 'adult_pose_vocabulary'));
  const explicitClothing = keywordSearchImagePromptKnowledge('nipple slip 乳头滑出', { scene: 'chat', limit: 100, db });
  assert.ok(explicitClothing.some(item => item.category === 'adult_clothing_vocabulary'));
  db.close();
});

test('keyword retrieval hits incremental scene vocabulary without displacing framework rules', () => {
  const db = createDb();
  seedImagePromptKnowledge(db);
  const items = keywordSearchImagePromptKnowledge('cyberpunk neon lights rainy night 赛博霓虹雨夜', {
    scene: 'moments', limit: 30, db,
  });
  assert.ok(items.some(item => item.id.startsWith('ipk.lib.scene.outdoor.')));
  assert.ok(items.some(item => item.id === 'ipk.environment.night'));
  db.close();
});

test('keyword retrieval selects scene-relevant conflict knowledge', () => {
  const db = createDb();
  seedImagePromptKnowledge(db);
  const items = keywordSearchImagePromptKnowledge('single girl sleeping in bed looking at viewer close-up full body', {
    scene: 'chat', limit: 20, db,
  });
  const ids = new Set(items.map(item => item.id));
  assert.ok(ids.has('ipk.gaze.sleep'));
  assert.ok(ids.has('ipk.camera.closeup'));
  assert.ok(ids.has('ipk.conflict.core'));
  db.close();
});

test('deterministic prompt composition injects tags without appending rule prose', () => {
  const result = composeImagePrompt(
    'Furina sleeping in a cyberpunk city at night, looking at the viewer, close-up, full body, neon lights, rainy night',
    [
      { id: 'ipk.gaze.sleep', category: 'gaze', priority: 100, executableTags: [], content: '中文规则不应直接进入提示词' },
      { id: 'ipk.camera.fullbody', category: 'camera', priority: 96, executableTags: [], content: '中文规则不应直接进入提示词' },
      {
        id: 'ipk.lib.scene.test.001',
        category: 'scene_vocabulary',
        priority: 55,
        score: 1,
        executableTags: [{ tag: 'cyberpunk_city_lights, neon_lights, rainy_night', label: '赛博霓虹雨夜', group: '城市' }],
        content: '标签词汇菜单（中文说明）',
      },
    ],
  );

  assert.match(result.promptRefined, /closed_eyes/);
  assert.match(result.promptRefined, /cyberpunk_city_lights, neon_lights, rainy_night/);
  assert.doesNotMatch(result.promptRefined, /中文规则|标签词汇菜单/);
  assert.doesNotMatch(result.promptRefined, /looking at the viewer/);
  assert.doesNotMatch(result.promptRefined, /close-up/);
  assert.equal(result.selectedTags.filter(item => item.tag === 'closed_eyes').length, 1);
  assert.ok(result.appliedRules.includes('ipk.gaze.sleep'));
});

test('prepareImagePrompt persists deterministic selection audit', async () => {
  const db = createDb();
  seedImagePromptKnowledge(db);
  const result = await prepareImagePrompt('cyberpunk neon lights rainy night', { db });
  assert.equal(result.status, 'deterministic');
  assert.ok(result.selection.selectedTags.length > 0);
  const row = db.prepare('SELECT prompt_original, prompt_refined, retrieval_snapshot, optimization_status FROM image_prompt_preparations ORDER BY id DESC LIMIT 1').get();
  const snapshot = JSON.parse(row.retrieval_snapshot);
  assert.equal(row.prompt_original, 'cyberpunk neon lights rainy night');
  assert.equal(row.prompt_refined, result.promptRefined);
  assert.equal(row.optimization_status, 'deterministic');
  assert.deepEqual(snapshot.selectedTags, result.selection.selectedTags);
  assert.ok(Array.isArray(snapshot.appliedRules));
  db.close();
});

test('completed image task keeps original and refined prompts separate', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE image_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT,
      prompt_original TEXT NOT NULL,
      prompt_refined TEXT,
      style TEXT,
      resolution TEXT DEFAULT '1024x1024',
      workflow_template TEXT,
      status TEXT DEFAULT 'pending',
      output_paths TEXT DEFAULT '[]',
      finished_at DATETIME
    );
  `);
  const id = recordCompletedImageTask({
    conversationId: 'char_1_mailbox_portrait',
    promptOriginal: 'sleeping, looking at viewer',
    promptRefined: '1girl, solo, sleeping, closed eyes',
    outputPaths: ['/images/mailbox/test.png'],
    resolution: '900x1200',
    workflowTemplate: 'turbo',
    db,
  });
  const row = db.prepare('SELECT * FROM image_tasks WHERE id = ?').get(id);
  assert.equal(row.prompt_original, 'sleeping, looking at viewer');
  assert.equal(row.prompt_refined, '1girl, solo, sleeping, closed eyes');
  assert.equal(row.resolution, '900x1200');
  assert.deepEqual(JSON.parse(row.output_paths), ['/images/mailbox/test.png']);
  assert.equal(row.status, 'done');
  db.close();
});

test('already prepared prompt skips retrieval and optimization', async () => {
  const result = await prepareImagePrompt('1girl, solo, portrait', {
    alreadyPrepared: true,
    persist: false,
  });
  assert.equal(result.promptRefined, '1girl, solo, portrait');
  assert.equal(result.status, 'skipped');
  assert.deepEqual(result.retrieval.knowledgeIds, []);
});
