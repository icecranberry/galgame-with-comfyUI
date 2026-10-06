<template>
  <!-- 建筑功能内容外壳：结果展示 + 选人/选物品/备注/确认等共用件。
       选择区版式按 templateId 分发到 shop/panels/ 下的专属面板（外观一套、交易一套、其余每店独立）；
       temporary_state 与外观四件套共用 renderer，分发不能只看 rendererKey（见 useShopFeature.shopPanelFor）。 -->
  <div class="bf-content" :class="{ 'is-dark': dark }">
    <!-- 已完成：展示真实结果 -->
    <template v-if="isDone">
      <div class="bf-result">
        <!-- 签运结果：签纸卡 -->
        <div v-if="resultKind === 'fortune'" class="bf-fortune-card">
          <span class="bf-fortune-badge">{{ result.title || '今日签' }}</span>
          <p class="bf-fortune-text">{{ result.text }}</p>
        </div>
        <template v-else>
          <img v-if="resultImage" :src="resultImage" class="bf-result-image" loading="lazy" alt="" />
          <p v-if="resultCaption" class="bf-result-caption">{{ resultCaption }}</p>
        </template>
        <p v-if="resultSummary && resultKind !== 'fortune'" class="bf-result-summary">{{ resultSummary }}</p>
        <p v-if="event.status === 'cancelled'" class="bf-result-summary">这次没有办成。</p>
      </div>
    </template>

    <!-- 进行中：开场 → 面板选择区 → 目标/物品 → 确认执行 -->
    <template v-else>
      <p v-if="event.opening" class="bf-opening">{{ event.opening }}</p>
      <p v-if="event.description" class="bf-desc">{{ event.description }}</p>

      <ShopFortunePanel v-if="panel === 'fortune'" :busy="busy" />
      <ShopDrawPanel v-else-if="panel === 'draw'" :prizes="optionChoices" :stock="featureStock" :busy="busy" />
      <ShopTradePanel v-else-if="panel === 'trade'" :mode="tradeMode" :options="optionChoices" :stock="featureStock"
        :selected-option-key="selectedOptionKey" :selected-item-name="selectedItemName"
        :tier-hint="tierHint" :estimate-price="quote?.price ?? null" @select="selectOption" />
      <ShopAppearancePanel v-else-if="panel === 'appearance'" :options="optionChoices" :params="featureParams"
        :category-label="featureCategoryLabel" :selected-option-key="selectedOptionKey" @select="selectOption" />
      <ShopStatePanel v-else-if="panel === 'state'" :options="optionChoices" :params="featureParams"
        :duration-hours="featureParams?.durationHours ?? null" :selected-option-key="selectedOptionKey" @select="selectOption" />
      <ShopPortraitPanel v-else-if="panel === 'portrait'" :options="optionChoices"
        :selected-option-key="selectedOptionKey" @select="selectOption" />
      <ShopKeepsakePanel v-else-if="panel === 'keepsake'" :formats="keepsakeFormats"
        :selected-format="selectedFormat" :options="optionChoices" :selected-option-key="selectedOptionKey"
        @select-format="selectedFormat = $event" @select="selectOption" />
      <ShopGalleryPanel v-else-if="panel === 'gallery'" :items="galleryItems" :loaded="galleryLoaded"
        :empty-text="galleryEmptyText" />

      <!-- 通用回退：未知模板的选项列表 -->
      <div v-else-if="optionChoices.length" class="bf-field">
        <span class="bf-field-label">{{ optionLabel }}</span>
        <div class="bf-option-list">
          <TownVnChoice v-for="opt in optionChoices" :key="opt.key"
            :active="selectedOptionKey === opt.key" :hint="opt.hint" :disabled="busy"
            @select="selectOption(opt.key)">{{ opt.label }}</TownVnChoice>
        </div>
      </div>

      <div v-if="needsTarget && selectableTargets.length" class="bf-field">
        <span class="bf-field-label">{{ targetLabel }}</span>
        <div class="bf-cast">
          <button type="button" class="bf-cast-card" :class="{ 'is-empty': !targetA }" @click="openPicker('a')">
            <span class="bf-cast-portrait">
              <img v-if="targetA?.avatarPath" :src="targetA.avatarPath" alt="" loading="lazy">
              <span v-else aria-hidden="true">{{ targetA ? initialOf(targetA) : '＋' }}</span>
            </span>
            <span class="bf-cast-name">{{ targetA?.displayName || '选择对象' }}</span>
          </button>
          <button v-if="isPair" type="button" class="bf-cast-card" :class="{ 'is-empty': !targetB }" @click="openPicker('b')">
            <span class="bf-cast-portrait">
              <img v-if="targetB?.avatarPath" :src="targetB.avatarPath" alt="" loading="lazy">
              <span v-else aria-hidden="true">{{ targetB ? initialOf(targetB) : '＋' }}</span>
            </span>
            <span class="bf-cast-name">{{ targetB?.displayName || '选择另一位' }}</span>
          </button>
        </div>
        <TownCharacterPicker
          :open="pickerOpen" :targets="selectableTargets"
          :exclude="pickerSlot === 'b' ? selectedTargetA : ''"
          :model-value="pickerSlot === 'b' ? selectedTargetB : selectedTargetA"
          :title="pickerSlot === 'b' ? '选择另一位' : '选择角色'"
          @update:model-value="onPicked" @close="pickerOpen = false"
        />
      </div>
      <p v-else-if="needsTarget && featureLoaded && !selectableTargets.length" class="bf-empty">{{ emptyText }}</p>

      <div v-if="needsItem" class="bf-field">
        <span class="bf-field-label">{{ isRecycle ? '选择要出售的物品' : '选择要交换的物品' }}</span>
        <linshe-select v-model="selectedItemId" size="sm" :options="itemOptions" placeholder="从背包选择" />
      </div>
      <p v-if="needsItem && featureLoaded && !itemOptions.length" class="bf-empty">{{ emptyText }}</p>

      <label v-if="allowsNote" class="bf-field bf-note-field">
        <span class="bf-field-label">想补充点什么？（可选）</span>
        <linshe-input v-model="userNote" type="textarea" :rows="2" size="sm" :maxlength="200" placeholder="给店家的一句话备注…" />
      </label>

      <div class="bf-choices">
        <TownVnChoice v-if="!isGallery" primary :busy="busy" :disabled="locked || !ready" :hint="priceHint" @select="isLuck ? luckExecute() : confirmExecute()">{{ confirmLabel }}</TownVnChoice>
        <TownVnChoice :disabled="busy" @select="dismiss">{{ isGallery ? '下次再来看' : '改天再说' }}</TownVnChoice>
      </div>
      <p v-if="quoteSummary" class="bf-quote" aria-live="polite">{{ quoteSummary }}</p>
      <p v-if="error" class="bf-error" role="alert">{{ error }}</p>
      <p v-if="busy && isGenerative" class="bf-pending" role="status">{{ generativeHint }}</p>
    </template>
  </div>
