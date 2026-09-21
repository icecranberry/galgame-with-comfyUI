// Visual/interaction fixture. Real Vue components and command storage, isolated in-memory API; never touches a player's town.
import { createApp, h, ref } from 'vue'
import '../../src/styles/tokens.css'
import '../../src/styles/base.css'
import TownCafeWorkPanel from '../../src/components/town/TownCafeWorkPanel.vue'
import TownPaperPanel from '../../src/components/town/TownPaperPanel.vue'
import TownDecorations from '../../src/components/town/TownDecorations.vue'
import TownEarningNotice from '../../src/components/town/TownEarningNotice.vue'
import LinsheButton from '../../src/components/ui/LinsheButton.vue'

const params = new URLSearchParams(location.search)
if (params.has('mobile')) {
  document.body.style.margin = '0'
  const frame = document.createElement('iframe')
  frame.title = '390px 手机视口'
  frame.style.cssText = 'width:390px;height:844px;border:0;max-width:100%;display:block;margin:auto'
  frame.src = `townEarning.html?theme=${params.get('theme') || 'warm'}&panel=${params.get('panel') || 'wallet'}`
  document.body.append(frame)
} else {
document.documentElement.dataset.theme = params.get('theme') || 'warm'
document.body.style.cssText = 'margin:0;background:var(--bg-primary);font-family:sans-serif'
const world = { worldId:'earning-visual-fixture', worldEpoch:1 }, balance = ref(180), view = ref(params.get('panel') || 'wallet')
const opportunities = { available:2, reserved:1, daily:3, capacity:9, nextRefreshAt:Date.parse('2026-09-13T00:00:00+08:00') }
const decorations = ref({ selected:null, catalog:[
  { key:'flower', name:'花信木牌', symbol:'✿', price:160, description:'在小镇铭牌上别一朵花，公告站也添上花信印记。', owned:false },
  { key:'sea', name:'海风铭牌', symbol:'≈', price:320, description:'海浪纹的镇名铭牌，配上公告站的海风印记。', owned:false },
  { key:'star', name:'星灯铭牌', symbol:'✦', price:800, description:'为小镇挂上星灯纹铭牌，留下慢慢攒钱的纪念。', owned:false },
] })
const questions = [
  { text:'第一位客人要赶车，另一位想慢慢坐一会儿。先照顾谁？', options:['赶车的客人','慢慢坐的客人','先收拾空桌'] },
  { text:'客人特地叮嘱怕苦，怎样准备更合适？', options:['加浓不加奶','选柔和口味，另备奶','按最畅销的做'] },
  { text:'饮品做好了，交给客人前再确认什么？', options:['杯子是不是最大','要不要推销下一杯','口味、杯签和取餐人'] },
]
let session = null
const replies = new Map(), clone = value => JSON.parse(JSON.stringify(value))
globalThis.fetch = async (url, options) => {
  const path = String(url), body = options?.body && JSON.parse(options.body)
  if (!path.startsWith('/api/town/')) throw Error('Fixture forbids external requests')
  let data
  if (body && replies.has(body.idempotencyKey)) data = replies.get(body.idempotencyKey)
  else if (path.endsWith('/economy')) data = { ...world, enabled:true, configured:true, livelihood:opportunities,
    cafe:{ open:true, hours:'09:00–18:00', catalog:[{ serviceKey:'town.cafe.work_shift', name:'临时代班', wage:24, price:0, available:true }], sessions:session ? [session] : [] } }
  else if (path.endsWith('/decorations')) {
    const next = clone(decorations.value), item = next.catalog.find(item => item.key === body.decorationKey)
    if (body.action === 'buy' && !item.owned) { balance.value -= item.price; item.owned = true }
    next.selected = body.decorationKey; decorations.value = next; data = next
  } else if (path.endsWith('/services/offer')) {
    session = { ...world, sessionId:'fixture-shift', serviceKey:'town.cafe.work_shift', serviceName:'咖啡馆 · 临时代班',
      version:1, status:'offered', turnCount:0, template:{ wage:24, maxTurns:4 }, turns:[], dialogue:'这班保底24金币，三件小事做好了，另有最多6金币小费。' }; data = session
  } else if (path.endsWith('/accept')) {
    session = { ...session, status:'active', version:2, work:{ answered:0, total:3, bonus:0, question:questions[0] }, choices:['work_answer_0','work_answer_1','work_answer_2','cancel'], dialogue:questions[0].text }; data = session
  } else if (path.endsWith('/turn')) {
    session = clone(session); session.version++; session.turnCount++
    if (body.intentKey === 'serve') {
      session.status = 'completed'; session.choices = []; session.settlement = { payout:24, bonus:6, netIncome:30, refund:0 }; balance.value += 30
    } else {
      session.work.answered++; session.work.bonus += 2; session.work.feedback = '做得好，小费 +2。记住客人的需求，交接也更顺利。'
      session.work.question = questions[session.work.answered] || null; session.dialogue = session.work.question?.text || '这一班已经准备妥当了。'
      session.choices = session.work.question ? ['work_answer_0','work_answer_1','work_answer_2','cancel'] : ['serve','cancel']
    }
    data = session
  } else data = session
  if (body) replies.set(body.idempotencyKey, clone(data))
  return { ok:true, status:200, json:async () => clone(data) }
}
createApp({ setup() {
  return () => h('main', [
    h('nav', { style:'display:flex;gap:12px;padding:12px' }, [
      h(LinsheButton, { size:'sm', onClick:() => { view.value = 'wallet' } }, () => '钱袋样例'),
      h(LinsheButton, { size:'sm', onClick:() => { view.value = 'work' } }, () => '打工样例'),
    ]),
    view.value === 'work' ? h(TownCafeWorkPanel, { ...world, providerName:'小栗', onClose:() => { view.value = '' } })
      : view.value === 'wallet' ? h(TownPaperPanel, { open:true, title:'钱袋', kicker:'UI 回归样例 · 不影响存档', onClose:() => { view.value = '' } }, () => [
        h('h2', `${balance.value} 金币`), h(TownEarningNotice, { value:opportunities }),
        h(TownDecorations, { ...world, value:decorations.value, balance:balance.value }),
      ]) : null,
  ])
} }).mount('#app')
}
