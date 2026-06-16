import express from 'express';
import cors from 'cors';
import { config } from './src/config.js';
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
import { startMomentScheduler } from './src/services/momentScheduler.js';

const app = express();

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 静态文件（Vue 前端，构建后）
app.use(express.static('public'));

// 图片存储目录（独立于 public，不会被 vite build 清空）
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

// 启动朋友圈定时调度器
startMomentScheduler();

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
  while (retries < 6) {
    const ok = await vectorHealth();
    if (ok) {
      console.log('[vector] connected');
      break;
    }
    retries++;
    await new Promise(r => setTimeout(r, 3000));
  }
  if (retries >= 6) {
    console.warn('[vector] WARNING: not reachable — vector search, memory extraction degraded');
  }
})();

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
  // 先关 HTTP 服务（拒绝新连接），再清理资源
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  // 5 秒硬超时兜底
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 供 dev.mjs 在 taskkill 前触发优雅退出
app.post('/api/shutdown', (req, res) => {
  res.json({ ok: true });
  shutdown();
});
