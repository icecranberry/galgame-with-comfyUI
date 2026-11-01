# 神说

角色列表顶部的常驻入口打开 `/#/god-says`。用户以神的身份与独立系统角色「天使」交流；天使不进入普通角色、随机发帖、群成员或好感度候选池。

## 行为

- 天使人格复用邻舍角色生成器的完整模板（身份、性格、好恶、外观及 VAD 基线），首次使用自动生成并持久化至 `god_angel`，之后聊天、日程共享该人格。旧版固定人设自动升级，已自定义的人设保留；并发生成合并，失败记录原因并冷却重试，不把占位人格当作生成成功，也不写入普通居民表。生成后刷新当前日程模板，历史会话快照保持不变。
- 日常聊天复用当前 LLM；天使日程复用现有生成与校验服务，独立保存，跟随全局日程开关和刷新间隔。日程是计划，不作为活动完成的依据。
- 世界事件先持久化事实和随机回应对象，再异步投递。默认 2–4 位角色发朋友圈、1–2 个群聊讨论，对象不足时按实际数量执行。默认全体感知，主动回应范围与感知范围分开。事实默认持续 180 分钟，工具可指定时长、范围或替代旧事件。
- 角色命令支持读取资料/日程、安排今天或未来活动、指定朋友圈/群聊主题、开启奇遇。建筑服务仍由奇遇选项推进，不代替玩家选择。
- 排队、安排、开启奇遇和完成明确区分；工具失败或缺少能力时由天使自然说明，不编造成功。

当前共有 85 个工具：原有 9 个核心工具、`list_capabilities` 能力查询，以及 75 个模块工具。模块工具在 `services/godSays/moduleTools.js` 中逐个绑定既有业务接口；模型不能提供任意 URL、HTTP 方法或额外请求体。`localApi.js` 通过当前服务的 loopback 地址调用原路由，保留各模块的校验、冷却、库存、睡眠、后台任务和推送逻辑。JSON Schema 与服务端共同校验，没有任意 SQL 或脚本工具。按用户要求，小镇专属工具不接入。

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
| 记忆 | 按角色搜索往事、分页浏览片段；天使私有记忆仍独立 |
| 相册 | 按角色/文件夹查图、图片实验室生图并发送到神说、生图任务与待确认草稿 |
| 角色 | 招募、读取/创建/切换专属外观、生成头像；核心工具读取资料 |
| 立绘 | 场景立绘、表情立绘、生成待确认的立绘草稿 |
| 表情包 | 素材/类别、创建/启停配置组、生成单个表情提示词和图片 |
| 媒体 | 媒体/板块/内容、后台刷新与状态、创办媒体、新建板块、收藏、门户正文 |
| 日报 | 今日/往期目录与正文、遵循原条件补发 |
| 世界观 | 查询、新建、修改、按神明确要求激活；世界事件仍使用核心工具 |
| 预设 | 只读已保存预设的目录和启用状态 |
| 素材库 | 查询/新增朋友圈话题与奇遇类型 |
| 语音 | 读取角色音色绑定、朗读已保存消息、查询语音任务 |

系统凭据、服务安装/重启、任意文件读写和整库清理不作为对话工具；通知/SSE 继续作为各模块的推送通道。人物参考、外观和生图仍由原业务入口统一组装。私聊/评论/发信/用户动态工具只在神明确要求传达时使用。

`generate_image` 直接调用图片实验室 `POST /api/images/test-style` 的自由画面链路，固定使用 `chat` 场景。`prompt` 为完整中文画面描述，`width` / `height` 可分别覆盖本次尺寸（256–4096 整数像素），省略时读取当前对话分辨率；不改变全局设置。可选 `artist` 覆盖本次画师风格，未传入时沿用对话设置。天使自拍须根据自己的人设完整描述外貌，普通居民的参考资料匹配仍由原接口处理。

神说请求固定附带 `saveToChat: true`，成功后图片存入聊天图片目录，完成任务写入 `image_tasks`（`conversation_id='god:angel'`），返回本地 URL、尺寸与任务编号；图片实验室原页面仍仅预览，不会被默认保存。模型、工具日志与 SSE 不携带图片 base64。对话在对应工具调用处显示成图并复用 `ImageLightbox` 放大/下载，支持断线重连和往日回看，进出动效为 300ms。生图失败不插图，也不声称发送成功。

