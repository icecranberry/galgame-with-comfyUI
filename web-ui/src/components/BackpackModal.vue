<template>
  <Teleport to="body">
    <Transition name="backpack-fade">
      <div v-if="visible" class="backpack-overlay" @click.self="close">
        <div class="backpack-modal">
          <!-- ── Header ── -->
          <div class="backpack-header">
            <div class="header-left">
              <svg class="header-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 9a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v1H4V9z"/>
                <path d="M4 10h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8z"/>
                <path d="M10 13h4"/>
              </svg>
              <div>
                <h3>背包</h3>
                <p class="header-subtitle">宝箱与道具</p>
              </div>
            </div>
            <div class="header-actions">
              <linshe-button variant="icon" @click="close" title="关闭">&times;</linshe-button>
            </div>
          </div>

          <!-- ── Body ── -->
          <div class="backpack-body">
            <!-- ── Left: 每日宝箱 ── -->
            <div class="chest-panel">
              <div
                class="chest-stage"
                :class="{ 'is-ready': store.chest.canOpen }"
                role="button"
                tabindex="0"
                @click="onOpenChest"
                @keydown.enter.prevent="onOpenChest"
              >
                <ChestSvg state="idle" :ready="store.chest.canOpen"/>
              </div>

              <div class="chest-status">
                <template v-if="store.chest.canOpen && !chestProcessActive">每日宝箱已就绪</template>
              </div>

              <linshe-button
                variant="primary" size="lg" block
                :disabled="!store.chest.canOpen || chestProcessActive"
                @click="onOpenChest"
              >{{ chestButtonLabel }}</linshe-button>
              <p class="chest-hint">每 {{ store.chest.cooldownHours || 16 }} 小时可开启一次</p>
            </div>

            <!-- ── Right: 道具网格 ── -->
            <div class="items-panel">
              <Transition name="effects-panel">
                <section v-if="store.activeEffects.length" class="active-effects" aria-labelledby="active-effects-title">
                  <div class="effects-heading">
                    <div class="effects-heading-main">
                      <span class="effects-heading-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M12 3 13.8 8.2 19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/>
                          <path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/>
                        </svg>
                      </span>
                      <div class="effects-title-copy">
                        <div class="effects-title-row">
                          <h4 id="active-effects-title" class="effects-title">此刻的角色状态</h4>
                        </div>
                        <p class="effects-subtitle">芭芭拉魔法~呼啦啦呜~魔仙变~</p>
                      </div>
                    </div>
                  </div>

                  <TransitionGroup v-if="store.activeEffects.length" name="effect-list" tag="div" class="effect-list">
                    <article v-for="ef in store.activeEffects" :key="ef.id" class="effect-card" :class="'card-' + ef.kind">
                      <div class="effect-thumb" :class="'thumb-' + ef.kind">
                        <img v-if="ef.item_image_url" :src="ef.item_image_url" alt=""/>
                        <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                          <path :d="effectIconPath(ef.kind)"/>
                        </svg>
                      </div>
                      <div class="effect-info">
                        <div class="effect-name-line">
                          <span class="effect-char">{{ ef.character_name }}</span>
                          <span class="effect-kind" :class="'kind-' + ef.kind">{{ effectKindLabel(ef.kind) }}</span>
                        </div>
                        <div class="effect-item">{{ ef.item_name || ef.effect_name }}</div>
                        <div class="effect-meta">
                          <span class="effect-time" :class="{ urgent: isEffectUrgent(ef) }">
                            <span class="effect-time-dot"></span>
                            <span>{{ effectRemainingText(ef) }}</span>
                          </span>
                        </div>
                      </div>
                      <linshe-button
                        class="effect-remove"
                        variant="ghost" tone="danger" size="sm"
                        :loading="removingEffectId === ef.id"
                        :disabled="removingEffectId !== null"
                        :aria-label="`移除 ${ef.character_name} 的${ef.item_name || ef.effect_name}效果`"
                        :title="`移除 ${ef.character_name} 的${ef.item_name || ef.effect_name}效果`"
                        @click.stop="onRemoveEffect(ef)"
                      >
                        <svg v-if="removingEffectId !== ef.id" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>
                        </svg>
                        <span>移除</span>
                      </linshe-button>
                    </article>
                  </TransitionGroup>

                  <div v-else-if="store.loading" class="effects-empty effects-loading">
                    <span class="loading-spinner" aria-hidden="true"></span>
                    <span>正在同步效果…</span>
                  </div>
                  <div v-else class="effects-empty">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M12 3 13.8 8.2 19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/>
                      <path d="m9 18 .5 1.5L11 20l-1.5.5L9 22l-.5-1.5L7 20l1.5-.5L9 18Z"/>
                    </svg>
                    <span>目前没有正在生效的效果</span>
                  </div>
                </section>
              </Transition>

              <div v-if="store.loading && store.items.length === 0" class="loading-state">
                <span class="loading-spinner"></span>
                <p>打开背包中…</p>
              </div>

              <div v-else-if="store.items.length === 0" class="items-empty">
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#8a7a6a" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 9a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v1H4V9z"/>
                  <path d="M4 10h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8z"/>
                  <path d="M10 13h4"/>
                </svg>
                <p class="empty-title">背包还是空的</p>
                <p class="empty-hint">去左边的宝箱看看吧</p>
              </div>

              <TransitionGroup v-else name="item-list" tag="div" class="items-grid">
                <div v-for="item in store.items" :key="item.id"
                  class="item-card"
                  role="button" tabindex="0"
                  @click="openDetail(item)"
                  @keydown.enter.prevent="openDetail(item)"
                >
                  <div class="item-image">
                    <img v-if="item.image_url" :src="item.image_url" alt=""/>
                    <ItemFallbackIcon v-else/>
                  </div>
                  <div class="item-name">{{ item.name }}</div>
                  <p class="item-desc" :title="item.description">{{ item.description }}</p>
                  <div class="item-actions">
                    <linshe-button size="sm" variant="ghost" tone="danger" @click.stop="onDiscard(item)">丢弃</linshe-button>
                    <linshe-button size="sm" variant="primary" :disabled="item.status !== 'ready'" @click.stop="startUse(item)">使用</linshe-button>
                  </div>
                </div>
              </TransitionGroup>
            </div>
          </div>

          <!-- ── 道具详情（二级层） ── -->
          <Transition name="detail-fade">
            <div v-if="detailItem" class="item-detail-overlay" @click.self="detailItem = null">
              <div class="item-detail-dialog">
                <div class="detail-header">
                  <span>道具详情</span>
                </div>
                <div class="detail-body">
                  <div class="detail-image">
                    <img v-if="detailItem.image_url" :src="detailItem.image_url" alt=""/>
                    <ItemFallbackIcon v-else/>
                  </div>
                  <div class="detail-name-row">
                    <span class="detail-name">{{ detailItem.name }}</span>
                  </div>
                  <div class="detail-kind">{{ KIND_LABELS[detailItem.kind] || KIND_LABELS.unknown }}</div>
                  <p class="detail-desc">{{ detailItem.description }}</p>
                  <div class="detail-actions">
                    <linshe-button variant="ghost" tone="danger" @click="onDiscard(detailItem)">丢弃</linshe-button>
                    <linshe-button variant="primary" :disabled="detailItem.status !== 'ready'" @click="startUse(detailItem)">使用</linshe-button>
                  </div>
                </div>
              </div>
            </div>
          </Transition>

          <!-- ── 角色选择（三级层） ── -->
          <div v-if="showCharPicker" class="char-picker-overlay" @click.self="cancelPick">
            <div class="char-picker-dialog">
              <div class="char-picker-header">
                <span>对谁使用「{{ pendingItem?.name }}」？</span>
                <linshe-button variant="icon" @click="cancelPick">&times;</linshe-button>
              </div>
              <div class="char-grid">
                <div v-for="char in characters" :key="char.id" class="char-card" @click="pickCharacter(char)">
                  <div class="char-card-inner">
                    <img v-if="char.avatar_path" :src="char.avatar_path" class="char-avatar"/>
                    <span v-else class="char-avatar char-avatar-fallback">{{ (char.display_name || char.name || '?')[0] }}</span>
                    <span class="char-name">{{ char.display_name || char.name }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <ConfirmDialog ref="confirmRef"/>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- ── 全屏开箱演出（蓄力 → 图片生成完毕 → 开盖揭示） ── -->
  <ChestRevealOverlay
    :show="fullscreen"
    :chest-anim="chestAnim"
    :flash-on="flashOn"
    :charge-boost="chargeBoost"
    :item="revealedItem"
    :collecting="collecting"
    @collect="onCollectFromReveal"
  />
</template>

<script setup>
import { ref, watch, onUnmounted, inject } from 'vue'
import LinsheButton from './ui/LinsheButton.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import ChestSvg from './ChestSvg.vue'
import ItemFallbackIcon from './ItemFallbackIcon.vue'
import ChestRevealOverlay from './ChestRevealOverlay.vue'
import { useBackpackActions, ITEM_KIND_LABELS as KIND_LABELS } from '../composables/useBackpackActions.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  characters: { type: Array, default: () => [] },
})
const emit = defineEmits(['close'])

