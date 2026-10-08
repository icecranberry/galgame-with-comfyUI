// 迁移清单（约定式加载）—— **新增迁移不要改本文件**，往同目录丢文件即可。
//
// ── 怎么加一个迁移 ───────────────────────────────────────
// 1. 在本目录新建 `<三位序号>_<小写描述>.migration.js`，例如
//    `001_drawing_page_tables.migration.js`
// 2. 文件里导出三样东西（缺一个就加载失败，见红线 0「不静默」）：
//      export const id = '001_drawing_page_tables';
//      export const description = '绘图页：画布/图层/历史三张表';
//      export function run(db) { ... }
// 3. 迁移自己必须幂等（加列前查 PRAGMA、清理前查一次性标记，见红线 5）。
//    序号只是排序依据，不需要连续，也不要复用已删的号。
//
// ── 为什么用 fs 扫描而不是在这里 import 一堆 ───────────────
// 目标是"新功能零改动存量"。静态 import 清单意味着每加一个迁移就要动本文件，
// 那和直接改 db/index.js 的区别只剩一个文件名。
//
// ── 失败策略 ────────────────────────────────────────────
// 单个文件加载/语法出错 → 抛错（让问题立刻可见，不静默少跑一个迁移）。
// 单个迁移**执行**出错 → 由 migrationRegistry 隔离（留痕 + 下次重试 + 不阻断启动）。

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { registerMigration, markRegistryLoaded } from '../migrationRegistry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUFFIX = '.migration.js';

/** 列出磁盘上的迁移文件（按文件名排序；不递归子目录） */
function listMigrationFiles() {
  let entries;
  try {
    entries = fs.readdirSync(__dirname, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(e => e.isFile() && e.name.endsWith(SUFFIX) && e.name !== 'index.js')
    .map(e => e.name)
    .sort();
}

/**
 * 加载并登记本目录下所有迁移。**可重复调用**（幂等：已登记的 id 会重建 registry 前先清空）。
 * 供 db/index.js 在 initSchema 末尾调用。
 * @returns {{loaded:string[], failed:{file:string,error:string}[]}}
 */
export async function loadFeatureMigrations() {
  const files = listMigrationFiles();
  const report = { loaded: [], failed: [] };

  for (const file of files) {
    const full = path.join(__dirname, file);
    let mod;
    try {
      mod = await import(pathToFileURL(full).href);
    } catch (err) {
      // 语法错误/依赖缺失：立刻抛，别让一个坏文件把整个迁移体系变成"空跑"
      throw new Error(`[migration] 加载 ${file} 失败: ${err.message}`);
    }

    const id = mod.id;
    const run = mod.run;
    const description = mod.description;
    if (typeof id !== 'string' || typeof run !== 'function') {
      throw new Error(`[migration] ${file} 必须导出 id 字符串与 run(db) 函数`);
    }
    if (!file.startsWith(id)) {
      throw new Error(`[migration] ${file} 的文件名必须以导出的 id 开头（id=${id}），否则排序不可预测`);
    }

    registerMigration({ id, description, run });
    report.loaded.push(id);
  }

  markRegistryLoaded();
  return report;
}