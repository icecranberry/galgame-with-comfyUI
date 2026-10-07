<template>
  <Teleport to="body">
    <Transition name="ss-fade">
      <div v-if="open" class="ss-mask" @click.self="close">
        <section class="ss-frame" role="dialog" aria-modal="true" :aria-label="title">
          <header class="ss-sign">
            <span class="ss-sign-kicker">店铺</span>
            <h2 class="ss-sign-title">{{ title }}</h2>
            <button type="button" class="ss-close" aria-label="离开店铺" @click="close">✕</button>
          </header>

          <div class="ss-body">
            <!-- 成交反馈：付钱/服务完成后在这里告诉玩家拿到了什么 -->
            <Transition name="ss-feedback">
              <div v-if="feedback" class="ss-feedback" role="status">
                <span class="ss-feedback-badge" aria-hidden="true">✓</span>
                <span class="ss-feedback-text">{{ feedback }}</span>
              </div>
            </Transition>
            <p v-if="loading" class="ss-state">正在推开门</p>
            <p v-else-if="error" class="ss-state is-error" role="alert">
              {{ error }}
              <button type="button" class="ss-retry" @click="load">再看一眼</button>
            </p>
            <p v-else-if="!features.length" class="ss-state">这家店还没有能办的事。</p>

            <!-- 菜单 ↔ 功能面板切换：out-in 淡出旧块、新块上滑入场 -->
            <template v-else>
              <Transition name="ss-swap" mode="out-in">
                <div v-if="!active" key="menu" class="ss-menu">
                  <button v-for="f in features" :key="f.featureId" type="button" class="ss-slot" @click="active = f">
                    <span v-if="f.categoryLabel" class="ss-chip">{{ f.categoryLabel }}</span>
                    <span class="ss-slot-title">{{ f.title }}</span>
                    <span class="ss-slot-hint">{{ f.description }}</span>
                    <span class="ss-slot-price">{{ f.price > 0 ? `${f.price} 金币` : '免费' }}</span>
                  </button>
                </div>

                <div v-else :key="active.featureId" class="ss-panel">
                  <button type="button" class="ss-back" @click="backToMenu"> 换个项目</button>
                  <TownBuildingFeatureContent
                    :event="syntheticEvent" :scope="scope"
                    @completed="onCompleted" @dismissed="close" @refresh="load"
                  />
                </div>
              </Transition>
            </template>
          </div>

          <footer class="ss-foot">
            <button
              type="button" class="ss-pixel-btn" :class="{ 'is-busy': refreshing }"
              :disabled="refreshing || !refreshable"
              :title="refreshable ? '重抽这家店的外观与商品，并把货架补满' : '这家店没有可以刷新的货架'"
              @click="refreshStock"
            >{{ refreshing ? '换货中…' : '刷新商品 · 10 金币' }}</button>
            <span class="ss-foot-hint">{{ footHint }}</span>
            <button type="button" class="ss-pixel-btn is-quiet" @click="close">离开</button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
// 小镇内的店铺舞台：不跳奇遇页，所有成交都在这里走 quote  execute。
// 各店专属面板由 TownBuildingFeatureContent 按 templateId 分发到 shop/panels/（签筒/抽奖机/格子货架/衣柜/相框墙）。
import { computed, inject, ref, watch } from 'vue'
import TownBuildingFeatureContent from '../TownBuildingFeatureContent.vue'
import { fetchBuildingFeatures, refreshBuildingFeatureStock } from '../../../api/townBuildingFeatures.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  locationKey: { type: String, default: '' },
  mapId: { type: Number, default: null },
  worldId: { type: String, default: '' },
  worldEpoch: { type: Number, default: 0 },
  buildingName: { type: String, default: '店铺' },
  /** 从对话窗直接点某一项时带上，留空则先给木牌菜单 */
  featureId: { type: String, default: '' },
})
const emit = defineEmits(['close', 'changed'])
const toast = inject('toast')