const toast = inject('toast')
const confirmRef = ref(null)

const {
  store,
  fullscreen, chestAnim, chestProcessActive, chargeBoost, flashOn,
  revealedItem, collecting,
  onOpenChest, onCollectFromReveal, resumePendingReveal,
  chestButtonLabel, startCountdown, stopCountdown,
  effectKindLabel, effectIconPath, effectRemainingText, isEffectUrgent,
  removingEffectId, onRemoveEffect,
  detailItem, openDetail, startUse,
  showCharPicker, pendingItem, cancelPick, pickCharacter,
  onDiscard, resetUi,
} = useBackpackActions({
  confirm: (opts) => confirmRef.value.show(opts),
  toast,
})

watch(() => props.visible, (v) => {
  if (v) {
    store.startPolling()
    startCountdown()
    // 中途离开留下的未收下道具：重开背包时续播揭示演出
    resumePendingReveal()
  } else {
    store.stopPolling()
    stopCountdown()
    resetUi()
  }
})
onUnmounted(() => {
  store.stopPolling()
})

function close() {
  emit('close')
}
</script>

<style scoped>
.backpack-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}
.backpack-modal {
  background: #f4f1eeed;
  border-radius: 18px;
  width: min(1280px, 96vw);
  height: 86vh;
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.18);
  overflow: hidden;
  position: relative;
}

