import { execSync } from 'child_process';
import os from 'os';

const PORTS = [3099, 5173, 8765];
const isWindows = os.platform() === 'win32';

let stopped = 0;

// ── 第一步：找到 npm run dev / dev.mjs 父进程，整棵树杀 ──
console.log('查找 dev 父进程…');
try {
  if (isWindows) {
    // wmic 查命令行包含 "npm" 和 "dev" 的 node 进程
    const wmicOut = execSync(
      `wmic process where "name='node.exe' and commandline like '%npm%run dev%'" get ProcessId`,
      { encoding: 'utf8' }
    );
    const pids = wmicOut
      .split('\n')
      .map(l => l.trim())
      .filter(l => /^\d+$/.test(l));

    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /T /F`, { encoding: 'utf8', stdio: 'pipe' });
        console.log(`  已树杀 npm run dev (PID ${pid})`);
        stopped++;
      } catch (e) {
        console.log(`  跳过 PID ${pid}: ${e.stderr || e.message}`);
      }
    }
  } else {
    // Unix: pgrep 找 npm run dev
    try {
      const pgrepOut = execSync('pgrep -f "npm run dev"', { encoding: 'utf8' });
      const pids = pgrepOut.trim().split('\n').filter(Boolean);
      for (const pid of pids) {
        execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
        console.log(`  已杀掉 npm run dev (PID ${pid})`);
        stopped++;
      }
    } catch {
      // pgrep 没找到任何进程也会 exit 1
    }
  }
} catch (e) {
  // wmic 没匹配到任何进程时也会抛异常
}
if (stopped === 0) console.log('  未找到运行中的 npm run dev');

// ── 第二步：兜底，按端口清理残留 ──
for (const port of PORTS) {
  try {
    if (isWindows) {
      const netstatOut = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
      const lines = netstatOut.trim().split('\n').filter(l => l.includes('LISTENING'));
      if (lines.length === 0) {
        console.log(`端口 ${port} — 未占用，跳过`);
        continue;
      }
      const pid = lines[0].trim().split(/\s+/).pop();
      execSync(`taskkill /PID ${pid} /F`, { encoding: 'utf8', stdio: 'pipe' });
      console.log(`端口 ${port} — 已杀掉 PID ${pid}`);
      stopped++;
    } else {
      try {
        const lsofOut = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8' });
        const pids = lsofOut.trim().split('\n').filter(Boolean);
        for (const pid of pids) {
          execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
        }
        console.log(`端口 ${port} — 已杀掉 PID ${pids.join(', ')}`);
        stopped++;
      } catch {
        console.log(`端口 ${port} — 未占用，跳过`);
      }
    }
  } catch (e) {
    // netstat/findstr 没匹配到任何结果时会 exit 1，这是正常的
    console.log(`端口 ${port} — 未占用，跳过`);
  }
}

if (stopped === 0) {
  console.log('\n所有服务均未运行，无需清理。');
} else {
  console.log(`\n已停止 ${stopped} 个进程。可运行 npm run dev 重新启动。`);
}
