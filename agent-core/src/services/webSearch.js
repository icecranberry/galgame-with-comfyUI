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

import { chatSync } from '../llm/llm-client.js';

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
    ], { temperature: 0, max_tokens: 60, label: '网络搜索' });
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
    const moe = await searchMoegirl(searchName, context);
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
        // 深度抓取萌娘百科页面（Python 服务提取 infobox + 正文）
        // 向前兼容：source 可能是完整 URL，也可能是"萌娘百科·Title"格式
        const scrapeUrl = best.source && best.source.includes('moegirl.org.cn')
          ? best.source
          : `https://zh.moegirl.org.cn/${encodeURIComponent(best.title)}`;
        try {
          const pageData = await scrapeMoegirlPage(scrapeUrl);
          if (pageData && pageData.content) {
            const infoboxLen = pageData.infobox?.length || 0;
            const contentLen = pageData.content?.length || 0;
            // 质量检查：infobox 为空且正文很短 → 可能是消歧义页或无效页，丢弃不用
            if (infoboxLen === 0 && contentLen < 600) {
              console.log(`[webSearch] low quality scrape (infobox=0, body=${contentLen} chars), discarding`);
            } else {
              best.content = pageData.content;
              console.log(`[webSearch] scraped moegirl page (${pageData.content.length} chars) for "${best.title}"`);
            }
          }
        } catch (err) {
          console.warn(`[webSearch] infobox scrape failed: ${err.message}`);
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
 * 尝试将查询词作为页面标题直接解析（跟随 Wiki 重定向）
 *
 * 萌娘百科有很多角色简称/别名的重定向页，如"丽娜"→"亚历山德丽娜·莎芭丝缇安"。
 * opensearch 不会跟随重定向，需要先用 action=query&redirects=1 尝试直接解析。
 *
 * @param {string} baseUrl - MediaWiki API 基地址
 * @param {string} query - 页面标题（角色名）
 * @returns {Promise<object|null>} 解析成功返回 { title, content, source }，失败返回 null
 */
async function tryDirectPageResolve(baseUrl, query) {
  try {
    const url = `${baseUrl}?${new URLSearchParams({
      action: 'query',
      titles: query,
      redirects: '1',       // 跟随重定向页面
      prop: 'extracts',
      exintro: '1',
      explaintext: '1',
      format: 'json',
      origin: '*',
    })}`;

    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    });
    const data = await res.json();

    // 记录重定向信息
    if (data.query?.redirects?.length > 0) {
      const r = data.query.redirects[0];
      console.log(`[webSearch] page redirect resolved: "${r.from}" → "${r.to}"`);
    }

    const pages = data.query?.pages || {};
    const pageData = Object.values(pages)[0];

    // 页面不存在（missing）或无内容 → 返回 null，回退到搜索
    if (!pageData || pageData.missing || !pageData.extract || pageData.extract.trim().length < 10) {
      return null;
    }

    const canonicalTitle = pageData.title;
    const pageUrl = `https://zh.moegirl.org.cn/${encodeURIComponent(canonicalTitle)}`;

    console.log(`[webSearch] direct page resolve success: "${query}" → "${canonicalTitle}" (${pageData.extract.length} chars)`);

    return {
      title: canonicalTitle,
      content: pageData.extract.slice(0, 2500),
      source: pageUrl,
    };
  } catch (err) {
    console.warn(`[webSearch] direct page resolve failed for "${query}": ${err.message}`);
    return null;
  }
}

/**
 * 萌娘百科搜索（ACG 角色专业 wiki，MediaWiki API，大陆可直连）
 *
 * 1. 先尝试直接页面解析（跟随 wiki 重定向，如"丽娜"→完整页面）
 * 2. 回退到 opensearch 搜索 → prop=extracts 获取摘要
 *
 * @param {string} query - 角色名
 * @param {string} context - 作品上下文（可选，用于优化搜索关键词）
 */
