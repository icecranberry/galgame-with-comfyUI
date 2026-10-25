/** 邻舍 World：角色人设资料、内容查询、生图与语音工具；媒体以回执附件交给 Persona 发送。 */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { ToolCallContext, ToolDef, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import { nowIso } from 'cortico/core/util.ts';
import { LINSHE_CONFIG_GROUP, type LinsheConfigSection } from './config.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));

const MAX_TEXT_CHARS = 12000;
const MAX_MEDIA_BYTES = 32 * 1024 * 1024;
const POLL_INTERVAL_MS = 2000;
const IMAGE_DELIVERY = '用当前会话支持的媒体发送工具交付 [blob …] 里的 log: 句柄；QQ 会话用 qq_draft 的 image 参数。当前会话不能发送图片时如实说明，未经用户指定不要改发其他会话。';
const SPEECH_DELIVERY = '用当前会话支持的媒体发送工具交付 [blob …] 里的 log: 句柄；QQ 语音条独占一条消息，qq_draft 只传 voice，不带 text、image 或 reply_to。当前会话不能发送语音时如实说明，未经用户指定不要改发其他会话。';

type Query = Record<string, string | number | undefined | null>;

interface LinsheWorldOptions {
  /** `worlds.linshe` 的活引用；热改的键现读即生效。 */
  cfg: LinsheConfigSection;
  timezone: string;
}

/** 全部工具的声明；定义里的 describe 与 `tools()` 都取它。描述口径与邻舍桥接 tools.json 一致。 */
export const LINSHE_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  {
    name: 'linshe_characters',
    description: '列出角色及其 ID；要指定其他角色前先查询。',
    tags: ['read'],
    parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] },
  },
  {
    name: 'linshe_character',
    description: '查询角色人物卡。不传 character_id 即查询当前角色。',
    tags: ['read'],
    parameters: {
      type: 'object',
      properties: { character_id: { type: 'integer', minimum: 1, description: '角色 ID，省略为当前角色' } },
      additionalProperties: false,
      required: [],
    },
  },
  {
    name: 'linshe_appearance',
    description: '查询角色原本外观、当前生效衣装、限时服饰及可用形态。',
    tags: ['read'],
    parameters: {
      type: 'object',
      properties: { character_id: { type: 'integer', minimum: 1 } },
      additionalProperties: false,
      required: [],
    },
  },
  {
    name: 'linshe_moments',
    description:
      '查询朋友圈最新动态。默认返回所有人混排的动态；只要看某个人（包括自己）发的，传 character_id。before_id 用于继续向前翻页。',
    tags: ['read'],
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        before_id: { type: 'integer', minimum: 1 },
        character_id: { type: 'integer', minimum: 1, description: '角色 ID，只返回该角色发的动态；查询自己的最近动态时必传' },
      },
      additionalProperties: false,
      required: [],
    },
  },
  {
    name: 'linshe_moment',
    description: '查询一条朋友圈及其评论，post_id 来自朋友圈列表。',
    tags: ['read'],
    parameters: {
      type: 'object',
      properties: { post_id: { type: 'integer', minimum: 1 } },
      required: ['post_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'linshe_events',
    description: '按时间倒序查询角色、镇民及建筑当前奇遇与历史；仅查询。has_more 为 true 时，将 next_offset 作为 offset 继续翻页。',
    tags: ['read'],
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        offset: { type: 'integer', minimum: 0, description: '列表回执的 next_offset，省略从第一页开始' },
      },
      additionalProperties: false,
      required: [],
    },
  },
  {
    name: 'linshe_event',
    description: '按奇遇列表返回的 ID 查询内容、选项和选择历史。',
    tags: ['read'],
    parameters: {
      type: 'object',
      properties: { event_id: { type: 'string', maxLength: 80, description: '奇遇 ID，如 123 或 town:123' } },
      required: ['event_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'linshe_schedule',
    description: '查询角色今日日程和当前活动；默认只返回当前时间前后一小时内的日程，要讲一整天的安排时传 full。',
    tags: ['read'],
    parameters: {
      type: 'object',
      properties: {
        character_id: { type: 'integer', minimum: 1 },
        full: { type: 'boolean', description: '返回今日完整日程；省略只看当前前后一小时' },
      },
      additionalProperties: false,
      required: [],
    },
  },
  {
    name: 'linshe_newspaper',
    description: '查询小镇日报，省略日期查询今天；不存在时如实告知。',
    tags: ['read'],
    parameters: {
      type: 'object',
      properties: { date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD，省略为今天' } },
      additionalProperties: false,
      required: [],
    },
  },
  {
    name: 'linshe_diary',
    description: '查询角色某日已生成的日记。',
    tags: ['read'],
    parameters: {
      type: 'object',
      properties: {
        character_id: { type: 'integer', minimum: 1 },
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      },
      additionalProperties: false,
      required: [],
    },
  },
  {
    name: 'linshe_world',
    description: '查询你所处世界的设定。',
    tags: ['read'],
    parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] },
  },
  {
    name: 'linshe_task',
    description:
      '查询生图或语音任务的最新状态，完成时回执带可发送的媒体。生图传数字 task_id；语音传 kind="speech" 与 linshe_tts 返回的字符串 task_id。',
    tags: ['read'],
    parameters: {
      type: 'object',
      properties: {
        task_id: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'string', minLength: 1, maxLength: 200 }], description: '生图回执的数字 ID，或语音回执的字符串 ID' },
        kind: { type: 'string', enum: ['image', 'speech'], description: '任务类型，省略为 image；查询语音须传 speech' },
      },
      required: ['task_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'linshe_moment_images',
    description:
      '取回朋友圈配图供你发送；需要给用户看朋友圈照片时用本工具。传 post_id 取该帖全部配图，或传 paths 直接取查询结果 images 字段里已携带的图片路径（如 /images/moments/xx.png），二者至少传一个。',
    tags: ['act'],
    barrierAfter: true,
    parameters: {
      type: 'object',
      properties: {
        post_id: { type: 'integer', minimum: 1 },
        paths: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 9, description: '朋友圈查询结果 images 字段中的图片路径，可一次多张' },
      },
      additionalProperties: false,
      required: [],
    },
  },
  {
    name: 'linshe_generate_image',
    description:
      '按用户要求为角色生成图片，自动采用该角色外观、衣装与生图配置。工具会等待生成完成并返回可发送的图片；相同参数返回同一张图，想要不同的图请改变描述或传入不同 nonce。',
    tags: ['act'],
    barrierAfter: true,
    parameters: {
      type: 'object',
      properties: {
        requirement: { type: 'string', minLength: 1, maxLength: 4000, description: '完整的画面需求，可用中文' },
        character_id: { type: 'integer', minimum: 1 },
        nonce: { type: 'string', maxLength: 64, description: '可选。相同画面需求想要重画一张时，换一个任意字符串' },
      },
      required: ['requirement'],
      additionalProperties: false,
    },
  },
  {
    name: 'linshe_tts',
    description: '使用角色已绑定的音色朗读文字，工具会等待合成完成并返回可发送的语音。',
    tags: ['act'],
    barrierAfter: true,
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 1000, description: '需要朗读的对白' },
        character_id: { type: 'integer', minimum: 1 },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
];

