export async function gameRequest(path = '', { method = 'GET', body, signal, raw = false, headers } = {}) {
  const response = await fetch(`/api/games${path}`, { method, signal,
    headers: body === undefined ? headers : { 'Content-Type': raw ? 'application/zip' : 'application/json', ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || `游戏请求失败（${response.status}）`), { code: result.code });
  return result;
}
