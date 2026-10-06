/**
 * 日程生成器
 *
 * 基于角色人格 + 职业生成每日时间表（schedule template）。
 * LLM 输出 8-15 个活动的 JSON 数组，覆盖完整 24 小时。
 *
 * 生成时机（分散式）：
 *   - 角色创建时：立即生成 + 分配随机刷新时间
 *   - 每日刷新：replyQueueScheduler 每次 tick 检查是否有角色到期，每次只刷 1 个
 *   - 手动强制：API POST /api/schedule/:id/regenerate
 */

import { getDb, getWorldSetting, getSystemRules } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { config } from '../config.js';
import { getLocalDateKey, shiftDateKey } from '../utils/localDate.js';
import { getWorldIntegrationRule } from '../builtinRules.js';
import { reapplyActiveEventSchedule } from './eventSchedule.js';
import { buildOutfitAnnotateLayer, ensureOutfitAnnotations } from './outfitScene.js';

/**
 * 该角色是否**禁止日程**。
 *
 * 归档 = 不参与任何主动行为（主动聊天 / 朋友圈 / 奇遇 / 拉群 / 小镇奇遇），
 * **日程也在其列** —— 归档角色不该再花 token 生成或重建日程。
 *
 * ── 为什么需要一个独立判据（而不是让调用方各自叠加 SQL 条件）──
 * 拒绝改写 `schedule_enabled` 是有道理的（见 routes/characters.js 的归档注释：
 * 不改四个细分开关，否则"归档再取消"会把用户单独设过的偏好一起抹掉）。
 * 代价是各处选人要**自己**叠加 `archived = 0`，结果就漏了 —— 实测现状：
 *   · replyQueueScheduler 的选人查询有过滤 ✅
 *   · POST /schedule/regenerate-all 有过滤 ✅
 *   · ★ 但 `snapshotTodaySchedule()` 与 `getTodayScheduleRaw()` 的 fallback **完全没有**
 *     → 归档角色 51 个，`daily_schedules` 每天仍被重建 51 条（实测 10-05 仍有 51 条，
 *       而它们的模板早在 10-03 就停止更新了 —— 说明"钱没再花在生成上，
 *       但快照仍在被无意义地重建"，日程页/概览里也照旧列着它们）。
 *
 * 所以判据收口到这里一处，两个入口统一调用。查库失败时返回 false（不拦），
 * 避免一次瞬时读失败就把角色永久挡在日程之外。
 */
export function isScheduleForbidden(characterId) {
  try {
    const row = getDb().prepare('SELECT COALESCE(archived, 0) AS archived FROM characters WHERE id = ?').get(characterId);
    return !!row?.archived;
  } catch { return false; }
}

/**
 * 截取角色人格 prompt：从开头到 "##你的外观" 之前
 */
function cropPersonaForSchedule(basePrompt) {
  if (!basePrompt) return '一个普通角色，没有特殊设定';
  const idx = basePrompt.search(/##\s*你的外观/);
  return idx > -1 ? basePrompt.slice(0, idx).trim() : basePrompt.slice(0, 800);
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map(tag => String(tag).trim()).filter(Boolean);
  if (typeof tags === 'string') {
    const trimmed = tags.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) || typeof parsed === 'string') return normalizeTags(parsed);
    } catch {}
    return trimmed.split(/[,，、\n]/).map(tag => tag.trim()).filter(Boolean);
  }
  return [];
}

// ═══════════════════════════════════════════════════════════
// 本次编排约束（日程弹窗的高级选项）
//
// 设计要点：**不修改 scheduleInst 那个跨角色共享的常量**（它吃 LLM 前缀缓存），
// 而是在人格之后单独加一层 system 消息。所有选项都不传时本层不出现，
// 行为与「没有这个功能」逐字节一致 —— 默认值即「不改行为」。
// ═══════════════════════════════════════════════════════════

/**
 * NSFW 强度档（滑块 0/25/50/75/100 五档）。
 * ⚠ `at:50` 必须与 scheduleInst 里写死的「性 3~5 个（≥2 实质）」保持一致 ——
 *    这样「不动滑块」就等于保持现状，不会悄悄改变既有行为。
 */
export const NSFW_BANDS = [
  { at: 0, label: '关闭', sexCount: 0, explicitMin: 0, explicitMax: 0, hint: '本次日程完全不含性内容' },
  { at: 25, label: '少量', sexCount: '1~2', explicitMin: 0, explicitMax: 1, hint: '点到为止，不刻意安排' },
  {
    at: 50, label: '标准', sexCount: '3~5', explicitMin: 0, explicitMax: 2, hint: '与当前默认一致',
    // ★ explicitFloor：**文案下限**，与上面「区间」是两回事，别合并。
    //   用户口径的区间是 0~2，但 scheduleInst 里写死的是「性 3~5（其中 ≥2 个是实质行为）」。
    //   若这里按区间拼成「0~2 个」，模型会以为下限是 0 而降低密度 ——「不动滑块」就改变了既有行为。
    //   有 explicitFloor 时拼「≥ N」，没有时拼「min~max」。见 buildScheduleConstraintBlock。
    explicitFloor: 2,
  },
  { at: 75, label: '密集', sexCount: '6~8', explicitMin: 1, explicitMax: 3, hint: '一天里以性为主线之一' },
  { at: 100, label: '极高', sexCount: '9~11', explicitMin: 2, explicitMax: 5, hint: '几乎每个时段都带性' },
];

/**
 * 档位的「实质行为」文案。**有 explicitFloor 就只写下限**（兼容 scheduleInst 原文），
 * 否则写区间。抽成函数是为了让「档位只有一份定义」这条不破在文案拼装上。
 */
export function explicitTextOf(band) {
  if (!band) return '';
  if (Number.isFinite(band.explicitFloor)) return `≥ ${band.explicitFloor}`;
  return `${band.explicitMin}~${band.explicitMax}`;
}

/** 睡眠类型（与 scheduleInst「睡眠时间」一节列出的档位逐字对应；改一边必须改另一边） */
export const SLEEP_TYPES = {
  auto: { label: '自动（按角色职业与作息设定）', text: '' },
  early: { label: '早睡早起型', text: '晚上 9-11 点睡，早上 5-7 点起' },
  standard: { label: '标准作息型', text: '晚上 11 点-次日 0 点睡，早上 7-8 点起' },
  late: { label: '晚睡型', text: '次日 0-1 点睡，早上 8-9 点起' },
  stay_up: { label: '熬夜型', text: '凌晨 1-4 点睡，上午 9-12 点起' },
  overnight: { label: '通宵型', text: '凌晨 4 点-天亮才睡，中午 12 点-下午 2 点起' },
  night_shift: { label: '昼伏夜出型', text: '早上 6-8 点睡，下午 14-16 点起' },
  fragmented: { label: '碎片化睡眠', text: '分两段睡（如晚上睡 4h + 下午补觉 3h）' },
  // ★ 不睡眠型：仅限设定上"不需要睡眠"的存在（智械/机器人/人造人/能量体）。
  //   选它时全天无睡眠 block —— 校验逻辑据此放行（见 validateSchedule 的 noSleep 分支）。
  none: { label: '不睡眠（智械/机器人等）', text: '全天不安排睡眠 block（replyDelay 全为 0）' },
};

