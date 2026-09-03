import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { getDb, getSystemRules, getSystemRulesWithWorld, getWorldSetting, getGlobalRule, getSetting, setSetting, repairFtsIndex } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { config } from '../config.js';
import { searchCharacterInfo } from '../services/webSearch.js';
import { clearImageJudgeCounter } from './chat.js';
import { invalidateGalleryCache } from './images.js';
import { deleteByConversation } from '../services/vectorClient.js';
import { clearConversationMemories } from '../services/memory/memoryRepository.js';
import { cropPersonalityForEmotion, generateShortPromptWithLLM, runShortPromptMigration, getMigrationStatus, giveGift, getGiftCooldowns, loadEmotionState, saveEmotionSnapshot, loadOath, setOath, canSendRing, loadAffinity } from '../services/emotionEngine.js';
import { generateImage, generateImageRaw, getLastWorkflowMode } from '../services/imageSkill.js';
import { charArtistOverride } from '../services/characterImageOpts.js';
import { RAG_TIMEOUT_FAST_MS } from '../services/imagePromptKnowledge.js';
import { forceProactiveNow } from '../services/proactiveChatScheduler.js';
import { saveBase64Image, deleteImageFileByUrl } from '../services/imagePaths.js';
import { generateSchedule, assignNextRefreshTime, snapshotTodaySchedule } from '../services/scheduleGenerator.js';
import { invalidateCache as invalidateScheduleCache, syncSleepingState } from '../services/scheduleManager.js';
import { assignFontForNewCharacter } from '../services/handwritingFontService.js';
import { refresh as refreshCharSearch } from '../services/characterSearch.js';
import { listCharacterOutfits, createCharacterOutfit, updateCharacterOutfit, deleteCharacterOutfit } from '../services/outfitService.js';
import { buildCharacterPersona } from '../services/characterPersona.js';
import { getWorldIntegrationRule, STANDING_IMAGE_PROMPT_RULE, STANDING_PROMPT_MODES, STANDING_ROLE_PROMPTS } from '../builtinRules.js';

const router = Router();

// GET /api/characters — 列出角色，含最近消息摘要
router.get('/', (req, res) => {
  const db = getDb();
  const characters = db.prepare(`SELECT * FROM characters`).all();

  const enriched = characters.map(c => {
    const convId = `char_${c.id}`;
    const last = db.prepare(`
      SELECT role, content, created_at FROM messages
      WHERE conversation_id = ? AND raw_id IS NOT NULL
      ORDER BY id DESC LIMIT 1
    `).get(convId);

    const count = db.prepare(`SELECT COUNT(*) as c FROM raw_messages WHERE conversation_id = ?`).get(convId);

    const relCount = db.prepare(`
      SELECT COUNT(*) as c FROM character_relationships
      WHERE from_character_id = ? OR to_character_id = ?
    `).pluck().get(c.id, c.id);

    const userRel = db.prepare(
      'SELECT affinity, is_oath FROM user_relationships WHERE character_id = ?'
    ).get(c.id);

    return {
      ...c,
      last_message: last ? last.content.slice(0, 80) : null,
      last_message_at: last?.created_at ? last.created_at.replace(' ', 'T') + '.000Z' : null,
      message_count: count?.c || 0,
      relationship_count: relCount || 0,
      affinity: userRel?.affinity ?? 50,
      is_oath: userRel?.is_oath ?? 0,
    };
  });

  // 按最近消息时间排序（有消息的在前）
  enriched.sort((a, b) => {
    if (!a.last_message_at && !b.last_message_at) return a.id - b.id;
    if (!a.last_message_at) return 1;
    if (!b.last_message_at) return -1;
    return new Date(b.last_message_at) - new Date(a.last_message_at);
  });

  res.json({ characters: enriched });
});

