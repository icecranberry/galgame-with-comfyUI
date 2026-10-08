/**
 * photoScenes.js —— 「哈托比亚」（SFW 图片站）的**题材池**
 *
 * ══════════════════════════════════════════════════════════════
 * 这个文件是干什么的
 * ══════════════════════════════════════════════════════════════
 *
 * 「哈托比亚」是与「规则34」并列的**图片站**，但不是成人站：
 * 主打 **城市风光 / 美少女自拍 / 美食打卡 / 宣传海报**，**不使用任何 NSFW 内容**。
 *
 * 它与规则34 **共用同一套架构**（这是规则34 表现好的原因）：
 *   服务端 → 抽题材 / 决定画面 / 抽画幅 / 抽画师串
 *   模型   → 只写作品名 / 一句备注 / 上传者 / 热度
 * 画面因此是**确定性随机**，不靠模型自觉，也不会"偶尔跑偏成 NSFW"。
 *
 * 差别只有一处、但是根本性的：**题材池不同**。
 *   · 规则34 从 `sexPositions.js`（84 条体位）+ `galleryEnvironment.js`（7 维色情环境层）抽；
 *   · 哈托比亚从**本文件**抽，且**不导入任何 NSFW 池**。
 *
 * ══════════════════════════════════════════════════════════════
 * ★ 城市风光的素材来源 = 世界地图（本文件只放"包裹语"）
 * ══════════════════════════════════════════════════════════════
 *
 * 「城市风光」的画面主体（"泊地站霓虹站台、湿地砖反射品红招牌"）**不写在本文件里** ——
 * 它来自 `world_map_places.scene_prompt`（全库 101/101 已补齐，含 lv1~lv4）。
 * 本文件只提供**取景包裹**（`{SCENE}` 占位 + 机位/时间/天气/构图），由 mediaService
 * 在生成时把地图场景填进 `{SCENE}`。
 *
 * 这样做的三个理由：
 *   ① 画面与**这个世界的真实地点**一致，不是泛泛的"cyberpunk street"；
 *   ② 让已补齐的 101 条 `scene_prompt` 有了**消费方**（此前只注入日程文字、无生图用途）；
 *   ③ 地点可与日程/朋友圈/奇遇联动（同一地点在不同内容里画面自洽）。
 *
 * ══════════════════════════════════════════════════════════════
 * ⚠ 维护红线
 * ══════════════════════════════════════════════════════════════
 * 1. **本文件里不许出现 NSFW 词**（不得有 naked / penis / penetration / 体位名…）。
 *    测试 `photoSiteSfw.test.js` 会用黑名单扫这个文件，写了就红。
 * 2. 英文描述里**不要用逗号**做整句连接（会被下游 split 拆碎）—— 用空格短语即可，
 *    但**允许多个逗号分隔的 danbooru 词**（这是画面描述的常规写法，下游会正确处理）。
 *    真正要避免的是**中文**（生图规则要求 ALL text in English）。
 * 3. 占位符只有两个：`{SCENE}`（地图场景，仅 cityscape 用）、`{subject}`（角色外观指代，仅自拍用）。
 *    引擎必须保证填完不留占位符（有测试）。
 */

/** 题材分类（前端"标签栏"按它分组；与 mediaService 的题材分派一一对应） */
export const PHOTO_CATEGORIES = [
  { key: 'cityscape', label: '城市风光', icon: '🌆', needsCharacter: false, needsMapScene: true,
    hint: '纯场景无人像 —— 画面取自世界地图的真实地点' },
  { key: 'selfie', label: '美少女自拍', icon: '🤳', needsCharacter: true, needsMapScene: false,
    hint: '角色出镜自拍 —— 会挂角色 LoRA，画面像本人；轻度魅力、不露点' },
  { key: 'food', label: '美食打卡', icon: '🍜', needsCharacter: false, needsMapScene: false,
    hint: '食物特写与餐桌场景 —— 街边小吃、甜点、咖啡、夜宵摊' },
  { key: 'poster', label: '宣传海报', icon: '🪧', needsCharacter: false, needsMapScene: false,
    hint: '宣发物料构图 —— 活动预告 / 店铺广告；文字由前端叠，画面只留版位' },
];

