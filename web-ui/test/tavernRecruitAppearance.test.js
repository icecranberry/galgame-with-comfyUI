import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref, reactive } from 'vue'

const source = readFileSync(new URL('../src/views/TavernView.vue', import.meta.url), 'utf8')
const recruitCode = source.slice(source.indexOf('const recruit = reactive('), source.indexOf('const cardInputRef = ref(null)'))
const fixture = (generateCharacterPreview, retryCharacterReferenceImage) => new Function('api', 'ref', 'reactive', 'toastFn', 'chat', `${recruitCode}
  return { recruit, showRecruitRefine, recruitRefineImage, recruitRefineAuto, openRecruit, closeRecruit,
    doGenerate, regenerateFromSearchResult, openRecruitRefine, onRecruitAppearanceRefined, confirmRecruit, retryRecruitImage }
`)({ generateCharacterPreview, retryCharacterReferenceImage, createCharacter: () => { throw new Error('must not save before confirmation') } }, ref, reactive, () => {}, {})
const card = { name: 'angel', display_name: '天使', base_prompt: '生成后的人格', search_context: '百科资料', reference_image: 'data:image/png;base64,cG9ydHJhaXQ=' }
const failedCard = { ...card, reference_image: '', reference_image_info: {
  page_url: 'https://zh.moegirl.org.cn/御坂美琴', status: 'blocked', message: '百科要求访问验证', retry_after: 0,
} }

test('image-only retry keeps the edited card and makes no further persona generation request', async t => {
  let generated = 0, finish
  const state = fixture(async () => { generated++; return failedCard }, (pageUrl, { signal }) => {
    assert.equal(pageUrl, failedCard.reference_image_info.page_url)
    assert.equal(signal.aborted, false)
    return new Promise(resolve => { finish = resolve })
  })
  t.after(state.closeRecruit)
  state.openRecruit(); state.recruit.desc = '御坂美琴'
  await state.doGenerate()
  assert.equal(state.recruit.referenceInfo.message, '百科要求访问验证')
  state.recruit.result.base_prompt = '用户自己修改的人格卡'
  state.recruit.result.display_name = '用户修改的名字'
  const pending = state.retryRecruitImage()
  assert.equal(state.recruit.imageLoading, true)
  await state.doGenerate(); await state.regenerateFromSearchResult(); await state.confirmRecruit()
  state.recruit.result.base_prompt += '（下载期间的继续编辑）'
  finish({ reference_image: card.reference_image, reference_image_info: { ...failedCard.reference_image_info, status: 'ready', message: '' } })
  await pending
  assert.equal(generated, 1)
  assert.equal(state.recruit.result.base_prompt, '用户自己修改的人格卡（下载期间的继续编辑）')
  assert.equal(state.recruit.result.display_name, '用户修改的名字')
  assert.equal(state.recruit.searchContext, card.search_context)
  assert.equal(state.showRecruitRefine.value, true)
  assert.equal(state.recruitRefineImage.value, card.reference_image)
})

test('failed image retry retains the card and a server cooldown prevents immediate retries', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1000 })
  let retried = 0
  const state = fixture(async () => failedCard, async () => {
    retried++
    return { reference_image: '', reference_image_info: { ...failedCard.reference_image_info,
      status: 'rate_limited', message: '请求过于频繁', retry_after: 2 } }
  })
  t.after(state.closeRecruit)
  state.openRecruit(); state.recruit.desc = '御坂美琴'
  await state.doGenerate(); await state.retryRecruitImage()
  assert.equal(state.recruit.result.base_prompt, card.base_prompt)
  assert.equal(state.recruit.referenceInfo.message, '请求过于频繁')
  assert.equal(state.recruit.imageRetrySeconds, 2)
  await state.retryRecruitImage()
  assert.equal(retried, 1)
  t.mock.timers.tick(2000)
  assert.equal(state.recruit.imageRetrySeconds, 0)
  await state.retryRecruitImage()
  assert.equal(retried, 2)
  assert.equal(state.showRecruitRefine.value, false)
})

test('closing during image retry cancels it and prevents late updates to a new card', async t => {
  let finish, signal
  const state = fixture(async () => failedCard, (_, options) => {
    signal = options.signal
    return new Promise(resolve => { finish = resolve })
  })
  t.after(state.closeRecruit)
  state.openRecruit(); state.recruit.desc = '御坂美琴'
  await state.doGenerate()
  const pending = state.retryRecruitImage()
  state.closeRecruit(); state.openRecruit()
  assert.equal(signal.aborted, true)
  finish({ reference_image: card.reference_image }); await pending
  assert.equal(state.recruit.result, null)
  assert.equal(state.recruit.referenceInfo, null)
  assert.equal(state.showRecruitRefine.value, false)
})

test('generation finishes before opening refinement and corrected text returns to the draft', async t => {
  let finish
  const state = fixture(() => new Promise(resolve => { finish = resolve }))
  t.after(state.closeRecruit)
  state.openRecruit(); state.recruit.desc = '天使'
  const pending = state.doGenerate()
  assert.equal(state.showRecruitRefine.value, false)
  assert.equal(state.recruit.result, null)
  finish(card); await pending
  assert.equal(state.recruit.step, 'preview')
  assert.equal(state.recruit.result.base_prompt, card.base_prompt)
  assert.equal(state.showRecruitRefine.value, true)
  assert.equal(state.recruitRefineImage.value, card.reference_image)
  assert.equal(state.recruitRefineAuto.value, true)
  await state.confirmRecruit() // guarded while refinement is open
  state.showRecruitRefine.value = false
  state.onRecruitAppearanceRefined({ basePrompt: '修正后的人格' })
  assert.equal(state.recruit.result.base_prompt, '修正后的人格')
  state.openRecruitRefine()
  assert.equal(state.recruitRefineAuto.value, false)
})

test('cached regeneration reuses the image, a fresh search without an image clears it', async t => {
  let round = 0
  const state = fixture(async (_, options) => {
    round++
    if (round === 1) return card
    if (round === 2) assert.equal(options.searchContext, card.search_context)
    return { ...card, reference_image: '' }
  })
  t.after(state.closeRecruit)
  state.openRecruit(); state.recruit.desc = '天使'
  await state.doGenerate()
  state.showRecruitRefine.value = false
  await state.regenerateFromSearchResult()
  assert.equal(state.recruitRefineImage.value, card.reference_image)
  assert.equal(state.showRecruitRefine.value, true)
  state.showRecruitRefine.value = false
  await state.doGenerate()
  assert.equal(state.recruit.referenceImage, '')
  assert.equal(state.showRecruitRefine.value, false)
})

test('a closed generation cannot reopen refinement or replace a new draft', async t => {
  let finish
  const state = fixture(() => new Promise(resolve => { finish = resolve }))
  t.after(state.closeRecruit)
  state.openRecruit(); state.recruit.desc = '旧角色'
  const pending = state.doGenerate()
  state.closeRecruit(); state.openRecruit(); state.recruit.desc = '新角色'
  finish(card); await pending
  assert.equal(state.recruit.result, null)
  assert.equal(state.showRecruitRefine.value, false)
  assert.equal(state.recruit.desc, '新角色')
})