async function searchMoegirl(query, context = '') {
  const BASE = 'https://mzh.moegirl.org.cn/api.php';

  // Step 0: 先尝试将查询词作为页面标题直接解析（跟随 redirects）
  // 处理萌娘百科的角色简称/别名重定向（如"丽娜"→"亚历山德丽娜·莎芭丝缇安"）
  if (query.length >= 2) {
    const directResult = await tryDirectPageResolve(BASE, query);
    if (directResult) {
      const isDisambig = /消歧义页|可以指|下列[^。]*条目|列出[^。]*同名/.test(directResult.content);

      if (isDisambig) {
        console.log(`[webSearch] direct page "${directResult.title}" is a disambiguation page`);
        // 尝试构造具体页面：重定向标题 + 上下文 → "琪亚娜·卡斯兰娜(崩坏3)"
        // 萌娘百科同一角色跨作品的页面命名规则为 角色名(作品名)
        if (context) {
          const specificTitle = `${directResult.title}(${context})`;
          console.log(`[webSearch] trying specific page: "${specificTitle}"`);
          const specificResult = await tryDirectPageResolve(BASE, specificTitle);
          if (specificResult) {
            return [specificResult];
          }
          console.log(`[webSearch] specific page not found, falling back to opensearch`);
        }
        // 构造失败，继续走 opensearch
      } else if (context) {
        const ctx = context.toLowerCase();
        const text = `${directResult.title} ${directResult.content}`.toLowerCase();
        if (!text.includes(ctx)) {
          console.log(`[webSearch] direct page "${directResult.title}" doesn't match context "${context}", falling back to search`);
        } else {
          return [directResult];
        }
      } else {
        return [directResult];
      }
    }
  }

  // Step 1: 直接解析失败/消歧义页/context 不匹配 → opensearch 搜索
  // 最多两次尝试：先拼 context 搜（精确），无结果时去掉 context 重试（宽泛）
  const searchQueries = context
    ? [`${query} ${context}`, query]
    : [query];

  let titles = [];
  let urls = [];

  for (const q of searchQueries) {
    const searchUrl = `${BASE}?${new URLSearchParams({
      action: 'opensearch',
      search: q,
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
      console.warn(`[webSearch] Moegirl opensearch "${q}" failed: ${err.message}`);
      continue;
    }

    titles = Array.isArray(searchData?.[1]) ? searchData[1] : [];
    urls = Array.isArray(searchData?.[3]) ? searchData[3] : [];
    console.log(`[webSearch] opensearch "${q}" → ${titles.length} results`);
    if (titles.length > 0) break;
  }

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
      const extractText = pageData?.extract?.trim() || '';
      if (extractText.length > 10) {
        // 过滤消歧义页面：不把消歧义页当作角色详情返回
        if (/消歧义页|可以指|下列[^。]{0,20}(条目|角色|人物|用语|作品)/.test(extractText)) {
          console.log(`[webSearch] skipping disambiguation page: "${pageData.title}"`);
          continue;
        }
        extracts.push({
          title: pageData.title,
          content: extractText.slice(0, 2500),
          source: pageUrl || `${pageData.title}`,
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
 * 从纯文本中提取信息框字段（Node.js 侧安全网，Python 提取失败时兜底）
 * 正文格式：基本资料\n字段名\n值\n字段名\n值\n...简介\n正文
 */
function extractInfoboxFromText(bodyText) {
  const idx = bodyText.indexOf('基本资料');
  if (idx < 0) return { infobox: null, cleanBody: bodyText };

  const end = bodyText.indexOf('简介', idx + 4);
  const block = end >= 0 ? bodyText.slice(idx, end) : bodyText.slice(idx, idx + 3000);

  const FIELD_NAMES = new Set([
    '本名','外文名','别号','昵称','称号',
    '性别','发色','瞳色','身高','体重','三围',
    '生日','年龄','种族','血型','星座',
    '萌点','爱好','喜欢','讨厌',
    '出身地区','出身','活动范围','所属团体','所属组织','组合',
    '个人状态','状态','配音','声优',
    '武器','神之眼','神之心','命之座','始基力','特色料理','相关人士',
  ]);

  const lines = block.split('\n');
  const found = []; // [{ lineIndex, name }]
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (FIELD_NAMES.has(s)) {
      found.push({ idx: i, name: s });
    }
  }

  if (found.length === 0) return { infobox: null, cleanBody: bodyText };

  const infoboxLines = ['【萌娘百科 · 基本信息框】'];
  for (let j = 0; j < found.length; j++) {
    const { idx: li, name } = found[j];
    const endLi = j + 1 < found.length ? found[j + 1].idx : lines.length;
    const valLines = lines.slice(li + 1, endLi).filter(l => l.trim());
    const val = valLines.join('\n').trim();
    if (val) {
      infoboxLines.push(`${name}: ${val}`);
    }
  }

  // 从正文中移除已提取的信息框区域
  let cleanBody = bodyText;
  if (end >= 0) {
    cleanBody = bodyText.slice(0, idx).trim() + '\n\n' + bodyText.slice(end).trim();
  }

  return { infobox: infoboxLines.join('\n'), cleanBody };
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
    const pyInfoboxLen = data.infobox?.length || 0;
    const bodyLen = data.content?.length || 0;
    console.log(`[webSearch] python scrape done: infobox=${pyInfoboxLen} chars, body=${bodyLen} chars`);

    let infoboxText = data.infobox || '';
    let bodyText = data.content || '';

    // Python 未提取到信息框 → Node.js 侧从正文文本中解析（安全网）
    if (!infoboxText && bodyText.includes('基本资料')) {
      console.log('[webSearch] Python infobox empty, falling back to Node.js text parsing');
      const parsed = extractInfoboxFromText(bodyText);
      if (parsed.infobox) {
        infoboxText = parsed.infobox;
        bodyText = parsed.cleanBody;
        console.log(`[webSearch] Node.js infobox extracted: ${infoboxText.length} chars`);
      }
    }

    // 组装内容：信息框前置，正文置后
    if (infoboxText) {
      data.content = infoboxText + '\n\n【正文描述】\n' + bodyText;
      data.content = data.content.slice(0, 8000);
    }
    return data;
  } catch (err) {
    console.warn(`[webSearch] python scrape call failed: ${err.message}`);
    return null;
  }
}
