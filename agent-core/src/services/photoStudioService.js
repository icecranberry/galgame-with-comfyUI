import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { buildCharacterAppearanceSection } from './characterPersona.js';
import { generateImage, getLastWorkflowMode } from './imageSkill.js';
import { getImageDir, buildImageUrl } from './imagePaths.js';
import { ACTIVE_WORKFLOW, PRO_WORKFLOW, resolveCustomWorkflowPath } from './workflowTemplates.js';
import { buildPhotoStudioPrompt, DEFAULT_PHOTO_STUDIO_DIMENSIONS, isPairPose, photoStudioDimensions } from './photoStudioWorkflow.js';

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
  persona = character => buildCharacterAppearanceSection(character, { includeHeading: false }),
  render = generateImage,
  save = savePhoto,
  random = values => values[Math.floor(Math.random() * values.length)],
} = {}) {
  const db = () => database();
  const job = id => db().prepare('SELECT * FROM photo_studio_jobs WHERE id = ?').get(id);
  const list = () => db().prepare('SELECT * FROM photo_studio_jobs ORDER BY created_at DESC, rowid DESC LIMIT 30').all();

  async function submit({ id, characterId, secondCharacterId = null, poseId, instruction = '', width, height }) {
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id || '')) throw Object.assign(new Error('拍摄请求编号无效'), { status: 400 });
    if (typeof instruction !== 'string' || instruction.length > 1000) throw Object.assign(new Error('补充要求最多 1000 字'), { status: 400 });
    let dimensions;
    try { dimensions = photoStudioDimensions(width ?? DEFAULT_PHOTO_STUDIO_DIMENSIONS.width, height ?? DEFAULT_PHOTO_STUDIO_DIMENSIONS.height); }
    catch (error) { throw Object.assign(error, { status: 400 }); }
    const previous = job(id);
    if (previous) return previous;

    const poses = await catalog();
    const pose = poses.find(item => item.id === poseId);
    const first = db().prepare('SELECT * FROM characters WHERE id = ? AND COALESCE(archived, 0) = 0').get(Number(characterId));
    if (!pose || !first) throw Object.assign(new Error('请选择有效的姿势和主角'), { status: 400 });
    if (!pose.posePrompt) throw Object.assign(new Error('该姿势的专属提示词尚未校准，请先选择已有完整描述的姿势'), { status: 400 });
    const supported = await capability();
    if (!supported.available) throw Object.assign(new Error(supported.error), { status: 503 });

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

    const characters = [first, ...(second ? [second] : [])].map(character => ({
      name: character.display_name || character.name,
      appearance: persona(character),
    }));
    const prompt = buildPhotoStudioPrompt({ pose, characters, instruction: instruction.trim() });
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
    if (created) void execute(job(id), pose);
    return job(id);
  }

  async function execute(snapshot, pose) {
    const database = db();
    try {
      database.prepare("UPDATE photo_studio_jobs SET stage = 'queued' WHERE id = ?").run(snapshot.id);
      const result = await render(snapshot.prompt, {
        promptScene: 'standalone',
        alreadyPrepared: true,
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

  return { submit, job, list };
}

async function savePhoto(dataUri, id) {
  const directory = getImageDir('photo_studio');
  await fs.mkdir(directory, { recursive: true });
  const base64 = String(dataUri).replace(/^data:image\/[^;]+;base64,/, '');
  await sharp(Buffer.from(base64, 'base64')).avif({ quality: 65, effort: 4 }).toFile(path.join(directory, `${id}.avif`));
  return buildImageUrl('photo_studio', `${id}.avif`);
}
