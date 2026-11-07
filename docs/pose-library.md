# 姿势库导入器

把外部姿势参考图库整理成「姿势目录 + 生图参数」资源：`scripts/import-pose-library.mjs`。

## 为什么是这个形态

姿势参考图库（如 [aiyaoooo14/ai-pose-gallery-SKILL](https://github.com/aiyaoooo14/ai-pose-gallery-SKILL)）给的是「体系 / 分类 / 姿势名称 / 角度」四个中文字段加图片路径。它擅长让人**看图**，但直接拿去驱动生图还差一步：姿势名称是中文短语，模型真正需要的是能拼进提示词的英文标签、负向词，以及「这一格定格在哪一瞬」。

所以导入分两步，**第二步是可选的**：

1. **整理**（必做）：把同一姿势的多个角度归成一条，产出干净的目录。只用 Node.js 内置模块，不需要任何密钥。
2. **补全**（可选）：调用一个 OpenAI 兼容接口，为每条姿势补出 `core` / `male` / `female` / `negative` / `frozen` / `prompt`。

默认数据源是那份中文姿势库的 `data/pose-zh.json`，也可以传本地文件。

## 用法

从仓库根目录执行：

```bash
# 只整理目录，不调模型
node scripts/import-pose-library.mjs --no-llm

# 先试一个分类的前 10 条，看补全质量
node scripts/import-pose-library.mjs --categories 立位 --limit 10 \
  --base-url https://api.example.com/v1/chat/completions --model <模型名>

# 全量补全，断了接着跑
node scripts/import-pose-library.mjs --resume

# 从本地文件读
node scripts/import-pose-library.mjs ./pose-zh.json --no-llm
```

| 选项 | 说明 |
| --- | --- |
| `--no-llm` | 只整理目录，不调用模型 |
| `--categories a,b` | 只处理指定分类，默认全部 |
| `--limit N` | 最多处理 N 条，试跑用 |
| `--resume` | 跳过已补全的条目，接着跑 |
| `--out <路径>` | 产出位置，默认 `agent-core/resources/pose-library.json` |
| `--base-url` / `--model` / `--api-key` | LLM 端点；也可用 `POSE_LLM_URL` / `POSE_LLM_MODEL` / `POSE_LLM_KEY`（回退读 `LLM_API_KEY`） |

## 产物

`agent-core/resources/pose-library.json`：

```json
{
  "version": 1,
  "source": "…",
  "generatedAt": "2026-11-07",
  "systems": ["全身单人・性感系", "全身单人・标准系", "上半身单人", "双人缠绵"],
  "categories": [{ "value": "站姿", "label": "站姿", "count": 40 }],
  "entries": [
    {
      "id": "P001",
      "system": "全身单人・性感系",
      "category": "站姿",
      "name": "S形站姿・胯部侧顶",
      "angles": ["正面", "俯视", "仰视", "侧面", "斜侧"],
      "images": { "正面": { "thumb": "thumbs/…jpg", "full": "img/…png" } },
      "params": {
        "core": ["standing", "s-curve posture", "hip cocked"],
        "male": [],
        "female": ["hand on hip", "weight on one leg"],
        "negative": ["extra limbs", "fused fingers", "wrong anatomy"],
        "frozen": "一句中文，讲清这一格定格在哪一瞬",
        "prompt": "英文提示词模板，用 [a / b] 表示可随机替换的变体"
      }
    }
  ]
}
```

当前数据源整理后：**1439 张图 → 288 组姿势**（4 个体系 / 26 个分类）。同一姿势的 5 个角度合为一条，`angles` 保留全部角度，`images` 记录各自路径。

`params` 只在补全成功后出现。补全失败的条目保留目录信息、不带 `params`，脚本继续跑。

## 边界

- **不下载图片**，也不复制图片文件，只记录图库里的相对路径。
- **不修改原始数据**：归组与补全都只发生在内存和产物里。
- 补全结果按「体系｜姿势编号」记断点，`--resume` 跳过已完成项；每 5 条落一次盘，中断不白跑。
- LLM 输出不合法会重试 4 次，仍不合法则该条跳过。
- 原始数据与断点缓存放 `.pai/temp/`，不污染工作树。

## 当前消费方

本仓库目前**没有**读取这份资源的模块——它是独立的数据产物。需要姿势 / 体位参数的模块，或外部工具，可以直接读 `agent-core/resources/pose-library.json`。

如果以后要接进来，建议的读取入口是一个 `services/poseLibrary.js`：负责词条校验、按分类筛选、把 `params` 拼成提示词片段；不要在调用点直接读 JSON。
