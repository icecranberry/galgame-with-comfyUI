/**
 * 特殊事件生成器
 *
 * 不做"奇遇生成器"——做"特殊事件生成器"。事件范围覆盖日常全光谱：
 * 从迟到/丢东西/逛街发现新鲜事，到目击紧急状况/收到匿名信息/撞见微妙异常，
 * 只要能打破角色当下日常节奏的事，都在候选池里。
 *
 * - 硬编码 EVENT_TYPES（31 条极简方向，和朋友圈风格库一样模式：只给方向，不编故事）
 * - generateEvent(): LLM 结合角色人格+世界观生成事件初始场景 + 配图
 * - generateNextBranch(): 用户选择后生成下一步 + 配图
 * - concludeEvent(): 到期/完成后生成结局，存入记忆
 */

import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, getSystemRules, getSystemRulesWithWorld, getWorldSetting, getGlobalRule } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { generateImageRaw } from './imageSkill.js';
import { config } from '../config.js';
import { broadcastNewEvent, broadcastEventUpdate, broadcastEventConclusion } from './eventNotificationBus.js';
import { upsertVector } from './vectorClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const imagesDir = path.join(projectRoot, 'data', 'images');

// ── 事件类型库（和朋友圈风格库完全一样的模式：只给方向，不编故事） ──
// 每条只描述"哪类事情"+"底层模式"，不预设具体场景。
// LLM 结合角色人格、世界观、关系网、当前时间，从方向出发自由创作独一无二的事件。
//
// 设计铁律：
//   - 不出现任何具体物品、地点、数字、动作
//   - 不暗示任何具体叙事走向
//   - 覆盖日常全光谱：从鸡毛蒜皮到紧急状况，从温情到诡异
//   - "奇"只是可选风味之一，不是必须——平凡小事的涟漪也值得成为一个事件

