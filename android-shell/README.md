# android-shell — 邻舍安卓网页壳

单 Activity + WebView 套壳应用：

- 首次启动输入后端地址（如 `http://192.168.1.100:3099`），保存到 SharedPreferences
- 网页内按返回键先打开角色列表，再按一次把 App 退到桌面；地址设置页保留退出确认
- 支持 `<input type="file">` 文件上传（头像上传）
- 允许明文 HTTP（局域网地址）
- release 构建使用仓库内固定 keystore（`release.keystore`，v1.8 起）签名，
  任何机器构建的包签名一致、可互相覆盖升级；keystore 缺失时回退 debug 签名。
  从 v1.7 及更早（debug 签名）升级到 v1.8+ 需卸载重装一次

## 立绘重力感应（v2.2 起）

- APK 内通过 `AndroidBridge.hasStandingGravity/startStandingGravity/stopStandingGravity` 读取原生传感器，内网 HTTP 可直接使用，无需 HTTPS 或额外传感器权限。普通浏览器仍走 HTTPS 的设备方向接口。
- 优先使用重力传感器，缺失时回退加速度计低通滤波，最多约 30 次/秒传递倾斜数据；前端负责握持姿势校准、位移限幅与平滑。
- 仅配置服务器的 `/#/standing-display` 页面接收数据；环境支持时自动开启，无需开关；离开页面、打开地址设置、进入后台或销毁 Activity 时停止采集。前台恢复重新校准。
- 需覆盖安装 v2.2 或更新版本 APK 并更新服务器前端资源。旧 APK 在 HTTP 下不显示重力感应入口；无硬件或无有效数据时保留静态展示与原有动效。

## 保存图片到相册

- 网页图片预览中的下载按钮通过 `AndroidBridge.saveImage` 保存到公共 `Pictures/邻舍/`，相册中显示为「邻舍」，首次保存时自动创建。
- 点击保存时请求系统权限：Android 8–9 请求存储读写权限，Android 10–12 请求存储读取权限，Android 13+ 请求照片权限；Android 14+ 也接受「仅允许部分照片」。
- 授权后自动完成本次保存；拒绝后不保存，并提示前往系统应用权限设置授权后重试。已授权时直接保存。
- Android 10+ 使用 MediaStore 发布图片，系统本身不要求保存自有图片的权限；这里按产品要求增加保存前的相册授权。Android 8–9 写公共目录后触发媒体扫描。

## 通知推送（仅局域网内生效）

前台服务（SseNotificationService）保持一条到 `/api/stream` 的原生 SSE 长连接，
App 退到后台/锁屏后仍能收事件并弹系统通知，点击通知跳转对应页面。

| 通知类别 (channel) | 对应 SSE 事件 | 点击跳转 |
|---|---|---|
| 聊天消息 | proactive_message, delayed_reply | /chat/:id |
| 朋友圈 | new_post, new_comment | /moments |
| 群聊 | group_message, group_created | /group/:id |
| 信箱 | reply_ready | /mailbox |
| 事件 | new_event, event_concluded, event_expired | /events |

- 分类开关：App 内设置页（地址输入页）有 5 个复选框；系统设置的通知渠道里也能按类关闭
- App 在前台时不弹通知（页面内已有红点/实时追加）
- 断线指数退避重连（5s→60s 封顶），服务端心跳 30s、客户端 90s 读超时判死链
- 保活依赖：电池优化白名单（保存时自动弹引导）；国产 ROM 还需手动允许「自启动 + 无限制后台」
- 开机自启：BootReceiver（同样受 ROM 自启动白名单限制）

## 构建方式

**方式一（推荐）**：项目根目录 `npm run apk`，脚本（scripts/build-apk.mjs）会自动下载便携
JDK 17 / Android SDK / Gradle 到 `launcher/build_cache/android-toolchain/`（仅构建缓存，
不进发布包），产物在 `app/build/outputs/apk/release/app-release.apk`。

**方式二**：`npm run release` 会自动调用同一构建逻辑，并把 APK 打入发布压缩包
（构建失败只警告，不阻塞 release）。

**方式三**：用 Android Studio 打开本目录，直接构建。

源码已入库；构建产物（`app/build/`、`.gradle/`）与本地配置（`local.properties`）被 `.gitignore` 忽略。
发布物为 `npm run release` 打入压缩包的 APK。

## 应用图标

图标源文件是本目录下的 **`app-icon.png` 或 `app-icon.jpg`**（任意正方形图，建议 ≥256px，
两者都存在时 png 优先）。构建时由 gradle 的 `syncAppIcon` 任务（preBuild 前置）自动同步到
`app/src/main/res/drawable-nodpi/ic_launcher_image.*`（该 res 文件是派生产物，不入库），
`npm run apk` 与 Android Studio 两条构建路径均生效；两处源图都缺失时构建会报错提示。
**换图标 = 覆盖 `app-icon.png|jpg` 后重新构建**，无需改代码。
它同时用于桌面图标（全出血自适应，边缘约 1/4 会被启动器蒙版裁掉，主体放中间）和 App 内欢迎页。