</template>

<script setup>
import LinsheInput from '../ui/LinsheInput.vue'
import LinsheSelect from '../ui/LinsheSelect.vue'
import TownCharacterPicker from './TownCharacterPicker.vue'
import TownVnChoice from './TownVnChoice.vue'
import ShopAppearancePanel from './shop/panels/ShopAppearancePanel.vue'
import ShopDrawPanel from './shop/panels/ShopDrawPanel.vue'
import ShopFortunePanel from './shop/panels/ShopFortunePanel.vue'
import ShopGalleryPanel from './shop/panels/ShopGalleryPanel.vue'
import ShopKeepsakePanel from './shop/panels/ShopKeepsakePanel.vue'
import ShopPortraitPanel from './shop/panels/ShopPortraitPanel.vue'
import ShopStatePanel from './shop/panels/ShopStatePanel.vue'
import ShopTradePanel from './shop/panels/ShopTradePanel.vue'
import { computed } from 'vue'
import { initialOf, useShopFeature } from './shop/useShopFeature.js'

const props = defineProps({
  event: { type: Object, required: true },
  dark: { type: Boolean, default: false },
  scope: { type: Object, default: () => ({}) }, // { worldId, worldEpoch }
})
const emit = defineEmits(['completed', 'dismissed', 'refresh'])

const {
  // 标识与分发
  panel,
  // 结果展示
  isDone, result, resultKind, resultImage, resultCaption, resultSummary,
  // 选项
  optionChoices, optionLabel, selectedOptionKey, selectOption,
  keepsakeFormats, selectedFormat, tierHint,
  // 目标（选人）
  needsTarget, selectableTargets, featureLoaded, isPair, targetLabel,
  selectedTargetA, selectedTargetB, targetA, targetB, pickerOpen, pickerSlot, openPicker, onPicked,
  // 物品
  needsItem, isRecycle, itemOptions, selectedItemId, selectedItemName, featureStock,
  // 备注 / 报价 / 确认
  allowsNote, userNote, quote, quoteSummary, priceHint, featureParams, featureCategoryLabel,
  busy, locked, ready, error, isGenerative, generativeHint, isLuck, isGallery,
  confirmLabel, emptyText, confirmExecute, luckExecute, dismiss,
  // 画廊
  galleryItems, galleryLoaded, galleryEmptyText,
} = useShopFeature({ event: () => props.event, scope: () => props.scope, emit })

