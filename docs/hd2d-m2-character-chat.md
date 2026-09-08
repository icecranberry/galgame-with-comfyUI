# M2 角色原聊天接口适配

## 前端接口

角色舞台直接复用 `POST /api/characters/:characterId/chat`，继续使用现有消息历史、聊天 store、SSE 解析和统一流通知。请求示例（ID/epoch 取最新小镇快照，下面仅示意）：

```json
{
  "message": "今天过得怎么样？",
  "client_msg_id": "本条消息的稳定唯一ID",
  "image_mode": "smart",
  "deep_think": false,
  "townContext": {
    "worldId": "快照.worldId",
    "worldEpoch": 1,
    "actorId": "被点击角色.actorId"
  }
}
```

路径 ID 使用角色的 `characterId`，不是 actorId 或 npcId。已邀请 NPC 关联角色后也使用此接口及角色历史；未关联角色的轻量 NPC 保持原 NPC 接口。

`townContext` 必须恰好含上述三个字段，不传玩家坐标、地点名称、场景 prompt。后端核对持久 world/epoch、未归档且在镇的 actor 与角色绑定、当前运行时世界和唯一角色实体、玩家身份，再从服务端路径时间取得双方已完成移动的格位置。曼哈顿距离须不超过 2 格。客户端插值、目标地点和显示台词不作位置证明。

校验失败在 SSE 开启之前返回 `{ "error": "可展示原因", "code": "TOWN_CHAT_..." }`：格式错误为 400；世界过期、身份/场景变化、未就绪或距离过远为 409。`TOWN_CHAT_TOO_FAR` 提示走近后重发；其余 409 刷新快照并重新选择目标。不要自动删除 townContext 后重试。

现有 `api.chatStream` 对非 2xx 均重试，舞台接入时须为这些 400/409 直接展示错误并停止重试，保留 5xx/网络错误的原策略；保留响应 `code`。本后端工作未改前端文件。

## 行为边界

- 缺省 townContext 完全沿用普通聊天；显式 null 视为无效，普通聊天应省略字段。
- townContext 是客户端提交的发言入场标识；guard 将服务端校验后的现场存入 `req.townAdmission`，route 在原 `dynamicBlocks` 追加发送时面对面现场说明。用户原文、稳定人格、统一历史、情绪、记忆、日程/睡眠、延迟回复、深度思考、配图及 SSE 处理函数保持原样；没有建立另一套小镇角色会话。非镇内请求在没有符合条件生活记录时，prompt 字节保持不变。M2 现场块 `buildCharacterTownSceneBlock` 单独保证无 townAdmission 时返回空字符串；M6 生活记录动态块也可用于普通私聊，范围与排队边界见 [M6 私聊生活记录](hd2d-m6-chat-life-context.md)。
- 继续接受原 JSON `queued` 响应及原 SSE 事件。睡眠梦话仍可返回 SSE 并同时排队；舞台不能假设发言必定即时完成。
- 当前服务端只在接受请求时校验镇内资格，不在模型完成时撤销已接受的普通聊天。关闭舞台、走远或地图重建后，已接受回复仍进入原角色历史；舞台须按 actor/角色/页面会话代次隔离迟到消息，避免显示到另一个角色。
- 现场动态块明确描述消息发出时的面对面交谈，不保证回复时双方仍在原地。地点由角色实际已完成整步的 cell 匹配 POI，不读取 `agent.targetloc`；未匹配时使用“镇上的道路”。地点名称作为场景数据处理，聊天台词不能证明交易、奖励或新约定已成立。
- `queued` 早返回保持原语义，不经过后续动态块组装，也不将镇内场景上下文另行持久化到延迟队列。现场说明不拼进用户原文，不额外建立人格或历史库。
- 未新增专用聊天服务：现有 HTTP 即为完整复用边界。`characterChatTownContext.js` 导出可注入连接/快照的校验、中间件及 `buildCharacterTownSceneBlock`；routes/chat.js 使用前置守卫与动态块构造函数。

## 验证

在 `agent-core` 执行 `node --test test/characterChatTownContext.test.js`。

2026-09-08 main 报告现场动态块补丁的 11 项 guard/context 测试通过；本次前端文档同步核对了实现，未重复运行后端测试。

测试使用显式 `:memory:` SQLite 和服务端快照 fixture；路由源码只替换 import 依赖边界，不加载生产 DB/config/模型图。验证输入/身份/epoch/位置隔离、普通聊天无条件旁路，以及真实排队分支的历史原文、延迟字段和 client_msg_id 去重。完整真实模型、图像生成、浏览器流及延迟调度器端到端未运行。