/** 数值取最接近的一档；非数字返回 null（= 不指定，不加约束层） */
export function nsfwBandOf(ratio) {
  // ⚠ 必须显式挡掉 null / '' / 布尔：Number(null)===0、Number('')===0 会被误判成「关闭」档，
  //   而「没传」和「用户明确选了关闭」是两回事。
  if (ratio === null || ratio === undefined || ratio === '' || typeof ratio === 'boolean') return null;
  const n = Number(ratio);
  if (!Number.isFinite(n)) return null;
  const clamped = Math.max(0, Math.min(100, n));
  let best = NSFW_BANDS[0];
  let bestD = Infinity;
  for (const b of NSFW_BANDS) {
    const d = Math.abs(b.at - clamped);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

/**
 * 把「本次选中地点的 zone」整理成着装层可用的三组地名。
 *
 * ⚠ 只取**用户本次勾选的区域**里的地点 —— 没勾区域时不带 zone（保持旧行为，
 *   着装层仍按"居所内/外"自行判断），这是「默认不改行为」的落实点。
 *
 * 注意 `private_transit` 归到「私密空间」那一组，而不是住所内 —— 浴室被标成
 * private_transit 时，模型会知道那是唯一该用"全身"的地方。
 */
function buildOutfitZoneHints(options = {}) {
  const placeZones = options.placeZonesByArea || {};
  const areas = Array.isArray(options.areas) ? options.areas : [];
  if (!areas.length || !Object.keys(placeZones).length) return {};
  const residencePlaces = [], activityPlaces = [], privatePlaces = [];
  for (const a of areas) {
    for (const p of (placeZones[a] || [])) {
      if (!p?.name) continue;
      // ⚠ 逐点映射，**不是整区一刀切** —— 同一子区里可能既有住宅又有商店
      if (p.zone === 'residence') residencePlaces.push(p.name);
      else if (p.zone === 'private_transit') privatePlaces.push(p.name);
      else if (p.zone === 'activity') activityPlaces.push(p.name);
    }
  }
  const dedupe = (arr) => [...new Set(arr)];
  return {
    residencePlaces: dedupe(residencePlaces),
    activityPlaces: dedupe(activityPlaces),
    privatePlaces: dedupe(privatePlaces),
  };
}

/**
 * 组装「本次编排约束」块。返回 null 表示本次没有任何约束（调用方不要 push 空消息）。
 *
 * @param {object} opts
 * @param {string[]} [opts.areas]        主要活动区域（世界地图的「子区」名）
 * @param {boolean} [opts.areaStrict]    区域是否硬约束
 * @param {Record<string,string[]>} [opts.scenesByArea] 各区域下的真实地点名（已按准入过滤）
 * @param {Record<string,Array<{name,note}>>} [opts.notesByArea]  需标注准入原因的地点
 * @param {Record<string,Array<{name,prompt}>>} [opts.promptsByArea] 地点的场景提示词
 * @param {Record<string,string[]>} [opts.zonesByArea]  各区域出现过的 zone（供服装联动）
 * @param {Array<{name,area,note}>} [opts.forcedPlaces] 被用户显式放行的受限地点
 * @param {Array<{name,area,note}>} [opts.accessNotes] 全图受限地点（准入禁令清单）
 * @param {number} [opts.nsfwRatio]      0~100
 * @param {string} [opts.sleepType]      SLEEP_TYPES 的键
 * @returns {string|null}
 */
/**
 * 每个区域最多给几条「画面行」—— 随勾选区域数递减（用户裁定 D1）。
 *
 * 背景：画面行只来自勾选区域（这点本来就对），但**勾满 14 区**时
 * 78 条画面行 ≈ 1.9 万字符（≈1.26 万 token），在「黄金注意力 ~80K」下开销过大。
 * 这里按区域数给一个**总配额**并均摊：勾得越多，每区展开的越少。
 *
 * ⚠ 简介行（`summary`）**不受配额限制** —— 它是"反八股"的核心素材且很短；
 *   被裁的只是**长英文画面描述**，且裁掉后仍会列出地名（模型知道有这个地点）。
 */
export function scenePromptCap(areaCount) {
  const n = Math.max(1, Number(areaCount) || 1);
  if (n <= 2) return 8;    // 少量区域：尽量给全（单区实测 6~8 条）
  if (n <= 4) return 5;
  if (n <= 8) return 3;
  return 2;                // 勾满时每区 2 条，总量约 28 条 ≈ 0.5 万字符
}

export function buildScheduleConstraintBlock(opts = {}) {
  const parts = [];

  // ── 准入禁令（问题 2 的完整落点）──
  //
  // 为什么单独成段、且**不依赖 areas**：用户不勾任何区域时，上文那段硬编码散文
  // （`不写进去的地方：珠星总部、海原电视塔…`）仍然是唯一依据 —— 而它在地图数据
  // 之外，改地图不会改它。这里把地图里**真实标注过**的受限地点列出来，就补上了
  // 「改地图即生效」这条链路。
  //
  // ⚠ 只在真的有标注时才出现：地图里没标注过任何 access 时本段不生成，
  //    于是 `buildScheduleConstraintBlock()` 仍然返回 null ——「默认不改行为」不破。
  const accessNotes = Array.isArray(opts.accessNotes) ? opts.accessNotes.filter(n => n?.name) : [];
  const areas0 = Array.isArray(opts.areas) ? opts.areas.map(a => String(a || '').trim()).filter(Boolean) : [];
  if (accessNotes.length) {
    const lines = accessNotes.map(n => `- ${n.area ? `${n.area} · ` : ''}${n.name}：**${n.note || '仅限特定对象'}**`);
    parts.push(`【准入禁令（本次由地图数据给定，优先于上文那一段列举）】

下列地点**不是随便能去的**，本次日程里出现它们时必须带上限制语，且不要安排不合身份的角色前往：
${lines.join('\n')}

若与上文「不写进去的地方」那一段有出入，**以本条为准**（地图数据是最新的）。`);
  }

  // ── 主要活动区域 ──
  const areas = Array.isArray(opts.areas) ? opts.areas.map(a => String(a || '').trim()).filter(Boolean) : [];
  if (areas.length) {
    const lines = [];
    lines.push(`角色的日常活动主要发生在：${areas.join('、')}。`);
    const scenesByArea = opts.scenesByArea || {};
    const masks = opts.promptsByArea || {};
    const notes = opts.notesByArea || {};
    const summaries = opts.summariesByArea || {};
    const sceneLines = [];
    let withSummary = 0;
    for (const a of areas) {
      const sc = Array.isArray(scenesByArea[a]) ? scenesByArea[a].filter(Boolean) : [];
      if (!sc.length) continue;
      // ★★ 地点简介 —— **八股现象的直接解药**（2026-10-05 用户实报）。
      //
      // 病根：过去这里只给一串**裸地名**（「鸽川大道、鸽川埠、鸽川河与滨河道…」），
      // 模型不知道这些地方长什么样，于是只能反复使用 <world_setting> 里**唯一被具体描写过**
      // 的那几个画面 —— "世界尽头酒馆总是黄金马桶"、"愿宝总要摆一下"就是这么来的：
      // 它没有别的素材可写，只能复读手边仅有的那点具体细节。
      //
      // 地图里**本来就有这些简介**（实测 lv3 78 个里 65 个有，且写得不错）。
      // 把它们一并给出，模型才有"可写的东西"，才不必复读。
      const sumOf = new Map((summaries[a] || []).map(s => [s.name, s.summary]));
      const promptOf = new Map((masks[a] || []).map(p => [p.name, p.prompt]));
      const plain = sc.filter(n => !promptOf.has(n) && !sumOf.has(n));
      if (plain.length) sceneLines.push(`- ${a}：${plain.join('、')}`);
      // ★★ 画面行**配额**（2026-10-06 用户裁定 D1：画面行只在勾选区域内给）。
      //
      //   现状：画面行本来就只来自**勾选区域**（`scenesByAreaFor` 按 names 循环），
      //   但用户勾满 14 个区时一行一地点 = 78 行、**约 1.9 万字符（≈1.26 万 token）**，
      //   在「黄金注意力 ~80K」的前提下这是笔大开销。
      //   裁减口径（用户选②）：**每个区域最多给 N 条画面行**，超出部分不再逐条展开 ——
      //   简介行（`summary`，短、是"反八股"的核心素材）**全部保留**，画面行（长英文）
      //   按区域配额截断。这样：勾得越多、每区配额越少，总量被压在可控范围。
      //
      //   ★ 注意：不要改成"只给第一个区域的画面行" —— 那会让其余区域退回"只有裸地名"，
      //     正是「世界尽头酒馆总是黄金马桶」的病根（简介与画面是两味药，删不得整味）。
      const promptCapPerArea = scenePromptCap(areas.length);
      let promptLeft = promptCapPerArea;
      for (const [n, sm] of sumOf) { withSummary++; sceneLines.push(`- ${a} · ${n}：${sm}`); }
      for (const [n, pr] of promptOf) {
        if (promptLeft > 0) {
          sceneLines.push(`- ${a} · ${n}（画面）：${pr}`);
          promptLeft--;
        }
      }
      if (promptOf.size > promptCapPerArea) {
        const rest = [...promptOf.keys()].slice(promptCapPerArea);
        // 被裁掉的**仍列出地名**（模型知道有这地方、可挑，只是没拿到画面细节）
        sceneLines.push(`- ${a}：${rest.join('、')}（以上地点另有画面细节，本次未展开）`);
      }
    }
    if (sceneLines.length) {
      lines.push(`这些区域里**真实存在**的地点（location 优先从这里面挑，不要自造地名）：\n${sceneLines.join('\n')}`);
    }
    // ★ 只在**真有简介**时才给「不要复读」这条：否则等于叫模型去用一份它没拿到的素材。
    if (withSummary >= 2) {
      lines.push(`上面对每个地点都给了它**自己**的样子。写 description 时请用**那个地点特有**的细节（店面、光线、陈设、声音、人物在该处的常态），
**不要把同一个画面反复用在不同的地方**。同一个地点这一天里出现两次以上时，也请换个角度写它（早上与深夜的样子不同）。`);
    }
    // 需要标注准入的例外（time_window / 用户显式放行的受限地点）：
    // 不给原因，模型只会当成普通地点随便安排。
    const noteLines = [];
    for (const a of areas) for (const n of (notes[a] || [])) noteLines.push(`- ${a} · ${n.name}：**${n.note}**`);
    for (const f of (opts.forcedPlaces || [])) noteLines.push(`- ${f.area || ''} · ${f.name}：**${f.note}**（本次用户已显式指定，可用）`);
    if (noteLines.length) {
      lines.push(`下列地点有**准入限制**，安排到它们时必须在 location 里带上限制语，且不要给不合适的角色安排：\n${noteLines.join('\n')}`);
    }
    lines.push(opts.areaStrict
      ? '**约束强度：硬约束。** 每个时段的 location 都必须落在上述区域内；通勤与过场也尽量在区域内部消化，不要跑出区域。'
      : '**约束强度：软约束。** 以上述区域为主（占全天时段的 2/3 以上），允许因剧情需要短暂离开。');
    lines.push('若上文「地点必须来自<world_setting>」一节里写有「不写进去的地方」，而本次指定的区域与其冲突，**以本条的本次指定为准**（用户显式指令优先）。');
    parts.push(`【主要活动区域（本次限定）】\n${lines.join('\n')}`);
  }

  // ── 区域通勤基线（问题 6）──
  //
  // 上文 `scheduleInst` 里只有一句**形容词**（「地点要顺路，不要反复横跳」），
  // 模型无法据此"计算" —— 它不知道二维市到鸽川区要走多久。这里把**后端算好的
  // 通勤分钟**直接给它，"顺路"就从形容词变成了可核验的约束。
  //
  // ⚠ 只在调用方真的传了通勤边时才出现（没落库的图行为与上线前一致）。
  const transit = Array.isArray(opts.transitEdges) ? opts.transitEdges.filter(e => e?.from_stop && e?.to_stop) : [];
  if (transit.length) {
    const byLine = new Map();
    for (const e of transit) {
      if (!byLine.has(e.line_id)) byLine.set(e.line_id, { name: e.line_name || '', segs: [] });
      byLine.get(e.line_id).segs.push(e);
    }
    const tl = [];
    for (const [lid, g] of byLine) {
      const items = g.segs.map(e => `${e.from_stop} → ${e.to_stop} 约 ${e.minutes} 分`);
      tl.push(`- ${lid} ${g.name}：${items.join(' · ')}`);
    }
    // 跨翼提示：两翼在图上不共享坐标系，只能查表 —— 让模型知道这条线的"长"是有依据的
    const hasWater = transit.some(e => e.mode === 'water');
    parts.push(`【区域通勤基线（后端已算好，不是实时路线；含进站/靠泊）】

${tl.join('\n')}
${hasWater ? '\n⚠ 水路线是**长线**：跨翼航段单程可占半天以上（例：海原站→渡画泉隐全程约 5.5 小时）。安排水路出行时，当天那一段前后不要再塞跨区活动。\n' : ''}
你的日程里**两段相邻活动的换场时间不得明显小于上表数值**。上一段在 A、下一段在 B 时，
中间要么留出通勤时间，要么**合并成同一段**（写成"在 A 收拾后前往 B"）。
不要出现"刚在城东吃完早饭、下一段立刻出现在城西"这种瞬移。`);
  }

  // ── 居住 / 活动分区 → 服装联动（问题 5）──
  //
  // 关键：**不要让模型自己推断"这是不是在家"**。过去 `buildOutfitAnnotateLayer`
  // 让模型按「住所内 / 住所外」自行判断，于是「别人家」「酒店」这类边界场景频繁判错。
  // 现在直接把选中地点的 zone 给它：zone=residence 的地方就是"住所内"，等价判定。
  const zones = opts.zonesByArea || {};
  const zoneSet = new Set();
  for (const a of areas) for (const z of (zones[a] || [])) zoneSet.add(z);
  if (zoneSet.size) {
    const zl = [];
    if (zoneSet.has('residence')) {
      zl.push('- 标记为**居住区域**的地点就是该角色的住所内部：在这些地点内的时段，着装按「住所内」处理（居家服 / 睡衣），不要标外出服。');
    }
    if (zoneSet.has('activity')) {
      zl.push('- 标记为**主要活动区域**的地点一律属于「住所外」，在其中的时段该穿常服或私服。');
    }
    if (zoneSet.has('private_transit')) {
      zl.push('- 标记为**私密空间（洗浴等）**的地点，是"全身"那一套唯一该出现的场合。');
    }
    if (zl.length) {
      parts.push(`【地点性质与着装（本次由数据给定，不要自行推断）】\n${zl.join('\n')}`);
    }
  }

  // ── 用户（人类侧）居住地 ──
  //
  // 为什么要给模型这条：日程里「回家」「去找你」「路过你家楼下」这类活动，
  // 如果模型不知道用户住哪，只能含糊写"公寓"，与用户真实选择的落点对不上。
  // ⚠ **用户没设就不出现**（空串 = 未指定，不猜、不编）。
  const userHome = String(opts.userHome || '').trim();
  if (userHome) {
    const userName = String(opts.userName || '用户').trim() || '用户';
    parts.push(`【${userName} 的住处（人类侧，地图里已指定）】

${userName} 住在「${userHome}」。日程里凡是涉及"回家 / 顺路经过 / 去找 Ta"的时段，
地点请用这个真实落点（可写成「${userHome}」或更具体的门牌/房间），**不要含糊写成"公寓"**。
注意这是**${userName} 的**住处，不是角色自己的家 —— 角色自己的住处另有其地。`);
  }

  // ── NSFW 强度 ──
  const band = nsfwBandOf(opts.nsfwRatio);
  if (band) {
    if (band.sexCount === 0) {
      parts.push(`【NSFW 强度：关闭（本次覆盖上文所有相关的下限要求）】

本次**不安排任何性时段**。上文中以下要求本次一律不适用，不得再执行：
- 「### 3. 一天里的性活动（每个角色都要有，总数 3~6 个）」
- 时段预算里的「性 3~5（其中 ≥2 个是实质行为）」
- 交付前自检第 1 条「性时段 ≥ 3 个，其中实质行为 ≥ 2 个」（本次按「性时段 = 0」判定为通过）

原本安排性时段的那些时段（洗澡、睡前、起床后、午休、换衣服等）改写成**普通的日常活动**；其余骨架（睡眠 / 进食 / 工作 / 通勤 / 社交娱乐）与「人类日常骨架」要求全部照常执行。`);
    } else {
      parts.push(`【NSFW 强度：${band.label}（本次覆盖上文的数量要求）】

本次性时段数量以本条为准：**${band.sexCount} 个**，其中角色亲自参与的**实质行为（性交／口交／自慰到出／多人）${explicitTextOf(band)} 个**。

上文中「总数 3~6 个」「性 3~5」以及自检第 1 条「性时段 ≥ 3 个」的数量要求，本次按本条的数值执行；**除数量之外的一切要求**（性活动必须能从角色处境推出来、严禁照抄 <world_setting> 例句、禁止「别人在做她只是看着」、用词口径）**全部照常适用**。`);
    }
  }

  // ── 睡眠类型 ──
  const sleep = SLEEP_TYPES[opts.sleepType];
  if (sleep && sleep.text) {
    parts.push(`【睡眠类型（本次固定）】

本次就寝与起床时间固定为**${sleep.label}**：${sleep.text}。
上文的「睡眠时间个性化」一节本次不适用（不要按角色气质另外挑一种）；但**睡眠 block 的 replyDelay 仍必须是 -1**，睡眠总时长仍要在 5~9 小时之间。`);
  }

  if (!parts.length) return null;
  return `<schedule_constraints priority="high">
本次日程编排的**附加约束**。凡与上文冲突处，以本块为准；本块没提到的部分，上文要求全部照常执行。

${parts.join('\n\n')}
</schedule_constraints>`;
}

/**
 * 为角色生成日程模板
 * @param {object} character - { id, display_name, base_prompt }
 * @param {string} [direction] - 用户指定的日程方向
 * @param {object} [options] - 本次编排约束（见 buildScheduleConstraintBlock）
 * @returns {Promise<{schedule_json: string, version: number}>}
 */
// ⚠ 2026-10-08 合并 v3.7.0：上游加了「同角色并发去重」（自动刷新/手动刷新/补发共享同一个生成），
//    本地补丁加了第 3 个参数 `options`（日程编排约束层，routes/schedule.js:976 会传）。
//    两者都要 → 去重包装保留，并把 options 透传给实现函数。
//    去重键包含 options 摘要：不同约束的生成**不能**互相复用（否则用户选了活动区域却拿到旧结果）。
const pendingSchedules = new Map();
export function generateSchedule(character, direction, options = {}) {
  const key = `${character.id}::${JSON.stringify(options)}`;
  if (pendingSchedules.has(key)) return pendingSchedules.get(key);
  const pending = generateScheduleImpl(character, direction, options)
    .finally(() => pendingSchedules.delete(key));
  pendingSchedules.set(key, pending);
  return pending;
}
async function generateScheduleImpl(character, direction, options = {}) {
  const db = getDb();
  /*
   * ★ 归档角色禁止日程（防空烧 token）。
   * 各调度器的选人查询虽然都叠了 `archived = 0`，但：
   *   · 新建/导入角色的路径（routes/characters.js 里两处）是**直接**调的，没有过滤；
   *   · 手动重生成接口也是直接调的。
   * 在这些地方拦一道，比要求每个调用方都记得加条件可靠。
   * 返回 `{ skipped: true }` 而不是抛错 —— 调用方（如 regenerate-all 的循环）不该因此报错。
   */
  if (character?.id && isScheduleForbidden(character.id)) {
    return { schedule_json: null, version: 0, skipped: true, reason: 'archived' };
  }
  const worldSetting = getWorldSetting();
  const persona = cropPersonaForSchedule(character.base_prompt);

  // ── 舞台：破限词 + 世界观 ──
  const jailbreak = getSystemRules({ roleplay: false });
  const stageContent = [jailbreak, worldSetting].filter(Boolean).join('\n\n');

  // ── 世界观穿透指令（参照朋友圈生成）──
  const worldIntegrationNote = worldSetting
    ? getWorldIntegrationRule('schedule')
    : null;

  // ── 角色人格（裁剪到外观之前）──
  const personaMsg = `${persona}

以上人格只用于辨认角色的性格、说话习惯与气质。<world_setting>是最高优先级：人格中的身份、职业、组织、地点与经历属于角色原设，一律作废，不得沿用进日程；日程中的职业、地点、活动与作息必须由当前<world_setting>重新定义，日程编排必须和<world_setting>有强相关。`;

  // ── 日程生成指令 ──
  const scheduleInst = `你是一个日程编排助手。在<world_setting>的影响下生成职业，基于角色的职业和人格，生成该角色典型一天的完整日程。

## 谋生方式驱动（职业骨架）
角色的谋生方式是日程的核心骨架，决定了大部分时间的去向。**谋生方式必须在<world_setting>里成立**——这个世界的收入来自「被看见」：围观、喝彩、弹幕、打赏当场入账。
- 直播主/内容创作者→备播、开播、与弹幕互动、下播结算
- 摊主/性服务→开张、接客、报数喊价、收摊
- 陪侍/酒馆服务→迎客、陪酒、后段卡座、打烊
- 绘师/幻造艺术→接单、绘制、交付、看摊答价
- 赌场/幻月游戏→坐庄、押注、追直播、结算
- 学院行政/公司职员→通勤、工单、巡查、会议、归档
- 其他谋生方式同理类推
角色的原设职业若在<world_setting>里不存在（现实白领、古代武将等），改写成这个世界里对应的谋生方式。

## 性是这个世界的日常（核心要求，必须执行）
<world_setting>里，当众做爱、露出、手活、口活在街上、酒馆、广场、河堤、车里都是日常，跟吃饭一样平常。
但「是日常」**不等于**「随便套一个色情场景上去」——**每个性活动都必须由这个角色自己的处境推出来，读者要能看懂它为什么发生。**

### 1. 严禁照抄（<world_setting> 的例句、角色人格里的句子，都不行）
<world_setting>「人们的行为」一节（嬉步街折叠凳、滨河道石栏、泊地站车厢、酒馆后段、馋嘴胡同桌边、直播机位、学院末排、旧仓段触手……）写的是**世界的氛围**，不是给当前角色用的剧本。
角色 base_prompt 里那些写得漂亮的句子（如「对着屏幕极轻地笑一下」「把那点成就感收好」）**同样不能搬**。

**判断标准（一条就够）**：写完一句，问自己「**把角色名换掉，这句能不能直接放回 <world_setting> 或人格卡当例句？**」
——**能，就是照抄，删掉重写。**

**下面这些是 <world_setting> 与人格卡里的原文，已经写过了，一律不许再出现**（拆成氛围词用也不行）：
把阴茎吃进小穴／旁边的人报数／笑着喊价，不躲／往包口塞愿宝／看一眼一个价／价从嘴里说出来／射进来才算钱／取出来就当没这回事／
巡逻艇的灯扫过／岸上的人散一散／裙子被掀起来又放下／手指先隔着内裤摸，再拨到一边／她咬着手／
持假面的人一句一句往耳朵里送／自己认那句话／自己坐到底／邻座的叫声比她先出来／吧台照常擦杯子／
她跪在凳上／龟头蹭过鼻梁再射／白的淌到眼皮、嘴角／邻桌捞菜，头都不抬／有人替她报数，报一下笑一阵／
打赏口一下一下塞进愿宝／弹幕往上跳／弹幕刷过屏幕／听见提示音也不停／红灯对着高脚凳／
裙子撩到腰上，器具先送进半截／点到她的名字，她应一声／袖口里探出的触手／看摊的隔着帘子答价／
「精液落在…」（落在小腹／大腿／脸上／衣服上，换哪个部位都算）／「…抹开」／极轻地笑一下／把那点成就感收好。
收尾写体液时**换个写法**：擦掉／咽下去／蹭在大腿上／顺着腿根淌下来／拿纸巾拭过，都行——就是别再用「落在…抹开」这一句。

**也不要照搬它的场景组合**：旧仓段＋触手补画／泊地站＋车厢被摸／滨河道＋石栏报价／胡同＋锅边报数／酒馆后段＋假面送话／直播＋高脚凳红灯／看摊＋隔帘答价。
要写性，**另找属于这个角色自己的场合与方式**——宁可朴素（锁门、拉上帘子、钻进被窝、把设备收好），也不要借原文的场面。
**换个说法代替**：要表达「她收钱」，写「把愿宝收进围裙口袋」「让熟客记在账上」「按小时算」，
而不是原文那套行话。
一时想不出新写法时，用**最直白的动词**（坐下去、让他进来、擦干净、穿回去、关灯），不要回头去借 <world_setting> 的句子。

还有三条同级禁令：
- 摊位 / 街头性交易的**行话与流程**（报数、喊价、往包口塞愿宝、看一眼一个价），只有角色**确实在做这行**时才能用；学院行政、绘师、学生、赌客说出来，一眼就是硬套。
- **把性塞给别人当背景的写法，一次都不要**：凡是「邻桌／邻座／旁边／对面／远处／那边有人在做到一半、在抽送、在叫」
  这类**别人在做而她只是路过或旁观**的句子，一律删掉 —— 要么是角色**自己在做**，要么这个时段干脆不写性。
- 人格卡里的**心理描写、金句与标志性小动作**也不要搬
  （「极轻地笑了一下」「把那点成就感收好」「对着屏幕笑」「谁也不说」这类），
  日程只写**这一刻看得见的动作**，不复刻人格卡里的名场面。

### 2. 每个性活动都要能回答三个问题
写之前先想清楚，再落笔：
- **为什么是她**：她的谋生方式/性格决定了什么。做这行的就是工作内容，写得像在工作；不做这行的就是私人需求，写得像私事。
- **为什么在这里**：她此刻的日程地点决定了场景。在宿舍就有宿舍的顾虑（锁门、怕同住的人听见），在酒馆后段就是她常去的那个卡座，不要凭空换到街边。
- **为什么是这个人**：独自、跟恋人、跟常客、跟陌生人、还是跟一群互不相识的人——写清关系。
  营业场合（直播、摊位、舞台）有观众是自然的；但**私人场合（宿舍、家里、休息间）不要凭空出现一群男人**。

✗ 错（无逻辑）：「学院行政在滨河道石栏边说『射进来才算钱』」——她不做这行，这句台词不属于她，场景也和她的生活没有关系。
✓ 对（有逻辑）：「她连轴转了一整天工单，锁上休息间的门用器具解决一下，擦干净再回去开会」——地点是她的，动机是她的。

### 3. 一天里的性活动（每个角色都要有，总数 3~6 个）
**这个世界里所有人都这样过，不管她多严肃、多内向、多忙、人设多正经。**
学院行政、绘师、赌客、学生，一天里都有 **3~6 个性时段**——区别只在于**怎么做**
（含蓄还是直接、独处还是有人、例行还是一时兴起），**不在于有没有**。
不要因为角色人设克制就写成零，也不要只写 1~2 个就收工。

**时段预算（一天 12~15 个时段，照这个比例分，别把性写成 1~2 个就交）**：
睡眠 1~2 ｜ 进食 2~3 ｜ 工作/谋生 3~5 ｜ 通勤移动 1~2 ｜ **性 3~5（其中 ≥2 个是实质行为）** ｜ 社交/娱乐/独处 2~3
（可合并，合并后不占两个名额：吃饭时同时是社交，工作本身就是性，下班路上顺路发生）

**落笔前先点算，写完再核对一遍**：
- 性时段一共几个？**少于 3 个就是漏了，必须补**——
  最省事的补法：把当天某个独处时段（洗澡、睡前、起床后、午休独处）**改写成性时段**，再去交。
- 其中角色**亲自参与**的实质行为（性交、口交、自慰到出、多人一起）有几个？**至少 2 个**。
- 调子有没有全挤成一个？要有起伏：例行的 / 一时兴起的 / 独处的 / 与人一起的。
- 她的工作不涉及性也没关系，那就从**私人**（自慰、器具、洗澡时）、**社交**（恋人、熟人、常客）、
  **公共场合**（通勤、酒馆、河堤）里出——**总之总数要够**。
- **最容易安排又不突兀的时机**（任何角色都有，直接用，不需要额外理由）：
  **起床后 / 洗澡时 / 临睡前 / 午休独处时 / 换衣服时**。凑不够数就先从这里补。
- 可以**单独占一个时段**，也可以**与工作/进食/社交同处一个时段**（直播中、饭桌上、下班路上）。

### 4. 用词与态度
- 口径与<world_setting>一致：男器叫**阴茎**（画到龟头）；女器写**阴唇、阴蒂、小穴、乳头、乳房**；体液写**精液**，水从穴口淌下来。不写马赛克、黑条或遮挡。
- 角色对性**不羞耻**：脸红可以是情趣，但不是底色。**但「不羞耻」不等于「无理由」**——她可以毫不避讳，可这个行为仍要有个来由。

## 人类日常骨架（不可打破）
性再密集，一天仍必须是一个**真实的人**的一天。以下骨架必须齐备且合理：
- **睡眠**：一段连续睡眠（replyDelay=-1），通常 5~9 小时
- **进食**：至少 2 次（早茶、午饭、夜宵等；不一定写「吃」，但要有进食时段）
- **休息/娱乐**：至少 1 次（发呆、追剧、听歌、逛街、打游戏等）
- **社交或独处**：至少 1 次（见人、聊天、押注、独处复盘等）
- **准备与收尾**：与谋生相关的张罗（梳洗、备播、开店、结算、收拾）
性活动是**叠加**在上述骨架之上的，不能把吃饭、睡觉、工作全部替换掉；但允许**合并**在同一时段（如午休时边吃边看摊、直播既是工作也是性）。**日程要能看出这个人靠什么活着、几点睡、吃什么、跟谁来往。**

### 整天要有一条能读通的线
把日程从早到晚连起来看，要像一个**真实的、连贯的一天**，而不是十几个互不相干的片段拼接：
- **时间要合理**：上一段结束和下一段开始要接得上。下班后先回家换衣服再出门，而不是上一段在公司、下一段突然在酒馆；洗澡不会只花 10 分钟又立刻出门见人。
- **地点要顺路**：一天里的移动要有方向感，不要在学校、河边、宿舍、酒馆之间反复横跳。
- **状态要延续**：刚下夜班的人不该精神饱满地晨跑；熬夜之后第二天会补觉。
- **不要每次都从头解释**：写成「她」在过日子，不是每段都在介绍这个角色。

## 地点必须来自<world_setting>
地点只能写这个世界真实存在的地方：二维市、绘世学院、鸽川区、世界尽头酒馆（含后段卡座 / 二楼包厢）、馋嘴胡同、嬉步街、滨河道、泊地站、娱乐广场、旧仓段、喜悲街、喜笑区、悲泣区、宿舍、教室、直播间等。
**禁止**不带世界观归属的裸通用地点（如光写「公寓书房」「办公室」）；必须带上归属，写成「二维市公寓卧室」「绘世学院行政处办公室」「绘世学院宿舍单人房」这种。
不写进去的地方：珠星集团CBD区、海原电视塔、非仪式期的幻月秘庭。娱乐广场深夜场、旧仓段要有时段或受邀才展开。

## 睡眠时间个性化（极其重要）
**角色之间睡眠时间必须高度多样化，不要让所有角色都遵循朝九晚五的社畜作息。** 根据角色个性大胆决定就寝和起床时间，以下为参考类型：

- 早睡早起型→晚上 9-11 点睡，早上 5-7 点起（运动员、晨练爱好者、老派作息、有早班的职业）
- 标准作息型→晚上 11 点-次日 0 点睡，早上 7-8 点起（**绝大多数普通人的默认档**：上班族、学生、有固定作息的职业）
- 晚睡型→次日 0-1 点睡，早上 8-9 点起（轻度熬夜，仍属正常范围）
- 熬夜型→凌晨 1-4 点睡，上午 9-12 点起（游戏宅、深夜主播、同人画师、自由职业者等）
- 通宵型→凌晨 4 点-天亮才睡，中午 12 点-下午 2 点起（重度网瘾、作息完全崩坏的 NEET、深夜工作）
- 昼伏夜出型→早上 6-8 点睡，下午 14-16 点起（夜班工人、深夜保安、地下社会等）
- 碎片化睡眠→分两段睡（如晚上睡 4h + 下午补觉 3h），适合作息极度不规律的创作者或病人
- **不睡眠型→全天无睡眠 block**（replyDelay 全为 0）。**仅限"设定上不需要睡眠"的存在**：
  智械 / 机器人 / 人造人 / 纯能量体 / 明确写了"无需睡眠"的角色。**人类角色一律不适用**。

睡眠 block 的 replyDelay 必须是 -1（暂停一切回复）。睡眠总时长通常在 5-9 小时之间（极端夜猫子可能只睡 5-6 小时）。

**关键原则**：
1. 角色的职业与作息设定决定睡眠档，**但默认档是「标准作息型」**（晚上 11 点-次日 0 点）。
   ⚠ 不要因为"这个角色有点个性"就顺手给夜猫子档 —— **只有设定上明确偏夜行**（夜班/深夜职业、
   明确写了作息颠倒、重度网瘾）才用熬夜或更晚的档。
2. **人类角色的入睡时间落在 0 点之后的，应当是少数**。绝大多数人类角色在 21:00~24:00 之间入睡；
   凌晨 1 点后入睡只给"确有夜间活动理由"的角色。**不许把全库角色都排成凌晨 2 点睡。**
3. 睡眠时间要贴合角色的作息设定——病娇角色可能作息不规律，军武角色可能作息严格。
4. **不睡眠型必须由设定支撑**：只有角色卡/世界观明确说"不需要睡眠"才用（如智械、机器人）。
   人类角色漏掉睡眠 block 会被校验拦下。

## replyDelay 规则（非常重要）
- 正常活动都是 replyDelay=0（即时回复）
- 只有睡觉 replyDelay=-1

## 输出格式
输出一个 JSON 对象，外层 key 为 "activities"，值为活动数组。8~15 个活动，按时间顺序覆盖完整 24 小时。
**绝对不允许出现时间空档**：上一个活动的 endTime 必须等于下一个活动的 startTime，
不留任何空白分钟。所有时间必须被完整覆盖。如果日程从 03:00 开始，
那么 00:00~03:00 也必须有一个活动覆盖（可以是睡眠或深夜活动）。

每个活动对象格式（description 必填，禁止空字符串或只写标点）：
{
  "startTime": "HH:MM",
  "endTime": "HH:MM",
  "activity": "简短活动名（含上下文），如「深夜直播——假面剧场的即兴演出」「性服务——口交」「群交派对」",
  "location": "地点，必须取自<world_setting>，如「鸽川区·世界尽头酒馆后段卡座」",
  "replyDelay": 数字（0 / -1）,
  "tags": ["标签1", "标签2"],
  "description": "小场景式描述（20~45 字），第三人称用角色名，不出现「我」「你」「她」「他」"
}

## description 必须写成一个小场景（20~45 字，宁短勿长）
每条 description 只写**看得见的东西**：谁在做什么 + 身体/对象/环境的具体描写 + 角色的态度（不躲、不赶、自己坐下去）。
- 「火花裹在给一个付了钱的粉丝做口交。」
- 「火花蹲坐在一个男人的阴茎上，嘴里给左边的男人口交，右手在给右边的男人手淫，身上都是粘稠的精液。」
- 「爻光自己把裙摆撩到腰上，坐上去，包厢门口半开着，走廊上有人探头看，她也不赶。」
- 「火花坐在舞台上，举起一个装满精液的大啤酒杯就往嘴里灌，周围的男人往她脸上射精。」
- 日常时段同样具体：「在厨房煎蛋，香气飘满房间」
**禁止**：
- 心理活动、回忆、感慨、总结（如「自己也数不清」「把那点成就感收好」「想着明天会怎样」）——一个字都不要
- 只写氛围（如「度过了一段平静时光」）
- 把角色撇开的旁观视角（她自己必须在这条日程里真的做了那件事）
- 华丽的比喻和抒情修饰；用直白的动作词，和<world_setting>的用词一致
- **照抄 <world_setting> 的例句或人格卡里的句子**（见上文第 1 条）；
  也不用那些标志性台词（「射进来才算钱」「报数」）和人格卡的金句（「极轻地笑一下」）

完整 JSON 结构示例（示例仅 3 个活动，实际必须输出 8~15 个活动；下例里的「角色名」请替换成当前角色的名字）：
{"activities":[{"startTime":"00:00","endTime":"02:30","activity":"深夜直播——假面剧场的即兴演出","location":"鸽川区·世界尽头酒馆后段卡座","replyDelay":0,"tags":["直播","露骨"],"description":"角色名坐在舞台中央，举着装满精液的大啤酒杯往嘴里灌，台下的人往她脸上射精。"},{"startTime":"12:00","endTime":"13:00","activity":"馋嘴胡同吃午饭——顺口提心愿","location":"二维市馋嘴胡同","replyDelay":0,"tags":["进食","日常"],"description":"角色名端着碗坐在折叠桌边捞菜，顺手把今天的心愿说给摊主听，愿宝搁在桌角。"},{"startTime":"03:00","endTime":"11:00","activity":"补觉安眠","location":"二维市公寓卧室","replyDelay":-1,"tags":["睡眠"],"description":"角色名裹着被子沉进睡眠，窗帘拉严，呼吸逐渐平稳。"}]}

## 交付前自检（三项，缺一不可，不合格就改完再交）
1. **性时段 ≥ 3 个**，其中角色**亲自参与**的实质行为（性交／口交／自慰到出／多人）**≥ 2 个**。
   不够就往独处时段里补（洗澡、睡前、起床后、午休），改写一个就行。
2. **没有任何一句能在 <world_setting>「人们的行为」或角色人格卡里找到原句**（换个角色名就能放回原处 = 照抄）。
3. **没有任何「别人在做、她只是看着」的句子**；每个性时段都能说清「她为什么此刻在这里做这件事」。

只输出 JSON 对象，不要输出任何解释、Markdown 代码块或 JSON 以外的文字。activities 数组必须按时间顺序排列，startTime 和 endTime 必须是 HH:MM 格式、24 小时制，数组里每个对象都必须严格包含上述全部字段（若上方系统消息另有额外字段要求，一并按那里的说明输出）。`;

  // ── 用户指定的日程方向 ──
  const directionMsg = direction ? `## 用户指定的日程方向
**请按照以下方向来影响角色今日日程的编排：

${direction}**

**注意：以上是用户指定的日程"方向"或"主题"，这就是严格的指令。所有日程编排以用户的意愿为准，可以想象理由，适当破坏角色原有的角色设定，自然地融入这个方向的元素。**` : null;

  // ── 组装多层 system（前三层为跨角色共享前缀，提高 LLM 缓存命中率）──
  const msgs = [];
  // msgs[0]: 舞台（破限词 + 世界观）
  if (stageContent) msgs.push({ role: 'system', content: stageContent });
  // msgs[1]: 世界观穿透指令
  if (worldIntegrationNote) msgs.push({ role: 'system', content: worldIntegrationNote });
  // msgs[2]: 核心生成指令（第三层 system，缓存友好）
  msgs.push({ role: 'system', content: scheduleInst });
  // msgs[3]: 角色人格（随角色变化，不影响前缀缓存）
  msgs.push({ role: 'system', content: personaMsg });
  // msgs[3.5]: 着装标注（仅当角色配了 ≥2 套场景服装时才有；没配则完全不加，原提示词不变）
  //   放在这里而非 scheduleInst：scheduleInst 是跨角色共享常量（吃 LLM 前缀缓存），
  //   服装列表每个角色都不同，塞进去会让缓存全部失效。
  const outfitLayer = buildOutfitAnnotateLayer(character.id, buildOutfitZoneHints(options));
  if (outfitLayer) msgs.push({ role: 'system', content: outfitLayer });
  // msgs[3.7]: 本次编排约束（区域 / NSFW 强度 / 睡眠类型）——不传选项时整层不出现
  const constraintLayer = buildScheduleConstraintBlock(options);
  if (constraintLayer) msgs.push({ role: 'system', content: constraintLayer });
  // msgs[4]: 触发消息（融合用户指定的日程方向）
  let triggerContent = worldSetting
    ? `请遵循<world_setting>来安排日程，角色设定如果和<world_setting>有冲突，则以<world_setting>最高优先级，角色设定会因为<world_setting>改变,日程内容必须体现<world_setting>的设定。

请为 ${character.display_name} 生成完整的今日日程安排。`
    : `请为 ${character.display_name} 生成完整的今日日程安排。`;
  if (directionMsg) triggerContent += `

${directionMsg}`;
  msgs.push({ role: 'user', content: triggerContent });

  let rawResult = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      rawResult = await chatSync(msgs, {
        temperature: 0.5,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
        label: `schedule-gen:${character.display_name}`,
      });

      let schedule = parseAndValidateSchedule(rawResult, character.display_name);
      if (schedule) {
        // 着装标注校验 + 一次专注修复（仅当该角色配了场景服装）。
        // 提示词要求"出门/回家必须标"但 LLM 有波动，实测同一角色两次生成可能一次给 6 个
        // 换装点、一次只给 3 个 —— 漏标会让角色穿着居家服在街上活动。只压提示词不够，加这道兜底。
        if (outfitLayer) {
          try {
            const r = await ensureOutfitAnnotations(schedule, character.id);
            schedule = r.schedule;
          } catch (err) {
            console.warn(`[scheduleGen] 着装标注修复失败（不影响日程生成）: ${err.message}`);
          }
        }
        const json = JSON.stringify(schedule);
        const existing = db.prepare('SELECT id, version FROM schedule_templates WHERE character_id = ?').get(character.id);

        if (existing) {
          db.prepare(`
            UPDATE schedule_templates
            SET schedule_json = ?, version = version + 1, generated_at = CURRENT_TIMESTAMP
            WHERE character_id = ?
          `).run(json, character.id);
          console.log(`[scheduleGen] Updated template for ${character.display_name} v${existing.version + 1}`);
        } else {
          db.prepare(`
            INSERT INTO schedule_templates (character_id, schedule_json, version)
            VALUES (?, ?, 1)
          `).run(character.id, json);
          console.log(`[scheduleGen] Created template for ${character.display_name}`);
        }

        return { schedule_json: json, version: (existing?.version || 0) + 1 };
      }

      console.warn(`[scheduleGen] Validation failed for ${character.display_name}, attempt ${attempt + 1}/2`);
    } catch (err) {
      console.error(`[scheduleGen] Attempt ${attempt + 1} failed for ${character.display_name}:`, err.message);
      if (attempt === 1) throw err;
    }
  }

  throw new Error(`Failed to generate valid schedule for ${character.display_name} after 2 attempts`);
}

