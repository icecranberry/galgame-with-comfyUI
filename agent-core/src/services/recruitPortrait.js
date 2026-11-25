import sharp from 'sharp';
import { getWebSearchDispatcher } from './webSearchTransport.js';

const games = {
  gi: { wiki: 'ys', matchesWork: text => text.includes('原神') },
  hsr: { wiki: 'sr', matchesWork: text => text.includes('星穹铁道') },
  zzz: { wiki: 'zzz', matchesWork: text => text.includes('绝区零') },
  bh3: { wiki: 'bh3', matchesWork: text => /崩坏(?:3|三|iii)/i.test(text) },
};
const wiki = 'https://wiki.biligame.com';
const baike = 'https://bkso.baidu.com';
const wikiImages = ['patchwiki.biligame.com'];
const baikeImages = ['bkimg.cdn.bcebos.com'];

// 词条跳转和远端返回的图片地址均按用途限制域名。限制解压后的字节数。
async function readBytes(url, hosts, signal, maxBytes) {
  let target = new URL(url);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (target.protocol !== 'https:' || target.username || target.password || target.port || !hosts.includes(target.hostname)) {
      throw new Error('百科地址超出允许范围');
    }
    const dispatcher = await getWebSearchDispatcher(target);
    const response = await fetch(target, { dispatcher, signal, redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error('百科跳转地址为空');
      target = new URL(location, target);
      continue;
    }
    if (!response.ok || Number(response.headers.get('content-length')) > maxBytes) {
      await response.body?.cancel();
      throw new Error(response.ok ? '百科文件过大' : 'HTTP ' + response.status);
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('百科文件过大');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  }
  throw new Error('百科跳转次数过多');
}

async function wikiPortrait(name, game, signal) {
  const base = wiki + '/' + game.wiki;
  async function query(params) {
    const url = base + '/api.php?' + new URLSearchParams({ format: 'json', ...params });
    const bytes = await readBytes(url, ['wiki.biligame.com'], signal, 1024 * 1024);
    return JSON.parse(bytes.toString());
  }
  async function fileInfo(files) {
    const data = await query({ action: 'query', titles: files.map(f => 'File:' + f).join('|'),
      prop: 'imageinfo', iiprop: 'url', redirects: '1' });
    const pages = Object.values(data.query?.pages || {});
    for (const file of files) {
      const title = '文件:' + file;
      const resolved = data.query?.redirects?.find(r => r.from === title)?.to || title;
      const info = pages.find(p => p.title === resolved)?.imageinfo?.[0];
      if (info?.url) return { url: info.url, page: info.descriptionurl, hosts: wikiImages };
    }
    return null;
  }
  const files = game.wiki === 'ys' ? [name + '立绘2.png', name + '抽卡立绘.png']
    : game.wiki === 'zzz' ? ['角色立绘-' + name + '.png'] : [name + '立绘.png'];
  const hit = await fileInfo(files);
  if (hit || game.wiki !== 'zzz') return hit;

  // 少数代理人（如月城柳）的角色页使用简称命名立绘。
  const data = await query({ action: 'parse', page: name, prop: 'images', redirects: '1' });
  const aliases = (data.parse?.images || []).filter(file => {
    const alias = /^角色立绘-([^-]+)\.png$/u.exec(file)?.[1];
    return alias && (name.includes(alias) || alias.includes(name));
  });
  return aliases.length === 1 ? fileInfo(aliases) : null;
}

function normalize(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s·・:：《》]/gu, '');
}

