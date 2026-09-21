/**
 * 小镇 NPC 服务 / 打工 —— 图片叙事运行时
 *
 * 与日程「瞄一眼」同构的链路：
 *   start() 立即返回 { generating: true } -> 异步 LLM 产出 JSON（趣事 / 英文画面 prompt / 两个后续选项）
 *   -> 生图 -> 落盘 -> 金币结算 -> SSE 广播就绪。
 *
 * 金币口径：
 *   service（NPC 为玩家服务）：玩家 -> NPC，玩家金币减少
 *   work   （玩家给 NPC 打工）：NPC -> 玩家，玩家金币增加
 *   激进分支（bold）金额 = 基准价 × [1.5, 3]，由确定性 hash 取值。
 */

import { createHash } from 'node:crypto';

import { getDb, getSystemRules, getWorldSetting } from '../../db/index.js';
import { getWorldIntegrationRule } from '../../builtinRules.js';
import { config } from '../../config.js';
import { chatSync } from '../../llm/llm-client.js';
import { extractFirstJson, repairJson } from '../eventGenerator.js';
import { generateImageRaw } from '../imageSkill.js';
import { saveBase64Image } from '../imagePaths.js';
import { recordCompletedImageTask } from '../imageTaskRecorder.js';
import { broadcast } from '../unifiedStreamBus.js';
import { broadcastTownStateUpdated } from './townBus.js';
import { townError } from './townEventService.js';
import { createTownActorRegistry } from './townActorRegistry.js';
import { createEconomyService } from './economyService.js';
import { clampOfferPrice, normalizeOfferKind } from './townNpcOfferService.js';
import { percentFromProgress } from './progressPercent.js';


export const TOWN_NPC_SERVICE_PROGRESS_EVENT = 'town_npc_service_progress';
export const TOWN_NPC_SERVICE_READY_EVENT = 'town_npc_service_ready';
export const SERVICE_SESSION_STATUSES = Object.freeze(['generating', 'ready', 'failed']);

const BOLD_MIN_FACTOR = 1.5;
const BOLD_MAX_FACTOR = 3;
const SERVICE_SCENE = 'town_service'; // 图片存储分类（落盘目录）
// 全局 LoRA 的场景：小镇的打工/服务出图统一跟随「日程」勾选框，
// 同时用 workflowScene 保持原本的工作流选择不变。
const SERVICE_LORA_SCENE = 'schedule';

function hashSeed(value) {
  return parseInt(createHash('sha256').update(String(value)).digest('hex').slice(0, 8), 16);
}

export function boldFactor(seedKey) {
  const span = Math.round((BOLD_MAX_FACTOR - BOLD_MIN_FACTOR) * 1000);
  return BOLD_MIN_FACTOR + (hashSeed(seedKey) % (span + 1)) / 1000;
}

/** 本轮结算金额：稳妥分支就是基准价；激进分支按确定性 hash 取 1.5~3 倍，开单前即可算准。 */
export function turnAmount({ kind, basePrice, sessionId, turns, tone }) {
  const base = clampOfferPrice(kind, basePrice ?? null);
  if (tone !== 'bold') return base;
  return Math.max(1, Math.round(base * boldFactor(`${sessionId}:${turns}`)));
}

function system0() {
  return [getSystemRules({ roleplay: false }), getWorldSetting()].filter(Boolean).join('\n\n');
}

function system0And1() {
  let integration = '';
  try {
    integration = getWorldIntegrationRule('schedule') || '';
  } catch {
    integration = '';
  }
  return [system0(), integration].filter(Boolean);
}

function stripFence(content) {
  const text = String(content || '').trim();
  const match = text.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/);
  return match ? match[1].trim() : text;
}

function npcPersonaBlock(npc) {
  const lines = [`【角色】${npc.display_name || 'NPC'}`];
  if (npc.job) lines.push(`【职业】${npc.job}`);
  if (npc.brief) lines.push(`【一句话简介】${npc.brief}`);
  if (npc.appearance_desc) lines.push(`【外观】${npc.appearance_desc}`);
  if (npc.persona) lines.push(`【人格卡】\n${npc.persona}`);
  return lines.join('\n');
}

