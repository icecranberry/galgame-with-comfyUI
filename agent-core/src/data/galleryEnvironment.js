/**
 * galleryEnvironment.js —— 规则34「环境层」标签池（**7 个维度**）
 *
 * ── 这是什么 ──
 *
 * 图库（形态 `gallery`）每一条本来就有一份**体位提示词**（`src/data/sexPositions.js`，
 * 84 条，逐字校准过）。但画面里除了"人怎么摆"，还有"在哪、什么光、什么镜头、
 * 什么表情、身上什么状态、手边有什么"——这些原先**全靠模型每次现编**，既不可控，
 * 也无法成为检索标签（用户口径：标签主体过于单一）。
 *
 * 本文件把这七类做成**确定性随机池**：每条图库条目每维抽 1 项，
 * 同时写进 `image_prompt`（追加一段正交句）与 `tags`。
 *
 * ── 正交意味着什么 ──
 *
 * 体位管"人怎么摆"，环境层管"在哪/什么光/什么镜头"——**两者不互相改写**，
 * 所以逐字校准过的体位提示词不会被污染。环境句是**追加**的，不是重写。
 *
 * ── ★ 耦合：为什么不能纯随机 ──
 *
 * 从 84 条体位的实测信号看，纯随机会稳定产出崩图：
 *
 *   1. **体位不区分裸体**（`core` 里 `nude/naked` 命中 0/84）
 *      → 「衣物破损/半脱」叠加在本番体位上是矛盾的。衣物类必须要求
 *        `ctx.clothed`（由体位语义推出：非插入类体位才可能还穿着衣物）。
 *
 *   2. **84 条里 80 条的 prompt 出现手/臂**
 *      → 手铐、绳缚、分腿杆会与"手扶着/握着/插入"直接打架。
 *        但**不能一刀切成 80/84 全禁**：`on all fours`、`kneeling` 这类并不占用双手。
 *        所以用 `HANDS_BUSY_RE` 只匹配**功能性占用**（arm support / hands on ground /
 *        holding / fingering / handjob …），命中才排除 —— 物理正确，且束缚类仍有命中率。
 *
 *   3. **景别已被体位决定**（61/84 是 cowboy shot，来自 `pose.frames`）
 *      → D4 **不再随机景别**，只随机"摄影效果"（景深/焦外/颗粒…，纯叠加、零冲突），
 *        另加一个**由体位 core 派生**的焦点词（`ass` → `ass focus`）。
 *        派生而非随机，是唯一能保证不冲突的做法。
 *
 *   4. **口塞类 × 口交类体位**：嘴被塞住就没法口交 —— 实测能撞上的真冲突，
 *      用 `block: ORAL_RE` 排除。
 *
 *   5. **跨维度**：
 *      · `reflection 镜中倒影` 需要场景里有镜面 → `needs: ['mirror']`
 *      · `underwater lighting` 需要水 → `needs: ['water']`
 *      · `through door gap` 需要门/缝 → `needs: ['doorway']`
 *      · `blindfold 眼罩` 与「看向观者 / 对视」互斥 → `notWith: [...]`
 *      · `silhouette 剪影` 在逆光下才好 → `soft` 加权（不是硬性）
 *
 * 约束统一声明在本文件（数据），执行在 `services/galleryEnvelope.js`（引擎）。
 *
 * ── 字段说明 ──
 *
 *   en      英文标签：**进 tags、也进提示词**（用户口径：标签保持英文）
 *   cn      中文释义：**仅供文档与调试**，不进 tags
 *   phrase  写进 image_prompt 的自然语言片段（英文）
 *   needs   能力键数组，**全部**满足才可选（见 CAPABILITIES）
 *   block   正则源：命中**体位文本**即排除（物理矛盾）
 *   match   正则源：**必须**命中体位文本才可选
 *   notWith 已选中的其它维度标签 en，命中即排除
 *   soft    软偏好：`[维度键, 正则, 权重倍数]` —— 不是硬约束，只调概率
 *
 * ── CAPABILITIES（能力键）──
 *
 * 判定见 `services/galleryEnvelope.js` 的 `buildContext()`。分两类：
 *   · 场景提供：`indoor` `outdoor` `night` `water` `mirror` `doorway` `public`
 *     `bed` `seat` `wall` `table` `ground`
 *   · 体位提供：`clothed`（非插入类，可能还穿着）`penis` `oral` `penetration`
 *     `multi`（≥2 人）`solo` `lying` `standing`
 *
 * ⚠ 新增标签时：宁可把 `needs` 写严一点（抽不到还有兜底池），也不要写漏 ——
 *   写漏会直接产出矛盾画面（用户看到的是一张崩图，不是一个少见的标签）。
 */

/** 紧凑构造器：`t(en, cn, phrase, meta)` */
const t = (en, cn, phrase, meta = {}) => ({ en, cn, phrase, ...meta });

