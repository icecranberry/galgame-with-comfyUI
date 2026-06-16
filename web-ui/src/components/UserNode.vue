<template>
  <div class="user-node is-center">
    <!-- 4向 source handle 覆盖头像上半区/下半区/左半区/右半区 -->
    <Handle
      type="source"
      :position="Position.Top"
      id="source-top"
      class="rel-handle rel-source-top"
    />
    <Handle
      type="source"
      :position="Position.Bottom"
      id="source-bottom"
      class="rel-handle rel-source-bottom"
    />
    <Handle
      type="source"
      :position="Position.Left"
      id="source-left"
      class="rel-handle rel-source-left"
    />
    <Handle
      type="source"
      :position="Position.Right"
      id="source-right"
      class="rel-handle rel-source-right"
    />

    <!-- 头像 -->
    <div
      class="un-avatar"
      :style="avatarStyle"
    >{{ avatarUrl ? '' : (nickname || '我').charAt(0) }}</div>

    <!-- 名字 -->
    <div class="un-name">{{ nickname || '我' }}</div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps({
  data: { type: Object, required: true },
})

const avatarUrl = computed(() => props.data.avatar_url)
const nickname = computed(() => props.data.nickname || '')

const avatarStyle = computed(() => {
  if (props.data.avatar_url) {
    return {
      backgroundImage: `url(${props.data.avatar_url})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    }
  }
  return { background: props.data.avatar_color || '#e07b6c' }
})
</script>

<style scoped>
.user-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  position: relative;
  user-select: none;
}

.un-avatar {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 44px;
  font-weight: 700;
  border: 4px solid rgba(255, 255, 255, 0.8);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
  flex-shrink: 0;
  pointer-events: none;
}

.un-name {
  font-size: 16px;
  font-weight: 700;
  color: #222;
  text-align: center;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: none;
  pointer-events: none;
}

/* ── Big transparent Handle covering the avatar ── */
.rel-handle {
  border: none !important;
  background: transparent !important;
  border-radius: 0 !important;
  opacity: 0 !important;
  z-index: 2;
}
.rel-source-top {
  width: 120px !important;
  height: 60px !important;
  top: 0 !important;
  left: 50% !important;
  transform: translate(-50%, 0) !important;
}
.rel-source-bottom {
  width: 120px !important;
  height: 60px !important;
  bottom: 0 !important;
  left: 50% !important;
  transform: translate(-50%, 0) !important;
}
.rel-source-left {
  width: 60px !important;
  height: 120px !important;
  top: 50% !important;
  left: 0 !important;
  transform: translate(0, -50%) !important;
}
.rel-source-right {
  width: 60px !important;
  height: 120px !important;
  top: 50% !important;
  right: 0 !important;
  transform: translate(0, -50%) !important;
}
</style>
