#!/usr/bin/env node
/**
 * 增量补丁生成器 —— 产出「两个版本之间」的最小补丁包，供启动器在线下载与落地。
 *
 *   node scripts/build-patch.mjs --from v3.4.0 --to v3.4.1 [--out patches]
 *        [--from-versions v3.4.0,v3.4.1] [--notes "修复说明"] [--channel stable]
 *
 * 产物（默认写进 patches/，该目录可直接当静态源发布）：
 *
 *   <id>.tar.gz   补丁包：patch.json（元信息 + 每个文件的 sha256）+ files/<相对路径>
 *   index.json    清单：latest / channel / patches[]（含大小与 sha256）
 *
 * 为什么是 tar.gz 而不是 zip：
 *   Python 侧（启动器）用标准库 tarfile 读，Node 侧用 git archive 写，
 *   两边都不需要任何第三方依赖，也不会踩 Windows 上 zip 的中文路径坑。
 *
 * 为什么用 git archive：
 *   文件内容、可执行位、二进制、非 ASCII 路径全部由 git 自己处理，
 *   比"逐个 git show 拼包"更可靠；脚本只负责把 patch.json 追加进 tar。
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const SCHEMA = 1;

// ── 参数 ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { out: 'patches', channel: 'stable', notes: '', fromVersions: '', exclude: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    if (key === 'exclude') {
      args.exclude.push(value);   // 可重复
      continue;
    }
    args[key] = value;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.from || !args.to) {
  console.error(
    '用法: node scripts/build-patch.mjs --from <ref> --to <ref> [--out patches] [--notes "…"]\n'
    + '      [--source-only] [--exclude <glob>]... [--from-versions a,b] [--channel stable]'
  );
  process.exit(2);
}

const fromRef = args.from;
const toRef = args.to;
const outDir = path.resolve(args.out);
const channel = String(args.channel || 'stable');

// ── git 工具 ──────────────────────────────────────────────────────────

function git(...argv) {
  return execFileSync('git', argv, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }).trim();
}

function gitBuffer(...argv) {
  return execFileSync('git', argv, { maxBuffer: 512 * 1024 * 1024 });
}

const fromSha = git('rev-parse', `${fromRef}^{commit}`);
const toSha = git('rev-parse', `${toRef}^{commit}`);
const fromDate = git('show', '-s', '--format=%cI', fromSha);
const toDate = git('show', '-s', '--format=%cI', toSha);

// ── 收集变更文件 ──────────────────────────────────────────────────────

const rawDiff = git('diff', '--name-status', '-z', fromSha, toSha);
const tokens = rawDiff.split('\0').filter(Boolean);

const changed = [];   // { path, sha256, size }
const deleted = [];

for (let i = 0; i < tokens.length;) {
  const status = tokens[i++];
  if (status.startsWith('R') || status.startsWith('C')) {
    const oldPath = tokens[i++];
    const newPath = tokens[i++];
    deleted.push(oldPath);
    changed.push(newPath);
  } else if (status === 'D') {
    deleted.push(tokens[i++]);
  } else {
    // A / M / T 都按"内容变了"处理
    changed.push(tokens[i++]);
  }
}

// ── 排除构建产物 ──────────────────────────────────────────────────────
// 默认把 agent-core/public 一起打进补丁的话，每发一版就多出几百 KB~MB 的
// 内容哈希 bundle（文件名每次都变，历史里越堆越多）。而这些东西本地
// 强制重新构建就会重新生成 —— 用户端「应用补丁 → 强制重新构建」本来就是既定流程。
// 实测（5e3e0af→3b03b7b，含一次前端重建）：全量 866 KB → 只发源码 421 KB，
// 排掉 51 个产物文件；产物占比越高的版本省得越多。

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  // 必须单次扫描替换：`**` 展开出来的 `.*` 若交给下一步的 `*` 规则再处理，
  // 会被二次改写成 `.[^/]*`，于是 `a/**` 退化成"只匹配一层"（这个坑踩过一次）。
  const pattern = escaped.replace(/\*\*\/|\*\*|\*/g, (match) => {
    if (match === '**/') return '(?:.*/)?';
    if (match === '**') return '.*';
    return '[^/]*';
  });
  return new RegExp(`^${pattern}$`);
}

