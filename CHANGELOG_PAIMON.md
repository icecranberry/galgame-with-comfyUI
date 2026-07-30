# Paimon 分支更新说明（2026-07-30）

本版本集中更新聊天记忆 RAG、绘图提示词知识库和聊天生图链路。运行数据库、聊天记录、API Key、Chroma 落盘数据与本地生成图片均不包含在提交中。

## 主要更新

### 1. 聊天记忆系统重构

- 记忆单元改为 `judgment / reasoning / tags / memoryType`，类型包括 `knowledge / skill / emotion / event`。
- 每个完整 `user → assistant` 轮次在后台整理记忆，不再累计 10 条用户消息后批量提取。
- 支持 `create / update / merge`：更新和合并采用不可变版本，新记忆生效后旧记忆标记为 `superseded`。
- SQLite 成为权威数据源：先保存正文，再异步建立向量索引。嵌入服务不可用时仍可保存和使用文本召回。
- 增加敏感凭据过滤，疑似密码、API Key、Token 或银行卡号的内容拒绝写入长期记忆。
- 增加提取 checkpoint、版本关系、索引任务和召回审计。

### 2. 四种聊天记忆召回模式

系统支持以下组合，并在外部服务失败时自动降级：

1. SQLite 文本召回；
2. 文本召回 + 重排序；
3. 文本召回 + 嵌入向量；
4. 文本召回 + 嵌入向量 + 重排序。

文本通道使用 SQLite FTS5/BM25 与中文 n-gram；向量和文本候选通过 RRF 融合，可选重排序模型进行最终排序。

### 3. 嵌入与重排序供应商设置

新增“系统设置 → 聊天记忆”二级页面，包含：

- 聊天记忆总开关；
- 嵌入供应商、地址、模型、API Key、维度、超时和附加请求头；
- 重排序供应商、地址、模型、API Key、返回数量、超时和附加请求头；
- 连接测试、召回候选数量、最终注入数量；
- 有效记忆、已索引、索引失败统计；
- 重建聊天索引和重试失败任务。

嵌入预设：OpenAI、硅基流动、Jina AI、自定义 OpenAI-compatible。

重排序预设：Jina AI、Cohere、硅基流动、Voyage AI、自定义 Jina/Cohere-compatible。

API Key 只保存，不通过配置读取接口回显明文。硅基流动的固定维度嵌入模型不会发送不兼容的 `dimensions` 请求参数；配置维度仍用于模型 profile 与索引隔离。

### 4. 聊天向量集合隔离

- 聊天记忆使用外部嵌入模型生成向量，写入独立的 `memory_v2_<profile>` Chroma collection。
- profile 根据供应商、地址、模型和维度生成；切换嵌入模型后只重建聊天记忆索引。
- 绘图知识库继续固定使用本地 Jina ONNX 与 `image_prompt_knowledge` collection，不受聊天记忆供应商设置影响。
- 嵌入和重排失败仅影响当前增强通道，SQLite 正文与文本召回保持可用。

### 5. 记忆删除、撤回与清空一致性

- 单条记忆软删除时同步排队删除对应向量。
- 撤回对话轮次时删除该轮产生的记忆与向量；若该轮更新了旧记忆，则恢复前一版本并重新索引。
- 清空角色聊天时同时清理该会话的记忆正文、版本关系、checkpoint、审计记录、索引任务和聊天向量。
- 失败重试同时覆盖向量写入和向量删除任务。

### 6. 绘图提示词知识库 RAG

- 新增内置绘图提示词知识与标签数据，并在数据库初始化时幂等播种。
- 增加绘图知识检索、规则选择、标签匹配、冲突处理和提示词准备流程。
- 绘图知识 RAG 与聊天记忆 RAG 使用独立 corpus 和嵌入路径。
- 图片任务分别记录原始提示词与优化后提示词，便于审计生成链路。

### 7. 聊天生图回空修复

- 生图二次提示词调用收到 HTTP 成功但空内容时，自动重试一次。
- 连续空响应或调用异常时，将预创建图片任务更新为 `failed`，不再残留 `pending`。
- 提示词验证通过前不写入 `raw_messages/messages`，避免空 assistant 消息和空气泡。
- 兼容纯文本和旧版 `{"prompt":"..."}` 返回格式，JSON 包装不会整体传入 ComfyUI。
- 生图成功后保存实际优化提示词、输出路径和工作流模式。

## 新增或调整的接口

### 记忆配置

- `GET /api/config/memory`
- `PUT /api/config/memory`
- `POST /api/config/memory/test-embedding`
- `POST /api/config/memory/test-reranker`

### 记忆管理与检索

- `GET /api/memory/fragments`
- `DELETE /api/memory/fragments/:id`
- `GET /api/memory/search`
- `GET /api/memory/stats`
- `GET /api/memory/index-jobs`
- `POST /api/memory/reindex`
- `POST /api/memory/retry-failed`

当前前端设置页展示记忆数量和索引状态；逐条记忆内容、来源对话和召回审计尚未做成可视化管理面板，可暂时通过上述 API 查看。

## 数据迁移与兼容性

- 启动时自动补充聊天记忆 v2 字段、索引和相关表，不要求手动执行 SQL。
- 旧 `memory_fragments` 数据会补齐新字段并继续作为 SQLite 权威记录。
- 未配置外部嵌入模型时自动使用纯文本模式，不阻断聊天或记忆生成。
- 本地 `agent-core/data/` 与 `vector-service/chroma_data/` 仍为运行数据，不进入 Git。

## 验证

本版本提交前执行：

- 后端 Node 测试：16 项；
- Node 语法检查；
- 前端 Vite 构建；
- Python 向量服务 `py_compile`；
- 聊天记忆纯文本、文本 + 重排、文本 + 嵌入、文本 + 嵌入 + 重排链路；
- 记忆 `create → update → 撤回恢复 → 清空`；
- 绘图知识库播种、检索、冲突规则和图片任务记录；
- 生图提示词首次空响应后重试成功、连续空响应失败处理。

## 使用提示

在项目根目录启动：

```bash
npm run dev
```

进入“系统设置 → 聊天记忆”填写供应商配置并保存。首次启用或切换嵌入模型后，可点击“重建聊天索引”；连接或索引失败时可点击“重试失败项”。
