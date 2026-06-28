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
  // ═══ 街头日常（40-120min）═══
  // 城市中的偶然发现与公共空间的即兴事件，节奏舒缓但有意外趣味
  { key: 'urban_wander', name: '城市漫游', durationMin: 90, urgency: 1,
    desc: '角色离开了熟悉的日常路线——可能是故意绕路、追某个东西、或纯粹走神——来到了一个平时不会涉足的城市角落。请自由想象这个地方：一条陌生的巷子、一个没去过的街区、一片被遗忘的公共空间。角色在那里注意到了什么让ta停下脚步的东西。氛围：探索与发现，节奏舒缓但有微小惊喜。' },
  { key: 'stranger_kindness', name: '陌生人的善意', durationMin: 60, urgency: 1,
    desc: '一个陌生人与角色产生了短暂但温暖的互动——一次意外的帮助、一句让人愣住的好话、或一份不求回报的小小善意。请自由想象这个陌生人是谁、ta做了什么、以及角色如何回应。氛围：人与人之间偶然的暖意，克制真实不煽情，互动结束各走各路。' },
  { key: 'night_owling', name: '深夜时分', durationMin: 90, urgency: 1,
    desc: '深夜，角色还在外面（或醒着）。城市的这一面与白天完全不同——更安静、更诚实、或更荒诞。请自由想象角色深夜在外的原因（失眠/有事/纯粹不想回家）以及ta在这段时间里遇到的事。氛围：深夜的独特质感，安静/微醺/或温柔的荒诞，略带孤独但不悲伤。' },
  { key: 'animal_encounter', name: '动物奇缘', durationMin: 60, urgency: 1,
    desc: '一只不属于角色的动物闯入了ta的生活半径——流浪猫狗、别人走丢的宠物、公园里的野鸟、或城市里偶然出现的野生动物。这只动物的行为引起了角色的好奇，角色决定花一点时间回应它。请自由想象动物的种类、行为、以及这场互动的走向。氛围：人与动物的短暂连接，温暖或有趣，动物推动叙事。' },
  { key: 'found_treasure', name: '意外淘宝', durationMin: 90, urgency: 1,
    desc: '角色在旧货摊/二手店/路边/阁楼/某个不起眼的角落发现了一件让ta在意的东西——不一定是值钱的，但一定带着"别人的故事"的痕迹。请自由想象这件物品是什么、它引发了角色怎样的好奇或行动。氛围：物品作为微型叙事的入口，怀旧或好奇驱使的小小探索。' },
  { key: 'wrong_place', name: '误入之境', durationMin: 40, urgency: 2,
    desc: '角色因为某个原因（走错路/追东西/被引导/纯粹好奇）进入了一个本不该在此时此刻出现的地方。这个空间正在发生某件事，角色的出现让情况变得微妙。请自由想象这个空间是什么、里面正在发生什么、以及角色如何应对这个尴尬/有趣的局面。氛围：轻微越界的紧张与趣味，短暂刺激但不危险。' },
  { key: 'public_scene', name: '街头现场', durationMin: 60, urgency: 1,
    desc: '角色在公共场合遇到了一场正在进行中的即兴事件——街头表演、快闪、小型比赛、围观骚动、或某种公开的集体行为。角色不知怎的从旁观者变成了参与者。请自由想象这场公共事件的性质以及角色被卷入的方式。氛围：公共空间的集体能量，轻松或热烈，被氛围带动。' },
  { key: 'shop_encounter', name: '店铺奇遇', durationMin: 60, urgency: 1,
    desc: '角色走进了一家店——可能是被橱窗吸引、被招牌逗乐、被香味牵引、或只是因为下雨进来躲一躲。店里的人或物让这次消费变成了一场微型冒险。请自由想象这家店的类型（书店/古董店/奇怪的专卖店/街角便利店）以及店里正在发生的事。氛围：日常消费的意外展开，轻松有趣或荒诞。' },

  // ═══ 社交碰撞（20-60min）═══
  // 人与人之间的即兴交锋与微妙互动，高密度社交张力
  { key: 'eye_contact', name: '眼神交汇', durationMin: 20, urgency: 2,
    desc: '角色与一个陌生人/半熟人对视——不是普通的扫过，而是有内容的眼神接触。对方的眼睛里有什么让角色在意：挑衅、好奇、认出、或某种说不清的意味。请自由想象对方是谁、那个眼神的含义、以及角色决定如何回应。氛围：非语言的社交张力，微妙的心理博弈，短暂但高密度。' },
  { key: 'challenged', name: '被挑战了', durationMin: 30, urgency: 2,
    desc: '有人当面向角色发起了某种挑战——不一定是恶意的，可能是即兴比赛、智力较劲、或某种角色擅长/不擅长的事。周围的人开始起哄。请自由想象挑战的内容、挑战者的身份和动机、以及角色如何应对（迎战/机智化解/意外翻车/优雅脱身）。氛围：社交压力下的即时决策，紧张但不危险，好玩。' },
  { key: 'silver_tongue', name: '被说服了', durationMin: 30, urgency: 2,
    desc: '一个口才出众的人正在试图说服角色接受某件事——买一件东西、参加一个活动、相信一个观点。角色的理性在抵抗，但对方的论点出人意料地有道理，角色发现自己居然在认真考虑。请自由想象对方在推销/论证什么、以及角色从抗拒到动摇的心理过程。氛围：理性与冲动的拉锯，有趣而非诈骗。' },
  { key: 'overheard', name: '不小心听到了', durationMin: 40, urgency: 1,
    desc: '角色无意间听到了一段让ta在意的对话——关于某个人、某件事、或某个信息。这段信息与角色的生活有某种关联（不一定是关于角色本人的）。请自由想象角色听到了什么、为什么在意、以及ta决定怎么做（装作没听到/继续听/采取行动）。氛围：信息不对等引发的道德微型困境，好奇心与边界感的冲突。' },
  { key: 'someone_needs_help', name: '有人需要帮助', durationMin: 30, urgency: 2,
    desc: '角色注意到旁边有人处于需要帮助的状态——情绪崩溃、迷路了、身体不适、或只是看起来很无助。周围其他人都在回避目光，而角色恰好站在一个可以行动的位置。请自由想象这个人需要什么样的帮助、以及角色决定介入后发生了什么。氛围：助人动机与社交惰性的微型博弈，走向温暖或意外的展开。' },
  { key: 'unexpected_praise', name: '突如其来的夸奖', durationMin: 20, urgency: 2,
    desc: '一个陌生人/半熟人对角色给出了认真而意外的正面评价——真诚到让角色愣住的程度，夸的可能是角色自己都没意识到的优点。请自由想象对方夸奖了什么、在什么情境下、以及这句评价在角色心里留下的回响。氛围：被看见的微妙感受，温暖或微妙的尴尬，不过度。' },

  // ═══ 冒险意志（60-120min）═══
  // 探索未知空间与追寻线索，好奇心驱动，过程比结果重要
  { key: 'hidden_space', name: '隐藏的空间', durationMin: 120, urgency: 1,
    desc: '角色发现了一个隐藏/被遗忘/不该存在的空间——暗门、废弃楼层、建筑夹层、地下通道、或城市中被所有人忽略的角落。这个空间有一种特别的氛围，让角色感到好奇多于恐惧。请自由想象这个空间在哪里、怎么被发现的、以及里面有什么。氛围：城市探索与空间叙事，场所本身是主角，神秘但不恐怖。' },
  { key: 'cryptic_clue', name: '神秘线索', durationMin: 90, urgency: 1,
    desc: '角色收到或发现了一个指向某处的加密信息/线索——纸条、短信、涂鸦、地图碎片、或更隐晦的提示。它暗示了某个时间和地点，但没有说会发生什么。请自由想象线索的形式、它指向的目的地、以及角色到那里后的发现（惊喜/虚惊/新的谜题）。氛围：信息驱动的微型探索，解谜感，结果开放。' },
  { key: 'childhood_echo', name: '童年的回响', durationMin: 90, urgency: 1,
    desc: '角色偶然遇到了某种与童年/过去强烈关联的触发物——一个被遗忘的地方、一件旧物、一种气味、一首歌。它让角色陷入了某种情绪，并产生了顺着这个线索做点什么的冲动。请自由想象触发物是什么、它连接着怎样的回忆、以及角色因此做了什么。氛围：过去与现在的温柔碰撞，怀旧驱动行动，情感真挚不煽情。' },
  { key: 'unexpected_guide', name: '意外的向导', durationMin: 90, urgency: 1,
    desc: '某个人/物/迹象似乎在引导角色去某个地方——一个小孩、一位老人、一只动物、或者一连串"巧合"的路标。角色不确定这是真正的指引还是过度解读，但好奇心占了上风。请自由想象向导的形式（人或非人）、目的地在哪里、以及跟随的过程中的体验。氛围："被引导"的不确定感，过程比结果重要。' },
  { key: 'strange_invitation', name: '奇怪的请柬', durationMin: 90, urgency: 1,
    desc: '角色收到了一张奇怪的邀请——不是常规社交邀约，而是带有神秘/荒诞/或异常正式感的请柬。地址存在但角色从没去过，时间就是今天。请自由想象请柬的来源、目的地的样子、以及角色决定赴约后的发现。氛围：被邀请进入未知领域，社交冒险，可以是神秘/荒诞/或意外的温馨。' },
  { key: 'curious_machine', name: '奇怪的机器', durationMin: 60, urgency: 1,
    desc: '角色遇到了一台不寻常的机器/装置——自动贩卖机、扭蛋机、老式街机、或某种叫不出名字的设备。它的操作方式很奇怪，似乎藏着什么秘密功能。请自由想象这台机器的外观和用途、角色摆弄它的过程、以及最终触发了什么。氛围：人机交互的趣味瞬间，轻松或略带神秘，机器的未知功能是探索入口。' },
  { key: 'high_place', name: '高处', durationMin: 60, urgency: 1,
    desc: '角色来到了一个高处——天台、山顶、屋顶、或某个能俯瞰城市/风景的位置。站得高让角色的想法变得不一样了，ta开始注意到平时不会注意的东西，或产生平时不会有的想法。请自由想象这个高处的位置、角色在那里的所见所感、以及是否有什么意外的发现或决定。氛围：物理高度带来心理视角的转变，独处与反思。' },

  // ═══ 危机时刻（20-30min）═══
  // 高张力即时应变，紧张但不暴力，重点是应对而非危险本身
  { key: 'chase', name: '追逐', durationMin: 20, urgency: 2,
    desc: '角色突然需要追某人/某物，或者被人追——不是生死时速，而是城市中的即兴奔跑。请自由想象追逐的原因（追回被偷/被抢的东西、追一个认识的人、被误会导致被追）、追逐的路线、以及结局。氛围：城市空间中的动态追逐，身体与环境的互动，紧张但不暴力。' },
  { key: 'caught_in_conflict', name: '卷入冲突', durationMin: 20, urgency: 2,
    desc: '角色不小心被卷入了正在发生的冲突——争吵、打架、对峙。不是角色挑起的，但ta现在站在了事件的半径内。请自由想象冲突的性质、各方立场、以及角色在其中的选择（介入调停/帮某一方/趁乱脱身/做点别的）。氛围：第三方视角的冲突应对，道德抉择与实用主义的碰撞。' },
  { key: 'gut_feeling', name: '不对劲', durationMin: 20, urgency: 2,
    desc: '角色的直觉拉响了警报——有东西不对，但理性说一切正常。可能是有人在跟踪、某个场景过于安静、或一个看起来正常但后颈汗毛竖起来的状况。请自由想象让角色不安的源头、以及最终的结果（虚惊一场/微小威胁/或发现了真正的问题）。氛围：心理悬疑，气氛营造比实际危险更重要。' },
  { key: 'stuck', name: '被困住了', durationMin: 30, urgency: 2,
    desc: '角色被困在了某个地方——电梯停了、门锁坏了、通道被封了。不是生死危机，但确实需要想办法出去。在等待或尝试脱困的过程中，角色开始注意到这个空间里平时不会关注的东西。请自由想象被困的地点和原因、以及脱困过程中的意外发现。氛围：受限空间内的微型冒险，静态中的动态思考。' },
  { key: 'crowd_chaos', name: '人群骚动', durationMin: 20, urgency: 2,
    desc: '角色所在的人群突然发生了某种集体变化——恐慌、骚动、方向的突然一致、或情绪的集体转变。角色被裹挟其中，需要在混乱中保持平衡并找到自己的出路。请自由想象骚动的原因（真实的/夸大的/误会）以及角色如何应对。氛围：集体行为中的个体应对，保持清醒与自我。' },
  { key: 'falsely_accused', name: '被冤枉', durationMin: 30, urgency: 2,
    desc: '有人认定角色做了某件ta没做的事。对方的指控听起来有几分道理（虽然完全是误会），而真正的原因/责任人藏在背后。角色需要在有限时间内为自己辩护或找出真相。请自由想象被指控的内容、真正的犯人/原因、以及角色自证的过程和结果。氛围：清白与证据的博弈，自证的过程是叙事核心。' },
  { key: 'lost_something', name: '丢了重要的东西', durationMin: 30, urgency: 2,
    desc: '角色发现丢了某样重要的东西——可能是钥匙/钱包/手机，也可能是有情感价值的非贵重物品。角色开始回溯自己的行动路线，重新走一遍今天走过的路。请自由想象丢失的物品及其重要性、回溯路线上的发现、以及最终是否找到。氛围：寻找失物的微型旅程，略带焦虑但保持希望，每一站都可能引出小事件。' },

  // ═══ 奇异现象（60-120min）═══
  // 日常中的微小异常，模糊现实与感知的边界，神秘而不过度恐怖
  { key: 'time_anomaly', name: '时间感异常', durationMin: 90, urgency: 1,
    desc: '角色对时间的感知出现了异常——某个瞬间感觉重复了、时间流速不对劲、或计时工具集体出问题。不一定是真的超自然，也可以是心理性的：太疲惫、太专注、或情绪影响了对时间的感知。请自由想象时间异常的表现形式、角色如何察觉、以及这种体验带来的心理变化。氛围：时间感知被扭曲的体验，迷离或诗意。' },
  { key: 'reflection_anomaly', name: '镜中异常', durationMin: 60, urgency: 1,
    desc: '角色在镜子/玻璃/水面中看到了与预期不符的倒影——可能只是一瞬间、可能是光线造成的错觉、也可能是角色的心理投射。请自由想象角色看到了什么（不限于倒影不同步）、ta如何试图验证或解释、以及这件事在ta心里留下的印象。氛围：自我认知与视觉错觉的交界，镜像作为心理洞察的入口。' },
  { key: 'glowing_object', name: '发光体', durationMin: 90, urgency: 1,
    desc: '角色发现了一个不该发光的东西在微弱地发光——可能是一块石头、一片叶子、一个旧设备、或某种无法名状的物体。光很微弱但确实存在。请自由想象发光体是什么、它为什么发光（自然现象/科技残余/未知）、以及角色决定拿它怎么办。氛围：日常中的微小异常，神秘而温柔，发光体是好奇心的起点而非威胁。' },
  { key: 'prediction', name: '被预言了', durationMin: 60, urgency: 1,
    desc: '某人（占卜师/奇怪的陌生人/或者一个随口说话的人）对角色的近期未来做出了一个具体预测——不是关于遥远命运，就是接下来几小时内的事。预测的第一部分已经开始发生。请自由想象预测的内容、预言者的身份和可信度、以及角色面对应验时的反应（相信/质疑/试图改变结果）。氛围：预言作为行动的催化剂，自我实现预言与自由意志的博弈。' },
  { key: 'synchronicity', name: '巧合的编织', durationMin: 90, urgency: 1,
    desc: '角色经历了一连串"太巧了"的事件——不同来源的信息指向同一个方向、刚想到什么就立刻遇到什么、或者随机事件形成了某种叙事连贯性。请自由想象这些巧合的具体内容以及它们暗示的"方向"（可能根本没有真正的方向，但角色忍不住去联想）。氛围：世界中隐藏的联系感，诗意的而非神秘学的。' },
  { key: 'object_behavior', name: '物品的意志', durationMin: 60, urgency: 1,
    desc: '角色身边的某件私人物品出现了无法解释的行为——旧玩具发出了声音、书翻到了恰好回答角色疑问的那一页、许久不用的东西自己启动了。每个单独事件都可以用理性解释，但它们先后发生的时间点太巧了。请自由想象是哪件物品、发生了什么、以及角色如何解读这一连串"巧合"。氛围：日常物品的神秘性，轻松诡谲，不过度。' },
  { key: 'atmosphere_shift', name: '空气变了', durationMin: 60, urgency: 1,
    desc: '角色进入某个空间后，环境氛围发生了明显变化——光线的质感变了、温度微妙的差异、声音的远近不同了、或者某种无法描述的"氛围"改变了。在这种氛围中，角色的情绪和想法被微妙地影响。请自由想象空间的变化、它对角色心理的渗透、以及在这个特殊氛围中发生的事。氛围：环境对心理的渗透，空间作为情绪催化剂。' },

  // ═══ 生活泥沼（30-90min）═══
  // 日常生活中的连锁翻车与荒诞喜剧，轻松解压，共鸣感强
  { key: 'domestic_chaos', name: '居家翻车', durationMin: 90, urgency: 1,
    desc: '角色在家里做了一件"很简单"的事——修东西/做饭/组装家具/大扫除——然后局面以指数级恶化。每一步补救都制造了新的问题，而某个重要的人（客人/室友/房东）可能正在逼近。请自由想象翻车的起因、连锁反应的过程、以及最终如何收场（或干脆没收场）。氛围：越努力越糟糕的生活喜剧，荒诞解压。' },
  { key: 'cleaning_time_capsule', name: '打扫出的过去', durationMin: 90, urgency: 1,
    desc: '角色在彻底清扫/整理时翻出了一件被遗忘的旧物——它触发了强烈的回忆或情绪，让角色停下了手中的活。请自由想象这件旧物是什么、它关联着怎样的记忆、以及角色面对这份记忆时的反应（可能会因此去做某件事）。氛围：旧物作为记忆的触发器，物理整理导致了心理整理，怀旧/释然/或重新面对。' },
  { key: 'nature_fights_back', name: '自然造反', durationMin: 60, urgency: 1,
    desc: '角色周围的某种自然元素出现了不正常的行为——养的植物疯长/枯萎/变色、家里出现了不该出现的昆虫/动物、或者天气精准地只在角色出门的那一刻变坏。请自由想象"造反"的具体表现、角色试图"镇压"或理解的过程、以及结果。氛围：人与自然的小型对抗，绿色幽默，轻松有趣。' },
  { key: 'errand_curse', name: '出门不顺', durationMin: 60, urgency: 1,
    desc: '角色只是出门办一件小事——取快递/买东西/缴费——然后被一连串计划外的事件精准狙击。每个问题单独看都不值一提，合在一起却让人怀疑今天不宜出门。请自由想象这些连环小倒霉的具体内容以及角色从烦躁到哭笑不得的心态变化。氛围：日常琐事的连锁打击，共鸣感强，最终可以一笑而过。' },
  { key: 'cohabitant_mystery', name: '同居生物的谜之行为', durationMin: 60, urgency: 1,
    desc: '与角色同住的生物（宠物/室友/家人）今天表现出了让角色完全无法理解的行为模式。它们在做什么？为什么要这样做？角色的好奇心从好笑变成了认真调查。请自由想象同居者是谁/是什么、它们的谜之行为、以及角色调查后发现的真相（可能非常无聊但很可爱）。氛围：观察与推理的趣味，轻松搞笑或温暖。' },
  { key: 'unexpected_guest', name: '不速之客', durationMin: 60, urgency: 1,
    desc: '有人突然出现在角色家门口——没有预约、临时起意、路过、或有某种急事。角色当时的状态（穿着/家里的状况/正在做的事）让这个时机非常微妙，角色需要在开门前快速调整。请自由想象来客是谁、ta的来意、以及角色从慌乱到应对的过程。氛围：私人空间被意外闯入的社交喜剧，真实而好笑。' },
  { key: 'power_outage', name: '停电了', durationMin: 60, urgency: 1,
    desc: '突然停电了——跳闸/线路维修/原因不明。角色被困在黑暗中，手边只有手机（电量不确定）和几根蜡烛。请自由想象角色在黑暗中做了什么、想了什么、或者在烛光中注意到了平时被忽略的东西。氛围：被强制抽离现代便利后的另类体验，安静/有趣/或小小觉悟。' },
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
  // ═══ 街头日常 — 舒缓/微小惊喜 ═══
  urban_wander:        { valence: 0.05, arousal: 0.02, dominance: 0.00 },
  stranger_kindness:   { valence: 0.08, arousal: 0.00, dominance: 0.00 },
  night_owling:        { valence: 0.00, arousal:-0.05, dominance: 0.00 },
  animal_encounter:    { valence: 0.08, arousal: 0.03, dominance: 0.00 },
  found_treasure:      { valence: 0.05, arousal: 0.05, dominance: 0.02 },
  wrong_place:         { valence:-0.03, arousal: 0.08, dominance:-0.05 },
  public_scene:        { valence: 0.03, arousal: 0.05, dominance:-0.02 },
  shop_encounter:      { valence: 0.05, arousal: 0.00, dominance: 0.00 },

  // ═══ 社交碰撞 — 警觉/微紧张 ═══
  eye_contact:         { valence: 0.00, arousal: 0.08, dominance: 0.00 },
  challenged:          { valence:-0.03, arousal: 0.12, dominance:-0.05 },
  silver_tongue:       { valence: 0.00, arousal: 0.05, dominance:-0.05 },
  overheard:           { valence:-0.05, arousal: 0.08, dominance: 0.00 },
  someone_needs_help:  { valence: 0.02, arousal: 0.05, dominance: 0.05 },
  unexpected_praise:   { valence: 0.10, arousal: 0.03, dominance: 0.02 },

  // ═══ 冒险意志 — 好奇/兴奋 ═══
  hidden_space:        { valence: 0.05, arousal: 0.10, dominance: 0.05 },
  cryptic_clue:        { valence: 0.03, arousal: 0.12, dominance: 0.03 },
  childhood_echo:      { valence: 0.00, arousal: 0.00, dominance:-0.05 },
  unexpected_guide:    { valence: 0.03, arousal: 0.08, dominance:-0.02 },
  strange_invitation:  { valence: 0.02, arousal: 0.08, dominance: 0.00 },
  curious_machine:     { valence: 0.08, arousal: 0.10, dominance: 0.05 },
  high_place:          { valence: 0.02, arousal:-0.03, dominance: 0.05 },

  // ═══ 危机时刻 — 不安/警觉 ═══
  chase:               { valence:-0.10, arousal: 0.15, dominance:-0.10 },
  caught_in_conflict:  { valence:-0.10, arousal: 0.12, dominance:-0.08 },
  gut_feeling:         { valence:-0.08, arousal: 0.10, dominance: 0.00 },
  stuck:               { valence:-0.05, arousal: 0.05, dominance:-0.10 },
  crowd_chaos:         { valence:-0.08, arousal: 0.12, dominance:-0.10 },
  falsely_accused:     { valence:-0.12, arousal: 0.10, dominance:-0.08 },
  lost_something:      { valence:-0.08, arousal: 0.08, dominance:-0.05 },

  // ═══ 奇异现象 — 不安/好奇交织 ═══
  time_anomaly:        { valence:-0.05, arousal: 0.08, dominance:-0.08 },
  reflection_anomaly:  { valence:-0.08, arousal: 0.10, dominance:-0.05 },
  glowing_object:      { valence: 0.03, arousal: 0.10, dominance: 0.00 },
  prediction:          { valence: 0.00, arousal: 0.08, dominance:-0.05 },
  synchronicity:       { valence: 0.05, arousal: 0.08, dominance: 0.00 },
  object_behavior:     { valence:-0.03, arousal: 0.10, dominance:-0.05 },
  atmosphere_shift:    { valence:-0.05, arousal: 0.05, dominance:-0.08 },

  // ═══ 生活泥沼 — 微烦躁/荒诞喜剧 ═══
  domestic_chaos:      { valence:-0.05, arousal: 0.08, dominance:-0.05 },
  cleaning_time_capsule:{ valence: 0.00, arousal: 0.00, dominance: 0.00 },
  nature_fights_back:  { valence:-0.03, arousal: 0.05, dominance:-0.05 },
  errand_curse:        { valence:-0.08, arousal: 0.05, dominance:-0.05 },
  cohabitant_mystery:  { valence: 0.02, arousal: 0.05, dominance: 0.00 },
  unexpected_guest:    { valence:-0.03, arousal: 0.08, dominance:-0.03 },
  power_outage:        { valence:-0.02, arousal:-0.05, dominance:-0.03 },
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
  const jailbreakPrompt = getSystemRulesWithWorld({ roleplay: false });
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

  // [0] 分镜导演声明 + jailbreak（最先确立创作身份）
  const directorSystem = `${jailbreakPrompt}

你是一个分镜导演，正在为角色「${displayName}」构思一个即将发生的"奇遇事件"——一段实时展开的故事片段。
这不是角色扮演，而是编剧创作。你需要根据角色人格信息，以第三人称视角想象一个电影画面：镜头跟随着${displayName}，记录ta正在经历的事。`;

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

