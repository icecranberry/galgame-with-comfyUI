/**
 * 私聊最近朋友圈语料。
 *
 * 角色自己的动态保持原有口径；用户动态只有在其评论区出现过的角色
 * 的私聊中注入，且发帖时间不超过两天，避免旧帖长期污染对话人格。
 */

export const USER_MOMENT_CONTEXT_DAYS = 2;
export const GROUP_USER_MOMENT_CONTEXT_DAYS = 1;

function formatUserMomentLine(index, moment, comments, characterName, userName) {
  const content = moment.content?.trim() || '';
  const prompt = moment.prompt?.trim() || '';
  const body = prompt ? `${content}（配图：${prompt}）` : (content || '（图片动态）');
  let line = `${index + 1}. [${moment.created_at}] ${body}`;
  if (comments.length > 0) {
    const replyLines = comments.map((comment) => {
      const name = comment.author_type === 'character' ? characterName : userName;
      return `  ${name}：${comment.content}`;
    }).join('\n');
    line += `\n  双方回复：\n${replyLines}`;
  }
  return line;
}

/**
 * 构建 `<recent_moments>` 动态块；没有可用语料时返回 null。
 * @param {import('better-sqlite3').Database} db
 */
export function buildPrivateMomentContext(db, {
  characterId,
  characterName,
  userName,
  ownLimit = 2,
  userMomentDays = USER_MOMENT_CONTEXT_DAYS,
} = {}) {
  const ownMoments = db.prepare(`
    SELECT id, content, created_at FROM moment_posts
    WHERE character_id = ? AND status = 'done'
    ORDER BY created_at DESC LIMIT ?
  `).all(characterId, ownLimit);

  const userMoments = db.prepare(`
    SELECT DISTINCT mp.id, mp.content, mp.prompt, mp.created_at
    FROM moment_posts mp
    JOIN moment_comments mc ON mc.post_id = mp.id
    WHERE mp.character_id IS NULL AND mp.npc_id IS NULL
      AND mp.status = 'done'
      AND mp.created_at >= datetime('now', '-' || ? || ' days')
      AND mc.author_type = 'character' AND mc.author_id = ?
    ORDER BY mp.created_at DESC
  `).all(userMomentDays, characterId);

  if (ownMoments.length === 0 && userMoments.length === 0) return null;

  const sections = [];
  if (ownMoments.length > 0) {
    const lines = ownMoments.map((moment, index) => {
      let line = `${index + 1}. [${moment.created_at}] ${moment.content}`;
      const hasUserComment = db.prepare(`
        SELECT COUNT(*) AS cnt FROM moment_comments
        WHERE post_id = ? AND author_type = 'user'
      `).get(moment.id);
      if (hasUserComment?.cnt > 0) {
        const comments = db.prepare(`
          SELECT mc.author_type, mc.content,
            CASE WHEN mc.author_type = 'character' THEN c.display_name ELSE ? END AS display_name
          FROM moment_comments mc
          LEFT JOIN characters c ON c.id = mc.author_id AND mc.author_type = 'character'
          WHERE mc.post_id = ?
          ORDER BY mc.created_at ASC
        `).all(userName, moment.id);
        if (comments.length > 0) {
          const commentLines = comments.map((comment) => {
            const name = comment.author_type === 'character' ? comment.display_name : userName;
            return `  ${name}：${comment.content}`;
          }).join('\n');
          line += `\n  评论区：\n${commentLines}`;
        }
      }
      return line;
    });
    sections.push(`${characterName}最近发了朋友圈：\n${lines.join('\n')}`);
  }
  if (userMoments.length > 0) {
    const lines = userMoments.map((moment, index) => {
      const relatedComments = db.prepare(`
        SELECT mc.author_type, mc.content
        FROM moment_comments mc
        WHERE mc.post_id = ?
          AND (mc.author_type = 'user' OR (mc.author_type = 'character' AND mc.author_id = ?))
        ORDER BY mc.created_at ASC, mc.id ASC
      `).all(moment.id, characterId);
      return formatUserMomentLine(index, moment, relatedComments, characterName, userName);
    });
    sections.push(`${userName}最近发的朋友圈（你评论过）：\n${lines.join('\n')}`);
  }

  return `<recent_moments>\n${sections.join('\n\n')}\n你可以把这些当做聊天话题，自然地在对话中提到。\n</recent_moments>`;
}

/**
 * 群聊共用的用户朋友圈：任一群成员评论过才可见，只保留正文，不注入评论区。
 * @param {import('better-sqlite3').Database} db
 */
export function buildGroupUserMomentContext(db, {
  memberIds = [],
  userName = '用户',
  userMomentDays = GROUP_USER_MOMENT_CONTEXT_DAYS,
} = {}) {
  if (memberIds.length === 0) return { posts: [], lines: [] };
  const placeholders = memberIds.map(() => '?').join(', ');
  const posts = db.prepare(`
    SELECT DISTINCT mp.id, mp.content, mp.created_at
    FROM moment_posts mp
    WHERE mp.character_id IS NULL AND mp.npc_id IS NULL
      AND mp.status = 'done'
      AND mp.created_at >= datetime('now', '-' || ? || ' days')
      AND EXISTS (
        SELECT 1 FROM moment_comments mc
        WHERE mc.post_id = mp.id
          AND mc.author_type = 'character' AND mc.author_id IN (${placeholders})
      )
    ORDER BY mp.created_at DESC
  `).all(userMomentDays, ...memberIds);
  const lines = posts.map((post) => {
    const content = post.content?.trim() || '（图片动态）';
    return `「${userName}」发了朋友圈：「${content.slice(0, 100)}」`;
  });
  return { posts, lines };
}
