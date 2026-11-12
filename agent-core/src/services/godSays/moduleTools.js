import { executeStudioPhoto, buildStudioPhotoBody, studioPhotoResult } from './studioPhotos.js';
import { isPairPose } from '../photoStudioWorkflow.js';

// 每个工具固定绑定已有业务接口；模型不能提供任意 URL、HTTP 方法或请求体。
const text = (description, maxLength = 2000) => ({ type: 'string', description, minLength: 1, maxLength });
const ident = description => ({ type: 'integer', description, minimum: 1 });
const integer = (description, minimum = 1, maximum = 100) => ({ type: 'integer', description, minimum, maximum });
const bool = description => ({ type: 'boolean', description });
const ids = description => ({ type: 'array', description, items: ident('角色编号'), minItems: 2, maxItems: 30, uniqueItems: true });
const page = { limit: integer('每页数量，默认20，最多50', 1, 50), offset: integer('分页偏移，默认0', 0, 100000) };
const char = { character_id: ident('先查询真实角色编号') };
const group = { group_id: ident('先查询真实群聊编号') };
const date = text('有效的 YYYY-MM-DD 当地日期', 10);

function tool(name, module, label, description, properties, required, method, path, options = {}) {
  return { name, module, label, method, path, ...options, definition: { type: 'function', function: {
    name, description: `【${module}】${label}。${description}`,
    parameters: { type: 'object', properties, required, additionalProperties: false },
  } } };
}

