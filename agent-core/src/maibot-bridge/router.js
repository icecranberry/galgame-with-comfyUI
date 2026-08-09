/**
 * maibot-bridge/router.js
 * 供 MaiBot 插件调用的 HTTP 接口（仅本机使用，无鉴权）。
 */
import { Router } from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

import { getDb } from '../db/index.js';
import { deriveStyles } from './style.js';
import { judgeImageNeed } from './judge.js';
import { extractImagePrompt } from './prompt.js';
import { startImageTask, getTask } from './generate.js';
import { clearLatestMemory, saveConversation } from './memory.js';
import {
  getPluginConfig,
  getPluginPersona,
  getWebuiSettings,
  setWebuiSettings,
  updatePluginConfig,
  updatePluginPersona,
} from './webui.js';

const router = Router();

function resolveCharacter(characterId, characterName) {
  const db = getDb();
  if (characterId != null && characterId !== '') {
    return db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(characterId));
  }
  if (characterName) {
    // 优先按 characters.name 匹配，兼容旧配置中保存的 display_name
    return (
      db.prepare('SELECT * FROM characters WHERE name = ?').get(String(characterName)) ||
      db.prepare('SELECT * FROM characters WHERE display_name = ?').get(String(characterName))
    );
  }
  return null;
}

// GET /api/maibot/health — 连通性检查
router.get('/', (req, res) => {
  res.json({ ok: true, service: 'maibot-bridge' });
});

// GET /api/maibot/characters — 角色列表（插件取值 characters.name，兼容旧配置中的 display_name）
router.get('/characters', (req, res) => {
  const db = getDb();
  const characters = db.prepare(
    `SELECT id, name, display_name, base_prompt, short_prompt, avatar_path FROM characters ORDER BY id`
  ).all();
  res.json({ characters });
});

