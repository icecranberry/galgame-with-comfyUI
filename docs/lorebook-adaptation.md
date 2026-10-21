# 世界书在邻舍中的适配清单

本清单对应 2026-10-17 工作区实现。默认 `positionPolicy=cache`。这是邻舍提示词结构适配，不是 SillyTavern 消息结构的复制。原消息角色、顺序、附件、历史封装不变；只插入世界书正文。无需新增 user 或 assistant。

## 位置与缓存的共同规则

| 酒馆位置 | 邻舍实际语义 | 高缓存模式：稳定常驻 | 高缓存模式：条件/随机/动态宏 | 按条目位置模式 |
|---|---|---|---|---|
| 角色定义之前 | 当前人设正文开始处；群聊用群名片 | 原人设前；前面已有动态内容则提前到稳定区末尾 | 最后 user 的任务之前 | 实际人设开始处，可能在 system 或最后 user 内 |
| 角色定义之后 | 当前人设正文结束处 | 原人设后；越过动态内容则提前 | 最后 user 的任务之前 | 实际人设结束处 |
| 作者注之前 | 世界观正文前 | 原 system 的 `<world_setting>` 前 | 最后 user 的任务之前 | 原 system 的世界观前 |
| 作者注之后 | 世界观正文后 | 原 system 的 `</world_setting>` 后 | 最后 user 的任务之前 | 原 system 的世界观后 |
| @D 聊天深度 | 从当前历史尾部向前定位 | 稳定区末尾，不随历史滑动 | 最后 user 的任务之前，不随历史滑动 | 私聊/群聊按原历史的消息或文本偏移；其他任务无历史则最后 user 前部 |
| 示例之前 | 世界书示例前组 | 稳定区末尾，历史/动态材料之前 | 最后 user 前的 system 示例区 | 最后 user 前的 system 示例区 |
| 示例之后 | 世界书示例后组 | 同上，排列在前组之后 | 同上，排列在前组之后 | 同上，排列在前组之后 |
| Outlet | `{{outlet::名称}}` 的命名引用 | 因依赖引用按动态处理 | 被原 system/user 或已激活条目引用后放最后 user 前部；未引用不追加 | 在原 system/user 或条目内展开引用；不改 assistant |

“最后 user 的任务之前”：私聊放在 `</dynamic_context>` 之前，当前输入仍在该标签之后；群聊放在最后 directive user 的开头；朋友圈/生成任务放在最后 user 的开头。原始 user 条数保持不变。

“user 前的 system 示例区”：紧邻的上一条是 system，就追加在其末尾；否则新增一条只含世界书的 system，放在最后 user 之前。常驻示例不会追着历史向后移动。示例仍包在 `<example_dialogue>` 中，不把 `<START>` 或人物发言拆成 API 对话。前组优先于后组，各组内部按 order 升序、UID 确定性排序。

Outlet 在缓存模式保留原占位符，以保证命中/未命中不修改前面任何一个字节；输出到尾部的正文带命名标签。这不是 ST 的原位替换。按位置模式才原位替换；嵌套循环 Outlet 不作为可执行模板语言支持。

## 新提示词的插槽约定

新增创作类 LLM 请求或重构提示词时，遵守本节。这里的“插槽”是**原始消息中的文本边界与定位元数据**，不是必须发送给模型的占位字符串，也不是每个位置都新增一条 system。没有激活条目时，不输出空 `<worldbook>`、空消息或额外分隔符。所有插入交给共用适配器，业务层不要再手工拼一次世界书。

### 推荐结构

下图是新请求的语义顺序，不是固定 API 消息下标；相邻静态部分可以共用原 system。方括号表示文档中的边界说明，不能原样发给模型。

