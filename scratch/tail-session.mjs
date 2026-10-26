// 读取 Cortico session-main.jsonl 尾部：node scratch/tail-session.mjs [行数]
import { readFileSync } from 'node:fs';
const file = 'Cortico/deployments/linshe/data/session-main.jsonl';
const n = Number(process.argv[2] || 12);
const lines = readFileSync(file, 'utf8').trim().split('\n');
console.log('TOTAL LINES:', lines.length);
for (const line of lines.slice(-n)) {
  try {
    const { item, context } = JSON.parse(line);
    const ts = context?.ts ?? '';
    const t = item?.type ?? '';
    const name = item?.function_call?.name ?? '';
    const args = item?.function_call?.arguments ?? '';
    const out = (item?.output ?? item?.function_call_output?.output ?? '');
    const s = String(name ? args : out).replace(/\s+/g, ' ').slice(0, 150);
    console.log(ts.slice(11, 19), t.padEnd(20), name.padEnd(16), s);
  } catch { console.log('parse-error'); }
}
