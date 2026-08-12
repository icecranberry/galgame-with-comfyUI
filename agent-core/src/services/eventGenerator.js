/**
 * 生活片段生成器
 *
 * EVENT_TYPES 描述的是"角色今天的生活进入了哪一种状态"，不是"发生了什么剧情"。
 *
 * 设计理念：
 *   - desc：描述"此刻是什么状态，不需要发生什么特别的事"
 *   - funFrom：这段生活的观看趣味来源（日常感/观察视角/身体感……）
 *   - reactions：角色在这种状态下的自然反应倾向（轻量参考，LLM 根据人格选择）
 *   - 所有具体物品/地点/人物/动作均由 LLM 根据角色人格+世界观自由创作
 *
 * - generateEvent(): LLM 结合角色人格+世界观，截取生活片段 + 配图
 * - generateNextBranch(): 用户选择后自然接续 + 配图
 * - concludeEvent(): 到期/完成后生成结局，存入记忆
 */

import { getDb, getSystemRules, getSystemRulesWithWorld, getWorldSetting, getGlobalRule } from '../db/index.js';
import { appendOathRing } from './oathUtils.js';
import { chatSync } from '../llm/llm-client.js';
import { generateImageRaw } from './imageSkill.js';
import { charArtistOverrideWithFallback } from './characterImageOpts.js';
import { recordCompletedImageTask } from './imageTaskRecorder.js';
import { saveBase64Image } from './imagePaths.js';
import { config } from '../config.js';
import { broadcastNewEvent, broadcastEventUpdate, broadcastEventConclusion } from './eventNotificationBus.js';
import { applyMemoryActions, softDeleteMemory } from './memory/memoryRepository.js';
import { getMemorySettings } from './memory/memoryConfig.js';
import { getCurrentActivity } from './scheduleManager.js';
import { getTimeTag, getLightNoteWithWeather } from './timeLight.js';
import { matchAll } from './characterSearch.js';
import { getWorldIntegrationRule } from '../builtinRules.js';

// ── 生活片段类型库 ──
// 每个类型描述的是"角色今天的生活进入了哪一种状态"，不是"发生了什么剧情"。
// LLM 结合角色人格+世界观+当前时间，在这个状态中截取属于该角色的具体的一分钟。
//
// 设计原则：
//   - desc 描述"此刻是什么状态，不需要发生什么特别的事"
//   - 不预设具体场景——具体物品/地点/人物/动作由 LLM 根据角色人格自由创作
//   - funFrom 指出这一小段生活的观看趣味来源（日常感而非剧情张力）
//   - reactions 给模型"这个角色可能怎么自然反应"的轻量参考
//   - 事件结束=镜头切走，角色的人生不会有任何变化

