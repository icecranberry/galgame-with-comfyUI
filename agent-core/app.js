import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, autoDetectWorkflowMode } from './src/config.js';
import { getDb, closeDb } from './src/db/index.js';
import { errorHandler } from './src/middleware/errorHandler.js';
import { healthCheck as vectorHealth } from './src/services/vectorClient.js';
import chatRoutes from './src/routes/chat.js';
import memoryRoutes from './src/routes/memory.js';
import imagesRoutes from './src/routes/images.js';
import charactersRoutes from './src/routes/characters.js';
import configRoutes from './src/routes/config.js';
import momentsRoutes from './src/routes/moments.js';
import relationshipsRoutes from './src/routes/relationships.js';
import userRelationshipsRoutes from './src/routes/userRelationships.js';
import portraitsRoutes from './src/routes/portraits.js';
import notificationsRoutes from './src/routes/notifications.js';
import eventsRoutes from './src/routes/events.js';
import streamRoutes from './src/routes/stream.js';
import scheduleRoutes from './src/routes/schedule.js';
import workflowsRoutes from './src/routes/workflows.js';
import mailboxRoutes from './src/routes/mailbox.js';
import groupsRoutes from './src/routes/groups.js';
import libraryRoutes from './src/routes/library.js';
import maibotBridgeRoutes from './src/maibot-bridge/router.js';
import { autoRestoreMissing } from './src/services/workflowTemplates.js';
import { startMomentScheduler } from './src/services/momentScheduler.js';
import { startProactiveChatScheduler } from './src/services/proactiveChatScheduler.js';
import { startEventScheduler } from './src/services/eventScheduler.js';
import { startDisturbScheduler } from './src/services/disturbModeScheduler.js';
import { startReplyQueueScheduler } from './src/services/replyQueueScheduler.js';
import { initialize as initScheduleManager } from './src/services/scheduleManager.js';
import { startScheduler as startImageCompressor } from './src/services/imageCompressor.js';
import { startMailboxScheduler } from './src/services/mailboxScheduler.js';
import { startWeatherScheduler } from './src/services/weatherService.js';
import { startGroupIdleScheduler } from './src/services/groupIdleScheduler.js';
import { startKnowledgeSyncScheduler } from './src/services/imagePromptKnowledge.js';
import { applyFromConfig } from './src/services/llmConcurrency.js';
import { refresh as refreshCharSearch } from './src/services/characterSearch.js';
import { ensureDefaultMemoryIndexes, stopMemoryIndexWorker } from './src/services/memory/memoryRepository.js';

const app = express();

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 静态文件（Vue 前端，构建后）
app.use(express.static('public'));

// 图片编辑任务暂存预览（重新生成 / HiresFix 细化确认前）
app.use('/images/.pending', express.static('data/images/.pending', { dotfiles: 'allow', index: false, maxAge: '5m' }));

// 图片存储目录（AVIF 自适应：请求 .png 时若同名 .avif 存在则返回 AVIF）
app.use('/images', (req, res, next) => {
  const pngMatch = req.path.match(/\.png$/i);
  if (!pngMatch) return next();

  const pngPath = path.join('data/images', req.path);
  // 原 PNG 存在 → 直接走 static 兜底
  if (fs.existsSync(pngPath)) return next();

  // PNG 不存在（已被 AVIF 压缩后删除），检查同名 .avif
  const avifPath = path.join('data/images', req.path.replace(/\.png$/i, '.avif'));
  if (fs.existsSync(avifPath)) {
    res.setHeader('Content-Type', 'image/avif');
    return res.sendFile(path.resolve(avifPath));
  }

  next();
});
app.use('/images', express.static('data/images'));
app.use('/avatars', express.static('data/avatars'));

// API 路由
app.use('/api', chatRoutes);           // /api/characters/:id/chat, /api/characters/:id/messages
app.use('/api/memory', memoryRoutes);
app.use('/api/images', imagesRoutes);
app.use('/api/characters', charactersRoutes);  // /api/characters CRUD
app.use('/api/config', configRoutes);
app.use('/api/moments', momentsRoutes);
app.use('/api/relationships', relationshipsRoutes);
app.use('/api/user-relationships', userRelationshipsRoutes);
app.use('/api/portraits', portraitsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/stream', streamRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/workflows', workflowsRoutes);
app.use('/api/mailbox', mailboxRoutes);
app.use('/api/groups', groupsRoutes);
app.use('/api/library', libraryRoutes);   // /api/library/event-types, /api/library/topics

app.use('/api/maibot', maibotBridgeRoutes);
// 健康检查
app.get('/api/health', async (req, res) => {
  const vectorOk = await vectorHealth();
  res.json({
    status: 'ok',
    vector_service: vectorOk ? 'ok' : 'down',
    timestamp: new Date().toISOString(),
  });
});

// 错误处理
app.use(errorHandler);

// ── 启动 ──
console.log('============================================');
console.log('  AI Agent - 本地图像生成智能体');
console.log('============================================');

// 初始化数据库
getDb();
console.log('[db] SQLite initialized');