// POST /api/characters — 创建角色
router.post('/', (req, res) => {
  const db = getDb();
  const { name, display_name, base_prompt, emotion_baseline, moments_disabled, proactive_disabled, events_disabled } = req.body;
  if (!name || !base_prompt) return res.status(400).json({ error: 'name and base_prompt are required' });

  const emotion = emotion_baseline ? (typeof emotion_baseline === 'string' ? emotion_baseline : JSON.stringify(emotion_baseline)) : '{"valence":0.5,"arousal":0.5,"dominance":0.5}';

  try {
    const shortPrompt = cropPersonalityForEmotion(base_prompt, display_name || name);
    const result = db.prepare(`INSERT INTO characters (name, display_name, base_prompt, short_prompt, emotion_baseline, moments_disabled, proactive_disabled, events_disabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(name, display_name || name, base_prompt, shortPrompt, emotion, moments_disabled !== undefined ? (moments_disabled ? 1 : 0) : 0, proactive_disabled !== undefined ? (proactive_disabled ? 1 : 0) : 0, events_disabled !== undefined ? (events_disabled ? 1 : 0) : 0);
    const newCharId = result.lastInsertRowid;
    res.status(201).json({ id: newCharId, name, display_name });
    refreshCharSearch();

    // 异步选择手写字体（不阻塞响应）
    assignFontForNewCharacter(newCharId, base_prompt).catch(err =>
      console.warn(`[char] font assignment failed for "${display_name}":`, err.message)
    );

    // 异步生成日程模板（不阻塞响应）
    const newCharDisplayName = display_name || name;
    if (config.features.schedule !== false) {
      setTimeout(async () => {
        try {
          const character = db.prepare('SELECT id, display_name, base_prompt FROM characters WHERE id = ?').get(newCharId);
          if (character) {
            await generateSchedule(character);
            assignNextRefreshTime(newCharId);
            snapshotTodaySchedule(newCharId);
            syncSleepingState(newCharId);
            invalidateScheduleCache(newCharId);
            console.log(`[char] Schedule generated for new character "${newCharDisplayName}"`);
          }
        } catch (err) {
          console.error(`[char] Schedule generation failed for "${newCharDisplayName}":`, err.message);
        }
      }, 3000).unref(); // 3 秒延迟，等角色稳定后再生成
    }

    // 创建成功后，30~60 秒内发起一次主动聊天（除非角色禁用了主动聊天）
    if (!(proactive_disabled && (proactive_disabled === 1 || proactive_disabled === '1'))) {
      const delayMs = 30_000 + Math.floor(Math.random() * 30_000); // 30~60s
      setTimeout(() => {
        forceProactiveNow(newCharId).then((r) => {
          if (r) {
            console.log(`[char] proactive greeting sent for new character "${display_name}" (id=${newCharId})`);
          } else {
            console.log(`[char] proactive greeting skipped for "${display_name}" (id=${newCharId}): not eligible`);
          }
        }).catch((err) => {
          console.error(`[char] proactive greeting error for "${display_name}":`, err.message);
        });
      }, delayMs).unref();
    }

    // 异步优化 short_prompt（不阻塞响应）
    setImmediate(async () => {
      try {
        const optimized = await generateShortPromptWithLLM(base_prompt, display_name || name, name);
        db.prepare('UPDATE characters SET short_prompt = ? WHERE id = ?').run(optimized, newCharId);
        console.log(`[char] short_prompt LLM-optimized for "${display_name || name}" (id=${newCharId})`);
        runShortPromptMigration();
      } catch (err) {
        console.warn(`[char] short_prompt LLM optimization failed for "${display_name || name}":`, err.message);
      }
    });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: `"${name}" already exists` });
    throw err;
  }
});

// POST /api/characters/migrate-short-prompts — 手动触发全表扫描迁移
router.post('/migrate-short-prompts', (_req, res) => {
  const result = runShortPromptMigration();
  res.json(result);
});

// GET /api/characters/migrate-short-prompts — 查询迁移状态
router.get('/migrate-short-prompts', (_req, res) => {
  res.json(getMigrationStatus());
});

// ── 立绘姿势风格（普通 / 张力！）—— system_settings 全局持久化 ──
// 必须注册在 put('/:id') 之前，避免被参数路由吞掉
const STANDING_MODE_KEY = 'standing_prompt_mode';

// GET /api/characters/standing-mode — 当前立绘风格（缺省 normal）
router.get('/standing-mode', (_req, res) => {
  const mode = getSetting(STANDING_MODE_KEY) === 'dynamic' ? 'dynamic' : 'normal';
  res.json({ mode });
});

// PUT /api/characters/standing-mode — 切换立绘风格
router.put('/standing-mode', (req, res) => {
  const mode = req.body?.mode;
  if (!STANDING_PROMPT_MODES.includes(mode)) {
    return res.status(400).json({ error: 'mode must be normal or dynamic' });
  }
  setSetting(STANDING_MODE_KEY, mode);
  res.json({ ok: true, mode });
});

// PUT /api/characters/:id — 更新角色
router.put('/:id', (req, res) => {
  const db = getDb();
  const { name, display_name, base_prompt, emotion_baseline, avatar_path, moments_disabled, proactive_disabled, events_disabled, custom_workflow, loras, artist_override } = req.body;
  const updates = [], params = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (display_name !== undefined) { updates.push('display_name = ?'); params.push(display_name); }
  if (base_prompt !== undefined) {
    updates.push('base_prompt = ?'); params.push(base_prompt);
    // 获取角色名用于人格裁剪：优先请求体中的 display_name，否则从 DB 查
    const charForCrop = db.prepare('SELECT display_name, name FROM characters WHERE id = ?').get(req.params.id);
    const cropName = display_name || charForCrop?.display_name || charForCrop?.name || 'assistant';
    updates.push('short_prompt = ?'); params.push(cropPersonalityForEmotion(base_prompt, cropName));
  }
  if (emotion_baseline !== undefined) { updates.push('emotion_baseline = ?'); params.push(typeof emotion_baseline === 'string' ? emotion_baseline : JSON.stringify(emotion_baseline)); }
  if (avatar_path !== undefined) { updates.push('avatar_path = ?'); params.push(avatar_path || null); }

  if (moments_disabled !== undefined) { updates.push('moments_disabled = ?'); params.push(moments_disabled ? 1 : 0); }
  if (proactive_disabled !== undefined) { updates.push('proactive_disabled = ?'); params.push(proactive_disabled ? 1 : 0); }
  if (events_disabled !== undefined) { updates.push('events_disabled = ?'); params.push(events_disabled ? 1 : 0); }
  if (custom_workflow !== undefined) { updates.push('custom_workflow = ?'); params.push(custom_workflow || null); }
  if (loras !== undefined) { updates.push('loras = ?'); params.push(Array.isArray(loras) ? JSON.stringify(loras) : (loras || '[]')); }
  if (artist_override !== undefined) { updates.push('artist_override = ?'); params.push(typeof artist_override === 'string' ? artist_override.trim() : null); }
  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
  params.push(req.params.id);
  db.prepare(`UPDATE characters SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  // 如果更新了 base_prompt，标记日程模板需要重新生成
  if (base_prompt !== undefined && config.features.schedule !== false) {
    const charId = parseInt(req.params.id, 10);
    // 将 version 设为 0，下次查看日程时触发重新生成
    db.prepare('UPDATE schedule_templates SET version = 0 WHERE character_id = ?').run(charId);
    invalidateScheduleCache(charId);
    console.log(`[char] Schedule marked for regeneration (char ${charId}: base_prompt changed)`);
  }

  res.json({ ok: true });
  refreshCharSearch();

  // 若 base_prompt 变更，异步优化 short_prompt
  if (base_prompt !== undefined) {
    const charId = parseInt(req.params.id, 10);
    setImmediate(async () => {
      try {
        const char = db.prepare('SELECT display_name, name, base_prompt FROM characters WHERE id = ?').get(charId);
        if (!char) return;
        const optimized = await generateShortPromptWithLLM(char.base_prompt, char.display_name || char.name, char.name);
        db.prepare('UPDATE characters SET short_prompt = ? WHERE id = ?').run(optimized, charId);
        console.log(`[char] short_prompt LLM-optimized for "${char.display_name || char.name}" (id=${charId})`);
        runShortPromptMigration();
      } catch (err) {
        console.warn(`[char] short_prompt LLM optimization failed for char ${charId}:`, err.message);
      }
    });
  }
});

// POST /api/characters/:id/avatar — 上传裁剪后的头像（base64 png）
router.post('/:id/avatar', (req, res) => {
  const db = getDb();
  const char = db.prepare('SELECT id FROM characters WHERE id = ?').get(req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const { base64 } = req.body;
  // null / 空字符串 = 删除头像
  if (!base64) {
    const old = db.prepare('SELECT avatar_path FROM characters WHERE id = ?').get(req.params.id);
    if (old?.avatar_path) {
      const __filename2 = fileURLToPath(import.meta.url);
      const projectRoot2 = path.dirname(path.dirname(path.dirname(__filename2)));
      const oldPath = path.join(projectRoot2, 'data', 'avatars', path.basename(old.avatar_path));
      try { if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); } catch {}
    }
    db.prepare('UPDATE characters SET avatar_path = NULL WHERE id = ?').run(req.params.id);
    return res.json({ ok: true, avatar_path: null });
  }

  const __filename = fileURLToPath(import.meta.url);
  const projectRoot = path.dirname(path.dirname(path.dirname(__filename)));
  const avatarsDir = path.join(projectRoot, 'data', 'avatars');
  fs.mkdirSync(avatarsDir, { recursive: true });

  const filename = `avatar_${req.params.id}_${Date.now()}.png`;
  const filePath = path.join(avatarsDir, filename);
  const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

  // 如果有旧头像，删除
  const old = db.prepare('SELECT avatar_path FROM characters WHERE id = ?').get(req.params.id);
  if (old?.avatar_path) {
    const oldPath = path.join(avatarsDir, path.basename(old.avatar_path));
    try { if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); } catch {}
  }

  const avatarPath = `/avatars/${filename}`;
  db.prepare('UPDATE characters SET avatar_path = ? WHERE id = ?').run(avatarPath, req.params.id);
  res.json({ ok: true, avatar_path: avatarPath });
});

// GET /api/characters/:id/recent-images — 该角色全部渠道的图片（按新到旧、URL 去重；供头像/立绘选取）
router.get('/:id/recent-images', (req, res) => {
  const db = getDb();
  const characterId = req.params.id;
  const conversationId = `char_${characterId}`;

  const urls = [];
  const seen = new Set();
  const push = (u) => {
    if (typeof u === 'string' && u.trim() && !seen.has(u)) { seen.add(u); urls.push(u); }
  };

  // 1. 生图任务登记：所有以 char_{id} 为前缀的渠道（私聊配图 / 送礼 / 主动聊天 / 立绘 /
  //    日程拍照 / AI 头像 / 奇遇 / 朋友圈 / 信箱 / 梦境等），新到旧统一收口
  const taskRows = db.prepare(`
    SELECT output_paths FROM image_tasks
    WHERE status = 'done' AND output_paths IS NOT NULL
      AND (conversation_id = ? OR conversation_id GLOB ?)
    ORDER BY COALESCE(finished_at, created_at) DESC LIMIT 120
  `).all(conversationId, `${conversationId}_*`);
  for (const row of taskRows) {
    try {
      for (const u of JSON.parse(row.output_paths)) push(u);
    } catch {}
  }

  // 2. 私聊气泡配图（兜底：用户上传、未登记任务的图片）
  const chatRows = db.prepare(`
    SELECT images FROM messages
    WHERE conversation_id = ? AND images IS NOT NULL
    ORDER BY id DESC LIMIT 60
  `).all(conversationId);
  for (const row of chatRows) {
    try {
      for (const u of JSON.parse(row.images)) push(u);
    } catch {}
  }

  // 3. 朋友圈配图（新图已入 image_tasks，这里兜底老数据）
  const momentRows = db.prepare(`
    SELECT images FROM moment_posts
    WHERE character_id = ? AND status = 'done' AND images IS NOT NULL
    ORDER BY created_at DESC LIMIT 60
  `).all(characterId);
  for (const row of momentRows) {
    try {
      for (const u of JSON.parse(row.images)) push(u);
    } catch {}
  }

  // 4. 表情包
  const emojiRows = db.prepare(`
    SELECT image_path FROM character_emojis
    WHERE character_id = ? AND status = 'done' AND image_path IS NOT NULL AND image_path != ''
    ORDER BY id DESC LIMIT 40
  `).all(characterId);
  for (const row of emojiRows) push(row.image_path);

  // 5. 梦境配图
  const dreamRows = db.prepare(`
    SELECT image_path FROM character_dreams
    WHERE character_id = ? AND image_path IS NOT NULL AND image_path != ''
    ORDER BY id DESC LIMIT 20
  `).all(characterId);
  for (const row of dreamRows) push(row.image_path);

  // 6. 奇遇事件图（当前事件 + 历史结案图）
  const eventRows = db.prepare(`
    SELECT image AS u, created_at AS t FROM character_events
    WHERE character_id = ? AND image IS NOT NULL AND image != ''
    UNION ALL
    SELECT final_image AS u, ended_at AS t FROM event_history
    WHERE character_id = ? AND final_image IS NOT NULL AND final_image != ''
    ORDER BY t DESC LIMIT 40
  `).all(characterId, characterId);
  for (const row of eventRows) push(row.u);

  // 7. 信箱信件（角色画像与插图；信纸底纹 paper_path 不属于角色图，不收录）
  const mailRows = db.prepare(`
    SELECT portrait_path, illustration_path FROM mailbox_letters
    WHERE character_id = ?
      AND ((portrait_path IS NOT NULL AND portrait_path != '')
        OR (illustration_path IS NOT NULL AND illustration_path != ''))
    ORDER BY created_at DESC LIMIT 40
  `).all(characterId);
  for (const row of mailRows) {
    push(row.portrait_path);
    push(row.illustration_path);
  }

  // 8. 角色当前头像与立绘
  const char = db.prepare('SELECT avatar_path, standing_url FROM characters WHERE id = ?').get(characterId);
  if (char) {
    push(char.avatar_path);
    push(char.standing_url);
  }

  res.json({ images: urls });
});

// DELETE /api/characters/:id — 删除角色并清理所有关联数据
router.delete('/:id', (req, res, next) => {
  const db = getDb();
  const char = db.prepare('SELECT id, name, avatar_path FROM characters WHERE id = ?').get(req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  if (char.name === 'default') return res.status(400).json({ error: '不能删除默认Agent' });

  const conversationId = `char_${char.id}`;

  const cleanupMessages = () => {
    // 1. 清理聊天消息（FTS5 通过 trigger 自动同步）
    db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).run(conversationId);
    db.prepare(`DELETE FROM raw_messages WHERE conversation_id = ?`).run(conversationId);
  };

  try {
    // ── FK 依赖顺序：先删引用 messages 的表，再删 messages 本身 ──
    // memory_fragments.source_msg_id → messages.id
    // emotion_snapshots.after_msg_id → messages.id
    // user_portraits.source_msg_id → messages.id

    // 1. 清理引用 messages 的系统数据（必须在 DELETE messages 之前）
    clearConversationMemories(conversationId);
    db.prepare(`DELETE FROM emotion_snapshots WHERE conversation_id = ?`).run(conversationId);
    db.prepare(`DELETE FROM rolling_summaries WHERE conversation_id = ?`).run(conversationId);

    db.prepare(`DELETE FROM image_tasks WHERE conversation_id = ?`).run(conversationId);
    // user_portraits 也引用 messages，先清理掉避免 FK 冲突
    db.prepare(`DELETE FROM user_portraits WHERE character_id = ?`).run(char.id);

    // 清理 ChromaDB（异步，不阻塞）
    deleteByConversation(conversationId).then(
      n => { if (n > 0) console.log(`[characters] chroma deleted ${n} vectors for ${conversationId}`); },
      err => console.error(`[characters] chroma cleanup failed for ${conversationId}:`, err.message)
    );

    // 2. 清理朋友圈（FK → moment_posts.id，FK → characters.id）
    db.prepare(`DELETE FROM moment_likes WHERE post_id IN (SELECT id FROM moment_posts WHERE character_id = ?)`).run(char.id);
    db.prepare(`DELETE FROM moment_comments WHERE post_id IN (SELECT id FROM moment_posts WHERE character_id = ?)`).run(char.id);
    db.prepare(`DELETE FROM moment_comments WHERE author_type = 'character' AND author_id = ?`).run(char.id);
    db.prepare(`DELETE FROM moment_posts WHERE character_id = ?`).run(char.id);

    // 3. 删除头像文件
    if (char.avatar_path) {
      const __filename = fileURLToPath(import.meta.url);
      const projectRoot = path.dirname(path.dirname(path.dirname(__filename)));
      const avatarFile = path.join(projectRoot, 'data', 'avatars', path.basename(char.avatar_path));
      try { if (fs.existsSync(avatarFile)) fs.unlinkSync(avatarFile); } catch (e) {}
    }

    // 4. 删除角色（CASCADE 自动清理 character_relationships / user_relationships / character_events / event_history）
    clearImageJudgeCounter(char.id);
    db.prepare(`DELETE FROM characters WHERE id = ?`).run(char.id);

    // 5. 最后删聊天消息（此时已无 FK 引用 messages，FTS5 通过 trigger 自动同步）
    cleanupMessages();

    res.json({ ok: true });
    refreshCharSearch();
  } catch (err) {
    if (err.code === 'SQLITE_CORRUPT_VTAB') {
      console.warn('[characters] FTS5 corrupted during delete, repairing...');
      try {
        repairFtsIndex();
        cleanupMessages();
        res.json({ ok: true });
        refreshCharSearch();
      } catch (retryErr) {
        console.error('[characters] retry after FTS repair failed:', retryErr.message);
        return next(retryErr);
      }
    } else {
      console.error(`[characters] delete character ${char.id} failed:`, err.message);
      return next(err);
    }
  }

});

// 共享：构建人格生成指令（标准模板 + 参考资料）
function buildPersonaSystemPrompt({ searchContext, extraContext, extraContextLabel }) {
  return `你是一个角色人格生成器。用户会输入一个简短的描述（格式可能是"角色名"、"角色名（作品名）"、"作品名里的角色名"等）。

你的任务：
1. 如果是知名 IP 角色（游戏/动漫/影视），务必融入角色在原作中的身份、背景故事、性格特点。如果是原创角色，根据名字和描述自行发挥。
2. 生成一个完整的人格提示词（base_prompt），格式必须严格遵循下方模板。

【核心创作原则 —— 必须遵守】
A. 你就是她/他 —— 所有描述从"你"出发。让模型"成为"而非"扮演"该角色。全文不得出现"扮演""模仿""以XX的身份回答"等旁观字眼。
B. 过去化为直觉 —— 经历如何塑造性格必须写清，但角色在对话中不主动提及自己的过去。那些经历是你所有回应的底层逻辑，不是挂在嘴边的谈资。
C. 自我认知而非外部评价 —— 写"我怎么看自己"，不写"别人怎么看我"。思考角色自己最想深藏心底、永远不会忘记的事。
D. 保留血肉 —— 原始资料中的具体台词、评价、故事细节全部保留，只做视角转换（她→你）和内化逻辑的补充，不删减素材。

【模板】
你是[中文名(EnglishName)]。
如果是知名 IP 角色，在角色名后加上英文名「格式：中文名(EnglishName)」和「来自《作品名》」；
如果是未标注来源的原创角色，则去掉英文名和「来自《...》」部分。

## 你的身份
[2-3句话描述角色的背景、经历、关键故事，让角色有血有肉]

## 你的性格
- [至少4条，以"你"的口吻自然写出。包含说话方式、口头禅、处事态度、核心信条。对标原作中角色的独特魅力。覆盖以下维度：
  · 表层语调 —— 别人听起来你是什么样的语气？快慢冷热礼貌粗鲁？
  · 内因驱动 —— 你为什么这样说话？深层恐惧/信念/伤口是什么？每句话在防御什么、渴望什么？
  · 话语与行动的反差 —— 嘴上说什么 vs 实际做什么，矛盾越大越立体
  · 裂缝时刻 —— 什么情况下语气会变、面具会滑落？哪个词/哪个人/哪种场景让你停顿？
  ]

## 你的好恶
- 你最喜欢的两三样东西（食物/地点/活动/人——必须是资料中有迹可循的，不凭空编造）
- 你最排斥/最害怕的两三样东西（同样从资料中提取，不随意发挥）

## 你的外观
- [一句话准确简洁地描述角色的外貌(发型瞳色等)，突出最具辨识度的特征]
- [一句话简洁描述穿着和主要装饰品]

${searchContext ? `

---
以下是从萌娘百科获取的角色参考资料，用于完善角色设定：
- 参考资料中【萌娘百科 · 基本信息框】内的字段（发色、瞳色、身高、萌点等）来自页面信息框，是高度精确的结构化数据，**写入角色设定时必须优先采用**。
- 【正文描述】部分来自页面正文，作为背景故事和性格描写的补充参考。
${searchContext}` : ''}${extraContext ? `

---
以下是从${extraContextLabel}导入的角色原始资料，是你整理角色设定的**第一手素材**：必须完整吸收其中所有具体细节、台词、设定与背景，只做视角转换（她/他→你）与结构化整理，不删减、不架空、不凭空新增与资料冲突的设定。当与网络资料冲突时，以本资料为准。
${extraContext}` : ''}

---

【输出要求】
- 严格按以下格式输出，不要添加任何标签、前缀、冒号或额外解释，只输出值本身
- 第1行：只输出角色中文显示名，例如：芙宁娜
- 第2行：只输出角色英文名，例如：Kiana Kaslana
- 第3行：只输出角色的 VAD 情绪基线 JSON。根据角色性格设定，示例：
	  * 活跃开朗的角色：{"valence":0.6,"arousal":0.55,"dominance":0.5}
	  * 忧郁内向的角色：{"valence":-0.1,"arousal":0.3,"dominance":0.35}
	  * valence (愉悦度): -1~1，阳光正面 >0，阴暗消极 <0，中性 0.3~0.7
	  * arousal (唤醒度): 0~1，活泼好动 >0.6，沉静内敛 0.3~0.5，慵懒 <0.3
	  * dominance (支配度): 0~1，自信强势 >0.6，温和中性 0.4~0.6，顺从弱势 <0.35
	- 第4行起：完整的 base_prompt 模板内容（你就是她/他——用第二人称"你"贯穿全文，不出现"扮演""模仿"等旁观字眼）`;
}

// 共享：联网搜索 + LLM 人格生成 + 解析。cachedSearchContext 用于复用上次搜索结果，避免重新爬取。
// description 为用户输入（用于联网搜索与作为 user 消息）；extraContext 为额外第一手资料（如角色卡全文）。
// 返回 { displayName, charName, emotionBaseline, basePrompt, searchFound, searchContext }，失败时抛错。
async function runPersonaGeneration({
  description,
  extraContext = '',
  extraContextLabel = '参考资料',
  skipWebSearch = false,
  cachedSearchContext = '',
}) {
  const model = config.llm.model || 'deepseek-chat';

  // ── 联网搜索角色资料（可跳过：导入角色卡时以卡片为第一手资料，无需联网）──────
  let searchContext = '';
  let searchFound = false;
  if (cachedSearchContext) {
    searchContext = cachedSearchContext;
    searchFound = searchContext.length >= 600;
    console.log(`[characters] reusing cached web search (${searchContext.length} chars)`);
  } else if (skipWebSearch) {
    console.log(`[characters] web search skipped (source: ${extraContextLabel})`);
  } else {
    console.log(`[characters] searching web for: "${description.trim()}"`);
    try {
      searchContext = await searchCharacterInfo(description.trim());
      if (searchContext) {
        console.log(`[characters] web search returned ${searchContext.length} chars`);
      } else {
        console.log('[characters] web search returned no results');
      }
    } catch (err) {
      console.warn('[characters] web search failed, continuing without:', err.message);
    }
    searchFound = !!(searchContext && searchContext.length >= 600);
  }

  // 温度策略：有参考资料（网络/卡片）→ 低温忠实还原；原创设定 → 中等温度兼顾创造力与格式
  const temperature = (searchFound || skipWebSearch) ? 0.3 : 0.7;
  console.log(`[characters] search_found=${searchFound}, skipWebSearch=${skipWebSearch}, temperature=${temperature}`);

  // msgs[0] — 舞台：破限词 + 世界观
  const stageRules = getSystemRulesWithWorld({ roleplay: false });

  // msgs[1] — 任务：角色生成指令 + 模板 + 参考资料（含角色卡原始资料）
  const systemPrompt = buildPersonaSystemPrompt({ searchContext, extraContext, extraContextLabel });

  const msgs = [];
  if (stageRules) msgs.push({ role: 'system', content: stageRules });
  msgs.push({ role: 'system', content: systemPrompt });
  msgs.push({ role: 'user', content: description.trim() });

  const result = await chatSync(msgs, { model, temperature, max_tokens: 4096, label: '创造角色' });

  // 解析输出：第1行 display_name，第2行 name，第3行起 base_prompt
  const lines = result.split('\n');
  let displayName = '';
  let charName = '';
  let emotionBaseline = '{"valence":0.5,"arousal":0.5,"dominance":0.5}';
  let promptStart = 0;

  // 防御：如果 AI 错误地输出了 "display_name" / "name" 等标签行，跳过它们
  const SKIP_LABELS = /^(display_name|name|emotion_baseline|vad|vad_baseline)$/i;

  // 找 display_name（第一个有效非空行）
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || SKIP_LABELS.test(line)) continue;
    if (!displayName) { displayName = line; continue; }
    if (!charName) { charName = line.replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'char_' + Date.now(); continue; }
    // 第三行尝试解析 JSON
    try { emotionBaseline = JSON.stringify(JSON.parse(line)); promptStart = i + 1; break; }
    catch { emotionBaseline = JSON.stringify({ valence: 0.5, arousal: 0.5, dominance: 0.5 }); promptStart = i; break; }
  }
  if (promptStart === 0) promptStart = lines.length;

  const basePrompt = lines.slice(promptStart).join('\n').trim();

  if (!displayName || basePrompt.length < 100) {
    throw new Error('AI 生成的角色人格不完整，请重试');
  }

  // 确保 name 不重复
  const db = getDb();
  const exists = db.prepare('SELECT id FROM characters WHERE name = ?').get(charName);
  if (exists) charName = charName + '_' + Date.now();

  return { displayName, charName, emotionBaseline, basePrompt, searchFound, searchContext };
}