const EVENT_TYPES = [
  // ═══ 晨间片段（15-20min）═══
  {
    key: 'morning_start', name: '刚醒', durationMin: 20, urgency: 1,
    funFrom: ['日常感', '角色的习惯'],
    reactions: ['慢慢来', '赶时间'],
    desc: '角色刚醒、或者正在为今天做第一件事。不需要发生什么——只是看看她今天怎么开始的。',
  },
  {
    key: 'getting_ready', name: '出门前', durationMin: 15, urgency: 1,
    funFrom: ['习惯的可爱', '内心小剧场'],
    reactions: ['按部就班', '手忙脚乱'],
    desc: '角色在准备出门。穿什么、带什么、最后一刻想起什么。这些细小的决定本身就是值得一看的生活纹理。',
  },

  // ═══ 通勤路上（15-25min）═══
  {
    key: 'commuting', name: '通勤路上', durationMin: 25, urgency: 1,
    funFrom: ['观察视角', '日常感'],
    reactions: ['放空', '看手机', '看窗外'],
    desc: '角色在去某处的路上。交通工具上、步行中、或等红灯的间隙。这段路程本身就可以是一段安静的独处时间。',
  },
  {
    key: 'wrong_way', name: '走岔了', durationMin: 20, urgency: 1,
    funFrom: ['小烦恼', '角色的独特反应'],
    reactions: ['不急', '有点急', '将错就错'],
    desc: '坐过站了、拐错了路口、或者走神走到了不太认得的地方。不是什么大事——只是今天多绕了一小段路。',
  },
  {
    key: 'slight_rush', name: '赶时间', durationMin: 15, urgency: 1,
    funFrom: ['小烦恼', '内心小剧场'],
    reactions: ['加速', '放弃', '边走边想策略'],
    desc: '比预想的晚了一点。不是灾难——只是步速快了一点、心跳多了一拍、脑子里"应该来得及/估计来不及了"在交替闪烁。',
  },

  // ═══ 在学/在工作中（20-25min）═══
  {
    key: 'at_work', name: '正在做正事', durationMin: 25, urgency: 1,
    funFrom: ['日常感', '习惯的可爱'],
    reactions: ['专注', '摸鱼', '一边做一边想别的'],
    desc: '角色在工作或学习中。可能很认真、可能在走神、可能在和面前的东西较劲。不需要发生什么——只是看看她怎么度过这段时间。',
  },
  {
    key: 'on_break', name: '休息一下', durationMin: 20, urgency: 1,
    funFrom: ['安静的满足', '内心小剧场'],
    reactions: ['彻底放空', '做点别的', '思考人生'],
    desc: '一段属于自己的间隙。喝水、伸懒腰、看窗外、刷手机、或者只是发了几秒呆。这种小暂停是日常生活里最多也最真实的褶皱。',
  },
  {
    key: 'stuck_moment', name: '卡住了', durationMin: 20, urgency: 1,
    funFrom: ['小烦恼', '角色的独特反应'],
    reactions: ['死磕', '先放下', '问人'],
    desc: '某件事做不下去了。一道题、一段文字、一个决定、或单纯不想继续了。卡住本身就是生活常态——看角色怎么面对它才是趣味所在。',
  },
  {
    key: 'finished_early', name: '提前搞完了', durationMin: 25, urgency: 1,
    funFrom: ['小确幸', '随意的决定'],
    reactions: ['多出来的时间不知道该干什么', '立刻做想做的事'],
    desc: '提前完成了手头的事，突然有了一段本不在计划里的空档。这个空档怎么填——甚至要不要填——是一个微妙的日常瞬间。',
  },

  // ═══ 购物消费（20-30min）═══
  {
    key: 'buying_something', name: '在买东西', durationMin: 20, urgency: 1,
    funFrom: ['日常感', '角色的习惯'],
    reactions: ['直奔目标', '顺便逛逛', '纠结'],
    desc: '角色正在买东西。日常采购、买杯喝的、或者只是路过顺便拿了点什么。这个过程中角色的选择方式、比较方式、和店员的短暂交集，都是生活真实的一部分。',
  },
  {
    key: 'trying_new', name: '尝新', durationMin: 20, urgency: 1,
    funFrom: ['一点点的期待', '角色的独特反应'],
    reactions: ['好奇', '犹豫', '拉了朋友一起试'],
    desc: '看到没吃过/没用过的、听说了新品、或者店里今天刚好换了菜单。不是冒险——只是在日常的选项里多按了一下"第一次"。',
  },
  {
    key: 'good_deal', name: '碰上优惠', durationMin: 20, urgency: 1,
    funFrom: ['小确幸', '瞬间的犹豫'],
    reactions: ['立刻拿下', '觉得不需要但心动'],
    desc: '正好打折、刚好最后一件、或者别人多买了一份递过来。一件小事，但"刚好碰上"的运气感会让心跳轻快几下。',
  },
  {
    key: 'just_browsing', name: '逛逛不买', durationMin: 30, urgency: 1,
    funFrom: ['观察视角', '随意的决定'],
    reactions: ['认真看', '随便扫', '被某样东西吸引'],
    desc: '进来只是看看——打发时间、路过、或者就是现在不想回家。没有目标，脚步很慢，视线在货架之间漂。这种没有目的性的闲逛，是日常生活中最松弛的时刻之一。',
  },

  // ═══ 天气带来的小变化（25min）═══
  {
    key: 'weather_change', name: '变天了', durationMin: 25, urgency: 1,
    funFrom: ['身体感', '小烦恼或小确幸'],
    reactions: ['找地方躲', '就这么走', '停下来感受'],
    desc: '下雨了、起风了、突然热了、太阳从云后面出来了。天气在没有任何预告的情况下做了一个微调——而角色的身体比判断先感觉到了。',
  },
  {
    key: 'caught_in_rain', name: '没带伞', durationMin: 25, urgency: 1,
    funFrom: ['小烦恼', '身体感'],
    reactions: ['等', '跑', '找人借', '就这么淋'],
    desc: '雨下起来了，而伞在别处。不是灾难——只是接下来十几分钟的活动范围被限定在了某个屋檐下，或者多了一段湿着袖子走路回家的路程。',
  },

  // ═══ 社交碎片（15-20min）═══
  {
    key: 'ran_into_friend', name: '碰到熟人了', durationMin: 20, urgency: 1,
    funFrom: ['日常感', '瞬间的犹豫'],
    reactions: ['打招呼', '假装没看见', '停下来聊两句'],
    desc: '在没约好的地方看见了认识的人。可能是朋友、同学、同事、或只是"那个经常在这个点出没的人"。要不要说话、说多少、怎么结束——这些微小的社交判断，是日常里最频繁也最有角色辨识度的行为。',
  },
  {
    key: 'brief_interaction', name: '和陌生人交集', durationMin: 15, urgency: 1,
    funFrom: ['日常感', '角色的独特反应'],
    reactions: ['礼貌', '冷淡', '热情'],
    desc: '结账时的收银员、问路的路人、电梯里的同乘者、排队时站在前后的人。几秒钟的互动——但角色的方式（眼神、语气、身体距离）能看出很多东西。不需要发生什么特别的事。',
  },
  {
    key: 'got_a_message', name: '收到消息', durationMin: 15, urgency: 1,
    funFrom: ['一点点的期待', '角色的独特反应'],
    reactions: ['立刻看', '等一会儿再看', '看了不知道怎么回'],
    desc: '手机亮了。一条消息——可能是群聊、可能是私聊、可能是通知。不是大事——但看到消息后的几秒钟反应是角色最真实的瞬间。回不回、怎么回、先装作没看到——这些犹豫比消息本身更有趣。',
  },
  {
    key: 'overheard_talk', name: '听见旁边在聊', durationMin: 15, urgency: 1,
    funFrom: ['观察视角', '内心小剧场'],
    reactions: ['继续听', '走开', '忍不住笑了'],
    desc: '旁边的人在说话。不是秘密、不是关键信息——就是普通人的普通聊天。但角色的注意力被勾住了一小会儿：可能觉得好笑、可能有共鸣、可能引发了自己的念头。这是旁观且在意的一刻。',
  },

  // ═══ 一点小情绪（15-20min）═══
  {
    key: 'sudden_craving', name: '突然好想', durationMin: 20, urgency: 1,
    funFrom: ['内心小剧场', '随意的决定'],
    reactions: ['马上去', '忍一下', '在脑内预览'],
    desc: '不知道哪里来的念头——突然特别想喝什么、吃什么、做某件小事。不是需求，是冲动。行动或不行动的这几十秒是角色和自己欲望之间的最短交涉。',
  },
  {
    key: 'small_nostalgia', name: '忽然想起', durationMin: 20, urgency: 1,
    funFrom: ['安静的满足', '角色的独特反应'],
    reactions: ['沉浸在回忆里', '笑了一下', '发条消息'],
    desc: '一个画面、一段旋律、一阵气味、或者完全没有触发源——脑子里突然跳出来一段过去的事。不是大事，不改变任何东西，只是今天多了一层很久之前的颜色。',
  },
  {
    key: 'mild_frustration', name: '有点烦', durationMin: 15, urgency: 1,
    funFrom: ['小烦恼', '角色的习惯'],
    reactions: ['忍', '发泄一下', '转移注意力'],
    desc: '不是因为什么大事。就是不太顺——少了点什么、慢了半拍、刚好不巧。这种低度的"有点烦"比愤怒更真实——它大多时候不需要解决，只是需要一个人自己消化几分钟。',
  },
  {
    key: 'little_lift', name: '心里亮了一下', durationMin: 15, urgency: 1,
    funFrom: ['小确幸', '安静的满足'],
    reactions: ['偷偷笑', '想告诉谁', '默默记下'],
    desc: '很小的事。听到了喜欢的那首歌的前奏、正好赶上了绿灯、今天的咖啡比昨天好喝、路过的人冲自己笑了一下。不需要理由的短暂愉快。',
  },
  {
    key: 'random_thought', name: '脑子里突然', durationMin: 15, urgency: 1,
    funFrom: ['内心小剧场', '角色的独特反应'],
    reactions: ['顺着想下去', '马上打断', '记下来'],
    desc: '一个念头不知道从哪冒了出来。和前后的上下文都没关系——一个比喻、一个记忆、一个问题、一个假设。思绪像风一样路过，角色可以选择追上去或让它飘走。',
  },

  // ═══ 兴趣爱好（20-30min）═══
  {
    key: 'doing_hobby', name: '沉浸在自己的世界', durationMin: 30, urgency: 1,
    funFrom: ['安静的满足', '角色的习惯'],
    reactions: ['全神贯注', '随性地做'],
    desc: '角色在做一件不是必须做、但就是想做的事。画画、看书、做手工、打游戏——身边的时间变慢，世界的边界模糊了。这是她最放松也最像自己的状态。',
  },
  {
    key: 'found_interesting', name: '看到有意思的', durationMin: 20, urgency: 1,
    funFrom: ['一点点的期待', '观察视角'],
    reactions: ['停下来仔细看', '拍照/收藏', '想告诉人'],
    desc: '在网上或者路过的时候，看到了一个引起好奇心或审美共鸣的东西。不一定要拥有、不一定要深挖——就是单纯觉得"有意思"。',
  },
  {
    key: 'planning_something', name: '在盘算', durationMin: 20, urgency: 1,
    funFrom: ['一点点的期待', '内心小剧场'],
    reactions: ['认真计划', '大致想想', '算了下次再说'],
    desc: '角色在想一件想做但还没做的事。查路线、算时间、列清单、或者只是脑补了一下过程。计划本身的快乐有时候不亚于执行——尤其是在计划阶段，一切都还是最好的版本。',
  },

  // ═══ 临时决定（15-20min）═══
  {
    key: 'changed_mind', name: '改主意了', durationMin: 15, urgency: 1,
    funFrom: ['随意的决定', '角色的独特反应'],
    reactions: ['果断改', '纠结后改', '想改但没改'],
    desc: '已经决定的事——临到跟前改了。想吃的店关门了所以换了一家、本来打算回家想了想又折去了别的地方。这种微小的方向修正，体现的是角色真实的选择倾向。',
  },
  {
    key: 'taking_a_minute', name: '先坐一会儿', durationMin: 15, urgency: 1,
    funFrom: ['安静的满足', '身体感'],
    reactions: ['真的只是坐一会儿', '坐着坐着不想动了'],
    desc: '角色决定暂时不赶路了。看到了长椅、台阶、或者刚好经过的咖啡馆——有地方能坐，而身体已经比计划先一步停了下来。不是偷懒——是和自己达成的一个即时休战协议。',
  },
  {
    key: 'going_long_way', name: '多走一段', durationMin: 20, urgency: 1,
    funFrom: ['随意的决定', '观察视角'],
    reactions: ['想多看看', '心情好', '不想太早到'],
    desc: '明明有更近的路，但选了远的那条。可能是因为天气太好了、可能在听一首没听完的歌、可能只是暂时没什么理由——就是想多在户外漂一会儿。这是只有自己知道的、没有任何后果的小任性。',
  },

  // ═══ 一点小幸运/小倒霉（10-20min）═══
  {
    key: 'just_in_time', name: '刚好赶上', durationMin: 15, urgency: 2,
    funFrom: ['小确幸', '角色的习惯'],
    reactions: ['心里得意', '太正常了', '觉得今天运气好'],
    desc: '差一步就赶不上——但赶上了。车刚要走的时候到了站、最后一个被叫到号、在关门前三秒进了电梯。这种轻飘飘的幸运是日常最好的赠品，不值得庆祝但值得心里得意一下。',
  },
  {
    key: 'small_inconvenience', name: '不太顺', durationMin: 15, urgency: 1,
    funFrom: ['小烦恼', '角色的习惯'],
    reactions: ['皱眉', '换一条路', '算了不在意'],
    desc: '刚好差了一步、前面那个人把最后一杯买了、想走的路被施工围住了。这个级别的"不太顺"不值得生气——就是正常生活的摩擦力——但角色面对它时的第一反应，比事件本身更有信息量。',
  },
  {
    key: 'cant_find_thing', name: '东西去哪了', durationMin: 20, urgency: 1,
    funFrom: ['小烦恼', '角色的习惯'],
    reactions: ['翻找', '回忆', '放弃先不用'],
    desc: '某样东西不在应该在的位置。钥匙、耳机、笔、或者昨天随手放的东西。没有严重后果——只是多了几分钟在房间里转圈和在脑子里倒放的片段。',
  },
  {
    key: 'forgot_thing', name: '忘了', durationMin: 15, urgency: 1,
    funFrom: ['小烦恼', '内心小剧场'],
    reactions: ['折回去', '算了', '找人带'],
    desc: '出了门才想起来自己忘了什么。或是在某件事做到一半的时候停住——总觉得忘了做点什么但想不起来。那几秒钟的回忆回溯是日常生活里最小的侦探游戏。',
  },
  {
    key: 'awkward_small', name: '尬了一小下', durationMin: 10, urgency: 1,
    funFrom: ['微小的尴尬', '角色的习惯'],
    reactions: ['假装没事', '自嘲', '赶紧离开'],
    desc: '说错了一个字、跟陌生人同时走了同一侧、伸手想拿的东西被别人先拿了。这是一种十秒之内就结束的小尴尬——不值得写进日记的第 1 行，但值得写进第 73 行。',
  },

  // ═══ 身体感（10-15min）═══
  {
    key: 'body_moment', name: '感觉到了自己', durationMin: 15, urgency: 1,
    funFrom: ['身体感', '日常感'],
    reactions: ['忽视', '停下来感受', '调整'],
    desc: '饿了、渴了、冷了、肩膀酸了——哪种都行。不是故事，是身体在一天里的常规汇报。角色的处理方式（忍一下/立刻找吃的/在心里骂一句）就是性格小样。',
  },
  {
    key: 'mirror_moment', name: '看到了自己', durationMin: 10, urgency: 1,
    funFrom: ['日常感', '内心小剧场'],
    reactions: ['看看就走', '认真打量', '整理一下'],
    desc: '路过镜子、橱窗玻璃、手机黑屏的反光——看到了自己。不是审视，就是一瞬间的对视。整理一下刘海、侧过脸看一眼、或者愣了一下——每个人和自己短暂相处的那几秒都不一样。',
  },

  // ═══ 注意到什么（15min）═══
  {
    key: 'noticed_detail', name: '注意到了', durationMin: 15, urgency: 1,
    funFrom: ['观察视角', '日常感'],
    reactions: ['多看两眼', '心里记下', '走过就算了'],
    desc: '抬头看见了平时不会多看一眼的东西。光透过树叶的样子、墙上新贴的纸条、旁边那个人戴了一只很特别的耳环。注意到本身就是事件——因为注意到意味着那一瞬间角色和世界之间多了一层关系。',
  },
  {
    key: 'animal_moment', name: '小动物', durationMin: 15, urgency: 1,
    funFrom: ['小确幸', '观察视角'],
    reactions: ['停下来看', '想摸', '拍照', '假装没兴趣'],
    desc: '路上看见了猫、跟着走了几步的狗、停在窗台上的鸟。人和动物之间那几秒钟的关系是非社会性的、不设防的——角色的真实反应往往比在人群中更直接。',
  },
  {
    key: 'season_signal', name: '季节的提示', durationMin: 15, urgency: 1,
    funFrom: ['身体感', '安静的满足'],
    reactions: ['停下来感受', '想起什么', '没什么感觉'],
    desc: '一阵风里有不同的温度、阳光的角度变了、空气里有某种只在特定季节出现的气味。角色感觉到了——然后呢？也许只是拉了拉衣领，也许被带回了去年的某一天。',
  },
  {
    key: 'odd_little', name: '有点奇怪', durationMin: 15, urgency: 1,
    funFrom: ['观察视角', '内心小剧场'],
    reactions: ['多看两眼', '心想算了', '和朋友说'],
    desc: '看到了一个有点奇怪但也没那么奇怪的东西。超市里放在错误货架的商品、写着看不懂文字的招牌、路人的穿搭。它不会发展成任何事——只是今天多看了一秒。',
  },

  // ═══════════════════════════════════════════════════════════════
  // 以下为剧情向事件——日常中的不寻常瞬间（与原日常片段共存）
  // ═══════════════════════════════════════════════════════════════

  // ═══ 日常节奏被打乱（15-40min）═══
  {
    key: 'routine_broken', name: '日常脱轨', durationMin: 20, urgency: 1,
    funFrom: ['意外遭遇', '反差', '被迫社交'],
    reactions: ['将计就计', '暗自好奇', '烦躁但勉强应付', '逐渐发现有意思'],
    desc: '原本按部就班的一天，在某个不起眼的环节上断了线——计划泡汤、路线被堵、或一直可靠的东西突然不可用了。事情本身不大，但它把人推出了反复踩踏了无数遍的轨迹。被迫偏离轨道的那一刻，注意力转向了平时不会留意的方向——而那个方向往往有平时不会遇见的人和事。烦躁还在，但好奇已经悄悄从缝隙里探了头——因为接下来发生什么，都不在预计之中。',
  },
  {
    key: 'running_late', name: '时间紧迫', durationMin: 15, urgency: 2,
    funFrom: ['反差', '紧急', '优先级反转'],
    reactions: ['先跑再说', '纠结要不要停下来', '将计就计'],
    desc: '因为某个原因快要迟到了——心跳加速、脑子里全是赶不上的灾难推演。但就在那种本不该分心的赶路时刻，发生了一件事，让"迟到"突然变成了今天最不重要的问题。焦虑还没来得及消退，就被一种更强烈的感受截了胡——让人停下来的不是障碍，是另一个更重的理由。',
  },
  {
    key: 'lost_something', name: '找不到了', durationMin: 25, urgency: 1,
    funFrom: ['意外发现', '怀旧', '被戳中'],
    reactions: ['假装没看见', '愣住', '一时百感交集', '先收起来再说'],
    desc: '确切需要用的东西找不到了。翻找从合理的地方蔓延到久未触碰的角落——抽屉深处、旧包里、堆在视线盲区的那些杂物。先被翻出来的往往不是要找的那件，而是一个本以为早就处理掉或已经忘记的什么东西——和某个时间、某个人、某段翻篇的往事黏在一起的那种。盯着它发愣的那几秒里，手机响了，发消息来的人，恰好和它有关。',
  },
  {
    key: 'something_broke', name: '关键时刻掉链子', durationMin: 20, urgency: 1,
    funFrom: ['黑色幽默', '反差', '被迫求助'],
    reactions: ['抓狂', '认命修理', '硬着头皮找人', '借此逃避另一件事'],
    desc: '一个依赖的东西专挑最不该坏的时候罢工了。那种"就差这一点"的荒谬感比事情本身更让人上头——坏的不是东西本身，是所有依赖它成立的那一堆安排。修理或找替代的过程不管往哪个方向走，都会把人引向平时绝不会主动敲的门。而门一开，事情就和修东西没什么关系了。',
  },

  // ═══ 人际交集（20-50min）═══
  {
    key: 'stranger_approach', name: '被搭话了', durationMin: 20, urgency: 1,
    funFrom: ['微悬疑', '暧昧误会', '被看见'],
    reactions: ['警惕打量', '好奇追问', '假装镇定', '直接反问回去'],
    desc: '一个陌生人开口了——而且说出来的内容让人没法用一句"你认错人了"轻易结束。因为话里有一处细节，只对了一半，但那一半准得让人后背一凉。对方显然知道一些不该知道的事——但也显然不完全知道。现在的问题是：ta还以为自己知道的那部分是全部，而错误的那一小半，正在打开一个让人忍不住想多问一句的缺口。',
  },
  {
    key: 'witness_moment', name: '目击时刻', durationMin: 30, urgency: 2,
    funFrom: ['秘密', '道德瞬间', '被看见'],
    reactions: ['悄无声息退出', '站出去', '装没看见', '事后找当事人'],
    desc: '恰好撞见了一幕——不一定多么惊心动魄，但显然是对方不希望被任何人看见的那种。可能是一个眼神、一个动作、一句没想到旁边有人的话。被看到的那方还不知道自己被看见了，而目击者的脑海里正在同时跑两件事：这件事的分量——和自己接下来该往哪个方向迈脚。那几步之间，选择就已经做完了。',
  },
  {
    key: 'put_on_spot', name: '被推到台前', durationMin: 20, urgency: 2,
    funFrom: ['社死', '反差', '被迫表现'],
    reactions: ['硬上', '转移焦点', '自嘲开场', '把球踢回去'],
    desc: '突然之间所有目光聚了过来——被点名、被推举、或被动地站在了一个"没法装没看到"的位置。没有准备时间、没有脚本、没有任何一个提前想好的应对方案。所有人的等待正在空气中凝成一个可见的重量，而身体的反应比脑子快——已经站了起来、张开了嘴、或碰了什么碰不得的东西。接下来不管做什么，都是"被看见"的，而且会被记住。',
  },

  // ═══ 机会与诱惑（20-60min）═══
  {
    key: 'unexpected_offer', name: '好事轮得到我？', durationMin: 30, urgency: 1,
    funFrom: ['捡漏', '小诱惑', '不对劲'],
    reactions: ['先确认有没有坑', '窃喜但矜持', '直接接住', '犹豫到错过'],
    desc: '有人把一个不在预期里的事推了过来——别人临时让出的位置、店家莫名的升级、或一条消息把本来只是围观的角色直接抬进了名单。它确实诱人，也确实有不问白不问的合理性。但那份"太刚好"的巧合会在脑子里轻轻敲一下：好得不真实不是因为它是假的，而是因为——自己从来没被算在"有份"的那群人里。而留给人做决定的时间很短。',
  },
  {
    key: 'found_item', name: '捡到东西了', durationMin: 25, urgency: 1,
    funFrom: ['秘密', '好奇', '巧合'],
    reactions: ['查来历', '先收着', '找失主', '假装没看到又折回来'],
    desc: '在公共场所或一个半私密的角落里，一样不属于这里的东西赫然在目。不是路人随手丢的垃圾——它有来历感：质地、内容、留下的痕迹都在暗示它和某个特定的人或某个特定时间有关联。把它放回去或带走看起来都合理，但它身上那种"本不该出现在这里"的气场，让人已经在心里替它编开头了。',
  },
  {
    key: 'tempting_path', name: '偷懒的诱惑', durationMin: 20, urgency: 1,
    funFrom: ['小越界', '没人会知道', '自我合理化'],
    reactions: ['做了但不安', '忍住没做但总想', '做了然后找理由', '做到一半停了'],
    desc: '面前有一条更省事的捷径——更快、更简单、绕开了所有规定步骤，唯一需要跨过的只有自己心里的那根线。没有人检查，没有人知道，走完和正路的结果看起来完全一样。理智在做最后的声音——但另一个声音更轻快，已经在替结果准备好了所有说得通的解释。这个决定影响不了除了自己以外的任何人，所以它特别考验人——不是因为代价大，而是因为代价为零。',
  },

  // ═══ 小危机（15-40min）═══
  {
    key: 'mistake_looming', name: '纸包不住火了', durationMin: 20, urgency: 2,
    funFrom: ['紧张', '赌一把', '诚实考验'],
    reactions: ['补救', '坦白', '赌没人发现', '先回避再想'],
    desc: '之前的一个疏漏、那个"过几天再说吧"的隐患、或一句当时觉得没关系但现在看漏洞巨大的处理——马上就要暴露了。还有一点时间，但只够做最后一件事。补救、坦白、还是赌一把风头自己过去：每个选项都有人在心里为它辩护，而倒计时不需要律师。关键是：接下来不管发生什么，都会让之前那个"糊弄过去"的决定彻底失效。',
  },
  {
    key: 'caught_awkward', name: '最怕被ta看见', durationMin: 15, urgency: 2,
    funFrom: ['社死', '反差', '被看见'],
    reactions: ['装没发生', '硬着头皮解释', '抢先反制', '直接摆烂'],
    desc: '正在做一件本来打算"绝对不能让熟人撞见"的事——不是多严重的事，但解释起来需要一长串前情提要，而且解释完对方未必会收住脸上的表情。偏偏这时候，有人推门进来了。最要命的不是被看见本身，而是对方停顿的那短短一秒——说明已经看到了最关键的部分。现在的处境是：两个人都不知道该怎么接，谁先开口谁输一半，但沉默只会让这个瞬间在记忆里烙得更深。',
  },
  {
    key: 'emergency_minor', name: '紧急小事', durationMin: 25, urgency: 2,
    funFrom: ['紧急', '本能反应', '事后回想'],
    reactions: ['冲上去', '愣住', '先稳住', '大声求助'],
    desc: '真正的小型紧急——不是灾难级别，但足够让周围的人在几秒之内决定自己是"上前的人"还是"留在原地的人"。这种情境里没有道德讨论的时间，只有身体先动还是没动的分别。不管当时做了什么选择，事情过去之后，那个瞬间会在心里被反复重放很久——不是因为结果多大，而是因为那一刻暴露了自己都未必知道的某个倾向。',
  },

  // ═══ 新鲜事与发现（30-90min）═══
  {
    key: 'overheard_info', name: '听到了不该听的', durationMin: 30, urgency: 2,
    funFrom: ['秘密', '被戳中', '重新审视'],
    reactions: ['继续偷听', '假装没听到', '直接上前问', '一个人消化'],
    desc: '无意中知道了某个信息——关于别人的，或更棘手的——关于自己的。获得方式不正常，说出的人不知道自己被听到了。现在这份信息安静地躺在脑子里，没有人知道角色已经有了它——而开始重新审视某些事、某些人的那个进程，已经自行启动了。最微妙的是：知道了就回不去"不知道"的状态了，但说出来的代价也同样可观。',
  },
  {
    key: 'new_curiosity', name: '被种草了', durationMin: 30, urgency: 1,
    funFrom: ['好奇心', '新世界', '偶然发现'],
    reactions: ['当场入坑', '反复路过偷看', '回家偷偷查资料', '拉上认识的人一起'],
    desc: '接触到了一件完全在认知范围以外的事物——一项技能、一个圈子、一种生活方式、或一个从来不知道存在的东西。最初只是路过看了一眼，但那个画面或那句话像一粒种子落进了合适的土壤，开始没来由地在脑子里冒芽。好奇心安静但顽固，而且比预期大得多——那种"我该不会真的想试试吧"的心虚感，本身已经是一种确定的信号。',
  },

  // ═══ 两难与冒险（20-40min）═══
  {
    key: 'two_fires', name: '两头着火', durationMin: 25, urgency: 2,
    funFrom: ['两难', '优先级抉择', '后果连锁'],
    reactions: ['先处理最急的', '找第三方分担', '两头凑合', '押一边赌另一边撑住'],
    desc: '两个都重要、但互相矛盾的事情同时逼到了眼前——选一边，另一边一定会出问题，而且用不了多久就会有具体的人或结果来提醒"你选了另一边"。两边的倒计时在同一条音轨上越来越紧，而在这种压力面前，人会看到自己心里真实的排序——不是嘴上说的那个，是手先伸向的那个。',
  },
  {
    key: 'leap_of_faith', name: '赌一把', durationMin: 20, urgency: 1,
    funFrom: ['冒险', '直觉', '赌徒心态'],
    reactions: ['闭眼上', '再收集一点线索', '拉人一起分担风险', '放弃又折回来'],
    desc: '面前是一个需要冒险的决定——信息量远不够做理性判断，时间也给不出更多。但直觉在用比大脑快得多的速度往一个方向用力——而且这个直觉过去的战绩好坏参半，让人没法全信，也没法完全不信。赌不赌这个决定本身，已经是今天最难过又最刺激的一道坎：不是因为后果有多大，而是因为在信息不足的情况下，自己必须替未来的自己做一个无法撤回的承诺。',
  },
  {
    key: 'someone_needs_help', name: '有人需要帮忙', durationMin: 25, urgency: 2,
    funFrom: ['边界感', '社交风险', '是非感'],
    reactions: ['硬着头皮帮', '装作没看到', '等别人先动', '问清楚再决定'],
    desc: '一个不太熟的人明显陷入了需要帮忙的处境。但帮这个忙——有成本、有风险、或者会把角色卷进一件本来可以礼貌地不被卷入的事。周围的"别人"恰好都正忙着看别的地方、恰好没空、恰好表情暗示"这不在我职责范围内"。这个瞬间真正考验的不是善良——是在社会目光下选择动还是不动的那种沉默压力，以及"为什么偏偏是我"的本能自问。',
  },

  // ═══ 一个人的道德瞬间（10-40min）═══
  {
    key: 'broke_something_secret', name: '不小心弄坏了', durationMin: 20, urgency: 2,
    funFrom: ['内疚', '责任', '独自承担'],
    reactions: ['走', '留字条', '试着修', '主动承认'],
    desc: '碰倒了、磕碎了、洒了——一件不属于自己的东西，在只有自己在场的时候坏了。四周没人，追究的可能性完全取决于自己接下来怎么选。那声碎裂或泼洒的声音还留在耳朵里，而面前摆着几条截然不同的路——每条都有人性里完全不同的一部分在为它站台。这件事不会有观众，不会有证人，但选完之后自己会在心里反复重放。',
  },
  {
    key: 'forbidden_to_look', name: '忍不住想看的', durationMin: 20, urgency: 1,
    funFrom: ['诱惑', '秘密', '好奇心'],
    reactions: ['忍不住看了', '克制住了', '只瞄了一眼', '看了但后悔'],
    desc: '某个不该看的东西恰好触手可及——没关的屏幕、敞开的抽屉、一份明写着不公开但此刻无人看守的内容。看了不会有任何人发现。但知道之后就不能假装不知道了——而且看到的东西未必是想要的答案，可能只是更多问号。手在伸与不伸之间犹豫，而犹豫本身已经说明了倾向：不是怕被发现，是怕看到之后自己会变成不一样的人。',
  },

  // ═══ 日常里的异物（20-90min）═══
  {
    key: 'flea_market_find', name: '淘到了怪东西', durationMin: 40, urgency: 1,
    funFrom: ['捡漏', '神秘感', '好奇心'],
    reactions: ['买下', '犹豫后离开', '翻来覆去打量', '跟摊主套话'],
    desc: '地摊、旧货店、某个不起眼的角落——一样东西攫住了目光。说不上哪里特别，但质地、触感、或它身上那种"已经等了一段时间"的气息让人走不开。摊主报的价低得不像在做生意，倒像在找一个人来把它领走。买下它只需要一个念头——搞清楚它是什么可能需要很久。而那种"不清楚但想弄清楚"的心情，正在覆盖所有保留意见。',
  },
  {
    key: 'mystery_vial', name: '捡到来路不明的东西', durationMin: 30, urgency: 1,
    funFrom: ['微悬疑', '好奇心', '冒险'],
    reactions: ['打开看看', '先留着不碰', '找人问问', '放回原处走掉'],
    desc: '路边、台阶下、某个不该有东西的位置——摆着一个小物件。材质不常见，透过外观隐约能感知到内容物的某些无法归类的特性。没有标签、没有说明、只有一些不认识或褪色的印记。拿起来的第一反应是好奇心赢了——第二反应是"打开了能还原吗"，而第三反应已经开始少了，因为心里有了一个假设，不管它是对是错，都想验证一下。',
  },
  {
    key: 'phantom_shop', name: '不存在的店铺', durationMin: 60, urgency: 1,
    funFrom: ['微悬疑', '荒谬日常', '好奇心'],
    reactions: ['推门进去', '在外面观察', '问附近的人', '拍照记录'],
    desc: '一条走过无数遍的街上——今天多了一个不该在这里的存在。不是新开的、不是换了招牌——是那种"应该在这里待了很久但自己确定之前绝不是它"的错位感。它和整条街的气质不在同一套坐标系里，但又没有刻意彰显自己的不同。门口挂着"营业中"，而推门进去的冲动和径直走过的惯性，正在为最后那几步路争执不下。',
  },
  {
    key: 'vending_mystery', name: '吐出了不该有的东西', durationMin: 20, urgency: 1,
    funFrom: ['荒谬日常', '好奇心', '捡漏'],
    reactions: ['当场试试', '收起来再说', '拍给朋友看', '退回去'],
    desc: '投币、按键、哐当——掉出来的和选的那个没有任何关系。不是货道滑错了——是这种东西根本就不应该出现在这个出货口里。包装上没有品牌、没有条形码，只有一些不像印刷体的痕迹或没见过的标识。机器不会解释，手里的东西不会自报家门。而此刻恰好无事——有一个"本来只打算做件小事"的空档可以拿来想这件不太小的事。',
  },

  // ═══ 喜讯降临（20-60min）═══
  {
    key: 'unexpected_approval', name: '居然过了', durationMin: 25, urgency: 1,
    funFrom: ['被认可', '惊喜', '自我怀疑'],
    reactions: ['反复确认', '不敢相信', '立刻告诉想告诉的人', '冷静但内心狂喜'],
    desc: '一个没抱希望的结果——通过了。当初提交的时候甚至反复犹豫过要不要点发送，现在它确确实实摆在了面前。不是"努力终于有了回报"的激昂叙事，而是一种有点不真实的踏实感——"原来这种事也可以发生在我身上"。那个在心里盘踞了很久的"我不够"的声音，被一行不声不响的结果否决了。高兴是确定的，不确定的是高兴该怎么处理。',
  },
  {
    key: 'public_recognition', name: '被看见了', durationMin: 30, urgency: 1,
    funFrom: ['被看见', '被理解', '小确幸'],
    reactions: ['不好意思', '暗自开心', '装淡定', '截图留念'],
    desc: '某个默默做了很久的事——不一定是作品，可能是某种坚持、某种习惯、某个一直在输出的地方——被人注意到了，而且不是在私下敷衍，是真正看懂了其中的用心后说了出来。被理解的感觉和被称赞的感觉搅在一起，已经分不清哪个更让人鼻子一酸。这是一个很小但足以让今天的天花板比昨天高一小截的瞬间。',
  },
  {
    key: 'surprise_invitation', name: '意想不到的邀请', durationMin: 25, urgency: 1,
    funFrom: ['被偏爱', '惊喜', '被记住'],
    reactions: ['惊讶并心动', '假装矜持', '当场答应', '偷偷反复看消息'],
    desc: '一个来自意料之外的人的邀请——或者一个来自意料之外的场合的准入许可。对方还记得、对方觉得可以、对方把角色放进了心里的某个名单。去不去是后面的事——被放进去的这个动作本身已经让这一天升了半级。心跳快的那个瞬间，是因为突然确认了自己在别人那里不是透明的、不是可替代的、不是想不起来的。',
  },
  {
    key: 'second_chance_news', name: '失而复得', durationMin: 30, urgency: 1,
    funFrom: ['意外', '惊喜', '命运感'],
    reactions: ['不敢相信', '马上行动', '犹豫要不要接', '怕再次错过'],
    desc: '一个确定已经关上的门——有过期日期的、被通知结束的、自己放弃或被告知没戏的——又开了一条缝。不是努力争取来的，就是某个条件自己变了一下、某个人突然想起了名字、或命运在别处受了挫折决定在这里补一口气。窗口重新打开的这个瞬间，比第一次得到机会还让人心跳——因为失去过的人，知道它在手里到底有多重。',
  },
  {
    key: 'lucky_timing', name: '刚好遇上', durationMin: 20, urgency: 1,
    funFrom: ['幸运', '得意', '巧合'],
    reactions: ['得意地笑', '觉得今天不一样', '告诉别人', '趁热打铁继续做'],
    desc: '一个稍纵即逝的好事——恰好被自己撞上了。不是计划、不是消息灵通——就是刚刚好的时间站在了刚刚好的地方。那种"今天难道是我的幸运日"的得意感混着一点迷信式的小心——做别的事会不会把运气用薄了。但这种顺手捡到的轻飘飘的运气，是日常里最好的赠品：没付出成本、没预期等待、就是正好轮到了。',
  },
  {
    key: 'mystery_blessing', name: '天上掉馅饼', durationMin: 25, urgency: 1,
    funFrom: ['被善待', '意外', '温暖'],
    reactions: ['感动', '疑惑找来源', '想找到是谁', '记在心里'],
    desc: '一份来路不明的好意——匿名、间接、或通过一个"我也不太确定为什么给我"的渠道——落到了角色头上。没有附加条件、没有解释、不是搞错了——就是有人在某个时间点想到了这个角色，然后做了一件不需要任何人知道的事。那种"被随便善待了一下"的感觉，和知道具体的谁没关系——光是知道有这件事，就足够让今天和昨天不一样了。',
  },

  // ═══ 其他（20-50min）═══
  {
    key: 'pressed_it', name: '手比脑子快', durationMin: 30, urgency: 2,
    funFrom: ['好奇心', '冒险', '荒谬'],
    reactions: ['愣住看变化', '赶紧补救', '马上跑', '兴奋等着看结果'],
    desc: '一个显然不是给人碰或不该碰的东西——按钮、把手、开关、某个被好奇相中了的机关——已经在手指碰完之后才开始接收大脑发送的警告信号。有动静正在发生，不是灾难——至少目前还不是——但肯定不再是"什么都没发生"。是站在原地看着它演变，还是在能动的时候做点什么：这两种冲动正在比赛谁先跑到终点，而中间这段等待是今天密度最高的几秒钟。',
  },
  {
    key: 'weather_trap', name: '老天爷留客', durationMin: 40, urgency: 2,
    funFrom: ['被迫停留', '意外遭遇', '反差'],
    reactions: ['干等', '找人搭话', '借机做点什么', '烦躁中顺势休息'],
    desc: '天气在没有任何预告的情况下翻了脸。回去的路不是不能走——是不值得冒那个险。接下来一段时间不管愿不愿意，都得待在附近。而一个被迫停下来的瞬间，通常藏着一个被日常忽略的赠品：它取消了"可以随时离开"的权利，所以往往也会顺带创造出一些本来不会发生的对话、和本来不会多看一眼的人。一转头才发现——有人也被同样的突发天气送到了同样的不该久留的位置。',
  },
  {
    key: 'dare_accepted', name: '谁怕谁', durationMin: 20, urgency: 1,
    funFrom: ['挑战', '好胜心', '证明自己'],
    reactions: ['直接上', '先放狠话', '暗自准备', '拉人当裁判'],
    desc: '面前是一个挑战——可能被说出口了，也可能只是一道没说出口的眼神。最聪明的做法是肩膀一耸转身走开——但心跳已经在加速了，过去的好坏战绩也已经在脑子里依次列队报到。理性在发言，但那个更年轻的、更快的、不需要理由的声音，已经笑着脱了外套、卷了袖子、或拿起了一开始没打算碰的东西。',
  },
];

