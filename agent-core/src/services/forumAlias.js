/**
 * 论坛网名（网民 ID）——**分类规则与去重的唯一真源**。
 *
 * 为什么单列一个模块：
 *   会产出网名的生成点有四处（媒体帖子的作者与评论、周刊的问答与跟帖、
 *   门户板块正文的问答与跟帖），它们分散在 mediaService 的不同构造函数里。
 *   若各处内联一份"网名要多样"的说明，口径必然漂移 —— 本项目已经因为
 *   「前后端各写一份分类判定」连踩两次（路由白名单漏 print、digital 与 isDigitalOutlet 说法不一）。
 *   所以规则文本只在这里写一份，各生成点 import 后插入。
 *
 * ★ 适用边界（别套错地方）：
 *   · **用**：论坛 / 报刊评论区 / 周刊跟帖 —— 这些是**匿名广场**，网民彼此不认识，
 *     用网名才是常态（用户在媒体页看到的正是这类）。
 *   · **不用**：**朋友圈的自动评论**（momentCommentService / momentInteractionService）。
 *     朋友圈是**熟人社交**（像微信），评论者都是互加了好友的角色，用真名才对；
 *     那里也不存在"匿名网民"，硬套马甲反而会让熟人圈变得莫名其妙。
 *   · **也不用**：私聊、群聊、日程、事件 —— 角色以本人身份出面，用真名。
 *
 * 设计要点（三轴正交，不是一个平铺清单）：
 *   只给一份"风格列表"时，模型会在列表里反复挑同一类，越挑越像。
 *   拆成 取材 × 形态 × 立场 三轴并**要求交叉搭配**，组合数远大于任何单一清单：
 *     · 取材（A）决定「像这个世界的人」
 *     · 形态（B）决定「像真人随手起的 ID」
 *     · 立场（C）决定「评论内容本身有对抗」
 *   第三轴最容易被忽略 —— 名字再花、每条评论都是"路过说一句"，照样是塑料感。
 */

/**
 * 维度 A：语汇来源 —— 网民 ID 从**哪些方向**取材。
 *
 * ★★ 2026-10-07 架构修正：拆成**通用维度**（留这里）+ **世界观专属维度**（由该世界观的
 *   项目库 `lexicons` 槽位提供）。
 *   原先整张表都是某一个世界观的专属概念（愿力经济/幻造种/幻月游戏…）， // @world-agnostic-ok: 注释举例
 *   而本文件自称"分类规则与去重的唯一真源" —— 引擎级的真源里内置了一个世界观。
 *   现在：通用维度任何世界都成立；专属维度换世界观时自动跟着换。
 */
import { getActiveWorldSlots } from '../db/index.js';

export const ALIAS_SOURCES_GENERIC = [
  { id: 'official', name: '机构号', hint: '官方口吻与网民混在一起的反差', samples: ['XX小助手', '官方（温馨提示）'] },
  { id: 'plain', name: '市井日常', hint: '最普通的那种 ID，占比要最高', samples: ['楼下便利店', '通勤中', '今天也想躺平'] },
  { id: 'job', name: '职业身份', hint: '以自己在世界里的营生自称', samples: ['打工人', '值夜班的', '刚下班的'] },
  { id: 'local', name: '住址街区', hint: '以自己常待的那片地方取名', samples: ['三号楼的', '老城区常客', '河对面'] },
];

/**
 * 当前可用的取材维度 = 通用维度 + **该世界观项目库声明**的专属维度。
 * 项目库读不到时退回通用维度（换世界观/存量库都不受影响）。
 */
export function aliasSourcesNow() {
  let extra = [];
  try {
    extra = getActiveWorldSlots()?.lexicons || [];
  } catch (err) {
    // ★ 2026-10-07 教训：这里原先写的是空 catch —— 结果把 **ReferenceError**
    //   （我漏了 import，`getActiveWorldSlots` 未定义）静默吞成了"没有项目库"，
    //   表现为"专属取材维度神秘消失"，排查时才被发现。静默兜底必须能区分：
    //     · 数据层不可用（还没 initWorldRepository）→ 正常回落，不刷日志；
    //     · 其它异常（名字写错、逻辑错）→ **必须喊出来**。
    const notReady = /not initialized|Cannot access|is not defined/.test(String(err?.message || ''));
    if (!notReady) console.warn('[forumAlias] 读取世界观语汇维度失败，本次只用通用维度:', err?.message || err);
  }
  const seen = new Set(ALIAS_SOURCES_GENERIC.map(s => s.id));
  return [...ALIAS_SOURCES_GENERIC, ...extra.filter(s => s && s.id && !seen.has(s.id))];
}

