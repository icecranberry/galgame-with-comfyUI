/**
 * 奇遇事件生成器
 *
 * - 硬编码 EVENT_TYPES（30+ 条，6 大类），和朋友圈风格库一样的模式
 * - generateEvent(): LLM 生成事件初始场景 + 配图
 * - generateNextBranch(): 用户选择后生成下一步 + 配图
 * - concludeEvent(): 到期/完成后生成结局，存入记忆
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, getSystemRulesWithWorld, getGlobalRule } from '../db/index.js';
import { chatSync } from '../llm/deepseek.js';
import { generateImageRaw } from './imageSkill.js';
import { config } from '../config.js';
import { broadcastNewEvent, broadcastEventUpdate, broadcastEventConclusion } from './eventNotificationBus.js';
import { upsertVector } from './vectorClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const imagesDir = path.join(projectRoot, 'data', 'images');

// ── 事件类型库（硬编码，和朋友圈风格库一样模式） ──
// 每个条目给大方向，LLM 结合角色个性、世界观、关系网、当前时间自由发挥

const EVENT_TYPES = [
  // ═══ 日常奇遇（60-120min）═══
  { key: 'street_wander', name: '街头漫步', durationMin: 90, urgency: 1,
    desc: '你正在街头/小镇/城市里闲逛，没有明确目的地，一路观察四周的店铺、行人和风景。可能会遇到有趣的小店、街头表演、或是某个让你驻足的瞬间。' },
  { key: 'shop_discovery', name: '偶遇小店', durationMin: 120, urgency: 1,
    desc: '你无意间发现了一家从未注意过的小店——可能是一家旧书店、杂货铺、古董店或手工艺品店。店主似乎有些特别，店里的某样东西吸引了你的注意。' },
  { key: 'rain_shelter', name: '雨天躲雨', durationMin: 60, urgency: 1,
    desc: '突然下起了雨，你没带伞，匆忙躲进了最近的屋檐/店铺/车站。在这个意外的停留中，你遇到了一些有意思的事或人。' },
  { key: 'lost_explore', name: '迷路探索', durationMin: 90, urgency: 1,
    desc: '你本来想去某个地方，但不小心走错了路，来到一个陌生的街区/区域。与其立刻回头，你决定顺便探索一下这个未知的地方。' },
  { key: 'library_find', name: '图书馆发现', durationMin: 120, urgency: 1,
    desc: '你在图书馆/资料室/书店里翻阅书籍时，意外发现了一本特别的书/一份旧资料/一张夹在书里的纸条，上面似乎藏着什么线索。' },
  { key: 'park_encounter', name: '公园散步', durationMin: 90, urgency: 1,
    desc: '你在公园/花园里散步，享受片刻宁静。也许会遇到遛狗的人、下棋的老人、玩耍的孩子，或者一只主动靠近你的小动物。' },
  { key: 'night_market', name: '夜市闲逛', durationMin: 120, urgency: 1,
    desc: '夜幕降临后你来到了夜市/集市，摊位林立，食物的香气、小贩的吆喝、琳琅满目的小商品。你被某个摊位吸引了目光。' },
  { key: 'bus_adventure', name: '公交车奇遇', durationMin: 60, urgency: 1,
    desc: '坐上了不知开往哪里的公交车/电车/列车，窗外风景变换，车厢里的其他乘客各有故事。你和一个陌生人/一件奇怪的事不期而遇。' },

  // ═══ 社交互动（20-60min）═══
  { key: 'stranger_approach', name: '被人搭讪', durationMin: 20, urgency: 2,
    desc: '一个陌生人突然向你搭话——可能是问路、推销、搭讪，或者有求于你。这个人的态度和意图尚不明朗，你需要决定如何应对。' },
  { key: 'old_acquaintance', name: '偶遇熟人', durationMin: 30, urgency: 1,
    desc: '你撞见了一个意想不到的人——可能是旧友、曾经的对手、或是一个你很久没见的人。重逢的瞬间有些微妙，接下来会发生什么？' },
  { key: 'mysterious_stranger', name: '神秘陌生人', durationMin: 40, urgency: 1,
    desc: '你注意到一个看起来很不寻常的人——穿着奇怪、举止神秘、或者身上带着某种说不出的气场。这个人似乎在等待着什么，或者等待着谁。' },
  { key: 'street_performer', name: '街头艺人互动', durationMin: 30, urgency: 1,
    desc: '路边有一个街头艺人正在表演——可能是音乐、魔术、杂技或画画。表演很精彩，而你被拉进了表演之中，成为了临时参与者。' },
  { key: 'neighbor_visit', name: '邻居来访', durationMin: 40, urgency: 1,
    desc: '你的邻居突然敲门来访——可能是来借东西、投诉噪音、送来食物，或者只是单纯想聊天。这次访问可能会引出一些意想不到的事。' },
  { key: 'sales_pitch', name: '被推销拦住', durationMin: 20, urgency: 2,
    desc: '一个热情的推销员/传单员/募捐者拦住了你，不依不饶地介绍着什么——可能是健身卡、保险、慈善捐款、或者是某种更奇怪的东西。你需要快速摆脱或应对。' },

  // ═══ 冒险探索（60-120min）═══
  { key: 'hidden_place', name: '发现隐藏地点', durationMin: 120, urgency: 1,
    desc: '你发现了一个从未注意过的地方——一面墙后面的暗门、楼梯间深处的通道、或者一扇标记着"禁止入内"的门。好奇心驱使着你一探究竟。' },
  { key: 'clue_chase', name: '追踪线索', durationMin: 120, urgency: 1,
    desc: '你手中出现了一条模糊的线索——可能是一张旧地图、一段密文、一个地址或是一个名字。线索指向某个未知的目的地，你决定去调查一下。' },
  { key: 'secret_room', name: '意外发现密室', durationMin: 90, urgency: 1,
    desc: '在你熟悉的地方——家里、工作场所或常去的建筑里——你意外发现了隐藏在墙壁/地板/书架后的一个密室。里面有什么？为什么被藏起来？' },
  { key: 'treasure_map', name: '宝藏地图', durationMin: 120, urgency: 1,
    desc: '一张看似破旧的地图落到了你手中，上面标记了一个X。地图看起来不像是恶作剧——纸张泛黄、墨迹陈旧。X标记的地点似乎在附近。' },
  { key: 'abandoned_building', name: '废弃建筑探险', durationMin: 90, urgency: 1,
    desc: '一座废弃的建筑——旧工厂、学校、医院或宅邸——出现在你面前。周围安静得有些诡异，但某种东西吸引着你走进去。' },
  { key: 'underground_entrance', name: '地下通道入口', durationMin: 120, urgency: 1,
    desc: '你发现了一个通往地下的入口——可能是下水道、防空洞、废弃地铁站或天然洞穴。入口处散发着微弱的冷风，暗示着下面有更大的空间。' },

  // ═══ 紧急事件（20-30min）═══
  { key: 'sudden_fight', name: '突发战斗', durationMin: 20, urgency: 2,
    desc: '毫无预兆地，危险出现了！可能是怪物/敌人/不明生物突然出现在你面前，也可能是被卷入了一场突发的冲突。你需要立刻做出反应——战斗还是逃跑？' },
  { key: 'being_chased', name: '被追赶', durationMin: 20, urgency: 2,
    desc: '有人在追你！你不太确定追你的是什么——可能是一群不明人士、一只凶猛的动物、或者某种更诡异的东西。你需要找到脱身的办法，而且要快。' },
  { key: 'rescue_request', name: '救援请求', durationMin: 30, urgency: 2,
    desc: '你听到了呼救声——有人（或动物）身处危险之中，需要立刻帮助。情况看起来很紧急，你没有太多时间思考。' },
  { key: 'falling_object', name: '天降之物', durationMin: 20, urgency: 2,
    desc: '一个东西从天上掉了下来——可能是一块陨石碎片、一个奇怪的包裹、一架失控的无人机、或是某种无法形容的物体。它在你的脚边砸出了一个小坑。' },
  { key: 'sudden_weather', name: '突发天气', durationMin: 30, urgency: 2,
    desc: '天气突然剧烈变化——暴风雨、冰雹、突如其来的浓雾、或者异常的闪电。这种变化来得太急了，你被困在了露天之处，需要立刻找到避难所。' },
  { key: 'equipment_failure', name: '突发故障', durationMin: 30, urgency: 2,
    desc: '你正在使用的某种设备突然失灵——可能是汽车抛锚、电梯停运、通讯中断、或者是某种更关键的设备。故障发生得不是时候，你必须想办法解决。' },

  // ═══ 神秘现象（60-120min）═══
  { key: 'strange_sound', name: '奇怪的声音', durationMin: 90, urgency: 1,
    desc: '你听到了一个无法解释的声音——墙壁里的敲击声、远处的低语、地板下的刮擦声，或者是某种不属于这个世界的旋律。声音引导着你走向某处。' },
  { key: 'glowing_object', name: '发光物品', durationMin: 120, urgency: 1,
    desc: '一个发光的物品出现在你面前——可能是从垃圾堆里捡到的，可能是别人给你的，也可能是自己"出现"在身边的。它发出柔和的光芒，似乎在等待什么。' },
  { key: 'prophecy_divination', name: '预言/占卜', durationMin: 60, urgency: 1,
    desc: '你偶然获得了一次占卜/预言的机会——可能是一个街头占卜师拉住你，也可能是一张塔罗牌从牌堆中滑落，或者是某种更超自然的感知。结果让你不安。' },
  { key: 'time_anomaly', name: '时空裂缝', durationMin: 90, urgency: 1,
    desc: '你似乎触碰到了某种——异常。时间感变得奇怪，周围的环境似乎不太对劲。这个地方好像不属于这个时间点，或者你自己不属于这个时间点。' },
  { key: 'magic_malfunction', name: '魔法失控', durationMin: 60, urgency: 1,
    desc: '你尝试使用某种能力/魔法/道具时出了意外——效果超出了预期范围，或者完全偏离了目标。事态正在朝着不可预测的方向发展。' },

  // ═══ 日常琐事（30-90min）═══
  { key: 'shopping_dilemma', name: '购物选择困难', durationMin: 60, urgency: 1,
    desc: '你被一个购物选择困住了——两件东西都想要，或者因为某个原因迟迟无法做出决定。这个选择似乎折射出了更深层的某个问题。' },
  { key: 'pet_lost', name: '宠物走失', durationMin: 60, urgency: 1,
    desc: '你的宠物/一只熟悉的动物不见了！它可能只是顽皮躲起来了，也可能真的走丢了。你开始在附近寻找，同时心里越来越焦急。' },
  { key: 'cooking_disaster', name: '做饭翻车', durationMin: 90, urgency: 1,
    desc: '你尝试做一道菜，但事情走向了完全相反的方向——锅烧糊了、调料放错了、厨房一团糟。现在你不只是要做饭，还要处理这个小灾难。' },
  { key: 'cleanup_find', name: '大扫除发现', durationMin: 90, urgency: 1,
    desc: '在整理/打扫时，你翻出了一件被遗忘的旧物——可能是旧照片、信件、纪念品、或某个已经失去的时光的碎片。它勾起了你的回忆。' },
  { key: 'plant_accident', name: '种植意外', durationMin: 60, urgency: 1,
    desc: '你养的植物/花园里的植物出了状况——可能突然疯长、开出奇怪的花、枯萎得离奇、或是表现出某种无法解释的异常。这好像不是正常的园艺问题。' },
  { key: 'diy_fail', name: 'DIY翻车现场', durationMin: 90, urgency: 1,
    desc: '你信心满满地开始了一个DIY项目——修东西、组装家具、做手工艺品——但发现事情远比想象的复杂。现在是坚持还是放弃？' },
];

/**
 * 根据角色条件筛选可用的事件类型
 * 目前全部可用，后续可以根据好感度/标签过滤
 */
