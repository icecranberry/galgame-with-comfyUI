import { githubTransport } from '../agent-core/src/services/githubTransport.js';
import { downloadGithubFile } from './lib/github-download.mjs';

const [operation, url, destination, rawTimeout] = process.argv.slice(2);
if (operation === '--download') {
  if (!await downloadGithubFile(url, destination, Number(rawTimeout) || 600)) {
    console.error('GitHub 下载失败，请检查网络或工坊连接设置');
    process.exitCode = 1;
  }
} else {
  // Allows the launcher to discover a proxy before the web backend is running.
  await githubTransport.resolveSettings();
}
