/**
 * 用户评论流程：帖主回评 / @ 点名回复 / 楼中楼回评
 *
 * - 普通评论：帖主（角色帖）回复——原有行为，prompt 结构保持不变（另带上首图画面描述）。
 * - 评论里 @ 了角色：被点名的角色来回复（@ 优先，替代默认的帖主回复）。
 * - 楼中楼（reply_to_comment_id）：被回复评论的作者回评；
 *   被回复的是用户/自己时回落到帖主（角色帖），保持评论区始终有人接话。
 * 回复统一落 reply_to_comment_id（指向被回应的用户评论）+ thread_root_id（所在楼层线程）。
 *
 * LLM 可通过 deps.chatSync 注入，便于测试。
 */

import { getDb, getSystemRules, getSystemRulesWithWorld, getWorldSetting } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { config } from '../config.js';
import { getCoreDialogueRules, getWorldIntegrationRule } from '../builtinRules.js';
import { loadEmotionState, stateToPrompt, loadAffinity, affinityToPrompt, cropPersonalityForEmotion } from './emotionEngine.js';
import { MOMENT_COMMENT_RULES, buildMomentImagePromptNote } from './momentForms.js';
import { userNickname, loadCommentHistory, isCharacterSleeping } from './momentUserPostService.js';

/** 单条用户评论最多触发几个角色回复（@ 多人时截断，防止 LLM 调用失控） */
const MAX_REPLIERS_PER_COMMENT = 4;

/**
 * 从评论文本解析 @ 点名的角色。
 * @param {string} content 评论文本（形如「@林小姐 说得对」）
 * @param {Array<{id, name, display_name}>} characters 全量角色
 * 长名优先匹配避免子串误伤（@小美美 不算 @小美）；同一角色只命中一次。
 */
export function parseMentionedCharacters(content, characters) {
  const text = String(content || '');
  if (!text.includes('@')) return [];

  const found = [];
  const takenSpans = [];
  const candidates = (characters || [])
    .flatMap(c => [c.display_name, c.name]
      .filter(Boolean)
      .map(name => ({ char: c, name })))
    .sort((a, b) => b.name.length - a.name.length);

  for (const { char, name } of candidates) {
    if (found.some(c => c.id === char.id)) continue;
    const token = '@' + name;
    let idx = text.indexOf(token);
    while (idx !== -1) {
      const end = idx + token.length;
      // 名字后面不能紧跟文字字符（防止「@小美美」被「@小美」抢匹配）
      const nextChar = text[end];
      const boundaryOk = !nextChar || !/[\u4e00-\u9fa5A-Za-z0-9]/.test(nextChar);
      const overlapped = takenSpans.some(([s, e]) => idx < e && s < end);
      if (boundaryOk && !overlapped) {
        found.push(char);
        takenSpans.push([idx, end]);
        break;
      }
      idx = text.indexOf(token, idx + 1);
    }
  }
  return found;
}

/**
 * 角色回复用户的评论（帖主回评 / @ 点名 / 楼中楼回评 共用）
 * prompt 结构与原 routes/moments.js generateCharacterReply 保持一致。
 * @param {object} character 回复者（完整 characters 行）
 * @param {object} post 帖子行（含 display_name / base_prompt 等帖主冗余字段）
 * @param {Array} historyComments 评论区历史（含刚写入的用户评论）
 * @param {{ isMentioned?: boolean, isThreadReply?: boolean, deps?: object }} opts
 */