/** 维度 B：账号形态 —— ID 本身长什么样（与取材交叉搭配） */
export const ALIAS_FORMS = [
  { id: 'realname', name: '真名流', hint: '姓+名 或 名+年份，像真名', samples: ['小林拓海', '佐藤2024'] },
  { id: 'nickname', name: '昵称流', hint: '短、无意义、偏可爱', samples: ['咪咪酱', '棉花糖'] },
  { id: 'symbol', name: '符号流', hint: '用 _ · ° 等符号装饰', samples: ['_钱包清零_', '°夜风の味道°'] },
  { id: 'numeric', name: '数字流', hint: '词 + 数字后缀', samples: ['打工人2333', 'No.7'] },
  { id: 'latin', name: '全大写英文流', hint: '真实互联网常见，略带出戏感', samples: ['WP_Gamer', 'NeonCat'] },
  { id: 'sentence', name: '长句流', hint: '整句话当 ID，情绪直白', samples: ['今天也没有被看见'] },
  { id: 'brand', name: '官方号', hint: 'XX官方 / 小助手 / 客服', samples: ['XX传媒小助手'] },
  { id: 'guest', name: '匿名流', hint: '游客或一串数字，低调路人', samples: ['游客', '路过的人'] },
]

/** 维度 C：发言立场 —— 评论里站在哪一边（决定评论内容，不只是名字） */
export const ALIAS_STANCES = [
  { id: 'passerby', name: '路人', hint: '没立场，随口一说' },
  { id: 'fangirl', name: '铁粉', hint: '护主、吹、不允许别人说坏话' },
  { id: 'hater', name: '黑子', hint: '挑刺、阴阳怪气、翻旧账' },
  { id: 'troll', name: '乐子人', hint: '只为看热闹，故意拱火' },
  { id: 'nerd', name: '技术党', hint: '冷静分析、抠细节、给数据' },
  { id: 'shill', name: '营销号', hint: '蹭热度、带货、说车轱辘话' },
  { id: 'seeker', name: '求关注型', hint: '借楼求关注、求被看见' },
  { id: 'admin', name: '官方号', hint: '出来压场、发温馨提示' },
]

/**
 * 注入用规则文本（无状态的部分）。
 * 各生成点用 buildAliasRuleBlock() 取，别直接拼这句 —— 那里还要接"已用名单"。
 */
function aliasRuleBody() {
  const sourceList = aliasSourcesNow().map(s => `${s.name}（${s.hint}）例：${s.samples.join('、')}`).join('\n  ')
  const formList = ALIAS_FORMS.map(s => `${s.name}（${s.hint}）例：${s.samples.join('、')}`).join('\n  ')
  const stanceList = ALIAS_STANCES.map(s => `${s.name}（${s.hint}）`).join('\n  ')

  return `网名规则（每个网名都要三轴交叉搭配，禁止全部套同一类）：
【取材】从这些方向里换着取，其中「市井日常」要占最多（真实论坛里多数 ID 都平平无奇，怪名因为稀有才有辨识度）：
  ${sourceList}
【形态】ID 长什么样也要换：
  ${formList}
  ★ 形态与取材要**错位搭配**（如某世界的特色题材配"全大写英文流" = COOL_THING_404），错位本身就是真实感的来源。
【立场】名字之外，每条评论的说话人要有明确立场，并体现在内容里：
  ${stanceList}

硬性要求：
- 同一批次内所有网名**绝对不许重复**，发帖人与评论人也不许共用同一个 ID。
- 每个网名都要暗示说话人的性格或身份；**禁止**"用户1""玩家A""匿名用户123"这类无个性 ID。
- 禁止生成与主角相关的 ID，或任何会暴露主角身份的 ID。
- 评论者的 ID 可以与帖子气质**形成反差**（如暴躁 ID 评论萌系帖子）。`
}

/**
 * 组装可插入 prompt 的规则块。
 * @param {object} [opts]
 * @param {string[]} [opts.used] 已经用过的网名（本批 + 近期），规则里会列为禁用，实现去重
 * @returns {string}
 */
export function buildAliasRuleBlock({ used = [] } = {}) {
  const clean = [...new Set((Array.isArray(used) ? used : [])
    .map(x => String(x || '').trim())
    .filter(x => x && x !== '匿名'))]
  const usedBlock = clean.length
    ? `\n\n【已用过的网名，禁止再出现（含仅数字后缀不同的变体）】\n${clean.join('、')}`
    : ''
  return aliasRuleBody() + usedBlock
}