// POST /api/maibot/derive-style — 从 base_prompt 提炼行为风格/表达风格（纯预览，不保存）
router.post('/derive-style', async (req, res) => {
  const { base_prompt } = req.body || {};
  if (!base_prompt || typeof base_prompt !== 'string' || !base_prompt.trim()) {
    return res.status(400).json({ error: 'base_prompt is required' });
  }
  try {
    const styles = await deriveStyles(base_prompt);
    res.json(styles);
  } catch (err) {
    console.error('[maibot-bridge] derive-style error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/maibot/plugin-persona — 读取 MaiBot 插件本地人格数据（base_prompt 副本/行为/表达风格，按角色）
router.get('/plugin-persona', (req, res) => {
  getPluginPersona()
    .then((data) => res.json({ ok: true, characters: data.characters || {} }))
    .catch((err) => res.status(502).json({ error: err.message }));
});

// PUT /api/maibot/plugin-persona — 更新 MaiBot 插件本地人格数据（按角色合并写入）
router.put('/plugin-persona', (req, res) => {
  const { character_name, base_prompt, behavior_style, reply_style } = req.body || {};
  if (!character_name || typeof character_name !== 'string') {
    return res.status(400).json({ error: 'character_name is required' });
  }
  const payload = { character_name };
  if (base_prompt !== undefined) payload.base_prompt = base_prompt;
  if (behavior_style !== undefined) payload.behavior_style = behavior_style;
  if (reply_style !== undefined) payload.reply_style = reply_style;
  updatePluginPersona(payload)
    .then((data) => res.json({ ok: true, ...data }))
    .catch((err) => res.status(502).json({ error: err.message }));
});

// POST /api/maibot/chat — 主入口：存记忆 + 判断是否发图 + 起生图任务
router.post('/chat', async (req, res) => {
  const {
    character_id = null,
    character_name = '',
    user_name = '',
    user_message = '',
    reply_text = '',
    context = [],
    client_msg_id = '',
    session_id = '',
    image_mode = 'auto',
    memory_enabled = true,
  } = req.body || {};

  const character = resolveCharacter(character_id, character_name);
  if (!character) {
    return res.status(404).json({ error: 'character not found', hint: '使用 GET /api/maibot/characters 查看可用角色名' });
  }
  if (!reply_text || typeof reply_text !== 'string' || !reply_text.trim()) {
    return res.status(400).json({ error: 'reply_text is required' });
  }

  // 1. 记忆整理（memory_enabled=false 时不累积，并删除该会话已保存的记忆摘要）
  let saveResult = { skipped: true, memory_saved: false };
  if (memory_enabled) {
    saveResult = await saveConversation({
      character,
      user_name,
      user_message,
      reply_text,
      client_msg_id,
      session_id,
    });
  } else if (session_id) {
    clearLatestMemory(session_id);
  }

  // 2. 判断是否需要配图
  let image_needed = false;
  let reason = 'image_mode_off';
  if (image_mode === 'always') {
    image_needed = true;
    reason = 'image_mode_always';
  } else if (image_mode !== 'off') {
    try {
      image_needed = await judgeImageNeed({ user_message, reply_text, context });
      reason = image_needed ? 'judge_yes' : 'judge_no';
    } catch (err) {
      console.error('[maibot-bridge] judge error:', err.message);
      reason = 'judge_error';
    }
  }

  // 3. 需要配图 → 抽 prompt + 起任务（异步生图，插件轮询 /tasks/:id）
  let task_id = null;
  if (image_needed) {
    try {
      const prompt = await extractImagePrompt({ character, user_message, reply_text, context });
      if (prompt) {
        task_id = startImageTask({
          character,
          conversationId: saveResult.conversationId,
          prompt,
          assistantMsgId: saveResult.assistantMsgId,
        });
      } else {
        reason = 'prompt_extract_failed';
        image_needed = false;
      }
    } catch (err) {
      console.error('[maibot-bridge] start image task error:', err.message);
      reason = 'image_task_error';
      image_needed = false;
    }
  }

  res.json({
    ok: true,
    memory_saved: !saveResult.skipped,
    image_needed,
    reason,
    task_id,
    character_id: character.id,
    conversation_id: saveResult.conversationId,
  });
});

// GET /api/maibot/tasks/:id — 生图任务状态（插件轮询）
router.get('/tasks/:id', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'task not found' });
  res.json(task);
});

// GET /api/maibot/latest-memory — 最新一份记忆整理（供 MaiBot 插件注入主聊天流历史对话之后）
// 带 session_id 返回该会话的最新一份；不带 session_id 时直接返回最近更新的一份（邻舍每个会话只保留一份）
router.get('/latest-memory', (req, res) => {
  const sessionId = String(req.query.session_id || '').trim();
  const row = sessionId
    ? getDb().prepare(
        `SELECT session_id, content, updated_at FROM maibot_latest_memory WHERE session_id = ?`
      ).get(sessionId)
    : getDb().prepare(
        `SELECT session_id, content, updated_at FROM maibot_latest_memory ORDER BY updated_at DESC, rowid DESC LIMIT 1`
      ).get();
  res.json({ session_id: row?.session_id || '', content: row?.content || '', updated_at: row?.updated_at || null });
});

// DELETE /api/maibot/latest-memory — 删除记忆摘要（带 session_id 删单个会话，否则删全部）
router.delete('/latest-memory', (req, res) => {
  const sessionId = String(req.query.session_id || '').trim();
  const deleted = clearLatestMemory(sessionId);
  res.json({ ok: true, deleted });
});

// GET /api/maibot/plugin-ui — 人格管理页面（独立 HTML，供 MaiBot 首页卡片跳转）
router.get('/plugin-ui', (req, res) => {
  res.type('html').send(readFileSync(fileURLToPath(new URL('./plugin-ui.html', import.meta.url)), 'utf8'));
});

// GET /api/maibot/webui-settings — 读取 MaiBot WebUI 连接设置
router.get('/webui-settings', (req, res) => {
  res.json(getWebuiSettings());
});

// POST /api/maibot/webui-settings — 保存 MaiBot WebUI 连接设置
router.post('/webui-settings', (req, res) => {
  const { url, token } = req.body || {};
  try {
    setWebuiSettings({ url, token });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/maibot/plugin-config — 读取插件配置（经 MaiBot WebUI 代理）
router.get('/plugin-config', async (req, res) => {
  try {
    const data = await getPluginConfig();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// PUT /api/maibot/plugin-config — 更新插件配置（经 MaiBot WebUI 代理）
router.put('/plugin-config', async (req, res) => {
  try {
    const data = await updatePluginConfig((req.body || {}).config || {});
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
