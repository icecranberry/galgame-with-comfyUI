import test from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, ref, nextTick } from 'vue'
import { dialogueCharacters, dialogueCharacterDelay, paginateDialogue, repaginateDialogue, mergeDialogueMessages, dialogueWaitStatus } from '../src/utils/galgameDialogue.js'
import { useGalgameTranscript } from '../src/composables/useGalgameTranscript.js'
import { createPinia, setActivePinia } from 'pinia'
import { useChatStore } from '../src/stores/chat.js'
import { chatSpeechAutoPlay } from '../src/utils/speechAutoPlay.js'

test('pagination preserves full text and never splits emoji or combining characters', () => {
  const source = '你👩‍👩‍👧‍👦好。\n\n（轻声说）e\u0301再见。'.repeat(12)
  const pages = paginateDialogue(source, { width: 5, lines: 3, measure: () => 1 })
  assert.ok(pages.length > 1)
  assert.equal(pages.join(''), source)
  assert.deepEqual(pages.flatMap(dialogueCharacters), dialogueCharacters(source))
  assert.ok(dialogueCharacters('👩‍👩‍👧‍👦').length === 1)
  assert.ok(dialogueCharacterDelay('。') > dialogueCharacterDelay('，'))
  assert.ok(dialogueCharacterDelay('，') > dialogueCharacterDelay('你'))
})

test('overlapping history pages merge in order without repeating full replies', () => {
  assert.deepEqual(mergeDialogueMessages([{ id: 3, content: 'a' }], [{ id: 1 }, { id: 3, content: 'b' }]), [{ id: 1 }, { id: 3, content: 'b' }])
})

test('short replies start unrevealed and resizing never reveals the remaining text', () => {
  const text = '你好👩‍👩‍👧‍👦，今天一起出去玩吧！'
  const wide = { width: 100, lines: 3, measure: () => 1 }
  const blank = { pages: [''], pageIndex: 0, revealed: 0 }
  const initial = repaginateDialogue(text, wide, blank, true)
  assert.deepEqual(initial, { pages: [text], pageIndex: 0, revealed: 0 })
  const typing = { ...initial, revealed: 3 }
  const resized = repaginateDialogue(text, wide, typing)
  assert.equal(resized.revealed, 3)
  assert.equal(dialogueCharacters(resized.pages[0]).slice(0, resized.revealed).join(''), '你好👩‍👩‍👧‍👦')
  assert.ok(resized.revealed < dialogueCharacters(text).length)
  const nextReply = repaginateDialogue('新的回复', wide, typing, true)
  assert.equal(nextReply.revealed, 0)
})

test('expanding a multi-page reply to one page preserves its typing progress', () => {
  const text = '一二三四五六七八九十'
  const narrow = { width: 4, lines: 1, measure: () => 1 }
  const previous = { pages: paginateDialogue(text, narrow), pageIndex: 1, revealed: 2 }
  const resized = repaginateDialogue(text, { ...narrow, width: 100 }, previous)
  assert.deepEqual(resized, { pages: [text], pageIndex: 0, revealed: 6 })
  const finished = repaginateDialogue(text, narrow, { ...resized, revealed: 10 })
  assert.equal(finished.pageIndex, 2)
  assert.equal(finished.revealed, 2)
})

test('viewport remeasurement keeps an unread page at its start and a completed page at its end', () => {
  const text = '一二三四五六七八九十'
  const layout = { width: 4, lines: 1, measure: () => 1 }
  const pages = paginateDialogue(text, layout)
  assert.deepEqual(repaginateDialogue(text, layout, { pages, pageIndex: 1, revealed: 0 }),
    { pages, pageIndex: 1, revealed: 0 })
  assert.deepEqual(repaginateDialogue(text, layout, { pages, pageIndex: 0, revealed: 4 }),
    { pages, pageIndex: 0, revealed: 4 })
})