```text
system：固定规则
        [世界观前]
        <world_setting>世界观原文</world_setting>
        [世界观后]
system：世界观强化（有世界观才有）
system：固定任务身份、行为规则、输出格式及完整 JSON 示例（如需）
        ── 跨角色共用的稳定前缀到此 ──
system：[角色前]
        实际角色人设 / 群成员资料
        [角色后]
        [稳定区末尾：稳定常驻的深度条目、示例前组、示例后组]
        ── cacheBoundary：必须在首个动态字段之前 ──
        日期、天气、情绪、关系、着装、帖子、场景等本次材料
        摘要与聊天历史：沿用业务既有封装和角色顺序
system：[动态示例前组 / 后组]（仅有命中时，优先复用末条 user 前的 system）
user：  [动态世界书：关键词 / 向量 / 概率等条件条目，以及被引用的 Outlet]
        本次任务 / 用户当前输入
```

角色人设属于“同角色、同版本下可复用”的内容，不意味着所有角色共享同一缓存。跨角色批量任务仍应把共用规则和格式放在人设前面。若人设段混入实时着装、日期、场景或其他本次变量，应拆出动态部分，或将 `cacheBoundary` 提前到它们之前；不能为了保留“角色之后”的位置而把动态内容认证为稳定。

新生成请求只保留一个收尾 user，本次任务放在末尾；长动态材料优先放在前面的业务 system。已有聊天请求仍保留原历史消息角色和封装，不为满足此示意图转换或拆分历史、不增加 user。私聊已有 `<dynamic_context>` 时，动态世界书放其结束标签之前，用户当前输入继续在标签外收尾。

### 必须可定位的边界

| 预留位置 | 定位依据 / 接入字段 | 用途与约束 |
|---|---|---|
| 世界观前、世界观后 | 原 system 中完整的 `<world_setting>…</world_setting>`；运行时按当前世界观正文识别 | 承载作者注前后适配；不要把日期、天气等拼进世界观正文。无世界观不造空段，使用现有回退 |
| 角色定义前、角色定义后 | `personaTexts` 提供**实际发出的完整文本**；可使用群名片整体文本 | 承载角色前后适配；不是角色 ID、名字或另一次重新拼装的人设。必须与消息逐字一致 |
| 稳定区末尾 | `staticTexts` 辅助认证；必要时显式传 `cacheBoundary: { index, offset }` | 在首个动态数据及全部历史之前；承载稳定常驻的深度/示例条目，以及越过稳定边界的常驻条目回退 |
| 历史内部定位点（有历史时） | 私聊 `activeSegments` 与 `historyStart`；群聊 `transcriptSegments`；自定义结构可提供 `depthTargets` | 只供按位置模式的 @D 定位。必须对应实际序列化历史，不能用扫描用的 `history` 数组直接猜消息偏移；不拆历史外壳、不改变 assistant |
| 最后 user 前的示例区 | 默认自动寻找末条 user；紧邻上一条 system 的末尾 | 示例前后保留为两组正文，不生成虚构对话。没有相邻 system 才新增仅承载世界书的 system；稳定示例使用稳定区末尾 |
| 动态世界书尾部 | 默认末条 user 开头；若有 `</dynamic_context>`，则在该结束标签前 | 放条件/随机条目和缓存模式 Outlet，必须在当前任务/输入之前；不得修改前方稳定前缀 |
| 命名 Outlet（按需） | 原提示词中的 `{{outlet::名称}}` 引用 | 仅业务确实需要命名引用时才添加；不是通用必留空槽。缓存模式保留引用、正文走尾部；按位置模式才原位展开 |

`index` 和 `offset` 都基于**尚未注入世界书的原始 messages**：index 是从 0 开始的数组下标，offset 是 JavaScript 字符串偏移（例如 `text.length`），不是 token 数或 UTF-8 字节数。可选 system 层有无变化时，必须在当次组装后计算，禁止照抄其他业务的固定下标。`cacheBoundary` 是调用方对整个前缀的承诺，不能跨越前方已存在的动态内容。

现有运行时会自动识别上述标准结构；确需自定义语义锚点时使用 `anchors`（角色前后、作者注前后、示例前后），由共用定位器处理。不要绕开稳定性规则，用 `stableAnchors` 将常驻内容强行放到历史后方。没有角色或世界观的任务使用既有回退，不为适配世界书虚构业务内容。

### 接入时同时提供扫描上下文

