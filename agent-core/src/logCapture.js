// 顶部模块：在 app.js 的 import 阶段尽早安装 console 捕获。
// ESM 的 import 会先于任何语句执行，放在这里可让捕获早于后续业务模块的顶层日志。
// installConsoleCapture 内部幂等，重复导入无副作用。
import { installConsoleCapture } from './services/logBuffer.js';

installConsoleCapture();
