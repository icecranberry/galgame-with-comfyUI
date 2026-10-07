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

const CLOTHING_HINT = /\b(dress|skirt|pants|trousers|shirt|blouse|jacket|coat|hoodie|sweater|cardigan|kimono|yukata|robe|shorts|jeans|stockings?|socks?|shoes?|boots?|slippers?|heels?|gloves?|bra|panties|camisole|nightgown|blazer|uniform|apron|sash|obi|scarf|hat|beret|headwear|choker|necklace|earrings?|goggles|mask|armor|suit)\b/i
const BODY_HINT = /\b(hair|eyes?|skin|build|figure|height|complexion|tail|ears?|horns?)\b/i

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
    // 「wearing no clothing / nothing」这类 = 没穿衣服，右半边不算服装
    if (/^(n(o|othing)|no clothing|nothing)\b/i.test(right)) return { body, garment: '', identity: prefix }
    return { body, garment: right, identity: prefix }
  }

  // ③ 没有 wearing：判断这段是身体还是衣服
  const looksBody = BODY_HINT.test(t) && !CLOTHING_HINT.test(t)
  if (looksBody) return { body: joinIdentity(prefix, t), garment: '', identity: prefix }
  if (CLOTHING_HINT.test(t)) {
    // 只有衣服、没有身体特征：前缀仍归身体（否则身份会随衣服丢掉）
    return { body: prefix, garment: t, identity: prefix }
  }
  // ④ 都判不出来 → 当身体（身体缺失的代价更大：五套都会丢身体）
  return { body: joinIdentity(prefix, t), garment: '', identity: prefix }
}

/** 把身份前缀拼回身体描述开头（逗号分隔，不带 has/is 这类动词） */
function joinIdentity(prefix, features) {
  const f = String(features || '').trim().replace(/^[,\s]+/, '')
  if (!prefix) return f
  return f ? `${prefix}, ${f}` : prefix
}