function dump(data: unknown): string {
  // 回执进模型上下文后可能被原话复读：内部系统名统一换成圈内说法。
  const text = JSON.stringify(data).replaceAll('邻舍', '小镇');
  if (text.length <= MAX_TEXT_CHARS) return text;
  return text.slice(0, MAX_TEXT_CHARS) + '…（结果过长已截断，可用更具体的参数缩小查询范围）';
}

function optInt(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const onAbort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export class LinsheWorld implements World {
  readonly id = 'linshe';

  constructor(private readonly opts: LinsheWorldOptions) {}

  private get cfg(): LinsheConfigSection {
    return this.opts.cfg;
  }

  private base(): string {
    return this.cfg.baseUrl.trim().replace(/\/+$/, '');
  }

  /** 只报值；前缀文本一律来自 ENV_PROMPT.md 模板。 */
  envPromptVars(): Record<string, string> {
    return {
      'linshe.taskTimeoutSec': String(this.cfg.taskTimeoutSec),
    };
  }

  tools(): ToolDef[] {
    return LINSHE_TOOL_DECLS.map((decl) => ({
      ...decl,
      handler: (args: Record<string, unknown>, ctx: ToolCallContext) => this.dispatch(decl.name, args, ctx),
    }));
  }

  webUi(): WorldWebUiDecl {
    return {
      config: [LINSHE_CONFIG_GROUP],
      promptDocs: [
        {
          key: 'worlds.linshe.envPrompt',
          title: 'Linshe · 环境提示词',
          description: '邻舍 World 进 system 前缀的那一段。',
          path: ENV_PROMPT_FILE,
          role: 'envPrompt',
          vars: [
            { name: 'linshe.taskTimeoutSec', description: '配置里的任务等待上限,此刻的值。' },
          ],
        },
      ],
    };
  }

  /** 挂载时投递状态事件；origin: internal 表示 World 的内部机制事件。 */
  async start(host: WorldHost): Promise<void> {
    await host.pushEvent({
      type: 'linshe.started',
      ts: nowIso(this.opts.timezone),
      source: this.id,
      origin: 'internal',
      senderKey: this.id,
      text: '你的生活数据已接通，查询与分享工具可用。',
    });
  }

  async stop(): Promise<void> {}

  // ---------------------------------------------------------------- API 访问

  private async api(method: 'GET' | 'POST', path: string, opts: { query?: Query; json?: unknown; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<unknown> {
    const url = new URL(this.base() + '/api/cortico' + path);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const signal = requestSignal(opts.signal, opts.timeoutMs ?? 30000);
    const response = await fetch(url, {
      method,
      headers: opts.json !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
      redirect: 'manual',
      signal,
    });
    let data: unknown = null;
    try { data = await response.json(); } catch (error) { if (signal.aborted) throw error; }
    if (response.status >= 300) {
      const message = (data as { error?: string } | null)?.error || `邻舍请求失败 (HTTP ${response.status})`;
      throw new Error(message);
    }
    return data;
  }

  /** 读取邻舍媒体；与桥接一致限制同源与 32MB。 */
  private async media(path: string, signal?: AbortSignal): Promise<{ bytes: Uint8Array; mime: string }> {
    const base = new URL(this.base());
    const url = new URL(path, base.origin + '/');
    if (url.origin !== base.origin) throw new Error('邻舍媒体地址不属于已配置的服务');
    const response = await fetch(url, { redirect: 'manual', signal: requestSignal(signal, 60000) });
    if (response.status !== 200) throw new Error(`邻舍媒体读取失败 (HTTP ${response.status})`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_MEDIA_BYTES) throw new Error('邻舍媒体超过 32MB，请在邻舍查看');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_MEDIA_BYTES) throw new Error('邻舍媒体超过 32MB，请在邻舍查看');
    const mime = (response.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
    return { bytes, mime };
  }

  /** 轮询任务直到完成；超时返回 null，由调用方决定如何向模型交代。生图任务 ID 为数字，语音任务 ID 为 UUID 字符串。 */
  private async waitTask(kind: 'image' | 'speech', id: number | string, ctx: ToolCallContext): Promise<{ url: string } | null> {
    const timeout = AbortSignal.timeout(Math.max(30, Math.min(3600, this.cfg.taskTimeoutSec)) * 1000);
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
    try {
      while (!signal.aborted) {
        const path = kind === 'image' ? `/tasks/${id}` : `/speech/${encodeURIComponent(id)}`;
        const data = await this.api('GET', path, { signal }) as { status?: string; error?: string; image?: { url?: string } | null; audio_url?: string | null };
        const status = data.status;
        if (status === 'done' || status === 'completed') {
          const url = kind === 'image' ? data.image?.url : data.audio_url;
          if (!url) throw new Error('邻舍任务已完成但没有返回媒体地址');
          return { url };
        }
        if (status === 'failed' || status === 'cancelled') throw new Error(data.error || '邻舍任务失败或已取消');
        await sleep(POLL_INTERVAL_MS, signal);
      }
    } catch (error) {
      if (ctx.signal?.aborted) throw new Error(`本轮已取消；可用 linshe_task(kind="${kind}", task_id=${JSON.stringify(id)}) 查询已提交的任务`);
      if (!timeout.aborted) throw error;
    }
    if (ctx.signal?.aborted) throw new Error('本轮已取消');
    return null;
  }

  // ---------------------------------------------------------------- 工具实现

  private async dispatch(name: string, args: Record<string, unknown>, ctx: ToolCallContext): Promise<string | { text: string; blobs: Array<{ bytes: Uint8Array; mime: string; name: string; fallbackText: string }> }> {
    try {
      if (ctx.signal?.aborted) throw new Error('本轮已取消');
      return await this.handlers(name, args, ctx);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  }

  private async handlers(name: string, args: Record<string, unknown>, ctx: ToolCallContext): Promise<string | { text: string; blobs: Array<{ bytes: Uint8Array; mime: string; name: string; fallbackText: string }> }> {
    const characterId = optInt(args.character_id);
    switch (name) {
      case 'linshe_characters':
        return dump(await this.api('GET', '/characters', { signal: ctx.signal }));
      case 'linshe_character':
        return dump(await this.api('GET', '/character', { query: { character_id: characterId }, signal: ctx.signal }));
      case 'linshe_appearance':
        return dump(await this.api('GET', '/appearance', { query: { character_id: characterId }, signal: ctx.signal }));
      case 'linshe_moments':
        return dump(await this.api('GET', '/moments', {
          query: { limit: optInt(args.limit), before_id: optInt(args.before_id), character_id: characterId },
          signal: ctx.signal,
        }));
      case 'linshe_moment':
        return dump(await this.api('GET', `/moments/${optInt(args.post_id)}`, { signal: ctx.signal }));
      case 'linshe_events':
        return dump(await this.api('GET', '/events', { query: { limit: optInt(args.limit), offset: args.offset === undefined ? undefined : Number(args.offset) }, signal: ctx.signal }));
      case 'linshe_event': {
        const id = String(args.event_id ?? '').trim();
        if (!id || id.length > 80) throw new Error('event_id 必填（如 123 或 town:123）');
        return dump(await this.api('GET', `/events/by-id/${encodeURIComponent(id)}`, { signal: ctx.signal }));
      }
      case 'linshe_schedule': {
        const full = args.full === true || args.full === 'true' || args.full === 1;
        return dump(await this.api('GET', '/schedule', { query: { character_id: characterId, full: full || undefined }, signal: ctx.signal }));
      }
      case 'linshe_newspaper': {
        const date = typeof args.date === 'string' && args.date.trim() ? args.date.trim() : undefined;
        return dump(await this.api('GET', '/newspaper', { query: { date }, signal: ctx.signal }));
      }
      case 'linshe_diary': {
        const date = typeof args.date === 'string' && args.date.trim() ? args.date.trim() : undefined;
        return dump(await this.api('GET', '/diary', { query: { character_id: characterId, date }, signal: ctx.signal }));
      }
      case 'linshe_world':
        return dump(await this.api('GET', '/world', { signal: ctx.signal }));
      case 'linshe_task': {
        const kind = args.kind ?? 'image';
        if (kind !== 'image' && kind !== 'speech') throw new Error('kind 须为 image 或 speech');
        const id = kind === 'image' ? optInt(args.task_id) : typeof args.task_id === 'string' ? args.task_id.trim() : undefined;
        if (!id || String(id).length > 200) throw new Error('task_id 必填：生图使用数字 ID，语音使用字符串 ID');
        const path = kind === 'image' ? `/tasks/${id}` : `/speech/${encodeURIComponent(id)}`;
        const data = await this.api('GET', path, { signal: ctx.signal }) as { status?: string; image?: { url?: string } | null; audio_url?: string | null; error?: string };
        if (data.status === 'done' || data.status === 'completed') {
          const url = kind === 'image' ? data.image?.url : data.audio_url;
          if (!url) throw new Error('邻舍任务已完成但没有返回媒体地址');
          const media = await this.media(url, ctx.signal);
          return {
            text: kind === 'image'
              ? `生图任务 #${id} 已完成。${IMAGE_DELIVERY}`
              : `语音任务 #${id} 已完成。${SPEECH_DELIVERY}`,
            blobs: [{ ...media, name: `linshe-${id}.${kind === 'image' ? 'png' : 'wav'}`, fallbackText: kind === 'image' ? '按用户要求生成的图片' : '角色语音' }],
          };
        }
        return dump(data);
      }
      case 'linshe_moment_images': {
        let paths = (Array.isArray(args.paths) ? args.paths : []).filter((p): p is string => typeof p === 'string' && p.startsWith('/')).slice(0, 9);
        const postId = optInt(args.post_id);
        if (!paths.length && !postId) throw new Error('需要提供 post_id 或 paths');
        if (paths.length) {
          const bootstrap = await this.api('GET', '/bootstrap', { signal: ctx.signal }) as { tools?: Array<{ name: string }> };
          if (!bootstrap.tools?.some(tool => tool.name === 'linshe_moment_images')) throw new Error('邻舍已关闭 moments 工具');
        }
        if (!paths.length) {
          const data = await this.api('GET', `/moments/${postId}/images`, { signal: ctx.signal }) as { images?: string[] };
          paths = (data.images || []).filter((p) => typeof p === 'string' && p).slice(0, 9);
          if (!paths.length) return '这条朋友圈没有配图。';
        }
        const blobs: Array<{ bytes: Uint8Array; mime: string; name: string; fallbackText: string }> = [];
        for (const [index, p] of paths.entries()) {
          const media = await this.media(p, ctx.signal);
          blobs.push({ ...media, name: `moment-${postId ?? index}-${index}.png`, fallbackText: '朋友圈配图' });
        }
        return {
          text: `已取到 ${blobs.length} 张朋友圈配图。${IMAGE_DELIVERY} 多张图逐条发送；QQ 每次 qq_draft 只带一张图，qq_confirm 成功后再起草下一条。`,
          blobs,
        };
      }
      case 'linshe_generate_image': {
        const requirement = String(args.requirement ?? '').trim();
        if (!requirement) throw new Error('requirement 必填');
        const nonce = typeof args.nonce === 'string' ? args.nonce : '';
        const requestId = createHash('sha256').update(JSON.stringify([requirement, characterId ?? null, nonce])).digest('hex');
        const data = await this.api('POST', '/generate', {
          json: { requirement, session_id: 'cortico-world-linshe', request_id: requestId, ...(characterId ? { character_id: characterId } : {}) },
          signal: ctx.signal,
        }) as { task_id?: number };
        const taskId = optInt(data.task_id);
        if (!taskId) throw new Error('邻舍没有返回生图任务 ID');
        const done = await this.waitTask('image', taskId, ctx);
        if (!done) {
          return `生图任务 #${taskId} 已提交，等待超过 ${this.cfg.taskTimeoutSec} 秒仍未完成。可用 linshe_task(task_id=${taskId}) 继续查询；不要向用户描述任务进度或预计时间。`;
        }
        const media = await this.media(done.url, ctx.signal);
        return {
          text: `图片已生成（任务 #${taskId}）。${IMAGE_DELIVERY} 发送成功前不要假定用户已看到图片。`,
          blobs: [{ ...media, name: `linshe-${taskId}.png`, fallbackText: '按用户要求生成的图片' }],
        };
      }
      case 'linshe_tts': {
        const text = String(args.text ?? '').trim();
        if (!text || text.length > 1000) throw new Error('朗读文字须为 1–1000 字');
        const data = await this.api('POST', '/tts', {
          json: { text, ...(characterId ? { character_id: characterId } : {}) },
          signal: ctx.signal,
        }) as { id?: number | string };
        const jobId = data.id;
        if (jobId === undefined || jobId === null || jobId === '') throw new Error('邻舍没有返回语音任务 ID');
        const done = await this.waitTask('speech', String(jobId), ctx);
        if (!done) {
          return `语音任务 #${jobId} 已提交，等待超过 ${this.cfg.taskTimeoutSec} 秒仍未完成。可用 linshe_task(kind="speech", task_id=${JSON.stringify(String(jobId))}) 继续查询；不要向用户描述任务进度或预计时间。`;
        }
        const media = await this.media(done.url, ctx.signal);
        return {
          text: `语音已合成（任务 #${jobId}）。${SPEECH_DELIVERY}`,
          blobs: [{ ...media, name: `linshe-${jobId}.wav`, fallbackText: '角色语音' }],
        };
      }
      default:
        throw new Error(`未知的邻舍工具 ${name}`);
    }
  }
}

