import test from 'node:test'
import assert from 'node:assert/strict'
import { createSpeechAutoPlay, chatSpeechAutoPlay } from '../src/utils/speechAutoPlay.js'
import { createPinia, setActivePinia } from 'pinia'
import { useChatStore } from '../src/stores/chat.js'
import { useGroupsStore } from '../src/stores/groups.js'
import { ref, createRenderer, nextTick } from 'vue'
import { useSpeechAutoPlay } from '../src/composables/useSpeechAutoPlay.js'
import { speechEnabled, speechAutoPlay, speechPlaybackBlocked, speechQueue } from '../src/stores/speech.js'

test('only the active, enabled and visible conversation can mark live sentences, once', () => {
  const auto = createSpeechAutoPlay()
  let enabled = false
  const leave = auto.enter('chat:12', () => enabled)
  assert.equal(auto.mark('chat:12', 1), undefined)
  enabled = true
  assert.equal(auto.claim(undefined), false) // histories have no token
  assert.equal(auto.mark('group:12', 2), undefined)
  assert.equal(auto.mark('chat:12', 1), undefined)
  const first = auto.mark('chat:12', 2), second = auto.mark('chat:12', 3)
  assert.equal(auto.mark('chat:12', 2), undefined)
  assert.equal(auto.claim(first), true)
  assert.equal(auto.claim(first), false) // remount / repeated SSE
  enabled = false
  assert.equal(auto.claim(second), false)
  enabled = true
  assert.equal(auto.claim(second), false) // no catch-up on enabling
  const old = auto.mark('chat:12', 4)
  auto.enter('group:12', () => true)
  leave() // old page teardown cannot remove new scope
  assert.equal(auto.claim(old), false)
  assert.equal(auto.claim(auto.mark('group:12', 1)), true)
  const queued = auto.mark('group:12', 2)
  auto.clear()
  assert.equal(auto.claim(queued), false)
})

test('private proactive and delayed sentences carry one-use tokens and real message IDs', () => {
  setActivePinia(createPinia())
  const chat = useChatStore()
  chat.activeCharId = 12
  const leave = chatSpeechAutoPlay.enter('chat:12', () => true)
  try {
    chat.handleProactiveMessage({ character_id: 12, msg_id: 31, msg_ids: [31, 32], segments: ['一', '二'] })
    chat.handleDelayedReply({ character_id: 12, messages: [{ id: 33, content: '三' }] })
    assert.deepEqual(chat.messages.map(m => m.speech_message_id), [31, 32, 33])
    assert.ok(chat.messages.every(m => chatSpeechAutoPlay.claim(m.speech_auto_token)))
    leave()
    chat.handleProactiveMessage({ character_id: 12, msg_id: 34, content: '后台消息' })
    assert.equal(chat.messages.at(-1).speech_auto_token, undefined)
  } finally { leave() }
})

test('private streaming waits for persisted sentence IDs before auto synthesis', async t => {
  setActivePinia(createPinia())
  const chat = useChatStore()
  chat.activeCharId = 12
  const leave = chatSpeechAutoPlay.enter('chat:12', () => true)
  t.after(leave)
  let controller
  t.mock.method(globalThis, 'fetch', async url => url.endsWith('/chat')
    ? new Response(new ReadableStream({ start(c) { controller = c } })) : Response.json({ characters: [] }))
  const sending = chat.sendMessage('你好')
  const emit = (event, data) => controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
  emit('token', { content: '第一句' })
  emit('bubble_break', {})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(chat.messages.find(m => m.role === 'assistant').speech_auto_token, undefined)
  emit('msg_saved', { id: 41, role: 'assistant', content: '第一句' })
  emit('token', { content: '第二句' })
  emit('bubble_break', {})
  emit('msg_saved', { id: 42, role: 'assistant', content: '第二句' })
  emit('response_end', {})
  controller.close()
  await sending
  const replies = chat.messages.filter(m => m.speech_message_id)
  assert.deepEqual(replies.map(m => m.speech_message_id), [41, 42])
  assert.ok(replies.every(m => chatSpeechAutoPlay.claim(m.speech_auto_token)))
})

