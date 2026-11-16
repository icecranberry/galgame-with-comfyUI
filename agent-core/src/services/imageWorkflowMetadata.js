import fs from 'node:fs';
import { inflateSync } from 'node:zlib';
import sharp from 'sharp';

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const MAX_TEXT_BYTES = 16 * 1024 * 1024;
const WORKFLOW_KEYS = ['prompt', 'workflow', 'linshe_generation'];
// 三份 JSON 转义为文本后可能膨胀；超限时停止转码，不能静默丢弃工作流。
const MAX_XMP_BYTES = MAX_TEXT_BYTES * 8;

export function isApiWorkflow(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length > 0
    && Object.values(value).every(node => node && typeof node.class_type === 'string'
      && node.inputs && typeof node.inputs === 'object' && !Array.isArray(node.inputs));
}

function normalizeSnapshot(value) {
  const generation = value?.generation || value?.linshe_generation || value?.workflow?.extra?.linsheGeneration;
  const hasPrompt = isApiWorkflow(value?.prompt);
  const hasWorkflow = Array.isArray(value?.workflow?.nodes) && value.workflow.nodes.length > 0
    && Array.isArray(value.workflow.links);
  if (hasPrompt || hasWorkflow) return {
    ...(hasPrompt ? { prompt: value.prompt } : {}),
    ...(hasWorkflow ? { workflow: value.workflow } : {}),
    ...(generation ? { generation } : {}),
  };
  return null;
}

// ComfyUI/Pillow 写入 tEXt；也兼容压缩文本与国际化文本块。
function readPngWorkflowTexts(buffer, strict = false) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return {};
  const texts = {};
  for (let offset = 8; offset + 12 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    if (offset + length + 12 > buffer.length) {
      if (strict) throw new Error('PNG 数据块不完整，无法安全保留工作流');
      break;
    }
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === 'IEND') break;
    if (!['tEXt', 'zTXt', 'iTXt', 'comf'].includes(type)) continue;
    const separator = data.indexOf(0);
    if (separator < 0) continue;
    const key = data.toString('utf8', 0, separator);
    if (!WORKFLOW_KEYS.includes(key)) continue;
    try {
      if (length > MAX_TEXT_BYTES) throw new Error('文本块过大');
      let text = data.subarray(separator + 1);
      if (type === 'zTXt') {
        if (text[0] !== 0) throw new Error('不支持的压缩方式');
        text = inflateSync(text.subarray(1), { maxOutputLength: MAX_TEXT_BYTES });
      } else if (type === 'iTXt') {
        const compressed = text[0];
        if (compressed > 1 || text[1] !== 0) throw new Error('不支持的压缩方式');
        const languageEnd = text.indexOf(0, 2);
        const translatedEnd = languageEnd < 0 ? -1 : text.indexOf(0, languageEnd + 1);
        if (translatedEnd < 0) throw new Error('文本块头不完整');
        text = text.subarray(translatedEnd + 1);
        if (compressed) text = inflateSync(text, { maxOutputLength: MAX_TEXT_BYTES });
      }
      const raw = text.toString('utf8');
      JSON.parse(raw);
      // 不用解析后的对象重新序列化，保留空白、字段顺序和大整数种子原文。
      texts[key] = raw;
    } catch (error) {
      if (strict) throw new Error(`无法保留 PNG ${key} 元数据：${error.message}`);
      // 只读回溯时，损坏的文本块不能阻断其他有效块。
    }
  }
  return texts;
}

function snapshotFromTexts(texts) {
  const values = {};
  for (const key of WORKFLOW_KEYS) {
    try { if (typeof texts[key] === 'string') values[key] = JSON.parse(texts[key]); } catch {}
  }
  return normalizeSnapshot(values);
}

export function readPngWorkflow(buffer) {
  return snapshotFromTexts(readPngWorkflowTexts(buffer));
}

function snapshotToTexts(snapshot) {
  return Object.fromEntries(Object.entries({ prompt: snapshot.prompt, workflow: snapshot.workflow,
    linshe_generation: snapshot.generation }).filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, JSON.stringify(value)]));
}

