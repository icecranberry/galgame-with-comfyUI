/**
 * 群聊后台调度器
 *
 * 线路 A · 预算制后台闲聊：
 *   - 每 10 分钟扫描 next_idle_at <= now 且 idle_enabled=1 的群，每次只处理一个（串行）
 *   - 每群每日轮数预算 group_chats.idle_budget（默认 2），每个群独立计数：触发一次减一
 *   - 用户在群里发言或跨天时自动恢复为默认值 2
 *   - 预算当天用满后不再触发，直到用户发言重置或跨天自动恢复
 *   - 闲聊后随机设定 0~24 小时内的下次时间（全天候随机，任意时刻都可能），消息经统一 SSE 总线广播
 *
 * 线路 B · 角色自发建群：
 *   - 每 6 小时判定一次，30% 概率触发
 *   - 选一个好感度 >= 60 且有关系出边的角色，拉 1~2 个关系角色建群
 *   - 成员集合查重防重复建群；LLM 生成群名；开场闲聊一轮
 */
import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { chatSync } from '../llm/llm-client.js';
import { broadcast } from './unifiedStreamBus.js';
import { getGroupWithMembers, runGroupRound } from './groupChatEngine.js';
import { loadAffinity } from './emotionEngine.js';

const IDLE_CHECK_INTERVAL = 10 * 60 * 1000;       // 10 分钟
const CREATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 小时
const CREATE_PROBABILITY = 0.3;
const MAX_AUTO_GROUPS = 3;                        // 自发建群总数上限
// 临时关闭角色自发创建群聊；保留完整流程，后续恢复时改为 true 即可。
const AUTO_GROUP_CREATION_ENABLED = false;

let idleTimer = null;
let createTimer = null;
let processing = false;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 消耗一次预算；预算耗尽返回 false。预算为每群独立计数 group.idle_budget（默认 2），跨天懒重置 */
function consumeIdleBudget(db, group) {
  const budget = group.idle_budget ?? 2;
  if (budget <= 0) return false;
  const today = todayStr();
  const used = group.idle_budget_date === today ? (group.idle_budget_used || 0) : 0;
  if (used >= budget) return false;
  db.prepare(`UPDATE group_chats SET idle_budget_date = ?, idle_budget_used = ? WHERE id = ?`)
    .run(today, used + 1, group.id);
  return true;
}

function scheduleNextIdle(db, groupId, minHours = 0, maxHours = 24) {
  const delayMs = minHours * 3600_000 + Math.random() * (maxHours - minHours) * 3600_000;
  const next = new Date(Date.now() + delayMs).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  db.prepare(`UPDATE group_chats SET next_idle_at = ? WHERE id = ?`).run(next, groupId);
}

async function idleTick() {
  if (!config.features.groupChat) return;
  if (processing) return;

  const db = getDb();
  try {
    const candidate = db.prepare(`
      SELECT * FROM group_chats
      WHERE idle_enabled = 1
        AND (next_idle_at IS NULL OR next_idle_at <= datetime('now'))
      ORDER BY next_idle_at ASC NULLS FIRST
      LIMIT 1
    `).get();
    if (!candidate) return;

    // 预算检查（当天已满 → 本次不触发，随机推迟 0~24 小时；跨天或用户发言重置后自动恢复）
    if (!consumeIdleBudget(db, candidate)) {
      scheduleNextIdle(db, candidate.id);
      console.log(`[groupIdle] budget exhausted for group ${candidate.id}, deferred 0-24h (resume on user reset or next day)`);
      return;
    }

    processing = true;
    console.log(`[groupIdle] idle chatter for group ${candidate.id} 「${candidate.name}」...`);
    try {
      const { messages } = await runGroupRound(candidate.id, {
        trigger: 'idle',
        emit: (event, data) => {
          if (event === 'group_msg') broadcast('group_message', data);
          if (event === 'generate_start') broadcast('group_image_start', data);
          if (event === 'generate_done') broadcast('group_image_done', data);
          if (event === 'generate_error') broadcast('group_image_error', data);
        },
      });
      console.log(`[groupIdle] group ${candidate.id} produced ${messages.length} message(s)`);
    } catch (err) {
      console.error(`[groupIdle] round failed for group ${candidate.id}:`, err.message);
    } finally {
      scheduleNextIdle(db, candidate.id);
    }
  } catch (err) {
    console.error('[groupIdle] tick error:', err.message);
  } finally {
    processing = false;
  }
}

// ── 角色自发建群 ──