/**
 * 城市风光的**取景包裹**（`{SCENE}` = 地图 scene_prompt）。
 * 每条只提供"怎么拍这个景"，不提供"景是什么"。
 */
export const CITYSCAPE_FRAMES = [
  { key: 'wide-estab',  cn: '广角全景',   en: 'wide establishing shot of {SCENE}, no people, deep depth of field, cinematic composition, highly detailed environment' },
  { key: 'low-angle',   cn: '低角度仰拍', en: 'low-angle shot looking up at {SCENE}, dramatic perspective, sky visible above, no people' },
  { key: 'roof-line',   cn: '天际线',     en: 'skyline view over {SCENE}, layered rooftops and distant towers, atmospheric haze, no people' },
  { key: 'alley',       cn: '巷道纵深',   en: 'looking down a narrow alley in {SCENE}, one-point perspective, overhead cables, ambient glow, no people' },
  { key: 'reflection',  cn: '湿地倒影',   en: 'rain-slick ground mirroring the lights of {SCENE}, reflection symmetry, night mood, no people' },
  { key: 'aerial',      cn: '俯瞰鸟瞰',   en: 'high aerial view of {SCENE}, sprawling city layout, tiny streets, wide vista, no people' },
  { key: 'detail',      cn: '局部特写',   en: 'close-up detail vignette inside {SCENE}, signage and textures, shallow depth of field, no people' },
  { key: 'window',      cn: '窗景框景',   en: 'framed through a large window overlooking {SCENE}, interior silhouette in foreground, no people' },
  { key: 'dusk-street', cn: '黄昏街景',   en: 'quiet dusk street scene of {SCENE}, long shadows, warm fading light, no people' },
  { key: 'night-lights',cn: '夜景灯光',   en: 'night scene of {SCENE}, dense artificial lights, glowing signs, deep blue darkness, no people' },
];

/** 通用氛围（光影/天气/时节）—— SFW 版环境层，只挑"好看"，不做耦合约束 */
export const PHOTO_ATMOSPHERE = [
  { key: 'golden-hour', cn: '黄金时刻', en: 'golden hour light, warm rim glow' },
  { key: 'blue-hour',   cn: '蓝调时刻', en: 'blue hour ambience, cool cyan tones' },
  { key: 'overcast',    cn: '阴天柔光', en: 'overcast soft light, muted palette' },
  { key: 'clear-day',   cn: '晴朗白日', en: 'clear daylight, crisp shadows' },
  { key: 'neon-night',  cn: '霓虹夜',   en: 'neon night glow, saturated reflections' },
  { key: 'rain',        cn: '雨',       en: 'light rain, wet surfaces, misty air' },
  { key: 'snow',        cn: '雪',       en: 'falling snow, cold blue cast, soft flakes' },
  { key: 'cherry',      cn: '落樱',     en: 'drifting cherry blossom petals, soft pink bokeh' },
  { key: 'fog',         cn: '薄雾',     en: 'thin fog, reduced visibility, layered depth' },
  { key: 'sun-flare',   cn: '逆光眩光', en: 'backlit sun flare, lens flare, bright halo' },
];