插槽决定“写在哪里”，扫描上下文决定“什么会激活”，两者必须分别提供。尤其不要因聊天记录已封装在 system 中，就漏掉关键词和向量的扫描来源。

- `history`：按时间从旧到新排列的逻辑记录，形如 `{ role, name, content }`；包含本次输入。私聊传真实消息，群聊保留真实发言者，朋友圈传帖子与评论链。只传本次业务可见的记录，不扫描完整请求里的所有系统规则，也不混入本次尚未注入的世界书正文。
- `characterName` / `characterNames`、`characterDescription` / `characterPersonality`、`personaDescription`、`scenario` 等：提供真实业务数据供角色筛选、宏与额外匹配源使用；这些扫描字段本身不代表新增一层提示词。
- `scope` / `turnKey` / `step`：有会话生命周期时提供稳定作用域、本次生成对应的回合标识和逻辑消息步数，用于黏性、冷却、延迟及重试快照；不把这些内部标识插进稳定提示词。
- 关键词按 `scanDepth`（条目可覆盖）扫描；向量按独立的 `vectorQueryMessages` 扫描。额外匹配来源当前只扩展关键词扫描，不自动加入向量查询。两者均前置执行：关键词是本地逻辑，向量需要 Embedding，注入正文仍计入主模型输入 token。

调用入口使用 `services/lorebook/runtime.js` 的 `chatSync` / `chatStream`，通过 `opts.lorebook` 传元数据；已有复杂调用链可直接使用 `prepareLorebook`。同一生成链只准备一次，重试沿用同一回合；追加记忆等材料后，从未注入版本重新组装并 `await prepared.reapply(...)`，不得在已经注入的文本上重复注入。直接调用入口需在业务生成成功后提交 `prepared.commit()`；适配器封装入口已负责提交。

### 新接入的验收要求

1. 禁用世界书、没有激活或注入失败时，业务消息内容、角色、附件和封装保持原样；不出现空插槽和额外 user/assistant。
2. 检查报告的 requested 与 actualAnchor/index/offset，逐项核实角色前后、世界观前后、示例、深度与 Outlet 的真实落点，不仅检查导入字段。
3. 固定世界观和角色，分别改变当前输入、历史、日期及条件条目命中，验证 `cacheBoundary` 之前（含稳定常驻注入）的文本逐字一致；动态条目只改变尾部。修改世界观或角色版本导致相关前缀变化属于预期。
4. 覆盖有/无世界观、有/无角色、有/无历史、可选 system 层和多模态附件，确认偏移取自当次原始结构。报告本地前缀稳定性与提供商实际缓存命中率时分开说明。

## 正文请求可选预设层

SillyTavern 预设仅由需要文风的业务请求显式接入 `services/presets/narrative.js`；普通 LLM 客户端和世界书运行时都不自动加载预设。素材、生图、分析、提取、规划等请求仅保留原有世界书行为。

正文组装器先编译预设，经 `reservedTokens` 为世界书预留其预算，再让世界书基于未插入预设的原消息定位，最后在 system0 后加独立 system。`reapply` 复用同一正文快照；原 index/offset 的口径不变。动态预设不被声明为 `staticTexts`。私聊规划使用不含预设的 `lorebookMessages`，正文才使用含预设的 `messages`。范围清单和接入方式见 [预设适配说明](preset-adaptation.md)。

## 业务请求逐项落点

编号是语义层，实际 system 索引随可选层变化，运行时报告使用原消息索引与 offset。