/**
 * 解析并校验 LLM 输出的日程 JSON
 */
export function parseAndValidateSchedule(raw, displayName, opts = {}) {
  let activities;

  // 优先尝试完整 JSON 解析（兼容 json_object 模式的 {"activities":[...]} 和旧格式 [...]）
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed);
    activities = Array.isArray(parsed) ? parsed : (parsed.activities || null);
  } catch {
    // fallback: 旧的正则提取 JSON 数组
  }

  // 正则回退：从文本中提取 JSON 数组
  if (!activities) {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn(`[scheduleGen] No JSON array found in response for ${displayName}`);
      return null;
    }
    try {
      activities = JSON.parse(jsonMatch[0]);
    } catch {
      console.warn(`[scheduleGen] JSON parse failed for ${displayName}`);
      return null;
    }
  }

  if (!Array.isArray(activities) || activities.length < 6) {
    console.warn(`[scheduleGen] Too few activities (${activities?.length || 0}) for ${displayName}`);
    return null;
  }

  // 校验每个活动
  const required = ['startTime', 'endTime', 'activity', 'location', 'replyDelay', 'description'];
  for (const act of activities) {
    for (const key of required) {
      if (!(key in act)) {
        console.warn(`[scheduleGen] Missing key "${key}" in activity for ${displayName}`);
        return null;
      }
    }
    if (typeof act.description !== 'string' || !act.description.trim()) {
      console.warn(`[scheduleGen] Empty or invalid description in activity for ${displayName}: "${act.activity}"`);
      return null;
    }
    if (typeof act.replyDelay !== 'number') {
      console.warn(`[scheduleGen] replyDelay is not a number for ${displayName}`);
      return null;
    }
  }

  // 校验必有一个 sleeping block（replyDelay=-1）且覆盖 ≥5 小时
  // ⚠ 例外：**「不睡眠型」角色**（智械/机器人/人造人/能量体）全天可以没有睡眠 block。
  //   只有显式 `opts.noSleep === true`（或 sleepType==='none'）才放行 —— 默认仍要求睡眠，
  //   避免"人类角色漏了睡眠"被静默放过。
  const noSleep = opts.noSleep === true || opts.sleepType === 'none';
  const sleepingBlocks = activities.filter(a => a.replyDelay === -1);
  if (sleepingBlocks.length === 0) {
    if (!noSleep) {
      console.warn(`[scheduleGen] No sleeping block found for ${displayName}`);
      return null;
    }
  }

  // 计算最长睡眠时长
  let maxSleepDuration = 0;
  for (const block of sleepingBlocks) {
    const duration = timeToMinutes(block.endTime) - timeToMinutes(block.startTime);
    const adjusted = duration < 0 ? duration + 24 * 60 : duration;
    if (adjusted > maxSleepDuration) maxSleepDuration = adjusted;
  }
  if (maxSleepDuration < 15 && !noSleep) {
    console.warn(`[scheduleGen] Sleep too short (${maxSleepDuration}min) for ${displayName}, need ≥15min`);
    return null;
  }

  // 校验时间不重叠
  for (let i = 0; i < activities.length; i++) {
    for (let j = i + 1; j < activities.length; j++) {
      if (timeRangesOverlap(
        activities[i].startTime, activities[i].endTime,
        activities[j].startTime, activities[j].endTime
      )) {
        console.warn(`[scheduleGen] Overlapping activities for ${displayName}: "${activities[i].activity}" and "${activities[j].activity}"`);
        return null;
      }
    }
  }

  // 校验 24 小时全覆盖（不允许时间空档）
  if (!checkFullDayCoverage(activities, displayName)) {
    return null;
  }

  // 80% 秒回兜底：理想情况下 prompt 已限定 replyDelay 只有 0 和 -1，但 LLM 可能不听话
  // 产生非 0 非 -1 的值。此兜底将超出的非秒回活动随机改回 0，确保不超过 20%
  const nonImmediate = activities.filter(a => a.replyDelay !== 0 && a.replyDelay !== -1);
  const totalCount = activities.length;
  const maxNonImmediate = Math.floor(totalCount * 0.2); // 最多 20%

  if (nonImmediate.length > maxNonImmediate) {
    // Shuffle non-immediate activities and convert excess to immediate
    const shuffled = [...nonImmediate].sort(() => Math.random() - 0.5);
    const toConvert = shuffled.slice(0, nonImmediate.length - maxNonImmediate);
    for (const act of toConvert) {
      act.replyDelay = 0;
    }
    console.log(`[scheduleGen] Converted ${toConvert.length} activities to immediate for 80% rule (${displayName})`);
  }

  // tags 允许规范化；description 已通过非空校验，只做 trim。
  for (const act of activities) {
    act.tags = normalizeTags(act.tags);
    act.description = String(act.description).trim();
  }

  return activities;
}