test('saved full reply and prediction identity arrive before image tasks release the send lock', async t => {
  const originalFetch = globalThis.fetch
  let controller, requestBody
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/chat')) {
      requestBody = JSON.parse(options.body)
      return new Response(new ReadableStream({ start(value) { controller = value } }), { headers: { 'Content-Type': 'text/event-stream' } })
    }
    return Response.json({ characters: [{ id: 1 }] })
  }
  t.after(() => { globalThis.fetch = originalFetch })
  setActivePinia(createPinia())
  const chat = useChatStore()
  chat.activeCharId = 1
  const leaveSpeech = chatSpeechAutoPlay.enter('chat:1', () => true)
  t.after(leaveSpeech)
  const send = chat.sendMessage('你好', 'smart', false, { galgameMode: true })
  assert.equal(requestBody.galgame_mode, true)
  assert.equal(requestBody.message, '你好', 'the mode preference must not be appended to the user message')
  assert.equal(chat.messages.find(message => message.role === 'user').content, '你好')
  const emit = (name, data) => controller.enqueue(new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`))
  assert.equal(dialogueWaitStatus(chat), '')
  emit('token', { content: '完整回复' })
  emit('response_end', {})
  emit('dialogue_saved', { raw_id: 12 })
  emit('msg_saved', { id: 22, role: 'assistant', content: '完整回复' })
  emit('guesses', { a: '好呀', b: '再聊一会儿', source_raw_id: 12 })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(chat.responseComplete, true)
  const sentence = chat.messages.find(message => message.speech_message_id === 22)
  assert.ok(sentence, 'Galgame replies retain the real ID required for speech synthesis')
  assert.equal(chatSpeechAutoPlay.claim(sentence.speech_auto_token), true, 'Galgame requests use the same automatic speech pipeline')
  assert.equal(chat.dialogueRevision, 1)
  assert.equal(chat.guessSourceRawId, 12)
  assert.deepEqual(chat.guesses, { a: '好呀', b: '再聊一会儿' })
  assert.equal(chat.streaming, true, 'prediction arrival must not release the existing send lock')
  assert.equal(dialogueWaitStatus(chat), '')
  emit('generate_start', { taskId: 'photo' })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(dialogueWaitStatus(chat), '正在准备一张照片…')
  emit('generate_retrying', { taskId: 'photo' })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(dialogueWaitStatus(chat), '照片还需要一点时间…')
  emit('generate_progress', { taskId: 'photo', progress: 50 })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(dialogueWaitStatus(chat), '正在准备一张照片…')
  emit('generate_done', { taskId: 'photo', images: [{ url: '/images/chat/late.png' }] })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(chat.dialogueRevision, 2, 'image completion refreshes the transcript even when no new raw row exists')
  assert.equal(dialogueWaitStatus(chat), '')
  controller.close(); await send
  assert.equal(chat.streaming, false)
  assert.equal(chat.lastSendError, '')
  assert.equal(dialogueWaitStatus(chat), '')
  const normalSend = chat.sendMessage('继续')
  assert.equal(requestBody.galgame_mode, undefined, 'the previous Galgame request must not leak its mode into ordinary chat')
  assert.equal(requestBody.message, '继续')
  emit('token', { content: '接着聊吧' })
  emit('bubble_break', {})
  emit('response_end', {})
  controller.close()
  await normalSend
})

test('failed or completed pictures do not leave an image waiting status behind', () => {
  const state = { streaming: true, responseComplete: false, messages: [
    { type: 'image_gen', genStatus: 'done' }, { type: 'image_gen', genStatus: 'error' },
  ] }
  assert.equal(dialogueWaitStatus(state), '')
  state.messages.push({ type: 'image_gen', genStatus: 'pending' })
  assert.equal(dialogueWaitStatus(state), '正在准备一张照片…')
  state.streaming = false
  assert.equal(dialogueWaitStatus(state), '')
})

test('late images refresh an existing dialogue row without losing its text or advancing the cursor', async t => {
  const originalFetch = globalThis.fetch
  let images = []
  const requests = []
  globalThis.fetch = async url => {
    const query = new URL(url, 'http://fixture').searchParams
    requests.push(query)
    const message = { id: 5, role: 'assistant', content: '看这张图', images }
    return Response.json({ messages: query.has('after') ? [] : [message], refreshed: query.has('refreshIds') ? [message] : [], latestId: 5, latestRole: 'assistant', hasMore: false })
  }
  let state
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { state = useGalgameTranscript(() => 1); return () => null } })
  app.mount({})
  t.after(() => { app.unmount(); globalThis.fetch = originalFetch })
  await state.refresh()
  images = ['/images/chat/late.png']
  await state.refresh()
  assert.equal(requests.at(-1).get('after'), '5')
  assert.equal(requests.at(-1).get('refreshIds'), '5')
  assert.deepEqual(state.messages.value, [{ id: 5, role: 'assistant', content: '看这张图', images }])
})

test('transcript catches up across pages, recovers undo/clear, and rejects a previous character response', async t => {
  const originalFetch = globalThis.fetch
  let rows = [{ id: 1, role: 'assistant', content: '第一句' }, { id: 2, role: 'assistant', content: '第二句' }]
  let delayed
  globalThis.fetch = async url => {
    const parsed = new URL(url, 'http://fixture')
    if (parsed.pathname.includes('/characters/2/')) return new Promise(resolve => { delayed = () => resolve(Response.json({ messages: [{ id: 999, content: '旧角色' }], latestId: 999, latestRole: 'assistant', hasMore: false })) })
    const after = Number(parsed.searchParams.get('after'))
    const selected = rows.filter(row => !after || row.id > after)
    return Response.json({ messages: selected.slice(0, 2), latestId: rows.at(-1)?.id || null, latestRole: rows.at(-1)?.role || null, hasMore: selected.length > 2 })
  }
  const id = ref(1)
  let state
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { state = useGalgameTranscript(() => id.value); return () => null } })
  app.mount({})
  t.after(() => { app.unmount(); globalThis.fetch = originalFetch })
  await state.refresh()
  rows.push(...[3, 4, 5, 6, 7].map(value => ({ id: value, role: 'assistant', content: String(value) })))
  await state.refresh()
  assert.deepEqual(state.messages.value.map(row => row.id), [1, 2, 3, 4, 5, 6, 7])
  rows = rows.slice(0, 2)
  await state.refresh()
  assert.deepEqual(state.messages.value.map(row => row.id), [1, 2])
  id.value = 2; await nextTick()
  const old = state.refresh()
  id.value = 3; await nextTick(); await state.refresh()
  delayed(); await old
  assert.deepEqual(state.messages.value.map(row => row.id), [1, 2])
  rows = []; await state.refresh()
  assert.deepEqual(state.messages.value, [])
})
