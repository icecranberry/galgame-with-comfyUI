<template>
  <div
    class="char-node"
    :class="{ 'is-center': isCenter }"
  >
    <!-- 中心角色：4向 source handle 覆盖头像上半区/下半区/左半区/右半区 -->
    <Handle
      v-if="isCenter"
      type="source"
      :position="Position.Top"
      id="source-top"
      class="rel-handle rel-source-top"
    />
    <Handle
      v-if="isCenter"
      type="source"
      :position="Position.Bottom"
      id="source-bottom"
      class="rel-handle rel-source-bottom"
    />
    <Handle
      v-if="isCenter"
      type="source"
      :position="Position.Left"
      id="source-left"
      class="rel-handle rel-source-left"
    />
    <Handle
      v-if="isCenter"
      type="source"
      :position="Position.Right"
      id="source-right"
      class="rel-handle rel-source-right"
    />
    <Handle
      v-if="!isCenter"
      type="target"
      :position="Position.Top"
      id="target-top"
      class="rel-handle rel-target-top"
    />
    <Handle
      v-if="!isCenter"
      type="target"
      :position="Position.Bottom"
      id="target-bottom"
      class="rel-handle rel-target-bottom"
    />
    <Handle
      v-if="!isCenter"
      type="target"
      :position="Position.Left"
      id="target-left"
      class="rel-handle rel-target-left"
    />
    <Handle
      v-if="!isCenter"
      type="target"
      :position="Position.Right"
      id="target-right"
      class="rel-handle rel-target-right"
    />

    <!-- 头像 -->
    <div
      class="cn-avatar"
      :style="avatarStyle"
    >{{ data.avatar_path ? '' : (data.display_name || '?').charAt(0) }}</div>

    <!-- 名字 -->
    <div class="cn-name">{{ data.display_name }}</div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps({
  data: { type: Object, required: true },
  isCenter: { type: Boolean, default: false },
})

const avatarStyle = computed(() => {
  if (props.data.avatar_path) {
    return {
      backgroundImage: `url(${props.data.avatar_path})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    }
  }
  return { background: props.data.avatar_color || '#e07b6c' }
})
</script>

<style scoped>
.char-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  position: relative;
  user-select: none;
}

.cn-avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 28px;
  font-weight: 700;
  border: 3px solid rgba(255,255,255,0.8);
  box-shadow: 0 2px 12px rgba(0,0,0,0.1);
  flex-shrink: 0;
  pointer-events: none;
}

.is-center .cn-avatar {
  width: 120px;
  height: 120px;
  font-size: 44px;
  border-width: 4px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.15);
}

.cn-name {
  font-size: 12px;
  font-weight: 600;
  color: #333;
  text-align: center;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: none;
  pointer-events: none;
}

.is-center .cn-name {
  font-size: 16px;
  font-weight: 700;
  color: #222;
  max-width: 140px;
}

/* ── Big transparent Handle covering the avatar ── */
.rel-handle {
  border: none !important;
  background: transparent !important;
  border-radius: 0 !important;
  opacity: 0 !important;
  z-index: 2;
}
.rel-target-top {
  width: 72px !important;
  height: 36px !important;
  top: 0 !important;
  left: 50% !important;
  transform: translate(-50%, 0) !important;
}
.rel-target-bottom {
  width: 72px !important;
  height: 36px !important;
  bottom: 0 !important;
  left: 50% !important;
  transform: translate(-50%, 0) !important;
}
.rel-target-left {
  width: 36px !important;
  height: 72px !important;
  top: 50% !important;
  left: 0 !important;
  transform: translate(0, -50%) !important;
}
.rel-target-right {
  width: 36px !important;
  height: 72px !important;
  top: 50% !important;
  right: 0 !important;
  transform: translate(0, -50%) !important;
}
/* 4向 source: 各覆盖头像一半，不重叠 */
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
