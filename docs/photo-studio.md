# 照相馆素材、授权与生成链路

姿势参考取自 [ai-pose-gallery-SKILL](https://github.com/aiyaoooo14/ai-pose-gallery-SKILL)，图片权利归原作者 ギア，原始站点为 ai-pose-gallery.pages.dev；上游 LICENSE 明确 `img/`、`thumbs/`、姿势 JSON 数据不适用 MIT，且**不得商用**。保留上游 LICENSE 与素材来源修订号/逐文件哈希清单。禁止用于商业用途；如权利人提出异议需移除素材。

`agent-core/assets/pose-gallery/manifest.json` 记录上游 commit、每张源图 SHA-256、像素尺寸、源大小及 AVIF 大小；`img/` 的原始图像和 `thumbs/` 缩略图均转换为 AVIF。`catalog.json` 保存全部 1439 个姿势索引。完整视觉识别稿保存在 `pose-prompts.json`；仅已完成逐图视觉校准的条目才进入照相馆，未识别或待复核条目不会显示或接受拍摄，避免选到没有动作描述的图片。维护/补拉图库：

```powershell
node agent-core/scripts/import-pose-gallery.mjs --source=<ai-pose-gallery-SKILL 本地工作副本>
```

照相馆沿用系统当前的 Anima 工作流，不将图库图片或头像上传作图像参考。姿势图先由人工按轮廓和角度写成英文动作 tag，再与 `buildCharacterAppearanceSection` 取出的角色外观拼接，直接作为预备完成的画面描述传给 `generateImage`；不再额外调用模型改写提示词。双人姿势优先使用用户选定的搭档，未指定时从其他角色随机补一人。尺寸默认 1200×1600，用户可分别滑动调整宽高（512–2048，8px 步长），本次任务会冻结保存尺寸。最终照片以 AVIF 保存到 `/images/photo_studio/`；选择、描述、尺寸和状态保存在 `photo_studio_jobs`，底层图像任务同步记入 `image_tasks`。

原始描述样本是 `full_single_P001` 的正面、俯视、仰视、侧面与斜侧五个角度，以及以下三张逐图核对过的双人姿势：

- `pair60_P042_front`「盘腿相拥」：第一人坐地盘腿作为支撑，第二人面对面坐在其腿上并环抱肩腰。
- `pair60_P051_front`「耳边低语・手触脸颊」：第一人站前方抬手触碰后方伙伴脸颊，第二人靠近耳边并扶住其外侧髋部。
- `pair60_P054_front`「被横抱・背部后仰」：第一人为被横抱者，头肩后仰、双腿向另一侧伸出；第二人站立托住其上背与膝下。

双人描述除 `posePrompt` 外保存按主角／搭档顺序排列的 `characterRoles`。未检查的其他角度不自动套用正面描述。

最终画面描述按内容顺序将构图、姿势、每位角色的名字／外观／动作职责及可选补充要求分别用圆括号包裹，并以空行分隔。括号是照相馆用来区分分组的写法，不是 Anima 官方定义的结构或控制语法。外观通过 `buildCharacterAppearanceSection(character, { includeHeading: false })` 组装，不将角色卡中的 `## 你的外观` 标题送入生图提示词；外观正文与生效服饰注入仍保留，其他功能默认继续保留标题。

先给角色名字、紧接该角色外观与动作描述，符合[Anima 官方模型卡](https://huggingface.co/circlestone-labs/Anima#prompting)对多人提示词的建议；不过角色分组与括号均不会锁定人物身份或形成空间控制。需注意，当前默认 Anima ComfyUI 工作流使用的 `CLIPTextEncode` 会由 ComfyUI 提示词解析器把 ASCII 圆括号识别为权重语法，未显式写权重时组内文本采用默认 1.1 权重（见 [ComfyUI `token_weights`](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/sd1_clip.py)）。因此这些括号既是可见分组，也可能让组内内容略微增权；这仍不是 Anima 提供的角色分组机制。当前工作流不引入额外 LLM 请求、图像参考或区域控制节点，也没有验证括号能减少角色串位。

新增描述须沿用来源体系/类别和姿势名称，但以图中骨盆、躯干、四肢支点与朝向、视角及透视为准，并在实际 Anima 出图后校验；不能只把名称翻译成几个泛化 tag。文本包裹不是空间约束，不能保证每次生成都精确复刻四肢接触点。