| 请求 | 原结构要点 | 常驻角色前/后、深度/示例的实际位置 | 作者注前/后 | 动态条目 |
|---|---|---|---|---|
| 私聊主聊天/规划复用/重试 | 规则+世界观 → 人设+buff/世界状态 → 格式关系 → 摘要/历史 → dynamic_context user | 人设原文前/后；深度/示例在人设原文后、buff 与世界状态之前 | 第一个 system 内世界观前/后 | 最后 user 的 dynamic_context 结束标签之前 |
| 群聊 | 规则世界观 → 协议 → group_info 群名片 → 摘要 → transcript user → directive user | group_info 前/后；深度/示例在群名片后、摘要和 transcript 之前 | 舞台 system 内世界观前/后 | directive user 开头；动态示例另用其前方 system 槽 |
| 角色回复用户评论、朋友首评、朋友续评、帖主回朋友 | 规则世界观 → 世界观强化 → 人设 → 情绪/关系/帖子/记忆 → user | 主要回复者人设前/后；示例/深度在其人设后、情绪或关系材料之前 | 第一 system 内世界观前/后 | 最后 user 开头；关键词/向量扫描实际帖子与评论记录 |
| 角色评论用户朋友圈 | 规则世界观 → 强化 → 评论规则 → 用户资料+帖子/图片 → 人设 → user | 人设之前已有动态帖子，常驻角色前/后都提前到评论规则末尾；按位置模式仍围绕真实人设 | 第一 system 内世界观前/后 | 最后 user 开头 |
| 发朋友圈 | 规则世界观 → 强化 → 任务层（共用固定规则 → JSON 示例、随机形态与天气等）→ 人设 → 场景及本次主次 → user | 常驻落在任务层固定规则末尾、可变 JSON 示例之前，由当次 `cacheBoundary` 定位；按位置模式围绕真正人设 | 第一 system 内世界观前/后 | 最后 user 开头；扫描用日程与正文使用同一份序列化文本，动因为主时均省略日程描述 |
| 赴约朋友圈 | 规则世界观 → 强化 → 混合任务要求 → 人设 → 场景 → user | 常驻提前到世界观强化后、混合任务要求之前；按位置模式围绕真正人设 | 第一 system 内世界观前/后 | 最后 user 开头 |
| 日程生成 | 规则世界观 → 强化 → 固定日程任务 → 人设 → 着装 → user | 人设前/后；示例/深度在人设后、着装层前 | 第一 system 内世界观前/后 | 最后 user 开头 |
| 日记生成 | 规则世界观 → 强化 → 固定日记任务 → 人设 → 今天日期与日程 → user | 人设前/后；示例/深度在人设后、今天日期层前 | 第一 system 内世界观前/后 | 最后 user 开头 |
| 小镇立绘/像素小人/整套人物素材 | 世界观 → 强化 → 固定设计与格式 → 外观资料 → user | 外观资料前/后；示例/深度在外观资料后 | 第一 system 内世界观前/后 | 最后 user 开头 |
| 镇民朋友圈、镇民奇遇各阶段 | 世界观 → 强化 → 混合场景/格式 → NPC 人格 → user | 人格前已有动态或未认证的内容，常驻提前到稳定区末尾；按位置模式围绕 NPC 人格 | 第一 system 内世界观前/后 | 最后 user 开头 |
| 信箱回信、小镇服务项目/货架生成 | 世界观 → 强化（可选）→ 已传入的完整人设 → 材料或 user | 人设前/后；示例/深度在已确认稳定区末尾 | 世界观所在 system 内前/后 | 最后 user 开头 |
| 小镇服务/打工趣事 | 世界观 → 强化 → 固定输出结构 → NPC 人格+用户资料 → user | NPC 人格前/后；示例/深度在 NPC 人格之后、用户资料之前 | 第一 system 内世界观前/后 | 最后 user 开头 |
| 其他创作请求（下方文件表） | 原有结构不改 | 按实际出现的角色完整/简短卡识别人设；仅已认证稳定前缀允许原位，未知边界提前。没有独立人设时角色前后都落稳定区末尾，不虚构角色段 | 有世界观则定位其前后；无世界观则映射系统开头/稳定区末尾 | 最后 user 开头；动态示例 user 前 |

私聊的实际深度只在按位置模式生效：0/1 留在当前任务边界，2 在上一段历史前，继续向前穿过活跃历史与 checkpoint；群聊 0 在 transcript 结束前，1 在最后一条记录之前。超深度截到最早可用历史。不拆 `active_chat_history` 或 `group_transcript`。

其他调用如果人设放在最后 user 里，按位置模式可在其文本内定位；高缓存模式提前到 system 的稳定边界。如果整个请求没有可确认的静态段，常驻放在第一个 system 开头；没有 system 时新增世界书专用 system。

