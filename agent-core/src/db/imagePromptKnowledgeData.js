import { IMAGE_PROMPT_TAG_KNOWLEDGE } from './imagePromptTagKnowledgeData.js';

export const IMAGE_PROMPT_KNOWLEDGE_VERSION = '2026-07-27.6';

const ALL_SCENES = ['chat', 'moments', 'events', 'schedule', 'mailbox', 'avatar', 'gift', 'proactive', 'standalone'];

const IMAGE_PROMPT_FRAMEWORK_KNOWLEDGE = [
  {
    knowledgeId: 'ipk.slot.order', category: 'structure', title: '提示词槽位顺序', isDefault: true, priority: 100,
    searchTerms: 'prompt order slot structure tag sequence 提示词 顺序 槽位 结构', scenes: ALL_SCENES,
    content: '按 count/gender → character/series → appearance → clothing/state → pose/action → expression → camera/shot → scene/environment → detail/mood 的顺序组织。相同语义只保留一次，核心主体与动作放在镜头和环境之前。',
  },
  {
    knowledgeId: 'ipk.count.solo', category: 'count_identity', title: '单人数量锚点', isDefault: true, priority: 90,
    searchTerms: 'solo one person single character 1girl 1boy selfie portrait 单人 独自 自拍 头像', scenes: ALL_SCENES,
    content: '单人画面明确写出性别计数与 solo；不要同时加入第二人的性别计数、hetero、yuri 或互动动作。自拍中的手臂或镜外视角不等于新增人物。',
  },
  {
    knowledgeId: 'ipk.count.duo', category: 'count_identity', title: '双人数量与身份分离', isDefault: false, priority: 96,
    searchTerms: 'two people duo couple together interaction 2girls 1girl 1boy 双人 两人 合照 情侣 互动', scenes: ALL_SCENES,
    content: '双人画面先锁定精确人数和性别，再分别描述 A、B 的外观、服装、动作与表情；用句号或分号分隔两人的描述，避免属性串到另一人身上。',
  },
  {
    knowledgeId: 'ipk.count.group', category: 'count_identity', title: '多人构图容量控制', isDefault: false, priority: 98,
    searchTerms: 'group multiple crowd three people多人 群像 三人 多角色 聚会', scenes: ALL_SCENES,
    content: '多人画面必须给出精确人数，并只保留一个主动作关系。每人使用独立身份和外观锚点；镜头选择能容纳全员的 wide shot、full body 或 from above，避免同时要求 close-up。',
  },
  {
    knowledgeId: 'ipk.character.anchor', category: 'character_anchor', title: '角色身份与外观锚点', isDefault: true, priority: 100,
    searchTerms: 'character identity series official appearance hair eyes costume anchor 角色 身份 系列 外观 发色 瞳色 服装 锚点', scenes: ALL_SCENES,
    content: 'IP 角色用 name (series) 作为身份锚点，并补充稳定的发色/发型、瞳色和标志服饰。不要编造未知特征；同一角色的互斥发色、瞳色或发型只保留一组。',
  },
  {
    knowledgeId: 'ipk.pose.geometry', category: 'pose_geometry', title: '单一主姿态几何', isDefault: true, priority: 100,
    searchTerms: 'pose action geometry posture body position standing sitting lying movement 姿势 动作 几何 站 坐 躺', scenes: ALL_SCENES,
    content: '画面只设一个主姿态和一个主要动作，明确躯干朝向、四肢支撑点与人物间接触关系。standing、sitting、lying/on back 等互斥体态不可并存；复杂动作应删去不必要的手脚细节。',
  },
  {
    knowledgeId: 'ipk.pose.selfie', category: 'pose_geometry', title: '自拍姿态约束', isDefault: false, priority: 96,
    searchTerms: 'selfie phone holding phone arm stretched mirror selfie 自拍 手机 镜子 手臂', scenes: ['chat', 'moments', 'avatar', 'proactive', 'standalone'],
    content: '自拍优先使用 upper body 或 cowboy shot，明确 holding phone / arm stretched toward camera，并只保留一只持机手。普通自拍不要同时写 third-person full body；镜面自拍需明确 mirror reflection，避免重复人物。',
  },
  {
    knowledgeId: 'ipk.pose.interaction', category: 'pose_geometry', title: '双人互动接触点', isDefault: false, priority: 97,
    searchTerms: 'hug holding hands embrace kiss touching interaction close together 拥抱 牵手 亲吻 接触 互动', scenes: ALL_SCENES,
    content: '双人互动只指定一个清晰接触点，例如 holding hands、arm around shoulder 或 embrace；同时说明双方朝向和距离。不要为每只手安排不同动作，以免生成额外肢体。',
  },
  {
    knowledgeId: 'ipk.camera.default', category: 'camera', title: '镜头与主体匹配', isDefault: true, priority: 100,
    searchTerms: 'camera shot framing composition angle view lens 镜头 景别 构图 视角', scenes: ALL_SCENES,
    content: '每张图选择一个主景别和一个主视角。full body 用于展示完整姿态，cowboy shot/upper body 用于人物互动与自拍，close-up 用于表情或局部；景别应与必须入画的身体范围一致。',
  },
  {
    knowledgeId: 'ipk.camera.closeup', category: 'camera', title: '近景排除全身要求', isDefault: false, priority: 98,
    searchTerms: 'close-up closeup portrait face focus headshot expression 近景 特写 脸部 表情 头像', scenes: ALL_SCENES,
    content: 'close-up、face focus 或 headshot 不与 full body 同时使用。近景只保留面部、肩部和必要手部动作；如果动作依赖腿部或全身空间，改用 cowboy shot 或 medium shot。',
  },
  {
    knowledgeId: 'ipk.camera.fullbody', category: 'camera', title: '全身镜头空间', isDefault: false, priority: 96,
    searchTerms: 'full body wide shot standing walking group feet visible 全身 远景 站立 行走 多人', scenes: ALL_SCENES,
    content: 'full body 需要为头顶和脚部留出空间，使用 from front/from side/from behind 中一个方向。不要同时要求 close-up 或过多局部 focus；多人全身画面优先 wide shot。',
  },
  {
    knowledgeId: 'ipk.camera.pov', category: 'camera', title: 'POV 可见范围', isDefault: false, priority: 99,
    searchTerms: 'pov first person viewer perspective point of view 第一人称 主观视角 视角', scenes: ['chat', 'events', 'schedule', 'mailbox', 'proactive', 'standalone'],
    content: 'POV 表示观看者占据镜头位置，通常不应再要求观看者的完整身体或 full body。只描述合理可见的手臂/手，并明确被摄主体朝向镜头的关系。',
  },
  {
    knowledgeId: 'ipk.gaze.default', category: 'gaze', title: '单人默认视线', isDefault: true, priority: 90,
    searchTerms: 'gaze looking at viewer eye contact facing viewer 视线 看镜头 直视 正面', scenes: ALL_SCENES,
    content: '清醒的单人正面画面在用户未指定时可使用 looking at viewer；回眸使用 over shoulder + looking at viewer，侧脸使用 profile/from side。视线标签必须与头部朝向一致。',
  },
  {
    knowledgeId: 'ipk.gaze.away', category: 'gaze', title: '背影与侧脸视线', isDefault: false, priority: 96,
    searchTerms: 'from behind facing away back view profile side face walking away 背影 背对 侧脸 远去 回眸', scenes: ALL_SCENES,
    content: '纯背影使用 from behind + facing away，不再加入 looking at viewer；若要回眸，改为 over shoulder + looking at viewer。profile/from side 与正面直视只保留一个意图。',
  },
  {
    knowledgeId: 'ipk.gaze.sleep', category: 'gaze', title: '睡眠与闭眼规则', isDefault: false, priority: 100,
    searchTerms: 'sleep sleeping asleep unconscious closed eyes bed nap 睡觉 熟睡 昏迷 闭眼 午睡', scenes: ['chat', 'events', 'schedule', 'mailbox', 'proactive', 'standalone'],
    content: 'sleeping、asleep 或 unconscious 必须使用 closed eyes，并移除 looking at viewer、direct eye contact 和需要主动注视的瞳孔效果。睡姿需与 lying/on bed 等身体支撑一致。',
  },
  {
    knowledgeId: 'ipk.clothing.default', category: 'clothing_state', title: '服装状态单值化', isDefault: true, priority: 100,
    searchTerms: 'clothing clothes outfit dressed state costume wardrobe 服装 衣服 穿着 状态 制服', scenes: ALL_SCENES,
    content: '先确定一套核心服装，再指定一个清晰状态：正常、敞开、掀起、半脱、湿透或全裸。不要把同一衣物同时描述为完整穿着和已脱下；服装改造维度最多保留两种。',
  },
  {
    knowledgeId: 'ipk.clothing.partial', category: 'clothing_state', title: '半脱状态一致性', isDefault: false, priority: 96,
    searchTerms: 'partially undressed half dressed open shirt unbuttoned skirt lift wet clothes 半脱 敞开 掀起 湿透 破损', scenes: ALL_SCENES,
    content: '半脱画面保留核心服装名，并只选一种主要变化（open/unbuttoned、lifted、partially undressed、wet/see-through 或 torn）。明确哪一件衣物变化，避免全身多处同时变化造成结构混乱。',
  },
  {
    knowledgeId: 'ipk.clothing.nude', category: 'clothing_state', title: '全裸与服装互斥', isDefault: false, priority: 100,
    searchTerms: 'nude naked completely nude no clothes 全裸 裸体 没穿衣服', scenes: ALL_SCENES,
    content: 'completely nude 与具体上衣、裙装、裤装和内衣主体互斥；如需身份提示，只保留少量不改变裸体状态的配饰。不要同时写完整内衣套装与 no panties/bottomless。',
  },
  {
    knowledgeId: 'ipk.expression.level', category: 'expression', title: '表情强度匹配', isDefault: true, priority: 90,
    searchTerms: 'expression emotion face smile blush crying intense relaxed 表情 情绪 微笑 脸 红晕 哭 放松', scenes: ALL_SCENES,
    content: '日常单人和自拍使用自然的 1–2 个表情标签；强烈动作最多提高一级。不要同时使用 smile 与 crying、open mouth 与 closed mouth、looking at viewer 与 rolling eyes 等互斥面部状态。',
  },
  {
    knowledgeId: 'ipk.environment.default', category: 'environment', title: '环境与光线闭环', isDefault: true, priority: 100,
    searchTerms: 'environment scene location background lighting time weather indoors outdoors 环境 场景 地点 背景 光线 时间 天气 室内 室外', scenes: ALL_SCENES,
    content: '环境只保留一个主要地点、一个时间/天气状态和一个主光源。室内外、白天夜晚不可并存；光线应由场景中的窗户、灯、日光、月光等合理来源产生。',
  },
  {
    knowledgeId: 'ipk.environment.night', category: 'environment', title: '夜景主光源', isDefault: false, priority: 96,
    searchTerms: 'night nighttime moonlight neon lamp dark evening 夜晚 夜景 月光 霓虹 灯光 傍晚', scenes: ALL_SCENES,
    content: '夜景选择 moonlight、lamplight 或 neon lighting 中一个主光源，再用 soft shadows/rim light 补充。不要同时加入 bright sunlight；人物面部仍需可读，避免只写 dark。',
  },
  {
    knowledgeId: 'ipk.environment.day', category: 'environment', title: '日景光线方向', isDefault: false, priority: 94,
    searchTerms: 'day daytime sunlight morning afternoon window light outdoor 白天 日光 早晨 下午 窗光 户外', scenes: ALL_SCENES,
    content: '日景使用 sunlight、morning light、afternoon light 或 window light 中一个主描述，并让阴影方向与光源一致。室内窗光和室外日光不要堆叠为两个不同场景。',
  },
  {
    knowledgeId: 'ipk.conflict.core', category: 'conflict', title: '核心互斥清理', isDefault: true, priority: 110,
    searchTerms: 'conflict contradiction incompatible cleanup deduplicate 冲突 互斥 矛盾 去重 清理', scenes: ALL_SCENES,
    content: '最终检查并删除互斥项：from front/from behind、from above/from below、close-up/full body、looking at viewer/facing away、standing/lying、open mouth/closed mouth、spread fingers/clenched fist、spread legs/legs together。用户明确要求优先于默认规则。',
  },
  {
    knowledgeId: 'ipk.detail.limit', category: 'detail_limit', title: '细节预算与防畸形', isDefault: true, priority: 88,
    searchTerms: 'detail anatomy hands fingers feet limbs quality clutter 细节 解剖 手 指 脚 肢体 质量 堆叠', scenes: ALL_SCENES,
    content: '单人画面控制在约 16–30 个核心标签，双人约 22–38 个；质量词和光线词各保留少量。手脚只在叙事需要时描述，不要同时指定每根手指、脚趾和多个局部 focus。',
  },
];

export const IMAGE_PROMPT_KNOWLEDGE = [
  ...IMAGE_PROMPT_FRAMEWORK_KNOWLEDGE,
  ...IMAGE_PROMPT_TAG_KNOWLEDGE,
];
