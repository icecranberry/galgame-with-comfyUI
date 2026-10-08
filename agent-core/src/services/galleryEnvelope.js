/**
 * galleryEnvelope.js —— 规则34「环境层」的**约束引擎**
 *
 * 数据在 `src/data/galleryEnvironment.js`（7 维标签池 + 耦合元数据），
 * 本文件只负责：**把 7 个维度按顺序各抽 1 项，且抽出来的组合不矛盾**。
 *
 * ══════════════════════════════════════════════════════════
 * 耦合设计（为什么不能纯随机）
 * ══════════════════════════════════════════════════════════
 *
 * 从 84 条体位的实测信号推出四层耦合，**全部是"排除矛盾"，不是"偏好美化"**：
 *
 * ── 第 1 层：体位 ↔ 维度（物理矛盾，硬排除）──
 *   · 体位数据**不区分裸体**（`nude/naked` 命中 0/84）→ 「衣物破损/半脱」若叠在
 *     本番体位上是自相矛盾。衣物类声明 `needs: ['clothed']`，而 `clothed` 由
 *     `isPenetration(pose)` 推出（非插入类才可能还穿着）。
 *   · 手被功能性占用（撑地/扶墙/握住/插入）→ 手铐、绳缚、分腿杆排除（`@HANDS_BUSY`）。
 *     ⚠ 这里**故意不用宽松的「出现手字就禁」**：84 条里 80 条 prompt 有手/臂，
 *     一刀切会让束缚类整类消失。只匹配"手确实被占用"的写法。
 *   · 口交类体位 → 口塞类排除（`@ORAL`）。嘴被塞住就没法口交。
 *   · 体位自带道具/泡沫/体液（040 `sex toys`、077 `soap`、075 `cum`）→ 排除同类道具，
 *     避免"已经拿着假阳具了又叠一个跳蛋"。
 *
 * ── 第 2 层：维度 ↔ 维度（场景自洽，硬排除）──
 *   · `reflection 镜中倒影` 需要场景有镜面 → `needs: ['mirror']`
 *   · `underwater lighting` 需要水 → `needs: ['water']`
 *   · `through door gap 门缝窥视` 需要门/缝 → `needs: ['doorway']`
 *   · `blindfold 眼罩` 与「看向观者 / 对视 / 垂眼 / 别开视线」互斥 → `notWith: [...]`
 *   · `looking at viewer` 与 `from behind 背面视角` 互斥 → `notWith: ['from behind']`
 *
 * ── 第 3 层：软偏好（合法但更好看，只调概率）──
 *   · `silhouette 剪影` 在逆光下才成立 → 逆光被选中时权重 ×5
 *   · `from above 俯视` 对躺/侧/趴/坐姿更自然 → 体位匹配时 ×4
 *   · `from behind 背面` 对后入/臀类体位更自然 → ×4
 *   用 `soft: [[维度键, 正则, 倍数]]` 声明；`'pose'` 是伪维度，指体位文本本身。
 *
 * ── 第 4 层：★ 兜底（项目红线）──
 *   **过滤后可能为空的分支，绝不静默返回空**。每一维按三级退化：
 *     ① 基础池 − 硬排除（block/needs/notWith/match）      ← 正常路径
 *     ② 基础池 − 仅 block（放宽 needs/notWith/match）     ← 约束过严时
 *     ③ 基础池                                            ← 最后兜底
 *   三级都空只可能是基础池本身为空（那是数据错误，会显式抛错而不是返回空）。
 *   用户看到的是"这一格图少了个标签"，**不是**"点了没反应"。
 */

import {
  ENV_DIMENSIONS, POSE_PATTERNS, POSE_SCENE_HINTS, FOCUS_RULES, DEFAULT_FOCUS,
} from '../data/galleryEnvironment.js';

/** 维度键 → 从 ctx 里取什么（'pose' 是伪维度，指体位文本） */
const SOFT_DIM_OF_POSE = 'pose';

/** 把 `'@NAME'` 解析成 `POSE_PATTERNS.NAME` 的正则源；普通字符串原样返回 */
function resolvePattern(src) {
  if (src instanceof RegExp) return src;
  return String(src ?? '').replace(/@([A-Z_]+)/g, (_, name) => {
    const found = POSE_PATTERNS[name];
    if (!found) throw new Error(`未知的体位命名模式：@${name}`);
    return `(?:${found})`;
  });
}

