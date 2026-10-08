/**
 * 「修正外观」产出的整段文本 → **身体 / 服装** 的拆分。
 *
 * ── 为什么需要拆 ────────────────────────────────────────────
 * 外观产出格式由后端提示词约束为 `角色名 (作品名) has <身体特征>, wearing <服装>`，
 * 是一个**连续完整**的句子。但「外观」在库里是**身体（五套共用）+ 每套各自的衣服**
 * 两层，若整段塞进某一套的 description：① 其余四套拿不到身体；
 * ② 与该角色已有的 body 打架。所以必须在应用时拆开。
 *
 * ── ★★ 2026-10-07 修复：身份前缀必须保留（用户实报）──────────
 * 旧实现用 `^[^,]{0,70}?\bhas\s+` 把开头整段**直接删掉**，于是
 * `Stelle (Honkai: Star Rail) has short choppy silver-grey hair, ...`
 * 拆出来只剩 `short choppy silver-grey hair, ...` —— **`Stelle (Honkai: Star Rail)`
 * 这个"角色 TAG"被丢了**，生图时角色识别不了，长相与原设定不一致。
 *
 * 现在改为：前缀里的「角色名 (作品名)」**保留**，只把连接动词 `has` 去掉
 * （`body` 是逗号分隔短语列，不能留完整句子结构）。
 * 身份仍按原顺序排在 body 最前 —— 生图提示词里角色名靠前权重更高。
 *
 * ⚠ 另一个必须保住的不变量：body **不得以身份前缀开头且带 `has`**。
 *   后端 `mediaService.buildSubjectRef` 取 `body.split(',')[0]` 并要求其中含 `hair`
 *   才会产出 `the girl with ...`；若首段是 `Stelle (Honkai: Star Rail) has short ...`
 *   会拼出「the girl with Stelle (Honkai: Star Rail) has short ...」这种病句。
 *   （该函数已同步加固，两侧都有测试。）
 */

/**
 * ── ★★ 2026-10-08 修复：身体特征被误判为服装（用户实报「乔瓦尼」）──────
 * 用户用参考图修正「全身」，点「应用到「身体」并保存」后**身体没被覆盖**。
 *
 * 实测乔瓦尼那条文本（来自模型）：
 * ```
 * Giovanni (Honkai: Star Rail) has pale silvery-lavender hair ...,
 * a pale complexion, and wears a striking mask covering the face,
 * the left side of the mask in deep crimson red, ...
 * ```
 * 这里存在**两层误判**，且结果都是静默的：
 *   ① `mask` 在 CLOTHING_HINT 里 → 面具被当成「一件衣服」从 body 里剥走；
 *   ② 更糟的是拆点取在 `wears` 处 —— 于是**面具整段（含脸部特征）被判成 garment**，
 *      该角色的「面具/脸」在身体里彻底消失（而它正是这个角色最有辨识度的身体特征）。
 *   ③ 若模型恰好写成没有 `wearing/wears` 的形式（如「..., a striking mask covering the face」），
 *      且该段同时含 `hair` 与 `mask`（BODY_HINT 与 CLOTHING_HINT 都命中），
 *      会落到最后的 fallback → 但若前缀与特征被切成 body=''，回写端 `if (body)` 不成立
 *      → **整个回写被静默跳过**，用户看到的就是"点了没反应/没覆盖"。
 *
 * 修复口径：
 *   · `mask`（及同类**长在脸上/身上的固定饰物**：veil 面纱、wings 翼、halo 光环、
 *     tail 尾、horns 角、ears 耳）**不属于可换服装**，归身体；
 *   · 「被拆成 garment 的那半边」若明显仍在描述脸/身体（含 hair/face/eyes/mask…），
 *     说明拆点切错了 → 退回"整段当身体"，宁可衣服稍多，也不许身体缺件。
 */

