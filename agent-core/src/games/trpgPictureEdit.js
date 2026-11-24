import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';
import { apiToGui } from '../services/comfyClient.js';
import { startEditTask } from '../services/imageEditTasks.js';
import { getImageDir } from '../services/imagePaths.js';
import { prepareImagePrompt } from '../services/imagePromptPreparer.js';
import { refineImage } from '../services/imageRefine.js';
import { generateImageRaw, NODE_TITLES } from '../services/imageSkill.js';
import { encodeImageWithWorkflow, readImageWorkflow } from '../services/imageWorkflowMetadata.js';
import { initGames } from './gameRoutes.js';
import { bad, MEDIA_DIR, regularFile } from './gamePaths.js';

const GAME_ID = 'trpg-simulator';

async function prepareSavedPicture(manager, sessionId, state, job) {
  const log = state.publicLog.find(entry => entry.id === job.logId);
  const style = state.scenario.meta.stylePrompt;
  if (log?.description) {
    const { imageService } = manager.context(GAME_ID);
    return imageService.prepareTrpgScene({ sessionId, description: log.description, characters: job.characters,
      playerName: state.player.name, speakerName: log.kind === 'dialogue' ? log.speaker : undefined,
      style, background: job.kind === 'scene' });
  }
  const scene = state.scenario.scenes.find(entry => entry.id === job.sceneId);
  if (!scene) throw bad('找不到这张跑团图片的场景', 404);
  return {
    prompt: [style, scene.imagePrompt || scene.publicDesc, job.mood,
      'wide environment establishing shot, no people, no text'].filter(Boolean).join(', '),
    options: { artist: config.comfyui.artist, width: 1024, height: 576, alreadyPrepared: true, disableRAG: true,
      scene: 'game', workflowScene: 'events', promptScene: 'events' },
  };
}

export function startTrpgPictureEdit(action, url) {
  const legacy = /^\/game-media\/trpg-simulator\/([\w-]+)\/([\w-]+\.png)$/.exec(url);
  const album = /^\/images\/game\/([\w-]+\.(?:png|avif))$/.exec(url);
  if (!legacy && !album) return null;

  const manager = initGames();
  if (manager.repo.game(GAME_ID)?.source !== 'official') return null;
  const sessionId = legacy?.[1] || manager.repo.db.prepare(`
    SELECT session_id FROM game_sessions
    WHERE game_id = ? AND EXISTS (
      SELECT 1 FROM json_each(state_json, '$.imageJobs')
      WHERE json_extract(value, '$.url') = ?
    ) LIMIT 1
  `).get(GAME_ID, url)?.session_id;
  if (!sessionId) return null;
  manager.get(GAME_ID);

  const getPicture = () => {
    const state = manager.repo.session(GAME_ID, sessionId)?.state;
    const job = state?.imageJobs?.find(entry => entry.url === url && entry.status === 'done');
    if (!job || (job.logId && !state.publicLog.slice(0, state.presented).some(log => log.id === job.logId))) {
      throw bad('这张跑团图片已不可编辑', 404);
    }
    return { state, job };
  };
  const { state, job } = getPicture();
  const dir = legacy ? MEDIA_DIR : getImageDir('game');
  let name = legacy ? `${GAME_ID}/${sessionId}/${legacy[2]}` : album[1];
  if (album && name.endsWith('.png') && !fs.existsSync(path.join(dir, name))) name = name.replace(/\.png$/, '.avif');
  if (!fs.existsSync(path.join(dir, name))) throw bad('原图文件不存在', 404);
  const targetPath = regularFile(dir, name);
  const original = fs.statSync(targetPath);
  const format = path.extname(targetPath).slice(1);
  const validateTarget = () => {
    manager.get(GAME_ID);
    getPicture();
    const current = fs.statSync(targetPath, { throwIfNoEntry: false });
    if (!current || current.ino !== original.ino || current.mtimeMs !== original.mtimeMs || current.size !== original.size) {
      throw bad('原图已更新，请重新提交图片任务', 409);
    }
  };

  return startEditTask({
    action, url, targetPath, validateTarget, meta: { gameId: GAME_ID },
    async run({ stageBase, onProgress }) {
      const source = fs.readFileSync(targetPath);
      const workflow = await readImageWorkflow(source);
      const stage = `${stageBase}.${format}`;
      let result;
      let metadata;
      if (action === 'regenerate') {
        const { prompt, options } = workflow ? { prompt: '', options: { sourceWorkflow: workflow } }
          : await prepareSavedPicture(manager, sessionId, state, job);
        const generated = await generateImageRaw(prompt, { ...options, onProgress });
        if (!generated.success || !generated.images?.length) throw new Error(generated.error || '图片生成失败');
        result = generated.images[0];
      } else {
        const graph = workflow?.workflow || apiToGui(workflow?.prompt);
        const sourceText = title => graph?.nodes?.find(node => node.title === title)?.widgets_values?.[0];
        let promptText = sourceText(NODE_TITLES.prompt);
        let loras = workflow?.generation?.characters;
        let artist = sourceText(NODE_TITLES.artist);
        if (!promptText) {
          const { prompt, options } = await prepareSavedPicture(manager, sessionId, state, job);
          ({ promptRefined: promptText } = await prepareImagePrompt(prompt, { ...options, scene: options.promptScene }));
          loras ??= options.loras;
          artist ??= options.artist;
        }
        result = await refineImage({ buffer: source, ext: `.${format}`, output: 'buffer',
          promptText, loras, artist: artist ?? config.comfyui.eventArtist, sourceWorkflow: workflow,
          scene: 'game', workflowScene: 'events', onProgress });
        // 下次重新生成仍从原始生图工作流出发。
        metadata = source;
      }
      const pixels = Buffer.from(result.base64.replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
      const output = await encodeImageWithWorkflow(sharp(pixels).toFormat(format), metadata ?? pixels, format);
      await fs.promises.writeFile(stage, output);
      return { filename: path.basename(stage) };
    },
  });
}
