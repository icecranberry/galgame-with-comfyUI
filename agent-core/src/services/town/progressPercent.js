/**
 * 把图片生成的进度回调换算成 0~100 的整数百分比。
 *
 * generateImageRaw / comfyClient 的 onProgress 回调收到的是**对象**
 * （{ stage, phase, progress: 0~1, step, max, promptId }），不是数字；
 * 直接把它当百分比广播出去，前端 Math.max(数字, 对象) 就会算出 NaN%。
 * 这里统一按 0~1 的小数处理并夹住范围；没有进度的阶段返回 null（不广播）。
 */
export function percentFromProgress(p) {
  const raw = typeof p === 'number' ? p : p?.progress;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.round(Math.max(0, Math.min(1, raw)) * 100);
}