// 交易面板的子模式：templateId 优先，旧事件 DTO 按 renderer 回退
const tradeMode = computed(() => {
  const id = props.event.templateId || ''
  if (id === 'item_exchange' || (!id && props.event.rendererKey === 'exchange_offers')) return 'exchange'
  if (id === 'item_recycle' || (!id && props.event.rendererKey === 'recycle')) return 'recycle'
  return 'purchase'
})
</script>

<style scoped>
/* 与奇遇卡内文一致的纸张语言；颜色全部走主题 token，不新造视觉体系。
   各店专属面板的选择区样式在 shop/panels/ 内；小镇内舞台由 TownShopStage 用 :deep() 统一拉到木牌配色。 */
.bf-content { display: flex; flex-direction: column; gap: 10px; }
.bf-opening { font-size: 15px; line-height: 1.7; color: var(--town-paper-ink, var(--text-primary)); }
.bf-desc { font-size: 13px; line-height: 1.6; opacity: 0.75; }
.bf-field { display: flex; flex-direction: column; gap: 4px; }
/* 选人卡：空槽是虚线，选中后亮起立绘 */
.bf-cast { display: flex; gap: 10px; flex-wrap: wrap; }
.bf-cast-card { display: flex; align-items: center; gap: 8px; padding: 6px 12px 6px 6px; border: 2px solid #00000018; border-radius: 12px; background: #fff9; cursor: pointer; font: inherit; color: inherit; text-align: left; }
.bf-cast-card.is-empty { border-style: dashed; color: #8b7b6c; }
.bf-cast-card:hover { border-color: var(--accent, #b08a5a); }
.bf-cast-portrait { width: 38px; height: 38px; border-radius: 9px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: #e7e0d8; flex-shrink: 0; font-size: 18px; color: #8b7b6c; }
.bf-cast-portrait img { width: 100%; height: 100%; object-fit: cover; display: block; }
.bf-cast-name { font-size: 13px; }
.bf-field-label { font-size: 12px; opacity: 0.7; }
.bf-option-list { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }
.bf-note-field { text-align: left; }
.bf-choices { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
.bf-quote { font-size: 12px; opacity: 0.7; text-align: center; }
.bf-error { font-size: 13px; color: var(--accent-hover, #b4443c); text-align: center; }
.bf-empty, .bf-pending { font-size: 13px; opacity: 0.7; text-align: center; }

/* ── 结果 ── */
.bf-result { display: flex; flex-direction: column; gap: 8px; align-items: center; }
.bf-result-image { max-width: 100%; border-radius: 10px; border: 2px solid var(--town-paper-line, var(--border)); }
.bf-result-caption { font-size: 14px; line-height: 1.7; text-align: center; }
.bf-result-summary { font-size: 13px; opacity: 0.75; text-align: center; }
.bf-fortune-card {
  display: flex; flex-direction: column; gap: 8px; align-items: center;
  width: min(260px, 88%); padding: 18px 14px; border-radius: 12px;
  background: linear-gradient(180deg, #f7ecd2 0%, #ecd9ae 100%);
  border: 2px solid #55432a;
  box-shadow: var(--shadow-hard-sm, 0 2px 0 rgba(0, 0, 0, 0.2));
  animation: bf-reveal 0.4s var(--ease-standard, ease);
}
@keyframes bf-reveal {
  from { transform: translateY(10px) rotate(-3deg); opacity: 0; }
  to { transform: translateY(0) rotate(0deg); opacity: 1; }
}
.bf-fortune-badge {
  font-size: 13px; font-weight: 700; padding: 2px 12px; border-radius: 999px;
  background: var(--accent); color: var(--on-accent, #fff);
}
.bf-fortune-text { font-size: 13px; line-height: 1.9; text-align: center; color: #55432a; margin: 0; }

@media (prefers-reduced-motion: reduce) {
  .bf-fortune-card { animation: none; }
}
</style>