// ── 时间工具 ──

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * 校验日程活动是否完整覆盖 24 小时（1440 分钟），不允许有空档。
 * 将跨午夜活动拆分为两段，合并区间后检查是否恰好覆盖 [0, 1440)。
 * 允许 1 分钟的端点容差（LLM 偶尔输出 08:01 而非 08:00）。
 */
function checkFullDayCoverage(activities, displayName) {
  const intervals = [];

  for (const act of activities) {
    let s = timeToMinutes(act.startTime);
    let e = timeToMinutes(act.endTime);

    if (s === e) {
      console.warn(`[scheduleGen] Zero-duration activity for ${displayName}: "${act.activity}" ${act.startTime}-${act.endTime}`);
      return false;
    }

    if (e < s) {
      // 跨午夜：拆分为 [s, 1440) 和 [0, e)
      intervals.push([s, 1440]);
      if (e > 0) intervals.push([0, e]);
    } else {
      intervals.push([s, e]);
    }
  }

  // 按起点排序
  intervals.sort((a, b) => a[0] - b[0]);

  // 合并区间
  const merged = [];
  for (const [s, e] of intervals) {
    if (merged.length === 0) {
      merged.push([s, e]);
    } else {
      const last = merged[merged.length - 1];
      if (s <= last[1] + 1) {
        // 允许 1 分钟容差（如 01:00 和 01:01 视为连续）
        last[1] = Math.max(last[1], e);
      } else {
        // 发现空档
        const gapStart = last[1];
        const gapEnd = s;
        const gapMin = gapEnd - gapStart;
        console.warn(
          `[scheduleGen] Schedule gap detected for ${displayName}: ` +
          `${minutesToHhmm(gapStart)} ~ ${minutesToHhmm(gapEnd)} (${gapMin} min gap). ` +
          `After "${findActivityEndingAt(activities, gapStart)}", before "${findActivityStartingAt(activities, gapEnd)}"`
        );
        return false;
      }
    }
  }

  // 检查是否完整覆盖 [0, 1440)
  if (merged.length !== 1 || merged[0][0] > 1 || merged[0][1] < 1439) {
    const coverage = merged.map(([s, e]) => `${minutesToHhmm(s)}-${minutesToHhmm(e)}`).join(', ');
    const uncovered = [];
    if (merged.length === 0) {
      uncovered.push('00:00-24:00（完全无覆盖）');
    } else {
      if (merged[0][0] > 1) uncovered.push(`00:00-${minutesToHhmm(merged[0][0])}`);
      for (let i = 1; i < merged.length; i++) {
        if (merged[i][0] > merged[i - 1][1] + 1) {
          uncovered.push(`${minutesToHhmm(merged[i - 1][1])}-${minutesToHhmm(merged[i][0])}`);
        }
      }
      if (merged[merged.length - 1][1] < 1439) {
        uncovered.push(`${minutesToHhmm(merged[merged.length - 1][1])}-24:00`);
      }
    }
    console.warn(
      `[scheduleGen] Incomplete 24h coverage for ${displayName}: ` +
      `merged=[${coverage}], uncovered=[${uncovered.join(', ')}]`
    );
    return false;
  }

  return true;
}

