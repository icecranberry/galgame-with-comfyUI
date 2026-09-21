/**
 * NPC 道具的「礼物叙事」。
 *
 * 小镇货摊买来的道具（backpack_items.source_type = 'trade'）不是加 NPC 好感的消耗品，
 * 而是送给酒馆角色的礼物：使用时由 LLM 写一段「TA 收到这件东西会怎么用它」的小故事，
 * 再配一张图。展示口径与小镇服务/打工一致（图片 + 描述），前端复用 TownServiceStage 的胶片样式。
 */
import { getDb, getSystemRules, getWorldSetting } from '../db/index.js';
import { config } from '../config.js';
import { chatSync } from '../llm/llm-client.js';
import { extractFirstJson, repairJson } from './eventGenerator.js';
import { buildCharacterPersona } from './characterPersona.js';
import { generateImageRaw } from './imageSkill.js';
import { saveBase64Image } from './imagePaths.js';
import { broadcast } from './unifiedStreamBus.js';
import { percentFromProgress } from './town/progressPercent.js';

export const ITEM_GIFT_PROGRESS_EVENT = 'item_gift_progress';
export const ITEM_GIFT_READY_EVENT = 'item_gift_ready';
const GIFT_SCENE = 'gifts';
const TALE_MAX = 500;

/** 进行中的礼物叙事：一次性任务，进程内保存即可（刷新页面后重来）。 */
const tasks = new Map();
let sequence = 0;

export function getGiftNarrative(id) {
  return tasks.get(id) || null;
}

function stripFence(content) {
  return String(content || '')
    .replace(/^\s*```(?:[a-z]+)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

/** system1（系统规则 + 世界观）+ system2（角色人格）+ user（本次任务）。 */
export function buildGiftMessages({ item, character }) {
  const name = character?.display_name || '对方';
  const persona = buildCharacterPersona(character, { variant: 'short' }) || '';
  const systemBase = [getSystemRules({ roleplay: false }), getWorldSetting()].filter(Boolean).join('\n\n');
  const user = [
    '【本次任务】',
    `玩家把自己在小镇货摊上买来的一件东西送给了「${name}」。`,
    `道具名：${item?.name || '一件小东西'}`,
    `道具描述：${item?.description || '（没有更多说明）'}`,
    '',
    `请写一段 120~220 字的中文小故事：${name} 收到这件东西之后会怎么用它、发生了什么。`,
    '要求有具体动作、至少一句对话、一个小意外或反差，不要写成「TA 很开心地道了谢」这种平淡流水账。',
    '故事里不要出现「道具」「系统」这类字眼，就当它是一件普通礼物。',
    '',
    '【输出格式】严格输出如下 JSON，禁止输出 JSON 以外的任何文字、解释或 markdown 代码块：',
    '{',
    '  "tale": "中文小故事，120~220 字",',
    '  "prompt": "English image prompt, one line, 60-140 words: the character using or enjoying the gift, include appearance, clothing, action, expression, location, time of day, lighting, camera angle, art style"',
    '}',
    '',
    '【字段约束】',
    '- tale：中文，120~220 字，单段。',
    '- prompt：英文，单行，60~140 词，只描述这一个角色，禁止出现中文。',
  ].join('\n');
  return [
    { role: 'system', content: systemBase },
    { role: 'system', content: persona },
    { role: 'user', content: user },
  ].filter(message => String(message.content || '').trim());
}

export function parseGiftPayload(text) {
  const json = extractFirstJson(stripFence(text));
  if (!json) throw new Error('GIFT_JSON_MISSING');
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    data = JSON.parse(repairJson(json));
  }
  const tale = String(data?.tale || '').trim();
  const prompt = String(data?.prompt || data?.imagePrompt || '').trim();
  if (!tale || !prompt) throw new Error('GIFT_PAYLOAD_INCOMPLETE');
  return { tale: tale.slice(0, TALE_MAX), prompt };
}

async function runGiftPipeline(id, { item, characterId, options }) {
  const task = tasks.get(id);
  if (!task) return;
  const db = getDb();
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(characterId));
  if (!character) {
    task.status = 'failed';
    task.error = 'CHARACTER_NOT_FOUND';
    broadcast(ITEM_GIFT_READY_EVENT, { sessionId: id, error: task.error });
    return;
  }
  task.characterName = character.display_name || '';
  try {
    const llm = options.llm?.chatSync || chatSync;
    const messages = buildGiftMessages({ item, character });
    let text = '';
    try {
      text = await llm(messages, { temperature: 0.9, max_tokens: 1400, label: '礼物叙事生成', response_format: { type: 'json_object' } });
    } catch {
      text = '';
    }
    let payload;
    try {
      payload = parseGiftPayload(text);
    } catch {
      text = await llm(messages, { temperature: 0.7, max_tokens: 1400, label: '礼物叙事生成（重试）' });
      payload = parseGiftPayload(text);
    }

    const generate = options.generateImageRaw || generateImageRaw;
    const onProgress = progress => {
      const percent = percentFromProgress(progress);
      if (percent == null) return;
      broadcast(ITEM_GIFT_PROGRESS_EVENT, { sessionId: id, progress: percent });
    };
    const result = await generate(payload.prompt, {
      ragQuery: payload.prompt,
      artist: config.comfyui.eventArtist,
      width: config.comfyui.eventWidth,
      height: config.comfyui.eventHeight,
      scene: GIFT_SCENE,
      priority: 'high',
      onProgress,
    });
    const image = Array.isArray(result?.images) ? result.images[0] : null;
    if (!result?.success || !image) throw new Error('GIFT_IMAGE_FAILED');
    const imageUrl = saveBase64Image(GIFT_SCENE,
      `item_gift_${character.id}_${Date.now()}_${image.filename || 'comfy.png'}`, image.base64);

    task.status = 'ready';
    task.imageUrl = imageUrl;
    task.tale = payload.tale;
    broadcast(ITEM_GIFT_READY_EVENT, {
      sessionId: id, imageUrl, tale: payload.tale,
      characterName: task.characterName, itemName: task.itemName,
    });
  } catch (error) {
    task.status = 'failed';
    task.error = error?.message || 'GIFT_FAILED';
    broadcast(ITEM_GIFT_READY_EVENT, { sessionId: id, error: task.error });
  }
}

/** 启动一次礼物叙事：立刻返回 id，图片与故事异步产出并走 SSE 推送。 */
export function startGiftNarrative({ item, characterId, options = {} }) {
  const id = `gift-${Date.now()}-${++sequence}`;
  tasks.set(id, {
    id, status: 'generating', characterName: '', itemName: item?.name || '',
    imageUrl: null, tale: '', error: '',
  });
  runGiftPipeline(id, { item, characterId, options }).catch(() => {});
  return { id };
}