export const GOD_MODULE_TOOLS = [
  tool('read_angel', '天使', '读取自己的资料与服装', '天使使用独立档案，不使用 character_id。读取名字、完整人设与四套服装。', {}, [], 'GET', '/api/god-says/angel', { select: d => ({ display_name: d.display_name, persona: d.persona, outfits: d.outfits, standings: d.standings }) }),
  tool('update_angel', '天使', '修改自己的资料', '仅提供用户要求修改的字段。改名只传 display_name，不重传人设；确认卡展示新旧值，确认后生效。外观段修改用 apply_angel_appearance，场景服装用 generate_angel_outfits。', { display_name: text('新的天使显示名', 40), persona: text('仅修改人设时提供完整新版', 50000) }, [], 'PUT', '/api/god-says/angel'),
  tool('read_private_chat', '聊天', '读取私聊', '查看最近发言，支持按原始消息编号分页，不改变聊天记录。', { ...char, limit: page.limit, before_id: ident('更早消息的 raw id 游标，可省略') }, ['character_id'], 'GET', '/api/characters/:character_id/dialogue', { query: { limit: 'limit', before_id: 'before' }, href: a => `/chat/${a.character_id}` }),
  tool('send_private_message', '聊天', '向角色传话', '仅在神明确要求传话时使用，以用户身份进入真实私聊；遵循角色日程，可能排队。返回实际保存的消息或排队状态，不代表角色已行动。', { ...char, message: text('用户授权传达的内容', 5000) }, ['character_id', 'message'], 'POST', '/api/characters/:character_id/chat', { body: a => ({ message: a.message, image_mode: 'off' }), clientKey: true, stream: true, href: a => `/chat/${a.character_id}` }),
  tool('list_groups', '群聊', '查询群聊', '返回群名、话题、真实成员和编号。', {}, [], 'GET', '/api/groups'),
  tool('read_group_chat', '群聊', '读取群聊上文', '读取真实群聊最近消息，以便接续话题。', { ...group, limit: page.limit, before_id: ident('更早消息游标') }, ['group_id'], 'GET', '/api/groups/:group_id/messages', { query: { limit: 'limit', before_id: 'before' }, href: a => `/group/${a.group_id}` }),
  tool('create_group', '群聊', '创建群聊', '至少两位真实角色；只建立群聊，需要讨论时再调用 discuss_in_group。', { name: text('群名', 80), topic: text('群聊话题', 300), member_ids: ids('至少2位不同角色的编号') }, ['name', 'member_ids'], 'POST', '/api/groups', { href: (a, d) => `/group/${d.group?.id}` }),
  tool('update_group', '群聊', '调整群名与话题', '仅更新提供的字段，不替换成员。', { ...group, name: text('群名', 80), topic: text('话题', 300) }, ['group_id'], 'PATCH', '/api/groups/:group_id', { href: a => `/group/${a.group_id}` }),
  tool('add_group_members', '群聊', '邀请角色入群', '添加真实角色，沿用群聊成员校验。', { ...group, member_ids: { ...ids('要添加的角色编号'), minItems: 1 } }, ['group_id', 'member_ids'], 'PATCH', '/api/groups/:group_id', { body: a => ({ add_member_ids: a.member_ids }), href: a => `/group/${a.group_id}` }),
  tool('list_moments', '朋友圈', '浏览朋友圈', '查询真实动态，可按角色筛选。', { ...char, ...page }, [], 'GET', '/api/moments', { query: { character_id: 'character_id', limit: 'limit', offset: 'offset' }, href: '/moments' }),
  tool('read_moment', '朋友圈', '读取动态与评论', '查看指定动态、配图和评论。', { post_id: ident('朋友圈编号') }, ['post_id'], 'GET', '/api/moments/:post_id', { href: '/moments' }),
  tool('comment_on_moment', '朋友圈', '评论朋友圈', '只有神明确要求评论时使用，以用户身份发言，保留帖主的既有自动回评机制。', { post_id: ident('动态编号'), content: text('用户授权的评论', 1500), reply_to_comment_id: ident('回复某条评论时填写') }, ['post_id', 'content'], 'POST', '/api/moments/:post_id/comments', { href: '/moments' }),
  tool('publish_user_moment', '朋友圈', '发布神的动态', '仅在明确要求以用户身份发朋友圈时使用；让某个角色发帖应使用 publish_moment。', { content: text('用户授权发布的正文', 5000) }, ['content'], 'POST', '/api/moments/user-post', { href: '/moments' }),
  tool('list_letters', '信箱', '查看信箱', '查询来信与回信状态，不替用户标记已读。', {}, [], 'GET', '/api/mailbox', { href: '/mailbox', select: d => ({ letters: (d.letters || []).slice(0, 40), total: d.letters?.length || 0 }) }),
  tool('send_letter', '信箱', '给角色写信', '仅按神明确要求寄出，以用户身份发信，沿用3至10分钟的回信等待；已寄出不代表已回信。', { ...char, title: text('信件标题', 100), content: text('用户授权的信件正文', 6000) }, ['character_id', 'content'], 'POST', '/api/mailbox/send', { href: '/mailbox', pending: true }),
  tool('read_diary', '日记', '读取角色日记', '日期省略则为今天，空日记不编造。', { ...char, date }, ['character_id'], 'GET', '/api/diaries/:character_id', { query: { date: 'date' }, href: '/schedule' }),
  tool('list_diaries', '日记', '查阅日记目录', '返回指定角色的历史日记简目。', { ...char, limit: page.limit }, ['character_id'], 'GET', '/api/diaries/:character_id/history', { query: { limit: 'limit' }, href: '/schedule' }),
  tool('generate_diary', '日记', '请角色整理日记', '沿用日记后台任务；返回受理状态，需 read_diary 查看实际生成结果。', { ...char, date }, ['character_id'], 'POST', '/api/diaries/:character_id/generate', { href: '/schedule', pending: true }),
  tool('schedule_overview', '日程', '查看大家的日程', '查询全体角色当前安排与睡眠概况。', {}, [], 'GET', '/api/schedule', { href: '/schedule' }),
  tool('regenerate_schedule', '日程', '重排角色日程', '根据神的要求重生成完整日程；只代表计划，沿用今日快照和睡眠状态同步。', { ...char, direction: text('重排方向与约束', 2000) }, ['character_id', 'direction'], 'POST', '/api/schedule/:character_id/regenerate', { href: '/schedule' }),
  tool('wake_character', '日程', '打电话叫醒角色', '遵循现有叫醒次数、睡眠判定与角色回应，不保证叫醒成功。', char, ['character_id'], 'POST', '/api/schedule/:character_id/wake-up-phone', { href: '/schedule' }),
  tool('list_encounters', '奇遇', '查看奇遇进展', '读取当前奇遇与历史，不替用户选择选项。', {}, [], 'GET', '/api/events', { href: '/events' }),
  tool('read_encounter', '奇遇', '读取一段奇遇', '支持普通编号或 town:编号，保持奇遇选项由玩家推进。', { event_id: text('真实奇遇编号，镇民奇遇形如 town:12', 80) }, ['event_id'], 'GET', '/api/events/by-id/:event_id', { href: a => `/events?event=${encodeURIComponent(a.event_id)}` }),
  tool('read_backpack', '背包', '查看背包与宝箱', '返回已收下/待收下道具、宝箱冷却和生效效果。', {}, [], 'GET', '/api/items', { href: '/backpack' }),
  tool('open_daily_chest', '背包', '开启每日宝箱', '遵循现有16小时冷却，图片可能后台生成，不绕过额度。', {}, [], 'POST', '/api/items/chest/open', { href: '/backpack' }),
  tool('collect_item', '背包', '收下道具', '将待收下道具收入背包。', { item_id: ident('真实道具编号') }, ['item_id'], 'POST', '/api/items/:item_id/collect', { href: '/backpack' }),
  tool('use_item', '背包', '对角色使用道具', '仅按神明确指定使用，沿用库存、消耗与效果校验；礼物叙事可能后台生成。', { item_id: ident('道具编号'), ...char }, ['item_id', 'character_id'], 'POST', '/api/items/:item_id/use', { href: '/backpack' }),
  tool('inject_character_state', '背包', '注入状态或变装', '神的直接塑造：给角色注入一种状态或外观，默认持续一天，不消耗背包道具。kind 选 outfit（服饰/换装）、hairstyle（发型）、transform（变身形态）、buff（身心状态）；description 写清外观细节或状态表现。', {
    ...char,
    kind: { type: 'string', enum: ['outfit', 'hairstyle', 'transform', 'buff'], description: '状态类型：outfit 服饰/换装、hairstyle 发型、transform 变身形态、buff 身心状态' },
    name: text('状态或外观名称', 60),
    description: text('外观细节；buff 时写清角色应如何表现', 1000),
    hours: integer('持续小时数，默认 24', 1, 168),
  }, ['character_id', 'kind', 'name', 'description'], 'POST', '/api/items/inject', { href: '/backpack' }),
  tool('read_gift_story', '背包', '查看赠礼叙事', '查询 use_item 返回的 sessionId，确认赠礼叙事实际进展。', { session_id: text('礼物叙事 sessionId', 100) }, ['session_id'], 'GET', '/api/items/gift/:session_id', { href: '/backpack' }),
  tool('read_relationships', '关系', '查询角色关系', '读取真实关系文本。', char, ['character_id'], 'GET', '/api/relationships', { query: { character_id: 'character_id' }, href: '/tavern' }),
  tool('create_relationship', '关系', '设定角色关系', '只按神明确要求建立一条有方向的关系，已存在时会拒绝。', { from_character_id: ident('起点角色'), to_character_id: ident('目标角色'), relationship_text: text('关系设定', 2000) }, ['from_character_id', 'to_character_id', 'relationship_text'], 'POST', '/api/relationships', { href: '/tavern' }),
  tool('update_relationship', '关系', '调整已有关系', '先查询真实关系编号，再按神要求修改其描述。', { relationship_id: ident('关系编号'), relationship_text: text('新的关系描述', 2000) }, ['relationship_id', 'relationship_text'], 'PUT', '/api/relationships/:relationship_id', { href: '/tavern' }),
  tool('read_character_emotion', '关系', '了解角色情绪与画像', '读取好感度、情绪状态和已有画像，不把推测当事实。', char, ['character_id'], 'GET', '/api/portraits/:character_id', { href: a => `/chat/${a.character_id}` }),
  tool('search_character_memory', '记忆', '搜索角色记忆', '仅在神要求了解某个角色往事时查询；不会把天使私有记忆写给角色。', { ...char, query: text('搜索内容', 200), limit: integer('返回条数', 1, 20) }, ['character_id', 'query'], 'GET', '/api/memory/search', { query: { query: 'q', limit: 'top_k' }, extraQuery: a => ({ conversation_id: `char_${a.character_id}` }) }),
  tool('list_character_memories', '记忆', '读取角色记忆目录', '按角色读取已有记忆片段，支持分页。', { ...char, ...page }, ['character_id'], 'GET', '/api/memory/fragments', { query: { limit: 'limit', offset: 'offset' }, extraQuery: a => ({ conversation_id: `char_${a.character_id}` }) }),
  tool('search_gallery', '相册', '查找邻舍图片', '可按角色和文件夹筛选已保存图片，返回图片地址。', { ...char, folder: text('先查询得到的文件夹键', 80), ...page }, [], 'GET', '/api/images/gallery', { query: { character_id: 'character', folder: 'folder', limit: 'limit', offset: 'offset' }, href: '/gallery' }),
  tool('generate_image', '相册', '生成并发送图片', '图片实验室：要求图片对应某个活动、上下文或具体情境就使用，包括先查询后确定情境；例如“她在干什么，发图看看”“按刚才聊的场景画一张”。情境可来自用户、上文或工具结果，不要求用户把动作说全，不先查姿势库或用随机照片代替。明显超出照相馆能力的作图也使用。仅泛泛要一至两位人物的图片、自拍或合照才默认 generate_studio_photo；用户点名渠道优先。生成后保存并发送到当前神说对话。prompt 须完整写入已查到的活动、地点、相关上下文和用户要求，日程只作计划情境，不冒充已发生事实；已知角色保留真实姓名，用姓名描述各自动作与位置，不只写一位少女、她等。已查询到的入镜角色必须传 character_ids，后端按编号加载身份、外观和 LoRA，不用凭记忆重写外貌。未传编号时仅按描述中的角色显示名匹配，不继承聊天查询结果。画自己或天使与角色同框时传 special_characters: ["angel"]，后端读取当前天使外观；prompt 保留天使称呼或名字及动作位置，不代写外貌，天使不占居民编号。未指定宽高时沿用对话分辨率，宽高仅覆盖本次，不修改设置。成功返回 images 本地地址；失败不声称已发送。', {
    prompt: text('完整中文画面描述：保留入镜角色真实姓名，写明动作、位置、场景和本次要求。上下文或查询配图须把相关情境完整写入，不能只写“按上文”；日程只作计划。例如“按日程安排，流萤坐在书房窗边看书”。不填文件路径', 5000),
    character_ids: { type: 'array', description: '已查询到的入镜角色真实编号；只列实际入镜者，不列仅被提及者、用户或天使。后端直接加载这些角色的资料，不能猜编号。', items: ident('已查询到的入镜角色编号'), minItems: 1, maxItems: 30, uniqueItems: true },
    special_characters: { type: 'array', description: '画你自己（天使）或天使与角色同框时必须传 ["angel"]，后端读取神说当前保存的天使外观，不需要手写外貌；仅提及天使但不入镜时传 []。天使不放进 character_ids。', items: { type: 'string', enum: ['angel'] }, minItems: 0, maxItems: 1, uniqueItems: true },
    width: integer('可选宽度像素；神指定尺寸或比例时设置，默认对话宽度', 256, 4096),
    height: integer('可选高度像素；默认对话高度', 256, 4096), artist: text('可选画师风格串；默认沿用对话画师设置', 2000),
  }, ['prompt'], 'POST', '/api/images/test-style', { body: a => ({ sceneDesc: a.prompt, mode: 'chat', saveToChat: true,
    ...(a.character_ids !== undefined ? { character_ids: a.character_ids } : {}),
    ...(a.special_characters !== undefined ? { special_characters: a.special_characters } : {}),
    ...(a.width !== undefined ? { width: a.width } : {}), ...(a.height !== undefined ? { height: a.height } : {}), ...(a.artist !== undefined ? { artist: a.artist } : {}),
  }), href: '/gallery' }),
  tool('read_image_task', '相册', '查看图片生成结果', '按真实生图任务编号查询状态与输出文件。', { task_id: ident('task_id') }, ['task_id'], 'GET', '/api/images/tasks/:task_id/status', { href: '/gallery' }),
  tool('read_photo_studio_capability', '照相馆', '查看照相馆可用状态', '查询当前 Anima 工作流和 ComfyUI 是否可用。拍摄前先检查；不可用时明确说明原因，不自动切换提供商或改用图片实验室。', {}, [], 'GET', '/api/photo-studio/capability', { href: '/photo-studio' }),
  tool('search_photo_studio_poses', '照相馆', '查询照相馆姿势库', '仅返回已校准姿势的真实编号、名称、体系、分类、角度与人数。用户明确选择照相馆且有姿势或角度筛选需要时查询；未指定渠道的活动、上下文或具体情境配图直接用图片实验室，包括查询后确定的情境，不用此工具找近似动作。泛泛拍照默认随机，无需先查。手动选择须先查，不能猜编号；双人须选 person_count=2，顺序对应主角与搭档。', {
    query: text('空格分隔的搜索词，全部匹配名称、编号或分类', 200), system: text('目录中的姿势体系', 100), category: text('目录中的分类', 100), angle: text('目录中的角度，如正面、侧面、俯视', 40),
    person_count: integer('入镜人数，1 单人、2 双人', 1, 2), ...page,
  }, [], 'GET', '/api/photo-studio/catalog', { query: { query: 'query', system: 'system', category: 'category', angle: 'angle', person_count: 'person_count', limit: 'limit', offset: 'offset' }, extraQuery: () => ({ compact: '1' }), href: '/photo-studio',
    select: d => ({ ...d, poses: d.poses.map(({ id, name, system, category, angle, characterRoles }) => ({ id, name, system, category, angle, person_count: isPairPose({ id, system }) ? 2 : 1, ...(characterRoles ? { character_roles: characterRoles } : {}) })) }) }),
  tool('search_photo_studio_backgrounds', '照相馆', '查询照相馆背景库', '返回背景真实编号、名称、分类和中文描述，可分页。用户明确选择照相馆且指定背景时先查再选，不编写替代背景。未指定渠道的活动、上下文或具体情境配图用图片实验室，不以库中背景代替情境；泛泛要人物图默认后端随机背景，无需查询。', {
    query: text('空格分隔的搜索词，全部匹配名称、编号或描述', 200), category: text('目录中的背景分类', 100), ...page,
  }, [], 'GET', '/api/photo-studio/backgrounds', { query: { query: 'query', category: 'category', limit: 'limit', offset: 'offset' }, extraQuery: () => ({ compact: '1' }), href: '/photo-studio',
    select: d => ({ ...d, entries: d.entries.map(({ id, label, category, description }) => ({ id, label, category, description })) }) }),
  tool('generate_studio_photo', '照相馆', '在照相馆拍摄并发送照片', '泛泛要一至两位人物图片、自拍或合照时默认使用，无需点名照相馆或说明人像写真。例如“给流萤拍张照”“发一张流萤的图片”“发你和流萤的图片”；只选已有服装、尺寸或笼统美观要求仍可用。要求图片对应活动、上下文或具体情境时改用 generate_image，包括“她在干什么，发图看看”、先查询再配图及“按刚才的场景画”；必须结合完整请求和上文，不因只出现“发张图”就用随机拍摄。超出能力的要求也用实验室，用户点名渠道优先遵循。支持天使自拍、与居民合照及居民单人或双人照。主角指定 character_id 或 special_character:"angel"，搭档指定 second_character_id 或 second_special_character:"angel"，同一位置二选一且两位不同，天使不占居民编号。天使外观及四套服装直接读 god_angel，不代写。默认省略 pose_id / background_id，后端按人数随机抽库；用户明确选照相馆且有筛选要求才查库传真实编号。instruction 只补充表情氛围，不覆盖库中动作背景。服装只影响本次，AI润色默认关闭。先检查可用状态；accepted 仍在拍摄，用 read_studio_photo 查询，不重复提交。', {
    ...char, special_character: { type: 'string', enum: ['angel'], description: '主角是天使自己时传 angel，与 character_id 二选一' },
    second_character_id: ident('搭档是普通居民时传真实编号'), second_special_character: { type: 'string', enum: ['angel'], description: '搭档是天使时传 angel，与 second_character_id 二选一' },
    pose_id: text('可选：已查询到的校准姿势编号；省略或 random 按实际人数随机', 100), background_id: text('可选：已查询到的背景编号；省略或 random 从背景库随机', 100),
    outfit_scene: { type: 'string', enum: ['work', 'casual', 'home', 'sleep'], description: '主角本次服装；work 默认，其他槽位读取该居民或天使已保存的服装' },
    second_outfit_scene: { type: 'string', enum: ['work', 'casual', 'home', 'sleep'], description: '搭档本次服装，直接读取对应居民或天使的衣柜，默认 work' },
    instruction: text('少量补充要求，不改写姿势和背景', 1000), polish_prompt: bool('是否使用照相馆 AI 润色，默认 false'),
    width: integer('本次宽度：512–2048 且为8的倍数，默认1152', 512, 2048), height: integer('本次高度：512–2048 且为8的倍数，默认2048', 512, 2048),
  }, [], 'POST', '/api/photo-studio/jobs', { body: buildStudioPhotoBody, href: '/photo-studio' }),
  tool('read_studio_photo', '照相馆', '查看照相馆拍摄结果', '用 generate_studio_photo 返回的 job_id 查询真实状态。完成后 images 直接展示到本条回复，失败如实说明，不重复拍摄。', { job_id: text('工具返回的拍摄记录 job_id', 100) }, ['job_id'], 'GET', '/api/photo-studio/jobs/:job_id', { select: studioPhotoResult, href: '/photo-studio' }),
  tool('list_outfits', '角色', '查看角色外观', '读取专属外观列表及启用状态。', char, ['character_id'], 'GET', '/api/characters/:character_id/outfits', { href: '/tavern' }),
  tool('read_scene_outfits', '角色', '查看场景服装', '读取默认、私服、居家、睡衣槽位中的现有服装，不查询日程。', char, ['character_id'], 'GET', '/api/characters/:character_id/outfits/scene', { href: '/tavern' }),
  tool('generate_scene_outfits', '角色', '生成场景服装草稿', '生成或修改私服、居家服、睡衣必须用此工具。调用邻舍已有服装生成接口及其生图描述规则，先生成完整草稿，用户在卡片确认后仅写入指定场景槽位；不修改基础外观，不创建独立专属形态，不自动生图。可用 batch_characters 逐角色生成。', {
    ...char,
    scenes: { type: 'array', description: '指定目标槽位：casual 私服、home 居家、sleep 睡衣；只选用户要求的槽位', items: { type: 'string', enum: ['casual', 'home', 'sleep'] }, minItems: 1, maxItems: 3, uniqueItems: true },
    instruction: text('用户对款式、颜色或修改已有服装的要求；没有额外要求可省略，不代写最终外观正文', 4000),
  }, ['character_id', 'scenes'], 'POST', '/api/characters/:character_id/outfits/generate', { body: a => ({ scenes: a.scenes, instruction: a.instruction, save: false, generateImages: false }), href: '/tavern' }),
  tool('create_outfit', '角色', '创建专属外观', '新增独立、可切换的专属外观。instruction 填设计要求，由原外观扩写服务生成规范正文；只有用户明确给了完整最终描述时才传 description，两者二选一。新增直接保存但不启用，启用另用 set_outfit_enabled。私服/居家/睡衣用 generate_scene_outfits，基础外观用 apply_character_appearance。', { ...char, name: text('新增外观名称', 60), instruction: text('服装或形态设计要求，不代写最终描述', 2000), description: text('用户明确提供的完整最终外观正文', 5000) }, ['character_id', 'name'], 'POST', '/api/characters/:character_id/outfits', { href: '/tavern' }),
  tool('set_outfit_enabled', '角色', '切换角色外观', '先查询真实外观编号；启用时由现有服务互斥关闭该角色其他专属外观。', { ...char, outfit_id: ident('专属外观编号'), enabled: bool('是否启用') }, ['character_id', 'outfit_id', 'enabled'], 'PUT', '/api/characters/:character_id/outfits/:outfit_id', { body: a => ({ enabled: a.enabled ? 1 : 0 }), href: '/tavern' }),
  tool('recruit_character', '角色', '招募新角色', '按神明确要求创建一位新角色，走酒馆既有人格生成流程，不修改已有角色。', { description: text('角色名称、人格和背景要求', 4000) }, ['description'], 'POST', '/api/characters/generate', { body: a => ({ description: a.description, save: true }), href: '/tavern', pending: true }),
  tool('read_character_standings', '立绘', '查看角色立绘', '读取角色立绘素材与生成任务。', char, ['character_id'], 'GET', '/api/characters/:character_id/standings', { href: '/tavern' }),
  tool('read_expression_standings', '立绘', '查看表情立绘', '读取表情立绘组与任务状态。', char, ['character_id'], 'GET', '/api/characters/:character_id/expression-standings', { href: '/tavern' }),
  tool('read_emoji_overview', '表情包', '查看表情包素材', '查询现有角色表情包与生成状态。', {}, [], 'GET', '/api/characters/emoji/overview', { href: '/tavern' }),
  tool('list_emoji_categories', '表情包', '查看表情类别', '读取真实表情语义类别。', {}, [], 'GET', '/api/characters/emoji/categories'),
  tool('list_media_outlets', '媒体', '查看媒体目录', '查询已有媒体及编号。', {}, [], 'GET', '/api/media/outlets', { href: '/media' }),
  tool('list_media_boards', '媒体', '查看媒体板块', '查询指定媒体下的真实板块。', { outlet_id: ident('媒体编号') }, ['outlet_id'], 'GET', '/api/media/outlets/:outlet_id/boards', { href: '/media' }),
  tool('read_media_posts', '媒体', '阅读媒体内容', '可按媒体、板块筛选；使用分页限制返回量。', { outlet_id: ident('媒体编号'), board_id: ident('板块编号'), ...page }, [], 'GET', '/api/media/posts', { query: { outlet_id: 'outlet', board_id: 'board', limit: 'limit', offset: 'offset' }, href: '/media' }),
  tool('refresh_media', '媒体', '生成新一批媒体内容', '后台刷新已有媒体，返回已受理；随后 read_media_posts 与 read_media_status 核对结果。', { outlet_id: ident('媒体编号，省略则全体'), count: integer('生成数量', 1, 5) }, [], 'POST', '/api/media/refresh', { body: a => ({ outletId: a.outlet_id, count: a.count || 1 }), href: '/media', pending: true }),
  tool('read_media_status', '媒体', '查看媒体任务状态', '读取媒体后台任务状态，不把受理当生成完成。', {}, [], 'GET', '/api/media/status', { href: '/media' }),
  tool('read_newspaper', '日报', '阅读邻舍日报', '读取今天的日报；查询往期请先查目录。', {}, [], 'GET', '/api/newspaper/today', { href: '/moments' }),
  tool('list_newspapers', '日报', '查阅日报目录', '返回往期日报日期与标题。', {}, [], 'GET', '/api/newspaper/editions', { href: '/moments' }),
  tool('read_newspaper_by_date', '日报', '阅读往期日报', '按目录里的真实日期读取。', { date }, ['date'], 'GET', '/api/newspaper/by-date/:date', { href: '/moments' }),
  tool('generate_newspaper', '日报', '补发今日日报', '遵循现有日报生成时间、冷却与并发规则；已存在则读现有日报。', {}, [], 'POST', '/api/newspaper/generate', { pending: true, href: '/moments' }),
  tool('list_world_settings', '世界观', '查看世界观', '读取世界观内容和当前启用项，不读取模型凭据。', {}, [], 'GET', '/api/config/world-settings', { href: '/tavern' }),
  tool('list_prompt_presets', '预设', '查看叙事预设', '读取已保存的预设目录，不自行改动当前预设。', {}, [], 'GET', '/api/presets', { href: '/settings', select: d => ({ presets: (Array.isArray(d) ? d : d.items || []).map(({ id, name, active, revision }) => ({ id, name, active, revision })) }) }),
  tool('list_event_types', '素材库', '查询奇遇类型', '读取可用奇遇类型，作为创作参考。', {}, [], 'GET', '/api/library/event-types'),
  tool('list_moment_topics', '素材库', '查询朋友圈话题', '读取现有话题库，作为创作参考。', {}, [], 'GET', '/api/library/topics'),
  tool('create_moment_topic', '素材库', '新增朋友圈话题', '按神指定的名称和内容新增话题。', { name: text('话题名', 80), desc: text('话题内容', 1500) }, ['name', 'desc'], 'POST', '/api/library/topics'),
  tool('create_event_type', '素材库', '新增奇遇类型', '按神指定的名称与描述建立可复用奇遇类型，默认60分钟。', { name: text('奇遇类型名', 80), desc: text('类型描述', 1500), urgency: integer('紧急程度1至5', 1, 5) }, ['name', 'desc'], 'POST', '/api/library/event-types'),
  tool('read_voice_binding', '语音', '查看角色语音', '读取角色的语音绑定和可用状态，不读取服务端凭据。', char, ['character_id'], 'GET', '/api/tts/characters/:character_id', { href: '/settings' }),
  tool('speak_chat_message', '语音', '朗读已保存私聊', '只朗读这位角色真实已保存的消息，message_id 使用 read_private_chat 返回的 speech_segments 内的 id，不使用 raw id。进入既有语音任务，不创建音色或安装模型。', { ...char, message_id: ident('speech_segments 中的消息编号') }, ['character_id', 'message_id'], 'POST', '/api/tts/characters/:character_id/messages/:message_id', { pending: true, href: a => `/chat/${a.character_id}` }),
  tool('read_speech_job', '语音', '查看语音生成结果', '查询语音任务返回的真实编号与音频地址。', { job_id: text('语音任务编号', 100) }, ['job_id'], 'GET', '/api/tts/jobs/:job_id'),
  tool('create_world_setting', '世界观', '新增世界观', '按神明确给出的设定创建新世界观，不自动激活。', { name: text('世界观名称', 100), content: text('完整世界观设定', 12000) }, ['name', 'content'], 'POST', '/api/config/world-settings', { href: '/tavern' }),
  tool('update_world_setting', '世界观', '修改世界观', '先读取原文，只在神明确要求修改时提交完整名称与内容，避免遗漏原设定。', { world_id: ident('世界观编号'), name: text('保留或修改后的名称', 100), content: text('完整新设定，保留未要求改动的部分', 12000) }, ['world_id', 'name', 'content'], 'PUT', '/api/config/world-settings/:world_id', { href: '/tavern' }),
  tool('activate_world_setting', '世界观', '切换世界观', '仅按神明确要求激活指定世界观，会影响后续创作与角色聊天。', { world_id: ident('先查询真实世界观编号') }, ['world_id'], 'POST', '/api/config/world-settings/:world_id/activate', { href: '/tavern' }),
  tool('create_media_outlet', '媒体', '创办媒体', '按神要求创建一个媒体内容源，之后可新增板块并刷新内容。', { name: text('媒体名称', 100), tagline: text('简介', 200), prompt: text('媒体的内容方向与风格', 3000) }, ['name', 'prompt'], 'POST', '/api/media/outlets', { href: '/media' }),
  tool('create_media_board', '媒体', '新增媒体板块', '给已有媒体增加一个板块。', { outlet_id: ident('媒体编号'), name: text('板块名', 80), desc: text('内容范围', 1000) }, ['outlet_id', 'name'], 'POST', '/api/media/outlets/:outlet_id/boards', { href: '/media' }),
  tool('set_media_favorite', '媒体', '收藏媒体内容', '按神要求收藏或取消收藏某条媒体内容，不使用反转状态的接口。', { post_id: ident('媒体帖子编号'), favorite: bool('是否收藏') }, ['post_id', 'favorite'], 'PUT', '/api/media/posts/:post_id/favorite', { href: '/media' }),
  tool('read_media_section', '媒体', '阅读门户板块正文', '使用帖子返回的真实 section_key；首次打开由原服务生成正文，已有内容直接返回。', { post_id: ident('门户帖子编号'), section_key: text('门户返回的真实板块键', 100) }, ['post_id', 'section_key'], 'POST', '/api/media/posts/:post_id/sections/:section_key', { href: '/media' }),
  tool('generate_character_avatar', '角色', '为角色生成头像', '仅在神要求换头像时调用，沿用角色完整人格与生图链，成功后保存候选图片，尚未替换角色头像。', char, ['character_id'], 'POST', '/api/characters/:character_id/generate-avatar', { href: '/tavern' }),
  tool('generate_character_standing', '立绘', '为角色生成立绘草稿', '沿用完整人格组装，返回后台任务；成图先暂存，需要在原立绘页面确认采用，不把草稿称为已替换。', { ...char, requirement: text('立绘姿势、衣服或构图要求', 500) }, ['character_id', 'requirement'], 'POST', '/api/characters/:character_id/generate-standing-task', { href: '/tavern', pending: true }),
  tool('read_image_edit_tasks', '相册', '查看待确认的图片', '查询立绘等后台草稿的状态与预览，待确认任务仍需用户在原页面采用。', {}, [], 'GET', '/api/images/edit-tasks', { href: '/gallery' }),
  tool('create_emoji_set', '表情包', '创建表情包组', '为角色建立一套配置，之后可生成各类别的提示词与图片。', { ...char, name: text('配置组名称', 80) }, ['character_id', 'name'], 'POST', '/api/characters/emoji/sets', { href: '/tavern' }),
  tool('read_emoji_set', '表情包', '读取一套表情包的完整状态', '先查询真实套装编号，读取每个表情的提示词、图片与生成状态，用于核验批量任务。', { set_id: ident('套装编号') }, ['set_id'], 'GET', '/api/characters/emoji/sets/:set_id', { href: '/tavern' }),
  tool('initialize_emoji_prompts', '表情包', '初始化或批量设计表情提示词', '指定一个真实角色和所属套装，复用原表情生成规则生成全部类别。空白套装直接新增；覆盖已有提示词时先展示完整草稿，确认后原样保存。随后调用 generate_emoji_images；这一步没有生成图片。', { ...char, set_id: ident('套装编号'), style: text('用户指定画面风格，可省略', 1000) }, ['character_id', 'set_id'], 'POST', '/api/characters/emoji/prompts', { body: a => ({ character_ids: [a.character_id], set_id: a.set_id, style: a.style }), href: '/tavern' }),
  tool('generate_emoji_images', '表情包', '批量生成表情图片', '已有提示词后才能生成，默认只处理尚无图片的类别；overwrite=true 表示重做已有图片，必须先确认。后台受理不等于完成，使用 read_emoji_set 核对逐项状态。', { ...char, set_id: ident('套装编号'), keys: { type: 'array', items: text('类别键', 100), minItems: 1, maxItems: 100, uniqueItems: true }, artist: text('画师风格', 500), overwrite: bool('是否覆盖已有图片，默认 false') }, ['character_id', 'set_id'], 'POST', '/api/characters/emoji/images', { body: a => ({ character_ids: [a.character_id], set_id: a.set_id, keys: a.keys, artist: a.artist, includeDone: a.overwrite === true, onlyMissing: a.overwrite !== true }), pending: true, href: '/tavern' }),
  tool('set_emoji_set_enabled', '表情包', '启停表情包组', '先查询真实表情包组编号，按神要求启用或停用。', { set_id: ident('配置组编号'), enabled: bool('是否启用') }, ['set_id', 'enabled'], 'POST', '/api/characters/emoji/sets/:set_id/activate', { href: '/tavern' }),
  tool('generate_emoji_prompt', '表情包', '准备一个表情画面', '用角色人格与当前外观为真实表情类别生成提示词；这一步只生成描述，未生成图片。', { ...char, emoji_key: text('先查询表情类别得到的键', 100), set_id: ident('表情包组编号'), style: text('画面风格', 1000) }, ['character_id', 'emoji_key', 'set_id'], 'POST', '/api/characters/emoji/:character_id/:emoji_key/prompt', { href: '/tavern' }),
  tool('generate_emoji_image', '表情包', '生成一个角色表情', '必须先有该表情的提示词，沿用角色参考图和完整人格生图服务。', { ...char, emoji_key: text('真实表情类别键', 100), set_id: ident('表情包组编号'), artist: text('用户指定的画师风格，可省略', 500) }, ['character_id', 'emoji_key', 'set_id'], 'POST', '/api/characters/emoji/:character_id/:emoji_key/image', { href: '/tavern' }),
];