function getAvailableEventTypes(character, db) {
  // 后续可根据 character 的属性（如好感度、性格标签等）过滤事件池
  return EVENT_TYPES;
}

/**
 * 生成奇遇事件
 *
 * @param {object} character - 角色行
 * @param {object} [options] - 可选参数
 * @param {string} [options.eventTypeKey] - 指定事件类型 key（不指定则随机）
 * @param {boolean} [options.manual] - 是否为手动触发（调试用）
 */
export async function generateEvent(character, options = {}) {
  const db = getDb();
  const now = new Date();

  // 1. 选事件类型
  const available = getAvailableEventTypes(character, db);
  let eventType;
  if (options.eventTypeKey) {
    eventType = available.find(e => e.key === options.eventTypeKey);
    if (!eventType) throw new Error(`Unknown event type: ${options.eventTypeKey}`);
  } else {
    eventType = available[Math.floor(Math.random() * available.length)];
  }

  // 2. 并发保护：检查该角色是否已有活跃事件
  const existing = db.prepare(
    `SELECT id FROM character_events WHERE character_id = ? AND status IN ('pending','open','engaged') LIMIT 1`
  ).get(character.id);
  if (existing) {
    console.log(`[eventGen] ${character.display_name} already has an active event (id=${existing.id})`);
    throw new Error('ALREADY_ACTIVE_EVENT');
  }

  // 3. 构建上下文
  // 最近 1h 朋友圈
  const recentMoment = db.prepare(`
    SELECT content FROM moment_posts
    WHERE character_id = ? AND status = 'done'
      AND created_at >= datetime('now', '-1 hour')
    ORDER BY created_at DESC LIMIT 1
  `).get(character.id);

  // 角色关系网
  const relationships = db.prepare(`
    SELECT cr.relationship_text, c.display_name
    FROM character_relationships cr
    JOIN characters c ON c.id = cr.to_character_id
    WHERE cr.from_character_id = ? AND cr.relationship_text != ''
  `).all(character.id);

  // 4. 生成初始场景
  const jailbreakPrompt = getSystemRulesWithWorld({ roleplay: false }); // 不需要 <roleplay> 指令
  const imageRules = getGlobalRule('image_prompt');
  const imageRulesText = imageRules?.rule_content || '';

  const weekDay = ['周日','周一','周二','周三','周四','周五','周六'][now.getDay()];
  const timeTag = `[当前时间 ${weekDay} ${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}]`;

  let contextBlock = '';
  if (recentMoment) {
    contextBlock += `\n关联线索——${character.display_name}一小时前刚发了朋友圈："${recentMoment.content}"。事件素材可以与此呼应，提高关联性。\n`;
  }
  if (relationships.length > 0) {
    const relLines = relationships.map(r => `${character.display_name}是${r.display_name}的${r.relationship_text}`).join('；');
    contextBlock += `\n角色关系网：${relLines}。如果事件涉及多人互动，优先从关系网中选择对象。\n`;
  }

  const directorPrompt = `你是一个分镜导演，正在为角色「${character.display_name}」构思一个即将发生的"奇遇事件"——一段实时展开的故事片段。

这不是角色扮演，而是编剧创作。你需要在脑海中想象一个电影画面：镜头跟随着${character.display_name}，记录ta正在经历的事。

事件类型方向：**${eventType.name}**——${eventType.desc}
${contextBlock}
${timeTag}

请以第三人称（"${character.display_name}"或"ta"）创作这个事件的开场场景。要求：
- 场景长度 80-150 字，像一个电影分镜的开场，有画面感
- 给出两个明确的行动选项（A和B），以及一个自由输入的C选项
- 选项的好坏/后果可以不同，但都不要明显"找死"——保持合理的叙事张力`;

  const formatPrompt = `请严格按照以下 JSON 格式输出，不要任何解释或额外文字：

{"title":"事件标题（10字以内）","description":"场景叙述（第三人称，80-150字）","prompt":"画面描述（英文，描述场景、角色外观、动作、氛围。${imageRulesText ? imageRulesText.slice(0, 200) : '≥8个外观锚点，角色名用character(series)格式'}）","choiceA":"选项A文字（简短有力，8-20字）","choiceB":"选项B文字（简短有力，8-20字）","choiceCLabel":"自由选项标签（5-10字）"}`;

  const msgs = [
    { role: 'system', content: jailbreakPrompt },
    { role: 'system', content: character.base_prompt },
    { role: 'system', content: formatPrompt },
    { role: 'user', content: directorPrompt },
  ];

  let eventData;
  try {
    const result = await chatSync(msgs, { temperature: 0.85, max_tokens: 1024, label: '奇遇生成' });
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in LLM response');
    eventData = JSON.parse(jsonMatch[0]);
    // field 兼容：imagePrompt / prompt 两种写法都接受
    const imagePromptText = eventData.prompt || eventData.imagePrompt;
    if (!eventData.title || !eventData.description || !eventData.choiceA || !eventData.choiceB) {
      throw new Error('Incomplete event data from LLM');
    }
    eventData.prompt = imagePromptText;
  } catch (err) {
    console.error(`[eventGen] LLM generation failed for ${character.display_name}:`, err.message);
    eventData = {
      title: eventType.name,
      description: eventType.desc,
      prompt: `beautiful illustration, ${character.display_name} in an adventure scene, cinematic lighting`,
      choiceA: '迎难而上',
      choiceB: '谨慎观望',
      choiceCLabel: '自由发挥',
    };
  }

  // 5. 生图
  let imageUrl = null;
  try {
    const genResult = await generateImageRaw(eventData.prompt, {
      artist: config.comfyui.momentsArtist,
      width: config.comfyui.momentsWidth,
      height: config.comfyui.momentsHeight,
    });
    if (genResult.success && genResult.images.length > 0) {
      fs.mkdirSync(imagesDir, { recursive: true });
      const img = genResult.images[0];
      const filename = `event_${Date.now()}_${img.filename || 'comfy.png'}`;
      const base64Data = img.base64.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(path.join(imagesDir, filename), Buffer.from(base64Data, 'base64'));
      imageUrl = `/images/${filename}`;
      console.log(`[eventGen] Image generated for ${character.display_name}: ${imageUrl}`);
    } else {
      console.warn(`[eventGen] Image generation returned no images for ${character.display_name}`);
    }
  } catch (err) {
    console.error(`[eventGen] Image generation failed for ${character.display_name}:`, err.message);
    // 无图片也继续
  }

  // 6. 写入 DB — 初始场景作为 choice_history[0]
  const initialChoiceEntry = [{
    branch: 0,
    choice_label: '事件开始',
    choice_text: '',
    summary: eventData.description,
    image: imageUrl,
  }];
  const expiresAt = new Date(now.getTime() + eventType.durationMin * 60 * 1000).toISOString();

  const insertResult = db.prepare(`
    INSERT INTO character_events (character_id, event_type_key, status, title, description, image, prompt, style, resolution, choice_a, choice_b, choice_c_label, current_branch, max_branches, choice_history, expires_at)
    VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
  `).run(
    character.id,
    eventType.key,
    eventData.title,
    eventData.description,
    imageUrl,
    eventData.prompt,
    config.comfyui.momentsArtist,
    `${config.comfyui.momentsWidth}x${config.comfyui.momentsHeight}`,
    eventData.choiceA,
    eventData.choiceB,
    eventData.choiceCLabel || '自由发挥',
    JSON.stringify(initialChoiceEntry),
    toSQLite(expiresAt)
  );
  const eventId = insertResult.lastInsertRowid;

  // 7. 构建返回数据
  const event = db.prepare(`SELECT * FROM character_events WHERE id = ?`).get(eventId);

  // 8. SSE 广播
  broadcastNewEvent({
    id: event.id,
    character_id: event.character_id,
    display_name: character.display_name,
    avatar_path: character.avatar_path || null,
    title: event.title,
    description: event.description,
    image: event.image,
    choice_a: event.choice_a,
    choice_b: event.choice_b,
    choice_c_label: event.choice_c_label,
    expires_at: toISO(event.expires_at),
    created_at: toISO(event.created_at),
    current_branch: event.current_branch,
    choice_history: JSON.parse(event.choice_history || '[]'),
  });

  console.log(`[eventGen] Event created for ${character.display_name}: "${event.title}" (type=${eventType.key}, expires=${expiresAt})`);
  return event;
}

