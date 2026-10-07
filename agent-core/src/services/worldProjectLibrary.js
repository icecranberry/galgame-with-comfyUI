// 世界观独立项目库（World Project Library）—— **引擎与具体世界观之间的边界**。
//
// ── 为什么要这个东西（2026-10-07 用户裁定）────────────────────
// 事故经过：我把「幻造种不是每日仪式」写进了 `scheduleGenerator.js` 的公共提示词。
// 幻造种是**某一个世界观**的自造概念 —— 切到「武装JK世界」后，那段规则在讲一个不存在的东西。
//
// 全量审计（`0-投递箱/2026-10-07_引擎世界观实例化污染审计/`）发现同类问题 244 处，根因是：
//   · 引擎写完提示词后**没有地方安放"这个世界的专属知识"**，只能顺手写进引擎；
//   · 同一个知识点被抄成多份（世界观有词表、地图有地点、引擎又各抄一份），副本一脱钩就静默失效。
//
// 本模块给出安放之处：**每个世界观一个独立项目库**，引擎只**读取**，不内置。
//
// ── 目录形态 ──────────────────────────────────────────────
//   data/world-projects/<slug>/
//     project.json   ← 结构化槽位（见下）；引擎唯一读取入口
//     world.md       ← 世界观正文（原 world_settings.content 的镜像，便于手工编辑/版本控制）
//     assets/        ← 该世界观专属素材（预留）
//
// ── 三条不可回退的约定 ────────────────────────────────────
// ① **项目库缺失 ≠ 报错**：存量世界观还没有项目库，此时所有槽位回落**中性默认值**，
//    行为必须与"没有这套机制"逐字节一致（默认不改行为）。
// ② **不用 slug 做身份**：身份是 `world_settings.id`（DB 主键）。
//    slug 只做目录名，改名时目录跟着改，引用不受影响。
//    若用 slug 当身份，用户改一次名就会把关联全部打断。
// ③ **读不到就回落、读坏了要留痕**：project.json 解析失败要 warn 并回落默认，
//    不能把整个世界观弄成不可用（世界观是应用可用性的前提，不是可选项）。

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_ROOT = path.resolve(__dirname, '../../data');
/**
 * 世界观项目库根目录。
 * ⚠ `DATA_ROOT` 是**写死**的（跟着源码走），所以测试要隔离项目库时必须靠这个环境变量：
 *   `LINSHE_WORLD_PROJECTS_DIR=<临时目录>` —— 不设时行为与从前逐字节一致。
 */
export const WORLD_PROJECTS_DIR = process.env.LINSHE_WORLD_PROJECTS_DIR
  ? path.resolve(process.env.LINSHE_WORLD_PROJECTS_DIR)
  : path.join(DATA_ROOT, 'world-projects');

/** 项目库结构版本：将来加槽位时用它做迁移判据 */
export const PROJECT_SCHEMA_VERSION = 1;

/**
 * 项目库的**全部可填槽位**（引擎只会读这些）。
 *
 * ★ 每加一个槽位，都必须在 `neutralProject()` 里给出对应的中性默认值 ——
 *   否则存量世界观（没有项目库）就会拿到 undefined，行为出现分叉。
 */