function townPlayerInfo() {
  let playerName = config.user?.nickname || '用户';
  let playerAppearance = config.user?.appearance || '';
  return { playerName, playerAppearance };
}

function twoPersonNote(npc, playerName, playerAppearance) {
  return [
    `画面中必须同时出现两个人，缺一不可：`,
    `1) NPC「${npc.display_name || 'NPC'}」：${npc.appearance_desc || '按人格卡与职业描述其外貌与着装'}；`,
    `2) 用户「${playerName}」：${playerAppearance || '按世界观里的普通居民形象描述其外貌与着装'}。`,
    `两人都要清晰可见且有互动动作（对话、递东西、并肩干活等），不要只画一个人，不要出现第三个人。`,
  ].join('\n');
}

// 风格示例：只用于让模型学习 tale 的语气、节奏与收尾方式，与世界观、NPC 人设无关。
const TALE_STYLE_EXAMPLE = '老周擦柜台擦到一半，抹布没攥住，甩出去正好糊在刚进门那位的新皮鞋上。两人对着那只鞋看了三秒，谁也没先说话。老周把抹布捡起来，说：「这鞋……本来也得擦。」对方真把脚抬起来让他擦完，付钱走人时鞋面上留着一道没抹开的灰印。老周低头接着擦柜台，像什么都没发生。';
const OUTPUT_STRUCTURE = [
  '【输出结构】',
  '你必须严格输出一个 JSON 对象，不要输出任何解释、前后缀或 JSON 以外的文字。格式如下：',
  '{',
  '  "tale": "本次服务/打工过程中发生的趣事，120~220 字。要有具体动作、一个物理层面的意外、一句不像在交代信息的对话，结尾留下一个没人处理的痕迹。",',
  '  "prompt": "English image prompt, describing the scene where BOTH the NPC and the user appear together. Include: character appearances, clothing, action, facial expression, location, time of day, lighting, camera angle, and art style. Output English only, 60-140 words, no line breaks.",',
  '  "options": [',
  '    { "label": "稳妥的下一步（12 字以内，口吻自然，如「干得不错，继续」）", "tone": "normal" },',
  '    { "label": "更跳脱、更意外的下一步（12 字以内，如「杂草太多了，索性奋力大干一场」）", "tone": "bold" }',
  '  ]',
  '}',
  '【字段约束】',
  '- tale：中文，120~220 字，必须同时满足下面五条：',
  '  1) 意外来自物理层面：手滑、打喷嚏、没攥住、风吹、脚下打滑、瓶盖崩开……让某样东西沾到/洒到/掉到不该在的地方。禁止把意外写成态度问题（粗心、不认真、被夸奖）。',
  '  2) 意外要留下可见痕迹：一根头发、一圈水渍、一道没抹开的灰印、歪掉的标签，且这个痕迹到结尾仍然存在。',
  '  3) 只写 1~2 句对话，且必须答非所问、嘴硬、自言自语或吐槽，不能用来交代信息；不要写「笑着说」「解释道」「随即回答」这类标签。',
  '  4) 结尾不总结、不写双方反应、不升华，停在一个没人处理的细节上。',
  '  5) 长短句混着来：可以有四字短句，也可以一句话里塞三个动作；禁止相邻两句字数接近。',
  '  禁用词：倒不恼、愣了愣、随即、顿时、气氛、认真、夸奖、似乎、仿佛、不禁、不由得。',
  '- prompt：英文，60~140 词，单行，必须同时描述 NPC 与用户两个人以及他们的互动，禁止出现中文。',
  '- options：必须是长度为 2 的数组，第一条 tone 固定为 "normal"（平稳继续），第二条 tone 固定为 "bold"（更激进、更意外、更有可能出状况的继续）。',
  '- label：中文，12 字以内，直接可点击，不要带标点前缀。',
].join('\n');

