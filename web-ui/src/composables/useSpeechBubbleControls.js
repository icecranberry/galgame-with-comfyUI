import { ref, watch } from 'vue'

// 私聊和群聊共用：只接受轻触，滚动、拖动和长按不唤出朗读按钮。
export function useSpeechBubbleControls(conversation) {
  const touchedSpeechBubble = ref(null)
  let touch = null
  function clearSpeechBubble() {
    touchedSpeechBubble.value = null
    touch = null
  }
  function onSpeechPointerDown(event) {
    if (event.target.closest('.speech-control')) return
    clearSpeechBubble()
    if (event.isPrimary === false) return
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      touch = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp }
    }
  }
  function onSpeechPointerMove(event) {
    if (touch?.id === event.pointerId && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) >= 10) touch = null
  }
  function revealSpeechBubble(event, id) {
    if (touch?.id === event.pointerId && event.timeStamp - touch.time < 500
      && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) < 10) touchedSpeechBubble.value = id
    touch = null
  }
  watch(conversation, clearSpeechBubble)
  return { touchedSpeechBubble, clearSpeechBubble, onSpeechPointerDown, onSpeechPointerMove, revealSpeechBubble }
}
