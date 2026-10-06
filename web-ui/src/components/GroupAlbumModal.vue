<template>
  <LinsheModal v-model="open" title="群相册" wide>
    <template #header-extra>
      <span class="ga-total">{{ filteredImages.length }} 张</span>
    </template>

    <!-- 筛选条：默认看本群全部图片，可按发言人收窄 -->
    <div v-if="speakerFilters.length > 1" class="ga-filters">
      <linshe-button
        v-for="f in speakerFilters"
        :key="f.key"
        variant="chip"
        :active="activeSpeaker === f.key"
        @click="activeSpeaker = f.key"
      >
        {{ f.label }}
        <span class="ga-filter-count">{{ f.count }}</span>
      </linshe-button>
    </div>

    <div class="ga-scroll">
      <template v-if="dayGroups.length > 0">
        <div v-for="day in dayGroups" :key="day.key" class="ga-group">
          <div class="ga-group-head">
            <span class="ga-group-label">{{ day.label }}</span>
            <span class="ga-group-count">{{ day.items.length }} 张</span>
          </div>
          <div class="ga-grid stagger">
            <div
              v-for="img in day.items"
              :key="img.base"
              class="ga-item sheen"
              :title="imageTooltip(img)"
              role="button"
              tabindex="0"
              @keydown.enter.prevent="openPreview(img.base)"
              @keydown.space.prevent="openPreview(img.base)"
              @click="openPreview(img.base)"
            >
              <img class="ga-img" :src="bustUrlIfOverwritten(img.url)" loading="lazy" decoding="async" alt="" />
              <!-- 「全部」视图里标出发图的人，筛过之后就不再重复 -->
              <span v-if="activeSpeaker === ALL_SPEAKERS" class="ga-owner">
                <img v-if="img.speakerAvatar" :src="img.speakerAvatar" alt="" />
                <span v-else>{{ img.speakerName.charAt(0) }}</span>
              </span>
            </div>
          </div>
        </div>
      </template>

      <div v-else class="empty ga-empty">
        <span>{{ images.length === 0 ? '这个群里还没有图片' : '这位成员还没有发过图片' }}</span>
        <span class="ga-empty-hint">群成员发出的图片会自动收进群相册</span>
      </div>
    </div>

    <!-- 图片放大：Teleport 到 body（弹窗面板带 backdrop-filter 会创建包含块，
         不 Teleport 时 fixed 的灯箱会被关在弹窗里），层级覆盖与日报弹窗同款 -->
    <Teleport to="body">
      <div style="--vel-z-index: 11000">
        <ImageLightbox
          :visible="lightboxVisible"
          :imgs="lightboxImgs"
          :index="lightboxIndex"
          @hide="lightboxVisible = false"
          @deleted="onDeleted"
        />
      </div>
    </Teleport>
  </LinsheModal>
</template>

<script setup>
// 群相册：把当前群聊消息里出现过的图片筛出来集中浏览（入口在群设置抽屉）。
// 数据来自群聊 store 已加载的全部历史消息，无需额外请求；删除图片交回父级同步群消息。
import { ref, computed, watch } from 'vue'
import LinsheModal from './ui/LinsheModal.vue'
import LinsheButton from './ui/LinsheButton.vue'
import ImageLightbox from './ImageLightbox.vue'
import { bustUrlIfOverwritten } from '../utils/imageUrlRefresh.js'
import {
  ALL_SPEAKERS,
  collectGroupImages,
  buildSpeakerFilters,
  filterImagesBySpeaker,
  groupImagesByDay,
  imageTooltip,
} from '../utils/groupAlbum.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  group: { type: Object, default: null },
  messages: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue', 'deleted'])

const open = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v),
})

const activeSpeaker = ref(ALL_SPEAKERS)
const lightboxVisible = ref(false)
const lightboxIndex = ref(0)

// 只在弹窗打开时收集，避免关闭状态下长会话反复重算
const images = computed(() => (props.modelValue ? collectGroupImages(props.messages, props.group) : []))
const speakerFilters = computed(() => buildSpeakerFilters(images.value, props.group))
const filteredImages = computed(() => filterImagesBySpeaker(images.value, activeSpeaker.value))
const dayGroups = computed(() => groupImagesByDay(filteredImages.value))
const lightboxImgs = computed(() => filteredImages.value.map(img => bustUrlIfOverwritten(img.url)))

// 换群或图片被删后，筛选键可能已不存在，回落到「全部」
watch(speakerFilters, (list) => {
  if (!list.some(f => f.key === activeSpeaker.value)) activeSpeaker.value = ALL_SPEAKERS
})
watch(() => props.modelValue, (v) => {
  if (!v) lightboxVisible.value = false
})

function openPreview(base) {
  const index = filteredImages.value.findIndex(img => img.base === base)
  if (index < 0) return
  lightboxIndex.value = index
  lightboxVisible.value = true
}

// 灯箱删除后交给父级从群消息里摘掉，本组件的列表随之更新
function onDeleted(url) {
  lightboxVisible.value = false
  emit('deleted', url)
}
</script>

<style scoped>
.ga-total {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}

/*  发言人筛选条  */
.ga-filters {
  padding-bottom: 12px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--border);
}
.ga-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ga-filter-count {
  margin-left: 6px;
  font-size: 11px;
  opacity: 0.7;
}

/*  滚动区  */
.ga-scroll {
  max-height: min(58vh, 520px);
  overflow-y: auto;
  overscroll-behavior: contain;
}

/*  日期分组  */
.ga-group {
  margin-bottom: 18px;
}
.ga-group:last-child {
  margin-bottom: 0;
}
.ga-group-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 2px 2px 10px;
}
.ga-group-label {
  font-size: var(--fs-md);
  font-weight: 700;
  color: var(--text-bright);
}
.ga-group-count {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}

/*  图片网格  */
.ga-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 10px;
}
.ga-item {
  position: relative;
  border-radius: var(--radius-md);
  overflow: hidden;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong);
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard);
}
.ga-item:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}
.ga-item:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.ga-img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  background-color: var(--bg-tertiary);
}

/* 发图人角标（仅「全部」视图） */
.ga-owner {
  position: absolute;
  right: 6px;
  bottom: 6px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  overflow: hidden;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: var(--accent-solid);
  border: 1.5px solid rgba(255, 255, 255, 0.85);
}
.ga-owner img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/*  空态  */
.ga-empty {
  color: var(--text-secondary);
}
.ga-empty-hint {
  font-size: var(--fs-xs);
  opacity: 0.75;
}

/*  移动端  */
@media (max-width: 767px) {
  .ga-scroll {
    max-height: 60vh;
  }
  .ga-grid {
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 8px;
  }
}
</style>