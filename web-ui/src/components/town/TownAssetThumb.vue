<template>
  <div
    class="town-asset-thumb"
    :class="{ 'is-selected': selected, 'is-pending': asset?.status !== 'ready' }"
    role="button"
    tabindex="0"
    :title="asset?.status === 'ready' ? (clickTitle || '点击选用') : (asset?.status === 'pending' ? '生成中…' : '生成失败')"
    @click="emit('click', asset)"
    @keydown.enter.prevent="emit('click', asset)"
  >
    <div class="tat-media">
      <img v-if="asset?.status === 'ready' && imageUrl" :src="imageUrl" :alt="asset?.name || ''">
      <span v-else-if="asset?.status === 'pending'" class="tat-state">⏳</span>
      <span v-else class="tat-state">⚠️</span>

      <linshe-button
        v-if="asset?.status === 'ready' && editable"
        class="tat-edit"
        variant="icon"
        size="sm"
        title="打开图片管理"
        :aria-label="`打开 ${asset?.name || '图片'} 管理`"
        @click.stop="emit('edit', asset)"
      >✎</linshe-button>
    </div>

    <div v-if="showName" class="tat-info">
      <span v-if="showName" class="tat-name">{{ asset?.name }}</span>
    </div>
    <linshe-button v-if="deletable && asset?.status === 'ready'" variant="ghost" size="sm" class="tat-delete" title="删除" @click.stop="emit('delete', asset)">删除</linshe-button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'

const props = defineProps({
  asset: { type: Object, default: null },
  selected: { type: Boolean, default: false },
  editable: { type: Boolean, default: true },
  showName: { type: Boolean, default: false },
  deletable: { type: Boolean, default: false },
  clickTitle: { type: String, default: '' },
})

const emit = defineEmits(['click', 'edit', 'delete'])

const imageUrl = computed(() => props.asset?.image_path
  ? `${props.asset.image_path}?v=${props.asset.meta?.updatedAt ?? 0}`
  : props.asset?.src || '')

</script>

<style scoped>
.town-asset-thumb {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  cursor: pointer;
}

.tat-media {
 position: relative;
 width: 100%;
 flex: 0 0 auto;
 aspect-ratio: 1 / 1;
 border-radius: 10px;
  overflow: hidden;
  background: #fbf8f3;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: box-shadow 0.18s ease, border-color 0.18s ease;
  border: 1.5px solid transparent;
}

.town-asset-thumb:hover .tat-media,
.town-asset-thumb:focus-visible .tat-media {
  border-color: rgba(224, 123, 108, 0.45);
  box-shadow: 0 6px 18px rgba(54, 42, 38, 0.1);
}

.town-asset-thumb.is-selected .tat-media {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(224, 123, 108, 0.24);
}

.town-asset-thumb.is-pending { opacity: 0.62; }
.tat-delete { margin-top: -2px; font-size: 10px; }

.tat-media img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: bottom center;
}

.tat-state { color: #b8a996; font-size: 18px; }

.tat-edit {
  position: absolute !important;
  top: 6px;
  right: 6px;
  opacity: 0;
  transform: translateY(-3px);
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.town-asset-thumb:hover .tat-edit,
.town-asset-thumb:focus-visible .tat-edit {
  opacity: 1;
  transform: translateY(0);
}

.tat-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.tat-name {
  font-size: 11px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

</style>