/**
 * 体位文本的**命名模式** —— 供 `block` / `match` 用 `'@名字'` 引用。
 *
 * 为什么用命名而不是就地写正则：同一套判据要在多处复用（手部占用出现在 8 个道具上），
 * 就地各写一遍必然改一处漏一处。放这里就是唯一真源。
 *
 * ⚠ `HANDS_BUSY` 的粒度是**关键**：84 条体位里 80 条 prompt 出现手/臂，
 *   但 `on all fours`、`kneeling` 并不占用双手 —— 若用宽松的 `/\bhand\b/`，
 *   束缚类会被全禁（看似安全，实则 D7 退化成只剩两三个标签）。
 *   所以只匹配「手被**功能性**占用」：撑地、扶墙、握住、插入。
 */
export const POSE_PATTERNS = {
  // 手被功能性占用（撑地 / 扶 / 握 / 抓 / 插）—— 束缚类与手铐类的排除依据
  HANDS_BUSY: [
    'arm support',
    'hands? (?:are |is )?(?:on|against|behind) (?:the )?(?:ground|floor|bed|table|wall|headboard)',
    'hands? (?:are |is )?placed',
    'holding (?:his|her|the|up)',
    'grab(?:bing|s)?',
    'gripp?(?:ing|ed|s)?',
    'clutch(?:ing|ed|es)?',
    'palm(?:s)? (?:on|flat)',
    'fingering',
    'handjob',
    'fingers? (?:in|on|around|inside|between)',
    'hand on (?:her|his|the)',
  ].join('|'),

  // 嘴被占用（口交 / 舔 / 含 / 深喉）—— 口塞类的排除依据
  ORAL: [
    'fellatio', 'blow ?job', 'irrumatio', 'deepthroat', 'deep throat',
    'cunnilingus', 'anilingus', 'licking', 'sucking', 'hollow cheeks',
    'penis in mouth', 'in her mouth', 'oral',
  ].join('|'),

  // 插入/本番 —— 决定"是否可能还穿着衣物"（体位数据本身不区分裸体，实测 0/84）
  PENETRATION: [
    'vaginal', 'anal', 'penetrat', 'double penetration', 'triple penetration',
    'double vaginal', 'double anal', 'intercrural', 'sumata', 'thigh_sex',
    'tribadism', 'mating press', 'spooning', 'straddling', 'upright straddle',
    'lotus position', 'wheelbarrow', 'suspended congress', 'amazon position',
    '\\bsex\\b', 'girl on top', 'missionary', 'doggystyle', 'cowgirl', 'prone bone',
  ].join('|'),

  // 已涉及玩具（体位自带道具，不要再叠一个同类）
  TOY_TAKEN: 'sex toys?|dildo|vibrator|double dildo',
  // 已涉及泡沫/肥皂（不要再叠"乳液/按摩油"）
  SOAP_TAKEN: '\\bsoap\\b|foam',
  // 已涉及体液或排泄（场景已经被这条占满，不再叠道具）
  FLUID_TAKEN: 'cum|peeing|drinking|ejaculat',
  // 躺 / 侧 / 趴 / 坐 —— 姿态类软偏好的共用判据
  LYING: 'lying|on back|on side|on stomach|prone|spooning',
};

/**
 * 体位**自带的场景暗示** —— 命中则把场景池**硬缩到**这几个。
 *
 * 实测来源：077「人体海绵」的 core 是 `soap, foam, bathroom, wet`，本身就在浴室；
 * 081 的 core 是 `on table`；021 是 `on table / on bed`。
 * 若这时随机抽到「雪原」就荒谬了 —— 这不是偏好，是矛盾。
 *
 * ⚠ 只列**确实排他**的；像 `on bed` 这种"床只是可能之一"的不列（交给 soft 加权）。
 */
export const POSE_SCENE_HINTS = [
  {
    match: '\\bsoap\\b|\\bfoam\\b|\\bbathroom\\b',
    scenes: ['bathroom', 'shower room', 'bathtub', 'public bath', 'open-air onsen', 'sauna'],
  },
  {
    match: '\\bon table\\b',
    scenes: ['kitchen', 'dining room', 'meeting room', 'laboratory', 'clinic', 'office', 'classroom'],
  },
];

// ══════════════════════════════════════════════════════════
// D1 场景 / 环境
// ══════════════════════════════════════════════════════════
/*
 * flags 图例（紧凑写法，便于扫表）：
 *   i 室内   o 室外   n 夜晚   w 有水   m 有镜面
 *   d 有门/缝隙   p 公共场所   b 有床   s 可坐   a 可倚墙   t 有桌面   g 地面
 */
const SCENE_FLAGS = { i: 'indoor', o: 'outdoor', n: 'night', w: 'water', m: 'mirror', d: 'doorway', p: 'public', b: 'bed', s: 'seat', a: 'wall', t: 'table', g: 'ground' };