/* ── Header ── */
.backpack-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 22px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.28);
}
.header-left { display: flex; align-items: center; gap: 12px; color: var(--text-primary); }
.header-svg { color: var(--accent); }
.header-left h3 { margin: 0; font-size: 18px; }
.header-subtitle { margin: 2px 0 0; font-size: 12px; color: var(--text-secondary); }

/* ── Body：白色衬里，与面板暖底分层 ── */
.backpack-body {
  display: flex;
  gap: 16px;
  margin: 16px 22px 22px;
  padding: 16px;
  background: #ffffffb3;
  border-radius: 16px;
  overflow: hidden;
  flex: 1;
  min-height: 0;
}

/* ── 左栏：宝箱 ── */
.chest-panel {
  width: 336px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(255, 253, 250, 0.75);
  border-radius: 16px;
  padding: 16px 16px;
}
.chest-stage { width: 264px; }
.chest-stage.is-ready { cursor: pointer; }
.chest-stage.is-ready:hover { filter: brightness(1.05); }

.chest-status {
  margin: 4px 0 14px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  min-height: 20px;
}
.chest-hint { margin: 10px 0 0; font-size: 12px; color: var(--text-secondary); }

/* ── 右栏：道具网格 ── */
.items-panel { flex: 1; min-width: 0; overflow-y: auto; padding-right: 2px; }

