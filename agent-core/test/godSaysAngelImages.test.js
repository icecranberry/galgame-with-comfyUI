import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { migrateGodSaysSchema } from '../src/db/godSaysSchema.js';
import { createGodRepository } from '../src/services/godSays/repository.js';
import { createAngelImageService, buildAngelImageRequest, buildAngelOutfitDesignRequest } from '../src/services/godSays/angelImages.js';
import { buildPromptProfile } from '../src/services/lorebook/promptProfile.js';

const png = `data:image/png;base64,${(await sharp({ create: { width: 4, height: 6, channels: 4, background: '#ddeeff' } }).png().toBuffer()).toString('base64')}`;
const persona = '你是天使。\n## 你的身份\n守护云庭的信使。\n## 你的外观\n浅金头发、白羽与光环，素白短袍。';
function fixture(t, overrides = {}) {
  const db = new Database(':memory:'); t.after(() => db.close());
  db.exec(`CREATE TABLE moment_posts(id INTEGER PRIMARY KEY);CREATE TABLE raw_messages(id INTEGER PRIMARY KEY);
    CREATE TABLE characters(id INTEGER PRIMARY KEY,base_prompt TEXT);INSERT INTO characters VALUES(1,'普通居民保持原样');
    CREATE TABLE image_tasks(id INTEGER PRIMARY KEY,conversation_id TEXT,prompt_original TEXT,prompt_refined TEXT,status TEXT,output_paths TEXT,resolution TEXT,workflow_template TEXT,finished_at TEXT)`);
  migrateGodSaysSchema(db); const repo = createGodRepository(db); repo.ensureAngel();
  repo.updateAngel({ display_name: '天使', persona });
  db.prepare('UPDATE god_angel SET schedule_json=?,standing_url=? WHERE id=1').run(JSON.stringify([{ startTime: '00:00', endTime: '06:00', activity: '深夜安眠', location: '云庭卧房', description: '羽翼轻轻垂落', replyDelay: -1 }]), '/images/standing/old.png');
  const rendered = [], described = [], stored = new Map();
  const deps = { describe: async (messages, opts) => { described.push({ messages, opts }); return 'an angel with white wings, soft golden hair, in cloud garden'; },
    render: async (prompt, opts) => { rendered.push({ prompt, opts }); return { success: true, images: [{ base64: png }], wfMode: 'turbo' }; },
    promptEnvironment: () => ({ systemRules: '规则', worldSetting: '<world_setting>云庭</world_setting>', worldRule: '世界观强化' }),
    settings: () => ({ eventWidth: 1600, eventHeight: 1200, eventArtist: 'photo', momentsArtist: 'portrait' }),
    save: (category, filename, data) => { const url = `/images/${category}/${filename}`; stored.set(url, data); return url; }, remove: url => stored.delete(url), ...overrides };
  const images = createAngelImageService(repo, deps);
  return { db, repo, images, described, rendered, stored, deps };
}
async function finish(images, id) {
  for (let tries = 0; tries < 40; tries++) { const job = images.get(id); if (job.status !== 'running') return job; await new Promise(setImmediate); }
  throw new Error('图片任务未结束');
}

test('legacy migration adds angel media independently and profile edits do not require or erase VAD', t => {
  const { db, repo } = fixture(t);
  db.exec('ALTER TABLE god_angel DROP COLUMN avatar_path; ALTER TABLE god_angel DROP COLUMN standing_url');
  migrateGodSaysSchema(db); migrateGodSaysSchema(db);
  assert.equal(repo.ensureAngel().avatar_path, null); assert.equal(repo.ensureAngel().standing_url, null);
  db.prepare('UPDATE god_angel SET emotion_baseline=? WHERE id=1').run('{"valence":0.2,"arousal":0.3,"dominance":0.4}');
  repo.updateAngel({ display_name: '星羽', persona });
  assert.deepEqual(JSON.parse(repo.ensureAngel().emotion_baseline), { valence: 0.2, arousal: 0.3, dominance: 0.4 });
  assert.equal(db.prepare('SELECT base_prompt FROM characters WHERE id=1').get().base_prompt, '普通居民保持原样');
});

