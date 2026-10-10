<template>
  <!-- 门户版式（数字报刊·两层生成）
       横版卡片网格：出刊即可读（文字先落库），配图由后台串行补（补一张亮一张）。
       点板块后打开独立阅读窗，按需生成正文并缓存。
       纯 CSS 排版，文字可选中、可随数据变。 -->
  <article class="portal" v-if="data">
    <!-- 刊头 -->
    <header
      class="po-head"
      :class="{ 'is-openable': openable }"
      :role="openable ? 'button' : undefined"
      :tabindex="openable ? 0 : undefined"
      :title="openable ? '查看当期报刊详情' : undefined"
      @click.stop="openable && emit('open')"
      @keydown.enter.prevent="openable && emit('open')"
      @keydown.space.prevent="openable && emit('open')"
    >
      <div class="po-head-left">
        <span class="po-brand">{{ post.outlet_name || '数字报刊' }}</span>
        <span class="po-issue">第 {{ data.issue }} 期</span>
      </div>
      <h1 class="po-title">{{ data.title }}</h1>
      <p v-if="data.lead" class="po-lead">{{ data.lead }}</p>
    </header>

    <!-- 板块卡片网格：auto-fill 吃满宽屏（旧的 880px 居中单列在 1920 屏两侧各空 520px） -->
    <div class="po-grid">
      <div
        v-for="s in data.sections"
        :key="s.key"
        class="po-card"
      >
        <div class="po-thumb" @click.stop="s.image && emit('zoom', s.image)">
          <img
            v-if="s.image"
            :src="bustUrlIfOverwritten(s.image)"
            alt=""
            loading="lazy"
            class="po-thumb-img"
            title="点击放大"
          />
          <div v-else class="po-thumb-ph">
            <span class="po-spinner"></span>
            <span class="po-thumb-ph-text">配图中…</span>
          </div>
        </div>

        <div
          class="po-card-body"
          :class="{ 'is-readable': !!bodyOf(s) }"
          :role="bodyOf(s) ? 'button' : undefined"
          :tabindex="bodyOf(s) ? 0 : undefined"
          :aria-label="bodyOf(s) ? `阅读${s.name}` : undefined"
          @click.stop="openReadySection(s)"
          @keydown.enter.self.prevent="openReadySection(s)"
          @keydown.space.self.prevent="openReadySection(s)"
        >
          <h3 class="po-card-name">{{ s.name }}</h3>
          <p class="po-card-lead">{{ s.lead }}</p>

          <media-game-button size="sm" class="po-more" @click.stop="openSection(s)">
            {{ bodyOf(s) ? '阅读全文' : '看这块' }} ↗
          </media-game-button>
        </div>
      </div>
    </div>

    <!-- 落款 -->
    <footer class="po-credits">
      <span v-if="data.credits?.reporter">记者：{{ data.credits.reporter }}</span>
      <span v-if="data.credits?.editor">编辑：{{ data.credits.editor }}</span>
    </footer>
  </article>
  <media-section-reader :visible="readerVisible" :post="post" :section="selectedSection" :body="selectedSection ? bodyOf(selectedSection) : null" :loading="!!pending[openKey]" :error="errors[openKey] || ''" @close="readerVisible = false" @retry="loadSection(selectedSection)" @zoom="emit('zoom', $event)" />
</template>