.active-effects {
  margin-bottom: 22px;
  padding: 14px;
  border-radius: 16px;
  background: rgba(255, 250, 245, 0.82);
  box-shadow: 0 2px 14px rgba(122, 91, 63, 0.04);
}
.effects-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 13px;
}
.effects-heading-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.effects-heading-icon {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 11px;
  background: rgba(var(--accent-rgb), 0.12);
  color: var(--accent);
}
.effects-heading-icon svg { width: 20px; height: 20px; }
.effects-title-copy { min-width: 0; }
.effects-eyebrow {
  margin: 0 0 2px;
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
}
.effects-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.effects-title {
  margin: 0;
  font-size: 16px;
  line-height: 1.35;
  font-weight: 700;
  color: var(--text-primary);
}
.effects-subtitle {
  margin: 3px 0 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-secondary);
}
.effects-count {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(var(--accent-rgb), 0.12);
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.effect-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
  gap: 10px;
}
.effect-card {
  --effect-surface: var(--bg-secondary);
  --effect-border: var(--border);
  --effect-shadow: var(--border);
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 11px 10px 11px 13px;
  border-radius: 12px;
  background: var(--effect-surface);
  border: 1px solid var(--effect-border);
  box-shadow: 0 3px 0 var(--effect-shadow), inset 0 1px 0 rgba(255, 255, 255, 0.92);
  transition: transform 0.16s ease, box-shadow 0.16s ease;
}
.effect-card:hover,
.effect-card:focus-within {
  transform: translateY(-1px);
  box-shadow: 0 4px 0 var(--effect-shadow), inset 0 1px 0 rgba(255, 255, 255, 0.96);
}
.effect-card.card-world-outfit,
.effect-card.card-outfit,
.effect-card.card-transform,
.effect-card.card-hairstyle {
  --effect-surface: rgba(var(--accent-rgb), 0.05);
  --effect-border: rgba(var(--accent-rgb), 0.16);
  --effect-shadow: rgba(var(--accent-rgb), 0.12);
}
.effect-card.card-buff {
  --effect-surface: #f8f4fd;
  --effect-border: #e5dcf3;
  --effect-shadow: #d9cbea;
}
.effect-card.card-mood {
  --effect-surface: #fff4f1;
  --effect-border: #f2d8d2;
  --effect-shadow: #efcdc7;
}
.effect-card.card-favor {
  --effect-surface: #fffaf0;
  --effect-border: #f1e3c4;
  --effect-shadow: #eedcaf;
}
.effect-thumb {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #f5efe7;
  color: #8a7a6a;
}
.effect-thumb img { width: 100%; height: 100%; object-fit: cover; }
.effect-thumb.thumb-world-outfit, .effect-thumb.thumb-outfit, .effect-thumb.thumb-transform, .effect-thumb.thumb-hairstyle { background: #fbeee4; color: #9a5c33; }
.effect-thumb.thumb-buff { background: #efe9fb; color: #6f5b9e; }
.effect-thumb.thumb-mood { background: #fde5df; color: #cc6a5c; }
.effect-thumb.thumb-favor { background: #fff1d6; color: #a5721f; }
.effect-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.effect-name-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.effect-char {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-bright);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.effect-kind {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 999px;
}
.kind-world-outfit, .kind-outfit, .kind-transform, .kind-hairstyle { background: #fbeee4; color: #9a5c33; }
.kind-buff { background: #efe9fb; color: #6f5b9e; }
.kind-mood { background: #fde5df; color: #cc6a5c; }
.kind-favor { background: #fff1d6; color: #a5721f; }
.kind-unknown { background: #eee6db; color: #8a7a6a; }
.effect-item {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.effect-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-top: 5px;
}
.effect-target {
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 10px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.effect-time {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}
.effect-time-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.14);
}
.effect-time.urgent { color: #cc6a5c; }
.effect-time.urgent .effect-time-dot {
  background: #cc6a5c;
  box-shadow: 0 0 0 3px rgba(204, 106, 92, 0.16);
  animation: effect-pulse 1.6s ease-in-out infinite;
}
.effect-remove {
  flex: 0 0 auto;
  opacity: 0;
  pointer-events: none;
  transform: translateX(4px) scale(0.92);
  transition: opacity 0.18s ease, transform 0.18s ease, color 0.15s ease;
}
.effect-remove :deep(svg) { flex-shrink: 0; }
.effect-card:hover .effect-remove,
.effect-card:focus-within .effect-remove {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0) scale(1);
}
.effects-empty {
  min-height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.54);
  color: var(--text-secondary);
  font-size: 12px;
}
.effects-empty svg { width: 18px; height: 18px; color: var(--accent-light); }
.effects-loading .loading-spinner {
  width: 14px;
  height: 14px;
  border-width: 2px;
}
@keyframes effect-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.25); opacity: 0.72; }
}

.items-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
  gap: 14px;
}
.item-card {
  background: #fffdf9;
  border-radius: 14px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  box-shadow: var(--glass-shadow);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  cursor: pointer;
}
.item-card:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08); }
.item-card:focus-visible { outline: 2px solid var(--accent-light); outline-offset: 1px; }

.item-image {
  position: relative;
  aspect-ratio: 1;
  border-radius: 10px;
  background: #f5efe7;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.item-image img { width: 100%; height: 100%; object-fit: cover; }
.item-drawing { display: flex; flex-direction: column; align-items: center; gap: 6px; font-size: 11px; color: var(--text-secondary); }
.item-name { margin-top: 10px; font-weight: 700; font-size: 14px; color: var(--text-bright); }
.item-desc {
  margin: 5px 0 10px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.item-actions { display: flex; gap: 6px; margin-top: auto; }

.items-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 0 36px;
  gap: 4px;
}
.empty-title { margin: 8px 0 0; font-weight: 600; color: var(--text-primary); }
.empty-hint { margin: 0; font-size: 12px; color: var(--text-secondary); }

.loading-state { display: flex; flex-direction: column; align-items: center; padding: 48px 0; gap: 10px; color: var(--text-secondary); font-size: 13px; }

.loading-spinner {
  width: 22px;
  height: 22px;
  border: 2.5px solid #e7ddd2;
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: bp-spin 0.8s linear infinite;
}
.loading-spinner.sm { width: 14px; height: 14px; border-width: 2px; }
@keyframes bp-spin { to { transform: rotate(360deg); } }

/* ── 道具详情（二级层）：近实心衬底，聚焦详情内容 ── */
.item-detail-overlay {
  position: absolute;
  inset: 0;
  background: #f6f2eef1;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 6;
}
.item-detail-dialog {
  background: #fffdf9;
  border-radius: 16px;
  padding: 16px;
  width: min(430px, 90%);
  max-height: 84%;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
}
.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 700;
  color: var(--text-bright);
  margin-bottom: 8px;
}
.detail-body { overflow-y: auto; display: flex; flex-direction: column; align-items: center; padding: 12px; }
.detail-image {
  width: 208px;
  height: 208px;
  border-radius: 16px;
  background: #f5efe7;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
}
.detail-image img { width: 100%; height: 100%; object-fit: cover; }
.detail-name-row { display: flex; align-items: center; gap: 8px; }
.detail-name { font-weight: 700; font-size: 16px; color: var(--text-bright); }
.detail-kind { margin-top: 6px; font-size: 12px; color: var(--accent); font-weight: 600; }
.detail-desc { margin: 10px 0 0; font-size: 13px; line-height: 1.7; color: var(--text-primary); text-align: center; }
.detail-actions { display: flex; gap: 10px; margin-top: 14px; justify-content: center; }

/* 详情过渡：遮罩渐入渐出，面板从下方轻轻浮起 */
.detail-fade-enter-active, .detail-fade-leave-active { transition: opacity 0.22s ease; }
.detail-fade-enter-active .item-detail-dialog, .detail-fade-leave-active .item-detail-dialog { transition: transform 0.22s ease; }
.detail-fade-enter-from, .detail-fade-leave-to { opacity: 0; }
.detail-fade-enter-from .item-detail-dialog, .detail-fade-leave-to .item-detail-dialog { transform: scale(0.95) translateY(12px); }

/* ── 角色选择层 ── */
.char-picker-overlay {
  position: absolute;
  inset: 0;
  background: #f6f2eef1;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 7;
}
.char-picker-dialog {
  background: #fffdf9;
  border-radius: 16px;
  padding: 16px;
  width: min(420px, 88%);
  max-height: 70%;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
}
.char-picker-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 700;
  color: var(--text-bright);
  margin-bottom: 12px;
}
.char-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 10px;
  overflow-y: auto;
}
.char-card { cursor: pointer; border-radius: 12px; transition: background 0.15s; }
.char-card:hover { background: #f5efe7; }
.char-card-inner { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 6px; }
.char-avatar { width: 52px; height: 52px; border-radius: 50%; object-fit: cover; }
.char-avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-light);
  color: #fff;
  font-weight: 700;
  font-size: 18px;
}
.char-name { font-size: 12px; color: var(--text-primary); text-align: center; }