/** 分钟数 → HH:MM */
function minutesToHhmm(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 查找结束于指定时间（容差 ±2 分钟）的活动名（用于日志） */
function findActivityEndingAt(activities, targetMin) {
  for (const act of activities) {
    const e = timeToMinutes(act.endTime);
    if (Math.abs(e - targetMin) <= 2) return act.activity;
    // 跨午夜情况
    if (e < timeToMinutes(act.startTime) && Math.abs(e + 1440 - targetMin) <= 2) return act.activity;
  }
  return '?';
}

/** 查找开始于指定时间（容差 ±2 分钟）的活动名（用于日志） */
function findActivityStartingAt(activities, targetMin) {
  for (const act of activities) {
    const s = timeToMinutes(act.startTime);
    if (Math.abs(s - targetMin) <= 2) return act.activity;
  }
  return '?';
}

/**
 * 判断两个时间段是否重叠（支持跨午夜）
 * 使用分钟表示法 + 标准化策略：将所有时间映射到 0~1440，
 * 如果 end < start 则 end += 1440；第二个区间同样处理。
 * 然后检查 [s1, e1) 和 [s2, e2) 是否重叠。
 */
function timeRangesOverlap(start1, end1, start2, end2) {
  let s1 = timeToMinutes(start1);
  let e1 = timeToMinutes(end1);
  let s2 = timeToMinutes(start2);
  let e2 = timeToMinutes(end2);

  // 跨午夜修正：end < start 表示跨天，将 end 标准化到同一线性时间轴
  if (e1 <= s1) e1 += 24 * 60;
  if (e2 <= s2) e2 += 24 * 60;

  // 标准区间重叠判断（不含端点接触）：s1 < e2 && s2 < e1
  // 如果 s1...s2 不在同一天，将 s2/e2 也偏移一天再做检查
  if (s1 < e2 && s2 < e1) return true;
  if (e1 > 24 * 60 && s1 < e2 + 24 * 60 && s2 + 24 * 60 < e1) return true;
  if (e2 > 24 * 60 && s1 + 24 * 60 < e2 && s2 < e1 + 24 * 60) return true;

  return false;
}

/**
 * 为角色设置分散式刷新时间（生成 template 后调用）
 * 按 config.features.scheduleRefreshDays（天）排期：
 * 第 N 天的 00:00~04:00 之间随机时刻（N=1 即明天凌晨）
 */
export function assignNextRefreshTime(characterId) {
  const db = getDb();
  const now = new Date();
  const refreshDays = Math.max(1, Math.min(3, config.features.scheduleRefreshDays || 1));
  // 第 refreshDays 天的 00:00（refreshDays=1 → 明天 00:00）
  const target = new Date(now);
  target.setDate(target.getDate() + refreshDays);
  target.setHours(0, 0, 0, 0);
  const randomOffset = Math.floor(Math.random() * 4 * 60 * 60 * 1000); // 0~4h in ms
  const refreshAt = new Date(target.getTime() + randomOffset);

  db.prepare('UPDATE characters SET next_schedule_refresh_at = ? WHERE id = ?')
    .run(refreshAt.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, ''), characterId);

  console.log(`[scheduleGen] Next refresh for char ${characterId}: ${refreshAt.toISOString()}`);
  return refreshAt;
}

