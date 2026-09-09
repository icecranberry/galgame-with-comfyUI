# 记忆系统升级方案（Memory v3）：分层安放 × 记忆演化 × 主动回想

> 状态：设计稿（待评审）
> 范围：agent-core 记忆子系统 + vector-service 适配 + web-ui 少量界面
> 明确排除：训练专用记忆模型（SFT/RL）、群聊主动搜索、图数据库、角色卡 v2（另线推进）

---

## 0. 摘要

本方案将现有记忆系统（提取式碎片 + FTS/bigram/向量三路混合检索 + supersede 覆盖）升级为四层结构：

1. **阶段一（安放）**：记忆碎片获得 MMS 式多重表示（关键词/认知视角/情景/语义），检索单元与注入单元分离；新增实体与三元组索引（SQLite 平行表，不上图数据库）；supersede 升级为双时态（bi-temporal）演化。
2. **阶段二（主动回想）**：为 1v1 聊天引入 `@memory` 文本协议——模型自己决定何时回想，服务端拦截执行检索后二次续写，消除热路径 LLM 嵌套（rerank 前置裁判退役）。
3. **阶段三（整理）**：空闲期整理 daemon——冲突消解、情景→语义泛化升华、遗忘曲线衰减归档、核心记忆（画像/关系）统一升华、存量表示回填。
4. **阶段四（预算）**：上下文 token 预算分配器与归档存储管理。

四个阶段互相独立、每步可单独回滚；全程不引入新的外部依赖。

---

## 1. 现状与问题

### 1.1 现状（权威实现，精确到文件）

| 机制 | 实现 | 位置 |
|---|---|---|
| 记忆提取 | 每 40 条 raw 消息触发，先 hybridSearch 召回 12 条相关旧记忆，LLM（temp 0.2 / json_object / max_tokens 1800）输出 create/update/merge 动作，事务落库 | `services/memoryExtractor.js`（`curateNow` L29、`buildMemoryCurationPrompt` L70） |
| 落库与血缘 | content_hash 去重、supersede 旧记忆、`memory_relations` 血缘、向量索引任务队列 | `services/memory/memoryRepository.js`（`applyMemoryActions` L58） |
| 检索 | FTS5 bm25 + 中文 bigram LIKE + 向量（ChromaDB）三路，RRF（K=60）融合，可选 rerank | `services/memorySearch.js`（`hybridSearch` L9） |
| 聊天注入 | 2.5s 熔断召回 → 过滤事件类 → `<rag_memories>` 注入最新 user 消息的 `<dynamic_context>` | `routes/chat.js` L790-822、`services/memory/chatMemoryRecall.js` |
| 滚动摘要 | 每 10 条 assistant 消息独立 LLM 调用，兼作压缩 checkpoint（不进索引） | `services/summarizer.js` |
| 向量索引 | 后台 worker（并发 2，优先级 LIVE/RETRY/HISTORY），嵌入文本 = judgment+reasoning+tags | `services/memory/memoryRepository.js`（`indexMemory` L191、`memoryText` L448） |
| 配置 | `system_settings.memory_settings` 单键 JSON，normalize 兼容旧值 | `services/memory/memoryConfig.js` |

### 1.2 本方案要解决的四个问题

1. **记忆彼此孤立**：无实体网络、无记忆间关联，多跳联想（"她上次说家里的事"→关联到"她妈妈生病"）只能靠向量碰运气。
2. **替换而非演化**：`update` 直接 supersede，旧版本进血缘表但**不可检索**，"她以前/第一次/后来"类时间性问题无法回答；事实变更后没有双时态历史。
3. **检索形态 = 注入形态**：向量索引文本和注入 prompt 用的是同一个 `judgment`，没有"用来搜的"与"用来喂的"之分；高层提炼（语义）混进检索会伤召回，情景冗余混进注入会伤生成（MMS 消融结论）。
4. **在线链路 LLM 嵌套**：热路径可选 rerank LLM"猜"模型需要什么；维护链 summarizer→extractor 各自为战；整理全部发生在聊天时段，抢占在线预算。

---

## 2. 设计原则（研究 → 工程映射）

