import { createPrivateKey, createSign, createHash, randomUUID } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const tokens = new Map();
const badConfig = message => Object.assign(new Error(message), { status: 400 });

export function parseServiceAccount(raw) {
  let account;
  try { account = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { throw badConfig('服务账号 JSON 格式无效'); }
  if (!account || account.type !== 'service_account') throw badConfig('请选择完整的 Service Account JSON（type 必须是 service_account）');
  for (const key of ['project_id', 'client_email', 'private_key']) {
    if (typeof account[key] !== 'string' || !account[key].trim()) throw badConfig(`服务账号 JSON 缺少 ${key}`);
  }
  if (!/^[a-zA-Z0-9._:-]+$/.test(account.project_id)) throw badConfig('服务账号 project_id 格式无效');
  if (!/^[^\s@]+@[^\s@]+$/.test(account.client_email)) throw badConfig('服务账号 client_email 格式无效');
  try {
    if (createPrivateKey(account.private_key).asymmetricKeyType !== 'rsa') throw new Error();
  } catch { throw badConfig('服务账号 private_key 不是有效的 RSA 私钥'); }
  // Only retain the fields used by this integration. Never trust a JSON-supplied token_uri.
  return { type: 'service_account', project_id: account.project_id, client_email: account.client_email, private_key: account.private_key };
}

export function normalizeVertexRegion(value = 'global') {
  const region = String(value).trim();
  if (!/^(global|[a-z]+(?:-[a-z]+)+[0-9])$/.test(region)) throw badConfig('地区格式无效，例如 global 或 us-central1');
  return region;
}

export function vertexBaseURL(region = 'global') {
  region = normalizeVertexRegion(region);
  return `https://${region === 'global' ? '' : `${region}-`}aiplatform.googleapis.com`;
}

export function clearVertexTokenCache() { tokens.clear(); }

async function readResponse(response, label) {
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.error) {
    // Do not echo remote response bodies: they can contain credentials or the signed assertion.
    const code = typeof data?.error === 'string' ? data.error : data?.error?.status;
    const safeCode = typeof code === 'string' && /^[A-Za-z_]+$/.test(code) ? ` (${code})` : '';
    throw Object.assign(new Error(`${label}失败：HTTP ${response.status}${safeCode}`), { status: response.ok ? 502 : response.status });
  }
  if (!data) throw new Error(`${label}返回了无效 JSON`);
  return data;
}

export async function getVertexAccessToken(raw, { signal, fetchImpl = fetch } = {}) {
  signal?.throwIfAborted();
  const account = parseServiceAccount(raw);
  const key = createHash('sha256').update(JSON.stringify(account)).digest('hex');
  const cached = tokens.get(key);
  if (cached?.expires > Date.now() + 60000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: account.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: TOKEN_URL, iat: now, exp: now + 3600,
  })}`;
  const signature = createSign('RSA-SHA256').update(input).sign(account.private_key, 'base64url');
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST', signal, redirect: 'error',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${input}.${signature}` }),
  });
  const data = await readResponse(response, 'Google 服务账号认证');
  if (typeof data.access_token !== 'string' || !data.access_token) throw new Error('Google 未返回访问令牌');
  if (tokens.size >= 8) tokens.delete(tokens.keys().next().value);
  tokens.set(key, { token: data.access_token, expires: Date.now() + (Number(data.expires_in) || 3600) * 1000 });
  return data.access_token;
}

function contentParts(content) {
  if (typeof content === 'string') return [{ text: content }];
  return (content || []).map(part => {
    if (part.type === 'text') return { text: part.text };
    if (part.type === 'image_url') {
      const url = part.image_url?.url || '';
      const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(url);
      if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
      if (/^(https:\/\/|gs:\/\/)/.test(url)) {
        const extension = new URL(url).pathname.split('.').pop()?.toLowerCase();
        const mimeType = part.image_url?.mime_type || ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' })[extension];
        if (!mimeType) throw badConfig('无法识别远程图片类型，请上传图片或提供 mime_type');
        return { fileData: { fileUri: url, mimeType } };
      }
      throw badConfig('Vertex AI 图片输入需要 base64、HTTPS 或 Cloud Storage 地址');
    }
    throw badConfig(`Vertex AI 暂不支持此消息内容类型：${part.type}`);
  });
}