async function maybeCreateGroup() {
  if (!AUTO_GROUP_CREATION_ENABLED) return;
  if (!config.features.groupChat) return;
  if (Math.random() > CREATE_PROBABILITY) return;

  const db = getDb();
  try {
    const autoCount = db.prepare(`SELECT COUNT(*) AS c FROM group_chats WHERE created_by = 'character'`).get().c;
    if (autoCount >= MAX_AUTO_GROUPS) return;

    // 候选发起人：有关系出边的角色，按好感度过滤
    const initiators = db.prepare(`
      SELECT DISTINCT c.id, c.display_name FROM characters c
      JOIN character_relationships cr ON cr.from_character_id = c.id AND cr.relationship_text != ''
      WHERE (c.is_sleeping IS NULL OR c.is_sleeping = 0)
    `).all().filter(c => loadAffinity(c.id) >= 60);
    if (initiators.length === 0) return;

    const initiator = initiators[Math.floor(Math.random() * initiators.length)];
    const related = db.prepare(`
      SELECT to_character_id AS id FROM character_relationships
      WHERE from_character_id = ? AND relationship_text != ''
    `).all(initiator.id);
    if (related.length === 0) return;

    // 拉 1~2 个关系角色
    const shuffled = related.sort(() => Math.random() - 0.5);
    const memberIds = [initiator.id, ...shuffled.slice(0, 1 + Math.floor(Math.random() * 2)).map(r => r.id)];
    const uniqueIds = [...new Set(memberIds)].sort((a, b) => a - b);
    if (uniqueIds.length < 2) return;

    // 成员集合查重：已有完全相同成员集合的群则不重复建
    const existing = db.prepare(`SELECT id FROM group_chats`).all();
    for (const g of existing) {
      const ids = db.prepare(`SELECT character_id FROM group_members WHERE group_id = ? ORDER BY character_id`).all(g.id).map(r => r.character_id);
      if (ids.length === uniqueIds.length && ids.every((v, i) => v === uniqueIds[i])) {
        console.log(`[groupIdle] identical member set already exists (group ${g.id}), skip auto-create`);
        return;
      }
    }

    const chars = uniqueIds.map(id => db.prepare('SELECT id, display_name FROM characters WHERE id = ?').get(id)).filter(Boolean);
    const chatUserName = config.user.nickname || '用户';

    // LLM 起群名（失败用兜底名）
    let groupName = '';
    try {
      const raw = await chatSync([
        { role: 'user', content: `${initiator.display_name}想拉${chars.filter(c => c.id !== initiator.id).map(c => c.display_name).join('、')}和${chatUserName}建一个微信群闲聊。请给这个群起一个 8 字以内、俏皮自然的群名。只输出群名本身，不要引号和解释。` },
      ], { temperature: 0.7, max_tokens: 24, label: '群名生成' });
      groupName = (raw || '').trim().replace(/^["'「」『』]|["'「」『』]$/g, '').slice(0, 16);
    } catch { /* fallback below */ }
    if (!groupName) groupName = chars.map(c => c.display_name).slice(0, 3).join('、') + '的小群';

    const result = db.prepare(`
      INSERT INTO group_chats (name, created_by, creator_character_id, next_idle_at)
      VALUES (?, 'character', ?, datetime('now', '+' || (60 + abs(random()) % 180) || ' minutes'))
    `).run(groupName, initiator.id);
    const groupId = result.lastInsertRowid;
    const ins = db.prepare(`INSERT OR IGNORE INTO group_members (group_id, character_id) VALUES (?, ?)`);
    for (const c of chars) ins.run(groupId, c.id);

    console.log(`[groupIdle] 🎉 ${initiator.display_name} created group ${groupId} 「${groupName}」 with [${chars.map(c => c.display_name).join(', ')}]`);

    const group = getGroupWithMembers(groupId);
    broadcast('group_created', {
      id: groupId,
      name: groupName,
      creator_character_id: initiator.id,
      creator_name: initiator.display_name,
      members: group.members.map(m => ({ id: m.id, display_name: m.display_name, avatar_path: m.avatar_path })),
    });

    // 开场暖场一轮（消耗一次当日预算）
    if (consumeIdleBudget(db, db.prepare('SELECT * FROM group_chats WHERE id = ?').get(groupId))) {
      await runGroupRound(groupId, {
        trigger: 'opening',
        emit: (event, data) => {
          if (event === 'group_msg') broadcast('group_message', data);
          if (event === 'generate_start') broadcast('group_image_start', data);
          if (event === 'generate_done') broadcast('group_image_done', data);
          if (event === 'generate_error') broadcast('group_image_error', data);
        },
      });
    }
  } catch (err) {
    console.error('[groupIdle] auto-create error:', err.message);
  }
}

export function startGroupIdleScheduler() {
  console.log('[groupIdle] Starting (idle interval:', IDLE_CHECK_INTERVAL / 60000, 'min, per-group budget: group_chats.idle_budget (default 2/day))');
  setTimeout(() => {
    idleTick();
    idleTimer = setInterval(idleTick, IDLE_CHECK_INTERVAL);
  }, 60_000);
  if (AUTO_GROUP_CREATION_ENABLED) {
    // 启动 5 分钟后首次判定自发建群，之后每 6 小时。
    setTimeout(() => {
      maybeCreateGroup();
      createTimer = setInterval(maybeCreateGroup, CREATE_CHECK_INTERVAL);
    }, 5 * 60_000);
  } else {
    console.log('[groupIdle] Character auto group creation is temporarily disabled');
  }
}

export function stopGroupIdleScheduler() {
  if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
  if (createTimer) { clearInterval(createTimer); createTimer = null; }
  console.log('[groupIdle] Stopped');
}