// 初始化时根据 ComfyUI/models/diffusion_models 下的模型自动检测工作流模式（仅首次执行一次）
autoDetectWorkflowMode();

// 初始化角色名称注册表（交叉引用检索）
refreshCharSearch();
console.log('[search] Character name registry loaded');

// 初始化后台 LLM 并发限制（云端 API 用户自动跳过，零开销）
applyFromConfig(config);

// 启动时自动补全缺失的工作流文件（已有文件不会被覆盖）
autoRestoreMissing();

// 启动朋友圈定时调度器
startMomentScheduler();

// 启动主动对话调度器（由 config.features.proactiveChat 控制开关，scheduler 内部自行判断）
startProactiveChatScheduler();

// 启动奇遇事件调度器（由 config.features.events 控制开关，scheduler 内部自行判断）
startEventScheduler();

// 启动防打扰模式调度器（由 config.features.disturbMode 控制开关，scheduler 内部自行判断）
startDisturbScheduler();

// 启动回复队列调度器（日程刷新 + 延迟回复处理）
startReplyQueueScheduler();

// 初始化日程管理器（恢复睡眠状态）
initScheduleManager();

// 启动图片压缩调度器（定时 + 立即压缩功能）
startImageCompressor();

// 启动信箱调度器（每 60 秒扫描待回信的信件）
startMailboxScheduler();

// 启动天气调度器（每日 08:00 后更新小时级天气缓存）
startWeatherScheduler();

// 启动群聊后台调度器（预算制闲聊 + 角色自发建群，由 config.features.groupChat 控制）
startGroupIdleScheduler();

// 启动图片知识库同步调度器（用户安静时才执行同步，不阻塞生图）
startKnowledgeSyncScheduler();

// 先启动 HTTP 服务，向量检查异步进行
const server = app.listen(config.port, () => {
  console.log(`[agent-core] http://localhost:${config.port}`);
  console.log('============================================');
});
// 缩短 keep-alive 空闲超时，避免 Vite 代理在进程重启后复用到已死连接
server.keepAliveTimeout = 5000;

// 异步检查向量服务（不阻塞启动）
(async () => {
  console.log('[vector] checking connection to', config.vectorService.url);
  let retries = 0;
  while (true) {
    const ok = await vectorHealth();
    if (ok) {
      console.log('[vector] connected');
      setImmediate(() => ensureDefaultMemoryIndexes().catch(error => console.warn('[memory] default index initialization failed:', error.message)));
      break;
    }
    retries++;
    if (retries === 6) {
      console.warn('[vector] WARNING: not reachable — vector search, memory extraction degraded; retrying every 30 seconds');
    }
    await new Promise(r => setTimeout(r, retries < 6 ? 3000 : 30000));
  }
})();

// 周期性 WAL checkpoint：每 5 分钟将 WAL 日志写入主 DB 文件，
// 缩短异常退出时的"脏窗口"，降低 WAL 损坏概率
const WAL_CHECKPOINT_INTERVAL = 5 * 60 * 1000;
const walCheckpointTimer = setInterval(() => {
  try {
    const db = getDb();
    const r = db.pragma('wal_checkpoint(PASSIVE)');
    if (r[0]?.log > 0 || r[0]?.checkpointed > 0) {
      console.log(`[db] periodic WAL checkpoint: ${r[0].checkpointed} pages checkpointed, ${r[0].log} remaining`);
    }
  } catch (_) { /* silent — 定期维护不应阻塞主流程 */ }
}, WAL_CHECKPOINT_INTERVAL);
// 不阻塞 process.exit()：WAL checkpoint 不是必须完成的关键操作
walCheckpointTimer.unref();

// 全局未捕获异常，防止进程崩溃
process.on('unhandledRejection', (reason) => {
  console.error('[agent-core] unhandled rejection:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[agent-core] uncaught exception:', err.message);
});

// 优雅退出（幂等 — 防止 shutdown 端点 + 信号双重触发）
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[agent-core] shutting down...');
  stopMemoryIndexWorker();

  // 1. WAL checkpoint：确保所有未落盘事务写入主 DB
  try {
    const db = getDb();
    const r = db.pragma('wal_checkpoint(TRUNCATE)');
    console.log(`[db] WAL checkpointed before shutdown: ${r[0]?.checkpointed || 0} pages`);
  } catch (e) {
    console.warn('[db] WAL checkpoint failed:', e.message);
  }

  // 2. 先关 HTTP 服务（拒绝新连接），再清理资源
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  // 5 秒硬超时兜底
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// Windows: 关闭控制台窗口 → CTRL_CLOSE_EVENT（若 Node 未映射为 SIGBREAK 则直接被杀，
// 周期性 WAL checkpoint 已把脏窗口缩到 ≤5 分钟，最坏情况损失 < 5 分钟的写入）
process.on('SIGBREAK', shutdown);

// 供 dev.mjs 在 taskkill 前触发优雅退出
app.post('/api/shutdown', (req, res) => {
  res.json({ ok: true });
  shutdown();
});
