# B 链工坊固定发型卡 UI

## 合同与范围

复用 TownLifePanel、TownWorkshopService 和原 TownDialogueStage，没有新增视觉体系或背包入口。工坊报价前仅有两个固定选择：心情修复贴、波波头发型卡。生产解锁只读取 `service.catalog[].available`；未解锁显示首次真实生产完成后的解锁说明。可选不等于营业、到场或余额充足，报价入口还检查经济开关与已知营业状态；最终资格由服务端判定。

新发型卡 offer 发送 `serviceKey: 'town.workshop.bob_cut'`。默认心情服务（包括显式默认选择）不发送 serviceKey，保留原请求体和旧 fingerprint。接受、回合、取消请求不发送新的 serviceKey，也不从 UI 传 template/outcome/config。聚合入口已存在所需函数，本切片没有修改 api/index.js。

已有会话只按返回 `serviceKey/serviceName/serviceDescription` 展示；旧 DTO 缺少这些字段时回退心情修复贴。会话存在或 pending 未确认时隐藏新选择，pending offer 的显示与重试沿用原始请求。目录后来锁定、停业或关闭经济不隐藏已有收据，不改变冻结产物。

费用沿用 30 邻币、1 份材料及既有退款说明。发型卡明确告知：到原背包手动使用后生效24小时，不自动换发型或生图，不新增免费回访。UI 不实现或推断生产 proof、扣费、发物与背包效果。

## 定向验证

- `node --test test/town-life-api.test.mjs`：**5/5通过**。新增验证默认offer无serviceKey、bob固定key、持久pending原body重试、accept不带选择字段及拒绝带@1的错误key。
- `node test/town-workshop-bob-browser.mjs`：**通过**，复用真实工坊组件fixture与API聚合入口。覆盖服务端解锁、停业/经济关闭gate、bob报价响应丢失后刷新不自动POST、同key同body重试、冻结bob收据在重新锁定/停业后恢复，以及旧DTO回退mood。375×667和740×360检查，无横向溢出、返回操作可达。场景共 **2次POST**，为同一次offer及其重试。
- `node test/town-workshop-browser.mjs`：**通过，主场景20次POST**。保留原退款、阶段推进、关闭重开、epoch与A→B接口恢复回归；新服务fixture明确恢复营业前提，已接受服务停业续办覆盖仍保留。
- `node test/town-life-browser.mjs`：**通过，主场景11次POST、钱包30**。原配送和生活面板恢复回归保持。

命令均在 web-ui 下串行执行，PLAYWRIGHT_MODULE 指向本地 playwright-core，浏览器为 headless Edge。所有HTTP由fixture拦截；bob完成收据是服务端DTO模拟，不将该UI测试描述为真实生产/四阶段发物/24h背包效果验收。未调用真实模型或修改真实配置，未运行全套构建与后端测试。主场景POST计数不包含旧测试的独立边界helper。

## B 链截图复核

仅重跑 `town-workshop-bob-browser.mjs` 一次，通过（仍为同一offer及重试共2次POST）；没有重跑旧API/Workshop/Life套件。测试已长期保留截图输出至 `output/hd2d-b-workshop-ui/`：

- `375-locked.png`：首次生产前锁定。
- `375-unlocked.png`、`375-unlocked-offer-action.png`：解锁选中bob及滚动后报价操作。
- `375-bob-quote.png`、`375-bob-quote-accept.png`：bob报价与接受收费操作。
- `375-bob-receipt.png`：冻结bob完成收据及背包指引。
- `740-available.png`、`740-available-offer-action.png`：横屏可用状态及滚动后报价操作。
- `740-bob-receipt.png`：横屏收据与返回操作。

上述9张均已通过 view_image 实际审阅。未见文字/按钮重叠或横向溢出；375首屏及740短横屏的报价操作需在原对话正文内滚动，已分别保留顶部与操作位置截图，关闭控件保持可见。此轮没有发现需要修改生产UI的功能问题。截图里的服务说明与人物占位来自隔离fixture，不是生产素材或真实交易结果。