/** 编译一个可能带 `@NAME` 的模式（失败返回 null，调用方按"不约束"处理） */
function compile(src) {
  if (src == null || src === '') return null;
  try { return src instanceof RegExp ? src : new RegExp(resolvePattern(src), 'i'); }
  catch { return null; }
}

/**
 * 体位文本 blob —— 所有体位侧判据都打在这一份上。
 *
 * 为什么要把 name/frozen/core/female/male 全拼进来：单看 `prompt` 会漏
 * （如 084 的 `double anal` 只在 `core` 里）。
 */
export function poseBlob(pose) {
  if (!pose) return '';
  return [
    pose.name, pose.frozen, pose.prompt,
    ...(pose.core || []), ...(pose.female || []), ...(pose.male || []),
  ].filter(Boolean).join(' ');
}

/*
 * 编译一次、全局复用 —— 这些正则在**每张图**的每个维度上都要跑，
 * 放函数里每次 `new RegExp` 既慢又容易写出"调用两次结果不一致"的怪代码（初版就有过）。
 */
const RE = {
  penetration: compile('@PENETRATION'),
  oral: compile('@ORAL'),
  lying: compile('@LYING'),
  handsBusy: compile('@HANDS_BUSY'),
};
/*
 * ★★ `isPenetration` 必须按 **core 的 token 精确判**，不能在长文本上跑正则。
 *
 * 实测踩过的三个假阳性，全都来自"在长文本上匹配"：
 *   · 055 乳交：prompt 里有变体组 `[straddling him / kneeling between his legs / …]`
 *     —— 那是**未被选中的备选**，却让 `straddling` 命中了。
 *   · 040 双排并列式：core 是 `sex toys`，`\bsex\b` 命中了 "sex toys"。
 *   · 018 素股：core 是 `intercrural sex`，同样被 `\bsex\b` 命中（素股是腿交，非插入）。
 * 而 035 颜面骑乘的 core 有 `girl on top` —— 骑在脸上不是插入。
 *
 * 所以：把 core 的每个 token 清洗后**逐 token 比对**（末尾词命中即可，
 * 于是 `double penetration` / `double vaginal` 这类复合词也能覆盖）。
 */
/*
 * 尾词匹配**只放行真正的插入词**。
 * ⚠ 绝不能把 `sex` 放进尾词表：`intercrural sex`（素股=腿交，非插入）与
 *   `group sex`（群交，但 087/088 其实是"轮换舔吸"）都会被尾词 `sex` 误命中 —— 实测踩过。
 *   所以 `sex` 只做**整 token 精确匹配**。
 */
const PEN_TAIL_RE = /(?:^|\s)(vaginal|anal|penetration)$/;
const PEN_EXACT = new Set([
  'sex', 'mating press', 'spooning', 'prone bone', 'missionary', 'doggystyle',
  'reverse cowgirl', 'cowgirl position', 'lotus position', 'wheelbarrow',
  'amazon position', 'suspended congress', 'upright straddle', 'girl on lap',
]);

/**
 * 中文名 + 定格描述里的**明确插入信号**。
 *
 * 为什么需要：`core` 是英文标签，有些体位（002 叠罗汉后入、029 前后夹击（男方本番））
 * 的 core 里根本没有插入词，但**中文名与定格描述写得清清楚楚**（"交替插入两人"）。
 * 中文散文才是这份数据的权威描述，不采信它就会漏判。
 *
 * ⚠ 只用**无歧义**的词：不收录裸「交」（否则「双人乳交/足交/手交/指交」全中招）。
 */
const PEN_CN_RE = /(后入|插入|双插|三插|同穴|贯穿|打桩|骑乘位|正常位|传教士|本番|种付|侧入|背入|交合|性交|抽插|承欢|受插|悬空插)/;

/**
 * 中文名里的**明确非插入信号** —— 优先级高于英文提示词。
 *
 * 为什么必须要有否向判据：英文提示词里 `penetrat` 出现得很泛 ——
 * 「强制深喉」的原文会写 "penetrates her throat"，「前后夹击（男方口交）」的
 * 变体组里也有插入选项，于是三条口交类体位（025 骑乘乳交 / 030 前后夹击口交 /
 * 059 强制深喉）被误判成"本番"。中文名才是这份数据的权威描述。
 */
