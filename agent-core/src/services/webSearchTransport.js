import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EnvHttpProxyAgent, ProxyAgent } from 'undici';

const run = promisify(execFile);
const windowsRoutes = new Map();
let envDispatcher;

// 让 Windows 为目标站点选择实际代理，包含系统的例外列表和按站点代理规则。
// 这里只传百科或 Bing 的 origin，不把角色名、查询参数交给子进程。
const readProxy = [
  '$ErrorActionPreference = "Stop"',
  '$target = [uri]$env:LINSHE_SEARCH_ORIGIN',
  '$proxy = [Net.WebRequest]::GetSystemWebProxy().GetProxy($target)',
  'if ($proxy -and $proxy -ne $target) { $proxy.AbsoluteUri }',
].join('; ');

export async function getWebSearchDispatcher(url) {
  const env = process.env;
  if (env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY) {
    return envDispatcher ??= new EnvHttpProxyAgent();
  }
  if (process.platform !== 'win32') return undefined;

  const origin = new URL(url).origin;
  const state = windowsRoutes.get(origin) || {};
  if (!state.pending || Date.now() >= state.expires) {
    state.expires = Date.now() + 60_000;
    state.pending = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', readProxy], {
      windowsHide: true, timeout: 3000, env: { ...env, LINSHE_SEARCH_ORIGIN: origin },
    }).then(({ stdout }) => {
      const address = stdout.trim();
      if (address !== state.address) {
        const next = address ? new ProxyAgent(address) : undefined;
        state.dispatcher?.close().catch(() => {});
        state.address = address;
        state.dispatcher = next;
      }
      return state.dispatcher;
    }).catch(error => {
      console.warn('[webSearch] 无法读取 Windows 系统代理设置:', error.code || error.name);
      return state.dispatcher;
    });
    windowsRoutes.set(origin, state);
  }
  return state.pending;
}