if (args['source-only'] !== undefined) args.exclude.push('agent-core/public/**');

const excludeRules = args.exclude.map(globToRegExp).filter(Boolean);
const isExcluded = (p) => excludeRules.some((re) => re.test(p));

const droppedChanged = changed.filter(isExcluded);
const droppedDeleted = deleted.filter(isExcluded);
const keepChanged = changed.filter((p) => !isExcluded(p));
const keepDeleted = deleted.filter((p) => !isExcluded(p));

if (keepChanged.length === 0 && keepDeleted.length === 0) {
  console.error(`[patch] ${fromRef} → ${toRef} 之间没有任何需要下发的文件差异，无需生成补丁`);
  process.exit(1);
}

// ── tar 追加 ──────────────────────────────────────────────────────────
// git archive 已经给出合法 tar；tar 允许直接追加条目，只需先去掉结尾的补零块。

function tarHeader(name, size, mtimeSeconds) {
  const block = Buffer.alloc(512);
  const nameBuf = Buffer.from(name, 'utf8');

  let prefix = '';
  let shortName = name;
  if (nameBuf.length > 100) {
    // ustar 的长路径方案：prefix + "/" + name
    const slash = nameBuf.lastIndexOf(0x2f); // '/'
    if (slash < 0) throw new Error(`路径过长且无法拆分：${name}`);
    prefix = nameBuf.subarray(0, slash).toString('utf8');
    shortName = nameBuf.subarray(slash + 1).toString('utf8');
    if (Buffer.byteLength(shortName) > 100 || Buffer.byteLength(prefix) > 155) {
      throw new Error(`路径超过 ustar 上限：${name}`);
    }
  }

  block.write(shortName, 0, 100, 'utf8');
  block.write('0000644\0', 100, 8, 'ascii');   // mode
  block.write('0000000\0', 108, 8, 'ascii');   // uid
  block.write('0000000\0', 116, 8, 'ascii');   // gid
  block.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
  block.write(Math.floor(mtimeSeconds).toString(8).padStart(11, '0') + '\0', 136, 12, 'ascii');
  block.write('        ', 148, 8, 'ascii');    // chksum 占位
  block.write('0', 156, 1, 'ascii');           // typeflag: 普通文件
  block.write('ustar\0', 257, 6, 'ascii');
  block.write('00', 263, 2, 'ascii');
  block.write('linshe\0', 265, 7, 'ascii');    // uname
  block.write('linshe\0', 297, 7, 'ascii');    // gname
  if (prefix) block.write(prefix, 345, 155, 'utf8');

  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return block;
}

function appendEntry(tarBuf, name, content, mtimeSeconds) {
  const header = tarHeader(name, content.length, mtimeSeconds);
  const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512);
  content.copy(padded);
  // 去掉上一个条目的收尾零块，再追加新条目
  let end = tarBuf.length;
  while (end >= 512 && tarBuf.subarray(end - 512, end).every((b) => b === 0)) end -= 512;
  return Buffer.concat([tarBuf.subarray(0, end), header, padded]);
}

// ── 生成补丁包 ────────────────────────────────────────────────────────

const patchId = `${fromRef.replace(/[^0-9A-Za-z._-]/g, '_')}_to_${toRef.replace(/[^0-9A-Za-z._-]/g, '_')}`;
const mtime = Math.floor(new Date(toDate).getTime() / 1000);

fs.mkdirSync(outDir, { recursive: true });

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linshe-patch-'));

// git archive 不支持从文件读 pathspec，Windows 命令行又有长度上限；
// 所以按字节切块多次导出，再把 tar 首尾相接（tar 允许直接拼接条目）。
function stripTrailingZeros(buf) {
  let end = buf.length;
  while (end >= 512 && buf.subarray(end - 512, end).every((b) => b === 0)) end -= 512;
  return buf.subarray(0, end);
}

