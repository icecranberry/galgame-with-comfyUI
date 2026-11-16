# 月星楷本地字体

- 上游：https://github.com/GuiWonder/MoonStarsKai
- 版本：1.102，与此前 CDN 字体版本一致。
- 下载：https://github.com/GuiWonder/MoonStarsKai/releases/download/1.102/MoonStarsKaiTTF.7z
- 原文件：归档内的 `MoonStarsKai-Regular.ttf`。
- 版权：Copyright 2023-2024 Moon Stars Kai Project Authors (https://github.com/GuiWonder/MoonStarsKai)
- 授权：SIL Open Font License 1.1，原文随应用发布于 `web-ui/public/licenses/moon-stars-kai.txt`。

`MoonStarsKai-Regular.woff2` 由官方完整 TTF 使用 FontTools 转换为 WOFF2，未做字符子集化或分片，保留全部字形、字符映射与 OpenType 表。

- 字形数：30,333；Unicode 字符映射：22,406。
- WOFF2 大小：5,812,708 字节。
- 原 TTF SHA-256：`b53358b56d57dcd801624a70467d1477541b560cf95a13d177c31cb210a451ea`。
- WOFF2 SHA-256：`6e95b7fce63e6926aa532f723fcec11f2ad0da2ddd532f78edeeeb9f156f58cc`。

`fonts.css` 注册字体，由 Vite 输出带内容哈希的本地资源；`useHandwritingFont.loadFont('moon_stars_kai')` 主动加载完整字库，神说、信件和日记共用。首次下载期间仍允许系统楷体回退，不阻塞文字显示。
