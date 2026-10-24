/** 默认导出 BotDefinition；deployment.json 的 bot 字段引用包名，多份部署可使用同一个包。 */
import { resolve } from 'node:path';
import type { BotDefinition, BotParts } from 'cortico/bot.ts';
import type { CoreConfig, World } from 'cortico/core/types.ts';
import type { LoadedConfig } from 'cortico/core/config.ts';
import { CORE_DEFAULTS } from 'cortico/core/config.ts';
import { describeTools, type WorldDeclaration } from 'cortico/world.ts';
import { LINSHE_PERSONA_TOOL_DECLS, LinshePersona } from './persona/persona.ts';

const HERE = resolve(import.meta.dirname);

export interface LinsheConfig extends CoreConfig {
  /** 一轮唤醒里模型最多调几次工具:软上限提醒收尾,硬上限强制收尾。归 Persona。 */
  rounds: { soft: number; hard: number };
  /** null 关闭心跳自醒;否则是自醒的基准分钟数(连续空转自动退避,最长 8 倍)。 */
  tick: { intervalMinutes: number | null };
  /** 邻舍 World 的段;这里只读 baseUrl 供 Persona 拉人设,其余归 World 自己。 */
  worlds: { linshe?: { baseUrl?: string } };
}

/** 这个 Persona 为之设计的渠道:控制台 + QQ + 邻舍工具。 */
const DECLARES: readonly WorldDeclaration[] = ['console', 'qq', 'linshe'];

function build(loaded: LoadedConfig<LinsheConfig>, worlds: World[]): BotParts<LinsheConfig> {
  const cfg = loaded.config;
  const persona = new LinshePersona({
    memoryDir: loaded.memoryDir,
    packageDir: HERE,
    worlds,
    rounds: () => cfg.rounds,
    bridge: () => ({ baseUrl: cfg.worlds?.linshe?.baseUrl || 'http://127.0.0.1:3099' }),
    // 每次现读配置,WebUI 热改的间隔立即生效。
    tickDelayMs: () => (cfg.tick?.intervalMinutes ?? null) === null ? null : cfg.tick.intervalMinutes * 60_000,
  });
  return {
    persona,
    onStart: () => {
      persona.startRhythm();
    },
    onStop: () => {
      persona.stopRhythm();
    },
  };
}

const definition: BotDefinition<LinsheConfig> = {
  id: 'linshe',
  memoryName: 'MEMORY.md',
  declares: DECLARES,
  // 层 1+2:框架默认 ← 这个 bot 的建议。World 段不在这里,启动器按本机实现补。
  defaults: () => ({
    ...structuredClone(CORE_DEFAULTS),
    displayName: '邻舍',
    web: { ...CORE_DEFAULTS.web, port: 7900 },
    paths: { memory: 'memory', data: 'data' },
    // 发一张图要 draft→confirm 往返;比模板略宽。
    rounds: { soft: 8, hard: 16 },
    // 心跳自醒的基准间隔;部署可改或置 null 关闭。
    tick: { intervalMinutes: 45 },
  }),
  build,
  // 自描述不进提示词。summary 按工具名给,可以只写一种语言。
  describe: {
    tools: describeTools(LINSHE_PERSONA_TOOL_DECLS, {
      memory_write: { zh: '往 MEMORY.md 末尾追加一行。', en: 'Appends one line to MEMORY.md.' },
      end_turn: { zh: '结束这一轮,等新事件或心跳再醒。', en: 'Ends the turn until a new event or the heartbeat arrives.' },
    }),
    memory: { form: { zh: '一份 MEMORY.md,整份进系统前缀;附件存在 blobs/ 下。', en: 'One MEMORY.md, all of it in the system prefix; attachments go under blobs/.' } },
  },
};

export default definition;
