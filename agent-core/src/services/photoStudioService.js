import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { buildCharacterImageAppearance, extractCharacterEnglishName, extractCharacterIdentityTag, replaceAppearanceSection } from './characterPersona.js';
import { resolveClothingTags } from './clothingLibrary.js';
import { resolveStudioBackground, getStudioBackgrounds } from './photoStudioBackgrounds.js';
import { angelOutfits } from './godSays/angelWardrobe.js';
import { resolveCustomStudioPose } from './photoStudioPose.js';
import { collectCharacterLoras } from './groupImageLoraMatcher.js';
import { polishStudioPrompt, getStudioPolishContext, generateStudioClothing, splitStudioTags, studioPoseTags } from './photoStudioPolish.js';
import { generateImage, getLastWorkflowMode } from './imageSkill.js';
import { saveBase64Image } from './imagePaths.js';
import { broadcast } from './unifiedStreamBus.js';
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
  publish = broadcast,
  polish = polishStudioPrompt,
  polishContext = getStudioPolishContext,
  clothing = generateStudioClothing,
  random = values => values[Math.floor(Math.random() * values.length)],
} = {}) {
  const db = () => database();
  const job = id => db().prepare('SELECT * FROM photo_studio_jobs WHERE id = ?').get(id);
  const notify = (id, terminal = false) => publish(terminal ? 'photo_studio_ready' : 'photo_studio_progress', { job: job(id) });
  const list = () => db().prepare('SELECT * FROM photo_studio_jobs ORDER BY created_at DESC, rowid DESC LIMIT 30').all();
  const outfitScenes = ['work', 'casual', 'home', 'sleep'];
  // A bounded result cache survives navigation and image-render retries, but not
  // a server restart. Store only successful rewrites, never failures.
  const polishedPrompts = new Map();
  function listCharacters() {
    // 与酒馆 /api/characters 一致：列出全部角色资料，不按小镇身份、立绘或服装筛选。
    const outfits = db().prepare("SELECT character_id, scene FROM character_outfits WHERE scene IN ('casual', 'home', 'sleep') AND TRIM(COALESCE(description, '')) != ''").all();
    return db().prepare('SELECT id, name, display_name, avatar_path, standing_url FROM characters ORDER BY pinned DESC, id DESC').all().map(character => ({
      ...character,
      outfitScenes: outfitScenes.filter(scene => scene === 'work' || outfits.some(outfit => outfit.character_id === character.id && outfit.scene === scene)),
    }));
  }

  function loadCharacter(id) {
    if (id !== 'angel') return db().prepare('SELECT * FROM characters WHERE id = ?').get(Number(id));
    const exists = db().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='god_angel'").get();
    const angel = exists && db().prepare('SELECT * FROM god_angel WHERE id = 1').get();
    if (!angel) throw Object.assign(new Error('尚未创建天使，请先在神说中召唤天使'), { status: 400 });
    return { id: 'god:angel', name: 'the angel', display_name: angel.display_name || '天使', base_prompt: angel.persona, angel };
  }

  async function prepare({ characterId, secondCharacterId = null, outfitScene = 'work', secondOutfitScene = 'work', appearanceOverride = '', secondAppearanceOverride = '', clothingTags = [], secondClothingTags = [], customClothingPrompt = '', secondCustomClothingPrompt = '', poseId, customPose, instruction = '', backgroundId = '', customBackgroundPrompt = '', width, height, polishPrompt = false, polishInstruction = '', strictParticipants = false }) {
    if (typeof polishInstruction !== 'string' || polishInstruction.length > 1000) throw Object.assign(new Error('润色任务额外需求最多 1000 字'), { status: 400 });
    polishInstruction = polishInstruction.trim();
    if (typeof strictParticipants !== 'boolean') throw Object.assign(new Error('入镜名单参数无效'), { status: 400 });
    const hasSecond = secondCharacterId !== null && secondCharacterId !== '';
    if (strictParticipants && (characterId == null || characterId === '' || (hasSecond && secondCharacterId === characterId))) throw Object.assign(new Error('请明确指定一至两位不同的入镜角色'), { status: 400 });
    if (backgroundId === 'random') {
      if (customBackgroundPrompt) throw Object.assign(new Error('随机背景不能同时指定自定义背景'), { status: 400 });
      const entries = getStudioBackgrounds().entries;
      if (!entries.length) throw Object.assign(new Error('背景库没有可用条目'), { status: 400 });
      backgroundId = random(entries).id;
    }
    const backgroundPrompt = resolveStudioBackground({ backgroundId, customBackgroundPrompt });
    if (typeof polishPrompt !== 'boolean') throw Object.assign(new Error('AI 润色开关无效'), { status: 400 });
    for (const appearance of [appearanceOverride, secondAppearanceOverride]) {
      if (typeof appearance !== 'string' || appearance.length > 30000) throw Object.assign(new Error('服装提示词最多 30000 字'), { status: 400 });
    }
    if (typeof instruction !== 'string' || instruction.length > 1000) throw Object.assign(new Error('补充要求最多 1000 字'), { status: 400 });
    let dimensions;
    try { dimensions = photoStudioDimensions(width ?? DEFAULT_PHOTO_STUDIO_DIMENSIONS.width, height ?? DEFAULT_PHOTO_STUDIO_DIMENSIONS.height); }
    catch (error) { throw Object.assign(error, { status: 400 }); }
    let pose;
    if (poseId === 'random' || poseId === undefined) {
      const candidates = (await catalog()).filter(item => item.posePrompt && isPairPose(item) === hasSecond);
      if (!candidates.length) throw Object.assign(new Error(hasSecond ? '没有可用的已校准双人姿势' : '没有可用的已校准单人姿势'), { status: 400 });
      pose = random(candidates);
    } else {
      pose = poseId === 'custom-upload' ? resolveCustomStudioPose(customPose) : (await catalog()).find(item => item.id === poseId);
    }
    if (!pose) throw Object.assign(new Error('请选择有效的姿势和主角'), { status: 400 });
    if (!pose.posePrompt) throw Object.assign(new Error('该姿势的专属提示词尚未校准，请先选择已有完整描述的姿势'), { status: 400 });

    const duo = isPairPose(pose);
    if (strictParticipants && duo !== hasSecond) throw Object.assign(new Error(duo ? '双人姿势必须指定搭档' : '单人姿势不能加入第二位角色'), { status: 400 });
    const randomFirst = characterId === null || characterId === '';
    const randomSecond = secondCharacterId === null || secondCharacterId === '';
    let second = null;
    if (duo && !randomSecond) {
      second = loadCharacter(secondCharacterId);
      if (!second) throw Object.assign(new Error('请选择有效的第二位角色'), { status: 400 });
    }
    let first;
    if (randomFirst) {
      const candidates = db().prepare('SELECT * FROM characters WHERE id != ? ORDER BY pinned DESC, id DESC').all(second?.id ?? -1);
      if (!candidates.length) throw Object.assign(new Error(duo ? '双人姿势至少需要两位可用角色' : '没有可选择的角色'), { status: 400 });
      first = random(candidates);
    } else {
      first = loadCharacter(characterId);
      if (!first) throw Object.assign(new Error('请选择有效的姿势和主角'), { status: 400 });
    }
    if (duo) {
      if (!randomSecond) {
        if (second.id === first.id) throw Object.assign(new Error('双人姿势需要选择两位不同角色'), { status: 400 });
      } else {
        const candidates = db().prepare('SELECT * FROM characters WHERE id != ? ORDER BY pinned DESC, id DESC').all(first.id);
        if (!candidates.length) throw Object.assign(new Error('双人姿势至少需要两位可用角色'), { status: 400 });
        second = random(candidates);
      }
    }

    const outfitInputs = [[clothingTags, customClothingPrompt], ...(second ? [[secondClothingTags, secondCustomClothingPrompt]] : [])];
    const outfits = outfitInputs.map(([tags, custom]) => {
      if (!Array.isArray(tags) || typeof custom !== 'string' || custom.length > 4000 || /```|\p{Script=Han}/u.test(custom)) throw Object.assign(new Error('本次服装参数无效，请重新选择或翻译'), { status: 400 });
      let entries;
      try { entries = tags.length ? resolveClothingTags(tags) : []; }
      catch (error) { throw Object.assign(error, { status: 400 }); }
      return { tags: entries.map(entry => entry.tag), custom: custom.trim() };
    });
    const scenes = [outfitScene, secondOutfitScene];
    const overrides = [randomFirst ? '' : appearanceOverride, randomSecond ? '' : secondAppearanceOverride];
    const characters = [first, ...(second ? [second] : [])].map((character, index) => {
      const scene = scenes[index];
      if (!outfitScenes.includes(scene)) throw Object.assign(new Error('请选择有效的服装：默认、私服、居家或睡衣'), { status: 400 });
      let selected = character;
      if (overrides[index].trim()) {
        selected = { ...character, base_prompt: replaceAppearanceSection(character.base_prompt, overrides[index].trim()) };
      } else if (scene !== 'work') {
        const outfit = character.angel ? angelOutfits(character.angel).find(outfit => outfit.scene === scene)
          : db().prepare('SELECT description FROM character_outfits WHERE character_id = ? AND scene = ? ORDER BY id ASC LIMIT 1').get(character.id, scene);
        if (!outfit?.description?.trim() && !(index === 0 ? randomFirst : randomSecond)) throw Object.assign(new Error(`${character.display_name || character.name}尚未配置所选服装，请选择默认服装或先到人物详情卡配置`), { status: 400 });
        // Scene descriptions contain the complete appearance. Replace, rather than layer over, the default clothes.
        if (outfit?.description?.trim()) selected = { ...character, base_prompt: replaceAppearanceSection(character.base_prompt, outfit.description) };
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
    // This task explicitly needs short_prompt alone, not characterPersona's
    // short variant (which also appends the default appearance and outfits).
    const personas = polishPrompt ? [first, ...(second ? [second] : [])].map(character => character.short_prompt || '').filter(text => text.trim()) : [];
    const poseText = basePrompt.slice('Pose: '.length, basePrompt.indexOf('\n\n'));
    const requiredTags = [...new Set([
      ...outfits.flatMap(outfit => [...outfit.tags.flatMap(splitStudioTags), ...splitStudioTags(outfit.custom)]),
      ...studioPoseTags(poseText),
    ])];
    const loras = collectCharacterLoras([first, ...(second ? [second] : [])].filter(character => !character.angel));
    return { first, second, pose, backgroundId, prompt, dimensions, personas, loras, requiredTags, polishInstruction };
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
    const { first, second, pose, backgroundId, prompt, dimensions, personas, loras, requiredTags, polishInstruction } = await prepare(input);
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
        (id, character_id, character2_id, character_kind, character2_kind, background_id, character_name, character2_name, pose_id, pose_name, image_task_id, prompt, width, height)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, first.angel ? null : first.id, second?.angel ? null : second?.id ?? null, first.angel ? 'angel' : 'resident', second?.angel ? 'angel' : 'resident', backgroundId,
          firstName, secondName, pose.id, `${pose.name} · ${pose.angle}`, Number(task.lastInsertRowid), prompt, dimensions.width, dimensions.height);
      return true;
    })();
    if (created) {
      notify(id);
      void execute(job(id), { polishPrompt: input.polishPrompt === true, personas, loras, requiredTags, polishInstruction });
    }
    return job(id);
  }

  async function execute(snapshot, { polishPrompt, personas, loras, requiredTags, polishInstruction }) {
    const database = db();
    try {
      if (polishPrompt) {
        const context = polishContext();
        const key = createHash('sha256').update(JSON.stringify({
          prompt: snapshot.prompt, personas, requiredTags, polishInstruction, context,
          actors: [snapshot.character_kind, snapshot.character_id, snapshot.character2_kind, snapshot.character2_id], poseId: snapshot.pose_id,
          // Resolution belongs to rendering; it does not change the LLM input.
          loras,
        })).digest('hex');
        if (polishedPrompts.has(key)) {
          snapshot.prompt = polishedPrompts.get(key);
        } else {
          database.prepare("UPDATE photo_studio_jobs SET stage = 'polishing' WHERE id = ?").run(snapshot.id);
          notify(snapshot.id);
          snapshot.prompt = await polish({ prompt: snapshot.prompt, personas, requiredTags, polishInstruction, context });
          polishedPrompts.set(key, snapshot.prompt);
          if (polishedPrompts.size > 32) polishedPrompts.delete(polishedPrompts.keys().next().value);
        }
        database.prepare('UPDATE photo_studio_jobs SET prompt = ? WHERE id = ?').run(snapshot.prompt, snapshot.id);
        database.prepare('UPDATE image_tasks SET prompt_refined = ? WHERE id = ?').run(snapshot.prompt, snapshot.image_task_id);
      }
      database.prepare("UPDATE photo_studio_jobs SET stage = 'queued' WHERE id = ?").run(snapshot.id);
      notify(snapshot.id);
      const result = await render(snapshot.prompt, {
        promptScene: 'standalone',
        alreadyPrepared: true,
        artist: config.comfyui.momentsArtist ?? config.comfyui.artist,
        // Keep LoRA triggers out of AI rewriting; the shared workflow adds them
        // to its dedicated trigger node and loads the models with their saved weights.
        loras,
        width: snapshot.width,
        height: snapshot.height,
        onProgress: event => {
          const progress = Number(event.progress);
          const hasProgress = !event.estimated && event.progress != null && Number.isFinite(progress);
          const stage = event.phase === 'executed' || event.phase === 'done' ? 'saving'
            : event.stage === 'submitting' || event.stage === 'retrying' || event.phase === 'submitted' || event.phase === 'waiting' ? 'queued'
              : hasProgress ? 'sampling' : 'generating';
          // ComfyUI reports the current sampling pass, not total job completion.
          // A new pass/retry may restart at zero; non-sampling phases have no percentage.
          database.prepare('UPDATE photo_studio_jobs SET stage = ?, progress = ? WHERE id = ?')
            .run(stage, stage === 'sampling' ? Math.min(1, Math.max(0, progress)) : 0, snapshot.id);
          notify(snapshot.id);
        },
      });
      if (!result.success || !result.images?.[0]?.base64) throw new Error(result.error || 'Anima 工作流未返回图片');
      database.prepare("UPDATE photo_studio_jobs SET stage = 'saving', progress = 0 WHERE id = ?").run(snapshot.id);
      notify(snapshot.id);
      const url = await save(result.images[0].base64, snapshot.id);
      database.transaction(() => {
        database.prepare("UPDATE photo_studio_jobs SET status = 'done', stage = 'done', progress = 1, output_url = ?, finished_at = datetime('now') WHERE id = ?").run(url, snapshot.id);
        database.prepare("UPDATE image_tasks SET status = 'done', prompt_refined = ?, output_paths = ?, workflow_template = ?, finished_at = datetime('now') WHERE id = ?")
          .run(snapshot.prompt, JSON.stringify([url]), `photo-studio-anima-${result.wfMode || getLastWorkflowMode()}`, snapshot.image_task_id);
      })();
      notify(snapshot.id, true);
    } catch (error) {
      database.transaction(() => {
        database.prepare("UPDATE photo_studio_jobs SET status = 'failed', stage = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?").run(error.message, snapshot.id);
        database.prepare("UPDATE image_tasks SET status = 'failed', error_message = ?, workflow_template = ?, finished_at = datetime('now') WHERE id = ?")
          .run(error.message, `photo-studio-anima-${getLastWorkflowMode()}`, snapshot.image_task_id);
      })();
      notify(snapshot.id, true);
    }
  }

  async function clothingDraft({ brief = '' }) {
    if (typeof brief !== 'string' || brief.length > 2000) throw Object.assign(new Error('自定义服装最多 2000 字'), { status: 400 });
    if (!brief.trim()) return { prompt: '' };
    return { prompt: await clothing({ brief: brief.trim() }) };
  }

  return { submit, preview, clothingDraft, job, list, listCharacters };
}

export function savePhoto(dataUri, id) {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id || '')) throw new Error('拍摄请求编号无效');
  // Match schedule peek: persist the original bytes, then push a small URL over
  // SSE. Optional compression belongs to the shared background compressor.
  const extension = String(dataUri).match(/^data:image\/(png|jpe?g|webp|avif);base64,/i)?.[1]?.toLowerCase() || 'png';
  return saveBase64Image('photo_studio', `${id}.${extension}`, dataUri);
}