## 运行与存储

每轮对话可从回复下方删除，支持今日和往日。删除前确认范围；同一天仍在回应或正在归档时返回 409，避免已删除内容被正在运行的上下文或总结重新写回。删除事务清理该轮消息、工具记录和 SSE 重放数据，清空本日摘要、长期记忆与上下文压缩，下一次归档按剩余对话重建。`god_runs.deleted_at` 保留空内容幂等墓碑，防止旧发送标识重新执行；已经受理的世界事件及投递保留，删除对话不撤销业务结果。

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

日期固定为 `Asia/Shanghai`，普通居民日程仍使用既有主机当地日期。后台每分钟检查跨日归档，旧日运行结束后才总结。摘要失败保留原文并有限重试，历史界面可重新整理。无对话的日期不自动创建空档案。私有记忆不注入普通居民聊天。长上下文按完整运行边界压缩，保留最近两轮和工具配对。

## 模型与提示词

原生工具流与普通聊天使用相同日志输出工具：每轮标注运行 ID / 轮次，打印请求消息（图片压缩显示）、模型、工具列表、服务商返回的思考、正文、工具调用和 token 用量。失败、取消或流中断保留已经收到的文本，遥测只记一次；不会为了日志重放请求。人格生成日志标签为 `创造角色:天使`。

人格与日志改动通过 35 项相关后端测试，覆盖生成并发与持久化、失败冷却、自定义人格保留、旧库迁移、共享生成器与参考资料边界、原生工具 HTTP 往返及中断日志。本机已实际生成并保存完整天使人格，日程已重新生成；对话工具验证使用隔离模型与数据库。

强制开启思考，覆盖全局关闭选项；模型必须支持原生工具调用。正文、服务商可展示的思考和工具记录分别流式显示，不伪造思考。没有返回可展示思考的模型不会被补写思考。思考展开由前端 `useGodThinking` 按运行编号管理：本次停留中新受理的一轮默认展开，正文开始、原生工具续轮及本轮结束均不自动收起；下一轮受理后折叠先前思考，离开页面后清除展开状态。重新进入页面或切换日期时，已有记录（包括重连中的运行）默认折叠；用户仍可手动开合。发送失败不折叠当前轮，午夜发送切换会话时以实际受理编号展开新一轮。OpenAI 兼容接口保留工具角色与推理元数据；Vertex 使用 functionCall/functionResponse 并回传 thoughtSignature。工具 JSON Schema 按 [FunctionDeclaration 官方定义](https://googleapis.github.io/js-genai/release_docs/interfaces/types.FunctionDeclaration.html) 使用 `parametersJsonSchema`。

神说复用角色私聊的 `buildChatContext`、核心聊天格式和聊天节奏规则，由 `services/godSays/promptBuilder.js` 统一组装。顺序为：破甲词 → 中文思考/回复要求 → 世界观 → 世界观强化（有世界观时）→ 共用工具与聊天规范 → 完整天使人格 → 神与天使的关系及用户资料 → 聊天节奏 → 往日/今日摘要 → 当日原始历史。当前时间、日程、召回的长期记忆、世界事件与实际执行状态放在末条 user 的 `<dynamic_context>` 内，用户原话在标签外收尾。日常聊天不用任务汇报语气，神谕汇报仍可列出结果与待办。

日程使用当前活动的情境与简短时间表，不再整段注入日程 JSON；明确计划不等于经历，休息中的天使仍可回应神。往日摘要和记忆按日期标注，长期记忆使用自然文本并保留偏好/约定/事件/关系分类。执行状态区分世界事实生效、任务受理、排队、失败、结果待核对及部分回应；详细结果仍由原工具读取。

接入既有预设/世界书组装器，提供真实 persona/static/cache/history 边界：缓存稳定区截止于聊天节奏规则末尾，不包含时间、摘要或历史。按位置模式的历史深度落在完整神谕轮次之前，避免插入原生工具调用与结果之间。共用组装器仅在神说显式启用结构化历史保留，工具编号、调用参数、推理元数据及 Vertex 签名原样回传；普通私聊默认行为保持原样。记忆总结使用原始客户端，不二次注入世界书。

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
