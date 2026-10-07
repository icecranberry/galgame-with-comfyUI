/**
 * outfitScene.js — 场景服装（工装 / 私服 / 居家 / 睡衣）
 *
 * ── 解决什么问题 ──
 *
 * 角色的「## 你的外观」是一套固定描述，于是不管在上班、逛街还是睡觉，生图都用同一身衣服。
 * 本模块让角色拥有**多套场景服装**，由**日程**决定此刻该穿哪套 —— 这样朋友圈配图、聊天、
 * 立绘才会「场合正确」。
 *
 * ── 与其他换装机制的关系（三条通道，互不干扰）──
 *
 *   character_outfits.scene IS NOT NULL  → 场景服装（本模块；可多套并存，按日程选一套）
 *   character_outfits.enabled = 1        → 角色专属形态（道具变身，同时只一套，有 expires_at）
 *   global_outfits  enabled = 1          → 通用限时服饰（可多套叠加）
 *
 * 注入优先级：**限时服饰/道具 > 场景服装 > 人物卡原本外观**。
 * 也就是「用户主动用了换装道具」时不该被自动的场景服装盖掉。
 *
 * ── 睡眠是硬规则 ──
 *
 * 睡眠时段（日程里 replyDelay === -1）**强制**用 sleep 那套，不看日程里的 outfit 标注
 * —— 否则模型很容易安排角色穿着制服睡觉。
 */

import { getDb, getSystemRules, getWorldSetting } from '../db/index.js';
import { getLocalDateKey } from '../utils/localDate.js';
import { chatSync } from '../llm/llm-client.js';
import { config } from '../config.js';

/**
 * 场景枚举。key 会落到 character_outfits.scene，改这里必须同步迁移注释。
 *
 * defaultName：界面**不再让用户填服装名**（名称对生图毫无用处，描述才是交给 ComfyUI 的东西），
 * 名称仅剩一个用途 —— 日程的 `outfit` 字段按**名称**标注「这一刻换了哪套」，
 * `getSceneOutfitForNow` 也按名称回查。所以留一组稳定的默认名，界面自动写入、用户不用管。
 */
export const OUTFIT_SCENES = [
  // ⚠ 2026-10-05：「裸体」已改名「全身」（界面与内部匹配名一起改，见 migrateOutfitNudeRename）。
  //   改这里的 label / defaultName 必须同步迁移存量（character_outfits.name + 两张日程表的 outfit 标注）——
  //   套名是**日程标注的匹配键**，只改常量会让老数据匹配不上、角色静默回退成默认服装。
  //   语义不变：这一套仍是"不穿任何衣物"的私密状态，NUDE_DESCRIPTION 常量也不动。
  { key: 'nude', label: '全身', defaultName: '全身', desc: '即「不穿任何衣物」的全身体态（原叫「裸体」）。**只用于私密场景**：洗浴、泡澡，以及在自己家里/酒店客房等私密空间里的性场景。**睡眠时段不用它**（睡觉一律穿睡衣）' },
  { key: 'work', label: '常服', defaultName: '日常装', desc: '上班、出勤、执行职务时穿（角色的招牌/常态形象）' },
  { key: 'casual', label: '私服', defaultName: '便装', desc: '上街、社交、休闲外出时穿的便装' },
  { key: 'home', label: '居家', defaultName: '居家服', desc: '在家中休息、做家务时穿的宽松舒适衣物。**脚上必须是一双室内拖鞋（indoor slippers）**——居家不等于赤脚（赤脚只属睡衣那套）；也不要用外出鞋（运动鞋/靴子/高跟鞋）' },
  { key: 'sleep', label: '睡衣', defaultName: '睡衣', desc: '睡觉时穿的睡衣或内衣，**赤脚、不穿鞋袜**。**睡眠时段强制使用这一套**' },
];

/**
 * 只用于私密场景的那一套（原「裸体」，现名「全身」）。
 * `getSceneOutfitForNow` 的兜底必须跳过它 —— 否则日程里没有 `outfit` 标注时，
 * 角色会在街上「兜底成不穿衣服」。洗浴/私密性场景必须由日程**显式标注**才会用到。
 */
export const PRIVATE_SCENE = 'nude';

/** 场景 key → 默认服装名（界面保存时自动写入，用户看不到这个字段） */
export const DEFAULT_NAME_BY_SCENE = Object.fromEntries(OUTFIT_SCENES.map(s => [s.key, s.defaultName]));

const SCENE_KEYS = OUTFIT_SCENES.map(s => s.key);
const LABEL_BY_KEY = Object.fromEntries(OUTFIT_SCENES.map(s => [s.key, s.label]));

/**
 * 拼出「注入用的自包含外观文本」= 身体 + 该套服装。
 *
 * ── 为什么这样拆（2026-10-04）──────────────────────────────
 * 原先 description 把身体和衣服混写，于是同一部位在「角色外观段 / work / casual」
 * 三处互相矛盾（银狼的发型有三个版本），且全身场景没有身体真源。
 * 现在：`body` 一列存**该角色 5 套共用的身体描述**，`description` 只存**衣服**；
 * 注入时才拼成自包含文本 —— 身体只存一份，不会在各套之间漂移。
 *
 * `nude` 那套的 garment 为空/`no clothing`，拼出来就是纯身体描述，
 * 正好满足「洗浴/私密场景只用身体」。
 */
export function composeOutfitText(body, garment) {
  const b = String(body || '').trim().replace(/[,\s]+$/, '');
  const g = String(garment || '').trim().replace(/[,\s]+$/, '');
  if (b && g) return `${b}, ${g}`;
  return b || g;
}

/** 该角色的全部场景服装（按场景顺序，便于界面展示与匹配） */
export function listSceneOutfits(characterId) {
  if (!characterId) return [];
  const rows = getDb().prepare(
    `SELECT id, name, description, scene, body FROM character_outfits
     WHERE character_id = ? AND scene IS NOT NULL AND scene != ''
     ORDER BY CASE scene WHEN 'nude' THEN 0 WHEN 'work' THEN 1 WHEN 'casual' THEN 2 WHEN 'home' THEN 3 WHEN 'sleep' THEN 4 ELSE 9 END, id ASC`
  ).all(characterId);
  return rows.map(r => ({
    ...r,
    sceneLabel: LABEL_BY_KEY[r.scene] || r.scene,
    // 注入用文本（自包含：身体 + 服装）
    text: composeOutfitText(r.body, r.description),
  }));
}