const EVENT_TYPES = [
  // ═══ 日常节奏被打乱（15-40min）═══
  { key: 'routine_broken', name: '日常脱轨', durationMin: 20, urgency: 1,
    desc: '原本按部就班的一天被一个小意外打断了——计划泡汤、路线受阻、或某个依赖的东西突然不可用了。事情本身不大，但它把人推出了舒适区，接下来遇到的人和事都不在计划里。' },
  { key: 'running_late', name: '时间紧迫', durationMin: 15, urgency: 2,
    desc: '因为某个原因快要迟到了。在赶路的过程中发生了一件事——它让"迟到"突然变成了最不重要的问题。' },
  { key: 'lost_something', name: '找不到了', durationMin: 25, urgency: 1,
    desc: '一个需要用到的东西找不到了。翻找的过程中撞上了别的东西——或别的人——或一段被压在角落的往事。' },
  { key: 'something_broke', name: '关键时刻掉链子', durationMin: 20, urgency: 1,
    desc: '某个依赖的东西在最不该坏的时候坏了。修理或想办法替代的过程把角色引向了平时不会去的地方或不会找的人。' },

  // ═══ 人际交集（20-50min）═══
  { key: 'stranger_approach', name: '被搭话了', durationMin: 20, urgency: 1,
    desc: '一个陌生人主动开口了。对方说的内容让人没办法用一句"你认错人了"结束对话——因为话里有一处细节，只对了一半，但那一半太准了。' },
  { key: 'witness_moment', name: '目击时刻', durationMin: 30, urgency: 2,
    desc: '恰好看到了不该被自己看到的一幕。可以是严重的（冲突/意外），也可以是微妙的（一个眼神/一个动作）。可以介入，可以走开——但选择之前只有几秒。' },
  { key: 'put_on_spot', name: '被推到台前', durationMin: 20, urgency: 2,
    desc: '突然成了众人注意力的焦点——被点名、被推举、或被动成为了某个局面的关键人物。没有准备、没有脚本、没有退路。所有人的目光已经聚过来了。' },

  // ═══ 机会与诱惑（20-60min）═══
  { key: 'unexpected_offer', name: '天上掉下来的', durationMin: 30, urgency: 1,
    desc: '有人提出了一个意料之外的提议、机会、或交易。它诱人但不完全对劲——好得不像真的，或者代价写在不起眼的地方。' },
  { key: 'found_item', name: '捡到东西了', durationMin: 25, urgency: 1,
    desc: '在公共或私密的空间里发现了一样不属于这里的东西。它不是垃圾也不是路人随手丢的——它有来历，可能还和角色的某个侧面有关联。' },
  { key: 'tempting_path', name: '偷懒的诱惑', durationMin: 20, urgency: 1,
    desc: '面前有一条更省事、更快、但不太符合规则的路。走不走——不需要告诉任何人。唯一知道的是自己。' },

  // ═══ 小危机（15-40min）═══
  { key: 'mistake_looming', name: '纸包不住火了', durationMin: 20, urgency: 2,
    desc: '之前的一个错误、疏漏、或没说清的含糊之处马上就要暴露了。还有一点时间——但只够做一件事。补救、坦白、还是赌一把没人发现。' },
  { key: 'caught_awkward', name: '被撞见了', durationMin: 15, urgency: 2,
    desc: '正处在一个尴尬的、不应该的、或容易被误解的时刻——有人出现了。对方看到了多少不确定，但眼神说明了一些事。需要立刻决定怎么收场。' },
  { key: 'emergency_minor', name: '紧急小事', durationMin: 25, urgency: 2,
    desc: '目睹或卷入了一场突发的小型紧急状况——不是灾难级别的，但需要立刻反应。介入、求助、或避开——每个选择只用一秒做出，但会被反复想起。' },

  // ═══ 新鲜事与发现（30-90min）═══
  { key: 'overheard_info', name: '听到了不该听的', durationMin: 30, urgency: 2,
    desc: '无意中听到了关于某人——或关于自己——的信息。不是通过正常渠道，也没人知道角色现在知道了。这个信息让人重新审视某些事情。' },
  { key: 'new_curiosity', name: '被种草了', durationMin: 30, urgency: 1,
    desc: '接触到了一件从未了解过的事物——一项技能、一个圈子、一种生活方式。本来只是路过看了一眼，但它开始在心里生根。好奇心比预期的大得多。' },

  // ═══ 两难与冒险（20-40min）═══
  { key: 'two_fires', name: '两头着火', durationMin: 25, urgency: 2,
    desc: '两个同样重要、但互相矛盾的事情同时需要处理。选一边意味着另一边出问题——而不管选哪边，都要面对选了之后的结果。时间不等人，必须选。' },
  { key: 'leap_of_faith', name: '赌一把', durationMin: 20, urgency: 1,
    desc: '面前有一个需要冒险的决定。信息不够、时间有限、没有保证。但直觉在往某个方向用力——而且这个直觉过往的战绩有好有坏。赌不赌。' },
  { key: 'someone_needs_help', name: '有人需要帮忙', durationMin: 25, urgency: 2,
    desc: '一个陌生人或不太熟的人明显需要帮助——但帮这个忙有成本、有风险、或会把角色卷进一件不太想卷进的事。周围还有别人，但没有人在动。' },

  // ═══ 一个人的道德瞬间（10-40min）═══
  // 没有观众、没有对方在等你的反应、纯自己和良心对弈
  { key: 'broke_something_secret', name: '不小心弄坏了', durationMin: 20, urgency: 2,
    desc: '碰倒了、摔了、洒了——一件不属于自己的东西坏了。主人不在场。周围没人看到。可以走，可以留张纸条，可以试着修。但不管选什么，那声碎裂的声音还在耳朵里。' },
  { key: 'forbidden_to_look', name: '忍不住想看的', durationMin: 20, urgency: 1,
    desc: '某个不该看的东西刚好触手可及——没锁的屏幕、敞开的抽屉、一份写着"保密"但没人看守的文件。看了没人会发现。但知道之后就不能假装不知道了——而且看到的东西未必是想要的。' },
  // ═══ 日常里的异物（20-90min）═══
  // 略微异世界/奇幻方向：日常中混进了一样不属于这个日常的东西。不恐怖，不诡异——
  // 更像是一瞬间的"等等，这个世界比我想的大一点"。全虚指，不给具体物品，LLM 自由发挥
  { key: 'flea_market_find', name: '淘到了怪东西', durationMin: 40, urgency: 1,
    desc: '地摊、旧货店、或某个不起眼的角落里——一样东西攫住了目光。说不上哪里特别，但手指碰上去的瞬间有种说不清的触感。摊主报了一个低得不像话的价，像是在清库存——又像是在找"对的人"把它带走。买下它的决定只需要一秒，搞清楚它是什么可能需要很久。' },
  { key: 'mystery_vial', name: '捡到来路不明的东西', durationMin: 30, urgency: 1,
    desc: '路边、台阶下、或某个不该有东西的地方——躺着一个小容器。瓶、罐、盒——材质不眼熟，里面装的东西透过外壳微微透出某种难以描述的光泽或温度。没有标签，没有说明，只有一个不认识的符号或一个褪色的手写字。拿起来的第一反应是"这是什么"——第二反应是"要不要打开"。' },
  { key: 'phantom_shop', name: '不存在的店铺', durationMin: 60, urgency: 1,
    desc: '一条走过无数遍的街上——今天多了一家店。不是新开的——门面有种在这里待了很久的感觉，但自己确定昨天、前天、上周这里都是另一家店或一堵墙。橱窗里摆的东西和这条街上的任何一家都不一样。门口挂着"营业中"。推开门的冲动和走过去的惯性在打架。' },
  { key: 'vending_mystery', name: '贩卖机里的异物', durationMin: 20, urgency: 1,
    desc: '投币、按键——哐当一声，掉出来的不是选的那个。不是隔壁货道滑错了——是一种不应该出现在任何自动贩卖机里的东西。包装上没有品牌，没有条形码，只有一行手写体或一个图案。机器不会解释。手里的东西也不会。现在该拿它怎么办——大概是今天第一个真正需要想的问题。' },

  // ═══ 喜讯降临（20-60min）═══
  // 纯粹的好消息：一条信息、一个通知、一通电话、一次告知——角色被动接收到了
  // 让自己高兴起来的消息。不是角色"做到了"什么，而是"得知了"什么。
  { key: 'unexpected_approval', name: '居然过了', durationMin: 25, urgency: 1,
    desc: '一个没抱希望的申请、投递、或请求——居然通过了。当初提交的时候甚至犹豫过要不要点"发送"，现在结果就在面前。不是"努力终于有了回报"的励志叙事，就是那种"原来我也配"的、有点不真实的踏实感。' },
  { key: 'public_recognition', name: '被看见了', durationMin: 30, urgency: 1,
    desc: '某个默默做了很久的事情——一项创作、一份工作、或一种坚持——被人在公开场合提起来了。不是客套的夸奖，是有人真的看到了其中的用心，并且说了出来。被理解的感觉和被赞扬的感觉同时涌上来，分不清哪个更多。' },
  { key: 'surprise_invitation', name: '意想不到的邀请', durationMin: 25, urgency: 1,
    desc: '一个意料之外的邀请——来自一个没想到会想起自己的人、或一个没想到自己够格参与的场合。邀请本身就是一个信号：有人把角色放进了他们心里的某个名单。去不去另说——被放进去了这件事，本身就让人心情好了一截。' },
  { key: 'second_chance_news', name: '失而复得', durationMin: 30, urgency: 1,
    desc: '一个以为已经错过了的机会——关门了、过期了、或自己主动放弃了的——又回来了。不是努力争取来的，就是某个条件变了、某个人想起了角色、或命运突然觉得该给第二次。窗口重新打开的那一瞬间，比第一次得到机会还让人心跳。' },
  { key: 'lucky_timing', name: '刚好赶上', durationMin: 20, urgency: 1,
    desc: '一个稍纵即逝的好事——恰好被自己碰上了。不是提前知道、不是有内幕消息、就是刚好在对的时间站在了对的地方。那一瞬间的运气好得像被人安排好的一样。捡到宝的心情里混着一点得意——今天是我的天。' },
  { key: 'mystery_blessing', name: '天上掉馅饼', durationMin: 25, urgency: 1,
    desc: '一份来路不明的好意——匿名、间接、或通过一个"我也不知道为什么给你"的渠道——落到了角色头上。没有附加条件、没有隐形代价、就是纯粹的"有人想让ta高兴"。不知道是谁、不知道为什么——但今天确实被这个世界善待了一次。' },
];

/**
 * 根据角色条件筛选可用的事件类型
 * 目前全部可用，后续可以根据好感度/标签过滤
 */
function getAvailableEventTypes(character, db) {
  return EVENT_TYPES;
}

