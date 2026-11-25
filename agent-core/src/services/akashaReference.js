import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getWebSearchDispatcher } from './webSearchTransport.js';

const endpoint = new URL('https://agent.zlb.ink/api/mcp/');

export function akashaWorld(ip = '') {
  if (ip.includes('铁道')) return 'hsr';
  if (ip.includes('原神')) return 'gi';
  if (ip.includes('绝区零')) return 'zzz';
  if (ip.includes('崩坏')) return 'bh3';
  return '';
}

// 首行同时供「重新整理」恢复角色与资料来源，其余部分是可直接阅读的检索原文。
export function cachedAkashaIdentity(text) {
  const match = /^【(?:智慧宫|虚空终端)·([^】\r\n]+)】([^\r\n]+)\r?\n/.exec(text);
  return match && akashaWorld(match[1]) ? { ip: match[1], name: match[2] } : null;
}

function selectDocuments(index, name) {
  const candidates = new Map();
  const entries = index.split(/\n(?=- )/);
  for (const entry of entries) {
    const doc = /^- (.+?) \| (doc_[\w-]+) \| [^\n]*?文件目录=([^\n]+)/.exec(entry);
    if (!doc) continue;
    const [, title, hash, directory] = doc;
    const hit = /^\s*L(\d+):/m.exec(entry);
    const named = title.includes(name);
    if (!named && (!hit || !entry.slice(doc[0].length).includes(name))) continue;
    const score = (named ? 4 : 0) + (title === name ? 2 : 0)
      + (/角色|人物|百科|语音/.test(directory) && named ? 4 : 0);
    const offset = named ? 1 : Math.max(1, Number(hit[1]) - 4);
    if (!candidates.has(hash)) candidates.set(hash, { title, hash, offset, score });
  }
  return [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, 3);
}

export async function fetchAkashaReference(name, ip, signal) {
  const world = akashaWorld(ip);
  if (!world || !name) return '';
  const timeout = AbortSignal.timeout(25_000);
  const deadline = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const dispatcher = await getWebSearchDispatcher(endpoint);
  const transport = new StreamableHTTPClientTransport(endpoint, {
    fetch: (url, init) => fetch(url, { ...init, dispatcher,
      signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline }),
  });
  const client = new Client({ name: 'linshe-character-cards', version: '1.0.0' });
  async function lookup(tool, args) {
    const result = await client.callTool({ name: tool, arguments: { world, ...args } }, undefined, { signal: deadline });
    if (result.isError) throw new Error(tool + ' 返回错误');
    return result.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
  }
  try {
    await client.connect(transport, { signal: deadline });
    const index = await lookup('akasha_search', { keyword: name, maxResults: 8 });
    const docs = selectDocuments(index, name);
    const reads = await Promise.allSettled(docs.map(async doc => {
      const page = await lookup('akasha_read', { pathHash: doc.hash, offset: doc.offset, limit: 120 });
      const body = /(?:^|\n)正文[:：]\s*([\s\S]+)/.exec(page)?.[1]?.trim();
      if (!body || (!doc.title.includes(name) && !body.includes(name))) return '';
      return doc.title + '\n' + body.slice(0, 5500);
    }));
    signal?.throwIfAborted();
    const passages = reads.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
    const failure = reads.find(r => r.status === 'rejected');
    if (!passages.length && failure) throw failure.reason;
    return passages.length ? '【智慧宫·' + ip + '】' + name + '\n' + passages.join('\n\n') : '';
  } finally {
    await client.close();
  }
}
