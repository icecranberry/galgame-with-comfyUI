/**
 * 批量修复 Reasonix 会话标题
 *
 * 问题：planner-executor 架构下，每条会话首条消息都是
 * "# Reasonix executor handoff"，导致 auto-title 全部变成
 * "# Reasonix executo…"。
 *
 * 修复：从 .display.json（存有每条消息的摘要）取最后一个 hash
 * 对应的标题，写入 desktop-topic-titles.json 并标记 source=manual。
 *
 * 使用方式：
 *   node scripts/fix-session-titles.mjs
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// --------------------- 路径 ---------------------
const SESSIONS_DIR = path.resolve(
  process.env.LOCALAPPDATA ||
    (process.platform === 'win32'
      ? path.join(process.env.USERPROFILE, 'AppData', 'Local')
      : path.join(process.env.HOME, '.local', 'share')),
  '..', 'Roaming', 'reasonix', 'projects',
  'D--project-Generate-image-agent', 'sessions'
);
const DISPLAY_JSON = path.join(SESSIONS_DIR, '.display.json');
const REASONIX_PROJECT_DIR = path.join(projectRoot, '.reasonix');
const TITLES_JSON = path.join(REASONIX_PROJECT_DIR, 'desktop-topic-titles.json');
const SOURCES_JSON = path.join(REASONIX_PROJECT_DIR, 'desktop-topic-title-sources.json');

// --------------------- 读取 .display.json ---------------------
if (!existsSync(DISPLAY_JSON)) {
  console.error(`❌ 未找到 .display.json: ${DISPLAY_JSON}`);
  process.exit(1);
}

const displayData = JSON.parse(readFileSync(DISPLAY_JSON, 'utf-8'));
console.log(`📖 读取到 ${Object.keys(displayData).length} 个会话的显示数据`);

// --------------------- 读取已有标题 ---------------------
const currentTitles = existsSync(TITLES_JSON)
  ? JSON.parse(readFileSync(TITLES_JSON, 'utf-8'))
  : {};
const currentSources = existsSync(SOURCES_JSON)
  ? JSON.parse(readFileSync(SOURCES_JSON, 'utf-8'))
  : {};

// --------------------- 扫描 .meta 文件，构建 session→topic_id 映射 ---------------------
const metaFiles = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl.meta'));

/** @type {Record<string, string>} session文件名 → topic_id */
const sessionToTopic = {};
for (const metaFile of metaFiles) {
  const metaPath = path.join(SESSIONS_DIR, metaFile);
  const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
  const sessionFile = metaFile.replace(/\.meta$/, '');
  if (meta.topic_id) {
    sessionToTopic[sessionFile] = meta.topic_id;
  }
}
console.log(`🔗 匹配到 ${Object.keys(sessionToTopic).length} 个会话 → topic_id 映射`);

// --------------------- 提取每个会话的最后一条消息作为标题 ---------------------
let fixCount = 0;

for (const [sessionFile, topicId] of Object.entries(sessionToTopic)) {
  const hashes = displayData[sessionFile];
  if (!hashes) {
    // 有些会话可能没有 .display.json 条目
    continue;
  }

  // 取最后一个 hash 的值作为标题
  const hashKeys = Object.keys(hashes);
  if (hashKeys.length === 0) continue;

  const lastHash = hashKeys[hashKeys.length - 1];
  let newTitle = hashes[lastHash];

  // 去掉换行和多余空白（保持单行）
  newTitle = newTitle
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 截断：太长的话保留前 60 字 + "..."
  if (newTitle.length > 60) {
    newTitle = newTitle.slice(0, 60) + '…';
  }

  const oldTitle = currentTitles[topicId];
  const oldSource = currentSources[topicId];

  // 只在旧标题是 auto 且为 "# Reasonix executo…" 时才修复
  // （或者旧 source 不存在/为 auto）
  const isAutoOrMissing = !oldSource || oldSource === 'auto';
  const isBadTitle = oldTitle === '# Reasonix executo…';

  if (isAutoOrMissing && isBadTitle) {
    currentTitles[topicId] = newTitle;
    currentSources[topicId] = 'manual';
    console.log(`  ✅ ${topicId}`);
    console.log(`     旧: ${oldTitle}`);
    console.log(`     新: ${newTitle}`);
    fixCount++;
  }
}

// --------------------- 落盘 ---------------------
writeFileSync(TITLES_JSON, JSON.stringify(currentTitles, null, 2), 'utf-8');
writeFileSync(SOURCES_JSON, JSON.stringify(currentSources, null, 2), 'utf-8');

console.log(`\n🎉 修复完成！共修正 ${fixCount} 条会话标题`);
console.log(`   写入 ${TITLES_JSON}`);
console.log(`   写入 ${SOURCES_JSON}`);
console.log('\n💡 重启 Reasonix 桌面端即可看到新的标题');