function scene(en, cn, phrase, flags) {
  const meta = {};
  for (const [ch, key] of Object.entries(SCENE_FLAGS)) if (flags.includes(ch)) meta[key] = true;
  return t(en, cn, phrase, meta);
}

export const SCENE_TAGS = [
  scene('bedroom', '卧室', 'a dim bedroom with rumpled sheets', 'ibs'),
  scene('love hotel room', '爱情旅馆', 'a gaudy love hotel room lit by colored lamps', 'ibsn'),
  scene('living room', '客厅', 'a quiet living room with a low sofa', 'is'),
  scene('kitchen', '厨房', 'a kitchen with a wide countertop', 'it'),
  scene('dining room', '餐厅', 'a dining room with a long table', 'it'),
  scene('bathroom', '浴室', 'a tiled bathroom with a fogged mirror and running water', 'iwm'),
  scene('shower room', '淋浴间', 'a glass shower stall with water running down the walls', 'iwd'),
  scene('bathtub', '浴缸', 'a deep bathtub filled with steaming water', 'iwm'),
  scene('open-air onsen', '露天温泉', 'a traditional open-air hot spring bath with steam drifting over the rocks', 'owp'),
  scene('public bath', '公共浴场', 'a large public bath house with steam and echoing tiles', 'iwp'),
  scene('sauna', '桑拿房', 'a hot cedar sauna thick with steam', 'iw'),
  scene('changing room', '更衣室', 'a changing room with lockers and a full-length mirror', 'imp'),
  scene('fitting room', '试衣间', 'a narrow fitting room with a curtain and a mirror', 'imdp'),
  scene('dressing room', '化妆间', 'a backstage dressing room with a mirror lined with bulbs', 'im'),
  scene('classroom', '教室', 'an empty classroom with desks pushed aside', 'ip'),
  scene('lecture hall', '阶梯教室', 'a tiered lecture hall with rows of empty seats', 'ip'),
  scene('library', '图书馆', 'a library aisle between tall bookshelves', 'ip'),
  scene('office', '办公室', 'an after-hours office with a wide desk and blinds drawn', 'iptn'),
  scene('meeting room', '会议室', 'a glass-walled meeting room with a long table', 'ipt'),
  scene('stairwell', '楼梯间', 'a concrete stairwell with a bare bulb', 'id'),
  scene('elevator', '电梯', 'a mirrored elevator cabin stopped between floors', 'im'),
  scene('corridor', '走廊', 'a long dim corridor with doors on both sides', 'id'),
  scene('warehouse', '仓库', 'a dusty warehouse stacked with crates', 'ig'),
  scene('basement', '地下室', 'a basement room lit by a single hanging lamp', 'ig'),
  scene('prison cell', '牢房', 'a bare stone cell with iron bars', 'id'),
  scene('laboratory', '实验室', 'a laboratory with steel tables and glassware', 'it'),
  scene('hospital room', '病房', 'a private hospital room with a narrow bed', 'ib'),
  scene('clinic', '诊所', 'a small examination room with a paper-covered couch', 'it'),
  scene('shrine', '神社', 'a deserted shrine ground under old trees', 'og'),
  scene('temple', '寺庙', 'the wooden hall of an old temple', 'i'),
  scene('chapel', '礼拜堂', 'a small stone chapel with light through stained glass', 'is'),
  scene('greenhouse', '温室', 'a glass greenhouse crowded with tropical plants', 'ig'),
  scene('flower field', '花田', 'a flower field swaying in the wind', 'og'),
  scene('forest', '森林', 'a dense forest clearing with dappled light', 'og'),
  scene('beach', '海滩', 'a deserted beach at the waterline', 'owg'),
  scene('swimming pool', '泳池', 'an empty swimming pool hall with still water', 'iw'),
  scene('rooftop', '天台', 'a windswept rooftop overlooking the city', 'og'),
  scene('balcony', '阳台', 'a narrow balcony with a railing and open sky', 'o'),
  scene('fire escape', '消防梯', 'a metal fire escape clinging to a building wall', 'ong'),
  scene('car interior', '车内', 'the back seat of a parked car', 'isg'),
  scene('train compartment', '列车车厢', 'an empty night train compartment', 'ipn'),
  scene('subway car', '地铁车厢', 'a rattling subway car with no other passengers', 'ipn'),
  scene('alley at night', '夜晚小巷', 'a narrow alley at night, wet asphalt reflecting signs', 'ondg'),
  scene('night street', '夜晚街道', 'a city street at night glittering with signage', 'onpg'),
  scene('bar', '酒吧', 'a low-lit bar with bottles behind the counter', 'inps'),
  scene('nightclub', '夜店', 'a nightclub booth washed in moving lights', 'inps'),
  scene('tent', '帐篷', 'a small tent lit from within by a lantern', 'ig'),
  scene('ruins', '废墟', 'broken ruins open to the sky', 'og'),
  scene('snowfield', '雪原', 'a silent snowfield under a pale sky', 'og'),
  scene('attic', '阁楼', 'a cluttered attic under a sloped roof', 'ig'),
  scene('laundry room', '洗衣间', 'a laundry room with the washer still spinning', 'i'),
  scene('locker room', '更衣间', 'a locker room with benches and a tiled floor', 'impg'),
  scene('hotel corridor', '旅馆走廊', 'a carpeted hotel corridor with numbered doors', 'id'),
];