export function buildVertexBody(params) {
  const systemParts = [];
  const contents = [];
  for (const message of params.messages || []) {
    if (message.role === 'tool') {
      const call = (params.messages || []).flatMap(m => m.tool_calls || []).find(c => c.id === message.tool_call_id);
      if (!call) throw badConfig('Vertex AI 工具结果缺少对应调用');
      let response;
      try { response = JSON.parse(message.content); } catch { response = { result: message.content }; }
      const part = { functionResponse: { name: call.function.name, response } };
      const previous = contents.at(-1);
      if (previous?.role === 'user' && previous.parts.every(p => p.functionResponse)) previous.parts.push(part);
      else contents.push({ role: 'user', parts: [part] });
      continue;
    }
    if (message.role === 'assistant' && message.vertex_parts?.length) {
      contents.push({ role: 'model', parts: message.vertex_parts });
      continue;
    }
    const parts = contentParts(message.content);
    if (message.tool_calls?.length) {
      for (const call of message.tool_calls) parts.push({ functionCall: { name: call.function.name, args: JSON.parse(call.function.arguments) } });
    }
    if (message.role === 'system' && !contents.length) systemParts.push(...parts);
    // Later system messages stay at their original chronological boundary.
    else if (['system', 'user', 'assistant'].includes(message.role)) contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
    else throw badConfig(`Vertex AI 暂不支持 ${message.role} 消息`);
  }
  const generationConfig = {};
  if (params.temperature !== undefined) generationConfig.temperature = params.temperature;
  if (params.top_p !== undefined) generationConfig.topP = params.top_p;
  if (params.stop) generationConfig.stopSequences = Array.isArray(params.stop) ? params.stop : [params.stop];
  if (params.response_format?.type === 'json_object') generationConfig.responseMimeType = 'application/json';
  Object.assign(generationConfig, params.generationConfig || {});
  if (params.thinking && !generationConfig.thinkingConfig) {
    const enabled = params.thinking.type === 'enabled';
    if (/gemini-3/.test(params.model)) generationConfig.thinkingConfig = { thinkingLevel: enabled ? 'HIGH' : 'LOW' };
    else if (/gemini-2\.5/.test(params.model)) generationConfig.thinkingConfig = { thinkingBudget: enabled || /-pro/.test(params.model) ? -1 : 0 };
  }
  // The configured limit wins over any native extraBody override as it does for OpenAI.
  generationConfig.maxOutputTokens = params.max_completion_tokens ?? params.max_tokens;
  const body = { contents, generationConfig };
  if (systemParts.length) body.systemInstruction = { parts: systemParts };
  for (const field of ['safetySettings', 'tools', 'toolConfig', 'cachedContent', 'labels']) {
    if (params[field] !== undefined) body[field] = params[field];
  }
  if (params.tools?.some(t => t.type === 'function')) {
    body.tools = [{ functionDeclarations: params.tools.map(t => ({ name: t.function.name, description: t.function.description, parametersJsonSchema: t.function.parameters })) }];
    const mode = params.tool_choice === 'required' ? 'ANY' : params.tool_choice === 'none' ? 'NONE' : 'AUTO';
    body.toolConfig = { functionCallingConfig: { mode } };
  }
  return body;
}