test('avatar upload validates and normalizes image data, reads back its URL and leaves residents unchanged', async t => {
  const { images, repo, stored, db } = fixture(t);
  const saved = await images.upload('avatar', png);
  assert.match(saved.avatar_path, /^\/images\/avatargen\/god_avatar_/);
  const buffer = Buffer.from(stored.get(saved.avatar_path).split(',')[1], 'base64');
  const metadata = await sharp(buffer).metadata(); assert.equal(metadata.width, 512); assert.equal(metadata.height, 512);
  assert.equal(createGodRepository(db).ensureAngel().avatar_path, saved.avatar_path);
  await assert.rejects(images.upload('avatar', 'data:image/png;base64,YmFk'), { status: 400 });
  assert.equal(repo.ensureAngel().avatar_path, saved.avatar_path);
  const standing = await images.upload('standing', png); assert.match(standing.standing_url, /^\/images\/standing\/god_standing_/);
  await images.upload('standing', null); assert.equal(repo.ensureAngel().standing_url, null);
  assert.equal(db.prepare('SELECT base_prompt FROM characters WHERE id=1').get().base_prompt, '普通居民保持原样');
});

test('avatar is a crop candidate, standing applies only after success, and images survive job reload', async t => {
  const { images, repo, rendered, described } = fixture(t);
  const avatar = await finish(images, images.start({ kind: 'avatar' }).id);
  assert.equal(avatar.status, 'done'); assert.equal(repo.ensureAngel().avatar_path, null, 'generation does not bypass crop confirmation');
  assert.equal(rendered[0].opts.width, 1024); assert.equal(rendered[0].opts.height, 1024);
  const first = images.start({ kind: 'standing', requirement: '手里拿信袋' });
  assert.equal(images.start({ kind: 'standing' }).id, first.id, 'same-kind in-flight requests merge');
  await assert.rejects(images.upload('standing', png), { status: 409 });
  const standing = await finish(images, first.id);
  assert.equal(standing.status, 'done'); assert.equal(standing.result.applied, true);
  assert.equal(repo.ensureAngel().standing_url, standing.result.images[0].url);
  assert.equal(rendered[1].opts.width, 768); assert.equal(rendered[1].opts.height, 1536);
  assert.match(described[1].messages.at(-1).content, /手里拿信袋/);
  assert.ok(images.list().images.includes(avatar.result.images[0].url));
});

test('peek snapshots the actual selected schedule, sleeping state, event resolution and persona', async t => {
  const { images, described, rendered, repo } = fixture(t);
  assert.throws(() => images.start({ kind: 'peek', activity_index: 5 }), { status: 400 });
  const job = images.start({ kind: 'peek', activity_index: 0 });
  repo.db.prepare("UPDATE god_angel SET schedule_json='[]' WHERE id=1").run();
  const done = await finish(images, job.id);
  assert.equal(done.status, 'done');
  assert.match(described[0].messages.at(-1).content, /00:00–06:00[\s\S]*深夜安眠[\s\S]*云庭卧房[\s\S]*必须闭眼/);
  assert.equal(rendered[0].opts.width, 1600); assert.equal(rendered[0].opts.height, 1200); assert.equal(rendered[0].opts.scene, 'schedule');
  assert.equal(repo.ensureAngel().standing_url, '/images/standing/old.png', 'peek never replaces the displayed standing');
  assert.doesNotMatch(JSON.stringify(done), /base64/);
});