// 事件类别 → VAD 情绪偏移（被 chat.js 情绪引擎消费，纯规则零 LLM 开销）
// 正值=提升(V愉悦/A兴奋/D支配感)，负值=降低，范围 [-0.30, +0.45]
const EVENT_VAD_MODIFIERS = {
  // ═══ 日常节奏被打乱 ═══ — V:[-0.15,0], A:[+0.1,+0.35], D:[-0.15,0]
  routine_broken:        { valence:-0.10, arousal: 0.20, dominance:-0.10 },
  running_late:          { valence:-0.15, arousal: 0.35, dominance:-0.15 },
  lost_something:        { valence:-0.10, arousal: 0.15, dominance:-0.10 },
  something_broke:       { valence:-0.15, arousal: 0.25, dominance:-0.15 },

  // ═══ 人际交集 ═══ — 混合：好奇/压力/失控
  stranger_approach:     { valence:-0.10, arousal: 0.25, dominance:-0.15 },
  witness_moment:        { valence:-0.15, arousal: 0.35, dominance:-0.15 },
  put_on_spot:           { valence:-0.25, arousal: 0.35, dominance:-0.30 },

  // ═══ 机会与诱惑 ═══ — 正面为主，带不确定性
  unexpected_offer:      { valence: 0.15, arousal: 0.25, dominance: 0.10 },
  found_item:            { valence: 0.10, arousal: 0.25, dominance: 0.05 },
  tempting_path:         { valence: 0.10, arousal: 0.20, dominance: 0.15 },

  // ═══ 小危机 ═══ — 高压、负价
  mistake_looming:       { valence:-0.30, arousal: 0.35, dominance:-0.25 },
  caught_awkward:        { valence:-0.30, arousal: 0.35, dominance:-0.30 },
  emergency_minor:       { valence:-0.25, arousal: 0.45, dominance:-0.15 },

  // ═══ 新鲜事与发现 ═══
  overheard_info:        { valence:-0.15, arousal: 0.25, dominance:-0.10 },
  new_curiosity:         { valence: 0.25, arousal: 0.20, dominance: 0.10 },

  // ═══ 两难与冒险 ═══
  two_fires:             { valence:-0.30, arousal: 0.35, dominance:-0.25 },
  leap_of_faith:         { valence: 0.10, arousal: 0.30, dominance: 0.15 },
  someone_needs_help:    { valence:-0.10, arousal: 0.25, dominance: 0.05 },

  // ═══ 一个人的道德瞬间 ═══ — 内疚/诱惑/责任，静水深流
  broke_something_secret:{ valence:-0.25, arousal: 0.30, dominance:-0.15 },
  forbidden_to_look:     { valence: 0.10, arousal: 0.25, dominance: 0.10 },

  // ═══ 日常里的异物 ═══ — 好奇+兴奋，"世界比想的大"
  flea_market_find:      { valence: 0.25, arousal: 0.25, dominance: 0.15 },
  mystery_vial:          { valence: 0.15, arousal: 0.30, dominance: 0.10 },
  phantom_shop:          { valence: 0.25, arousal: 0.30, dominance: 0.15 },
  vending_mystery:       { valence: 0.15, arousal: 0.25, dominance: 0.05 },

  // ═══ 喜讯降临 ═══ — 纯粹愉悦：V全正、A中高（好消息天然唤醒兴奋）、D全正（喜讯提升自我效能感）
  unexpected_approval:   { valence: 0.30, arousal: 0.30, dominance: 0.20 },  // 惊喜+"原来我也配"
  public_recognition:    { valence: 0.25, arousal: 0.20, dominance: 0.25 },  // 被看见+被理解，支配感强
  surprise_invitation:   { valence: 0.25, arousal: 0.30, dominance: 0.15 },  // 被纳入名单的兴奋
  second_chance_news:    { valence: 0.25, arousal: 0.25, dominance: 0.15 },  // 窗口重开的心跳加速
  lucky_timing:          { valence: 0.25, arousal: 0.35, dominance: 0.15 },  // 刚好赶上的兴奋
  mystery_blessing:      { valence: 0.20, arousal: 0.20, dominance: 0.10 },  // 被世界善待，温和暖意
};
/**
 * 根据事件类型 key 获取对应的 VAD 情绪偏移量
 * @param {string} eventTypeKey
 * @returns {{ valence: number, arousal: number, dominance: number } | null}
 */
export function getEventVadModifier(eventTypeKey) {
  return EVENT_VAD_MODIFIERS[eventTypeKey] || null;
}

export function getUrgencyLevel(eventTypeKey) {
  const found = EVENT_TYPES.find(e => e.key === eventTypeKey);
  return found ? found.urgency : 1;
}

/**
 * 生成特殊事件
 *
 * @param {object} character - 角色行
 * @param {object} [options] - 可选参数
 * @param {string} [options.eventTypeKey] - 指定事件类型 key（不指定则随机）
 * @param {boolean} [options.manual] - 是否为手动触发（调试用）
 */
