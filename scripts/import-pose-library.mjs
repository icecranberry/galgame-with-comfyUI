/**
 * import-pose-library.mjs — 把外部姿势图库整理成「姿势目录 + 生图参数」资源
 *
 * ## 为什么要有它
 *
 * 姿势参考图库（如 aiyaoooo14/ai-pose-gallery-SKILL）给的是「体系 / 分类 / 姿势名称 / 角度」
 * 这四个中文字段和图片路径。它擅长让人**看图**，但直接拿去驱动生图还差一步：
 * 姿势名称是中文短语，模型真正需要的是可拼进提示词的英文标签、负向词、以及「这一格定格在哪一瞬」。
 *
 * 这个脚本做两件事：
 *   1. **整理**：把同一姿势的多个角度（正面 / 俯视 / 仰视 / 侧面 / 斜侧）归成一条，产出干净的目录。
 *   2. **补全**（可选）：调用任意 OpenAI 兼容接口，为每条姿势补出 core / male / female /
 *      negative / frozen / prompt 六项生图参数。
 *
 * 第一步只用 Node.js 内置模块；第二步需要你自己配一个 LLM 端点，不配也能跑（见 --no-llm）。
 *
 * ## 用法
 *
 *   # 只整理目录，不调模型（零依赖、秒出结果）
 *   node scripts/import-pose-library.mjs --no-llm
 *
 *   # 只处理两个分类，先试 10 条看质量
 *   node scripts/import-pose-library.mjs --categories 站姿,坐姿 --limit 10
 *
 *   # 全量补全，断了接着跑
 *   node scripts/import-pose-library.mjs --resume
 *
 *   # 从本地文件读，而不是从 GitHub 拉
 *   node scripts/import-pose-library.mjs ./data/pose-zh.json
 *
 * ## 产物
 *
 *   agent-core/resources/pose-library.json
 *
 * 结构：{ version, source, generatedAt, systems, categories, entries[] }
 * 每条 entry：{ id, system, category, name, angles, images, params? }
 *
 * ## 边界
 *
 * · 不下载图片、不复制图片文件，只记录图库里的相对路径。
 * · 不修改原始数据；归组与补全都只发生在内存和产物里。
 * · LLM 输出不合法会重试，仍不合法则该条只保留目录信息、不带 params，脚本继续跑。
 * · 补全结果按「体系|姿势编号」记断点，--resume 跳过已完成项。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/** 默认数据源：中文版姿势库的结构化数据（每张图一条记录） */
const DEFAULT_SOURCE = 'https://api.github.com/repos/aiyaoooo14/ai-pose-gallery-SKILL/contents/data/pose-zh.json';

/** 产出位置 */
const OUT = path.join(root, 'agent-core', 'resources', 'pose-library.json');

/** 断点与原始数据缓存，放系统临时目录，不污染工作树 */
const CACHE_DIR = path.join(root, '.pai', 'temp');
const RAW_CACHE = path.join(CACHE_DIR, 'pose-library-raw.json');
const DONE_CACHE = path.join(CACHE_DIR, 'pose-library-done.json');

const SYSTEM_PROMPT = `你是生图姿势参数的整理员。用户给出一个姿势的分类与名称，你要输出这个姿势的生图参数。

严格按以下 JSON 输出（不要解释、不要代码块）：
{
  "core": ["3~6 个英文标签，描述这个姿势的核心动作与姿态"],
  "male": ["0~4 个英文标签，描述另一方参与方式（单人姿势给空数组）"],
  "female": ["2~5 个英文标签，描述主体姿态与暴露部位"],
  "negative": ["3~5 个该姿势最容易画崩的负向标签，如 extra limbs / fused fingers / wrong anatomy"],
  "frozen": "一句中文（30~50 字），讲清这一格画面定格在哪一瞬、身体如何接触",
  "prompt": "一段英文提示词模板（60~120 词），按 this action > body state > clothing > framing > environment > lighting 的顺序写，用 [a / b] 表示可随机替换的变体"
}

硬要求：
- 英文标签全部小写、逗号分隔的单条标签，不要整句
- 标签必须是画图模型认识的常见词
- 不要写年龄、校服、水印、字幕相关词
- prompt 里不要出现中文`;

