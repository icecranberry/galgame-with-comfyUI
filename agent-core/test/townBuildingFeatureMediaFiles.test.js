import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 这里走的是真实的 saveBase64Image（不注入 provider）：产物必须真的落盘。
// IMAGES_DIR 指到临时目录，绝不碰用户 data/images。
process.env.DB_PATH = ':memory:';
process.env.IMAGES_DIR = mkdtempSync(join(tmpdir(), 'bf-media-files-'));
globalThis.fetch = async () => { throw new Error('Network forbidden'); };

const media = await import('../src/services/town/buildingFeatures/media.js');
const { IMAGE_CATEGORIES, getImageDir, getAllImageDirs } = await import('../src/services/imagePaths.js');

after(() => rmSync(process.env.IMAGES_DIR, { recursive: true, force: true }));

test('generative media saves into a registered image category (no stubbed save)', async () => {
  // 没登记的话 getImageDir 抛 Unknown image category，写真/合影/纪念品会在最后一步全部失败，
  // 而 mock 掉 generatePortraitImage 的测试永远看不到这件事。
  assert.ok(IMAGE_CATEGORIES.building_features, 'building_features 必须登记在 IMAGE_CATEGORIES');
  assert.equal(getImageDir('building_features'), join(process.env.IMAGES_DIR, 'building_features'));
  // 相册（/api/images/gallery）就是扫 getAllImageDirs 的目录，登记即接入，不再是一张只在奇遇里能看到的孤儿图
  assert.ok(getAllImageDirs().some(d => d.category === 'building_features' && d.urlPrefix === '/images/building_features'),
    '建筑作品会进相册目录');

  const png = `data:image/png;base64,${Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')}`;
  const { url, filename } = await media.generatePortraitImage({
    imagePrompt: 'a quiet test prompt',
    generateImageRaw: async () => ({ success: true, images: [{ base64: png }] }),
  });

  assert.match(url, /^\/images\/building_features\/bf-[0-9a-f-]+\.png$/, '产物 URL 落在 /images/building_features/');
  assert.ok(existsSync(join(getImageDir('building_features'), filename)), '产物真的写到磁盘');
});
