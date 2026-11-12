import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { isPairPose } from '../photoStudioWorkflow.js';

export function studioPhotoRequestId(effectKey) {
  if (!effectKey) throw new Error('拍摄请求缺少操作编号');
  return `godstudio_${createHash('sha256').update(effectKey).digest('hex').slice(0, 40)}`;
}

export function buildStudioPhotoBody(args, ctx) {
  const actor = (id, special, required) => {
    if (special !== undefined && special !== 'angel') throw new Error('特殊入镜角色只能是天使');
    if (id !== undefined && special !== undefined) throw new Error('同一位置只能指定居民编号或天使之一');
    if (required && id === undefined && special === undefined) throw new Error('请指定主角的居民编号或天使身份');
    return special === 'angel' ? 'angel' : id;
  };
  const characterId = actor(args.character_id, args.special_character, true);
  const secondCharacterId = actor(args.second_character_id, args.second_special_character, false);
  if (secondCharacterId === characterId) throw new Error('双人姿势需要选择两位不同角色');
  return { id: studioPhotoRequestId(ctx.effectKey), characterId, poseId: args.pose_id ?? 'random', backgroundId: args.background_id ?? 'random', strictParticipants: true,
    ...(secondCharacterId !== undefined ? { secondCharacterId } : {}),
    ...(args.outfit_scene !== undefined ? { outfitScene: args.outfit_scene } : {}), ...(args.second_outfit_scene !== undefined ? { secondOutfitScene: args.second_outfit_scene } : {}),
    ...(args.instruction !== undefined ? { instruction: args.instruction } : {}), ...(args.polish_prompt !== undefined ? { polishPrompt: args.polish_prompt } : {}),
    ...(args.width !== undefined ? { width: args.width } : {}), ...(args.height !== undefined ? { height: args.height } : {}),
  };
}

export function studioPhotoResult(data) {
  const job = data?.job;
  if (!job || !/^[a-zA-Z0-9_-]{8,100}$/.test(job.id || '')) throw new Error('照相馆未返回有效的拍摄记录');
  const result = { job_id: job.id, task_id: job.image_task_id, status: job.status, stage: job.stage,
    character_id: job.character_id, second_character_id: job.character2_id,
    ...(job.character_kind === 'angel' ? { special_character: 'angel' } : {}),
    ...(job.character2_kind === 'angel' ? { second_special_character: 'angel' } : {}),
    pose_id: job.pose_id, pose_name: job.pose_name, background_id: job.background_id, width: job.width, height: job.height };
  if (job.status === 'failed') throw new Error(job.error || '照相馆拍摄失败');
  if (!['running', 'done'].includes(job.status)) throw new Error('照相馆返回了无效的拍摄状态');
  if (job.status !== 'done') return { ...result, success: false, images: [] };
  if (!/^\/images\/photo_studio\/[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp|avif)$/.test(job.output_url || '')) throw new Error('照相馆成片地址无效');
  return { ...result, success: true, images: [{ url: job.output_url, width: job.width, height: job.height }] };
}

// 等待原照相馆任务，不重新生图、不复制图片；停止等待不撤销已经受理的拍摄。
export async function executeStudioPhoto(request, ctx, api, { timeoutMs = 480000, intervalMs = 1000, wait = delay, now = Date.now } = {}) {
  ctx.signal?.throwIfAborted();
  if (request.body.poseId !== undefined && request.body.poseId !== 'random') {
    const catalog = await api({ method: 'GET', path: `/api/photo-studio/catalog?id=${encodeURIComponent(request.body.poseId)}&limit=1` }, ctx);
    const pose = catalog.data?.poses?.find(item => item.id === request.body.poseId);
    if (!pose?.posePrompt) throw new Error('请选择姿势库中已经校准的真实姿势');
    const pair = isPairPose(pose);
    if (pair !== (request.body.secondCharacterId !== undefined)) throw new Error(pair ? '双人姿势必须指定搭档' : '单人姿势不能加入第二位角色，请改选双人姿势');
  }
  ctx.signal?.throwIfAborted();
  let response = await api(request, ctx);
  const jobId = request.body.id;
  const deadline = now() + timeoutMs;
  while (true) {
    if (response.data?.job?.id !== jobId) throw new Error('照相馆返回了不匹配的拍摄记录');
    const data = studioPhotoResult(response.data);
    if (data.success) return { status: 200, data };
    const remaining = deadline - now();
    if (remaining <= 0) return { status: 202, data };
    try {
      await wait(Math.min(intervalMs, remaining), undefined, { signal: ctx.signal });
      ctx.signal?.throwIfAborted();
      response = await api({ method: 'GET', path: `/api/photo-studio/jobs/${encodeURIComponent(jobId)}` }, ctx);
    } catch (error) {
      if (ctx.signal?.aborted) {
        throw Object.assign(new Error(`已停止等待，拍摄 ${jobId} 已受理，可在照相馆查询。`, { cause: error }), { name: 'AbortError', uncertain: true });
      }
      // 查询断线不能把已经受理的生成误报为失败，更不能触发重新拍摄。
      return { status: 202, data: { ...data, query_error: error.message } };
    }
  }
}