function completion(data, stream, model, state = { toolIndex: 0, prefix: randomUUID() }) {
  if (data.error) throw new Error('Vertex AI 流式请求返回错误');
  const candidate = data.candidates?.[0];
  const blocked = data.promptFeedback?.blockReason || (candidate?.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason) ? candidate.finishReason : null);
  if (blocked) throw new Error(`Vertex AI 未完成生成：${blocked}`);
  const parts = candidate?.content?.parts || [];
  const message = {
    content: parts.filter(p => !p.thought).map(p => p.text || '').join(''),
    reasoning_content: parts.filter(p => p.thought).map(p => p.text || '').join(''),
  };
  const functions = parts.filter(p => p.functionCall);
  if (functions.length) {
    message.tool_calls = functions.map(p => {
      const index = state.toolIndex++;
      return { index, id: `vertex_${state.prefix}_${index}`, type: 'function', function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) } };
    });
  }
  // 保存带签名的原始 parts，后续工具回合原样返给 Gemini。
  if (parts.length) message.vertex_parts = parts;
  if (!stream && !candidate) throw new Error('Vertex AI 未返回候选回复');
  const u = data.usageMetadata;
  return {
    model: data.modelVersion || model,
    choices: [{ [stream ? 'delta' : 'message']: message, finish_reason: candidate?.finishReason === 'MAX_TOKENS' ? 'length' : candidate?.finishReason ? 'stop' : null }],
    ...(u ? { usage: { prompt_tokens: u.promptTokenCount || 0, completion_tokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), total_tokens: u.totalTokenCount || 0, prompt_tokens_details: { cached_tokens: u.cachedContentTokenCount || 0 } } } : {}),
  };
}

async function* streamResponse(response, model, controller) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const state = { toolIndex: 0, prefix: randomUUID() };
  const event = text => {
    const data = text.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    return data && data !== '[DONE]' ? completion(JSON.parse(data), true, model, state) : null;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, '\n');
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const chunk = event(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
        if (chunk) yield chunk;
      }
      if (done) { const chunk = event(buffer); if (chunk) yield chunk; break; }
    }
  } finally { controller.abort(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function createVertexClient({ vertexServiceAccount, vertexRegion = 'global', headers = {}, timeout = 600000 }, fetchImpl = fetch) {
  const account = parseServiceAccount(vertexServiceAccount);
  const region = normalizeVertexRegion(vertexRegion);
  const baseURL = vertexBaseURL(region);
  return { chat: { completions: { async create(params, options = {}) {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(options.timeout ?? timeout), ...(options.signal ? [options.signal] : [])]);
    const body = buildVertexBody(params);
    const token = await getVertexAccessToken(account, { signal, fetchImpl });
    const model = String(params.model || '').replace(/^google\//, '');
    if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw badConfig('Vertex AI 模型名称格式无效');
    const url = `${baseURL}/v1/projects/${encodeURIComponent(account.project_id)}/locations/${region}/publishers/google/models/${model}:${params.stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
    const requestHeaders = new Headers(headers);
    requestHeaders.set('Content-Type', 'application/json');
    requestHeaders.set('Authorization', `Bearer ${token}`);
    const response = await fetchImpl(url, { method: 'POST', signal, redirect: 'error', headers: requestHeaders, body: JSON.stringify(body) });
    if (!response.ok) { if (response.status === 401) clearVertexTokenCache(); await readResponse(response, 'Vertex AI 请求'); }
    if (!params.stream) return completion(await readResponse(response, 'Vertex AI 请求'), false, model);
    const stream = streamResponse(response, model, controller);
    stream.controller = controller;
    return stream;
  } } } };
}

export async function listVertexModels({ vertexServiceAccount, vertexRegion = 'global' }, fetchImpl = fetch) {
  const signal = AbortSignal.timeout(15000);
  const token = await getVertexAccessToken(vertexServiceAccount, { signal, fetchImpl });
  const models = new Set();
  let pageToken = '';
  const seen = new Set();
  do {
    const url = new URL(`${vertexBaseURL(vertexRegion)}/v1beta1/publishers/google/models`);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetchImpl(url, { signal, redirect: 'error', headers: { Authorization: `Bearer ${token}` } });
    const data = await readResponse(response, 'Vertex AI 模型列表');
    for (const row of data.publisherModels || []) {
      const id = row.name?.split('/').pop();
      if (id?.startsWith('gemini-') && !/embedding|image|live|tts/.test(id)) models.add(id);
    }
    pageToken = data.nextPageToken || '';
    if (seen.has(pageToken)) break;
    seen.add(pageToken);
  } while (pageToken);
  if (!models.size) throw new Error('未获取到 Gemini 文本模型，请手动填写模型名称');
  return { ok: true, models: [...models].sort(), capabilities: {} };
}