## 内部规则与 ST 对照

本机源码参考：`D:/AI/SillyTavern-Launcher/SillyTavern/public/scripts/world-info.js` 的 WorldInfoBuffer、checkWorldInfo、BUILDING PROMPT、filterGroupsByScoring 与 timed effects；向量召回由 ST 扩展向激活器提供外部命中。

| 功能 | 当前行为及适配 |
|---|---|
| 常驻/关键词/向量 | 保留三策略；常驻无需关键词但仍检查条件/概率/预算。向量外部命中与关键词回退可并存，符合本机 ST 激活器行为；全局向量扫描可扩展到非向量条目 |
| 主词、次词与逻辑 | 主词任意命中；次词 AND ANY / NOT ALL / NOT ANY / AND ALL；空次词忽略 |
| 正则/大小写/完整单词 | 正则带 flags；大小写、完整单词可继承全局；保留 ST 的 JS 单词边界口径，中文不是分词 |
| 扫描深度、最少激活 | 按输入逻辑消息计数，条目覆盖全局；最少激活逐步加深；关键词深度 0 不扫描聊天关键词。向量独立使用 `vectorQueryMessages`（默认最近 2 条），不受关键词深度控制 |
| 六个额外匹配源 | 用户设定→用户 persona；角色描述→本次角色原文；性格→已识别角色 short_prompt；角色备注、作者备注→邻舍世界观正文；场景→业务场景（无显式场景时世界观）。各开关仍决定是否扫描对应源 |
| 角色筛选 | 已识别卡片的名字/显示名和调用方指定名字参与；导入 character_book 扩展中的筛选也保留。ST 标签没有自动对应的邻舍数据表，调用方没传 characterTags 时按空集合处理并显示警告，不伪造支持 |
| 递归 | 已命中的正文可激活其他条目；excludeRecursion 阻止被递归命中；preventRecursion 阻止作为递归来源；支持延迟递归级别与扫描上限 |
| 包含组 | 优先/权重/组评分；常驻与向量候选也按关键词算组评分；黏性赢家优先，不被组评分淘汰 |
| 概率 | 每次评估每条只抽一次；同一已保存 scope/turn 快照重试不重抽；稳定常驻先占预算 |
| 黏性/冷却/延迟 | 私聊、群聊使用会话逻辑消息步数与持久状态；普通私聊、主动消息、叫醒、延迟回复共享 `char_ID` scope 与真实 raw 消息计数，回复落库后提交状态。一次性生成请求没有会话生命周期，需调用方提供 scope/turnKey 才跨请求持久化 |
| 预算 | 完整条目进入/淘汰；稳定常驻优先；ignoreBudget 跳过世界书预算但不能突破请求总上下文限制；token 当前是估算值 |
| 排序 | 预算选择以高 order 优先；最终正文低 order 在前，同序按 UID；示例前后组单独有先后 |
| 宏 | 支持 char/user/persona/description/personality/scenario、当前消息、日期时间、random/pick、局部 getvar/setvar 等；纯 setvar 条目提交变量和激活状态，不生成空提示词块。全局变量/未知宏保留并警告；未知或动态宏不进入稳定区 |
| 自动化 ID | 保存与导出保留；不执行 ST Quick Reply 脚本，不宣称它能触发邻舍自动化 |
| role、生成类型 | 原导入 role 保留导出；注入继承承载消息角色，新增槽只有 system。默认生成类型 normal，群聊冷场续写映射 continue；没有业务触发的 ST 类型不会凭空触发 |
| 正文正则 | 应用世界书配置中的正文替换规则；不是完整 ST 正则插件运行环境 |

## 遍历范围

以下业务文件均通过共用适配器，未改写各业务原消息结构。具体是否可以围绕角色原位注入，由实际卡片匹配与静态边界判断；不是给所有文件硬套固定 system 下标。

