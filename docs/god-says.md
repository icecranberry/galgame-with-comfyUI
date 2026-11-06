# 神说

角色列表顶部的常驻入口打开 `/#/god-says`。用户以神的身份与独立系统角色「天使」交流；天使不进入普通角色、随机发帖、群成员或好感度候选池。

Agent 的主流程、后台投递与设计思路见[神说 Agent 流程与设计思路](god-says-agent-design.md)。

## 行为

- 天使人格参考酒馆的身份、性格、好恶、外观四段结构，由 `angelPersonaGenerator.js` / `angelPersonaPrompt.js` 专门组装。支持原创，也支持在自定义中指定 IP 角色担任天使：保留原名、性别、外貌、语感、核心动机和兼容世界观的经历，将天使作为当前职责，冲突设定才按世界观适配。通过符合角色的日常习惯、闲暇兴趣、小愿望与情绪反差增加生活质感，避免统一仪式腔。用户选好性格或填写自定义要求后发起召唤，结果持久化至 `god_angel`，之后聊天、日程共享。业务槽位仍名为“天使”，人格正文可使用指定角色的姓名。新生成只输出人格正文，不继承 VAD 输出协议，成功保存时清空旧 VAD 基线；已有自定义人格保留。并发生成合并，失败记录原因并冷却重试，不把占位人格当作生成成功，也不写入普通居民表。生成后刷新当前日程模板，历史会话快照保持不变。

人格创建按稳定前缀分层：system0 为基础规则与世界观，有世界观时 system1 为 `getWorldIntegrationRule('character_persona')`，之后依次放静态创作规范与输出模板、固定天使身份及默认白袍双翼光环、当次性格倾向与自定义要求，最后一个 user 简短重申任务并强调遵循 `<world_setting>`。没有世界观则省略强化层与对应强调，不生成空占位。世界书的角色边界指向实际身份文本，缓存边界截止于该层末尾，动态选择不得进入静态认证。标签的 hint 只描述抽象性格倾向，不指定具体人物、地点、行为或日常桥段；前端悬停说明与生成请求共用这些描述。
- 日常聊天复用当前 LLM；天使日程复用现有生成与校验服务，独立保存，跟随全局日程开关和刷新间隔。日程是计划，不作为活动完成的依据。
- 世界事件先持久化事实和随机回应对象，再异步投递。默认 2–4 位角色发朋友圈、1–2 个群聊讨论，对象不足时按实际数量执行。默认全体感知，主动回应范围与感知范围分开。事实默认持续 180 分钟，工具可指定时长、范围或替代旧事件。
- 角色命令支持读取资料/日程、安排今天或未来活动、指定朋友圈/群聊主题、开启奇遇。建筑服务仍由奇遇选项推进，不代替玩家选择。
- 神说的普通角色反馈首选朋友圈和群聊：个人分享、外观展示用朋友圈，多人讨论和相互回应用群聊，按需求选择，不默认两者都触发。只有明确要求奇遇，或明确希望亲自参与并通过选项推进现场剧情，才开启奇遇；普通互动、日程中的相遇及反馈渠道排队或失败都不自动转成奇遇。用户指定的渠道优先，世界事件已安排社交回应时不额外附送奇遇。
- 排队、安排、开启奇遇和完成明确区分；工具失败或缺少能力时由天使自然说明，不编造成功。

当前共有 100 个工具：17 个核心工具与 83 个模块工具。模块工具在 `services/godSays/moduleTools.js` 中逐个绑定既有业务接口；模型不能提供任意 URL、HTTP 方法或额外请求体。`localApi.js` 通过当前服务的 loopback 地址调用原路由，保留各模块的校验、冷却、库存、睡眠、后台任务和推送逻辑。JSON Schema 与服务端共同校验，没有任意 SQL 或脚本工具。按用户要求，小镇全部专属能力不添加工具。

| 模块 | 已接入能力 |
| --- | --- |
| 聊天 | 分页读取私聊、按神授权向角色传话，遵循日程排队 |
| 群聊 | 查询群与上文、建群、修改名称/话题、邀请成员；核心工具触发讨论 |
| 朋友圈 | 浏览动态与评论、评论、以用户身份发布；核心工具让指定角色发帖 |
| 信箱 | 浏览来信/回信状态、寄信并等待既有回信机制 |
| 日记 | 读取、查目录、启动生成并查询结果 |
| 日程 | 全体概况、完整重排、电话叫醒；核心工具指定时段安排 |
| 奇遇 | 列表和详情、核心工具开启普通角色奇遇，选项仍由玩家推进 |
| 背包 | 库存与效果、宝箱冷却、开宝箱、收下/使用道具、读取赠礼叙事 |
| 关系 | 查询、新建、修改有向关系，读取情绪/好感与画像 |
| 记忆 | 按角色搜索往事、分页浏览片段；神说自身的记忆总结与召回已停用 |
| 相册 | 按角色/文件夹查图、图片实验室生图并发送到神说、生图任务与待确认草稿 |
| 角色 | 招募、读取/创建/切换专属外观、生成头像；核心工具读取资料 |
| 立绘 | 场景立绘、表情立绘、生成待确认的立绘草稿 |
| 表情包 | 素材/类别、创建/启停配置组、初始化/批量生成提示词、批量生成缺少的图片、按确认稿重做已有图片、读取套装逐项状态 |
| 天使 | 读取独立档案、按字段修改名字/人设、修改默认外观、生成/修改私服/居家/睡衣草稿 |
| 媒体 | 媒体/板块/内容、后台刷新与状态、创办媒体、新建板块、收藏、门户正文 |
| 日报 | 今日/往期目录与正文、遵循原条件补发 |
| 世界观 | 查询、新建、修改、按神明确要求激活；世界事件仍使用核心工具 |
| 预设 | 只读已保存预设的目录和启用状态 |
| 素材库 | 查询/新增朋友圈话题与奇遇类型 |
| 语音 | 读取角色音色绑定、朗读已保存消息、查询语音任务 |

系统凭据、服务安装/重启、任意文件读写和整库清理不作为对话工具；通知/SSE 继续作为各模块的推送通道。人物参考、外观和生图仍由原业务入口统一组装。私聊/评论/发信/用户动态工具只在神明确要求传达时使用。

### 工具确认与能力边界（2026-11-05）

确认由后端 `changePolicy` 按业务目标判断，不按 SQL 动词或 HTTP 方法简单分类。新建角色、群聊、关系、独立外观、世界观、媒体与内容直接执行；改变已有资料、衣柜、日程、库存、收藏或状态先确认。首次初始化空表情套装/首次生成缺少的图片直接执行；已有提示词/图片覆盖先准备完整草稿。`create_world_event` 带 `supersedes_id` 会结束旧事件，因此也需要确认。内部任务状态更新不额外确认。

`update_character` 和 `update_angel` 仅提交用户指定字段；改名不复制整个人设，确认卡展示新旧名字。普通角色与天使档案独立，天使默认外观使用 `apply_angel_appearance`，三套场景服装使用 `generate_angel_outfits`。服装草稿复用现有 `sceneOutfitPrompt` 规则与解析器；仅保存选中槽位，不自动重绘形象。新增专属形态的设计要求走 `create_outfit.instruction` 与原外观扩写接口，`description` 只允许原样使用本轮用户提供的正文，不能让模型借它绕过生成规范。