/* ── 弹窗 Transition ── */
.backpack-fade-enter-active, .backpack-fade-leave-active { transition: opacity 0.25s ease; }
.backpack-fade-enter-active .backpack-modal, .backpack-fade-leave-active .backpack-modal { transition: transform 0.25s ease; }
.backpack-fade-enter-from, .backpack-fade-leave-to { opacity: 0; }
.backpack-fade-enter-from .backpack-modal { transform: scale(0.96) translateY(10px); }
.backpack-fade-leave-to .backpack-modal { transform: scale(0.98); }

.item-list-enter-active { transition: all 0.3s ease; }
.item-list-enter-from { opacity: 0; transform: translateY(8px); }
.item-list-leave-active { transition: all 0.2s ease; }
.item-list-leave-to { opacity: 0; transform: scale(0.9); }
.item-list-move { transition: transform 0.3s cubic-bezier(0.22, 0.61, 0.36, 1); }

.effects-panel-enter-active,
.effects-panel-leave-active { transition: opacity 0.3s ease, transform 0.3s ease; }
.effects-panel-enter-from,
.effects-panel-leave-to { opacity: 0; transform: translateY(-6px); }

.effect-list-enter-active,
.effect-list-leave-active { transition: opacity 0.3s ease, transform 0.3s ease; }
.effect-list-enter-from { opacity: 0; transform: translateY(10px) scale(0.96); }
.effect-list-leave-to { opacity: 0; transform: scale(0.94); }
.effect-list-leave-active { position: absolute; z-index: 0; }
.effect-list-move { transition: transform 0.3s cubic-bezier(0.22, 0.61, 0.36, 1); }

