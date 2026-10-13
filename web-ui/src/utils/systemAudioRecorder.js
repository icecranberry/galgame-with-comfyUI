// Audio-only capture. The display stream stays local and is never uploaded.
export function createSystemAudioRecorder({
  getDisplayMedia = options => navigator.mediaDevices.getDisplayMedia(options),
  Recorder = globalThis.MediaRecorder, Stream = globalThis.MediaStream,
  onState = () => {}, onResult = () => {}, now = () => Date.now(),
  maxDurationMs = 119000, maxBytes = 25 * 1024 * 1024,
} = {}) {
  let generation = 0, source, recorder, timer, deadline, started = 0, chunks = [], size = 0
  let phase = 'idle'
  const publish = (value, extra = {}) => { phase = value; onState({ phase, seconds: started ? (now() - started) / 1000 : 0, ...extra }) }
  const release = () => {
    clearInterval(timer); clearTimeout(deadline)
    source?.getTracks().forEach(track => track.stop()); source = null
  }
  function cancel() {
    generation++
    clearInterval(timer); clearTimeout(deadline)
    if (recorder?.state === 'recording') recorder.stop()
    release(); recorder = null; chunks = []; size = 0; started = 0
    publish('idle')
  }
  function stop() {
    if (phase === 'requesting') { cancel(); return }
    if (phase !== 'recording') return
    publish('stopping')
    recorder.stop()
    release()
  }
  async function start() {
    if (['requesting', 'recording', 'stopping'].includes(phase)) return
    cancel()
    const current = generation
    publish('requesting')
    try {
      if (!Recorder || !Stream) throw new Error('浏览器不支持录音，请使用桌面 Chrome / Edge，或上传音频文件。')
      const stream = await getDisplayMedia({
        video: true,
        // Preserve the source audio for voice cloning instead of applying call
        // processing. Plain booleans remain best-effort on unsupported sources.
        audio: { autoGainControl: false, echoCancellation: false, noiseSuppression: false },
        systemAudio: 'include', selfBrowserSurface: 'exclude',
      })
      if (current !== generation) { stream.getTracks().forEach(track => track.stop()); return }
      source = stream
      const tracks = stream.getAudioTracks().filter(track => track.readyState !== 'ended')
      if (!tracks.length) throw new Error('未共享声音。请选择“整个屏幕”并勾选“共享系统音频”，或共享带音频的浏览器标签页。')
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => Recorder.isTypeSupported(type))
      if (!mimeType) throw new Error('浏览器没有可用的音频录制格式，请改用桌面 Chrome / Edge 或上传文件。')
      recorder = new Recorder(new Stream(tracks), { mimeType, audioBitsPerSecond: 128000 })
      const active = recorder
      active.ondataavailable = event => {
        if (current !== generation || !event.data.size) return
        size += event.data.size
        if (size > maxBytes) { cancel(); publish('error', { error: '录音超过 25MB，请缩短录制时间。' }); return }
        chunks.push(event.data)
      }
      active.onerror = () => {
        if (current !== generation) return
        cancel(); publish('error', { error: '录音中断，请重新录制。' })
      }
      active.onstop = () => {
        if (current !== generation) return
        release()
        const blob = new Blob(chunks, { type: active.mimeType || mimeType })
        chunks = []; recorder = null
        if (!blob.size) { publish('error', { error: '没有录到音频，请确认播放来源和共享音频选项。' }); return }
        publish('ready'); onResult(blob)
      }
      source.getTracks().forEach(track => track.addEventListener('ended', stop, { once: true }))
      started = now(); active.start(250); publish('recording')
      timer = setInterval(() => publish('recording'), 250)
      deadline = setTimeout(stop, maxDurationMs)
    } catch (error) {
      if (current !== generation) return
      release(); recorder = null
      const message = error.name === 'NotAllowedError' ? '已取消共享或未获授权，可重新开始录制。'
        : error.name === 'InvalidStateError' ? '请在当前窗口直接点击“开始录制”，再选择共享来源。'
          : error.message
      publish('error', { error: message })
    }
  }
  return { start, stop, cancel }
}
