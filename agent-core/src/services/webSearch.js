/**
 * 联网搜索 — 为角色生成提供真实资料
 *
 * 先搜萌娘百科（ACG 角色专业 wiki，大陆可直连），获取角色背景、
 * 性格、经历等结构化资料。萌娘百科无结果时降级到 Bing 搜索。
 *
 * 免费、无需 API Key、无速率限制。
 *
 * 搜索链路：萌娘百科（mzh.moegirl.org.cn）→ 无结果时 Bing 降级
 */

import { chatSync } from '../llm/deepseek.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const FETCH_TIMEOUT = 5000; // 萌娘百科/通用单次请求 5s 超时
const BING_TIMEOUT = 8000;  // Bing 抓取（含 HTML 解析，给更长时间）

function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * 用默认模型从用户输入中提取核心角色名称和作品上下文
 * 例如 "绝区零里的千夏" → { name: "千夏", context: "绝区零" }
 * 作品上下文用于在萌娘百科多结果排序时优先匹配
 * @param {string} rawQuery - 用户原始输入
 * @returns {Promise<{name: string, context: string}>} 提取结果，失败时 name 返回原 query
 */
async function extractNameForSearch(rawQuery) {
  if (!rawQuery || rawQuery.length < 2) return { name: rawQuery, context: '' };
  try {
    const result = await chatSync([
      { role: 'system', content: '你是一个动漫游戏角色搜索关键词提取器和纠错器。从用户输入中提取核心角色名称和所属作品。\n如果角色名有错别字（如输入"芙宁哪"→纠正为"芙宁娜"），请自动纠正为正确的官方名称。\n输出格式：角色名|作品名\n如果没有作品名，只输出角色名，|后面留空。\n\n示例：\n输入：绝区零里的千夏\n输出：千夏|绝区零\n输入：芙宁娜（原神）\n输出：芙宁娜|原神\n输入：帮我看一下雷电将军的背景故事\n输出：雷电将军|\n输入：一个金发双马尾的傲娇角色\n输出：金发双马尾傲娇角色|\n输入：芙宁哪\n输出：芙宁娜|原神\n输入：我想要钟离\n输出：钟离|原神' },
      { role: 'user', content: rawQuery },
    ], { temperature: 0, max_tokens: 60 });
    const trimmed = (result || '').trim();
    const pipeIdx = trimmed.indexOf('|');
    if (pipeIdx !== -1) {
      const name = trimmed.slice(0, pipeIdx).trim();
      const context = trimmed.slice(pipeIdx + 1).trim();
      if (name && name.length > 0 && name.length <= 30) {
        console.log(`[webSearch] extractNameForSearch: "${rawQuery}" → name="${name}", context="${context}"`);
        return { name, context };
      }
    }
  } catch (err) {
    console.warn(`[webSearch] extractNameForSearch failed, using raw query: ${err.message}`);
  }
  return { name: rawQuery, context: '' };
}

/**
 * 搜索角色相关信息
 * @param {string} query - 搜索词，如 "芙宁娜 原神"
 * @returns {Promise<string>} 格式化后的搜索结果文本
 */
