/**
 * 记忆证据闸门 —— 逐字引文复算（T1，2026-10-07）。
 *
 * ── 为什么需要它（唯一能根治"AI 编造记忆"的机制）──────────────
 * 邻舍原有链路（`memoryExtractor.js` → `memoryRepository.applyMemoryActions`）只要求模型写
 * `reasoning:"只写支撑判断的对话依据"` —— **自由文本、写入前不复算**。
 * 于是模型说"用户喜欢咖啡"、而对话里从没提过咖啡，也会照存。
 *
 * 本模块抄的是「千千结」的核心机制：**不是"AI 说记住了什么"，而是"这句话在正文里第几次出现"**。
 * 写入前把每条证据的逐字引文拿回来源消息里**数出现次数**定位，对不上就拒收该条。
 *
 * ⚠ **默认关闭**（`FEATURE_MEMORY_EVIDENCE_GATE`）：关闭时不校验、不写证据列，
 *   行为与上线前逐字节一致（项目红线 4「默认不改行为」）。
 *
 * ── 与千千结的差异（有意为之，不是遗漏）────────────────────
 * · 千千结的宿主是 ST，正文在 `chat_metadata` / 楼层里；邻舍有 `raw_messages` 表，
 *   直接按 `evidence_msg_id` 取原文 —— 更简单可靠。
 * · 千千结「整图拒绝提交」；邻舍改为**逐条隔离**（好条目照存，坏条目丢弃并计数）
 *   —— 与本项目已有的 `isolate()` 取向一致，避免一条幻觉毁掉整批。
 */

// ⚠ 路径层级：本文件在 `src/services/memory/` 下，到 `src/db/index.js` 是**两层**回溯
//   （与同目录的 `memoryRepository.js` / `memoryConfig.js` 保持一致）。
//   写成三层会解析到 `agent-core/db/index.js`（不存在）→ ERR_MODULE_NOT_FOUND（实测踩过）。
import { getDb } from '../../db/index.js';

/**
 * 特征开关 —— 读环境变量。
 *
 * ⚠ 与项目其它长驻功能一致：**默认关闭**。改默认值须三处同步
 *   （此处 env / 若将来进 config 的 seedData / 前端兜底）。
 */
export function isMemoryEvidenceGateEnabled() {
  const v = process.env.FEATURE_MEMORY_EVIDENCE_GATE;
  return v === '1' || v === 'true' || v === 'on';
}

/**
 * 归一化引文用于比对。
 *
 * ⚠ **只做"无害归一"，不改语义**：
 *   · 全角/半角标点、空白差异不应当导致误判（模型抄写时常把「，」写成","）；
 *   · 但**不能**做"模糊匹配"（如删词、取子串）—— 那就失去"逐字"的意义了。
 *
 * @param {string} s
 * @returns {string} 归一化后的文本（仅用于比对，不落库）
 */
export function normalizeQuoteForMatch(s) {
  return String(s ?? '')
    .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)) // 全角→半角
    .replace(/[\u3000\s]+/g, ' ')       // 全角空格与各类空白归一
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[—–―─]/g, '-')
    .replace(/[…]+/g, '...')
    .trim();
}

/**
 * 在原文里数 `quote` 出现了多少次，并判断第 `occurrence` 次是否存在。
 *
 * ★★ 这是整套机制的心脏 —— 判据是**逐字**出现，不是"语义相近"。
 *
 * ⚠ 用 `indexOf` 循环推进（而不是正则）：
 *   · 引文里可能含正则元字符（`(`, `[`, `*`, `?` …），构造正则要先转义、易错；
 *   · 重叠匹配要显式处理（"aaa" 里 "aa" 出现 2 次），`indexOf` 步进 1 位即可。
 *
 * @param {string} rawText 来源原文
 * @param {string} quote 逐字引文
 * @param {number} occurrence 期望是第几次出现（从 1 起）
 * @returns {{ok:boolean, total:number, at:number}} ok=第 occurrence 次确实存在；total=完整出现次数
 */
export function countQuoteOccurrence(rawText, quote, occurrence = 1) {
  const hay = normalizeQuoteForMatch(rawText);
  const needle = normalizeQuoteForMatch(quote);
  if (!needle) return { ok: false, total: 0, at: -1 };
  const want = Number.isInteger(Number(occurrence)) && Number(occurrence) >= 1 ? Number(occurrence) : 1;
  let from = 0, seen = 0, at = -1;
  while (true) {
    const i = hay.indexOf(needle, from);
    if (i === -1) break;                 // ⚠ 必须数完全部才停（不要命中即 return）
    seen++;
    if (seen === want) at = i;           // 记下目标位置，但**继续数完**
    from = i + 1;   // 步进 1 位以支持重叠匹配
  }
  return { ok: at >= 0, total: seen, at };
}

