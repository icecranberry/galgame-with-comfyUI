// 临时视觉验证页:只挂载全局 Toast 组件,配色迭代期间保留
// 默认加载即自动展示四种状态;按钮可手动重放;?scenario=mobile 为窄屏演示
import { createApp, ref, h } from 'vue'
import './assets/fonts/fonts.css'
import Toast from './components/Toast.vue'

const scenario = new URLSearchParams(location.search).get('scenario') || 'demo'

createApp({
  setup() {
    const toastEl = ref(null)
    const btn = (label, fn) => h('button', { onClick: fn }, label)

    if (scenario === 'demo') {
      // 加载即展示四种状态 + 双行卡片
      const demo = [
        ['已开启每日免费鸡蛋', 'success'],
        ['新的信件已经送达', 'info'],
        ['今天的免费鸡蛋还没有领取', 'warning'],
        ['信件发送失败，请稍后再试', 'error'],
      ]
      demo.forEach(([msg, type], i) => {
        setTimeout(() => toastEl.value?.show(msg, type, 10000), 400 + i * 300)
      })
      setTimeout(() => toastEl.value?.show({ message: '每日免费鸡蛋', description: '今天的奖励已经准备好了', type: 'success', duration: 10000 }), 1700)
    }

    if (scenario === 'mobile') {
      setTimeout(() => toastEl.value?.show('已开启每日免费鸡蛋', 'success', 8000), 400)
      setTimeout(() => toastEl.value?.show('正在同步世界线……这是一条比较长的状态消息,观察窄屏下的宽度与换行表现。', 'info', 8000), 800)
    }

    return () => h('div', null, [
      btn('success', () => toastEl.value.show('已开启每日免费鸡蛋', 'success', 8000)),
      btn('info', () => toastEl.value.show('新的信件已经送达', 'info', 8000)),
      btn('warning', () => toastEl.value.show('今天的免费鸡蛋还没有领取', 'warning', 8000)),
      btn('error', () => toastEl.value.show('信件发送失败，请稍后再试', 'error', 8000)),
      btn('标题+辅助文字', () => toastEl.value.show({ message: '每日免费鸡蛋', description: '今天的奖励已经准备好了', type: 'success', duration: 8000 })),
      btn('长消息', () => toastEl.value.show('正在同步世界线……这是一条比较长的状态消息,用来观察多行情况下卡片高度的自然增长与文字换行表现。', 'info', 8000)),
      btn('连续 6 条', () => {
        for (let i = 1; i <= 6; i++) {
          setTimeout(() => toastEl.value.show('世界线发生了一点变化 #' + i, i % 2 ? 'info' : 'success', 6000), (i - 1) * 220)
        }
      }),
      h(Toast, { ref: toastEl }),
    ])
  },
}).mount('#app')