/* 滚动条弱化 */
.items-panel::-webkit-scrollbar { width: 6px; }
.items-panel::-webkit-scrollbar-thumb { background: #ddd2c4; border-radius: 3px; }
.char-grid::-webkit-scrollbar { width: 6px; }
.char-grid::-webkit-scrollbar-thumb { background: #ddd2c4; border-radius: 3px; }
.detail-body::-webkit-scrollbar { width: 6px; }
.detail-body::-webkit-scrollbar-thumb { background: #ddd2c4; border-radius: 3px; }

@media (max-width: 760px) {
  .backpack-modal {
    width: calc(100vw - 20px);
    height: calc(100dvh - 20px);
    max-height: calc(100dvh - 20px);
  }
  .backpack-body {
    flex-direction: column;
    overflow-y: auto;
  }
  .chest-panel {
    width: auto;
    padding: 12px;
  }
  .chest-stage { width: min(264px, 100%); }
  .items-panel { overflow: visible; padding-right: 0; }
}

@media (max-width: 460px) {
  .backpack-header { padding: 14px 16px; }
  .backpack-body {
    margin: 12px;
    padding: 12px;
  }
  .effects-heading { flex-wrap: wrap; }
  .effect-card { align-items: flex-start; }
  .effect-remove { align-self: center; }
}

@media (hover: none), (pointer: coarse) {
  .effect-remove {
    opacity: 1;
    pointer-events: auto;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .effect-time.urgent .effect-time-dot,
  .effect-remove { animation: none; transition: none; }
}
</style>
