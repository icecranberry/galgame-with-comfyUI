// Protocol/transport adapter. Reference: SillyTavern src/endpoints/novelai.js
// and src/request-proxy.js. Native fetch needs an Undici dispatcher, not http.globalAgent.
import { randomInt } from 'node:crypto';
import { EnvHttpProxyAgent, ProxyAgent } from 'undici';
import { unzipSync } from 'fflate';

export const NOVELAI_MODELS = ['nai-diffusion-5-full', 'nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated', 'nai-diffusion-4-full', 'nai-diffusion-4-curated-preview', 'nai-diffusion-3', 'nai-diffusion-furry-3'];
export const normalizeNovelaiFormat = value => ['official', 'native', 'relay'].includes(value) ? value : 'relay';
export const normalizeNovelaiKey = value => String(value || '').trim().replace(/^Bearer\s+/i, '').trim();

export function validateNovelaiUrl(value, label = 'NovelAI 地址') {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error(`${label}必须是有效的 HTTP 或 HTTPS URL`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label}仅支持 HTTP/HTTPS，不能包含用户名、密码、查询参数或片段`);
  }
  return url;
}

export function novelaiEndpoint({ apiFormat, url }, operation = 'generate') {
  const format = normalizeNovelaiFormat(apiFormat);
  const target = validateNovelaiUrl(format === 'official' ? 'https://image.novelai.net' : url);
  let prefix = target.pathname.replace(/\/+$/, '');
  if (format === 'relay') {
    prefix = prefix.replace(/\/(?:images\/generations|models)$/, '').replace(/\/v1$/, '');
    target.pathname = `${prefix}/v1/${operation === 'generate' ? 'images/generations' : 'models'}`;
  } else {
    prefix = prefix.replace(/\/(?:ai\/generate-image|user\/subscription)$/, '').replace(/\/ai$/, '');
    target.pathname = `${prefix}/${operation === 'generate' ? 'ai/generate-image' : 'user/subscription'}`;
  }
  return target.toString();
}

export function buildNovelaiBody(prompt, options) {
  const { model = 'nai-diffusion-4-5-full', width = 1216, height = 832, steps = 28,
    sampler = 'k_euler_ancestral', noiseSchedule = 'karras', scale = 5, negativePrompt = '' } = options;
  if (normalizeNovelaiFormat(options.apiFormat) === 'relay') {
    return { model, prompt, size: `${width}x${height}`, steps, sampler, noise_schedule: noiseSchedule,
      scale, negative_prompt: negativePrompt, n: 1, response_format: 'b64_json' };
  }
  const modern = /^nai-diffusion-(4|5)-/.test(model);
  return { action: 'generate', input: prompt, model, parameters: {
    params_version: model.startsWith('nai-diffusion-5-') ? 4 : modern ? 3 : 1,
    width, height, steps, sampler, noise_schedule: noiseSchedule, scale,
    seed: randomInt(0, 0x100000000), n_samples: 1, image_format: 'png',
    negative_prompt: negativePrompt, qualityToggle: false, ucPreset: 0,
    legacy: false, legacy_v3_extend: false, sm: false, sm_dyn: false,
    dynamic_thresholding: false, uncond_scale: 1, prefer_brownian: true,
    ...(modern ? {
      use_coords: false, characterPrompts: [],
      v4_prompt: { caption: { base_caption: prompt, char_captions: [] }, use_coords: false, use_order: true },
      v4_negative_prompt: { caption: { base_caption: negativePrompt, char_captions: [] }, legacy_uc: false },
    } : {}),
  } };
}

const MAX_BYTES = 64 * 1024 * 1024;
async function readBytes(response, limit = MAX_BYTES) {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const parts = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); throw new Error('响应内容过大'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts, length);
}

function redact(value, key) {
  let text = String(value || '');
  if (key) text = text.replaceAll(key, '[redacted]');
  return text.replace(/Bearer\s+[^\s"<>]+/gi, 'Bearer [redacted]').slice(0, 350);
}

class NovelaiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function checkResponse(response, key, endpoint) {
  if (response.ok) return;
  const raw = (await readBytes(response, 64 * 1024)).toString('utf8');
  let detail = raw;
  try { const data = JSON.parse(raw); detail = data.error?.message || data.message || data.error || data.details || raw; } catch { /* plain text gateway errors */ }
  if (/gems balance is insufficient/i.test(String(detail))) detail = '该中转服务的 Gems 余额不足，请补充余额或切换接口。';
  const hint = response.status === 401 ? '认证被拒绝，请核对当前站点的 Key、接口协议及接口权限。'
    : response.status === 403 ? '当前接口无访问权限。'
      : response.status === 429 ? '服务限流，请稍后重试。'
        : response.status === 404 ? '接口不存在，请核对地址及协议。' : '';
  const target = new URL(endpoint);
  throw new NovelaiError(`HTTP ${response.status}（${target.origin}${target.pathname}）：${hint}${redact(detail, key)}`, response.status);
}

export function describeNovelaiError(error, key = '') {
  if (error instanceof NovelaiError) return redact(error.message, key);
  const code = error?.cause?.code || error?.code || '';
  if (error?.name === 'TimeoutError' || /TIMEOUT|ETIMEDOUT/.test(code)) {
    return `请求超时${code ? `（${code}）` : ''}，请检查运行邻舍后端的网络与代理；浏览器能访问不代表后端已使用代理。`;
  }
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return `域名解析失败（${code}），请检查接口地址和后端 DNS。`;
  if (/CERT|TLS|SSL/.test(code)) return `TLS 证书连接失败（${code}），请检查代理和证书配置。`;
  if (['ECONNREFUSED', 'ECONNRESET'].includes(code)) return `连接失败（${code}），请检查接口地址、代理端口和服务状态。`;
  // Do not surface transport error messages containing proxy credentials.
  if (error?.message === 'fetch failed') return `网络连接失败${code ? `（${code}）` : ''}，请检查后端网络与代理。`;
  return redact(error?.message || '请求失败', key);
}

/** 站点把未实现的路径交给前端页面处理时返回 200 + HTML，用内容类型和首字节识别 */
function looksLikeHtml(bytes, response) {
  const type = String(response.headers?.get?.('content-type') || '').toLowerCase();
  if (type.includes('text/html')) return true;
  const head = bytes.subarray(0, 200).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

/**
 * 部分中转站只实现生图接口，没有订阅/模型检测接口，请求会落到站点网页。
 * 这不是「连不上」，也不能据此判定 Key 无效，因此单独标记，交由调用方按「无法验证」处理。
 */
function noDetectionEndpoint(apiFormat, endpoint) {
  const target = new URL(endpoint);
  const hint = apiFormat === 'relay'
    ? '该站点没有 OpenAI 兼容接口（/v1/models 返回的是网页），如站点支持原生协议请改用「NovelAI 原生协议中转」。'
    : '该站点没有订阅/模型检测接口（只提供生图接口），本页无法验证鉴权，请用「画风测试」或图片实验室实际生成一张确认。';
  const error = new Error(`${target.origin}${target.pathname} 返回的是网页（HTML）而不是 API。${hint}`);
  error.noDetectionEndpoint = true;
  return error;
}

function createDispatcher(proxyUrl) {
  if (proxyUrl) return new ProxyAgent(validateNovelaiUrl(proxyUrl, '代理地址').toString());
  return new EnvHttpProxyAgent(); // Explicit opt-in also works on bundled Node versions without --use-env-proxy.
}

async function withTransport(options, run, dependencies = {}) {
  const key = normalizeNovelaiKey(options.apiKey);
  if (!key) throw new Error('请先配置 NovelAI API Key');
  let dispatcher;
  let signal;
  try {
    dispatcher = (dependencies.createDispatcher || createDispatcher)(options.proxyUrl);
    signal = AbortSignal.timeout(options.timeoutMs ?? 180_000);
    const request = async (url, init = {}) => {
      const response = await (dependencies.fetch || globalThis.fetch)(url, {
        ...init, dispatcher, signal, redirect: 'manual',
      });
      // Do not forward a credential to a different host or silently lose it on redirects.
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new Error('接口发生重定向，请填写服务商提供的最终 API 地址后重试。');
      }
      return response;
    };
    return await run(request, key);
  } catch (error) {
    const wrapped = new NovelaiError(describeNovelaiError(signal?.aborted ? signal.reason : error, key), error.status);
    if (error?.noDetectionEndpoint) wrapped.noDetectionEndpoint = true;
    throw wrapped;
  } finally { await dispatcher?.close(); }
}

function imageData(bytes) {
  const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
    : bytes[0] === 255 && bytes[1] === 216 ? 'image/jpeg'
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
  if (!mime) throw new Error('服务返回的内容不是有效的 PNG、JPEG 或 WebP 图片');
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

export async function generateNovelaiImage(prompt, options, dependencies) {
  const endpoint = novelaiEndpoint(options);
  return withTransport(options, async (request, key) => {
    const response = await request(endpoint, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
        Accept: normalizeNovelaiFormat(options.apiFormat) === 'relay' ? 'application/json' : 'application/zip, application/json' },
      body: JSON.stringify(buildNovelaiBody(prompt, options)),
    });
    await checkResponse(response, key, endpoint);
    const bytes = await readBytes(response);
    let values = [];
    let created;
    if (bytes[0] === 80 && bytes[1] === 75) {
      let expanded = 0;
      const entries = unzipSync(bytes, { filter: entry => {
        if (!/\.(png|webp|jpe?g)$/i.test(entry.name)) return false;
        expanded += entry.originalSize;
        if (expanded > MAX_BYTES) throw new Error('图片解压后过大');
        return true;
      } });
      values = Object.values(entries).map(value => imageData(Buffer.from(value)));
    } else if (response.headers.get('content-type')?.startsWith('image/')) {
      values = [imageData(bytes)];
    } else {
      let payload;
      try { payload = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('接口未返回可识别的图片或 JSON，请核对接口地址与协议'); }
      created = payload.created;
      const entries = payload.images || payload.data || [];
      if (!Array.isArray(entries)) throw new Error('图片响应格式不正确');
      for (const entry of entries) {
        const value = typeof entry === 'string' ? entry : entry?.image || entry?.b64_json;
        if (value) {
          values.push(imageData(Buffer.from(String(value).replace(/^data:image\/[^;]+;base64,/, ''), 'base64')));
        } else if (entry?.url) {
          const imageUrl = new URL(entry.url);
          if (!['https:', 'http:'].includes(imageUrl.protocol) || imageUrl.username || imageUrl.password) throw new Error('图片下载地址无效');
          // CDN downloads never receive the API Authorization header.
          const download = await request(imageUrl.toString());
          await checkResponse(download, key, imageUrl);
          values.push(imageData(await readBytes(download)));
        }
      }
    }
    if (!values.length) throw new Error('NovelAI 服务没有返回图片数据');
    return { created, images: values.map((base64, index) => ({ base64, filename: `novelai_${Date.now()}_${index + 1}.${base64.startsWith('data:image/webp') ? 'webp' : base64.startsWith('data:image/jpeg') ? 'jpg' : 'png'}` })) };
  }, dependencies);
}

/**
 * 没有检测接口时，用一次空 body 的生图请求确认生图接口本身是否在线：
 * 空 body 不含 prompt/action，服务端只会返回参数校验错误（不会真的出图、不消耗额度），
 * 404/405 或返回网页则说明这个地址根本没有生图接口。
 */
async function probeGenerateEndpoint(options, dependencies) {
  try {
    return await withTransport({ ...options, timeoutMs: options.timeoutMs ?? 15_000 }, async (request, key) => {
      const endpoint = novelaiEndpoint(options);
      const response = await request(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({}),
      });
      const bytes = await readBytes(response, 8 * 1024);
      const target = new URL(endpoint);
      if (looksLikeHtml(bytes, response) || [404, 405].includes(response.status)) {
        return { exists: false, target: `${target.origin}${target.pathname}` };
      }
      return { exists: true, status: response.status, target: `${target.origin}${target.pathname}` };
    }, dependencies);
  } catch {
    return { exists: false };
  }
}

export async function checkNovelaiConnection(options, dependencies) {
  const apiFormat = normalizeNovelaiFormat(options.apiFormat);
  let endpoint;
  try {
    endpoint = novelaiEndpoint(options, 'health');
    return await withTransport({ ...options, timeoutMs: options.timeoutMs ?? 30_000 }, async (request, key) => {
      const response = await request(endpoint, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
      await checkResponse(response, key, endpoint);
      let payload;
      const bytes = await readBytes(response, 1024 * 1024);
      if (looksLikeHtml(bytes, response)) throw noDetectionEndpoint(apiFormat, endpoint);
      try { payload = JSON.parse(bytes.toString('utf8')); }
      catch { throw new Error('检测接口未返回有效 JSON，请核对地址与协议'); }
      if (apiFormat !== 'relay') {
        if (!payload || typeof payload !== 'object' || !('tier' in payload)) throw new Error('订阅接口未返回可识别的订阅信息，请核对原生中转地址');
        return { connected: true, authenticated: true, models: [...NOVELAI_MODELS], modelSource: 'builtin',
          message: '鉴权成功；显示内置绘图模型，具体模型权限以实际生图为准。' };
      }
      const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
      const models = [...new Set(rows.map(item => typeof item === 'string' ? item : item?.id).filter(Boolean))];
      return { connected: true, authenticated: true, models, modelSource: 'remote',
        modelAvailable: models.length ? !options.model || models.includes(options.model) : undefined,
        message: models.length ? '模型列表接口鉴权成功；生图权限以实际请求为准。' : '接口可访问，但未返回模型列表；可手动填写模型后测试生图。' };
    }, dependencies);
  } catch (error) {
    // 站点只有生图接口、没有检测接口：既不是连不上，也不能据此判定 Key 无效
    if (error?.noDetectionEndpoint) {
      const probe = await probeGenerateEndpoint(options, dependencies);
      const suffix = probe.exists
        ? ` 已确认 ${probe.target} 提供生图接口（返回参数校验结果），鉴权与出图请用实际生成验证。`
        : '';
      return { connected: null, authenticated: null, models: [], detectionEndpoint: false,
        error: `${describeNovelaiError(error)}${suffix}` };
    }
    const unknown = [401, 403, 404, 405, 501].includes(error.status) && apiFormat !== 'official';
    return { connected: unknown ? null : false, authenticated: unknown ? null : false, models: [],
      error: `${describeNovelaiError(error)}${unknown ? ' 此检测接口可能未开放，不能据此确定生图 Key 无效；可手动填写模型后测试生图。' : ''}` };
  }
}
