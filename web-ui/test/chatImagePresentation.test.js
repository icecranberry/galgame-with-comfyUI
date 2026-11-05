import test from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { useChatStore } from '../src/stores/chat.js'
import { startUnifiedStream, stopUnifiedStream } from '../src/stores/unifiedStream.js'

const settle = () => new Promise(resolve => setImmediate(resolve))
let sequence = 100
async function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const requests = []
  let bus, history = []
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const path = String(url)
    if (path.endsWith('/chat') || path.endsWith('/stream')) {
      const stream = new ReadableStream({ start(controller) {
        if (path.endsWith('/stream')) bus = controller
        else requests.push({ body: JSON.parse(options.body), controller })
        options.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true })
      } })
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
    }
    if (path.endsWith('/messages')) return Response.json({ messages: history })
    return Response.json({ characters: [] })
  })
  setActivePinia(createPinia())
  const store = useChatStore()
  store.activeCharId = ++sequence
  const characterId = store.activeCharId
  startUnifiedStream()
  await settle()
  t.after(() => { stopUnifiedStream(); store.$dispose() })
  const write = (controller, event, data) => controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
  return { store, requests,
    async tick(ms) { t.mock.timers.tick(ms); await settle() },
    event(event, data = {}) { write(requests.at(-1).controller, event, data) },
    image(event, data = {}) { write(bus, 'private_chat_image', { characterId, clientMsgId: requests.at(-1).body.client_msg_id, taskId: 'image-1', messageId: 801, ...data, event }) },
    history(rows) { history = rows },
    close() { requests.at(-1).controller.close() },
  }
}
const pictures = store => store.messages.filter(m => m.type === 'image_gen')

test('独立图片先完成：后台事件即时消费，所有文字结束后才一次性上屏最终图片', async t => {
  const f = await fixture(t)
  const send = f.store.sendMessage('发张照片'); await settle()
  f.image('generate_start'); f.image('generate_progress', { progress: .6 }); f.image('generate_done', { images: [{ url: '/ready.png' }] })
  await settle()
  assert.equal(pictures(f.store).length, 0)
  f.event('token', { content: '第一句。' }); f.event('bubble_break'); f.event('token', { content: '第二句。' })
  await settle(); await f.tick(1000)
  assert.equal(pictures(f.store).length, 0, '不能按固定时间或分句数提前放图')
  f.event('bubble_break'); f.event('response_end'); f.event('dialogue_saved'); await settle(); f.close(); await send
  await f.tick(299); assert.equal(pictures(f.store).length, 0)
  await f.tick(1)
  assert.equal(pictures(f.store).length, 1)
  const image = pictures(f.store)[0]
  assert.equal(image.genStatus, 'done'); assert.equal(image.images[0].url, '/ready.png')
  assert.equal(image.liveImage, true, '已经完成的新图仍需要浏览器加载与入场跟随')
  assert.ok(f.store.messages.indexOf(image) > f.store.messages.findIndex(m => m.content === '第二句。'))
  f.image('generate_done', { images: [{ url: '/ready.png' }] }); await settle()
  assert.equal(pictures(f.store).length, 1, '重复图片事件不重复插泡')
})

test('文字先结束：展示最新进度；下一轮输出期间上一轮图片仍更新原位置', async t => {
  const f = await fixture(t)
  let send = f.store.sendMessage('第一轮'); await settle()
  const firstKey = f.requests[0].body.client_msg_id
  f.image('generate_start'); f.image('generate_progress', { progress: .75 })
  f.event('token', { content: '第一轮正文。' }); f.event('bubble_break'); f.event('response_end'); f.event('dialogue_saved')
  await settle(); f.close(); await send
  assert.equal(f.store.streaming, false, '文字结束立即解除发送锁，不等生图')
  await f.tick(300)
  assert.equal(pictures(f.store)[0].genProgress, .75)
  send = f.store.sendMessage('第二轮'); await settle()
  f.image('generate_done', { clientMsgId: firstKey, images: [{ url: '/first.png' }] })
  f.image('generate_start', { taskId: 'image-2', messageId: 802 })
  f.image('generate_error', { taskId: 'image-2', messageId: 802, error: '图片失败' })
  await settle()
  assert.equal(pictures(f.store).length, 1)
  assert.equal(pictures(f.store)[0].genStatus, 'done')
  assert.ok(f.store.messages.indexOf(pictures(f.store)[0]) < f.store.messages.findIndex(m => m.content === '第二轮'))
  f.event('token', { content: '第二轮正文。' }); f.event('bubble_break'); f.event('response_end'); f.event('dialogue_saved')
  await settle(); f.close(); await send; await f.tick(300)
  assert.equal(pictures(f.store).length, 2)
  assert.equal(f.store.messages.at(-1).genError, '图片失败')
})

test('旧版同流生图也排队，等待尚未到时的表情/文字展示后再放图', async t => {
  const f = await fixture(t)
  const send = f.store.sendMessage('先表情再说话'); await settle()
  f.event('token', { content: '后面的文字。', leadingSticker: true, images: ['/sticker.png'] })
  f.event('generate_start', { taskId: 'legacy' })
  f.event('generate_done', { taskId: 'legacy', images: [{ url: '/legacy.png' }] })
  f.event('bubble_break'); f.event('response_end'); f.event('dialogue_saved')
  f.event('msg_saved', { role: 'assistant', id: 100, content: '后面的文字。' })
  await settle(); f.close(); await send
  await f.tick(449); assert.equal(pictures(f.store).length, 0)
  await f.tick(1); await f.tick(299); assert.equal(pictures(f.store).length, 0)
  await f.tick(1); assert.equal(pictures(f.store)[0].genStatus, 'done')
})

test('文字异常结束仍释放已受理图片；切角色取消旧轮上屏计时', async t => {
  const f = await fixture(t)
  let send = f.store.sendMessage('断流'); await settle()
  f.image('generate_start'); f.event('token', { content: '已收到的文字。' }); f.event('bubble_break')
  await settle(); f.requests.at(-1).controller.error(new Error('模拟断流')); await send
  await f.tick(300); assert.equal(pictures(f.store).length, 1)
  send = f.store.sendMessage('切换前'); await settle()
  f.image('generate_start', { taskId: 'next', messageId: 802 })
  f.event('token', { content: '新文字。' }); f.event('bubble_break'); f.event('response_end'); f.event('dialogue_saved')
  await settle(); f.close(); await send
  await f.store.selectChar(++sequence)
  await f.tick(1000)
  assert.equal(pictures(f.store).length, 0)
})

test('上屏前历史接口已恢复同一张图片时不重复插入', async t => {
  const f = await fixture(t)
  const send = f.store.sendMessage('恢复图片'); await settle()
  f.image('generate_done', { images: [{ url: '/ready.png' }] })
  f.event('token', { content: '正文。' }); f.event('bubble_break'); f.event('response_end'); f.event('dialogue_saved')
  await settle(); f.close(); await send
  f.history([{ id: 801, role: 'assistant', content: '', images: '["/ready.png"]' }])
  await f.store.loadMessages(f.store.activeCharId)
  await f.tick(300)
  assert.equal(pictures(f.store).length, 1)
})
