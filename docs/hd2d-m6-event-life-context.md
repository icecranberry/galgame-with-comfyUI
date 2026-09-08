# M6 首次奇遇生成的只读生活背景

仅 `eventGenerator.generateEvent(character, options)` 在原 `chatSync`（奇遇生成）调用前读取 `createCharacterTownLifeContext`。严格 `features.town === true`，使用主角色 `character.id`、当前 registry/world epoch、当前时间和 `config.town.timeZone`。共享 reader 返回的 JSON 事实块完整保留，原 1800 字符上限不变；外层另加固定背景说明。

说明明确：记录属于主角色此前生活，不是本次已发生情节，不要求引用或复演；不能替换用户方向、日程起点和事件选择，不能据此新增经历、奖励、解锁或约定；预约不证明已赴约、见面或其他角色共同参与。即使原多人模式选中关系角色，也只读取主角色记录。

无记录不添加消息，读取异常降级为原生成流程。原 JSON 示例、字段和解析不变，稳定人格、事件类型选择、日程、活跃事件保护、图片和广播流程不变。没有新增奇遇触发、模型调用或结算行为。`generateNextBranch` 和 `concludeEvent` 原样保留，不向选择结果或结局记忆摘要引入新的生活背景。

## 定向验证

`agent-core/test/eventTownLifeContext.test.js` 读取并编译完整生产模块，在 import 边界注入依赖，运行真实 `generateEvent` 和原 JSON 解析、事件写入流程。仅使用显式内存库；生活 reader 在 query_only 下运行。模型返回固定 JSON，图片、图片记录和广播均为本地 fake，不访问网络、不写图片文件、不发送真实消息、不启动 scheduler。

独立 **5/5** 通过：

- 当前 canonical 主角色记录进入，关系角色、旧 epoch、其他 world 排除；原多人人格仍保留。
- 原 1800 字符事实块与真实 reader 输出完整一致，背景不直接复制到事件字段、图片参数或广播内容。
- 无数据、关闭或非布尔 feature gate 时，完整 msgs/options 逐字节一致。
- 下一次首次生成按当前 epoch/时刻读取，读取失败不阻断原自定义方向生成。
- 活跃事件仍在读取和新增模型/图片/广播调用前拒绝；正常每次生成仍为一次 fake 模型、一次 fake 图片、一次 fake 广播。

与 `characterTownLifeContext.test.js`、`characterTownAppointments.test.js` 定向联跑 **23/23 通过，0 失败**，耗时约 457ms。日志：`output/hd2d-event-life-context.log`。未运行全量套件。

## 边界

测试证明接入、存储和调用边界，不证明真实模型绝不会将背景编写为虚构情节。没有新增模型输出的事实核验器。首次主调用前当前没有 await；模型内部 slot 等待及生成中 reset 的取消/晚响应隔离未实现。本切片不声称覆盖分支、结局或长期记忆生成。