const NONPEN_CN_RE = /(口交|深喉|舔|舐|舌|手交|指交|足交|乳交|素股|六九|颜面骑乘|毒龙|侍奉|责弄|海绵|含棒|饮尿)/;

/** 英文提示词里的强信号（优先级最低，只在前两路都判不出来时用） */
const PEN_STRONG_BLOB_RE = /\bpenetrat/i;

const RE_PENIS = /penis|cock|fellatio|handjob|paizuri|glans|testicles/i;

/** 清洗 core token：去掉 `（原文）`、`(sumata:1.5)` 之类的注记与权重 */
function cleanCoreToken(raw) {
  return String(raw ?? '')
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[:：]\s*[\d.]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
/*
 * ★ `anal` 只能由**真正的肛门相关词**给出。
 *   初版写成 `/\banal\b|anilingus|\bass\b/i` → 「his hand on her ass」这种随处可见的描写
 *   就足以放行「肛珠」（实测 331 次误放行）。`ass` 单独出现不算肛交。
 */
const RE_ANAL = /\banal\b|anilingus|anal beads|double anal|ass ?up|anilingus/i;
const RE_STANDING = /standing|straddl|amazon/i;
const RE_SCENE_HINT = POSE_SCENE_HINTS.map(h => ({ re: compile(h.match), scenes: h.scenes }));
const RE_FOCUS = FOCUS_RULES.map(r => ({ re: compile(r.match), rule: r }));

/**
 * 由体位派生**焦点词**（D4b）—— 见 `galleryEnvironment.js` 里 `FOCUS_RULES` 的说明：
 * 焦点必须由体位决定，随机抽会与体位打架（给口交抽到 `ass focus` = 镜头移开嘴）。
 */
export function deriveFocus(pose) {
  // ★ 只在 core + name 上匹配（理由见 FOCUS_RULES 注释：长文本会让焦点词彻底失真）
  const subject = poseCoreBlob(pose);
  for (const { re, rule } of RE_FOCUS) {
    if (re && re.test(subject)) return { dim: 'focus', en: rule.en, cn: rule.cn, phrase: rule.phrase };
  }
  return { dim: 'focus', ...DEFAULT_FOCUS };
}

/** 体位的**精炼**文本（core + name）—— 焦点派生、道具冲突等"类别级"判据用它 */
export function poseCoreBlob(pose) {
  if (!pose) return '';
  return [pose.name, ...(pose.core || [])].filter(Boolean).join(' ');
}

/** 该体位的手是否被**功能性**占用（撑地/扶墙/握住/插入）—— 束缚类道具的排除依据 */
export function poseHandsBusy(pose) {
  return !!RE.handsBusy && RE.handsBusy.test(poseBlob(pose));
}

/**
 * 该体位是否属于「插入/本番」。
 *
 * ★ 这是"衣物状态类标签"的唯一开关：体位数据**不区分裸体与穿衣**（实测 0/84），
 *   只能由语义推断 —— 本番基本等于已脱，非本番（口交/手交/足交/乳交）才可能还穿着。
 */
export function isPenetration(pose) {
  // ① core 的 token 精确判（`double penetration` / `double vaginal` 由尾词覆盖）。
  //    这是**标签级**证据，最硬，优先采信。
  for (const c of (pose?.core || []).map(cleanCoreToken)) {
    if (!c) continue;
    if (PEN_EXACT.has(c)) return true;
    if (PEN_TAIL_RE.test(c)) return true;
  }
  /*
   * ②③ 名字与定格描述**分层判定，且否向优先**。
   *
   * 为什么否向要放在正向前面、且分字段：
   *   实测踩过 —— `025 骑乘乳交` / `030 前后夹击（男方口交）` / `059 强制深喉`
   *   三条口交类体位的**定格描述**里都写了「插入」（"插入喉部""插入口中"），
   *   若把 name+frozen 拼成一段一起判，正向的「插入」会先命中，三条全被误判成"本番"。
   *   而它们的**名字**已经明确写了 乳交 / 口交 / 深喉 —— 名字是最高权威。
   */
  const name = String(pose?.name || '');
  const frozen = String(pose?.frozen || '');
  if (NONPEN_CN_RE.test(name)) return false;
  if (PEN_CN_RE.test(name)) return true;
  if (NONPEN_CN_RE.test(frozen)) return false;
  if (PEN_CN_RE.test(frozen)) return true;
  // ④ 英文提示词强信号（最后一道保险）
  return PEN_STRONG_BLOB_RE.test(poseBlob(pose));
}

/**
 * 由体位 + 场景拼出**能力键**表（`needs` 就查它）。
 *
 * 分两类来源，同名即满足：
 *   · 场景侧（卧室的 `bed`、浴室的 `water`…）
 *   · 体位侧（`clothed` / `penis` / `oral` / `penetration` / `multi` …）
 */
export function buildContext(pose, sceneTag) {
  const blob = poseBlob(pose);
  const penetration = isPenetration(pose);
  return {
    // ── 场景提供的（默认全 false；命中哪个由 sceneTag 摊平覆盖）──
    indoor: false, outdoor: false, night: false, water: false,
    mirror: false, doorway: false, public: false,
    bed: false, seat: false, wall: false, table: false, ground: false,
    // ── 体位提供的 ──
    // ★ `clothed` = 非插入类：体位数据完全不区分裸体与穿衣（实测 0/84），
    //   只能由"是否本番"推断"是否可能还穿着衣服"。衣物状态类标签全靠它。
    clothed: !penetration,
    penetration,
    penis: RE_PENIS.test(blob),
    oral: !!RE.oral?.test(blob),
    anal: RE_ANAL.test(blob),
    multi: Number(pose?.girls || 1) + Number(pose?.boys || 0) >= 2,
    solo: Number(pose?.boys || 0) === 0 && Number(pose?.girls || 1) === 1,
    lying: !!RE.lying?.test(blob),
    standing: RE_STANDING.test(blob),
    // 场景键摊平进来（`needs` 查的就是这个平表：场景键与体位键同名即满足）
    ...(sceneTag || {}),
  };
}

/**
 * 场景池的**体位预筛**：体位自带场景暗示时（077 是浴室、081 在桌上），
 * 把池子硬缩到那几个场景。缩完为空则**退回原池**（宁可场景不准，也不能没场景）。
 */
export function restrictScenesByPose(pool, pose) {
  const blob = poseBlob(pose);
  for (const hint of RE_SCENE_HINT) {
    if (hint.re && hint.re.test(blob)) {
      const narrowed = pool.filter(e => hint.scenes.includes(e.en));
      if (narrowed.length) return narrowed;
    }
  }
  return pool;
}

/** 该条目在当前上下文下是否合法（硬约束）；返回 null = 合法，否则返回原因 */
function violation(entry, ctx, picked) {
  if (entry.needs?.length && !entry.needs.every(k => ctx[k])) {
    return `needs:${entry.needs.filter(k => !ctx[k]).join(',')}`;
  }
  if (entry.match) {
    const re = compile(entry.match);
    if (re && !re.test(ctx.__blob || '')) return 'match';
  }
  if (entry.block) {
    const re = compile(entry.block);
    if (re && re.test(ctx.__blob || '')) return 'block';
  }
  if (entry.notWith?.length) {
    const taken = new Set(Object.values(picked).map(x => x?.en).filter(Boolean));
    const hit = entry.notWith.find(n => taken.has(n));
    if (hit) return `notWith:${hit}`;
  }
  return null;
}

/** 软偏好倍数（`soft: [[维度键, 正则, 倍数]]`；'pose' 伪维度指体位文本） */
function softMultiplier(entry, ctx, picked) {
  if (!entry.soft?.length) return 1;
  let mult = 1;
  for (const [dim, re, k] of entry.soft) {
    if (!(re instanceof RegExp)) continue;
    const subject = dim === SOFT_DIM_OF_POSE ? (ctx.__blob || '') : (picked[dim]?.en || '');
    if (subject && re.test(subject)) mult *= k;
  }
  return mult;
}

/** 按权重抽 1 项（权重 = softMultiplier；默认 1） */
function weightedPick(entries, ctx, picked, rand) {
  const weights = entries.map(e => Math.max(0.0001, softMultiplier(e, ctx, picked)));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < entries.length; i++) {
    r -= weights[i];
    if (r <= 0) return entries[i];
  }
  return entries[entries.length - 1];   // 浮点误差兜底
}

