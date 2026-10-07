/**
 * 建筑功能建档生成器（两段式，计划 §6/§8）：
 *   第一段「选模板」：审建筑资料 → 必须选出恰好 1 个最贴合的模板（证据/价档/表现文案，不含参数）。
 *   第二段「生成参数」：为该模板调 1 次 LLM，生成其真正需要的 params（及需要的 resources）。
 *   玩家使用仍零调用。
 *
 * 预算纪律：建档 = 2 次调用；每段修复最多 1 次；浏览/报价/执行零调用；
 * 不允许空手而归（none 被校验拒绝并触发修复）；失败保留诊断供手动重试。
 * 两段输出在内存拼回原有 generated 形状后，仍走 compileGeneration 做全量权威校验。
 *
 * LLM 分层（AGENTS.md 高缓存口径）：system 按层拆分多条消息——
 *   system0 = 破甲词+世界观（getSystemRulesWithWorld，全应用共享前缀）；
 *   system1 = 世界观强化（getWorldIntegrationRule('town_asset')，有世界观才有）；
 *   system2 = 任务规则与输出格式（静态）。user 内再按 静态→易变 排序。
 */
import { randomUUID } from 'node:crypto';
import { chatSync } from '../../llm/llm-client.js';
import { extractFirstJson, repairJson } from '../eventGenerator.js';
import { getSystemRulesWithWorld, getSystemRules } from '../../db/worldRepository.js';
import { getWorldIntegrationRule } from '../../builtinRules.js';
import { townError } from './townEventService.js';
import { resolveBuildingFeatureSource } from './townBuildingFeatureSource.js';
import { ensureProfile, effectiveStatus, compiledConfig, compileGeneration, templateCatalogForPrompt,
  setBuildingFeatureDescription } from './townBuildingFeatureService.js';
import { PRICE_TIERS, getTemplate, SHOP_TEMPLATE_IDS, SHOP_REFRESH_PRICE } from './townBuildingFeatureRegistry.js';
import { ensureOpeningResources, buildingStockOwnerKey, OPENING_STOCK_UNITS } from './buildingFeatures/trade.js';

const GENERATE_LABEL = '建筑功能生成';

/** system0：破甲词 + 世界观（有则带）。全应用共享的逐字节稳定前缀，最大化提供商前缀缓存命中。 */
function system0() {
  try { return getSystemRulesWithWorld({ roleplay: false }); }
  catch { return getSystemRules({ roleplay: false }); }
}

/** system1：世界观强化（town_asset 口径）。无世界观时省略该层。 */
function system1() {
  try { return getWorldIntegrationRule('town_asset'); }
  catch { return null; }
}

/** 按分层规则组装消息：system0 → system1（可选）→ 任务 system → user */
function layeredMessages(taskSystem, user) {
  const messages = [{ role: 'system', content: system0() }];
  const integration = system1();
  if (integration) messages.push({ role: 'system', content: integration });
  messages.push({ role: 'system', content: taskSystem });
  messages.push({ role: 'user', content: user });
  return messages;
}

// ── 第一段：选模板 ──

