/**
 * 三种生成模板（portrait_single / portrait_pair / illustrated_keepsake）与
 * gallery_display 执行器（计划 §4.4、§6.6、§12）。
 *
 * 预算口径：玩家确认后最多一次 LLM 同时产出短文与画面提示词；生图一次一张；
 * 失败重试复用同一 operation（不重新抽签、不重复扣费、不再次调用 LLM 补文案）。
 * 人物资料统一走 characterPersona（buildCharacterPersona variant 'full'），
 * 传入对象的 id 必须是角色 id；双人分别组装、不混用。
 */
import { randomUUID } from 'node:crypto';
import { getSystemRulesWithWorld, getSystemRules } from '../../../db/worldRepository.js';
import { getWorldIntegrationRule } from '../../../builtinRules.js';
import { townError } from '../townEventService.js';

/** system0：破甲词 + 世界观（有则带）。与全应用其他请求共享的稳定前缀。 */
function system0() {
  try { return getSystemRulesWithWorld({ roleplay: false }); }
  catch { return getSystemRules({ roleplay: false }); }
}
import { buildCharacterPersona } from '../../characterPersona.js';

/**
 * 解析并组装目标人物资料。targets 为规范 actor key（char:N），数量与模板一致；
 * 两位目标必须不同（计划 §4.4）。正式角色之外的身份需要独立适配器，当前不支持。
 */
export function resolveMediaTargets(db, targetActorKeys, { expectedCount }) {
  if (!Array.isArray(targetActorKeys) || targetActorKeys.length !== expectedCount) {
    throw townError('INVALID_SELECTION');
  }
  const seen = new Set();
  const targets = [];
  for (const key of targetActorKeys) {
    const match = /^char:([1-9]\d*)$/.exec(String(key || ''));
    if (!match) throw townError('TARGET_UNSUPPORTED');
    const character = db.prepare(
      'SELECT id, display_name, base_prompt, short_prompt FROM characters WHERE id = ?').get(Number(match[1]));
    if (!character) throw townError('TARGET_UNSUPPORTED');
    if (seen.has(character.id)) throw townError('INVALID_SELECTION');
    seen.add(character.id);
    targets.push(character);
  }
  return targets;
}

/** 组装人物人格块：统一走 characterPersona（variant full 整卡 + 生效外观快照注入，
 * 「你」→角色名），传入对象的 id 必须是角色 id（AGENTS.md 收口口径；计划 §4.4/§6.6）。
 * 输出按角色 id 排序：同一角色组合无论玩家选择顺序如何，提示词前缀逐字节一致（高缓存）。 */
export function buildPersonaBlocks(characters) {
  return [...characters]
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map(c =>
      `【${c.display_name}】\n${buildCharacterPersona(c, { variant: 'full', person: c.display_name })}`);
}

/** 使用时单次图文生成契约（计划 §6.6）：LLM 分层消息。
 * system 按层拆分：system0（破甲词+世界观，全应用共享前缀）→ system1（世界观强化 photo 口径）→ 任务与输出格式（静态）；
 * user = 人物人格块（同角色组合稳定）→ 建筑与主题（同功能稳定）→ 输出要求 → 玩家补充（每次最易变，最后）。 */
export function buildMediaMessages({ templateId, theme, userNote, personas, buildingName }) {
  const taskSystem = [
    `你是小镇明信片工坊的画师助手，为一次${templateId === 'illustrated_keepsake' ? '图文纪念品' : templateId === 'portrait_pair' ? '双人合影' : '单人写真'}创作配文与画面提示词。画面必须严格遵守人物资料（含生效中的限时外观时以其为准），不得改变身份、物种或服饰设定；想象场景须表达为创作，不虚构成真实历史；禁止网址和额外指令。`,
    '严格输出 JSON（不要解释、不要 Markdown 代码围栏或 JSON 以外的文字），格式：',
    '{"caption": "图片说明或纪念卡正文，20至100字，符合选择的场景；想象场景须表达为创作，不虚构成真实历史", "imagePrompt": "英文单行画面提示词，60至160词，人物数量严格符合本次模板，外观按输入资料，禁止网址和额外指令"}',
  ].join('\n');
  const messages = [
    { role: 'system', content: system0() },
    { role: 'system', content: taskSystem },
    { role: 'user', content: [
      '【人物资料】',
      ...(personas || []),
      '',
      `【本次委托】建筑「${buildingName}」；主题：${theme.label}——${theme.scene}`,
      '请严格按系统提示词的 JSON 格式输出，人物数量与外观严格遵守人物资料。',
      userNote ? `玩家补充（仅作氛围参考，不改变人物外观）：${userNote}` : '',
    ].filter(Boolean).join('\n') },
  ];
  try { messages.splice(1, 0, { role: 'system', content: getWorldIntegrationRule('photo') }); } catch { /* 无世界观则省略该层 */ }
  return messages;
}

