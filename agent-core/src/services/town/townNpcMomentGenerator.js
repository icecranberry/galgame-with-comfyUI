/**
 * 镇民朋友圈生成器
 *
 * 镇民（town_npcs，无角色卡）把「今天发生的事」发进朋友圈：素材全部来自
 * 已入账记录——相遇摘要（town_encounters.summary）、共同经历（town_experiences）、
 * 奇遇结局（town_npc_event_history）——不让模型凭空编造一天的生活。
 * 帖子落 moment_posts（npc_id 作者，与角色作者互斥），评论/点赞/feed 与角色帖共用。
 */

import { getDb, getSystemRules, getSystemRulesWithWorld, getWorldSetting, getGlobalRule } from '../../db/index.js';
import { chatSync as defaultChatSync } from '../../llm/llm-client.js';
import { generateImageRaw as defaultGenerateImageRaw } from '../imageSkill.js';
import { saveBase64Image } from '../imagePaths.js';
import { recordCompletedImageTask } from '../imageTaskRecorder.js';
import { broadcast as broadcastToUnified } from '../unifiedStreamBus.js';
import { config } from '../../config.js';
import { getTimeTag, getLightNoteWithWeather } from '../timeLight.js';
import { getWorldIntegrationRule } from '../../builtinRules.js';
import { createTownActorRegistry } from './townActorRegistry.js';
import { townNpcPortraitUrl } from './townNpcEventGenerator.js';
import { MOMENT_FORMS, weightedPick, MOMENT_SINGLE_FOCUS_RULE, MOMENT_TONE_RULES, MOMENT_IMAGE_RULES, buildMomentOutputFormat } from '../momentForms.js';
import { parseMomentResponse } from '../momentResponseParser.js';

function toSQLite(iso) {
  if (!iso) return iso;
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
}

/** 最近 24 小时内与该镇民相关的「今天的事」，全部是已落库的客观记录。 */
export function collectTownNpcDayFacts(db, npc) {
  const encodedId = -npc.id; // town_encounters.char_a/char_b：NPC 取负、角色取正
  const encounters = db.prepare(`
    SELECT e.id, e.summary, l.name AS location_name
    FROM town_encounters e LEFT JOIN town_locations l ON l.id = e.location_id
    WHERE e.status = 'done' AND e.summary != ''
      AND (e.char_a = ? OR e.char_b = ?)
      AND e.ended_at >= datetime('now', '-24 hours')
    ORDER BY e.ended_at DESC LIMIT 3`).all(encodedId, encodedId);
  const stories = db.prepare(`
    SELECT title, summary, conclusion FROM town_npc_event_history
    WHERE npc_id = ? AND engaged = 1 AND ended_at >= datetime('now', '-24 hours')
    ORDER BY ended_at DESC LIMIT 2`).all(npc.id);
  let experiences = [];
  try {
    const registry = createTownActorRegistry(db);
    const actor = registry.resolveAgentKey(`npc:${npc.id}`);
    if (actor?.actorId) {
      experiences = db.prepare(`
        SELECT summary FROM town_experiences
        WHERE actor_id = ? AND occurred_at >= ?
        ORDER BY occurred_at DESC LIMIT 3`)
        .all(actor.actorId, Date.now() - 24 * 3600_000);
    }
  } catch { /* 小镇世界未初始化时跳过经历 */ }
  return { encounters, stories, experiences };
}

function renderDayFacts({ encounters, stories, experiences }) {
  const lines = [];
  for (const e of encounters) {
    lines.push(`- 和人聊天：在${e.location_name || '镇上'}：${String(e.summary).slice(0, 80)}`);
  }
  for (const s of stories) {
    lines.push(`- 经历了「${s.title}」：${String(s.summary || s.conclusion || '').slice(0, 100)}`);
  }
  for (const x of experiences) {
    lines.push(`- 经历：${String(x.summary).slice(0, 100)}`);
  }
  return lines;
}

function npcPersonaBlock(npc) {
  const lines = [`镇民名：${npc.display_name}`];
  if (npc.job) lines.push(`身份/工作：${npc.job}`);
  if (npc.appearance_desc) lines.push(`外观：${npc.appearance_desc}`);
  const persona = (npc.persona || '').trim() || (npc.brief || '').trim();
  if (persona) lines.push(`人格档案：\n${persona}`);
  return lines.join('\n');
}

function npcMomentForm(hour) {
  const isNight = hour >= 22 || hour < 5;
  const weights = {};
  for (const f of MOMENT_FORMS) weights[f.name] = f.weight * (isNight && f.nightBoost ? 1.8 : 1.0);
  return weightedPick(MOMENT_FORMS, weights);
}

/**
 * 生成一条镇民朋友圈
 * @param {object} npc - town_npcs 行
 * @param {object} [opts]
 * @param {Function} [opts.broadcastPost] - 帖子完成后的 SSE 推送（routes 层注入；缺省走 unified bus）
 * @param {object} [opts.llm] - 测试注入 { chatSync }
 * @param {object} [opts.image] - 测试注入 { generateImageRaw }
 */
