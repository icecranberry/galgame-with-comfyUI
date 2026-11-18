import { Router } from 'express';
import { githubTransport } from '../services/githubTransport.js';

const REPO = 'https://api.github.com/repos/icecranberry/galgame-with-comfyUI';

export function createGithubUpdateRoutes(transport = githubTransport) {
  const router = Router();
  async function read(path, res) {
    try {
      const response = await transport.fetch(`${REPO}/git/${path}`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Linshe-Updates' },
        redirect: 'error',
        signal: AbortSignal.timeout(14_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 403 || response.status === 429) {
          return res.status(429).json({ error: 'GitHub 接口限流了，请稍后再刷新' });
        }
        return res.status(502).json({ error: `GitHub 接口返回 ${response.status}` });
      }
      return res.json(await response.json());
    } catch {
      return res.status(502).json({ error: '连不上 GitHub，请检查网络或工坊连接设置' });
    }
  }
  router.get('/tags', (_req, res) => read('refs/tags', res));
  router.get('/tags/:sha', (req, res) => {
    const { sha } = req.params;
    if (!/^[a-f0-9]{40}$/i.test(sha)) return res.status(400).json({ error: '无效的 GitHub tag SHA' });
    return read(`tags/${sha}`, res);
  });
  return router;
}

export default createGithubUpdateRoutes();
