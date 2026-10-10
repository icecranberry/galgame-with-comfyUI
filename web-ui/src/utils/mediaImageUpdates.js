/** Apply image events to the actual image slot without replacing the cover with a detail image. */
export function applyMediaImageUpdate(post, event) {
  if (!post || post.id !== event.postId) return
  if (event.sectionKey != null) {
    const section = post.payload?.sections?.find(s => s.key === event.sectionKey)
    if (section) section.image = event.image
  } else if (event.panel) {
    const panel = post.payload?.panels?.[event.panelIndex]
    if (panel) panel.image = event.image
  } else {
    post.image = event.image
    post.image_status = 'done'
    post.image_error = null
  }
}

export function applyMediaPortalReady(post, { postId }) {
  if (!post || post.id !== postId) return
  post.image_status = 'done'
  post.image_error = null
  if (!post.image) post.image = post.payload?.sections?.find(s => s.image)?.image || null
}
