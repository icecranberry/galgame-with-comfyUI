# M6 小镇素材外观来源与待更新标记

本切片只记录真实生成输入的外观来源并报告待更新状态。不新增装备系统、不自动生图、不迁移 `characters.standing_url`，不改变立绘/精灵回退优先级。

## DTO：对应资产，不是有效显示图

`listTownCharacters()` 的每个角色增加：

```js
appearanceStatus: {
  sprites: { down: 'current', up: 'needs_update' },
  portrait: 'unknown',
  standing: 'unknown',
}
```

三个状态分别表示：可信来源与当前实际外观输入一致；可信来源与当前输入不同；没有可信来源凭证。历史无签名素材、缺失素材均为 `unknown`，不自动补写为当前。

角色 DTO 仅描述 `char_<characterId>_down/up/portrait` 自有素材。角色无自有素材而实际回退使用关联 NPC 图时，这里的 `unknown` 不代表 NPC 图，也不应转换为 fallback current。NPC 素材状态由 `getNpc()` 返回的每个非空 `sprites[direction]` / `portrait` 的 `appearanceStatus` 提供。UI 若展示 NPC 回退素材，应使用对应 NPC 素材状态。

本轮没有 `effective` 字段，不能把这些字段解释为“镇内当前显示图片”的统一状态。`characters.standing_url` 沿用原复用与优先级，`standing` 始终为 `unknown`。

## 真实生成来源

`createTownAppearanceSignature({db,buildAppearanceSection,buildPersona})` 注入实际 central `characterPersona` 构建函数。`capture({sourceKind,sourceId,mode,styleTags})` 在 prompt 生成前获取一份快照，返回 `appearanceInfo`、`description`、`source` 和同步 `assertCurrent()`。调用方使用这一份 `appearanceInfo` 构建 prompt。

素材成功发布时，`meta.appearanceSource` 保存：

```js
{ version: 1, signature, sourceKind: 'character' /* 或 npc */,
  sourceId, characterId, mode: 'sprite' /* 或 portrait */ }
```

signature 覆盖来源身份、模式及实际使用的 central 外观/persona/fallback 文本。画风进入生成 `appearanceInfo`，但不纳入外观新鲜度指纹。NPC 始终使用 NPC 自身 persona、名字与职业；关联角色只提供生效外观，不能将 NPC 生成图认作 character 来源。

NPC 关联角色必须实际存在，否则来源中的 characterId 归 null，关闭 outfit 注入并保留 NPC 自身 persona；不回写历史关联字段。非字符串 signature（包括 `{toString:null}`）直接归 unknown，不做隐式字符串转换。

character sprite 的 fallback 有意变化：旧实现无外观段且未抛异常时只使用显示名；新实现依次使用 `short_prompt → base_prompt → 显示名/名字`。这是新生成输入的行为变化，不声称与旧输入逐字节一致。历史图仍为 unknown。

## 生成与编辑边界

- 精灵入口默认只补缺图，所有 ready 素材均跳过。显式 `refreshAppearance: true` 才更新 unknown/needs_update 的 ready 素材，current ready 仍跳过；NPC 原有显式 force 保留。字符串 `"true"` 不启用刷新。
- 外层 prompt await 后检查外观；asset 队列执行前、生成 await 后以及最终文件/DB 发布前再次同步检查。换装、外观到期或源身份变化不能发布旧结果。
- 外观凭证与新图片一起提交。已有图片重绘期间保留 ready、旧图片与旧凭证；外观失效时仅在仍拥有原 world/token 的条件下恢复请求前元数据与 source_prompt，不替换旧图、不升级旧签名。请求抛出 `TOWN_ASSET_STALE`，明确未更新成功。
- 新建但尚无图片的任务若因外观过期失效，只将本世界、同 operation token 的 pending 行标为 failed，避免永久 pending；不修改其他任务或新世界行。
- 生成等待期间保存 artist/loras/promptPrefix 时，各字段在 meta._generationConfigEdits 记录独立保存标记。外观失效回滚与成功 commit 共用字段版本合并，保留随后保存的字段及编辑凭证；同值保存、null 重置和部分字段保存均保留用户意图，不更换生成 token、不触发生成。裁剪/高清的成功提交同样保护并发保存的配置，新像素与对应来源凭证仍正常提交。
- 任意 prompt 重绘没有可信 guard 时，新图清除来源凭证。客户端 meta 不能直接注入凭证。
- 服务端裁剪/高清继承原凭证，不将其升级为当前外观。任意上传的编辑图片清除凭证，状态回到 unknown。
- 列表对无凭证素材惰性返回 unknown；有凭证时读取 central 外观。未添加逐帧轮询或生成。

