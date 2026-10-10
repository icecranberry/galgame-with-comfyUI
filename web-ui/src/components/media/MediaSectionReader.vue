<template>
  <linshe-modal :visible="visible" title="报刊 · 板块阅读" variant="comic" wide :transition-ms="300" @close="emit('close')">
    <template #close="{ close }">
      <media-game-button variant="icon" aria-label="关闭板块阅读" @click="close">×</media-game-button>
    </template>
    <article v-if="section" class="section-reader">
      <header class="section-heading">
        <div class="section-source">{{ post.outlet_name || '数字报刊' }} / 第 {{ post.payload?.issue }} 期</div>
        <h1>{{ section.name }}</h1>
        <p>{{ section.lead }}</p>
      </header>
      <div class="section-content">
        <div v-if="section.image" class="section-image" role="button" tabindex="0" aria-label="放大板块配图" @click="emit('zoom', section.image)" @keydown.enter.prevent="emit('zoom', section.image)" @keydown.space.prevent="emit('zoom', section.image)">
          <img :src="bustUrlIfOverwritten(section.image)" :alt="section.name" />
          <span>配图 / 点击放大 ↗</span>
        </div>
        <Transition name="section-fade" mode="out-in">
          <div v-if="loading" key="loading" class="section-status" role="status">
            <span class="cel-spin">✦</span><strong>编辑正在整理这篇报道…</strong><p>完成后会自动显示，关闭窗口不会中断生成。</p>
          </div>
          <div v-else-if="error" key="error" class="section-status" role="alert">
            <strong>这篇报道还没准备好</strong><p>{{ error }}</p>
            <media-game-button size="sm" @click="emit('retry')">重新获取 ↻</media-game-button>
          </div>
          <div v-else class="po-blocks">
            <template v-for="(b, i) in (body || [])" :key="i">
              <p v-if="b.type === 'p'" class="po-p">{{ b.text }}</p>

              <div v-else-if="b.type === 'qa'" class="po-qa">
                <p class="po-qa-q">
                  <span v-if="b.asker" class="po-qa-asker">@{{ b.asker }}</span>{{ b.q }}
                </p>
                <div v-for="(a, j) in b.answers" :key="j" class="po-qa-a">
                  <span class="po-qa-speaker">{{ a.speaker }}</span>
                  <span class="po-qa-text">{{ a.text }}</span>
                </div>
              </div>

              <div v-else-if="b.type === 'rank'" class="po-rank">
                <p v-if="b.title" class="po-rank-title">{{ b.title }}</p>
                <p v-if="b.notice" class="po-rank-notice">{{ b.notice }}</p>
                <div v-for="(r, j) in b.rows" :key="j" class="po-rank-row">
                  <span class="po-rank-pos">{{ r.rank }}</span>
                  <span class="po-rank-mask">{{ r.mask }}</span>
                  <span class="po-rank-change">{{ r.change }}</span>
                  <span class="po-rank-bearer">{{ r.bearer }}</span>
                </div>
              </div>

              <div v-else-if="b.type === 'replies'" class="po-replies">
                <p class="po-replies-head">
                  <span v-if="b.title">{{ b.title }}</span>
                  <span v-if="b.stat" class="po-replies-stat">{{ b.stat }}</span>
                </p>
                <p v-for="(r, j) in b.replies" :key="j" class="po-reply">
                  <span class="po-reply-author">{{ r.author }}</span>{{ r.text }}
                </p>
              </div>

              <div v-else-if="b.type === 'caption'" class="po-caption">
                <p v-for="(l, j) in b.lines" :key="j">{{ l }}</p>
              </div>
            </template>
          </div>
        </Transition>
        <footer class="section-credits"><span v-if="post.payload?.credits?.reporter">记者 / {{ post.payload.credits.reporter }}</span><span v-if="post.payload?.credits?.editor">编辑 / {{ post.payload.credits.editor }}</span></footer>
      </div>
    </article>
    <template #footer><media-game-button size="sm" variant="primary" @click="emit('close')">返回本期 ↵</media-game-button></template>
  </linshe-modal>
</template>
<script setup>
import LinsheModal from '../ui/LinsheModal.vue'
import MediaGameButton from './MediaGameButton.vue'
import { bustUrlIfOverwritten } from '../../utils/imageUrlRefresh.js'
defineProps({
  visible: Boolean,
  post: { type: Object, required: true },
  section: { type: Object, default: null },
  body: { type: Array, default: null },
  loading: Boolean,
  error: { type: String, default: '' }
})
const emit = defineEmits(['close', 'retry', 'zoom'])
</script>
<style scoped>
.section-reader { color: var(--text-primary); overflow-wrap: anywhere; }
.section-heading { background: var(--accent); color: var(--media-ink); border-bottom: 3px solid var(--media-ink); padding: 22px 32px; }
.section-source { font-size: 12px; font-weight: 800; letter-spacing: .08em; }
.section-heading h1 { font-size: clamp(24px, 4vw, 36px); line-height: 1.3; margin: 16px 0; }
.section-heading p { margin: 0; line-height: 1.8; }
.section-content { padding: 28px 32px; background: var(--media-paper); }
.section-image { cursor: zoom-in; margin-bottom: 28px; }
.section-image img { display: block; width: 100%; max-height: 240px; object-fit: contain; border: 2px solid var(--media-rule); }
.section-image span { display: block; margin-top: 8px; color: var(--text-muted); font-size: 12px; }
.section-status { padding: 32px 0; text-align: center; line-height: 1.8; }
.section-status .cel-spin { display: inline-block; margin-right: 12px; }
.section-status p { color: var(--text-secondary); }
.po-blocks { display: flex; flex-direction: column; gap: 22px; font-size: 15px; line-height: 1.9; }
.po-blocks p { margin: 0 0 10px; white-space: pre-wrap; }
.po-qa-q { border-left: 4px solid var(--accent); padding-left: 14px; font-weight: 800; }
.po-qa-a, .po-reply { padding: 12px 16px; background: var(--bg-sunken); border: 1px solid var(--border); }
.po-qa-speaker, .po-reply-author, .po-qa-asker { font-weight: 800; margin-right: 10px; color: var(--text-bright); }
.po-rank-title, .po-replies-head { font-weight: 800; }
.po-rank-notice, .po-replies-stat { color: var(--text-secondary); font-size: 13px; }
.po-replies-stat { margin-left: 12px; }
.po-rank-row { display: grid; grid-template-columns: minmax(4em, max-content) minmax(0, 1fr) 56px minmax(0, 1fr); gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--media-rule); }
.po-rank-pos { font-weight: 900; white-space: nowrap; overflow-wrap: normal; }
.po-rank-change { color: var(--accent); }
.section-credits { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 28px; padding-top: 16px; border-top: 2px solid var(--media-rule); color: var(--text-secondary); font-size: 12px; }
.section-fade-enter-active, .section-fade-leave-active { transition: opacity .3s ease, transform .3s ease; }
.section-fade-enter-from, .section-fade-leave-to { opacity: 0; transform: translateY(6px); }
@media (max-width: 767px) { .section-heading, .section-content { padding: 20px 16px; } .po-rank-row { grid-template-columns: minmax(4em, max-content) minmax(0, 1fr) 42px minmax(0, 1fr); gap: 6px; font-size: 13px; } }
</style>
