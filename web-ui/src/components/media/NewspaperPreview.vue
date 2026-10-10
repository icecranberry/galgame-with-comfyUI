<template>
  <article class="paper-preview" :aria-busy="loading && !paper">
    <header class="paper-masthead">
      <div>
        <span class="paper-kicker">LIN SHE DAILY / 每日刊</span>
        <h2>{{ paper?.name || '邻舍日报' }}</h2>
      </div>
      <div class="paper-edition">
        <span v-if="paper" class="edition-stamp">
          第 {{ paper.edition }} 期
        </span>
        <span v-else class="edition-stamp">
          {{ loading ? '收讯中' : '等待出刊' }}
        </span>
        <time v-if="paper" :datetime="paper.publish_date">
          {{ paper.publish_date }}
        </time>
        <span v-if="unread" class="paper-unread">● 今日新报 · 未读</span>
      </div>
    </header>
    <div v-if="loading && !paper" class="paper-loading" role="status">
      正在接收今日报纸…
    </div>
    <div
      v-else
      class="paper-feature"
      :class="{ 'has-image': !!lead?.image && !imageFailed }"
    >
      <div class="paper-copy">
        <span class="headline-label">
          {{ paper ? '本期头条 / HEADLINE' : '下一期 / COMING SOON' }}
        </span>
        <h3>
          {{
            lead?.title ||
            (paper ? '今天的故事，已经上报。' : '新的一天，好戏待开场。')
          }}
        </h3>
        <p v-if="lead?.content" class="headline-excerpt">{{ lead.content }}</p>
        <p v-else class="headline-excerpt">
          {{
            paper
              ? '翻开整张报纸，看看今天的邻里新闻和人物故事。'
              : '今日报纸尚未印出。先翻翻往期，故事不会散场。'
          }}
        </p>
        <div v-if="author && paper?.character_event" class="headline-author">
          <span>人物特稿</span>
          {{ author }}
        </div>
        <media-game-button @click="emit('open')">
          {{ paper ? '展开整张报纸' : '打开报纸 · 翻阅往期' }}
          <span aria-hidden="true">↗</span>
        </media-game-button>
      </div>
      <div
        v-if="lead?.image && !imageFailed"
        class="paper-image"
        role="button"
        tabindex="0"
        aria-label="打开整张报纸"
        @click="emit('open')"
        @keydown.enter.prevent="emit('open')"
        @keydown.space.prevent="emit('open')"
      >
        <img
          :src="bustUrlIfOverwritten(lead.image)"
          :alt="lead.title"
          loading="lazy"
          @error="imageFailed = true"
        />
        <span class="image-stamp" aria-hidden="true">
          本期焦点
          <span>↗</span>
        </span>
      </div>
      <div v-else class="paper-type-art" aria-hidden="true">
        <span>EXTRA!</span>
        <b>{{ paper ? '头条' : '待刊' }}</b>
        <span>邻里有声 · 每日有戏</span>
      </div>
    </div>
    <footer class="paper-foot">
      <span>世界的消息，邻里的声音。</span>
      <span>
        整版阅读 / 往期回看
        <b aria-hidden="true">✦</b>
      </span>
    </footer>
  </article>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import MediaGameButton from './MediaGameButton.vue'
import { bustUrlIfOverwritten } from '../../utils/imageUrlRefresh.js'

const props = defineProps({
  paper: { type: Object, default: null },
  unread: Boolean,
  loading: Boolean
})
const emit = defineEmits(['open'])
const imageFailed = ref(false)
const lead = computed(() => {
  const paper = props.paper
  if (!paper) return null
  if (paper.character_event?.title) return paper.character_event
  const item = paper.items?.find((item) => item.title)
  if (item) return item
  if (paper.world_state)
    return {
      title: paper.world_state.name,
      content: paper.world_state.news || paper.world_state.description,
      image: paper.world_state.image
    }
  return null
})
const author = computed(
  () =>
    props.paper?.character?.display_name ||
    props.paper?.character_event?.character_name ||
    ''
)
watch(
  () => lead.value?.image,
  () => {
    imageFailed.value = false
  }
)
</script>