export const PROJECT_SLOTS = {
  /** 声明的"氛围/例句节"标题（供注入前裁剪）。**空数组 = 不裁剪任何内容。** */
  ambienceSections: [],
  /** 该世界的语汇取材维度（供论坛网名等生成器取词）。空 = 用引擎内置通用池。 */
  lexicons: [],
  /** 用词口径提示（如身体部位的称呼）。空 = 不注入。 */
  vocabHints: [],
  /**
   * 该世界里**容易变成口头禅的道具/货币/地标名**（供台账的"八股检测"计数）。
   * 空 = 只用引擎的通用词表。
   * ★ 2026-10-07 从 `scheduleLedger.js` 的 `CLICHE_PROPS` 分出来 ——
   *   那张表里混着通用词（心愿/餐盘/酒杯，任何世界观都适用）与专有词（愿宝/黄金马桶）。
   *   通用词留引擎，专有词归这里。
   */
  clicheProps: [],
  /**
   * 通勤网种子（**数据，不是规则**）。
   * 结构：`{ lines: [{ id, name, segments: [[from, to, mode, km, minutes, note], ...] }] }`
   * 空 = 不种子（用户在地图页自己连）。
   * ★ 2026-10-07 从 `db/index.js` 的 `migrateWorldMapTransit()` 搬来 ——
   *   那段代码里硬编码了某世界观的全部站名，属"数据跑进引擎"。
   */
  transitSeed: null,
  /**
   * 派系与组织（**数据，不是规则**）。
   * 结构：`[{ slug, name, type, parent, summary, description, color, icon, sort_order,
   *          members: [{ character, role, rank }], relations: [{ to, relation, strength }] }]`
   * 空 = 该世界没有登记派系。
   * ★ 2026-10-07：派系是**世界观实例专属**（二相乐园的派系 ≠ 武装JK世界的派系），
   *   按红线 12 引擎不得内置 → 归这里；运行时真源在 DB（`factions` 三表），
   *   本槽位是**镜像/可迁移载体**（每次写操作后由 `factionService` 回写，与 `world.md` 同口径）。
   */
  factions: [],
  /** 自由备注（给人看的，引擎不读） */
  notes: '',
};

/** 中性项目 —— 项目库不存在/损坏时的回落值。**必须保持"零影响"**。 */
export function neutralProject() {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    slug: '',
    exists: false,
    ambienceSections: [],
    lexicons: [],
    vocabHints: [],
    clicheProps: [],
    transitSeed: null,
    factions: [],
    notes: '',
    mapIds: [],
  };
}

/**
 * 由名称生成目录名。
 *
 * ⚠ 中文名不能直接当目录名（跨平台、Git 显示都不友好），所以：
 *   · 含 ASCII 字母数字 → 取其 slug 形式；
 *   · 纯中文 → 用 `wp-<名称 sha1 前 10 位>`，稳定且与内容绑定；
 *   · 始终追加短哈希后缀，保证"同名不同 id"不撞车。
 */
export function slugForWorld(name, id) {
  const base = String(name || '').trim();
  const ascii = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const h = crypto.createHash('sha1').update(`${id}:${base}`).digest('hex').slice(0, 8);
  return ascii ? `${ascii}-${h}` : `wp-${h}`;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 某个世界观的项目库目录（**不保证存在**） */
export function projectDirFor(slug) {
  if (!slug) return '';
  return path.join(WORLD_PROJECTS_DIR, slug);
}

/**
 * 读取项目库。
 *
 * ⚠ 失败语义（与红线 0 同源）：
 *   · **不存在** → 返回中性项目（`exists:false`），**完全静默**（存量常态，不是异常）；
 *   · **存在但解析失败** → 返回中性项目并 **warn 留痕**（这是异常，不能装看不见）。
 * @param {string} slug
 * @param {{logger?: Pick<Console,'warn'|'error'>}} [opts]
 */
export function readProject(slug, opts = {}) {
  const log = opts.logger || console;
  if (!slug) return neutralProject();
  const file = path.join(projectDirFor(slug), 'project.json');
  if (!fs.existsSync(file)) return neutralProject();
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      ...neutralProject(),
      ...raw,
      // 数组槽位必须归一为数组：手工编辑时写成字符串/对象都不该让下游炸
      ambienceSections: Array.isArray(raw.ambienceSections) ? raw.ambienceSections.map(String) : [],
      lexicons: Array.isArray(raw.lexicons) ? raw.lexicons : [],
      vocabHints: Array.isArray(raw.vocabHints) ? raw.vocabHints.map(String) : [],
      clicheProps: Array.isArray(raw.clicheProps) ? raw.clicheProps.map(String) : [],
      factions: Array.isArray(raw.factions) ? raw.factions : [],
      mapIds: Array.isArray(raw.mapIds) ? raw.mapIds.map(Number).filter(Number.isFinite) : [],
      exists: true,
    };
  } catch (err) {
    log.warn(`[worldProject] ${slug}/project.json 解析失败，回落中性默认值: ${err.message}`);
    return neutralProject();
  }
}

