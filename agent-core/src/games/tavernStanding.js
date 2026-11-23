import sharp from 'sharp';
import { generateImageRaw } from '../services/imageSkill.js';
import { prepareStandingImage } from '../services/expressionStandingAssets.js';
import { frameStandingPrompt } from '../services/expressionStandingPipeline.js';
import { captureStandingImageConfig } from '../services/expressionStandingService.js';
import { saveGameOutput } from './gameMedia.js';
import { bad } from './gamePaths.js';

export async function renderTavernStanding({ gameId, sessionId, character, prompt, tier, sessionExists }) {
  const generation = captureStandingImageConfig(character);
  const result = await generateImageRaw(frameStandingPrompt(prompt), {
    ...generation, imageProvider: 'comfyui', scene: 'portrait', workflowScene: null, promptScene: 'avatar',
    alreadyPrepared: true, disableRAG: true, normalizeComfyCountTags: false,
    negativePrompt: [
      generation.negativePrompt,
      'background scenery, furniture, character reference sheet, collage, multiple views, comic panel border, duplicate figure, multiple heads, extra people, extra hands, disconnected limbs, face paint, runny nose, snot, text, signature, watermark, costume change, character redesign',
      (tier === 'heavy' || tier === 'blackout') && 'open eyes, one eye open, visible irises, winking, eye contact',
    ].filter(Boolean).join(', '),
  });
  if (!result.success || !result.images?.[0]) throw bad(result.error || '临时立绘生成失败', 502);
  const image = result.images[0];
  const png = Buffer.from((typeof image === 'string' ? image : image.base64).replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
  const { output, bounds } = await prepareStandingImage(png);
  if (!bounds || (await sharp(output).stats()).isOpaque) throw bad('临时立绘没有可用的透明轮廓', 502);
  return saveGameOutput({ success: true, images: [output.toString('base64')] },
    { outputScope: 'game', gameId, sessionId }, { sessionExists });
}