/** 第一段系统提示词：只选择一个最贴合的模板，不生成参数（任务层；system0/system1 由 layeredMessages 组装） */
function selectSystemPrompt() {
  return `根据建筑资料判断它最适合用哪一个模板实现功能。建筑完整用途描述优先，名称与类型（businessKind）用于辅助理解。只从输入给出的 ready 模板目录中选择。**每栋建筑必须恰好选择 1 个最贴合建筑性质的模板（features 恰好 1 项），不允许空手而归**——即使资料只有名称，也要结合名称与类型选出最接近建筑性质的模板。supportLevel 默认返回 supported；只有当描述明确要求目录中完全不存在的能力（如时间倒退、定时培养等被排除的玩法）时才返回 partial 并把该用途原文列入 unsupported——**描述里能用其他 ready 模板实现的用途不要列入 unsupported**（单模板口径下它们只是未被选中，不是不支持）。选择必须有原文依据（缺描述时用 building.title）。你只做选择与表现文案，不生成任何执行参数——参数由后续阶段单独生成。严格按完整 JSON 示例输出；不要解释、Markdown 代码围栏或 JSON 以外的文字。

完整顶层格式示例（字符串示例中的内容要求也必须遵守）：
{
  "schemaVersion": 1,
  "supportLevel": "supported",
  "interpretation": "建筑用途概括，20至80字，忠于输入描述，不补写不存在的业务",
  "unsupported": [],
  "features": [
    {
      "key": "rent_outfit",
      "templateId": "outfit_change",
      "templateVersion": 1,
      "title": "具体可点击的服务名称，2至16字，不出现模板或参数等内部用语",
      "description": "服务说明，20至80字，只承诺本模板可执行结果",
      "evidence": {
        "source": "building.description",
        "quote": "必须逐字摘录输入中支持该功能的一段原文，1至160字"
      },
      "priceTier": "standard",
      "presentation": {
        "opening": "建筑开场文案，20至80字，未执行前不声称玩家已付款或已获得效果",
        "success": "完成后的简短反应，10至60字，只用已确定的结果；可使用占位符 {targetName} {optionLabel} {itemName}",
        "empty": "无可用目标或选项时的短提示，5至40字，不编造替代奖励"
      }
    }
  ]
}

字段硬约束：
- schemaVersion 固定为 1；supportLevel 默认 supported；只有描述明确要求目录中完全不存在的能力（被排除玩法）时才用 partial 并把该用途列入 unsupported；**能用其他 ready 模板实现的用途不要列入 unsupported**。
- interpretation 20—80 字，不能扩写人物背景或新世界规则。
- unsupported 0—6 个对象，每项 {"sourceText": "输入中暂不能实现的用途原文，1至160字，必须是精确摘录", "reason": "不能实现的具体原因，10至80字；不能承诺会自动实现或偷偷换成其他能力"}。
- features 必须恰好 1 项（none 时为空数组）；key 为小写字母开头的字母数字下划线；templateId/templateVersion 必须来自输入的模板目录；**不要输出 params 或 resources 字段**。
- evidence.source 只能是输入给出的来源路径；quote 必须是该来源的精确子串；缺描述时只有标题明确支持的用途可用 building.title 作依据。
- priceTier 只能用模板允许的价档（free/basic/standard/premium），不是自由金额；签运、展示固定 free。
- presentation 的 opening/success/empty 均必填；占位符只允许 {targetName} {optionLabel} {itemName}。
- supportLevel=partial 时，未支持部分放 unsupported，不自动生成替代功能。`;
}

/** 第一段用户输入：高缓存分层——静态模板目录在前（跨建筑共享前缀），建筑资料居中，旧 key 最后 */
export function selectUserPrompt({ source, catalog, oldKeys }) {
  const catalogText = catalog.map(template =>
    `- ${template.id} (version ${template.version})：${template.semanticDescription}\n` +
    `  目标类型: ${template.supportedTargetKinds.join('/') || '无（建筑自身）'}\n` +
    `  允许价档: ${template.costPolicy.allowedTiers.join('/')}，默认 ${template.costPolicy.defaultTier}`).join('\n');
  return [
    '【可用模板目录（只允许选择以下 ready 模板）】',
    catalogText,
    `价档金额: ${JSON.stringify(PRICE_TIERS)}`,
    '',
    '【建筑资料】',
    `标题（building.title）: ${source.title}`,
    `建筑类型（businessKind，弱提示）: ${source.businessKind}`,
    source.description
      ? `完整用途描述（building.description）: ${source.description}`
      : '完整用途描述: （缺失——结合标题与建筑类型也必须选出 1 个模板，用 building.title 作依据）',
    `世界观: ${source.mapName}（版本 ${source.worldVersion}）`,
    source.ambient ? `环境氛围（location.ambient，仅弱提示）: ${source.ambient}` : '',
    oldKeys.length ? `旧配置功能 key（修改时优先沿用）: ${oldKeys.join('/')}` : '',
    '',
    '请输出模板选择 JSON（严格按系统提示词的完整格式，不要任何其他文字）。',
  ].filter(Boolean).join('\n');
}

