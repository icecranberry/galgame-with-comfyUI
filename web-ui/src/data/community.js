/**
 * 社区与致谢信息（手动维护）
 *
 * 为什么单独一个文件、而不是写进 changelog.js：
 * changelog.js 的内容一变，CHANGELOG_FLAG 就会变，所有用户都会被重新弹一次更新说明。
 * 群号 / 仓库地址 / 鸣谢名单属于长期不变的信息，改它们不该打扰用户，因此单独放置。
 *
 * 改这里的任何内容都不会触发更新说明弹窗。
 */

/** 交流渠道：label 为按钮上的文字，text 为紧随其后的高亮内容（可省略） */
export const COMMUNITY_LINKS = [
  {
    key: 'qq',
    label: '交流群',
    text: '1056624274',
    url: 'https://qm.qq.com/q/OhEJWMWGqu',
    title: '点击加入邻舍交流群（1056624274）',
  },
  {
    key: 'github',
    label: 'GitHub 仓库',
    text: 'icecranberry/galgame-with-comfyUI',
    url: 'https://github.com/icecranberry/galgame-with-comfyUI',
    title: 'https://github.com/icecranberry/galgame-with-comfyUI',
  },
  {
    key: 'bilibili',
    label: '哔哩哔哩',
    text: '@琪猫猫来了全秒了',
    url: 'https://space.bilibili.com/632137',
    title: '点击前往 @琪猫猫来了全秒了 的哔哩哔哩主页',
  },
]

/** 特别鸣谢：names 用 、 连接展示 */
export const SPECIAL_THANKS = [
  { label: '技术支持', names: ['派萌=.=', '刘明诚', '千野'] },
  { label: 'Token支持', names: ['柚子', 'ギルティクラウン', '小奇wsq'] },
]
