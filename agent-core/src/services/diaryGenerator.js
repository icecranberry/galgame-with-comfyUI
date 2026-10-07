/**
 * 角色日记 —— 后台生成一篇「今天」的日记（文字 + 三张配图）。
 *
 * 输入：角色本人 + 角色当天的完整日程（daily_schedules 当日快照）。
 * 输出：一篇以角色口吻写的第一人称日记，配三张今日场景插图。
 *
 * 一天一篇：character_diaries 以 (character_id, diary_date) 唯一，同日多次生成覆盖当日那一篇，
 * 历史日期不动，供日记本往前翻阅。
 *
 * LLM 请求分层（AGENTS.md「LLM 请求分层」，稳定前缀优先，user 最后）：
 *   system0 = 破甲词 + 世界观           （getSystemRulesWithWorld，静态）
 *   system1 = 世界观强化（有世界观才有）  （getWorldIntegrationRule('moments')，静态）
 *   system2 = 日记任务身份 + 口吻要求 + 输出 JSON 结构 + 生图提示词规范（静态）
 *   system3 = 角色完整人格               （buildCharacterPersona full，随角色变化）
 *   system4 = 今天的日期 + 今天的完整日程 （随日期变化）
 *   user    = 本次执行强调
 * 静态层逐字节稳定（无日期 / 用户名内插），同一角色跨天的请求共享 system0~3 前缀缓存。
 *
 * 生图参数与朋友圈一致（scene='moments' → 朋友圈画师串 / 全局 LoRA / 工作流），
 * 分辨率取朋友圈宽高并随机横竖，逐图独立随机，priority 固定 high。
 */

import { getDb, getSystemRulesWithWorld, getGlobalRule, getWorldSetting } from '../db/index.js';
import { getWorldIntegrationRule } from '../builtinRules.js';
import { chatSync } from '../llm/llm-client.js';
import { generateImage } from './imageSkill.js';
import { charArtistOverride } from './characterImageOpts.js';
import { buildCharacterPersona } from './characterPersona.js';
import { recordCompletedImageTask } from './imageTaskRecorder.js';
import { broadcast } from './unifiedStreamBus.js';
import { saveBase64Image } from './imagePaths.js';
import { ensureFontForCharacter } from './handwritingFontService.js';
import { getTodaySchedule } from './scheduleManager.js';
import { startBackgroundTask } from './imageEditTasks.js';
import { config } from '../config.js';
import { getLocalDateKey } from '../utils/localDate.js';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const DIARY_IMAGE_COUNT = 3;

/** 同一角色同一天正在生成中的任务：`${charId}:${date}` → task */
const inflight = new Map();

// ══════════════════════════════════════════════════════════════
//  静态 prompt 层（逐字节稳定，禁止内插日期 / 用户名等每次变化的内容）
// ══════════════════════════════════════════════════════════════