| 类别 | 文件（均相对于 agent-core/src） |
|---|---|
| 聊天 | routes/chat.js、services/groupChatEngine.js、proactiveChatScheduler.js、replyQueueScheduler.js、wakeService.js |
| 朋友圈 | routes/moments.js、services/momentCommentService.js、momentInteractionService.js、momentUserPostService.js、town/townNpcMomentGenerator.js |
| 生活叙事 | services/eventGenerator.js、diaryGenerator.js、dreamService.js、mailboxScheduler.js、scheduleGenerator.js、itemGiftNarrative.js |
| 图片与角色 | routes/characters.js、images.js、schedule.js；services/characterAppearanceService.js、characterReactionService.js、characterReactionPackService.js、dialogueBackground.js、emojiService.js、expressionStandingService.js、outfitScene.js；maibot-bridge/prompt.js |
| 世界内容 | routes/relationships.js；services/itemService.js、libraryGenerator.js、mediaAvatarDesigner.js、mediaOutletDesigner.js、mediaService.js、newspaperService.js |
| 小镇 | services/town/townBuildingFeatureGenerator.js、townBuildingFeatureRuntime.js、townInitService.js、townLayoutAI.js、townNpcEventGenerator.js、townNpcOfferService.js、townNpcService.js、townNpcServiceRuntime.js、townNpcStockService.js、townPromptBuilder.js、townService.js |

图片事实识别、信箱文字浓缩显式 `lorebook:false`；主聊天图片意图判断、记忆提取/摘要保留原客户端。私聊配图生成补接世界书适配器，避免和主聊天世界设定脱节。

## 验证口径

正式回归覆盖语义前后位置、动态前缀截断、历史完整性、多模态附件、缺省结构、示例前后排序、深度、Outlet、触发细则、旧快照分类与预算。缓存稳定性以条件命中变化前后、历史变化前后实际组装文本的公共前缀比较验证；不把本地字节稳定性等同于提供商已回报缓存命中率。本次不使用旧请求的命中率证明新布局。

本轮验证：50 项世界书专项回归通过；后端全量测试通过，后续适配改动再跑世界书/朋友圈相关回归；前端 6 项编辑器测试、ESLint 与生产构建通过。两本已保存世界书在私聊/群聊/朋友圈共 6 组离线场景中通过稳定前缀一致性检查，结果见 `output/lorebook-validation/adaptive-layout-audit.json`。测试未修改保存的世界书配置，也未发送新的提供商缓存实测请求。

通用预览使用同一个运行时（包括向量召回），但它只是通用结构，并不假装展示某条真实私聊/群聊请求。真实请求报告包含 requested、actualAnchor、index、offset、mode、cacheTier；索引为插入前的原消息索引。报告中的 mapped 表示启用了邻舍适配，不表示原配置被改写。

## 审核修复后的运行边界

- 关键词求值与正文注入都在独立 Worker 中执行，每项任务含排队最多 1.5 秒；同一进程最多同时执行 2 项、排队 32 项，Worker 堆上限 128 MiB。超时终止线程，保留原业务请求，报告未注入原因，不提交世界书状态。预览、正常请求与记忆补充后的重新注入共用这一边界。
- 保存启用的向量世界书后异步预建索引；冷索引第一次请求立即回退关键词匹配，构建完成后的请求使用向量。同一索引构建合并并发请求，未修改正文复用向量；仅修改书名、revision 不重建。后台整本构建上限 30 秒，在线查询上限 1.5 秒，超时中止 HTTP 请求（含响应正文读取）。失败退避 30 秒，仍保留关键词匹配。最多并行构建 4 本，单本最多 4096 个向量条目，索引及正文向量使用有界缓存。
- 扫描时使用真实发言者名称；私聊为用户昵称和角色显示名，显式消息 name 优先，群聊不把整段多角色剧本归给某一个成员。关闭 includeNames 后不添加姓名前缀。
- 兼容承诺分三类：关键词、次词逻辑、概率、分组等保留执行语义；位置、作者注、消息角色和缓存模式 Outlet 按邻舍结构适配；自动化 ID、全局变量和未知宏只保留，不冒充已执行。导入成功不代表 ST 扩展脚本可在邻舍执行。
- 本次按要求不修改 token 预算计算阶段；正文替换、Outlet 展开与包装标签之后的最终预算复核仍属于已知限制。