export function buildMessages({ npc, offer, kind, priorTale, priorChoice, turns }) {
  const { playerName, playerAppearance } = townPlayerInfo();
  const kindLabel = kind === 'work' ? '打工' : '服务';
  const roleLine = kind === 'work'
    ? `本次是「打工」：${playerName} 给 NPC「${npc.display_name}」干活，NPC 付给 ${playerName} 报酬。`
    : `本次是「服务」：NPC「${npc.display_name}」为 ${playerName} 提供服务，${playerName} 向 NPC 付费。`;

  const contextLines = [
    `【本次任务目标】`,
    roleLine,
    `项目标题：${offer.title}`,
    offer.description ? `项目详情：${offer.description}` : '',
    `基准金额：${offer.price} 金币`,
    twoPersonNote(npc, playerName, playerAppearance),
    '',
    '【创作要求】',
    `1. 写一段这次${kindLabel}过程中真实发生的趣事，要有画面感、有意外或反差。tale 必须满足【字段约束】里列出的五条写法。`,
    '2. 画面 prompt 用英文，必须让 NPC 与用户同框出现并产生互动，符合世界观里的环境与着装。',
    '3. 给出两个后续选项：normal 是平稳继续；bold 要更跳脱、更意外，可能引发小状况。',
    '',
    '【风格示例】（只学语气、节奏与收尾方式，禁止复用其中的人物、道具、事件与句子）',
    TALE_STYLE_EXAMPLE,
    '',
    '【输出前自检】tale 里有物理意外吗？痕迹留到结尾了吗？有相邻两句字数接近吗？出现禁用词了吗？结尾在总结或升华吗？',
    '4. 严格按【输出结构】的 JSON 格式输出，不要输出 JSON 以外的任何文字。',
  ].filter(Boolean);

  if (priorTale) {
    contextLines.push(
      '',
      '【前情提要】',
      `这是第 ${Number(turns) + 1} 轮，上一轮的经过是：${priorTale}`,
      priorChoice ? `玩家上一轮选择了：${priorChoice}` : '',
      '本次请承接上一轮的结果继续推进，保持人物状态与场景连续。',
    );
  }

  return [
    ...system0And1().map(content => ({ role: 'system', content })),
    { role: 'system', content: OUTPUT_STRUCTURE },
    { role: 'system', content: `${npcPersonaBlock(npc)}\n\n【用户】\n名字：${playerName}\n外貌：${playerAppearance || '（未填写）'}` },
    { role: 'user', content: contextLines.filter(Boolean).join('\n') },
  ];
}

export function parseServicePayload(text) {
  const raw = stripFence(text);
  let data = null;
  try {
    const jsonText = extractFirstJson(raw);
    if (jsonText) data = JSON.parse(jsonText);
  } catch {
    data = null;
  }
  if (!data) {
    try {
      const repaired = repairJson(raw);
      data = typeof repaired === 'string' ? JSON.parse(repaired) : repaired;
    } catch {
      data = null;
    }
  }
  if (!data || typeof data !== 'object') throw townError('SERVICE_JSON_MISSING');

  const tale = String(data.tale || '').trim();
  const prompt = String(data.prompt || data.imagePrompt || '').trim();
  if (!tale || !prompt) throw townError('SERVICE_PAYLOAD_INCOMPLETE');

  const rawOptions = Array.isArray(data.options) ? data.options : [];
  const options = [];
  const pick = tone => rawOptions.find(item => item && String(item.tone || '').toLowerCase() === tone);
  const normal = pick('normal') || rawOptions[0];
  const bold = pick('bold') || rawOptions[1];
  options.push({ label: String(normal?.label || '继续').trim().slice(0, 24), tone: 'normal' });
  options.push({ label: String(bold?.label || '放手一搏，把事情闹大一点').trim().slice(0, 24), tone: 'bold' });

  return { tale: tale.slice(0, 400), prompt, options };
}

function createEconomyRuntime(db) {
  const registry = createTownActorRegistry(db);
  const world = registry.getWorldState();
  const scope = { worldId: world.worldId, worldEpoch: world.epoch };
  const economy = createEconomyService({
    db,
    clock: { now: Date.now },
    getWorldEpoch: registry.getWorldEpoch,
    getActor: registry.getActor,
  });
  return { db, registry, world, scope, economy };
}

/** 开单前先确认玩家付得起。只有「服务」要玩家掏钱；「打工」是给玩家发钱，不看余额。 */
function assertAffordable(context, { kind, amount }) {
  if (kind !== 'service') return null;
  const { registry, scope, economy } = context;
  const me = registry.resolveAgentKey('me');
  if (!me?.actorId) throw townError('PLAYER_ACTOR_MISSING');
  const payer = economy.ensureAccount({ ...scope, ownerKey: `actor:${me.actorId}`, actorId: me.actorId, accountType: 'actor' });
  if ((payer?.available ?? 0) < amount) throw townError('INSUFFICIENT_FUNDS');
  return payer;
}