/** 原生 PNG 文本优先；兼容旧版对象快照与新版原文 XMP。 */
export async function readImageWorkflowTexts(input, { strict = false } = {}) {
  const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const texts = readPngWorkflowTexts(buffer, strict);
  if (Object.keys(texts).length) return texts;
  let xmp;
  try { ({ xmp } = await sharp(buffer).metadata()); } catch (error) {
    if (strict) throw error;
    return {};
  }
  const xml = xmp?.toString('utf8');
  const encoded = xml?.match(/<linshe:workflow>([A-Za-z0-9+/=\s]+)<\/linshe:workflow>/)?.[1];
  if (!encoded) {
    if (strict && xml?.includes('<linshe:workflow>')) throw new Error('工作流 XMP 损坏，已停止转码');
    return {};
  }
  try {
    if (encoded.length > MAX_XMP_BYTES * 4 / 3 + 4) throw new Error('工作流 XMP 过大');
    const stored = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    if (!stored.pngText) return snapshotToTexts(stored);
    const result = {};
    for (const key of WORKFLOW_KEYS) {
      if (!(key in stored.pngText)) continue;
      const raw = stored.pngText[key];
      if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_TEXT_BYTES) throw new Error(`无效的 ${key} 原文`);
      JSON.parse(raw);
      result[key] = raw;
    }
    return result;
  } catch (error) {
    if (strict) throw new Error(`无法保留工作流 XMP：${error.message}`);
    return {};
  }
}

/** 同时读取完整 GUI 工作流和 API prompt，执行时仍由调用方优先使用 prompt。 */
export async function readImageWorkflow(input) {
  return snapshotFromTexts(await readImageWorkflowTexts(input));
}

