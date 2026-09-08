# Central 人格与外观回归

新增 `agent-core/test/characterPersona.test.js`，补齐 AGENTS 与计划2.3要求的正式入口测试。未修改 `characterPersona.js`、outfitService 或 shared 拼接口径。

测试使用实际 central 模块源码，仅注入 getActiveOutfits 依赖；无外观、short/full/person、纯 appearance/crossref 及三种外观优先级使用固定人工输入和字节级预期。三种优先级完整锁定清单、基础降级说明、替换裁定和换行；预期不由待测拼接函数生成。

另复用 townAppearanceFixture，以显式内存 SQLite 与 query_only 验证真实 outfit 查询按角色 id 隔离、无生效衣装与显式 null 禁用。覆盖自定义 joiner、空输入、缺外观标题、数组衣装和空衣装对象；不加载真实存档，不调用模型或图片生成。

短模式缺少简介和外观标题时保留历史整卡 fallback、不注入外观，是当前入口明确记载的兼容边界。本测试不改变该行为，也不验证图像模型是否遵守文字裁定或所有调用方是否传入正确 id。

CPU profile 窗口解除后，新增正式测试9/9通过；与 `townAppearanceSignature.test.js` 组合17/17通过，0 fail/cancelled/skipped。命令：`node --test --test-reporter=spec --test-concurrency=4 test/characterPersona.test.js test/townAppearanceSignature.test.js`。日志：`output/hd2d-persona-regression.log`。未发现需修改 central 生产口径的问题。
