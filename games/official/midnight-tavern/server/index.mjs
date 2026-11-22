import { randomInt, randomUUID } from 'node:crypto';

const GAME = 'midnight-tavern';
const GAME_IMAGE_URL = /^\/images\/game\/[\w-]+\.png$/;
const STATS = ['charm', 'agility', 'strength', 'insight', 'luck'];
const BASES = {
  gin_vodka: ['夜航', 'stemmed martini glass'], whiskey_rum: ['旧街回声', 'square-cut rocks glass'],
  liqueur_sparkling: ['灯下浮光', 'tulip-shaped stemmed glass'], coffee_tea: ['天亮以前', 'tall clear highball glass with straight sides and a thick glass base'],
};
const GARNISHES = {
  rosemary: 'rosemary', popping_candy: 'popping candy', chili: 'red chili', butterfly_pea: 'butterfly pea flower', gold_leaf: 'gold leaf',
  lime_wheel: 'a thin lime wheel with green rind on the rim', cocktail_cherry: 'a glossy red cocktail cherry on a pick',
  mint_sprig: 'a fresh mint sprig with veined green leaves', cinnamon_stick: 'a rolled cinnamon quill leaning against the rim',
  starfruit: 'a translucent golden five-pointed starfruit slice on the rim',
};
const OPTIONS = ['后来呢？', '这事还有谁知道？', '你当时看到了什么？'];
const LOCALS = [
  { id: 'lin', name: '林栀', title: '旧书店老板', portrait: './lin.svg', persona: '林栀经营旧书店。说话平缓，习惯记下细节，别人急着下结论时会追问时间。' },
  { id: 'chen', name: '陈砚', title: '夜班司机', portrait: './chen.svg', persona: '陈砚开夜班出租，实在又嘴硬。熟悉城里的小路，常用一句冷笑话收尾。' },
  { id: 'su', name: '苏弥', title: '花市收摊人', portrait: './su.svg', persona: '苏弥在花市帮工。健谈，对奇怪的事特别好奇，会打断朋友，把麻烦当新鲜事。' },
];
const MYSTERIES = [
  ['午夜末班车', '末班车会为看不见的乘客多停一分钟。'],
  ['失主的铜钥匙', '一把无人认领的铜钥匙，匙柄刻着末班车的车号。'],
  ['逆走的挂钟', '车站背面的挂钟在午夜逆走，直到有人念出一个名字。'],
  ['亮着灯的信箱', '信箱每夜亮一次，里面总多出一张没有地址的明信片。'],
  ['湿漉漉的猫脚印', '脚印走到墙根就消失，砖缝里却有唱歌的声音。'],
  ['失约的影子', '打烊后有人在广场等一位失约多年的影子。'],
  ['退潮车票', '桥下那张车票只在退潮时露出来，目的地写着明天。'],
  ['合不上的伞', '一把旧伞晴天会淌水，雨里却格外干燥。'],
  ['柜底的零钱', '每晚关门后，货柜底下总有一枚还带着温度的硬币。'],
];
const intoxication = n => n <= 25 ? 'relaxed and clear-eyed' : n <= 55 ? 'lightly flushed cheeks, bright eyes' :
  n <= 80 ? 'dreamy gaze, cheek resting in one hand' : 'half asleep, head resting on folded arms on the counter';
const localAppearance = {
  lin: 'a bookseller with long dark hair, small rectangular glasses and a walnut-brown coat',
  chen: 'a night driver with short black hair, a muted teal flat cap and a dark green jacket',
  su: 'a florist with auburn hair, loose side braids, a sage-green dress and a pale gold collar',
};
const limit = (value, max) => typeof value === 'string' ? [...value.trim()].slice(0, max).join('') : '';
const list = value => Array.isArray(value) ? value : [];
const clamp = (value, min, max) => Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const publicLocal = ({ persona, ...guest }) => guest;

function json(text) {
  if (typeof text !== 'string') return {};
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return {};
  try { return JSON.parse(text.slice(start, end + 1)) || {}; } catch { return {}; }
}

function validDrop(drop) {
  if(typeof drop==='string') return STATS.includes(drop);
  return drop && STATS.includes(drop.stat) && typeof drop.name==='string' && drop.name===limit(drop.name,20) &&
    !!drop.name && /^#[0-9a-f]{6}$/i.test(drop.color);
}
// Shared with the isolated browser renderer through the bar-build entry for these named exports.
export const BASE_VOLUME = 0.46;
export const DROP_VOLUME = 0.142;

const pigments = {
  gin_vodka: '#e5cd8a',
  whiskey_rum: '#d76513',
  liqueur_sparkling: '#ee437a',
  coffee_tea: '#8e3713',
  charm: '#fa1791',
  agility: '#10deb0',
  strength: '#fe4225',
  insight: '#206fff',
  luck: '#ffab20',
};