/**
 * 抽一条完整的「环境层」。
 *
 * @param {object} pose - `SEX_POSITIONS` 里的一条（可为 null → 退化为纯场景模式）
 * @param {object} [opts]
 * @param {() => number} [opts.rand] - 随机源（测试注入，默认 `Math.random`）
 * @returns {{picks: Array<{dim,en,cn,phrase}>, sentence: string, tags: string[]}}
 *          `picks` 按维度顺序；`sentence` 是追加进 image_prompt 的英文片段；
 *          `tags` 是进 `tags_json` 的英文标签。三者**同源**，不会漂移。
 */
export function pickGalleryEnvelope(pose, opts = {}) {
  const rand = typeof opts.rand === 'function' ? opts.rand : Math.random;
  const blob = poseBlob(pose);

  // 顺序即依赖顺序：场景先定（后面的维度靠它提供 `needs` 能力）
  const picked = {};
  const ctxBase = { __blob: blob };

  for (const dim of ENV_DIMENSIONS) {
    let pool = dim.pool || [];
    if (!pool.length) throw new Error(`环境层维度「${dim.key}」的基础池为空（数据错误）`);
    // 场景维度先按体位的自带暗示预筛（077 浴室 / 081 桌面）
    if (dim.key === 'scene') pool = restrictScenesByPose(pool, pose);
    if (!pool.length) pool = dim.pool;

    // 场景维度已抽出来的话，后续维度据此满足 needs
    const ctx = { ...ctxBase, ...buildContext(pose, picked.scene) };

    // ① 正常路径：全部约束
    const pool1 = pool.filter(e => !violation(e, ctx, picked));
    // ② 放宽 needs / notWith / match，只保留物理矛盾（block）
    const pool2 = pool.filter(e => {
      if (!e.block) return true;
      const re = compile(e.block);
      return !(re && re.test(blob));
    });
    // ③ 兜底：基础池
    const candidates = pool1.length ? pool1 : (pool2.length ? pool2 : pool);

    picked[dim.key] = weightedPick(candidates, ctx, picked, rand);
  }

  const picks = ENV_DIMENSIONS
    .map(d => ({ dim: d.key, ...picked[d.key] }))
    .filter(p => p.en);

  // D4b 焦点：**派生**而非随机（见 FOCUS_RULES 说明），插在 optics 之后
  const focus = deriveFocus(pose);
  const opticsAt = picks.findIndex(p => p.dim === 'optics');
  picks.splice(opticsAt >= 0 ? opticsAt + 1 : picks.length, 0, focus);

  return {
    picks,
    sentence: buildEnvelopeSentence(picks),
    tags: picks.map(p => p.en),
  };
}