const byName = new Map(GOD_MODULE_TOOLS.map(t => [t.name, t]));
export const moduleTool = name => byName.get(name);
export const moduleToolCatalog = () => GOD_MODULE_TOOLS.map(({ name, module, label, definition }) => ({ name, module, label, description: definition.function.description }));

export function buildModuleRequest(entry, args, ctx = {}) {
  const used = new Set();
  const path = entry.path.replace(/:([a-z_]+)/g, (_, key) => {
    used.add(key);
    const value = String(args[key]);
    if (value === '.' || value === '..' || /[\\/\u0000-\u001f]/u.test(value)) throw new Error('对象编号格式无效');
    return encodeURIComponent(value);
  });
  const query = new URLSearchParams();
  for (const [key, parameter] of Object.entries(entry.query || {})) {
    used.add(key);
    if (args[key] !== undefined) query.set(parameter, String(args[key]));
  }
  for (const [key, value] of Object.entries(entry.extraQuery?.(args) || {})) query.set(key, String(value));
  // 分页默认取20条，避免把相册、记忆或聊天一次性全部交给模型。
  if (entry.definition.function.parameters.properties.limit && !query.has('limit') && entry.query?.limit === 'limit') query.set('limit', '20');
  let body;
  if (entry.method !== 'GET') {
    body = entry.body ? entry.body(args, ctx) : Object.fromEntries(Object.entries(args).filter(([key]) => !used.has(key)));
    if (entry.clientKey) body.client_msg_id = `god-${ctx.effectKey}`;
  }
  return { method: entry.method, path: path + (query.size ? `?${query}` : ''), body, stream: entry.stream === true };
}