/** 用跨 PNG/AVIF 的 XMP 保存执行快照，避免 sharp 转码剥离 PNG 文本块。 */
export function workflowXmp(snapshot) {
  const json = Buffer.from(JSON.stringify(snapshot));
  if (json.length > MAX_XMP_BYTES) throw new Error('工作流 XMP 过大，已停止转码');
  const encoded = json.toString('base64');
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:linshe="urn:linshe:image-generation:1"><linshe:workflow>${encoded}</linshe:workflow></rdf:Description></rdf:RDF></x:xmpmeta>`;
}

export async function preserveImageWorkflow(pipeline, input) {
  const texts = await readImageWorkflowTexts(input, { strict: true });
  return applyWorkflowMetadata(pipeline, texts);
}

function applyWorkflowMetadata(pipeline, texts) {
  if (!Object.keys(texts).length) return pipeline;
  return pipeline.withXmp(workflowXmp({ pngText: texts }));
}

function buildAvifWorkflowExif(texts) {
  // 对齐 ComfyUI 的 AVIF EXIF 约定：IFD0 Make=workflow、Model=prompt。
  // 自行写 TIFF，避免 libexif 对超长 ASCII 字段的截断；JSON 转义保留中文和 emoji。
  const entries = [['workflow', 0x010f], ['prompt', 0x0110]].filter(([key]) => texts[key] !== undefined);
  const header = Buffer.alloc(8 + 2 + entries.length * 12 + 4);
  header.write('II', 0, 'ascii');
  header.writeUInt16LE(42, 2);
  header.writeUInt32LE(8, 4);
  header.writeUInt16LE(entries.length, 8);
  const values = [];
  let offset = header.length;
  for (const [index, [key, tag]] of entries.entries()) {
    const ascii = texts[key].replace(/[\u007f-\uffff]/g,
      char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
    const data = Buffer.from(`${key}:${ascii}\0`, 'ascii');
    const at = 10 + index * 12;
    header.writeUInt16LE(tag, at);
    header.writeUInt16LE(2, at + 2);
    header.writeUInt32LE(data.length, at + 4);
    header.writeUInt32LE(offset, at + 8);
    values.push(data);
    offset += data.length;
    if (offset % 2) {
      values.push(Buffer.alloc(1));
      offset++;
    }
  }
  // HEIF Exif item 前四字节是到 TIFF 头的偏移，不写 JPEG 的 Exif\0\0 前缀。
  return Buffer.concat([Buffer.alloc(4), header, ...values]);
}

// ComfyUI 的 AVIF 解析器忽略 iloc.base_offset。把 Sharp/libheif 的相对偏移
// 改写为绝对偏移并清零 base，Exif item 指向新增 mdat，图像数据位置不变。
function attachAvifWorkflow(buffer, texts) {
  if (buffer.toString('ascii', 4, 12) !== 'ftypavif') throw new Error('输出不是 AVIF，无法保留可导入工作流');
  function findBox(start, end, type) {
    for (let at = start; at + 8 <= end;) {
      const size = buffer.readUInt32BE(at) || end - at;
      if (size < 8 || at + size > end) throw new Error('AVIF 数据块布局不受支持');
      if (buffer.toString('ascii', at + 4, at + 8) === type) return { start: at + 8, end: at + size };
      at += size;
    }
    throw new Error(`AVIF 缺少 ${type} 数据块`);
  }
  const meta = findBox(0, buffer.length, 'meta');
  const iinf = findBox(meta.start + 4, meta.end, 'iinf');
  if (iinf.start + 6 > iinf.end || buffer[iinf.start] !== 0) throw new Error('AVIF item-info 格式不受支持');
  let exifId;
  let cursor = iinf.start + 6;
  for (let i = 0; i < buffer.readUInt16BE(iinf.start + 4); i++) {
    const infe = findBox(cursor, iinf.end, 'infe');
    if (infe.start + 12 > infe.end || buffer[infe.start] !== 2) throw new Error('AVIF item-info entry 格式不受支持');
    if (buffer.toString('ascii', infe.start + 8, infe.start + 12) === 'Exif') exifId = buffer.readUInt16BE(infe.start + 4);
    cursor = infe.end;
  }
  if (exifId === undefined) throw new Error('AVIF 缺少 EXIF item');
  const exif = buildAvifWorkflowExif(texts);
  const mdat = Buffer.alloc(8);
  mdat.writeUInt32BE(exif.length + 8);
  mdat.write('mdat', 4, 'ascii');
  const iloc = findBox(meta.start + 4, meta.end, 'iloc');
  // 当前 Sharp 输出 iloc v0、32 位 offset/length/base；未知布局停止写入，不猜测偏移。
  if (iloc.start + 8 > iloc.end || buffer[iloc.start] !== 0 || buffer[iloc.start + 4] !== 0x44
    || ![0, 0x40].includes(buffer[iloc.start + 5])) {
    throw new Error('AVIF item-location 格式不受支持，已停止转码');
  }
  const baseSize = buffer[iloc.start + 5] >>> 4;
  const count = buffer.readUInt16BE(iloc.start + 6);
  let at = iloc.start + 8;
  let replaced = false;
  for (let i = 0; i < count; i++) {
    if (at + 6 + baseSize > iloc.end || buffer.readUInt16BE(at + 2) !== 0) {
      throw new Error('AVIF item-location 数据不完整或引用了外部文件');
    }
    const isExif = buffer.readUInt16BE(at) === exifId;
    const base = baseSize ? buffer.readUInt32BE(at + 4) : 0;
    const extents = buffer.readUInt16BE(at + 4 + baseSize);
    if (isExif && extents !== 1) throw new Error('AVIF EXIF extent 数量不受支持');
    if (baseSize) buffer.writeUInt32BE(0, at + 4);
    at += 6 + baseSize;
    for (let j = 0; j < extents; j++, at += 8) {
      if (at + 8 > iloc.end) throw new Error('AVIF extent 数据不完整');
      const offset = base + buffer.readUInt32BE(at);
      const length = buffer.readUInt32BE(at + 4);
      if (offset > 0xffffffff || offset + length > buffer.length) throw new Error('AVIF extent 超出文件范围');
      buffer.writeUInt32BE(isExif ? buffer.length + 8 : offset, at);
      if (isExif) {
        buffer.writeUInt32BE(exif.length, at + 4);
        replaced = true;
      }
    }
  }
  if (!replaced) throw new Error('AVIF 缺少 EXIF item-location');
  return Buffer.concat([buffer, mdat, exif]);
}

async function encodeWithWorkflowTexts(pipeline, texts, format) {
  if (!['png', 'avif'].includes(format)) throw new Error(`不支持的工作流保留格式：${format}`);
  if (format === 'png') return attachPngWorkflowTexts(await pipeline.toBuffer(), texts);
  const hasWorkflow = texts.workflow !== undefined || texts.prompt !== undefined;
  // 让 libheif 建立 Exif item/关联，再用完整 TIFF 替换它，支持超过 64 KiB 的工作流。
  if (hasWorkflow) pipeline.withExif({ IFD0: { Make: 'ComfyUI' } });
  const buffer = await applyWorkflowMetadata(pipeline, texts).toBuffer();
  return hasWorkflow ? attachAvifWorkflow(buffer, texts) : buffer;
}

/** 内存转码同样补齐可导入的 EXIF/iloc；供已压缩图片重新生成、放大后的 AVIF 回写使用。 */
export async function encodeImageWithWorkflow(pipeline, input, format) {
  return encodeWithWorkflowTexts(pipeline, await readImageWorkflowTexts(input, { strict: true }), format);
}

/** PNG 写原生文本，AVIF 写 ComfyUI EXIF 和原文 XMP；校验落盘原文后才可删除原图。 */
export async function writeImageWithWorkflow(pipeline, input, output, format) {
  const texts = await readImageWorkflowTexts(input, { strict: true });
  await fs.promises.writeFile(output, await encodeWithWorkflowTexts(pipeline, texts, format));
  const saved = await readImageWorkflowTexts(output, { strict: true });
  for (const key of WORKFLOW_KEYS) {
    if (saved[key] !== texts[key]) throw new Error(`压缩后 ${key} 元数据不一致，已保留原图`);
  }
}

function attachPngWorkflowTexts(buffer, texts) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return buffer;
  const chunks = [];
  for (const [key, text] of Object.entries(texts)) {
    const data = Buffer.from(`${key}\0${text}`, 'utf8');
    const chunk = Buffer.alloc(data.length + 12);
    chunk.writeUInt32BE(data.length);
    chunk.write('tEXt', 4, 'ascii');
    data.copy(chunk, 8);
    let crc = 0xffffffff;
    for (const byte of chunk.subarray(4, -4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
    chunks.push(chunk);
  }
  // 插到 IEND 之前，读取时以最后一份同名文本为准。
  return Buffer.concat([buffer.subarray(0, -12), ...chunks, buffer.subarray(-12)]);
}

// 不重编码像素，补存执行快照；即使 ComfyUI 禁用了 PNG 元数据也可回溯。
export function attachPngWorkflow(buffer, snapshot) {
  return attachPngWorkflowTexts(buffer, snapshotToTexts(snapshot));
}

/** 深拷贝后仅更新种子；不重建 LoRA、提示词、模型或连接。 */
export function randomizeWorkflowSeeds(prompt, random = Math.random) {
  if (!isApiWorkflow(prompt)) throw new Error('原图工作流不是有效的 ComfyUI API 工作流');
  const copy = structuredClone(prompt);
  const changed = new Set();
  function updateSeed(node, key, visiting = new Set()) {
    if (visiting.has(node)) throw new Error('原图种子节点存在循环连接，无法重新生成');
    visiting.add(node);
    const value = node.inputs[key];
    if (Array.isArray(value)) {
      const source = copy[String(value[0])];
      if (!source || value[1] !== 0 || !['PrimitiveInt', 'PrimitiveFloat'].includes(source.class_type)) {
        throw new Error('原图种子由不支持的节点提供，无法安全地重新生成');
      }
      updateSeed(source, 'value', visiting);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      const id = `${Object.keys(copy).find(id => copy[id] === node)}:${key}`;
      if (changed.has(id)) return;
      let seed = Math.floor(random() * Number.MAX_SAFE_INTEGER);
      if (seed === value) seed = (seed + 1) % Number.MAX_SAFE_INTEGER;
      node.inputs[key] = seed;
      changed.add(id);
    } else throw new Error('原图种子格式不受支持，无法安全地重新生成');
  }
  for (const node of Object.values(copy)) {
    for (const key of ['seed', 'noise_seed', 'random_seed']) {
      if (key in node.inputs) updateSeed(node, key);
    }
  }
  if (!changed.size) throw new Error('原图工作流没有可更新的随机种子，无法安全地重新生成');
  return copy;
}