const DIARY_TASK_REQUIREMENTS = `【任务身份】
你是一个日记执笔人。你会拿到一个角色的人设，以及这个角色今天的完整日程。你要以「这个角色本人」的第一人称口吻，把今天的一天写成一篇日记。

【日记口吻要求】
1. 这是角色在一天结束时写给自己看的私人日记。以第一人称写，但不必句句以「我」开头，也不招呼读者、介绍自己的身份或解释熟人的背景。写下的是此刻还惦记着的事，不是给旁人展示的一篇好文章。
2. 让人设决定「注意什么、怎么想、怎么说」：同一件小事，不同的人会介意不同的地方。用角色自己的词汇、句子长短、幽默感和表达分寸；寡言的人可以简短，讲究的人可以措辞认真，直率的人可以直接抱怨。不要把所有人都写成温柔文艺、俏皮话多或伤感敏锐的同一种声音，也不要反复用性格标签介绍自己。
3. 从今天里挑一两件仍有余味的小事展开，其他事情可以一笔带过或不写。篇幅跟着在意程度走：一件不起眼的事可能念叨很久，一件大事也可能暂时不想多提。不要照抄日程表、逐项报时或平均分配篇幅；正文不提「日程表」等任务来源，但可以自然地说自己的打算。
4. 细节要和在意的事情连在一起：一个反复做的小动作、一件不顺手的东西、一句听后还在琢磨的话，都可以让感受落地。只挑当时真会注意到的细节，不必把气味、光线、声音、触感逐项写齐，也不要每段都用景物烘托情绪。比起泛泛写「有点烦」，更可以写烦的时候做了什么、忍住了什么。
5. 可以留下没对别人说的小心思：嘴上不在乎却又记着，想偷懒又有点心虚，得到一点好处就暗自高兴，或者还没想明白自己为什么不舒服。是否出现这些反应由人设和当天经历决定，不必每篇都安排反转、矛盾或秘密；不用急着把情绪分析清楚，更不用替自己作出正确、成熟的总结。
6. 叙述可以有轻重和停顿，顺着一个念头想起另一件事，也可以临时改口、补一句或就此打住。长短句和段落自然交替，不追求每段一样整齐。口语词、括号、省略号、感叹号只是偶尔需要时才用，不靠满篇「嗯」「唉」「算了」、故意写错字或硬塞网络梗制造随手感。上述写法都是可选的，不要逐项表演。
7. 以给定的人设、世界观和当天活动为事实边界，可以补充合理的日常动作与感受，不为增加戏剧性擅自编造重要人物关系、重大遭遇或他人的承诺。角色只能写自己知道的事，对别人的心思可以猜，但不能当成事实。平淡的一天也值得记，不必硬添波折，更不必把每件事都牵到恋爱或某个人身上。
8. 从最想记的地方直接写起，不必固定用「今天是……的一天」开场。写到没什么想说的地方就停，可以停在一件小事、一个未解决的念头或接下来想做的事上，不强行升华、感恩、励志或期待明天。少用套话和漂亮比喻，不要把日记写成散文、心理咨询记录或每日成长报告。
9. 日记正文只保留角色实际写下的文字，不写任务说明、写作分析或自我评价；整体仍按下方 JSON 结构输出。`;

const DIARY_OUTPUT_STRUCTURE = `【输出格式】
严格按下面这个 JSON 结构输出（字段名固定，值按注释里的要求填）：

{
  "title": "被雨淋了一路（标题：6~14 个字，像随手写在页首的一句话，口语、有画面感，能看出今天的心情）",
  "mood": "又累又饿（心情：2~6 个字，直接写此刻的心境）",
  "weather": "阴了一整天（天气：2~6 个字，写你感知到的天气或光线）",
  "content": "第一段（正文：300~400 字，第一人称，分 3~5 段，段与段之间用 \\n\\n 分隔，段落长短可以不同。从今天最惦记的小事直接写起，不复述日程表，不为凑字数重复感想）\\n\\n第二段（按角色自己的口吻展开，用少量与事情相关的动作或物件带出当时的反应、此刻还在意的地方；不堆砌感官描写，不解释人设）\\n\\n第三段（顺着念头自然停笔，不必解决情绪或总结道理，不刻意用断句、口头禅或抒情句收尾）",
  "imagePrompts": [
    "第一张配图的英文画面描述：从正文里挑一个具体的场景或瞬间，写清人物状态、表情、姿势、动作、所处环境、光线氛围与镜头感；若画面中有『我』，必须使用你的人设里的外貌特征，眼睛不看镜头。只写英文关键词与短句，不要写中文。",
    "第二张配图的英文画面描述：取正文里另一处不同的场景、物件特写或情绪画面，与第一张的场面明显区分。只写英文。",
    "第三张配图的英文画面描述：再取正文里第三处不同的画面（可以是空镜、静物、远景），与前面两张都不重复。只写英文。"
  ]
}

【硬性约束】
- imagePrompts 必须是 3 个元素，三张图对应今天里三个不同的场面，不要重复同一处场景。
- imagePrompts 里至少两张画面上要有「我」本人（用你人设里的外貌、发型、发色、服饰特征，不要被其他内容干扰），姿势与表情符合当时的处境。
- 必须严格按示例格式输出，只输出 JSON，不要输出任何解释或 JSON 以外的文字。`;

// ══════════════════════════════════════════════════════════════
//  prompt 组装
// ══════════════════════════════════════════════════════════════