// ⚠ 可换的**衣物**（脱下就该消失的东西）。判据要窄：只收真正的穿着物。
const CLOTHING_HINT = /\b(dress|skirt|pants|trousers|shirt|blouse|jacket|coat|hoodie|sweater|cardigan|kimono|yukata|robe|shorts|jeans|stockings?|socks?|shoes?|boots?|slippers?|heels?|gloves?|bra|panties|camisole|nightgown|blazer|uniform|apron|sash|obi|scarf|hat|beret|headwear|choker|necklace|earrings?|goggles|armor|suit|vest|waistcoat|cravat|tie|cloak|cape|shawl)\b/i
// ⚠ 身体/长相特征 —— 含**长在身上、不可脱下**的部件与固定饰物。
const BODY_HINT = /\b(hair|eyes?|skin|build|figure|height|complexion|tail|ears?|horns?|wings?|halo|mask|veil|face|features|blush|freckles?|scar|tattoo|markings?|bangs|braid|ponytail|twintails?|fangs|antennae?)\b/i

/**
 * 一半文本是否"明显在讲脸/身体"。
 * 用于识别「wearing 拆点切错」——拆出来的所谓"服装"其实还在描述长相。
 */
const FACE_OR_BODY_SIGNAL = /\b(hair|face|eyes?|complexion|skin|mask|veil|bangs|blush|freckles?|scar|tattoo|markings?|horns?|ears?|wings?|halo)\b/i

/**
 * 从外观段开头取出「角色名 (作品名)」身份前缀（保留原文写法），并返回剩余正文。
 *
 * 与后端 `extractAppearanceIdentityCorpus` 同源语义（都认「角色名 (作品名)」这一形态），
 * 但这里要的是**写进 body 的前缀本身**，而不是语料。
 *
 * 形态（按后端提示词约定）：`Stelle (Honkai: Star Rail) has ...` /
 * `Cyrene (Honkai: Star Rail) has ...`。也容忍没有作品名括号的裸名（原创角色）。
 *
 * @param {string} text
 * @returns {{ prefix: string, rest: string }} 无身份前缀时 prefix 为 ''
 */
export function extractIdentityPrefix(text) {
  const t = String(text || '').trim()
  if (!t) return { prefix: '', rest: '' }
  // 「角色名 (作品名)」——作品名括号内容允许含空格与冒号（如 Honkai: Star Rail）
  const m = t.match(/^([^,()]{1,60}?)\s*\(([^()]{1,60})\)\s*(?:has|have|is|with)?\s*[,]?\s*/i)
  if (m) {
    const prefix = `${m[1].trim()} (${m[2].trim()})`
    return { prefix, rest: t.slice(m[0].length).trim() }
  }
  // 裸名 + has（原创角色，无作品名）
  const m2 = t.match(/^([^,]{1,60}?)\s+has\s+/i)
  if (m2) {
    const name = m2[1].trim()
    // 只有当第一段确实像"名字"而不是特征短语时才当身份（否则会把 hair 短语误当前缀）
    if (!BODY_HINT.test(name) && !CLOTHING_HINT.test(name)) {
      return { prefix: name, rest: t.slice(m2[0].length).trim() }
    }
  }
  return { prefix: '', rest: t }
}

/**
 * 拆成「身体 / 服装」两部分。
 *
 * 返回的 `body` **保留身份前缀**（`Stelle (Honkai: Star Rail), <身体特征>`），
 * `garment` 只含服装。判不出服装时 `garment` 为 ''（调用方据此保留原描述）。
 *
 * @param {string} text
 * @returns {{ body: string, garment: string, identity: string }}
 */
