/**
 * maibot-bridge/webui.js
 * 插件配置通过 MaiBot WebUI API 读写；人格数据通过桥接插件的本机控制接口读写。
 * 连接设置（WebUI 地址与 Token）存放在邻舍 system_settings 中。
 */
import { getSetting, setSetting } from '../db/index.js';

const PLUGIN_ID = 'github.icecranberry.linshe-bridge';
const COOKIE_TTL_MS = 6 * 60 * 60 * 1000;
const PERSONA_CONTROL_URL = 'http://127.0.0.1:3199';

let cachedCookie = null;
let cachedAt = 0;

function getWebuiUrl() {
  return (getSetting('maibot_webui_url') || 'http://127.0.0.1:8001').replace(/\/+$/, '');
}

export function getWebuiSettings() {
  return {
    url: getSetting('maibot_webui_url') || 'http://127.0.0.1:8001',
    token: getSetting('maibot_webui_token') || '',
  };
}

export function setWebuiSettings({ url, token } = {}) {
  if (url !== undefined) setSetting('maibot_webui_url', String(url).trim());
  if (token !== undefined) setSetting('maibot_webui_token', String(token).trim());
  cachedCookie = null;
  cachedAt = 0;
}

async function login() {
  const token = String(getSetting('maibot_webui_token') || '').trim();
  if (!token) {
    throw new Error('未配置 MaiBot WebUI Token，请先在人格管理页填写并保存');
  }
  const response = await fetch(`${getWebuiUrl()}/api/webui/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) {
    throw new Error(`WebUI 登录失败: HTTP ${response.status}`);
  }
  const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  const cookie = setCookies.find((item) => item.startsWith('maibot_session='));
  if (!cookie) {
    throw new Error('WebUI 登录成功但未返回会话 Cookie');
  }
  cachedCookie = cookie.split(';', 1)[0];
  cachedAt = Date.now();
  return cachedCookie;
}

async function webuiFetch(method, path, body) {
  if (!cachedCookie || Date.now() - cachedAt > COOKIE_TTL_MS) {
    await login();
  }
  const headers = { Cookie: cachedCookie };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${getWebuiUrl()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401 && cachedCookie) {
    cachedCookie = null;
    await login();
    return webuiFetch(method, path, body);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`WebUI ${method} ${path} 失败: HTTP ${response.status} ${detail.slice(0, 200)}`);
  }
  return response.json();
}

export async function getPluginConfig() {
  return webuiFetch('GET', `/api/webui/plugins/config/${PLUGIN_ID}`);
}

export async function updatePluginConfig(config) {
  return webuiFetch('PUT', `/api/webui/plugins/config/${PLUGIN_ID}`, { config });
}

async function personaControlFetch(method, path, body) {
  const response = await fetch(`${PERSONA_CONTROL_URL}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`桥接插件人格接口 ${method} ${path} 失败: HTTP ${response.status} ${data.error || ''}`.trim());
  }
  return data;
}

export async function getPluginPersona() {
  return personaControlFetch('GET', '/persona');
}

export async function updatePluginPersona(persona) {
  return personaControlFetch('PUT', '/persona', persona);
}
