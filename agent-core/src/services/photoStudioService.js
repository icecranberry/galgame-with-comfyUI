import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { buildCharacterImageAppearance, buildCharacterPersona, extractCharacterEnglishName, extractCharacterIdentityTag, replaceAppearanceSection } from './characterPersona.js';
import { resolveClothingTags } from './clothingLibrary.js';
import { resolveStudioBackground } from './photoStudioBackgrounds.js';
import { collectCharacterLoras } from './groupImageLoraMatcher.js';
import { polishStudioPrompt, generateStudioClothing } from './photoStudioPolish.js';
import { generateImage, getLastWorkflowMode } from './imageSkill.js';
import { getImageDir, buildImageUrl } from './imagePaths.js';
import { ACTIVE_WORKFLOW, PRO_WORKFLOW, resolveCustomWorkflowPath } from './workflowTemplates.js';
import { buildPhotoStudioPrompt, appendPhotoStudioOutfits, DEFAULT_PHOTO_STUDIO_DIMENSIONS, isPairPose, photoStudioDimensions } from './photoStudioWorkflow.js';

export const POSE_GALLERY_DIR = fileURLToPath(new URL('../../assets/pose-gallery/', import.meta.url));
const WORKFLOW_DIR = fileURLToPath(new URL('../../../workflow/', import.meta.url));
let catalogPromise;

