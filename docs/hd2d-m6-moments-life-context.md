# M6 原朋友圈生成的只读生活记录

`routes/moments.js` 仅在原 `generateMomentPost` 的 `chatSync` 调用前，按主角色 ID 调用 `createCharacterTownLifeContext`，将非空记录作为 system 消息插入末尾 user 消息之前。既有 `buildCharacterPersona`、JSON 输出示例与解析协议未变。

必须同时满足 `config.features.town === true`、`!isFreeMode` 和 `!isSpecialMode`。原模式中，小于5%的分支是做梦/幻想，5%至15%为自由发挥；话题库为空也回退自由模式。上述三种均不注入现实记录。关闭、无记录或读取失败时，消息列表不新增空块，原流程继续。

数据来自共享只读适配器：当前 world/epoch、当前参与主角色的最近72小时最多三条经历及最多三条未来预约，沿用长度与转义边界。预约仍是未来安排，不代表见面、到达或空闲保证；发型卡记录不表示已经使用。没有读取配角的生活记录。

本切片不新增发帖触发、模型调用、图片生成、任务表、经济操作或正式活动卡 adapter。原朋友圈流程自身的发帖和配图保持原样。记录在模型分发前同步读取，不缓存到排队任务或角色对象。

## 验证范围与状态

独立 `agent-core/test/momentsTownLifeContext.test.js` 加载完整 route 源码并替换 import 边界：模型、图片、帖子写入、广播及定时器均为隔离 fake；共享生活记录、registry 与内存 SQLite 读取使用真实模块，读取期间开启 `query_only`。没有真实存档、真实模型或外发帖子。

已验证场景包括关闭/空记录与原请求逐字节一致，自由/梦境/空话题排除，当前 epoch 主角色记录，读取失败降级，排队等待后读取新增记录，以及预约不当作已见面。测试中的经历与预约行是读取边界 fixture，不替代正式结算及预约来源校验的上游测试。

CPU 窗口结束后运行 `cd agent-core && node --test --test-reporter=spec test/momentsTownLifeContext.test.js`：**5 tests / 5 pass / 0 fail**，耗时179.452ms。未运行全后端，也未调用真实模型、图片服务或发送真实帖子。
