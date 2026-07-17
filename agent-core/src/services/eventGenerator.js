/**
 * 奇遇事件生成器
 *
 * EVENT_TYPES 不再做"剧情钩子库"，而是做"奇遇引擎"——
 * 每条描述的不是"发生了什么"，而是"为什么这种处境值得成为一个事件"。
 *
 * 设计理念：
 *   - desc：描述"这种处境的核心张力"+"它好玩的底层原因"，不预设具体场景
 *   - funFrom：这件事的有趣点来源（社死/反差/被看见/捡漏/好奇心……），引导 LLM 往有活人感的方向写
 *   - reactions：角色面对这类处境的典型反应倾向（仅供参考，LLM 根据人格选择最贴合的方向）
 *   - 所有具体物品/地点/人物/动作均由 LLM 根据角色人格+世界观自由创作，避免模板化
 *
 * - generateEvent(): LLM 结合角色人格+世界观+funFrom/reactions 生成事件初始场景 + 配图
 * - generateNextBranch(): 用户选择后生成下一步 + 配图
 * - concludeEvent(): 到期/完成后生成结局，存入记忆
 */

import { getDb, getSystemRules, getSystemRulesWithWorld, getWorldSetting, getGlobalRule } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
import { generateImageRaw } from './imageSkill.js';
import { saveBase64Image } from './imagePaths.js';
import { config } from '../config.js';
import { broadcastNewEvent, broadcastEventUpdate, broadcastEventConclusion } from './eventNotificationBus.js';
import { upsertVector } from './vectorClient.js';
import { getCurrentActivity } from './scheduleManager.js';
import { getTimeLightTag, getTimeLight } from './timeLight.js';

// ── 事件类型库（奇遇引擎） ──
// 每条给出"这类奇遇的核心模式 + 有趣点来源 + 角色反应方向"，不预设具体场景。
// LLM 结合角色人格、世界观、关系网、当前时间，从方向出发自由创作独一无二的事件。
//
// 设计原则：
//   - desc 描述"这种处境为什么值得成为一个事件"，不是"发生了什么"
//   - 不出现具体物品/地点/人物/动作——那是 LLM 根据角色人格去创造的
//   - funFrom 告诉模型"往哪里用力才会有活人感"（社死/反差/被看见/捡漏……）
//   - reactions 给模型"这个角色可能怎么面对"的参考方向（不照搬，取最贴合人格的）
//   - "奇"只是可选风味之一，平凡小事的情感涟漪同样值得成为一个事件

