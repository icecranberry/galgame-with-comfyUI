/**
 * 用户自己发朋友圈 + 角色来评论区互动
 *
 * 用户发帖（文字 + 可选本地图片，不走生图）落库后，异步组织角色来评论：
 *   1. 最近聊过天的 10 个角色里随机挑 3 个（近期有交集，自然会来捧场）
 *   2. 其余角色里再随机挑 1~3 个路过冒泡
 * 单个角色的评论 prompt 结构与朋友圈评论口径（momentInteractionService 的朋友首评）保持一致。
 *
 * LLM / 延时 / 广播 / 存图均可通过 deps 注入，便于测试。
 */

import { getDb, getSystemRules, getSystemRulesWithWorld, getWorldSetting } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { config } from '../config.js';
import { broadcast as broadcastToUnified } from './unifiedStreamBus.js';
import { saveBase64Image } from './imagePaths.js';
import { getWorldIntegrationRule } from '../builtinRules.js';
import { compressDataUriToAvif } from './imageTranscode.js';
import { MOMENT_COMMENT_RULES, firstMomentImagePrompt } from './momentForms.js';
import { extractMomentImageRequest, stripMomentImageRequest } from './momentImageRequest.js';

const USER_POST_MAX_IMAGES = 3;
// 单张图片解码前的 base64 上限（base64 约为原大小 4/3，express.json 全局限 10mb）
const USER_POST_MAX_IMAGE_CHARS = 8 * 1024 * 1024;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * arr.length);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 角色是否在睡觉（日程系统关闭时视为不睡） */
export async function isCharacterSleeping(characterId) {
  try {
    if (config.features.schedule !== false) {
      const { isSleeping } = await import('./scheduleManager.js');
      return !!isSleeping(characterId)?.sleeping;
    }
  } catch { /* schedule not available */ }
  return false;
}

/** 用户昵称（单例用户无 user 表，统一取 config） */
export function userNickname() {
  return config.user.nickname || '我';
}

/** 用户身份描述（给角色看的「发帖人是谁」） */
function buildUserPersona() {
  const u = config.user;
  let persona = u.appearance || u.persona || '你最重要的朋友';
  if (u.gender) persona = `[性别：${u.gender}] ${persona}`;
  return persona;
}

