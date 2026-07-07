/**
 * 朋友圈关系网互动服务
 *
 * 帖子发布后，关系网中的角色有概率来评论区互动：
 *   1. Sigmoid 概率判断 → 层叠选朋友（第1个必选，之后每个 50%）
 *   2. 朋友首轮评论（含双方人格 + 世界观 + 帖子原文）
 *   3. 发帖人必定回复
 *   4. 30% 连锁继续，最多 3 轮（全帖累计）
 *
 * 与用户操作完全解耦——用户评论走 moments.js 原有逻辑。
 */

import { getDb, getSystemRules, getSystemRulesWithWorld, getWorldSetting } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { config } from '../config.js';
import { broadcast as broadcastToUnified } from './unifiedStreamBus.js';
import { cropPersonalityForEmotion } from './emotionEngine.js';

// Sigmoid 参数（与 moments.js 多人模式一致）
const MULTI_P_MIN = 0.30;
const MULTI_P_MAX = 0.80;
const MULTI_K = 1.0;
const MULTI_R_MID = 5;

// ──────────────── 工具函数 ────────────────

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 统计帖子当前已用的互动轮数（朋友评论次数 = 朋友发了多少条）
 */
function countUsedRounds(db, postId, posterId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS cnt FROM moment_comments
    WHERE post_id = ? AND auto_trigger = 1 AND author_id != ?
  `).get(postId, posterId);
  return row?.cnt || 0;
}

// ──────────────── SSE 广播 ────────────────

/**
 * 广播新评论到统一 SSE 流，前端实时接收
 */
function broadcastNewComment(commentData) {
  broadcastToUnified('new_comment', commentData);
}

// ──────────────── LLM 生成函数 ────────────────

/**
 * 获取角色的 short_prompt（第三人称摘要），优先用 DB 预计算值，缺失时动态生成
 */
function getShortPrompt(char, name) {
  if (char.short_prompt || char.other_short_prompt) return char.short_prompt || char.other_short_prompt;
  const bp = char.base_prompt || char.other_prompt;
  if (bp) return cropPersonalityForEmotion(bp, name);
  return '';
}

/**
 * 将评论线程上下文格式化为文本
 */
function formatThreadContext(threadComments, friendName, posterName, userName) {
  return threadComments.map(c => {
    const name = c.author_type === 'character'
      ? (c.author_id === c._posterId ? posterName : friendName)
      : userName;
    return `${name}：${c.content}`;
  }).join('\n');
}

/**
 * 朋友首轮评论（看到帖子后的第一反应）
 */
async function generateFriendInitialComment(friend, posterChar, post, relDesc) {
  const worldSetting = getWorldSetting();
  const permissionPrompt = worldSetting
    ? getSystemRulesWithWorld()
    : getSystemRules();
  const worldIntegrationNote = worldSetting
    ? `<world_integration priority="highest">
上述世界观设定不是可有可无的背景说明——它是这个虚构世界的基本法则。以下所有创作必须在这个世界观的框架内展开。
</world_integration>`
    : null;

  // 关系描述转自然语言（发帖人视角 → 朋友视角）
  // relDesc 格式: "{friendName}是你的{relationship}"（从发帖人视角）
  // 需要反转: "你（朋友）是{posterName}的{relationship}"
  const posterName = posterChar.display_name || posterChar.name;
  const friendName = friend.other_name;

  // 其他人（发帖人）的人设 + 关系 → 单独 system，用 short_prompt（第三人称）避免人称混淆
  const posterShortPrompt = getShortPrompt(posterChar, posterName);
  const otherContext = posterShortPrompt
    ? `关于${posterName}：\n${posterShortPrompt}\n\n你和${posterName}的关系是：${relDesc.replace(friendName + '是你的', `你是${posterName}的`)}`
    : null;

  const contextTask = `${posterName}刚刚在朋友圈发了一条动态：
---
${post.content}
---

请以你的身份（${friendName}），在${posterName}的朋友圈评论区留一条自然的评论。
规则：
- 15~50 字，自然口语化，像熟人之间刷朋友圈随口评论一样
- 保持你自身的人设和语气
- 可以调侃、关心、吐槽、点赞——看你的性格和你们的关系
- 不用刻意称呼对方名字，熟人之间不需要每句都叫
- 只输出评论文本，不要带任何前缀或引号`;

  const msgs = [{ role: 'system', content: permissionPrompt }];
  if (worldIntegrationNote) msgs.push({ role: 'system', content: worldIntegrationNote });
  msgs.push({ role: 'system', content: friend.other_prompt });
  if (otherContext) msgs.push({ role: 'system', content: otherContext });
  msgs.push({ role: 'system', content: contextTask });

  msgs.push({ role: 'user', content: '去评论区留个言吧：' });

  const result = await chatSync(msgs, { temperature: 0.8, max_tokens: 128, label: '朋友首评' });
  return result.trim().replace(/^["']|["']$/g, '').slice(0, 200);
}

/**
 * 发帖人回复朋友的评论
 */
async function generatePosterReplyToFriend(posterChar, friend, post, friendComment, threadContext) {
  const worldSetting = getWorldSetting();
  const permissionPrompt = worldSetting
    ? getSystemRulesWithWorld()
    : getSystemRules();
  const worldIntegrationNote = worldSetting
    ? `<world_integration priority="highest">
上述世界观设定不是可有可无的背景说明——它是这个虚构世界的基本法则。以下所有创作必须在这个世界观的框架内展开。
</world_integration>`
    : null;

  const posterName = posterChar.display_name || posterChar.name;
  const friendName = friend.other_name;

  let threadSection = '';
  if (threadContext && threadContext.length > 0) {
    const userName = config.user.nickname || '用户';
    threadSection = `\n评论区你们之前的对话（供上下文参考，避免重复）：\n---\n${formatThreadContext(threadContext, friendName, posterName, userName)}\n---\n`;
  }

  // 其他人（朋友）的人设 + 关系 → 单独 system，用 short_prompt（第三人称）避免人称混淆
  const friendShortPrompt = getShortPrompt(friend, friendName);
  const otherContext = friendShortPrompt
    ? `${friendName}是你${friend.relationship_text}，她的人设是：\n${friendShortPrompt}`
    : null;

  const contextTask = `你的朋友圈帖子：
---
${post.content}
---

${friendName}在你的朋友圈评论了：${friendComment}${threadSection}
请以你的身份自然回复${friendName}的评论。
规则：
- 15~50 字，自然口语化，像熟人聊天一样随意
- 保持你自身的人设和语气
- 可以参考上下文但不要重复自己说过的话
- 只输出回复文本，不要带任何前缀或引号`;

  const msgs = [{ role: 'system', content: permissionPrompt }];
  if (worldIntegrationNote) msgs.push({ role: 'system', content: worldIntegrationNote });
  msgs.push({ role: 'system', content: posterChar.base_prompt });
  if (otherContext) msgs.push({ role: 'system', content: otherContext });
  msgs.push({ role: 'system', content: contextTask });

  msgs.push({ role: 'user', content: `回复${friendName}的最后一条评论：` });

  const result = await chatSync(msgs, { temperature: 0.75, max_tokens: 128, label: '发帖人回朋友' });
  return result.trim().replace(/^["']|["']$/g, '').slice(0, 200);
}

/**
 * 朋友续评（30% 连锁触发后的再次回复）
 */
async function generateFriendContinuation(friend, posterChar, post, threadContext) {
  const worldSetting = getWorldSetting();
  const permissionPrompt = worldSetting
    ? getSystemRulesWithWorld()
    : getSystemRules();
  const worldIntegrationNote = worldSetting
    ? `<world_integration priority="highest">
上述世界观设定不是可有可无的背景说明——它是这个虚构世界的基本法则。以下所有创作必须在这个世界观的框架内展开。
</world_integration>`
    : null;

  const posterName = posterChar.display_name || posterChar.name;
  const friendName = friend.other_name;
  const userName = config.user.nickname || '用户';

  const threadText = formatThreadContext(threadContext, friendName, posterName, userName);

  // 其他人（发帖人）的人设 + 关系 → 单独 system，用 short_prompt（第三人称）避免人称混淆
  const posterShortPrompt = getShortPrompt(posterChar, posterName);
  const otherContext = posterShortPrompt
    ? `关于${posterName}：\n${posterShortPrompt}\n\n你和${posterName}的关系是：你是${posterName}的${friend.relationship_text}`
    : null;

  const contextTask = `${posterName}的朋友圈帖子：
---
${post.content}
---

评论区你们的对话（从上到下）：
---
${threadText}
---

现在轮到你回复了。请以你的身份（${friendName}）继续这段对话。
规则：
- 15~50 字，自然口语化，像熟人聊天一样随意
- 保持你自身的人设和语气
- 看上下文，不要重复自己说过的话，也别重复对方说过的话
- 可以顺着话题聊下去，也可以自然转移
- 只输出回复文本，不要带任何前缀或引号`;

  const msgs = [{ role: 'system', content: permissionPrompt }];
  if (worldIntegrationNote) msgs.push({ role: 'system', content: worldIntegrationNote });
  msgs.push({ role: 'system', content: friend.other_prompt });
  if (otherContext) msgs.push({ role: 'system', content: otherContext });
  msgs.push({ role: 'system', content: contextTask });

  msgs.push({ role: 'user', content: '继续聊天：' });

  const result = await chatSync(msgs, { temperature: 0.8, max_tokens: 128, label: '朋友续评' });
  return result.trim().replace(/^["']|["']$/g, '').slice(0, 200);
}

// ──────────────── 主逻辑 ────────────────

/**
 * 异步触发关系网朋友互动（主入口）
 * 在帖子发布完成后调用，不阻塞主流程
 */
export async function triggerFriendComments(post, character) {
  const db = getDb();

  // 1. 查关系网
  const relationships = db.prepare(`
    SELECT cr.relationship_text,
           c.id AS other_id, c.display_name AS other_name, c.base_prompt AS other_prompt,
           c.short_prompt AS other_short_prompt
    FROM character_relationships cr
    JOIN characters c ON c.id = cr.to_character_id
    WHERE cr.from_character_id = ? AND cr.relationship_text != ''
  `).all(character.id);

  const relCount = relationships.length;
  if (relCount === 0) {
    console.log(`[momentInteraction] ${character.display_name} 无关系网，跳过`);
    return;
  }

  // 2. Sigmoid 概率判断
  const prob = MULTI_P_MIN + (MULTI_P_MAX - MULTI_P_MIN) / (1 + Math.exp(-MULTI_K * (relCount - MULTI_R_MID)));
  console.log(`[momentInteraction] ${character.display_name} relCount=${relCount}, prob=${(prob * 100).toFixed(0)}%`);
  if (Math.random() >= prob) {
    console.log(`[momentInteraction] 概率未命中，post ${post.id} 不触发互动`);
    return;
  }

  // 3. 层叠选人：shuffle → 第1个必选 → 之后每个 50%，首次未命中即终止
  shuffle(relationships);
  const selected = [relationships[0]];
  for (let i = 1; i < relationships.length; i++) {
    if (Math.random() < 0.5) {
      selected.push(relationships[i]);
    } else {
      break;
    }
  }

  console.log(`[momentInteraction] post ${post.id} 选中 ${selected.length} 个朋友: ${selected.map(r => r.other_name).join(', ')}`);

  // 4. 串行执行线程（线程间 30~90s 随机延迟，模拟自然节奏）
  for (let i = 0; i < selected.length; i++) {
    if (i > 0) {
      const stagger = 30_000 + Math.random() * 60_000;
      console.log(`[momentInteraction] 等待 ${(stagger / 1000).toFixed(0)}s 后启动下个线程...`);
      await delay(stagger);
    }

    try {
      await runInteractionThread(post, character, selected[i]);
    } catch (err) {
      console.error(`[momentInteraction] 线程失败 (${selected[i].other_name}):`, err.message);
    }
  }

  console.log(`[momentInteraction] post ${post.id} 全部互动线程结束`);
}

/**
 * 执行单条互动线程：
 *   friend 评论 → poster 回复 → (30% 循环继续，最多 3 轮)
 */
async function runInteractionThread(post, posterChar, friend) {
  const db = getDb();
  const posterId = posterChar.id;
  const posterName = posterChar.display_name || posterChar.name;
  const friendName = friend.other_name;

  // 检查帖子是否还存在
  if (!db.prepare('SELECT id FROM moment_posts WHERE id = ?').get(post.id)) {
    console.log(`[momentInteraction] post ${post.id} 已删除，放弃线程`);
    return;
  }

  // 检查睡眠（朋友角色不回复）
  try {
    if (config.features.schedule !== false) {
      const { isSleeping } = await import('./scheduleManager.js');
      if (isSleeping(friend.other_id)?.sleeping) {
        console.log(`[momentInteraction] ${friendName} 在睡觉，跳过`);
        return;
      }
    }
  } catch { /* schedule not available */ }

  // 检查已用轮数
  if (countUsedRounds(db, post.id, posterId) >= 3) {
    console.log(`[momentInteraction] post ${post.id} 已满 3 轮，跳过`);
    return;
  }

  const relDesc = `${friendName}是你的${friend.relationship_text}`;

  // ── Step 1: 朋友首轮评论 ──
  console.log(`[momentInteraction] ${friendName} → 首轮评论 post ${post.id}`);
  const friendComment = await generateFriendInitialComment(friend, posterChar, post, relDesc);

  const ins1 = db.prepare(`
    INSERT INTO moment_comments (post_id, author_type, author_id, content, auto_trigger, thread_root_id)
    VALUES (?, 'character', ?, ?, 1, NULL)
  `).run(post.id, friend.other_id, friendComment);
  const threadRootId = ins1.lastInsertRowid;
  db.prepare('UPDATE moment_comments SET thread_root_id = ? WHERE id = ?').run(threadRootId, threadRootId);

  // 获取头像路径用于 SSE 广播
  const friendAvatar = db.prepare('SELECT avatar_path FROM characters WHERE id = ?').get(friend.other_id)?.avatar_path;

  broadcastNewComment({
    post_id: post.id,
    comment: {
      id: threadRootId,
      post_id: post.id,
      author_type: 'character',
      author_id: friend.other_id,
      content: friendComment,
      char_display_name: friendName,
      char_avatar_path: friendAvatar,
      reply_to_name: null,  // 首轮评论，不回复任何人
      auto_trigger: 1,
      thread_root_id: threadRootId,
      created_at: new Date().toISOString(),
    },
  });

  await delay(10_000 + Math.random() * 20_000); // 10~30s

  // ── Step 2: 发帖人回复（必定） ──
  console.log(`[momentInteraction] ${posterName} → 回复 ${friendName}`);
  const posterReply = await generatePosterReplyToFriend(posterChar, friend, post, friendComment, null);

  const ins2 = db.prepare(`
    INSERT INTO moment_comments (post_id, author_type, author_id, content, auto_trigger, thread_root_id)
    VALUES (?, 'character', ?, ?, 1, ?)
  `).run(post.id, posterId, posterReply, threadRootId);

  broadcastNewComment({
    post_id: post.id,
    comment: {
      id: ins2.lastInsertRowid,
      post_id: post.id,
      author_type: 'character',
      author_id: posterId,
      content: posterReply,
      char_display_name: posterName,
      char_avatar_path: posterChar.avatar_path,
      reply_to_name: friendName,  // 发帖人回复朋友
      auto_trigger: 1,
      thread_root_id: threadRootId,
      created_at: new Date().toISOString(),
    },
  });

  await delay(10_000 + Math.random() * 20_000);

  // ── Step 3: 30% 连锁继续 ──
  let round = 1;
  const userName = config.user.nickname || '用户';
  const posterAvatar = posterChar.avatar_path;

  while (round < 3) {
    if (countUsedRounds(db, post.id, posterId) >= 3) {
      console.log(`[momentInteraction] 满 3 轮（已用 ${countUsedRounds(db, post.id, posterId)} 轮），停止续评`);
      break;
    }

    const roll = Math.random();
    if (roll >= 0.3) {
      console.log(`[momentInteraction] 续评骰子: ${roll.toFixed(3)} >= 0.3 → 未命中，${friendName} 线程在第 ${round} 轮后停止`);
      break;
    }
    console.log(`[momentInteraction] 续评骰子: ${roll.toFixed(3)} < 0.3 → 命中！${friendName} 进入第 ${round + 1} 轮`);

    round++;

    // 加载线程上下文
    const threadComments = db.prepare(`
      SELECT mc.content, mc.author_type, mc.author_id,
             CASE WHEN mc.author_type = 'character' THEN c.display_name ELSE ? END AS display_name
      FROM moment_comments mc
      LEFT JOIN characters c ON c.id = mc.author_id
      WHERE mc.thread_root_id = ?
      ORDER BY mc.created_at ASC
    `).all(userName, threadRootId);

    // 标注 poster ID 以便 formatThreadContext 区分
    for (const tc of threadComments) tc._posterId = posterId;

    // 朋友续评
    console.log(`[momentInteraction] ${friendName} → 续评 round ${round}`);
    const friendCont = await generateFriendContinuation(friend, posterChar, post, threadComments);

    const insF = db.prepare(`
      INSERT INTO moment_comments (post_id, author_type, author_id, content, auto_trigger, thread_root_id)
      VALUES (?, 'character', ?, ?, 1, ?)
    `).run(post.id, friend.other_id, friendCont, threadRootId);

    broadcastNewComment({
      post_id: post.id,
      comment: {
        id: insF.lastInsertRowid,
        post_id: post.id,
        author_type: 'character',
        author_id: friend.other_id,
        content: friendCont,
        char_display_name: friendName,
        char_avatar_path: friendAvatar,
        reply_to_name: posterName,  // 朋友续评，回复发帖人
        auto_trigger: 1,
        thread_root_id: threadRootId,
        created_at: new Date().toISOString(),
      },
    });

    await delay(10_000 + Math.random() * 20_000);

    // 发帖人回复
    const threadComments2 = db.prepare(`
      SELECT mc.content, mc.author_type, mc.author_id,
             CASE WHEN mc.author_type = 'character' THEN c.display_name ELSE ? END AS display_name
      FROM moment_comments mc
      LEFT JOIN characters c ON c.id = mc.author_id
      WHERE mc.thread_root_id = ?
      ORDER BY mc.created_at ASC
    `).all(userName, threadRootId);
    for (const tc of threadComments2) tc._posterId = posterId;

    const posterReply2 = await generatePosterReplyToFriend(posterChar, friend, post, friendCont, threadComments2);

    const insP = db.prepare(`
      INSERT INTO moment_comments (post_id, author_type, author_id, content, auto_trigger, thread_root_id)
      VALUES (?, 'character', ?, ?, 1, ?)
    `).run(post.id, posterId, posterReply2, threadRootId);

    broadcastNewComment({
      post_id: post.id,
      comment: {
        id: insP.lastInsertRowid,
        post_id: post.id,
        author_type: 'character',
        author_id: posterId,
        content: posterReply2,
        char_display_name: posterName,
        char_avatar_path: posterAvatar,
        reply_to_name: friendName,  // 发帖人回复朋友续评
        auto_trigger: 1,
        thread_root_id: threadRootId,
        created_at: new Date().toISOString(),
      },
    });

    await delay(10_000 + Math.random() * 20_000);
  }

  console.log(`[momentInteraction] ${friendName} 线程结束，共 ${round} 轮`);
}