// ══════════════════════════════════════════════════════════
// D2 光影 / 氛围
// ══════════════════════════════════════════════════════════
export const LIGHTING_TAGS = [
  t('soft lighting', '柔光', 'Soft light falls evenly across the scene'),
  t('dim lighting', '昏暗光', 'The room is dim, shadows pooling in the corners'),
  t('candlelight', '烛光', 'Candlelight flickers across bare skin', { needs: ['indoor'] }),
  t('moonlight', '月光', 'Cold moonlight cuts through the window', { needs: ['night'] }),
  t('sunlight', '日光', 'Bright sunlight floods in'),
  t('morning light', '晨光', 'Pale morning light fills the space', { needs: ['outdoor'] }),
  t('sunset', '夕阳', 'Sunset light burns orange across everything', { needs: ['outdoor'] }),
  t('golden hour', '黄金时刻', 'Warm golden hour light wraps the whole frame', { needs: ['outdoor'] }),
  t('backlit', '逆光', 'The light comes from behind, rimming the silhouette'),
  t('backlit translucent', '逆光透射', 'Backlight glows through the thin fabric, a translucent halo'),
  t('light through hair', '发丝透光', 'Light passes through loose strands of hair like gold thread'),
  t('rim light', '轮廓光', 'A hard rim light traces the outlines'),
  t('lens flare', '镜头光斑', 'A soft lens flare streaks across the frame'),
  t('god rays', '丁达尔光', 'Shafts of light come down through the dust'),
  t('volumetric lighting', '体积光', 'The air itself glows, lit volume by volume'),
  t('dappled sunlight', '斑驳阳光', 'Dappled sunlight scatters across the skin', { needs: ['outdoor'] }),
  t('neon lights', '霓虹灯', 'Neon comes in through the window in bars of color', { needs: ['night'] }),
  t('spotlight', '聚光灯', 'A single hard spotlight isolates the subject'),
  t('stage lights', '舞台灯', 'Stage lights sweep across in every direction'),
  t('projector light', '投影光', 'A projector throws moving shapes across the wall', { needs: ['indoor'] }),
  t('firelight', '火光', 'Firelight pulses from off-frame, warm and uneven', { needs: ['night'] }),
  t('fluorescent lighting', '荧光灯', 'Flat fluorescent light hums overhead', { needs: ['indoor'] }),
  t('split lighting', '半脸受光', 'Half the face is lit, the other half lost to shadow'),
  t('chiaroscuro', '明暗对照', 'Deep chiaroscuro carves the bodies out of black'),
  t('dramatic shadows', '戏剧阴影', 'Hard shadows cut dramatic shapes across the scene'),
  t('underwater lighting', '水下光', 'Light bends and dances as if seen through moving water', { needs: ['water'] }),
  t('strobe light', '频闪', 'A strobe freezes the moment in slices of white'),
  t('blacklight', '黑光', 'Blacklight makes pale skin and fabric glow violet'),
];

// ══════════════════════════════════════════════════════════
// D3 视角 / 构图
// ══════════════════════════════════════════════════════════
/*
 * ⚠ 本维度**只抽 1 项** → 池内各项天然互斥（不会同时出现 `from above` 与 `from below`）。
 *   与其它维度的冲突用 `needs` / `notWith` / `soft` 声明。
 */