/** 自拍视角/构图（`{subject}` = 角色外观指代）—— 轻度魅力，不露点 */
export const SELFIE_VIEWS = [
  { key: 'mirror',    cn: '对镜自拍',   en: 'mirror selfie of {subject}, phone held up, casual stylish outfit, indoor setting' },
  { key: 'arm-ext',   cn: '举手自拍',   en: 'arm-extended selfie of {subject}, bright smile, outdoor background bokeh' },
  { key: 'from-above',cn: '俯角自拍',   en: 'high-angle selfie of {subject}, looking up at camera, playful expression' },
  { key: 'cafe',      cn: '咖啡馆',     en: 'selfie of {subject} at a cafe table, coffee cup in frame, warm indoor light' },
  { key: 'foodie',    cn: '美食同框',   en: 'selfie of {subject} with a plate of food held up to camera, restaurant setting' },
  { key: 'stroll',    cn: '街拍随行',   en: 'candid selfie of {subject} walking a lively street, motion in background' },
  { key: 'sunset',    cn: '落日背影',   en: 'selfie of {subject} against a sunset sky, warm backlight, soft silhouette edges' },
  { key: 'window',    cn: '窗边',       en: 'selfie of {subject} beside a large window, soft daylight on face, cozy interior' },
  { key: 'rooftop',   cn: '天台',       en: 'selfie of {subject} on a rooftop at dusk, city skyline behind, wind in hair' },
  { key: 'pet',       cn: '与宠物',     en: 'selfie of {subject} hugging a small fluffy pet, warm domestic setting' },
  { key: 'snowy',     cn: '雪中',       en: 'selfie of {subject} in falling snow, breath visible, winter coat and scarf' },
  { key: 'beach-lite',cn: '海边（轻）', en: 'selfie of {subject} at the seaside, light summer outfit, hair blowing, bright daylight' },
];

/** 美食题材（食物 + 场景） */
export const FOOD_ITEMS = [
  { key: 'ramen',   cn: '拉面',     en: 'a steaming bowl of tonkotsu ramen, soft-boiled egg, chashu, nori, scallions, close-up food photography' },
  { key: 'skewers', cn: '烧烤串',   en: 'grilled skewers on a charcoal grill, glistening glaze, smoke rising, street stall at night' },
  { key: 'sushi',   cn: '寿司',     en: 'assorted nigiri sushi on a dark slate board, fresh salmon and tuna, minimal styling' },
  { key: 'cake',    cn: '甜点蛋糕', en: 'a slice of layered strawberry cream cake on a ceramic plate, fork and linen napkin, soft window light' },
  { key: 'coffee',  cn: '咖啡拉花', en: 'a latte with delicate rosetta latte art in a ceramic cup, wooden table, morning light' },
  { key: 'hotpot',  cn: '火锅',     en: 'a bubbling hotpot with sliced meat and vegetables, steam and rising heat, warm communal table' },
  { key: 'bento',   cn: '便当',     en: 'a neatly packed bento box with rice, tamagoyaki and vegetables, top-down flat lay' },
  { key: 'taiyaki', cn: '街头小吃', en: 'a paper-wrapped taiyaki pastry held over a crowded night market street, warm bokeh lights behind' },
  { key: 'icecream',cn: '冰品',     en: 'a tall parfait glass with ice cream, fruit and syrup, condensation on the glass, pastel background' },
  { key: 'dumpling',cn: '饺子',     en: 'a bamboo steamer of freshly made dumplings, chopsticks lifting one, rising steam' },
  { key: 'bbq-meat',cn: '烤肉',     en: 'sizzling sliced meat on a cast-iron grill, charred edges, smoke and glistening fat' },
  { key: 'bread',   cn: '烘焙',     en: 'rustic artisan bread and pastries on a bakery counter, flour dusting, warm ambient light' },
];

