import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { githubTransport } from '../../agent-core/src/services/githubTransport.js';

const execute = promisify(execFile);
const CURL_CONNECTION_ERRORS = new Set([5, 6, 7, 28, 35, 52, 55, 56]);

export function isGithubDownload(value) {
  try {
    const { protocol, hostname } = new URL(value);
    return protocol === 'https:' && (hostname === 'github.com' || hostname === 'codeload.github.com' ||
      hostname === 'api.github.com' || hostname.endsWith('.githubusercontent.com'));
  } catch {
    return false;
  }
}

async function downloadBeforeDependencies(url, temporary, timeoutSec) {
  const { proxyUrl, proxyMode } = await githubTransport.resolveSettings();
  const download = proxy => execute(process.platform === 'win32' ? 'curl.exe' : 'curl', [
    '--disable', '--fail', '--silent', '--show-error', '--location', '--proto-redir', '=https',
    '--proxy', proxy, '--noproxy', proxy ? '' : '*', '--max-time', String(timeoutSec), '--output', temporary, url,
  ], { windowsHide: true });
  try {
    await download(proxyUrl);
  } catch (error) {
    if (proxyMode !== 'auto' || !proxyUrl || !CURL_CONNECTION_ERRORS.has(error.code)) throw error;
    await download('');
  }
}

export async function downloadGithubFile(url, destination, timeoutSec) {
  if (!destination || !isGithubDownload(url)) return false;
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    let response;
    try {
      response = await githubTransport.fetch(url, { signal: AbortSignal.timeout(timeoutSec * 1000) });
    } catch (error) {
      // The release builder may download PortableGit before npm dependencies are installed.
      if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
      await downloadBeforeDependencies(url, temporary, timeoutSec);
    }
    if (response) {
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        return false;
      }
      await pipeline(response.body, createWriteStream(temporary));
    }
    await rename(temporary, destination);
    return true;
  } catch {
    return false;
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}