/**
 * 根据角色条件筛选可用的事件类型
 * 目前全部可用，后续可以根据好感度/标签过滤
 */
function getAvailableEventTypes(character, db) {
  return EVENT_TYPES;
}

// 生活片段类别 → VAD 情绪偏移（被 chat.js 情绪引擎消费，纯规则零 LLM 开销）
// 正值=提升(V愉悦/A兴奋/D支配感)，负值=降低，范围 [-0.15, +0.15]
// 原则：日常小事不会让情绪剧烈波动，所有偏移量控制在轻度范围
const EVENT_VAD_MODIFIERS = {
  // ═══ 晨间片段 ═══ — 偏安静，轻微启动
  morning_start:        { valence: 0.05, arousal:-0.05, dominance: 0.05 },
  getting_ready:        { valence: 0.00, arousal: 0.10, dominance: 0.05 },
  breakfast_moment:     { valence: 0.10, arousal:-0.05, dominance: 0.00 },

  // ═══ 通勤路上 ═══ — 中性偏安静
  commuting:            { valence: 0.00, arousal:-0.05, dominance: 0.00 },
  wrong_way:            { valence:-0.05, arousal: 0.05, dominance:-0.05 },
  slight_rush:          { valence:-0.10, arousal: 0.15, dominance:-0.10 },

  // ═══ 在学/在工作中 ═══ — 中性到轻微波动
  at_work:              { valence: 0.00, arousal: 0.00, dominance: 0.05 },
  on_break:             { valence: 0.05, arousal:-0.10, dominance: 0.00 },
  stuck_moment:         { valence:-0.10, arousal: 0.05, dominance:-0.10 },
  finished_early:       { valence: 0.15, arousal: 0.10, dominance: 0.10 },

  // ═══ 购物消费 ═══
  buying_something:     { valence: 0.05, arousal: 0.00, dominance: 0.05 },
  trying_new:           { valence: 0.10, arousal: 0.10, dominance: 0.05 },
  good_deal:            { valence: 0.15, arousal: 0.10, dominance: 0.10 },
  just_browsing:        { valence: 0.05, arousal:-0.05, dominance: 0.05 },

  // ═══ 天气变化 ═══
  weather_change:       { valence: 0.00, arousal: 0.05, dominance:-0.05 },
  caught_in_rain:       { valence:-0.10, arousal: 0.10, dominance:-0.10 },

  // ═══ 社交碎片 ═══
  ran_into_friend:      { valence: 0.05, arousal: 0.10, dominance: 0.05 },
  brief_interaction:    { valence: 0.00, arousal: 0.00, dominance: 0.00 },
  got_a_message:        { valence: 0.10, arousal: 0.10, dominance: 0.05 },
  overheard_talk:       { valence: 0.00, arousal: 0.05, dominance: 0.00 },

  // ═══ 一点小情绪 ═══
  sudden_craving:       { valence: 0.10, arousal: 0.10, dominance: 0.10 },
  small_nostalgia:      { valence: 0.05, arousal:-0.05, dominance: 0.00 },
  mild_frustration:     { valence:-0.10, arousal: 0.05, dominance:-0.05 },
  little_lift:          { valence: 0.15, arousal: 0.10, dominance: 0.10 },
  random_thought:       { valence: 0.00, arousal: 0.00, dominance: 0.00 },

  // ═══ 兴趣爱好 ═══
  doing_hobby:          { valence: 0.15, arousal: 0.00, dominance: 0.15 },
  found_interesting:    { valence: 0.10, arousal: 0.10, dominance: 0.10 },
  planning_something:   { valence: 0.10, arousal: 0.05, dominance: 0.10 },

  // ═══ 临时决定 ═══
  changed_mind:         { valence: 0.00, arousal: 0.05, dominance: 0.10 },
  taking_a_minute:      { valence: 0.05, arousal:-0.10, dominance: 0.05 },
  going_long_way:       { valence: 0.10, arousal: 0.00, dominance: 0.10 },

  // ═══ 小幸运/小倒霉 ═══
  just_in_time:         { valence: 0.15, arousal: 0.15, dominance: 0.10 },
  small_inconvenience:  { valence:-0.05, arousal: 0.05, dominance:-0.05 },
  cant_find_thing:      { valence:-0.10, arousal: 0.10, dominance:-0.10 },
  forgot_thing:         { valence:-0.10, arousal: 0.10, dominance:-0.10 },
  awkward_small:        { valence:-0.05, arousal: 0.10, dominance:-0.05 },

  // ═══ 身体感 ═══
  body_moment:          { valence:-0.05, arousal: 0.00, dominance: 0.00 },
  mirror_moment:        { valence: 0.00, arousal: 0.00, dominance: 0.05 },

  // ═══ 注意到什么 ═══
  noticed_detail:       { valence: 0.05, arousal: 0.05, dominance: 0.00 },
  animal_moment:        { valence: 0.15, arousal: 0.05, dominance: 0.05 },
  season_signal:        { valence: 0.05, arousal: 0.00, dominance: 0.00 },
  odd_little:           { valence: 0.00, arousal: 0.05, dominance: 0.00 },

  // ════════════════════════════════════════════════════════
  // 剧情向事件 VAD（与原日常片段偏移量共存）
  // ════════════════════════════════════════════════════════

  // ═══ 日常节奏被打乱 ═══ — V:[-0.15,0], A:[+0.1,+0.35], D:[-0.15,0]
  routine_broken:        { valence:-0.10, arousal: 0.20, dominance:-0.10 },
  running_late:          { valence:-0.15, arousal: 0.35, dominance:-0.15 },
  lost_something:        { valence:-0.10, arousal: 0.15, dominance:-0.10 },
  something_broke:       { valence:-0.15, arousal: 0.25, dominance:-0.15 },

  // ═══ 人际交集 ═══ — 混合：好奇/压力/失控
  stranger_approach:     { valence:-0.10, arousal: 0.25, dominance:-0.15 },
  witness_moment:        { valence:-0.15, arousal: 0.35, dominance:-0.15 },
  put_on_spot:           { valence:-0.25, arousal: 0.35, dominance:-0.30 },

  // ═══ 机会与诱惑 ═══ — 正面为主，带不确定性
  unexpected_offer:      { valence: 0.15, arousal: 0.25, dominance: 0.10 },
  found_item:            { valence: 0.10, arousal: 0.25, dominance: 0.05 },
  tempting_path:         { valence: 0.10, arousal: 0.20, dominance: 0.15 },

  // ═══ 小危机 ═══ — 高压、负价
  mistake_looming:       { valence:-0.30, arousal: 0.35, dominance:-0.25 },
  caught_awkward:        { valence:-0.30, arousal: 0.35, dominance:-0.30 },
  emergency_minor:       { valence:-0.25, arousal: 0.45, dominance:-0.15 },

  // ═══ 新鲜事与发现 ═══
  overheard_info:        { valence:-0.15, arousal: 0.25, dominance:-0.10 },
  new_curiosity:         { valence: 0.25, arousal: 0.20, dominance: 0.10 },

  // ═══ 两难与冒险 ═══
  two_fires:             { valence:-0.30, arousal: 0.35, dominance:-0.25 },
  leap_of_faith:         { valence: 0.10, arousal: 0.30, dominance: 0.15 },
  someone_needs_help:    { valence:-0.10, arousal: 0.25, dominance: 0.05 },

  // ═══ 一个人的道德瞬间 ═══ — 内疚/诱惑/责任，静水深流
  broke_something_secret:{ valence:-0.25, arousal: 0.30, dominance:-0.15 },
  forbidden_to_look:     { valence: 0.10, arousal: 0.25, dominance: 0.10 },

  // ═══ 日常里的异物 ═══ — 好奇+兴奋，"世界比想的大"
  flea_market_find:      { valence: 0.25, arousal: 0.25, dominance: 0.15 },
  mystery_vial:          { valence: 0.15, arousal: 0.30, dominance: 0.10 },
  phantom_shop:          { valence: 0.25, arousal: 0.30, dominance: 0.15 },
  vending_mystery:       { valence: 0.15, arousal: 0.25, dominance: 0.05 },

  // ═══ 喜讯降临 ═══ — 纯粹愉悦：V全正、A中高、D全正
  unexpected_approval:   { valence: 0.30, arousal: 0.30, dominance: 0.20 },
  public_recognition:    { valence: 0.25, arousal: 0.20, dominance: 0.25 },
  surprise_invitation:   { valence: 0.25, arousal: 0.30, dominance: 0.15 },
  second_chance_news:    { valence: 0.25, arousal: 0.25, dominance: 0.15 },
  lucky_timing:          { valence: 0.25, arousal: 0.35, dominance: 0.15 },
  mystery_blessing:      { valence: 0.20, arousal: 0.20, dominance: 0.10 },

  // ═══ 其他 ═══
  pressed_it:            { valence:-0.05, arousal: 0.40, dominance:-0.10 },
  weather_trap:          { valence:-0.05, arousal: 0.15, dominance:-0.15 },
  dare_accepted:         { valence: 0.10, arousal: 0.35, dominance: 0.15 },
};
/**
 * 根据事件类型 key 获取对应的 VAD 情绪偏移量
 * @param {string} eventTypeKey
 * @returns {{ valence: number, arousal: number, dominance: number } | null}
 */
