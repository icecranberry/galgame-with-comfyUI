/**
 * 在内置 QQWorld 之上加「出站文字按聊天习惯分句 + 推送节奏」的子类。
 *
 * 不复制上游发送逻辑：只在 tools() 里包装 qq_draft / qq_confirm 两个 handler——
 * 起草时冻结分段（首段连同图片/引用走原起草门，余段存在本类），确认时先发首段、
 * 再经上游 sendToTarget 逐段补发；段与段之间按打字节奏停顿（随句子长度变长、带抖动，
 * 与宿主私聊同一组常数）；失败保留余段，再次 confirm 只补发剩余。
 * 语音条与纯图片不参与分段，行为与上游一致。
 *
 * 依赖三个上游内部缝隙：qq_draft / qq_confirm 工具名与回执前缀
 * （`[draft staged`、`[sent`、`[no draft`）、`sendToTarget`、`pendingDraft.target`。
 * 构造时逐一探针，缺失即抛错（对应源码补丁方案的「冲突大声失败」）。
 * 行为回归由 agent-core/test/corticoSegmentedQQ.test.js 对真实上游类验证。
 */
import type { ToolCallContext, ToolDef } from 'cortico/core/types.ts';
import type { Language } from 'cortico/core/language.ts';
import type { ConfigGroup } from 'cortico/core/config-schema.ts';
import type { WorldWebUiDecl } from 'cortico/core/types.ts';
import { QQWorld } from 'cortico/worlds/qq/world.ts';
import { splitText } from '../../utils/sentenceSplitter.js';

/** 与聊天流出站共用同一套清洗（去 <br>、合并空行）与分句实现。 */
export function splitLinsheChatText(text: string): string[] {
  return splitText(text.replace(/<br\s*\/?>/gi, '').replace(/\n{2,}/g, '\n'))
    .filter((segment) => segment.trim());
}

/** 打字节奏：按刚发出分句的长度随机 300~900ms（短句快、长句慢、带随机抖动）。 */
export function chatTypingDelayMs(text: string): number {
  const len = Math.min(30, (text || '').length || 1); // 长度封顶 30 字，避免超长句停顿过久
  const base = 300 + (len / 30) * 300;                // 长度映射 300~600ms
  const jitter = Math.random() * 300;                 // 随机抖动 0~300ms
  return Math.min(900, Math.round(base + jitter));    // 最终落在 300~900ms
}

/** next＝已发出的段数；发送循环从 segments[next] 继续补发。 */
type SplitState = { target: unknown; segments: string[]; next: number };

type InternalAccess = {
  sendToTarget?: (this: QQWorld, target: unknown, opts: { text: string }) => Promise<string>;
  pendingDraft?: { target?: unknown } | null;
};

/** 把继承自内置 qq 定义的配置组改写到本 World 自己的段（id、owner 与 worlds.qq.* 路径）。 */
function remapConfigOwner(group: ConfigGroup): ConfigGroup {
  const remapped = structuredClone(group) as ConfigGroup;
  remapped.id = remapped.id === 'world:qq' ? 'world:qq-linshe' : remapped.id;
  if (remapped.owner === 'world:qq') remapped.owner = 'world:qq-linshe';
  const properties = remapped.schema?.properties as Record<string, unknown> | undefined;
  if (properties) {
    for (const key of Object.keys(properties)) {
      if (key.startsWith('worlds.qq.')) {
        properties[`worlds.qq-linshe.${key.slice('worlds.qq.'.length)}`] = properties[key];
        delete properties[key];
      }
    }
  }
  return remapped;
}

export class SegmentedQQWorld extends QQWorld {
  /** 装配层按定义 id 寻找槽位、Core 按实例 id 归属工具与事件，两者必须一致。 */
  override readonly id = 'qq-linshe';

  private splitState: SplitState | null = null;

  constructor(...args: ConstructorParameters<typeof QQWorld>) {
    super(...args);
    const access = this as unknown as Record<string, unknown>;
    if (typeof access.sendToTarget !== 'function' || !('pendingDraft' in access)) {
      throw new Error('qq-linshe：上游 QQWorld 缺少 sendToTarget/pendingDraft，分句适配与该版本不兼容；请更新 cortico-world-qq-linshe 或换回内置 qq World。');
    }
    const names = new Set(super.tools().map((def) => def.name));
    for (const name of ['qq_draft', 'qq_confirm'] as const) {
      if (!names.has(name)) {
        throw new Error(`qq-linshe：上游 QQWorld 工具表缺少 ${name}，分句适配与该版本不兼容；请更新 cortico-world-qq-linshe 或换回内置 qq World。`);
      }
    }
  }

  tools(): ToolDef[] {
    return super.tools().map((def) => {
      if (def.name === 'qq_draft') return { ...def, handler: this.wrapDraft(def.handler) };
      if (def.name === 'qq_confirm') return { ...def, handler: this.wrapConfirm(def.handler) };
      return def;
    });
  }