/** 第一段轻校验：选择层面的语法/证据/权限，参数留白由第二段补齐 */
function validateSelection(source, generated) {
  const diagnostics = [];
  if (!generated || typeof generated !== 'object') throw townError('GENERATION_INVALID');
  if (generated.schemaVersion !== 1) diagnostics.push('schemaVersion 必须为 1');
  if (!['supported', 'partial', 'none'].includes(generated.supportLevel)) diagnostics.push('supportLevel 非法');
  const interpretation = String(generated.interpretation || '');
  if (interpretation.length < 20 || interpretation.length > 80) diagnostics.push('interpretation 长度须在 20—80 之间');

  const unsupported = Array.isArray(generated.unsupported) ? generated.unsupported : [];
  if (unsupported.length > 6) diagnostics.push('unsupported 最多 6 项');
  for (const item of unsupported) {
    if (!item || typeof item !== 'object') { diagnostics.push('unsupported[] 必须是对象'); continue; }
    for (const field of ['sourceText', 'reason']) {
      const value = item[field];
      if (typeof value !== 'string' || value.length < (field === 'reason' ? 10 : 1) || value.length > 160) {
        diagnostics.push(`unsupported[].${field} 长度非法`);
      }
    }
  }

  const features = Array.isArray(generated.features) ? generated.features : [];
  // 每栋建筑必须选出恰好 1 个模板（用户口径，none 不允许）
  if (generated.supportLevel === 'none') {
    diagnostics.push('每栋建筑必须选择一个模板：不允许返回 none');
  } else if (features.length !== 1) {
    diagnostics.push('每栋建筑只能选择一个模板：features 必须恰好 1 项');
  }
  const seen = new Set();
  features.forEach((feature, index) => {
    const label = `features[${index}]`;
    try {
      if (!feature || typeof feature !== 'object') throw new Error('必须是对象');
      const template = getTemplate(feature.templateId);
      if (!template || template.status !== 'ready') throw new Error(`模板 ${feature.templateId} 不在 ready 目录`);
      if (typeof feature.key !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(feature.key)) throw new Error('key 格式非法');
      if (seen.has(feature.key)) throw new Error('key 重复');
      if (feature.templateVersion !== template.version) throw new Error('templateVersion 与目录不一致');
      if (typeof feature.title !== 'string' || feature.title.length < 2 || feature.title.length > 16) throw new Error('title 长度非法');
      if (typeof feature.description !== 'string' || feature.description.length < 20 || feature.description.length > 80) throw new Error('description 长度非法');
      const evidence = feature.evidence;
      if (!evidence || typeof evidence !== 'object') throw new Error('缺少 evidence');
      const allowedSources = source.description ? ['building.description', 'building.title', 'location.ambient'] : ['building.title'];
      if (!allowedSources.includes(evidence.source)) throw new Error(`evidence.source 只允许 ${allowedSources.join('/')}`);
      const quote = String(evidence.quote || '');
      if (quote.length < 1 || quote.length > 160) throw new Error('evidence.quote 长度非法');
      const evidenceText = evidence.source === 'building.description' ? source.description
        : evidence.source === 'building.title' ? source.title : source.ambient;
      if (!evidenceText || !evidenceText.includes(quote)) throw new Error('evidence.quote 不是原文精确子串');
      const priceTier = feature.priceTier ?? template.costPolicy.defaultTier;
      if (!template.costPolicy.allowedTiers.includes(priceTier)) throw new Error(`priceTier ${priceTier} 不被模板允许`);
      const presentation = feature.presentation;
      if (!presentation || typeof presentation !== 'object') throw new Error('缺少 presentation');
      for (const [field, min, max] of [['opening', 20, 80], ['success', 10, 60], ['empty', 5, 40]]) {
        const value = presentation[field];
        if (typeof value !== 'string' || value.length < min || value.length > max) throw new Error(`presentation.${field} 长度非法`);
      }
      seen.add(feature.key);
    } catch (err) {
      if (err?.code === 'TEMPLATE_UNAVAILABLE') throw err;
      diagnostics.push(`${label}：${err.message}`);
    }
  });

  if (generated.supportLevel === 'partial' && !unsupported.length) diagnostics.push('partial 必须列出未支持的用途');
  if (diagnostics.length) {
    throw Object.assign(new Error(diagnostics.join('；')), { code: 'GENERATION_INVALID', diagnostics });
  }
  return generated;
}

// ── 第二段：逐模板生成参数 ──

/** 第二段系统提示词：只生成一个已选模板的 params（及需要的 resources）（任务层；system0/system1 由 layeredMessages 组装） */
function paramsSystemPrompt() {
  return `你在为一座小镇建筑的某个已确定功能生成可执行的参数配置。只生成输入指定模板的 params（及该模板明确需要的 resources），不重新选择模板、不增删功能、不决定账户余额、实际库存或随机开奖结果。严格按输入给出的完整 JSON 示例与字段约束输出；不要解释、Markdown 代码围栏或 JSON 以外的文字。

输出格式（唯一形状，params 结构按输入的模板示例）：
{
  "params": { 按输入示例填 },
  "resources": [ 按输入约束填，不需要时为空数组 ]
}

resources 通用格式（仅当输入要求定义资源时输出）：
{"key": "小写字母开头的字母数字下划线", "name": "商品名，2至16字", "description": "商品说明，20至100字，只描述支持的用途", "itemKind": "collectible/outfit/hairstyle/accessory/transform/state 之一", "effectProfileKey": "仅 itemKind=state 时填输入目录中的状态档案键，其他必须为 null", "appearance": "仅外观类填 40—120 字第三人称外观说明，collectible/state 必须为 null", "imagePrompt": "可 null；非 null 时为英文物品插画提示词，40至100词，单行，只描述物品，禁止代码或网址"}
不输出初始库存、拥有者、数据库 ID 或金币余额。`;
}