表情包顺序为 `create_emoji_set → initialize_emoji_prompts → generate_emoji_images → read_emoji_set`。批量出图默认 `onlyMissing`，不覆盖已有图片；明确 `overwrite` 时先生成候选图片，卡片展示原图/新图，确认后采用冻结的图片地址。候选图预览复用 `GodMessageImages` 和只读 `ImageLightbox`。日程、日记正文与表情提示词的重生成也先冻结草稿，确认后不再次调用文字生成器。提交时重新核对目标快照，原数据变化时拒绝覆盖；不确定提交不自动重放。旧版缺少新名字预览或冻结结果的草稿拒绝提交，需重新生成。

`capabilityBoundary` 在已知未接入的实体需求进入模型前拒绝，例如小镇店铺改名、删除角色、已有图片放大。小镇仅作为普通生图/朋友圈的地点不被拦截。未知工具或能力查询返回未接入时，工具循环停止同批剩余调用并直接说明边界，不再让模型尝试世界事件等替代写操作。世界事件只设定叙事事实，不能当作改名、删除、修改设置等实体接口。

`generate_image` 直接调用图片实验室 `POST /api/images/test-style` 的自由画面链路，固定使用 `chat` 场景。`prompt` 为完整中文画面描述，`width` / `height` 可分别覆盖本次尺寸（256–4096 整数像素），省略时读取当前对话分辨率；不改变全局设置。可选 `artist` 覆盖本次画师风格，未传入时沿用对话设置。普通居民通过 `character_ids` 显式指定入镜名单，未传时沿用姓名匹配。天使自拍或与居民同框时传 `special_characters: ["angel"]`，实验室未传该字段时也会按“天使”或其已保存名字匹配；`[]` 表示天使仅被提及、不入镜。后端从 `god_angel` 读取最新外观，通过 characterPersona 与普通角色资料一起注入，不创建隐藏酒馆角色、不占用居民编号、不携带普通角色的服装或 LoRA，也不注入神说聊天和记忆。天使没有可用外观时，在调用模型前返回明确错误。此能力使用 `sceneDesc` 自由画面链路，已生成的英文 `prompt` 重测链路保持原样。

神说请求固定附带 `saveToChat: true`，成功后图片存入聊天图片目录，完成任务写入 `image_tasks`（`conversation_id='god:angel'`），返回本地 URL、尺寸与任务编号；图片实验室原页面仍仅预览，不会被默认保存。模型、工具日志与 SSE 不携带图片 base64。对话在对应工具调用处显示成图并复用 `ImageLightbox` 放大/下载，支持断线重连和往日回看，进出动效为 300ms。生图失败不插图，也不声称发送成功。

## 运行与存储

每轮对话可从回复下方删除，支持今日和往日。删除前确认范围；同一会话仍在回应时返回 409，避免已删除内容被正在运行的上下文重新写回。删除事务清理该轮消息、工具记录和 SSE 重放数据，清空遗留摘要、长期记忆与上下文压缩字段，不再生成新摘要。`god_runs.deleted_at` 保留空内容幂等墓碑，防止旧发送标识重新执行；已经受理的世界事件及投递保留，删除对话不撤销业务结果。

天使资料经 `GET /angel` 读取、`PUT /angel` 保存，校验显示名、人设长度和 VAD 范围；只修改独立 `god_angel` 表。人设修改会使日程模板过期，生成中的旧日程只能在对应人设仍一致时写回。已有历史日程快照不变，新人设用于之后的聊天准备。

天使详情通过数据适配器直接复用普通角色的 `ResidentCharacterDetailModal.vue`，使用相同的头像行、人设／外观折叠编辑与宽窄屏形象布局；隐藏关系、声音、LoRA、删除等居民专属功能。服装与居民一致提供默认、私服、居家、睡衣四套，支持衣服库、按默认生成三套换装及其形象；形象面板逐套切换，支持生成、复用提示词重出、上传和移除。今日日程已移至神说顶部的「今日日程」独立入口，由 `GodAngelScheduleModal.vue` 承载，不再作为详情卡页签。天使详情支持换头像、形象展示和默认外观编辑。头像复用 AvatarCropper，可上传、选最近图片或按人格生成候选图，再裁剪确认；保存成功同步到神说页头、回复头像和侧栏。形象复用 CharacterStandingPanel，可上传、生成或移除；人设与外观服装分开编辑，默认外观仍合并保存为完整人格，其他三套和各套形象分别保存，后续图片统一走 characterPersona。VAD 不再出现在资料或编辑界面，省略该字段的保存保留原有有效基线。后台头像与形象更新保留未保存的编辑草稿，保存期间防止重复提交。媒体请求、任务轮询和嵌套 Esc 处理由 `useGodAngelMedia` 共用。

「修正外观」直接复用 AppearanceRefineModal，默认／私服／居家／睡衣按打开时的页签锁定目标。分析沿用无需居民编号的 `POST /characters/refine-appearance-draft`，提交当前场景的草稿人格与场景名；应用只提取外观，保存仍走独立天使接口。最近图片截取通过适配器调用 `/god-says/angel/image-jobs`，不把 god:angel 传入居民图片查询。默认外观更新人格，其他服装只更新对应槽位；自动保存失败保留草稿且不提示成功。关闭分析时取消前端请求并忽略迟到结果；最近图片层独立响应 Esc，开合为300ms。

独立图片接口为 `GET/POST /angel/image-jobs`、`GET /angel/image-jobs/:id`、`POST /angel/avatar`、`POST/DELETE /angel/standing`。`god_angel` 增加 avatar_path / standing_url / scene_outfits_json / scene_standings_json，`god_angel_image_jobs` 保存头像、形象和日程快照任务。生成候选头像为1024×1024，展示形象为768×1536；日程相机读取天使自己选中的活动快照，使用奇遇分辨率和画师设置，不将计划当成完成记录。相机在桌面悬停／聚焦显示，手机直接可见；图片可放大、下载与再拍。

图片任务按类型合并在途请求，完成记录和图片地址持久化；关掉详情不会丢失任务，服务重启标记未完成任务失败，不自动重复生图。生成失败保留原形象；生成期间人设或形象改变时，不用旧图覆盖新资料。上传验证 PNG/JPEG/WebP、体积与像素限制，并经 sharp 解码、旋转、规范化；只写独立天使资料，不使用普通居民编号。最近图片包含天使已生成的头像、各套形象、日程快照和神说配图。

服装经 `PUT /angel` 的 `outfits` 数组与人格原子保存，场景限定为 work / casual / home / sleep，默认外观始终以 persona 原文为准。形象上传、移除及 `standing` 任务支持 scene 参数。`outfits` 任务复用邻舍的三套换装规范与完整 JSON 示例，先保存服装再串行出图，状态仍持久化在 god_angel_image_jobs；设计失败不落库，部分出图失败保留已有形象与成功图片。并发修改人格或服装后，旧任务不覆盖新资料。`POST /angel/clothing-draft` 为天使衣服库生成独立草稿，复用原词条校验与睡衣赤脚约束，不调用居民编号接口。