{"title":"事件标题（10字以内）","description":"场景叙述（第三人称，80-150字）","prompt":"画面描述（英文。${imagePromptInstruction}）${multiPersonImageNote}","choiceA":"选项A文字（简短有力，8-20字）","choiceB":"选项B文字（简短有力，8-20字）"}`;

  // [3] 创作任务
  const multiPersonNote = multiPerson
    ? `\n**多人事件**：${multiPerson.relDesc}。事件中应包含${multiPerson.otherName}作为互动对象，描述ta们之间的互动方式、肢体距离和氛围要贴合两人的真实关系。`
    : '';

  const directorPrompt = `事件类型方向：**${eventType.name}**——${eventType.desc}
${contextBlock}
${timeTag}${multiPersonNote}

请以第三人称创作这个事件的开场场景。要求：
- 场景长度 80-150 字，像一个电影分镜的开场，有画面感
- 给出两个明确的行动选项（A和B）
- 选项的好坏/后果可以不同，但都不要明显"找死"——保持合理的叙事张力`;

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
    const jsonMatch = rawResult.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in LLM response');
    eventData = JSON.parse(repairJson(jsonMatch[0]));
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

  // 0. 标记处理中，防止切页后重复提交
  db.prepare(`UPDATE character_events SET processing = 1 WHERE id = ?`).run(event.id);

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

  // 3. 构建 choice_history 文本
  const choiceHistory = JSON.parse(event.choice_history || '[]');
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
  const jailbreakPrompt = getSystemRulesWithWorld({ roleplay: false });
  const imageRules = getGlobalRule('image_prompt');
  const imageRulesText = imageRules?.rule_content || '';

  const displayName2 = character.display_name;
  const personaText2 = character.base_prompt.replace(/你/g, displayName2);

  const directorSystem2 = `${jailbreakPrompt}

