import { getDb, getSystemRulesWithWorld, getGlobalRule } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { generateImage } from './imageSkill.js';
import { broadcast } from './unifiedStreamBus.js';
import { saveBase64Image } from './imagePaths.js';
import { hybridSearch } from './memorySearch.js';
import { loadEmotionState, stateToPrompt } from './emotionEngine.js';
import { formatScheduleContext } from './scheduleManager.js';
import { getTimeLight } from './timeLight.js';
import { config } from '../config.js';

const CHECK_INTERVAL = 60 * 1000;

let timer = null;
let processing = false;

export function startMailboxScheduler() {
  if (timer) return;
  console.log('[mailboxScheduler] started (check every 60s)');
  timer = setInterval(checkAndProcess, CHECK_INTERVAL);
  timer.unref();
  checkAndProcess();
}

export function stopMailboxScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}

async function checkAndProcess() {
  if (processing) return;
  processing = true;
  try {
    const db = getDb();
    const pending = db.prepare(`
      SELECT ml.*, c.id AS char_id, c.display_name, c.name, c.base_prompt,
             c.emotion_baseline, c.avatar_path, c.custom_workflow, c.loras
      FROM mailbox_letters ml
      LEFT JOIN characters c ON ml.character_id = c.id
      WHERE ml.direction = 'user_to_char'
        AND ml.status = 'pending'
        AND ml.reply_at <= datetime('now')
      ORDER BY ml.reply_at ASC
      LIMIT 1
    `).get();

    if (!pending) return;

    console.log(`[mailboxScheduler] processing letter #${pending.id} for character "${pending.display_name}"`);
    await processReply(db, pending);
  } catch (err) {
    console.error('[mailboxScheduler] check error:', err.message);
  } finally {
    processing = false;
  }
}

async function processReply(db, letter) {
  const letterId = letter.id;
  const charId = letter.char_id || letter.character_id;
  const charName = letter.display_name || letter.name;
  const charBasePrompt = letter.base_prompt || '';
  const charLoras = safeJSON(letter.loras, []);
  const charCustomWorkflow = letter.custom_workflow || null;

  // 标记 processing + 广播
  db.prepare('UPDATE mailbox_letters SET status = ? WHERE id = ?').run('processing', letterId);
  broadcast('reply_processing', {
    letter_id: letterId,
    character_id: letter.character_id,
    character_name: charName,
  });

  try {
    // ── 步骤1: LLM 生成回信 + 3 段生图 prompt ──
    const data = await generateReplyData(charId, charName, charBasePrompt, letter.content, letter.emotion_baseline);
    if (!data || !data.text) throw new Error('LLM reply generation returned empty');

    // ── 步骤2: 并发生成3张图（使用 LLM 输出的 prompt，朋友圈画师串） ──
    const [paperResult, portraitResult, illustrationResult] = await Promise.all([
      generateImageSafe(data.paperPrompt, charLoras, charCustomWorkflow, { width: 1200, height: 900 }),
      generateImageSafe(data.portraitPrompt, charLoras, charCustomWorkflow, { width: 900, height: 1200 }),
      generateImageSafe(data.illustrationPrompt, charLoras, charCustomWorkflow, { width: 1200, height: 900 }),
    ]);

    if (!paperResult || !portraitResult || !illustrationResult) {
      const f = [];
      if (!paperResult) f.push('paper');
      if (!portraitResult) f.push('portrait');
      if (!illustrationResult) f.push('illustration');
      throw new Error(`Image generation failed: ${f.join(', ')}`);
    }

    // ── 步骤3: 保存 ──
    const ts = Date.now();
    const paperPath = saveBase64Image('mailbox', `paper_${letterId}_${ts}.png`, paperResult.base64);
    const portraitPath = saveBase64Image('mailbox', `portrait_${letterId}_${ts}.png`, portraitResult.base64);
    const illustrationPath = saveBase64Image('mailbox', `illustration_${letterId}_${ts}.png`, illustrationResult.base64);

    db.prepare(`
      UPDATE mailbox_letters
      SET status = 'completed',
          direction = 'char_to_user',
          reply_content = ?,
          paper_path = ?,
          portrait_path = ?,
          illustration_path = ?,
          is_read = 0,
          replied_at = datetime('now')
      WHERE id = ?
    `).run(data.text, paperPath, portraitPath, illustrationPath, letterId);

    console.log(`[mailboxScheduler] letter #${letterId} reply completed`);

    const fullLetter = db.prepare(`
      SELECT ml.*, c.display_name, c.avatar_path
      FROM mailbox_letters ml
      LEFT JOIN characters c ON ml.character_id = c.id
      WHERE ml.id = ?
    `).get(letterId);

    broadcast('reply_ready', {
      letter_id: letterId,
      character_id: letter.character_id,
      character_name: charName,
      character_avatar: fullLetter.avatar_path,
      title: fullLetter.title,
      content: fullLetter.content,
      reply_content: data.text,
      paper_path: paperPath,
      portrait_path: portraitPath,
      illustration_path: illustrationPath,
      is_read: 0,
    });

  } catch (err) {
    console.error(`[mailboxScheduler] letter #${letterId} failed:`, err.message);

    const retryCount = (letter.retry_count || 0) + 1;
    const backoffMs = retryCount <= 1 ? 120000 : retryCount <= 2 ? 300000 : 600000;
    const nextRetry = new Date(Date.now() + backoffMs).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
    db.prepare('UPDATE mailbox_letters SET status = ?, retry_count = ?, reply_at = ? WHERE id = ?')
      .run('pending', retryCount, nextRetry, letterId);
    console.log(`[mailboxScheduler] letter #${letterId} retry ${retryCount} → backoff ${backoffMs / 1000}s`);
  }
}