/**
 * 校验一条记忆的证据是否成立。
 *
 * ★★ 关键设计决定（2026-10-07）：**不要求模型给出消息 id，由代码自行定位。**
 *
 * 理由：`chat_log` 是**两个 LLM 调用共享的缓存前缀块**（`chatLogPrompt.js` 明写
 * "两个调用必须逐字节一致"）。若为了塞 id 去改它的行格式（如 `[id|user] ...`），
 * 会让**所有历史缓存前缀失效**、并打破"两处逐字节一致"的约定。
 * 而"这句话在哪条消息里"本就是个**确定性的搜索问题** —— 代码比模型靠谱得多。
 *
 * 所以流程是：模型给**逐字引文** → 代码在**本批次消息窗口内**逐条搜索定位 →
 * 找不到即拒收该条。模型只需"抄准"，不需要"指对"。
 *
 * @param {string} quote 逐字引文
 * @param {number} occurrence 第几次出现（默认 1）
 * @param {Array<{id:number,content:string}>} windowMessages 本批次的消息窗口（**必须限定范围**）
 * @returns {{ok:boolean, reason?:string, msgId?:number, total?:number}}
 */
export function verifyQuoteInWindow(quote, occurrence = 1, windowMessages = []) {
  const q = String(quote || '').trim();
  if (!q) return { ok: false, reason: 'missing-evidence-text' };
  // 引文过长：多半是模型把整段对话抄进来了，不算"逐字锚点"。上限 2000 与千千结一致。
  if (q.length > 2000) return { ok: false, reason: 'evidence-too-long' };

  const want = Number.isInteger(Number(occurrence)) && Number(occurrence) >= 1 ? Number(occurrence) : 1;
  let best = null;   // 命中窗口内**最早**的那条（多条都含引文时取第一条，与"第 N 次出现"跨消息累计的口径一致）
  let acc = 0;
  for (const m of windowMessages || []) {
    const r = countQuoteOccurrence(m?.content, q, 1);
    if (r.total <= 0) continue;
    if (!best) best = { msgId: Number(m.id), firstAt: acc + 1 };
    acc += r.total;
    if (acc >= want) {
      return { ok: true, msgId: best.msgId, total: acc };
    }
  }
  if (!best) return { ok: false, reason: 'quote-not-found', total: 0 };
  return { ok: false, reason: 'occurrence-out-of-range', total: acc, msgId: best.msgId };
}

/**
 * 兼容旧签名：按 `evidenceMsgId` 精确取原文校验（用于"模型确实给了 id"的场合）。
 *
 * @param {{evidenceMsgId:number|string, evidenceText:string, evidenceCount?:number}} ev
 * @returns {{ok:boolean, reason?:string, total?:number}}
 */
export function verifyEvidence(ev) {
  const msgId = Number(ev?.evidenceMsgId);
  if (!Number.isFinite(msgId) || msgId <= 0) return { ok: false, reason: 'missing-evidence-msg' };
  const quote = String(ev?.evidenceText || '').trim();
  if (!quote) return { ok: false, reason: 'missing-evidence-text' };
  if (quote.length > 2000) return { ok: false, reason: 'evidence-too-long' };

  let row;
  try {
    row = getDb().prepare('SELECT content FROM raw_messages WHERE id = ?').get(msgId);
  } catch { return { ok: false, reason: 'db-error' }; }
  if (!row) return { ok: false, reason: 'evidence-msg-not-found' };

  const r = countQuoteOccurrence(row.content, quote, Number(ev?.evidenceCount) || 1);
  if (!r.ok) return { ok: false, reason: 'quote-not-found', total: r.total };
  if (Number(ev?.evidenceCount) > r.total) return { ok: false, reason: 'occurrence-out-of-range', total: r.total };
  return { ok: true, total: r.total };
}

/**
 * 批量隔离：把 actions 里证据不成立的条目剔除，返回可用条目与隔离记录。
 *
 * ★ 与千千结的「整图拒绝」不同，这里**逐条隔离**：
 *   一条幻觉不该毁掉同批次里其它正确的记忆（本项目既有取向，见 `isolate()` 的注释）。
 *
 * @param {Array} actions 模型产出的记忆动作
 * @param {Array<{id:number,content:string}>} windowMessages 本批次消息窗口
 * @returns {{accepted:Array, isolated:Array<{judgment:string,reason:string}>}}
 */
export function isolateUnverifiedActions(actions = [], windowMessages = []) {
  const accepted = [], isolated = [];
  for (const a of actions) {
    const m = a?.memory || {};
    const quote = String(m.evidenceText ?? m.evidence_text ?? '').trim();
    const count = Number(m.evidenceCount ?? m.evidence_count) || 1;
    const v = verifyQuoteInWindow(quote, count, windowMessages);
    if (v.ok) {
      accepted.push({
        ...a,
        _evidence: { verified: 1, text: quote, count, msgId: v.msgId ?? null },
      });
    } else {
      isolated.push({ judgment: String(m.judgment || ''), reason: v.reason || 'unknown' });
    }
  }
  return { accepted, isolated };
}