<style scoped>
.paper-preview {
  margin: 28px 20px 40px;
  border: 3px solid var(--media-rule);
  box-shadow: 7px 7px 0 var(--media-ink);
  background: var(--media-paper);
  color: var(--text-primary);
}
.paper-masthead {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  padding: 22px 30px;
  background: var(--media-ink);
  color: var(--media-light);
  border-bottom: 5px solid var(--accent);
}
.paper-kicker {
  font: 11px monospace;
  letter-spacing: 0.15em;
}
.paper-masthead h2 {
  margin: 5px 0 0;
  font-size: clamp(28px, 4vw, 44px);
  font-weight: 950;
  letter-spacing: 0.08em;
  color: var(--media-light);
}
.paper-edition {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  font: 12px monospace;
  flex-shrink: 0;
}
.edition-stamp {
  padding: 5px 12px;
  background: var(--accent);
  border: 2px solid var(--media-light);
  color: var(--media-ink);
  font-weight: 900;
  transform: rotate(4deg);
}
.paper-unread {
  color: var(--accent-light);
  font-size: 11px;
}
.paper-feature {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 0.7fr);
  min-height: 330px;
}
.paper-feature.has-image {
  grid-template-columns: minmax(0, 1fr) minmax(0, min(50%, 800px));
}
.paper-copy {
  padding: clamp(24px, 3vw, 42px);
  align-self: center;
  min-width: 0;
}
.headline-label {
  display: inline-block;
  padding: 6px 12px;
  font: 800 12px monospace;
  background: var(--accent);
  color: var(--media-ink);
  border: 2px solid var(--media-ink);
  box-shadow: 3px 3px 0 var(--media-ink);
  transform: rotate(-2deg);
}
.paper-copy h3 {
  color: var(--text-bright);
  font-size: clamp(26px, 3vw, 40px);
  font-weight: 950;
  line-height: 1.35;
  letter-spacing: -0.03em;
  margin: 22px 0 16px;
  overflow-wrap: anywhere;
  text-wrap: pretty;
}
.headline-excerpt {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 15px;
  line-height: 1.9;
  margin: 0 0 20px;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.headline-author {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 22px;
  font-size: 13px;
  font-weight: 700;
}
.headline-author span {
  font-size: 11px;
  font-weight: 400;
  padding-right: 10px;
  border-right: 2px solid var(--media-rule);
}
.paper-image {
  position: relative;
  border-left: 3px solid var(--media-rule);
  cursor: pointer;
  background: var(--bg-sunken);
  min-height: 330px;
  overflow: hidden;
  text-align: center;
}
.paper-image img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.image-stamp {
  position: absolute;
  right: 18px;
  bottom: 22px;
  display: flex;
  align-items: center;
  gap: 18px;
  background: var(--media-light);
  color: var(--media-ink);
  border: 3px solid var(--media-ink);
  box-shadow: 4px 4px 0 var(--media-ink);
  padding: 10px 16px;
  font-size: 20px;
  font-weight: 900;
  transform: rotate(-5deg);
}
.image-stamp > span {
  font-size: 28px;
}
.paper-type-art {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 16px;
  margin: 28px;
  border: 3px solid var(--media-rule);
  background: var(--accent);
  color: var(--media-ink);
  transform: rotate(3deg);
  box-shadow: 6px 6px 0 var(--media-ink);
}
.paper-type-art b {
  font-size: clamp(54px, 7vw, 96px);
  font-weight: 950;
  font-style: italic;
  line-height: 1.1;
}
.paper-type-art > span {
  font: 800 12px monospace;
  letter-spacing: 0.1em;
}
.paper-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 14px 30px;
  border-top: 2px solid var(--media-rule);
  font-size: 12px;
  font-weight: 650;
}
.paper-foot b {
  margin-left: 10px;
  color: var(--accent);
}
.paper-loading {
  padding: 72px 24px;
  text-align: center;
  font-weight: 800;
}
@container media-shell (max-width: 720px) {
  .paper-preview {
    margin: 20px 14px 32px;
    box-shadow: 4px 4px 0 var(--media-ink);
  }
  .paper-masthead {
    padding: 20px;
    gap: 12px;
  }
  .paper-kicker {
    font-size: 9px;
    letter-spacing: 0.03em;
  }
  .paper-masthead h2 {
    font-size: 28px;
  }
  .paper-feature,
  .paper-feature.has-image {
    grid-template-columns: minmax(0, 1fr);
  }
  .paper-copy {
    padding: 24px;
  }
  .paper-image {
    border-left: 0;
    border-top: 3px solid var(--media-rule);
    min-height: 0;
    aspect-ratio: 16 / 10;
  }
  .paper-type-art {
    display: none;
  }
  .paper-foot {
    padding: 12px 20px;
    font-size: 11px;
  }
  .paper-edition {
    font-size: 10px;
  }
}
</style>