// ══════════════════════════════════════════════════════════════
//  多层 prompt 构建 + LLM 调用 → JSON { text, paperPrompt, portraitPrompt, illustrationPrompt }
// ══════════════════════════════════════════════════════════════

async function generateReplyData(charId, charName, charBasePrompt, userContent, emotionBaselineRaw) {
  const db = getDb();
  const convId = `char_${charId}`;
  const msgs = [];

  const userName = config.user.nickname || '用户';

  // ── system 0: 破限词 + 世界观 ──
  const stage = getSystemRulesWithWorld();
  if (stage) msgs.push({ role: 'system', content: stage });

  // ── system 1: 角色完整人格 ──
  msgs.push({ role: 'system', content: charBasePrompt });

  // ── system 2: 朋友圈 + 对话 + 记忆 ──
  const mat2Parts = [];

  const recentMoments = db.prepare(`
    SELECT mp.content, mp.created_at FROM moment_posts mp
    WHERE mp.character_id = ? AND mp.status = 'done'
    ORDER BY mp.created_at DESC LIMIT 2
  `).all(charId);
  if (recentMoments.length > 0) {
    mat2Parts.push('【角色最近发过的朋友圈】\n' + recentMoments.map(m => `- ${m.content.slice(0, 80)}`).join('\n'));
  }

  const recentMsgs = db.prepare(`
    SELECT role, content FROM raw_messages WHERE conversation_id = ? AND role IN ('user','assistant')
    ORDER BY id DESC LIMIT 10
  `).all(convId).reverse();
  if (recentMsgs.length > 0) {
    mat2Parts.push('【最近对话记录】\n' + recentMsgs.map(m =>
      `${m.role === 'user' ? userName : charName}：${m.content.slice(0, 120)}`
    ).join('\n'));
  }

  const memories = await hybridSearch(userContent, { conversationId: convId, topK: 3 }).catch(() => []);
  if (memories.length > 0) {
    mat2Parts.push('【相关记忆碎片】\n' + memories.map(m => `- [${m.fragment_type || '记忆'}] ${m.content}`).join('\n'));
  }

  const latestSummary = db.prepare(`
    SELECT summary FROM rolling_summaries WHERE conversation_id = ? ORDER BY id DESC LIMIT 1
  `).pluck().get(convId);
  if (latestSummary) mat2Parts.push(`【最近对话摘要】${latestSummary}`);

  // 关键记忆碎片
  const topMemory = db.prepare(`
    SELECT content FROM memory_fragments WHERE conversation_id = ? ORDER BY id DESC LIMIT 1
  `).pluck().get(convId);
  if (topMemory) mat2Parts.push(`【关键记忆】${topMemory}`);

  if (mat2Parts.length > 0) msgs.push({ role: 'system', content: mat2Parts.join('\n\n') });

  // ── system 3: 用户信息 + 关系 + 好感度 + 画像 + VAD ──
  const rel3Parts = [];

  // 用户完整信息
  const userFields = [];
  if (config.user.nickname) userFields.push(`名字：${config.user.nickname}`);
  if (config.user.gender) userFields.push(`性别：${config.user.gender}`);
  if (config.user.appearance) userFields.push(`外观：${config.user.appearance}`);
  if (config.user.persona) userFields.push(`其他：${config.user.persona}`);
  if (userFields.length > 0) {
    rel3Parts.push('【' + userName + ' 的信息】\n' + userFields.join('\n'));
  }

  // 角色与用户的关系 + 好感度
  const userRel = db.prepare('SELECT relationship_text, affinity FROM user_relationships WHERE character_id = ?').get(charId);
  if (userRel?.relationship_text) {
    rel3Parts.push(`你是 ${userName} 的"${userRel.relationship_text}"。${userName} 对你好感度：${Math.round(userRel.affinity || 50)}/100。`);
  }

  // 用户画像（角色视角）
  const portraits = db.prepare(`
    SELECT trait_type, content FROM user_portraits WHERE character_id = ? ORDER BY id
  `).all(charId);
  if (portraits.length > 0) {
    const groups = {};
    for (const p of portraits) { (groups[p.trait_type] ||= []).push(p.content); }
    const label = { appearance: '外貌', personality: '性格', preference: '偏好' };
    const lines = Object.entries(groups).map(([k, v]) => `- ${label[k] || k}：${v.join('；')}`);
    rel3Parts.push(`【你眼中 ${userName} 的画像】\n${lines.join('\n')}`);
  }

  // VAD 情绪
  try {
    const baseline = safeJSON(emotionBaselineRaw, { valence: 0.5, arousal: 0.5, dominance: 0.5 });
    const emotionState = loadEmotionState(convId, baseline);
    const vadPrompt = stateToPrompt(emotionState);
    if (vadPrompt) rel3Parts.push(vadPrompt);
  } catch {}

  if (rel3Parts.length > 0) msgs.push({ role: 'system', content: rel3Parts.join('\n\n') });

  // ── system 4: 当前日程 + timeLight ──
  const ctx4Parts = [];

  const scheduleCtx = formatScheduleContext(charId);
  if (scheduleCtx) ctx4Parts.push(scheduleCtx);

  const tl = getTimeLight();
  if (tl?.timeDesc) {
    ctx4Parts.push(`当前时间：${tl.timeDesc}。光线氛围：${tl.lightNote || ''}`);
  }

  if (ctx4Parts.length > 0) msgs.push({ role: 'system', content: ctx4Parts.join('\n') });

  // ── user: 任务 ──
  const imageRule = getGlobalRule('image_prompt');
  const imageGuide = imageRule?.rule_content || '';
  const imageGuideBlock = imageGuide ? `\n\n【生图提示词编写规范】\n${imageGuide}\n\n` : '';

  const userLen = (userContent || '').length;
  const textRange = userLen < 30 ? '100~300字' : userLen <= 50 ? '200~400字' : '300~500字';
  const maxTokens = userLen < 30 ? 1200 : userLen <= 50 ? 1500 : 2000;

  const taskMsg = `你收到了一封来自 ${userName} 的来信。请以"${charName}"的身份和口吻回复这封信，并用JSON格式返回以下内容：${imageGuideBlock}
{
  "text": "你的回信正文（${textRange}，自然口语，真挚感人，符合你的性格和当前情绪）",
  "paperPrompt": "描述一张信纸的画面（英文，用于Anima模型生图）。信纸中间大面积留白并且无衬线并且中间禁止有任何装饰（用于书写），四周有符合你角色性格特征的装饰（如花卉、纹章、图腾、几何图案、角色代表色、角色标志物等）。描述须具体。按照上述生图提示词编写规范输出。",
  "portraitPrompt": "描述一张角色写信时的第三人称照片画面（英文，用于Anima模型生图）。需要包含：你(注意画面主角是你自己，用你自己人格描述里的外貌特征，不要被其他正文或者user干扰)正在哪里写这封信（书房/窗边/花园/床前/吧台/天台...）、此刻的表情神态、姿势动作、光线氛围。画面须有生活感和故事感，你眼睛不看镜头。按照上述生图提示词编写规范输出。",
  "illustrationPrompt": "描述一张配图画面（英文，用于Anima模型生图）。根据你的回信内容，提取信中提到的一个具体场景、意象或情绪画面。画面须与回信内容紧密关联。按照上述生图提示词编写规范输出。"
}

${userName} 的来信内容：
${userContent}

请只返回JSON，不要输出任何解释。`

  msgs.push({ role: 'user', content: taskMsg });

  // ── 调用 LLM ──
  try {
    const raw = await chatSync(msgs, { temperature: 0.82, max_tokens: maxTokens, response_format: { type: 'json_object' }, label: '信箱回信助手' });
    return parseReplyJSON(raw, userContent);
  } catch (err) {
    console.error('[mailboxScheduler] LLM reply error:', err.message);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════
//  JSON 解析 + fallback
// ══════════════════════════════════════════════════════════════

function parseReplyJSON(raw, userContent) {
  if (!raw) return null;
  const clean = raw.trim();

  // 1) 直接 JSON.parse
  try { const p = JSON.parse(clean); return validate(p); } catch {}

  // 2) 提取 ```json 代码块
  const block = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (block) {
    try { const p = JSON.parse(block[1]); return validate(p); } catch {}
  }

  // 3) 提取首个 {...} 块（允许跨行）
  const obj = clean.match(/\{[\s\S]*\}/);
  if (obj) {
    try { const p = JSON.parse(obj[0]); return validate(p); } catch {}
  }

  // 4) fallback: 把整段当 text，用默认 prompt
  console.log('[mailboxScheduler] JSON parse failed, using raw text fallback');
  return {
    text: clean.slice(0, 600),
    paperPrompt: 'decorative letter paper, elegant stationery, floral border, soft cream tones, large blank center area',
    portraitPrompt: 'close-up portrait, sitting at a desk writing a letter, warm candlelight, contemplative expression',
    illustrationPrompt: 'dreamy illustration, warm colors, ethereal atmosphere, storybook style',
  };
}

function validate(parsed) {
  if (!parsed || (!parsed.text && !parsed.paperPrompt && !parsed.portraitPrompt && !parsed.illustrationPrompt)) return null;
  return {
    text: (parsed.text || '').trim(),
    paperPrompt: (parsed.paperPrompt || '').trim(),
    portraitPrompt: (parsed.portraitPrompt || '').trim(),
    illustrationPrompt: (parsed.illustrationPrompt || '').trim(),
  };
}

// ══════════════════════════════════════════════════════════════
//  图片生成 helper
// ══════════════════════════════════════════════════════════════

async function generateImageSafe(prompt, charLoras, charCustomWorkflow, overrides = {}) {
  if (!prompt) return null;
  try {
    const result = await generateImage(prompt, {
      artist: config.comfyui.momentsArtist,
      loras: charLoras,
      customWorkflow: charCustomWorkflow,
      scene: 'chat',
      ...overrides,
    });
    if (result.success && result.images && result.images.length > 0) return result.images[0]; // { base64, filename }
    console.error(`[mailboxScheduler] image fail: ${result?.error || 'unknown'}`);
    return null;
  } catch (err) {
    console.error(`[mailboxScheduler] image exception:`, err.message);
    return null;
  }
}

function safeJSON(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