export async function generateEvent(character, options = {}) {
  const db = getDb();
  const now = new Date();

  // 1. 选事件类型
  const available = getAvailableEventTypes(character, db);
  let eventType;
  if (options.eventTypeKey) {
    eventType = available.find(e => e.key === options.eventTypeKey);
    if (!eventType) throw new Error(`Unknown event type: ${options.eventTypeKey}`);
  } else if (options.customPrompt) {
    // 用户自定义事件动机：跳过随机选类型，使用自定义提示
    eventType = {
      key: 'custom',
      name: '自定义事件',
      durationMin: 5,
      urgency: 1,
      desc: options.customPrompt,
    };
    console.log(`[eventGen] Custom event for ${character.display_name}: "${options.customPrompt.slice(0, 60)}..."`);
  } else {
    eventType = available[Math.floor(Math.random() * available.length)];
  }

  // 2. 并发保护：检查该角色是否已有活跃事件
  const existing = db.prepare(
    `SELECT id FROM character_events WHERE character_id = ? AND status IN ('pending','open','engaged') LIMIT 1`
  ).get(character.id);
  if (existing) {
    console.log(`[eventGen] ${character.display_name} already has an active event (id=${existing.id})`);
    throw new Error('ALREADY_ACTIVE_EVENT');
  }

  // 3. 构建上下文
  // 最近 1h 朋友圈
  const recentMoment = db.prepare(`
    SELECT content FROM moment_posts
    WHERE character_id = ? AND status = 'done'
      AND created_at >= datetime('now', '-1 hour')
    ORDER BY created_at DESC LIMIT 1
  `).get(character.id);

  // 角色关系网
  const relationships = db.prepare(`
    SELECT cr.relationship_text, c.display_name
    FROM character_relationships cr
    JOIN characters c ON c.id = cr.to_character_id
    WHERE cr.from_character_id = ? AND cr.relationship_text != ''
  `).all(character.id);

  // 多人关系：sigmoid 模型，照搬朋友圈算法但降低频率
  // P(多人) = P_min + (P_max - P_min) / (1 + e^(-k * (R - R_mid)))
  const relCount = relationships.length;
  const MULTI_P_MIN = 0.10;  // 1人也保持 10% 随机到关系网对象的概率
  const MULTI_P_MAX = 0.50;  // 社交达人趋于 50%
  const MULTI_K = 1.0;       // 陡峭度
  const MULTI_R_MID = 5;     // 拐点：R=5 时概率 = 30%

  let multiPerson = null;
  if (relCount > 0) {
    const multiProb = MULTI_P_MIN + (MULTI_P_MAX - MULTI_P_MIN) / (1 + Math.exp(-MULTI_K * (relCount - MULTI_R_MID)));
    console.log(`[eventGen] ${character.display_name} relCount=${relCount}, multiProb=${(multiProb * 100).toFixed(0)}%`);

    if (Math.random() < multiProb) {
      const allRels = db.prepare(`
        SELECT cr.relationship_text,
               c.id AS other_id, c.display_name AS other_name, c.base_prompt AS other_prompt
        FROM character_relationships cr
        JOIN characters c ON c.id = cr.to_character_id
        WHERE cr.from_character_id = ? AND cr.relationship_text != ''
      `).all(character.id);

      const picked = allRels[Math.floor(Math.random() * allRels.length)];
      const otherPersona = picked.other_prompt.replace(/你/g, picked.other_name);

      // 查反向关系，双向注入
      const reverseRel = db.prepare(`
        SELECT relationship_text FROM character_relationships
        WHERE from_character_id = ? AND to_character_id = ? AND relationship_text != ''
      `).get(picked.other_id, character.id);

      let relDesc = `${character.display_name}是${picked.other_name}的${picked.relationship_text}`;
      if (reverseRel) {
        relDesc += `，${picked.other_name}是${character.display_name}的${reverseRel.relationship_text}`;
      }

      multiPerson = {
        otherName: picked.other_name,
        otherPersona,
        relDesc,
      };
      console.log(`[eventGen] Multi-person event: ${character.display_name} + ${picked.other_name} (${relDesc})`);
    }
  }

  // 4. 生成初始场景
  const worldSetting = getWorldSetting();
  const jailbreakPrompt = worldSetting
    ? getSystemRulesWithWorld({ roleplay: false })
    : getSystemRules({ roleplay: false });
  const imageRules = getGlobalRule('image_prompt');
  const imageRulesText = imageRules?.rule_content || '';

  const weekDay = ['周日','周一','周二','周三','周四','周五','周六'][now.getDay()];
  const timeTag = `[当前时间 ${weekDay} ${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}]`;

  let contextBlock = '';
  if (recentMoment) {
    contextBlock += `\n关联线索——${character.display_name}一小时前刚发了朋友圈："${recentMoment.content}"。事件素材可以与此呼应，提高关联性。\n`;
  }

  // 将角色人格中的"你"替换为角色名（保留引号内对话不变，简单正则处理）
  const displayName = character.display_name;
  const personaText = character.base_prompt.replace(/你/g, displayName);

  // [0] 第三人称叙事声明 + jailbreak + 世界观（有世界观时注入整合指令，无世界观时跳过）
  const worldIntegrationBlock = worldSetting ? `
<world_integration priority="highest">
上述世界观设定不是可有可无的背景说明——它是这个虚构世界的基本法则，定义了这个世界里什么是正常的、人与人之间如何互动、社会如何运转。以下所有创作必须在这个世界观的框架内展开：

1. 角色的所有行为、反应和判断，都必须以世界观为基准线。世界观塑造了角色的常识和三观——角色觉得什么理所当然、什么值得惊讶、什么不可接受，都由世界观决定，不由现实世界的常识决定。
2. 事件中"异常"的判定标准来自世界观。一个事件是否奇怪、是否危险、是否值得在意，取决于它在这个世界里的相对位置——在现实世界显得离奇的事，在这个世界里可能稀松平常，反之亦然。
3. 环境描写要自然地渗透世界观的细节。场景中的每一个元素——空间、物品、氛围、人群——都应该一致地属于这个世界，不能出现与世界观矛盾的描写。
4. 不要把世界观当成一段可以忽略的"前置说明"。它必须穿透到叙事中的每一个感官细节、每一个角色反应、每一个情节转折。世界观不是背景，是地基。
</world_integration>
` : '';

  const directorSystem = `${jailbreakPrompt}
${worldIntegrationBlock}
你正在为「${displayName}」生成一段特殊事件的开场叙事——所谓"特殊事件"，就是在角色当下的日常中撕开了一道口子的某个瞬间。它可以大（紧急状况、陌生人闯入、一个改变轨迹的邀约），也可以小（迟到了、东西丢了、一个没来由的情绪涌上来），可以是正面的（惊喜、发现、心动），也可以是负面的（危机、尴尬、暴露），可以"奇"——但不是必须奇。

你的任务是写出这个"口子被撕开"的瞬间——紧密第三人称叙事（close third-person narration），读者看到的是关于「${displayName}」的生动叙述。

铁律——违反以下任何一条即视为失败：
- 指代角色只用「她」「他」「ta」「${displayName}」，绝对、绝对不要使用「你」字
- 叙事中不存在一个被称呼的"你"——这不是第二人称游戏文本，这是第三人称小说叙事
- 使用自由间接引语（free indirect discourse）：第三人称代词，但浸透角色的即时感受

叙事原则：
- 从具体的感官细节开始——声音、画面、身体感受
- 展现身体反应而非命名情绪："手心渗出细密的汗"而非"ta感到紧张"
- 结尾卡在角色必须做出选择的那个点——不是在写结局，是在打开一个需要立刻面对的瞬间
- **最重要的是**：这个事件必须像是为${displayName}量身定做的。换个角色就不成立——不是情节不成立，是反应方式、关注点、内心活动不成立。`;

  // [1] 角色人格（"你"已替换为角色名，去角色扮演化）
  let personaMsg = `以下是角色「${displayName}」的人格设定，供你了解角色的外貌、性格和行为模式：

${personaText}`;

  if (multiPerson) {
    personaMsg += `\n\n---\n以下是${multiPerson.otherName}的人格设定（${multiPerson.relDesc}），供事件涉及多人互动时参考：

${multiPerson.otherPersona}`;
  }

  // [2] JSON 格式
  const multiPersonImageNote = multiPerson
    ? `**多人画面**：prompt 中必须包含${displayName}和${multiPerson.otherName}两个人。描述清楚各自的外观、位置、互动动作。用句号分隔两人描述。`
    : '';

  // 解析 image_prompt 规则的 {"prompt":"..."} JSON，提取其中的 prompt 指令文本
  const imagePromptInstruction = parseImagePromptRule(imageRulesText)
    || '≥8个外观锚点，角色名用character(series)格式';

  const formatPrompt = `请严格按照以下 JSON 格式输出，不要任何解释或额外文字：

{"title":"事件标题（8字以内，从本次事件的具体细节中提炼——一个让人想点进去看的标题）","description":"场景叙述（紧密第三人称，80-150字。从感官细节切入，展开角色的即时反应，结尾卡在选择点上。铁律：不使用'你'字，始终用ta/她/他。重要：事件方向只是一个出发点——具体场景必须由角色人格和世界观驱动，不要产出可以被复制粘贴到其他角色身上的通用故事）","prompt":"画面描述（英文。${imagePromptInstruction}）${multiPersonImageNote}","choiceA":"选项A（具体行动，8-15字。与B形成真正的行动对比）","choiceB":"选项B（与A形成真正的行动对比——介入vs抽身/直接vs迂回/面对vs回避/现在vs稍后。8-15字）"}

选项设计原则：
- A和B必须是性质完全不同的两条行动路径——读者立刻感受到它们通往不同的情绪走向
- 避免两个"本质上差不多"的选项
- 根据场景选择最合适的对比维度：做vs不做、直面vs绕开、自己解决vs求助、立刻vs等等、坦白vs保留、介入vs旁观`;

  // [3] 创作任务
  const multiPersonNote = multiPerson
    ? `\n**多人事件**：${multiPerson.relDesc}。事件中应包含${multiPerson.otherName}作为互动对象，描述ta们之间的互动方式、肢体距离和氛围要贴合两人的真实关系。`
    : '';

  const worldPenetrationLine = worldSetting
    ? '- **世界观穿透**：这个事件发生在上述世界观中，不是发生在真空或现实世界中。所有感官细节（街头景象、路人行为、空气气味、社交礼仪）和角色反应（身体本能、社交判断、情感触发点）必须忠实地在世界观规则下展开。事件方向只是一个叙事钩子——它的具体呈现方式必须被世界观重新塑造。\n'
    : '';

  const directorPrompt = `事件方向：**${eventType.name}**——${eventType.desc}
${contextBlock}
${timeTag}${multiPersonNote}

**关键理解**：上面的事件方向只指了一个大概的方向——它不是剧本，里面没有任何具体的场景设定。你的任务是把方向翻译成${displayName}今天此刻实际遇到的事情。

基于以下素材来创作：
- ${displayName}的人格：外貌、性格、行为模式、说话方式——这是最重要的创作来源
- ${worldSetting ? '世界观的基本法则——这个世界里什么是日常、什么算特殊，由世界观决定' : '现实世界背景——以真实世界的日常为基准'}
- 当前时间：${timeTag}——事件发生在这个时间点，场景细节要贴合
- ${multiPerson ? '与' + multiPerson.otherName + '的关系——互动要贴合两人的真实关系' : '角色近期的状态——事件应该自然地嵌入角色的生活中'}
${contextBlock ? '- ' + contextBlock.trim() : ''}

请以紧密第三人称创作这个特殊事件的开场。要求：
${worldPenetrationLine}- 从一个感官细节开始——声音、画面、身体感受——而不是背景介绍
- 场景长度 80-150 字，结尾卡在角色必须做出选择的那个点
- 这个事件不需要惊天动地——它只需要在${displayName}今天的日常中撕开一道值得注意的口子。可以是温暖的、尴尬的、紧张的、好奇的、或微妙不安的——方向决定基调，角色人格决定具体样貌
- 两个选项的行动路径要形成真正的岔路口——选A和选B通往不同的情绪走向。每条路径的后果应该让读者"没想到但回头想又合理"
- **最重要**：这个事件必须像是为${displayName}量身定做的。如果可以把主角名字换成另一个人而故事依然成立——那就是失败的。`;

  const msgs = [
    { role: 'system', content: directorSystem },
    { role: 'system', content: personaMsg },
    { role: 'system', content: formatPrompt },
    { role: 'user', content: directorPrompt },
  ];

  let eventData;
  let rawResult = '';
  try {
    rawResult = await chatSync(msgs, { temperature: 0.82, max_tokens: 1024, label: '奇遇生成' });
    const jsonStr = extractFirstJson(rawResult);
    if (!jsonStr) throw new Error('No JSON found in LLM response');
    eventData = JSON.parse(repairJson(jsonStr));
    // field 兼容：imagePrompt / prompt 两种写法都接受
    const imagePromptText = eventData.prompt || eventData.imagePrompt;
    if (!eventData.title || !eventData.description || !eventData.choiceA || !eventData.choiceB) {
      throw new Error('Incomplete event data from LLM');
    }
    eventData.prompt = imagePromptText;
  } catch (err) {
    console.error(`[eventGen] LLM generation failed for ${character.display_name}:`, err.message);
    console.log(`[eventGen] Raw LLM response:\n${rawResult}`);
    throw err;
  }

  // 5. 生图
  let imageUrl = null;
  try {
    const genResult = await generateImageRaw(eventData.prompt, {
      artist: config.comfyui.eventArtist,
      width: config.comfyui.eventWidth,
      height: config.comfyui.eventHeight,
    });
    if (genResult.success && genResult.images.length > 0) {
      await fsp.mkdir(imagesDir, { recursive: true });
      const img = genResult.images[0];
      const filename = `event_${Date.now()}_${img.filename || 'comfy.png'}`;
      const base64Data = img.base64.replace(/^data:image\/\w+;base64,/, '');
      await fsp.writeFile(path.join(imagesDir, filename), Buffer.from(base64Data, 'base64'));
      imageUrl = `/images/${filename}`;
      console.log(`[eventGen] Image generated for ${character.display_name}: ${imageUrl}`);
    } else {
      console.warn(`[eventGen] Image generation returned no images for ${character.display_name}`);
    }
  } catch (err) {
    console.error(`[eventGen] Image generation failed for ${character.display_name}:`, err.message);
    // 无图片也继续
  }

  // 6. 写入 DB — 初始场景作为 choice_history[0]
  const initialChoiceEntry = [{
    branch: 0,
    choice_label: '事件开始',
    choice_text: '',
    summary: eventData.description,
    image: imageUrl,
    // 存储多人模式信息，供后续分支生成时复用
    multiPerson: multiPerson ? { otherName: multiPerson.otherName, otherPersona: multiPerson.otherPersona, relDesc: multiPerson.relDesc } : null,
  }];
  const expiresAt = new Date(now.getTime() + eventType.durationMin * 60 * 1000).toISOString();

  const insertResult = db.prepare(`
    INSERT INTO character_events (character_id, event_type_key, status, title, description, image, prompt, style, resolution, choice_a, choice_b, choice_c_label, current_branch, max_branches, choice_history, expires_at)
    VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
  `).run(
    character.id,
    eventType.key,
    eventData.title,
    eventData.description,
    imageUrl,
    eventData.prompt,
    config.comfyui.eventArtist,
    `${config.comfyui.eventWidth}x${config.comfyui.eventHeight}`,
    eventData.choiceA,
    eventData.choiceB,
    eventData.choiceCLabel || '自由行动',
    JSON.stringify(initialChoiceEntry),
    toSQLite(expiresAt)
  );
  const eventId = insertResult.lastInsertRowid;

  // 7. 构建返回数据
  const event = db.prepare(`SELECT * FROM character_events WHERE id = ?`).get(eventId);

  // 8. SSE 广播
  broadcastNewEvent({
    id: event.id,
    character_id: event.character_id,
    display_name: character.display_name,
    avatar_path: character.avatar_path || null,
    title: event.title,
    description: event.description,
    image: event.image,
    choice_a: event.choice_a,
    choice_b: event.choice_b,
    choice_c_label: event.choice_c_label,
    expires_at: toISO(event.expires_at),
    created_at: toISO(event.created_at),
    current_branch: event.current_branch,
    choice_history: JSON.parse(event.choice_history || '[]'),
  });

  console.log(`[eventGen] Event created for ${character.display_name}: "${event.title}" (type=${eventType.key}, expires=${expiresAt})`);
  return event;
}

