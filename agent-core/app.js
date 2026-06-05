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

const app = express();

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 静态文件（Vue 前端，构建后）
app.use(express.static('public'));

// API 路由
app.use('/api/conversations', chatRoutes);
app.use('/api/memory', memoryRoutes);
app.use('/api/images', imagesRoutes);
app.use('/api/characters', charactersRoutes);

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

// 先启动 HTTP 服务，向量检查异步进行
app.listen(config.port, () => {
  console.log(`[agent-core] http://localhost:${config.port}`);
  console.log('============================================');
});

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

// 优雅退出
process.on('SIGINT', async () => {
  console.log('\n[agent-core] shutting down...');
  closeDb();
  process.exit(0);
});
