/**
 * 奇遇事件生成器
 *
 * - 硬编码 EVENT_TYPES（42 条，9 大类，钩子驱动），和朋友圈风格库一样的模式
 * - generateEvent(): LLM 生成事件初始场景 + 配图
 * - generateNextBranch(): 用户选择后生成下一步 + 配图
 * - concludeEvent(): 到期/完成后生成结局，存入记忆
 */

import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, getSystemRules, getSystemRulesWithWorld, getWorldSetting, getGlobalRule } from '../db/index.js';
import { chatSync } from '../llm/llm-client.js';
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
  // ═══ 手机/网络上出现了不该出现的东西（20-60min）═══
  { key: 'flight_booked', name: '有人替你订了一张票', durationMin: 30, urgency: 2,
    desc: '手机弹出一条预订确认——机票、车票、或活动门票。目的地是一个从没去过的地方。不是你订的。打过去问，客服说订单备注栏里留了一句话，是你很久以前在某处说过或写过的一句话。一字不差。那个人是谁——以及ta怎么知道你会在今天看到这条确认短信？' },
  { key: 'trapped_in_group', name: '被拉进了一个退不出的群', durationMin: 25, urgency: 2,
    desc: '不知被谁拉进了一个群聊。其他成员的头像全是默认灰色，名字都是单字。最新一条消息是刚发的：两个简单的字。然后自己就被设成了群主。所有按钮都是灰的——不能退群，不能拉人，不能禁言。唯一亮着的按钮是「发送消息」。光标在里面闪。' },
  { key: 'self_sent_message', name: '收到一条自己发来的定时消息', durationMin: 30, urgency: 2,
    desc: '手机弹出某个App的定时发送提醒——但自己从没用过这个功能。消息内容只有一行字，措辞是你习惯的句式，提到了一件只有自己知道的事。对写下这句话完全没有记忆。发送时间被设定在三个月前。发现这一点的时候，汗毛竖起来不是因为恐惧，而是因为那句话里藏着一个自己已经忘记的念头——现在重新被点燃了。' },
  { key: 'mystery_friend', name: '社交账号多了个不认识的亲密好友', durationMin: 40, urgency: 1,
    desc: '翻好友列表时发现一个完全没印象的账号，但它被标注为"亲密好友"——能看到所有仅密友可见的内容。聊天记录是空的，显示已互相关注半年。对方的头像是一张没有任何特征的风景照。点进主页——最近一条动态的发布时间是今天。内容只有一张照片：自己昨天下午去过的那个地方，角度是从自己当时站的位置背后拍的。' },
  { key: 'phantom_post', name: '账号自动发了一条你不记得的动态', durationMin: 30, urgency: 2,
    desc: '朋友截图发来一条"自己"刚发的动态——文字像是自己会说的话，配图是自己确实去过的地方。但自己没有发过。打开主页，那条动态稳稳地躺在时间线上，发布时间是十分钟前。已有几个共同好友点赞。删掉之前先看了一眼评论——有一条来自一个不认识的人，写了三个字："你想起来了？"然后那条评论在自己眼前被秒删了。' },

  // ═══ 物理空间出现了不该出现的东西（40-90min）═══
  { key: 'shoes_at_door', name: '门口多了一双不认识的鞋', durationMin: 40, urgency: 2,
    desc: '回家时门口摆着一双鞋——不是自己的，不是同住者的，不是任何来过家里的人的。鞋码不对，款式没印象，但鞋尖朝内，像有人穿进来后脱在这里。鞋底是干净的。鞋舌上有一个手写的小标记，不是商标——像是某种记号。房间里的空气温度和离开时不一样。' },
  { key: 'things_moved', name: '房间里有什么东西被挪动过了', durationMin: 40, urgency: 1,
    desc: '不是少了东西——是位置不对。椅子比平时离桌子远了大约一掌。杯子把手的方向反了。书架上有一本倒着插回去的书——书脊朝内，页边朝外。都很微小。但如果站在房间中央，把这些变化的点位连起来——它们构成了一条行动路线，从门口开始，在某个位置停下。那个位置前面，是一件自己每天都会碰但从没仔细看过的东西。' },
  { key: 'mirror_delay', name: '镜子里的倒影慢了半拍', durationMin: 30, urgency: 2,
    desc: '第一眼是正常的。折回来看第二眼时发现的——倒影的动作有极微小的延迟，不到半秒。举起手，镜像等了片刻才跟上。反复确认了三次。不是错觉。现在倒影正盯着自己，表情和本人脸上的不完全一致。嘴角的弧度多了一点点——只有自己在笑的时候才会出现的弧度，但此刻自己并没有在笑。是光线、是疲劳、还是别的什么——但手已经不自觉地想去碰一下镜面。' },
  { key: 'unknown_door', name: '发现了一个从没注意过的空间', durationMin: 90, urgency: 1,
    desc: '在这栋建筑里待了这么久，今天第一次注意到那个结构——楼梯下方的窄门、天花板上的检修口、或者走廊尽头一块颜色和周围墙面微妙不同的墙板。它一直在那里。撬开或推开之后，里面的空间比预期的深得多。空气从里面涌出来——不冷，带着一种不属于这栋建筑的气味。手机手电筒的光照进去，尽头拐了个弯，看不见最里面。' },
  { key: 'upstairs_nobody', name: '天花板传来脚步声——楼上没人住', durationMin: 40, urgency: 2,
    desc: '清晰的脚步声从上面传来——不急促，甚至有某种节奏感。七步或八步，走到某个位置停下，安静片刻，再走回来。问房东，楼上的住户上周搬走了，门锁着，水电都断了。抬头盯着天花板。脚步声停了。然后一个新的声音加进来——某种沉重的、被缓慢拖拽的东西。就在头顶正上方。' },

  // ═══ 有人在冒充你、找你、或知道你（20-50min）═══
  { key: 'name_poacher', name: '有人正用你的名字做某件事', durationMin: 40, urgency: 2,
    desc: '偶然发现有人以你的名义在行动——预订了餐厅、报名了活动、或给某个公共平台投了稿。对方选的都是你会选的选项，语气模仿得很准，甚至知道你不吃香菜。还没有造成实质伤害，但有一件事卡在喉咙里：这个人对自己日常习惯的了解程度，超过了任何普通朋友。而自己完全不知道对方是谁。' },
  { key: 'stranger_knows_name', name: '陌生人叫出了全名——还知道别的', durationMin: 25, urgency: 2,
    desc: '一个完全没印象的人迎面走来，自然地叫了全名。对方提到昨天做的事——时间地点都对，语气像老朋友。自己确定不认识这张脸。在想好怎么回应之前，对方已经走近到只有一步的距离，用只有两个人能听到的音量说了后半句——那是一件从来没有对任何人说过的事。然后对方退后，等你的反应。' },
  { key: 'mistaken_for_another', name: '被当面认定成另一个人——对方有证据', durationMin: 30, urgency: 2,
    desc: '对面的人态度太过笃定，一时让人怀疑起自己。对方拿出了一张照片——里面的人确实和自己有几分像。但更让人在意的是照片里的场景：一个自己没有去过的地方，拍到的背影穿着一件自己确实有的外套。日期是上个周末。那天自己出过门。但没有去过那里。至少不记得去过。' },
  { key: 'ex_appears', name: '那个人在最糟糕的时刻出现了', durationMin: 25, urgency: 2,
    desc: '一个此刻绝对不想见到的人——正在朝这个方向走来。还有大约三十米。不能跑，跑了更难看。不能假装低头看手机，因为对方已经看到了自己。手边没有可以躲进去的巷子、店门、或人群。只剩下几秒钟，用来决定用什么表情面对，以及对方开口第一句说什么——是自己先说，还是等对方先开口。' },

  // ═══ 被迫参与/被选中（20-60min）═══
  { key: 'thing_thrown', name: '有人朝你扔了个东西——里面包着纸条', durationMin: 20, urgency: 2,
    desc: '人群里飞出一个拳头大的纸团，精准地砸在胸前。打开皱巴巴的外层，里面是一张小纸条，手写的字很潦草。不是告白、不是广告、不是恶作剧。是一句指向某个时间和地点的短句。猛抬头找扔纸团的人，周围全是陌生面孔。其中一个背影正在走远——步伐不快不慢，没有回头。纸条还在手里。那个时间和地点，就是接下来两小时内的事。' },
  { key: 'dragged_onstage', name: '被陌生人指名拉上了台', durationMin: 20, urgency: 2,
    desc: '台上的人——表演者、主持人、或某种控场的角色——手指正直直地指着这个方向。周围的目光像探照灯一样汇聚过来。"就是你——上来一下。"没有任何提示、没有上下文。周围开始有掌声和起哄。坐在原地拒绝只需要两秒，但所有人会盯着更久。站起来上去——不知道上去之后会发生什么，但至少不需要继续被所有人从座位上盯着看。' },
  { key: 'kid_package', name: '一个小孩把东西塞进手里就跑了', durationMin: 25, urgency: 2,
    desc: '手心里突然多了一样东西——被一只小手塞进来的。抬头只来得及看到一个小孩的背影，已经跑远了，拐进了人堆或巷口。手掌打开，不是玩具、不是垃圾、不是钱。而是一件似曾相识的东西：前两天丢掉的那件小物、或者最近一直在找的那个东西、或者一个自己小时候也拥有过的完全同款的旧物。那孩子不认识。但手里的东西是真实的。' },
  { key: 'stranger_game', name: '路边有个陌生人摆好了棋盘在等你', durationMin: 30, urgency: 1,
    desc: '街角或公园长椅边，一个人面前摆着棋盘、扑克、或某种叫不出名字的游戏。周围没有别的玩家。也没有在等人——除了你。因为当你走得足够近时，对方抬起头，眼神没有犹疑："就差你了。"语气笃定得像认识你很久。对面的位置是空的。棋盘上的局面已经进行了一半——正在等一个黑子/白子/关键一步。' },
  { key: 'unsigned_challenge', name: '收到了一封没有署名的信——但你认得那个符号', durationMin: 30, urgency: 2,
    desc: '一封信或消息——没有发件人。措辞不像是威胁，更像是一种测试。提到了一个具体的时间和地点、一把长椅或一扇门、和一个只有自己知道含义的暗号。落款是一个符号——自己认得的，但想不起在哪里见过。翻来覆去看了三遍。那个符号开始在心里烧——不是害怕，是某种被点燃的旧东西，以为早就不在了。' },

  // ═══ 过于精确的巧合——正在打破"随机"的底线（30-90min）═══
  { key: 'dream_came_true', name: '今天的事和昨晚的梦逐帧重合', durationMin: 40, urgency: 1,
    desc: '一次是意外。两次是概率。但现在是整个场景——同一个路口、同一个光线角度、同一个路人的外套颜色、胃里同样的微妙收紧感。梦里的事件正在一帧一帧地发生。但梦做到这里就醒了。接下来的部分——梦没有提前展示。站在这帧"已知"和下一帧"未知"的交界上，脚有点不想继续往前走了。但又不得不走。' },
  { key: 'phantom_photo', name: '刚删掉的照片出现在了不该出现的地方', durationMin: 30, urgency: 2,
    desc: '明明已经删掉并从回收站彻底清除的照片，出现在了完全不该出现的地方——朋友发来的截图的背景里、某家店面的展示墙上、或一本翻开的杂志内页。照片里的场景是真实的，角度和构图是只有自己才会那样拍的。它不应该在任何地方，但它确实在。而且——照片里有一处细节和记忆中的不一样了。多了点什么，或者少了点什么。' },
  { key: 'thought_stolen', name: '脑中刚组织好的句子被人逐字说了出来', durationMin: 20, urgency: 2,
    desc: '脑子里刚成形的一串措辞——还没开口、还没动嘴唇——被旁边的陌生人完整地、逐字逐句地说了出来。措辞完全一致，甚至停顿的位置都和脑中预演的重合。对方说完后继续做自己的事，完全没觉得有什么异常。那句话不是一个常用句。它包含一个极其生僻的引用或一组非常具体的意象。那个人不可能独立组合出同样的句子。不可能。但发生了。' },
  { key: 'three_mentions', name: '同一个词今天被三个无关的人说了', durationMin: 40, urgency: 1,
    desc: '第一次听到不以为意。第二次——来自完全不同的来源、完全不同的语境——手指顿了一下。到了第三次，第三个毫无关联的人嘴里吐出同一个词的时候，心跳在耳朵里响了一声。这个词不是日常用语，它非常具体。它可能是一个地名、一个人名、或一个不应该出现在今天对话中的专业术语。它不可能是流行语、不可能是算法推送、不可能是"你只是在注意它"。三次。三次。它在指向什么。' },
  { key: 'perfect_stranger_repeat', name: '第三次撞见同一个完全陌生的人', durationMin: 60, urgency: 1,
    desc: '第一次是昨天下午的咖啡店——排队时前面那个人。第二次是今天早上的地铁——隔着三个人。现在是第三次了。完全不同的地点、完全不同的时间带、换了衣服。但就是同一个人。对方也看到了你。这次没有移开视线，而是举起了一只手——像是在打招呼，又像是在示意你站在原地等ta过来。这个人的表情不是在笑，也不是在怕——是一种更复杂的东西，像是"终于"。' },

  // ═══ 身体/感官发出了异常信号（20-60min）═══
  { key: 'phantom_smell', name: '闻到了一股物理上不该存在的味道', durationMin: 30, urgency: 1,
    desc: '一阵突然而精确的气味——某个特定的人身上的洗衣液味道、童年厨房里的调料、或一处已经不存在的地方的空气。不是"类似"，是精确到能让大脑自动开始播放那一整段记忆。周围没有任何可以产生这种味道的来源。气味持续了几秒就消失了，但身体还没恢复——心跳偏快，眼眶有一点点发胀。气味走了，记忆还停在原地。' },
  { key: 'mysterious_mark', name: '身上出现了一个不记得的印记', durationMin: 30, urgency: 1,
    desc: '洗澡或换衣服时发现的——手腕内侧、锁骨下方、或脚踝附近——一个浅浅的痕迹。不是受伤，更像某种压痕或接触留下的印记。对着镜子仔细观察，开始用力回忆昨天的每一个片段，试图找出会留下这种印记的动作。有一段时间想不起来——不是大段的缺失，就是几分钟的空白，刚好够发生某件事但不够留下清晰的记忆。' },
  { key: 'deja_vu_crash', name: '既视感强烈到像被人按进了水里', durationMin: 20, urgency: 2,
    desc: '不是普通的"这个场景好像经历过"。是一股沉重的、近乎物理性的"这个瞬间已经发生过"的确信——每一个感官细节同时抵达，像一面墙迎面撞来。接下来对方会说的话、窗外即将经过的那辆车的颜色、自己喉咙里即将涌上来的某种情绪——全部在预感中，然后全部精确地、一样不差地发生了。不是幻觉。也不是巧合。结束了。但那几秒里自己被按在某种东西里面，现在还在喘气。' },
  { key: 'eavesdrop_impossible', name: '听到了一段不该能听到的对话', durationMin: 30, urgency: 2,
    desc: '声音从不可能的方向传来——隔了两堵墙的私语、没有人的走道深处、或者手机不处于通话状态却传出了微弱的说话声。内容是一段对话，正在进行。其中出现了自己的名字——两次。第二次后面跟着一句信息，是一个自己以为没有任何人知道的事实。屏住呼吸继续听。声音还在。但想不通声源在哪里。房间没有任何地方能让这个声音穿过来。' },

  // ═══ 社交场面的微小爆炸（20-40min）═══
  { key: 'elevator_stranger', name: '困在电梯里——陌生人突然开始说真话', durationMin: 25, urgency: 2,
    desc: '电梯停了。另一个被困的人——不认识，大概是同栋楼的面孔——在沉默了片刻之后，突然用完全不像陌生人之间说话的语气开了口。那句话不是闲聊。是坦白、质问、或一个信息——简短，但每个字都让人无法用"嗯嗯"敷衍过去。这个人可能不会再见到，可能马上就出去，可能这段对话的保质期只有电梯维修的这几分钟——但正因如此，有些话可以说，有些话必须说。' },
  { key: 'rogue_device', name: '在绝对安静处——身上的设备突然炸响', durationMin: 20, urgency: 2,
    desc: '在最不该出声的场合——表演中、会议的寂静里、或某个人正在说重要事情的时候——身上的某个设备以最大音量响了起来。但不是熟悉的铃声或通知音。播放的内容是一段自己从没录过的音频片段、一个陌生人的声音在叫自己的名字、或一段不应该存在的录音。关不掉。音量键失灵。所有人转头盯着。而那段音频还没播完——剩下的内容正在从扬声器里继续往外淌。' },
  { key: 'impossible_question', name: '被当众问了一个任何回答都会暴露什么的题', durationMin: 20, urgency: 2,
    desc: '一个看似无辜的问题从人群中浮起来——提问的人可能没有恶意，或者完全清楚自己在做什么。这个问题精准地触碰了一个绝对不能在这里说的点：两个人的秘密、一个正在进行的谎言、或一个还没准备好面对的真相。回答A会暴露其中一半，回答B会暴露另一半。沉默本身就是承认。需要决定在接下来两秒内毁掉哪一半——或者毁掉谁的。' },
  { key: 'side_eye_secret', name: '撞破了一个自己不该看到的眼神交换', durationMin: 30, urgency: 2,
    desc: '如果不是恰好站在这个角度，根本不会注意到。两个熟人在以为没人看的时候交换了一个表情——极快，不到一秒，但信息量太大了。有秘密、有共谋、有某种与自己有关的潜台词。现在两个人都恢复了正常，正在朝自己自然地说笑。但那个表情还残留在视网膜上。它暗示了一件事——自己一直被蒙在鼓里的事。而这件事可能已经存在了很长一段时间。' },
  { key: 'wrong_offer', name: '一个不该答应的提议——但全身都在想答应', durationMin: 30, urgency: 1,
    desc: '对方提了一个理智层面应该婉拒的提议。但身体的第一反应骗不了人——心跳加速不是因为紧张，是因为兴奋。对方的嘴角有一点非常微小的弧度，像是知道答案。表情管理还维持着——"我再考虑一下"——但脑子里已经在预演答应之后会发生的事。那些事和"不该做"之间有重叠区域，但那个区域边缘模糊，看起来很诱人。' },

  // ═══ 时间与空间的规则正在微妙崩坏（30-120min）═══
  { key: 'vending_mystery', name: '自动贩卖机吐出了不是自己选的东西', durationMin: 30, urgency: 1,
    desc: '按的是咖啡，哐当一声滚出来的是一样完全不同的物品——不是零食、不是饮料，而是一件不该出现在自动贩卖机里的东西。上面贴了一张手写的标签，字迹不像是店员写的。翻过来——背面还有一行更小的字，提到了附近某个具体的地点和一个时间段。"如果你拿到了这个"——自己在读这行字的时候手指有点发麻，因为那个地点是自己每天都会经过但从没进去过的地方。' },
  { key: 'shop_switch', name: '推开店门——外面的世界被调包了', durationMin: 60, urgency: 1,
    desc: '只是进去不到五分钟。推门出来时，街上有什么不一样了。不是大变——一个招牌换了颜色、路边停着一辆不该在这个城市的车、空气的湿度变了。手机信号满格但自动对时的时间是错的，差了整整几个小时。旁边便利店的店员制服颜色和记忆中不同。回头看刚才出来的那扇门——它在一个之前没有门的墙面上。摸了摸门把手——凉的，真实存在。但刚才自己是从哪里进去的？' },
  { key: 'clock_divergence', name: '所有的钟都在说不同的时间——而且差距在扩大', durationMin: 40, urgency: 1,
    desc: '手机上的时间、街边电子钟的时间、店里墙上的指针——三个完全不同的数字，差别大到不可能是时区或误差。盯得越久越不对劲。手机上的秒针走得太慢了。不对，是电子钟太快了。也不对。是自己感受到的时间流速变了？重新看三个钟——差距比刚才更大了。三个时间在以不同的速度向前流动。而自己正站在三个不同时间流速的交汇点上。' },
  { key: 'number_pattern', name: '今天遇到的每一个数字都在重复同一个序列', durationMin: 40, urgency: 1,
    desc: '早上找零的钱数。电梯停靠的楼层。外卖单号后几位。路过的车牌后三位——同一个数字组合。到了第七次开始主动找下一个数字来确认能不能打破这个模式。第十次：一辆公交车身侧面硕大的广告电话号码，同一个数字序列嵌在其中。手已经自动打开了备忘录在搜索这个数字。它可能是一个日期、一个坐标、一个编号——或者什么都不是。但如果它什么都不是，为什么自己的后颈有点发麻。' },
  { key: 'liminal_hour', name: '凌晨三四点——城市在运行另一套规则', durationMin: 90, urgency: 1,
    desc: '这个时间醒着的人之间有一种默契：便利店里穿玩偶服买东西的人、河堤上一个人反复练习挥棒的人、自助洗衣店里对着滚筒自言自语的人。每个人的存在都在说明同一件事——凌晨三点到四点半之间，正常世界的规则暂时松动了。而自己今晚也在这个时间醒着，走在街灯之间，还没有向自己解释清楚为什么要出门。然后看到下一个路灯下，另一个人影。' },

  // ═══ 被迫扮演/越界/踏入禁区（20-50min）═══
  { key: 'fake_identity_trap', name: '被误认成某个人——将错就错的诱惑太大了', durationMin: 30, urgency: 2,
    desc: '对方迎上来的表情是松了一口气——"您终于到了！"——显然认错人了。纠正的话含在嘴里时，看到了对方手里递过来的东西、旁边众人的期待表情、和那扇正在为自己打开的门。继续往前走只需要闭嘴点头，但跨过那扇门之后，这个误会就暂时脱不掉了——除非自己主动拆穿。而那个被误认的身份——从对方恭敬的语气和周围人的反应来看——比自己预想的要有趣得多。' },
  { key: 'caught_in_the_act', name: '正在做一件不该做的事——最不该的人出现了', durationMin: 20, urgency: 2,
    desc: '手还放在不该放的位置。屏幕还亮着不该被看到的页面。或嘴里还含着那句不该说的话。而那个人——所有人类中最不该看到这一幕的那一个——正站在几米外，目光已经锁定。脸上可能已经有结论了，也可能什么都没有写，只是在等一个解释。自己需要在一秒之内决定：承认、否认、转移话题、反问对方为什么在这里、或者试试看能不能让这件事变成一个"笑点"。' },
  { key: 'overheard_about_self', name: '不小心听到别人在认真讨论自己', durationMin: 25, urgency: 2,
    desc: '自己的名字从转角飘过来。不是那种随口提到的语气——是在认真地、压低声音地讨论。内容让人定住了：涉及一件自己没告诉过任何人的事，或一个连自己都还没确认的"事实"。说话的人不知道自己在墙的另一边。继续听就不可逆地获取了不该获取的信息。走开就等于永远不知道那个人接下来要说的下半句——而那个下半句可能正是关于"怎么办"的部分。' },
  { key: 'line_crossed', name: '越过了一条明确写着"止步"的线——没有人知道', durationMin: 40, urgency: 1,
    desc: '不是什么惊天大事——翻过了一道"禁止进入"的围栏、推开了一扇写着"外人免进"的门、或走进了一段被警戒线拦住的路。没有人看见。这个事实比背后的场景更让人心跳加速。现在站在不该在的地方，周围的空气、声音、光线都和外面不是同一个世界。那道被越过的线还在身后——现在转身回去什么事都没有。但到目前为止，还没有人转身。前面似乎还有空间。' },
];

