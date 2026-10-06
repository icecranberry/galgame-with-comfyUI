// 小镇店铺功能共用逻辑：selection（选项/目标/物品/备注）→ quote → execute → 轮询 operation → 结果。
// 纯函数（buildSelection / shopFeatureErrorText / shopPanelFor / excerptOf / optionDetailOf 等）
// 单独导出，行为测试直接 import 断言；useShopFeature 负责响应式装配与 API 调用（api 可注入）。
// ⚠️ 面板分发必须按 templateId：temporary_state 与外观四件套共用 appearance_options 渲染器，
// 只看 rendererKey 会把 BUFF 商店错分进衣柜面板。
import { computed, ref, unref, watch } from 'vue'
import * as townBuildingFeaturesApi from '../../../api/townBuildingFeatures.js'
import { listItems } from '../../../api/index.js'

// 提供玩法选项的 renderer；fortune/draw 由服务端按种子定结果，gallery 只读展示
export const SELECTABLE_RENDERERS = ['appearance_options', 'trade_offers', 'exchange_offers', 'portrait_themes', 'keepsake_formats']
// 抽取家族：结果由当日/操作种子决定，无需玩家选具体项，但有专属演出
export const LUCK_RENDERERS = ['fortune', 'draw']
export const TIER_GOLD = { basic: 5, standard: 15, premium: 40 }
export const OPTION_LABELS = {
  appearance_options: '选一样',
  trade_offers: '挑一件商品',
  exchange_offers: '选一个交换档',
  portrait_themes: '选一个拍摄主题',
  keepsake_formats: '选一个纪念品主题',
}

// templateId → 面板名（14 个模板全覆盖：外观一套 + 交易一套 + 其余每店独立）
export const SHOP_PANEL_MAP = {
  outfit_change: 'appearance',
  hairstyle_change: 'appearance',
  accessory_change: 'appearance',
  temporary_transform: 'appearance',
  item_purchase: 'trade',
  item_exchange: 'trade',
  item_recycle: 'trade',
  temporary_state: 'state',
  portrait_single: 'portrait',
  portrait_pair: 'portrait',
  illustrated_keepsake: 'keepsake',
  gallery_display: 'gallery',
  pool_draw: 'draw',
  daily_fortune: 'fortune',
}
// 无 templateId 的旧事件 DTO 按 renderer 兜底（appearance_options 无法区分 BUFF，回退外观面板）
const RENDERER_PANEL_FALLBACK = {
  fortune: 'fortune',
  draw: 'draw',
  trade_offers: 'trade',
  exchange_offers: 'trade',
  recycle: 'trade',
  appearance_options: 'appearance',
  portrait_themes: 'portrait',
  keepsake_formats: 'keepsake',
  gallery: 'gallery',
}
export function shopPanelFor(templateId, rendererKey) {
  if (templateId && SHOP_PANEL_MAP[templateId]) return SHOP_PANEL_MAP[templateId]
  return RENDERER_PANEL_FALLBACK[rendererKey] || null
}

// 生成型模板：执行后轮询 operation 至终态（一次 LLM + 一次生图，失败重试不重复扣款）
const GENERATIVE_TEMPLATES = ['portrait_single', 'portrait_pair', 'illustrated_keepsake']
// 确认键要展示到期时长的模板（外观四件套 + BUFF）
const DURATION_TEMPLATES = ['outfit_change', 'hairstyle_change', 'accessory_change', 'temporary_transform', 'temporary_state']

export function excerptOf(text, max = 56) {
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}
export function optionDetailOf(params, key, field) {
  const opt = (params?.options || []).find(o => o.key === key)
  return opt?.[field] || ''
}
export const formatLabel = format => ({ postcard: '明信片', memento_card: '纪念卡' }[format] || format)
export const initialOf = target => String(target?.displayName || '?').trim().slice(0, 1) || '?'

/**
 * 把界面上的选择拼成执行 selection。参数均为已解包的普通值（测试可直接构造）。
 * 商品购买选项即 offer（offerKey）；其余可选 renderer 用 optionKey；
 * 签运/抽奖的选项维度不进入 selection（结果由服务端种子定）。
 */
