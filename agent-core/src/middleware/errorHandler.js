// 全局错误处理：统一 { error } 响应格式。
// 5xx 类错误不透出内部 err.message（可能包含 SQL/路径细节），只记日志。
export function errorHandler(err, req, res, _next) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const status = err.status || err.statusCode || 500;
  const message = status < 500 && err.message
    ? err.message
    : 'Internal server error';

  res.status(status).json({ error: message });
}
