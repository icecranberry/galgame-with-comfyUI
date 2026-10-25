/**
 * cortico-world-qq-linshe（QQ 分句发送）：让 QQ 出站文字按聊天分句规则拆分发送的 World 扩展。
 *
 * 整体继承内置 qq 定义（defaults / describe / 事件声明原样复用），只换 id 与 create——
 * 装配代码与内置定义逐行对应，唯一的差别是把模块换成 SegmentedQQWorld 子类。
 * 上游 Cortico 源码保持零改动；配置段是 worlds.qq-linshe。
 */
import type { WorldContext, WorldDefinition } from 'cortico/world.ts';
import { QQ } from 'cortico/worlds/qq/definition.ts';
import { QQ_SECRETS, type QQConfigSection } from 'cortico/worlds/qq/config.ts';
import { enabledRosterIds } from 'cortico/worlds/qq/world.ts';
import { VisionService } from 'cortico/worlds/qq/vision.ts';
import { OpenRouterVLMClient } from 'cortico/worlds/qq/vlm.ts';
import { SegmentedQQWorld } from './segmented-qq-world.ts';

export default {
  ...QQ,
  id: 'qq-linshe',
  label: 'QQ 分句发送',
  create: (ctx: WorldContext<QQConfigSection>) => {
    const { cfg } = ctx;
    // 辅助视觉依赖开关与密钥;没有它时,主模型收图则由 QQWorld 自己下载图片附件。
    const openrouterKey = ctx.secret(QQ_SECRETS.vision);
    const vision = cfg.vision.enabled && openrouterKey
      ? new VisionService({
          vlm: new OpenRouterVLMClient(openrouterKey, {
            baseUrl: cfg.vision.baseUrl,
            model: cfg.vision.model,
            maxTokens: cfg.vision.maxTokens,
            timeoutMs: cfg.vision.timeoutMs,
          }),
          cfg: cfg.vision,
          dataDir: ctx.dataDir,
          timezone: ctx.timezone,
        })
      : undefined;
    const module = new SegmentedQQWorld(
      {
        wsUrl: cfg.wsUrl,
        groups: enabledRosterIds(cfg.groups),
        privates: enabledRosterIds(cfg.privates),
        token: cfg.token,
        timezone: ctx.timezone,
      },
      {
        vision,
        imageCapture: cfg.vision,
        gate: {
          enabled: () => cfg.enabled,
          wsUrl: () => cfg.wsUrl,
          tokenSet: () => !!cfg.token,
          roster: () => ({ groups: cfg.groups, privates: cfg.privates }),
          setRoster: (groups, privates) => {
            // The running module receives only enabled entries; the full roster is persisted.
            module.setWatched(enabledRosterIds(groups), enabledRosterIds(privates));
            ctx.persist({ groups, privates });
            const gOn = groups.filter((e) => e.enabled).length;
            const pOn = privates.filter((e) => e.enabled).length;
            return `监听名单已更新:群${groups.length}个(启用${gOn})、私聊${privates.length}个(启用${pOn}),已写回config.json`;
          },
          setEnabled: (enabled) => ctx.persist({ enabled }),
          setConnection: (wsUrl, token) => {
            // 空串 = 保持原 token 不动
            ctx.persist(token === '' ? { wsUrl } : { wsUrl, token });
          },
          restart: () => { void ctx.restart(); },
        },
      },
    );
    return module;
  },
} satisfies WorldDefinition<QQConfigSection>;
