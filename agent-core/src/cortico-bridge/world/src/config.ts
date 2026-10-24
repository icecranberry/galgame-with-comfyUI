import type { ConfigGroup } from 'cortico/core/types.ts';

/** config.json 的 worlds.linshe 段，默认禁用；bot 或部署可启用。 */
export interface LinsheConfigSection {
  enabled: boolean;
  /** 邻舍服务根地址；桥接 API 挂在 `<baseUrl>/api/cortico` 下。 */
  baseUrl: string;
  /** 生图/语音任务在工具内等待完成的上限（秒）；超时回执给出任务 ID，可用 linshe_task 再查。 */
  taskTimeoutSec: number;
}

export const LINSHE_DEFAULTS: LinsheConfigSection = {
  enabled: false,
  baseUrl: 'http://127.0.0.1:3099',
  taskTimeoutSec: 240,
};

/** World 配置的 JSON Schema 声明。 */
export const LINSHE_CONFIG_GROUP: ConfigGroup = {
  id: 'world:linshe',
  owner: 'world:linshe',
  schema: {
    type: 'object',
    title: 'Linshe',
    properties: {
      'worlds.linshe.baseUrl': {
        type: 'string',
        title: '邻舍服务地址',
        description: '邻舍服务根地址，桥接 API 在其 /api/cortico 下。',
        'x-hot': true,
      },
      'worlds.linshe.taskTimeoutSec': {
        type: 'integer',
        title: '任务等待上限（秒）',
        description: '生图与语音任务在工具内等待完成的最长时间，超时后可用 linshe_task 继续查询。',
        minimum: 30,
        maximum: 3600,
        'x-hot': true,
      },
    },
  },
};
