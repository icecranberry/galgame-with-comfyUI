<template>
  <Teleport to="body">
    <Transition name="cp-fade">
      <div v-if="open" class="cp-mask" @click.self="$emit('close')" @keydown.esc="$emit('close')">
        <section class="cp-panel" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1">
          <header class="cp-head">
            <div>
              <span class="cp-kicker">选人</span>
              <h2>{{ title }}</h2>
            </div>
            <button type="button" class="cp-close" :aria-label="`关闭${title}`" @click="$emit('close')">✕</button>
          </header>
          <p v-if="!options.length" class="cp-empty" role="status">
            {{ targets.length ? '其他角色已经被选中了。' : '还没有角色卡，先去招募一位吧。' }}
          </p>
          <div v-else class="cp-grid" role="listbox" :aria-label="title">
            <button
              v-for="item in options" :key="item.actorKey"
              type="button" role="option" :aria-selected="item.actorKey === modelValue"
              class="cp-card" :class="{ 'is-picked': item.actorKey === modelValue }"
              @click="pick(item)"
            >
              <span class="cp-portrait">
                <img v-if="item.avatarPath" :src="item.avatarPath" :alt="item.displayName" loading="lazy">
                <span v-else class="cp-initial" aria-hidden="true">{{ initialOf(item) }}</span>
              </span>
              <span class="cp-name">{{ item.displayName }}</span>
            </button>
          </div>
          <footer class="cp-foot">
            <span class="cp-hint">共 {{ options.length }} 位可选</span>
            <button type="button" class="cp-cancel" @click="$emit('close')">取消</button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
// 建筑功能的选人界面：把「选一位角色」做成带立绘的角色卡网格，替掉原来的下拉框。
// 目标范围由服务端 selectableTargets 给出（全部招募角色，不再要求入住本镇）。
// 没有头像的角色卡退回首字占位，不会因为缺图变成空框。
// 视觉与店铺舞台同语言：深木面板 + 木纹卡 + 3px 硬边像素风（不再用糖纸）。
import { computed } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '选择角色' },
  targets: { type: Array, default: () => [] },
  /** 已被另一位占用的 actorKey（合影的两个目标不能是同一人） */
  exclude: { type: String, default: '' },
  modelValue: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'close'])

const options = computed(() => (props.targets || []).filter(t => t && t.actorKey && t.actorKey !== props.exclude))
function initialOf(target) {
  return String(target?.displayName || '?').trim().slice(0, 1) || '?'
}
function pick(item) {
  emit('update:modelValue', item.actorKey)
  emit('close')
}
</script>

<style scoped>
/* 木牌像素风：与 TownShopStage 同一语言（深木面板、木纹卡、3px 硬边、方角） */
.cp-fade-enter-active, .cp-fade-leave-active { transition: opacity .16s ease; }
.cp-fade-enter-from, .cp-fade-leave-to { opacity: 0; }
.cp-mask { position: fixed; inset: 0; z-index: 10060; display: flex; align-items: center; justify-content: center; padding: 12px; background: #1d140bcc; box-sizing: border-box; }
.cp-panel {
  width: min(560px, 100%); max-height: calc(100dvh - 24px); display: flex; flex-direction: column;
  background: #2e2013; color: #f3e2c7; border: 3px solid #17100a;
  box-shadow: 0 0 0 3px #7a5127, 0 12px 32px #00000066; overflow: hidden; outline: none;
}
.cp-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; flex-shrink: 0;
  background: repeating-linear-gradient(90deg, #00000010 0 2px, #00000000 2px 7px), linear-gradient(#a4703a, #8a5a2b);
  border-bottom: 3px solid #17100a;
}
.cp-kicker { color: #f7dfae; font-size: 11px; letter-spacing: .3em; text-shadow: 1px 1px 0 #4a2f14; }
.cp-panel h2 { font-size: 18px; margin: 2px 0 0; font-weight: 700; color: #fff4d8; text-shadow: 2px 2px 0 #4a2f14; }
.cp-close {
  width: 28px; height: 28px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  padding: 0; font: inherit; font-size: 13px; line-height: 1; cursor: pointer;
  background: #4a3520; color: #f0d9b5; border: 2px solid #17100a; box-shadow: inset 0 0 0 2px #ffffff22;
}
.cp-close:hover { background: #5d4327; }
.cp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 10px; padding: 12px 16px 14px; overflow-y: auto; overscroll-behavior: contain; min-height: 0; }
.cp-card {
  display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 8px;
  background: linear-gradient(#c79a63, #b07d4a); color: #2e2013;
  border: 3px solid #17100a; border-radius: 0; box-shadow: inset 0 0 0 2px #ffffff30, 0 2px 0 #17100a;
  cursor: pointer; font: inherit;
  transition: background .14s ease, border-color .14s ease, box-shadow .14s ease;
}
.cp-card:hover { background: linear-gradient(#d9ab72, #bd8a54); }
.cp-card:active { transform: translateY(2px); box-shadow: inset 0 0 0 2px #ffffff30, 0 0 0 #17100a; }
.cp-card.is-picked { border-color: #ffd98a; box-shadow: inset 0 0 0 2px #ffd98a, 0 2px 0 #17100a; }
.cp-portrait { width: 64px; height: 64px; border-radius: 0; overflow: hidden; display: flex; align-items: center; justify-content: center; background: #e7e0d8; border: 2px solid #17100a; flex-shrink: 0; }
.cp-portrait img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cp-initial { font-size: 26px; font-weight: 600; color: #55432a; }
.cp-name { font-size: 13px; font-weight: 600; text-align: center; line-height: 1.35; overflow-wrap: anywhere; }
.cp-empty { padding: 4px 22px 18px; font-size: 13px; color: #a8916f; }
.cp-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 16px calc(12px + env(safe-area-inset-bottom)); flex-shrink: 0;
  background: #241a0f; border-top: 3px solid #17100a; color: #a8916f; font-size: 11px;
}
.cp-cancel {
  padding: 5px 12px; font: inherit; font-size: 12px; cursor: pointer;
  background: #4a3520; color: #f0d9b5; border: 2px solid #17100a; box-shadow: inset 0 0 0 2px #ffffff22, 0 2px 0 #17100a;
}
.cp-cancel:hover { background: #5d4327; }
.cp-cancel:active { transform: translateY(2px); box-shadow: inset 0 0 0 2px #ffffff22, 0 0 0 #17100a; }
@media (prefers-reduced-motion: reduce) { .cp-card { transition: none; } }
</style>