/**
 * 把「某一套场景服装」转成 `buildCharacterPersona` 认的 `outfits` 参数。
 *
 * ── 什么时候用它（而不是让 buildCharacterPersona 走 'auto'）──
 * `'auto'` 会按**当前日程时刻**选装：夜里变睡衣、洗浴时段变全身、在家变居家。
 * 这对聊天/朋友圈是对的（角色此刻确实那么穿），但**生成形象图时必须固定**：
 * 头像、场景立绘这类要的是角色的**基准形象**，不能"白天生成是常服、半夜生成是睡衣"。
 * 所以调用方显式指定场景，由本函数取那一套喂进去。
 *
 * ⚠ 用 `hit.text`（身体 + 服装的组合文本），**不要用裸 `description`** ——
 *   `description` 现在只存衣服，直接用会让画面丢掉身体特征。
 *   （本函数正是为了把这句口径收成一处，避免各生成点各写一遍、写法漂移。）
 *
 * @param {number} characterId
 * @param {string} scene - 场景 key（work / casual / home / sleep / nude）
 * @returns {{limited: Array<{name:string, description:string}>, exclusive: null}|null}
 *          该角色没有这一套时返回 null（= 不注入，退回基础外观）
 */
export function sceneOutfitParam(characterId, scene) {
  if (!characterId || !scene) return null;
  const hit = listSceneOutfits(characterId).find(o => o.scene === scene);
  if (!hit) return null;
  return { limited: [{ name: hit.name, description: hit.text || hit.description }], exclusive: null };
}

/**
 * 写角色的「身体描述」，**同步到该角色全部服装行**。
 *
 * 这是"单一真源"的落点：界面只让用户编辑一个身体字段，保存时写进每一行，
 * 既避免重复维护，也保证 5 套之间不会漂移。
 */
export function setCharacterBody(characterId, body) {
  const clean = String(body || '').trim().slice(0, 2000);
  const r = getDb().prepare('UPDATE character_outfits SET body = ? WHERE character_id = ?')
    .run(clean, characterId);
  return { ok: true, updated: r.changes };
}

/**
 * 全身那套的**固定描述** —— 所有角色、任何情况都一样，是**系统常量**，不提供用户输入。
 *
 * 为什么它必须是常量而不是"可填的一项"：
 *   · 「全身」（不穿衣服）就是"没穿"这一个状态，没有任何可定制的余地；
 *   · 真正需要因人而异的是**身体**，那已经由共用的 `body` 承担；
 *   · 让它可填反而会出问题 —— 一旦被存成空字符串，注入里就没有"不穿衣服"这个声明了，
 *     模型会照基础外观把衣服画上（2026-10-04 实测：姬子那条该行的描述就是空的）。
 */
export const NUDE_DESCRIPTION = 'completely nude, wearing no clothing at all, bare skin visible';
/** 那一套的默认名（日程标注按名字匹配，全库统一用它）。
 *  2026-10-05 由「裸体」改为「全身」—— 改这里**必须**同步跑 migrateOutfitNudeRename，
 *  否则老角色的行仍叫「裸体」，新日程标「全身」就匹配不上了。 */
export const NUDE_NAME = '全身';

/**
 * 规范化形态的写入：全身那套的描述一律用常量，调用方传什么都以常量为准。
 *
 * ⚠ `humanEdited` 决定**要不要过脚部护栏** —— 见 `enforceSceneFootwear` 上方那段说明。
 *   AI 产出：过护栏（模型有惯性，必须兜底）；
 *   人工编辑：**不过**（用户改什么就是什么）。
 */
function normalizeGarment(scene, description, humanEdited = false) {
  if (scene === PRIVATE_SCENE) return NUDE_DESCRIPTION;
  const d = String(description || '').trim().slice(0, 1200);
  return humanEdited ? d : enforceSceneFootwear(scene, d);
}

/**
 * 出口层兜底：强制「居家＝拖鞋、睡衣＝赤脚」这一对相反的脚部口径。
 *
 * ── 为什么必须在这里做（2026-10-06 用户反馈）────────────────────
 * 用户注意到居家服被生成成"没有鞋子"，但现实中居家是穿拖鞋的。
 * 实测存量 15 套居家：2 套写成赤脚、3 套自相矛盾（如「barefoot + 拖鞋」「袜子 + barefoot」）。
 * 根因是提示词只约束了睡衣、对居家**完全没规定**，模型只能随机发挥。
 * 提示词已补（本条 + GEN_SYSTEM_PROMPT + buildDeriveLayer + expand 入口），
 * 但**模型有惯性** —— 按项目红线，「改提示词不够，必须在出口层兜底」。
 *
 * ⚠ 只做**最小干预**：能在已有文本里识别到鞋/赤脚就替换那一个词，
 *   识别不到才追加；且**睡衣不追加任何鞋类**（睡衣的规则是"不出现鞋"）。
 *
 * ★★ 2026-10-07 ★★ **它只能作用于 AI 产出，绝不能作用于人工编辑。**
 *
 * 用户实报：「玩家人工修改了绯英的睡衣，但点击保存以后自动刷新为原文段」。
 * 实测复现根因就在这个函数：用户在睡衣里把靴子改成自己想要的写法（甚至写了 `boots`），
 * 保存时 `upsertSceneOutfits → normalizeGarment → enforceSceneFootwear` 照着"睡衣不能有鞋"
 * 的规则，**把含 `boot` 的整段删掉、再强制追加 `, barefoot`** ——
 * 用户的编辑被系统静默改写，看起来就是"保存后变回原来的样子"。
 *
 * 判据：**护栏的目的是替"会犯错的模型"兜底，不是替人做决定。**
 * 人工编辑是显式指令，其优先级高于任何自动规则（与本项目其它「显式优先」口径一致）。
 */