/**
 * 把 7 个维度拼成一段**追加**在体位提示词后面的英文片段。
 *
 * 为什么是自然语言而不是 `Setting: xxx, Lighting: yyy`：
 *   目标模型（Anima）吃自然语言，字段名会被当成"要画出来的文字"。
 */
export function buildEnvelopeSentence(picks) {
  const get = (dim) => picks.find(p => p.dim === dim)?.phrase || '';
  const scene = get('scene');
  const light = get('lighting');
  const view = get('view');
  const focus = get('focus');
  const optics = get('optics');
  const emotion = get('emotion');
  const state = get('state');
  const prop = get('prop');

  /*
   * 每个维度**各自成句**，句号连接。
   *
   * 为什么不用逗号串：各维度的 `phrase` 形态是混的 —— 有的是独立句
   * （`a flush spreads over her cheeks`），有的是从句（`shallow depth of field`）。
   * 用逗号串会出现「The frame centers on the hands, A little motion blur smears…」
   * 这种逗号后接大写开头的畸形句。各自成句则**无论 phrase 什么形态都成立**。
   */
  const body = [focus, optics, emotion, state, prop].filter(Boolean);
  const sentences = [
    scene ? `The scene is ${scene}.` : '',
    light ? `${light}.` : '',
    view ? `${view}.` : '',
    ...body.map(p => `${p[0].toUpperCase()}${p.slice(1)}.`),
  ].filter(Boolean);

  return sentences.join(' ').replace(/\s+/g, ' ').trim();
}