天使日程通过同一服装标注层安排换装；日程快照按所选活动向前查找最近的换装点，睡眠强制优先睡衣。对话的当前着装放动态上下文，生图服装注入走 characterPersona，置于稳定人格之后。服装改动使当前日程模板过期，不修改往日快照。

`agent.js` 只负责模型 → 工具 → 模型循环，最多 8 轮、16 次工具调用，运行限时 10 分钟。`runtime.js` 组装业务服务，`repository.js` 管理会话和可重放流事件，`worldEvents.js` 管理投递。每个当日会话最多一个运行。发送使用客户端幂等键，写工具以运行内规范化参数摘要防重；只读工具每次重新查询。

独立表：`god_angel`、`god_sessions`、`god_runs`、`god_messages`、`god_tool_calls`、`god_run_events`、`god_world_events`、`god_world_deliveries`。普通朋友圈和群聊原始消息增加可空的 `god_delivery_key` 供恢复核对。迁移自动执行且可重复运行。

本次详情能力通过41项相关后端测试、4项前端测试，包含独立头像／形象上传后的HTTP读回、旧库补列、任务合并、重启恢复、失败与资料竞争保护、日程／睡眠快照及世界书真实边界。浏览器使用隔离接口与SVG素材验证头像保存失败保留裁剪／重试成功、AI头像进入裁剪、外观保存失败保留草稿／读回、形象生成要求、重新打开读回、日程相机及灯箱；检查暖色、暗夜、390px手机和44px相机触摸范围。未修改真实天使资料或调用真实生图服务，主执行者自检，未独立视觉评审或生产构建。截图在 `output/angel-detail/`；临时验证页和素材验收后删除。

SSE 从持久化序号恢复。离开页面或断线只断开订阅，不终止运行。停止取消后续工具及尚未开始的投递；已经提交或正在执行的业务操作可能完成并保留结果。重启后聊天标为中断，成功投递不重复；结果不确定的工作标为需要核对，不自动重放。群聊部分回应明确标注。模块 API 返回 accepted/started/queued 只代表受理，工具结果包含真实任务编号与对应入口；写请求在超时/断线后标为需要核对。读取结果过滤凭据并限制长度，超量明确提示缩小范围。

日期固定为 `Asia/Shanghai`，普通居民日程仍使用既有主机当地日期。会话不随日期重置：前端不再轮询跨日或在发送前按日期切换，后端不自动归档旧日会话；后台刷新不强制回到底部。日程仍按日期独立更新。侧栏「新建对话」通过 `POST /sessions` 结束当前会话并返回未保存草稿；重复点击复用唯一空白草稿，首条消息受理后才落库，未发送文字及附图保留。回应期间返回 409。所有日期的会话都可继续，包括新建或重新召唤前的会话；状态接口的 `writable` 为真，`current` 仅表示默认会话，创建日期不影响可写性。发送携带所选 `session_id`，重试标识按会话隔离，发送完成、重新连接和重进页面都保留所选会话；服务端将消息写入所选会话，不因日期不同转投最新会话。会话历史与提示词快照跨日仍按原会话继续，手动新建或重新召唤才建立独立前缀；同日可创建多条有内容的会话，分页使用日期与会话游标。神说不再生成每日摘要或长期记忆，也不再自动注入或提供 `recall_memory` 工具；旧 `/memories` 返回空列表、总结重试返回 410。已有原文保留，当前会话完整累积，不压缩。

## 模型与提示词

原生工具流与普通聊天使用相同日志输出工具：每轮标注运行 ID / 轮次，打印请求消息（图片压缩显示）、模型、工具列表、服务商返回的思考、正文、工具调用和 token 用量。失败、取消或流中断保留已经收到的文本，遥测只记一次；不会为了日志重放请求。人格生成日志标签为 `创造角色:天使`。

人格相关回归覆盖独立创建分层、有／无世界观、稳定前缀、世界书实际锚点、无数值基线的正文解析、生成并发与持久化、失败冷却和自定义人格保留。HTTP 测试使用隔离模型与内存数据库，验证真实请求的世界观强化层、user 强调及保存结果，不修改本机现有天使。