export const VIEW_TAGS = [
  t('from above', '俯视', 'The camera looks down from above', { soft: [['pose', /lying|on back|on side|on stomach|sitting/, 3]] }),
  t('from directly above', '顶视', 'The camera is directly overhead, flattening the scene', { soft: [['pose', /lying|on back|on side|on stomach/, 2.5]] }),
  t('from below', '仰视', 'The camera looks up from a low angle', { block: /lying on (?:her )?back|on back,/i }),
  // ⚠ 软偏好的正则**只该匹配体位本身的朝向**，不能匹配"提到臀部"这种顺带描述。
  //   实测（2026-10-05）：`ass` 命中「扛腿位」(068) —— 它的 prompt 里有
  //   "his hands around her waist or ass"，但那是**面对面**的体位（core 里是 missionary）。
  //   结果 `from behind` 被 ×4 拉高、与 `missionary` 的面对面构图打架 →
  //   生成的图里人物肢体扭曲（头朝下、臀部朝上、四肢拧在一起）。
  //   已去掉裸 `ass`；要表达"后入/臀朝向镜头"应由 doggy / all fours / prone / reverse cowgirl 承担。
  //
  // ★ 再加一道 `block`：**正面位（missionary / 面对面）根本不该出现背面视角**。
  //   只靠 soft 降权不够 —— soft 只在多个候选间调概率，候选只有它一个时照样必选。
  //   block 是硬排除，宁可这一格退回"侧面/四分之三侧"也不许构图自相矛盾。
  t('from behind', '背面', 'The camera watches from behind', {
    soft: [['pose', /from behind|reverse cowgirl|doggy|all fours|prone|from the back/, 4]],
    block: /missionary|facing (?:each other|him)|face to face|on (?:her|his) back with (?:her|his) (?:legs|knees) (?:up|bent)/i,
  }),
  t('from side', '侧面', 'The camera is level with them, seen from the side'),
  t('three quarter view', '四分之三侧', 'The camera sits at a natural three-quarter angle'),
  t('dutch angle', '荷兰角', 'The frame is tilted off its axis', { soft: [['pose', /standing|on top|squat/, 3]] }),
  t('pov', '主观视角', 'The shot is their point of view', { needs: ['multi'] }),
  t('pov hands', '主观视角（手）', "The shot is in first person, the man's hands in frame", { needs: ['multi', 'penis'] }),
  t('over shoulder shot', '过肩', 'The foreground shoulder frames the shot', { needs: ['multi'] }),
  t('voyeuristic angle', '窥视', 'The shot peers in from an unnoticed vantage', { needs: ['doorway'] }),
  t('through door gap', '门缝窥视', 'The view comes through a narrow gap in the door', { needs: ['doorway'] }),
  t('frame within frame', '画中画', 'A doorway frames the scene inside the frame', { needs: ['doorway'] }),
  t('reflection', '镜中倒影', 'The scene is caught in a mirror, doubling the bodies', { needs: ['mirror'] }),
  t('silhouette', '剪影', 'The bodies read as dark shapes against the light', { soft: [['lighting', /backlit|rim light|sunset|golden hour|neon/, 5]] }),
  t('foreshortening', '透视压缩', 'Strong foreshortening pushes the near limb toward the lens'),
  t('wide-angle', '广角', 'A wide angle exaggerates the depth of the room'),
  t('fisheye', '鱼眼', 'A fisheye lens bends the whole frame outward'),
  t('vanishing point', '灭点透视', 'Perspective lines run to a single vanishing point'),
  t('dynamic angle', '动感角度', 'A dynamic angle puts the composition off balance'),
  t('cinematic angle', '电影感角度', 'A cinematic angle gives the frame a film-still weight'),
  t('selfie', '自拍', 'The shot is a handheld selfie, arm out of frame', { block: /penetrat|vaginal|anal|mating press/i }),
];

// ══════════════════════════════════════════════════════════
// D4 摄影效果（景别**不在这里** —— 它由体位的 `frames` 决定，见文件头）
// ══════════════════════════════════════════════════════════
export const OPTICS_TAGS = [
  t('depth of field', '景深', 'Shallow depth of field separates them from the background'),
  t('bokeh', '焦外虚化', 'The background dissolves into soft bokeh'),
  t('foreground blur', '前景虚化', 'Something close to the lens blurs across the foreground'),
  t('blurry background', '背景虚化', 'The background falls away out of focus'),
  t('soft focus', '柔焦', 'A soft focus takes the hard edges off everything'),
  t('deep focus', '深景深', 'Deep focus holds the whole room in sharp detail'),
  t('film grain', '胶片颗粒', 'Fine film grain sits over the whole image'),
  t('vignetting', '暗角', 'The corners fall off into vignette'),
  t('chromatic aberration', '色差', 'Slight chromatic fringing bleeds at the edges'),
  t('motion blur', '动态模糊', 'A little motion blur smears the fastest movement', { block: /freeze|stillness/i }),
  t('slow shutter', '慢门', 'The slow shutter drags light trails across the frame'),
];