export function splitBodyGarment(text) {
  const raw = String(text || '').trim()
  if (!raw) return { body: '', garment: '', identity: '' }

  // ① 取出身份前缀（★ 保留，不再丢弃）
  const { prefix, rest } = extractIdentityPrefix(raw)
  const t = rest

  // ② 按 wearing 拆点（提示词固定的连接词）
  // ⚠ 逗号后可能没有空格 —— 实测后端产出过 `fair skin,wearing a ...`，
  //   所以这里是 `[,;]?\s*` 而不是 `\s+`。
  const m = t.match(/^(.*?)[,;]?\s*\b(?:wearing|wears|dressed in)\s+(.*)$/i)
  if (m) {
    const left = m[1].replace(/[,\s]+$/, '').trim()
    const right = m[2].replace(/^[,\s]+/, '').trim()
    const body = joinIdentity(prefix, left)
    /**
     * ★★ 拆点校验（2026-10-08 修）：右半边若**明显还在讲脸/身体**，说明这个
     * `wearing` 不是"身体/衣服"的分界（乔瓦尼的「面具」就长这样 ——
     * `... a pale complexion, and wears a striking mask covering the face, ...`），
     * 此时把整段当身体，**绝不把它从身体里切走**。
     *
     * 判据：右侧命中 FACE_OR_BODY_SIGNAL，且左侧**没有任何可换衣物** ——
     * 左右侧都像衣服时才走正常拆分（如 `... hair, eyes, wearing a white shirt`）。
     */
    if (FACE_OR_BODY_SIGNAL.test(right) && !CLOTHING_HINT.test(left)) {
      return { body: joinIdentity(prefix, t), garment: '', identity: prefix }
    }
    // 「wearing no clothing / nothing」这类 = 没穿衣服，右半边不算服装
    if (/^(n(o|othing)|no clothing|nothing)\b/i.test(right)) return { body, garment: '', identity: prefix }
    return { body, garment: right, identity: prefix }
  }

  // ③ 没有 wearing：判断这段是身体还是衣服
  // ★★ 2026-10-08 修：**只要出现身体特征，就归身体**（不再要求"同时不出现衣物词"）。
  //   旧判据 `BODY_HINT && !CLOTHING_HINT` 在同段既有长相又有衣物时（模型未按
  //   `, wearing ` 格式输出时很常见）会落到「只有衣服」那条 → body 变空 →
  //   回写端 `if (body)` 不成立 → **用户点了「应用」却什么都没发生**（静默失败）。
  //   按本文件既有原则「身体缺失的代价更大」，这里一律优先保身体。
  if (BODY_HINT.test(t)) return { body: joinIdentity(prefix, t), garment: '', identity: prefix }
  if (CLOTHING_HINT.test(t)) {
    // 只有衣服、没有身体特征：前缀仍归身体（否则身份会随衣服丢掉）
    return { body: prefix, garment: t, identity: prefix }
  }
  // ④ 都判不出来 → 当身体（身体缺失的代价更大：五套都会丢身体）
  return { body: joinIdentity(prefix, t), garment: '', identity: prefix }
}

/** 把身份前缀拼回身体描述开头（逗号分隔，不带 has/is 这类动词） */
function joinIdentity(prefix, features) {
  /**
   * ★ 2026-10-08：清掉拆分残留的连接词与动词。
   *
   * 两类残留，都会让后端 `buildSubjectRef`（取首段拼 `the girl with ...`）
   * 或注入文本产出病句：
   *   · 尾部孤立的 `and` / `with` / `plus`（拆点切在连接词前时留下）；
   *   · **中段夹着的连接动词** `and wears` / `and has` / `wears` / `has`
   *     —— 见乔瓦尼那条（`... a pale complexion, and wears a striking mask ...`）。
   * body 是**逗号分隔的短语列**，不该出现任何句子连接成分。
   */
  const f = String(features || '')
    .trim()
    .replace(/^[,\s]+/, '')
    .replace(/[,\s]+(?:and|with|plus)\s*$/i, '')            // 尾部孤立连接词
    .replace(/,?\s*\band\s+(?:wears?|has|have|is|are)\s+/gi, ', ')  // 中段 "and wears/has"
    .replace(/^\s*(?:and\s+)?(?:wears?|has|have|is|are)\s+/i, '')   // 开头动词
    .replace(/\s*,\s*/g, ', ')                               // 归一逗号
    .replace(/[,\s]+$/, '')
    .trim()
  if (!prefix) return f
  return f ? `${prefix}, ${f}` : prefix
}