const features = ref([])
const loading = ref(false)
const error = ref('')
const active = ref(null)
const refreshing = ref(false)
// 成交反馈：付钱/服务完成后展示「拿到了什么」，6 秒后自动收起
const feedback = ref('')
let feedbackTimer = null

const title = computed(() => props.buildingName || '店铺')
const scope = computed(() => ({ worldId: props.worldId, worldEpoch: props.worldEpoch }))
const SHOP_TEMPLATES = ['outfit_change', 'hairstyle_change', 'accessory_change', 'temporary_transform',
  'item_purchase', 'item_exchange', 'item_recycle']
const refreshable = computed(() => features.value.some(f => SHOP_TEMPLATES.includes(f.templateId)))
const footHint = computed(() => (refreshable.value
  ? '刷新会重抽店里的外观与商品，并把货架补满'
  : '这家店没有可以刷新的货架'))

function showError(err) {
  return ({
    FEATURE_UNCONFIGURED: '这家店还没有配置好，先去「建筑」里生成一次。',
    TEMPLATE_UNAVAILABLE: '这家店的货架类型不支持刷新。',
    INSUFFICIENT_FUNDS: '金币不够刷新了。',
    NOT_ARRIVED: '只能在自己所在的小镇里逛店。',
    STALE_EPOCH: '小镇已经变过了，重新进来看看。',
    SOURCE_CHANGED: '这栋建筑刚被改过，重新打开一次。',
  })[err?.code] || err?.message || '这次没办成，稍后再试。'
}

const resourceNames = ref({})
/** 把功能视图拼成内容组件认识的形态（旧事件 DTO 的子集，不再有事件载体） */
function optionsOf(feature) {
  const params = feature.params || {}
  if (Array.isArray(params.options)) {
    return params.options.map(o => ({ key: o.key, label: o.label, ...(o.flavor ? { flavor: o.flavor } : {}) }))
  }
  if (Array.isArray(params.offers)) {
    return params.offers.map(o => ({ key: o.resourceKey || o.giveResourceKey, label: o.label,
      ...(o.priceTier ? { priceTier: o.priceTier } : {}) }))
  }
  // 奖池条目没有自带名称，用资源目录名兜底
  if (Array.isArray(params.pool)) {
    return params.pool.map(p => ({ key: p.resourceKey, label: p.label || resourceNames.value[p.resourceKey] || p.resourceKey }))
  }
  if (Array.isArray(params.themes)) return params.themes.map(t => ({ key: t.key, label: t.label, scene: t.scene }))
  if (Array.isArray(params.entries)) return params.entries.map(e => ({ key: e.key, label: e.title }))
  return []
}
const syntheticEvent = computed(() => {
  const f = active.value
  if (!f) return null
  return {
    id: null,
    buildingInstanceId: `${props.mapId}:${props.locationKey}`,
    mapId: props.mapId,
    worldId: props.worldId,
    worldEpoch: props.worldEpoch,
    featureId: f.featureId,
    templateId: f.templateId,
    rendererKey: f.rendererKey,
    supportedTargetKinds: f.supportedTargetKinds || [],
    options: optionsOf(f),
    opening: f.presentation?.opening || '',
    description: f.description || '',
    price: f.price || 0,
    priceTier: f.priceTier,
    status: 'open',
    result: null,
  }
})