你是一个分镜导演，正在为角色「${displayName2}」的奇遇事件推进叙事。
这是编剧创作而非角色扮演，请以第三人称视角继续展开故事。`;

  const personaMsg2 = `以下是角色「${displayName2}」的人格设定，供你了解角色的外貌、性格和行为模式：

${personaText2}`;

  // 解析 image_prompt 规则的 {"prompt":"..."} JSON，提取其中的 prompt 指令文本
  const branchImagePromptInstruction = parseImagePromptRule(imageRulesText)
    || '描述场景、角色外观、动作、氛围';

  const formatPrompt2 = `请严格按照以下 JSON 格式输出，不要任何解释或额外文字：

{"description":"选择后的场景叙述（第三人称，80-150字）","prompt":"画面描述（英文。${branchImagePromptInstruction}）","choiceA":"新选项A","choiceB":"新选项B"}`;

  const relBlock2 = relationships.length > 0
    ? `\n角色关系网：${relationships.map(r => `${displayName2}是${r.display_name}的${r.relationship_text}`).join('；')}\n`
    : '';

  const directorPrompt2 = `事件标题：${event.title}
${historyText}${relBlock2}
请以第三人称创作选择之后发生的下一个场景。要求：
- 场景长度 80-150 字，有画面感
- 给出新的A和B选项（不要和之前的选项重复，保持故事持续发展）`;

  const msgs = [
    { role: 'system', content: directorSystem2 },
    { role: 'system', content: personaMsg2 },
    { role: 'system', content: formatPrompt2 },
    { role: 'user', content: directorPrompt2 },
  ];

  let branchData;
  let rawBranchResult = '';
  try {
    rawBranchResult = await chatSync(msgs, { temperature: 0.82, max_tokens: 1024, label: '奇遇分支' });
    const jsonMatch = rawBranchResult.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in LLM response');
    branchData = JSON.parse(repairJson(jsonMatch[0]));
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
    conclusionData = JSON.parse(repairJson(jsonMatch[0]));
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
// ── 工具函数 ──

function toSQLite(iso) {
  if (!iso) return iso;
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
}

// 修复 LLM 输出的非法 JSON 转义（image_prompt 规则中的 \( \) 等不是合法 JSON 转义）
function repairJson(text) {
  return text.replace(/\\([^"\\\/bfnrtu])/g, '$1');
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
