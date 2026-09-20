/**
 * 用户朋友圈自动配图需求的存储标记。
 * 需求隐藏在 content 里，展示/聊天语境剥离，评论生成时还原成参考说明。
 */
export const MOMENT_IMAGE_REQUEST_OPEN = '[[imgreq]]';
export const MOMENT_IMAGE_REQUEST_CLOSE = '[[/imgreq]]';

const MOMENT_IMAGE_REQUEST_RE = /\[\[imgreq\]\]([\s\S]*?)(?:\[\[\/imgreq\]\]|$)/;
const MOMENT_IMAGE_REQUEST_ALL_RE = /\[\[imgreq\]\][\s\S]*?(?:\[\[\/imgreq\]\]|$)/g;

export function extractMomentImageRequest(content) {
  return String(content || '').match(MOMENT_IMAGE_REQUEST_RE)?.[1]?.trim() || '';
}

export function stripMomentImageRequest(content) {
  return String(content || '').replace(MOMENT_IMAGE_REQUEST_ALL_RE, '').trim();
}

export function appendMomentImageRequest(content, request) {
  const body = stripMomentImageRequest(content);
  const imageRequest = String(request || '').trim();
  if (!imageRequest) return body;
  return [body, `${MOMENT_IMAGE_REQUEST_OPEN}${imageRequest}${MOMENT_IMAGE_REQUEST_CLOSE}`]
    .filter(Boolean)
    .join('\n');
}