async function load() {
  if (!props.locationKey) return
  loading.value = true; error.value = ''
  try {
    const view = await fetchBuildingFeatures(props.locationKey, props.mapId)
    resourceNames.value = view.resourceNames || {}
    features.value = (view.features || [])
    const wanted = props.featureId ? features.value.find(f => f.featureId === props.featureId) : null
    active.value = wanted || (features.value.length === 1 ? features.value[0] : null)
  } catch (err) { error.value = showError(err); features.value = []; active.value = null }
  finally { loading.value = false }
}
function backToMenu() { active.value = features.value.length === 1 ? features.value[0] : null }
function close() { emit('close') }
function feedbackText(operation) {
  const summary = operation?.result?.summary
  if (summary) return summary
  switch (operation?.templateId) {
    case 'item_purchase': return '已购买，物品放进了背包'
    case 'item_exchange': return '交换成功，新物品已放进背包'
    case 'item_recycle': return '回收成功，金币已到账'
    case 'daily_fortune': return `抽到了「${operation?.result?.title || '签'}」`
    case 'portrait_single': case 'portrait_pair': case 'illustrated_keepsake':
      return '作品已完成，请收好'
    default: return '办理完成'
  }
}
function onCompleted(operation) {
  emit('changed')
  feedback.value = feedbackText(operation)
  clearTimeout(feedbackTimer)
  feedbackTimer = setTimeout(() => { feedback.value = '' }, 6000)
  load()
}

async function refreshStock() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    const result = await refreshBuildingFeatureStock(props.locationKey, { mapId: props.mapId })
    toast?.(`货架换了新货：重抽了 ${result.refreshed} 项，补了 ${result.restocked} 件`, 'success', 5000)
    emit('changed')
    await load()
  } catch (err) { toast?.(showError(err), 'error', 5000) }
  finally { refreshing.value = false }
}

watch(() => [props.open, props.locationKey, props.featureId], ([open]) => {
  if (open) load()
  else { features.value = []; active.value = null; error.value = ''; resourceNames.value = {} }
})
</script>

