export async function gameRequest(path = '', { method = 'GET', body, signal, raw = false } = {}) {
  const response = await fetch(`/api/games${path}`, { method, signal,
    headers: body === undefined ? undefined : { 'Content-Type': raw ? 'application/zip' : 'application/json' },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `游戏请求失败（${response.status}）`);
  return result;
}