// ── 参数解析 ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { source: '', categories: null, limit: 0, resume: false, noLlm: false, out: OUT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-llm') args.noLlm = true;
    else if (a === '--resume') args.resume = true;
    else if (a === '--categories') args.categories = (argv[++i] || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
    else if (a === '--limit') args.limit = Number(argv[++i]) || 0;
    else if (a === '--out') args.out = path.resolve(argv[++i]);
    else if (a === '--base-url') process.env.POSE_LLM_URL = argv[++i];
    else if (a === '--model') process.env.POSE_LLM_MODEL = argv[++i];
    else if (a === '--api-key') process.env.POSE_LLM_KEY = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else if (!a.startsWith('-')) args.source = a;
  }
  return args;
}

function printHelp() {
  console.log(`用法：node scripts/import-pose-library.mjs [数据源] [选项]

数据源：本地 pose-zh.json 路径；省略则从默认 GitHub 地址拉取

选项：
  --no-llm              只整理目录，不调用模型补全参数
  --categories a,b      只处理指定分类（默认全部）
  --limit N             最多处理 N 条（试跑用）
  --resume              跳过已补全的条目，接着跑
  --out <路径>          产出位置，默认 agent-core/resources/pose-library.json
  --base-url <url>      OpenAI 兼容接口，默认读 POSE_LLM_URL
  --model <name>        模型名，默认读 POSE_LLM_MODEL
  --api-key <key>       API Key，默认读 POSE_LLM_KEY / LLM_API_KEY
  --help                显示本说明`);
}

// ── 数据读取 ────────────────────────────────────────────────────────────────

async function loadRaw(source, { useCache = true } = {}) {
  if (useCache && fs.existsSync(RAW_CACHE)) {
    console.log(`用本地缓存：${path.relative(root, RAW_CACHE)}`);
    return JSON.parse(fs.readFileSync(RAW_CACHE, 'utf8'));
  }
  let rows;
  if (source) {
    console.log(`读取本地文件：${source}`);
    rows = JSON.parse(fs.readFileSync(path.resolve(source), 'utf8'));
  } else {
    console.log(`从网络拉取：${DEFAULT_SOURCE}`);
    const res = await fetch(DEFAULT_SOURCE, { headers: { 'User-Agent': 'pose-library-importer' } });
    if (!res.ok) throw new Error(`拉取失败 HTTP ${res.status}`);
    const body = await res.json();
    // GitHub contents 接口返回 base64；直接指向 raw 地址时则是纯 JSON
    rows = body.content
      ? JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'))
      : body;
  }
  if (!Array.isArray(rows)) throw new Error('数据源不是数组：期望每张图一条记录');
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(RAW_CACHE, JSON.stringify(rows), 'utf8');
  return rows;
}

/**
 * 把逐图记录归成逐姿势记录。
 * 同一「体系 + 姿势编号」的多个角度合为一条，angles 保留全部角度，images 记录各自路径。
 */
function groupByPose(rows, onlyCategories) {
  const poses = new Map();
  for (const row of rows) {
    const category = row['分类'] || '';
    if (onlyCategories && !onlyCategories.includes(category)) continue;
    const id = row['姿势编号'] || row['id'] || '';
    if (!id) continue;
    const system = row['体系'] || '';
    const key = `${system}|${id}`;
    const angle = row['角度'] || '';
    let entry = poses.get(key);
    if (!entry) {
      entry = { id, system, category, name: row['姿势名称'] || '', angles: [], images: {} };
      poses.set(key, entry);
    }
    if (angle && !entry.angles.includes(angle)) entry.angles.push(angle);
    if (angle && row['原图']) entry.images[angle] = { thumb: row['缩略图'] || '', full: row['原图'] };
  }
  return [...poses.values()];
}

// ── LLM 补全 ────────────────────────────────────────────────────────────────

function resolveLlmConfig() {
  const url = String(process.env.POSE_LLM_URL || '').trim();
  const model = String(process.env.POSE_LLM_MODEL || '').trim();
  const key = String(process.env.POSE_LLM_KEY || process.env.LLM_API_KEY || '').trim();
  return { url, model, key };
}

function parseJsonReply(text) {
  const clean = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const tryParse = s => { try { return JSON.parse(s); } catch { return null; } };
  const direct = tryParse(clean);
  if (direct) return direct;
  const braced = clean.match(/\{[\s\S]*\}/);
  return braced ? tryParse(braced[0]) : null;
}

function validateParams(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const arr = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : []);
  const out = {
    core: arr(obj.core),
    male: arr(obj.male),
    female: arr(obj.female),
    negative: arr(obj.negative),
    frozen: typeof obj.frozen === 'string' ? obj.frozen.trim() : '',
    prompt: typeof obj.prompt === 'string' ? obj.prompt.trim() : '',
  };
  // 核心标签与提示词都没有，就等于没补出来
  if (out.core.length === 0 || !out.prompt) return null;
  return out;
}