export function enforceSceneFootwear(scene, description) {
  if (description == null || description === '') return description;   // 空值原样返回（不凭空造鞋）
  const d = String(description);
  if (scene !== 'home' && scene !== 'sleep') return d;

  // ── 按逗号分段后**原位**处理 ──
  // ⚠ 两个坑：
  //   ① 不能只替换"关键词"（会留下悬空片段："covered in fuzzy slippers and ankle socks"
  //      删词后剩 "covered in"、"white slippers with gold trim" 剩 "with gold trim"）；
  //   ② **不能把拖鞋挪到末尾重排** —— 那会打乱原有描述结构（实测把「裸脚踝」甩到最后，
  //      读起来像换了个人）。所以按段**原位**替换/删除。
  const segs = d.split(/[,，]/).map(s => s.trim()).filter(Boolean);

  const FOOT_RE = /slipper|shoe|sneaker|boot|heel|sandal|loafer|sock|stocking|pantyhose|tights|barefoot|bare\s+feet|bare\s+foot|bare\s+ankle|ankle\s+warm|拖鞋|室内鞋|棉拖|袜子|长袜|赤脚|光脚|赤足|光着脚/i;
  const SLIPPER_RE = /slipper|拖鞋|室内鞋|棉拖/i;
  // 「裸脚踝/脚链」这类**不是鞋**的脚部描述 —— 居家场景下与拖鞋并不冲突（拖鞋本来就露脚踝）
  const ANKLE_KEEP_RE = /bare\s+ankle|anklet|脚链/i;

  const cleaned = (arr) => {
    // 相邻重复段合并（如 "indoor slippers, indoor slippers" → 一个），再清标点
    const dedup = [];
    for (const s of arr) {
      const last = dedup[dedup.length - 1];
      if (last && last.toLowerCase() === s.toLowerCase() && SLIPPER_RE.test(s)) continue;
      dedup.push(s);
    }
    return dedup.join(', ').replace(/,\s*,/g, ',').replace(/[,\s]+$/, '').trim();
  };

  if (scene === 'home') {
    // 居家：把「赤脚/袜子」段原位换成拖鞋；已有拖鞋段原样保留；裸脚踝段保留原位。
    // ★ 若全文**已有**拖鞋，就不再替换（只把赤脚/袜子段删掉）—— 否则会出现
    //   「indoor slippers, indoor slippers」或「indoor slippers, white cloth slippers」这类重复。
    const hasSlipperAnywhere = segs.some(s => SLIPPER_RE.test(s));
    const out = [];
    for (const s of segs) {
      if (!FOOT_RE.test(s)) { out.push(s); continue; }            // 非脚部段：原样
      if (SLIPPER_RE.test(s)) { out.push(s); continue; }           // 已有拖鞋：原样
      if (ANKLE_KEEP_RE.test(s)) { out.push(s); continue; }        // 裸脚踝：原样
      // 赤脚 / 袜子段：已有拖鞋则直接删掉，否则原位换成拖鞋
      if (!hasSlipperAnywhere) out.push('indoor slippers');
    }
    if (!out.some(s => SLIPPER_RE.test(s))) out.push('indoor slippers');
    return cleaned(out);
  }

  // 睡衣：原位**删除**所有脚部段（画面里不出现任何鞋袜，含裸脚踝/脚套），末尾补 barefoot
  const out = segs.filter(s => !FOOT_RE.test(s));
  return `${cleaned(out)}, barefoot`.replace(/^,\s*/, '').trim();
}

/**
 * 批量写入场景服装（供「一键生成」与「界面保存」共用）。
 * 同名同场景则更新描述，避免重复堆叠。
 *
 * ★★ 两条写入通道必须分开（2026-10-07 用户实报的 bug 就出在没分开）★★
 *
 * `opts.humanEdited = true` → **人工编辑**：描述**原样写入**，不过任何自动护栏。
 * 否则（默认）→ **AI 产出**：过 `normalizeGarment`（含 `enforceSceneFootwear` 脚部兜底）。
 *
 * 病根复现：用户在睡衣里写了 `boots` 想要靴子，保存时被「睡衣不能有鞋」的护栏
 * 把整个含 `boot` 的段删掉、再追加 `, barefoot` —— 用户看到的就是"保存后变回原样"。
 * 护栏是替**会犯错的模型**兜底的，不该替人做决定。
 *
 * @param {number} characterId
 * @param {Array<{scene:string,name:string,description:string,body?:string}>} outfits
 * @param {{humanEdited?:boolean}} [opts]
 */
export function upsertSceneOutfits(characterId, outfits, opts = {}) {
  const humanEdited = opts.humanEdited === true;
  const db = getDb();
  const ins = db.prepare(
    `INSERT INTO character_outfits (character_id, name, description, scene, body) VALUES (?, ?, ?, ?, ?)`
  );
  const upd = db.prepare(
    `UPDATE character_outfits SET name = ?, description = ?, body = COALESCE(?, body) WHERE id = ?`
  );
  const find = db.prepare(
    `SELECT id, name FROM character_outfits WHERE character_id = ? AND scene = ? LIMIT 1`
  );
  let added = 0, updated = 0;
  const tx = db.transaction(() => {
    for (const o of outfits) {
      if (!o?.scene || !SCENE_KEYS.includes(o.scene) || !o.name) continue;
      const body = o.body != null ? String(o.body).trim().slice(0, 2000) : null;
      // ★ humanEdited 一路传下去：人工编辑不过脚部护栏
      const desc = normalizeGarment(o.scene, o.description, humanEdited);
      const exist = find.get(characterId, o.scene);
      if (exist) {
        /**
         * 全身那套**保留已有名字**：日程标注是按「名字」匹配的，
         * 若这里被改名，已生成的日程里那些 `outfit: "全身"` 就匹配不上了。
         * （2026-10-05 从「裸体」改名时，存量就是靠 migrateOutfitNudeRename 一起迁的。）
         * 其余套按调用方给的名字更新。
         */
        const name = o.scene === PRIVATE_SCENE ? (exist.name || o.name) : o.name;
        upd.run(name, desc, body, exist.id);
        updated++;
      } else {
        ins.run(characterId, o.name, desc, o.scene, body || '');
        added++;
      }
    }

    /**
     * 兜底：**保证「全身」那一行存在**。
     *
     * 前端不再提供它的输入（描述是常量），所以调用方可能根本不传它 ——
     * 但 `getSceneOutfitForNow` 是按「名字」匹配日程标注的，
     * 没有这一行，日程里标的「全身」就匹配不上；`buildOutfitAnnotateLayer`
     * 也靠它决定要不要渲染「它在什么时候才用」那段提示。
     * 所以由这里负责建（缺则补、有则上面已把描述规范化为常量 → 顺带自愈空描述）。
     */
    if (!find.get(characterId, PRIVATE_SCENE)) {
      const anyBytes = db.prepare(
        `SELECT body FROM character_outfits WHERE character_id = ? AND body IS NOT NULL AND body != '' LIMIT 1`
      ).get(characterId);
      ins.run(characterId, NUDE_NAME, NUDE_DESCRIPTION, PRIVATE_SCENE, anyBytes?.body || '');
      added++;
    }
  });
  tx();
  return { added, updated };
}

// ── LLM 生成基础场景服装 ──────────────────────────────────