/** 只有玩家记账：服务是玩家把钱花掉（销毁），打工是玩家领到工钱（发行）。居民不持有钱包。 */
function settleCoins(context, { kind, amount, sessionId, turns }) {
  const { registry, scope, economy } = context;
  const me = registry.resolveAgentKey('me');
  if (!me?.actorId) throw townError('PLAYER_ACTOR_MISSING');
  const playerAccount = economy.ensureAccount({ ...scope, ownerKey: `actor:${me.actorId}`, actorId: me.actorId, accountType: 'actor' });

  const playerPays = kind === 'service';
  const receipt = (playerPays ? economy.burn : economy.mint)({
    ...scope,
    accountId: playerAccount.accountId,
    amount,
    idempotencyKey: `npc-service:${sessionId}:${turns}`,
    sourceKey: `town_npc_service:${sessionId}:${turns}`,
    reasonCode: playerPays ? 'TOWN_NPC_SERVICE_PAYMENT' : 'TOWN_NPC_WORK_WAGE',
  });

  const after = economy.ensureAccount({ ...scope, ownerKey: `actor:${me.actorId}`, actorId: me.actorId, accountType: 'actor' });
  return {
    delta: playerPays ? -amount : amount,
    amount,
    direction: playerPays ? 'pay' : 'earn',
    transactionId: receipt?.transactionId || null,
    balance: after?.balance ?? null,
    available: after?.available ?? null,
  };
}


function updateSession(db, sessionId, patch) {
  const fields = Object.keys(patch);
  if (!fields.length) return;
  const assignments = fields.map(field => `${field}=?`).join(', ');
  const values = fields.map(field => patch[field]);
  db.prepare(`UPDATE town_npc_service_sessions SET ${assignments}, updated_at=? WHERE id=?`)
    .run(...values, Date.now(), sessionId);
}

async function generateServiceImage(prompt, { npc, kind, sessionId, options }) {
  const generate = options.image?.generateImageRaw || generateImageRaw;
  // onProgress 收到的是 { stage, phase, progress: 0~1, step, max, ... } 对象，
  // 必须换算成 0~100 的整数再广播；直接把对象当数字用会让前端算出 NaN%。
  const onProgress = p => {
    const percent = percentFromProgress(p);
    if (percent == null) return;
    broadcast(TOWN_NPC_SERVICE_PROGRESS_EVENT, { sessionId, npcId: npc.id, kind, progress: percent });
  };
  const result = await generate(prompt, {
    ragQuery: prompt,
    artist: config.comfyui.eventArtist,
    width: config.comfyui.eventWidth,
    height: config.comfyui.eventHeight,
    scene: SERVICE_LORA_SCENE,
    workflowScene: SERVICE_SCENE,
    priority: 'high',
    onProgress,
  });
  return result;
}

function persistImage(result, npc, sessionId) {
  const images = Array.isArray(result?.images) ? result.images : [];
  const image = images[0];
  if (!image) return { imageUrl: null, inline: null };
  const filename = `town_service_${npc.id}_${Date.now()}_${image.filename || 'comfy.png'}`;
  let imageUrl = null;
  try {
    imageUrl = saveBase64Image(SERVICE_SCENE, filename, image.base64);
  } catch {
    imageUrl = null;
  }
  try {
    recordCompletedImageTask({
      conversationId: `town_service_${sessionId}`,
      promptOriginal: result?.promptOriginal || null,
      promptRefined: result?.promptRefined || null,
      outputPaths: imageUrl ? [imageUrl] : [],
      style: config.comfyui.eventArtist,
      resolution: `${config.comfyui.eventWidth}x${config.comfyui.eventHeight}`,
      workflowTemplate: result?.wfMode || null,
    });
  } catch {
    /* 记录失败不影响主链路 */
  }
  return { imageUrl, inline: image.base64 || null };
}