test('failed generation and changed persona preserve existing standing and surface real status', async t => {
  const failure = fixture(t, { render: async () => ({ success: false, error: '生图服务离线' }) });
  const failed = await finish(failure.images, failure.images.start({ kind: 'standing' }).id);
  assert.equal(failed.status, 'failed'); assert.equal(failed.error, '生图服务离线'); assert.equal(failure.repo.ensureAngel().standing_url, '/images/standing/old.png');
  let release; const gate = new Promise(resolve => { release = resolve; });
  const raced = fixture(t, { render: async () => { await gate; return { success: true, images: [{ base64: png }] }; } });
  const job = raced.images.start({ kind: 'standing' }); await new Promise(setImmediate);
  raced.repo.updateAngel({ display_name: '天使', persona: `${persona}\n外貌已改变` }); release();
  const done = await finish(raced.images, job.id); assert.equal(done.result.applied, false); assert.match(done.result.note, /没有覆盖/);
  assert.equal(raced.repo.ensureAngel().standing_url, '/images/standing/old.png');
});

test('image prompt has real world/persona/cache anchors and changing activity cannot change stable prefix', t => {
  const { repo, deps } = fixture(t); const angel = repo.ensureAngel();
  const a = buildAngelImageRequest(angel, 'peek', { day: '2026-10-31', activity: angel.schedule[0] }, deps.promptEnvironment());
  const b = buildAngelImageRequest(angel, 'peek', { day: '2026-11-01', activity: { ...angel.schedule[0], activity: '读信' } }, deps.promptEnvironment());
  assert.deepEqual(a.messages.slice(0, -1), b.messages.slice(0, -1));
  const profile = buildPromptProfile(a.messages, { ...a.lorebook, worldText: '<world_setting>云庭</world_setting>' });
  assert.equal(profile.anchors.afterCharacter.index, a.lorebook.cacheBoundary.index);
  assert.equal(profile.anchors.afterAuthorNote.index, 0);
  assert.deepEqual(a.lorebook.history, [a.messages.at(-1)]);
});

test('restart exposes interrupted image jobs without rerunning them or losing finished images', async t => {
  const { repo, images, deps } = fixture(t);
  const completed = await finish(images, images.start({ kind: 'avatar' }).id);
  repo.db.prepare("INSERT INTO god_angel_image_jobs(id,kind,request_json,created_at) VALUES ('old-running','peek','{}',?)").run(repo.timestamp());
  let calls = 0;
  const restarted = createAngelImageService(repo, { ...deps, render: async () => { calls++; throw new Error('must not run'); } });
  assert.equal(restarted.get('old-running').status, 'failed');
  assert.match(restarted.get('old-running').error, /服务重启/);
  assert.ok(restarted.list().images.includes(completed.result.images[0].url));
  await new Promise(setImmediate); assert.equal(calls, 0);
});

const wardrobe = [
  { scene: 'casual', name: '蓝色私服', description: 'Angel has golden hair, white wings and a halo, wearing a blue casual dress.' },
  { scene: 'home', name: '柔软居家服', description: 'Angel has golden hair, white wings and a halo, wearing a loose ivory home dress.' },
  { scene: 'sleep', name: '浅蓝睡裙', description: 'Angel has golden hair, white wings and a halo, wearing a pale blue nightdress, barefoot.' },
];
function saveWardrobe(repo) { const angel = repo.ensureAngel(); return repo.updateAngel({ display_name: angel.display_name, persona: angel.persona, outfits: wardrobe }); }

test('four angel outfits persist independently, validate atomically and invalidate the schedule without replacing the default persona', t => {
  const { repo, db } = fixture(t);
  db.prepare("UPDATE god_angel SET schedule_generated_at='2026-10-31T00:00:00' WHERE id=1").run();
  const result = saveWardrobe(repo);
  assert.equal(result.persona, persona);
  assert.equal(result.schedule_generated_at, null);
  assert.deepEqual(result.outfits.map(row => row.scene), ['work', 'casual', 'home', 'sleep']);
  assert.match(result.outfits[0].description, /素白短袍/);
  assert.equal(createGodRepository(db).ensureAngel().outfits[3].description, wardrobe[2].description);
  assert.throws(() => repo.updateAngel({ display_name: '不应保存', persona: '不应保存', outfits: [{ scene: 'unknown', description: 'bad' }] }), { status: 400 });
  assert.equal(repo.ensureAngel().display_name, '天使');
  assert.equal(db.prepare('SELECT base_prompt FROM characters WHERE id=1').get().base_prompt, '普通居民保持原样');
  migrateGodSaysSchema(db); assert.equal(repo.ensureAngel().outfits[2].name, '柔软居家服');
});

