// 回归测试：SSE「客户端断开 → 中止上游」到底该挂哪个事件
//
// 背景：agent-core/src/routes/chat.js 原本写的是
//     const upstreamAbort = new AbortController();
//     req.on('close', () => upstreamAbort.abort());
// 这在 Node ≥16 下永远不会触发：IncomingMessage 的 'close' 表示「请求体已读完」，
// 而 SSE 响应此时还没开始写；何况该行在 handler 深处才注册，事件早已错过。
// 结果是客户端超时/关页面后，上游 LLM 仍会跑完整轮并照常计费。
//
// 本测试用一个复刻中间件顺序（cors → express.json）的 SSE 端点把这两件事钉死：
//   1) req 的 'close' 在响应未结束时就会触发 ⇒ 不能当断线信号；
//   2) 只有 res 的 'close' 配合 writableEnded=false 才是真断线，且正常结束不会误触发。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { once } from 'node:events';

const EVENT_INTERVAL_MS = 30;
const EVENT_COUNT = 20; // 约 600ms

function createSseServer() {
  const state = { reqCloseBeforeEnd: false, abortFired: false, abortAfterNormalEnd: false };

  const app = express();
  app.use(cors());
  // 老写法的监听点在 body 解析之前，这样才能观察到它在「请求体读完」就触发
  app.use((req, res, next) => {
    req.on('close', () => { if (!res.writableEnded) state.reqCloseBeforeEnd = true; });
    next();
  });
  app.use(express.json({ limit: '10mb' }));

  app.post('/sse', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    req.socket.setTimeout(0);
    res.setTimeout(0);

    // 与 chat.js 修复后同款：只有「响应没写完就断了」才中止
    const ac = new AbortController();
    res.on('close', () => {
      if (res.writableEnded) { state.abortAfterNormalEnd = true; return; }
      state.abortFired = true;
      ac.abort();
    });

    let n = 0;
    const timer = setInterval(() => {
      n++;
      res.write(`event: token\ndata: {"n":${n}}\n\n`);
      if (n >= EVENT_COUNT) { clearInterval(timer); res.end(); }
    }, EVENT_INTERVAL_MS);
  });

  const server = app.listen(0, '127.0.0.1');
  return { server, state, port: () => server.address()?.port };
}

function postSse(port) {
  const body = JSON.stringify({ message: 'hi', client_msg_id: 'test' });
  const req = http.request({
    host: '127.0.0.1',
    port,
    path: '/sse',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  });
  req.end(body);
  return req;
}

test('SSE 断线：res 的 close 触发中止；req 的 close 在响应结束前就已触发（不能当断线信号）', async () => {
  const { server, state, port } = createSseServer();
  await once(server, 'listening');
  try {
    const req = postSse(port());
    await once(req, 'response');
    await new Promise(r => setTimeout(r, EVENT_INTERVAL_MS * 5)); // 先收几个事件，确保响应已开始
    req.destroy();                                                 // 模拟前端安全超时 abort / 用户关页面
    await new Promise(r => setTimeout(r, 150));

    assert.equal(state.reqCloseBeforeEnd, true,
      'req 的 close 在响应未结束时就触发了 —— 它只代表请求体读完，不能用来判断客户端断开');
    assert.equal(state.abortFired, true,
      'res 的 close（writableEnded=false）必须触发中止，否则上游会继续空烧 token');
  } finally {
    server.close();
  }
});

test('SSE 正常跑完不把 res 的 close 误判为断线', async () => {
  const { server, state, port } = createSseServer();
  await once(server, 'listening');
  try {
    const p = port();
    await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port: p, path: '/sse', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(JSON.stringify({ message: 'hi' })) },
      }, (res) => {
        res.on('data', () => {});
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.end(JSON.stringify({ message: 'hi' }));
    });
    await new Promise(r => setTimeout(r, 100));

    assert.equal(state.abortFired, false, '正常结束不得触发中止');
    assert.equal(state.abortAfterNormalEnd, true, '正常结束走 writableEnded=true 分支');
  } finally {
    server.close();
  }
});