export function getEventVadModifier(eventTypeKey) {
  return EVENT_VAD_MODIFIERS[eventTypeKey] || null;
}

export function getUrgencyLevel(eventTypeKey) {
  const found = EVENT_TYPES.find(e => e.key === eventTypeKey);
  return found ? found.urgency : 1;
}

/**
 * 生成特殊事件
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
  } else if (options.customPrompt) {
    // 用户自定义事件动机：跳过随机选类型，使用自定义提示
    eventType = {
      key: 'custom',
      name: '自定义事件',
      durationMin: 60,
      urgency: 1,
      desc: options.customPrompt,
    };
    console.log(`[eventGen] Custom event for ${character.display_name}: "${options.customPrompt.slice(0, 60)}..."`);
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

  // 多人关系：sigmoid 模型，照搬朋友圈算法但降低频率
  // P(多人) = P_min + (P_max - P_min) / (1 + e^(-k * (R - R_mid)))
  const relCount = relationships.length;
  const MULTI_P_MIN = 0.50;  // 最低多人概率
  const MULTI_P_MAX = 0.80;  // 社交达人趋于 50%
  const MULTI_K = 1.0;       // 陡峭度
  const MULTI_R_MID = 5;     // 拐点：R=5 时概率 = 30%

  let multiPerson = null;
  if (relCount > 0) {
    const multiProb = MULTI_P_MIN + (MULTI_P_MAX - MULTI_P_MIN) / (1 + Math.exp(-MULTI_K * (relCount - MULTI_R_MID)));
    console.log(`[eventGen] ${character.display_name} relCount=${relCount}, multiProb=${(multiProb * 100).toFixed(0)}%`);

    if (Math.random() < multiProb) {
      const allRels = db.prepare(`
        SELECT cr.relationship_text,
               c.id AS other_id, c.display_name AS other_name, c.base_prompt AS other_prompt, c.short_prompt AS other_short
        FROM character_relationships cr
        JOIN characters c ON c.id = cr.to_character_id
        WHERE cr.from_character_id = ? AND cr.relationship_text != ''
      `).all(character.id);

      const picked = allRels[Math.floor(Math.random() * allRels.length)];
      const otherShort = picked.other_short || '';
      const base = picked.other_prompt || '';
      const appMatch = base.match(/##\s*你的外观/);
      const appSection = appMatch ? base.slice(appMatch.index).replace(/你/g, picked.other_name) : '';
      const otherPersona = [otherShort, appSection].filter(Boolean).join('\n');

      // 查反向关系，双向注入
      const reverseRel = db.prepare(`
        SELECT relationship_text FROM character_relationships
        WHERE from_character_id = ? AND to_character_id = ? AND relationship_text != ''
      `).get(picked.other_id, character.id);

      let relDesc = `${character.display_name}是${picked.other_name}的${picked.relationship_text}`;
      if (reverseRel) {
        relDesc += `，${picked.other_name}是${character.display_name}的${reverseRel.relationship_text}`;
      }

      multiPerson = {
        otherId: picked.other_id,
        otherName: picked.other_name,
        otherPersona,
        relDesc,
      };
      console.log(`[eventGen] Multi-person event: ${character.display_name} + ${picked.other_name} (${relDesc})`);
    }
  }

  // 4. 生成初始场景
  const worldSetting = getWorldSetting();
  const jailbreakPrompt = worldSetting
    ? getSystemRulesWithWorld({ roleplay: false })
    : getSystemRules({ roleplay: false });
  const imageRules = getGlobalRule('image_prompt');
  const imageRulesText = imageRules?.rule_content || '';

  const timeTag = getTimeTag(now, false);

  let contextBlock = '';
  if (recentMoment) {
    contextBlock += `\n关联线索——${character.display_name}一小时前刚发了朋友圈："${recentMoment.content}"。事件素材可以与此呼应，提高关联性。\n`;
  }

  // 将角色人格中的"你"替换为角色名（保留引号内对话不变，简单正则处理）
  const displayName = character.display_name;
  let personaText = character.base_prompt.replace(/你/g, displayName);

  // 誓约角色：银白细戒指外观细节
  const ringUserName1 = config.user?.nickname || 'user';
  personaText = appendOathRing(personaText, character.id, ringUserName1, { isFirstPerson: false, charName: displayName });

  // [0] 第三人称叙事声明 + jailbreak + 世界观（有世界观时注入整合指令，无世界观时跳过）
  const worldIntegrationBlock = worldSetting
    ? getWorldIntegrationRule('event')
    : '';

  // 日程注入：获取角色当前活动，让事件起点与当前活动自然衔接
  let scheduleContextLine = '';
  let scheduleSystemBlock = '';
  try {
    if (config.features.schedule !== false) {
      const currentActivity = getCurrentActivity(character.id);
      if (currentActivity && currentActivity.activity !== '自由时间') {
        scheduleContextLine = `此时${displayName}正在${currentActivity.location}${currentActivity.activity}。`;
        const descPart = currentActivity.description ? `——${currentActivity.description}` : '';
        scheduleSystemBlock = `\n【当前日程】${displayName}正在【${currentActivity.location}】${currentActivity.activity}${descPart}。`;
      }
    }
  } catch { /* schedule not available */ }

  const worldPenetrationLine = worldSetting
    ? (eventType.key === 'custom'
        ? '- **世界观穿透**：这个事件发生在上述世界观中，不是发生在真空或现实世界中。所有感官细节（街头景象、路人行为、空气气味、社交礼仪）和角色反应（身体本能、社交判断、情感触发点）必须忠实地在世界观规则下展开。用户指定的事件方向是本次事件的核心，必须直接发生；世界观重塑的是它的呈现方式，而不是替换它。\n'
        : '- **世界观穿透**：这个事件发生在上述世界观中，不是发生在真空或现实世界中。所有感官细节（街头景象、路人行为、空气气味、社交礼仪）和角色反应（身体本能、社交判断、情感触发点）必须忠实地在世界观规则下展开。事件方向只是一个叙事钩子——它的具体呈现方式必须被世界观重新塑造。\n')
    : '';

  // [1] 角色人格（"你"已替换为角色名，去角色扮演化）
  let personaMsg = `以下是角色「${displayName}」的人格设定，供你了解角色的外貌、性格和行为模式：

${personaText}`;

  if (multiPerson) {
    personaMsg += `\n\n---\n以下是${multiPerson.otherName}的人格设定（${multiPerson.relDesc}），供事件涉及多人互动时参考：

${multiPerson.otherPersona}`;
  }

  // [2] JSON 格式
  const multiPersonImageNote = multiPerson
    ? `**多人画面**：prompt 中必须包含${displayName}和${multiPerson.otherName}两个人。描述清楚各自的外观、位置、互动动作。用句号分隔两人描述。`
    : '';

  // image_prompt 规则内容直接作为 prompt 字段的格式指令
  const imagePromptInstruction = imageRulesText
    || '≥8个外观锚点，角色名用character(series)格式';

  const weatherNote = getLightNoteWithWeather(now);
  const weatherHint = weatherNote ? `\n\nEnvironment reference：${weatherNote}。` : '';

  const formatPrompt = `请严格按照以下 JSON 格式输出，不要任何解释或额外文字：

{
  "title": "事件标题事件标题（≤8字，口语感叹。从你刚写完的事件场景里抓最戳人的那个瞬间，用角色第一反应的口吻喊出来——不要给事件'取名'，是替角色喊出ta看到/发现/意识到时脑子里蹦出来的那句话。正确：包裹在动……|谁寄来的？！|钥匙怎么还在她这里。错误：神秘包裹降临|意外来客——这些是在概括事件类型。禁止万能感叹'天哪''不是吧''怎么会'——必须带上这个事件的具体信息点）",
  "description": "场景叙述（80-150字。
不要像讲故事，而像镜头正在发生：
- 从一个正在进行的动作切入，而不是背景介绍。
- 多写细节（声音、触感、视线、停顿、呼吸、小动作），少解释心理。
- 心理不要直接写『她很内疚』『她很紧张』，而要通过动作表现。
- 每一句都推动画面继续发生，不回顾过去，不概括原因。
- 结尾停在『必须做出选择之前』，留下悬念，不提前进入结果。
- 行动需要符合当前天气和时间，但禁止直接提及天气时间",
  "prompt": "${imagePromptInstruction}${weatherHint}${multiPersonImageNote}",
  "choiceA": "选项A（具体行动，8-15字。符合${displayName}的性格和当下处境）",
  "choiceB": "选项B（与A形成真正的行动对比——不符合${displayName}的个性，会将事件往意料之外但符合世界观的情况发展。8-15字）"
}

选项设计原则：
- A和B必须是性质完全不同的两条路径——读者感受到它们通往不同的情绪走向
- **但两条路径都必须能从${displayName}的性格和当下处境中自然推出**
- 避免两个"本质上差不多"的选项
- 根据场景选择最合适的对比维度：做vs不做、直面vs绕开、自己解决vs求助、立刻vs等等、坦白vs保留、介入vs旁观`;

  // [3] 创作任务
  const multiPersonNote = multiPerson
    ? `\n**多人事件**：${multiPerson.relDesc}。事件中应包含${multiPerson.otherName}作为互动对象，描述ta们之间的互动方式、肢体距离和氛围要贴合两人的真实关系。`
    : '';

  const funFromNote = eventType.funFrom?.length
    ? `\n\n这件事之所以值得成为一个事件，不是因为它"出了大事"——而是因为它天然带有${eventType.funFrom.join('、')}的张力。叙事时往这些层面用力，让读者感受到"就是这个感觉"。`
    : '';
  const reactionsNote = eventType.reactions?.length
    ? `\n\n${displayName}面对这类处境时可能出现的反应倾向：${eventType.reactions.join('、')}。仅供参考——请根据角色人格和当下场景，选择最自然、最贴合的一个方向来展开叙事和选项设计。`
    : '';

  const customDirectionHeader = eventType.key === 'custom'
    ? `【用户指定事件方向·最高优先级】**${eventType.desc}**`
    : `事件方向：**${eventType.name}**——${eventType.desc}`;

  const customKeyUnderstanding = eventType.key === 'custom'
    ? `**关键理解**：**「${eventType.desc}」是本次事件的核心，不是可选的出发点**——开场必须让${displayName}直接身处这件事之中，让它在正文里具体地发生（场景、动作、对话都围绕它展开）。世界观、日程、人设决定这件事在${displayName}身上如何发生，但不能把用户点名的事替换成别的活动。`
    : `**关键理解**：上面的事件方向只是一个出发点——不是剧本，里面没有具体场景。把方向翻译成${displayName}今天此刻实际遇到的、不可复制到别人身上的生活切片。`;

  const directorPrompt = `${customDirectionHeader}${funFromNote}${reactionsNote}
${timeTag}${multiPersonNote}
${scheduleContextLine ? scheduleContextLine : ''}${scheduleSystemBlock || ''}${contextBlock ? '\n关联线索：' + contextBlock.trim() : ''}

${customKeyUnderstanding}

请以紧密第三人称创作这个事件的开场。场景长度 80-150 字。`;


  const msgs = [];

  // [0] Base jailbreak rules — most stable, always cache-hit
  msgs.push({ role: 'system', content: jailbreakPrompt });

    // [2] World integration block — stable per world setting
  if (worldIntegrationBlock) {
    msgs.push({ role: 'system', content: worldIntegrationBlock });
  }

  // [1] JSON format — most stable, always cache-hit (template unchanged, only trailing env ref varies)
  msgs.push({ role: 'system', content: formatPrompt });

  // [3] Director instructions — stable per character
  msgs.push({ role: 'system', content: `你正在为「${displayName}」截取今天生活中的一小段。

【人称】
- 指代角色只用「她」「他」「ta」「${displayName}」，不使用「你」
- 叙述始终贴着角色此刻的感知。读者看到什么、听到什么、注意到什么，都应与角色保持一致，不跳出角色视角解释世界。

【角色定制锁——事件触发器根植于角色独有信息】
- 事件的触发点应与${displayName}的独有信息直接相关——习惯、身份、能力、关系网、正在隐瞒的事、雷点、近期状态的改变、或世界观中独有的属性——至少命中一项

【正文——写现场，不写剧情总结】
正文始终停留在现场，而不是剧情总结。

镜头直接落在一个正在发生的动作上。

背景、关系、原因，都随着动作自然露出来，而不是提前说明。

【结尾——停在行动门槛】
结尾停在一个具体动作即将发生之前。

【schedule 起点锁】
- 事件从${displayName}当前所在的地点、手头在做的事、视线范围内的东西中触发。第一句出现的地点、动作、物件，直接从当前 schedule 场景中承接
- 避免为制造戏剧性，直接把角色挪到另一个无关地点再触发事件

${worldPenetrationLine}
【天气约束】description中行动需要符合当前天气和时间，但禁止直接提及天气时间` });

  // [4] Character persona — stable per character
  msgs.push({ role: 'system', content: personaMsg });

  // [4.5] 自定义事件：用户方向锁定——独立成段，防止方向被淹没在长上下文中
  if (eventType.key === 'custom') {
    msgs.push({ role: 'system', content: `【用户指定事件方向·最高优先级】
本次奇遇由用户手动指定方向：**${eventType.desc}**。

- 开场必须直接落在方向这件事本身上：${displayName}此刻正在做、或正要开始这件事，正文让这件事具体发生（场景、动作、对话全部围绕它展开）。
- 方向里的每个要素都要真实呈现：不能只擦边、暗示、用比喻带过，更不能把用户点名的事替换成别的活动。
- 世界观和日程决定"这件事在${displayName}身上如何发生"，但不能淡化或替换"发生的这件事本身"。
- 若方向与世界观有冲突：保留方向的核心行为，只把它的表现方式融入世界观。` });
  }

  // [user] Event-specific creation task — changes per event（有世界观时开头注入遵循规则）
  const customPreamble = eventType.key === 'custom'
    ? '\n用户手动指定的事件方向必须直接发生——世界观负责塑造它的表现方式，不负责替换它。'
    : '';
  const eventUserContent = worldSetting
    ? `请遵循当前世界观来生成奇遇，角色人设如果和世界观有冲突，则以世界观最高优先级，将人设融入世界观。${customPreamble}

${directorPrompt}`
    : directorPrompt;
  msgs.push({ role: 'user', content: eventUserContent });

  let eventData;
  let rawResult = '';
  try {
    rawResult = await chatSync(msgs, { temperature: 0.82, max_tokens: 4096, response_format: { type: 'json_object' }, label: '奇遇生成' });
    const jsonStr = extractFirstJson(rawResult);
    if (!jsonStr) throw new Error('No JSON found in LLM response');
    eventData = JSON.parse(repairJson(jsonStr));
    if (!eventData.title || !eventData.description || !eventData.choiceA || !eventData.choiceB) {
      throw new Error('Incomplete event data from LLM');
    }
    // field 兼容：imagePrompt / prompt 两种写法都接受
    const imagePromptText = eventData.prompt || eventData.imagePrompt;
    eventData.prompt = imagePromptText;
  } catch (err) {
    console.error(`[eventGen] LLM generation failed for ${character.display_name}:`, err.message);
    console.log(`[eventGen] Raw LLM response:\n${rawResult}`);
    throw err;
  }

  // 5. 生图（多人时合并两人 LoRA）
  const selfLoras = _parseCharLoras(character.loras);
  let otherChars = [];
  if (multiPerson) {
    const otherChar = db.prepare('SELECT loras, artist_override FROM characters WHERE id = ?').get(multiPerson.otherId);
    if (otherChar) otherChars = [otherChar];
  }
  const otherLoras = otherChars.flatMap(c => _parseCharLoras(c.loras));
  const allLoras = [...selfLoras, ...otherLoras];

  const originalEventPrompt = eventData.prompt;
  let imageUrl = null;
  try {
    const charArtist = charArtistOverrideWithFallback(character, otherChars);
    const genResult = await generateImageRaw(eventData.prompt, {
      artist: charArtist !== null ? charArtist : config.comfyui.eventArtist,
      width: config.comfyui.eventWidth,
      height: config.comfyui.eventHeight,
      scene: 'events',
      priority: options.manual ? 'high' : 'low',
      loras: allLoras,
      ...(!multiPerson && character.custom_workflow ? { customWorkflow: character.custom_workflow } : {}),
    });
    if (genResult.success && genResult.images.length > 0) {
      eventData.prompt = genResult.promptRefined || eventData.prompt;
      const img = genResult.images[0];
      const filename = `event_${Date.now()}_${img.filename || 'comfy.png'}`;
      imageUrl = saveBase64Image('events', filename, img.base64);
      recordCompletedImageTask({
        conversationId: `char_${character.id}_events`,
        promptOriginal: originalEventPrompt,
        promptRefined: eventData.prompt,
        outputPaths: [imageUrl],
        style: charArtist !== null ? charArtist : config.comfyui.eventArtist,
        resolution: `${config.comfyui.eventWidth}x${config.comfyui.eventHeight}`,
        workflowTemplate: genResult.wfMode,
        db,
      });
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
    // 存储多人模式信息，供后续分支生成时复用
    multiPerson: multiPerson ? { otherId: multiPerson.otherId, otherName: multiPerson.otherName, otherPersona: multiPerson.otherPersona, relDesc: multiPerson.relDesc } : null,
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
    config.comfyui.eventArtist,
    `${config.comfyui.eventWidth}x${config.comfyui.eventHeight}`,
    eventData.choiceA,
    eventData.choiceB,
    eventData.choiceCLabel || '自由行动',
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
  const branchTimeExtensionMinutes = 5;

  // 0. 原子性标记处理中（CAS：仅 processing=0 时置 1），防止并发重复提交
  // 如果已有其他请求在处理中，直接抛出错误，避免：
  //   - 两次 LLM 调用浪费 token / 并发生图压垮 ComfyUI
  //   - 浏览器 HTTP/1.1 6 连接限制下，双 choose 请求挤占剩余连接导致其他 API 排队 23s+
  const casResult = db.prepare(
    `UPDATE character_events SET processing = 1 WHERE id = ? AND processing = 0`
  ).run(event.id);
  if (casResult.changes === 0) {
    throw new Error('EVENT_ALREADY_PROCESSING');
  }

  // 1. 检查是否过期
  const expiresAt = new Date(event.expires_at + 'Z');
  if (now >= expiresAt) {
    db.prepare(`UPDATE character_events SET processing = 0 WHERE id = ?`).run(event.id);
    await concludeEvent(character, event, event.engaged ? 'completed' : 'expired');
    return null;
  }

  // 用户已成功提交一个有效分支选择，立即延长倒计时，避免分支生成期间事件到期。
  db.prepare(`
    UPDATE character_events
    SET expires_at = datetime(expires_at, '+' || ? || ' minutes')
    WHERE id = ?
  `).run(branchTimeExtensionMinutes, event.id);
  event.expires_at = db.prepare(
    `SELECT expires_at FROM character_events WHERE id = ?`
  ).get(event.id).expires_at;

  // 2. 加载关系网
  const relationships = db.prepare(`
    SELECT cr.relationship_text, c.display_name
    FROM character_relationships cr
    JOIN characters c ON c.id = cr.to_character_id
    WHERE cr.from_character_id = ? AND cr.relationship_text != ''
  `).all(character.id);

  // 2.5 检查是否为多人模式（从 choice_history[0] 读取初始事件时存储的 multiPerson 数据）
  const choiceHistory = JSON.parse(event.choice_history || '[]');
  const storedMultiPerson = choiceHistory.length > 0 ? choiceHistory[0].multiPerson : null;
  let multiPerson2 = null;
  if (storedMultiPerson) {
    multiPerson2 = {
      otherId: storedMultiPerson.otherId,
      otherName: storedMultiPerson.otherName,
      otherPersona: storedMultiPerson.otherPersona,
      relDesc: storedMultiPerson.relDesc,
    };
  }

  // 3. 构建 choice_history 文本
  let historyText = '';
  if (choiceHistory.length === 0) {
    historyText = `初始场景：${event.description}`;
  } else {
    historyText = choiceHistory.map((h, i) =>
      `第${i + 1}幕：推进「${h.choice_label}」→ ${h.summary}`
    ).join('\n');
  }
  // choice.customText 仅在非 C 选项时作为补充说明；C 选项的 label 已等于 customText
  const choiceExtra = choice.choice !== 'C' && choice.customText ? '——' + choice.customText : '';

  // 4. LLM 生成下一步（try-catch 确保失败时清除 processing 标记）
  try {
  const worldSetting2 = getWorldSetting();
  const jailbreakPrompt = worldSetting2
    ? getSystemRulesWithWorld({ roleplay: false })
    : getSystemRules({ roleplay: false });
  const imageRules = getGlobalRule('image_prompt');
  const imageRulesText = imageRules?.rule_content || '';

  const weatherNote = getLightNoteWithWeather(now);
  const weatherHint = weatherNote ? `\n\nEnvironment reference：${weatherNote}。` : '';
  const timeTag2 = getTimeTag(now, false);

  const displayName2 = character.display_name;
  let personaText2 = character.base_prompt.replace(/你/g, displayName2);

  // 誓约角色：银白细戒指外观细节
  const ringUserName2 = config.user?.nickname || 'user';
  personaText2 = appendOathRing(personaText2, character.id, ringUserName2, { isFirstPerson: false, charName: displayName2 });

  const worldIntegrationBlock2 = worldSetting2
    ? getWorldIntegrationRule('event')
    : '';

  const worldPenetrationLine2 = worldSetting2
    ? '- **世界观穿透**：这个事件发生在上述世界观中，不是发生在真空或现实世界中。所有感官细节（街头景象、路人行为、空气气味、社交礼仪）和角色反应（身体本能、社交判断、情感触发点）必须忠实地在世界观规则下展开。事件方向只是一个叙事钩子——它的具体呈现方式必须被世界观重新塑造。\n'
    : '';

  let personaMsg2 = `以下是角色「${displayName2}」的人格设定，供你了解角色的外貌、性格和行为模式：

${personaText2}`;

  if (multiPerson2) {
    personaMsg2 += `\n\n---\n以下是${multiPerson2.otherName}的人格设定（${multiPerson2.relDesc}），供事件涉及多人互动时参考：

${multiPerson2.otherPersona}`;
  }

  // 交叉角色引用：从事件上下文中加载被提及的角色信息
  const crossRefIds = JSON.parse(event.referenced_character_ids || '[]');
  let crossRefNames = [];
  if (crossRefIds.length > 0) {
    const crossChars = crossRefIds.map(id =>
      db.prepare('SELECT id, display_name, short_prompt, base_prompt FROM characters WHERE id = ?').get(id)
    ).filter(Boolean);
    if (crossChars.length > 0) {
      crossRefNames = crossChars.map(c => c.display_name);
      const crossBlocks = crossChars.map(c => {
        const parts = [];
        if (c.short_prompt) parts.push(c.short_prompt);
        const base = c.base_prompt || '';
        const m = base.match(/##\s*你的外观/);
        if (m) parts.push(base.slice(m.index).replace(/你/g, c.display_name));
        // 查询角色间关系
        const relParts = [];
        const fwd = db.prepare(
          'SELECT relationship_text FROM character_relationships WHERE from_character_id = ? AND to_character_id = ? AND relationship_text != ?'
        ).get(character.id, c.id, '');
        if (fwd) relParts.push(`${displayName2}是${c.display_name}的${fwd.relationship_text}`);
        const rev = db.prepare(
          'SELECT relationship_text FROM character_relationships WHERE from_character_id = ? AND to_character_id = ? AND relationship_text != ?'
        ).get(c.id, character.id, '');
        if (rev) relParts.push(`${c.display_name}是${displayName2}的${rev.relationship_text}`);
        if (relParts.length > 0) {
          parts.push(`[关系] ${relParts.join('，')}`);
        }
        return `[${c.display_name}]\n${parts.join('\n')}`;
      }).join('\n\n');
      personaMsg2 += `\n\n---\n以下是在当前事件推进中被提及的其他角色信息，必须在生成的分支场景中现身互动：\n\n${crossBlocks}`;
    }
  }

  const branchImagePromptInstruction = imageRulesText
    || '描述场景、角色外观、动作、氛围';

  const allOtherNames = [...new Set([
    ...(multiPerson2 ? [multiPerson2.otherName] : []),
    ...crossRefNames,
  ])];
  const multiPersonImageNote2 = allOtherNames.length > 0
    ? `**多人画面**：prompt 中必须包含${displayName2}和${allOtherNames.join('、')}共${allOtherNames.length + 1}人。描述清楚各自的外观、位置、互动动作。用句号分隔每人描述。`
    : '';

  const formatPrompt2 = `请严格按照以下 JSON 格式输出，不要任何解释或额外文字：

{
  "description": "选择后的场景叙述场景叙述，承接上一个选择的结果，展现角色此刻的即时感受和新出现的局面。场景转折要出乎意料但又在情理之中（80-150字）。

采用紧密第三人称（她/他/ta），始终贴着角色当下的感知与动作，不解释、不总结、不评价。

不要像讲故事，而像镜头正在发生：
- 从一个正在进行的动作切入，而不是背景介绍。
- 多写细节（声音、触感、视线、停顿、呼吸、小动作），少解释心理。
- 心理不要直接写『她很内疚』『她很紧张』，而要通过动作表现。
- 每一句都推动画面继续发生，不回顾过去，不概括原因。
- 结尾停在『必须做出选择之前』，留下悬念，不提前进入结果。
- 行动需要符合当前天气和时间，但禁止直接提及天气时间。",
  "prompt": "${branchImagePromptInstruction}${weatherHint}${multiPersonImageNote2}",
  "choiceA": "新选项A（具体行动。必须符合${displayName2}的个性——是ta此刻真的会做出来的事。8-15字）",
  "choiceB": "新选项B（与A形成真正的行动对比——不符合${displayName2}的个性，会将事件往意料之外但符合世界观的情况发展。8-15字）"
}`;

  // 只有多人模式才注入关系信息（和初始事件生成一致）
  const multiNote2 = multiPerson2
    ? `\n**多人事件**：${multiPerson2.relDesc}。事件中应包含${multiPerson2.otherName}作为主要互动对象，描述ta们之间的互动方式、肢体距离和氛围要贴合两人的真实关系。${relationships.map(r => `${displayName2}是${r.display_name}的${r.relationship_text}`).join('；')}`
    : '';

  const eventTypeMeta = EVENT_TYPES.find(e => e.key === event.event_type_key);
  const funFromNote2 = eventTypeMeta?.funFrom?.length
    ? `\n\n这段生活的质感来自${eventTypeMeta.funFrom.join('、')}——后续中保持这个质感，不用刻意用力。`
    : '';
  const reactionsNote2 = eventTypeMeta?.reactions?.length
    ? `\n\n${displayName2}在这种状态下可能出现的自然反应：${eventTypeMeta.reactions.join('、')}——仅供参考，根据角色个性选择最贴合的方向。`
    : '';

  const directorPrompt2 = `事件标题：${event.title}
${timeTag2}${historyText}${multiNote2}${funFromNote2}${reactionsNote2}

**核心要求——让分支有趣**：接下来的场景不能是"选了A所以A发生了"的平铺直叙。读者选择之后应该经历一个"没想到会这样——但仔细一想确实合理"的转折。这个转折可以来自：
- 选择引发的连锁反应中，出现了角色没预料到的因素
- 某个之前被忽略的细节突然变得关键
- 另一个角色的反应方式出乎意料（但符合那个人的人设）
- 环境或时机带来了额外的变量

**重要提醒**：场景必须忠实于「${displayName2}」的人格——ta的反应方式、内心活动、决策逻辑，都应该让读者觉得"换了别人就不会这样"。

**剧情推进（必须发生）**：${choice.label}${choiceExtra}

请以紧密第三人称创作选择之后发生的下一个场景。场景长度 80-150 字。`;

  // 上一幕画面注入：视觉参考帮助 LLM 保持画面连贯（叙事已有 historyText，此处仅补充视觉信息）
  const prevSceneBlock = event.prompt
    ? `\n\n【上一幕画面 · 环境参考】\n${event.prompt}`
    : '';

  const msgs = [];

  // [0] Base jailbreak rules — most stable, always cache-hit
  msgs.push({ role: 'system', content: jailbreakPrompt });

  // [1] World integration block — stable per world setting
  if (worldIntegrationBlock2) {
    msgs.push({ role: 'system', content: worldIntegrationBlock2 });
  }

  // [2] JSON format — most stable, always cache-hit (template unchanged, only trailing env ref varies)
  msgs.push({ role: 'system', content: formatPrompt2 });

  // [3] Branch continuation instructions — stable per character
  msgs.push({ role: 'system', content: `你正在为「${displayName2}」的特殊事件生成下一幕——一段紧密第三人称叙事。上一幕中角色做出了选择，现在展现选择之后发生的事情，选择已经完成，描述的是选择的结果。

${worldPenetrationLine2}
【天气约束】description中行动需要符合当前天气和时间，但禁止直接提及天气时间` });

  // [4] Character persona — stable per character
  msgs.push({ role: 'system', content: personaMsg2 });

  // [user] Branch task（有世界观时开头注入遵循规则）
  const branchUserContent = worldSetting2
    ? `请遵循当前世界观来推进奇遇，角色人设如果和世界观有冲突，则以世界观最高优先级，将人设融入世界观。

${directorPrompt2}${prevSceneBlock}`
    : directorPrompt2 + prevSceneBlock;
  msgs.push({ role: 'user', content: branchUserContent });

  let branchData;
  let rawBranchResult = '';
  // 分支结果必须是完整可解析的 JSON；失败最多重试 3 次
  const MAX_BRANCH_ATTEMPTS = 3;
  let lastBranchError = null;
  for (let attempt = 1; attempt <= MAX_BRANCH_ATTEMPTS; attempt++) {
    rawBranchResult = '';
    try {
      rawBranchResult = await chatSync(msgs, { temperature: 0.82, max_tokens: 4096, response_format: { type: 'json_object' }, label: '事件分支' });
      const jsonStr = extractFirstJson(rawBranchResult);
      if (!jsonStr) throw new Error('No JSON found in LLM response');
      branchData = JSON.parse(repairJson(jsonStr));
      const branchPromptText = branchData.prompt || branchData.imagePrompt;
      if (!branchData.description || !branchData.choiceA || !branchData.choiceB) throw new Error('Incomplete branch data');
      branchData.prompt = branchPromptText || event.prompt;
      break;
    } catch (err) {
      lastBranchError = err;
      console.warn(`[eventGen] Branch generation attempt ${attempt}/${MAX_BRANCH_ATTEMPTS} failed:`, err.message);
      console.log(`[eventGen] Raw branch LLM response (attempt ${attempt}):\n${rawBranchResult}`);
    }
  }

  if (!branchData) {
    // 3 次都无法产出有效分支：清除生成中状态，回到用户选择分支之前的状态
    console.error('[eventGen] Branch generation failed after 3 attempts, reverting to pre-choice state:', lastBranchError?.message);
    db.prepare(`UPDATE character_events SET processing = 0 WHERE id = ?`).run(event.id);
    const resetEvent = db.prepare(`SELECT * FROM character_events WHERE id = ?`).get(event.id);
    return resetEvent;
  }

  // 4.5 检测当前事件描述和分支描述中是否提及其他角色
  const branchDescText = (event.description || '') + ' ' + (branchData.description || '');
  const crossRefMatches = matchAll(branchDescText, character.id);
  const filteredMatches = multiPerson2
    ? crossRefMatches.filter(m => m.id !== multiPerson2.otherId)
    : crossRefMatches;
  if (filteredMatches.length > 0) {
    const existing = JSON.parse(event.referenced_character_ids || '[]');
    const merged = [...new Set([...existing, ...filteredMatches.map(c => c.id)])].slice(0, 3);
    db.prepare('UPDATE character_events SET referenced_character_ids = ? WHERE id = ?')
      .run(JSON.stringify(merged), event.id);
    event.referenced_character_ids = JSON.stringify(merged);
  }

  // 5. 生图（合并主角色 + 多人 + 交叉引用角色的 LoRA）
  const branchSelfLoras = _parseCharLoras(character.loras);
  const branchOtherChars = [];
  let branchOtherLoras = [];
  if (multiPerson2) {
    const otherChar = db.prepare('SELECT loras, artist_override FROM characters WHERE id = ?').get(multiPerson2.otherId);
    if (otherChar) { branchOtherChars.push(otherChar); branchOtherLoras = _parseCharLoras(otherChar.loras); }
  }
  let branchCrossRefLoras = [];
  const crossRefIdsForLora = JSON.parse(event.referenced_character_ids || '[]');
  if (crossRefIdsForLora.length > 0) {
    branchCrossRefLoras = crossRefIdsForLora.flatMap(id => {
      const c = db.prepare('SELECT loras, artist_override FROM characters WHERE id = ?').get(id);
      if (c) branchOtherChars.push(c);
      return c ? _parseCharLoras(c.loras) : [];
    });
  }
  const allLoras = [...branchSelfLoras, ...branchOtherLoras, ...branchCrossRefLoras];
  const seen = new Set();
  const branchAllLoras = allLoras.filter(l => {
    if (seen.has(l.path)) return false;
    seen.add(l.path);
    return true;
  });

  const originalBranchPrompt = branchData.prompt;
  let imageUrl = null;
  try {
    const charArtist = charArtistOverrideWithFallback(character, branchOtherChars);
    const genResult = await generateImageRaw(branchData.prompt, {
      artist: charArtist !== null ? charArtist : config.comfyui.eventArtist,
      width: config.comfyui.eventWidth,
      height: config.comfyui.eventHeight, scene: 'events',
      priority: 'high',
      loras: branchAllLoras,
      ...(!multiPerson2 && character.custom_workflow ? { customWorkflow: character.custom_workflow } : {}),
    });
    if (genResult.success && genResult.images.length > 0) {
      branchData.prompt = genResult.promptRefined || branchData.prompt;
      const img = genResult.images[0];
      const filename = `event_${Date.now()}_${img.filename || 'comfy.png'}`;
      imageUrl = saveBase64Image('events', filename, img.base64);
      recordCompletedImageTask({
        conversationId: `char_${character.id}_event_${event.id}_branch_${event.current_branch + 1}`,
        promptOriginal: originalBranchPrompt,
        promptRefined: branchData.prompt,
        outputPaths: [imageUrl],
        style: charArtist !== null ? charArtist : config.comfyui.eventArtist,
        resolution: `${config.comfyui.eventWidth}x${config.comfyui.eventHeight}`,
        workflowTemplate: genResult.wfMode,
        db,
      });
      console.log(`[eventGen] Branch image generated: ${imageUrl}`);
    }
  } catch (err) {
    console.error(`[eventGen] Branch image generation failed:`, err.message);
  }

  // 6. 更新 choice_history 和 summary
  // 存储上一步的选项信息，用于撤回（undo）时恢复
  const newChoiceEntry = {
    branch: event.current_branch + 1,
    choice_label: choice.label,
    choice_text: choice.customText || '',
    summary: branchData.description,
    image: imageUrl,
    prev_choice_a: event.choice_a,
    prev_choice_b: event.choice_b,
    prev_choice_c_label: event.choice_c_label || '自由行动',
    prev_prompt: event.prompt || '',
  };
  choiceHistory.push(newChoiceEntry);

  // 7. 更新 DB（清除 processing 标记，重置强调标记以便下轮重新通知用户）
  db.prepare(`
    UPDATE character_events SET
      description = ?, image = ?, prompt = ?,
      choice_a = ?, choice_b = ?, choice_c_label = ?,
      current_branch = ?, choice_history = ?,
      engaged = 1, processing = 0, emphasis_delivered = 0, last_interaction_at = datetime('now')
    WHERE id = ?
  `).run(
    branchData.description, imageUrl, branchData.prompt,
    branchData.choiceA, branchData.choiceB, '自由行动',
    event.current_branch + 1, JSON.stringify(choiceHistory),
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
    choice_history: JSON.parse(updatedEvent.choice_history || '[]'),
    expires_at: toISO(updatedEvent.expires_at),
    created_at: toISO(updatedEvent.created_at),
  });

    return updatedEvent;
  } catch (err) {
    db.prepare(`UPDATE character_events SET processing = 0 WHERE id = ?`).run(event.id);
    throw err;
  }
}

/**
 * 生成结局并存入记忆
 */
export async function concludeEvent(character, event, outcome) {
  const db = getDb();
  console.log(`[eventGen] Concluding event "${event.title}" for ${character.display_name} (engaged=${event.engaged}, outcome=${outcome})`);

  // 1. LLM 生成结局和摘要
  const worldSetting3 = getWorldSetting();
  const permissionPrompt = worldSetting3
    ? getSystemRulesWithWorld()
    : getSystemRules();
  const worldIntegrationNote = worldSetting3
    ? getWorldIntegrationRule('eventConclusion')
    : null;

  const choiceHistory = JSON.parse(event.choice_history || '[]');
  const historyText = choiceHistory.length > 0
    ? choiceHistory.map((h, i) => `第${i + 1}步：${h.choice_label} → ${h.summary}`).join('\n')
    : `角色经历了：${event.description}（未与用户互动）`;

  const worldConsistencyLine = worldSetting3
    ? '- **世界观一致性**：结局和记忆摘要必须反映世界观的基本规则。角色做出的选择及其后果、环境的反应、事件的收束方式，都必须在世界观框架内自然发生。\n'
    : '';

  const taskPrompt = event.engaged
    ? `为以下特殊事件生成结局叙述和记忆摘要。
事件标题：${event.title}
${historyText}
当前场景：${event.description}

要求：
${worldConsistencyLine}- 结局叙述 80-150 字，收束整个事件的来龙去脉，给故事一个自然的结果
- 记忆摘要 150-300 字，用第三人称视角客观记录整个事件的起因、经过、转折和结果，作为角色长期记忆的一部分

**重要：输出严格 JSON 格式**
{"conclusion":"结局叙述","summary":"记忆摘要（第三人称，包含完整的事件经过）"}`
    : `角色刚刚经历了一场无人参与的特殊事件。请基于事件描述想象它会如何自然结束。
事件标题：${event.title}
${historyText}

要求：
${worldConsistencyLine}- 结局叙述 80-150 字
- 记忆摘要 150-300 字，用第三人称视角客观记录事件

**重要：输出严格 JSON 格式**
{"conclusion":"结局叙述","summary":"记忆摘要（第三人称）"}`;

  const conclusionUserContent = worldSetting3
    ? `请遵循当前世界观来收束奇遇，角色人设如果和世界观有冲突，则以世界观最高优先级，将人设融入世界观。

${taskPrompt}`
    : taskPrompt;

  const msgs = [
    { role: 'system', content: permissionPrompt },
    ...(worldIntegrationNote ? [{ role: 'system', content: worldIntegrationNote }] : []),
    { role: 'system', content: character.base_prompt },
    { role: 'user', content: conclusionUserContent },
  ];

  let conclusionData;
  try {
    const result = await chatSync(msgs, { temperature: 0.7, max_tokens: 1024, response_format: { type: 'json_object' }, label: '事件结局' });
    const jsonStr = extractFirstJson(result);
    if (!jsonStr) throw new Error('No JSON found');
    conclusionData = JSON.parse(repairJson(jsonStr));
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
  const conversationId = `char_${character.id}`;

  try {
    const parsedHistory = JSON.parse(event.choice_history || '[]');
    const branchReasoning = parsedHistory
      .filter(item => item.branch !== 0)
      .map(item => `选择「${item.choice_label}」后：${item.summary}`)
      .join('；');
    if (!event.engaged) {
      const oldRows = db.prepare(`
        SELECT memory_id FROM memory_fragments
        WHERE conversation_id = ? AND memory_type = 'event' AND subject = 'character'
          AND status = 'active' AND judgment LIKE '未互动事件：%'
      `).all(conversationId);
      for (const row of oldRows) softDeleteMemory(row.memory_id);
    }
    const skipUnengaged = !event.engaged && !getMemorySettings().recordUnengagedEvents;
    if (!skipUnengaged) {
      applyMemoryActions({
        conversationId,
        sourceRawStartId: null,
        sourceRawEndId: null,
        actions: [{
          action: 'create',
          sourceMemoryIds: [],
          memory: {
            memoryType: 'event',
            subject: 'character',
            judgment: `${event.engaged ? '已完成事件' : '未互动事件'}：${event.title}。${conclusionData.summary}`,
            reasoning: [event.description, branchReasoning].filter(Boolean).join('；'),
            tags: [character.display_name, event.title, '事件'],
          },
        }],
      });
    }
  } catch (memErr) {
    console.error(`[eventGen] Memory save failed:`, memErr.message);
  }

  // 3. 移到 event_history（保留原始 ID，确保分享卡片等引用不失效）
  db.prepare(`
    INSERT INTO event_history (id, character_id, event_type_key, title, description, final_image, summary, choice_history, total_branches, engaged, outcome, referenced_character_ids)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id,
    character.id, event.event_type_key,
    event.title, event.description, event.image,
    conclusionData.summary,
    event.choice_history, event.current_branch || 0,
    event.engaged, outcome,
    event.referenced_character_ids || '[]'
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
// ── 工具函数 ──

function toSQLite(iso) {
  if (!iso) return iso;
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
}

// 修复 LLM 输出的非法 JSON 转义（image_prompt 规则中的 \( \) 等不是合法 JSON 转义）
function repairJson(text) {
  return text.replace(/\\([^"\\\/bfnrtu])/g, '$1');
}

// 从 LLM 原始输出中提取第一个完整 JSON 对象（括号计数，防 LLM 输出多段 JSON 拼在一起）
function extractFirstJson(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null; // 括号未闭合
}

function toISO(dt) {
  if (!dt) return dt;
  return dt.replace(' ', 'T') + '.000Z';
}

function _parseCharLoras(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return [] }
  }
  return [];
}