/** 把当日日程快照格式化成给 LLM 看的文本（不含日期，日期在单独一层） */
export function formatScheduleForDiary(activities = []) {
  if (!Array.isArray(activities) || activities.length === 0) return '（今天没有安排，一整天都是自己支配的时间。）';
  const lines = [];
  for (const act of activities) {
    const range = act.startTime || act.endTime ? `${act.startTime || '??:??'}-${act.endTime || '??:??'} ` : '';
    const loc = act.location ? `在【${act.location}】` : '';
    const desc = act.description ? ` —— ${String(act.description).trim()}` : '';
    lines.push(`${range}${loc}${act.activity || ''}${desc}`.trim());
  }
  return lines.join('\n');
}

/**
 * 按「稳定前缀优先」组装日记请求的分层消息。
 * @param {object} p
 * @param {object} p.character  - characters 表行（含 id / base_prompt / short_prompt）
 * @param {string} p.dateKey    - 本地日期键 YYYY-MM-DD
 * @param {string} p.scheduleText - formatScheduleForDiary 的结果
 * @returns {Array<{role:string, content:string}>}
 */
export function buildDiaryMessages({ character, dateKey, scheduleText }) {
  const msgs = [];

  // system0：破甲词 + 世界观
  const stage0 = getSystemRulesWithWorld({ roleplay: false });
  if (stage0) msgs.push({ role: 'system', content: stage0 });

  // system1：世界观强化（没有世界观就不要这一层）
  if (getWorldSetting()) {
    msgs.push({ role: 'system', content: getWorldIntegrationRule('moments') });
  }

  // system2：静态任务层（身份 + 口吻要求 + 输出结构 + 生图提示词规范）
  const imageGuide = getGlobalRule('image_prompt')?.rule_content || '';
  const imageGuideBlock = imageGuide ? `\n\n【生图提示词编写规范】\n${imageGuide}` : '';
  msgs.push({
    role: 'system',
    content: `${DIARY_TASK_REQUIREMENTS}\n\n${DIARY_OUTPUT_STRUCTURE}${imageGuideBlock}`,
  });

  // system3：角色完整人格（随角色变化）
  msgs.push({
    role: 'system',
    content: buildCharacterPersona(
      { id: character.id, base_prompt: character.base_prompt, short_prompt: character.short_prompt },
      { variant: 'full' }
    ),
  });

  // system4：今天的日期 + 今天的完整日程（随日期变化）
  const weekday = WEEKDAYS[new Date(`${dateKey}T12:00:00`).getDay()] || '';
  msgs.push({
    role: 'system',
    content: `【今天】${dateKey}${weekday ? `（${weekday}）` : ''}\n\n【今天的日程】\n${scheduleText}`,
  });

  // user：只强调本次执行与输出格式
  msgs.push({
    role: 'user',
    content: '请从今天的日程里挑出值得记录的部分，以你自己的口吻写一篇今天的日记，严格按上面的 JSON 结构只返回 JSON。',
  });

  return msgs;
}

// ══════════════════════════════════════════════════════════════
//  输出解析
// ══════════════════════════════════════════════════════════════

/** 兜底的生图 prompt：LLM 没给够 3 条时按位置补，保证日记始终有 3 张配图 */
const FALLBACK_IMAGE_PROMPTS = [
  'anime illustration, the character in a quiet everyday scene from the day, warm ambient light, soft focus, looking away from the camera, detailed background',
  'anime illustration, a still-life detail from the day, close-up of objects and light, gentle color palette, calm atmosphere',
  'anime illustration, evening mood, the character alone in a dim room after a long day, soft rim light through the window, contemplative expression, looking away from the camera',
];

function asText(value, maxLen = 0) {
  const text = typeof value === 'string' ? value.trim() : '';
  return maxLen > 0 ? text.slice(0, maxLen) : text;
}

/**
 * 校验并规整 LLM 的日记 JSON：字段缺失只做降级，不抛错（保证日记主体能落地）。
 * imagePrompts 一律补齐/裁剪到 3 条。
 */
