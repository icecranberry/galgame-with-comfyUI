<script setup>
// 外观设置卡片：主题选择（从 SettingsView 抽出的首个功能域组件）
// 主题状态与切换逻辑全部来自 settings store，本组件无本地状态。
import { useSettingsStore } from '../../stores/settings.js'
import { THEMES } from '../../theme.js'

const settingsStore = useSettingsStore()
const themes = THEMES
</script>

<template>
  <div class="card appearance-card">
    <h3>外观</h3>
    <p class="fd">选择界面配色主题，点击立即生效，偏好保存在本设备</p>
    <div class="theme-grid">
      <button v-for="t in themes" :key="t.id"
        class="theme-tile" :class="{ active: settingsStore.theme === t.id }"
        @click="settingsStore.setTheme(t.id)">
        <span class="theme-swatch">
          <i v-for="(c, i) in t.swatches" :key="i" :style="{ background: c }"></i>
        </span>
        <span class="theme-meta">
          <span class="theme-name">{{ t.name }}<span v-if="settingsStore.theme === t.id" class="theme-check">✓</span></span>
          <span class="theme-desc">{{ t.desc }}</span>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}
.theme-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 14px;
  border: 1.5px solid var(--border);
  background: var(--bg-secondary);
  text-align: left;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}
.theme-tile:hover { transform: translateY(-2px); box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06); }
.theme-tile.active {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}
.theme-swatch {
  display: flex;
  height: 44px;
  border-radius: 10px;
  overflow: hidden;
}
.theme-swatch i { flex: 1; }
.theme-meta { display: flex; flex-direction: column; gap: 2px; }
.theme-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-bright);
  display: flex;
  align-items: center;
  gap: 6px;
}
.theme-check {
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
}
.theme-desc { font-size: 11.5px; color: var(--text-secondary); }
</style>