/**
 * 生成下一步分支
 */
export async function generateNextBranch(character, event, choice) {
  const db = getDb();
  const now = new Date();

  // 0. 原子性标记处理中（CAS：仅 processing=0 时置 1），防止并发重复提交
  // 如果已有其他请求在处理中，直接抛出错误，避免：
  //   - 两次 LLM 调用浪费 token / 并发生图压垮 ComfyUI
  //   - 浏览器 HTTP/1.1 6 连接限制下，双 choose 请求挤占剩余连接导致其他 API 排队 23s+
  const casResult = db.prepare(
    `UPDATE character_events SET processing = 1 WHERE id = ? AND processing = 0`
  ).run(event.id);
  if (casResult.changes === 0) {
    throw new Error('EVENT_ALREADY_PROCESSING');
  }

  // 1. 检查是否过期
  const expiresAt = new Date(event.expires_at + 'Z');
  if (now >= expiresAt) {
    db.prepare(`UPDATE character_events SET processing = 0 WHERE id = ?`).run(event.id);
    await concludeEvent(character, event, event.engaged ? 'completed' : 'expired');
    return null;
  }

  // 2. 加载关系网
  const relationships = db.prepare(`
    SELECT cr.relationship_text, c.display_name
    FROM character_relationships cr
    JOIN characters c ON c.id = cr.to_character_id
    WHERE cr.from_character_id = ? AND cr.relationship_text != ''
  `).all(character.id);

  // 2.5 检查是否为多人模式（从 choice_history[0] 读取初始事件时存储的 multiPerson 数据）
  const choiceHistory = JSON.parse(event.choice_history || '[]');
  const storedMultiPerson = choiceHistory.length > 0 ? choiceHistory[0].multiPerson : null;
  let multiPerson2 = null;
  if (storedMultiPerson) {
    multiPerson2 = {
      otherName: storedMultiPerson.otherName,
      otherPersona: storedMultiPerson.otherPersona,
      relDesc: storedMultiPerson.relDesc,
    };
  }

  // 3. 构建 choice_history 文本
  let historyText = '';
  if (choiceHistory.length === 0) {
    historyText = `初始场景：${event.description}`;
  } else {
    historyText = choiceHistory.map((h, i) =>
      `第${i + 1}幕：推进「${h.choice_label}」→ ${h.summary}`
    ).join('\n');
  }
  // choice.customText 仅在非 C 选项时作为补充说明；C 选项的 label 已等于 customText
  const choiceExtra = choice.choice !== 'C' && choice.customText ? '——' + choice.customText : '';
  historyText += `\n剧情推进：${choice.label}${choiceExtra}`;

  // 4. LLM 生成下一步（try-catch 确保失败时清除 processing 标记）
  try {
  const worldSetting2 = getWorldSetting();
  const jailbreakPrompt = worldSetting2
    ? getSystemRulesWithWorld({ roleplay: false })
    : getSystemRules({ roleplay: false });
  const imageRules = getGlobalRule('image_prompt');
  const imageRulesText = imageRules?.rule_content || '';

  const displayName2 = character.display_name;
  const personaText2 = character.base_prompt.replace(/你/g, displayName2);

  const worldIntegrationBlock2 = worldSetting2 ? `
<world_integration priority="highest">
上述世界观设定不是可有可无的背景说明——它是这个虚构世界的基本法则，定义了这个世界里什么是正常的、人与人之间如何互动、社会如何运转。以下所有创作必须在这个世界观的框架内展开：

1. 角色的所有行为、反应和判断，都必须以世界观为基准线。世界观塑造了角色的常识和三观——角色觉得什么理所当然、什么值得惊讶、什么不可接受，都由世界观决定，不由现实世界的常识决定。
2. 事件中"异常"的判定标准来自世界观。一个事件是否奇怪、是否危险、是否值得在意，取决于它在这个世界里的相对位置——在现实世界显得离奇的事，在这个世界里可能稀松平常，反之亦然。
3. 环境描写要自然地渗透世界观的细节。场景中的每一个元素——空间、物品、氛围、人群——都应该一致地属于这个世界，不能出现与世界观矛盾的描写。
4. 不要把世界观当成一段可以忽略的"前置说明"。它必须穿透到叙事中的每一个感官细节、每一个角色反应、每一个情节转折。世界观不是背景，是地基。
</world_integration>
` : '';

  const directorSystem2 = `${jailbreakPrompt}
${worldIntegrationBlock2}
你正在为「${displayName2}」的特殊事件生成下一幕——一段紧密第三人称叙事。上一幕结束在一个选择点上，角色做出了选择，现在该展现选择之后发生的事情。

铁律（违反即失败）：
- 指代角色只用「她」「他」「ta」「${displayName2}」，绝对不要使用「你」
- 叙事中不存在被称呼的"你"——这是第三人称小说叙事，不是第二人称游戏文本
- 通过身体反应来展现角色的即时情绪变化，而非直接命名情绪`;

  let personaMsg2 = `以下是角色「${displayName2}」的人格设定，供你了解角色的外貌、性格和行为模式：

${personaText2}`;

  if (multiPerson2) {
    personaMsg2 += `\n\n---\n以下是${multiPerson2.otherName}的人格设定（${multiPerson2.relDesc}），供事件涉及多人互动时参考：

${multiPerson2.otherPersona}`;
  }

  const branchImagePromptInstruction = parseImagePromptRule(imageRulesText)
    || '描述场景、角色外观、动作、氛围';

  const multiPersonImageNote2 = multiPerson2
    ? `**多人画面**：prompt 中必须包含${displayName2}和${multiPerson2.otherName}两个人。描述清楚各自的外观、位置、互动动作。用句号分隔两人描述。`
    : '';

  const formatPrompt2 = `请严格按照以下 JSON 格式输出，不要任何解释或额外文字：

{"description":"选择后的场景叙述（紧密第三人称，80-150字。承接上一个选择的结果，从一个具体的感官细节开始，展现角色此刻的即时感受和新出现的局面。**场景转折要出乎意料但又在情理之中**——读者应该感到"居然会这样"但紧接着就觉得"仔细想确实会这样"）","prompt":"画面描述（英文。${branchImagePromptInstruction}）${multiPersonImageNote2}","choiceA":"新选项A（具体行动，与B形成真正的对比。8-15字）","choiceB":"新选项B（具体行动，与A性质不同。8-15字）"}

选项设计原则：
- A和B必须形成真正的行动对比，不要给本质上差不多的选项
- **每个选项的后果要出乎意料但又在情理之中**——读者选之前猜不到接下来会发生什么，但发生之后回头看会觉得"这个展开确实合理"`;

  // 只有多人模式才注入关系信息（和初始事件生成一致）
  const multiNote2 = multiPerson2
    ? `\n**多人事件**：${multiPerson2.relDesc}。事件中应包含${multiPerson2.otherName}作为主要互动对象，描述ta们之间的互动方式、肢体距离和氛围要贴合两人的真实关系。${relationships.map(r => `${displayName2}是${r.display_name}的${r.relationship_text}`).join('；')}`
    : '';

  const worldPenetrationLine2 = worldSetting2
    ? '- **世界观穿透**：这个事件发生在上述世界观中，不是发生在真空或现实世界中。所有感官细节（街头景象、路人行为、空气气味、社交礼仪）和角色反应（身体本能、社交判断、情感触发点）必须忠实地在世界观规则下展开。事件方向只是一个叙事钩子——它的具体呈现方式必须被世界观重新塑造。\n'
    : '';

  const directorPrompt2 = `事件标题：${event.title}
${historyText}${multiNote2}

**核心要求——让分支有趣**：接下来的场景不能是"选了A所以A发生了"的平铺直叙。读者选择之后应该经历一个"没想到会这样——但仔细一想确实合理"的转折。这个转折可以来自：
- 选择引发的连锁反应中，出现了角色没预料到的因素
- 某个之前被忽略的细节突然变得关键
- 另一个角色的反应方式出乎意料（但符合那个人的人设）
- 环境或时机带来了额外的变量

**重要提醒**：场景必须忠实于「${displayName2}」的人格——ta的反应方式、内心活动、决策逻辑，都应该让读者觉得"换了别人就不会这样"。

请以紧密第三人称创作选择之后发生的下一个场景。要求：
${worldPenetrationLine2}- 承接上一个选择的结果，从一个具体的感官细节开始
- 场景长度 80-150 字，展现角色此刻的即时感受和新出现的局面——其中至少有一个读者没预料到的元素
- 给出新的A和B选项（不要和之前的选项重复，保持故事持续发展）
- 新选项继续形成行动路径的对比——让玩家每一步都面临真正的岔路口`;

  // 上一幕画面注入：视觉参考帮助 LLM 保持画面连贯（叙事已有 historyText，此处仅补充视觉信息）
  const prevSceneMsg = event.prompt
    ? { role: 'system', content: `【上一幕画面 · 视觉参考】\n${event.prompt}` }
    : null;

  const msgs = [
    { role: 'system', content: directorSystem2 },
    { role: 'system', content: personaMsg2 },
    { role: 'system', content: formatPrompt2 },
    ...(prevSceneMsg ? [prevSceneMsg] : []),
    { role: 'user', content: directorPrompt2 },
  ];

  let branchData;
  let rawBranchResult = '';
  try {
    rawBranchResult = await chatSync(msgs, { temperature: 0.82, max_tokens: 1024, label: '事件分支' });
    const jsonStr = extractFirstJson(rawBranchResult);
    if (!jsonStr) throw new Error('No JSON found in LLM response');
    branchData = JSON.parse(repairJson(jsonStr));
    const branchPromptText = branchData.prompt || branchData.imagePrompt;
    if (!branchData.description) throw new Error('Incomplete branch data');
    branchData.prompt = branchPromptText || event.prompt;
  } catch (err) {
    console.error(`[eventGen] Branch generation failed:`, err.message);
    console.log(`[eventGen] Raw branch LLM response:\n${rawBranchResult}`);
    throw err;
  }

  // 5. 生图
  let imageUrl = null;
  try {
    const genResult = await generateImageRaw(branchData.prompt, {
      artist: config.comfyui.eventArtist,
      width: config.comfyui.eventWidth,
      height: config.comfyui.eventHeight,
    });
    if (genResult.success && genResult.images.length > 0) {
      await fsp.mkdir(imagesDir, { recursive: true });
      const img = genResult.images[0];
      const filename = `event_${Date.now()}_${img.filename || 'comfy.png'}`;
      const base64Data = img.base64.replace(/^data:image\/\w+;base64,/, '');
      await fsp.writeFile(path.join(imagesDir, filename), Buffer.from(base64Data, 'base64'));
      imageUrl = `/images/${filename}`;
      console.log(`[eventGen] Branch image generated: ${imageUrl}`);
    }
  } catch (err) {
    console.error(`[eventGen] Branch image generation failed:`, err.message);
  }

  // 6. 更新 choice_history 和 summary
  // 存储上一步的选项信息，用于撤回（undo）时恢复
  const newChoiceEntry = {
    branch: event.current_branch + 1,
    choice_label: choice.label,
    choice_text: choice.customText || '',
    summary: branchData.description,
    image: imageUrl,
    prev_choice_a: event.choice_a,
    prev_choice_b: event.choice_b,
    prev_choice_c_label: event.choice_c_label || '自由行动',
    prev_prompt: event.prompt || '',
  };
  choiceHistory.push(newChoiceEntry);

  // 7. 更新 DB（清除 processing 标记，不生成摘要——摘要只在结局时生成）
  db.prepare(`
    UPDATE character_events SET
      description = ?, image = ?, prompt = ?,
      choice_a = ?, choice_b = ?, choice_c_label = ?,
      current_branch = ?, choice_history = ?,
      engaged = 1, processing = 0, last_interaction_at = datetime('now')
    WHERE id = ?
  `).run(
    branchData.description, imageUrl, branchData.prompt,
    branchData.choiceA, branchData.choiceB, '自由行动',
    event.current_branch + 1, JSON.stringify(choiceHistory),
    event.id
  );

  // 8. 获取更新后的事件（事件只由时间到期结束）
  const updatedEvent = db.prepare(`SELECT * FROM character_events WHERE id = ?`).get(event.id);

  // 10. SSE 广播
  broadcastEventUpdate({
    id: updatedEvent.id,
    character_id: updatedEvent.character_id,
    display_name: character.display_name,
    avatar_path: character.avatar_path || null,
    title: updatedEvent.title,
    description: updatedEvent.description,
    image: updatedEvent.image,
    choice_a: updatedEvent.choice_a,
    choice_b: updatedEvent.choice_b,
    choice_c_label: updatedEvent.choice_c_label,
    current_branch: updatedEvent.current_branch,
    choice_history: JSON.parse(updatedEvent.choice_history || '[]'),
    expires_at: toISO(updatedEvent.expires_at),
    created_at: toISO(updatedEvent.created_at),
  });

    return updatedEvent;
  } catch (err) {
    db.prepare(`UPDATE character_events SET processing = 0 WHERE id = ?`).run(event.id);
    throw err;
  }
}

