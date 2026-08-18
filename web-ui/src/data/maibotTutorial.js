// MaiBot 安装教程，内容与启动器 launcher/launcher/maibot_page.py 保持一致。
export const MAIBOT_INTRO_TEXT =
  'MaiBot 用于在群内快速部署一个 QQ 机器人。它与 SnowLuma 连接器配套运行，' +
  '让邻舍的纸片人可以在 QQ 群和私聊中接收消息、自动回复营业。'

export const MAIBOT_INSTALL_STEPS = [
  {
    title: '① 下载一键包',
    body: '从 <a href="https://pan.quark.cn/s/8ee40c22ccc6?pwd=SWwE" target="_blank" rel="noopener">夸克网盘（提取码 SWwE）</a> 下载 MaiBot 一键包。',
  },
  {
    title: '② 解压到邻舍根目录',
    body: '将压缩包解压到邻舍根目录（与 邻舍.EXE.exe 同级），确保根目录下出现 MaiBot-Container 文件夹（里面包含 MaiBot 和 Snowluma）。',
  },
  {
    title: '③ 观看安装视频',
    body: 'B 站 <a href="https://space.bilibili.com/632137" target="_blank" rel="noopener">@琪猫猫来了全秒了</a> 有完整的安装演示，跟着做即可。',
  },
  {
    title: '④ 完成安装',
    body: '回到邻舍启动器的 MaiBot 页面，点击「我已安装，重新检测」，之后即可在启动器一键启动（也可以直接双击 MaiBot-Container\\start.bat）。',
  },
]

export const MAIBOT_AFTER_START_STEPS = [
  '默认 Token：MaiBot 后台为 MaiBot.admin，SnowLuma 后台为 Snowluma.admin',
  '先去 Snowluma 后台连接已登录、用作机器人的 QQ 客户端，消息才能被截取和注入',
  '在后台「模型列表」配置 LLM 模型',
  '麦麦设置 → 核心设置 → 填写机器人 QQ 号',
  '在 MaiBot 的插件管理 → Snowluma 连接器里配置接收消息的 QQ 群或私聊账号（强烈建议在聊天管理中把发言频率降低到 0.05，避免刷屏）',
]
