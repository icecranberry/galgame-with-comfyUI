<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <!-- 摊开的日记本：左右两页 + 中间书脊 + 右侧书签带 -->
    <path d="M12 6.6C9.9 4.8 6.4 4.4 3.4 5.1v13.2c3-.7 6.5-.3 8.6 1.5" />
    <path d="M12 6.6c2.1-1.8 5.6-2.2 8.6-1.5v13.2c-3-.7-6.5-.3-8.6 1.5" />
    <path d="M12 6.6v13.2" />
    <path d="M6.1 8.9h3.2M6.1 12.1h3.2" />
    <path d="M14.7 8.9h3.2M14.7 12.1h3.2" />
  </svg>
</template>

<script setup>
// 日记入口图标：摊开的本子。跟随 currentColor，与全局 stroke 线性图标同源。
defineProps({
  size: { type: [Number, String], default: 18 },
  strokeWidth: { type: [Number, String], default: 1.8 },
})
</script>
