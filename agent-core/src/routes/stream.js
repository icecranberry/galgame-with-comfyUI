import { Router } from 'express';
import { addClient, removeClient } from '../services/unifiedStreamBus.js';

const router = Router();

// GET /api/stream — 统一 SSE 端点（替代 3 个独立 SSE 长连接）
router.get('/', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write('event: connected\ndata: {}\n\n');
  addClient(res);

  const heartbeat = setInterval(() => {
    try { res.write(':keepalive\n\n'); } catch { clearInterval(heartbeat); removeClient(res); }
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeClient(res);
  });
});

export { router as default };
