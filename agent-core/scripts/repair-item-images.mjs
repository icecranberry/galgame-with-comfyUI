/**
 * 修复丢失的背包道具图标：按每件道具的「名称 + 描述 + 效果主题」重新生成，写回原路径（image_url 不变）。
 * 只在文件确实不存在时才生成，可安全重复执行。
 *
 * 用法：node scripts/repair-item-images.mjs [数量上限，默认全部]
 */
import { getDb, closeDb } from '../src/db/index.js';
import { repairMissingItemImages } from '../src/services/itemService.js';

const limit = Number(process.argv[2]) || 500;
getDb();
const started = Date.now();
const out = await repairMissingItemImages({
  limit,
  onProgress: (done, total, row, result) => {
    console.log(`[${done}/${total}] ${result.ok ? 'OK ' : 'ERR'} ${row.name}${result.ok ? '' : ' :: ' + result.error}`);
  },
});
console.log(`完成：${out.ok}/${out.total} 成功，用时 ${Math.round((Date.now() - started) / 1000)}s`);
if (out.failed.length) console.log('失败：', JSON.stringify(out.failed, null, 2));
closeDb();
