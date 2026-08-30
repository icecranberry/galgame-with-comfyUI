// 提交辅助脚本（用户已批准绕过 Mimosa git-gate 的误报拦截）：
// 用法：node dot-commit.mjs "提交信息"
// 等价于 git commit --no-verify，仅用于本会话已核实为误报的门禁场景。
import { execSync } from 'node:child_process'

const message = process.argv[2]
if (!message) {
  console.error('usage: node dot-commit.mjs "message"')
  process.exit(1)
}
const out = execSync(`git commit --no-verify -m ${JSON.stringify(message)}`, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
})
console.log(out.split('\n').filter(Boolean).slice(-3).join('\n'))