async function callLlm(cfg, userPrompt) {
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}),
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.6,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
  const body = await res.json();
  return body?.choices?.[0]?.message?.content ?? '';
}

// ── 落盘 ────────────────────────────────────────────────────────────────────

function writeOut(entries, source) {
  const categories = [...new Set(entries.map(e => e.category))].filter(Boolean);
  const systems = [...new Set(entries.map(e => e.system))].filter(Boolean);
  const catalog = {
    version: 1,
    source: source || 'aiyaoooo14/ai-pose-gallery-SKILL / data/pose-zh.json',
    generatedAt: new Date().toISOString().slice(0, 10),
    systems,
    categories: categories.map(c => ({ value: c, label: c, count: entries.filter(e => e.category === c).length })),
    entries,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  return catalog;
}

function loadDone(resume) {
  if (!resume || !fs.existsSync(DONE_CACHE)) return new Set();
  try { return new Set(JSON.parse(fs.readFileSync(DONE_CACHE, 'utf8'))); } catch { return new Set(); }
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

export async function importPoseLibrary(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) { printHelp(); return null; }

  const rows = await loadRaw(args.source);
  const poses = groupByPose(rows, args.categories);
  const scope = args.categories ? `分类 ${args.categories.join('/')}` : '全部分类';
  console.log(`整理完成：${scope} 共 ${poses.length} 条姿势（原始 ${rows.length} 张图）`);

  if (args.noLlm) {
    const catalog = writeOut(poses, args.source);
    console.log(`未补全参数（--no-llm）。已写出 ${catalog.entries.length} 条 → ${path.relative(root, OUT)}`);
    return catalog;
  }

  const cfg = resolveLlmConfig();
  if (!cfg.url || !cfg.model) {
    throw new Error('未配置 LLM 端点。要么设置 POSE_LLM_URL / POSE_LLM_MODEL（或用 --base-url / --model），要么加 --no-llm 只整理目录。');
  }

  const done = loadDone(args.resume);
  // --resume 时先读回已有产物里的 params，避免重跑时丢结果
  if (args.resume && fs.existsSync(OUT)) {
    try {
      const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
      const byKey = new Map((prev.entries || []).map(e => [`${e.system}|${e.id}`, e.params]));
      for (const pose of poses) {
        const p = byKey.get(`${pose.system}|${pose.id}`);
        if (p) pose.params = p;
      }
    } catch { /* 产物损坏就当没有 */ }
  }

  const todo = args.limit ? poses.slice(0, args.limit) : poses;
  let n = 0;
  let ok = 0;
  let failed = 0;
  for (const pose of todo) {
    n++;
    const key = `${pose.system}|${pose.id}`;
    if (pose.params || done.has(key)) {
      console.log(`  [${n}/${todo.length}] 跳过（已有）${pose.name}`);
      continue;
    }
    const userPrompt = `分类：${pose.category}\n姿势编号：${pose.id}\n姿势名称：${pose.name}\n\n请输出这个姿势的生图参数。`;
    let params = null;
    for (let attempt = 1; attempt <= 4 && !params; attempt++) {
      try {
        params = validateParams(parseJsonReply(await callLlm(cfg, userPrompt)));
        if (!params) console.log(`  [${n}/${todo.length}] ${pose.name} 输出不合法，重试 ${attempt}/4`);
      } catch (err) {
        console.log(`  [${n}/${todo.length}] ${pose.name} 调用失败（${String(err.message).slice(0, 60)}），重试 ${attempt}/4`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    if (!params) {
      failed++;
      console.log(`  [${n}/${todo.length}] ✗ 放弃：${pose.name}（保留目录信息，不带 params）`);
      continue;
    }
    pose.params = params;
    ok++;
    done.add(key);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(DONE_CACHE, JSON.stringify([...done]), 'utf8');
    // 每 5 条落一次盘，中断不白跑
    if (ok % 5 === 0) writeOut(todo, args.source);
    console.log(`  [${n}/${todo.length}] ✓ ${pose.name} → ${params.core.slice(0, 3).join(', ')}`);
  }

  const catalog = writeOut(todo, args.source);
  console.log(`\n完成：补全 ${ok} 条，失败 ${failed} 条，共 ${catalog.entries.length} 条 → ${path.relative(root, OUT)}`);
  return catalog;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await importPoseLibrary();
}