/** 取角色人设正文（截到外观段之前，控制长度） */
function cropPersona(basePrompt) {
  const base = String(basePrompt || '');
  const at = base.search(/##\s*你的外观/);
  const body = at >= 0 ? base.slice(0, at) : base;
  return body.trim().slice(0, 2000);
}

const GEN_SYSTEM_PROMPT = `你是角色外观设计助手。你为角色设计**自包含的外观描述**：一套 = 身体 + 服装。

【身体与服装分开输出】
每个 scene 都要输出两个字段：
- \`body\`：这个角色的**身体特征**（全身）：发色、发型、瞳色、肤色、体型/身高等。
  **同一角色的所有 scene，body 必须完全一致**（是同一个人）。
- \`description\`：**只写这一套的服装**（衣服、鞋袜、配饰），不要重复身体特征。

【输出语言】
一律用**英文生图提示词风格**（逗号分隔的短语），因为这两个字段最终会直接喂给生图模型。
不要中文、不要完整句子、不要「她穿着一件」这类叙述。

【五套场景定义（scene 字段照抄英文 key；本次具体要哪几套以用户消息为准，别多给）】
- nude（全身）：**不穿任何衣物**的私密状态（洗浴、在自己家里/酒店客房这类私密空间里的性场景）。
  这一套的 \`description\` 固定写 \`completely nude, wearing no clothing, bare skin\`；
  \`body\` 要写得比平时**更完整**（既然是全身、不穿衣服，身体就是画面主体）：
  除发型瞳色外，补上肤色、体型、胸/腰/腿的形态、以及显著身体特征（痣、伤痕、纹身、兽耳兽尾等）。
- work（常服）：这个角色在**其职业/身份场合**日常穿的那身。制式职业（警察、护士、学生等）
  就是对应制服；自由职业者则是工作时常穿的那身。
- casual（私服）：休息日上街、见朋友、逛街时穿的便装。
- home（居家）：在家里做家务、放松、看书时穿的宽松舒适衣物。
  **★ 脚上要穿室内拖鞋**：description 里必须写出 indoor slippers（与服装风格协调的家居拖鞋），
  因为现实中居家就是穿拖鞋 —— **不要写成 barefoot**（赤脚只属睡衣那套），也不要用外出鞋
  （sneakers / boots / heels / sandals 一律不写）。
- sleep（睡衣）：**睡觉时穿的睡衣或内衣**（睡裙 / 睡衣睡裤 / 吊带内衣 + 短裤 / 内裤等），
  不要设计成能穿出门的服装。
  **★ 必须赤脚**：description 里必须明确写出 barefoot。
  **画面里不要出现任何鞋类** —— shoes / boots / slippers / heels / sandals / socks / stockings /
  pantyhose / tights 一律不写，**连「床边摆着一双没穿的拖鞋」这种也不要写**
  （生图模型看到 slippers 就会把它画出来）。只交代脚本身是裸的。

【要求】
1. 各套服装必须**彼此区分明显** —— 一眼能看出是上班、出门、在家还是睡觉。
2. 必须**贴合这个角色的人设与世界观**：颜色、风格、职业特征要呼应 ta 的身份。
   若提供了世界观，服装要符合那个世界的技术与文化（不要直接照抄现实品牌或原作品服装名）。
3. 只输出 JSON，不要解释、不要 Markdown 代码块。

## 输出格式
{"outfits":[{"scene":"nude","name":"全身","body":"...","description":"completely nude, wearing no clothing, bare skin"},{"scene":"work","name":"...","body":"...","description":"..."}]}`;

/**
 * 反推层：把「已填好的分项」交给模型，让它**据此反推未填的分项**。
 *
 * ── 设计意图（2026-10-04 用户提出，替代原先固定「按工装推其余三套」）──
 * 用户可能只填了一两项（比如手工填了常服、或从一张图反推了全身），
 * 其余项不该从人设凭空重画 —— 那会让「同一个人」的身体漂移。
 * 正确做法：**以已填项为锚**，身体取自锚点、只补该套的服装。
 *
 * 锚点优先级 `bodySource`：**nude → work/casual → 角色卡外观段**。
 * 优先 nude 是因为它"只有身体、没有衣服"，是身体描述最纯的来源。
 */
function buildDeriveLayer(seeds, bodySource, scenes) {
  const labels = scenes.map(s => LABEL_BY_KEY[s] || s).join('、');
  const seedText = seeds.map(s => {
    const scene = s.scene ? `【${LABEL_BY_KEY[s.scene] || s.scene}】` : '';
    return `${scene}${s.name ? ` ${s.name}` : ''}\n  body: ${s.body || '（无）'}\n  description: ${s.description || '（无）'}`;
  }).join('\n');

  const sleepNote = scenes.includes('sleep')
    ? '\n5. **睡衣那一套要赤脚**：不要写任何鞋袜（shoes / slippers / socks 等），只交代 barefoot。'
    : '';
  // 居家与睡衣相反：居家是穿拖鞋的（用户口径 2026-10-06）。不点明模型会写成 barefoot。
  const homeNote = scenes.includes('home')
    ? '\n6. **居家那一套要穿室内拖鞋**：脚上写 indoor slippers，**不要写成 barefoot**（赤脚只属睡衣那套），也不要写外出鞋。'
    : '';

  return `【已确定的基准（最高优先级，必须原样沿用）】
以下是这个角色**已经确定好**的外观，请把它们当作事实基准：

${seedText}

${bodySource ? `【身体描述的唯一真源 —— 逐字照抄，一个字都不要改】
${bodySource}

` : ''}本次要补的（${labels}）和上面是**同一个人**。因此：
1. **body 字段必须逐字照抄上面的「身体真源」**（含 nude 那一套在内，五套身体必须完全一致）——
   发色、发型、瞳色、肤色、体型、身高等一个字都不要改写、不要重新描述。
2. **只设计 description**（这一套的服装），不要动身体。
3. 服装要与已确定那套处在**同一套审美体系**里（相近的配色偏好、材质与气质），
   看得出是同一个人换了衣服，而不是换了一个人。
4. 不要把已确定的那套衣服原样再写一遍 —— 新补的几套必须和它明显不同。${sleepNote}${homeNote}`;
}

/**
 * 纯函数：算出本次要生成/反推**哪几套**。
 *
 * ── 一个容易踩的坑（2026-10-04 实测踩到）──────────────────
 * 「已填好的分项」必须**只看 `description`**，**不能把"带了 body"也算成这一套已填**：
 * 身体是**五套共用的一层**（由 baseAppearance / pickBody 单独处理），
 * 而这里的结果会用来**从待生成目标里剔除**已填项 ——
 * 若把"带 body"当已填，调用方只要顺手给每一条都附上 body，目标就会被**全部剔空**，
 * 上层静默拿到空数组，表现为"点了反推没反应"。
 *
 * ② **「全身」永远不在生成目标里** —— 它的描述是系统常量（`NUDE_DESCRIPTION`），
 *    让 LLM 去"设计"它纯属浪费、还可能被写坏；那一行由 `upsertSceneOutfits` 负责维护。
 *
 * 抽成独立函数是为了**能在不调 LLM 的前提下单测**这几条语义。
 *
 * @param {Array<{scene:string, body?:string, description?:string}>} seeds 已填好的分项
 * @param {string[]} [wanted] 调用方指定的目标；留空 = 全部还没填的（不含全身）
 */
export function planOutfitTargets(seeds, wanted = []) {
  const rows = (Array.isArray(seeds) ? seeds : [])
    .filter(s => SCENE_KEYS.includes(s?.scene) && (s.body || s.description));
  const filled = new Set(
    rows.filter(s => String(s.description || '').trim()).map(s => s.scene),
  );
  // 可生成的场景：**排除全身** —— 它的描述是系统常量，不需要（也不该）让 LLM 生成
  const generable = SCENE_KEYS.filter(s => s !== PRIVATE_SCENE);
  const want = (Array.isArray(wanted) ? wanted : []).filter(s => generable.includes(s));
  return (want.length ? want : generable).filter(s => !filled.has(s));
}

/**
 * 用 LLM 为角色生成/补全场景外观（不落库，由调用方决定保存）。
 *
 * @param {object} character
 * @param {{ scenes?: string[], seeds?: Array<{scene,name,body,description}>, baseAppearance?: string }} opts
 *   scenes         本次要生成哪几套；不传 = 全部还没填的
 *   seeds          **已填好的分项**，作为反推锚点（新口径的核心）
 *   baseAppearance 角色卡外观段；没有任何 seed 时作为身体来源的兜底
 * @returns {Promise<Array<{scene,name,body,description}>>}
 */
export async function generateSceneOutfits(character, opts = {}) {
  const displayName = character?.display_name || '角色';
  const persona = cropPersona(character?.base_prompt);
  if (!persona) throw new Error('角色人格为空，无法生成外观');

  const seeds = (Array.isArray(opts.seeds) ? opts.seeds : [])
    .filter(s => SCENE_KEYS.includes(s?.scene) && (s.body || s.description))
    .map(s => ({
      scene: s.scene,
      name: String(s.name || '').trim(),
      body: String(s.body || '').trim(),
      description: String(s.description || '').trim(),
    }));

  // 未指定就补「所有还没有的」
  const targetScenes = planOutfitTargets(seeds, opts.scenes);
  if (!targetScenes.length) return [];

  const baseAppearance = String(opts.baseAppearance || '').trim();

  /**
   * 身体真源的选择（决定整组的一致性）：
   *   ① 锚点里有 nude → 用它（纯身体，最干净）
   *   ② 否则锚点里的 work/casual → 用其 body（这两套区分度最大、信息最全）
   *   ③ 都没有 → 用角色卡外观段（首次生成走这条）
   * 刻意**不用 sleep 当锚** —— 它的 description 常常极短（如"一件宽松的白T恤"），信息量不够。
   */
  const pickBody = () => {
    const byScene = new Map(seeds.map(s => [s.scene, s]));
    for (const k of [PRIVATE_SCENE, 'work', 'casual']) {
      const b = byScene.get(k)?.body;
      if (b) return b;
    }
    return seeds.find(s => s.body)?.body || baseAppearance || '';
  };
  const bodySource = pickBody();

  const worldSetting = getWorldSetting();
  const msgs = [
    { role: 'system', content: getSystemRules({ roleplay: false }) },
    { role: 'system', content: GEN_SYSTEM_PROMPT },
  ];
  if (worldSetting) msgs.push({ role: 'system', content: worldSetting });
  // 反推层放在人设之后、user 之前：它是本次生成的锚点，权重比人设更直接
  if (seeds.length || bodySource) {
    msgs.push({ role: 'system', content: buildDeriveLayer(seeds, bodySource, targetScenes) });
  }
  msgs.push({
    role: 'user',
    content: `角色名：${displayName}\n\n以下是 ta 的人设：\n${persona}\n\n`
      + `本次只需要设计这 ${targetScenes.length} 套：${targetScenes.map(s => `${s}（${LABEL_BY_KEY[s]}）`).join('、')}。`
      + `\n请为 ${displayName} 输出这几套，outfits 数组里只放这几套，不要多给。`
      + (bodySource ? '\n\n⚠ 每套的 body 字段都必须逐字照抄「身体描述的唯一真源」，不得改写。' : ''),
  });

  const model = config.llm.model || 'deepseek-chat';
  const raw = await chatSync(msgs, {
    model, temperature: 0.8, max_tokens: 3072,
    response_format: { type: 'json_object' }, label: '场景服装生成',
  });

  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    const m = String(raw).match(/\{[\s\S]*"outfits"[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : null;
  }
  const list = Array.isArray(parsed?.outfits) ? parsed.outfits : null;
  if (!list) throw new Error('模型返回格式无法解析');

  // 规范化 + 只保留本次要求的场景
  const out = [];
  for (const scene of targetScenes) {
    const hit = list.find(o => o?.scene === scene);
    // 身体一律以真源为准（模型可能仍自作主张改写），保证五套完全一致
    const body = bodySource || String(hit?.body || '').trim().slice(0, 2000);
    let description = String(hit?.description || '').trim().slice(0, 1200);
    // nude 那套必须显式声明"不穿衣服"，否则生图模型会沿用基础外观里的默认服装
    if (scene === PRIVATE_SCENE && !/nude|no clothing|bare skin/i.test(description)) {
      description = FALLBACK_OUTFITS[PRIVATE_SCENE].description;
    }
    // 非全身套缺服装描述才兜底；全身套允许 description 就是那串 nude 声明
    if (!description && scene !== PRIVATE_SCENE) {
      // ⚠ 兜底分支也必须过脚部护栏（FALLBACK 里的 home/sleep 文案已合规，但统一走一遍
      //   可防日后改文案时漏掉这个分支 —— 少一个出口就是一条静默绕过）
      out.push({
        scene,
        name: FALLBACK_OUTFITS[scene].name,
        description: enforceSceneFootwear(scene, FALLBACK_OUTFITS[scene].description),
        body,
      });
      continue;
    }
    out.push({
      scene,
      name: String(hit?.name || '').trim().slice(0, 20) || DEFAULT_NAME_BY_SCENE[scene],
      // ★ 出口层兜底脚部口径（居家＝拖鞋、睡衣＝赤脚）—— 提示词压不住模型惯性，见 enforceSceneFootwear
      description: enforceSceneFootwear(scene, description),
      body,
    });
  }
  return out;
}

/** 模型漏给某场景时的兜底（尽量中性，避免画不出来）。
 *  ⚠ nude 的名字**必须**用 NUDE_NAME 常量、不能写字面量 —— 这是第二处硬编码套名，
 *    写死会让这条兜底路径注入「裸体」而库里/日程里是「全身」，两边对不上。 */
const FALLBACK_OUTFITS = {
  nude: { name: NUDE_NAME, description: 'completely nude, wearing no clothing at all, bare skin visible' },
  work: { name: '工作装', description: 'a simple practical work outfit, neat and comfortable, suitable for daily work' },
  casual: { name: '便装', description: 'casual everyday clothes, a simple top with matching bottoms, relaxed style' },
  // 居家兜底带室内拖鞋（用户口径 2026-10-06：居家是穿拖鞋的，赤脚只属睡衣）
  home: { name: '居家服', description: 'comfortable loose loungewear, soft fabric, relaxed fit for staying at home, indoor slippers' },
  // 睡衣兜底明确赤脚（且不出现任何鞋类）
  sleep: { name: '睡衣', description: 'a simple sleepwear set, soft lightweight fabric, camisole and shorts, barefoot' },
};

// ── 按日程决定此刻的服装 ──────────────────────────────────

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** 当前分钟数（本地时间） */
function nowMinutes(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

/** 取今日日程的活动数组（没生成/解析失败返回 []） */
function todayActivities(characterId, date = new Date()) {
  try {
    const row = getDb().prepare(
      'SELECT schedule_json FROM daily_schedules WHERE character_id = ? AND schedule_date = ?'
    ).get(characterId, getLocalDateKey(date));
    if (!row) return [];
    const parsed = JSON.parse(row.schedule_json);
    const arr = Array.isArray(parsed) ? parsed : (parsed?.activities || []);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * 找当前所处的时段下标。
 * 日程要求「上一个 endTime === 下一个 startTime」且覆盖完整 24 小时，所以必有命中；
 * 仍做兜底（取最后一段）以防数据异常。
 */
function findCurrentIndex(activities, minutes) {
  for (let i = 0; i < activities.length; i++) {
    const start = toMinutes(activities[i].startTime);
    let end = toMinutes(activities[i].endTime);
    if (end <= start) end += 24 * 60;                    // 跨午夜
    const cur = minutes < start ? minutes + 24 * 60 : minutes;
    if (cur >= start && cur < end) return i;
  }
  return activities.length - 1;
}

/**
 * 此刻该穿哪套场景服装。
 *
 * 判定顺序：
 *  1. 角色没有场景服装 → null（调用方回落原外观）
 *  2. 当前时段是睡眠（replyDelay=-1）→ **强制** sleep 那套（硬规则，优先于任何标注）
 *  3. 否则从当前时段**向前回溯**，找最近一个有 outfit 标注的时段 → 按名字匹配
 *     （日程只在「换装的那一刻」标注 outfit，其余留空，这样换装次数天然被限制）
 *  4. 都没匹配上 → 回到该角色的第一套**日常**服装（兜底，避免没衣服穿）
 *
 * ⚠ **兜底绝不能落到 `nude`** —— 那是"只用于私密场景"的一套，
 *   若成了兜底，日程里没写 outfit 的角色会在大街上不穿衣服。见 PRIVATE_SCENE。
 *
 * @returns {{outfit: object, scene: string, source: string}|null}
 *          source 便于排查：'sleep' | 'schedule' | 'fallback'
 */
export function getSceneOutfitForNow(characterId, date = new Date()) {
  const outfits = listSceneOutfits(characterId);
  if (!outfits.length) return null;

  const sleepOutfit = outfits.find(o => o.scene === 'sleep') || null;
  // 「白天可兜底」的服装：排除睡眠、也排除私密全身
  const dayOutfits = outfits.filter(o => o.scene !== 'sleep' && o.scene !== PRIVATE_SCENE);
  const byName = new Map(outfits.map(o => [o.name, o]));
  const byId = new Map(outfits.map(o => [String(o.id), o]));

  const acts = todayActivities(characterId, date);
  if (!acts.length) {
    // 没有日程：用第一套白天服装兜底（实在没有才退睡衣；**绝不用"全身"**）
    const fallback = dayOutfits[0] || sleepOutfit;
    return fallback ? { outfit: fallback, scene: fallback.scene, source: 'fallback' } : null;
  }

  const idx = findCurrentIndex(acts, nowMinutes(date));
  const cur = acts[idx] || {};

  // ② 睡眠：硬规则，优先于任何标注（**包括日程显式标的 nude** —— 睡觉一律穿睡衣）
  if (Number(cur.replyDelay) === -1 && sleepOutfit) {
    return { outfit: sleepOutfit, scene: 'sleep', source: 'sleep' };
  }

  // ③ 向前回溯最近的换装点（含当前段）；上限防止绕一圈
  for (let step = 0; step < acts.length; step++) {
    const i = (idx - step + acts.length) % acts.length;
    const o = acts[i]?.outfit;
    if (!o) continue;
    const text = String(o).trim();
    if (!text) continue;
    const hit = byName.get(text) || byId.get(text);
    if (hit) return { outfit: hit, scene: hit.scene, source: 'schedule' };
    // 标注了但匹配不到（LLM 编了个名字）→ 继续往前找，别停在一个无效值上
  }

  // ④ 兜底（同样排除 nude）
  const fallback = dayOutfits[0] || sleepOutfit;
  return fallback ? { outfit: fallback, scene: fallback.scene, source: 'fallback' } : null;
}

/** 把当前场景服装包成 characterPersona 认的 outfits 结构（走 limited 通道） */
export function asPersonaOutfits(sceneOutfit) {
  if (!sceneOutfit?.outfit) return null;
  const o = sceneOutfit.outfit;
  // ⚠ 注入的是**组合后**的文本（身体 + 服装）—— `o.description` 现在只存衣服，
  //   直接用它会丢掉身体特征。listSceneOutfits 已算好 `text`；这里的对象可能来自别处，故兜底现算。
  const text = o.text || composeOutfitText(o.body, o.description);
  return { limited: [{ name: o.name, description: text }], exclusive: null };
}

// ── 日程生成时的服装标注层 ──────────────────────────────────

/**
 * 为日程生成拼一段「服装标注」提示词。
 * 只有角色配了场景服装时才调用；没配的角色日程生成保持原样（零影响）。
 * @returns {string|null}
 */
/**
 * 由地图的 zone 标注生成「地点性质对照」块 —— **给答案，不给判断**。
 *
 * ⚠ 这一块是**数据**，不是让模型自己推断。
 *   过去只给「自己住处 vs 其余」，于是「别人家」「酒店客房」这类边界场景
 *   模型经常判错。现在若调用方带上了地图里标注过的 zone，就直接列出地名归属，
 *   把判定从"推断"变成"查表"。
 */
function buildZoneHintBlock(opts = {}) {
  const zr = Array.isArray(opts.residencePlaces) ? opts.residencePlaces.filter(Boolean) : [];
  const za = Array.isArray(opts.activityPlaces) ? opts.activityPlaces.filter(Boolean) : [];
  const zp = Array.isArray(opts.privatePlaces) ? opts.privatePlaces.filter(Boolean) : [];
  if (!zr.length && !za.length && !zp.length) return '';
  const L = ['', '', '**本次已由地图数据标注的地点性质（以下地名直接按此归类，不要再自行推断）**：'];
  if (zr.length) L.push(`- 「住所内」：${zr.map(n => `「${n}」`).join('、')} —— 在这些地点内的时段按住所内处理（居家服 / 睡衣）。`);
  if (za.length) L.push(`- 「住所外」：${za.map(n => `「${n}」`).join('、')} —— 在这些地点内的时段必须穿外出服。`);
  if (zp.length) L.push(`- 「私密空间（洗浴/更衣）」：${zp.map(n => `「${n}」`).join('、')} —— 只有这些地方该用"全身"那一套。`);
  L.push('- 不在上面的地名仍按本节的一般规则自行判断。');
  return L.join('\n');
}

export function buildOutfitAnnotateLayer(characterId, opts = {}) {
  const outfits = listSceneOutfits(characterId);
  if (outfits.length < 2) return null;   // 只有一套就没什么可分配的

  // 清单里给的是「组合后的自包含文本」—— 模型要照着这个判断"哪一套像什么场合"，
  // 也给模型一个身体描述可抄（反推时照抄这一份，五套才一致）
  const list = outfits.map(o =>
    `- "${o.name}"（${LABEL_BY_KEY[o.scene] || o.scene}）：${(o.text || composeOutfitText(o.body, o.description)).slice(0, 90)}`
  ).join('\n');
  const hasSleep = outfits.some(o => o.scene === 'sleep');
  const sleepName = outfits.find(o => o.scene === 'sleep')?.name;
  const nudeName = outfits.find(o => o.scene === PRIVATE_SCENE)?.name;
  const workName = outfits.find(o => o.scene === 'work')?.name;
  const casualName = outfits.find(o => o.scene === 'casual')?.name;
  const homeName = outfits.find(o => o.scene === 'home')?.name;
  // 「白天的服装」要排除睡眠与全身 —— 把它列进这里等于教模型"白天可以光着"
  const dayNames = outfits.filter(o => o.scene !== 'sleep' && o.scene !== PRIVATE_SCENE)
    .map(o => `"${o.name}"`).join(' / ') || '（无）';

  // 示例用角色真实拥有的服装名，避免出现"示例里写了 A、可选清单里没有 A"的自相矛盾
  const exOut = workName || casualName || outfits[0].name;
  const exHome = homeName || outfits[0].name;
  // 地点性质对照（有地图 zone 数据时才非空）
  const zoneHintBlock = buildZoneHintBlock(opts);

  // 全身那一段只在角色真的配了它时才讲 —— 没配的角色别被提示词带偏
  const nudeBlock = nudeName ? `

### 二点五、「${nudeName}」（不穿衣服）什么时候才用（严格）
"${nudeName}"**只用于私密场景**，一天里通常只有 1~2 段：
- **洗浴类**：洗澡、泡澡、冲凉、泡温泉。
- **私密性场景**：在自己家里、酒店客房这类**私密空间**里做爱。

判定要点：
- **地点必须在私密空间**（自己家 / 酒店客房 / 浴室）。在**外面**（街上、酒馆、车站、广场、
  公园、河岸）做爱**不标"${nudeName}"** —— 那种场合角色仍穿着衣服或不整，标对应的外出服。
- **睡眠时段绝不标"${nudeName}"**（睡觉一律穿"${sleepName || '睡衣'}"，硬规则，哪怕裸睡）。
- 洗完澡接着过日常时，别忘了**从浴室出来那一段重新标上衣服**（居家或外出）。
- 用不到就完全不出现这个值 —— 不要为了"丰富"而给角色安排这段时段。` : '';

  return `## 着装标注（额外要求）
这个角色在一天中会换衣服。可选服装如下：
${list}

请在生成日程时，为**每个时段**额外输出一个字段 \`outfit\`：
- 值为上面某套服装的**名称**（原样照抄，不要改写）。
- **只在「换装的那一刻」填写**，其余时段填 \`null\`（表示沿用上一段的穿着）。

### 一、先给每个时段判断「在自己住所内 / 在住所外」
- **住所内**＝这个角色自己的住处（卧室、浴室、客厅、厨房等）。
- **住所外**＝其余一切地方：街道、商店、胡同、车站、广场、公园、河岸、酒馆、学校、公司，
  以及**别人家**（哪怕在室内，也不是"在家"）。${zoneHintBlock}

### 二、以下 4 个时点**必须**标 outfit，一个都不能漏
1. **入睡** → 标"${sleepName || '睡衣'}"（睡眠时段的 outfit 必须是它）。
2. **睡醒起床** → 标一套白天的衣服。
3. **从住所出门**（去任何"住所外"的地方）→ 标一套**外出**的（常服或私服）。
4. **从外面回到住所** → 标"${exHome}"。${nudeBlock}

### 三、写完自检（逐时段过，发现矛盾就补标）
- 某个"住所外"的时段，穿的却是**居家服或睡衣** → ✗ 错。在这一段补标一套外出服。
  （唯一例外：明确写的是家门口的短暂活动，如"下楼取快递""楼下便利店"，可沿用。）
- 某个"住所内"的时段，穿的却是外出服 → ✗ 错。在这一段补标居家服。
- \`outfit\` 非 null 的时段**通常是 4~6 个**；一天里出门几次、回家几次，就要标几次。
  **不要为了凑少数几次，把"出门"或"回家"漏掉** —— 漏掉的后果是角色会穿着睡衣/居家服在街上活动。
- 反过来也别无理由频繁换装（同一地点、同一活动内不要反复换）。

- 可用作白天的服装：${dayNames}。

示例（仅示意 outfit 字段的密度与位置，实际按角色真实日程；注意"出门"与"回家"两处都有标注）：
{"startTime":"07:00","endTime":"07:30","activity":"晨间梳洗","location":"公寓浴室","replyDelay":0,"tags":["日常"],"description":"……","outfit":"${exHome}"}
{"startTime":"08:00","endTime":"12:00","activity":"上班","location":"公司","replyDelay":0,"tags":["工作"],"description":"……","outfit":"${exOut}"}
{"startTime":"12:00","endTime":"13:00","activity":"午休回公寓","location":"公寓客厅","replyDelay":0,"tags":["日常"],"description":"……","outfit":"${exHome}"}
{"startTime":"13:00","endTime":"18:00","activity":"继续上班","location":"公司","replyDelay":0,"tags":["工作"],"description":"……","outfit":"${exOut}"}
{"startTime":"19:00","endTime":"22:00","activity":"在家做饭休息","location":"公寓客厅","replyDelay":0,"tags":["日常"],"description":"……","outfit":"${exHome}"}
{"startTime":"22:00","endTime":"07:00","activity":"就寝","location":"公寓卧室","replyDelay":-1,"tags":["睡眠"],"description":"……","outfit":${hasSleep ? `"${sleepName}"` : 'null'}}`;
}

// ── 生成后校验 + 一次专注修复 ────────────────────────────────

/**
 * 校验日程的 outfit 标注，不达标就用一次**只做标注**的专注调用补回来。
 *
 * ── 为什么需要这道兜底（实测，2026-10-04）────────────────────
 * 提示词已明确要求「出门/回家必须标」，但 LLM 有波动：同一角色连跑两次，
 * 一次给了 6 个换装点（含「换装出门」「回家换装」），另一次只有 3 个
 * —— 漏掉出门那一次，角色就会**穿着居家服/睡衣在街上活动**（用户报的就是这个）。
 * 只靠提示词压不住，所以加一道确定性的「生成 → 校验 → 修复」。
 *
 * 修复之所以有效：让模型**只干一件事**（对着已有日程填 outfit）比它同时
 * 编日程又填标注要可靠得多，且这份 prompt 极小、很快。
 *
 * @param {Array} schedule 已解析通过的日程数组（不改原数组）
 * @param {number} characterId
 * @returns {Promise<{schedule: Array, repaired: boolean, reason: string}>}
 */
export async function ensureOutfitAnnotations(schedule, characterId) {
  const outfits = listSceneOutfits(characterId);
  if (outfits.length < 2 || !Array.isArray(schedule) || !schedule.length) {
    return { schedule, repaired: false, reason: 'no-outfits' };
  }
  const valid = new Set(outfits.map(o => o.name));

  // ── 校验 ──
  const marked = schedule.filter(a => a?.outfit).length;
  const illegal = schedule.filter(a => a?.outfit && !valid.has(String(a.outfit).trim()));

  /**
   * 阈值取「固定 4」而不是按地点切换次数推算。
   *
   * 曾试过 `transitions - 1`（地点段变了就大概要换装），但那个估算**过于激进**：
   * 「公寓卧室 → 公寓浴室」这种同住处的移动也会被算成一次切换，于是几乎每次都触发修复
   * —— 等于每次生成日程都白跑一次 LLM 调用（实测 3 轮全部触发）。
   *
   * 一天正常至少需要 4 个换装点（入睡 / 起床 / 出门 / 回家）；低于 4 才可疑。
   * 用户报的那个 case 正是 3 个 —— 能被抓住。而 6~9 个的正常日程不会再被误触发。
   */
  const floor = 4;

  const needsRepair = illegal.length > 0 || marked < floor;
  if (!needsRepair) return { schedule, repaired: false, reason: 'ok' };

  const reason = illegal.length
    ? `非法服装名 ${illegal.length} 处`
    : `换装点偏少（${marked} < ${floor}）`;
  console.log(`[outfitScene] 标注不合格（${reason}），发起一次专注修复`);

  // ── 修复：只输出与日程等长的 outfit 数组 ──
  const list = outfits.map(o => `- "${o.name}"（${LABEL_BY_KEY[o.scene] || o.scene}）`).join('\n');
  const sleepName = outfits.find(o => o.scene === 'sleep')?.name;
  const homeName = outfits.find(o => o.scene === 'home')?.name;
  const exOut = outfits.find(o => o.scene === 'work')?.name
    || outfits.find(o => o.scene === 'casual')?.name || outfits[0].name;
  const lines = schedule.map((a, i) =>
    `${i}. ${a.startTime}-${a.endTime}　${a.activity}　@${a.location || '（未写）'}`
    + `${Number(a.replyDelay) === -1 ? '　【睡眠】' : ''}`
  ).join('\n');

  const msgs = [
    { role: 'system', content: `你是着装校对员。下面是某角色一天的日程，请为**每个时段**判定该穿哪套衣服。

可选服装：
${list}

判定规则（逐时段过）：
1. 先判断该时段在「这个角色自己的住处内」还是「住所外」。
   住所内＝自己的卧室/浴室/客厅/厨房；住所外＝其余一切地方（街道、商店、车站、广场、公园、
   河岸、酒馆、学校、公司，以及**别人家**）。
2. 睡眠时段（标了【睡眠】的）→ 必须穿${sleepName ? ` "${sleepName}"` : '睡衣'}。
3. **住所外**的时段 → 必须穿外出服（工装或私服），**绝不能是居家服或睡衣**。
4. 回到自己住处 → 穿${homeName ? ` "${homeName}"` : '居家服'}。
5. **只在穿着发生变化的那一段**给出名字，没变化就填 null（表示沿用上一段）。
   出门、回家都是变化，都要给。

⚠ 只输出 JSON，格式严格如下（数组长度必须等于 ${schedule.length}，第 i 项对应上面第 i 条）：
{"outfits": ["${exOut}", null, "..."]}
不要输出任何解释或 JSON 以外的文字。` },
    { role: 'user', content: lines },
  ];

  let fixed = null;
  try {
    const raw = await chatSync(msgs, {
      temperature: 0.2, max_tokens: 900,
      response_format: { type: 'json_object' }, label: 'schedule-gen:着装校对',
    });
    const parsed = JSON.parse(String(raw || '')
      .replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim());
    const arr = Array.isArray(parsed?.outfits) ? parsed.outfits : null;
    // 只接受「长度对齐 + 名字全合法」的结果 —— 宁可保留原样，也不拿脏数据覆盖
    if (arr && arr.length === schedule.length
      && arr.every(v => v == null || valid.has(String(v).trim()))) {
      fixed = arr;
    } else {
      console.warn('[outfitScene] 修复结果不合格，保留原标注',
        arr ? `（长度 ${arr.length}≠${schedule.length}）` : '（无数组）');
    }
  } catch (err) {
    console.warn('[outfitScene] 修复调用失败，保留原标注:', err.message);
  }

  if (!fixed) return { schedule, repaired: false, reason: 'repair-failed' };

  const next = schedule.map((a, i) => ({ ...a, outfit: fixed[i] ? String(fixed[i]).trim() : null }));
  const newMarks = next.filter(a => a.outfit).length;
  console.log(`[outfitScene] 标注已修复：${marked} → ${newMarks} 个换装点`);
  return { schedule: next, repaired: true, reason };
}
