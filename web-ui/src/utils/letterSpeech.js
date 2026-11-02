import { createSpeechPlayback } from './speechPlayback.js'
import { ttsApi } from '../api/tts.js'

const POLL_INTERVAL = 1200
const MAX_WAIT_MS = 180000

/**
 * 信件 TTS 播放：展开信件时从头播放（不记录进度），合起时停止。
 *
 * 主流程：
 *  1. 先取信件已绑定的合成任务（写完信勾选「自动阅读」后，后端在回信生成时已开始合成）；
 *  2. 若没有任务或任务已失效，则触发合成——后端内部会检测角色声音，
 *     未配置声音时抛 VOICE_NOT_CONFIGURED，这里静默忽略（不播放）；
 *  3. 轮询任务直到完成，再播放音频。
 */
export function createLetterSpeech() {
  const player = createSpeechPlayback()
  let session = null

  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms)
      if (!signal) return
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      }, { once: true })
    })
  }

  async function start(letter) {
    stop()
    if (!letter || !letter.auto_read || !letter.reply_content) return

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    const signal = controller?.signal
    const state = { cancelled: false, controller, ticket: player.begin() }
    session = state

    try {
      let job = await ttsApi(`/letters/${letter.id}`, undefined, 'GET', signal)
      if (state.cancelled) return
      if (!job || !job.id || job.status === 'failed' || job.status === 'cancelled') {
        job = await ttsApi(`/letters/${letter.id}`, {}, 'POST', signal)
      }
      if (state.cancelled) return

      const deadline = Date.now() + MAX_WAIT_MS
      while (job && ['queued', 'generating', 'processing'].includes(job.status)) {
        if (Date.now() > deadline) return
        await wait(POLL_INTERVAL, signal)
        if (state.cancelled) return
        job = await ttsApi(`/jobs/${job.id}`, undefined, 'GET', signal)
      }
      if (state.cancelled || !job || job.status !== 'completed' || !job.audio_url) return
      await player.play(job.audio_url, state.ticket)
    } catch (err) {
      if (err?.name !== 'AbortError' && err?.code !== 'VOICE_NOT_CONFIGURED') {
        console.warn('[letterSpeech]', err?.message || err)
      }
    }
  }

  function stop() {
    if (session) {
      session.cancelled = true
      try { session.controller?.abort() } catch {}
      session = null
    }
    player.stop()
  }

  return { start, stop }
}