强制开启思考，覆盖全局关闭选项；模型必须支持原生工具调用。正文、服务商可展示的思考和工具记录分别流式显示，不伪造思考。没有返回可展示思考的模型不会被补写思考。思考展开由前端 `useGodThinking` 按运行编号管理：本次停留中新受理的一轮默认展开，正文开始、原生工具续轮及本轮结束均不自动收起；下一轮受理后折叠先前思考，离开页面后清除展开状态。重新进入页面或切换日期时，已有记录（包括重连中的运行）默认折叠；用户仍可手动开合。发送失败不折叠当前轮，午夜发送切换会话时以实际受理编号展开新一轮。OpenAI 兼容接口保留工具角色与推理元数据；Vertex 使用 functionCall/functionResponse 并回传 thoughtSignature。工具 JSON Schema 按 [FunctionDeclaration 官方定义](https://googleapis.github.io/js-genai/release_docs/interfaces/types.FunctionDeclaration.html) 使用 `parametersJsonSchema`。

神说复用角色私聊的 `buildChatContext`、核心聊天格式和聊天节奏规则，由 `services/godSays/promptBuilder.js` 统一组装。顺序为：破甲词 → 中文思考/回复要求 → 世界观 → 世界观强化（有世界观时）→ 共用工具与聊天规范 → 完整天使人格 → 神与天使的关系及用户资料 → 聊天节奏 → 当前会话原始历史。当前时间、日程、世界事件与实际执行状态放在末条 user 的 `<dynamic_context>` 内，用户原话在标签外收尾。日常聊天不用任务汇报语气，神谕汇报仍可列出结果与待办。

日程使用当前活动的情境与简短时间表，不再整段注入日程 JSON；明确计划不等于经历，休息中的天使仍可回应神。不注入往日摘要或记忆；升级前冻结前缀中的独立摘要层也会跳过。执行状态区分世界事实生效、任务受理、排队、失败、结果待核对及部分回应；详细结果仍由原工具读取。

接入既有预设/世界书组装器，提供真实 persona/static/cache/history 边界：缓存稳定区截止于聊天节奏规则末尾，不包含时间或历史。按位置模式的历史深度落在完整神谕轮次之前，避免插入原生工具调用与结果之间。共用组装器仅在神说显式启用结构化历史保留，工具编号、调用参数、推理元数据及 Vertex 签名原样回传；普通私聊默认行为保持原样。

## 界面与验证

2026-10-31 对话管理：归档弹窗替换为常驻左侧日期列表，手机可收起；头像和角色详情按钮打开可查看、编辑的天使详情卡；每轮回复下方增加删除按钮。沿用现有视觉与控件，去掉重复的归档入口和无用样式。日期切换、侧栏展开、详情页签与弹窗、删除反馈采用 300ms 过渡。

本轮 19 项相关后端测试、2 项前端测试及修改文件 ESLint 通过（保留 App 既有 unused-vars 和受控 v-html 警告）。浏览器隔离写入验证连续通过 3 轮，覆盖日期切换、往日只读、保存失败保留草稿／成功后刷新读回、删除取消／失败／成功后刷新；最后的资料排版及桌面侧栏调整又复验一轮。实际页面只读验证天使资料，未修改或删除真实对话；暖色／暗夜、1440px 桌面和 390px 手机截图已人工检查，无横向溢出。局部改动由主执行者自检，未做独立视觉评审或生产构建。截图与验证记录在 `output/god-says-management/`，其中 `live-*` 为真实只读页面，其余为同一 Vue 页面使用隔离 HTTP 数据；临时验证脚本已清理。

沿用暖纸/Cel Glow、既有 token 和 Linshe 控件，以天使徽记、金色光环和拱形轮廓表达云庭。页面切换、折叠、弹窗使用 300ms 过渡；手机输入区固定在底部。用户气泡不显示说话人标签；回到最新按钮悬浮于内容区右下角、输入区上方，无独立占位行，显隐过渡为 300ms。草稿本地保存，发送失败保留输入。

输入区按 Codex 的布局调整为整体圆角容器，文本和工具栏共用主题描边；左下保留思考状态，右下为高对比圆形发送／停止图标。复用 LinsheAutoTextarea 的显式 `embedded` 模式和 LinsheButton 的 `ink` 色调，普通表单与按钮默认皮肤不变。长文本最高 `min(240px, 30dvh)` 后滚动，发送／停止切换为 300ms 过渡。已在真实页面检查相邻内容，并用隔离页面检查暖色／暗夜、390px 窄屏、长文本、停止和往日只读状态；未发送真实消息，未做独立评审或生产构建。修改文件 ESLint 无错误，保留原有格式与受控 v-html 警告；截图在 `output/god-composer-css/`，临时验证页已清理。

2026-10-31 样式整理：保留既有会话顺序、完整思考内容和展开逻辑，仅调整纸面回复、浅珊瑚用户气泡、思考区横分隔、工具状态及输入区边界。辅助入口使用 LinsheButton 可选的中性 `muted` 色调，不改变其他调用者的默认皮肤。思考正文增至 `--fs-base`，展开仍使用既有 300ms CollapseTransition；没有删除或缩写用户可查看的文案。桌面保留原阅读宽度，内层浅底用于区分独立思考阶段，因此保留自动检查提示的长行和嵌套区域。

本次对 1245px 桌面、390px 手机、暖色／暗夜、思考展开／收起以及 2 倍像素密度截图做了检查，无横向溢出、图片加载错误或可读性告警；一轮独立视觉复核无必改项。真实会话验证思考展开，隔离预览验证键盘展开、记忆和归档入口，未发送真实消息。专项前端测试通过；修改组件 ESLint 无错误，保留已有受控 `v-html` 警告。未运行生产构建。截图保存在 `output/god-says-css/final/`，真实会话前后截图位于上级目录；隔离预览使用示例正文，验收后已删除。录屏工具编码失败，保留了动效探测和三帧截图，未将录屏记为通过。

专项测试：`agent-core/test/godSays.test.js`、`godSaysHttp.test.js`、`godSaysModules.test.js`、`web-ui/test/godSays.test.js`；Vertex 工具往返在 `vertexClient.test.js`。HTTP 测试使用内存数据库、本地模拟模型，并阻止外部网络请求。模块回归核对全部 75 个工具的目标路由均真实注册，并通过真实接口执行建群、邀请成员、写信、关系、话题、外观、媒体、世界观与表情包配置；模型 → 模块 API → 模型链路使用建群工具验证。群聊读取新增可选分页参数，原页面不传参数时仍返回完整记录。

旧版本升级会逐列补齐 `god_sessions.schedule_json`、上下文压缩字段、摘要重试次数和 `god_world_events.kind`，保留原对话。回归覆盖缺列旧表迁移重复执行，以及开启天使日程的真实 HTTP 聊天准备流程，避免仅测试全新内存库和关闭日程的情况。本机旧库已完成迁移，今天的天使日程快照已成功写入。

本轮 66 项相关后端回归、前端专项测试和 ESLint 通过；初版界面曾验证桌面、390px 手机、暖色/暗夜、思考展开、执行卡、记忆/归档切换、草稿恢复与发送失败恢复，并做过一轮独立视觉评审。此次界面仅将工具名称改为读取后端能力目录，继续复用原有显示方式。本机 API 已确认 85 个工具、小镇专属工具为 0、天使15项日程及会话日程快照正常。隔离测试未向真实居民投递或调用真实模型；未运行生产构建。初版截图保存在 `output/god-says-validation/`。

2026-11-01 神圣感改造：整页弃用 `LinsheButton`，改为页面自写的 `web-ui/src/components/godSays/GodSacredButton.vue`（`line / ghost / link / icon / pill / primary` 六变体，`gold / muted` 两种色调，`sm / md / lg` 三档尺寸，`disabled / loading / touchTarget` 状态）。按钮为 `div[role=button]` + 自包含样式，Enter/Space 触发，loading 时以旋转环替换内容，触屏 44px 热区；色值全部由 `--fun-gold` 与既有主题 token 派生，金色描线、刻字字距、悬停一次斜向流光、focus-visible 金环均在组件内部定义。

首屏 welcome 重写为「圣所式 hero」：`.sacred-sky` 内两层装饰 SVG——`sky-beam`（`#godBeam` 线性渐变光柱、`#godGlow` 椭圆辉光、5 条低透明度放射线）与 `sky-arch`（双层拱线、拱顶菱形光印、5 枚闪烁星点）；整体加 `mask-image` 上下渐隐，避免装饰硬边。天使外圈加 `.welcome-halo` 旋转光环，`welcome-kicker` 两侧加金线分隔。表头加金色细线与徽记悬停光环，输入区 focus 加金色微光。动效为光柱呼吸 7s、辉光 9s、星点 4.5s、光环旋转 12s，只改 opacity 与 transform；页面切换与折叠仍为 300ms。

验证：修改文件 ESLint 通过（保留既有受控 `v-html` 警告）；真实页面暖色与暗夜 1366×900 截图、390×900 暖色与暗夜截图（CDP 设备模拟）均无横向溢出（`scrollWidth === clientWidth === 390`，唯一越界元素为全局装饰 `div.bg-geo.bg-geo-2`，被页面裁剪）。移动端三枚建议词按 2+1 换行，发送/停止、思考折叠、执行详情、删除入口与历史导航均已换成新按钮。未做独立视觉评审或生产构建；未发送真实消息。

2026-11-01 日程与瞄一眼对齐系统：神说页「今日日程」不再用居中 `LinsheModal`，改为完全参考系统日程页的右侧抽屉——新增 `web-ui/src/components/godSays/AngelScheduleDrawer.vue`，结构与皮肤逐项照搬 `CharacterDetailDrawer.vue`：`Teleport` + `Transition name="drawer"`、420px 右侧滑入（手机全宽）、`.dr-header` 头像／名称／当前活动＋地点、时间轴 `.tl-item`（当前项绿点与「此刻」、悬停显示相机）、加载骨架与空状态；抽屉只保留「瞄一眼」操作（神说无居民聊天／日记／叫醒），Esc 与点击遮罩关闭，焦点进出回到触发元素。`GodAngelScheduleModal.vue` 改为数据容器：用 `useGodAngelMedia` 提供 peek 任务，把 `character.schedule` 传给抽屉（按 HH:MM 区间推断 `isCurrent`）。瞄一眼弹窗新增 `web-ui/src/components/godSays/AngelPeekFilm.vue`，模板与样式逐字照搬 `ScheduleView.vue` 的胶卷框：上下 20px 黑边 + 白色矩形齿孔、`.pk-body` 按奇遇 `aspect-ratio` 取景、环形进度（虚拟推进至 95%、出图即 100%）＋ 8 条拍摄文案 3s 轮播、出图时白色闪光与双帘幕快门、底部信息栏（头像／活动／地点＋「再拍一张」），点击图片用 `ImageLightbox`（`--vel-z-index:14000`）。验证：ESLint 通过（`AngelPeekFilm.vue` 的属性换行警告已修，仅剩既有受控 `v-html` 警告）；1440×900 暖/暗与 390×844 抽屉截图、1440×900 暖色胶卷框截图存于 `output/god-says-sacred/`（`schedule-drawer-warm/dark/mobile.png`、`peek-film-warm.png`），抽屉 14 条日程渲染正常、`scrollWidth === clientWidth`。未做生产构建。

2026-11-01 建议词池与华丽天使：① 建议词从固定 3 条改为 `SUGGESTION_POOL` 60 条（10 组，覆盖 inspect_neighbors、read_character、set_schedule、publish_moment、discuss_in_group、create_encounter、create_world_event、inspect_work、recall_memory 与通用寒暄），`suggestions` 改为 `ref`，`rollSuggestions()` 用 `Set` 去重后随机取 3 条；`onMounted`、`onActivated` 及 `watch(() => god.turns.length)` 归零时重掷。② `AngelEmblem.vue` 重绘（viewBox 120×120）：`defs` 内 `angelWingGrad`（羽翼渐变）、`angelRobeGrad`（袍渐变）、`angelCoreGlow`（星核径向光）与 `#angelWingShape`（外层＋中层羽翼＋三条羽线，右侧 `transform="translate(120 0) scale(-1 1)"` 镜像）；头顶金色主光环＋模糊光晕（`angel-core-pulse` 呼吸）、大眼与高光、睫毛、腮红、微笑，胸前星核脉冲，底部金色飘带；暗夜通过 `.god-welcome` / `.header-emblem` 上的 `--angel-wing-fill`、`--angel-wing-stroke`、`--angel-body-stroke`、`--angel-head-fill` 覆写为暖金圣像；`prefers-reduced-motion` 关闭动画。验证：ESLint 0 error（仅既有受控 `v-html` 警告）；1440×900 暖/暗与 390×844 暖/暗截图更新于 `output/god-says-sacred/`（`angel-warm.png`、`angel-dark.png`、`angel-mobile.png`、`angel-mobile-dark.png`，另有 `angel-zoom-warm.png`、`angel-zoom-dark.png` 局部放大）；连续多次加载建议词均不相同、各 3 条，`scrollWidth === clientWidth`。未做生产构建。该版 Q 版天使随后被同日的「天使立绘换为用户提供的 SVG」取代。

2026-11-01 天使立绘换为用户提供的 SVG：`web-ui/src/components/godSays/AngelEmblem.vue` 整文件换成用户给出的 560×560 二次元闭目天使——淡金长发与后发、三排层叠羽翼（`#angelWing` 内 18 片硬编码羽片）、白袍与金色羽饰发夹、顶部椭圆光环，`radialGradient` 柔光与 `mask` 底部渐隐，`filter` 投影加强羽片层次；只去掉原始 `metadata/c2pa:manifest` 与 `role/aria-label`，全部 `defs` id 加 `angel` 前缀避免与其它内联 SVG 冲突；新增 `focus` prop 切换 `viewBox`（`118 34 324 324`）供 header 裁到头部。`GodSaysView.vue` 同步：header 传 `focus`；welcome 移除 `.welcome-halo` 旋转神环与 `--angel-wing-*` / `--angel-body-*` 暗夜变量，`.welcome-angel` 改为 176×176（手机 136×136），暗夜改用 `drop-shadow` 暖金辉光。验证：ESLint 通过（仅既有受控 `v-html` 警告）；1440×900 与 390×844、暖色/暗夜四张截图存于 `output/god-says-sacred/angel2-warm.png`、`angel2-dark.png`、`angel2-mobile-warm.png`、`angel2-mobile-dark.png`，`scrollWidth === clientWidth`，建议词仍随机 3 条；未做生产构建。

2026-11-01 页头天使徽记收敛：顶部栏原来的方形卡片里塞整只天使，缩到 48px 后只露出带大光晕的白团、边缘生硬。`AngelEmblem.vue` 新增 `emblem` prop（`viewBox="154 48 252 252"`，只留头部与光环），并用 `v-if` 在徽记模式下隐藏 `#angelGlow` 大圆光、装饰羽毛与星芒；`.angel-emblem` 由 `overflow:visible` 改为 `hidden`（此前头发/长袍/翅膀会画到 viewBox 外，页头上溢出成竖长白块）。`GodSaysView.vue` 的 `.header-emblem` 改为 52px 圆形徽章（`--bg-secondary` 底、1px `--border` 描边、`padding:3px`、`overflow:hidden`），hover 金光收到圆内，消息头 `.speaker-emblem` 同样改圆形描边底；暗夜给徽记 SVG 加 `brightness(.94)` 压住白翼尖。验证：1440×900 暖/暗徽记实测 52×52、`scrollWidth === clientWidth`，截图见 `output/god-says-sacred/header-warm.png`、`header-dark.png`（另有 `-wide` / `-zoom` 局部放大）；移动端页头不显示徽记，无需适配。

2026-11-01 二次调整（按反馈）：① 发送／停止键改回墨色实心圆（`--text-primary` 底 + `--bg-secondary` 图标，hover 提亮 `--text-bright`，38px），不再使用金色渐变圣核，与 DSH 输入框发送键的实心圆语汇一致；② 输入区与内容「直接接触」：`.god-composer-area` 背景改 `transparent`、删除原先向上 34px 的渐变遮罩，顶部内边距 10→22px（移动端 8→16px），形成 DSH 式的框外留白且不与内容分块；③ `AngelEmblem.vue` 按 Q 版重绘（viewBox 120×120）：更大头部与双眼（固定深墨 `#33291f` 眼珠 + 白高光）、珊瑚腮红、微笑、云朵式三瓣羽翼、缩小的暖白袍身与胸前小星、下移贴头的光环与柔光外环；暗夜下 hero 天使以 `--fun-gold` 与 `--text-primary` 混出暖金圣像（翅 16%、身 24%），描边由 `gold 52%/55%` 与 `#7d5a12` 混合，避免黑翅剪影或深褐团。验证：ESLint 通过（仅既有受控 `v-html` 警告）；1440×900 与 390×900、暖色/暗夜四张截图更新于 `output/god-says-sacred/`，`scrollWidth === clientWidth`；实测发送键 38×38、背景 `rgb(51,51,51)`（暖）/`rgb(231,226,222)`（暗），输入区背景 `rgba(0,0,0,0)`、`padding-top:22px`。

2026-11-01 输入区改造与图片消息：① 往日对话（归档只读态）不再渲染输入区——`<footer v-if="!god.archiveId" class="god-composer-area">`，只保留顶部 `.archive-strip` 的「往日对话 / 回到今天」提示条；② `.god-composer` 内边距改 `12px 16px 10px`（移动端 `10px 14px 8px`），删除底部「✦ 思考已开启」与「Enter 发送 · Shift + Enter 换行」两段说明，工具栏左侧改为图片入口、右侧保留发送／停止；③ 图片消息：前端 `draftImages`（最多 4 张）＋隐藏 `<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" multiple>`，`+` 按钮（`GodSacredButton` icon md，移动端 44px 热区）唤出选择器，`.god-composer` 监听 `@paste` 直接接住剪贴板图片；`compressImageFile()` 用 canvas 把图压到长边 1600、`toDataURL('image/jpeg', 0.88)`，发送前在文本域上方显示 56px 缩略图（可逐张移除、`n/4` 计数、达到上限按钮禁用）；发送走 `god.send(images)` → `POST /api/god-says/runs { images: [dataUri] }`，成功后清空草稿图。后端：`god_runs` 增 `images_json`（`godSaysSchema.js` 建表 + `ALTER TABLE` 旧库补列），`repository.start(clientId, input, images)` 写入、`snapshot()` 每条 run 追加 `images`，`routes/godSays.js` 校验 data URI（≤4 张、单张 base64 ≤10MB、仅 png/jpeg/jpg/webp/gif/avif）并按真实 MIME 落盘 `/images/chat/<uuid>.<ext>`，`runtime.start` 把 `dataUris` 挂到 `started.run.imageDataUris` 传给 `buildGodChatContext`，后者在算完 `taskTarget` 后把末条 user 的 `content` 改为 `[{ type:'text', text }, ...image_url]`（`lorebook/engine.js` 对数组 content 已有前置插入分支），`messages.length` 与 `historyStart` 不变。用户消息附图渲染在气泡上方（`GodMessageImages`，`.god-user-images .image-hit img` 最高 240px，点击放大）。验证：前端 ESLint 0 error（仅既有受控 `v-html` 警告）；后端 `node --test test/godSaysImages.test.js` 8 pass、`test/godSaysPrompt.test.js` 7 pass、`test/godSays.test.js`＋`test/godSaysHttp.test.js` 17 pass；真实 POST 实测落盘 `/images/chat/<uuid>.png` 且 `GET /state` 的 run 回传 `images`；1440×900 暖色截图 `output/god-says-sacred/user-image-warm.png`（附图 384×240）、`composer-warm.png`、`composer-mobile.png`，切到历史日期后 `archive-history.png` 实测 `.god-composer-area` 与 `.god-composer` 均不存在，`scrollWidth === clientWidth`；README 未改；测试产生的 run 已删除，未做生产构建。

2026-11-02 回复区边界与思考区滚动（按反馈）：① 回复区与输入框交界恢复渐变过渡——`.god-composer-area` 加 `z-index:1`，并以 `::before`（`position:absolute; bottom:100%; height:56px; pointer-events:none`）叠加 `linear-gradient(to top, var(--bg-sunken) 0%, color-mix(in srgb, var(--bg-sunken) 55%, transparent) 55%, transparent 100%)`，手机端高度 36px；内容滚到输入框上方时逐渐淡出而非硬切，`.god-reading` 底部 36px（移动端 22px）内边距保证静止时最后一行不被遮住。② 思考区不再吞掉滚轮——删除 `.thinking-text` 的 `max-height:300px; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin;`，思考正文随内容自然展开，鼠标经过 `god-thinking` 时滚轮直接滚动整个 `.god-scroll` 会话区。同步更新 `docs/design-system.md` 神说段。验证：`web-ui` ESLint 0 error（仅既有受控 `v-html` 警告）。

2026-11-02 神说发帖动因提示词（按反馈）：`publish_moment` 的 `instruction` 参数由「本次朋友圈要求」改为「这次发帖的真实动因」——要求先交代此刻为何发生（意料之外的契机、角色莫名涌起的冲动、其他角色（绝非天使或神）的提议或要求、环境或身体的偶然触动等自然缘由），再落到分享的画面、语气与配图；以角色自身经历口吻写，不写成「神/天使让角色去做某事」的转述，也不点破授意者。`runtime.js` 的 `AGENT_RULES` 同步增加该写作口径；`momentForms.js` 的 `MOMENT_SINGLE_FOCUS_RULE` 补一句「动因为主时正文不必解释动因从何而来、是谁提议或要求的」。验证：`node --check` 通过；`node --test` 的 godSays（`test/godSays.test.js`、`godSaysPrompt`、`godSaysModules`、`godSaysHttp`、`godSaysImages`）与朋友圈（`momentOutputFormat`、`townNpcMomentGenerator`、`src/services/momentForms`、`momentTopicGenerate`）共 57 项全部通过。

2026-11-02 神说自主行动动因口径扩展（按反馈）：把 `publish_moment` 的动因写法推广到其它让角色自主行动的工具——`discuss_in_group` 的 `instruction` 改为「这场讨论的真实起因与要求」（先写清话题为何在此刻自然出现：群聊上文正好聊到、某个角色顺口提起、刚发生的一件小事、角色自己突然想聊的冲动、环境或身体的偶然触动等自然缘由；再写具体方向、语气与边界；不写成神/天使让群里讨论某事的转述，不点破授意者）；`create_encounter` 的 `instruction` 改为「这段奇遇的真实起因、场景与要求」（同理，其他角色绝非天使或神，不写成神/天使安排这场奇遇的转述）。`runtime.js` 的 `AGENT_RULES` 动因规则由只覆盖 `publish_moment` 扩展为覆盖 `publish_moment` / `discuss_in_group` / `create_encounter`。`groupChatEngine.js` 的 god_command 群聊指令前缀由「请围绕以下要求自然开展讨论」改为「请顺着下面的真实起因自然展开讨论（当作正在发生的事，不必复述起因，也不要写成被要求的转述）」。验证：`node --check` 三文件通过；`node --test` 的 godSays 六个测试文件 + `groupChatMention` / `groupRecentLogBlock` / `groupChatImageRuleEcho` 共 82 项全部通过。

2026-11-02 神说直接注入状态/变装（按反馈）：新增内部路由 `POST /api/items/inject` 与神说工具 `inject_character_state(character_id, kind, name, description, hours?)`，`kind ∈ outfit / hairstyle / transform / buff`，默认 24 小时、上限 168 小时，不消耗背包道具，直接复用现有落地链路：服饰/发型 → `createTemporaryLimitedOutfit`，变身 → `createTemporaryExclusiveOutfit`（到期恢复原形态），buff → `item_effects` 行并经 `buildBuffBlock` 注入「临时状态」。效果由一条 `status='used'`、`source_type='inject'` 的影子道具承载（`listBackpack` 只列 ready/generating，故不进背包列表），只在「生效中」面板以神写下的具体名称显示。为此 `ITEM_EFFECTS` 新增 4 个 `injectionOnly` 专用条目并在 `DROP_POOL_FILTERS` 与 `pickWorldLoot` 中排除，避免被宝箱/日报抽到；`listActiveEffects` 增加 `effect_text`（解析 payload）且注入类优先显示 `item_name`，`buildBuffBlock` 优先用 `effect_text`，`restoreExpiredTransforms` 同时处理 `god_inject_transform`。验证：`node --check` 六个文件全通过；`node --test` 的 `test/itemInjectState.test.js`（新增 5 项）+ `outfitService` + `newspaperService` + `godSaysModules` + `godSaysHttp` 共 38 项全部通过。

2026-11-02 执行详情入口增强（按反馈）：回复气泡底部的「查看执行详情」由 `variant="link" tone="muted"` 的灰色小字，改为 `variant="line" tone="gold"` 的金线胶囊——左侧加列表图标、右侧加工具数徽标（金色小圆显示 `turn.calls.length`）、末端加展开箭头（开合时 0.3s 旋转 90°），与正文的分隔线由普通 `--border` 改为 `--fun-gold` 20% 混合的淡金线，让入口更显眼、更想点开；展开内容仍由 300ms `CollapseTransition` 渐开，移动端按钮使用 44px 触达热区。思考折叠按钮与删除图标仍保持 `tone="muted"` 辅助层级，不抢主视觉。验证：`web-ui` ESLint 0 error（仅既有受控 `v-html` 警告）。

2026-11-02 工具执行状态归并到左侧圆标（按反馈）：删除工具行右侧 `.tool-state` 文字（原「已处理 / 处理中 / 暂未完成 / 需要核对」），状态集中到行首 `.tool-mark` 圆标——执行中为金色旋转环（`.mark-spinner`，0.9s 线性旋转），完成后 0.3s 交叉过渡为对勾（`.mark-check`），失败与待核对为琥珀色感叹号（`.mark-bang`），未执行/准备中为淡色圆点；圆标底色与描边随状态 0.3s 过渡（运行中金色、完成取 `--accent`、失败取 `--danger`）。状态语义保留在 `role="img"` 的 `aria-label`（沿用 `toolStateText`），视觉上不再出现重复文字。验证：`web-ui` ESLint 0 error（仅既有受控 `v-html` 警告）；实机用 DevTools 将 `.tool-mark` 切到 `running` 与 `done` 复核，金色旋转环与对勾及 0.3s 过渡均正常。

2026-11-02 用户消息右侧加「我」头像（按反馈）：`.god-user` 由纵向单列改为横向右对齐——左侧 `.god-user-bubble` 包住图片与文字气泡（`max-width:min(80%, calc(100% - 52px))`），右侧新增 36px 圆形 `.god-user-avatar`（`--bg-tertiary` 底、1px `--border` 描边、`overflow:hidden`）；有 `userConfig` 的 `userAvatar` 时显示头像、加载失败或未设置时以「我」字占位；`GodSaysView` 挂载时调用 `loadUserAvatar()` 拉取头像。图片消息同列右对齐、随气泡收窄不溢出。验证：`web-ui` ESLint 0 error（仅既有受控 `v-html` 警告）；实机 http://127.0.0.1:5173/#/god-says 复核用户气泡右侧头像显示正常。

2026-11-02 用户气泡书卷化与头像细节（按反馈）：① 用户头像由 36px 放大到 44px，`.god-user` 改 `align-items:center` 让头像与气泡垂直居中，气泡最大宽度相应收为 `min(80%, calc(100% - 60px))`；头像描边改淡金（`--fun-gold` 22% 混 `--border`）。② 用户气泡由浅珊瑚圆角改为暖纸书卷式：淡金渐变纸底 + 极淡横向纸纹、`--fun-gold` 34% 描边、不对称圆角 `18px 5px 16px 4px`，`::before` 在右上角画一处卷角缺口（`--bg-sunken` 抠角 + 金线），呈现略微破损的书卷与神圣感。③ 天使头像 `.speaker-emblem` 加入与朋友圈 `.moment-avatar` 同节奏的 hover：`transition transform/box-shadow .15s`，hover/focus-visible 时 `scale(1.08)` + 3px 淡金光环，并补 `cursor:pointer`。验证：`web-ui` ESLint 0 error（仅既有受控 `v-html` 警告）；实机复核用户气泡书卷样式、44px 头像居中、页头与消息内天使头像（及其 hover）均正常。

2026-11-02 书卷与头像 hover 再修正（按反馈）：① hover 与朋友圈 `.moment-avatar` 完全同节奏——`transition: transform .15s ease, box-shadow .15s ease`，hover/focus 时 `scale(1.08)` + `0 0 0 3px rgba(var(--accent-rgb), 0.25)`（不再用金色 `color-mix` 与 `--ease-standard`）。② 去掉头像白框——页头 `.header-emblem` 与消息内 `.speaker-emblem` 均移除 `padding:3px`、`border` 与 `background`，头像直接铺满圆形；用户头像 `.god-user-avatar` 也去掉描边。③ 用户气泡加强书卷感——纸底更暖（`--fun-gold` 18%→8% 渐变）、`--fun-gold` 50% 描边 + `inset` 金线、明显横向纸纹、圆角加大到 `22px 6px 20px 5px`，右上 20px 与左下 16px 双卷角缺口。验证：`web-ui` ESLint 0 error（仅既有受控 `v-html` 警告）；实机复核书卷气泡、无白框头像、天使头像 hover 一致。

2026-11-02 用户气泡改为展开卷轴（按反馈「不像书卷，换个思路」）：放弃圆角纸片 / 卷角缺口方案，改为一幅展开的卷轴——`.god-user-bubble>.god-user-text` 左右各留 `margin:0 16px`，纸面用两个 radial 金斑点 + `repeating-linear-gradient(0deg … 0 1px, transparent 1px 6px)` 横向纸纹 + 上下 `--fun-gold` 13%→9% 的浅金压边，`border-top/bottom:1px` 淡金线、`border-radius:2px`，并以 `inset` 上下阴影强化卷面弧度；`::before`/`::after` 为两根 `width:18px; top:-8px; bottom:-8px; border-radius:9px` 的深金圆柱卷轴柱（`linear-gradient(90deg, --fun-gold 55%+--text-primary → --bg-secondary 中段 → 反侧 60%+--text-primary)`，`border:1px` 深金，`inset` 高光 / 阴影做出圆柱体积），分别定位 `left:-15px` / `right:-15px`，比纸面上下各高 8px 形成轴头，`pointer-events:none`；头像 44px 与卷轴垂直居中。验证：`web-ui` ESLint 0 error（仅既有受控 `v-html` 警告）；实机截图确认两端卷轴柱与中间展开纸面、头像对齐、窄屏不溢出。

2026-11-02 用户气泡改为羊皮纸古典（按反馈「太丑了，再换风格」）：卷轴方案被否，改用羊皮纸古典——`.god-user-bubble>.god-user-text` 恢复 `margin:0; padding:16px 22px`，纸底为 `--fun-gold` 16% 混 `--bg-secondary` 的暖琥珀色，叠加 12%/18% 暖光与 88%/85% 暗角两处 radial、横/竖两组极淡纸纹，深墨描边 `--text-primary` 38% 混 `--fun-gold`、不规则圆角 `4px 7px 4px 8px / 7px 4px 8px 4px`，`inset` 金线 + 22px 做旧内阴影 + 外投影，右下角 18px 折角 `::after`；删除两根卷轴柱。验证：`web-ui` ESLint 0 error（仅既有受控 `v-html` 警告）；vite HMR 已自动热更新至用户浏览器。

2026-11-02 用户气泡改为宣纸风格（按反馈「换成宣纸风格」）：`background-color:color-mix(in srgb, var(--bg-secondary) 94%, #fff)` 米白宣纸底，`background-image` 仅保留横/竖两组极淡纸纤维（`--text-primary` 1.6% / 1.2% 细线），`border:1px solid color-mix(in srgb, var(--text-primary) 24%, transparent)` 淡墨细边，`border-radius:3px 5px 4px 6px / 5px 3px 6px 4px` 干净小圆角，`box-shadow:0 1px 4px --text-primary 7%` 轻投影；移除折角 `::after` 与琥珀/做旧重色。验证：`web-ui` ESLint 0 error（仅既有受控 `v-html` 警告）；vite HMR 已自动热更新。

2026-11-02 用户气泡加神圣感（按反馈「太普通了，没有神圣的感觉」）：在宣纸底上叠加圣典装饰——顶部 `radial-gradient(ellipse at 50% -10%)` 柔金圣光、底部反向微光，背景保留极淡纸纤维；`border:1px solid --fun-gold 55%` 外金边，`inset 0 0 0 3px bg-secondary 72%` + `inset 0 0 0 4px --fun-gold 26%` 形成内嵌金细线双框；`inset 0 0 26px --fun-gold 10%` 与 `0 0 20px --fun-gold 24%` 内外柔金光晕，圆角 6px；`::before`/`::after` 在左上、右下各画一枚 14px 金色 L 形角饰（1.5px 金线、首尾圆角、opacity .8）。验证：`web-ui` ESLint 0 error（仅既有受控 `v-html` 警告）；vite HMR 已自动热更新。

2026-11-02 用户头像对齐文字气泡（按反馈「头像应该是悬浮在文字气泡右侧，不要统计图片的高度」）：把用户头像从 `.god-user` 的 flex 同行移入 `.god-user-bubble` 内、与文字气泡同放新的 `.god-user-text-line`（`display:flex; flex-direction:row; align-items:center; justify-content:flex-end; gap:12px; min-width:0; max-width:100%`）；`.god-user` 改为 `flex-direction:column; align-items:flex-end`，图片仍在气泡上方，因此头像只与文字气泡垂直居中、不再被附图高度拉低；`.god-user-text` 选择器由 `.god-user-bubble>.god-user-text` 收敛为 `.god-user-text` 并加 `min-width:0`。验证：`web-ui` ESLint 0 error（仅既有受控 `v-html` 警告）；vite HMR 已自动热更新。

2026-11-02 用户消息附图右侧留白（按反馈「图片要留出头像的宽度这么宽的间距，也就是往左移」）：`.god-user-images` 加 `margin-right:calc(44px + 12px)`，使附图右缘与文字气泡右缘对齐、右侧腾出与头像（44px 加 12px 间距）等宽的空列，头像仍悬在最右；图片多高都不影响头像位置。

2026-11-02 用户气泡改为游戏化硬描边暖纸（按反馈「气泡还是不满意，再换」）：放弃细金渐变/圣典路线，改为复用小镇 `TownDialogueStage.vue` 的对话气泡语言——`.god-user-text` 用暖金奶油渐变底（`--fun-gold` 10%→18% 混 `--bg-secondary`）、`2px solid` 墨棕硬描边（`--text-primary` 58% 混 `--fun-gold`）、`border-radius:16px 16px 4px 16px`（右下小尖角指向头像）、`0 4px 0` 实心厚底 + `0 10px 20px` 软投影 + `inset 0 0 0 1px --fun-gold 26%` 金内线；删除上一版两枚金 L 形角饰。验证：`web-ui` ESLint 0 error（仅既有受控 `v-html` 警告）；vite HMR 已自动热更新。

2026-11-02 用户气泡改为做旧撕边羊皮纸（按参考图「仿一下这种感觉」）：`.god-user-text` 改为透明底 + `isolation:isolate`，`::before` 铺土黄做旧纸（`--fun-gold` 26%→40% 混 `--bg-secondary` 渐变 + 顶部暖光 + 三处褐斑 + 横向纤维 + 左右 9% 卷边暗带），并以 `filter:url(#god-torn-paper) drop-shadow(0 5px 8px …)` 生成撕边与外投影；模板在 `<main class="god-page">` 顶部新增 0×0 内联 SVG `#god-torn-paper`（`feTurbulence type=fractalNoise baseFrequency="0.012 0.05" numOctaves=4 seed=9` + `feDisplacementMap scale 9`）；文字在主元素、不受滤镜影响。验证：`web-ui` ESLint 0 error（仅既有受控 `v-html` 警告）；vite HMR 已自动热更新。

2026-11-02 用户气泡改用「月星楷」手写字体（天使回复保持默认字体）：复用信件/日记同一套手写字体库 `web-ui/src/composables/useHandwritingFont.js`（`loadFont(fontId)` 动态注入字体 CSS、`getFontFamily(fontId)` 返回 font-family 栈 + `STKaiti/KaiTi` 回退）。GodSaysView 选择 `moon_stars_kai`（月星楷，星空梦幻楷体、笔画带柔光）：`USER_BUBBLE_FONT_ID` 常量 + `userBubbleFontStyle`，`onMounted` 里 `loadFont('moon_stars_kai')`，`.god-user-text` 通过 `:style="userBubbleFontStyle"` 应用；`.god-reply-text`（天使回复）不设该字体、保持默认。验证：`web-ui` ESLint 0 error（仅既有受控 `v-html` 警告）；vite HMR 已自动热更新。

## 手机选图兼容

神说与朋友圈共用 `web-ui/src/utils/imageUpload.js` 的图片选择策略和文件识别：手机及 AndroidBridge 网页壳使用单选相册，逐张追加到草稿，神说仍最多附四张；桌面保留多选。此策略规避部分安卓 ROM 多选返回后不触发 WebView `change` 的问题，无需升级 APK。图片 MIME 缺失或为通用二进制类型时按扩展名识别；读取失败保留其他附件并显示错误。