/**
 * 生成下一步分支
 */
export async function generateNextBranch(character, event, choice) {
  const db = getDb();
  const now = new Date();

  // 1. 检查是否过期
  const expiresAt = new Date(event.expires_at + 'Z');
  if (now >= expiresAt) {
    // 过期了，直接走到期结论流程
    await concludeEvent(character, event, event.engaged ? 'completed' : 'expired');
    return null;
  }

  // 2. 加载关系网
  const relationships = db.prepare(`
    SELECT cr.relationship_text, c.display_name
    FROM character_relationships cr
    JOIN characters c ON c.id = cr.to_character_id
    WHERE cr.from_character_id = ? AND cr.relationship_text != ''
  `).all(character.id);

  // 3. 构建 choice_history 文本
  const choiceHistory = JSON.parse(event.choice_history || '[]');
  let historyText = '';
  if (choiceHistory.length === 0) {
    historyText = `初始场景：${event.description}`;
  } else {
    historyText = choiceHistory.map((h, i) =>
      `第${i + 1}步：选择「${h.choice_label}」→ ${h.summary}`
    ).join('\n');
  }
  historyText += `\n当前用户选择：${choice.label}${choice.customText ? '——' + choice.customText : ''}`;

  // 4. LLM 生成下一步
  const jailbreakPrompt = getSystemRulesWithWorld({ roleplay: false });
  const imageRules = getGlobalRule('image_prompt');
  const imageRulesText = imageRules?.rule_content || '';

  const directorPrompt = `继续推进「${character.display_name}」的奇遇事件。

事件标题：${event.title}
${historyText}

角色关系网：${relationships.length > 0 ? relationships.map(r => `${character.display_name}是${r.display_name}的${r.relationship_text}`).join('；') : '无特殊关系'}

请以第三人称创作选择之后发生的下一个场景。要求：
- 场景长度 80-150 字，有画面感
- 给出新的A和B选项（不要和之前的选项重复，保持故事持续发展）`;

  const formatPrompt = `请严格按照以下 JSON 格式输出，不要任何解释或额外文字：

{"description":"选择后的场景叙述（第三人称，80-150字）","prompt":"画面描述（英文。${imageRulesText ? imageRulesText.slice(0, 200) : '描述场景、角色外观、动作、氛围'}）","choiceA":"新选项A","choiceB":"新选项B","choiceCLabel":"自由选项标签"}`;

  const msgs = [
    { role: 'system', content: jailbreakPrompt },
    { role: 'system', content: character.base_prompt },
    { role: 'system', content: formatPrompt },
    { role: 'user', content: directorPrompt },
  ];

  let branchData;
  try {
    const result = await chatSync(msgs, { temperature: 0.85, max_tokens: 1024, label: '奇遇分支' });
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in LLM response');
    branchData = JSON.parse(jsonMatch[0]);
    const branchPromptText = branchData.prompt || branchData.imagePrompt;
    if (!branchData.description) throw new Error('Incomplete branch data');
    branchData.prompt = branchPromptText || event.prompt;
  } catch (err) {
    console.error(`[eventGen] Branch generation failed:`, err.message);
    branchData = {
      description: `${character.display_name}${choice.label}。故事继续展开……`,
      prompt: event.prompt || `illustration of ${character.display_name} in an adventure scene`,
      choiceA: '继续前进',
      choiceB: '换一种方式',
      choiceCLabel: '自由发挥',
    };
  }

  // 5. 生图
  let imageUrl = null;
  try {
    const genResult = await generateImageRaw(branchData.prompt, {
      artist: config.comfyui.momentsArtist,
      width: config.comfyui.momentsWidth,
      height: config.comfyui.momentsHeight,
    });
    if (genResult.success && genResult.images.length > 0) {
      fs.mkdirSync(imagesDir, { recursive: true });
      const img = genResult.images[0];
      const filename = `event_${Date.now()}_${img.filename || 'comfy.png'}`;
      const base64Data = img.base64.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(path.join(imagesDir, filename), Buffer.from(base64Data, 'base64'));
      imageUrl = `/images/${filename}`;
      console.log(`[eventGen] Branch image generated: ${imageUrl}`);
    }
  } catch (err) {
    console.error(`[eventGen] Branch image generation failed:`, err.message);
  }

  // 6. 更新 choice_history 和 summary
  const newChoiceEntry = {
    branch: event.current_branch + 1,
    choice_label: choice.label,
    choice_text: choice.customText || '',
    summary: branchData.description,
    image: imageUrl,
  };
  choiceHistory.push(newChoiceEntry);

  // 生成运行中的摘要
  const summary = await generateRunningSummary(character, event, choiceHistory, branchData.description);

  // 7. 更新 DB
  db.prepare(`
    UPDATE character_events SET
      description = ?, image = ?, prompt = ?,
      choice_a = ?, choice_b = ?, choice_c_label = ?,
      current_branch = ?, choice_history = ?, summary = ?,
      engaged = 1, last_interaction_at = datetime('now')
    WHERE id = ?
  `).run(
    branchData.description, imageUrl, branchData.prompt,
    branchData.choiceA, branchData.choiceB, branchData.choiceCLabel || '自由发挥',
    event.current_branch + 1, JSON.stringify(choiceHistory), summary,
    event.id
  );

  // 8. 获取更新后的事件（事件只由时间到期结束）
  const updatedEvent = db.prepare(`SELECT * FROM character_events WHERE id = ?`).get(event.id);

  // 10. SSE 广播
  broadcastEventUpdate({
    id: updatedEvent.id,
    character_id: updatedEvent.character_id,
    display_name: character.display_name,
    avatar_path: character.avatar_path || null,
    title: updatedEvent.title,
    description: updatedEvent.description,
    image: updatedEvent.image,
    choice_a: updatedEvent.choice_a,
    choice_b: updatedEvent.choice_b,
    choice_c_label: updatedEvent.choice_c_label,
    current_branch: updatedEvent.current_branch,
    summary: updatedEvent.summary,
    choice_history: JSON.parse(updatedEvent.choice_history || '[]'),
    expires_at: toISO(updatedEvent.expires_at),
    created_at: toISO(updatedEvent.created_at),
  });

  return updatedEvent;
}