/**
 * 根据角色条件筛选可用的事件类型
 * 目前全部可用，后续可以根据好感度/标签过滤
 */
function getAvailableEventTypes(character, db) {
  return EVENT_TYPES;
}

// 奇遇类别 → VAD 情绪偏移（被 chat.js 情绪引擎消费，纯规则零 LLM 开销）
// 正值=提升(V愉悦/A兴奋/D支配感)，负值=降低，范围 [-0.15, +0.15]
const EVENT_VAD_MODIFIERS = {
  // ═══ 手机/网络异常 — 被窥视/微不安 ═══
  flight_booked:        { valence:-0.03, arousal: 0.10, dominance:-0.05 },
  trapped_in_group:     { valence:-0.05, arousal: 0.10, dominance:-0.08 },
  self_sent_message:    { valence:-0.05, arousal: 0.12, dominance:-0.05 },
  mystery_friend:       { valence:-0.03, arousal: 0.08, dominance:-0.03 },
  phantom_post:         { valence:-0.05, arousal: 0.10, dominance:-0.05 },

  // ═══ 物理空间异常 — 安全感被打破 ═══
  shoes_at_door:        { valence:-0.08, arousal: 0.10, dominance:-0.05 },
  things_moved:         { valence:-0.05, arousal: 0.08, dominance:-0.05 },
  mirror_delay:         { valence:-0.08, arousal: 0.12, dominance:-0.08 },
  unknown_door:         { valence: 0.05, arousal: 0.10, dominance: 0.03 },
  upstairs_nobody:      { valence:-0.08, arousal: 0.10, dominance:-0.05 },

  // ═══ 冒充/找你 — 失控/被针对 ═══
  name_poacher:         { valence:-0.08, arousal: 0.10, dominance:-0.08 },
  stranger_knows_name:  { valence:-0.10, arousal: 0.12, dominance:-0.10 },
  mistaken_for_another: { valence:-0.03, arousal: 0.08, dominance:-0.05 },
  ex_appears:           { valence:-0.08, arousal: 0.12, dominance:-0.05 },

  // ═══ 被迫参与/被选中 — 被卷入 ═══
  thing_thrown:         { valence: 0.00, arousal: 0.12, dominance:-0.05 },
  dragged_onstage:      { valence:-0.05, arousal: 0.12, dominance:-0.10 },
  kid_package:          { valence: 0.03, arousal: 0.10, dominance:-0.03 },
  stranger_game:        { valence: 0.05, arousal: 0.08, dominance: 0.00 },
  unsigned_challenge:   { valence: 0.03, arousal: 0.12, dominance: 0.02 },

  // ═══ 过于精确的巧合 — 敬畏/微不安 ═══
  dream_came_true:      { valence: 0.00, arousal: 0.10, dominance:-0.05 },
  phantom_photo:        { valence:-0.05, arousal: 0.10, dominance:-0.05 },
  thought_stolen:       { valence:-0.05, arousal: 0.12, dominance:-0.08 },
  three_mentions:       { valence: 0.00, arousal: 0.08, dominance:-0.03 },
  perfect_stranger_repeat:{ valence: 0.03, arousal: 0.10, dominance: 0.00 },

  // ═══ 身体/感官异常 — 身体比理智诚实 ═══
  phantom_smell:        { valence: 0.00, arousal: 0.05, dominance:-0.03 },
  mysterious_mark:      { valence:-0.05, arousal: 0.08, dominance:-0.05 },
  deja_vu_crash:        { valence:-0.05, arousal: 0.15, dominance:-0.10 },
  eavesdrop_impossible: { valence:-0.08, arousal: 0.10, dominance:-0.05 },

  // ═══ 社交微爆炸 — 高压/即时应对 ═══
  elevator_stranger:    { valence: 0.00, arousal: 0.10, dominance:-0.05 },
  rogue_device:         { valence:-0.10, arousal: 0.15, dominance:-0.10 },
  impossible_question:  { valence:-0.10, arousal: 0.12, dominance:-0.08 },
  side_eye_secret:      { valence:-0.08, arousal: 0.10, dominance:-0.05 },
  wrong_offer:          { valence: 0.05, arousal: 0.08, dominance: 0.02 },

  // ═══ 时空崩坏 — 敬畏/迷茫 ═══
  vending_mystery:      { valence: 0.05, arousal: 0.08, dominance: 0.00 },
  shop_switch:          { valence:-0.03, arousal: 0.10, dominance:-0.08 },
  clock_divergence:     { valence:-0.05, arousal: 0.08, dominance:-0.08 },
  number_pattern:       { valence: 0.00, arousal: 0.08, dominance:-0.03 },
  liminal_hour:         { valence: 0.02, arousal:-0.03, dominance: 0.03 },

  // ═══ 被迫扮演/越界 — 兴奋与恐惧并存 ═══
  fake_identity_trap:   { valence: 0.05, arousal: 0.10, dominance: 0.03 },
  caught_in_the_act:    { valence:-0.12, arousal: 0.15, dominance:-0.10 },
  overheard_about_self: { valence:-0.08, arousal: 0.10, dominance:-0.05 },
  line_crossed:         { valence: 0.05, arousal: 0.08, dominance: 0.05 },
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
  } else if (options.customPrompt) {
    // 用户自定义事件动机：跳过随机选类型，使用自定义提示
    eventType = {
      key: 'custom',
      name: '自定义事件',
      durationMin: 5,
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

  const weekDay = ['周日','周一','周二','周三','周四','周五','周六'][now.getDay()];
  const timeTag = `[当前时间 ${weekDay} ${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}]`;

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

  const directorSystem = `${jailbreakPrompt}
${worldIntegrationBlock}
你正在生成一段紧密第三人称叙事（close third-person narration）。你写出的文字会被直接展示给读者——读者看到的是关于「${displayName}」的生动叙述。

铁律——违反以下任何一条即视为失败：
- 指代角色只用「她」「他」「ta」「${displayName}」，绝对、绝对不要使用「你」字
- 叙事中不存在一个被称呼的"你"——这不是第二人称游戏文本，这是第三人称小说叙事
- 使用自由间接引语（free indirect discourse）：第三人称代词，但浸透角色的即时感受

正确示例：
"${displayName}的手指停在发送键上方。屏幕光映在瞳孔里，喉结滚动了一下。如果发出去——ta很清楚——有些东西就真的回不去了。"

错误示例（严格禁止）：
"你的手指停在发送键上方。你犹豫了。"
→ 使用"你"就是失败。永远不要出现"你"。

叙事原则：
- 从具体的感官细节开始——声音、画面、身体感受
- 展现身体反应而非命名情绪："手心渗出细密的汗"而非"ta感到紧张"
- 结尾留下必须立刻面对的张力——不是在写结局，是在打开一个需要做出选择的瞬间`;

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

  // 解析 image_prompt 规则的 {"prompt":"..."} JSON，提取其中的 prompt 指令文本
  const imagePromptInstruction = parseImagePromptRule(imageRulesText)
    || '≥8个外观锚点，角色名用character(series)格式';

  const formatPrompt = `请严格按照以下 JSON 格式输出，不要任何解释或额外文字：

{"title":"事件标题（8字以内，必须自带悬念钩子。如'有人替你订了票''天花板上的脚步''脑中刚想的话被说了出来'）","description":"场景叙述（紧密第三人称，80-150字。从一个具体的感官细节切入——声音/画面/身体感受——然后展开角色的即时反应。结尾必须留下一个需要立刻面对的局面。铁律：不使用'你'字，始终用ta/她/他）","prompt":"画面描述（英文。${imagePromptInstruction}）${multiPersonImageNote}","choiceA":"选项A（具体的行动路径，如'推门进去问清楚'。8-15字）","choiceB":"选项B（与A形成真正的行动对比——介入vs抽身/直接vs迂回/现在vs稍后。8-15字）"}

选项设计原则：
- A和B必须是性质完全不同的两条行动路径——读者应该能立刻感受到选择A和选择B通往不同的情绪走向
- 避免两个"本质上差不多"的选项
- 根据场景选择最合适的对比维度：做vs不做、直接vs迂回、自己vs求助、现在vs等、诚实vs保留、介入vs抽身`;

  // [3] 创作任务
  const multiPersonNote = multiPerson
    ? `\n**多人事件**：${multiPerson.relDesc}。事件中应包含${multiPerson.otherName}作为互动对象，描述ta们之间的互动方式、肢体距离和氛围要贴合两人的真实关系。`
    : '';

  const worldPenetrationLine = worldSetting
    ? '- **世界观穿透**：这个事件发生在上述世界观中，不是发生在真空或现实世界中。所有感官细节（街头景象、路人行为、空气气味、社交礼仪）和角色反应（身体本能、社交判断、情感触发点）必须忠实地在世界观规则下展开。事件方向只是一个叙事钩子——它的具体呈现方式必须被世界观重新塑造。\n'
    : '';

  const directorPrompt = `事件方向：**${eventType.name}**——${eventType.desc}
${contextBlock}
${timeTag}${multiPersonNote}

请以紧密第三人称创作这个奇遇时刻的开场。要求：
${worldPenetrationLine}- 从一个感官细节开始——一个声音、一个画面、一个身体感受——而不是背景介绍
- 场景长度 80-150 字，结尾留下让角色必须立刻面对的局面
- 两个选项的行动路径要有真正的差异和各自的代价——读者选A和选B应该通往完全不同的情绪走向`;

  const msgs = [
    { role: 'system', content: directorSystem },
    { role: 'system', content: personaMsg },
    { role: 'system', content: formatPrompt },
    { role: 'user', content: directorPrompt },
  ];

  let eventData;
  let rawResult = '';
  try {
    rawResult = await chatSync(msgs, { temperature: 0.82, max_tokens: 1024, label: '奇遇生成' });
    const jsonStr = extractFirstJson(rawResult);
    if (!jsonStr) throw new Error('No JSON found in LLM response');
    eventData = JSON.parse(repairJson(jsonStr));
    // field 兼容：imagePrompt / prompt 两种写法都接受
    const imagePromptText = eventData.prompt || eventData.imagePrompt;
    if (!eventData.title || !eventData.description || !eventData.choiceA || !eventData.choiceB) {
      throw new Error('Incomplete event data from LLM');
    }
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
      artist: config.comfyui.momentsArtist,
      width: config.comfyui.momentsWidth,
      height: config.comfyui.momentsHeight,
    });
    if (genResult.success && genResult.images.length > 0) {
      await fsp.mkdir(imagesDir, { recursive: true });
      const img = genResult.images[0];
      const filename = `event_${Date.now()}_${img.filename || 'comfy.png'}`;
      const base64Data = img.base64.replace(/^data:image\/\w+;base64,/, '');
      await fsp.writeFile(path.join(imagesDir, filename), Buffer.from(base64Data, 'base64'));
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
    config.comfyui.momentsArtist,
    `${config.comfyui.momentsWidth}x${config.comfyui.momentsHeight}`,
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
你正在为「${displayName2}」的奇遇故事生成下一幕——一段紧密第三人称叙事。

铁律（违反即失败）：
- 指代角色只用「她」「他」「ta」「${displayName2}」，绝对不要使用「你」
- 叙事中不存在被称呼的"你"——这是第三人称小说叙事，不是第二人称游戏文本
- 读者应该始终能感受到${displayName2}的即时情绪变化——通过身体反应来展现，而非通过情绪命名

正确：${displayName2}的手指不自觉蜷进掌心。喉咙发干。
错误：你感到紧张。你的手心出汗。`;

  let personaMsg2 = `以下是角色「${displayName2}」的人格设定，供你了解角色的外貌、性格和行为模式：

${personaText2}`;

  if (multiPerson2) {
    personaMsg2 += `\n\n---\n以下是${multiPerson2.otherName}的人格设定（${multiPerson2.relDesc}），供事件涉及多人互动时参考：

${multiPerson2.otherPersona}`;
  }

  const branchImagePromptInstruction = parseImagePromptRule(imageRulesText)
    || '描述场景、角色外观、动作、氛围';

  const multiPersonImageNote2 = multiPerson2
    ? `**多人画面**：prompt 中必须包含${displayName2}和${multiPerson2.otherName}两个人。描述清楚各自的外观、位置、互动动作。用句号分隔两人描述。`
    : '';

  const formatPrompt2 = `请严格按照以下 JSON 格式输出，不要任何解释或额外文字：

{"description":"选择后的场景叙述（紧密第三人称，80-150字。承接上一个选择的结果，从一个具体的感官细节开始，展现角色此刻的即时感受和新出现的局面）","prompt":"画面描述（英文。${branchImagePromptInstruction}）${multiPersonImageNote2}","choiceA":"新选项A（具体行动，与B形成真正的对比。8-15字）","choiceB":"新选项B（具体行动，与A性质不同。8-15字）"}

选项设计原则与之前相同：A和B必须形成真正的行动对比，不要给本质上差不多的选项。`;

  // 只有多人模式才注入关系信息（和初始事件生成一致）
  const multiNote2 = multiPerson2
    ? `\n**多人事件**：${multiPerson2.relDesc}。事件中应包含${multiPerson2.otherName}作为主要互动对象，描述ta们之间的互动方式、肢体距离和氛围要贴合两人的真实关系。${relationships.map(r => `${displayName2}是${r.display_name}的${r.relationship_text}`).join('；')}`
    : '';

  const worldPenetrationLine2 = worldSetting2
    ? '- **世界观穿透**：这个事件发生在上述世界观中，不是发生在真空或现实世界中。所有感官细节（街头景象、路人行为、空气气味、社交礼仪）和角色反应（身体本能、社交判断、情感触发点）必须忠实地在世界观规则下展开。事件方向只是一个叙事钩子——它的具体呈现方式必须被世界观重新塑造。\n'
    : '';

  const directorPrompt2 = `事件标题：${event.title}
${historyText}${multiNote2}
请以紧密第三人称创作选择之后发生的下一个场景。要求：
${worldPenetrationLine2}- 承接上一个选择的结果，从一个具体的感官细节开始
- 场景长度 80-150 字，展现角色此刻的即时感受和新出现的局面
- 给出新的A和B选项（不要和之前的选项重复，保持故事持续发展）
- 新选项继续形成行动路径的对比——让玩家每一步都面临真正的岔路口`;

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
    rawBranchResult = await chatSync(msgs, { temperature: 0.82, max_tokens: 1024, label: '奇遇分支' });
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
      artist: config.comfyui.momentsArtist,
      width: config.comfyui.momentsWidth,
      height: config.comfyui.momentsHeight,
    });
    if (genResult.success && genResult.images.length > 0) {
      await fsp.mkdir(imagesDir, { recursive: true });
      const img = genResult.images[0];
      const filename = `event_${Date.now()}_${img.filename || 'comfy.png'}`;
      const base64Data = img.base64.replace(/^data:image\/\w+;base64,/, '');
      await fsp.writeFile(path.join(imagesDir, filename), Buffer.from(base64Data, 'base64'));
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
    ? `为以下奇遇事件生成结局叙述和记忆摘要。
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
    const result = await chatSync(msgs, { temperature: 0.7, max_tokens: 1024, label: '奇遇结局' });
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
    const summaryText = `【奇遇】${event.title}\n${conclusionData.summary}`;

    // 完整文本：全部分支（用于 ChromaDB 向量检索，使事件细节也可被语义召回）
    const parsedHistory = JSON.parse(event.choice_history || '[]');
    let fullVectorText = `【奇遇】${event.title}\n开始：${event.description}`;
    for (const h of parsedHistory) {
      if (h.branch === 0) continue;
      fullVectorText += `\n选择了：「${h.choice_label}」→ ${h.summary}`;
    }
    fullVectorText += `\n结局：${conclusionData.summary}`;

    if (!event.engaged) {
      db.prepare(`
        DELETE FROM memory_fragments
        WHERE conversation_id = ? AND fragment_type = 'fact' AND content LIKE '【未互动的奇遇】%'
      `).run(conversationId);
      console.log(`[eventGen] Replaced old unengaged event memory for ${character.display_name}`);
    }

    const contentWithTag = event.engaged
      ? `【奇遇·已完成】${summaryText}`
      : `【未互动的奇遇】${summaryText}`;

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

/**
 * 解析 image_prompt 规则的 {"prompt":"..."} JSON 格式
 * 成功则返回 prompt 字段内容，失败返回 null
 *
 * rule_content 可能包含：(1) 真实换行符（JSON 不允许）(2) 非法转义序列如 \(
 * 两步清洗后再解析
 */
function parseImagePromptRule(ruleContent) {
  if (!ruleContent) return null;
  try {
    // Step 1: 真实控制字符 → JSON 合法转义
    let sanitized = ruleContent
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t');
    // Step 2: 非法转义序列（如 \( → (）
    sanitized = repairJson(sanitized);
    // Step 3: 解析
    const parsed = JSON.parse(sanitized);
    return parsed.prompt || null;
  } catch {
    return null;
  }
}

function toISO(dt) {
  if (!dt) return dt;
  return dt.replace(' ', 'T') + '.000Z';
}