  /** 分段进行中到达轮末：连同余段一起作废（上游只作废自己的单槽草稿）。 */
  onTurnEnded(): void {
    this.splitState = null;
    super.onTurnEnded();
  }

  /**
   * 面板客户端按 page id 从框架构建清单解析，扩展 id 解析不到内置 qq 的 bundle；
   * 保留状态灯、徽标、配置页签（监听名单在配置里编辑），只裁掉三个自定义面板。
   * 继承来的配置组把写入路径指向 worlds.qq，这里整体重映射到本 World 自己的段。
   */
  webUi(language?: Language): WorldWebUiDecl {
    const { panels: _panels, ...decl } = super.webUi(language);
    if (decl.config) decl.config = decl.config.map((group) => remapConfigOwner(group));
    return decl;
  }

  private wrapDraft(handler: ToolDef['handler']): ToolDef['handler'] {
    return async (args: Record<string, unknown>, ctx: ToolCallContext) => {
      const raw = typeof args.text === 'string' ? args.text : '';
      const segments = raw.trim() ? splitLinsheChatText(raw) : [];
      if (segments.length <= 1) {
        this.splitState = null;
        return handler(args, ctx);
      }
      const receipt = await handler({ ...args, text: segments[0] }, ctx);
      const target = (this as unknown as InternalAccess).pendingDraft?.target;
      if (typeof receipt !== 'string' || !receipt.startsWith('[draft staged') || target === undefined) {
        this.splitState = null;
        return receipt;
      }
      this.splitState = { target, segments, next: 0 };
      const lines = [
        receipt,
        '',
        `Will send ${segments.length} text segments in order; image and quote reply appear only on the first segment.`,
      ];
      for (let i = 1; i < segments.length; i += 1) lines.push(`Segment ${i + 1}: ${segments[i]}`);
      return lines.join('\n');
    };
  }

  private wrapConfirm(handler: ToolDef['handler']): ToolDef['handler'] {
    return async (args: Record<string, unknown>, ctx: ToolCallContext) => {
      const state = this.splitState;
      if (!state) return handler(args, ctx);
      if (args.decision === 'cancel') {
        this.splitState = null;
        if (state.next > 0) {
          const remaining = state.segments.length - state.next;
          return `[draft discarded; ${state.next}/${state.segments.length} segments were already sent, remaining ${remaining} dropped]`;
        }
        return handler(args, ctx);
      }
      if (args.decision !== 'send') return handler(args, ctx);
      const receipts: string[] = [];
      if (state.next === 0) {
        const receipt = await handler(args, ctx);
        if (typeof receipt !== 'string' || !receipt.startsWith('[sent')) {
          if (typeof receipt === 'string' && receipt.startsWith('[no draft')) this.splitState = null;
          return receipt;
        }
        receipts.push(receipt);
        state.next = 1;
      }
      const send = (this as unknown as InternalAccess).sendToTarget!;
      while (state.next < state.segments.length) {
        // 段与段之间的打字节奏：按刚发出那段的长度停顿；轮次被取消时停在原地。
        if (!(await this.paceTyping(state.segments[state.next - 1], ctx))) {
          return this.partialReceipt(receipts, state, 'cancelled while typing');
        }
        try {
          const receipt = await send.call(this, state.target, { text: state.segments[state.next] });
          if (typeof receipt !== 'string' || !receipt.startsWith('[sent')) {
            return this.partialReceipt(receipts, state, receipt);
          }
          receipts.push(receipt);
          state.next += 1;
        } catch (error) {
          return this.partialReceipt(receipts, state, error instanceof Error ? error.message : String(error));
        }
      }
      this.splitState = null;
      return [`[sent ${state.segments.length} text segments]`, ...receipts].join('\n');
    };
  }

  private partialReceipt(receipts: string[], state: SplitState, failure: string): string {
    return [
      `[sent ${receipts.length}/${state.segments.length} text segments]`,
      ...receipts,
      `[send failed] ${failure} (remaining ${state.segments.length - state.next} segments kept; confirm again to retry or cancel)`,
    ].join('\n');
  }

  /** 两段之间的推送间隔；返回 false 表示轮次已取消。测试可把 typingDelayMs 归零加速。 */
  private async paceTyping(previousSegment: string, ctx: ToolCallContext): Promise<boolean> {
    const ms = this.typingDelayMs(previousSegment);
    if (ms <= 0) return true;
    const signal = ctx.signal;
    if (signal?.aborted) return false;
    return new Promise((resolve) => {
      const onAbort = () => { clearTimeout(timer); resolve(false); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(true); }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** 打字节奏常数与宿主私聊同一组；子类/测试可覆写。 */
  protected typingDelayMs(text: string): number {
    return chatTypingDelayMs(text);
  }
}