export function normalizeDiaryPayload(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const content = asText(parsed.content);
  if (!content) return null;

  let prompts = Array.isArray(parsed.imagePrompts) ? parsed.imagePrompts : [];
  prompts = prompts.map(p => asText(p)).filter(Boolean);
  while (prompts.length < DIARY_IMAGE_COUNT) {
    prompts.push(FALLBACK_IMAGE_PROMPTS[prompts.length] || FALLBACK_IMAGE_PROMPTS[0]);
  }
  prompts = prompts.slice(0, DIARY_IMAGE_COUNT);

  return {
    title: asText(parsed.title, 40) || '无题',
    mood: asText(parsed.mood, 20),
    weather: asText(parsed.weather, 20),
    content,
    imagePrompts: prompts,
  };
}

/** 容错解析：直接 parse → ```json 代码块 → 首个 {...} 块；都失败返回 null（由调用方决定失败语义） */
export function parseDiaryJSON(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const clean = raw.trim();
  const attempts = [clean];
  const block = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (block) attempts.push(block[1]);
  const obj = clean.match(/\{[\s\S]*\}/);
  if (obj) attempts.push(obj[0]);

  for (const text of attempts) {
    let parsed;
    try { parsed = JSON.parse(text); } catch { continue; }
    const normalized = normalizeDiaryPayload(parsed);
    if (normalized) return normalized;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
//  查询
// ══════════════════════════════════════════════════════════════

function safeJSON(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

/** 行 → 前端使用的日记对象 */
export function toDiaryDTO(row) {
  if (!row) return null;
  const images = safeJSON(row.images, []);
  return {
    id: row.id,
    character_id: row.character_id,
    character_name: row.character_name || row.display_name || '',
    character_avatar: row.avatar_path || '',
    date: row.diary_date,
    title: row.title || '',
    mood: row.mood || '',
    weather: row.weather || '',
    content: row.content || '',
    images: Array.isArray(images) ? images : [],
    resolutions: safeJSON(row.resolutions, []),
    handwriting_font: row.handwriting_font || '',
    status: row.status,
    error: row.error_message || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const DIARY_ROW_SELECT = `
  SELECT cd.*, c.display_name, c.avatar_path
  FROM character_diaries cd
  LEFT JOIN characters c ON cd.character_id = c.id
`;

export function getDiary(characterId, dateKey) {
  const row = getDb().prepare(`${DIARY_ROW_SELECT} WHERE cd.character_id = ? AND cd.diary_date = ?`).get(characterId, dateKey);
  return toDiaryDTO(row);
}

/** 历史日记简目（最新在前），不含正文，供翻阅导航 */
export function listDiaries(characterId, limit = 60) {
  const rows = getDb().prepare(`
    SELECT cd.id, cd.character_id, cd.diary_date, cd.title, cd.mood, cd.weather, cd.images, cd.status, cd.updated_at,
           c.display_name, c.avatar_path
    FROM character_diaries cd
    LEFT JOIN characters c ON cd.character_id = c.id
    WHERE cd.character_id = ? AND cd.status = 'completed'
    ORDER BY cd.diary_date DESC
    LIMIT ?
  `).all(characterId, limit);
  return rows.map(r => {
    const images = safeJSON(r.images, []);
    return {
      id: r.id,
      character_id: r.character_id,
      date: r.diary_date,
      title: r.title || '',
      mood: r.mood || '',
      weather: r.weather || '',
      cover: Array.isArray(images) ? (images[0] || '') : '',
      updated_at: r.updated_at,
    };
  });
}

export function isDiaryGenerating(characterId, dateKey) {
  return inflight.has(`${characterId}:${dateKey}`);
}

// ══════════════════════════════════════════════════════════════
//  生图（朋友圈参数 + 横竖随机 + 高优先级）
// ══════════════════════════════════════════════════════════════

/**
 * 朋友圈参数下的随机横竖分辨率：宽高互换，二者等概率。
 * 逐图独立随机，所以同一篇日记的三张图可能横竖混排。
 */
export function pickDiaryResolution(random = Math.random) {
  const w = Number(config.comfyui.momentsWidth) || 1600;
  const h = Number(config.comfyui.momentsHeight) || 1200;
  return random() < 0.5 ? { width: w, height: h } : { width: h, height: w };
}

async function generateDiaryImages({ character, content, prompts, onProgress }) {
  const charLoras = safeJSON(character.loras, []);
  const customWorkflow = character.custom_workflow || null;
  const charArtist = charArtistOverride(character);
  const artist = charArtist !== null ? charArtist : config.comfyui.momentsArtist;
  const ragQuery = String(content || '').slice(0, 300);

  let finished = 0;
  const settled = await Promise.allSettled(prompts.map((prompt, index) => (async () => {
    const { width, height } = pickDiaryResolution();
    const result = await generateImage(prompt, {
      ragQuery,
      artist,
      width,
      height,
      scene: 'moments',
      priority: 'high',
      loras: charLoras,
      customWorkflow,
      onProgress: (p) => {
        const cur = typeof p?.progress === 'number' ? Math.min(1, Math.max(0, p.progress)) : 0;
        onProgress?.({ stage: 'image', imageIndex: index, progress: Math.min(1, (finished + cur) / prompts.length) });
      },
    });
    finished++;
    onProgress?.({ stage: 'image', imageIndex: index, progress: Math.min(1, finished / prompts.length) });
    if (!result?.success || !result.images?.length) {
      throw new Error(result?.error || `第 ${index + 1} 张配图生成失败`);
    }
    return {
      index,
      width,
      height,
      image: result.images[0],
      promptRefined: result.promptRefined || prompt,
      wfMode: result.wfMode,
    };
  })()));

  const ok = settled.filter(s => s.status === 'fulfilled').map(s => s.value)
    .sort((a, b) => a.index - b.index);
  const failed = settled.filter(s => s.status === 'rejected');
  for (const f of failed) console.warn('[diaryGenerator] 配图失败:', f.reason?.message || f.reason);
  return { ok, failedCount: failed.length };
}

// ══════════════════════════════════════════════════════════════
//  生成主流程
// ══════════════════════════════════════════════════════════════

/**
 * 为角色生成某一天的日记（后台执行，立刻返回）。
 * 同角色同日期已有任务在跑时不重复启动。
 *
 * @param {number} characterId
 * @param {{ date?: string }} [opts] - date 缺省为今天
 * @returns {{ started: boolean, date: string, generating: boolean, diary: object|null }}
 */
export function startDiaryGeneration(characterId, opts = {}) {
  const db = getDb();
  const dateKey = opts.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) ? opts.date : getLocalDateKey();
  const key = `${characterId}:${dateKey}`;

  const character = db.prepare(`
    SELECT id, name, display_name, avatar_path, base_prompt, short_prompt,
           handwriting_font, loras, custom_workflow, artist_override
    FROM characters WHERE id = ?
  `).get(characterId);

  if (!character) {
    const err = new Error('角色不存在');
    err.status = 404;
    throw err;
  }

  if (inflight.has(key)) {
    return { started: false, date: dateKey, generating: true, diary: getDiary(characterId, dateKey) };
  }

  // 先占位：今天那篇标成 generating（已有正文的保留正文，前端可继续显示旧内容）
  db.prepare(`
    INSERT INTO character_diaries (character_id, diary_date, status, updated_at)
    VALUES (?, ?, 'generating', datetime('now'))
    ON CONFLICT(character_id, diary_date)
    DO UPDATE SET status = 'generating', error_message = NULL, updated_at = datetime('now')
  `).run(characterId, dateKey);

  const name = character.display_name || character.name || '';
  broadcast('diary_start', { character_id: characterId, character_name: name, date: dateKey });

  // 右下角生成提示：复用图片后台任务通道（image_edit_task_* 事件）
  const task = startBackgroundTask({
    action: 'diary',
    meta: { characterId, characterName: name, characterAvatar: character.avatar_path || '', date: dateKey },
  });
  task.onProgress({ stage: 'text', progress: 0 });

  const promise = runDiaryGeneration({ db, character, dateKey, name, task })
    .finally(() => { inflight.delete(key); });
  inflight.set(key, promise);

  return { started: true, date: dateKey, generating: true, diary: getDiary(characterId, dateKey) };
}

async function runDiaryGeneration({ db, character, dateKey, name, task }) {
  const characterId = character.id;
  let lastText = null;
  try {
    // ── 步骤1：角色当日日程 ──
    let activities = [];
    try { activities = getTodaySchedule(characterId) || []; } catch (err) {
      console.warn(`[diaryGenerator] schedule unavailable for char #${characterId}:`, err.message);
    }
    const scheduleText = formatScheduleForDiary(activities);

    // ── 步骤2：确保角色有手写字体（日记正文用信件那套字体渲染）──
    let handwritingFont = character.handwriting_font || '';
    try {
      handwritingFont = await ensureFontForCharacter(characterId);
    } catch (err) {
      console.warn(`[diaryGenerator] font ensure failed for char #${characterId}:`, err.message);
    }

    // ── 步骤3：LLM 生成日记文字 + 3 段生图 prompt ──
    const messages = buildDiaryMessages({ character, dateKey, scheduleText });
    const raw = await chatSync(messages, {
      temperature: 0.9,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      label: '日记助手',
    });
    const diary = parseDiaryJSON(raw);
    if (!diary) throw new Error('日记生成返回内容无法解析');
    lastText = diary;

    db.prepare(`
      UPDATE character_diaries
      SET title = ?, mood = ?, weather = ?, content = ?, image_prompts = ?,
          handwriting_font = ?, status = 'generating', error_message = NULL, updated_at = datetime('now')
      WHERE character_id = ? AND diary_date = ?
    `).run(diary.title, diary.mood, diary.weather, diary.content,
      JSON.stringify(diary.imagePrompts), handwritingFont || '', characterId, dateKey);

    broadcast('diary_text_ready', {
      character_id: characterId,
      character_name: name,
      date: dateKey,
      diary: getDiary(characterId, dateKey),
    });
    task.onProgress({ stage: 'image', imageIndex: 0, progress: 0 });

    // ── 步骤4：并发生成 3 张配图（朋友圈参数 + 横竖随机 + 高优先级）──
    const { ok, failedCount } = await generateDiaryImages({
      character,
      content: diary.content,
      prompts: diary.imagePrompts,
      onProgress: (p) => task.onProgress(p),
    });
    if (ok.length === 0) throw new Error('三张配图全部生成失败');

    // ── 步骤5：落盘 + 记录 image_tasks ──
    const ts = Date.now();
    const images = [];
    const resolutions = [];
    for (const item of ok) {
      const imageUrl = saveBase64Image('diary', `diary_${characterId}_${dateKey}_${item.index}_${ts}.png`, item.image.base64);
      images.push(imageUrl);
      resolutions.push(`${item.width}x${item.height}`);
      recordCompletedImageTask({
        conversationId: `char_${characterId}_diary`,
        promptOriginal: diary.imagePrompts[item.index] || item.promptRefined,
        promptRefined: item.promptRefined,
        outputPaths: [imageUrl],
        style: config.comfyui.momentsArtist,
        resolution: `${item.width}x${item.height}`,
        workflowTemplate: item.wfMode,
        db,
      });
    }

    db.prepare(`
      UPDATE character_diaries
      SET images = ?, resolutions = ?, status = 'completed', error_message = NULL, updated_at = datetime('now')
      WHERE character_id = ? AND diary_date = ?
    `).run(JSON.stringify(images), JSON.stringify(resolutions), characterId, dateKey);

    const saved = getDiary(characterId, dateKey);
    if (failedCount > 0) {
      console.warn(`[diaryGenerator] char #${characterId} ${dateKey} 完成但缺 ${failedCount} 张配图`);
    }
    console.log(`[diaryGenerator] char #${characterId} ${dateKey} 日记完成（${images.length} 张配图）`);
    broadcast('diary_done', { character_id: characterId, character_name: name, date: dateKey, diary: saved });
    task.succeed({ diaryId: saved?.id || null, date: dateKey, characterId });
  } catch (err) {
    console.error(`[diaryGenerator] char #${characterId} ${dateKey} failed:`, err.message);
    const message = (err?.message || '日记生成失败').slice(0, 200);
    // 文字已生成、只是配图失败时保留正文，用户可原地重新生成
    db.prepare(`
      UPDATE character_diaries
      SET status = 'failed', error_message = ?, updated_at = datetime('now')
      WHERE character_id = ? AND diary_date = ?
    `).run(message, characterId, dateKey);
    broadcast('diary_error', {
      character_id: characterId,
      character_name: name,
      date: dateKey,
      error: message,
      hasText: Boolean(lastText),
    });
    task.fail(err);
  }
}