test('each angel scene has its own uploaded/generated standing and removal never erases another scene', async t => {
  const { repo, images, described } = fixture(t); saveWardrobe(repo);
  const uploaded = await images.upload('standing', png, 'casual');
  const casualUrl = uploaded.standings.find(row => row.scene === 'casual').image_url;
  assert.equal(uploaded.standing_url, '/images/standing/old.png');
  const job = await finish(images, images.start({ kind: 'standing', scene: 'sleep' }).id);
  assert.equal(job.result.applied, true);
  assert.match(described.at(-1).messages.map(message => message.content).join('\n'), /pale blue nightdress/);
  assert.equal(repo.ensureAngel().standings.find(row => row.scene === 'casual').image_url, casualUrl);
  const before = described.length;
  await finish(images, images.start({ kind: 'standing', scene: 'sleep', reuse_prompt: true }).id);
  assert.equal(described.length, before, 'roll image reuses this scene prompt');
  await images.upload('standing', null, 'sleep');
  assert.equal(repo.ensureAngel().standings.find(row => row.scene === 'sleep').image_url, null);
  assert.equal(repo.ensureAngel().standings.find(row => row.scene === 'casual').image_url, casualUrl);
  assert.equal(repo.ensureAngel().standing_url, '/images/standing/old.png');
  await assert.rejects(images.upload('standing', png, 'unknown'), { status: 400 });
});

test('sleep snapshot forces pajamas over a contradictory schedule label and freezes the selected wardrobe', async t => {
  const { repo, images, described } = fixture(t); saveWardrobe(repo);
  const activities = repo.ensureAngel().schedule;
  activities[0].outfit = '蓝色私服';
  repo.db.prepare('UPDATE god_angel SET schedule_json=? WHERE id=1').run(JSON.stringify(activities));
  const start = images.start({ kind: 'peek', activity_index: 0 });
  repo.updateAngel({ display_name: '天使', persona, outfits: wardrobe.map(row => ({ ...row, description: 'changed after request' })) });
  const done = await finish(images, start.id);
  assert.equal(done.request.outfit.scene, 'sleep');
  assert.match(described[0].messages.map(message => message.content).join('\n'), /pale blue nightdress/);
  assert.doesNotMatch(described[0].messages.map(message => message.content).join('\n'), /changed after request/);
});

test('batch designs three outfits and their standings in the background while keeping default appearance and image intact', async t => {
  const { images, repo } = fixture(t, { describe: async (_messages, opts) => opts.label === '天使场景服装生成' ? JSON.stringify({ outfits: wardrobe }) : 'an angel with white wings in her selected outfit, full body portrait' });
  const job = images.start({ kind: 'outfits', baseAppearance: '白色羽翼，金色光环，素白短袍。' });
  assert.equal(images.start({ kind: 'outfits', baseAppearance: '白色羽翼，金色光环。' }).id, job.id);
  assert.throws(() => images.start({ kind: 'standing', scene: 'work' }), { status: 409 });
  const done = await finish(images, job.id);
  assert.equal(done.status, 'done'); assert.equal(done.result.completed.length, 3);
  assert.equal(repo.ensureAngel().standings.filter(row => row.image_url).length, 4);
  assert.equal(repo.ensureAngel().standing_url, '/images/standing/old.png');
  assert.equal(repo.ensureAngel().persona, persona);
  assert.equal(repo.ensureAngel().outfits[3].description, wardrobe[2].description);
});

