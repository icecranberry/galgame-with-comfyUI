/** 邻舍 Persona：PREFIX.md 渲染前缀（角色人设从邻舍桥接实时拉取），MEMORY.md 全文与环境段进前缀。 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  BlobStore,
  CoreApi,
  Persona,
  PrefixSegment,
  RoundCaps,
  SessionDecl,
  SessionOpeningReason,
  SystemPrefixContext,
  ToolDef,
  World,
} from 'cortico/core/types.ts';
import { renderTemplate } from 'cortico/core/template.ts';
import { FileBlobStore } from './blobs.ts';

export const MEMORY_FILE = 'MEMORY.md';
const MAIN = 'main';

export interface LinshePersonaOptions {
  memoryDir: string;
  /** 包目录:`persona/PREFIX.md` 与 `persona/MEMORY.seed.md` 在它下面。 */
  packageDir: string;
  /** 活的挂载表,用时再读:激活 / 停用一个 World 就地增删。 */
  worlds: readonly World[];
  rounds: () => RoundCaps;
  /** 邻舍桥接连接参数;由 bot 装配代码从部署配置注入。 */
  bridge: () => { baseUrl: string };
}

const MEMORY_WRITE_DECL: Omit<ToolDef, 'handler'> = {
  name: 'memory_write',
  description: 'Append one line to MEMORY.md, your only persistent memory. It is shown in full at the top of every context.',
  tags: ['write'],
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string', description: 'One line to remember.' },
    },
    required: ['text'],
  },
};

const END_TURN_DECL: Omit<ToolDef, 'handler'> = {
  name: 'end_turn',
  description:
    'End this turn: nothing more you want to say or do right now. '
    + 'New events will wake you again. This is the normal way to finish a turn.',
  tags: ['flow'],
  barrierAfter: true,
  endsTurn: true,
  parameters: { type: 'object', properties: {}, required: [] },
};

/** 自有工具的声明;`index.ts` 的 describe 与 `ownToolNames()` 都取它。 */
export const LINSHE_PERSONA_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [MEMORY_WRITE_DECL, END_TURN_DECL];

export class LinshePersona implements Persona {
  readonly memoryDir: string;
  readonly blobs: BlobStore;
  private core: CoreApi | null = null;
  /** 上一次渲染时的初始角色 ID；跨重启持久化，用于识别角色切换。 */
  private lastSeenCharacter: string | null;

  constructor(private readonly opts: LinshePersonaOptions) {
    this.memoryDir = opts.memoryDir;
    mkdirSync(this.memoryDir, { recursive: true });
    const memory = join(this.memoryDir, MEMORY_FILE);
    if (!existsSync(memory)) {
      writeFileSync(memory, readFileSync(join(opts.packageDir, 'persona', 'MEMORY.seed.md'), 'utf8'), 'utf8');
    }
    this.blobs = new FileBlobStore(this.memoryDir);
    const stateFile = join(this.memoryDir, 'persona-state.json');
    let lastSeen: string | null = null;
    try { lastSeen = JSON.parse(readFileSync(stateFile, 'utf8')).lastCharacterId ?? null; } catch { /* 首次运行 */ }
    this.lastSeenCharacter = lastSeen;
    this.stateFile = stateFile;
  }

  attach(core: CoreApi): void {
    this.core = core;
  }

  private stateFile: string;

  /** 前缀 = 一份模板渲染出的一段;角色人设实时取自邻舍,记忆整份进去,每个 World 的环境提示词各占一节。 */
  async systemSegments(ctx: SystemPrefixContext): Promise<PrefixSegment[]> {
    const template = readFileSync(join(this.opts.packageDir, 'persona', 'PREFIX.md'), 'utf8');
    const envPrompts = ctx.worlds
      .filter((w) => w.envPrompt.trim())
      .map((w) => `## ${w.id}\n${w.envPrompt.trim()}`)
      .join('\n\n');
    return [
      {
        title: 'PREFIX',
        text: renderTemplate(template, {
          'linshe.persona': await this.personaBlock(),
          'persona.memory': readFileSync(join(this.memoryDir, MEMORY_FILE), 'utf8').trim(),
          'worlds.envPrompts': envPrompts,
        }),
      },
    ];
  }

  onOpening({ reason }: { reason: SessionOpeningReason }): void {
    this.core?.injectInternal(`[session ${reason}] 上面是你的角色人格、记忆与环境。按你的判断行动,没有想说的就 end_turn。`);
  }