| 原则 | 来源 | 在本方案的落点 |
|---|---|---|
| 图做索引、不做语料 | HippoRAG 2（ICML 2025） | 实体/三元组只当检索索引，`memory_fragments` 原文永远是唯一事实源；不往检索库塞 LLM 摘要 |
| 检索单元 ≠ 注入单元 | MMS（arXiv 2508.15294） | 向量/FTS 匹配用检索形态（关键词+视角+情景），`<rag_memories>` 注入用语义形态 |
| 实体链接是多跳能力的来源，平行集合即可 | Mem0 2026 算法 | `memory_entities` + `memory_entity_links` 平行表 + 检索 boost，不需要图数据库 |
| 演化分三维度：事实级 / 强度级 / 结构级 | Zep bi-temporal / MemoryBank 遗忘曲线 / A-Mem | 阶段一做双时态，阶段三做衰减与泛化 |
| 两层检索：被动环境召回 + 主动工具搜索 | harness 范式（agentic search） | 阶段二 `@memory` 协议，被动召回保留兜底 |
| 整理移到空闲期 | Letta sleep-time / SCM | 阶段三 consolidationScheduler |
| 宽种子 + 平衡因子的邻接扩展（PPR 思想的 SQLite 近似） | HippoRAG 2 | 主动检索的三元组联想扩展（查询→三元组→关联记忆，1 跳） |

---

## 3. 目标架构总览

```
────────── 写入路径（每 40 条 raw 消息，单次 LLM，离线） ──────────
对话窗口 ──▶ curation v3 单遍输出：
             摘要(scratch) + 记忆动作(create/update/merge，含新表示字段)
             + 实体(去重入实体表) + 三元组(可选)
                            │
                            ▼
────────── 安放（四层，各有检索策略） ─────────────────────────────
L0  raw_messages          直接记忆（逐字，只追加，永不参与 LLM 化整理）
L1  memory_fragments      间接记忆·碎片（多表示字段 + 双时态 + 强度）
    ├─ memory_entities / memory_entity_links    实体索引层
    └─ memory_triples                            关系三元组索引层
L2  rolling_summaries     工作记忆（压缩 checkpoint，不进检索）
L3  user_portraits / user_relationships / emotion_snapshots
                          核心记忆（常驻注入；阶段三起由整理工序统一升华）

────────── 检索路径（两层混合） ──────────────────────────────────
被动（常驻，零 LLM）：FTS + bigram + 向量 + 实体boost 四路 RRF
                      → 检索单元匹配 → 注入单元喂给 <rag_memories>
主动（按需，@memory）：模型发指令 → activeSearch
                      （时态模式检测 + 三元组联想扩展 + 实体 1 跳）
                      → <memory_recall_result> 二次续写

────────── 整理路径（空闲期 daemon，预算受控） ───────────────────
T1 冲突消解(双时态失效)  T2 情景→语义泛化升华  T3 强度衰减与归档
T4 核心记忆升华(半自动)  T5 存量表示回填       T6 向量墓碑一致性
```

---

## 4. 阶段一：表示层与安放（Memory v3 Schema）

### 4.1 数据库迁移：`migrateChatMemoryV3Schema(db)`

位置：`db/index.js`，完全沿用 `migrateChatMemoryV2Schema`（L1609）的防御式模式（`PRAGMA table_info` 探测 + `ALTER TABLE ADD COLUMN` + 批量 `db.exec`）。

**A. `memory_fragments` 新增列：**

```sql
-- 检索形态（MMS 检索单元的组成部件）
keywords       TEXT NOT NULL DEFAULT '[]'   -- 检索关键词 3-8 个（JSON 数组）
perspectives   TEXT NOT NULL DEFAULT '[]'   -- 认知视角标签 2-5 个（如 饮食习惯/童年/健康/工作/关系）
episodic_note  TEXT NOT NULL DEFAULT ''     -- 情景备注：何时何地发生了什么（event/emotion 类重点）
-- 注入形态（MMS 注入单元的核心）
semantic_note  TEXT NOT NULL DEFAULT ''     -- 语义事实：提炼后的可独立陈述（空则回退 judgment）
-- 双时态演化（Zep 模式）
event_time     DATETIME                     -- 事件发生时间（服务端从消息时间戳取，不让 LLM 猜）
valid_from     DATETIME                     -- 该版本生效时间（默认 = created_at）
valid_to       DATETIME                     -- 失效时间（NULL = 现行有效）
-- 强度与重要性（MemoryBank 模式，阶段三消费）
importance     INTEGER NOT NULL DEFAULT 3   -- 1-5，受控枚举
strength       REAL NOT NULL DEFAULT 1.0    -- 当前强度，daemon 维护
last_reinforced_at DATETIME                 -- 最近被召回强化时间
retrieval_count INTEGER NOT NULL DEFAULT 0  -- 被召回次数（audit 聚合）
```