export function getPoseCatalog() {
  catalogPromise ||= Promise.all([
    fs.readFile(path.join(POSE_GALLERY_DIR, 'catalog.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(POSE_GALLERY_DIR, 'pose-prompts.json'), 'utf8').then(JSON.parse).catch(() => ({ prompts: {} })),
  ]).then(([catalog, additions]) => {
    const prompts = additions.prompts || {};
    return catalog.map(pose => {
      const addition = prompts[pose.id];
      // Existing single-person entries are strings; pair entries also bind each actor's role.
      return {
        ...pose,
        posePrompt: (typeof addition === 'string' ? addition : addition?.posePrompt) || pose.posePrompt || '',
        ...(Array.isArray(addition?.characterRoles) ? { characterRoles: addition.characterRoles } : {}),
      };
    });
  }).catch(error => { catalogPromise = null; throw error; });
  return catalogPromise;
}

export async function getRecognizedPoseCatalog() {
  return (await getPoseCatalog()).filter(pose => pose.posePrompt);
}

function selectedWorkflowPath() {
  const mode = config.workflow?.mode || 'turbo';
  if (mode === 'base') return path.join(WORKFLOW_DIR, PRO_WORKFLOW);
  if (mode === 'custom') return resolveCustomWorkflowPath(config.workflow?.customTemplate);
  if (mode === 'hybrid' && config.workflow?.scene?.standalone === 'base') return path.join(WORKFLOW_DIR, PRO_WORKFLOW);
  return path.join(WORKFLOW_DIR, ACTIVE_WORKFLOW);
}

export async function photoStudioCapability() {
  if ((config.comfyui.imageProvider || 'comfyui') !== 'comfyui') {
    return { available: false, engine: 'Anima', error: '照相馆使用默认 Anima 工作流，请先将图片提供商切换为 ComfyUI。' };
  }
  try {
    const workflowPath = selectedWorkflowPath();
    if (!workflowPath) throw new Error('当前自定义工作流不存在');
    const workflow = await fs.readFile(workflowPath, 'utf8');
    if (!/anima_(?:base|turbo)/i.test(workflow)) throw new Error('当前默认工作流未检测到 Anima 模型');
    const response = await fetch(`${config.comfyui.url}/queue`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`ComfyUI HTTP ${response.status}`);
    return { available: true, engine: `Anima · ${config.workflow?.mode || 'turbo'}`, error: null };
  } catch (error) {
    return { available: false, engine: 'Anima', error: `默认 Anima 暗房未就绪：${error.message}` };
  }
}

export function createPhotoStudioService({
  database = getDb,
  catalog = getPoseCatalog,
  capability = photoStudioCapability,
  persona = buildCharacterImageAppearance,
  render = generateImage,
  save = savePhoto,
  polish = polishStudioPrompt,
  clothing = generateStudioClothing,
  random = values => values[Math.floor(Math.random() * values.length)],
} = {}) {
  const db = () => database();
  const job = id => db().prepare('SELECT * FROM photo_studio_jobs WHERE id = ?').get(id);
  const list = () => db().prepare('SELECT * FROM photo_studio_jobs ORDER BY created_at DESC, rowid DESC LIMIT 30').all();
  const outfitScenes = ['work', 'casual', 'home', 'sleep'];
  function listCharacters() {
    const outfits = db().prepare("SELECT character_id, scene FROM character_outfits WHERE scene IN ('casual', 'home', 'sleep') AND TRIM(COALESCE(description, '')) != ''").all();
    return db().prepare('SELECT id, name, display_name, avatar_path, standing_url FROM characters WHERE COALESCE(archived, 0) = 0 ORDER BY pinned DESC, id DESC').all().map(character => ({
      ...character,
      outfitScenes: outfitScenes.filter(scene => scene === 'work' || outfits.some(outfit => outfit.character_id === character.id && outfit.scene === scene)),
    }));
  }

  async function prepare({ characterId, secondCharacterId = null, outfitScene = 'work', secondOutfitScene = 'work', appearanceOverride = '', secondAppearanceOverride = '', clothingTags = [], secondClothingTags = [], customClothingPrompt = '', secondCustomClothingPrompt = '', poseId, instruction = '', backgroundId = '', customBackgroundPrompt = '', width, height, polishPrompt = false }) {
    const backgroundPrompt = resolveStudioBackground({ backgroundId, customBackgroundPrompt });
    if (typeof polishPrompt !== 'boolean') throw Object.assign(new Error('AI 润色开关无效'), { status: 400 });
    for (const appearance of [appearanceOverride, secondAppearanceOverride]) {
      if (typeof appearance !== 'string' || appearance.length > 30000) throw Object.assign(new Error('服装提示词最多 30000 字'), { status: 400 });
    }
    if (typeof instruction !== 'string' || instruction.length > 1000) throw Object.assign(new Error('补充要求最多 1000 字'), { status: 400 });
    let dimensions;
    try { dimensions = photoStudioDimensions(width ?? DEFAULT_PHOTO_STUDIO_DIMENSIONS.width, height ?? DEFAULT_PHOTO_STUDIO_DIMENSIONS.height); }
    catch (error) { throw Object.assign(error, { status: 400 }); }
    const poses = await catalog();
    const pose = poses.find(item => item.id === poseId);
    const first = db().prepare('SELECT * FROM characters WHERE id = ? AND COALESCE(archived, 0) = 0').get(Number(characterId));
    if (!pose || !first) throw Object.assign(new Error('请选择有效的姿势和主角'), { status: 400 });
    if (!pose.posePrompt) throw Object.assign(new Error('该姿势的专属提示词尚未校准，请先选择已有完整描述的姿势'), { status: 400 });

    const duo = isPairPose(pose);
    let second = null;
    if (duo) {
      if (secondCharacterId !== null && secondCharacterId !== '') {
        if (Number(secondCharacterId) === Number(first.id)) throw Object.assign(new Error('双人姿势需要选择两位不同角色'), { status: 400 });
        second = db().prepare('SELECT * FROM characters WHERE id = ? AND COALESCE(archived, 0) = 0').get(Number(secondCharacterId));
        if (!second) throw Object.assign(new Error('请选择有效的第二位角色'), { status: 400 });
      } else {
        const candidates = db().prepare('SELECT * FROM characters WHERE COALESCE(archived, 0) = 0 AND id != ? ORDER BY pinned DESC, id DESC').all(first.id);
        if (!candidates.length) throw Object.assign(new Error('双人姿势至少需要两位可用角色'), { status: 400 });
        second = random(candidates);
      }
    }

    const outfitInputs = [[clothingTags, customClothingPrompt], ...(second ? [[secondCharacterId ? secondClothingTags : [], secondCharacterId ? secondCustomClothingPrompt : '']] : [])];
    const outfits = outfitInputs.map(([tags, custom]) => {
      if (!Array.isArray(tags) || typeof custom !== 'string' || custom.length > 4000 || /```|\p{Script=Han}/u.test(custom)) throw Object.assign(new Error('本次服装参数无效，请重新选择或翻译'), { status: 400 });
      let entries;
      try { entries = tags.length ? resolveClothingTags(tags) : []; }
      catch (error) { throw Object.assign(error, { status: 400 }); }
      return { tags: entries.map(entry => entry.tag), custom: custom.trim() };
    });
    const scenes = [outfitScene, secondCharacterId ? secondOutfitScene : 'work'];
    const overrides = [appearanceOverride, secondCharacterId ? secondAppearanceOverride : ''];
    const characters = [first, ...(second ? [second] : [])].map((character, index) => {
      const scene = scenes[index];
      if (!outfitScenes.includes(scene)) throw Object.assign(new Error('请选择有效的服装：默认、私服、居家或睡衣'), { status: 400 });
      let selected = character;
      if (overrides[index].trim()) {
        selected = { ...character, base_prompt: replaceAppearanceSection(character.base_prompt, overrides[index].trim()) };
      } else if (scene !== 'work') {
        const outfit = db().prepare('SELECT description FROM character_outfits WHERE character_id = ? AND scene = ? ORDER BY id ASC LIMIT 1').get(character.id, scene);
        if (!outfit?.description?.trim()) throw Object.assign(new Error(`${character.display_name || character.name}尚未配置所选服装，请选择默认服装或先到人物详情卡配置`), { status: 400 });
        // Scene descriptions contain the complete appearance. Replace, rather than layer over, the default clothes.
        selected = { ...character, base_prompt: replaceAppearanceSection(character.base_prompt, outfit.description) };
      }
      const name = extractCharacterEnglishName(selected) || extractCharacterEnglishName(character) || `the ${index === 0 ? 'first' : 'second'} character`;
      const appearance = persona(selected);
      if (!appearance) throw Object.assign(new Error(`${character.display_name || character.name}缺少可用的外观正文，请先完善人物详情卡`), { status: 400 });
      return { name, appearance, identityTag: extractCharacterIdentityTag(selected) || extractCharacterIdentityTag(character), aliases: [character.display_name, character.name] };
    });
    const basePrompt = buildPhotoStudioPrompt({ pose, characters, instruction: instruction.trim(), backgroundPrompt });
    const outfitBlocks = characters.map((character, index) => {
      const { tags, custom } = outfits[index];
      if (!tags.length && !custom) return '';
      return [`Character ${index + 1} — Outfit: Replace ${character.name}'s original clothing with the following outfit; preserve their physical appearance.`,
        ...(tags.length ? [`Clothing tags: (${tags.join(', ')})`] : []),
        ...(custom ? [`Custom clothing: (${custom})`] : []),
      ].join('\n');
    });
    const prompt = appendPhotoStudioOutfits(basePrompt, outfitBlocks);
    const personas = polishPrompt ? [first, ...(second ? [second] : [])].map(character => buildCharacterPersona(character, { variant: 'full', outfits: null })) : [];
    const loras = collectCharacterLoras([first, ...(second ? [second] : [])]);
    return { first, second, pose, prompt, dimensions, personas, loras, basePrompt, outfitBlocks };
  }

  async function preview(input) {
    const { prompt, dimensions } = await prepare(input);
    return { prompt, ...dimensions };
  }

  async function submit(input) {
    const { id } = input;
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id || '')) throw Object.assign(new Error('拍摄请求编号无效'), { status: 400 });
    const previous = job(id);
    if (previous) return previous;
    const { first, second, pose, prompt, dimensions, personas, loras, basePrompt, outfitBlocks } = await prepare(input);
    const supported = await capability();
    if (!supported.available) throw Object.assign(new Error(supported.error), { status: 503 });
    const firstName = first.display_name || first.name;
    const secondName = second?.display_name || null;
    const created = db().transaction(() => {
      if (job(id)) return false;
      const active = db().prepare("SELECT id FROM photo_studio_jobs WHERE status = 'running' LIMIT 1").get();
      if (active) throw Object.assign(new Error('已有照片正在拍摄，请等待完成'), { status: 409 });
      const task = db().prepare("INSERT INTO image_tasks (prompt_original, prompt_refined, status) VALUES (?, ?, 'running')").run(prompt, prompt);
      db().prepare(`INSERT INTO photo_studio_jobs
        (id, character_id, character2_id, character_name, character2_name, pose_id, pose_name, image_task_id, prompt, width, height)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, first.id, second?.id ?? null, firstName, secondName, pose.id, `${pose.name} · ${pose.angle}`, Number(task.lastInsertRowid), prompt, dimensions.width, dimensions.height);
      return true;
    })();
    if (created) void execute(job(id), { polishPrompt: input.polishPrompt === true, personas, loras, basePrompt, outfitBlocks });
    return job(id);
  }

  async function execute(snapshot, { polishPrompt, personas, loras, basePrompt, outfitBlocks }) {
    const database = db();
    try {
      if (polishPrompt) {
        database.prepare("UPDATE photo_studio_jobs SET stage = 'polishing' WHERE id = ?").run(snapshot.id);
        snapshot.prompt = appendPhotoStudioOutfits(await polish({ prompt: basePrompt, personas }), outfitBlocks);
        database.prepare('UPDATE photo_studio_jobs SET prompt = ? WHERE id = ?').run(snapshot.prompt, snapshot.id);
        database.prepare('UPDATE image_tasks SET prompt_refined = ? WHERE id = ?').run(snapshot.prompt, snapshot.image_task_id);
      }
      database.prepare("UPDATE photo_studio_jobs SET stage = 'queued' WHERE id = ?").run(snapshot.id);
      const result = await render(snapshot.prompt, {
        promptScene: 'standalone',
        alreadyPrepared: true,
        // Keep LoRA triggers out of AI rewriting; the shared workflow adds them
        // to its dedicated trigger node and loads the models with their saved weights.
        loras,
        width: snapshot.width,
        height: snapshot.height,
        onProgress: event => {
          const progress = Number(event.progress);
          const stage = event.stage === 'submitting' ? 'queued' : 'generating';
          database.prepare('UPDATE photo_studio_jobs SET stage = ?, progress = MAX(progress, ?) WHERE id = ?')
            .run(stage, Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0, snapshot.id);
        },
      });
      if (!result.success || !result.images?.[0]?.base64) throw new Error(result.error || 'Anima 工作流未返回图片');
      database.prepare("UPDATE photo_studio_jobs SET stage = 'saving' WHERE id = ?").run(snapshot.id);
      const url = await save(result.images[0].base64, snapshot.id);
      database.transaction(() => {
        database.prepare("UPDATE photo_studio_jobs SET status = 'done', stage = 'done', progress = 1, output_url = ?, finished_at = datetime('now') WHERE id = ?").run(url, snapshot.id);
        database.prepare("UPDATE image_tasks SET status = 'done', prompt_refined = ?, output_paths = ?, workflow_template = ?, finished_at = datetime('now') WHERE id = ?")
          .run(snapshot.prompt, JSON.stringify([url]), `photo-studio-anima-${result.wfMode || getLastWorkflowMode()}`, snapshot.image_task_id);
      })();
    } catch (error) {
      database.transaction(() => {
        database.prepare("UPDATE photo_studio_jobs SET status = 'failed', stage = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?").run(error.message, snapshot.id);
        database.prepare("UPDATE image_tasks SET status = 'failed', error_message = ?, workflow_template = ?, finished_at = datetime('now') WHERE id = ?")
          .run(error.message, `photo-studio-anima-${getLastWorkflowMode()}`, snapshot.image_task_id);
      })();
    }
  }

  async function clothingDraft({ brief = '' }) {
    if (typeof brief !== 'string' || brief.length > 2000) throw Object.assign(new Error('自定义服装最多 2000 字'), { status: 400 });
    if (!brief.trim()) return { prompt: '' };
    return { prompt: await clothing({ brief: brief.trim() }) };
  }

  return { submit, preview, clothingDraft, job, list, listCharacters };
}

async function savePhoto(dataUri, id) {
  const directory = getImageDir('photo_studio');
  await fs.mkdir(directory, { recursive: true });
  const base64 = String(dataUri).replace(/^data:image\/[^;]+;base64,/, '');
  await sharp(Buffer.from(base64, 'base64')).avif({ quality: 65, effort: 4 }).toFile(path.join(directory, `${id}.avif`));
  return buildImageUrl('photo_studio', `${id}.avif`);
}