// ══════════════════════════════════════════════════════════
// D5 表情 / 视线
// ══════════════════════════════════════════════════════════
export const EMOTION_TAGS = [
  t('blush', '脸红', 'a flush spreads over her cheeks'),
  t('full-face blush', '满脸通红', 'her whole face is burning red'),
  t('parted lips', '微张双唇', 'her lips are parted'),
  t('half-closed eyes', '半闭眼', 'her eyes are half closed'),
  t('closed eyes', '闭眼', 'her eyes are shut tight'),
  t('tears', '泪光', 'tears stand in her eyes'),
  t('crying', '流泪', 'tears run down her cheeks'),
  t('sweat', '汗', 'sweat beads on her skin'),
  t('heavy breathing', '喘息', 'her breath comes in short gasps'),
  t('tongue out', '吐舌', 'her tongue lolls out'),
  t('biting lip', '咬唇', 'she bites her lower lip'),
  t('drooling', '流涎', 'saliva trails from her lips'),
  t('ahegao', '恍惚脸', 'her face is slack and rolled back in pleasure', { soft: [['pose', /vaginal|anal|penetrat|sex|mating/, 3]] }),
  t('rolled eyes', '翻眼', 'her eyes have rolled back'),
  t('seductive smile', '媚笑', 'she gives a slow, knowing smile'),
  t('smug', '得意', 'she looks quietly smug'),
  t('embarrassed', '羞赧', 'she looks mortified'),
  t('expressionless', '面无表情', 'her face stays utterly blank'),
  t('surprised', '惊讶', 'her eyes go wide in surprise'),
  // ★ 与「背面视角」互斥：镜头在背后却写着看向观者 = 自相矛盾（模型会让角色回头，构图就废了）
  t('looking at viewer', '看向观者', 'she looks straight into the lens', { notWith: ['from behind'], block: /facing away/i }),
  t('eye contact', '对视', 'she holds eye contact with the lens', { notWith: ['from behind'], block: /facing away/i }),
  t('looking down', '垂眼', 'her gaze drops downward'),
  t('looking away', '别开视线', 'she looks away, unfocused'),
  t('heart-shaped pupils', '心形瞳孔', 'her pupils are shaped like little hearts'),
  t('pout', '撅嘴', 'she pouts'),
];

// ══════════════════════════════════════════════════════════
// D6 身体 / 衣物状态
// ══════════════════════════════════════════════════════════
/*
 * ★ 本维度是耦合最重的地方 —— 体位数据**不区分裸体与穿衣**（实测 0/84）。
 *   分两段：
 *     · 身体表面（`needs: []`）—— 与穿不穿衣无关，永远可选
 *     · 衣物状态（`needs: ['clothed']`）—— 只有**非插入类**体位才可能还穿着衣物
 *   `clothed` 由 `services/galleryEnvelope.js` 的 `isPenetration()` 推出。
 */
export const STATE_TAGS = [
  // ── 身体表面（无耦合）──
  t('sweaty body', '汗湿身体', 'her skin is slick with sweat'),
  t('glistening skin', '肌肤泛光', 'her skin glistens'),
  t('oiled skin', '涂油肌肤', 'her skin is oiled and shining'),
  t('wet skin', '湿身', 'water runs over her skin', { needs: ['water'] }),
  t('steam', '蒸汽', 'steam curls off her skin', { needs: ['water'] }),
  t('skin droplets', '皮肤水珠', 'droplets cling to her skin', { needs: ['water'] }),
  t('body blush', '身体泛红', 'a flush spreads down her chest'),
  t('trembling', '颤栗', 'her legs are trembling'),
  /*
   * ── 衣物**凌乱/脱卸**状态 ──
   * ★ 这一组**不禁本番体位**，而且这正是关键判断：
   *   它们描述的是"衣物被弄乱/拉下/解开"，而"本番"本身就意味着衣物已被弄乱 ——
   *   两者**相容**（现实中就是「扒开衣服做」）。初版把这 14 条全挂 `needs:['clothed']`，
   *   导致本番体位（84 条里绝大多数）的 D6 只剩 5 条可抽，标签池被无谓压窄。
   *   真正与"衣物仍整齐"矛盾的只有下面那一组 5 条 —— 它们才需要 `clothed`。
   */
  t('torn clothes', '衣物破损', 'her clothes are torn open'),
  t('ripped clothes', '撕裂', 'her clothes are ripped apart'),
  t('partially removed', '半脱', 'her clothes are half pulled off'),
  t('clothes pulled down', '拉下衣物', 'her clothes are dragged down'),
  t('panties around one leg', '内裤挂一腿', 'her panties hang around one ankle'),
  t('bra lifted', '胸罩上推', 'her bra is shoved up over her breasts'),
  t('unbuttoned', '解开扣子', 'her shirt hangs open, unbuttoned'),
  t('slipping off shoulder', '滑落肩头', 'her top has slipped off one shoulder'),
  t('disheveled clothes', '衣物凌乱', 'her clothes are disheveled'),
  t('messy clothes', '衣物不整', 'her clothes are in disarray'),
  t('tattered clothes', '褴褛', 'what is left of her clothes hangs in tatters'),
  t('clinging fabric', '布料贴身', 'wet fabric clings to every curve', { needs: ['water'] }),
  t('see-through', '透视', 'the wet fabric has gone see-through', { needs: ['water'] }),
  t('sheer fabric', '薄纱', 'sheer fabric shows everything beneath'),
  t('wet clothes', '湿透衣物', 'her clothes are soaked through and clinging', { needs: ['water'] }),
  t('soaked clothes', '浸湿衣物', 'her clothes are soaked', { needs: ['water'] }),
  /*
   * ── 衣物**仍然整齐穿着**状态 ──
   * 只有非插入类体位（口交/手交/足交/乳交）才可能"还好好穿着"，
   * 所以这 5 条才挂 `needs: ['clothed']`（= `!isPenetration(pose)`）。
   */
  t('form-fitting', '紧身', 'her clothes are form-fitting', { needs: ['clothed'] }),
  t('skin tight', '紧贴', 'her clothes are skin tight', { needs: ['clothed'] }),
  t('wrinkled clothes', '起皱', 'her clothes are crumpled and creased', { needs: ['clothed'] }),
  t('untucked shirt', '下摆外放', 'her shirt has come untucked', { needs: ['clothed'] }),
  t('undressing', '正在脱', 'she is mid-undress', { needs: ['clothed'] }),
];

