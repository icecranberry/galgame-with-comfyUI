/**
 * 将朋友圈评论还原为「原始楼层 + 楼中楼」。
 * 后端按写入顺序返回；这里不改变评论内容，只改变展示组织方式。
 */
export function groupMomentComments(comments = []) {
  const list = (comments || []).filter(Boolean)
  const byId = new Map(list.map(comment => [comment.id, comment]))

  const resolveRootId = (comment, depth = 0) => {
    if (!comment || depth > 16) return comment?.id ?? null
    if (comment.thread_root_id != null && byId.has(comment.thread_root_id)) {
      return comment.thread_root_id
    }
    if (comment.reply_to_comment_id != null && byId.has(comment.reply_to_comment_id)) {
      return resolveRootId(byId.get(comment.reply_to_comment_id), depth + 1)
    }
    return comment.id
  }

  const groups = []
  const groupByRootId = new Map()
  for (const comment of list) {
    const rootId = resolveRootId(comment)
    if (groupByRootId.has(rootId)) continue
    const root = byId.get(rootId) || comment
    const group = { comment: root, replies: [] }
    groupByRootId.set(rootId, group)
    groups.push(group)
  }

  for (const comment of list) {
    const rootId = resolveRootId(comment)
    const group = groupByRootId.get(rootId)
    if (group && comment.id !== group.comment.id) group.replies.push(comment)
  }

  return groups
}