export async function executeModuleTool(entry, args, ctx, api) {
  if (!api) throw new Error('业务工具接口尚未连接');
  const request = buildModuleRequest(entry, args, ctx);
  const response = entry.name === 'generate_studio_photo' ? await executeStudioPhoto(request, ctx, api) : await api(request, ctx);
  const data = entry.select ? entry.select(response.data, args) : response.data;
  const failed=data?.results?.filter(item=>item.ok===false)||[];
  if (failed.length && failed.length===data.results.length) throw new Error(failed.map(item=>item.error||'生成失败').join('；'));
  const pending = response.status === 202 || data?.started === true || data?.queued === true || entry.pending || (entry.name === 'read_studio_photo' && data.status === 'running');
  const href = typeof entry.href === 'function' ? entry.href(args, data) : entry.href;
  return { status: failed.length ? 'partial' : data?.started===false ? 'not_started' : pending ? 'accepted' : 'returned', data, ...(href ? { href } : {}),
    note: failed.length || data?.partial ? '已有部分结果，但尚未完整结束；请到目标页面核对已保存内容。' : data?.started===false ? (data.generating?'本次未启动新任务，已有任务仍在处理，请查询实际进展。':data.message||'没有启动新的任务。') : pending ? '请求已交给原功能模块处理；请查询对应记录或任务，确认是否实际完成。' : '已取得原功能模块的实际返回结果。' };
}