// ══════════════════════════════════════════════════════════
// D7 道具 / 玩法
// ══════════════════════════════════════════════════════════
/*
 * ★ 手部占用（`HANDS_BUSY_RE`，与引擎同一口径）：
 *   84 条体位里 80 条的 prompt 出现手/臂，但**不能因此全禁束缚类** ——
 *   `on all fours` / `kneeling` 并不占用双手。只排除**功能性占用**。
 *
 * ★ 口塞类 × 口交体位 = 嘴被占住就没法口交（实测能撞上的真冲突，用 `ORAL_RE` 排除）。
 */
export const PROP_TAGS = [
  // ── 低耦合：放在身上/体内，不占用手脚 ──
  // ★ 与「饮精/饮尿/射精入体」类体位互斥：戴了套就不可能有这些结果
  t('condom', '避孕套', 'a condom is in play', { needs: ['penis'], block: '@FLUID_TAKEN' }),
  t('condom on penis', '戴套', 'a condom is rolled onto his cock', { needs: ['penis'], block: '@FLUID_TAKEN' }),
  t('vibrator', '振动棒', 'a vibrator is pressed against her'),
  t('egg vibrator', '跳蛋', 'an egg vibrator is tucked inside her'),
  t('remote control vibrator', '遥控跳蛋', 'a remote-controlled vibrator buzzes inside her'),
  t('anal beads', '肛珠', 'a string of anal beads is worked into her', { needs: ['anal'] }),
  t('dildo', '假阳具', 'a dildo is in her hand', { block: '@TOY_TAKEN' }),
  t('double dildo', '双头龙', 'the two of them share a double-ended dildo', { needs: ['multi'], block: '@TOY_TAKEN' }),
  t('lotion', '乳液', 'a bottle of lotion sits open nearby', { block: '@SOAP_TAKEN|@FLUID_TAKEN' }),
  t('massage oil', '按摩油', 'she is being worked over with massage oil', { block: '@SOAP_TAKEN|@FLUID_TAKEN' }),
  t('body writing', '身上写字', 'words are written across her skin'),
  t('tally marks', '计数', 'tally marks are inked on her thigh'),
  t('nipple clamp', '乳夹', 'clamps are fixed to her nipples'),
  t('collar and leash', '项圈与牵引绳', 'a collar sits on her neck with a leash running off frame'),
  t('blindfold', '眼罩', 'a blindfold covers her eyes', { notWith: ['looking at viewer', 'eye contact', 'looking down', 'looking away'] }),
  t('video camera', '摄像机', 'a camera on a tripod records everything'),
  t('smartphone photo', '手机拍摄', 'a phone is held up to film it', { block: '@HANDS_BUSY|@PENETRATION' }),
  t('mirror', '镜子', 'she is made to watch herself in a mirror', { needs: ['mirror'] }),
  t('nipple pull', '拉乳头', 'her nipples are being pulled', { block: '@HANDS_BUSY' }),
  t('nipple tweak', '捏乳头', 'her nipples are being tweaked', { block: '@HANDS_BUSY' }),
  t('spanking', '打屁股', 'her backside is red from spanking', { block: '@HANDS_BUSY' }),
  t('crotch rope', '胯下绳', 'a rope is drawn tight between her legs', { block: '@HANDS_BUSY' }),
  t('exhibitionism', '裸露癖', 'they are deliberately in the open where anyone could walk in', { needs: ['public'] }),
  t('voyeurism', '窥阴', 'someone unseen is watching from the gap', { needs: ['doorway'] }),
  // ── 需要手确实空着（`@HANDS_BUSY` 排除撑地/扶墙/握住等）──
  t('hitachi magic wand', '按摩棒', 'a wand vibrator buzzes against her', { block: '@HANDS_BUSY|@TOY_TAKEN' }),
  t('handcuffs', '手铐', 'her wrists are cuffed', { block: '@HANDS_BUSY' }),
  t('rope bondage', '绳索捆绑', 'ropes are wound tight around her body', { block: '@HANDS_BUSY' }),
  t('shibari', '绳缚', 'she hangs in an elaborate shibari harness', { block: '@HANDS_BUSY' }),
  t('spreader bar', '分腿杆', 'a spreader bar holds her ankles apart', { block: '@HANDS_BUSY' }),
  t('pillory', '枷锁', 'her head and wrists are locked in a pillory', { block: '@HANDS_BUSY' }),
  t('hogtie', '曲膝捆绑', 'she is hogtied, wrists to ankles', { block: '@HANDS_BUSY', match: '@LYING' }),
  t('wooden horse', '木马', 'she is seated on a wooden horse', { block: '@HANDS_BUSY', needs: ['seat'] }),
  // ── 口塞类：嘴被塞住就没法口交（真冲突，不是洁癖）──
  t('ball gag', '口塞', 'a ball gag is strapped in her mouth', { block: '@ORAL' }),
  t('bit gag', '棍塞', 'a bit gag is strapped between her teeth', { block: '@ORAL' }),
  t('ring gag', '扩口器', 'a ring gag holds her mouth open', { block: '@ORAL' }),
  t('tape gag', '胶带封口', 'tape is stuck over her mouth', { block: '@ORAL' }),
  t('panty gag', '内裤塞口', 'her own panties are stuffed in her mouth', { block: '@ORAL', needs: ['clothed'] }),
];