/**
 * 生成结局并存入记忆
 */
export async function concludeEvent(character, event, outcome) {
  const db = getDb();
  console.log(`[eventGen] Concluding event "${event.title}" for ${character.display_name} (engaged=${event.engaged}, outcome=${outcome})`);

  // 1. LLM 生成结局和摘要
  const worldSetting3 = getWorldSetting();
  const permissionPrompt = worldSetting3
    ? getSystemRulesWithWorld()
    : getSystemRules();
  const worldIntegrationNote = worldSetting3
    ? `<world_integration priority="highest">
上述世界观设定是最高优先级的创作框架。结局叙述和记忆摘要必须在这个世界观的框架下展开——角色的行为逻辑、事件的因果链条、环境的细节描写，都要忠实于世界观的基本法则。世界观定义了角色判断"正常"与"异常"的基准线，结局的收束方式不能偏离这条基准线。
</world_integration>`
    : null;

  const choiceHistory = JSON.parse(event.choice_history || '[]');
  const historyText = choiceHistory.length > 0
    ? choiceHistory.map((h, i) => `第${i + 1}步：${h.choice_label} → ${h.summary}`).join('\n')
    : `角色经历了：${event.description}（未与用户互动）`;

  const worldConsistencyLine = worldSetting3
    ? '- **世界观一致性**：结局和记忆摘要必须反映世界观的基本规则。角色做出的选择及其后果、环境的反应、事件的收束方式，都必须在世界观框架内自然发生。\n'
    : '';

  const taskPrompt = event.engaged
    ? `为以下特殊事件生成结局叙述和记忆摘要。
事件标题：${event.title}
${historyText}
当前场景：${event.description}

要求：
${worldConsistencyLine}- 结局叙述 80-150 字，收束整个事件的来龙去脉，给故事一个自然的结果
- 记忆摘要 150-300 字，用第三人称视角客观记录整个事件的起因、经过、转折和结果，作为角色长期记忆的一部分

**重要：输出严格 JSON 格式**
{"conclusion":"结局叙述","summary":"记忆摘要（第三人称，包含完整的事件经过）"}`
    : `角色刚刚经历了一场无人参与的特殊事件。请基于事件描述想象它会如何自然结束。
事件标题：${event.title}
${historyText}

要求：
${worldConsistencyLine}- 结局叙述 80-150 字
- 记忆摘要 150-300 字，用第三人称视角客观记录事件

**重要：输出严格 JSON 格式**
{"conclusion":"结局叙述","summary":"记忆摘要（第三人称）"}`;

  const msgs = [
    { role: 'system', content: permissionPrompt },
    ...(worldIntegrationNote ? [{ role: 'system', content: worldIntegrationNote }] : []),
    { role: 'system', content: character.base_prompt },
    { role: 'user', content: taskPrompt },
  ];

  let conclusionData;
  try {
    const result = await chatSync(msgs, { temperature: 0.7, max_tokens: 1024, label: '事件结局' });
    const jsonStr = extractFirstJson(result);
    if (!jsonStr) throw new Error('No JSON found');
    conclusionData = JSON.parse(repairJson(jsonStr));
    if (!conclusionData.summary) throw new Error('No summary generated');
  } catch (err) {
    console.error(`[eventGen] Conclusion generation failed:`, err.message);
    conclusionData = {
      conclusion: event.engaged
        ? `故事告一段落。${character.display_name}从这次经历中有所收获。`
        : `这个偶然的际遇悄然结束，没有留下太多痕迹。`,
      summary: `${character.display_name}经历了一场"${event.title}"——${event.description}。结局：${outcome === 'completed' ? '事件顺利完成。' : '事件因时间流逝而自然结束。'}`,
    };
  }

  // 2. 存入记忆
  const conversationId = `char_${character.id}`;
  const fragmentType = 'fact';

  try {
    const entities = JSON.stringify([character.display_name, event.title]);

    // 摘要文本：仅结论（用于 memory_fragments + 聊天注入，避免全量分支撑爆上下文）
    const summaryText = `【事件】${event.title}\n${conclusionData.summary}`;

    // 完整文本：全部分支（用于 ChromaDB 向量检索，使事件细节也可被语义召回）
    const parsedHistory = JSON.parse(event.choice_history || '[]');
    let fullVectorText = `【事件】${event.title}\n开始：${event.description}`;
    for (const h of parsedHistory) {
      if (h.branch === 0) continue;
      fullVectorText += `\n选择了：「${h.choice_label}」→ ${h.summary}`;
    }
    fullVectorText += `\n结局：${conclusionData.summary}`;

    if (!event.engaged) {
      db.prepare(`
        DELETE FROM memory_fragments
        WHERE conversation_id = ? AND fragment_type = 'fact' AND content LIKE '【未互动的事件】%'
      `).run(conversationId);
      console.log(`[eventGen] Replaced old unengaged event memory for ${character.display_name}`);
    }

    const contentWithTag = event.engaged
      ? `【事件·已完成】${summaryText}`
      : `【未互动的事件】${summaryText}`;

    const insertResult = db.prepare(`
      INSERT INTO memory_fragments (conversation_id, fragment_type, content, entities)
      VALUES (?, ?, ?, ?)
    `).run(conversationId, fragmentType, contentWithTag, entities);

    // 向量化存入 RAG
    try {
      await upsertVector({
        id: `event_${insertResult.lastInsertRowid}`,
        text: fullVectorText, // 向量检索用完整分支文本，提高召回
        metadata: {
          conversation_id: conversationId,
          fragment_type: 'event',
          character_name: character.display_name,
          event_title: event.title,
          engaged: event.engaged,
        },
      });
    } catch (vecErr) {
      console.warn(`[eventGen] Vector upsert failed for event memory:`, vecErr.message);
    }
  } catch (memErr) {
    console.error(`[eventGen] Memory save failed:`, memErr.message);
  }

  // 3. 移到 event_history（保留原始 ID，确保分享卡片等引用不失效）
  db.prepare(`
    INSERT INTO event_history (id, character_id, event_type_key, title, description, final_image, summary, choice_history, total_branches, engaged, outcome)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id,
    character.id, event.event_type_key,
    event.title, event.description, event.image,
    conclusionData.summary,
    event.choice_history, event.current_branch || 0,
    event.engaged, outcome
  );

  // 4. 删除活跃事件
  db.prepare(`DELETE FROM character_events WHERE id = ?`).run(event.id);

  // 5. SSE 广播
  broadcastEventConclusion({
    character_id: character.id,
    character_name: character.display_name,
    event_title: event.title,
    conclusion: conclusionData.conclusion,
    summary: conclusionData.summary,
    outcome,
    engaged: event.engaged,
  });

  console.log(`[eventGen] Event concluded: "${event.title}" → ${outcome}`);
}

/**
 * 生成运行中的事件摘要（每步更新）
 */
// ── 工具函数 ──

function toSQLite(iso) {
  if (!iso) return iso;
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
}

// 修复 LLM 输出的非法 JSON 转义（image_prompt 规则中的 \( \) 等不是合法 JSON 转义）
function repairJson(text) {
  return text.replace(/\\([^"\\\/bfnrtu])/g, '$1');
}

// 从 LLM 原始输出中提取第一个完整 JSON 对象（括号计数，防 LLM 输出多段 JSON 拼在一起）
function extractFirstJson(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null; // 括号未闭合
}

/**
 * 解析 image_prompt 规则的 {"prompt":"..."} JSON 格式
 * 成功则返回 prompt 字段内容，失败返回 null
 *
 * rule_content 可能包含：(1) 真实换行符（JSON 不允许）(2) 非法转义序列如 \(
 * 两步清洗后再解析
 */
function parseImagePromptRule(ruleContent) {
  if (!ruleContent) return null;
  try {
    // Step 1: 真实控制字符 → JSON 合法转义
    let sanitized = ruleContent
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t');
    // Step 2: 非法转义序列（如 \( → (）
    sanitized = repairJson(sanitized);
    // Step 3: 解析
    const parsed = JSON.parse(sanitized);
    return parsed.prompt || null;
  } catch {
    return null;
  }
}

function toISO(dt) {
  if (!dt) return dt;
  return dt.replace(' ', 'T') + '.000Z';
}