<style scoped>
/* 弹出门：遮罩淡入，店铺框体按 x/y 轴错位果冻弹入（同 LinsheButton 口径）；离开整体缩下淡出 */
.ss-fade-enter-active { transition: opacity .18s ease; }
.ss-fade-enter-active .ss-frame { animation: ss-jelly .3s cubic-bezier(.3, 1.15, .4, 1); }
.ss-fade-leave-active { transition: opacity .26s ease .04s; }
.ss-fade-leave-active .ss-frame { transition: transform .26s ease, opacity .26s ease; }
.ss-fade-enter-from, .ss-fade-leave-to { opacity: 0; }
.ss-fade-leave-to .ss-frame { transform: scale(.94) translateY(10px); opacity: 0; }
@keyframes ss-jelly {
  0% { transform: scale(.96) translateY(14px); opacity: 0; }
  45% { transform: scale(1.04, .96) translateY(0); opacity: 1; }
  72% { transform: scale(.992, 1.008); }
  100% { transform: scale(1); }
}
/* 菜单 ↔ 功能面板内容切换：旧块淡出、新块上滑入场 */
.ss-swap-enter-active { transition: opacity .24s ease, transform .24s cubic-bezier(.22,.61,.36,1); }
.ss-swap-leave-active { transition: opacity .14s ease; }
.ss-swap-enter-from { opacity: 0; transform: translateY(10px); }
.ss-swap-leave-to { opacity: 0; }
/* 成交反馈横幅：金底像素卡，顶部滑入 */
.ss-feedback {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px; margin-bottom: 4px;
  background: linear-gradient(#f0c987, #dba757); color: #4a2f14;
  border: 3px solid #17100a; box-shadow: inset 0 0 0 2px #ffffff44, 0 3px 0 #17100a;
  font-size: 13px; font-weight: 700; line-height: 1.5;
}
.ss-feedback-badge {
  width: 22px; height: 22px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  background: #2e2013; color: #ffd98a; font-size: 12px; border: 2px solid #17100a;
}
.ss-feedback-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.ss-feedback-enter-active { transition: opacity .25s ease, transform .25s cubic-bezier(.34, 1.56, .64, 1); }
.ss-feedback-leave-active { transition: opacity .3s ease; }
.ss-feedback-enter-from { opacity: 0; transform: translateY(-12px); }
.ss-feedback-leave-to { opacity: 0; }
.ss-mask { position: fixed; inset: 0; z-index: 10040; display: flex; align-items: center; justify-content: center; padding: 12px; background: #1d140bcc; box-sizing: border-box; }
.ss-frame {
  width: min(680px, 100%); max-height: calc(100dvh - 24px); display: flex; flex-direction: column;
  background: #2e2013; color: #f3e2c7; border: 3px solid #17100a;
  box-shadow: 0 0 0 3px #7a5127, 0 12px 32px #00000066;
}
.ss-sign {
  display: flex; align-items: center; gap: 10px; padding: 12px 16px;
  background: repeating-linear-gradient(90deg, #00000010 0 2px, #00000000 2px 7px), linear-gradient(#a4703a, #8a5a2b);
  border-bottom: 3px solid #17100a;
}
.ss-sign-kicker { font-size: 11px; letter-spacing: .3em; color: #f7dfae; text-shadow: 1px 1px 0 #4a2f14; }
.ss-sign-title { flex: 1; margin: 0; font-size: 18px; font-weight: 700; color: #fff4d8; text-shadow: 2px 2px 0 #4a2f14; }
.ss-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 14px 16px; background: #3a2a19; }
.ss-state { font-size: 13px; color: #d9c3a2; }
.ss-state.is-error { color: #ffb4a2; }
.ss-retry { margin-left: 8px; padding: 0; font: inherit; font-size: 12px; color: #ffd98a; background: none; border: none; text-decoration: underline; cursor: pointer; }
.ss-menu { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
.ss-slot {
  display: flex; flex-direction: column; gap: 4px; align-items: flex-start; padding: 12px;
  background: linear-gradient(#c79a63, #b07d4a); color: #2e2013; border: 3px solid #17100a;
  box-shadow: inset 0 0 0 2px #ffffff30, 0 3px 0 #17100a; cursor: pointer; font: inherit; text-align: left;
}
.ss-slot:hover { background: linear-gradient(#d9ab72, #bd8a54); }
.ss-slot:active { transform: translateY(2px); box-shadow: inset 0 0 0 2px #ffffff30, 0 1px 0 #17100a; }
.ss-chip { align-self: flex-start; padding: 1px 6px; font-size: 11px; font-weight: 700; background: #2e2013; color: #ffd98a; border: 2px solid #17100a; }
.ss-slot-title { font-size: 14px; font-weight: 700; }
.ss-slot-hint { font-size: 11px; opacity: .8; line-height: 1.4; }
.ss-slot-price { font-size: 11px; font-weight: 700; color: #6b3f0d; }
.ss-panel { display: flex; flex-direction: column; gap: 8px; }
.ss-back { align-self: flex-start; padding: 4px 8px; font: inherit; font-size: 12px; cursor: pointer; background: #4a3520; color: #f0d9b5; border: 2px solid #17100a; }
.ss-close {
  width: 28px; height: 28px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  padding: 0; font: inherit; font-size: 13px; line-height: 1; cursor: pointer;
  background: #4a3520; color: #f0d9b5; border: 2px solid #17100a; box-shadow: inset 0 0 0 2px #ffffff22;
}
.ss-close:hover { background: #5d4327; }
/* 底部操作也走木牌像素风（游戏化控件，不套糖纸按钮） */
.ss-pixel-btn {
  padding: 6px 12px; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
  background: linear-gradient(#c79a63, #b07d4a); color: #2e2013;
  border: 2px solid #17100a; box-shadow: inset 0 0 0 2px #ffffff30, 0 2px 0 #17100a;
}
.ss-pixel-btn:hover:not(:disabled) { background: linear-gradient(#d9ab72, #bd8a54); }
.ss-pixel-btn:active:not(:disabled) { transform: translateY(2px); box-shadow: inset 0 0 0 2px #ffffff30, 0 0 0 #17100a; }
.ss-pixel-btn.is-quiet { background: #4a3520; color: #f0d9b5; box-shadow: inset 0 0 0 2px #ffffff22, 0 2px 0 #17100a; }
.ss-pixel-btn.is-quiet:hover:not(:disabled) { background: #5d4327; }
.ss-pixel-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.ss-pixel-btn.is-busy { animation: ss-blink 1s steps(2, end) infinite; }
@keyframes ss-blink { 50% { opacity: 0.75; } }
.ss-foot { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: #241a0f; border-top: 3px solid #17100a; flex-wrap: wrap; }
.ss-foot-hint { flex: 1; font-size: 11px; color: #a8916f; }
/* 把内层各店面板从暖纸拉到木牌配色（.bf-field 是布局组不刷盒子，标签和卡片直接落在深木底上） */
.ss-panel :deep(.bf-result), .ss-panel :deep(.bf-shelf), .ss-panel :deep(.bf-swap),
.ss-panel :deep(.bf-buyback), .ss-panel :deep(.bf-frames), .ss-panel :deep(.bf-keepsake),
.ss-panel :deep(.bf-wardrobe), .ss-panel :deep(.bf-machine), .ss-panel :deep(.bf-shrine),
.ss-panel :deep(.bf-gallery), .ss-panel :deep(.bf-cast-card),
.ss-panel :deep(.bf-state-card), .ss-panel :deep(.bf-prize),
.ss-panel :deep(.bf-frame-card), .ss-panel :deep(.bf-wardrobe-card), .ss-panel :deep(.bf-shelf-row.is-cell),
.ss-panel :deep(.bf-swap-item), .ss-panel :deep(.bf-swap-give), .ss-panel :deep(.bf-format-chip),
.ss-panel :deep(.bf-preview-frame), .ss-panel :deep(.bf-cell-icon) {
  background: #c79a63; border: 3px solid #17100a; border-radius: 0; color: #2e2013;
  box-shadow: inset 0 0 0 2px #ffffff30;
}
/* 卡片网格（衣柜/相框墙/格子货架）的格缝走深木色：卡片自身保持木牌底色，
   只有卡片之间的底色不能再跟卡片同色（否则整块读成一片浅木黄，看不出是格子） */
.ss-panel :deep(.bf-wardrobe), .ss-panel :deep(.bf-frames),
.ss-panel :deep(.bf-shelf.is-grid) { background: #2e2013; }
/* 选中态：金描边像素高亮，去掉暖纸的粉环与位移 */
.ss-panel :deep(.bf-frame-card.is-picked), .ss-panel :deep(.bf-wardrobe-card.is-picked),
.ss-panel :deep(.bf-shelf-row.is-cell.is-picked), .ss-panel :deep(.bf-swap-item.is-picked),
.ss-panel :deep(.bf-format-chip.is-picked), .ss-panel :deep(.bf-state-card.is-picked),
.ss-panel :deep(.bf-prize.is-sold-out) {
  transform: none;
}
.ss-panel :deep(.bf-frame-card.is-picked), .ss-panel :deep(.bf-wardrobe-card.is-picked),
.ss-panel :deep(.bf-shelf-row.is-cell.is-picked), .ss-panel :deep(.bf-swap-item.is-picked),
.ss-panel :deep(.bf-format-chip.is-picked), .ss-panel :deep(.bf-state-card.is-picked) {
  border-color: #ffd98a; box-shadow: inset 0 0 0 2px #ffd98a;
}
/* 木底上的价格/徽章用深木色，别用暖纸粉 */
.ss-panel :deep(.bf-cell-price), .ss-panel :deep(.bf-buyback-estimate), .ss-panel :deep(.bf-state-duration),
.ss-panel :deep(.bf-wardrobe-badge), .ss-panel :deep(.ls-select-label.placeholder) { color: #6b3f0d; }
/* 表单控件（LinsheSelect / LinsheInput）同样落木牌皮肤 */
.ss-panel :deep(.ls-select-trigger), .ss-panel :deep(.ls-select-dropdown), .ss-panel :deep(.ls-select-option),
.ss-panel :deep(.ls-select-search-input), .ss-panel :deep(.ls-input) {
  background: #c79a63; border: 2px solid #17100a; border-radius: 0; color: #2e2013;
  box-shadow: none;
}
.ss-panel :deep(.ls-select-option:hover) { background: #d9ab72; }
.ss-panel :deep(.ls-input::placeholder), .ss-panel :deep(.ls-select-search-input::placeholder) { color: #6b3f0d; opacity: .8; }
/* 确认办理 / 改天再说（TownVnChoice）同样落木牌像素风：方角 + 3px 硬边 + 底部厚度 */
.ss-panel :deep(.vn-choice) {
  border: 3px solid #17100a; border-radius: 0; color: #2e2013;
  background: linear-gradient(#c79a63, #b07d4a);
  box-shadow: inset 0 0 0 2px #ffffff30, 0 3px 0 #17100a;
}
.ss-panel :deep(.vn-choice__hint) { color: #6b3f0d; }
.ss-panel :deep(.vn-choice.is-primary) {
  background: linear-gradient(#f0c987, #dba757); color: #4a2f14;
}
.ss-panel :deep(.vn-choice.is-primary .vn-choice__hint) { color: #4a2f14; }
.ss-panel :deep(.vn-choice:hover:not(.is-disabled):not(.is-busy)) { background: linear-gradient(#d9ab72, #bd8a54); }
.ss-panel :deep(.vn-choice.is-primary:hover:not(.is-disabled):not(.is-busy)) { background: linear-gradient(#f6d49a, #e2b265); }
.ss-panel :deep(.vn-choice:active:not(.is-disabled):not(.is-busy)) {
  transform: translateY(2px); box-shadow: inset 0 0 0 2px #ffffff30, 0 1px 0 #17100a;
}
.ss-panel :deep(.vn-choice.is-disabled), .ss-panel :deep(.vn-choice.is-busy) {
  opacity: .55; cursor: not-allowed; box-shadow: inset 0 0 0 2px #ffffff30, 0 2px 0 #17100a;
}
/* 状态变体（hover/active/选中/禁用）的糖纸底厚 #d8c1a1 一并压掉，防止淡黄线漏出 */
.ss-panel :deep(.vn-choice:hover:not(.is-disabled)),
.ss-panel :deep(.vn-choice:focus-visible:not(.is-disabled)) {
  background: linear-gradient(#d9ab72, #bd8a54); filter: none; transform: none;
  box-shadow: inset 0 0 0 2px #ffffff30, 0 3px 0 #17100a;
}
.ss-panel :deep(.vn-choice:active:not(.is-disabled)) {
  background: linear-gradient(#d9ab72, #bd8a54);
  box-shadow: inset 0 0 0 2px #ffffff30, 0 1px 0 #17100a;
}
.ss-panel :deep(.vn-choice.is-disabled),
.ss-panel :deep(.vn-choice.is-busy),
.ss-panel :deep(.vn-choice.is-active) {
  box-shadow: inset 0 0 0 2px #ffffff30, 0 3px 0 #17100a;
}
.ss-panel :deep(.vn-choice.is-active) { border-color: #ffd98a; }
.ss-panel :deep(.bf-field-label), .ss-panel :deep(.bf-opening), .ss-panel :deep(.bf-desc) { color: #f0d9b5; }
.ss-panel :deep(.bf-pending), .ss-panel :deep(.bf-quote) { color: #d9c3a2; }
@media (prefers-reduced-motion: reduce) {
  .ss-fade-enter-active, .ss-fade-leave-active { transition: none; }
  .ss-fade-enter-active .ss-frame { animation: none; }
  .ss-swap-enter-active, .ss-swap-leave-active { transition: none; }
  .ss-feedback-enter-active, .ss-feedback-leave-active { transition: none; }
  .ss-pixel-btn.is-busy { animation: none; }
}
</style>