test('group history is silent; new sentences are marked only when displayed and deduplicated', async t => {
  setActivePinia(createPinia())
  const store = useGroupsStore(), group = { id: 56, members: [] }
  const leave = chatSpeechAutoPlay.enter('group:56', () => true)
  t.after(() => { leave(); store.leaveGroup() })
  const message = { id: 51, role: 'assistant', speaker_character_id: 12, content: '新分句' }
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.endsWith('/chat')) return new Response(`event: group_msg\ndata: ${JSON.stringify(message)}\n\nevent: group_msg\ndata: ${JSON.stringify(message)}\n\n`)
    if (url.endsWith('/messages')) return Response.json({ group, messages: [{ ...message, id: 50, content: '历史' }] })
    if (url === '/api/groups') return Response.json({ groups: [group] })
    return Response.json({ ok: true })
  })
  await store.loadGroups(); await store.selectGroup(56)
  assert.equal(store.messages[0].speech_auto_token, undefined)
  store.sendMessage('你好')
  await new Promise(resolve => setImmediate(resolve))
  const replies = store.messages.filter(m => m.id === 51)
  assert.equal(replies.length, 1)
  assert.equal(chatSpeechAutoPlay.claim(replies[0].speech_auto_token), true)
})

test('page lifecycle clears pending playback on switch, disable and leave; hidden tabs do not enqueue', t => {
  const previous = globalThis.document
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} }
  t.after(() => { globalThis.document = previous; speechEnabled.value = false; speechAutoPlay.value = false })
  speechEnabled.value = true; speechAutoPlay.value = true
  const scope = ref('chat:12')
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { useSpeechAutoPlay(() => scope.value); return () => null } })
  app.mount({})
  try {
    assert.equal(chatSpeechAutoPlay.claim(chatSpeechAutoPlay.mark('chat:12', 1)), true)
    document.hidden = true
    assert.equal(chatSpeechAutoPlay.mark('chat:12', 2), undefined)
    document.hidden = false
    const old = speechQueue.reserve()
    scope.value = 'group:56'
    assert.equal(old.active, false)
    assert.equal(chatSpeechAutoPlay.mark('chat:12', 3), undefined)
    const queued = speechQueue.reserve(), token = chatSpeechAutoPlay.mark('group:56', 1)
    speechAutoPlay.value = false
    assert.equal(queued.active, false)
    speechAutoPlay.value = true
    assert.equal(chatSpeechAutoPlay.claim(token), false)
    const leaving = speechQueue.reserve()
    app.unmount()
    assert.equal(leaving.active, false)
    assert.equal(chatSpeechAutoPlay.mark('group:56', 2), undefined)
  } finally { app.unmount() }
})

test('blocked playback is visible in a toast and trusted desktop/mobile gestures resume it', async t => {
  const previous = globalThis.document, handlers = new Map(), notices = []
  globalThis.document = { hidden: false,
    addEventListener(type, fn) { handlers.set(type, fn) },
    removeEventListener(type) { handlers.delete(type) } }
  t.after(() => { globalThis.document = previous })
  let resumes = 0
  t.mock.method(speechQueue, 'resume', () => resumes++)
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() { useSpeechAutoPlay(() => 'chat:12'); return () => null } })
  app.provide('toast', (...args) => notices.push(args)); app.mount({})
  try {
    speechPlaybackBlocked.value = true; await nextTick()
    assert.match(notices[0][0], /点击或轻触页面/)
    handlers.get('click')({ type: 'click', isTrusted: false })
    assert.equal(resumes, 0)
    handlers.get('click')({ type: 'click', isTrusted: true }) // mouse click or touch-generated click
    handlers.get('keydown')({ type: 'keydown', key: 'Enter', isTrusted: true })
    assert.equal(resumes, 2)
    document.hidden = true
    handlers.get('click')({ type: 'click', isTrusted: true })
    assert.equal(resumes, 2)
  } finally { app.unmount() }
  assert.equal(handlers.size, 0)
})
