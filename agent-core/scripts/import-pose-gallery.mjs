import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
sharp.concurrency(2);

const source = process.argv.find(a => a.startsWith('--source='))?.slice(9);
if (!source) throw new Error('Usage: node scripts/import-pose-gallery.mjs --source=<local checkout>');
const root = path.resolve(source);
const destination = fileURLToPath(new URL('../assets/pose-gallery/', import.meta.url));
const rows = JSON.parse(await fs.readFile(path.join(root, 'data/pose-zh.json'), 'utf8'));
const revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const files = [];
for (const directory of ['img', 'thumbs']) {
  await fs.mkdir(path.join(destination, directory), { recursive: true });
  for (const name of await fs.readdir(path.join(root, directory))) {
    if (/\.(png|jpe?g|webp|avif)$/i.test(name)) files.push(`${directory}/${name}`);
  }
}
let cursor = 0, completed = 0;
const records = [];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (cursor < files.length) {
    const relative = files[cursor++];
    const input = await fs.readFile(path.join(root, relative));
    const converted = relative.replace(/\.[^.]+$/, '.avif');
    const output = path.join(destination, converted);
    // Resume interrupted imports without re-encoding thousands of finished files.
    try { await sharp(output).metadata(); } catch {
      await sharp(input).rotate().avif({ quality: relative.startsWith('thumbs/') ? 42 : 52, effort: 1 }).toFile(output);
    }
    const metadata = await sharp(output).metadata();
    const stat = await fs.stat(output);
    records.push({ source: relative, file: converted, sha256: createHash('sha256').update(input).digest('hex'), sourceBytes: input.length, bytes: stat.size, width: metadata.width, height: metadata.height });
    if (++completed % 100 === 0) console.log(`${completed}/${files.length}`);
  }
}));
const avif = value => value.replace(/\.[^.]+$/, '.avif');
const catalog = rows.map(row => ({ id: row.id, system: row['体系'], group: row['姿势编号'], category: row['分类'], name: row['姿势名称'], angle: row['角度'], image: avif(row['原图']), thumbnail: avif(row['缩略图']) }));
for (const row of catalog) {
  if (!records.some(r => r.file === row.image) || !records.some(r => r.file === row.thumbnail)) throw new Error(`Missing image: ${row.id}`);
}
records.sort((a, b) => a.source.localeCompare(b.source));
const manifest = { repository: 'https://github.com/aiyaoooo14/ai-pose-gallery-SKILL', revision, poses: catalog.length, groups: new Set(catalog.map(p => `${p.system}/${p.group}`)).size, files: records.length, sourceBytes: records.reduce((n, r) => n + r.sourceBytes, 0), bytes: records.reduce((n, r) => n + r.bytes, 0), records };
await fs.writeFile(path.join(destination, 'catalog.json'), JSON.stringify(catalog));
await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2));
await fs.copyFile(path.join(root, 'LICENSE'), path.join(destination, 'LICENSE'));
console.log(JSON.stringify({ ...manifest, records: undefined }, null, 2));
