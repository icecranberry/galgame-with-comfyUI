<template>
  <div class="backpack-view">
    <!-- ══ Top Bar ══ -->
    <div class="backpack-topbar">
      <linshe-button variant="icon" class="topbar-btn" @click="onBack">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </linshe-button>
      <span class="topbar-title">背包</span>
      <!-- 宝箱冷却中：大卡收起，顶栏只显示剩余时间 -->
      <div v-if="!store.chest.canOpen" class="topbar-chest-timer" title="宝箱冷却中">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 9a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v1H4V9z"/>
          <path d="M4 10h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8z"/>
          <path d="M10 13h4"/>
        </svg>
        <span>{{ countdownText }}</span>
      </div>
    </div>

    <!-- ══ Content ══ -->
    <div class="bp-scroll">
      <div class="bp-content">
        <!-- ── 每日宝箱（就绪时展示，冷却中缩到顶栏只显示时间） ── -->
        <section v-if="store.chest.canOpen" class="bp-chest">
          <div
            class="bp-chest-stage"
            :class="{ 'is-ready': store.chest.canOpen }"
            role="button"
            tabindex="0"
            @click="onOpenChest"
            @keydown.enter.prevent="onOpenChest"
          >
            <ChestSvg state="idle" :ready="store.chest.canOpen"/>
          </div>

          <div class="bp-chest-status">
            <template v-if="!chestProcessActive">每日宝箱已就绪</template>
          </div>

          <linshe-button
            variant="primary" size="lg" block
            :disabled="chestProcessActive"
            @click="onOpenChest"
          >{{ chestButtonLabel }}</linshe-button>
          <p class="bp-chest-hint">每 {{ store.chest.cooldownHours || 16 }} 小时可开启一次</p>
        </section>

        <!-- ── 此刻的角色状态 ── -->
        <section class="bp-section" aria-labelledby="bp-effects-title">
          <div class="bp-heading">
            <span class="bp-heading-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3 13.8 8.2 19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/>
                <path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/>
              </svg>
            </span>
            <div class="bp-title-copy">
              <h4 id="bp-effects-title" class="bp-title">此刻的角色状态</h4>
              <p class="bp-subtitle">芭芭拉魔法~呼啦啦呜~魔仙变~</p>
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

          <div v-else class="bp-effects-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 3 13.8 8.2 19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/>
              <path d="m9 18 .5 1.5L11 20l-1.5.5L9 22l-.5-1.5L7 20l1.5-.5L9 18Z"/>
            </svg>
            <span>目前没有正在生效的效果</span>
          </div>
        </section>

        <!-- ── 我的道具 ── -->
        <section class="bp-section" aria-labelledby="bp-items-title">
          <div class="bp-heading">
            <span class="bp-heading-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                <line x1="12" y1="22.08" x2="12" y2="12"/>
              </svg>
            </span>
            <div class="bp-title-copy">
              <h4 id="bp-items-title" class="bp-title">我的道具</h4>
              <p class="bp-subtitle">对角色使用，或忍痛丢弃</p>
            </div>
          </div>

          <div v-if="store.loading && store.items.length === 0" class="bp-loading">
            <span class="loading-spinner"></span>
            <p>打开背包中…</p>
          </div>

          <div v-else-if="store.items.length === 0" class="bp-items-empty">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#8a7a6a" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" opacity="0.6">
              <path d="M4 9a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v1H4V9z"/>
              <path d="M4 10h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8z"/>
              <path d="M10 13h4"/>
            </svg>
            <p class="empty-title">背包还是空的</p>
            <p class="empty-hint">{{ store.chest.canOpen ? '去上面的宝箱看看吧' : '宝箱冷却中，就绪后再来看看吧' }}</p>
          </div>

          <TransitionGroup v-else name="item-list" tag="div" class="bp-items-grid">
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
        </section>
      </div>
    </div>

    <!-- ── 道具详情（底部抽屉） ── -->
    <Transition name="sheet-fade">
      <div v-if="detailItem" class="bp-sheet-overlay" @click.self="detailItem = null">
        <div class="bp-sheet">
          <div class="sheet-grab" aria-hidden="true"></div>
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

    <!-- ── 角色选择（底部抽屉） ── -->
    <Transition name="sheet-fade">
      <div v-if="showCharPicker" class="bp-sheet-overlay" @click.self="cancelPick">
        <div class="bp-sheet">
          <div class="sheet-grab" aria-hidden="true"></div>
          <div class="picker-header">
            <span>对谁使用「{{ pendingItem?.name }}」？</span>
            <linshe-button variant="icon" @click="cancelPick">&times;</linshe-button>
          </div>
          <div class="char-grid">
            <div v-for="char in sortedCharacters" :key="char.id" class="char-card" @click="pickCharacter(char)">
              <div class="char-card-inner">
                <img v-if="char.avatar_path" :src="char.avatar_path" class="char-avatar"/>
                <span v-else class="char-avatar char-avatar-fallback">{{ (char.display_name || char.name || '?')[0] }}</span>
                <span class="char-name">{{ char.display_name || char.name }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

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
  </div>
</template>

<script setup>
import { computed, inject, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import LinsheButton from '../components/ui/LinsheButton.vue'
import ChestSvg from '../components/ChestSvg.vue'
import ItemFallbackIcon from '../components/ItemFallbackIcon.vue'
import ChestRevealOverlay from '../components/ChestRevealOverlay.vue'
import { useBackpackActions, ITEM_KIND_LABELS as KIND_LABELS } from '../composables/useBackpackActions.js'
import { useChatStore } from '../stores/chat.js'

const router = useRouter()
const toast = inject('toast')
const confirm = inject('confirm')
const isMobile = inject('isMobile')
const toggleMobileSidebar = inject('toggleMobileSidebar')
const chat = useChatStore()

const {
  store,
  fullscreen, chestAnim, chestProcessActive, chargeBoost, flashOn,
  revealedItem, collecting,
  onOpenChest, onCollectFromReveal,
  chestButtonLabel, countdownText, startCountdown, stopCountdown,
  effectKindLabel, effectIconPath, effectRemainingText, isEffectUrgent,
  removingEffectId, onRemoveEffect,
  detailItem, openDetail, startUse,
  showCharPicker, pendingItem, cancelPick, pickCharacter,
  onDiscard,
} = useBackpackActions({ confirm, toast })

const sortedCharacters = computed(() =>
  [...chat.characters].sort((a, b) =>
    (a.display_name || '').localeCompare(b.display_name || '', 'zh-CN')
  )
)

onMounted(() => {
  store.startPolling()
  startCountdown()
})
onUnmounted(() => {
  store.stopPolling()
  stopCountdown()
})

function onBack() {
  // 与相册等 more-menu 入口页一致：移动端左上角回到角色列表
  if (isMobile?.value && toggleMobileSidebar) toggleMobileSidebar()
  else router.back()
}
</script>

<style scoped>
.backpack-view {
  height: 100vh; height: 100dvh;
  flex: 1;
  display: flex; flex-direction: column;
  overflow: hidden;
  background: var(--bg-primary);
  position: relative;
}

/* ═══════════════════════════════════════
   Top Bar（与信箱页同构；标题绝对居中，右侧可挂宝箱冷却计时）
   ═══════════════════════════════════════ */
.backpack-topbar {
  position: relative;
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 8px 12px 4px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  background: var(--bg-primary);
  z-index: 10;
}
.topbar-btn {
  width: 40px; height: 40px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.topbar-title {
  position: absolute;
  left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  font-size: 17px; font-weight: 600; color: var(--text-bright);
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.topbar-chest-timer {
  display: flex; align-items: center; gap: 5px;
  margin-right: 4px;
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(var(--accent-rgb), 0.1);
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.topbar-chest-timer svg { flex-shrink: 0; }

/* ═══════════════════════════════════════
   Content：手机版式，宽屏时居中成手机宽度
   ═══════════════════════════════════════ */
.bp-scroll {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.bp-scroll::-webkit-scrollbar { display: none; }
.bp-content {
  max-width: 560px;
  margin: 0 auto;
  padding: 14px 16px calc(28px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 22px;
}

/* ── 每日宝箱 ── */
.bp-chest {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 16px 16px;
  border-radius: 16px;
  background: var(--bg-secondary);
  box-shadow: 0 2px 14px rgba(122, 91, 63, 0.04);
}
.bp-chest-stage { width: min(220px, 62%); }
.bp-chest-stage.is-ready { cursor: pointer; }
.bp-chest-stage.is-ready:hover { filter: brightness(1.05); }
.bp-chest-stage:focus-visible { outline: 2px solid var(--accent-light); outline-offset: 2px; border-radius: 12px; }
.bp-chest-status {
  margin: 6px 0 14px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  min-height: 20px;
}
.bp-chest-hint { margin: 10px 0 0; font-size: 12px; color: var(--text-secondary); }

/* ── 分区标题 ── */
.bp-section { display: flex; flex-direction: column; }
.bp-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 13px;
}
.bp-heading-icon {
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
.bp-heading-icon svg { width: 20px; height: 20px; }
.bp-title-copy { min-width: 0; }
.bp-title {
  margin: 0;
  font-size: 16px;
  line-height: 1.35;
  font-weight: 700;
  color: var(--text-primary);
}
.bp-subtitle {
  margin: 3px 0 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-secondary);
}

/* ── 道具网格 ── */
.bp-items-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}
.item-card {
  background: var(--bg-secondary);
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
  background: var(--bg-tertiary);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.item-image img { width: 100%; height: 100%; object-fit: cover; }
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
.item-actions > * { flex: 1; }

.bp-items-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 34px 0 26px;
  gap: 4px;
  border-radius: 16px;
  background: rgba(var(--accent-rgb), 0.04);
}
.empty-title { margin: 8px 0 0; font-weight: 600; color: var(--text-primary); }
.empty-hint { margin: 0; font-size: 12px; color: var(--text-secondary); }

.bp-loading {
  display: flex; flex-direction: column; align-items: center;
  padding: 40px 0; gap: 10px;
  color: var(--text-secondary); font-size: 13px;
}

.loading-spinner {
  width: 22px;
  height: 22px;
  border: 2.5px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: bp-spin 0.8s linear infinite;
}
@keyframes bp-spin { to { transform: rotate(360deg); } }

/* ── 生效中效果 ── */
.effect-list {
  display: flex;
  flex-direction: column;
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
@keyframes effect-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.25); opacity: 0.72; }
}
.effect-remove { flex: 0 0 auto; }
.bp-effects-empty {
  min-height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 12px;
  background: rgba(255, 253, 250, 0.55);
  color: var(--text-secondary);
  font-size: 12px;
}
.bp-effects-empty svg { width: 18px; height: 18px; color: var(--accent-light); }

/* ── 底部抽屉（详情 / 角色选择）：近实心衬底，聚焦内容 ── */
.bp-sheet-overlay {
  position: absolute;
  inset: 0;
  background: #f6f2eef1;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 20;
}
.bp-sheet {
  width: min(560px, 100%);
  max-height: 88%;
  background: #fffdf9;
  border-radius: 20px 20px 0 0;
  padding: 10px 16px calc(16px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.12);
  overflow: hidden;
}
.sheet-grab {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: #e3d9cd;
  margin: 2px auto 10px;
  flex-shrink: 0;
}
.detail-body {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px 2px 2px;
}
.detail-image {
  width: 176px;
  height: 176px;
  border-radius: 16px;
  background: #f5efe7;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
  flex-shrink: 0;
}
.detail-image img { width: 100%; height: 100%; object-fit: cover; }
.detail-name-row { display: flex; align-items: center; gap: 8px; }
.detail-name { font-weight: 700; font-size: 16px; color: var(--text-bright); }
.detail-kind { margin-top: 6px; font-size: 12px; color: var(--accent); font-weight: 600; }
.detail-desc { margin: 10px 0 0; font-size: 13px; line-height: 1.7; color: var(--text-primary); text-align: center; }
.detail-actions { display: flex; gap: 10px; margin-top: 16px; width: 100%; }
.detail-actions > * { flex: 1; }

.picker-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  color: var(--text-bright);
  margin-bottom: 12px;
  flex-shrink: 0;
}
.char-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
  gap: 8px;
  overflow-y: auto;
  padding-bottom: 4px;
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
.char-name {
  font-size: 12px;
  color: var(--text-primary);
  text-align: center;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 抽屉过渡：遮罩渐隐，面板自下而上滑入 */
.sheet-fade-enter-active, .sheet-fade-leave-active { transition: opacity 0.22s ease; }
.sheet-fade-enter-active .bp-sheet, .sheet-fade-leave-active .bp-sheet { transition: transform 0.26s cubic-bezier(0.32, 0.72, 0.35, 1); }
.sheet-fade-enter-from, .sheet-fade-leave-to { opacity: 0; }
.sheet-fade-enter-from .bp-sheet, .sheet-fade-leave-to .bp-sheet { transform: translateY(60%); }

/* ── 列表过渡 ── */
.item-list-enter-active { transition: all 0.3s ease; }
.item-list-enter-from { opacity: 0; transform: translateY(8px); }
.item-list-leave-active { transition: all 0.2s ease; }
.item-list-leave-to { opacity: 0; transform: scale(0.9); }
.item-list-move { transition: transform 0.3s cubic-bezier(0.22, 0.61, 0.36, 1); }

.effect-list-enter-active,
.effect-list-leave-active { transition: opacity 0.3s ease, transform 0.3s ease; }
.effect-list-enter-from { opacity: 0; transform: translateY(10px) scale(0.96); }
.effect-list-leave-to { opacity: 0; transform: scale(0.94); }
.effect-list-leave-active { position: absolute; z-index: 0; }
.effect-list-move { transition: transform 0.3s cubic-bezier(0.22, 0.61, 0.36, 1); }

/* 滚动条弱化 */
.detail-body::-webkit-scrollbar { width: 6px; }
.detail-body::-webkit-scrollbar-thumb { background: #ddd2c4; border-radius: 3px; }
.char-grid::-webkit-scrollbar { width: 6px; }
.char-grid::-webkit-scrollbar-thumb { background: #ddd2c4; border-radius: 3px; }

@media (prefers-reduced-motion: reduce) {
  .effect-time.urgent .effect-time-dot { animation: none; }
}
</style>