/** 第二段用户输入：高缓存分层——模板示例/硬约束与资源目录（静态，跨建筑共享前缀）在前，
 * 建筑资料与已选功能居中，旧参数与诊断（最易变）最后。导出供缓存前缀稳定性测试使用。 */
export function paramsUserPrompt({ source, template, feature, itemCatalog, oldParams, diagnostics }) {
  return [
    `【${template.id} 的 params 完整示例】`,
    JSON.stringify(template.paramsExample),
    `【本模板参数硬约束】${template.paramHints || '严格遵循示例结构与字段长度。'}`,
    // temporary_state 模板暂时弃用（不再进 ready 目录），只剩签运可选带状态档案
    template.id === 'daily_fortune'
      ? `可用状态档案键: ${source.catalogs.stateProfiles.map(p => p.key).join('/') || '（无）'}` : '',
    ['item_exchange', 'item_recycle'].includes(template.id)
      ? `可引用商品目录键（acceptCatalogKey 只允许这些）: ${itemCatalog.join('/') || '（无）'}` : '',
    '',
    '【建筑资料】',
    `标题: ${source.title}`,
    source.description ? `完整用途描述: ${source.description}` : '完整用途描述: （缺失，按标题理解）',
    '',
    '【已确定的功能（不可更改）】',
    `key: ${feature.key}`,
    `模板: ${template.id} (version ${template.version})——${template.semanticDescription}`,
    `标题: ${feature.title}`,
    `说明: ${feature.description}`,
    oldParams ? `旧配置的 params（修改时优先沿用其中的选项 key 与结构）: ${JSON.stringify(oldParams).slice(0, 800)}` : '',
    diagnostics?.length
      ? `【上一轮校验诊断——本次输出必须修正这些问题】\n${diagnostics.map(d => `- ${d}`).join('\n')}`
      : '',
    '',
    '请输出该功能的 params JSON（严格按系统提示词格式，不要任何其他文字）。',
  ].filter(Boolean).join('\n');
}

/** 修复调用输入：原输出 + 诊断，要求整卡重出 */
function repairPrompt(originalOutput, diagnostics) {
  return [
    '上一次输出未通过校验，诊断如下：',
    ...diagnostics.map(d => `- ${d}`),
    '',
    '上一次输出：',
    originalOutput,
    '',
    '请修正全部问题后重新输出完整的 JSON。仍然遵守系统提示词的全部约束；不要解释或输出 JSON 以外的文字。',
  ].join('\n');
}

function parseJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function parseCandidate(raw) {
  const text = typeof raw === 'string' ? repairJson(raw) : JSON.stringify(raw);
  const extracted = extractFirstJson(text);
  if (!extracted) throw Object.assign(new Error('输出不是可解析的 JSON'), { code: 'GENERATION_INVALID' });
  try {
    return JSON.parse(extracted);
  } catch (err) {
    throw Object.assign(new Error(`输出 JSON 无法解析：${err.message}`), { code: 'GENERATION_INVALID' });
  }
}

/** 第二段单次调用（含最多一次修复），返回 {params, resources} */
async function generateFeatureParams({ chat, source, template, feature, itemCatalog, oldParams, featureKeyLabel, diagnostics }) {
  const label = `${GENERATE_LABEL}·${template.id}`;
  const messages = layeredMessages(paramsSystemPrompt(),
    paramsUserPrompt({ source, template, feature, itemCatalog, oldParams, diagnostics }));
  let raw = await chat(messages, { label, temperature: 0.6, max_tokens: 2200 });
  let candidate = parseCandidate(raw);
  const shapeOk = candidate && typeof candidate === 'object'
    && candidate.params && typeof candidate.params === 'object'
    && (!candidate.resources || Array.isArray(candidate.resources));
  if (!shapeOk) {
    const originalText = typeof raw === 'string' ? raw : JSON.stringify(raw);
    raw = await chat([...messages,
      { role: 'assistant', content: originalText },
      { role: 'user', content: repairPrompt(originalText,
        ['输出必须是 {"params": {...}, "resources": [...]} 形状']) },
    ], { label: `${label}修复`, temperature: 0.3, max_tokens: 2200 });
    candidate = parseCandidate(raw);
    if (!candidate?.params || typeof candidate.params !== 'object') {
      throw Object.assign(new Error(`${featureKeyLabel}：参数输出形状非法`), { code: 'GENERATION_INVALID' });
    }
    candidate.resources = Array.isArray(candidate.resources) ? candidate.resources : [];
  }
  return candidate;
}

