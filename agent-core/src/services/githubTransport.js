import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import tls from 'node:tls';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DATA_DIR = fileURLToPath(new URL('../../data/', import.meta.url));
const PROXY_PORTS = [7890, 7897, 10809, 10808, 7891, 7892, 8080, 8888];
const PROBE_HOST = 'api.github.com';
const RETRY_AFTER_MS = 30_000;

function probeGithubProxy(port) {
  return new Promise(resolve => {
    let secureSocket;
    const authority = `${PROBE_HOST}:443`;
    const request = http.request({
      host: '127.0.0.1', port, method: 'CONNECT', path: authority, headers: { Host: authority }, agent: false,
    });
    const timer = setTimeout(() => finish(false), 2500);
    function finish(connected) {
      clearTimeout(timer);
      secureSocket?.destroy();
      request.destroy();
      resolve(connected ? `http://127.0.0.1:${port}` : '');
    }
    request.once('error', () => finish(false));
    request.once('connect', (response, socket, head) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        finish(false);
        return;
      }
      if (head.length) socket.unshift(head);
      secureSocket = tls.connect({ socket, servername: PROBE_HOST, rejectUnauthorized: true });
      secureSocket.once('error', () => finish(false));
      secureSocket.once('secureConnect', () => finish(true));
    });
    request.end();
  });
}

export function normalizeGithubProxy(value) {
  if (value === null) return null;
  const text = String(value ?? '').trim();
  if (!text) return '';
  const url = URL.parse(text);
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw Object.assign(new Error('请输入无账号密码的 HTTP 代理地址，例如 http://127.0.0.1:7890'), { status: 400 });
  }
  return url.origin;
}

export function createGithubTransport({
  dataDir = DATA_DIR, ports = PROXY_PORTS, probePort = probeGithubProxy, fetchImpl = fetch,
} = {}) {
  const manualFile = path.join(dataDir, 'github-proxy.json');
  const autoFile = path.join(dataDir, 'github-proxy-auto.json');
  let directAgent, activeProxy, discovering, nextProbeAt = 0, failedProxy;

  function read(file) {
    try {
      const { proxyUrl } = JSON.parse(fs.readFileSync(file, 'utf8'));
      return typeof proxyUrl === 'string' ? normalizeGithubProxy(proxyUrl) : undefined;
    } catch {
      return undefined;
    }
  }

  function remember(file, proxyUrl) {
    fs.mkdirSync(dataDir, { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ proxyUrl }));
      fs.renameSync(temporary, file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

  function savedSettings() {
    const manual = read(manualFile);
    if (manual !== undefined) return { proxyUrl: manual, proxyMode: manual ? 'manual' : 'direct' };
    const detected = read(autoFile);
    if (detected) return { proxyUrl: detected, proxyMode: 'auto' };
  }

  async function resolveSettings() {
    const saved = savedSettings();
    if (saved) return saved;
    if (discovering) return discovering;
    if (Date.now() < nextProbeAt) return { proxyUrl: '', proxyMode: 'auto' };
    discovering = (async () => {
      const results = await Promise.all(ports.map(probePort));
      const existing = savedSettings();
      if (existing) return existing;
      const proxyUrl = results.find(Boolean) || '';
      if (proxyUrl) {
        try { remember(autoFile, proxyUrl); }
        catch (error) { console.warn('[github] 无法保存自动代理', error.code); }
      }
      nextProbeAt = Date.now() + RETRY_AFTER_MS;
      return { proxyUrl, proxyMode: 'auto' };
    })().finally(() => { discovering = null; });
    return discovering;
  }

  function setProxy(value) {
    const proxyUrl = normalizeGithubProxy(value);
    if (proxyUrl === null) {
      fs.rmSync(autoFile, { force: true });
      fs.rmSync(manualFile, { force: true });
      nextProbeAt = 0;
    } else {
      remember(manualFile, proxyUrl);
    }
    failedProxy = null;
  }

  async function fetchGithub(url, options = {}) {
    const { Agent, ProxyAgent } = await import('undici');
    directAgent ??= new Agent();
    const { proxyUrl, proxyMode } = await resolveSettings();
    const direct = () => fetchImpl(url, { ...options, dispatcher: directAgent });
    if (!proxyUrl || (proxyMode === 'auto' && failedProxy?.url === proxyUrl && Date.now() < failedProxy.until)) {
      return direct();
    }
    if (activeProxy?.url !== proxyUrl) {
      void activeProxy?.dispatcher.close().catch(() => {});
      activeProxy = { url: proxyUrl, dispatcher: new ProxyAgent(proxyUrl) };
    }
    const dispatcher = activeProxy.dispatcher;
    if (proxyMode === 'manual') return fetchImpl(url, { ...options, dispatcher });

    // Only bound the automatic proxy's wait for response headers. Large ZIP bodies
    // keep the caller's normal timeout once a connection has started responding.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    try {
      return await fetchImpl(url, { ...options, signal, dispatcher });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      failedProxy = { url: proxyUrl, until: Date.now() + RETRY_AFTER_MS };
      return direct();
    } finally {
      clearTimeout(timer);
    }
  }

  return { resolveSettings, setProxy, fetch: fetchGithub };
}

export const githubTransport = createGithubTransport();