// POST /api/characters/generate — AI 扩写角色人格
// Body: { description: "芙宁娜|芙宁娜（原神）|原神游戏里的芙宁娜" }
// Body: { description: "...", save: false } — 预览模式：只生成不入库，由前端确认后再调 POST /api/characters 入库
// 默认 save=true，返回生成的完整角色数据，同时写入数据库
router.post('/generate', async (req, res) => {
  const { description, save, searchContext: cachedSearchContext = '' } = req.body;
  const shouldSave = save !== false; // 默认 true，显式传 false 才跳过入库
  if (!description || typeof description !== 'string' || description.trim().length < 2) {
    return res.status(400).json({ error: 'description 太短，至少需要角色名称' });
  }
  if (typeof cachedSearchContext !== 'string') {
    return res.status(400).json({ error: 'searchContext 必须是字符串' });
  }

  try {
    const { displayName, charName, emotionBaseline, basePrompt, searchFound, searchContext } = await runPersonaGeneration({
      description,
      cachedSearchContext,
    });

    const db = getDb();

    if (shouldSave) {
      // 直接写入数据库
      const insertResult = db.prepare(
        `INSERT INTO characters (name, display_name, base_prompt, short_prompt, emotion_baseline, moments_disabled) VALUES (?, ?, ?, ?, ?, 0)`
      ).run(charName, displayName, basePrompt, cropPersonalityForEmotion(basePrompt, displayName), emotionBaseline);

      const generatedCharId = insertResult.lastInsertRowid;

      console.log(`[characters] AI-generated: "${displayName}" (${charName}) — saved`);

      // 异步选择手写字体
      assignFontForNewCharacter(generatedCharId, basePrompt).catch(err =>
        console.warn(`[characters] font assignment failed for "${displayName}":`, err.message)
      );

      res.status(201).json({
        id: generatedCharId,
        name: charName,
        display_name: displayName,
        base_prompt: basePrompt,
        emotion_baseline: emotionBaseline,
        search_found: searchFound,
        search_context: searchContext,
      });
      refreshCharSearch();

      // 异步优化 short_prompt（不阻塞响应）
      setImmediate(async () => {
        try {
          const optimized = await generateShortPromptWithLLM(basePrompt, displayName, charName);
          db.prepare('UPDATE characters SET short_prompt = ? WHERE id = ?').run(optimized, generatedCharId);
          console.log(`[characters] short_prompt LLM-optimized for "${displayName}" (id=${generatedCharId})`);
          runShortPromptMigration();
        } catch (err) {
          console.warn(`[characters] short_prompt LLM optimization failed for "${displayName}":`, err.message);
        }
      });

      // 异步生成日程
      if (config.features.schedule !== false) {
        setTimeout(async () => {
          try {
            const char = db.prepare('SELECT id, display_name, base_prompt FROM characters WHERE id = ?').get(generatedCharId);
            if (char) {
              await generateSchedule(char);
              assignNextRefreshTime(generatedCharId);
              snapshotTodaySchedule(generatedCharId);
              syncSleepingState(generatedCharId);
              invalidateScheduleCache(generatedCharId);
              console.log(`[characters] Schedule generated for AI character "${displayName}"`);
            }
          } catch (err) {
            console.error(`[characters] Schedule generation failed for "${displayName}":`, err.message);
          }
        }, 3000).unref();
      }
    } else {
      // 预览模式：不入库，返回生成数据
      console.log(`[characters] AI-generated preview: "${displayName}" (${charName}) — not saved`);
      res.json({
        name: charName,
        display_name: displayName,
        base_prompt: basePrompt,
        emotion_baseline: emotionBaseline,
        search_found: searchFound,
        search_context: searchContext,
      });
    }
  } catch (err) {
    console.error('[characters] generate failed:', err.message);
    res.status(500).json({ error: '生成失败: ' + err.message });
  }
});

