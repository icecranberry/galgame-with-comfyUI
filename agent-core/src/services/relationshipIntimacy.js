/**
 * relationshipIntimacy.js — 角色间关系的「亲密度」分级
 *
 * ── 为什么需要它 ──
 *
 * 朋友圈的多人场景原本只看「关系条数」：有 1 条关系就 ≥50% 概率拉人同框，R=5 时 65%。
 * 但关系文本表达的是**关系类型**，不是亲密许可 —— 本机实测银狼的 5 条关系全是
 * 「网红漫画家 / 公司女总裁 / 吵闹的网友 / 麻烦的警官」这类职业或泛泛之交，
 * 却被拉进「晚上一起睡」的画面。原因是**「有关系」被当成了「可以同框」**。
 *
 * 本模块把两个独立的维度分开：
 *   - 亲密度（泛泛 ↔ 亲密）→ 决定**画面尺度**（社交距离 vs 私密）
 *   - 关系类型本身       → 决定**能否自然同框**（按亲密度分层给概率）
 *
 * ── 取值来源（优先级从高到低）──
 *   1. `character_relationships.intimacy` 显式值（推演输出 / 用户在关系图里改）
 *   2. 关键词推断（本文件的 INFER_RULES）—— 兜住历史数据
 *   3. 默认「熟悉」——「有关系」至少意味着认识
 */
import { getDb } from '../db/index.js';

/**
 * 亲密度分级。`multiProb` 是「该角色进入多人场景」的概率，
 * 取**候选者中最高的亲密度**作为整轮的概率（有挚友就按挚友那一档算）。
 */
export const INTIMACY_LEVELS = [
  {
    level: 0,
    key: 'casual',
    label: '泛泛',
    multiProb: 0,          // 完全不参与多人场景
    sceneNote: '',
    desc: '职业性 / 对立 / 点头之交',
  },
  {
    level: 1,
    key: 'acquainted',
    label: '熟悉',
    multiProb: 0.15,
    desc: '相识但保持距离（网友、同事、警官）',
    sceneNote: '你们只是相识或有工作往来，画面必须停留在**公共或半公共场合**（街上、办公室、店门口、活动现场、网吧卡座），两人保持社交距离：不出现肢体接触、不进入私密空间（卧室 / 浴室 / 床 / 酒店房间）、衣着完整。',
  },
  {
    level: 2,
    key: 'close',
    label: '亲近',
    multiProb: 0.35,
    desc: '朋友 / 搭档（挚友、队友、后辈）',
    sceneNote: '你们是亲近的朋友或搭档，可以在私交场合同框（一起吃饭、打游戏、逛街、并肩坐着），允许自然的亲昵举动（勾肩、拍背、靠得近），但仍是**日常尺度**：不出现性场景、不出现裸露或半裸。',
  },
  {
    level: 3,
    key: 'intimate',
    label: '亲密',
    multiProb: 0.70,
    desc: '恋人 / 家人 / 誓约',
    sceneNote: '',         // 不做额外限制，交回世界观与既有 NSFW 规则
  },
];

const BY_LEVEL = new Map(INTIMACY_LEVELS.map(l => [l.level, l]));

/** 取分级元数据（越界或未设 → 默认「熟悉」） */
export function levelMeta(level) {
  const n = Number(level);
  return BY_LEVEL.get(Number.isInteger(n) ? n : 1) || BY_LEVEL.get(1);
}

/**
 * 关键词推断规则。**按顺序匹配，先命中先返回**，所以：
 *   - `exact` 放最前（处理「塑料姐妹花」这类字面像亲密、实为反讽的说法）
 *   - 然后从高到低（亲密 → 亲近 → 熟悉 → 泛泛），避免「恋人」被「朋友」抢先命中
 */
