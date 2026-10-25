# cortico-world-qq-linshe

「邻舍风格输出分句」——Cortico 的 World 扩展，内置 QQ World 的变体（World id `qq-linshe`）。出站文字按邻舍风格的聊天节奏分句：长回复不再整条糊出一屏，而是拆成多条短消息依次发送，一句一条。上游 Cortico 源码保持零改动，整个适配以扩展形式存在。

## 行为

- **起草时冻结分段**：`qq_draft` 把正文拆成若干段并给出各段预览；`qq_confirm` 确认后按序发送。
- **断句规则**：句号与换行是主断点（每段剥掉句尾的句号后独立发送）；较长的句子在感叹/疑问标点与逗号停顿处再断开；短句中的感叹/疑问标点保留并与相邻句子合并。分句由独立的 SentenceSplitter 实现（流式与整段共用一套规则）。
- **图片与引用回复只附在第一条**；语音条独占一条消息，不参与分段。
- **推送节奏**：段与段之间按打字节奏停顿——300~900ms 随机，随刚发出那段的长度变长（封顶 30 字），带随机抖动；首段立即发出。轮次被取消时停在原地，余段保留。
- **失败续发**：某段发送失败时保留剩余段落并报告进度，再次确认只补发未发出的部分；中途取消丢弃余段。
- 每段回录为独立的 `qq.self` 事件，历史与引用行为与上游单条发送一致。
- 除发送拆分外，与内置 QQ World 功能完全一致（连接、监听名单、辅助视觉、历史查询工具）。

## 工作方式

- 默认导出整体继承内置 qq 定义（`defaults` / `describe` / 事件声明原样复用），只换 id 与 `create`；装配代码与内置定义逐行对应，唯一的差别是把模块换成 `SegmentedQQWorld` 子类。
- `SegmentedQQWorld` 继承 `QQWorld`，只在 `tools()` 里包装 `qq_draft` / `qq_confirm` 两个 handler，不复制上游发送逻辑。
- 分句模块当前以相对路径引用宿主仓库的共享实现（`agent-core/src/utils/sentenceSplitter.js`）；独立发布 npm 前需将该模块随包打包。

## 配置

- 部署配置段为 `worlds.qq-linshe`，字段与 `worlds.qq` 完全相同（wsUrl / token / groups / privates / vision）。
- **内置 `qq` World 必须保持停用**：两者提供同名工具，同时挂载会被装配层拒绝其一。
- World 页不提供自定义面板（面板客户端按 page id 从框架构建清单解析，扩展 id 拿不到内置 qq 的 bundle）；状态灯、徽标与配置页签照常可用，监听名单在配置页签编辑。

## 兼容性与验证

- 依赖上游三个内部缝隙：工具名 `qq_draft` / `qq_confirm` 与回执前缀（`[draft staged`、`[sent`、`[no draft`）、`sendToTarget` 私有方法、`pendingDraft.target` 字段。构造时逐一探针，缺失即抛错，不会静默走样。
- `pnpm check:extension` 会报 4 条「与内置 qq 工具重名」——检查器的假部署同时构造两个 World 所致；真实部署停用内置 `qq` 即无冲突。
- 行为回归由 `agent-core/test/corticoSegmentedQQ.test.js` 对真实上游类验证（分段顺序、图片/引用只附首段、语音不拆、失败续发、中途取消、轮末作废等 9 个场景）。

手动验证：

```bash
cd Cortico
pnpm exec tsx scripts/extension-describe.ts ../agent-core/src/cortico-bridge/qq-segmented
pnpm exec tsx scripts/extension-check.ts ../agent-core/src/cortico-bridge/qq-segmented
```
