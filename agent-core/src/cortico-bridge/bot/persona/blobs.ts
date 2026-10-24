/**
 * `mem:` 句柄的后端:字节住在 memoryDir 下,句柄就是相对 memoryDir 的路径(`mem:blobs/cat.png`)。
 * 不带目录的名字提示落进 `blobs/`;越出 memoryDir 的路径一律拒绝。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { BlobStore } from 'cortico/core/types.ts';
import { MEM_SCHEME, mimeOfHandle } from 'cortico/core/blobs.ts';

const BLOBS_DIR = 'blobs';

export class FileBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  put(nameHint: string, bytes: Uint8Array, _mime: string): string {
    const rel = this.inside(nameHint.includes('/') ? nameHint : `${BLOBS_DIR}/${nameHint}`);
    const abs = join(this.root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, bytes);
    return `${MEM_SCHEME}${rel}`;
  }

  get(handle: string): { bytes: Uint8Array; mime: string } | null {
    const rel = handle.startsWith(MEM_SCHEME) ? handle.slice(MEM_SCHEME.length) : handle;
    let abs: string;
    try {
      abs = join(this.root, this.inside(rel));
    } catch {
      return null;
    }
    if (!existsSync(abs) || statSync(abs).isDirectory()) return null;
    return { bytes: readFileSync(abs), mime: mimeOfHandle(rel) };
  }

  list(prefix: string = BLOBS_DIR): Array<{ handle: string; mime: string; size: number }> {
    let dir: string;
    try {
      dir = join(this.root, this.inside(prefix));
    } catch {
      return [];
    }
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
    const out: Array<{ handle: string; mime: string; size: number }> = [];
    const walk = (at: string): void => {
      for (const name of readdirSync(at).sort()) {
        const abs = join(at, name);
        const st = statSync(abs);
        if (st.isDirectory()) walk(abs);
        else {
          const rel = relative(this.root, abs).split(sep).join('/');
          out.push({ handle: `${MEM_SCHEME}${rel}`, mime: mimeOfHandle(rel), size: st.size });
        }
      }
    };
    walk(dir);
    return out;
  }

  /** 归一化成相对 memoryDir 的 `/` 路径;越出 memoryDir 的抛错。 */
  private inside(rel: string): string {
    const root = resolve(this.root);
    const abs = resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + sep)) throw new Error(`${rel} 在 Memory 之外`);
    return relative(root, abs).split(sep).join('/');
  }
}
