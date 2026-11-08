import fs from 'node:fs';
import { inflateSync } from 'node:zlib';
import sharp from 'sharp';

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const MAX_TEXT_BYTES = 16 * 1024 * 1024;

export function isApiWorkflow(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length > 0
    && Object.values(value).every(node => node && typeof node.class_type === 'string'
      && node.inputs && typeof node.inputs === 'object' && !Array.isArray(node.inputs));
}

function normalizeSnapshot(value) {
  const generation = value?.generation || value?.linshe_generation || value?.workflow?.extra?.linsheGeneration;
  if (isApiWorkflow(value?.prompt)) return { prompt: value.prompt, ...(generation ? { generation } : {}) };
  if (Array.isArray(value?.workflow?.nodes) && value.workflow.nodes.length > 0
    && Array.isArray(value.workflow.links)) return { workflow: value.workflow, ...(generation ? { generation } : {}) };
  return null;
}

// ComfyUI/Pillow 写入 tEXt；也兼容压缩文本与国际化文本块。
export function readPngWorkflow(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const values = {};
  for (let offset = 8; offset + 12 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    if (offset + length + 12 > buffer.length) break;
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (!['tEXt', 'zTXt', 'iTXt'].includes(type) || length > MAX_TEXT_BYTES) continue;
    const separator = data.indexOf(0);
    if (separator < 0) continue;
    const key = data.toString('utf8', 0, separator);
    if (!['prompt', 'workflow', 'linshe_generation'].includes(key)) continue;
    try {
      let text = data.subarray(separator + 1);
      if (type === 'zTXt') {
        if (text[0] !== 0) continue;
        text = inflateSync(text.subarray(1), { maxOutputLength: MAX_TEXT_BYTES });
      } else if (type === 'iTXt') {
        const compressed = text[0];
        if (compressed > 1 || text[1] !== 0) continue;
        const languageEnd = text.indexOf(0, 2);
        const translatedEnd = languageEnd < 0 ? -1 : text.indexOf(0, languageEnd + 1);
        if (translatedEnd < 0) continue;
        text = text.subarray(translatedEnd + 1);
        if (compressed) text = inflateSync(text, { maxOutputLength: MAX_TEXT_BYTES });
      }
      values[key] = JSON.parse(text.toString('utf8'));
    } catch { /* 损坏的文本块不能阻断其他有效块。 */ }
  }
  return normalizeSnapshot(values);
}

/** PNG 优先读取实际 API prompt；转码图片从保留的 XMP 快照读取。 */
export async function readImageWorkflow(input) {
  const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const png = readPngWorkflow(buffer);
  if (png) return png;
  let xmp;
  try { ({ xmp } = await sharp(buffer).metadata()); } catch { return null; }
  const encoded = xmp?.toString('utf8').match(/<linshe:workflow>([A-Za-z0-9+/=\s]+)<\/linshe:workflow>/)?.[1];
  if (!encoded || encoded.length > MAX_TEXT_BYTES * 2) return null;
  try { return normalizeSnapshot(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))); }
  catch { return null; }
}

/** 用跨 PNG/AVIF 的 XMP 保存执行快照，避免 sharp 转码剥离 PNG 文本块。 */
export function workflowXmp(snapshot) {
  const encoded = Buffer.from(JSON.stringify(snapshot)).toString('base64');
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:linshe="urn:linshe:image-generation:1"><linshe:workflow>${encoded}</linshe:workflow></rdf:Description></rdf:RDF></x:xmpmeta>`;
}

export async function preserveImageWorkflow(pipeline, input) {
  const snapshot = await readImageWorkflow(input);
  return snapshot ? pipeline.withXmp(workflowXmp(snapshot)) : pipeline;
}

// 不重编码像素，补存执行快照；即使 ComfyUI 禁用了 PNG 元数据也可回溯。
export function attachPngWorkflow(buffer, snapshot) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return buffer;
  const chunks = [];
  for (const [key, value] of Object.entries({ prompt: snapshot.prompt, workflow: snapshot.workflow, linshe_generation: snapshot.generation })) {
    if (!value) continue;
    const data = Buffer.from(`${key}\0${JSON.stringify(value)}`, 'utf8');
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
