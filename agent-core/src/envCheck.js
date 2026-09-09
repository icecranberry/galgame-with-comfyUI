// 启动预检（必须是 app.js 的第一个 import，先于任何加载 better-sqlite3 的模块执行）。
//
// better-sqlite3 的原生二进制与 Node 的 ABI 版本（NODE_MODULE_VERSION）强绑定：
// 用错 Node 大版本启动时会在模块加载阶段抛出难懂的 ERR_DLOPEN_FAILED 崩溃。
// 这里提前探测并给出可操作的中文提示。
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

try {
  require('better-sqlite3');
} catch (err) {
  if (err?.code === 'ERR_DLOPEN_FAILED' && /NODE_MODULE_VERSION/.test(err.message || '')) {
    console.error('[agent-core] 启动失败：Node 版本与 better-sqlite3 编译时的 ABI 不匹配（NODE_MODULE_VERSION 冲突）。');
    console.error(`当前 Node：${process.version}（MODULE_VERSION ${process.versions.modules}）`);
    console.error('请改用项目自带的 runtime 启动：runtime\\nodejs\\node.exe app.js');
    console.error('（或使用启动器 / 在已配置 runtime PATH 的终端里 npm run dev）');
    process.exit(1);
  }
  throw err;
}