export function buildSelection({ event, optionChoices = [], selectedOptionKey = '', selectedTargetA = '',
  selectedTargetB = '', selectedItemId = '', userNote = '', needsTarget = false, isPair = false,
  needsItem = false, allowsNote = false }) {
  const selected = optionChoices.some(opt => opt.key === selectedOptionKey)
    ? selectedOptionKey : (optionChoices[0]?.key || '')
  const selection = {}
  if (event.rendererKey === 'trade_offers') {
    // 商品购买：选项即 offer
    if (selected) selection.offerKey = selected
  } else if (selected && SELECTABLE_RENDERERS.includes(event.rendererKey)) {
    selection.optionKey = selected
  }
  if (needsTarget && selectedTargetA) {
    selection.targetActorKeys = isPair
      ? [selectedTargetA, selectedTargetB].filter(Boolean)
      : [selectedTargetA]
  }
  if (needsItem && selectedItemId) selection.itemIds = [Number(selectedItemId)]
  if (allowsNote && userNote.trim()) selection.userNote = userNote.trim().slice(0, 200)
  return selection
}

const SHOP_ERROR_TEXTS = {
  NOT_ARRIVED: '请先走到这家门口，再办理。', INSUFFICIENT_FUNDS: '可用金币不足。',
  OUT_OF_STOCK: '今天的货已经空了。', DAILY_LIMIT: '今天已经用过这次机会了，明天再来。',
  EFFECT_ALREADY_ACTIVE: '这项效果还在生效中，不用重复办理。', QUOTE_EXPIRED: '报价已过期，请重新确认。',
  PRICE_CHANGED: '价格已变化，请重新确认。', NEEDS_OPERATOR: '这家还没有经营者，收费项目暂不可用。',
  FEATURE_STALE: '这家店的描述变了，功能暂停，等店主重新挂牌吧。', TARGET_UNSUPPORTED: '选定的对象不支持这项服务。',
  ITEM_LOCKED: '这件物品正被占用，稍后再试。', INVALID_SELECTION: '这个选择办不了，换一样试试。',
  STALE_EPOCH: '小镇已更新，请刷新后重试。', GENERATION_FAILED: '画面没能画出来，可以重试。',
}
export function shopFeatureErrorText(err) {
  return SHOP_ERROR_TEXTS[err?.code]
    || (err?.uncertain ? '结果尚未确认，稍后可在奇遇页查看。' : '这次没办成，请稍后再试。')
}

/**
 * 店铺功能共用状态与执行管线。
 * @param {object} opts
 * @param {Ref|ComputedRef|Function|object} opts.event   事件/合成事件 DTO（推荐传 getter）
 * @param {Ref|ComputedRef|Function|object} [opts.scope] { worldId, worldEpoch }，缺省回退事件自带
 * @param {Function} opts.emit                           组件 emit（completed/dismissed/refresh）
 * @param {object} [opts.api]                            覆盖默认 API（测试注入）
 */