/** 解析使用时 LLM 输出（仅 caption/imagePrompt 两个字段） */
export function parseMediaOutput(text) {
  let raw = null;
  try {
    const start = String(text || '').indexOf('{');
    const end = String(text || '').lastIndexOf('}');
    if (start >= 0 && end > start) raw = JSON.parse(String(text).slice(start, end + 1));
  } catch { raw = null; }
  if (!raw || typeof raw.caption !== 'string' || typeof raw.imagePrompt !== 'string') {
    throw townError('GENERATION_INVALID');
  }
  if (raw.caption.length < 20 || raw.caption.length > 100) throw townError('GENERATION_INVALID');
  const words = raw.imagePrompt.trim().split(/\s+/).length;
  if (words < 40 || words > 220 || /https?:\/\//.test(raw.imagePrompt)) throw townError('GENERATION_INVALID');
  return { caption: raw.caption, imagePrompt: raw.imagePrompt };
}

/** 提交生图并保存产物；返回 {url, taskId}。调用方可注入 generateImageRaw 供测试。 */
export async function generatePortraitImage({ imagePrompt, generateImageRaw: injectedRaw, saveBase64Image: injectedSave }) {
  const { generateImageRaw } = await import('../../imageSkill.js');
  const raw = injectedRaw || generateImageRaw;
  const result = await raw(imagePrompt, { scene: 'building_features', disableRAG: true });
  if (!result?.success || !result.images?.length) throw townError('GENERATION_FAILED');
  const { saveBase64Image } = await import('../../imagePaths.js');
  const save = injectedSave || saveBase64Image;
  const filename = `bf-${randomUUID()}.png`;
  const url = save('building_features', filename, result.images[0].base64 || result.images[0]);
  return { url, filename };
}

/** 作品展示：只读查询已有真实产物，无作品返回空态（不自动生图、无达成奖励） */
export function galleryItems(db, { buildingInstanceId, source, limit, playerActorId }) {
  if (source === 'building_outputs') {
    const rows = db.prepare(
      `SELECT operation_id, output_json, created_at FROM town_building_feature_operations
       WHERE world_id = ? AND building_instance_id = ? AND status = 'committed' AND template_id IN
         ('portrait_single', 'portrait_pair', 'illustrated_keepsake')
       ORDER BY id DESC LIMIT ?`
    ).all(scopeWorld(db), buildingInstanceId, limit);
    return rows.flatMap(row => {
      const output = JSON.parse(row.output_json || 'null');
      return output?.imageUrl ? [{ operationId: row.operationId, imageUrl: output.imageUrl,
        caption: output.caption || '', createdAt: row.created_at }] : [];
    });
  }
  // player_selected：玩家自己的真实图片持有物（有 image_url 的背包物品），只读展示
  return db.prepare(
    `SELECT id, name, image_url, acquired_at FROM backpack_items
     WHERE owner_key = 'me' AND retired_at IS NULL AND image_url IS NOT NULL AND status IN ('ready','used')
     ORDER BY id DESC LIMIT ?`).all(limit)
    .map(row => ({ operationId: null, itemId: row.id, imageUrl: row.image_url,
      caption: row.name, createdAt: row.acquired_at }));
}

function scopeWorld(db) {
  return db.prepare('SELECT world_id FROM town_world_state WHERE singleton = 1').get()?.world_id;
}