async function baikePortrait(name, game, signal) {
  const item = (title, id) => baike + '/item/' + encodeURIComponent(title) + (id ? '/' + id : '');
  async function article(url) {
    const bytes = await readBytes(url, ['bkso.baidu.com', 'baike.baidu.com'], signal, 5 * 1024 * 1024);
    const data = /<script\b[^>]*>\s*window\.PAGE_DATA\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i.exec(bytes.toString());
    return data ? JSON.parse(data[1]) : null;
  }
  const matchesWork = desc => game.matchesWork(normalize(desc));
  let page = await article(item(name));
  if (!page) return null;
  // 百度的默认义项可能是真人、同名作品或同系列另一作。
  const names = [name, page.lemmaTitle, page.navigation?.word].filter(Boolean).map(normalize);
  if (!names.slice(1).some(n => n === names[0] || n.startsWith(names[0]))) return null;
  if (!matchesWork(page.lemmaDesc)) {
    const choices = (page.navigation?.lemmas || []).filter(row =>
      names.includes(normalize(row.lemmaTitle)) && matchesWork(row.redirectDesc || row.lemmaDesc));
    const choice = choices.find(row => !/后崩坏书|平行|联动/.test(row.redirectDesc || row.lemmaDesc)) || choices[0];
    const id = choice?.redirectId || choice?.lemmaId;
    if (choice) {
      if (!Number.isSafeInteger(id) || id <= 0) return null;
      const title = choice.redirectTitle || choice.lemmaTitle;
      page = await article(item(title, id));
      if (!page || normalize(page.lemmaTitle) !== normalize(title)) return null;
    }
  }
  // 有些义项只写「虚拟歌手」等分类，作品或系列名称在词条简介的首句。
  if (!matchesWork(page.lemmaDesc) && !matchesWork(page.description?.split(/[。！？]/u, 1)[0])) return null;
  // 概述图册的封面是本义项的代表图。正文首图可能是贺图、其他人物或道具。
  const cover = page.abstractAlbum?.coverPic;
  return cover?.url ? { url: cover.url, page: item(page.lemmaTitle, page.lemmaId), hosts: baikeImages } : null;
}

/** 取图与智慧宫文字独立，任一来源读图失败都可继续使用另一来源或文字外观。 */
export async function findRecruitPortrait(name, world, signal) {
  const game = games[world];
  if (!game) return {};
  const sources = world === 'bh3' ? [baikePortrait, wikiPortrait] : [wikiPortrait, baikePortrait];
  return findPortrait(name, game, sources, signal);
}

export function findBaikePortrait(name, ip, signal) {
  const work = typeof ip === 'string' && ip.length <= 200 && normalize(ip);
  if (!work) return {};
  return findPortrait(name, { matchesWork: text => text.includes(work) }, [baikePortrait], signal);
}

async function findPortrait(name, game, sources, signal) {
  if (typeof name !== 'string' || !name.trim() || name.length > 80 || /[|\r\n]/.test(name)) return {};
  for (const source of sources) {
    if (signal?.aborted) break;
    const label = source === wikiPortrait ? 'BWIKI' : '百度百科';
    const timeout = AbortSignal.timeout(9000);
    const deadline = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const result = await source(name.trim(), game, deadline);
      if (!result) {
        console.info(`[webSearch] ${label}未匹配到「${name}」的立绘`);
        continue;
      }
      const bytes = await readBytes(result.url, result.hosts, deadline, 20 * 1024 * 1024);
      const image = sharp(bytes, { limitInputPixels: 40000000 });
      const meta = await image.metadata();
      if (!['png', 'jpeg', 'webp'].includes(meta.format) || Math.min(meta.width, meta.height) < 150) {
        throw new Error('图片格式或尺寸不适合识图');
      }
      const preview = await image.rotate().resize({ width: 1440, height: 1440, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 87 }).toBuffer();
      console.info(`[webSearch] 已取得${label}立绘「${name}」 ${result.page}`);
      return { referenceImage: 'data:image/webp;base64,' + preview.toString('base64'),
        referenceImageInfo: { status: 'ready', source: label, page_url: result.page } };
    } catch (error) {
      if (!signal?.aborted) console.warn(`[webSearch] ${label}取图失败「${name}」：${error.message}`);
    }
  }
  return {};
}