存量回填（同事务）：`valid_from = COALESCE(updated_at, created_at)`。

**B. 新表：**

```sql
CREATE TABLE IF NOT EXISTS memory_entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,          -- 规范名（人名/地名/事物名）
  aliases TEXT NOT NULL DEFAULT '[]', -- 别名 JSON 数组（错别字/昵称归并）
  mention_count INTEGER NOT NULL DEFAULT 0,
  embedding_state TEXT NOT NULL DEFAULT 'disabled',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS memory_entity_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'mention',  -- subject | object | mention
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(memory_id, entity_id, role)
);
CREATE INDEX IF NOT EXISTS idx_memory_entity_links_entity ON memory_entity_links(entity_id, memory_id);

CREATE TABLE IF NOT EXISTS memory_triples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  subject_entity_id INTEGER,
  subject_text TEXT NOT NULL,
  predicate TEXT NOT NULL,             -- 受控谓词表：喜欢/讨厌/承诺/居住/职业/拥有/状态变化…
  object_entity_id INTEGER,
  object_text TEXT NOT NULL,
  event_time DATETIME,
  valid_from DATETIME,
  valid_to DATETIME,
  embedding_state TEXT NOT NULL DEFAULT 'disabled',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_memory_triples_memory ON memory_triples(memory_id);

CREATE TABLE IF NOT EXISTS memory_consolidation_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL,              -- conflict_resolve | generalize | decay | promote | backfill | tombstone
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

`memory_relations` 增列 `relation_meta TEXT`（泛化关系沿用 `action='merge'`，meta 标注 `{"kind":"generalize"}`；避免重建带 CHECK 约束的表）。

**C. FTS5 扩列（关键决策：semantic_note 刻意不进 FTS）**

重建 `memory_fragments_fts` 为六列（judgment, reasoning, tags, keywords, perspectives, episodic_note），同步更新三个触发器，然后 `INSERT INTO memory_fragments_fts(memory_fragments_fts) VALUES ('rebuild')`。**语义列不进检索通道**是 MMS 的核心发现的应用：高层提炼与提问语言形态脱节，混入会降低召回。

bm25 权重（列序对应）：`bm25(memory_fragments_fts, 5.0, 1.0, 3.0, 4.0, 2.5, 1.5)`——judgment 与 keywords 最高（可调）。

### 4.2 curation 单遍多产出：`buildMemoryCurationPrompt` v3

`memoryExtractor.js` 改造。**核心设计：新字段全部可选**——LLM 少输出任何字段时系统仍可落库（judgment/tags 保持必填），旧模型/弱模型零兼容风险。

记忆对象 v3 JSON 形态：

```json
{
  "memoryType": "knowledge|skill|emotion|event",
  "subject": "user|character|relationship|assistant",
  "judgment": "一句独立、清楚的判断句（不变，权威语义）",
  "reasoning": "对话依据（不变）",
  "tags": ["独立稳定词元"],
  "keywords": ["香菜", "挑食"],
  "perspectives": ["饮食习惯", "童年"],
  "episodicNote": "2026-08 中旬聊天时提到，小时候被家人逼着吃香菜",
  "semanticNote": "她不吃香菜，源于童年被强制进食的经历",
  "importance": 3,
  "entities": [{"name": "香菜", "role": "object"}, {"name": "她", "role": "subject"}],
  "triple": {"predicate": "讨厌", "subject": "她", "object": "香菜"}
}
```

Prompt 变更点：

1. 保留全部现有约束（敏感信息拒绝、动作约束、不得引用列表外记忆）。
2. **解除"不输出 importance"禁令**，改为受控 1-5 整数枚举（v2 禁止是防自由发挥；v3 用 schema 校验兜底）。
3. 新增字段说明段：四个表示字段各自用途（keywords/perspectives/episodicNote 用于"将来被想起来"，semanticNote 用于"想起来了怎么转述"），要求 semanticNote ≠ judgment 复读。
4. 实体抽取：人名/地名/具体事物名，`role` 标 subject/object/mention；泛指代词（她/我/你/它）不抽。
5. 三元组仅在存在清晰主谓宾时输出（关系类记忆优先），谓词从受控表选择，没有就省略 `triple`。
6. 上下文注入窗口时间信息 `<window_time>`（服务端取窗口首末消息 created_at），**event_time 由服务端从消息时间戳计算**（取窗口内最后一条 user 消息时间），不让 LLM 生成。
7. `max_tokens` 1800 → 3000。

`normalizeMemory`（memoryRepository L34）扩展校验：keywords ≤8、perspectives ≤5、importance clamp 到 [1,5]、entities 名字去空格去重 ≤6、triple 字段长度上限；全部字段解析失败时丢弃该字段而非整体报错（降级哲学）。

### 4.3 落库扩展：`applyMemoryActions`

在现有事务内追加：

1. 写入新列；物化检索文本不需要额外列——检索文本由 `retrievalText(row)` 函数实时合成（见 4.4），避免冗余存储与更新不一致。
2. 实体 upsert：`name` 精确匹配命中则 `mention_count+1`，未命中插入；写入 `memory_entity_links`（含 role）。
3. 三元组落库（有 `triple` 时），`event_time/valid_from` 同步记忆本体。
4. `update/merge` 被替代的源记忆：在现有 `status='superseded'` 基础上补 `valid_to = CURRENT_TIMESTAMP`（不动现有语义，纯增量列）。

联动清理：`rollbackMemoriesFromRawId`（L126）与 `clearConversationMemories`（L159）需同步删除对应 `memory_entity_links` / `memory_triples` 行（`memory_entities` 全局保留）。

### 4.4 检索单元 / 注入单元拆分

**`memoryRepository.js`：**

```js
// 检索文本：被动/主动检索的向量与匹配文本（MMS 检索单元）
function retrievalText(row) {
  const legacy = !parseTags(row.keywords).length && !row.episodic_note;
  if (legacy) return memoryText(row); // 存量回退：judgment+reasoning+tags
  return [
    row.judgment,
    parseTags(row.keywords).join(' '),
    parseTags(row.perspectives).join(' '),
    row.episodic_note || '',
  ].filter(Boolean).join('\n');
}
// 注入文本：喂给 <rag_memories> 的形态（MMS 注入单元）
function injectionText(row) {
  return row.semantic_note || row.judgment;
}
```

`indexMemory`（L191）改用 `retrievalText(row)`；**向量 corpus 不升版**（实施期决策修订）：新记忆直接以新文本形态嵌入现有 corpus（`memory_fragments` / `memory_v2_${fingerprint}`），存量记忆保持旧向量。理由：混合文本形态在同一 corpus 中逐条独立嵌入、互不影响，避免升级时全量重嵌入风暴；存量新形态补嵌由阶段三 T5 回填任务按条完成。`removeMemoryVector`（L410）的 corpora 列表无需改动。vector-service 侧无需改动。

**`memorySearch.js`：**

1. `ngramSearch`（L114）的 LIKE 列扩展：`judgment / reasoning / tags / keywords / perspectives / episodic_note`。
2. `ftsSearch`（L93）无需改 SQL（FTS 重建后自动覆盖新列），仅更新 bm25 权重参数。
3. 全部查询加现行有效过滤：`status='active' AND valid_to IS NULL`（`ftsSearch` / `ngramSearch` / `hydrateVectorResults` 三处）。
4. **实体第四路信号（新 `entityMatch()`）**：复用 `queryTokens` 的 bigram 对 `memory_entities.name/aliases` 做 LIKE 匹配 → 命中实体 → `memory_entity_links` 反查 memory_id → 关联记忆按实体命中数排序，作为第四个结果集进 `rrfFusion`（与 fts/ngram/vector 并列，天然融入现有架构，不引入新融合代码）。
5. `formatRow`（L176）透出新字段：`semantic_note / perspectives / keywords / valid_from / valid_to / event_time / entities(真实实体)`，供注入与审计使用。

**`routes/chat.js` 注入改造（L790-822）：**

```js
// 现在： `${i+1}. [${m.memory_type}] ${m.judgment}`
// 改为：
const label = (m.perspectives?.length ? `${m.memory_type}|${m.perspectives[0]}` : m.memory_type);
const text = m.semantic_note || m.judgment;
memoryLines.push(`${i + 1}. [${label}] ${text}`);
```

`memorySnapshot` 同步记录 `semantic_note/perspectives/entity_hits`，作为阶段三强化统计的数据源。

### 4.5 验收标准

- [ ] 迁移幂等（重复启动不重复执行）；FTS 重建后 `fts 行数 == fragments 行数`。
- [ ] 旧记忆（无新字段）检索/注入行为与升级前一致（回退路径生效）。
- [ ] curation 新字段缺失时正常落库；schema 校验失败自动降级只丢字段不丢记忆；JSON 整体解析失败重试 1 次后仍走 v2 行为。
- [ ] 实体命中场景（消息包含已存实体名）抽检：top5 相关记忆命中率较升级前提升（人工 20 例）。
- [ ] "讨厌狗→收养狗" update 用例：旧记忆 `valid_to` 置位、被动检索不再召回、血缘链完整。

### 4.6 回滚

行为开关 `memory_settings.v3.enabled`（默认 true）：关闭后注入回退 `judgment`、检索文本回退 `memoryText`、实体路不参与融合。Schema 不回滚（SQLite 不支持 DROP COLUMN 且无害）。

---

## 5. 阶段二：主动回想（`@memory` 协议）

### 5.1 协议设计

1v1 聊天 system 序列（stableBlocks 尾部）追加固定段：

```
<recall_tool>
如果你需要回想过去的对话细节——对方提起一件"你应该记得"的事、时间较久远的事、
或下方提供的记忆片段不足以回应时——你可以在回复的第一行输出检索指令：

