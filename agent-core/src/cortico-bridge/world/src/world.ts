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
    description: '列出邻舍角色及其 ID，指定其他角色前先查询。',
    tags: ['read'],
    parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] },
  },
  {
    name: 'linshe_character',
    description: '查询邻舍角色人物卡。不传 character_id 使用初始角色。',
    tags: ['read'],
    parameters: {
      type: 'object',
      properties: { character_id: { type: 'integer', minimum: 1, description: '邻舍角色 ID，省略为初始角色' } },
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
      '查询邻舍朋友圈最新动态。默认返回全镇所有人（角色、镇民、用户）混排的动态；只要看某个人（包括自己）发的，传 character_id。before_id 用于继续向前翻页。',
    tags: ['read'],
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        before_id: { type: 'integer', minimum: 1 },
        character_id: { type: 'integer', minimum: 1, description: '邻舍角色 ID，只返回该角色发的动态；查询自己的最近动态时必传' },
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
    description: '查询角色及镇民当前奇遇、近期奇遇历史；仅查询，推进选项请在邻舍奇遇页进行。',
    tags: ['read'],
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } },
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
    description: '查询邻舍角色今日日程和当前活动，不生成或重置日程。',
    tags: ['read'],
    parameters: {
      type: 'object',
      properties: { character_id: { type: 'integer', minimum: 1 } },
      additionalProperties: false,
      required: [],
    },
  },
  {
    name: 'linshe_newspaper',
    description: '查询邻舍日报，省略日期查询今天；不存在时如实告知。',
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
    description: '查询邻舍角色某日已生成的日记。',
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
    description: '查询邻舍当前世界观。',
    tags: ['read'],
    parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] },
  },
  {
    name: 'linshe_task',
    description:
      '查询一个邻舍生图任务的最新状态；完成时回执带可发送的图片。linshe_generate_image 等待超时后用任务 ID 继续查询。',
    tags: ['read'],
    parameters: {
      type: 'object',
      properties: { task_id: { type: 'integer', minimum: 1, description: 'linshe_generate_image 回执给出的任务 ID' } },
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
      '按用户要求为邻舍角色生成图片，自动采用该角色外观、衣装与生图配置。工具会等待生成完成并返回可发送的图片；相同参数返回同一张图，想要不同的图请改变描述或传入不同 nonce。',
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
    description: '使用邻舍角色已绑定的音色朗读文字，工具会等待合成完成并返回可发送的语音。',
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
  const text = JSON.stringify(data);
  if (text.length <= MAX_TEXT_CHARS) return text;
  return text.slice(0, MAX_TEXT_CHARS) + '…（结果过长已截断，可用更具体的参数缩小查询范围）';
}

function optInt(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('本轮已取消')); }, { once: true });
  });
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
      'linshe.baseUrl': this.base(),
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
            { name: 'linshe.baseUrl', description: '配置里的邻舍服务地址,此刻的值。' },
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
      text: '邻舍 World 已挂载,linshe_* 工具可用。',
    });
  }

  async stop(): Promise<void> {}

  // ---------------------------------------------------------------- API 访问

  private async api(method: 'GET' | 'POST', path: string, opts: { query?: Query; json?: unknown; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<unknown> {
    const url = new URL(this.base() + '/api/cortico' + path);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, {
      method,
      headers: opts.json !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
      redirect: 'manual',
      signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 30000),
    });
    let data: unknown = null;
    try { data = await response.json(); } catch { /* 非 JSON 响应按错误处理 */ }
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
    const response = await fetch(url, { redirect: 'manual', signal: signal ?? AbortSignal.timeout(60000) });
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
    const deadline = Date.now() + Math.max(30, Math.min(3600, this.cfg.taskTimeoutSec)) * 1000;
    while (Date.now() < deadline) {
      if (ctx.signal?.aborted) throw new Error('本轮已取消；邻舍任务仍在后台运行，稍后可用 linshe_task 查询');
      const path = kind === 'image' ? `/tasks/${id}` : `/speech/${id}`;
      const data = await this.api('GET', path, { signal: ctx.signal }) as { status?: string; error?: string; image?: { url?: string } | null; audio_url?: string | null };
      const status = data.status;
      if (status === 'done' || status === 'completed') {
        const url = kind === 'image' ? data.image?.url : data.audio_url;
        if (!url) throw new Error('邻舍任务已完成但没有返回媒体地址');
        return { url };
      }
      if (status === 'failed' || status === 'cancelled') throw new Error(data.error || '邻舍任务失败或已取消');
      try { await sleep(POLL_INTERVAL_MS, ctx.signal); } catch { throw new Error('本轮已取消；邻舍任务仍在后台运行，稍后可用 linshe_task 查询'); }
    }
    return null;
  }

  // ---------------------------------------------------------------- 工具实现

  private async dispatch(name: string, args: Record<string, unknown>, ctx: ToolCallContext): Promise<string | { text: string; blobs: Array<{ bytes: Uint8Array; mime: string; name: string; fallbackText: string }> }> {
    try {
      return await this.handlers(name, args, ctx);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  }

  private async handlers(name: string, args: Record<string, unknown>, ctx: ToolCallContext): Promise<string | { text: string; blobs: Array<{ bytes: Uint8Array; mime: string; name: string; fallbackText: string }> }> {
    const characterId = optInt(args.character_id);
    switch (name) {
      case 'linshe_characters':
        return dump(await this.api('GET', '/characters'));
      case 'linshe_character':
        return dump(await this.api('GET', '/character', { query: { character_id: characterId } }));
      case 'linshe_appearance':
        return dump(await this.api('GET', '/appearance', { query: { character_id: characterId } }));
      case 'linshe_moments':
        return dump(await this.api('GET', '/moments', {
          query: { limit: optInt(args.limit), before_id: optInt(args.before_id), character_id: characterId },
        }));
      case 'linshe_moment':
        return dump(await this.api('GET', `/moments/${optInt(args.post_id)}`));
      case 'linshe_events':
        return dump(await this.api('GET', '/events', { query: { limit: optInt(args.limit) } }));
      case 'linshe_event': {
        const id = String(args.event_id ?? '').trim();
        if (!id || id.length > 80) throw new Error('event_id 必填（如 123 或 town:123）');
        return dump(await this.api('GET', `/events/by-id/${encodeURIComponent(id)}`));
      }
      case 'linshe_schedule':
        return dump(await this.api('GET', '/schedule', { query: { character_id: characterId } }));
      case 'linshe_newspaper': {
        const date = typeof args.date === 'string' && args.date.trim() ? args.date.trim() : undefined;
        return dump(await this.api('GET', '/newspaper', { query: { date } }));
      }
      case 'linshe_diary': {
        const date = typeof args.date === 'string' && args.date.trim() ? args.date.trim() : undefined;
        return dump(await this.api('GET', '/diary', { query: { character_id: characterId, date } }));
      }
      case 'linshe_world':
        return dump(await this.api('GET', '/world'));
      case 'linshe_task': {
        const id = optInt(args.task_id);
        if (!id) throw new Error('task_id 必填');
        const data = await this.api('GET', `/tasks/${id}`) as { status?: string; image?: { url?: string } | null; error?: string };
        if ((data.status === 'done' || data.status === 'completed') && data.image?.url) {
          const media = await this.media(data.image.url, ctx.signal);
          return {
            text: `生图任务 #${id} 已完成。把 [blob …] 里的 log: 句柄作为 qq_draft 的 image 参数发送给用户。`,
            blobs: [{ ...media, name: `linshe-${id}.png`, fallbackText: '按用户要求生成的图片' }],
          };
        }
        return dump(data);
      }
      case 'linshe_moment_images': {
        let paths = (Array.isArray(args.paths) ? args.paths : []).filter((p): p is string => typeof p === 'string' && p.startsWith('/')).slice(0, 9);
        const postId = optInt(args.post_id);
        if (!paths.length && !postId) throw new Error('需要提供 post_id 或 paths');
        if (!paths.length) {
          const data = await this.api('GET', `/moments/${postId}/images`) as { images?: string[] };
          paths = (data.images || []).filter((p) => typeof p === 'string' && p).slice(0, 9);
          if (!paths.length) return '这条朋友圈没有配图。';
        }
        const blobs: Array<{ bytes: Uint8Array; mime: string; name: string; fallbackText: string }> = [];
        for (const [index, p] of paths.entries()) {
          const media = await this.media(p, ctx.signal);
          blobs.push({ ...media, name: `moment-${postId ?? index}-${index}.png`, fallbackText: '朋友圈配图' });
        }
        return {
          text: `已取到 ${blobs.length} 张朋友圈配图。逐条发送：每次 qq_draft 只带一张图的句柄，qq_confirm 发送成功后再起草下一条；全部发完后不要复述发送过程。`,
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
        }) as { task_id?: number };
        const taskId = optInt(data.task_id);
        if (!taskId) throw new Error('邻舍没有返回生图任务 ID');
        const done = await this.waitTask('image', taskId, ctx);
        if (!done) {
          return `生图任务 #${taskId} 已提交，等待超过 ${this.cfg.taskTimeoutSec} 秒仍未完成。可用 linshe_task(task_id=${taskId}) 继续查询；不要向用户描述任务进度或预计时间。`;
        }
        const media = await this.media(done.url, ctx.signal);
        return {
          text: `图片已生成（任务 #${taskId}）。把 [blob …] 里的 log: 句柄作为 qq_draft 的 image 参数发送给用户；发送成功前不要在正文里假定用户已看到图片。`,
          blobs: [{ ...media, name: `linshe-${taskId}.png`, fallbackText: '按用户要求生成的图片' }],
        };
      }
      case 'linshe_tts': {
        const text = String(args.text ?? '').trim();
        if (!text || text.length > 1000) throw new Error('朗读文字须为 1–1000 字');
        const data = await this.api('POST', '/tts', {
          json: { text, ...(characterId ? { character_id: characterId } : {}) },
        }) as { id?: number | string };
        const jobId = data.id;
        if (jobId === undefined || jobId === null || jobId === '') throw new Error('邻舍没有返回语音任务 ID');
        const done = await this.waitTask('speech', String(jobId), ctx);
        if (!done) {
          return `语音任务 #${jobId} 已提交，等待超过 ${this.cfg.taskTimeoutSec} 秒仍未完成。不要向用户描述任务进度或预计时间。`;
        }
        const media = await this.media(done.url, ctx.signal);
        return {
          text: `语音已合成（任务 #${jobId}）。语音条独占一条消息：调用 qq_draft 时只传 voice 参数（[blob …] 里的 log: 句柄），不要带 text、image 或 reply_to。`,
          blobs: [{ ...media, name: `linshe-${jobId}.wav`, fallbackText: '角色语音' }],
        };
      }
      default:
        throw new Error(`未知的邻舍工具 ${name}`);
    }
  }
}