export function useShopFeature({ event, scope, emit, api } = {}) {
  const api_ = api || townBuildingFeaturesApi
  const eventRef = computed(() => (typeof event === 'function' ? event() : unref(event)) || {})
  const scopeRef = computed(() => ((typeof scope === 'function' ? scope() : unref(scope)) || {}))

  const templateId = computed(() => eventRef.value.templateId || '')
  const renderer = computed(() => eventRef.value.rendererKey || '')
  const panel = computed(() => shopPanelFor(templateId.value, renderer.value))
  const needsTarget = computed(() => (eventRef.value.supportedTargetKinds || []).some(k => k.startsWith('character')))
  const requiresTarget = computed(() => needsTarget.value && !(eventRef.value.supportedTargetKinds || []).includes('character_optional'))
  const needsItem = computed(() => ['exchange_offers', 'recycle'].includes(renderer.value))
  const isRecycle = computed(() => renderer.value === 'recycle')
  const isGenerative = computed(() => ['portrait_themes', 'keepsake_formats'].includes(renderer.value))
  const isLuck = computed(() => LUCK_RENDERERS.includes(renderer.value))
  const isGallery = computed(() => renderer.value === 'gallery')
  const isDone = computed(() => ['completed', 'cancelled', 'expired'].includes(eventRef.value.status))
  const allowsNote = computed(() => (eventRef.value.options || []).length > 0
    && ['portrait_themes', 'keepsake_formats'].includes(renderer.value))

  const result = computed(() => eventRef.value.result || {})
  const resultKind = computed(() => result.value.kind || '')
  const resultImage = computed(() => result.value.imageUrl || eventRef.value.output?.imageUrl || null)
  const resultCaption = computed(() => result.value.caption || '')
  const resultSummary = computed(() => result.value.summary || '')
  const resultText = computed(() => result.value.text || '')

  // 目标 / 物品候选与货架库存：来自建筑功能视图（只读）
  const selectableTargets = ref([])
  const featureParams = ref(null)
  const featureStock = ref(null)
  const featureCategoryLabel = ref('')
  const backpackItems = ref([])
  const galleryItems = ref([])
  const galleryLoaded = ref(false)
  const galleryEmptyText = ref('')
  const featureLoaded = ref(false)
  const selectedTargetA = ref('')
  const selectedTargetB = ref('')
  const selectedItemId = ref('')
  const selectedOptionKey = ref('')
  const selectedFormat = ref('')
  const userNote = ref('')
  const quote = ref(null)
  const busy = ref(false)
  const error = ref('')

  const isPair = computed(() => (eventRef.value.supportedTargetKinds || []).includes('character_pair'))
  const targetLabel = computed(() => isPair.value ? '选择两位对象' : '选择对象')

  // 选人界面：目标角色用带立绘的角色卡挑（服务端给的是全部招募角色）
  const pickerOpen = ref(false)
  const pickerSlot = ref('a')
  const targetA = computed(() => selectableTargets.value.find(t => t.actorKey === selectedTargetA.value) || null)
  const targetB = computed(() => selectableTargets.value.find(t => t.actorKey === selectedTargetB.value) || null)
  function openPicker(slot) {
    if (locked.value) return
    pickerSlot.value = slot
    pickerOpen.value = true
  }
  function onPicked(actorKey) {
    if (pickerSlot.value === 'b') selectedTargetB.value = actorKey
    else selectedTargetA.value = actorKey
    pickerOpen.value = false
  }

  const optionChoices = computed(() => {
    if (isGallery.value || (!SELECTABLE_RENDERERS.includes(renderer.value) && renderer.value !== 'draw')) return []
    return (eventRef.value.options || []).map(opt => ({
      ...opt,
      hint: renderer.value === 'trade_offers' && opt.priceTier
        ? `${TIER_GOLD[opt.priceTier] ?? opt.priceTier} 金币` : '',
    }))
  })
  const optionLabel = computed(() => OPTION_LABELS[renderer.value] || '选一样')
  const keepsakeFormats = computed(() => {
    const formats = featureParams.value?.formats
    return Array.isArray(formats) && formats.length ? formats : ['postcard']
  })
  const tierHint = computed(() => eventRef.value.price > 0 ? `按 ${eventRef.value.price} 金币档` : '按行情')
  // 交换/回收只接受建档 accept 目录中的物品（catalog_{template_id}）——与服务端校验同一口径
  const acceptedTemplateIds = computed(() => {
    const params = featureParams.value
    if (!params) return null
    if (renderer.value === 'exchange_offers') {
      const offer = (params.offers || []).find(o => o.giveResourceKey === selectedOptionKey.value)
        || (params.offers || [])[0]
      return offer?.acceptCatalogKey ? [String(offer.acceptCatalogKey).replace(/^catalog_/, '')] : null
    }
    if (renderer.value === 'recycle') {
      const keys = params.acceptCatalogKeys || []
      return keys.length ? keys.map(key => String(key).replace(/^catalog_/, '')) : null
    }
    return null
  })
  const itemOptions = computed(() => {
    if (!needsItem.value) return []
    const accepted = acceptedTemplateIds.value
    return backpackItems.value
      .filter(item => item.status === 'ready' && (!accepted || accepted.includes(item.template_id)))
      .map(item => ({ label: item.name, value: String(item.id) }))
  })
  const selectedItemName = computed(() => {
    const item = backpackItems.value.find(i => String(i.id) === String(selectedItemId.value))
    return item?.name || ''
  })
  const durationHint = computed(() => {
    if (!DURATION_TEMPLATES.includes(templateId.value)) return ''
    const hours = Number(featureParams.value?.durationHours)
    return Number.isFinite(hours) && hours > 0 ? `有效 ${hours} 小时` : ''
  })
  const priceHint = computed(() => {
    const price = quote.value?.price ?? eventRef.value.price ?? 0
    const base = price > 0 ? `${price} 金币` : '免费'
    return durationHint.value ? `${base} · ${durationHint.value}` : base
  })
  const confirmLabel = computed(() => {
    if (renderer.value === 'fortune') return '摇一支'
    if (renderer.value === 'draw') return '抽一次'
    return isGenerative.value ? '确认并生成' : '确认办理'
  })
  const emptyText = computed(() => (optionChoices.value.length || needsItem.value)
    ? '今天没有合适的人选或货品。' : '暂时无法办理。')
  const generativeHint = computed(() => '正在画画，需要一点时间。可以先离开，稍后在奇遇页查看结果。')

  const locked = computed(() => busy.value)
  const ready = computed(() => {
    if (isLuck.value) return true
    if (optionChoices.value.length && !selectedOptionKey.value) return false
    if (needsTarget.value && requiresTarget.value) {
      if (!selectedTargetA.value) return false
      if (isPair.value && (!selectedTargetB.value || selectedTargetB.value === selectedTargetA.value)) return false
    }
    if (needsItem.value) return selectedItemId.value !== ''
    return true
  })
  const quoteSummary = computed(() => quote.value?.summary || '')

  function showError(err) {
    error.value = shopFeatureErrorText(err)
  }

  function selectOption(key) {
    if (selectedOptionKey.value === key) return
    selectedOptionKey.value = key
    quote.value = null // 报价与选择绑定：换选项后旧报价作废，确认时重新询价
  }

  function currentSelection() {
    return buildSelection({
      event: eventRef.value,
      optionChoices: optionChoices.value,
      selectedOptionKey: selectedOptionKey.value,
      selectedTargetA: selectedTargetA.value,
      selectedTargetB: selectedTargetB.value,
      selectedItemId: selectedItemId.value,
      userNote: userNote.value,
      needsTarget: needsTarget.value,
      isPair: isPair.value,
      needsItem: needsItem.value,
      allowsNote: allowsNote.value,
    })
  }

  async function loadFeatureContext() {
    if (isDone.value) return
    featureLoaded.value = false
    backpackItems.value = []
    galleryItems.value = []
    galleryLoaded.value = false
    try {
      const view = await api_.fetchBuildingFeatures(rawLocationKey.value, eventRef.value.mapId)
      const feature = (view.features || []).find(f => f.featureId === eventRef.value.featureId)
      featureParams.value = feature?.params || null
      featureStock.value = feature?.stock || null
      featureCategoryLabel.value = feature?.categoryLabel || ''
      selectableTargets.value = feature?.targets || []
      if (needsItem.value) {
        const backpack = await listItems()
        backpackItems.value = backpack.items || []
      }
      featureLoaded.value = true
    } catch { featureLoaded.value = true }
    if (isGallery.value) loadGallery()
  }

  async function loadGallery() {
    try {
      const gallery = await api_.fetchBuildingFeatureGallery(rawLocationKey.value, {
        worldId: scopeRef.value.worldId ?? eventRef.value.worldId,
        worldEpoch: scopeRef.value.worldEpoch ?? eventRef.value.worldEpoch,
        mapId: eventRef.value.mapId, featureId: eventRef.value.featureId,
      })
      galleryItems.value = gallery.items || []
      galleryEmptyText.value = gallery.emptyText || '还没有可以展示的作品。'
    } catch (err) {
      showError(err)
    } finally {
      galleryLoaded.value = true
    }
  }

  /** 报价 → 执行：报价收据绑定执行（过期/变价由服务端拒绝） */
  async function requestOperation(selection) {
    const worldEpoch = scopeRef.value.worldEpoch ?? eventRef.value.worldEpoch
    const worldId = scopeRef.value.worldId ?? eventRef.value.worldId
    const q = await api_.quoteBuildingFeature(rawLocationKey.value, {
      worldId, worldEpoch, mapId: eventRef.value.mapId,
      featureId: eventRef.value.featureId, selection,
    })
    quote.value = q
    return api_.executeBuildingFeature(rawLocationKey.value, {
      worldId, worldEpoch, mapId: eventRef.value.mapId,
      featureId: eventRef.value.featureId, profileRevision: q.revision,
      quoteId: q.quoteId, quoteExpiresAt: q.expiresAt,
      selection, eventId: eventRef.value.id,
    })
  }

  async function confirmExecute() {
    if (locked.value || !ready.value) return
    busy.value = true; error.value = ''
    try {
      const operation = await requestOperation(currentSelection())
      if (GENERATIVE_TEMPLATES.includes(operation.templateId)) {
        await pollOperation(operation.operationId)
      } else {
        finishWith(operation)
      }
    } catch (err) { showError(err) }
    finally { busy.value = false }
  }

  /** 摇签/转盘：先播 0.6s 摇动/翻转动画再请求，演出与结算分离 */
  async function luckExecute() {
    if (locked.value || !ready.value) return
    busy.value = true; error.value = ''
    await new Promise(resolve => setTimeout(resolve, 650))
    try {
      finishWith(await requestOperation(currentSelection()))
    } catch (err) { showError(err) }
    finally { busy.value = false }
  }

  async function pollOperation(operationId, { timeoutMs = 120000 } = {}) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const operation = await api_.fetchBuildingFeatureOperation(operationId)
      if (['committed', 'failed', 'cancelled'].includes(operation.status)) {
        if (operation.status === 'failed') {
          showError({ code: operation.errorCode, message: operation.errorMessage })
          return
        }
        finishWith(operation)
        return
      }
      await new Promise(resolve => setTimeout(resolve, 1500))
    }
    showError({ code: 'GENERATION_PENDING', message: '还在生成中，稍后在奇遇页查看结果。' })
  }

  function finishWith(operation) {
    emit('completed', operation)
    emit('refresh')
  }

  // 小镇内的店铺面板不再有事件载体（event.id 为空），关掉就是关掉；
  // 只有旧的事件卡路径才需要回写事件状态。
  async function dismiss() {
    if (busy.value) return
    emit('dismissed'); emit('refresh')
  }

  // 回收的「预计报价」：选中物品后先做一次只读询价（不扣款），确认时再正式询价
  let previewToken = 0
  watch([selectedItemId, selectedOptionKey], () => {
    if (templateId.value !== 'item_recycle' || !selectedItemId.value) return
    const token = ++previewToken
    const selection = currentSelection()
    const worldEpoch = scopeRef.value.worldEpoch ?? eventRef.value.worldEpoch
    const worldId = scopeRef.value.worldId ?? eventRef.value.worldId
    api_.quoteBuildingFeature(rawLocationKey.value, {
      worldId, worldEpoch, mapId: eventRef.value.mapId,
      featureId: eventRef.value.featureId, selection,
    }).then(q => { if (token === previewToken) quote.value = q })
      .catch(() => { /* 预估价拿不到就算了，确认时仍会正式询价 */ })
  })

  const rawLocationKey = computed(() => String(eventRef.value.buildingInstanceId || '').split(':').slice(1).join(':'))

  watch(() => eventRef.value.id, () => {
    selectedTargetA.value = ''; selectedTargetB.value = ''; selectedItemId.value = ''
    selectedOptionKey.value = optionChoices.value[0]?.key || ''
    selectedFormat.value = keepsakeFormats.value[0] || 'postcard'
    userNote.value = ''
    quote.value = null; error.value = ''
    loadFeatureContext()
  }, { immediate: true })

  // 交换档切换改变 accept 目录：原选中的物品可能不再合格，直接清空让玩家重挑
  watch(acceptedTemplateIds, () => {
    if (!selectedItemId.value) return
    if (!itemOptions.value.some(opt => opt.value === selectedItemId.value)) selectedItemId.value = ''
  })

  return {
    // 标识与分发
    templateId, renderer, panel, rawLocationKey,
    // 结果展示
    isDone, result, resultKind, resultImage, resultCaption, resultSummary, resultText,
    // 选项
    optionChoices, optionLabel, selectedOptionKey, selectOption,
    keepsakeFormats, selectedFormat, tierHint,
    // 目标（选人）
    needsTarget, requiresTarget, isPair, targetLabel, selectableTargets, featureLoaded,
    selectedTargetA, selectedTargetB, targetA, targetB, pickerOpen, pickerSlot, openPicker, onPicked,
    // 物品
    needsItem, isRecycle, itemOptions, selectedItemId, selectedItemName, featureStock,
    // 备注 / 报价 / 确认
    allowsNote, userNote, quote, quoteSummary, priceHint, featureParams, featureCategoryLabel,
    busy, locked, ready, error, isGenerative, generativeHint, isLuck, isGallery,
    confirmLabel, emptyText, confirmExecute, luckExecute, dismiss,
    // 画廊
    galleryItems, galleryLoaded, galleryEmptyText,
  }
}
