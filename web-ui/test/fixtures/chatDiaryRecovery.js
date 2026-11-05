import { createApp, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ChatRetryNotice from '../../src/components/chat/ChatRetryNotice.vue'
import DiaryBookOverlay from '../../src/components/DiaryBookOverlay.vue'
import { useChatStore } from '../../src/stores/chat.js'
import { useDiaryStore } from '../../src/stores/diary.js'
import '../../src/styles/tokens.css'
import '../../src/styles/base.css'
import '../../src/styles/components.css'
import '../../src/styles/animations.css'

const params = new URLSearchParams(location.search)
document.documentElement.dataset.theme = params.get('theme') || 'warm'
const pinia = createPinia(); setActivePinia(pinia)
const chat = useChatStore(), diary = useDiaryStore()
chat.activeCharId = 1
chat.failedTurn = { content:'你好', clientMsgId:'fixture', error:'回应中断，已保留收到的内容' }
const failed = { date:'2026-01-01', status:'failed', content:'', error:'服务重启导致日记生成中断，请重试' }
// fixture 的全部接口使用合成数据，禁止访问真实后端。
globalThis.fetch = async (url, options = {}) => {
  if (String(url).includes('/history')) return Response.json({ diaries:[{ ...failed, title:'' }] })
  if (String(url).includes('/diaries/')) return Response.json({ generating:options.method==='POST', diary:{...failed,status:options.method==='POST'?'generating':'failed'} })
  throw new Error(`Unexpected fixture request: ${url}`)
}
const app = createApp({render:()=>h('main',{style:'min-height:100dvh;background:var(--bg-primary);color:var(--text-primary);padding-top:24px'},[h(ChatRetryNotice),h(DiaryBookOverlay)])})
app.use(pinia);app.mount('#app')
if(params.get('panel')==='diary') await diary.openBook({ characterId:1,characterName:'测试角色',date:failed.date })
window.recoveryFixture = { chat, diary }