export async function generateCharacterCommentReply(character, post, historyComments, opts = {}) {
  const db = getDb();
  const userName = userNickname();
  const u = config.user;
  let userPersona = u.appearance || u.persona || '你最重要的朋友';
  if (u.gender) userPersona = `[性别：${u.gender}] ${userPersona}`;

  const displayName = character.display_name || character.name;
  const isPostAuthor = post.character_id != null && character.id === post.character_id;

  // 评论区对话历史
  const historyById = new Map(historyComments.map(c => [c.id, c]));
  const commentAuthorName = (comment) => comment?.author_type === 'character'
    ? (comment.display_name || '某位朋友')
    : userName;
  const formatCommentLine = (comment) => {
    if (!comment) return '';
    const replyTo = historyById.get(comment.reply_to_comment_id);
    const replyPrefix = replyTo ? `（回复 ${commentAuthorName(replyTo)}）` : '';
    return `${commentAuthorName(comment)}${replyPrefix}：${comment.content}`;
  };
  const commentHistory = historyComments.map(formatCommentLine).filter(Boolean).join('\n');

  // 用户→角色关系
  let userRelMsg = '';
  const userRel = db.prepare(
    'SELECT relationship_text, is_oath FROM user_relationships WHERE character_id = ?'
  ).get(character.id);
  if (userRel && userRel.relationship_text) {
    userRelMsg = `**【你与user的关系】\n你对于user而言的身份是${userRel.relationship_text}。**这个关系为最高优先级，请在回复中自然体现。`;
  }
  if (userRel?.is_oath) {
    userRelMsg += `\n\n**【特殊羁绊】**\n你和user之间有一个比普通关系更深一层的约定——user曾经郑重地送过你一枚戒指。这代表了独一无二的羁绊和承诺。在回复时，你的行为和情感会自然地带有"你是我最重要的人"的底色。`;
  }

  // 角色间关系（双向）
  let charRelMsg = '';
  const charRels = db.prepare(`
    SELECT 'from' AS direction, cr.relationship_text, c.display_name
    FROM character_relationships cr
    JOIN characters c ON c.id = cr.to_character_id
    WHERE cr.from_character_id = ? AND cr.relationship_text != ''
    UNION ALL
    SELECT 'to' AS direction, cr.relationship_text, c.display_name
    FROM character_relationships cr
    JOIN characters c ON c.id = cr.from_character_id
    WHERE cr.to_character_id = ? AND cr.relationship_text != ''
  `).all(character.id, character.id);

  if (charRels.length > 0) {
    const relLines = charRels.map(r => {
      if (r.direction === 'from') {
        return `- ${r.display_name}是你的${r.relationship_text}`;
      } else {
        return `- ${r.display_name}认为你是她的${r.relationship_text}`;
      }
    }).join('\n');
    charRelMsg = `**【你与其他角色的关系】**\n${relLines}\n\n请在回复中自然体现这些关系，不必刻意说明。你的人设可能会有其他的性格，但是在私下里，你的关系网就是这样的，在回复里不用完全保持公开人设，以私下关系为最高优先级。`;
  }

  // 权限层
  const worldSettingReply = getWorldSetting();
  const permissionPrompt = worldSettingReply
    ? getSystemRulesWithWorld()
    : getSystemRules();
  const worldIntegrationNoteReply = worldSettingReply
    ? getWorldIntegrationRule('momentReply')
    : null;

  // 情绪状态 + 好感度
  let emotionPrompt = '';
  let affPrompt = '';
  if (config.features.emotion) {
    const convId = `char_${character.id}`;
    const emotionBaseline = character.emotion_baseline
      ? JSON.parse(character.emotion_baseline)
      : { valence: 0.5, arousal: 0.5, dominance: 0.5 };
    const emotionState = loadEmotionState(convId, emotionBaseline);
    emotionPrompt = stateToPrompt(emotionState) || '';

    const affinity = loadAffinity(character.id);
    affPrompt = affinityToPrompt(affinity) || '';
  }

  // 任务：帖主视角 vs 其他角色视角，框架略有不同
  const isUserPost = post.character_id == null && post.npc_id == null;
  const postAuthorName = isUserPost ? userName : (post.display_name || displayName);
  const targetComment = opts.targetComment || null;
  const latestComment = opts.userComment || null;
  const targetAuthorName = commentAuthorName(targetComment);
  const latestCommentLines = latestComment ? [
    '最新要回应的评论：',
    '---',
    targetComment ? `${userName} 回复 ${targetAuthorName}：${latestComment.content}` : formatCommentLine(latestComment),
    '---',
  ] : [];
  if (targetComment) {
    latestCommentLines.push('被回复的原评论：', '---', formatCommentLine(targetComment), '---');
  }
  latestCommentLines.push(`请直接回应${userName}刚刚发出的这条最新评论；不要把朋友圈正文、配图或其他旧评论当成主要回复对象。`);
  const mentionNote = opts.isMentioned ? `\n- ${userName}在评论里 @ 了你，先回应 ta 的这条评论。` : '';
  const threadNote = opts.isThreadReply ? `\n- 这条评论是楼中楼里的回复，回应时照顾好楼层里的上下文。` : '';
  const momentRules = getCoreDialogueRules({ userName, identityAnchor: false });

  const imageNote = buildMomentImagePromptNote(post.prompt);
  const contextTask = isPostAuthor
    ? `你在朋友圈发了：
---
${post.content}
---${imageNote}

请以角色的身份自然回复评论区的最新评论。${mentionNote}${threadNote}

${latestCommentLines.join('\n')}

${MOMENT_COMMENT_RULES}
- 可以参考评论区的上下文，但不要重复自己已经说过的话
${momentRules}`
    : (() => {
        // 非帖主角色：补一段帖主的人设摘要，避免 ta 对这条朋友圈的主人一无所知
        let posterSection = '';
        if (post.base_prompt) {
          const posterShort = cropPersonalityForEmotion(post.base_prompt, postAuthorName);
          if (posterShort) posterSection = `\n关于${postAuthorName}（这条朋友圈的主人）：\n${posterShort}\n`;
        }
        return `${postAuthorName}的朋友圈动态：
---
${post.content}
---${imageNote}
${posterSection}
${userName}在评论区${opts.isThreadReply ? '楼里回复' : '评论'}${opts.isMentioned ? '并 @ 了你' : ''}。

请以你的身份（${displayName}）回应${userName}的这条评论。

${latestCommentLines.join('\n')}

${MOMENT_COMMENT_RULES}
- 看你的性格和你与${userName}的关系，决定是调侃、关心、吐槽，还是只起个哄`;
      })();

  // msgs[0] 舞台 → [世界观] → msgs[1] 角色+情绪 → msgs[2] 交互上下文 → msgs[3] 任务 → user
  const msgs = [{ role: 'system', content: permissionPrompt }];
  if (worldIntegrationNoteReply) msgs.push({ role: 'system', content: worldIntegrationNoteReply });

  const charContent = [character.base_prompt, emotionPrompt].filter(Boolean).join('\n\n');
  msgs.push({ role: 'system', content: charContent });

  const relContext = [userRelMsg, charRelMsg, affPrompt].filter(Boolean).join('\n\n');
  if (relContext) msgs.push({ role: 'system', content: relContext });

  msgs.push({ role: 'system', content: contextTask });

  const userMsg = `关于${userName}：
${userPersona}

评论区目前的对话：
---
${commentHistory}
---

回复这条评论：`;
  msgs.push({ role: 'user', content: userMsg });

  const chat = opts.deps?.chatSync || chatSync;
  const result = await chat(msgs, { temperature: 0.7, max_tokens: 128, label: '回评' });
  return String(result || '').trim().replace(/^["']|["']$/g, '').slice(0, 200);
}

/**
 * 用户评论主流程：写入用户评论 → 决定谁回复 → 逐个生成 → 返回 { comment, replies }
 * @param {{ post: object, content: string, replyToCommentId?: number|null, deps?: object }} params
 */
export async function handleUserComment({ post, content, replyToCommentId = null, deps = {} }) {
  const db = getDb();
  const userName = userNickname();
  const trimmed = String(content || '').trim();
  if (!trimmed) {
    throw Object.assign(new Error('content is required'), { status: 400 });
  }
  const isNpcPost = post.npc_id != null;

  // 1. 楼中楼：被回复评论归入其所在线程（无线程的评论就此成为线程根）
  let threadRootId = null;
  let target = null;
  if (replyToCommentId != null) {
    target = db.prepare(
      'SELECT * FROM moment_comments WHERE id = ? AND post_id = ?'
    ).get(replyToCommentId, post.id) || null;
    if (target) {
      if (target.thread_root_id != null) {
        threadRootId = target.thread_root_id;
      } else {
        threadRootId = target.id;
        db.prepare(
          'UPDATE moment_comments SET thread_root_id = ? WHERE id = ? AND thread_root_id IS NULL'
        ).run(threadRootId, target.id);
      }
    }
  }

  // 2. 写入用户评论
  // reply_to_comment_id 记录用户明确回复的那条评论，供前端渲染「回复 X」前缀；
  // 与 thread_root_id 分工：后者归线程，前者记直接回复对象
  const userComment = db.prepare(
    `INSERT INTO moment_comments (post_id, author_type, content, thread_root_id, reply_to_comment_id)
     VALUES (?, 'user', ?, ?, ?)`
  ).run(post.id, trimmed, threadRootId, target ? target.id : null);

  const loadChar = (id) => db.prepare('SELECT * FROM characters WHERE id = ?').get(id);

  // 回复对象的展示信息：读接口 GET /:id 是在 SQL 里算出来的，写接口必须自己补齐。
  // 缺了 reply_to_name，前端就渲染不出「回复 X」前缀，用户评论会退化成普通评论。
  const targetChar = target && target.author_type === 'character' && target.author_id != null
    ? loadChar(target.author_id)
    : null;
  const targetComment = target ? {
    ...target,
    display_name: target.author_type === 'character'
      ? ((targetChar && (targetChar.display_name || targetChar.name)) || '某位朋友')
      : userName,
  } : null;

  const userCommentData = {
    id: userComment.lastInsertRowid,
    post_id: post.id,
    author_type: 'user',
    author_id: null,
    content: trimmed,
    char_display_name: null,
    char_avatar_path: null,
    reply_to_name: target
      ? (target.author_type === 'character'
          ? ((targetChar && (targetChar.display_name || targetChar.name)) || '某位朋友')
          : userName)
      : null,
    reply_to_author_type: target ? target.author_type : null,
    reply_to_avatar_path: targetChar ? targetChar.avatar_path : null,
    thread_root_id: threadRootId,
    reply_to_comment_id: target ? target.id : null,
    auto_trigger: 0,
    created_at: new Date().toISOString(),
  };

  // 3. 决定谁要回复：@ 点名优先（替代默认帖主回复），楼中楼由被回复者接话
  const mentioned = parseMentionedCharacters(trimmed, db.prepare('SELECT * FROM characters').all());
  const repliers = [];
  const pushReplier = (char) => {
    if (char && !repliers.some(r => r.id === char.id)) repliers.push(char);
  };

  if (target) {
    if (target.author_type === 'character' && target.author_id != null) {
      pushReplier(loadChar(target.author_id));
    } else if (!isNpcPost) {
      pushReplier(loadChar(post.character_id));
    }
  } else if (!mentioned.length && !isNpcPost) {
    pushReplier(loadChar(post.character_id));
  }
  for (const m of mentioned) pushReplier(m);
  const capped = repliers.slice(0, MAX_REPLIERS_PER_COMMENT);

  // 4. 逐个生成回复（后回复的人能看到前面的回复，形成自然接话）
  const replies = [];
  for (const character of capped) {
    if (await isCharacterSleeping(character.id)) continue;
    try {
      const history = loadCommentHistory(db, post.id);
      const replyText = await generateCharacterCommentReply(character, post, history, {
        isMentioned: mentioned.some(m => m.id === character.id),
        isThreadReply: !!threadRootId,
        deps,
        userComment: userCommentData,
        targetComment,
      });
      if (!replyText) continue;

      const ins = db.prepare(
        `INSERT INTO moment_comments (post_id, author_type, author_id, content, thread_root_id, reply_to_comment_id)
         VALUES (?, 'character', ?, ?, ?, ?)`
      ).run(post.id, character.id, replyText, threadRootId, userCommentData.id);

      replies.push({
        id: ins.lastInsertRowid,
        post_id: post.id,
        author_type: 'character',
        author_id: character.id,
        content: replyText,
        char_display_name: character.display_name || character.name,
        char_avatar_path: character.avatar_path,
        reply_to_name: userName,
        reply_to_author_type: 'user',
        reply_to_avatar_path: null,
        reply_to_comment_id: userCommentData.id,
        thread_root_id: threadRootId,
        auto_trigger: 0,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`[momentComment] ${character.display_name || character.name} 回评失败:`, err.message);
    }
  }

  return { comment: userCommentData, replies, reply: replies[0] || null };
}