const EVENT_TYPES = [
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
    key: 'lucky_timing', name: '刚好赶上', durationMin: 20, urgency: 1,
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

// 事件类别 → VAD 情绪偏移（被 chat.js 情绪引擎消费，纯规则零 LLM 开销）
// 正值=提升(V愉悦/A兴奋/D支配感)，负值=降低，范围 [-0.30, +0.45]
const EVENT_VAD_MODIFIERS = {
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

  // ═══ 喜讯降临 ═══ — 纯粹愉悦：V全正、A中高（好消息天然唤醒兴奋）、D全正（喜讯提升自我效能感）
  unexpected_approval:   { valence: 0.30, arousal: 0.30, dominance: 0.20 },  // 惊喜+"原来我也配"
  public_recognition:    { valence: 0.25, arousal: 0.20, dominance: 0.25 },  // 被看见+被理解，支配感强
  surprise_invitation:   { valence: 0.25, arousal: 0.30, dominance: 0.15 },  // 被纳入名单的兴奋
  second_chance_news:    { valence: 0.25, arousal: 0.25, dominance: 0.15 },  // 窗口重开的心跳加速
  lucky_timing:          { valence: 0.25, arousal: 0.35, dominance: 0.15 },  // 刚好赶上的兴奋
  mystery_blessing:      { valence: 0.20, arousal: 0.20, dominance: 0.10 },  // 被世界善待，温和暖意
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
  const MULTI_P_MIN = 0.10;  // 1人也保持 10% 随机到关系网对象的概率
  const MULTI_P_MAX = 0.50;  // 社交达人趋于 50%
  const MULTI_K = 1.0;       // 陡峭度
  const MULTI_R_MID = 5;     // 拐点：R=5 时概率 = 30%

  let multiPerson = null;
  if (relCount > 0) {
    const multiProb = MULTI_P_MIN + (MULTI_P_MAX - MULTI_P_MIN) / (1 + Math.exp(-MULTI_K * (relCount - MULTI_R_MID)));
    console.log(`[eventGen] ${character.display_name} relCount=${relCount}, multiProb=${(multiProb * 100).toFixed(0)}%`);

    if (Math.random() < multiProb) {
      const allRels = db.prepare(`
        SELECT cr.relationship_text,
               c.id AS other_id, c.display_name AS other_name, c.base_prompt AS other_prompt
        FROM character_relationships cr
        JOIN characters c ON c.id = cr.to_character_id
        WHERE cr.from_character_id = ? AND cr.relationship_text != ''
      `).all(character.id);

      const picked = allRels[Math.floor(Math.random() * allRels.length)];
      const otherPersona = picked.other_prompt.replace(/你/g, picked.other_name);

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

  const timeTag = getTimeLightTag(now);

  let contextBlock = '';
  if (recentMoment) {
    contextBlock += `\n关联线索——${character.display_name}一小时前刚发了朋友圈："${recentMoment.content}"。事件素材可以与此呼应，提高关联性。\n`;
  }

  // 将角色人格中的"你"替换为角色名（保留引号内对话不变，简单正则处理）
  const displayName = character.display_name;
  const personaText = character.base_prompt.replace(/你/g, displayName);

  // [0] 第三人称叙事声明 + jailbreak + 世界观（有世界观时注入整合指令，无世界观时跳过）
  const worldIntegrationBlock = worldSetting ? `
<world_integration priority="highest">
上述世界观设定不是可有可无的背景说明——它是这个虚构世界的基本法则，定义了这个世界里什么是正常的、人与人之间如何互动、社会如何运转。以下所有创作必须在这个世界观的框架内展开：

1. 角色的所有行为、反应和判断，都必须以世界观为基准线。世界观塑造了角色的常识和三观——角色觉得什么理所当然、什么值得惊讶、什么不可接受，都由世界观决定，不由现实世界的常识决定。
2. 事件中"异常"的判定标准来自世界观。一个事件是否奇怪、是否危险、是否值得在意，取决于它在这个世界里的相对位置——在现实世界显得离奇的事，在这个世界里可能稀松平常，反之亦然。
3. 环境描写要自然地渗透世界观的细节。场景中的每一个元素——空间、物品、氛围、人群——都应该一致地属于这个世界，不能出现与世界观矛盾的描写。
4. 不要把世界观当成一段可以忽略的"前置说明"。它必须穿透到叙事中的每一个感官细节、每一个角色反应、每一个情节转折。世界观不是背景，是地基。
</world_integration>
` : '';

  // 日程注入：获取角色当前活动，让事件起点与当前活动自然衔接
  let scheduleContextLine = '';
  let scheduleSystemBlock = '';
  try {
    if (config.features.schedule !== false) {
      const currentActivity = getCurrentActivity(character.id);
      if (currentActivity && currentActivity.activity !== '自由时间') {
        scheduleContextLine = `此时${displayName}正在${currentActivity.location}${currentActivity.activity}。`;
        const { timeStr, timeDesc, lightNote } = getTimeLight(now);
        const descPart = currentActivity.description ? `——${currentActivity.description}` : '';
        scheduleSystemBlock = `\n【当前日程】${displayName}正在【${currentActivity.location}】${currentActivity.activity}${descPart}。现在是${timeStr}（${timeDesc}），光线参考：${lightNote}`;
      }
    }
  } catch { /* schedule not available */ }

  const directorSystem = `${jailbreakPrompt}
${worldIntegrationBlock}
你正在为「${displayName}」生成一段特殊事件的开场叙事——所谓"特殊事件"，就是在角色当下的日常中不寻常的某个瞬间。它可以大（紧急状况、陌生人闯入、一个改变轨迹的邀约），也可以小（迟到了、东西丢了、一个没来由的情绪涌上来），可以是正面的（惊喜、发现、心动），也可以是负面的（危机、尴尬、暴露）。

你的任务是写出这个"口子被撕开"的瞬间——紧密第三人称叙事（close third-person narration），读者看到的是关于「${displayName}」的生动叙述。

铁律——违反以下任何一条即视为失败：

【人称】
- 指代角色只用「她」「他」「ta」「${displayName}」，绝对不要使用「你」
- 自由间接引语（free indirect discourse）：第三人称代词，但浸透角色的即时感受

【角色定制锁——事件触发器必须根植于角色独有信息】
- 事件的触发点必须与${displayName}的独有信息直接相关——习惯、身份、能力、关系网、正在隐瞒的事、雷点、近期状态的改变、或世界观中独有的属性——至少命中一项
- 如果删掉这条独有信息、换个名字，这个事件就不该还能成立
- "性格滤镜"不够——不是只在反应层面做高冷/活泼的区别，而是这件事之所以发生、之所以以这种方式发生，根子在角色的独有设定里

【正文禁止摘要化——写现场，不写剧情概要】
- 禁止在正文中出现这些抽象概括词："意外"、"不对劲"、"打断了她原本的节奏"、"事情开始变得复杂"、"她意识到情况不对"、"一切都脱离了计划"
- 开头三句内必须出现：≥1 个具体动作 + ≥1 个具体物件/环境细节 + 1 个角色即时反应（身体或脑内）
- 展现身体反应而非命名情绪："手心渗出细密的汗"而非"ta感到紧张"

【结尾——停在无法再装没看见的行动门槛上】
- 结尾不写"她必须做出选择"或任何旁白式的决策宣告
- 结尾停在一个由场景中的具体细节逼出来的行动门槛上：接不接话、打不打开、跟不跟上去、承认还是否认、帮忙还是走开、留着还是丢掉——但不一定是"A 或 B"的标准二选一题
- 门槛必须来自场景中发生了什么事，不是来自旁白说"现在她面临抉择"

【schedule 起点锁】
- 事件必须从${displayName}当前所在的地点、手头在做的事、视线范围内的东西中触发。第一句出现的地点、动作、物件，必须直接从当前 schedule 场景中承接
- 不允许为制造戏剧性，直接把角色挪到另一个无关地点再触发事件${scheduleSystemBlock}`;

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

  const formatPrompt = `请严格按照以下 JSON 格式输出，不要任何解释或额外文字：

{"title":"事件标题（≤8字，口语感叹。从你刚写完的事件场景里抓最戳人的那个瞬间，用角色第一反应的口吻喊出来——不要给事件'取名'，是替角色喊出ta看到/发现/意识到时脑子里蹦出来的那句话。正确：包裹在动……|谁寄来的？！|钥匙怎么还在她这里。错误：神秘包裹降临|意外来客——这些是在概括事件类型。禁止万能感叹'天哪''不是吧''怎么会'——必须带上这个事件的具体信息点）","description":"场景叙述（紧密第三人称，80-150字。不使用'你'字，始终用ta/她/他）","prompt":"画面描述（英文。${imagePromptInstruction}）${multiPersonImageNote}","choiceA":"选项A（具体行动，8-15字。符合${displayName}的性格和当下处境）","choiceB":"选项B（与A形成真正的行动对比——但必须同样是${displayName}此刻真的可能做出来的事。分叉强度不能为了戏剧性让角色突然做出明显不像ta的选择。8-15字）"}

选项设计原则：
- A和B必须是性质完全不同的两条行动路径——读者立刻感受到它们通往不同的情绪走向
- **但两条路径都必须能从${displayName}的性格和当下处境中自然推出。不能为了让选项有差异而让角色突然做出任何不符合人设的事**
- 避免两个"本质上差不多"的选项
- 根据场景选择最合适的对比维度：做vs不做、直面vs绕开、自己解决vs求助、立刻vs等等、坦白vs保留、介入vs旁观`;

  // [3] 创作任务
  const multiPersonNote = multiPerson
    ? `\n**多人事件**：${multiPerson.relDesc}。事件中应包含${multiPerson.otherName}作为互动对象，描述ta们之间的互动方式、肢体距离和氛围要贴合两人的真实关系。`
    : '';

  const worldPenetrationLine = worldSetting
    ? '- **世界观穿透**：这个事件发生在上述世界观中，不是发生在真空或现实世界中。所有感官细节（街头景象、路人行为、空气气味、社交礼仪）和角色反应（身体本能、社交判断、情感触发点）必须忠实地在世界观规则下展开。事件方向只是一个叙事钩子——它的具体呈现方式必须被世界观重新塑造。\n'
    : '';

  const funFromNote = eventType.funFrom?.length
    ? `\n\n这件事之所以值得成为一个事件，不是因为它"出了大事"——而是因为它天然带有${eventType.funFrom.join('、')}的张力。叙事时往这些层面用力，让读者感受到"就是这个感觉"。`
    : '';
  const reactionsNote = eventType.reactions?.length
    ? `\n\n${displayName}面对这类处境时可能出现的反应倾向：${eventType.reactions.join('、')}。仅供参考——请根据角色人格和当下场景，选择最自然、最贴合的一个方向来展开叙事和选项设计。`
    : '';

  const directorPrompt = `事件方向：**${eventType.name}**——${eventType.desc}${funFromNote}${reactionsNote}
${timeTag}${multiPersonNote}
${scheduleContextLine}
**关键理解**：上面的事件方向只是一个方向性的出发点——它不是剧本，里面没有任何具体场景设定。你的任务是把方向翻译成${displayName}今天此刻实际遇到的、具体的、不可被复制粘贴到别人身上的生活切片。

创作素材：
- ${displayName}的人格：外貌、性格、行为模式——这是最重要的创作来源，但不是"给角色套一个性格滤镜"——而是让事件触发根直接扎进角色独有的设定里
- ${worldSetting ? '世界观的基本法则——这个世界里什么是日常、什么算特殊，由世界观决定' : '现实世界背景——以真实世界的日常为基准'}
- 当前时间：${timeTag}${scheduleContextLine ? '。' + scheduleContextLine : ''}
- ${multiPerson ? '与' + multiPerson.otherName + '的关系——互动要贴合两人的真实关系' : '角色近期的状态——事件自然地嵌入角色生活中'}
${contextBlock ? '- ' + contextBlock.trim() : ''}

请以紧密第三人称创作这个事件的开场。场景长度 80-150 字。
${worldPenetrationLine}严格遵守 directorSystem 中列出的所有铁律——特别是角色定制锁、正文禁止摘要化、结尾停在行动门槛上而不是旁白式决策宣告。`;


  const msgs = [
    { role: 'system', content: directorSystem },
    { role: 'system', content: personaMsg },
    { role: 'system', content: formatPrompt },
    { role: 'user', content: directorPrompt },
  ];

  let eventData;
  let rawResult = '';
  try {
    rawResult = await chatSync(msgs, { temperature: 0.82, max_tokens: 1024, response_format: { type: 'json_object' }, label: '奇遇生成' });
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

  // 5. 生图
  let imageUrl = null;
  try {
    const genResult = await generateImageRaw(eventData.prompt, {
      artist: config.comfyui.eventArtist,
      width: config.comfyui.eventWidth,
      height: config.comfyui.eventHeight,
      scene: 'events',
      priority: options.manual ? 'high' : 'low',
      loras: _parseCharLoras(character.loras),
      ...(character.custom_workflow ? { customWorkflow: character.custom_workflow } : {}),
    });
    if (genResult.success && genResult.images.length > 0) {
      const img = genResult.images[0];
      const filename = `event_${Date.now()}_${img.filename || 'comfy.png'}`;
      imageUrl = saveBase64Image('events', filename, img.base64);
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
    multiPerson: multiPerson ? { otherName: multiPerson.otherName, otherPersona: multiPerson.otherPersona, relDesc: multiPerson.relDesc } : null,
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
  historyText += `\n剧情推进：${choice.label}${choiceExtra}`;

  // 4. LLM 生成下一步（try-catch 确保失败时清除 processing 标记）
  try {
  const worldSetting2 = getWorldSetting();
  const jailbreakPrompt = worldSetting2
    ? getSystemRulesWithWorld({ roleplay: false })
    : getSystemRules({ roleplay: false });
  const imageRules = getGlobalRule('image_prompt');
  const imageRulesText = imageRules?.rule_content || '';

  const displayName2 = character.display_name;
  const personaText2 = character.base_prompt.replace(/你/g, displayName2);

  const worldIntegrationBlock2 = worldSetting2 ? `
<world_integration priority="highest">
上述世界观设定不是可有可无的背景说明——它是这个虚构世界的基本法则，定义了这个世界里什么是正常的、人与人之间如何互动、社会如何运转。以下所有创作必须在这个世界观的框架内展开：

1. 角色的所有行为、反应和判断，都必须以世界观为基准线。世界观塑造了角色的常识和三观——角色觉得什么理所当然、什么值得惊讶、什么不可接受，都由世界观决定，不由现实世界的常识决定。
2. 事件中"异常"的判定标准来自世界观。一个事件是否奇怪、是否危险、是否值得在意，取决于它在这个世界里的相对位置——在现实世界显得离奇的事，在这个世界里可能稀松平常，反之亦然。
3. 环境描写要自然地渗透世界观的细节。场景中的每一个元素——空间、物品、氛围、人群——都应该一致地属于这个世界，不能出现与世界观矛盾的描写。
4. 不要把世界观当成一段可以忽略的"前置说明"。它必须穿透到叙事中的每一个感官细节、每一个角色反应、每一个情节转折。世界观不是背景，是地基。
</world_integration>
` : '';

  const directorSystem2 = `${jailbreakPrompt}
${worldIntegrationBlock2}
你正在为「${displayName2}」的特殊事件生成下一幕——一段紧密第三人称叙事。上一幕中角色做出了选择，现在展现选择之后发生的事情。

铁律（违反即失败）：
- 指代角色只用「她」「他」「ta」「${displayName2}」，绝对不要使用「你」
- 通过身体反应来展现角色的即时情绪变化，而非直接命名情绪
- 禁止摘要化：不要用"意外""不对劲""事情变得更复杂了""她意识到局面超出了预期"这类抽象概括推进剧情
- 必须写出：一个具体动作 + 一个具体物件/环境细节 + 一个角色即时反应（身体或脑内）`;

  let personaMsg2 = `以下是角色「${displayName2}」的人格设定，供你了解角色的外貌、性格和行为模式：

${personaText2}`;

  if (multiPerson2) {
    personaMsg2 += `\n\n---\n以下是${multiPerson2.otherName}的人格设定（${multiPerson2.relDesc}），供事件涉及多人互动时参考：

${multiPerson2.otherPersona}`;
  }

  const branchImagePromptInstruction = imageRulesText
    || '描述场景、角色外观、动作、氛围';

  const multiPersonImageNote2 = multiPerson2
    ? `**多人画面**：prompt 中必须包含${displayName2}和${multiPerson2.otherName}两个人。描述清楚各自的外观、位置、互动动作。用句号分隔两人描述。`
    : '';

  const formatPrompt2 = `请严格按照以下 JSON 格式输出，不要任何解释或额外文字：

{"description":"选择后的场景叙述（紧密第三人称，80-150字。承接上一个选择的结果，展现角色此刻的即时感受和新出现的局面。场景转折要出乎意料但又在情理之中——读者应该感到'居然会这样'但紧接着就觉得'仔细想确实会这样'。禁止摘要化：不要用'意外''不对劲''事情变复杂了'等抽象概括推进剧情）","prompt":"画面描述（英文。${branchImagePromptInstruction}）${multiPersonImageNote2}","choiceA":"新选项A（具体行动。必须符合${displayName2}的个性——是ta此刻真的会做出来的事。8-15字）","choiceB":"新选项B（与A形成真正的行动对比——但同A一样，必须从${displayName2}的个性中自然推出。8-15字）"}`;

  // 只有多人模式才注入关系信息（和初始事件生成一致）
  const multiNote2 = multiPerson2
    ? `\n**多人事件**：${multiPerson2.relDesc}。事件中应包含${multiPerson2.otherName}作为主要互动对象，描述ta们之间的互动方式、肢体距离和氛围要贴合两人的真实关系。${relationships.map(r => `${displayName2}是${r.display_name}的${r.relationship_text}`).join('；')}`
    : '';

  const worldPenetrationLine2 = worldSetting2
    ? '- **世界观穿透**：这个事件发生在上述世界观中，不是发生在真空或现实世界中。所有感官细节（街头景象、路人行为、空气气味、社交礼仪）和角色反应（身体本能、社交判断、情感触发点）必须忠实地在世界观规则下展开。事件方向只是一个叙事钩子——它的具体呈现方式必须被世界观重新塑造。\n'
    : '';

  const eventTypeMeta = EVENT_TYPES.find(e => e.key === event.event_type_key);
  const funFromNote2 = eventTypeMeta?.funFrom?.length
    ? `\n\n这件事的有趣张力来自${eventTypeMeta.funFrom.join('、')}——后续分支中请继续保持这个层面的力量。`
    : '';
  const reactionsNote2 = eventTypeMeta?.reactions?.length
    ? `\n\n${displayName2}面对这类处境时可能出现的反应倾向：${eventTypeMeta.reactions.join('、')}——仅供参考，根据角色个性和当下局面选择最贴合的方向。`
    : '';

  const directorPrompt2 = `事件标题：${event.title}
${historyText}${multiNote2}${funFromNote2}${reactionsNote2}

**核心要求——让分支有趣**：接下来的场景不能是"选了A所以A发生了"的平铺直叙。读者选择之后应该经历一个"没想到会这样——但仔细一想确实合理"的转折。这个转折可以来自：
- 选择引发的连锁反应中，出现了角色没预料到的因素
- 某个之前被忽略的细节突然变得关键
- 另一个角色的反应方式出乎意料（但符合那个人的人设）
- 环境或时机带来了额外的变量

**重要提醒**：场景必须忠实于「${displayName2}」的人格——ta的反应方式、内心活动、决策逻辑，都应该让读者觉得"换了别人就不会这样"。

请以紧密第三人称创作选择之后发生的下一个场景。场景长度 80-150 字。
${worldPenetrationLine2}严格遵守 directorSystem2 中列出的铁律。`;

  // 上一幕画面注入：视觉参考帮助 LLM 保持画面连贯（叙事已有 historyText，此处仅补充视觉信息）
  const prevSceneMsg = event.prompt
    ? { role: 'system', content: `【上一幕画面 · 视觉参考】\n${event.prompt}` }
    : null;

  const msgs = [
    { role: 'system', content: directorSystem2 },
    { role: 'system', content: personaMsg2 },
    { role: 'system', content: formatPrompt2 },
    ...(prevSceneMsg ? [prevSceneMsg] : []),
    { role: 'user', content: directorPrompt2 },
  ];

  let branchData;
  let rawBranchResult = '';
  try {
    rawBranchResult = await chatSync(msgs, { temperature: 0.82, max_tokens: 1024, response_format: { type: 'json_object' }, label: '事件分支' });
    const jsonStr = extractFirstJson(rawBranchResult);
    if (!jsonStr) throw new Error('No JSON found in LLM response');
    branchData = JSON.parse(repairJson(jsonStr));
    const branchPromptText = branchData.prompt || branchData.imagePrompt;
    if (!branchData.description) throw new Error('Incomplete branch data');
    branchData.prompt = branchPromptText || event.prompt;
  } catch (err) {
    console.error(`[eventGen] Branch generation failed:`, err.message);
    console.log(`[eventGen] Raw branch LLM response:\n${rawBranchResult}`);
    throw err;
  }

  // 5. 生图
  let imageUrl = null;
  try {
    const genResult = await generateImageRaw(branchData.prompt, {
      artist: config.comfyui.eventArtist,
      width: config.comfyui.eventWidth,
      height: config.comfyui.eventHeight, scene: 'events',
      priority: 'high',
      loras: _parseCharLoras(character.loras),
      ...(character.custom_workflow ? { customWorkflow: character.custom_workflow } : {}),
    });
    if (genResult.success && genResult.images.length > 0) {
      const img = genResult.images[0];
      const filename = `event_${Date.now()}_${img.filename || 'comfy.png'}`;
      imageUrl = saveBase64Image('events', filename, img.base64);
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

  // 7. 更新 DB（清除 processing 标记，不生成摘要——摘要只在结局时生成）
  db.prepare(`
    UPDATE character_events SET
      description = ?, image = ?, prompt = ?,
      choice_a = ?, choice_b = ?, choice_c_label = ?,
      current_branch = ?, choice_history = ?,
      engaged = 1, processing = 0, last_interaction_at = datetime('now')
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
    ? `<world_integration priority="highest">
上述世界观设定是最高优先级的创作框架。结局叙述和记忆摘要必须在这个世界观的框架下展开——角色的行为逻辑、事件的因果链条、环境的细节描写，都要忠实于世界观的基本法则。世界观定义了角色判断"正常"与"异常"的基准线，结局的收束方式不能偏离这条基准线。
</world_integration>`
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

  const msgs = [
    { role: 'system', content: permissionPrompt },
    ...(worldIntegrationNote ? [{ role: 'system', content: worldIntegrationNote }] : []),
    { role: 'system', content: character.base_prompt },
    { role: 'user', content: taskPrompt },
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
  const fragmentType = 'fact';

  try {
    const entities = JSON.stringify([character.display_name, event.title]);

    // 摘要文本：仅结论（用于 memory_fragments + 聊天注入，避免全量分支撑爆上下文）
    const summaryText = `【事件】${event.title}\n${conclusionData.summary}`;

    // 完整文本：全部分支（用于 ChromaDB 向量检索，使事件细节也可被语义召回）
    const parsedHistory = JSON.parse(event.choice_history || '[]');
    let fullVectorText = `【事件】${event.title}\n开始：${event.description}`;
    for (const h of parsedHistory) {
      if (h.branch === 0) continue;
      fullVectorText += `\n选择了：「${h.choice_label}」→ ${h.summary}`;
    }
    fullVectorText += `\n结局：${conclusionData.summary}`;

    if (!event.engaged) {
      db.prepare(`
        DELETE FROM memory_fragments
        WHERE conversation_id = ? AND fragment_type = 'fact' AND content LIKE '【未互动的事件】%'
      `).run(conversationId);
      console.log(`[eventGen] Replaced old unengaged event memory for ${character.display_name}`);
    }

    const contentWithTag = event.engaged
      ? `【事件·已完成】${summaryText}`
      : `【未互动的事件】${summaryText}`;

    const insertResult = db.prepare(`
      INSERT INTO memory_fragments (conversation_id, fragment_type, content, entities)
      VALUES (?, ?, ?, ?)
    `).run(conversationId, fragmentType, contentWithTag, entities);

    // 向量化存入 RAG
    try {
      await upsertVector({
        id: `event_${insertResult.lastInsertRowid}`,
        text: fullVectorText, // 向量检索用完整分支文本，提高召回
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

  // 3. 移到 event_history（保留原始 ID，确保分享卡片等引用不失效）
  db.prepare(`
    INSERT INTO event_history (id, character_id, event_type_key, title, description, final_image, summary, choice_history, total_branches, engaged, outcome)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id,
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