`POST /api/town/characters/:id/sprites` 与 `POST /api/town/npcs/:id/sprites` 均支持 JSON `{ "refreshAppearance": true }`；路由只用严格布尔比较传递该标记。普通“生成缺失小人”不传此标记。服务函数分别为 `generateCharacterSprites(id, options)` 和 `generateNpcSprites(id, overrides)`。

两个 sprites 路由将 `TOWN_ASSET_STALE` 返回为 HTTP 409，并保留 code；其他生成错误仍为500。主审发现原 catch 丢失这项契约后，新增真实 router 错误分支先复现两处500，再修复为409；`townAppearanceRoutes.test.js` 随后3/3通过。该证据补足了此前仅严格布尔参数的路由测试，不能用早期 Admin 的模拟409替代真实路由验收。

## 验证

定向测试，仅使用内存 SQLite、临时素材目录、真实 central persona/outfit 查询与 fake 生成依赖：

```text
node --test test/townAppearanceSignature.test.js test/townAssetCallers.test.js test/townAssetEpoch.test.js test/townAppearanceRoutes.test.js
73 tests / 73 pass / 0 fail
```

覆盖来源身份、fallback 变化、历史 unknown、主动更新与 current 跳过、linked NPC、standing 复用、换装/自然到期发生于生成期间、最终发布前拒绝、旧图保留、任意重绘清签名、裁剪/高清继承，以及新建失效任务终止。

包含旧 token/epoch 收尾隔离、生成期间配置保存、畸形 JSON 凭证、删除关联角色以及真实 localhost 路由严格布尔验证。路由使用实际 router，生成边界注入 fake，无真实生图。

随后补齐成功提交的配置合并回归，单独运行 `node --test test/townAssetEpoch.test.js`，41/41 通过，覆盖成功生成时保存不同值、同值、null、部分字段，以及裁剪/高清等待期间保存。该次与上述 73 项有重叠；未重跑整组。

另一次受影响回归：`townAssetPostProcess`、`townRuntimeIdentity`、`townRuntimeSimulation`、`townAppointmentRuntimeMovement`、`townBoundaryRuntime` 共 24/24 通过。不是 full suite 或真实模型验收；未访问真实存档、未调用真实生图。

后端改动限定 `townAppearanceSignature.js`、`townService.js` 的素材生成/列表、`townNpcService.js` 的素材生成/DTO、`townAssetService.js` 的来源提交和 guard，以及 `routes/town.js` 的两个 sprites handler。

## Admin 界面与 API 兼容

TownAdminPanel 按实际展示的 NPC/角色素材标注 current、needs_update、unknown，缺失图片不标成 unknown；保留原 standing 显示选择与复用。独立“按当前外观更新小人”按钮说明会重绘未知/过时素材，仅明确点击传 `refreshAppearance:true`。原“生成缺失小人”保持默认请求。两个生成动作均有局部 role=alert 与只读重新读取入口；409 失败保留旧图，不显示更新成功、不自动再提交。

主线已验证：所有生成失败采用中性错误提示，503 不误报为外观变化；409 fixture 使用真实错误码 `TOWN_ASSET_STALE`。每次打开 Admin 都重新读取列表，以 assetScope 与各列表独立 seq 隔离旧 GET。进行中的 sprites busy 状态跨关闭保留；请求成功时若面板已重开，仅发起当前列表 GET 更新，旧 scope 的错误不污染当前界面。

world/epoch 变化同样使旧读取失效，先清除旧居民、角色、玩家图片及详情，再读取新世界列表。新增浏览器 held GET 跨世界场景通过，旧居民不会在晚响应后复活；显式生成请求总数仍为10，没有因打开面板或世界变化自动生图。

`generateTownNpcSprites(id, overrides={})` 保留所有旧 overrides（包括 direction、force、styleTags、promptPrefix、loras、artist），仅删除新增字段 refreshAppearance 的非布尔值，不修改调用方对象。角色 sprites API 原无 options，新增 options 仅透传布尔 refreshAppearance。不能将 NPC 的旧 overrides 误改为只允许新增字段。

`web-ui/test/town-appearance-admin-browser.mjs` 使用真实 Admin/Vue/Pinia/API 与 synthetic HTTP，验证逐素材状态、缺失与未知区分、手动生成、两个动作的409保留旧图/零自动重试、standing 原选择、NPC 旧参数透传及角色新增参数白名单。375/1100截图已自检；结果与截图在 `output/hd2d-appearance-admin/`。未连接业务后端或调用模型。

据主线验收回报，新增 held GET 与 held POST 跨关闭/重开场景均通过；共 10 次 mock POST 包含 API 兼容测试，没有自动额外 POST。本节记录主线已完成的浏览器验证，本次文档更新未重跑浏览器或修改 UI。
