/**
 * 日记本的版面：把正文段落与配图交错排进同一条流里（外层用 CSS `columns: 2` 均分两列）。
 *
 * 目标是「文字和图片混在一起均匀分布两列」——不是左页全文字、右页全图片。
 * 图片按 floor((段号+1) * 图片数 / 段数) 的节奏均匀落到段落之间，
 * 交给浏览器的多栏平衡决定最终落在左栏还是右栏。
 */

/** 正文按空行切段（日记正文由 LLM 用 \n\n 分段），去掉空段 */
export function splitDiaryParagraphs(content) {
  return String(content || '')
    .split(/\n{2,}/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * 交错编排成 [{ type:'text', text }, { type:'photo', url, slot }] 的块序列。
 * @param {string} content    日记正文
 * @param {string[]} images   配图 URL（缺位留空字符串，占位卡仍会排版出来）
 * @returns {Array<object>}
 */
export function buildDiaryFlow(content, images = []) {
  const paragraphs = splitDiaryParagraphs(content);
  const photos = (Array.isArray(images) ? images : []).map((url, slot) => ({ url, slot }));

  if (paragraphs.length === 0) return photos.map(p => ({ type: 'photo', ...p }));

  const blocks = [];
  let used = 0;
  for (let p = 0; p < paragraphs.length; p += 1) {
    blocks.push({ type: 'text', text: paragraphs[p] });
    // 写完第 p 段后，图片累计应放出这么多张（末段放完剩下的）
    const target = Math.floor(((p + 1) * photos.length) / paragraphs.length);
    while (used < target) {
      blocks.push({ type: 'photo', ...photos[used] });
      used += 1;
    }
  }
  while (used < photos.length) {
    blocks.push({ type: 'photo', ...photos[used] });
    used += 1;
  }
  return blocks;
}