async function runPipeline(context, { npc, offer, kind, session, prior, options }) {
  const db = context.db;
  const sessionId = session.id;
  try {
    const llm = options.llm?.chatSync || chatSync;
    const messages = buildMessages({
      npc,
      offer,
      kind,
      priorTale: prior?.tale || '',
      priorChoice: prior?.choice || '',
      turns: session.turns || 0,
    });

    let text = '';
    try {
      text = await llm(messages, {
        temperature: 0.9,
        max_tokens: 1800,
        label: kind === 'work' ? '小镇打工趣事生成' : '小镇服务趣事生成',
        response_format: { type: 'json_object' },
      });
    } catch {
      text = '';
    }

    let payload;
    try {
      payload = parseServicePayload(text);
    } catch {
      text = await llm(messages, {
        temperature: 0.7,
        max_tokens: 1800,
        label: kind === 'work' ? '小镇打工趣事生成（重试）' : '小镇服务趣事生成（重试）',
      });
      payload = parseServicePayload(text);
    }

    const genResult = await generateServiceImage(payload.prompt, { npc, kind, sessionId, options });
    if (!genResult?.success || !Array.isArray(genResult.images) || !genResult.images.length) {
      throw townError('SERVICE_IMAGE_FAILED');
    }
    const persist = options.persistImage || persistImage;
    const { imageUrl, inline } = persist(genResult, npc, sessionId);

    const basePrice = clampOfferPrice(kind, offer?.price ?? null);
    const chosenTone = prior?.tone === 'bold' ? 'bold' : 'normal';
    const amount = turnAmount({ kind, basePrice, sessionId, turns: session.turns || 0, tone: chosenTone });

    // 给「继续」选项标好下一轮的价格：稳妥=基准价，激进=同一个确定性倍率（和服务结算完全同源）。
    const nextTurns = (session.turns || 0) + 1;
    const pricedOptions = payload.options.map(option => {
      const nextAmount = turnAmount({ kind, basePrice, sessionId, turns: nextTurns, tone: option.tone });
      return { ...option, amount: nextAmount, delta: kind === 'service' ? -nextAmount : nextAmount };
    });

    // 开单前已校验过余额；这里再失败就当作整单失败，绝不静默放行成「白拿」。
    const settle = options.settleCoins || settleCoins;
    const money = settle(context, { npcId: npc.id, kind, amount, sessionId, turns: session.turns || 0 });
    const settlementError = null;

    updateSession(db, sessionId, {
      status: 'ready',
      last_tale: payload.tale,
      last_image_path: imageUrl,
      last_choice: payload.options.map(item => item.label).join(' | '),
      turns: (session.turns || 0) + 1,
    });

    const readyPayload = {
      sessionId,
      npcId: npc.id,
      npcName: npc.display_name || '',
      kind,
      offerId: offer?.id || session.offer_id || null,
      offerTitle: offer?.title || session.offer_title || '',
      tale: payload.tale,
      prompt: payload.prompt,
      options: pricedOptions,
      images: imageUrl ? [imageUrl] : (inline ? [inline] : []),
      money,
      settlementError,
      turns: (session.turns || 0) + 1,
    };
    broadcast(TOWN_NPC_SERVICE_READY_EVENT, readyPayload);
    try {
      broadcastTownStateUpdated({ reason: 'town_npc_service_ready' });
    } catch {
      /* 广播失败不影响主链路 */
    }
    return readyPayload;
  } catch (error) {
    updateSession(db, sessionId, { status: 'failed' });
    const failure = {
      sessionId,
      npcId: npc.id,
      kind,
      error: error?.code || error?.message || 'SERVICE_FAILED',
    };
    broadcast(TOWN_NPC_SERVICE_READY_EVENT, failure);
    throw error;
  }
}

function loadNpc(db, npcId) {
  const id = Number(npcId);
  if (!Number.isSafeInteger(id) || id < 1) throw townError('NPC_NOT_FOUND');
  const npc = db.prepare('SELECT * FROM town_npcs WHERE id=?').get(id);
  if (!npc) throw townError('NPC_NOT_FOUND');
  return npc;
}

function loadOffer(db, npcId, offerId) {
  const id = Number(offerId);
  if (!Number.isSafeInteger(id) || id < 1) throw townError('OFFER_NOT_FOUND');
  const offer = db.prepare('SELECT * FROM town_npc_offers WHERE npc_id=? AND id=?').get(npcId, id);
  if (!offer) throw townError('OFFER_NOT_FOUND');
  return offer;
}