function archiveInChunks(paths) {
  const chunks = [];
  let bucket = [];
  let bytes = 0;

  const flush = () => {
    if (bucket.length === 0) return;
    const out = path.join(tmpDir, `chunk-${chunks.length}.tar`);
    // --literal-pathspecs：路径按字面量处理，避免被当成 glob
    execFileSync('git', [
      '--literal-pathspecs', 'archive', '--format=tar', '--prefix=files/',
      `--output=${out}`, toSha, '--', ...bucket,
    ], { stdio: ['ignore', 'ignore', 'inherit'] });
    chunks.push(fs.readFileSync(out));
    bucket = [];
    bytes = 0;
  };

  for (const filePath of paths) {
    const cost = Buffer.byteLength(filePath, 'utf8') + 3;
    if (bytes + cost > 6000) flush();
    bucket.push(filePath);
    bytes += cost;
  }
  flush();
  return Buffer.concat(chunks.map(stripTrailingZeros));
}

let archive = archiveInChunks(keepChanged);

// ── 从包里读内容算哈希 ────────────────────────────────────────────────
// 不能拿 git show 的字节来算：git archive 会按 core.autocrlf / .gitattributes
// 做行尾转换（本仓在 Windows 上是 CRLF），于是"清单里的哈希"和"包里的内容"
// 会对不上。清单必须描述载荷本身，所以直接解析 tar 取真实字节。

function readTarEntries(buf) {
  const entries = new Map();
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const block = buf.subarray(offset, offset + 512);
    if (block.every((b) => b === 0)) break;
    const name = block.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = block.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const size = parseInt(
      block.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim() || '0', 8,
    ) || 0;
    offset += 512;
    entries.set(prefix ? `${prefix}/${name}` : name, buf.subarray(offset, offset + size));
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}

const entries = readTarEntries(archive);
const files = keepChanged.map((filePath) => {
  const content = entries.get(`files/${filePath}`);
  if (!content) throw new Error(`补丁包缺少文件内容：${filePath}`);
  return {
    path: filePath,
    sha256: createHash('sha256').update(content).digest('hex'),
    size: content.length,
  };
});

const meta = {
  schema: SCHEMA,
  id: patchId,
  channel,
  from: (args.fromVersions || fromRef).split(',').map((s) => s.trim()).filter(Boolean),
  to: toRef,
  from_commit: fromSha.slice(0, 12),
  to_commit: toSha.slice(0, 12),
  created_at: new Date().toISOString(),
  notes: args.notes || '',
  files,
  deleted: keepDeleted,
  excluded: droppedChanged.length + droppedDeleted.length,
};

archive = appendEntry(archive, 'patch.json',
  Buffer.from(JSON.stringify(meta, null, 2), 'utf8'), mtime);
archive = Buffer.concat([archive, Buffer.alloc(1024)]);   // tar 收尾

const gzPath = path.join(outDir, `${patchId}.tar.gz`);
const gz = zlib.gzipSync(archive, { level: 9 });
fs.writeFileSync(gzPath, gz);
const gzSha = createHash('sha256').update(gz).digest('hex');

// ── 更新清单 ──────────────────────────────────────────────────────────

const manifestPath = path.join(outDir, 'index.json');
let manifest = { schema: SCHEMA, channel, latest: null, patches: [] };
if (fs.existsSync(manifestPath)) {
  try {
    const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (existing && Array.isArray(existing.patches)) manifest = existing;
  } catch {
    console.warn('[patch] 现有 index.json 解析失败，将重建');
  }
}

const entry = {
  id: patchId,
  channel,
  from: meta.from,
  to: toRef,
  file: `${patchId}.tar.gz`,
  size: gz.length,
  sha256: gzSha,
  notes: meta.notes,
  created_at: meta.created_at,
  files: files.length,
  deleted: deleted.length,
};

manifest.schema = SCHEMA;
manifest.channel = channel;
manifest.patches = [entry, ...(manifest.patches || []).filter((p) => p && p.id !== patchId)];
manifest.patches.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
manifest.latest = manifest.patches[0]?.to ?? null;
manifest.updated_at = new Date().toISOString();

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`[patch] ${fromRef} → ${toRef}`);
console.log(`  变更文件 ${files.length} 个${keepDeleted.length ? `，删除 ${keepDeleted.length} 个` : ''}`
  + (meta.excluded ? `（已排除构建产物/忽略项 ${meta.excluded} 个，本地重新构建会重新生成）` : ''));
console.log(`  补丁包   ${gzPath}  (${(gz.length / 1024).toFixed(1)} KB)`);
console.log(`  sha256   ${gzSha}`);
console.log(`  清单     ${manifestPath}  (latest=${manifest.latest})`);
