<template>
  <linshe-modal :visible="visible" :title="title" :z-index="90000" @close="close" panel-class="install-guide-modal">
    <template #title>
      <div class="modal-heading-content">
            <div class="guide-mark" aria-hidden="true">
              <svg viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="7.2" stroke="currentColor" stroke-width="1.6"/>
                <path d="M10 8.7V13M10 5.9h.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              </svg>
            </div>
            <div class="guide-title-wrap">
              <h3>{{ title }}</h3>
              <p v-if="intro">{{ intro }}</p>
            </div>

      </div>
    </template>

          <div class="guide-body">
            <template v-if="steps.length">
              <h4 class="guide-section">安装步骤</h4>
              <ul class="guide-steps">
                <li v-for="step in steps" :key="step.title" class="guide-step">
                  <span class="guide-step-title">{{ step.title }}</span>
                  <p class="guide-step-body" v-html="step.body"></p>
                </li>
              </ul>
            </template>

            <template v-if="afterStartSteps.length">
              <h4 class="guide-section">启动后的配置（简要）</h4>
              <ol class="guide-after">
                <li v-for="tip in afterStartSteps" :key="tip">{{ tip }}</li>
              </ol>
            </template>
          </div>

    <template #footer>
            <linshe-button variant="primary" class="guide-ok" @click="close">我已了解</linshe-button>
    </template>
  </linshe-modal>
</template>

<script setup>
import LinsheModal from './ui/LinsheModal.vue'

import { ref } from 'vue'
import LinsheButton from './ui/LinsheButton.vue'

const visible = ref(false)
const title = ref('安装教程')
const intro = ref('')
const steps = ref([])
const afterStartSteps = ref([])

function show(opts = {}) {
  title.value = opts.title || '安装教程'
  intro.value = opts.intro || ''
  steps.value = Array.isArray(opts.steps) ? opts.steps : []
  afterStartSteps.value = Array.isArray(opts.afterStartSteps) ? opts.afterStartSteps : []
  visible.value = true
}

function close() {
  visible.value = false
}

defineExpose({ show, close })
</script>

<style scoped>
.guide-mark {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: rgba(var(--accent-rgb), 0.12);
  color: var(--accent);
}
.guide-mark svg {
  width: 21px;
  height: 21px;
}

.guide-title-wrap {
  flex: 1;
  min-width: 0;
}
.guide-title-wrap h3 {
  margin: 2px 0 5px;
  font-size: 18px;
  font-weight: 600;
  color: #3E3A36;
}
.guide-title-wrap p {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: #8B8179;
}

/* 皮肤交给 LinsheButton，仅保留布局与图标尺寸 */

.guide-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 22px 18px;
}
.guide-body::-webkit-scrollbar {
  width: 6px;
}
.guide-body::-webkit-scrollbar-track {
  background: transparent;
}
.guide-body::-webkit-scrollbar-thumb {
  background: #D6CDC5;
  border-radius: 3px;
}
.guide-body::-webkit-scrollbar-thumb:hover {
  background: #BEB3AA;
}

.guide-section {
  margin: 4px 0 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--accent);
}
.guide-section:not(:first-child) {
  margin-top: 20px;
}

.guide-steps {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 14px;
}
.guide-step-title {
  display: block;
  margin-bottom: 3px;
  font-size: 13px;
  font-weight: 600;
  color: #3E3A36;
}
.guide-step-body {
  margin: 0;
  font-size: 13px;
  line-height: 1.65;
  color: #6F655C;
}
.guide-step-body :deep(a) {
  color: var(--accent);
  text-decoration: none;
}
.guide-step-body :deep(a:hover) {
  text-decoration: underline;
}

.guide-after {
  margin: 0;
  padding-left: 20px;
  display: grid;
  gap: 8px;
  font-size: 13px;
  line-height: 1.6;
  color: #6F655C;
}
.guide-after li::marker {
  color: var(--accent);
}

.guide-foot {
  display: flex;
  justify-content: flex-end;
  padding: 12px 22px 18px;
  border-top: 1px solid rgba(var(--accent-rgb), 0.14);
}
/* 皮肤交给 LinsheButton，仅保留尺寸 */
.guide-ok {
  min-width: 112px;
  min-height: 38px;
}

.guide-enter-active {
  transition: opacity 220ms cubic-bezier(0.4, 0, 0.2, 1);
}
.guide-leave-active {
  transition: opacity 160ms cubic-bezier(0.4, 0, 0.2, 1);
}
.guide-enter-from,
.guide-leave-to {
  opacity: 0;
}

@keyframes guide-pop-in {
  0% {
    opacity: 0;
    transform: translateY(10px) scale(0.97);
  }
  58% {
    opacity: 1;
    transform: translateY(-1px) scale(1.004);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .guide-enter-active,
  .guide-leave-active {
    transition: opacity 140ms ease;
  }
}

@media (max-width: 640px) {
  .guide-body {
    padding: 14px 16px 16px;
  }
  .guide-foot {
    padding: 10px 16px 14px;
  }
}
:global(.linshe-modal.install-guide-modal) { width: min(680px, 94vw); }
.guide-title-wrap p { font-size: var(--fs-sm); line-height: 1.6; margin: 4px 0 0; color: var(--text-secondary); }
</style>
