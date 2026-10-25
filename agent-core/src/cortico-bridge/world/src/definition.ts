import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { LINSHE_DEFAULTS, type LinsheConfigSection } from './config.ts';
import { LINSHE_TOOL_DECLS, LinsheWorld } from './world.ts';

export const LINSHE: WorldDefinition<LinsheConfigSection> = {
  id: 'linshe',
  label: '邻舍工具包',
  defaults: () => ({ ...LINSHE_DEFAULTS }),
  // `ctx.cfg` 是 `worlds.linshe` 的活引用:热改的键现读即生效。
  create: (ctx) => new LinsheWorld({ cfg: ctx.cfg, timezone: ctx.timezone }),
  // 自描述:可能出现的全部工具与会推出的全部事件,不进提示词。
  describe: {
    tools: describeTools(LINSHE_TOOL_DECLS, {
      linshe_characters: { zh: '列出邻舍角色及其 ID。', en: 'Lists Linshe characters with their IDs.' },
      linshe_character: { zh: '查询邻舍角色人物卡。', en: 'Fetches a Linshe character card.' },
      linshe_appearance: { zh: '查询角色外观、生效衣装与可用形态。', en: 'Fetches appearance, active outfits and forms.' },
      linshe_moments: { zh: '分页查询朋友圈动态，可按角色过滤。', en: 'Lists moments with paging and character filter.' },
      linshe_moment: { zh: '查询一条朋友圈及其评论。', en: 'Fetches one moment with comments.' },
      linshe_events: { zh: '查询角色与镇民的奇遇列表。', en: 'Lists active and recent events.' },
      linshe_event: { zh: '按 ID 查询奇遇详情与选项。', en: 'Fetches one event with options.' },
      linshe_schedule: { zh: '查询角色当前前后一小时内的日程与当前活动；full 返回今日完整日程。', en: "Fetches the current activity and nearby schedule; full returns the whole day." },
      linshe_newspaper: { zh: '查询邻舍日报。', en: "Fetches the Linshe newspaper." },
      linshe_diary: { zh: '查询角色某日已生成的日记。', en: 'Fetches a generated diary entry.' },
      linshe_world: { zh: '查询邻舍当前世界观。', en: 'Fetches the active world setting.' },
      linshe_task: { zh: '查询生图或语音任务，完成时带可发送媒体。', en: 'Polls an image or speech task; returns its media when done.' },
      linshe_moment_images: { zh: '取回朋友圈配图供发送。', en: 'Retrieves moment images for sending.' },
      linshe_generate_image: { zh: '按角色配置与需求生图，完成后带可发送图片。', en: 'Generates an image; returns the image when done.' },
      linshe_tts: { zh: '用角色绑定音色合成语音，完成后带可发送语音。', en: 'Synthesizes speech; returns audio when done.' },
    }),
    events: [
      { type: 'linshe.started', description: { zh: 'World 挂载完成。', en: 'The World was mounted.' } },
    ],
  },
};