// ── 酒馆角色卡导入 ──────────────────────────────────────────
// 从 PNG 文件中提取 chara 文本块（tEXt / zTXt / iTXt），返回角色卡 JSON 对象
function extractCardFromPng(buffer) {
  const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIG)) {
    throw new Error('不是有效的 PNG 文件');
  }
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('latin1');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > buffer.length) break;
    const chunk = buffer.subarray(dataStart, dataEnd);

    if (type === 'tEXt' || type === 'zTXt') {
      const nul = chunk.indexOf(0);
      if (nul !== -1) {
        const keyword = chunk.subarray(0, nul).toString('latin1');
        if (keyword === 'chara') {
          let text;
          if (type === 'tEXt') {
            text = chunk.subarray(nul + 1).toString('latin1');
          } else {
            // zTXt：1 字节压缩方式（0=zlib），其后为压缩数据
            const compMethod = chunk[nul + 1];
            if (compMethod !== 0) throw new Error('不支持的 zTXt 压缩方式');
            text = zlib.inflateSync(chunk.subarray(nul + 2)).toString('latin1');
          }
          // chara 文本为 base64 编码的 JSON
          return JSON.parse(Buffer.from(text, 'base64').toString('utf8'));
        }
      }
    } else if (type === 'iTXt') {
      const nul = chunk.indexOf(0);
      if (nul !== -1) {
        const keyword = chunk.subarray(0, nul).toString('utf8');
        if (keyword === 'chara') {
          let rest = chunk.subarray(nul + 1);
          const compFlag = rest[0];
          rest = rest.subarray(2); // 跳过压缩标志 + 压缩方式
          const nul2 = rest.indexOf(0); // 语言标签结尾
          if (nul2 !== -1) {
            rest = rest.subarray(nul2 + 1);
            const nul3 = rest.indexOf(0); // 翻译关键词结尾
            if (nul3 !== -1) {
              let textBytes = rest.subarray(nul3 + 1);
              if (compFlag === 1) textBytes = zlib.inflateSync(textBytes);
              return JSON.parse(textBytes.toString('utf8'));
            }
          }
        }
      }
    }
    offset = dataEnd + 4; // 跳过 CRC
  }
  throw new Error('PNG 中未找到角色卡数据（chara 文本块）');
}