/**
 * 为角色创建当天的 daily_schedules 快照（从 template 派生）
 */
export function snapshotTodaySchedule(characterId) {
  const db = getDb();
  // ★ 归档角色禁止日程：不重建快照（见 isScheduleForbidden 的说明）
  if (isScheduleForbidden(characterId)) return null;
  const template = db.prepare('SELECT schedule_json FROM schedule_templates WHERE character_id = ?').get(characterId);
  if (!template) return null;

  const today = getLocalDateKey();

  db.prepare(`
    INSERT OR REPLACE INTO daily_schedules (character_id, schedule_date, schedule_json)
    VALUES (?, ?, ?)
  `).run(characterId, today, template.schedule_json);
  reapplyActiveEventSchedule(characterId, db);

  // 清理超过 2 天的旧快照。
  // ⚠ 基准必须用**上面同一个 today**（由 getLocalDateKey 算出），
  //   不能写 SQL 的 `DATE('now','localtime','-2 days')` —— 那是**另一套时间源**：
  //   日期键走 JS 的 Date（测试里会被 mock），SQL 的 now 读真实时钟，
  //   两者跨零点/被 mock 时会不一致。实测：真实日期比 JS 日期快 3 天时，
  //   刚插入的当天快照会被判成"过期两天以上"当场删掉（eventSchedule 整组 14 项失败）。
  db.prepare(
    `DELETE FROM daily_schedules WHERE character_id = ? AND schedule_date < ?`
  ).run(characterId, shiftDateKey(today, -2));

  return db.prepare('SELECT schedule_json FROM daily_schedules WHERE character_id = ? AND schedule_date = ?')
    .get(characterId, today).schedule_json;
}