export async function describeUserMomentImages(images = [], deps = {}) {
  const imageList = (Array.isArray(images) ? images : []).filter(Boolean);
  if (imageList.length === 0) return '';

  const imageParts = imageList.map(image => ({
    type: 'image_url',
    image_url: { url: String(image) },
  }));
  const chat = deps.chatSync || chatSync;
  const result = await chat([
    {
      role: 'system',
      content: getSystemRules({ roleplay: false }),
    },
    {
      role: 'system',
      content: '你是朋友圈图片观察助手。请只输出一段自然的中文图片内容描述，供其他角色理解照片。按图片顺序写清人物、动作、场景、物品和文字；人物是可识别的动漫/游戏/影视等已知名角色时，优先用「角色名（作品名）」点名，并保留关键辨识特征和动作。不要因为图是二创或截屏就不敢点名；无法可靠确认时只描述特征，不要编造名字。不要推测作者身份，不要评价画质，不要分析、解释或输出 JSON。',
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: '这些是同一条朋友圈的配图。请压缩成 100 字以内；多张图时用「第1张：」「第2张：」标明顺序。' },
        ...imageParts,
      ],
    },
  ], { temperature: 0.2, max_tokens: 256, label: '用户朋友圈图片识别' });

  return String(result || '').trim().replace(/^["']|["']$/g, '').slice(0, 300);
}

/** 评论区历史（含刚写入的评论），角色显示名 + 用户昵称 */
export function loadCommentHistory(db, postId) {
  return db.prepare(`
    SELECT mc.id, mc.author_type, mc.author_id, mc.content,
      mc.reply_to_comment_id, mc.thread_root_id,
      CASE WHEN mc.author_type = 'character' THEN c.display_name ELSE ? END AS display_name
    FROM moment_comments mc
    LEFT JOIN characters c ON c.id = mc.author_id AND mc.author_type = 'character'
    WHERE mc.post_id = ?
    ORDER BY mc.id ASC
  `).all(userNickname(), postId);
}

// ──────────────── 选人 ────────────────

/** 最近聊过天的角色（按会话最后一条消息时间取前 N，排除关闭朋友圈的角色） */
export function listRecentlyChattedCharacters(db, limit = 10) {
  return db.prepare(`
    SELECT c.* FROM characters c
    JOIN (
      SELECT conversation_id, MAX(created_at) AS last_at
      FROM messages
      WHERE conversation_id LIKE 'char_%' AND raw_id IS NOT NULL
      GROUP BY conversation_id
    ) m ON m.conversation_id = 'char_' || c.id
    WHERE COALESCE(c.moments_disabled, 0) = 0
    ORDER BY m.last_at DESC
    LIMIT ?
  `).all(limit);
}

/** 选出给用户帖子评论的角色：最近聊过的 10 个里随机挑 3 个，其余角色里随机挑 1~3 个 */
export function selectUserPostRepliers(db) {
  const recent = shuffle(listRecentlyChattedCharacters(db));
  const picked = recent.slice(0, Math.min(3, recent.length));
  const recentIds = new Set(recent.map(c => c.id));

  const others = shuffle(
    db.prepare('SELECT * FROM characters WHERE COALESCE(moments_disabled, 0) = 0').all()
      .filter(c => !recentIds.has(c.id))
  );
  const extraCount = Math.min(others.length, 1 + Math.floor(Math.random() * 3));

  return [...picked, ...others.slice(0, extraCount)];
}

// ──────────────── LLM 生成 ────────────────

/**
 * 角色评论用户的朋友圈。
 * 评论规则、用户资料、动态和配图描述组成稳定前缀；描述排在角色人设前，
 * 同一条动态的多个角色评论能共享前缀缓存；人设后只保留差异信息和短任务。
 */
export async function generateUserPostComment(character, post, historyComments, deps = {}) {
  const db = getDb();
  const userName = userNickname();
  const userPersona = buildUserPersona();
  const displayName = character.display_name || character.name;

  const worldSetting = getWorldSetting();
  const permissionPrompt = worldSetting
    ? getSystemRulesWithWorld()
    : getSystemRules();
  const worldIntegrationNote = worldSetting
    ? getWorldIntegrationRule('momentReply')
    : null;


  const commentRulesContext = [
    '<user_moment_comment_rules>',
    '像刷到好友动态一样在评论区随口说话，参考群聊那种即时反应，但这里只输出一条评论：',
    MOMENT_COMMENT_RULES,
    '- 优先抓住正文或图里的一个点给出第一反应；短、糙、随口比完整书面句更像真人。',
    '- 可以吐槽内容、质疑细节、起哄、追问，也可以只给一个短反应；不要每条都强行幽默。',
    '- 不要用“这张图”“配图里”开场，不要解说画面；可以自然提到某个具体细节。',
    '- 不堆华丽比喻和成语套话，不为了妙语虚构不存在的事，不把短反应扩成表演型长句。',
    '- 输出单条评论文本，不要拆成多条、换行列表或另外解释。',
    '</user_moment_comment_rules>',
  ].join('\n\n');

  const imageRequest = extractMomentImageRequest(post.content);
  const visibleContent = stripMomentImageRequest(post.content || '');
  const postBody = imageRequest
    ? `${visibleContent}\n（AI 配图需求：${imageRequest}）`
    : visibleContent;

  // 配图信息独立 system 消息；AI 配图的防误认提醒放末位任务里（末位指令权重最高）
  const imageDescription = firstMomentImagePrompt(post.prompt);
  const hasImageContent = Boolean(imageDescription) || Boolean(imageRequest);
  let imageContext = '';
  if (hasImageContent) {
    const lines = ['<post_image>'];
    if (imageDescription) {
      lines.push(`画面内容（图片观察助手识别）：${imageDescription}`);
    }
    if (imageRequest) {
      lines.push(`来源：AI 根据配图需求生成的图片，不是${userName}的真实照片；图中人物不是${userName}，${userName}只是分享这张图的人。`);
    }
    lines.push('</post_image>');
    imageContext = lines.join('\n');
  }
  const userPostContext = [
    `关于${userName}：\n${userPersona}`,
    `${userName}刚刚在朋友圈发了一条动态：\n---\n${postBody}\n---`,
  ].join('\n\n');

  // 规则先于动态和人设；仅用户资料/动态合并成一个 system，保证高缓存前缀。
  const userRel = db.prepare(
    'SELECT relationship_text FROM user_relationships WHERE character_id = ?'
  ).get(character.id);
  let relationContext = '';
  if (userRel?.relationship_text) {
    relationContext = `<user_relation>你对于${userName}而言的身份是${userRel.relationship_text}。这个身份为最高优先级，即使你在外有其他身份，但是在${userName}面前就是这样的。请在对话中自然体现这层身份，不必刻意说明，行为举止应符合这层身份。</user_relation>`;
  }

  const worldRulePrefix = worldSetting
    ? '请遵循当前<world_setting>来评论朋友圈，角色人设如果和<world_setting>有冲突，则以<world_setting>最高优先级，人设会因为<world_setting>改变。\n\n'
    : '';
  const imageTaskNote = imageRequest
    ? `（注意：配图里的人物不是${userName}，${userName}只是发帖分享这张图的人。请把图中角色当作图里的其他人来评论，不要把图中人物当成${userName}，也不要对${userName}本人描写图中角色的外貌或行为。）`
    : '';
  const task = `${worldRulePrefix}请以你的身份（${displayName}），看你的性格和你与${userName}的关系，去评论区留一条评论：\n${imageTaskNote}`;

  const msgs = [{ role: 'system', content: permissionPrompt }];
  if (worldIntegrationNote) msgs.push({ role: 'system', content: worldIntegrationNote });
  msgs.push({ role: 'system', content: commentRulesContext });
  msgs.push({ role: 'system', content: userPostContext });
  if (imageContext) msgs.push({ role: 'system', content: imageContext });
  msgs.push({ role: 'system', content: character.base_prompt || '' });
  if (relationContext) msgs.push({ role: 'system', content: relationContext });
  msgs.push({ role: 'user', content: task });

  const chat = deps.chatSync || chatSync;
  const result = await chat(msgs, { temperature: 0.7, max_tokens: 128, label: '用户朋友圈评论' });
  return String(result || '').trim().replace(/^["']|["']$/g, '').slice(0, 200);
}

// ──────────────── 主流程 ────────────────

/**
 * 用户发朋友圈：存图落库、广播、异步触发角色评论
 * @returns {Promise<object>} 前端可直接 unshift 的帖子对象
 */
export async function publishUserMoment({ content, images = [] }, deps = {}) {
  const db = getDb();
  const text = String(content || '').trim();
  const imgList = Array.isArray(images) ? images : [];

  if (!text && imgList.length === 0) {
    throw Object.assign(new Error('写点内容或配上图片再发吧'), { status: 400 });
  }
  if (imgList.length > USER_POST_MAX_IMAGES) {
    throw Object.assign(new Error(`最多配 ${USER_POST_MAX_IMAGES} 张图片`), { status: 400 });
  }

  const urls = [];
  const compressedUris = [];
  for (let i = 0; i < imgList.length; i++) {
    const dataUri = String(imgList[i] || '');
    if (!/^data:image\/(png|jpeg|jpg|webp|gif|avif);base64,/i.test(dataUri)) {
      throw Object.assign(new Error('只支持 PNG / JPG / WEBP / GIF / AVIF 图片'), { status: 400 });
    }
    if (dataUri.length > USER_POST_MAX_IMAGE_CHARS) {
      throw Object.assign(new Error('图片过大，请压缩后再发（单张不超过 6MB）'), { status: 400 });
    }
    const compressImage = deps.compressImage || compressDataUriToAvif;
    const compressed = await compressImage(dataUri);
    compressedUris.push(compressed.dataUri);
    const save = deps.saveImage || saveBase64Image;
    const filename = `moment_user_${Date.now()}_${i + 1}${compressed.ext}`;
    urls.push(save('moments', filename, compressed.dataUri));
  }

  const ins = db.prepare(
    `INSERT INTO moment_posts (character_id, npc_id, content, images, style, status)
     VALUES (NULL, NULL, ?, ?, '我的动态', 'done')`
  ).run(text, JSON.stringify(urls));

  const payload = {
    id: ins.lastInsertRowid,
    character_id: null,
    npc_id: null,
    author_type: 'user',
    display_name: userNickname(),
    avatar_path: null,
    content: text,
    images: urls,
    prompt: '',
    style: '我的动态',
    status: 'done',
    comment_count: 0,
    like_count: 0,
    liked: false,
    created_at: new Date().toISOString(),
  };

  const broadcastPost = deps.broadcastPost || ((p) => broadcastToUnified('new_post', p));
  broadcastPost(payload);

  // 角色评论异步进行：先给一点「刚发出去」的时间，随后逐条浮现（SSE 推送）
  const schedule = deps.schedule || ((fn) => setTimeout(fn, 0));
  schedule(() => {
    triggerUserPostReplies({
      id: payload.id,
      content: text,
      prompt: '',
      images: urls,
      imageDataUris: compressedUris,
    }, deps).catch(err => console.error('[momentUserPost] reply flow error:', err.message));
  });

  return payload;
}

/**
 * 触发用户朋友圈的异步评论。
 * 先等图片描述助手返回并写入 post.prompt，评论改用文字描述，不再传原图。
 */
export async function triggerUserPostReplies(post, deps = {}) {
  const db = getDb();

  const archiveUris = post.imageDataUris?.length ? post.imageDataUris : (post.images || []);
  if (!post.prompt && archiveUris.length > 0) {
    await archiveImageDescription(db, post.id, archiveUris, deps);
  }

  // 读库拿统一形状，避免角色评论逻辑再区分首条用户数据结构
  const postRecord = db.prepare(`
    SELECT mp.*, NULL AS author_type, NULL AS display_name
    FROM moment_posts mp
    WHERE mp.id = ?
  `).get(post.id);
  if (!postRecord) return;
  const repliers = selectUserPostRepliers(db);

  for (const character of repliers) {
    const delayFn = deps.delay || delay;
    await delayFn(1200 + Math.floor(Math.random() * 5200));
    if (await isCharacterSleeping(character.id)) continue;

    const history = loadCommentHistory(db, post.id);
    const commentText = await generateUserPostComment(character, postRecord, history, deps);
    if (!commentText) continue;

    const inserted = db.prepare(`
      INSERT INTO moment_comments (post_id, author_type, author_id, content, auto_trigger, thread_root_id, created_at)
      VALUES (?, 'character', ?, ?, 1, NULL, ?)
    `).run(post.id, character.id, commentText, new Date().toISOString());
    const threadRootId = inserted.lastInsertRowid;
    db.prepare('UPDATE moment_comments SET thread_root_id = ? WHERE id = ?').run(threadRootId, threadRootId);

    const payload = {
      post_id: post.id,
      comment: {
        id: threadRootId,
        post_id: post.id,
        author_type: 'character',
        author_id: character.id,
        content: commentText,
        char_display_name: character.display_name || character.name,
        char_avatar_path: character.avatar_path || null,
        reply_to_name: null,
        reply_to_avatar_path: null,
        reply_to_author_type: null,
        auto_trigger: 1,
        thread_root_id: threadRootId,
        created_at: new Date().toISOString(),
      },
    };
    const broadcastComment = deps.broadcastComment || ((c) => broadcastToUnified('new_comment', c));
    broadcastComment(payload);
  }
}

/**
 * 异步生成图片描述并写入 post.prompt，供后续私聊/群聊的 recent_moments 语境消费。
 * 失败时广播 vision 错误但不阻塞评论流程。
 */
async function archiveImageDescription(db, postId, images, deps = {}) {
  try {
    const describeImages = deps.describeImages || describeUserMomentImages;
    const prompt = await describeImages(images, deps);
    if (!prompt) throw new Error('model returned no image description');
    db.prepare('UPDATE moment_posts SET prompt = ? WHERE id = ?').run(prompt, postId);
  } catch (err) {
    const visionUnsupported = err.message === 'model returned no image description' || isVisionUnsupportedError(err);
    const payload = {
      post_id: postId,
      vision_unsupported: visionUnsupported,
      message: visionUnsupported ? '当前模型不能识图' : '图片识别失败',
      description: visionUnsupported ? '请更换支持图片输入的模型' : (err.message || '请检查模型配置'),
    };
    const broadcastVisionError = deps.broadcastVisionError || ((data) => broadcastToUnified('user_moment_vision_error', data));
    broadcastVisionError(payload);
    console.warn('[momentUserPost] image recognition failed:', err.message);
  }
}
function isVisionUnsupportedError(err) {
  const status = err?.status || err?.response?.status;
  const text = [err?.message, err?.error?.message, err?.error?.code, err?.code]
    .filter(Boolean).join('\n').toLowerCase();
  return [400, 404, 415, 422].includes(status)
    || /image|vision|multimodal|unsupported|not support|does not support|invalid content|content part/.test(text);
}