@memory 一句自然的查询（例如：@memory 她之前说过家里的事吗）

输出指令后立即停止，系统会替你回想并把结果反馈给你，你再继续正常回复。
每轮最多使用一次；只是闲聊或记忆片段已够用时不要使用。
</recall_tool>
```

设计决策与理由：

- **放回复第一行**而非中途：流式拦截只需在行边界做一次判断（复用 SentenceSplitter 前的 fullContent 累积，模式同现有 `{"` 三字闸门），避免中途截断续写的复杂状态机。
- **纯文本协议而非 function calling**：兼容任意 OpenAI 兼容后端（含 LM Studio 本地模型），与群聊"行协议"同一设计哲学；模型不遵循 = 协议永不触发 = 零影响。
- **被动召回保留**：`<rag_memories>` 常驻不动，@memory 是深度补充而非替代（Claude Code 式"常驻上下文 + 按需 grep"）。

### 5.2 服务端拦截与续写循环（`routes/chat.js` 流式分支）

```
1. stream 开始，逐 token 累积 fullContent
2. 行闸门检测：首行以 "@memory" 开头 且 行已完整（遇换行/流结束）
   ├─ 否 → 正常流程（零开销路径，检测为 O(1) 前缀判断）
   └─ 是 → abort 当前流（此时仅生成了一行指令，无可展示内容）
3. 解析查询文本 → activeMemorySearch(query, { conversationIds })
   ├─ 成功 → 命中 N 条
   ├─ 超时(4s)/失败 → 命中 0 条，标注"回想失败"
4. 二次调用 buildChatContext：dynamicBlocks 追加
   <memory_recall_result>
   （你回想了「{query}」，结果是：）
   1. [现行] {injectionText}
   2. [历史·已于 {valid_to} 过时] {injectionText}
   （没想起来的部分就自然地说不记得，不要编造）
   </memory_recall_result>
   第二次调用的 system 中追加一句"检索已完成，不要再输出 @memory"
5. 二次流式输出照常走 SentenceSplitter → SSE → 落库
   （@memory 指令行本身不进入气泡、不落 messages/raw_messages）
6. 审计：memory_retrieval_audits 记 mode='active'，含 query/命中/耗时
```

防呆：同一用户消息只认第一次触发（二次调用时 system 已明示禁止）；@memory 出现在非首行时视为普通文本不处理。

### 5.3 `activeMemorySearch`（新文件 `services/memory/activeSearch.js`）

```
输入 query, { conversationIds, includeHistorical }
1. 时态模式检测：/(以前|曾经|第一次|上次|之前|那时候|后来)/ → includeHistorical=true
   ├─ 现行模式：hybridSearch(..., validTo=null)   （同被动，topK=8，timeout 4s）
   └─ 历史模式：hybridSearch 放宽 valid_to IS NOT NULL + superseded 状态，
                结果逐条带 [历史·{valid_to} 过时] 徽标与后继版本（查 memory_relations）
2. 三元组联想扩展（查询→三元组→关联记忆，HippoRAG 2 query-to-triple 思路）：
   query 嵌入 → vectorSearch(corpus='memory_triples_v1', topK=5)
   → 命中三元组的 memory_id 关联碎片（去重、限 5 条、标 source='triple')
   三元组库为空时此步自动跳过（对存量数据的自然降级）
3. 实体 1 跳扩展：query 实体命中 → entity_links → 已命中之外的关联记忆（限 3 条）
4. RRF 融合 → 返回 [{ fragment, injectionText, badge }]
```

三元组嵌入：扩展 `memory_index_worker` 支持 `job_type='triple_upsert'/'triple_delete'`（`processIndexJob` L388 的 switch 加分支），嵌入文本 = `subject_text + predicate + object_text`，metadata 含 `memory_id/conversation_id/predicate`，corpus `memory_triples_v1`。

### 5.4 UI（实现前先读 `docs/design-system.md`）

- ChatView：@memory 触发时显示轻量"回想着…"状态条（复用现有 loading/Toast 视觉语言），完成后收起；不展示指令行本身。
- MemorySettingsView：新增"主动回想"开关卡片（复用现有设置卡片模式），说明文案："角色会在需要时主动检索自己的记忆，可能略微增加回复等待"。

### 5.5 灰度与验收

- 开关 `memory_settings.activeSearch.enabled` 默认 **false**，自用灰度两周。
- 验收：
  - [ ] 应该用的场景（20 例人工清单：远期指涉、矛盾澄清、"还记得吗"句式）指令触发率 ≥ 80%；
  - [ ] 闲聊场景误用率 < 10%；
  - [ ] 触发轮次端到端 P95 延迟增量 < 5s；
  - [ ] 未触发时行为与现状逐字节一致（回归）；
  - [ ] 检索超时时正常续写（带"回想失败"提示注入），无卡死、无空回复。

---

## 6. 阶段三：整理 Daemon（记忆的"睡眠期")

### 6.1 调度与预算

新文件 `services/memory/consolidationScheduler.js`，模式对齐 `proactiveChatScheduler.js`：

- **触发**：空闲判定（无活跃 SSE 流 且 距最后一条消息 ≥ `idleDelayMinutes`，默认 30 分钟）或每日一次兜底；可选产品化——结合角色 `schedule_templates` 作息，在角色"睡觉"时段执行（"她睡着后在整理今天的记忆"）。
- **预算**：单次运行 LLM 调用 ≤ `dailyMaxLlmCalls`（默认 6）、总 token 上限；全部走 `chatSync` + `llmConcurrency` 正常排队，label 统一 `记忆整理`。
- **任务表**：`memory_consolidation_jobs`，启动时 `processing→pending` 恢复（模式同 index worker L432），`attempts` ≥3 进 failed 不再自动重试。
- **feature flag**：`memory_settings.consolidation.enabled`。

### 6.2 六个整理任务

**T1 冲突消解（事实级演化，自动化双时态）**
候选：近 7 天新建记忆，按共享实体聚类（同 entity_id ≥1 且 FTS 相似）。每簇一次 LLM 调用判断：矛盾（新事实替代旧事实）→ 旧记忆补 `valid_to` + 血缘 `update`；包含/重复 → 走 merge；无关 → 跳过。
对应用户场景："她讨厌狗"（3 月）→"她收养了一只流浪狗"（今天）→ 旧记忆自动失效但历史可查。

**T2 泛化升华（情景→语义，结构级演化）**
候选：同实体 + 同 subject 的 event/emotion 记忆 ≥3 条且时间跨度 >14 天。LLM 从多条情景记忆归纳一条 knowledge 语义记忆（"他连续两年换季感冒"→"他体质偏弱，换季易感冒"），原记忆保留、`importance` 降 1，血缘 `action='merge'` + `relation_meta={"kind":"generalize"}`。

**T3 强度衰减与归档（强度级演化，纯 SQL 零 LLM）**
先跑 audit 聚合子任务：按 memory_id 统计近 90 天 `memory_retrieval_audits` 命中次数 → 更新 `retrieval_count/last_reinforced_at`。然后：

```
strength = (importance/5) × exp(-Δdays / halfLife(type)) × (1 + 0.1·ln(1+retrieval_count))
halfLife: event=14d, emotion=60d, knowledge=180d, skill=180d
strength < 0.15 → status='archived' + 向量 delete job（进 v3 与 triples 两 corpus 的墓碑）
```

archived 不进任何检索通道，管理界面可查可恢复（恢复即 status='active' + 重嵌入）。

**T4 核心记忆升华（统一散装管线，半自动）**
从 importance≥4 的 knowledge 记忆生成画像候选：`INSERT INTO portrait_suggestions(character_id, field, current, suggestion, source_memory_ids, status='pending')`（新表，DDL 并入 4.1B）。TavernView 画像面板增加"待确认建议"列表，人工确认后应用——**不自动改写画像与关系**，好感度系统完全不动（避免记忆污染核心状态）。

**T5 存量表示回填**
`keywords/perspectives/semantic_note` 为空的 active 记忆，每批 10 条一次 LLM 调用补齐（输入=judgment+reasoning+tags，复用 v3 字段说明），完成后触发重嵌入。批次间退避，靠预算上限自然限速。

**T6 向量墓碑一致性**
幂等扫描：archived/superseded/deleted 状态但 v3 corpus 仍有向量的记忆，补发 delete job（T3 的兜底，独立小任务）。

### 6.3 summarizer/extractor 合并（可选项，谨慎）

方案：curation 命中 40 条边界时同步产出该窗口的 rolling summary（替代第 4 个 summarizer 调用点），summarizer 周期不变。收益：省 1 次 LLM 调用/40 条、摘要与记忆同源。风险：耦合故障域（curation 失败会连带摘要缺失）。
**建议观察 curation 稳定性一个月后再启用**，默认不做。

### 6.4 验收

- [ ] daemon 单次运行产出完整 job 表记录与日志；kill 后重启可续跑。
- [ ] T1 冲突用例端到端：自动失效 → 被动召回不再命中 → @memory 历史模式命中并标注过时时间。
- [ ] T3 可解释：管理界面/日志可查每条记忆的 strength 构成与归档原因。
- [ ] 单次 daemon LLM 调用 ≤ 预算；空闲判定在聊天中永不触发。

---

## 7. 阶段四：存储与上下文预算

### 7.1 Token 预算分配器（`contextAssembler.js`）

- `estimateTokens(text)`：中文按 字数/1.6 + 英文词数×1.3 估算（够用即可，不引依赖）。
- 分配规则：stableBlocks 不预算（必留，前缀缓存友好性不动）；剩余预算给 dynamicBlocks 按优先级分配：
  1. `<rag_memories>` / `<memory_recall_result>`
  2. `<time_context>`
  3. `<active_chat_history>`
  4. `<schedule_context>` 与其余块
- 超预算降级顺序：active_chat_history 轮数减半 → RAG topK 5→3 → 按优先级从尾部整块丢弃。
- 配置：`memory_settings.contextBudget = { enabled, dynamicTokens: 8000 }`。

### 7.2 存储管理

- 查询接口（`routes/memory.js` 的碎片列表）默认排除 archived，筛选参数透出 status 维度；MemorySettingsView 增加 archived 视图与恢复按钮（遵循 design-system.md）。
- `memoryStats()` 扩展：分层计数、实体数、三元组数、平均 strength、archived 占比。
- 检查项：现有备份/导出机制若按表清单导出，确认包含四张新表与 `portrait_suggestions`。

### 7.3 验收

- [ ] 构造极端 case（超长 base_prompt + 14 个 dynamic 块）验证降级顺序逐级生效、无静默截断。
- [ ] archived 记忆在被动/主动检索均不可见，恢复后重新可见。

---

## 8. 配置开关汇总（`memoryConfig.js` 扩展）

`DEFAULT_MEMORY_SETTINGS` 新增（`normalizeMemorySettings` 向后兼容，旧配置文件自动补全默认值）：

```js
v3:            { enabled: true },                       // 阶段一：新表示与实体信号
activeSearch:  { enabled: false, timeoutMs: 4000 },     // 阶段二：@memory 主动回想
consolidation: { enabled: true, idleDelayMinutes: 30,   // 阶段三：整理 daemon
                 dailyMaxLlmCalls: 6 },
contextBudget: { enabled: false, dynamicTokens: 8000 }, // 阶段四：上下文预算
```

每个开关独立可关；关闭即回退对应旧行为，互不牵连。

---

## 9. 测试与评估

- **单元测试**（扩展现有 `memoryExtractor.test.js`）：v3 schema 校验、字段缺失降级、实体 upsert 幂等、bi-temporal 置位、rollback/clear 联动清理。
- **回归清单**：新建会话 → 40 条触发 curation → update 记忆 → rollback → 清空会话 → 管理界面增删查，全链路每阶段跑一遍。
- **效果指标**（audit 驱动，无需新表）：
  - 被动召回命中率：人工标注 50 条真实查询的期望记忆，比对升级前后 top5 命中；
  - @memory 触发率/误用率/延迟（阶段二灰度）；
  - 泛化记忆与自动失效的抽检正确率（阶段三）。
- **可选**：LongMemEval 子集汉化自测（研究性质，不阻塞交付）。

---

## 10. 风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| curation 输出膨胀导致 JSON 失败率上升 | 中 | 新字段全可选 + 逐字段降级 + 整体重试 1 次；灰度期监控 `parseMemoryActions` 异常率 |
| 各模型对 @memory 协议遵循度不一 | 高 | 协议纯增量：不触发=零影响；灰度指标（触发率/误用率）达标才放量；system 提示词含正反例 |
| daemon LLM 成本失控 | 低 | 单次运行调用数 + token 双上限；仅空闲触发；flag 可关 |
| FTS 重建/迁移期间检索异常 | 低 | 启动时同步完成（单机毫秒级）；`rebuild` 幂等；迁移全程 try/catch 沿用 v2 模式 |
| 实体表膨胀（错别字/昵称变体） | 中 | mention_count 权重的 alias 归并任务并入 T5；name 唯一约束兜底 |
| 二次续写增加首字延迟 | 中 | 仅 @memory 触发时发生；状态条 UI 管理预期；4s 检索超时硬上限 |
| 群聊/交叉会话 scope 复杂化 | 中 | 本方案不动群聊注入路径（conversationIds scope 原样）；群聊主动搜索明确排除 |

---

## 11. 工作量与实施顺序

| 顺序 | 内容 | 主要文件 | 预估 |
|---|---|---|---|
| 1A | v3 迁移 + 新表 + FTS 扩列 + 回填框架 | `db/index.js` | 1-2 人日 |
| 1B | curation v3 prompt + repository 扩展 | `memoryExtractor.js` / `memoryRepository.js` | 2-3 人日 |
| 1C | 检索/注入拆分 + 实体第四路 + corpus v3 | `memorySearch.js` / `memoryRepository.js` / `chat.js` / `memoryConfig.js` | 3 人日 |
| 1D | bi-temporal 置位 + 时态过滤 | `memoryRepository.js` / `memorySearch.js` | 1-2 人日 |
| 2 | @memory 协议 + activeSearch + UI | `chat.js` / `activeSearch.js`(新) / `ChatView.vue` / `MemorySettingsView.vue` | 3-4 人日 |
| 3 | 整理 daemon 六任务 | `consolidationScheduler.js`(新) / `memoryIndexWorker.js` | 4-5 人日 |
| 4 | token 预算 + 存储管理 | `contextAssembler.js` / `routes/memory.js` / `MemorySettingsView.vue` | 2-3 人日 |

合计约 **16-22 人日**。每行为一个独立 PR，顺序即依赖顺序；阶段间无强耦合，可按价值单独取舍（例如先做 1+2 拿检索与回想收益，daemon 缓行）。

---

## 12. 关联研究（设计依据）

- MMS 多段记忆系统（检索单元/注入单元分离、多视角表示）— arXiv:2508.15294
- HippoRAG 2《From RAG to Memory》（图做索引不做语料、query-to-triple、再认过滤思想由主动层模型自身承担）— arXiv:2502.14802
- Zep/Graphiti（双时态、invalidation 而非删除）— arXiv:2501.13956
- MemoryBank（艾宾浩斯遗忘曲线、检索即强化）— arXiv:2305.10250
- Mem0 2026 算法报告（平行实体集合 + 多信号融合、staleness）— mem0.ai/blog/state-of-ai-agent-memory-2026
- A-Mem（记忆演化与链接生成，本方案以实体表+血缘表轻量近似）— arXiv:2502.12110
- Memory-R1 / MRAgent（记忆操作工具化的 prompt 模仿，@memory 协议的思想来源）— arXiv:2508.19828 / 2606.06036
