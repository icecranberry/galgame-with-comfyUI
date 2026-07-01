import { execSync } from 'child_process';
import { createInterface } from 'readline';

const run = (cmd) => execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' }).trim();

// 1. 拉取远端 tags
execSync('git fetch --tags --quiet', { stdio: 'inherit' });

// 2. 获取最近一个 tag（纯 Node.js，不依赖 head）
const tags = run('git tag --sort=-creatordate').split('\n').filter(Boolean);
const tag = tags[0];

if (!tag) {
  console.log('没有找到任何 tag。');
  process.exit(0);
}

console.log(`Tag: ${tag}`);

// 3. 显示 tag message
const msg = run(`git tag -l --format="%(contents)" "${tag}"`);
if (msg) console.log(msg);

// 4. 交互确认
const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.question('Delete this tag locally and remotely? (y/n) ', (answer) => {
  rl.close();
  if (answer.toLowerCase() === 'y') {
    execSync(`git tag -d "${tag}"`, { stdio: 'inherit' });
    execSync(`git push origin ":refs/tags/${tag}"`, { stdio: 'inherit' });
    console.log(`已删除 tag: ${tag}`);
  } else {
    console.log('已取消。');
  }
});