const INFER_RULES = [
  // ① 特例优先：字面误导的说法
  { level: 1, exact: ['塑料姐妹花', '塑料兄弟情', '表面朋友', '酒肉朋友', '点头之交'] },

  // ② 亲密：恋爱 / 家庭
  { level: 3, words: [
    '恋人', '爱人', '情人', '情侣', '伴侣', '配偶', '老公', '老婆', '妻子', '丈夫',
    '男友', '女友', '男朋友', '女朋友', '未婚妻', '未婚夫', '婚约', '誓约', '订婚', '定亲',
    '家人', '亲生', '双胞胎', '姐妹', '兄弟', '兄妹', '姐弟', '母亲', '父亲', '女儿', '儿子',
    '暗恋', '单恋', '痴迷', '心爱', '挚爱', '珍宝', '守护一生',
  ] },

  // ③ 亲近：朋友 / 搭档 / 有情感投入的关系
  //    「誓死 / 守护 / 珍藏」这类**情感强度词**说明不是泛泛之交 ——
  //    实测本库里「誓死追随的完美队长」「想要守护一生的珍宝」原本落到泛泛/熟悉，明显偏低。
  { level: 2, words: [
    '挚友', '死党', '密友', '至交', '知己', '闺蜜', '好友', '好兄弟', '好姐妹', '亲友',
    '搭档', '伙伴', '同伴', '队友', '战友', '同伙', '拍档',
    '青梅竹马', '发小', '一起长大', '形影不离', '出生入死',
    '誓死', '守护', '珍藏', '珍视', '亲密', '深情', '依赖', '舍不得', '心疼', '偏爱',
  ] },

  // ④ 熟悉：相识但保持距离
  { level: 1, words: [
    '网友', '同事', '同学', '邻居', '室友', '同屋', '同班', '同袍', '同僚', '同好', '同行', '同院', '同校',
    '学姐', '学妹', '学长', '学弟', '前辈', '后辈',
    '熟人', '旧识', '朋友', '干部', '班长', '副手', '幕僚', '副官', '指挥官', '联络人', '后勤',
    '监护人', '保姆', '跟班', '小跟班',
  ] },

  // ⑤ 泛泛：职业 / 对立 / 疏远
  //    注意**不要**把「队长 / 会长」放进来 —— 实测「值得信赖的队长」「又怕又敬的队长大人」
  //    这类明显超出泛泛之交，交给默认档（熟悉）更准。
  { level: 0, words: [
    '陌生人', '路人', '生人', '不相识',
    '记者', '粉丝', '观众', '读者', '客户', '客人', '顾客', '委托人', '审批员', '审核',
    '警官', '警察', '治安官', '上司', '老板', '总裁', '董事', '主管', '下属', '员工', '秘书', '助理',
    '对手', '竞争者', '敌人', '宿敌', '仇人', '情敌', '死对头', '眼中钉', '惯犯',
    '提防', '留意', '监视', '警惕', '可疑', '危险', '黑影', '目标', '眼线', '卧底', '麻烦',
    '老师', '教师', '教授', '医生', '护士', '律师', '会计', '专员', '主任', '部长', '局长', '台长', '社长', '将军',
  ] },

  // ⑥ 纯职业头衔（正则）：泛泛。放最后，避免盖住前面的亲密/亲近词
  { level: 0, re: /(漫画家|设计师|工程师|程序员|作家|作者|画家|歌手|演员|主播|偶像|模特|运动员|教练|店长|厨师|司机|保安|大亨|巨子|神|官)$/ },
];

/**
 * 从关系文本推断亲密度。
 * 没命中任何规则时返回 1（熟悉）—— 「有关系」本身至少意味着认识，
 * 用最低的非零档比直接判成泛泛更安全（宁可少同框，也不要把熟人误判成陌生人）。
 */
export function inferIntimacy(text) {
  const t = String(text || '').trim();
  if (!t) return 1;
  for (const rule of INFER_RULES) {
    if (rule.exact && rule.exact.some(w => t === w)) return rule.level;
    if (rule.words && rule.words.some(w => t.includes(w))) return rule.level;
    if (rule.re && rule.re.test(t)) return rule.level;
  }
  return 1;
}

/** 取一条关系的亲密度：显式值优先，其次推断 */
export function resolveIntimacy(rel) {
  const explicit = rel?.intimacy;
  if (explicit !== null && explicit !== undefined && Number.isInteger(Number(explicit))) {
    return Number(explicit);
  }
  return inferIntimacy(rel?.relationship_text);
}

/**
 * 给角色 A 的候选关系分级。
 * @returns {Array<{rel, level, meta}>} 按亲密度降序（同分保持原序）
 */
export function rankCandidates(relationships) {
  return (relationships || [])
    .map(rel => ({ rel, level: resolveIntimacy(rel), meta: levelMeta(resolveIntimacy(rel)) }))
    .sort((a, b) => b.level - a.level);
}

/**
 * 按候选人中最高的亲密度决定「是否进入多人场景」。
 * 泛泛（0）不参与 —— 只要候选全是泛泛，就永远单人。
 * @returns {{ go: boolean, prob: number, best: object|null }}
 */
export function rollMultiPerson(ranked) {
  const best = ranked.find(c => c.level >= 1) || null;
  if (!best) return { go: false, prob: 0, best: null };
  return { go: Math.random() < best.meta.multiProb, prob: best.meta.multiProb, best };
}

/**
 * 多人画面的尺度约束文本。
 *
 * 取所选角色里**最低**的亲密度作为整幅画面的约束 —— 保守优先：
 * 一桌人里只要有一个泛泛之交，就不该出现亲昵画面。
 */
export function buildSceneConstraint(persons) {
  const levels = (persons || []).map(p => Number(p.intimacyLevel) || 0);
  if (!levels.length) return '';
  const minLevel = Math.min(...levels);
  const notes = [];
  for (const p of persons) {
    notes.push(`${p.otherName}与你的关系是「${p.relText || p.relDesc}」`);
  }
  const constraint = levelMeta(minLevel).sceneNote;
  const head = `**同框尺度（必须遵守）**：${notes.join('；')}。`;
  return constraint ? `${head}\n${constraint}` : head;
}

/**
 * 把库里所有 `intimacy` 为空的关系统统按关键词写成显式值。
 *
 * **默认不调用** —— 留空（NULL）时读取会实时按文本推断，改文本即跟着变，这是更好的默认行为。
 * 本函数是给「想冻结当前推断结果、然后批量改」这类维护场景用的一次性工具（幂等，可重复跑）。
 */
export function backfillIntimacy() {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, relationship_text FROM character_relationships WHERE intimacy IS NULL`
  ).all();
  if (!rows.length) return { updated: 0 };
  const upd = db.prepare('UPDATE character_relationships SET intimacy = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const r of rows) upd.run(inferIntimacy(r.relationship_text), r.id);
  });
  tx();
  return { updated: rows.length };
}