/**
 * 生成结局并存入记忆
 */
export async function concludeEvent(character, event, outcome) {
  const db = getDb();
  console.log(`[eventGen] Concluding event "${event.title}" for ${character.display_name} (engaged=${event.engaged}, outcome=${outcome})`);

  // 1. LLM 生成结局和摘要
  const permissionPrompt = getSystemRulesWithWorld();
  const choiceHistory = JSON.parse(event.choice_history || '[]');
  const historyText = choiceHistory.length > 0
    ? choiceHistory.map((h, i) => `第${i + 1}步：${h.choice_label} → ${h.summary}`).join('\n')
    : `角色经历了：${event.description}（未与用户互动）`;

  const taskPrompt = event.engaged
    ? `为以下奇遇事件生成结局叙述和记忆摘要。
事件标题：${event.title}
${historyText}
当前场景：${event.description}

要求：
- 结局叙述 80-150 字，收束整个事件的来龙去脉，给故事一个自然的结果
- 记忆摘要 150-300 字，用第三人称视角客观记录整个事件的起因、经过、转折和结果，作为角色长期记忆的一部分

**重要：输出严格 JSON 格式**
{"conclusion":"结局叙述","summary":"记忆摘要（第三人称，包含完整的事件经过）"}`
    : `角色刚刚经历了一场无人参与的特殊事件。请基于事件描述想象它会如何自然结束。
事件标题：${event.title}
${historyText}

要求：
- 结局叙述 80-150 字
- 记忆摘要 150-300 字，用第三人称视角客观记录事件

**重要：输出严格 JSON 格式**
{"conclusion":"结局叙述","summary":"记忆摘要（第三人称）"}`;

  const msgs = [
    { role: 'system', content: permissionPrompt },
    { role: 'system', content: character.base_prompt },
    { role: 'user', content: taskPrompt },
  ];

  let conclusionData;
  try {
    const result = await chatSync(msgs, { temperature: 0.7, max_tokens: 1024, label: '奇遇结局' });
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    conclusionData = JSON.parse(jsonMatch[0]);
    if (!conclusionData.summary) throw new Error('No summary generated');
  } catch (err) {
    console.error(`[eventGen] Conclusion generation failed:`, err.message);
    conclusionData = {
      conclusion: event.engaged
        ? `故事告一段落。${character.display_name}从这次经历中有所收获。`
        : `这个偶然的际遇悄然结束，没有留下太多痕迹。`,
      summary: `${character.display_name}经历了一场"${event.title}"——${event.description}。结局：${outcome === 'completed' ? '事件顺利完成。' : '事件因时间流逝而自然结束。'}`,
    };
  }

  // 2. 存入记忆
  // memory_fragments CHECK 约束只允许 fact/preference/emotion，事件摘要用 'fact' 存储
  const conversationId = `char_${character.id}`;
  const fragmentType = 'fact';

  try {
    const entities = JSON.stringify([character.display_name, event.title]);

    if (!event.engaged) {
      // 临时单槽：删除旧的未互动事件记忆再插入新的
      db.prepare(`
        DELETE FROM memory_fragments
        WHERE conversation_id = ? AND fragment_type = 'fact' AND content LIKE '【未互动的奇遇】%'
      `).run(conversationId);
      console.log(`[eventGen] Replaced old unengaged event memory for ${character.display_name}`);
    }

    const summaryWithTag = event.engaged
      ? `【奇遇·已完成】${conclusionData.summary}`
      : `【未互动的奇遇】${conclusionData.summary}`;

    const insertResult = db.prepare(`
      INSERT INTO memory_fragments (conversation_id, fragment_type, content, entities)
      VALUES (?, ?, ?, ?)
    `).run(conversationId, fragmentType, summaryWithTag, entities);

    // 向量化
    try {
      await upsertVector({
        id: `event_${insertResult.lastInsertRowid}`,
        text: summaryWithTag,
        metadata: {
          conversation_id: conversationId,
          fragment_type: 'event',
          character_name: character.display_name,
          event_title: event.title,
          engaged: event.engaged,
        },
      });
    } catch (vecErr) {
      console.warn(`[eventGen] Vector upsert failed for event memory:`, vecErr.message);
    }
  } catch (memErr) {
    console.error(`[eventGen] Memory save failed:`, memErr.message);
  }

  // 3. 移到 event_history
  db.prepare(`
    INSERT INTO event_history (character_id, event_type_key, title, description, final_image, summary, choice_history, total_branches, engaged, outcome)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    character.id, event.event_type_key,
    event.title, event.description, event.image,
    conclusionData.summary,
    event.choice_history, event.current_branch || 0,
    event.engaged, outcome
  );

  // 4. 删除活跃事件
  db.prepare(`DELETE FROM character_events WHERE id = ?`).run(event.id);

  // 5. SSE 广播
  broadcastEventConclusion({
    character_id: character.id,
    character_name: character.display_name,
    event_title: event.title,
    conclusion: conclusionData.conclusion,
    summary: conclusionData.summary,
    outcome,
    engaged: event.engaged,
  });

  console.log(`[eventGen] Event concluded: "${event.title}" → ${outcome}`);
}

/**
 * 生成运行中的事件摘要（每步更新）
 */
async function generateRunningSummary(character, event, choiceHistory, latestDescription) {
  const historyText = choiceHistory.map((h, i) =>
    `第${i + 1}步：选择「${h.choice_label}」→ ${h.summary}`
  ).join('\n');

  // 用 LLM 压缩摘要
  const taskPrompt = `请将以下奇遇事件进度归纳为一句话摘要（30-60字），用第三人称：

事件标题：${event.title}
进展：
${historyText}

只输出摘要文本，不要引号或解释。`;

  try {
    const result = await chatSync([
      { role: 'user', content: taskPrompt },
    ], { temperature: 0.3, max_tokens: 128, label: '奇遇摘要' });
    return result.trim();
  } catch {
    // 兜底：用最新的描述作为摘要
    return `${character.display_name}正在经历"${event.title}"，最近的发展是：${latestDescription.slice(0, 60)}`;
  }
}

// ── 工具函数 ──

function toSQLite(iso) {
  if (!iso) return iso;
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
}

function toISO(dt) {
  if (!dt) return dt;
  return dt.replace(' ', 'T') + '.000Z';
}
