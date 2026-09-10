/**
 * stop.mjs — 一键停止全部开发服务
 *
 *   $ npm run stop              在项目根目录
 *   $ npm run stop -- --dry     只列出目标进程与清理顺序，不执行任何杀进程操作
 *
 * 流程:
 *   1. 先请求 agent-core 优雅退出 (/api/shutdown)，避免硬杀导致 SQLite WAL 未落盘
 *   2. 全量清扫本项目进程（进程名 + 命令行关键字，先杀监督进程再杀服务进程）
 *      —— 关键：不只看端口。不占端口的「幽灵」node app.js 与遗留在外的 nodemon
 *         监督进程都要清掉，否则它们会继续跑后台调度器（朋友圈重复发帖的根源），
 *         并在下次保存源码时再拉起一份新实例。
 *   3. 端口兜底（只杀 node / python，其他应用放行）
 *   4. 复查并报告残留
 *
 * 识别与清理逻辑见 scripts/lib/projectProcesses.mjs（与 dev.mjs / restart-core.mjs 共用）。
 */

import { cleanupProjectProcesses, label } from './lib/projectProcesses.mjs';

const DRY = process.argv.includes('--dry') || process.argv.includes('--dry-run');
// 绝不自杀：stop.mjs 自身进程、`npm run stop` 包装进程
const SELF_PATTERNS = ['stop.mjs', 'run stop'];

// ── 1. 优雅退出（尽力而为：只有占着 3099 的那个进程能收到）──
if (DRY) {
  console.log('(dry-run：跳过优雅退出请求)');
} else {
  console.log('请求 agent-core 优雅退出…');
  try {
    const resp = await fetch('http://localhost:3099/api/shutdown', {
      method: 'POST',
      signal: AbortSignal.timeout(3000),
    });
    console.log(resp.ok ? '  已请求，等待 WAL 落盘…' : `  返回 ${resp.status}，继续`);
    await new Promise((r) => setTimeout(r, 4000));
  } catch {
    console.log('  无法连接（可能未运行），继续');
  }
}

// ── 2 + 3. 全量清扫 + 端口兜底 ──
console.log('\n扫描本项目进程…');
const res = cleanupProjectProcesses({ excludePatterns: SELF_PATTERNS, dryRun: DRY });

// ── 4. 复查 ──
if (DRY) {
  console.log('\n(dry-run 结束，未杀任何进程)');
} else {
  await new Promise((r) => setTimeout(r, 500));
  if (!res.tableReadable || res.leftover === null) {
    console.log(`\n本次停止 ${res.killed} 个进程（进程表不可读，未复查）。`);
  } else if (res.leftover.length === 0) {
    console.log(res.killed > 0
      ? `\n已清理完毕，本次停止 ${res.killed} 个进程。可运行 npm run dev 重新启动。`
      : '\n所有服务均未运行，无需清理。');
  } else {
    console.log(`\n[警告] 本次停止 ${res.killed} 个，仍有 ${res.leftover.length} 个本项目进程存活：`);
    for (const p of res.leftover) console.log(`    ${label(p.ProcessId, p.CommandLine)}`);
    console.log('  它们会继续跑后台调度器（朋友圈可能出现重复发帖），可再执行一次 npm run stop。');
  }
}
