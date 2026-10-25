# Changelog

## Unreleased

- 移除心跳自醒：Persona 不再定时注入 `[自醒]` 事件唤醒主动发言，只由外部事件（QQ / 控制台来信）驱动；`tick` 配置项废除，`end_turn` 文案不再提心跳。

## 0.1.0

- 首版：邻舍角色人格前缀（桥接实时拉取）、MEMORY.md 记忆、console/qq/linshe 三渠道声明。