/**
 * 幂等开始一次两段式配置生成。重复调用在 generating 状态直接返回现有 token；
 * 手工维护的配置必须显式 force 才会重生成（计划 §7.2/§11.2）。
 * @returns {{status, token, revision, features, interpretation, unsupported}}
 */
export async function generateBuildingFeatureConfig(context, { mapId, locationKey, chatSync: injectedChat, force } = {}) {
  const { db, registry, scope } = context;
  let source = resolveBuildingFeatureSource(context, { mapId, locationKey });
  // 缺用途描述不拦生成：置空时直接用建筑名回填 feature_desc（用户口径 2026-10-05）。
  // 回填发生在 ensureProfile 之前，生成记录的 sourceHash 与回填后的来源一致，不会立刻变 stale。
  if (!source.description && source.title) {
    setBuildingFeatureDescription(db, { mapId, locationKey, description: source.title });
    source = resolveBuildingFeatureSource(context, { mapId, locationKey });
  }
  const profile = ensureProfile(db, source);
  if (profile.manual && !force && ['ready', 'partial'].includes(profile.status)) {
    throw townError('FEATURE_MANUAL_LOCKED');
  }
  if (profile.status === 'generating' && profile.generated_at == null) {
    // 上一轮任务仍在进行：幂等返回同一 token（重复轮询不新建任务）；
    // 卡死超过 20 分钟视为中断，允许接管（与 town_interaction_offers 同口径）
    const staleAt = Date.parse(String(profile.updated_at || '').replace(' ', 'T') + 'Z');
    if (Number.isFinite(staleAt) && Date.now() - staleAt < 20 * 60000) {
      return { status: 'generating', token: profile.generation_token, revision: profile.revision };
    }
  }
  // 失败回滚基准：新候选未通过校验前，不得覆盖已保存的有效配置（计划 §7.2）
  const previous = { status: profile.status, sourceJson: profile.source_json, sourceHash: profile.source_hash };
  const token = randomUUID();
  db.prepare(
    `UPDATE town_building_feature_profiles SET status = 'generating', generation_token = ?, source_json = ?,
     source_hash = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(token, JSON.stringify(source), source.sourceHash, profile.id);

  const oldConfig = compiledConfig(profile);
  const oldKeys = (oldConfig?.features || []).map(f => f.key);
  const oldParamsByKey = Object.fromEntries((oldConfig?.features || []).map(f => [f.key, f.params]));
  const itemCatalog = db.prepare('SELECT template_id FROM item_templates WHERE world_id = ?')
    .all(source.worldId).map(row => `catalog_${row.template_id}`);
  const chat = injectedChat || chatSync;
  let llmCalls = 0;

  try {
    // ── 第一段：选模板（最多一次修复） ──
    const selectMessages = layeredMessages(selectSystemPrompt(),
      selectUserPrompt({ source, catalog: templateCatalogForPrompt(), oldKeys }));
    let selectRaw = await chat(selectMessages, { label: `${GENERATE_LABEL}·选择`, temperature: 0.6, max_tokens: 2200 });
    llmCalls += 1;
    let selection;
    try {
      selection = validateSelection(source, parseCandidate(selectRaw));
    } catch (err) {
      if (err?.code !== 'GENERATION_INVALID') throw err;
      const originalText = typeof selectRaw === 'string' ? selectRaw : JSON.stringify(selectRaw);
      selectRaw = await chat([...selectMessages,
        { role: 'assistant', content: originalText },
        { role: 'user', content: repairPrompt(originalText, err.diagnostics || [err.message]) },
      ], { label: `${GENERATE_LABEL}·选择修复`, temperature: 0.3, max_tokens: 2200 });
      llmCalls += 1;
      selection = validateSelection(source, parseCandidate(selectRaw));
    }

    // ── 第二段：逐模板生成参数（none 时 0 次调用；每个模板最多一次修复） ──
    const selectedFeatures = Array.isArray(selection.features) ? selection.features : [];
    const resourcesByKey = new Map();
    const paramsByKey = {};
    for (const feature of selectedFeatures) {
      const template = getTemplate(feature.templateId);
      const { params, resources } = await generateFeatureParams({
        chat, source, template, feature, itemCatalog,
        oldParams: oldParamsByKey[feature.key] || null,
        featureKeyLabel: `features[${feature.key}]`,
      });
      llmCalls += 1;
      paramsByKey[feature.key] = params;
      for (const resource of resources || []) {
        if (resource?.key && !resourcesByKey.has(resource.key)) resourcesByKey.set(resource.key, resource);
      }
    }

    // ── 拼回原有 generated 形状，走全量权威校验（复用现有编译器） ──
    // 合并资源超过全局上限（8）时：先丢弃没有任何功能引用的资源，引用中的保留
    const referencedKeys = new Set();
    for (const feature of selectedFeatures) {
      const params = paramsByKey[feature.key] || {};
      (params.offers || params.pool || []).forEach(o => referencedKeys.add(o.resourceKey || o.giveResourceKey));
    }
    const mergedResources = [...resourcesByKey.values()];
    if (mergedResources.length > 8) {
      const kept = mergedResources.filter(r => referencedKeys.has(r.key));
      const rest = mergedResources.filter(r => !referencedKeys.has(r.key));
      resourcesByKey.clear();
      for (const r of [...kept, ...rest].slice(0, 8)) resourcesByKey.set(r.key, r);
    }
    const generated = {
      schemaVersion: 1,
      supportLevel: selection.supportLevel,
      interpretation: selection.interpretation,
      unsupported: selection.unsupported || [],
      resources: [...resourcesByKey.values()],
      features: selectedFeatures.map(feature => ({ ...feature, params: paramsByKey[feature.key] || {} })),
    };
    let compiled;
    let merged = generated;
    try {
      ({ compiled, generated: merged } = compileGeneration(db, source, generated));
    } catch (err) {
      if (err?.code !== 'GENERATION_INVALID') throw err;
      // 组装级修复（最多一次）：把诊断按 feature key 归还，重新生成出问题的参数
      const diagnostics = err.diagnostics || [err.message];
      const offendingKeys = new Set();
      for (const d of diagnostics) {
        const byKey = /features\[([a-z][a-z0-9_]*)\]/.exec(String(d))?.[1];
        if (byKey) { offendingKeys.add(byKey); continue; }
        // 诊断按下标引用时映射回 feature key（features[2] → 第三个功能）
        const byIndex = /features\[(\d+)\]/.exec(String(d))?.[1];
        if (byIndex != null && selectedFeatures[Number(byIndex)]) offendingKeys.add(selectedFeatures[Number(byIndex)].key);
      }
      const targets = offendingKeys.size
        ? selectedFeatures.filter(f => offendingKeys.has(f.key))
        : selectedFeatures;
      for (const feature of targets) {
        const template = getTemplate(feature.templateId);
        const { params, resources } = await generateFeatureParams({
          chat, source, template, feature, itemCatalog,
          oldParams: oldParamsByKey[feature.key] || null,
          featureKeyLabel: `features[${feature.key}]`,
          diagnostics,
        });
        llmCalls += 1;
        paramsByKey[feature.key] = params;
        for (const resource of resources || []) {
          if (resource?.key && !resourcesByKey.has(resource.key)) resourcesByKey.set(resource.key, resource);
        }
      }
      ({ compiled, generated: merged } = compileGeneration(db, source, {
        ...generated,
        resources: [...resourcesByKey.values()],
        features: selectedFeatures.map(feature => ({ ...feature, params: paramsByKey[feature.key] || {} })),
      }));
    }

    // 提交前再次检查世界代次与建筑实例，旧任务不得写回重置后的世界（计划 §3.3）
    const world = registry.getWorldState();
    if (world.worldId !== scope.worldId || world.epoch !== scope.worldEpoch) throw townError('STALE_EPOCH');
    const fresh = resolveBuildingFeatureSource(context, { mapId, locationKey });
    if (fresh.sourceHash !== source.sourceHash) throw townError('SOURCE_CHANGED');
    const finalRevision = commitCandidate(db, profile.id, source, merged, compiled, llmCalls);
    // 交易类功能激活时做一次性开业配置（幂等，受预算约束）
    const tradeFeatures = compiled.features.filter(f => ['operator', 'operator_stock'].includes(getTemplate(f.templateId)?.resourceRequirements));
    if (tradeFeatures.length) {
      const resourceKeys = new Set();
      for (const feature of tradeFeatures) {
        (feature.params.offers || feature.params.pool || []).forEach(o => resourceKeys.add(o.resourceKey || o.giveResourceKey));
      }
      ensureOpeningResources({ db, economy: context.economy, scope: { ...scope, idempotencyKey: token },
        buildingInstanceId: source.buildingInstanceId, resourceKeys: [...resourceKeys] });
    }
    return { status: compiled.supportLevel === 'none' ? 'unsupported'
      : compiled.features.length ? (compiled.supportLevel === 'partial' ? 'partial' : 'ready') : 'unsupported',
      token, revision: finalRevision, features: compiled.features.length,
      interpretation: compiled.interpretation, unsupported: compiled.unsupported.length };
  } catch (err) {
    // 失败恢复：原先已有有效配置（ready/partial）则还原其状态与来源快照（来源漂移时
    // 由 effectiveStatus 判为 stale，旧配置保留但不可执行）；否则保持 failed（计划 §7.2）
    const restored = ['ready', 'partial'].includes(previous.status) ? previous.status : 'failed';
    const failed = db.prepare(
      `UPDATE town_building_feature_profiles SET status = ?, source_json = ?, source_hash = ?,
       generation_token = NULL, retry_count = retry_count + 1, last_error = ?, llm_calls = llm_calls + ?,
       updated_at = CURRENT_TIMESTAMP WHERE id = ? AND generation_token = ?`)
      .run(restored, previous.sourceJson, previous.sourceHash,
        String(err?.message || err).slice(0, 500), llmCalls, profile.id, token);
    if (!failed.changes) throw err; // 已被更新任务接管
    throw err;
  }
}
/** 收集功能目录引用到的资源键（购买用 resourceKey、交换用 giveResourceKey、奖池用 pool[].resourceKey） */
export function referencedResourceKeys(features) {
  const keys = new Set();
  for (const feature of features || []) {
    const entries = [...(feature?.params?.offers || []), ...(feature?.params?.pool || [])];
    for (const entry of entries) {
      if (entry?.resourceKey) keys.add(entry.resourceKey);
      if (entry?.giveResourceKey) keys.add(entry.giveResourceKey);
    }
  }
  return keys;
}

/** 把某个资源在货架上的可售量补到开业档位（刷新只补不削，玩家买到的不会回收） */
function topUpShelfStock({ economy, scope, buildingInstanceId, resourceKey, token }) {
  const stock = economy.ensureStock({ ...scope,
    ownerKey: buildingStockOwnerKey(buildingInstanceId, resourceKey),
    resourceKey: `bfr:${buildingInstanceId}:${resourceKey}` });
  const available = economy.getStock({ ...scope, stockId: stock.stockId }).available;
  const delta = OPENING_STOCK_UNITS - available;
  if (delta <= 0) return 0;
  economy.seedStock({ ...scope, stockId: stock.stockId, amount: delta,
    idempotencyKey: `bf-refresh:${token}:${resourceKey}`,
    sourceKey: `bf-refresh-stock:${token}:${resourceKey}`, reasonCode: 'BF_REFRESH_STOCK' });
  return delta;
}

/**
 * 刷新店铺货架（用户口径 2026-10-05）：重抽「外观四件套 + 交易三件套」的参数，
 * 也就是重新生成店里有的外观与商品，并把货架补满；其余功能（写真/签运/抽奖）原样保留。
 * 收费 10 金币，固定价、不限次数。生成成功才会扣款并提交，失败保持原配置。
 */
export async function refreshBuildingFeatureStock(context, { mapId, locationKey, chatSync: injectedChat } = {}) {
  const { db, registry, scope, economy, player } = context;
  const source = resolveBuildingFeatureSource(context, { mapId, locationKey });
  const profile = ensureProfile(db, source);
  const status = effectiveStatus(source, profile);
  if (!['ready', 'partial'].includes(status)) throw townError('FEATURE_UNCONFIGURED');
  const previousGenerated = parseJson(profile.generated_json, null);
  const previousFeatures = Array.isArray(previousGenerated?.features) ? previousGenerated.features : [];
  if (!previousFeatures.length) throw townError('FEATURE_UNCONFIGURED');
  const shopFeatures = previousFeatures.filter(f => SHOP_TEMPLATE_IDS.includes(f.templateId));
  if (!shopFeatures.length) throw townError('TEMPLATE_UNAVAILABLE');

  const chat = injectedChat || chatSync;
  const itemCatalog = db.prepare('SELECT template_id FROM item_templates WHERE world_id = ?')
    .all(source.worldId).map(row => `catalog_${row.template_id}`);
  const token = randomUUID();
  const paramsByKey = Object.fromEntries(previousFeatures.map(f => [f.key, f.params]));
  const resourcesByKey = new Map((previousGenerated.resources || []).map(r => [r.key, r]));
  let llmCalls = 0;

  for (const feature of shopFeatures) {
    const template = getTemplate(feature.templateId);
    const { params, resources } = await generateFeatureParams({
      chat, source, template, feature, itemCatalog,
      oldParams: feature.params || null,
      featureKeyLabel: `features[${feature.key}]`,
    });
    llmCalls += 1;
    paramsByKey[feature.key] = params;
    for (const resource of resources || []) {
      if (resource?.key) resourcesByKey.set(resource.key, resource);
    }
  }

  // 只保留仍被引用的资源：换掉的旧商品从目录里摘走（玩家已经买到手的物品不受影响）
  const nextFeatures = previousFeatures.map(f => ({ ...f, params: paramsByKey[f.key] || {} }));
  const referenced = referencedResourceKeys(nextFeatures);
  const nextResources = [...resourcesByKey.values()].filter(r => referenced.has(r.key));

  const { compiled, generated: merged } = compileGeneration(db, source, {
    ...previousGenerated,
    resources: nextResources,
    features: nextFeatures,
  });

  // 收费：玩家  建筑自己的 business 账户（与其他收费功能同口径）
  const playerAccount = economy.ensureAccount({ ...scope, ownerKey: `actor:${player.actorId}`,
    accountType: 'actor', actorId: player.actorId });
  const buildingAccount = economy.ensureAccount({ ...scope,
    ownerKey: `building:${source.buildingInstanceId}`, accountType: 'business' });
  economy.transfer({ ...scope, fromAccountId: playerAccount.accountId, toAccountId: buildingAccount.accountId,
    amount: SHOP_REFRESH_PRICE, idempotencyKey: `bf-refresh:${token}:pay`,
    sourceKey: `bf-refresh-pay:${token}`, reasonCode: 'BF_SHOP_REFRESH' });

  const world = registry.getWorldState();
  if (world.worldId !== scope.worldId || world.epoch !== scope.worldEpoch) throw townError('STALE_EPOCH');
  const fresh = resolveBuildingFeatureSource(context, { mapId, locationKey });
  if (fresh.sourceHash !== source.sourceHash) throw townError('SOURCE_CHANGED');
  const revision = commitCandidate(db, profile.id, source, merged, compiled, llmCalls);

  // 补满货架：新出现的商品按开业档位铺货，沿用旧键的商品把缺口补回去
  const tradeKeys = new Set();
  for (const feature of nextFeatures) {
    const capability = compiled.features.find(f => f.key === feature.key);
    if (getTemplate(capability?.templateId)?.resourceRequirements !== 'operator_stock') continue;
    for (const key of referencedResourceKeys([feature])) tradeKeys.add(key);
  }
  let restocked = 0;
  for (const resourceKey of tradeKeys) {
    restocked += topUpShelfStock({ economy, scope, buildingInstanceId: source.buildingInstanceId, resourceKey, token });
  }
  return { status: compiled.supportLevel === 'partial' ? 'partial' : 'ready',
    revision, price: SHOP_REFRESH_PRICE, refreshed: shopFeatures.length, restocked, llmCalls };
}

/** 原子切换 revision：校验失败的候选不会走到这里（计划 §7.2） */
function commitCandidate(db, profileId, source, generated, compiled, llmCalls) {
  const current = db.prepare('SELECT revision, compiled_json, feature_ids_json FROM town_building_feature_profiles WHERE id = ?')
    .get(profileId);
  const revision = (current?.revision || 0) + 1;
  // 稳定功能 ID：旧配置中已存在的 key 沿用其 ID——重生成配置不创造新领取次数、
  // 不改变签运/奖池的当日种子作用域（计划 §7.2、§4.5）
  const previousIds = parseJson(current?.feature_ids_json, {}) || {};
  for (const feature of compiled.features) {
    if (previousIds[feature.key]) feature.featureId = previousIds[feature.key];
  }
  compiled.revision = revision;
  const featureIds = Object.fromEntries(compiled.features.map(f => [f.key, f.featureId]));
  const resourceBindings = Object.fromEntries(compiled.resources.map(r => [r.key,
    { itemKind: r.itemKind, name: r.name, templateId: `bfr:${source.buildingInstanceId}:${r.key}` }]));
  const status = compiled.supportLevel === 'none' || !compiled.features.length ? 'unsupported'
    : compiled.supportLevel === 'partial' ? 'partial' : 'ready';
  db.transaction(() => {
    db.prepare(
      `UPDATE town_building_feature_profiles SET status = ?, generated_json = ?, compiled_json = ?,
       revision = ?, feature_ids_json = ?, resource_bindings_json = ?, generation_token = NULL,
       last_error = NULL, llm_calls = llm_calls + ?, generated_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(status, JSON.stringify(generated), JSON.stringify(compiled), revision,
        JSON.stringify(featureIds), JSON.stringify(resourceBindings), llmCalls, profileId);
  }).immediate();
  return revision;
}