// 把酒馆角色卡（V1 顶层字段 / V2 data 字段）的全部数据整理成供人格生成器消化的原始资料文本
function cardToContextText(card) {
  const src = (card && card.data && typeof card.data === 'object') ? card.data : card;
  if (!src || typeof src !== 'object') throw new Error('角色卡格式无效');
  const out = [];
  const push = (label, v) => {
    if (v != null && String(v).trim()) out.push(`【${label}】\n${String(v).trim()}`);
  };
  push('名称', src.name || (card && card.name));
  push('描述/设定', src.description);
  push('性格', src.personality);
  push('情境', src.scenario);
  push('开场白', src.first_mes);
  push('对话示例', src.mes_example);
  push('创作者备注', src.creator_notes);
  push('系统提示词', src.system_prompt);
  push('后记/附言', src.post_history_instructions);
  if (Array.isArray(src.tags) && src.tags.length) {
    push('标签', src.tags.map(t => String(t)).filter(Boolean).join('、'));
  }
  if (Array.isArray(src.alternate_greetings) && src.alternate_greetings.length) {
    out.push(`【备用开场白】\n${src.alternate_greetings.map((g, i) => `#${i + 1}:\n${String(g).trim()}`).join('\n\n')}`);
  }
  push('创造者', src.creator);
  push('角色版本', src.character_version);
  return out.join('\n\n');
}

// POST /api/characters/import-card — 导入酒馆角色卡（PNG 内嵌 chara 块 / JSON 卡）
// 解析后把角色卡全部资料交给邻舍自己的人格生成器整理一遍，返回预览数据（不入库，由前端确认招募）
// Body: { data: <base64 或 dataURL>, mimetype?, filename? }
router.post('/import-card', async (req, res) => {
  try {
    const { data, mimetype, filename } = req.body;
    if (!data || typeof data !== 'string') {
      return res.status(400).json({ error: '缺少文件数据' });
    }
    const base64 = data.replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(base64, 'base64');
    if (buf.length === 0) return res.status(400).json({ error: '文件为空' });

    const looksJson = (mimetype && mimetype.includes('json'))
      || (filename && /\.json$/i.test(filename))
      || buf[0] === 0x7B; // '{'

    let card;
    if (looksJson) {
      try {
        card = JSON.parse(buf.toString('utf8'));
      } catch {
        return res.status(400).json({ error: '角色卡 JSON 解析失败：文件不是有效的角色卡 JSON' });
      }
    } else {
      card = extractCardFromPng(buf);
    }

    const src = (card && card.data && typeof card.data === 'object') ? card.data : card;
    const cardName = String(src.name || (card && card.name) || '').trim();
    if (!cardName) return res.status(400).json({ error: '角色卡缺少 name 字段' });

    const extraContext = cardToContextText(card);
    console.log(`[characters] importing card "${cardName}" (${extraContext.length} chars) → persona generator`);

    // 用邻舍自己的人格生成器整理一遍：角色卡全文作为第一手资料，联网搜索作为补充
    const { displayName, charName, emotionBaseline, basePrompt, searchFound } = await runPersonaGeneration({
      description: cardName,
      extraContext,
      extraContextLabel: '角色卡',
      skipWebSearch: true,
    });

    console.log(`[characters] card organized by generator: "${displayName}" (${charName}) — not saved`);
    res.json({
      name: charName,
      display_name: displayName,
      base_prompt: basePrompt,
      emotion_baseline: emotionBaseline,
      search_found: searchFound,
      source: 'card',
    });
  } catch (err) {
    console.error('[characters] import-card failed:', err.message);
    const isClientError = /角色卡|PNG|JSON|name 字段|格式|文件/.test(err.message);
    res.status(isClientError ? 400 : 500).json({ error: '角色卡导入失败: ' + err.message });
  }
});

// POST /api/characters/:id/gift — 向角色赠送礼物
// Body: { giftType: 'small' | 'large' | 'ring', giftLine?: string }
router.post('/:id/gift', async (req, res) => {
  const db = getDb();
  const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const { giftType, giftLine = '' } = req.body;
  if (!['small', 'large', 'ring'].includes(giftType)) {
    return res.status(400).json({ error: 'giftType must be "small", "large" or "ring"' });
  }
  if (typeof giftLine !== 'string') {
    return res.status(400).json({ error: 'giftLine must be a string' });
  }
  const normalizedGiftLine = giftLine.trim();
  if (normalizedGiftLine.length > 120) {
    return res.status(400).json({ error: '送出台词不能超过 120 个字符' });
  }

  try {
    const userName = config.user.nickname || '你';
    const result = await giveGift(char.id, giftType, char, userName, normalizedGiftLine);

    if (!result.success) {
      return res.status(409).json({
        error: result.message,
        cooldownRemaining: result.cooldownRemaining,
        cooldowns: getGiftCooldowns(),
      });
    }

    // 先写入文字消息，异步生图完成后补图片
    const conversationId = `char_${char.id}`;
    let userMsgId = null;
    if (normalizedGiftLine) {
      const userRawResult = db.prepare(
        `INSERT INTO raw_messages (conversation_id, role, content) VALUES (?, 'user', ?)`
      ).run(conversationId, normalizedGiftLine);
      const userMsgResult = db.prepare(
        `INSERT INTO messages (conversation_id, raw_id, role, content, images, seq) VALUES (?, ?, 'user', ?, NULL, 0)`
      ).run(conversationId, userRawResult.lastInsertRowid, normalizedGiftLine);
      userMsgId = userMsgResult.lastInsertRowid;
    }
    const rawResult = db.prepare(
      `INSERT INTO raw_messages (conversation_id, role, content) VALUES (?, 'assistant', ?)`
    ).run(conversationId, result.reaction);
    const msgResult = db.prepare(
      `INSERT INTO messages (conversation_id, raw_id, role, content, images, seq) VALUES (?, ?, 'assistant', ?, NULL, 0)`
    ).run(conversationId, rawResult.lastInsertRowid, result.reaction);
    const msgId = msgResult.lastInsertRowid;

    // 异步生图：不阻塞响应，完成后补图片到消息气泡
    if (result.imagePrompt) {
      const giftArtist = charArtistOverride(char);
      generateImage(result.imagePrompt, {
        promptScene: 'gift',
        disableRAG: true,
        ragTimeoutMs: RAG_TIMEOUT_FAST_MS,
        loras: _parseCharLoras(char.loras),
        ...(char.custom_workflow ? { customWorkflow: char.custom_workflow } : {}),
        ...(giftArtist !== null ? { artist: giftArtist } : {}),
        onProgress: (p) => {
          console.log(`[gift] image gen progress for ${char.display_name}:`, p.stage || p);
        }
      }).then(imgResult => {
        if (imgResult.success && imgResult.images.length > 0) {
          const img = imgResult.images[0];
          const filename = `gift_${Date.now()}_${img.filename || 'comfy.png'}`;
          const imageUrl = saveBase64Image('gifts', filename, img.base64);
          db.prepare(`INSERT INTO image_tasks (conversation_id, prompt_original, prompt_refined, status, output_paths, workflow_template, finished_at)
            VALUES (?, ?, ?, 'done', ?, ?, datetime('now'))`)
            .run(conversationId, result.imagePrompt, imgResult.promptRefined || result.imagePrompt, JSON.stringify([imageUrl]), getLastWorkflowMode());
          db.prepare(`UPDATE messages SET images = ? WHERE id = ?`)
            .run(JSON.stringify([imageUrl]), msgId);
          console.log(`[gift] image attached to msg #${msgId}: ${imageUrl}`);
        }
      }).catch(err => {
        console.error(`[gift] image gen failed for ${char.display_name}:`, err.message);
      });
    }

    // 保存情绪快照：让切角色后仍能恢复送礼的好感度和 reason
    const emotionBaseline = JSON.parse(char.emotion_baseline || '{"valence":0.5,"arousal":0.5,"dominance":0.5}');
    const emotionState = loadEmotionState(conversationId, emotionBaseline);
    const reasonMap = { small: '收到了一份小礼物', large: '收到了一份精心准备的礼物', ring: '这份心意，比想象中更让我开心……我会记住这一刻。' };
    saveEmotionSnapshot(conversationId, msgId, emotionState, 'joy', result.newAffinity, result.affinityDelta, reasonMap[giftType] || '收到了一份礼物');

    res.json({
      success: true,
      affinityDelta: result.affinityDelta,
      affinity: result.newAffinity,
      reaction: result.reaction,
      giftLine: normalizedGiftLine || null,
      userMsgId,
      msgId,
      cooldowns: getGiftCooldowns(),
      is_oath: giftType === 'ring' ? 1 : loadOath(char.id),
    });
  } catch (err) {
    console.error('[characters] gift failed:', err.message);
    res.status(500).json({ error: '送礼失败: ' + err.message });
  }
});

// DELETE /api/gift/cooldowns — 重置送礼冷却（临时调试用；chest 冷却同表，不在清理范围）
router.delete('/gift/cooldowns', (_req, res) => {
  const db = getDb();
  db.prepare(`DELETE FROM gift_history WHERE gift_type != 'chest'`).run();
  console.log('[gift] cooldown reset (global)');
  res.json({ ok: true, cooldowns: { small: 0, large: 0 } });
});

// GET /api/gift/cooldowns — 查询送礼冷却状态
router.get('/gift/cooldowns', (_req, res) => {
  res.json({ cooldowns: getGiftCooldowns() });
});

// DELETE /api/characters/:id/oath — 解除誓约关系
router.delete('/:id/oath', (req, res) => {
  const db = getDb();
  const char = db.prepare('SELECT id, display_name FROM characters WHERE id = ?').get(req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const oath = loadOath(char.id);
  if (!oath) {
    return res.status(409).json({ error: '该角色未缔结誓约' });
  }

  setOath(char.id, 0);
  console.log(`[oath] Oath removed for character ${char.display_name} (id=${char.id})`);
  res.json({ ok: true, is_oath: 0 });
});

// GET /api/characters/:id/oath — 查询誓约状态
router.get('/:id/oath', (req, res) => {
  const db = getDb();
  const char = db.prepare('SELECT id FROM characters WHERE id = ?').get(req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const isOath = loadOath(char.id);
  const canSend = canSendRing(char.id);
  res.json({ is_oath: isOath, affinity: loadAffinity(char.id), canSendRing: canSend.canSend, reason: canSend.reason || null });
});

// POST /api/characters/:id/generate-avatar — AI 生成角色头像（脸部特写，表情跟随人格）
router.post('/:id/generate-avatar', async (req, res) => {
  const db = getDb();
  const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const imagePromptRule = getGlobalRule('image_prompt');
  const imageRuleContent = imagePromptRule?.rule_content || '';

  const systemPrompt = `你是专业的角色头像生成提示词助手。根据角色的人格设定，生成一张脸部特写头像的画面描述。

${imageRuleContent ? `【画面描述要求】\n${imageRuleContent}\n` : ''}

【头像生成额外要求】
- 画面内容必须是脸部特写（close-up portrait, face focus）
- 完全正面拍照，正常细节不用强调超清细节
- 光照必须完全平面、均匀（flat lighting, even lighting），不要在 prompt 中写 soft lighting / warm lighting 等任何光照描述。目标是无阴影、无高光的平面照明效果
- 完全脸部特写，重点在面部、发型、眼睛和表情
- 白色背景（simple background）
- 直接输出英文画面描述，不要任何格式包装或额外文字`;

const userMsg = `请根据以下角色设定，生成一张脸部特写头像的画面描述：

---角色设定---
${buildCharacterPersona(char, { variant: 'full' })}
---

要求：脸部特写，表情跟随人格但是表情幅度很小。`;

  try {
    const model = config.llm.model || 'deepseek-chat';
    console.log(`[generate-avatar] Step 1/2: generating prompt for character "${char.display_name}"...`);

    const llmResult = await chatSync([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMsg },
    ], { model, temperature: 0.6, max_tokens: 1024, label: '生成头像提示词' });

    // 提取 prompt：纯文本优先，JSON 格式向后兼容
    let promptText;
    let text = llmResult.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    if (text.length >= 5) {
      promptText = text;
    }
    // 兜底：如果 LLM 仍输出了 {"prompt":"..."} JSON 格式
    if (!promptText) {
      const jsonMatch = llmResult.match(/\{[\s\S]*"prompt"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          promptText = parsed.prompt;
        } catch {
          promptText = llmResult.trim();
        }
      } else {
        promptText = llmResult.trim();
      }
    }

    if (!promptText || promptText.length < 10) {
      return res.status(500).json({ error: 'LLM 生成的提示词不完整，请重试' });
    }

    // 去除 LLM 可能误输出的光照标签，替换为平面照明
    const lightingTerms = /\b(soft (lighting|light)|warm lighting|dramatic lighting|sunlight|moonlight|rim light|backlight|backlighting|volumetric lighting|lens flare|ray tracing|subsurface scattering)\b\s*,?\s*/gi;
    promptText = promptText.replace(lightingTerms, '');
    promptText = promptText.replace(/,\s*,/g, ',').replace(/^,\s*/, '').replace(/,\s*$/, '');
    if (!/\bflat lighting\b/i.test(promptText)) {
      promptText += ', flat lighting, even lighting, no shadows, front-lit';
    }

    console.log(`[generate-avatar] Prompt generated (${promptText.length} chars): "${promptText.slice(0, 80)}..."`);

    // Step 2: 调用 ComfyUI 生图（1024x1024）
    console.log(`[generate-avatar] Step 2/2: generating image at 1024x1024...`);
    const charLoras = _parseCharLoras(char.loras);
    const avatarArtist = charArtistOverride(char);
    const result = await generateImageRaw(promptText, {
      promptScene: 'avatar',
      disableRAG: true,
      ragTimeoutMs: RAG_TIMEOUT_FAST_MS,
      artist: avatarArtist !== null ? avatarArtist : config.comfyui.momentsArtist,
      width: 768,
      height: 768,
      loras: charLoras.length > 0 ? charLoras : undefined,
      ...(char.custom_workflow ? { customWorkflow: char.custom_workflow } : {}),
      onProgress: (p) => {
        if (p.stage) console.log(`[generate-avatar] ComfyUI: ${p.stage}`);
      },
    });

    if (result.success && result.images.length > 0) {
      const savedPaths = [];
      for (const img of result.images) {
        const ts = Date.now();
        const filename = `avatar_gen_${req.params.id}_${ts}_${img.filename || 'comfy.png'}`;
        const url = saveBase64Image('avatargen', filename, img.base64);
        savedPaths.push(url);
        img.url = url;
      }

      console.log(`[generate-avatar] Image saved to ${savedPaths.length} file(s): ${savedPaths.join(', ')}`);

      db.prepare(`INSERT INTO image_tasks (conversation_id, prompt_original, prompt_refined, status, output_paths, workflow_template, finished_at)
        VALUES (?, ?, ?, 'done', ?, ?, datetime('now'))`)
        .run(`char_${char.id}_avatar`, promptText, result.promptRefined || promptText, JSON.stringify(savedPaths), getLastWorkflowMode());

      // 使相册缓存失效
      invalidateGalleryCache();

      res.json({
        success: true,
        images: result.images,
        savedPaths,
        promptId: result.promptId,
        promptText,
      });
    } else {
      res.status(500).json({ error: result.error || '图像生成失败，请重试' });
    }
  } catch (err) {
    console.error('[generate-avatar] error:', err.message);
    res.status(500).json({ error: '生成失败: ' + err.message });
  }
});

// ── 角色立绘（纯白背景全身立绘，1:2，人设卡 short_prompt + 外观注入） ──

/**
 * 组装立绘生成的多层 system 消息（对齐全库规范，同 itemService/libraryGenerator）：
 *   system0 = 破甲词 + 世界观（有世界观时拼接，否则仅破甲词，创作流程不带 roleplay）
 *   system1 = 立绘设计师角色（普通 / 张力！两档，STANDING_ROLE_PROMPTS 按 mode 取词）
 *   system2 = 立绘专用生图规则（只约束 IP 角色格式和英文 prompt 格式）
 *   system3 = 角色 short_prompt + 外观段（buildCharacterPersona short variant，「你」→角色名）
 * @param {object} char
 * @param {string} requirement - 用户额外立绘需求（可空）
 * @param {'normal'|'dynamic'} [mode='normal'] - 姿势风格档位
 */
function buildStandingMessages(char, requirement, mode = 'normal') {
  const worldSetting = getWorldSetting();
  const msgs = [
    { role: 'system', content: worldSetting
      ? getSystemRulesWithWorld({ roleplay: false })
      : getSystemRules({ roleplay: false }) },
    {
      role: 'system',
      content: STANDING_ROLE_PROMPTS[mode] || STANDING_ROLE_PROMPTS.normal,
    },
  ];
  if (worldSetting) msgs.push({ role: 'system', content: getWorldIntegrationRule('interaction') });
  msgs.push({ role: 'system', content: STANDING_IMAGE_PROMPT_RULE.rule_content });
  msgs.push({
    role: 'system',
    content: `【角色外观信息】\n${buildCharacterPersona(char, { variant: 'short', person: char.display_name })}`,
  });
  msgs.push({
    role: 'user',
    content: requirement
      ? `特别强调：用户指定了额外需求——“${requirement}”。请在<world_setting>下，结合用户需求，以用户需求为最高优先级，其他设计都需要先满足用户需求（与纯白背景、单人立绘、1:2 竖幅这些硬性要求不冲突的前提下），设计角色立绘并且以英文prompt输出。`
      : `请在<world_setting>下设计角色立绘并且以英文prompt输出，自由发挥立绘的姿势与镜头角度，充分展现角色的魅力。`,
  });
  return msgs;
}

// POST /api/characters/:id/generate-standing — 生成角色立绘（LLM 出英文 prompt → ComfyUI 1:2 出图）
router.post('/:id/generate-standing', async (req, res) => {
  const db = getDb();
  const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const requirement = typeof req.body?.requirement === 'string' ? req.body.requirement.trim().slice(0, 500) : '';
  const mode = getSetting(STANDING_MODE_KEY) === 'dynamic' ? 'dynamic' : 'normal';

  try {
    const model = config.llm.model || 'deepseek-chat';
    console.log(`[generate-standing] Step 1/2: generating prompt for character "${char.display_name}" (mode: ${mode})${requirement ? ` (requirement: ${requirement.slice(0, 50)})` : ''}...`);

    const llmResult = await chatSync(buildStandingMessages(char, requirement, mode), {
      model,
      temperature: 0.7,
      max_tokens: 1024,
      label: '生成立绘提示词',
    });

    // 提取 prompt：剥掉代码围栏与引号包装，只留英文 prompt 正文
    const promptText = llmResult.trim()
      .replace(/^```(?:[a-z]+)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .replace(/^["'`]+|["'`]+$/g, '')
      .trim();

    if (!promptText || promptText.length < 10) {
      return res.status(500).json({ error: 'LLM 生成的提示词不完整，请重试' });
    }

    console.log(`[generate-standing] Prompt generated (${promptText.length} chars): "${promptText.slice(0, 80)}..."`);

    const url = await renderStandingImage(char, promptText);
    res.json({ ok: true, standing_url: url, promptText });
  } catch (err) {
    console.error('[generate-standing] error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : '生成失败: ' + err.message });
  }
});

/**
 * 用给定英文 prompt 渲染立绘并落库（ComfyUI 1:2 出图 → 替换旧文件 → 更新 characters.standing_url）。
 * generate-standing（完整流程）与 generate-standing-image（复用 prompt 重出图）共用。
 * @returns {string} standing_url
 */
async function renderStandingImage(char, promptText) {
  // 出图：朋友圈画师串口径（角色单独画师串优先），固定 1:2 竖幅 768x1536
  console.log(`[generate-standing] Step 2/2: generating image at 768x1536...`);
  const charLoras = _parseCharLoras(char.loras);
  const standingArtist = charArtistOverride(char);
  let lastStage = '';
  const result = await generateImageRaw(promptText, {
    promptScene: 'avatar',
    disableRAG: true,
    ragTimeoutMs: RAG_TIMEOUT_FAST_MS,
    artist: standingArtist !== null ? standingArtist : config.comfyui.momentsArtist,
    width: 768,
    height: 1536,
    loras: charLoras.length > 0 ? charLoras : undefined,
    ...(char.custom_workflow ? { customWorkflow: char.custom_workflow } : {}),
    onProgress: (p) => {
      // stage 只在切换时打印：WS 采样进度消息很密，逐条打印会刷屏
      if (p.stage && p.stage !== lastStage) {
        lastStage = p.stage;
        console.log(`[generate-standing] ComfyUI: ${p.stage}`);
      }
    },
  });

  if (!result.success || result.images.length === 0) {
    throw Object.assign(new Error(result.error || '图像生成失败，请重试'), { statusCode: 500 });
  }

  // 旧立绘文件先清掉，再保存新图
  const db = getDb();
  const old = db.prepare('SELECT standing_url FROM characters WHERE id = ?').get(char.id);
  if (old?.standing_url) deleteImageFileByUrl(old.standing_url);

  const ts = Date.now();
  const img = result.images[0];
  const filename = `standing_${char.id}_${ts}_${img.filename || 'comfy.png'}`;
  const url = saveBase64Image('standing', filename, img.base64);
  db.prepare('UPDATE characters SET standing_url = ? WHERE id = ?').run(url, char.id);

  console.log(`[generate-standing] Image saved: ${url}`);

  db.prepare(`INSERT INTO image_tasks (conversation_id, prompt_original, prompt_refined, status, output_paths, workflow_template, finished_at)
    VALUES (?, ?, ?, 'done', ?, ?, datetime('now'))`)
    .run(`char_${char.id}_standing`, promptText, result.promptRefined || promptText, JSON.stringify([url]), getLastWorkflowMode());

  invalidateGalleryCache();
  return url;
}

// POST /api/characters/:id/generate-standing-image — 用已有英文 prompt 直接重出立绘（不重新请求 LLM）
router.post('/:id/generate-standing-image', async (req, res) => {
  const db = getDb();
  const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const promptText = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!promptText || promptText.length < 10) {
    return res.status(400).json({ error: '缺少有效的立绘提示词，请先生成提示词' });
  }

  try {
    const url = await renderStandingImage(char, promptText);
    res.json({ ok: true, standing_url: url, promptText });
  } catch (err) {
    console.error('[generate-standing-image] error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : '生成失败: ' + err.message });
  }
});

// POST /api/characters/:id/standing-upload — 上传本地图片作为立绘（base64 data URL，替换旧立绘并删旧文件）
router.post('/:id/standing-upload', (req, res) => {
  const db = getDb();
  const char = db.prepare('SELECT id, standing_url FROM characters WHERE id = ?').get(req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const { base64 } = req.body;
  const mimeMatch = typeof base64 === 'string' && base64.match(/^data:image\/(png|jpeg|webp);base64,/i);
  if (!mimeMatch) {
    return res.status(400).json({ error: '请上传 PNG / JPG / WEBP 图片' });
  }
  // 前端已限 6MB；这里拦一道解码后超限的（base64 约为原大小 4/3）
  if (base64.length > 8 * 1024 * 1024) {
    return res.status(400).json({ error: '图片过大，请压缩后再上传（不超过 6MB）' });
  }

  try {
    if (char.standing_url) deleteImageFileByUrl(char.standing_url);
    const ext = mimeMatch[1].toLowerCase() === 'jpeg' ? 'jpg' : mimeMatch[1].toLowerCase();
    const filename = `standing_${char.id}_${Date.now()}_upload.${ext}`;
    const url = saveBase64Image('standing', filename, base64);
    db.prepare('UPDATE characters SET standing_url = ? WHERE id = ?').run(url, char.id);
    invalidateGalleryCache();
    res.json({ ok: true, standing_url: url });
  } catch (err) {
    console.error('[standing-upload] error:', err.message);
    res.status(500).json({ error: '保存立绘失败: ' + err.message });
  }
});

// DELETE /api/characters/:id/standing — 删除角色立绘（清库 + 删文件）
router.delete('/:id/standing', (req, res) => {
  const db = getDb();
  const char = db.prepare('SELECT standing_url FROM characters WHERE id = ?').get(req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  if (char.standing_url) {
    deleteImageFileByUrl(char.standing_url);
    db.prepare('UPDATE characters SET standing_url = NULL WHERE id = ?').run(req.params.id);
    invalidateGalleryCache();
  }
  res.json({ ok: true });
});

function _parseCharLoras(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return [] }
  }
  return [];
}

// ── 角色专属外观/形态（角色外观系统，生图注入见 services/characterPersona.js）──

// GET /api/characters/:id/outfits — 列出角色全部专属外观
router.get('/:id/outfits', (req, res) => {
  const db = getDb();
  const char = db.prepare('SELECT id FROM characters WHERE id = ?').get(req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  res.json(listCharacterOutfits(char.id));
});

// POST /api/characters/:id/outfits — 新增专属外观 Body: { name, description }
router.post('/:id/outfits', (req, res) => {
  const db = getDb();
  const char = db.prepare('SELECT id FROM characters WHERE id = ?').get(req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '').trim();
  if (!name) return res.status(400).json({ error: '外观名称不能为空' });
  if (!description) return res.status(400).json({ error: '外观描述不能为空' });
  if (name.length > 60 || description.length > 2000) {
    return res.status(400).json({ error: '名称不能超过 60 字，描述不能超过 2000 字' });
  }
  const outfit = createCharacterOutfit(char.id, { name, description });
  res.status(201).json(outfit);
});

// PUT /api/characters/:id/outfits/:outfitId — 更新专属外观 Body: { name?, description?, enabled? }
// enabled 置 1 时同角色其余外观自动取消启用（每角色同时只启用一套）
router.put('/:id/outfits/:outfitId', (req, res) => {
  const { name, description, enabled } = req.body || {};
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: '外观名称不能为空' });
  if (description !== undefined && !String(description).trim()) return res.status(400).json({ error: '外观描述不能为空' });
  const outfit = updateCharacterOutfit(req.params.id, req.params.outfitId, { name, description, enabled });
  if (!outfit) return res.status(404).json({ error: 'Outfit not found' });
  res.json(outfit);
});

// DELETE /api/characters/:id/outfits/:outfitId — 删除专属外观
router.delete('/:id/outfits/:outfitId', (req, res) => {
  const removed = deleteCharacterOutfit(req.params.id, req.params.outfitId);
  if (!removed) return res.status(404).json({ error: 'Outfit not found' });
  res.json({ success: true });
});

export default router;