/** 宣传海报的题材与构图（画面只留版位，文字由前端叠） */
export const POSTER_TOPICS = [
  { key: 'event',    cn: '活动预告', en: 'promotional poster background for a city festival, bold empty banner space at top, celebratory confetti and lights, vibrant colors, poster art' },
  { key: 'shop',     cn: '店铺广告', en: 'storefront advertisement poster art, product hero area in center, clean empty text space, warm inviting palette' },
  { key: 'idol',     cn: '演出应援', en: 'concert support poster art, stage lights and glowing backdrop, large empty area for headline text, energetic atmosphere' },
  { key: 'tourism',  cn: '旅游宣传', en: 'tourism promotion poster art, scenic landmark hero shot, travel-poster flat color style, large sky area for title text' },
  { key: 'food-ad',  cn: '美食宣传', en: 'food advertisement poster art, hero dish on clean background, appetizing styling, bold empty space for slogan, studio lighting' },
  { key: 'notice',   cn: '公告通知', en: 'public notice poster art, simple graphic background, strong central empty panel for announcement text, high contrast' },
  { key: 'recruit',  cn: '招募启事', en: 'recruitment poster art, group of silhouetted figures, bright optimistic palette, generous empty space for copy, flat vector poster style' },
  { key: 'seasonal', cn: '节令海报', en: 'seasonal greeting poster art, iconic seasonal scenery, decorative framing border, empty central cartouche for text, decorative art' },
];

/**
 * 画幅池（哈托比亚版）。
 * 与规则34 的区别：**倾向相反** —— 这里的题材以"景"与"版面"为主，
 * 所以横构图（风景/全景/海报背景）与方构图（食物俯拍）占比更高。
 * ⚠ 键（`2:3` 等）与 `GALLERY_ASPECTS` 保持一致，前端尺寸逻辑可共用。
 */
export const PHOTO_ASPECTS = {
  // 城市风光：横为主
  cityscape: [
    { key: '16:9', w: 1728, h: 972,  cn: '宽银幕' },
    { key: '3:2',  w: 1632, h: 1088, cn: '横幅' },
    { key: '4:3',  w: 1600, h: 1200, cn: '标准横幅' },
  ],
  // 自拍：竖为主（手机自拍的真实构图）
  selfie: [
    { key: '3:4',  w: 1200, h: 1600, cn: '竖幅' },
    { key: '9:16', w: 972,  h: 1728, cn: '手机全屏' },
    { key: '1:1',  w: 1440, h: 1440, cn: '方形' },
  ],
  // 美食：方/近景（俯拍与特写的常规构图）
  food: [
    { key: '1:1',  w: 1440, h: 1440, cn: '方形俯拍' },
    { key: '4:3',  w: 1600, h: 1200, cn: '近景横幅' },
    { key: '3:4',  w: 1200, h: 1600, cn: '竖版特写' },
  ],
  // 海报：竖版物料
  poster: [
    { key: '2:3',  w: 1088, h: 1632, cn: '海报竖幅' },
    { key: '3:4',  w: 1200, h: 1600, cn: '竖幅' },
    { key: '1:1',  w: 1440, h: 1440, cn: '方形海报' },
  ],
};

/** 站点的通用画质后缀（所有题材共享，放在提示词末尾） */
export const PHOTO_QUALITY_SUFFIX = 'highly detailed, professional photography, sharp focus, best quality, no text, no watermark';

/** 通用负向（**只排除画质问题与文字**，不排除 NSFW 内容 —— 这是 SFW 站，本来就没有） */
export const PHOTO_NEGATIVE = 'lowres, blurry, jpeg artifacts, bad anatomy, extra limbs, deformed hands, watermark, signature, text, username, worst quality, low quality';

/**
 * ★ SFW 黑名单（供测试与出口层兜底使用）。
 * 任何出现在本条题材词里的词，都不该在这些黑名单词中。
 * 目的：防止日后有人往池子里塞了 NSFW 词（如从 galleryEnvironment 复制粘贴）。
 */
export const NSFW_LEAK_WORDS = [
  'naked', 'nude', 'penis', 'cock', 'cum', 'sex', 'penetration', 'nipple', 'breast',
  'pussy', 'orgasm', 'aroused', 'cleavage', 'lingerie', 'panties', 'bra',
  'condom', 'vibrator', 'dildo', 'anal', 'oral', 'bondage', 'penetrat',
  // 中文体位名（如误从 sexPositions 引入）
  '后入', '骑乘', '正常位', '口交', '乳交', '足交', '颜面',
];