/**
 * 收集一批已落库帖子里用过的网名（用于下一批去重）。
 * @param {Array<{author_name?:string, comments?:Array<{author?:string}>}>} posts
 * @returns {string[]}
 */
export function collectUsedAliases(posts = []) {
  const out = []
  for (const p of Array.isArray(posts) ? posts : []) {
    if (p?.author_name) out.push(p.author_name)
    const comments = Array.isArray(p?.comments) ? p.comments : []
    for (const c of comments) if (c?.author) out.push(c.author)
  }
  return [...new Set(out.map(x => String(x || '').trim()).filter(Boolean))]
}

/**
 * 同批网名消歧：重名不丢弃，而是追加序号（`小明` → `小明2`）。
 *
 * 为什么不直接丢弃或静默改名：
 *   · 丢弃会让评论区凭空少内容，而且"少了"这件事没人看得见（本项目红线：不静默吞结果）。
 *   · 追加序号恰好也是真实互联网的做法（注册撞名就加个数字），比硬编一个假名更自然。
 * 命名去重的主要责任在 prompt（把已用名单喂回去），这里是兜底。
 *
 * @param {string[]} names 按出现顺序
 * @param {object} [opts]
 * @param {string[]} [opts.reserved] **预占**的名字：它们已经用掉了这些名字，但自身不参与改名。
 *   角色马甲就走这里 —— 马甲来自角色档案，必须原样保留（否则"同一角色固定马甲"就废了），
 *   但它得占住名字空间，否则会出现「评论者顶着角色的马甲说话」这种一眼假的场面。
 * @returns {string[]} 等长数组，重名项已消歧
 */
export function disambiguateAliases(names = [], { reserved = [] } = {}) {
  const seen = new Map()
  for (const r of Array.isArray(reserved) ? reserved : []) {
    const key = String(r || '').trim()
    if (key) seen.set(key, 1)
  }
  return (Array.isArray(names) ? names : []).map(raw => {
    const base = String(raw || '').trim() || '匿名'
    const hit = (seen.get(base) || 0) + 1
    seen.set(base, hit)
    return hit === 1 ? base : `${base}${hit}`
  })
}

/**
 * 给角色生成候选「论坛马甲」的 prompt。
 *
 * 为什么网名要落在角色档案里、而不是每次生成时现编：
 *   网名必须**稳定** —— 同一个角色每次发帖都换名，读者就认不出是谁，
 *   "马甲"的意义就没了。要稳定就只能存成角色属性。
 *
 * 要求网名**不暴露身份**，但语气要能让人猜出来（对应《狸狸八卦》那种
 * 「不点名但大家都知道是谁」的调调）。
 *
 * @param {{display_name?:string, name?:string, base_prompt?:string, short_prompt?:string, forum_persona?:string}} character
 * @returns {{system:string, user:string}}
 */
export function buildForumAliasGenPrompt(character = {}) {
  const displayName = character.display_name || character.name || '这个角色'
  const persona = String(character.short_prompt || character.base_prompt || '').trim().slice(0, 1500)

  const system = `你是给网络论坛用户起 ID 的。你要为一个角色设计 Ta 在网上用的**马甲（论坛网名）**，以及这个马甲的发言人设。

${aliasRuleBody()}

额外要求（马甲专用）：
- 这个马甲**不能被一眼认出是本人**（不用真名、不用真名的谐音或缩写、不带职称或标志性称号），
  但语气和兴趣要能让人**猜出来是这一类人**。保持"不点名但大家都心里有数"的调调。
- 优先选「市井日常」这类不起眼的取材 —— 越像随手起的，越像真的马甲。
- 不要带任何说明文字、引号或标记，只给名字本身。`

  const user = `角色：${displayName}
${persona ? `Ta 的人设：\n${persona}` : '（没有更多资料，按名字与常识判断其性格）'}

请严格按以下 JSON 输出，不要输出任何解释或 JSON 以外的文字：
{
  "alias": "论坛马甲（网名本体，2~8 字或等长英文，不带 @、不带引号）",
  "persona": "这个马甲在网上的人设（**≤40字**，一句话讲完：爱逛什么板、什么话题会下场、说话什么调门）"
}

注意 "persona" 要**短**。它是"这个马甲在网上什么调门"的一句话速写，不是人物小传 ——
超过 40 字在界面上会显示不全，也超出了它实际被用到的信息量（只用来定这一条帖子的语气）。`

  return { system, user }
}