/** 写入项目库（幂等覆盖；自动建目录） */
export function writeProject(slug, project) {
  const dir = ensureDir(projectDirFor(slug));
  const payload = { schemaVersion: PROJECT_SCHEMA_VERSION, slug, ...project };
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

/** 世界观正文镜像（便于手工编辑 / 版本控制；DB 仍是运行时真源） */
export function writeWorldDoc(slug, name, content) {
  const dir = ensureDir(projectDirFor(slug));
  const body = `# ${name}\n\n<!-- 本文件是世界观正文的镜像，供人工编辑与版本控制。\n     运行时真源仍是数据库 world_settings.content；改这里不会自动回写数据库。 -->\n\n${content || ''}\n`;
  fs.writeFileSync(path.join(dir, 'world.md'), body, 'utf8');
}

/** 新建项目库骨架（世界观创建时调用）。已存在则只补缺失文件，不覆盖用户改动。 */
export function scaffoldProject({ name, id, content = '', ambienceSections = [], lexicons = [] }) {
  const slug = slugForWorld(name, id);
  const dir = ensureDir(projectDirFor(slug));

  const jsonPath = path.join(dir, 'project.json');
  if (!fs.existsSync(jsonPath)) {
    writeProject(slug, { ...neutralProject(), slug, exists: true, ambienceSections, lexicons, notes: `#${id} ${name}` });
  }
  const docPath = path.join(dir, 'world.md');
  if (!fs.existsSync(docPath)) writeWorldDoc(slug, name, content);
  ensureDir(path.join(dir, 'assets'));

  return { slug, dir };
}

/**
 * 从世界观正文里**猜测**可用的槽位默认值 —— 只为"新建时给个好起点"，不是判据。
 *
 * ⚠ 明确边界：这是**启发式**，猜错不影响正确性（用户可在 project.json 里改）。
 *   引擎**不得**依赖这里的猜测结果做逻辑分支。
 *
 * ★★ 2026-10-07 实测教训：**只猜"内容 100% 是例句"的标题，宁少勿多**。
 *   第一次把「日常规则」当氛围节 → 它**混着生图硬约束**（「整根画进画面」「不裁出画面」
 *   「……不画进去」），整段裁掉会**丢掉约束**。
 *   第二次想把「社会基调」也收进来 → 它同样**混着事实**（「愿宝是数字虚拟货币」这类陈述）。
 *   结论：**只有「人们的行为」是纯例句节**（通篇"这里的人平时怎么做"），故只猜它一个。
 *
 *   其余候选（「日常规则」「社会基调」……）**交给人在 project.json 里自行裁定** ——
 *   是不是氛围节，只有作者知道；引擎猜错的代价是静默丢内容，比多留一段更糟。
 */
export function guessSlotsFromContent(content) {
  const text = String(content || '');
  const ambienceSections = [];
  /** 唯一被猜的标题：通篇是"这里的人平时怎么做"的例句，不含规则/事实/画面指令 */
  const PURE_AMBIENCE_TITLES = ['人们的行为'];
  for (const line of text.split('\n')) {
    const m = line.match(/^#{1,6}\s*(.+?)\s*$/);
    if (!m) continue;
    const t = m[1].trim();
    if (PURE_AMBIENCE_TITLES.includes(t) && !ambienceSections.includes(t)) ambienceSections.push(t);
  }
  return { ambienceSections };
}

/** 列出全部项目库（供诊断/前端展示） */
export function listProjects() {
  if (!fs.existsSync(WORLD_PROJECTS_DIR)) return [];
  return fs.readdirSync(WORLD_PROJECTS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({ slug: e.name, ...readProject(e.name) }))
    .sort((a, b) => (a.slug < b.slug ? -1 : 1));
}