export async function searchCharacterInfo(query) {
  // 先用 LLM 提取核心角色名 + 作品上下文，提升萌娘百科搜索命中率
  const { name: searchName, context } = await extractNameForSearch(query);

  // 没有作品上下文 → 原创角色描述 → 跳过搜索，让 LLM 自行发挥
  if (!context) {
    console.log(`[webSearch] no work context, skipping search (original character): "${searchName}"`);
    return '';
  }

  const allResults = [];

  // 1. 萌娘百科（ACG 角色专业 wiki，大陆可直连）
  try {
    const moe = await searchMoegirl(searchName);
    // 如有作品上下文，对结果排序并只保留匹配作品名的第一条（排除同名干扰）
    if (context && moe.length > 0) {
      const ctx = context.toLowerCase();
      moe.sort((a, b) => {
        const aMatch = a.title.toLowerCase().includes(ctx) || a.content.toLowerCase().includes(ctx) ? 1 : 0;
        const bMatch = b.title.toLowerCase().includes(ctx) || b.content.toLowerCase().includes(ctx) ? 1 : 0;
        return bMatch - aMatch;
      });
      const matched = moe.filter(r => r.title.toLowerCase().includes(ctx) || r.content.toLowerCase().includes(ctx));
      if (matched.length > 0) {
        console.log(`[webSearch] filtered ${moe.length} → 1 result by context "${context}": "${matched[0].title}"`);
        // 深度抓取萌娘百科基本资料栏，补全外貌等关键信息
        const best = matched[0];
        if (best.source && best.source.includes('moegirl.org.cn')) {
          try {
            const pageData = await scrapeMoegirlPage(best.source);
            if (pageData && pageData.content) {
              best.content = pageData.content;
              console.log(`[webSearch] scraped moegirl page (${pageData.content.length} chars) for "${best.title}"`);
            }
          } catch (err) {
            console.warn(`[webSearch] infobox scrape failed: ${err.message}`);
          }
        }
        moe.length = 0; moe.push(best);
      } else {
        console.log(`[webSearch] no results matched context "${context}", keeping all`);
      }
    }
    allResults.push(...moe);
  } catch (err) {
    console.warn('[webSearch] Moegirl failed:', err.message);
  }

  // 2. 萌娘百科无结果时降级到 Bing
  if (allResults.length === 0) {
    console.log('[webSearch] Moegirl returned no results, falling back to Bing');
    try {
      const bing = await searchBing(`${searchName} ${context}`);
      allResults.push(...bing);
    } catch (err) {
      console.warn('[webSearch] Bing failed:', err.message);
    }
  }

  if (allResults.length === 0) return '';

  return allResults
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.content}\n来源: ${r.source}`)
    .join('\n\n');
}

/**
 * 萌娘百科搜索（ACG 角色专业 wiki，MediaWiki API，大陆可直连）
 *
 * 使用 opensearch 接口搜索 → prop=extracts 获取摘要
 */
async function searchMoegirl(query) {
  const BASE = 'https://mzh.moegirl.org.cn/api.php';

  // Step 1: opensearch 搜索（返回标题 + URL）
  const searchUrl = `${BASE}?${new URLSearchParams({
    action: 'opensearch',
    search: query,
    format: 'json',
    limit: '5',
  })}`;

  let searchData;
  try {
    const res = await fetchWithTimeout(searchUrl, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    });
    searchData = await res.json();
  } catch (err) {
    console.warn('[webSearch] Moegirl opensearch failed:', err.message);
    return [];
  }

  // opensearch 返回: [query, [title1, title2, ...], [...], [url1, url2, ...]]
  const titles = Array.isArray(searchData?.[1]) ? searchData[1] : [];
  const urls = Array.isArray(searchData?.[3]) ? searchData[3] : [];
  if (titles.length === 0) return [];

  // Step 2: 获取前 3 条摘要
  const extracts = [];
  for (let i = 0; i < Math.min(titles.length, 3); i++) {
    const title = titles[i];
    const pageUrl = urls[i] || '';
    try {
      const extractUrl = `${BASE}?${new URLSearchParams({
        action: 'query',
        prop: 'extracts',
        exintro: '1',
        explaintext: '1',
        titles: title,
        format: 'json',
        origin: '*',
      })}`;

      const extractRes = await fetchWithTimeout(extractUrl, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      }).then(r => r.json());

      const pageData = Object.values(extractRes.query?.pages || {})[0];
      if (pageData?.extract && pageData.extract.trim().length > 10) {
        extracts.push({
          title: pageData.title,
          content: pageData.extract.slice(0, 2500),
          source: pageUrl || `萌娘百科·${pageData.title}`,
        });
      }
    } catch {
      // 单条失败不影响其他
    }
  }

  return extracts;
}

/**
 * Bing 搜索结果抓取（免注册、免 API Key，大陆可直连）
 * 搜到萌娘百科链接时，跟踪进去抓「基本资料」栏的结构化字段
 */
async function searchBing(query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query + ' 萌娘百科')}&setlang=zh-hans`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BING_TIMEOUT);

  let html;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      signal: controller.signal,
    });
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const results = [];

  // 先检查是否有萌娘百科结果，有则深度抓取
  const moegirlMatch = /<a[^>]*href="(https?:\/\/[a-z]*\.?moegirl\.org\.cn\/[^"]*?)"/i.exec(html);
  if (moegirlMatch) {
    const moegirlUrl = moegirlMatch[1].replace(/&amp;/g, '&');
    console.log(`[webSearch] Found moegirl link: ${moegirlUrl}`);
    try {
      const moegirlData = await scrapeMoegirlPage(moegirlUrl);
      if (moegirlData) results.push(moegirlData);
    } catch (err) {
      console.warn('[webSearch] Moegirl scrape failed:', err.message);
    }
  }

  // 再取普通 Bing 结果（补充非萌娘来源）
  const BLOCK_RE = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
  let blockMatch;

  while ((blockMatch = BLOCK_RE.exec(html)) !== null) {
    const block = blockMatch[1];
    const titleMatch = /<h2[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    const urlMatch = /<a[^>]*href="(https?:\/\/[^"]+)"/i.exec(block);
    const snippetMatch = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);

    if (titleMatch) {
      const title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
      const snippet = snippetMatch
        ? snippetMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
        : '';
      const sourceUrl = urlMatch ? urlMatch[1].replace(/&amp;/g, '&') : '';

      // 跳过萌娘百科结果（已深度抓取，不重复）
      if (sourceUrl.includes('moegirl.org.cn')) continue;

      if (title && (snippet || sourceUrl)) {
        results.push({
          title,
          content: snippet || title,
          source: sourceUrl || 'Bing',
        });
      }
    }

    if (results.length >= 5) break;
  }

  return results;
}

/**
 * 调用 Python 爬虫服务获取萌娘百科页面内容
 */
async function scrapeMoegirlPage(pageUrl) {
  console.log(`[webSearch] scrapeMoegirlPage calling python: ${pageUrl}`);
  try {
    const res = await fetch(`http://localhost:8765/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: pageUrl }),
    });
    if (!res.ok) {
      console.warn(`[webSearch] python scrape returned ${res.status}`);
      return null;
    }
    const data = await res.json();
    console.log(`[webSearch] python scrape done: ${data.content.length} chars`);
    return data;
  } catch (err) {
    console.warn(`[webSearch] python scrape call failed: ${err.message}`);
    return null;
  }
}