<script setup>
import { ref, computed } from 'vue'
import * as api from '../../api/index.js'
import MediaGameButton from './MediaGameButton.vue'
import MediaSectionReader from './MediaSectionReader.vue'
import { bustUrlIfOverwritten } from '../../utils/imageUrlRefresh.js'
const props = defineProps({
  post: { type: Object, required: true },
  openable: { type: Boolean, default: false },
})
const emit = defineEmits(['open', 'zoom', 'section-loaded', 'section-error'])
const data = computed(() => props.post?.payload || null)
const openKey = ref('')
const readerVisible = ref(false)
const localBodies = ref({})
const pending = ref({})
const errors = ref({})
const selectedSection = computed(() => data.value?.sections?.find(s => s.key === openKey.value) || null)
function bodyOf(s) {
  if (Array.isArray(s.body) && s.body.length) return s.body
  const local = localBodies.value[s.key]
  return Array.isArray(local) && local.length ? local : null
}
function openReadySection(s) {
  if (!bodyOf(s)) return
  openKey.value = s.key
  readerVisible.value = true
}
function openSection(s) {
  openKey.value = s.key
  readerVisible.value = true
  loadSection(s)
}
async function loadSection(s) {
  if (!s || bodyOf(s) || pending.value[s.key]) return
  const postId = props.post.id
  pending.value[s.key] = true
  errors.value[s.key] = ''
  try {
    const r = await api.generateMediaSection(postId, s.key)
    if (!Array.isArray(r?.section?.body) || !r.section.body.length) throw new Error('未获取到正文，请重试')
    localBodies.value[s.key] = r.section.body
    emit('section-loaded', { postId, section: r.section })
  } catch (err) {
    errors.value[s.key] = err?.message || '生成失败，请重试'
  } finally {
    pending.value[s.key] = false
  }
}
</script>

<style scoped>
.po-head.is-openable { cursor: pointer; }
.po-head.is-openable:active { opacity: 0.7; }
/* 报刊卡片沿用版式，表面与文字跟随网络模块主题。 */
.portal {
  --po-ink: var(--text-bright);
  --po-accent: var(--accent);
  --po-line: var(--border);
  background: var(--media-paper);
  color: var(--po-ink);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--shadow-md);
}

/* ── 刊头 ── */
.po-head {
  padding: 18px 22px 16px;
  border-bottom: 3px double var(--po-line);
}
.po-head-left { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.po-brand {
  font-size: 11.5px; font-weight: 700; letter-spacing: 1px;
  padding: 2px 9px; border-radius: 4px;
  background: var(--po-accent); color: var(--media-ink);
}
.po-issue { font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.po-title {
  margin: 0 0 6px;
  font-size: 25px; font-weight: 800; line-height: 1.3;
  letter-spacing: 0.3px;
}
.po-lead { margin: 0; font-size: 13px; line-height: 1.7; color: var(--text-secondary); }

/* ── 卡片网格：auto-fill 吃满宽屏（旧版 880px 居中单列，1920 屏两侧各空 520px）── */
.po-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: 14px;
  padding: 16px 22px;
}
.po-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--po-line);
  border-radius: 12px;
  overflow: hidden;
  background: var(--media-paper);
  transition: box-shadow 0.18s, border-color 0.18s;
}
.po-card:hover { box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08); }
/* 配图保持卡片比例，正文在独立窗口中阅读。 */
.po-thumb { position: relative; aspect-ratio: 16 / 9; background: var(--bg-sunken); overflow: hidden; }
.po-thumb-img { width: 100%; height: 100%; object-fit: cover; display: block; cursor: zoom-in; }
.po-thumb-ph {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px;
  color: var(--text-muted); font-size: 11.5px;
}
.po-spinner {
  width: 15px; height: 15px; border-radius: 50%;
  border: 2px solid var(--border); border-top-color: var(--po-accent);
  animation: po-spin 0.7s linear infinite;
  flex-shrink: 0;
}
@keyframes po-spin { to { transform: rotate(360deg); } }

/* ── 卡片文字 ── */
.po-card-body { display: flex; flex-direction: column; gap: 7px; padding: 12px 14px 12px; flex: 1; }
.po-card-body.is-readable { cursor: pointer; }
.po-card-name { margin: 0; font-size: 15px; font-weight: 700; }
.po-card-lead { margin: 0; font-size: 12.5px; line-height: 1.75; color: var(--text-secondary); }

.po-more { align-self: flex-end; margin-top: auto; }

/* ── 落款 ── */
.po-credits {
  display: flex; justify-content: flex-end; gap: 18px;
  padding: 10px 22px;
  border-top: 1px solid var(--po-line);
  background: var(--bg-sunken);
  font-size: 11.5px; color: var(--text-secondary);
}

/* ── 响应式 ── */
@media (max-width: 767px) {
  .po-head { padding: 14px 16px 12px; }
  .po-title { font-size: 20px; }
  .po-grid { grid-template-columns: 1fr; gap: 12px; padding: 12px 16px; }
  .po-credits { padding: 8px 16px; }
}
</style>