// ══════════════════════════════════════════════════════════
// D4b 焦点词 —— **由体位派生，不随机**
// ══════════════════════════════════════════════════════════
/*
 * 为什么派生而不是随机：
 *   焦点词（`ass focus` / `face focus` …）说的是"画面强调哪个部位"。
 *   随机抽会直接和体位打架 —— 给「口交」抽到 `ass focus`，等于让模型把镜头
 *   从嘴上挪到屁股上，画面就废了。
 *   体位本身已经决定了它强调什么（`core` 里就是 `ass` / `fellatio` / `footjob`），
 *   所以**按 core 映射**既零冲突，又天然语义正确。
 *
 * 顺序 = 优先级：先命中的胜出（越靠前越具体）。
 *
 * ★★ 匹配范围**只有 `pose.core` + `pose.name`，绝不是整个体位长文本**。
 *   实测踩过：拿 `prompt`/`frozen` 一起匹配时，几乎所有体位都会提到 "his hand on her ass"，
 *   于是 `hand focus` 占到 36%、`foot focus` 占到 31%（足交体位才 3 条！）—— 焦点词彻底失真。
 *   `core` 是精炼过的特征标签，`frozen`/`prompt` 是长描写，噪声极大。
 *
 * ★ 同理**不能写裸 `\bhand\b` / `\bfeet\b`**，只能写"手交/足交"这种**体位类别词**。
 */
export const FOCUS_RULES = [
  { match: 'footjob|foot worship|\\bsoles\\b|\\btoes\\b', en: 'foot focus', cn: '足部焦点', phrase: 'the frame centers on her feet' },
  { match: 'paizuri|penis between breasts|breast hold', en: 'breast focus', cn: '胸部焦点', phrase: 'the frame centers on her breasts' },
  { match: 'handjob|fingering|glans|disembodied hand|male hand', en: 'hand focus', cn: '手部焦点', phrase: 'the frame centers on the hands' },
  { match: 'fellatio|irrumatio|deepthroat|licking penis|penis in mouth|sucking|hollow cheeks', en: 'face focus', cn: '脸部焦点', phrase: 'the frame stays close on her face' },
  { match: 'cunnilingus|anilingus|licking testicles|licking', en: 'face focus', cn: '脸部焦点', phrase: 'the frame stays close on her face' },
  { match: 'ass up|\\bass\\b|on all fours|all fours|doggystyle|prone bone|reverse cowgirl|wheelbarrow', en: 'ass focus', cn: '臀部焦点', phrase: 'the frame centers on her hips and rear' },
  { match: 'legs? (?:over|around|up)|leg up|spread legs|M legs|thigh|knees up|crossed ankles', en: 'thigh focus', cn: '大腿焦点', phrase: 'the frame centers on her legs' },
  { match: 'straddling|girl on top|amazon|lotus|mating press|\\bsex\\b|vaginal|penetrat|spooning|upright straddle', en: 'hip focus', cn: '腰胯焦点', phrase: 'the frame centers on where their bodies meet' },
];

/** 兜底焦点（体位没有任何可映射特征时） */
export const DEFAULT_FOCUS = { en: 'face focus', cn: '脸部焦点', phrase: 'the frame stays close on her face' };

/** 全部维度（顺序 = 抽取顺序：场景先定，后面的维度依赖它） */
export const ENV_DIMENSIONS = [
  { key: 'scene', label: '场景 / 环境', pool: SCENE_TAGS },
  { key: 'lighting', label: '光影 / 氛围', pool: LIGHTING_TAGS },
  { key: 'view', label: '视角 / 构图', pool: VIEW_TAGS },
  { key: 'optics', label: '摄影效果', pool: OPTICS_TAGS },
  { key: 'emotion', label: '表情 / 视线', pool: EMOTION_TAGS },
  { key: 'state', label: '身体 / 衣物状态', pool: STATE_TAGS },
  { key: 'prop', label: '道具 / 玩法', pool: PROP_TAGS },
];