test('partial batch failure keeps saved outfits and completed images, reports failures and retains the old failed-scene image', async t => {
  let renders = 0;
  const h = fixture(t, {
    describe: async (_messages, opts) => opts.label === '天使场景服装生成' ? JSON.stringify({ outfits: wardrobe }) : 'an angel with white wings in her selected outfit, full body portrait',
    render: async () => ++renders === 2 ? { success: false, error: 'home image offline' } : { success: true, images: [{ base64: png }] },
  });
  const old = await h.images.upload('standing', png, 'home');
  const oldHome = old.standings.find(row => row.scene === 'home').image_url;
  const done = await finish(h.images, h.images.start({ kind: 'outfits', baseAppearance: '白色羽翼与素白短袍。' }).id);
  assert.equal(done.status, 'failed'); assert.match(done.error, /2\/3[\s\S]*home image offline/);
  assert.equal(h.repo.ensureAngel().standings.find(row => row.scene === 'home').image_url, oldHome);
  assert.equal(h.repo.ensureAngel().outfits[1].name, '蓝色私服');
  assert.ok(h.repo.ensureAngel().standings.find(row => row.scene === 'sleep').image_url);
});

test('outfit design never overwrites edits made while the model was running and has a stable cache boundary before the design base', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = fixture(t, { describe: async () => { await gate; return JSON.stringify({ outfits: wardrobe }); } });
  const job = h.images.start({ kind: 'outfits', baseAppearance: '白色羽翼与素白短袍。' });
  await new Promise(setImmediate);
  saveWardrobe(h.repo);
  release();
  const done = await finish(h.images, job.id);
  assert.equal(done.status, 'failed'); assert.match(done.error, /服装已改变/);
  const env = { systemRules: '规则', worldSetting: '<world_setting>云庭</world_setting>', worldRule: '强化' };
  const a = buildAngelOutfitDesignRequest(h.repo.ensureAngel(), { baseAppearance: '白色短袍', scenes: ['sleep'] }, env);
  const b = buildAngelOutfitDesignRequest(h.repo.ensureAngel(), { baseAppearance: '浅蓝短袍', scenes: ['casual'] }, env);
  assert.deepEqual(a.messages.slice(0, a.lorebook.cacheBoundary.index + 1), b.messages.slice(0, b.lorebook.cacheBoundary.index + 1));
  assert.equal(a.messages.filter(message => message.role === 'user').length, 1);
  assert.match(a.messages[2].content, /\"outfits\"[\s\S]*\"scene\"[\s\S]*\"description\"/);
  assert.match(a.messages.at(-1).content, /sleep/);
});


test('angel clothing library uses independent identity, shared tag validation and real dynamic lorebook anchors', async t => {
  const calls = [];
  const h = fixture(t, { describe: async (messages, opts) => {
    calls.push({ messages, opts });
    return JSON.stringify({ appearance: 'Angel has white wings, golden eyes and a halo, wearing a soft blue dress, barefoot.', conflict: '' });
  } });
  const draft = await h.images.clothingDraft({ basePrompt: persona, scene: 'sleep', tags: ['dress'], brief: '浅蓝棉质' });
  assert.match(draft.appearance, /barefoot[\s\S]*Outfit tags: dress/);
  assert.equal(h.repo.ensureAngel().persona, persona, 'draft never changes profile');
  assert.equal(calls[0].opts.lorebook.scope, 'god:angel:clothing');
  const { index, offset } = calls[0].opts.lorebook.cacheBoundary;
  assert.equal(offset, calls[0].messages[index].content.length);
  assert.match(calls[0].messages[index].content, /守护云庭的信使/);
  assert.match(calls[0].messages.at(-1).content, /浅蓝棉质/);
  assert.equal(calls[0].messages.filter(message => message.role === 'user').length, 1);
  await assert.rejects(h.images.clothingDraft({ basePrompt: persona, scene: 'sleep', tags: ['socks'] }), { status: 400 });
  assert.equal(calls.length, 1, 'invalid sleep footwear never reaches LLM');
});
