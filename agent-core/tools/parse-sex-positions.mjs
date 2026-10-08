/**
 * 解析《体位生图参考.md》→ 生成 `agent-core/src/data/sexPositions.js`
 *
 * 源文件在 NAS 只进不改库（`Z:\...\50-创意库\0-投递箱\邻舍 提示词\体位生图参考.md`），
 * 是可读的；**不能改**。所以这里只做「读 → 生成项目内数据模块」，源文件不动。
 * 源文件日后更新时重跑本脚本即可（幂等：每次都全量重写目标文件）。
 *
 * 用法：node tools/parse-sex-positions.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = 'Z:/docker/hermes/data/home/agent-foundry-vault/50-创意库/0-投递箱/邻舍 提示词/体位生图参考.md';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/data/sexPositions.js');

const raw = fs.readFileSync(SRC, 'utf8');

/** 取 `- **字段**：内容` 的字段值（同一小节内） */
function fieldOf(block, label) {
  const re = new RegExp(`-\\s*\\*\\*${label}\\*\\*\\s*：\\s*([\\s\\S]*?)(?=\\n-\\s*\\*\\*|\\n##\\s|$)`);
  const m = block.match(re);
  return m ? m[1].trim() : '';
}

/** 把 `| 男 `x`｜女 `y`` 里的反引号内容拆开 */
function stripTicks(s) {
  return String(s || '').replace(/`/g, '').trim();
}

const sections = raw.split(/\n(?=##\s)/).filter(s => /^##\s/.test(s));
const poses = [];

for (const sec of sections) {
  const head = sec.match(/^##\s*(\d{3})\s+(.+)$/m);
  if (!head) continue;
  const no = head[1];

  /*
   * ★ 前置的「（小马限定）」「（小车限定）」是**出镜条件**（被抱起/被驮的那一方必须明显娇小），
   *   不是体位名的一部分。直接留在 name 里会有两个坏处：
   *     ① 它会被当成 tags[0] 写进标签 → 与「标签重点在 NSFW」的要求打架；
   *     ② 前端贴纸/检索词会出现「（小车限定）站立怀抱式」这种半截话。
   *   所以：**剥到 `limit` 字段**，再从源文件的**负向标签**推导到底是谁娇小（`limitOn`）：
   *     `muscular male`   → 男方娇小（女方抱/驮男方）
   *     `muscular female` → 女方娇小（男方抱起/倒提女方）
   *   ⚠ 不能按「小马 ⇒ 男、小车 ⇒ 女」硬映射：那是巧合，不是可复用的规则。
   *     负向没给信号时（080）才退回词面猜测，并计入 `limitUnresolved` 统计以便日后发现漏网。
   *   后置括号（如「前后夹击（男方本番）」）是**变体区分**，属于名字，保留不动。
   */
  const nameRaw = head[2].trim();
  let limit = '';
  let name = nameRaw;
  const lead = nameRaw.match(/^[（(]\s*([^）)]+?(?:限定|限))\s*[）)]\s*(.*)$/);
  if (lead) { limit = lead[1].trim(); name = lead[2].trim(); }

  const frozen = fieldOf(sec, '定格');
  const tagsRaw = fieldOf(sec, '标签');
  const frame = stripTicks(fieldOf(sec, '画幅'));
  const negative = stripTicks(fieldOf(sec, '负向'));
  const prompt = stripTicks(fieldOf(sec, '提示词'));
  const conflicts = fieldOf(sec, '不可组合');

  if (!prompt) continue;   // 没有提示词的条目不收（例如 001 缺失）

  // 标签块形如：核心 `xxx`｜男 `yyy`｜女 `zzz`
  const pick = (label) => {
    const m = tagsRaw.match(new RegExp(`${label}\\s*([^｜|]*)`));
    return stripTicks(m ? m[1] : '');
  };
  const core = pick('核心');
  const male = pick('男');
  const female = pick('女');

  // 英文 NSFW 检索标签：从核心标签里挑「有检索价值」的（去掉 1girl/1boy/2girls 这类已单列的）
  const coreTags = core.split(',').map(t => t.trim()).filter(Boolean);

  // ── 出镜条件的对象（谁必须娇小）──
  let limitOn = '';
  if (limit) {
    if (/muscular male/.test(negative)) limitOn = 'male';
    else if (/muscular female/.test(negative)) limitOn = 'female';
    else if (/小马/.test(limit)) limitOn = 'male';      // 兜底：负向未给信号
    else if (/小车/.test(limit)) limitOn = 'female';
  }
  const limitTags = limitOn === 'male'
    ? ['petite male', 'male clearly shorter than the girl', 'small male body frame']
    : limitOn === 'female'
      ? ['petite girl', 'girl clearly shorter than the man', 'small female body frame']
      : [];

  poses.push({
    no,
    name,
    limit,
    limitOn,
    limitTags,
    frozen,
    core: coreTags,
    male: male.split(',').map(t => t.trim()).filter(Boolean),
    female: female.split(',').map(t => t.trim()).filter(Boolean),
    frame,
    negative,
    prompt,
    conflicts: conflicts && conflicts !== '—' ? conflicts : '',
  });
}

// ── 人数推导 ──
// ★ 两个坑：
//   ① 不能只取第一个数字 —— `1boy, standing, holding up / 1boy, standing, penis` 是**两个人**；
//   ② 不能在 core+female 合并串里数 —— 两处都列举同一批人，会**重复计数**
//      （002 的 core 写 `2girls`、female 又写 `1girl / 1girl` → 合并后数出 3 人）。
//   所以：**只在「女方标签」里数女、只在「男方标签」里数男**，core 只作兜底。
for (const p of poses) {
  const femaleAll = p.female.join(', ');
  const maleAll = p.male.join(', ');
  const coreAll = p.core.join(', ');

  const countIn = (str, word) => {
    const hits = [...str.matchAll(new RegExp(`(\\d)${word}s?\\b`, 'g'))].map(m => Number(m[1]));
    if (!hits.length) return 0;
    // 同一字段内：取「出现次数」与「最大数量」的较大者
    return Math.max(hits.length, Math.max(...hits));
  };

  // 两个字段**取较大者**（不是相加）：004 的 core 写 `2girls` 而 female 只写 `1girl`，
  // 取大才对；相加会把人算多。
  p.girls = Math.max(countIn(femaleAll, 'girl'), countIn(coreAll, 'girl')) || 1;
  p.boys = Math.max(countIn(maleAll, 'boy'), countIn(coreAll, 'boy'));
  // 含 solo / 只有一只手（disembodied hand）的条目没有男性参与者
  p.solo = /(^|,\s*)solo(\s*,|$)/.test(femaleAll) || /\bdisembodied hand\b/.test(femaleAll);
  if (p.solo) p.boys = 0;

  // 画幅可能是「A 或 B」并列 —— 归一成候选数组，出图时随机取一个
  p.frames = String(p.frame || '')
    .replace(/（[^）]*）/g, '')
    .split(/或/)
    .map(s => s.trim())
    .filter(Boolean);
  if (!p.frames.length) p.frames = ['cowboy shot'];
}

const banner = `/**
 * 体位生图参考 —— 结构化数据（**自动生成，勿手改**）
 *
 * 来源：\`Z:/docker/.../50-创意库/0-投递箱/邻舍 提示词/体位生图参考.md\`（84 条体位的生图描写）。
 * 该文件在 NAS 只进不改库中，**只读**；需要更新时改源文件后重跑
 * \`node tools/parse-sex-positions.mjs\` 全量重生成本文件。
 *
 * 每条字段：
 *   no/name   编号与中文名（tags 里的中文检索词就用 name）
 *   limit     出镜条件（源文件标题里前置的「（小马限定）/（小车限定）」，已从 name 剥出；空串 = 无限制）
 *   limitOn   该条件落在谁身上：'male'（男方须娇小）/ 'female'（女方须娇小）/ ''（无）
 *   limitTags limitOn 对应的英文提示词标签（进 prompt 作正向约束；无限制时为 []）
 *   frozen    中文「定格」描述（讲清这一格画面定在哪一瞬）
 *   core      核心英文 NSFW 标签（检索用）
 *   male/female  男/女方的英文标签
 *   frame     画幅（原始文本，可能是「A 或 B」）
 *   frames    画幅候选数组（并列项已拆开，出图时随机取一个）
 *   negative  负向标签（该体位专属，用于压制常见畸形）
 *   prompt    英文提示词模板：\`[a / b / c]\` 是变体组，出图时**每组随机取一个**
 *   conflicts 中文「不可组合」说明（人工参考，不进提示词）
 *   girls/boys/solo  参与者数量（由标签推导，用于挑角色）
 *
 * 生成时间：${new Date().toISOString().slice(0, 10)}（共 ${poses.length} 条）
 */

export const SEX_POSITIONS = ${JSON.stringify(poses, null, 2)};

/** 单条文案：中文名 + 定格（给 LLM 写作品名时做参考） */
export function poseBrief(p) {
  return \`\${p.name}——\${p.frozen}\`;
}
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, banner, 'utf8');

// ── 校验 ──
const stat = {
  total: poses.length,
  withNegative: poses.filter(p => p.negative).length,
  withVariants: poses.filter(p => /\[[^\]]*\/[^\]]*\]/.test(p.prompt)).length,
  solo: poses.filter(p => p.solo).length,
  twoGirls: poses.filter(p => p.girls === 2).length,
  threePlus: poses.filter(p => p.girls >= 3).length,
  withLimit: poses.filter(p => p.limit).length,
  limitMale: poses.filter(p => p.limitOn === 'male').length,
  limitFemale: poses.filter(p => p.limitOn === 'female').length,
  limitUnresolved: poses.filter(p => p.limit && !p.limitOn).length,
  nameStillDirty: poses.filter(p => /[（(]/.test(p.name.split('（')[0])).length,
  byFrame: poses.reduce((m, p) => { const k = p.frame || '(空)'; m[k] = (m[k] || 0) + 1; return m }, {}),
};
console.log('已生成:', OUT, `(${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);
console.log(JSON.stringify(stat, null, 1));
console.log('\n抽样:');
for (const p of [poses[0], poses[Math.floor(poses.length / 2)], poses[poses.length - 1]]) {
  console.log(` ${p.no} ${p.name}${p.limit ? `（限制：${p.limit}）` : ''} | ${p.girls}女${p.boys}男${p.solo ? '(solo)' : ''} | ${p.frame} | 变体组 ${(p.prompt.match(/\[[^\]]*\/[^\]]*\]/g) || []).length}`);
}