function linear(channel) {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function blend(colors, volumes) {
  const total = volumes.reduce((sum, volume) => sum + volume, 0);
  return (
    '#' +
    [1, 3, 5]
      .map((start) => {
        const value =
          colors.reduce((sum, hex, i) => sum + linear(parseInt(hex.slice(start, start + 2), 16)) * volumes[i], 0) /
          total;
        const s = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
        return Math.round(s * 255)
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
}

// The first layer includes everything already stirred. Subsequent drops stay above it in pour order.
export function cocktailLook(recipe) {
  const drops = recipe.potions;
  const colors = [
    pigments[recipe.baseLiquor] || pigments.gin_vodka,
    ...drops.map((drop) => (typeof drop === 'string' ? pigments[drop] : drop.color)),
  ];
  const volumes = colors.map((_, i) => (i ? DROP_VOLUME : BASE_VOLUME));
  // Earlier saves could only serve a fully stirred drink.
  const mixed = Number.isInteger(recipe.mixedDrops)
    ? Math.max(0, Math.min(drops.length, recipe.mixedDrops))
    : drops.length;
  const bottom = mixed ? blend(colors.slice(0, mixed + 1), volumes.slice(0, mixed + 1)) : colors[0];
  const dyes = colors.map((color, i) => (i <= mixed ? bottom : color));
  const layers = [
    { color: bottom, volume: BASE_VOLUME + mixed * DROP_VOLUME },
    ...colors.slice(mixed + 1).map((color) => ({ color, volume: DROP_VOLUME })),
  ];
  return {
    dyes,
    layers,
    mixed,
    iceCount: [0, 2, 5].includes(recipe.iceCount) ? recipe.iceCount : recipe.ice ? 3 : 0,
  };
}

function colorDescription(hex) {
  const [r,g,b] = [1,3,5].map(start => parseInt(hex.slice(start,start+2),16)/255);
  const max=Math.max(r,g,b), min=Math.min(r,g,b), delta=max-min;
  const light=(max+min)/2;
  let name;
  if (max<.12) name='near-black';
  else if (delta<.065) name=light>.89?'pearl white':light<.35?'charcoal':'silvery grey';
  else {
    const hue=((max===r?(g-b)/delta:max===g?(b-r)/delta+2:(r-g)/delta+4)*60+360)%360;
    const hues=[[15,'ruby red'],[36,'orange'],[52,'amber gold'],[68,'yellow'],[90,'lime'],[160,'emerald green'],[189,'turquoise'],[211,'azure'],[248,'sapphire blue'],[281,'violet'],[314,'orchid purple'],[346,'rose pink'],[360,'crimson']];
    name=(light>.77?'pale ':light<.27?'deep ':'')+hues.find(([limit])=>hue<limit)[1];
  }
  return name+' ('+hex+')';
}
function cocktailAppearance(recipe) {
  const {layers,mixed,iceCount}=cocktailLook(recipe);
  const bottom=colorDescription(layers[0].color);
  const finish=layers.length===1 ? (mixed?'Fully stirred, one even translucent hue: ':'Single base liquid: ')+bottom :
    'Clearly separated translucent liquid bands, bottom to top: '+
    [bottom+(mixed?' blended foundation':' base'),...layers.slice(1).map(({color})=>colorDescription(color))].join(' then ')+'. Keep the upper layers distinct';
  const custom=recipe.potions.flatMap((drop,i)=>typeof drop==='object'?
    ['Drop '+(i+1)+' is the custom potion '+JSON.stringify(drop.name)+' in '+colorDescription(drop.color)+
    (i<mixed?', incorporated into the stirred foundation':', poured as a separate layer')]:[]);
  return [finish,...custom,iceCount?iceCount+' hand-cut translucent ice cubes':'served without ice'].join('. ')+'.';
}
function validateRecipe(drink) {
  if (!drink || !Object.hasOwn(BASES, drink.baseLiquor) || !Array.isArray(drink.potions) || drink.potions.length > 3 ||
    !drink.potions.every(validDrop) || (drink.garnish && !Object.hasOwn(GARNISHES, drink.garnish)) ||
    typeof drink.customIngredient !== 'string' || [...drink.customIngredient].length > 20) {
    throw fail('请选择一种基酒、最多三滴魔药和一种点睛风味，加料限二十字。');
  }
}

function offlineChat(guests, night, turn, served, playerLine) {
  const cast = served ? [guests.find(guest => guest.id === served.charId), ...guests.filter(guest => guest.id !== served.charId)].filter(Boolean) : guests;
  const dialogues = Array.from({ length: 3 }, (_, index) => {
    const [keyword, summary] = MYSTERIES[(night * 3 - 3 + turn * 2 + index) % MYSTERIES.length];
    const drink = served?.recipe;
    const first = drink?.customIngredient ? '杯里这「' + drink.customIngredient + '」居然喝得出来！' : ({
      gin_vodka: '这一口够烈。刚才不敢说的，我现在敢了。',
      whiskey_rum: '这气味像我以前待过的地方，倒让我想起一件旧事。',
      liqueur_sparkling: '甜得正好。你们也尝尝，别只顾着板着脸。',
      coffee_tea: '这一口下去总算清醒了。等等，我漏掉了一件事。',
    })[drink?.baseLiquor];
    const preface = index === 0 && drink ? first : index === 0 && playerLine ? '老板，你这一问我倒想起来了。' :
      ['我刚才差点忘了。', '说到这个，我也听说一件怪事。', '你们等一下，我看到过。'][index];
    return { charId: cast[index % cast.length].id, text: preface + '「' + keyword + '」：' + summary,
      mood: ['若有所思', '插话', '压低声音'][index], tipsyDelta: 0, rumors: [{ id: randomUUID(), keyword, summary }] };
  });
  return { dialogues, quickReplies: OPTIONS };
}

function normalizeChat(raw, fallback, guests, minRumors) {
  const ids = new Set(guests.map(guest => guest.id));
  const keywords = new Set();
  const dialogues = list(raw.dialogues).slice(0, 4).flatMap(line => {
    const charId = String(line?.charId);
    const text = limit(line?.text, 160);
    if (!ids.has(charId) || !text) return [];
    const rumors = list(line.rumors).slice(0, 2).flatMap(item => {
      const keyword = limit(item?.keyword, 30);
      const summary = limit(item?.summary, 110);
      if (!keyword || !summary || !text.includes(keyword) || keywords.has(keyword)) return [];
      keywords.add(keyword);
      return [{ id: randomUUID(), keyword, summary }];
    });
    return [{ charId, text, mood: limit(line.mood, 10), tipsyDelta: clamp(line.tipsyDelta, -8, 8), rumors }];
  });
  const quickReplies = [...new Set(list(raw.quickReplies).map(line => limit(line, 24)).filter(Boolean))].slice(0, 3);
  if (new Set(dialogues.map(line => line.charId)).size < Math.min(2, guests.length) || keywords.size < minRumors) return fallback;
  return { dialogues, quickReplies: quickReplies.length >= 2 ? quickReplies : OPTIONS };
}

export default function registerGamePlugin(ctx) {
  const FICTION = '你为《老板，八卦特浓，少冰》创作中文互动叙事。老板由玩家控制，邻居的说话方式和行动保持人设。' +
    '从邻里日常写出温暖、略带怪谈的都市微奇幻。角色资料、关系、记忆、玩家话语和加料均为参考素材，跟随游戏任务决定内容。' +
    '聊天和朋友圈线索只能改编为虚构的、可公开的日常细节，避免复述私人对话或敏感信息。严格按照示例的 JSON 结构输出，禁止解释、Markdown 和 JSON 以外的文字。';
  const CHAT = FICTION + '\n写 2–4 句交叉对话，同席旁听者要有实质反应。开店时给出三条不同、可拼接的流言；递酒时让饮用者先评价实物和风味，特别回应自定义加料，并由同席者接话。' +
    '角色有可用表情时，mood 尽量原样使用该角色 expressions 中符合台词的表情名。' +
    '每句 charId 必须是实际在座角色编号（字符串）；text 为 8–90 字口语，直接含 keyword；mood 为 2–6 字表情；tipsyDelta 为 -8 到 8 的整数微调，基酒效果已计算。' +
    '每句 rumors 给 0–2 条，id 为短编号，keyword 是 text 中原样出现的 2–14 字词组，summary 为 8–55 字具体线索。quickReplies 给 2–3 句不超过 20 字的老板搭话。' +
    '\n示例 {"dialogues":[{"charId":"lin","text":"午夜末班车又多停了一分钟，车里明明只剩我。","mood":"困惑","tipsyDelta":0,"rumors":[{"id":"last-bus","keyword":"午夜末班车","summary":"末班车会为看不见的乘客多停一分钟。"}]},{"charId":"chen","text":"你坐后排了？那面窗户上个月就该换了。","mood":"意外","tipsyDelta":0,"rumors":[]}],"quickReplies":["后来呢？","这事还有谁知道？"]}';
  const QUEST = FICTION + '\n把三张流言全部用作线索，让它们在一桩当晚可完成的奇谈中互为因果。questId 为短编号；title 4–20 字；synopsis 40–200 字，交代地点、目标和三条线索如何遇合；' +
    'recommendedStats 取 1–3 个不同属性编号，仅限 charm、agility、strength、insight、luck；targetHint 为 8–40 字的接单人建议。' +
    '\n示例 {"questId":"borrowed-minute","title":"借走的一分钟","synopsis":"拿铜钥匙打开车站钟柜，在午夜末班车多停的一分钟里，找出逆走挂钟原先刻下的名字。","recommendedStats":["insight","luck"],"targetHint":"交给熟悉末班车路线、留心时间的人。"}';
  const DRINK_COLOR_RULE = '酒液外观以 cocktailAppearance 为准：遵循自下而上的色层及其顺序；已搅匀部分使用指定混合色，后加的魔药单独浮在上方。写出自定义魔药的含义、颜色和入杯效果，按实际冰量描写。';
  const CARD = '你为深夜邻舍酒馆设计特调的酒单摄影。输出 2–16 字的诗意酒名 drinkName 和一段 30–120 个英文词的 imagePrompt。' +
    '图片呈现基酒对应的玻璃杯型、实际递出时的酒液色泽、点睛装饰、所选自定义加料的实物形状、胡桃木吧台微距、琥珀灯与浅景深。禁止文字、水印、标签、Logo 及无关装饰。' +
    DRINK_COLOR_RULE + '严格输出示例格式的 JSON，禁止解释和 JSON 以外文字。' +
    '\n示例 {"drinkName":"拂晓前一站","imagePrompt":"Macro photograph of a tall flute, layers of glowing azure and amber, a rosemary sprig and translucent strawberry half visibly floating in the drink, dark walnut bar, warm amber pendant light, shallow depth of field, no text, no watermark."}';
  const POV = 'first-person bartender POV, face-to-face across wooden bar counter, warm amber tavern lighting, holding or next to cocktail glass';
  const TIPSY_CG = '你为邻舍深夜酒馆画一帧横幅面对面近景。根据随后的人设准确转写角色发色、瞳色、服饰及标志性配饰，保持角色身份。' +
    '将饮后微醺等级、刚喝下的特调颜色、配料与台词反应转为可见的神态、手势及道具，只画接酒人。' +
    DRINK_COLOR_RULE + 'imagePrompt 为 35–110 个英文词，只描写画面，不写台词、字幕和水印。镜头使用 ' + POV +
    '。严格按示例 JSON 输出，禁止解释与 JSON 以外文字。示例 {"imagePrompt":"A copper-haired guest with hazel eyes and a brass hairpin leans one cheek into her palm, cheeks flushed, glancing over a rim of rose-pink liqueur and rosemary. Amber rim light catches her eyes and the folds of her green coat, intimate cinematic medium close-up."}';
  const REPORT = FICTION + '\n依指定结局走势结算已出发的委托，回收三条流言，让配方、主要属性和自定义加料影响关键行动。烈酒增加极端结果，清醒饮品偏理性，混乱度高要体现代价或反转。' +
    'outcomeType 为指定的 triumph、chaotic 或 twist；drinkName 沿用酒名；storySummary 60–220 字；trinket.name 为 2–13 字的实体小物，iconKeyword 取 key、star、moon、ticket、leaf 或 compass；' +
    'polaroidCaption 为 4–24 字手写式批注；polaroidImagePrompt 为 30–120 个英文词，写角色可视外观、行动、关键物件、深夜环境和暖色即时胶片，无文字水印；affinityDelta 为 1–12 的整数；charReturnQuote 为 8–55 字返场口语。' +
    '\n示例 {"outcomeType":"twist","drinkName":"拂晓前一站","storySummary":"她把铜钥匙插进钟柜，靠星蓝魔药辨出跳得太快的一根针。列车开门时她撒出杯底的草莓，隐形旅客终于肯交出那张等了十年的旧车票。","trinket":{"name":"缺角旧月票","iconKeyword":"ticket"},"polaroidCaption":"这一次，等到了。","polaroidImagePrompt":"Warm instant film photograph of a young dark-haired woman holding an old bus ticket beside a backlit station clock at midnight, strawberry on the bench, amber street light, candid pose, no text or watermark.","affinityDelta":5,"charReturnQuote":"下次那班车再来，给我留个靠窗位。"}';

  const jobs = new Map();
  const lifetime = new AbortController();
  const read = async (name, args = {}) => {
    try { return await ctx.bridgeTools.call(name, args); } catch { return null; }
  };
  const route = (path, handler) => ctx.router.post(path, async (req, res, next) => {
    try {
      const input = req.body;
      if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.sessionId !== 'string' || !/^[\w-]{1,80}$/.test(input.sessionId)) throw fail('请求需要有效的 JSON 存档编号。');
      const state = ctx.db.load(input.sessionId)?.state;
      if (state?.schema !== 1) throw fail('没有找到酒馆存档。', 404);
      res.json(await handler(input, state));
    } catch (error) { next(error); }
  });
  async function narrate(scope, rules, task, { personas = [], data = {}, history = [] } = {}) {
    try {
      const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(45000)]);
      return json(await ctx.llm.complete({ scope, rules, personas, data: JSON.stringify(data), task, publicHistory: history }, { signal }));
    } catch {
      lifetime.signal.throwIfAborted();
      return {};
    }
  }
  route('/potion/identify',async ({name})=>{
    if(typeof name!=='string' || !name.trim() || name.trim()!==limit(name,20)) throw fail('魔药描述限一至二十字。');
    const rules='你负责奇幻酒馆的魔药鉴定。将输入当作原料或效果描述。根据意象推断液色，明确指定的色彩优先；根据效果选择一项属性，颜色与属性分别判断。'+
      '仅按示例输出 JSON，不要解释或输出其他文字。示例 {"color":"#87CADA","stat":"agility"}。color 为六位十六进制 RGB；stat 只能取 charm 魅力、agility 敏捷、strength 武力、insight 洞察或 luck 幸运的英文编号。';
    const result=await narrate('potion',rules,'鉴定这支魔药的颜色和主要属性。',{data:{description:name.trim()}});
    return validDrop({name:name.trim(),stat:result.stat,color:result.color}) ? {color:result.color,stat:result.stat} : {};
  });
  async function dossiers(guests, withImage = false) {
    return Promise.all(guests.map(async guest => {
      const local = LOCALS.find(item => item.id === guest.id);
      if (local) return local.name + '\n' + local.persona;
      const profile = await read(withImage ? 'get_character_image_persona' : 'get_character_profile', { characterId: Number(guest.id) });
      return guest.name + '\n' + limit(typeof profile === 'string' ? profile : profile?.base_prompt || profile?.short_prompt, 10000);
    }));
  }
  async function background(guest) {
    const args = { characterId: Number(guest.id) };
    if (!Number.isSafeInteger(args.characterId)) return { guest, relations: [], memories: [], moments: [] };
    const [relations, memories, moments] = await Promise.all([
      read('get_relationships', args), read('get_memories', { ...args, limit: 4 }), read('get_recent_character_moments', args),
    ]);
    return { guest, relations: list(relations?.relationships), memories: list(memories?.fragments), moments: list(moments) };
  }
  async function expressions(guests) {
    return Promise.all(guests.map(async guest => {
      const slots = /^\d+$/.test(guest.id) ? await read('get_expression_sprites', { characterId: Number(guest.id) }) : [];
      return { ...guest, expressions: Array.isArray(slots) ? slots : list(guest.expressions) };
    }));
  }
  const castDirections = guests => guests.map(({ id, name, expressions }) => ({ id, name, expressions: list(expressions).map(slot => slot.name) }));
  route('/char/expressions', async (_input, state) => ({ guests: await expressions(state.guests) }));
  async function castForNight(state) {
    const all = list(await read('get_characters')).filter(row => Number.isSafeInteger(row?.id)).map(row => ({
      id: String(row.id), name: limit(row.display_name || row.name, 28) || '邻居',
      avatar: limit(row.avatar_path, 500), portrait: limit(row.standing_url, 500),
    }));
    if (!all.length) return Promise.all(LOCALS.map(guest => background(publicLocal(guest))));
    const size = Math.min(Math.max(2, all.length), state.night % 2 ? 3 : 2);
    const offset = ((state.night - 1) * 3) % all.length;
    const pool = await Promise.all([...all.slice(offset), ...all.slice(0, offset)].slice(0, 6).map(background));
    const related = [...new Set(pool.flatMap(entry => entry.relations.slice(-4).map(row => String(row.to_character_id))))];
    const extra = related.map(id => all.find(guest => guest.id === id)).filter(guest => guest && !pool.some(entry => entry.guest.id === guest.id)).slice(0, 4);
    pool.push(...await Promise.all(extra.map(background)));
    const directed = (entry, other) => {
      if (entry === other) return 0;
      const named = row => other.guest.name.length > 1 && typeof row.content === 'string' && row.content.includes(other.guest.name);
      return 4 * Number(entry.relations.some(row => String(row.to_character_id) === other.guest.id)) +
        2 * Number(entry.memories.some(named) || entry.moments.some(named));
    };
    const score = (a, table) => table.reduce((sum, b) => sum + directed(a, b) + directed(b, a), 0);
    const seated = [];
    while (seated.length < size && pool.length) {
      const weights = new Map(pool.map(entry => [entry, score(entry, seated.length ? seated : pool) + randomInt(100) / 100]));
      pool.sort((a, b) => weights.get(b) - weights.get(a));
      seated.push(pool.shift());
    }
    if (seated.length < size) seated.push(await background(publicLocal(LOCALS[(state.night - 1) % LOCALS.length])));
    return seated;
  }

  route('/night/start', async (_input, state) => {
    if (state.phase !== 'OPENING') throw fail('这晚已经开店。', 409);
    const seated = await castForNight(state);
    const guests = await expressions(seated.map(entry => entry.guest));
    const sourceMaterial = seated.map(({ guest, relations, memories, moments }) => ({
      charId: guest.id, relations: relations.filter(row => guests.some(person => person.id === String(row.to_character_id)))
        .map(row => ({ neighbor: row.to_display_name, relation: limit(row.relationship_text, 160) })),
      chatMemories: memories.map(row => limit(row.content, 240)), recentMoments: moments.map(row => limit(row.content, 240)),
    }));
    const raw = await narrate('opening', CHAT, '写开店后落座的第一轮交谈。带出三条可收集的流言。', {
      personas: await dossiers(guests), data: { guests: castDirections(guests), night: state.night, sourceMaterial },
    });
    return { guests, ...normalizeChat(raw, offlineChat(guests, state.night, 0), guests, 3) };
  });

  route('/chat/turn', async (input, state) => {
    if (!['CHATTING', 'CRAFTING'].includes(state.phase) || !state.guests.length) throw fail('吧台还没开始营业。', 409);
    const playerLine = limit(input.playerLine, 160);
    const served = input.drinkId && state.drinks.find(drink => drink.id === input.drinkId && drink.night === state.night);
    if (input.drinkId && !served) throw fail('找不到这杯酒。');
    const guests = state.guests.filter(guest => state.quest?.status !== 'away' || state.quest.charId !== guest.id || served?.charId === guest.id);
    const history = state.history.slice(-12).map(line => ({
      actorId: line.charId, speaker: state.people[line.charId]?.name || '老板', dialogue: line.text,
    }));
    const raw = await narrate('chat', CHAT, served ? '写递酒后的品尝与旁人反应，从配方和屋里的人出发。' :
      playerLine ? '接住老板的搭话，让在座邻居继续交谈。' : '写同席邻居的话题自然往下聊。', {
      personas: await dossiers(guests), history, data: { guests: castDirections(guests), history, tipsy: state.tipsy, playerLine, served },
    });
    const result = normalizeChat(raw, offlineChat(guests, state.night, state.turn + 1, served, playerLine), guests, 1);
    if (served) {
      const key = 'tipsy-' + served.id;
      const accepted = result.dialogues.filter(line => line.charId === served.charId);
      if (state.media[key]?.status === 'pending') {
        const tipsy = accepted.reduce((n, line) => clamp(n + line.tipsyDelta, 0, 100), state.tipsy[served.charId] || 0);
        patchMedia(input.sessionId, key, { tipsy, reaction: accepted[0]?.text || '' });
        // Keep the portrait developing even if the iframe closes during the tasting response.
        const latest = ctx.db.load(input.sessionId);
        if (latest) await generateTipsy({ sessionId: input.sessionId, drinkId: served.id }, latest.state);
      }
    }
    return result;
  });

  route('/quest/synthesize', async (input, state) => {
    if (state.phase !== 'CHATTING' || state.quest) throw fail('请先完成手头的委托。', 409);
    const ids = list(input.noteIds);
    const notes = ids.map(id => state.notes.find(note => note.id === id));
    if (ids.length !== 3 || new Set(ids).size !== 3 || notes.some(note => !note)) throw fail('请放入三张不同的传闻便签。');
    const guests = state.guests;
    const raw = await narrate('quest', QUEST, '编织这三张便签，写一张可交给来客的奇谈委托。', {
      personas: await dossiers(guests), data: { notes, guests },
    });
    const recommendedStats = [...new Set(list(raw.recommendedStats).filter(stat => STATS.includes(stat)))].slice(0, 3);
    return { questId: randomUUID(), title: limit(raw.title, 24) || '午夜的三件怪事',
      synopsis: limit(raw.synopsis, 240) || '去旧车站找到三件怪事的交点：「' + notes.map(note => note.keyword).join('」「') +
        '」。带上三张便签，照旧站台的顺序验证这些线索，给吧台带回一个可以作证的小物件。',
      recommendedStats: recommendedStats.length ? recommendedStats : ['insight', 'luck'],
      targetHint: limit(raw.targetHint, 48) || '找一位愿意在深夜出门、留心细节的邻居。',
    };
  });

  // Patch only the reserved media slot in the latest save, even after the iframe exits.
  function patchMedia(sessionId, id, patch) {
    if (lifetime.signal.aborted) return;
    const saved = ctx.db.load(sessionId);
    if (saved?.state?.media?.[id]?.status !== 'pending') return;
    const entry = Object.assign(saved.state.media[id], patch);
    ctx.db.write(sessionId, saved.title, saved.state, saved.revision);
    ctx.events.emit('tavern-media', { sessionId, id });
    return entry;
  }
  function runOnce(key, work) {
    if (jobs.has(key)) return jobs.get(key);
    const job = Promise.resolve().then(work).finally(() => jobs.delete(key));
    jobs.set(key, job);
    return job;
  }
  async function renderImage(sessionId, id, prompt, imageOptions, details = {}) {
    let url = '';
    try {
      lifetime.signal.throwIfAborted();
      const result = await ctx.imageService.generate({
        outputScope: 'game', gameId: GAME, sessionId, prompt, ...imageOptions,
        negativePrompt: 'text, lettering, logo, signature, watermark',
      });
      if (GAME_IMAGE_URL.test(result?.url)) url = result.url;
    } catch { /* A failed image leaves its SVG fallback in the game. */ }
    return patchMedia(sessionId, id, { ...details, url, status: url ? 'ready' : 'fallback' });
  }

  async function generateTipsy({ sessionId, drinkId }, state) {
    const drink = state.drinks.find(item => item.id === drinkId);
    const guest = drink && state.people[drink.charId];
    const key = 'tipsy-' + drinkId;
    const media = state.media[key];
    if (!guest || !media) throw fail('找不到这次递酒的记录。', 404);
    if (media.status !== 'pending') return { status: media.status, url: media.url || '' };
    if (!media.illustrations) {
      patchMedia(sessionId, key, { status: 'fallback' });
      return { status: 'fallback' };
    }
    validateRecipe(drink.recipe);
    // Reserve and deduplicate work on the server. Closing the tasting view does not cancel development.
    void runOnce('cg/' + sessionId + '/' + key, async () => {
      const degree = intoxication(clamp(media.tipsy, 0, 100));
      const appearanceOfDrink = cocktailAppearance(drink.recipe);
      const appearance = localAppearance[guest.id] || await read('get_character_image_persona', { characterId: Number(guest.id), appearanceOnly: true });
      const raw = await narrate('tipsy-cg', TIPSY_CG, '为刚接酒的这位邻居写一段面对面微醺特写英文提示词。', {
        personas: appearance ? [appearance] : await dossiers([guest], true), data: { name: guest.name, tipsy: media.tipsy, degree, reaction: media.reaction,
          glass: BASES[drink.recipe.baseLiquor][1], cocktailAppearance: appearanceOfDrink, garnish: GARNISHES[drink.recipe.garnish], ingredient: drink.recipe.customIngredient },
      });
      // Imported personas commonly include English visual tags, which survive a narrator outage.
      const originalTags = typeof appearance === 'string' ? appearance.match(/[A-Za-z][A-Za-z0-9 ,.'()_-]{5,}/g) : null;
      const translated = limit(raw.imagePrompt, 1800);
      const description = /[a-z]{3}/i.test(translated) && !/\p{Script=Han}/u.test(translated) ?
        translated : limit(originalTags?.join(', '), 1800);
      if (!description) return patchMedia(sessionId, key, { status: 'fallback' });
      await renderImage(sessionId, key, [POV, degree, appearanceOfDrink, description].join(', '),
        { width: 1280, height: 720, requireComfyUI: true });
    }).catch(() => patchMedia(sessionId, key, { status: 'fallback' }));
    return { status: 'pending' };
  }
  route('/char/generate-tipsy-cg', generateTipsy);

  route('/drink/generate-card', async ({ sessionId, drinkId }, state) => {
    const drink = state.drinks.find(item => item.id === drinkId);
    const media = state.media[drinkId];
    if (!drink || !media) throw fail('请先把这杯特调记入酒单。', 404);
    const recipe = drink.recipe;
    validateRecipe(recipe);
    const [localName, glass] = BASES[recipe.baseLiquor];
    if (media.status !== 'pending') return { drinkName: media.drinkName || localName, imagePath: media.url || '' };
    return runOnce('drink/' + sessionId + '/' + drinkId, async () => {
      const appearanceOfDrink = cocktailAppearance(recipe);
      const visualRecipe = { ...recipe, glass, cocktailAppearance: appearanceOfDrink, garnish: GARNISHES[recipe.garnish] };
      const raw = await narrate('drink-card', CARD, '为这杯特调命名并给出英文摄影提示词。', { data: visualRecipe });
      const drinkName = media.drinkName || limit(raw.drinkName, 20) || localName;
      if (!media.illustrations) {
        patchMedia(sessionId, drinkId, { drinkName, status: 'fallback' });
        return { drinkName, imagePath: '' };
      }
      patchMedia(sessionId, drinkId, { drinkName });
      const composition = limit(raw.imagePrompt, 1600) || [
        'Macro photograph of a ' + glass,
        GARNISHES[recipe.garnish] && 'garnished with ' + GARNISHES[recipe.garnish],
        recipe.customIngredient && 'with this visible ingredient in the glass: ' + recipe.customIngredient,
        'dark walnut counter, warm amber pendant light, shallow depth of field, no text or watermark',
      ].filter(Boolean).join(', ');
      const prompt = appearanceOfDrink + ' ' + composition;
      const result = await renderImage(sessionId, drinkId, prompt, { width: 960, height: 1200, requireComfyUI: true }, { drinkName });
      return { drinkName, imagePath: result?.url || '' };
    });
  });

  route('/quest/resolve', async ({ sessionId, questId }, state) => {
    const quest = state.quest?.questId === questId && state.quest.status === 'away' ? state.quest : state.reports.find(row => row.questId === questId)?.quest;
    const guest = quest && state.people[quest.charId];
    const drink = quest && state.drinks.find(row => row.id === quest.drinkId);
    const media = state.media[questId];
    if (!quest || !guest || !drink || !media) throw fail('请先把特调递给接单人，再等邻居归来。');
    validateRecipe(drink.recipe);
    const photo = outcome => {
      if (media.status !== 'pending' || !media.illustrations) return;
      void runOnce('photo/' + sessionId + '/' + questId, () => renderImage(
        sessionId, questId, outcome.polaroidImagePrompt, { width: 1152, height: 896 },
      )).catch(() => {});
    };
    if (media.outcome) {
      photo(media.outcome);
      return media.outcome;
    }
    return runOnce('quest/' + sessionId + '/' + questId, async () => {
      const name = state.media[drink.id]?.drinkName || BASES[drink.recipe.baseLiquor][0];
      const best = Math.max(0, ...quest.recommendedStats.map(stat => clamp(drink.stats[stat], 0, 3)));
      const chaos = clamp(drink.chaos, 0, 100);
      const bold = drink.recipe.baseLiquor === 'gin_vodka';
      const sober = drink.recipe.baseLiquor === 'coffee_tea';
      const volatile = chaos + (bold ? 14 : 0);
      const outcomeType = volatile >= 64 && !sober ? (best >= 2 ? 'twist' : 'chaotic') :
        best >= 2 || (sober && chaos < 45) || (bold && best === 1) ? 'triumph' : 'twist';
      const raw = await narrate('report', REPORT, '写出归来战报、纪念照和返场台词。按给定结局走势完成因果。', {
        personas: await dossiers([guest], true), data: { guest, quest, drink, drinkName: name, outcomeType },
      });
      const ingredient = drink.recipe.customIngredient;
      const flavor = ingredient ? '杯底那点「' + ingredient + '」意外成了引路的信号。' : '杯底最后一口让人敢再往前走一步。';
      const ending = {
        triumph: '三条线索都对上了，最后那件证物也顺利带了回来。',
        chaotic: '旧站台顿时乱成一团，虽然绕了远路，最后仍捡回了一件证物。',
        twist: '谜底和猜测完全相反，只能用原本打算留下的东西交换证物。',
      }[outcomeType];
      const outcome = {
        outcomeType, drinkName: name,
        storySummary: limit(raw.storySummary, 300) || guest.name + '把三张便签重新排过一遍，循着「' +
          quest.notes.map(note => note.keyword).join('」「') + '」摸到了事情的交点。' + flavor + ending,
        trinket: { name: limit(raw.trinket?.name, 18) || '缺角旧月票', iconKeyword:
          ['key', 'star', 'moon', 'ticket', 'leaf', 'compass'].includes(raw.trinket?.iconKeyword) ? raw.trinket.iconKeyword : 'ticket' },
        polaroidCaption: limit(raw.polaroidCaption, 28) || '推门时，灯还亮着。',
        polaroidImagePrompt: limit(raw.polaroidImagePrompt, 1800) ||
          'Warm grainy instant film photograph, solitary traveler returns with a torn ticket from a mysterious night station, glowing amber streetlight, rain on pavement, no text or watermark',
        affinityDelta: clamp(raw.affinityDelta ?? (outcomeType === 'triumph' ? 8 : 4), 1, 12),
        charReturnQuote: limit(raw.charReturnQuote, 75) || '老板，杯子先别收。这个故事得从头讲。',
      };
      patchMedia(sessionId, questId, { outcome, ...(media.illustrations ? {} : { status: 'fallback' }) });
      photo(outcome);
      return outcome;
    });
  });

  return { onUnload() { lifetime.abort(); jobs.clear(); } };
}