export async function generateTownNpcMoment(npc, opts = {}) {
  const db = getDb();
  const chatSync = opts.llm?.chatSync || defaultChatSync;
  const generateImageRaw = opts.image?.generateImageRaw || defaultGenerateImageRaw;

  // 0. 并发保护：该镇民已有生成中的帖子（10 分钟视为僵尸帖）
  const existingGenerating = db.prepare(
    `SELECT id, created_at FROM moment_posts WHERE npc_id = ? AND status = 'generating' LIMIT 1`
  ).get(npc.id);
  if (existingGenerating) {
    const ageSeconds = (Date.now() - new Date(existingGenerating.created_at + 'Z').getTime()) / 1000;
    if (ageSeconds > 600) {
      db.prepare(`UPDATE moment_posts SET status = 'failed' WHERE id = ?`).run(existingGenerating.id);
    } else {
      throw new Error('ALREADY_GENERATING');
    }
  }

  // 0.5 悲观锁 + 全镇每日上限：超限时顺延到明天再试
  const lockNextAt = new Date(Date.now() + 3600_000).toISOString();
  db.prepare('UPDATE town_npcs SET next_moment_at = ? WHERE id = ?').run(toSQLite(lockNextAt), npc.id);
  const { npcMoments } = config.town;
  const dailyCount = db.prepare(
    `SELECT count(*) n FROM moment_posts WHERE npc_id IS NOT NULL AND created_at >= datetime('now', '-24 hours')`
  ).get().n;
  if (dailyCount >= (npcMoments?.dailyCap ?? 4)) {
    const tomorrow = new Date(Date.now() + 24 * 3600_000).toISOString();
    db.prepare('UPDATE town_npcs SET next_moment_at = ? WHERE id = ?').run(toSQLite(tomorrow), npc.id);
    console.log(`[npcMoments] Daily cap reached (${dailyCount}), defer ${npc.display_name} to ${tomorrow}`);
    return null;
  }

  // 1. 素材与形态
  const facts = collectTownNpcDayFacts(db, npc);
  const factLines = renderDayFacts(facts);
  const hasFacts = factLines.length > 0;
  const pickedForm = npcMomentForm(new Date().getHours());

  // 2. 创建 pending 记录（镇民作者：character_id 为 NULL）
  const postResult = db.prepare(
    `INSERT INTO moment_posts (character_id, npc_id, content, prompt, style, resolution, status)
     VALUES (NULL, ?, '', '', ?, ?, 'generating')`
  ).run(npc.id, pickedForm.name, `${config.comfyui.momentsWidth}x${config.comfyui.momentsHeight}`);
  const postId = postResult.lastInsertRowid;

  // 3. LLM 生成文案 + 配图提示词
  const worldSetting = getWorldSetting();
  const permissionPrompt = worldSetting ? getSystemRulesWithWorld() : getSystemRules();
  const worldIntegrationNote = worldSetting ? getWorldIntegrationRule('moments') : null;
  const imagePromptRule = getGlobalRule('image_prompt');
  const imagePromptGuide = imagePromptRule?.rule_content || '';
  const now = new Date();
  const weatherNote = getLightNoteWithWeather(now);
  const weatherHint = weatherNote ? `Environment reference：${weatherNote}。` : '';
  const timeTag = getTimeTag(now, false);

  const factsBlock = hasFacts
    ? `【今天真实发生的事（候选素材，只选一件作为唯一主线）】\n${factLines.join('\n')}\n`
    : '';
  const factsRule = hasFacts
    ? `- 上面「今天真实发生的事」是你今天亲历的记录：只从中选一件最想分享的事作为唯一主线，其余都忽略；没提到的部分写日常即可。禁止否认或编造更大的事`
    : `- 今天没什么特别的事，就选一件符合你身份和此刻时段的小事作为唯一主线，随手记录小镇日常`;

  const formatPrompt = `规则：
- 只输出 JSON，不要解释
${MOMENT_SINGLE_FOCUS_RULE}
${MOMENT_TONE_RULES}
${MOMENT_IMAGE_RULES}

${buildMomentOutputFormat({ textRequirement: '中文口语，第一人称可省略主语，只围绕一个具体中心' })}

本次要求：
- text 用中文，第一人称（可省略主语），参考 ${pickedForm.len}，不凑字数；${pickedForm.desc}
- ${factsRule}
- 你的语气要贴合你的身份（${npc.job || '镇民'}）和人格，像一个真实的小镇居民在发朋友圈，不要写成官方通告
- text 中的事符合当前时间和天气，不用报时或报天气；只有它直接触发了这次反应才自然提及
- **画面里只有你自己**（或你正在看的风景/物件），不要出现玩家

生图格式：
${imagePromptGuide || '一段完整的自然英文，描述具体画面，避免标签堆砌。'}
${weatherHint}`;

  const personaMsg = `以下是小镇镇民「${npc.display_name}」的资料，发帖时保持这个人设：\n\n${npcPersonaBlock(npc)}`;

  const msgs = [{ role: 'system', content: permissionPrompt }];
  if (worldIntegrationNote) msgs.push({ role: 'system', content: worldIntegrationNote });
  msgs.push({ role: 'system', content: formatPrompt });
  msgs.push({ role: 'system', content: personaMsg });
  msgs.push({ role: 'user', content: worldSetting
    ? `请遵循当前<world_setting>来发朋友圈。${timeTag}${factsBlock}现在发一条朋友圈。`
    : `${timeTag}${factsBlock}现在发一条朋友圈。` });

  let text = '', imagePrompt = '';
  try {
    const result = await chatSync(msgs, { temperature: 0.8, max_tokens: 2048,
      response_format: { type: 'json_object' }, label: '镇民朋友圈' });
    const parsed = parseMomentResponse(result);
    text = parsed.text;
    imagePrompt = parsed.imagePrompt || '';
  } catch (err) {
    console.error(`[npcMoments] LLM failed for ${npc.display_name}:`, err.message);
  }
  if (!text) {
    // 文案失败：标记失败并设置短重试，不让空帖进 feed
    db.prepare(`UPDATE moment_posts SET status = 'failed', error_message = ? WHERE id = ?`)
      .run('LLM_EMPTY_TEXT', postId);
    const retryAt = new Date(Date.now() + 30 * 60_000).toISOString();
    db.prepare('UPDATE town_npcs SET next_moment_at = ? WHERE id = ?').run(toSQLite(retryAt), npc.id);
    throw new Error('NPC_MOMENT_EMPTY_TEXT');
  }
  if (!imagePrompt) imagePrompt = `${npc.display_name}, a townsfolk, in the small town, daily scene`;

  // 4. 配图（镇民无 LoRA，走朋友圈画师；与角色帖同结构必出图，生图失败才降级为无图帖）
  const imageUrls = [];
  try {
    const genResult = await generateImageRaw(imagePrompt, {
      ragQuery: text,
      artist: config.comfyui.momentsArtist,
      width: config.comfyui.momentsWidth,
      height: config.comfyui.momentsHeight,
      scene: 'moments',
      priority: 'low',
    });
    if (genResult.success && genResult.images.length > 0) {
      const usedPrompt = genResult.promptRefined || imagePrompt;
      const batchUrls = [];
      for (const img of genResult.images) {
        const filename = `moment_npc_${npc.id}_${Date.now()}_${img.filename || 'comfy.png'}`;
        batchUrls.push(saveBase64Image('moments', filename, img.base64));
      }
      imageUrls.push(...batchUrls);
      imagePrompt = usedPrompt;
      recordCompletedImageTask({
        conversationId: `town_npc_${npc.id}_moments`,
        promptOriginal: imagePrompt,
        promptRefined: usedPrompt,
        outputPaths: batchUrls,
        style: config.comfyui.momentsArtist,
        resolution: `${config.comfyui.momentsWidth}x${config.comfyui.momentsHeight}`,
        workflowTemplate: genResult.wfMode,
        db,
      });
    }
  } catch (err) {
    console.error(`[npcMoments] Image failed for ${npc.display_name}:`, err.message);
  }

  // 5. 完成 + 下次发帖时间
  db.prepare(`UPDATE moment_posts SET content = ?, prompt = ?, images = ?, status = 'done' WHERE id = ?`)
    .run(text, imagePrompt, JSON.stringify(imageUrls), postId);
  // 每人每天最多一条：基线直接越过调度器的 24h 去重窗口，再叠加原本的随机间隔
  const gapMs = (npcMoments?.minGapHours ?? 3) * 3600_000
    + Math.random() * Math.max(0, ((npcMoments?.maxGapHours ?? 10) - (npcMoments?.minGapHours ?? 3))) * 3600_000;
  const nextAt = new Date(Date.now() + 24 * 3600_000 + gapMs).toISOString();
  db.prepare('UPDATE town_npcs SET next_moment_at = ? WHERE id = ?').run(toSQLite(nextAt), npc.id);

  const postInfo = {
    id: postId, npc_id: npc.id, character_id: null, author_type: 'npc',
    content: text, images: imageUrls,
    display_name: npc.display_name,
    avatar_path: townNpcPortraitUrl(db, npc.id),
    status: 'done', created_at: new Date().toISOString(),
  };
  if (opts.broadcastPost) opts.broadcastPost(postInfo);
  else broadcastToUnified('new_post', postInfo);

  console.log(`[npcMoments] Post ${postId} done for ${npc.display_name}, next at ${nextAt}`);
  return postInfo;
}