  /** 每批投递都会经过。 */
  onDelivery(ctx: { events: Array<{ origin?: string; source?: string; type?: string }> }): void {
    // 没有配置 PIN 的控制台正文只有时间和昵称，来源由事件元数据补充。
    if (ctx.events.some((e) => e.source === 'console' && (e.type === 'console.message' || e.type === 'console.invite'))) {
      this.core?.injectInternal(
        '【当前来信渠道】本批含控制台来信。回复控制台使用 console_send；普通 assistant 文本不会显示在聊天窗口。除非来信明确指定转达对象，不要发送到历史 QQ 会话。',
        'delivery-channel',
      );
    }
  }

  declareSessions(): SessionDecl[] {
    return [
      {
        id: MAIN,
        label: MAIN,
        rounds: this.opts.rounds,
        persistent: true,
        receivesEvents: true,
        // World 的工具在前、自有工具在后:工具表顺序影响请求前缀的缓存命中。
        tools: () => [...this.opts.worlds.flatMap((w) => w.tools()), memoryWriteTool(this.memoryDir), endTurnTool()],
      },
    ];
  }

  /** 自有工具名;装配层据此拒绝与之撞名的 World。 */
  ownToolNames(): string[] {
    return LINSHE_PERSONA_TOOL_DECLS.map((decl) => decl.name);
  }

  /**
   * 从邻舍桥接拉取初始角色人设,渲染成前缀段;失败时空串,由模板的占位符兜底。
   * 每次渲染现拉(本地回环开销可忽略):切换角色后经 /session/reload-prefix 重载
   * 前缀即取到最新人设,不会撞缓存。
   */
  private async personaBlock(): Promise<string> {
    let block = '';
    let personaId: string | null = null;
    let personaName = '';
    try {
      const { baseUrl } = this.opts.bridge();
      const base = baseUrl.trim().replace(/\/+$/, '');
      const response = await fetch(base + '/api/cortico/bootstrap', {
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as {
        persona?: { character_id?: number; name?: string; system_prompt?: string; behavior_style?: string; reply_style?: string } | null;
      };
      const persona = data.persona;
      if (!persona?.system_prompt) throw new Error('initial persona unavailable');
      personaId = String(persona.character_id ?? '');
      personaName = persona.name || '';
      // 行为/表达风格两段随人物卡进前缀;空段整节不渲染。
      const styleSections = [
        persona.behavior_style?.trim() ? `## 行为风格\n${persona.behavior_style.trim()}` : '',
        persona.reply_style?.trim() ? `## 表达风格\n${persona.reply_style.trim()}` : '',
      ].filter(Boolean).join('\n\n');
      block = [
        '# 角色人格',
        '',
        persona.system_prompt,
        ...(styleSections ? ['', styleSections] : []),
        '',
        '【角色人格结束】',
        '你以上述角色身份说话与行动,后续同类身份描述以此为准。',
        `当前角色:${persona.name || '未知'}(character_id=${persona.character_id ?? '未知'})。`,
        '查询或生成当前角色的内容时,省略工具参数 character_id 即使用当前角色,不要猜测角色 ID;',
        '用户指定其他角色时,先用 linshe_characters 查询对应 ID。',
      ].join('\n');
    } catch {
      block = '';
    }
    // 角色变化：向会话注入身份同步通告（前缀重载 + 通告双保险锚定新身份）。
    if (personaId && this.lastSeenCharacter !== null && personaId !== this.lastSeenCharacter) {
      this.core?.injectInternal(
        `【身份同步】初始角色已切换：你现在的角色是 ${personaName}(character_id=${personaId})。`
        + '此前的对话记录属于上一个角色，不要再沿用旧身份、旧名字或旧口癖自称。',
        'notice',
      );
    }
    if (personaId) {
      this.lastSeenCharacter = personaId;
      try { writeFileSync(this.stateFile, JSON.stringify({ lastCharacterId: personaId }), 'utf8'); } catch { /* 状态文件写失败只影响下次对比 */ }
    }
    return block;
  }
}

/** 向 MEMORY.md 追加一行。 */
export function memoryWriteTool(memoryDir: string): ToolDef {
  return {
    ...MEMORY_WRITE_DECL,
    handler: async (args) => {
      const text = String(args.text ?? '').trim();
      if (!text) return '[write failed] text 不能为空';
      appendFileSync(join(memoryDir, MEMORY_FILE), `${text}\n`, 'utf8');
      return '[written]';
    },
  };
}

/** 结束本轮的工具。Core 只认 `endsTurn`;名字与措辞归 Persona。 */
export function endTurnTool(): ToolDef {
  return {
    ...END_TURN_DECL,
    handler: async () => '[turn ended]',
  };
}
