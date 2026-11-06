#!/usr/bin/env node
// 测试脚本卫生检查：防止「新增测试没入库」和「微测试碎片化」这两个已经踩过的坑。
//   node scripts/test-hygiene.mjs            # 检查并输出摘要
//   node scripts/test-hygiene.mjs --quiet    # 只在有问题时输出（npm pretest 用）
//   node scripts/test-hygiene.mjs --strict   # 微测试告警也当失败
//   TEST_HYGIENE=off npm test                # 临时跳过（不推荐）
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.TEST_HYGIENE === 'off') process.exit(0);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const quiet = args.has('--quiet');
const strict = args.has('--strict');

// 收集范围与两个包 `npm test` 的收集规则保持一致
const globs = [
  { dir: 'agent-core/test', match: /\.test\.js$/ },
  { dir: 'agent-core/src/services', match: /\.test\.js$/ },
  { dir: 'web-ui/test', match: /\.test\.js$/ },
];

const files = [];
for (const { dir, match } of globs) {
  const abs = path.join(root, dir);
  if (!existsSync(abs)) continue;
  for (const name of readdirSync(abs)) {
    if (match.test(name)) files.push({ abs: path.join(abs, name), rel: `${dir}/${name}`, pkg: dir.split('/')[0] });
  }
}
files.sort((a, b) => a.rel.localeCompare(b.rel));

const git = (gitArgs, options = {}) =>
  execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], ...options });

const tracked = new Set(git(['ls-files', '-z']).split('\0').filter(Boolean));

// 没有被任何规则忽略时 git check-ignore 以 1 退出，属正常情况
let ignored = new Set();
if (files.length) {
  try {
    const out = git(['check-ignore', '--stdin'], { input: files.map(f => f.rel).join('\n') });
    ignored = new Set(out.split(/\r?\n/).filter(Boolean));
  } catch { /* 无命中 */ }
}

const errors = [];
const warnings = [];
const stats = new Map();

for (const file of files) {
  const source = readFileSync(file.abs, 'utf8');
  const loc = source.split(/\r?\n/).length;
  const cases = (source.match(/(^|\n)\s*(?:await\s+)?(?:t\.)?test\(/g) || []).length;
  const s = stats.get(file.pkg) || { files: 0, loc: 0, cases: 0 };
  s.files += 1; s.loc += loc; s.cases += cases;
  stats.set(file.pkg, s);

  if (!tracked.has(file.rel)) {
    errors.push(ignored.has(file.rel)
      ? `${file.rel} 被 .gitignore 忽略，git 无法恢复它——请调整忽略规则或 git add -f`
      : `${file.rel} 未被 git 跟踪，删除后无法恢复——请 git add ${file.rel}`);
  }
  if (cases <= 1 && loc < 45) {
    warnings.push(`${file.rel}（${loc} 行 / ${cases} 个用例）疑似微测试，建议并入同族测试文件`);
  }
}

const summary = [...stats.entries()]
  .map(([pkg, s]) => `${pkg}: ${s.files} 文件 / ${s.cases} 用例 / ${s.loc} 行`)
  .join('；');

if (!quiet || errors.length) console.log(`[test-hygiene] ${summary}`);
if (!quiet) for (const w of warnings) console.log(`[test-hygiene] 告警: ${w}`);
for (const e of errors) console.error(`[test-hygiene] 错误: ${e}`);

if (errors.length || (strict && warnings.length)) {
  console.error(`[test-hygiene] 失败：${errors.length} 个错误、${warnings.length} 个告警`);
  process.exit(1);
}
if (!quiet) console.log('[test-hygiene] 通过');
