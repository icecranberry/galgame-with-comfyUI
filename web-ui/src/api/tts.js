export async function ttsApi(path, body, method = 'POST', signal) {
  const res = await fetch(`/api/tts${path}`, {
    method: body === undefined ? 'GET' : method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal,
  })
  const value = await res.json()
  if (!res.ok) throw Object.assign(new Error(value.error || '语音请求失败'), { code: value.code })
  return value
}
export async function uploadVoice(file) {
  if (!file || file.size > 25 * 1024 * 1024) throw new Error('请选择 25MB 以内的音频')
  const res = await fetch('/api/tts/samples', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file })
  const value = await res.json()
  if (!res.ok) throw new Error(value.error || '音频上传失败')
  return value
}
export async function uploadApiReference(characterId, file) {
  if (!file || !file.size || file.size > 25 * 1024 * 1024) throw new Error('请选择 25MB 以内的音频')
  const res = await fetch(`/api/tts/characters/${characterId}/api-samples?name=${encodeURIComponent(file.name || '参考音频')}`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
  })
  const value = await res.json()
  if (!res.ok) throw new Error(value.error || 'API 参考音频上传失败')
  return value
}
