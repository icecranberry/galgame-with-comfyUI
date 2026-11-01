import { randomUUID } from 'node:crypto';
import { saveBase64Image, deleteImageFileByUrl } from './imagePaths.js';
import { invalidateGalleryCache } from './galleryCache.js';

export function studioDimensions({ width, height, mode = 'chat' }, settings) {
  const prefix = mode === 'event' ? 'event' : mode === 'moments' ? 'moments' : '';
  const dimensions = { width: width ?? settings[prefix ? `${prefix}Width` : 'width'], height: height ?? settings[prefix ? `${prefix}Height` : 'height'] };
  for (const [name, value] of Object.entries(dimensions)) {
    if (!Number.isInteger(value) || value < 256 || value > 4096) throw Object.assign(new Error(`${name === 'width' ? '宽度' : '高度'}必须是256至4096之间的整数像素`), { status: 400 });
  }
  return dimensions;
}

// 实验室默认仍只预览；神说显式请求持久化，模型和 SSE 只收到本地 URL，不携带 base64。
export function saveStudioChatImages(db, result, { prompt, originalPrompt, width, height, artist }, { save = saveBase64Image, remove = deleteImageFileByUrl } = {}) {
  if (!result.images?.length) throw new Error('生图服务没有返回图片');
  const types = result.images.map(image => /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.exec(image.base64 || '')?.[1]);
  if (types.some(type => !type)) throw new Error('生图服务返回了无效的图片数据');
  const images = [];
  try {
    for (const [index, image] of result.images.entries()) {
      const filename = `god_${randomUUID()}.${types[index] === 'jpeg' ? 'jpg' : types[index]}`;
      images.push({ url: save('chat', filename, image.base64), filename, width, height });
    }
    const task = db.prepare(`INSERT INTO image_tasks(conversation_id,prompt_original,prompt_refined,style,resolution,workflow_template,comfyui_prompt_id,status,output_paths,finished_at)
      VALUES ('god:angel',?,?,?,?,?,?,'done',?,datetime('now'))`).run(originalPrompt, prompt, artist, `${width}x${height}`, result.wfMode || null, result.promptId || null, JSON.stringify(images.map(image => image.filename)));
    invalidateGalleryCache();
    return { images, task_id: Number(task.lastInsertRowid) };
  } catch (error) {
    for (const image of images) remove(image.url);
    throw error;
  }
}