export function startNpcService(npcId, input = {}, options = {}) {
  const db = options.db || getDb();
  const context = createEconomyRuntime(db);
  const npc = loadNpc(db, npcId);
  const offer = loadOffer(db, npcId, input.offerId);
  const kind = normalizeOfferKind(offer.kind);
  // 服务=玩家付钱、打工=居民付钱：付不起就别开单。
  assertAffordable(context, { kind, amount: clampOfferPrice(kind, offer.price) });

  const now = Date.now();
  const insertInfo = db.prepare(
    `INSERT INTO town_npc_service_sessions
       (world_id, world_epoch, npc_id, player_actor_id, kind, offer_id, offer_title, status, turns, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'generating', 0, ?, ?)`,
  ).run(
    context.scope.worldId,
    context.scope.worldEpoch,
    npc.id,
    input.playerActorId || context.registry.resolveAgentKey('me')?.actorId || 'me',
    kind,
    offer.id,
    offer.title,
    now,
    now,
  );
  const sessionId = Number(insertInfo.lastInsertRowid);
  const session = { id: sessionId, turns: 0, offer_id: offer.id, offer_title: offer.title };

  const pending = runPipeline(context, { npc, offer, kind, session, prior: null, options });
  const immediate = {
    generating: true,
    sessionId,
    npcId: npc.id,
    npcName: npc.display_name || '',
    kind,
    offerId: offer.id,
    offerTitle: offer.title,
    price: clampOfferPrice(kind, offer.price),
    message: '服务生成中，请等待 town_npc_service_ready',
  };
  if (options.awaitPipeline) return pending;
  pending.catch(() => {});
  return immediate;
}

export function continueNpcService(npcId, input = {}, options = {}) {
  const db = options.db || getDb();
  const context = createEconomyRuntime(db);
  const npc = loadNpc(db, npcId);
  const sessionId = Number(input.sessionId);
  if (!Number.isSafeInteger(sessionId) || sessionId < 1) throw townError('SERVICE_SESSION_NOT_FOUND');
  const session = db.prepare('SELECT * FROM town_npc_service_sessions WHERE id=? AND npc_id=?').get(sessionId, npc.id);
  if (!session) throw townError('SERVICE_SESSION_NOT_FOUND');

  const kind = normalizeOfferKind(session.kind);
  let offer = null;
  if (session.offer_id) {
    offer = db.prepare('SELECT * FROM town_npc_offers WHERE id=?').get(session.offer_id) || null;
  }
  if (!offer) {
    offer = { id: session.offer_id || null, title: session.offer_title || '继续', description: '', price: clampOfferPrice(kind, null) };
  }

  const tone = input.choice === 'bold' ? 'bold' : 'normal';
  const prior = { tale: session.last_tale || '', choice: input.choiceLabel || '', tone };
  assertAffordable(context, { kind,
    amount: turnAmount({ kind, basePrice: offer?.price ?? null, sessionId: session.id, turns: session.turns || 0, tone }) });
  updateSession(db, session.id, { status: 'generating' });

  const pending = runPipeline(context, { npc, offer, kind, session, prior, options });
  const immediate = {
    generating: true,
    sessionId: session.id,
    npcId: npc.id,
    npcName: npc.display_name || '',
    kind,
    offerId: offer.id,
    offerTitle: offer.title,
    price: clampOfferPrice(kind, offer.price),
    tone,
    message: '服务生成中，请等待 town_npc_service_ready',
  };
  if (options.awaitPipeline) return pending;
  pending.catch(() => {});
  return immediate;
}

export function getNpcServiceSession(sessionId, options = {}) {
  const db = options.db || getDb();
  const row = db.prepare('SELECT * FROM town_npc_service_sessions WHERE id=?').get(sessionId);
  if (!row) throw townError('SERVICE_SESSION_NOT_FOUND');
  return row;
}

export function listNpcServiceSessions(npcId, options = {}) {
  const db = options.db || getDb();
  return db.prepare('SELECT * FROM town_npc_service_sessions WHERE npc_id=? ORDER BY created_at DESC LIMIT 20').all(npcId);
}
