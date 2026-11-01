import { effectKey, parseJson } from './repository.js';
import { GOD_MODULE_TOOLS, moduleTool, moduleToolCatalog, executeModuleTool } from './moduleTools.js';

const string = (description, maxLength = 2000) => ({ type: 'string', description, minLength: 1, maxLength });
const id = description => ({ type: 'integer', minimum: 1, description });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const definition = (name, description, parameters) => ({ type: 'function', function: { name, description, parameters } });

export const GOD_TOOLS = [
  definition('inspect_neighbors', '查询真实角色/群聊编号、近期世界事件。指代不清先查询，不能猜编号。query 可空串。', object({ query: { type: 'string', maxLength: 100 } }, [])),
  definition('read_character', '查看指定角色资料与今日安排。日程是计划，不代表已经执行。', object({ character_id: id('角色编号') })),
  definition('set_schedule', '安排角色今天或未来的活动。只代表已安排，涉及服务或相遇可另开奇遇。时间用角色日程所在主机的当地日期，不支持已过去的日期或跨日时段。', object({
    character_id: id('角色编号'), date: string('YYYY-MM-DD；先 read_character 确认当地日期', 10),
    start_time: string('HH:MM', 5), end_time: string('HH:MM，晚于开始时间', 5), activity: string('活动名', 60), location: string('地点', 60), description: string('活动安排，不写已经完成', 200),
  })),
  definition('publish_moment', '让指定角色按自己的性格围绕要求发布朋友圈，任务入队，可能含配图；查询执行状态确认实际完成。', object({ character_id: id('角色编号'), instruction: string('本次朋友圈要求') })),
  definition('discuss_in_group', '让指定群聊结合最近上文讨论一个话题；入队等待群聊空闲，不伪造用户发言。', object({ group_id: id('群聊编号'), instruction: string('讨论主题与要求') })),
  definition('create_encounter', '为指定角色开启可以在奇遇页推进的叙事事件，用户自己选择选项。已有活跃奇遇时不可重复开启。', object({ character_id: id('角色编号'), instruction: string('奇遇的动机、场景与要求') })),
  definition('create_world_event', '让一件世界事实生效，并随机触发朋友圈和群聊反应。默认全体居民感知；character_ids 只用于用户明确指定感知范围。发帖/群聊数量为零表示该渠道不触发。后续变化可用 supersedes_id 结束之前的事件。', object({
    title: string('简短事件标题', 80), fact: string('准确描述已经被神谕设定为现实的事实与范围，不包含工具指令'),
    duration_minutes: { type: 'integer', minimum: 1, maximum: 10080, description: '生效分钟数；默认180' },
    character_ids: { type: 'array', items: id('角色编号'), maxItems: 100 },
    moment_count: { type: 'integer', minimum: 0, maximum: 8 }, group_count: { type: 'integer', minimum: 0, maximum: 5 }, supersedes_id: id('被替代的世界事件编号'),
  }, ['title', 'fact'])),
  definition('inspect_work', '读取神谕实际投递结果。event_id 不填时返回最近事件与任务；区分 pending、running、done、failed、uncertain。', object({ event_id: id('事件/任务编号') }, [])),
  definition('recall_memory', '查找神与天使往日对话的摘要和长期记忆；不包含其他角色私人记忆。', object({ query: string('要回忆的内容', 150) })),
  definition('list_capabilities', '按模块查看天使已接入的真实能力。module 可填聊天、群聊、朋友圈、信箱、日记、日程、奇遇、背包、关系、记忆、相册、角色、立绘、表情包、媒体、日报、世界观、预设、素材库、语音；省略返回全部。', object({ module: string('功能模块名', 30) }, [])),
  ...GOD_MODULE_TOOLS.map(t => t.definition),
];

export const godToolCatalog = () => GOD_TOOLS.map(t => {
  const module = moduleTool(t.function.name);
  return module ? { name: module.name, label: module.label, module: module.module }
    : { name: t.function.name, label: t.function.description.split('。')[0], module: '神说' };
});

export function validateToolArgs(schema, value, path = '参数') {
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path}不在允许范围内`);
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}必须是对象`);
    for (const k of schema.required || []) if (!Object.hasOwn(value, k)) throw new Error(`${path}缺少 ${k}`);
    for (const [k, v] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, k)) throw new Error(`不支持的参数 ${k}`);
      validateToolArgs(schema.properties[k], v, k);
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || (schema.minLength && value.trim().length < schema.minLength) || value.length > schema.maxLength) throw new Error(`${path}不是有效文本`);
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) throw new Error(`${path}不是有效整数`);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > schema.maxItems || value.length < (schema.minItems || 0) || (schema.uniqueItems && new Set(value).size !== value.length)) throw new Error(`${path}不是有效列表`);
    for (const item of value) validateToolArgs(schema.items, item, path);
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${path}必须是布尔值`);
  }
}

export function createGodTools(repo, world, memory, services) {
  const { db } = repo;
  function character(id) {
    const c = db.prepare('SELECT * FROM characters WHERE id=?').get(id);
    if (!c) throw new Error('没有找到这位角色，请重新查询');
    return c;
  }
  async function dispatch(name, args, ctx) {
    switch (name) {
      case 'inspect_neighbors': {
        const q = `%${args.query || ''}%`;
        return { characters: db.prepare('SELECT id,display_name FROM characters WHERE display_name LIKE ? OR name LIKE ? ORDER BY id LIMIT 100').all(q, q),
          groups: db.prepare('SELECT id,name,topic FROM group_chats WHERE name LIKE ? ORDER BY id LIMIT 60').all(q),
          events: world.list().slice(0, 5), localDate: services.localDate(), angelDate: repo.day() };
      }
      case 'read_character': {
        const c = character(args.character_id);
        return { id: c.id, name: c.display_name, persona: c.short_prompt || c.base_prompt?.slice(0, 6000), localDate: services.localDate(),
          scheduleEnabled: services.scheduleEnabled(), schedule: services.getSchedule(c.id) || [], currentActivity: services.getActivity(c.id) };
      }
      case 'set_schedule': {
        const c = character(args.character_id);
        if (!services.scheduleEnabled() || c.schedule_enabled === 0) throw new Error('这位角色的日程尚未启用，暂时无法安排');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date) || Number.isNaN(Date.parse(args.date)) || new Date(args.date).toISOString().slice(0, 10) !== args.date || args.date < services.localDate()) throw new Error('需要有效的今天或未来日期');
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(args.start_time) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(args.end_time) || args.end_time <= args.start_time) throw new Error('请使用当天开始时间早于结束时间的 HH:MM 时段，跨日安排需分成两段');
        const activity = { startTime: args.start_time, endTime: args.end_time, activity: args.activity, location: args.location, description: args.description, replyDelay: 0, tags: ['神谕'] };
        if (args.date === services.localDate()) {
          const result = services.changeSchedule(c.id, activity);
          if (!result.ok) throw new Error(result.error || '当前没有可修改的日程');
        } else services.queueSchedule(c.id, args.date, activity, 'god-says');
        return { status: 'scheduled', character_id: c.id, date: args.date, activity, href: '/schedule', note: '已安排，尚不代表活动已经完成。' };
      }
      case 'publish_moment': character(args.character_id); return world.queue('moment', args.character_id, args.instruction, ctx);
      case 'discuss_in_group': return world.queue('group', args.group_id, args.instruction, ctx);
      case 'create_encounter': {
        const result = await services.encounter(character(args.character_id), { customPrompt: args.instruction, manual: true,
          beforePersist: () => ctx.signal?.throwIfAborted(),
          // 在业务落库事务中同步留下结果；崩溃发生在返回之前也可核对。
          afterPersist: id => db.prepare('UPDATE god_tool_calls SET result_json=? WHERE id=?').run(JSON.stringify({ id, status: 'opened', href: `/events?event=${id}` }), ctx.callId),
        });
        return { id: result.id, title: result.title, status: 'opened', href: `/events?event=${result.id}`, note: '奇遇已开启，请在奇遇页选择推进。' };
      }
      case 'create_world_event': return world.create(args, ctx);
      case 'inspect_work': return world.list(args.event_id);
      case 'recall_memory': return { memories: memory.recall(args.query) || '暂时没有对应的往日记忆。' };
      case 'list_capabilities': return { tools: moduleToolCatalog().filter(t => !args.module || t.module === args.module), core: GOD_TOOLS.slice(0, 9).map(t => ({ name: t.function.name, description: t.function.description })) };
      default: {
        const entry = moduleTool(name);
        if (!entry) throw new Error('这项能力尚未接入，不能执行');
        return executeModuleTool(entry, args, ctx, services.api);
      }
    }
  }
  async function execute(call, runId, round, signal) {
    const def = GOD_TOOLS.find(t => t.function.name === call.function.name);
    const callId = `${runId}:${round}:${call.id}`;
    let args;
    try {
      if (!def) throw new Error('这项能力尚未接入');
      args = JSON.parse(call.function.arguments);
      validateToolArgs(def.function.parameters, args);
      signal?.throwIfAborted();
    } catch (err) { return { ok: false, error: err.message }; }
    const readOnly = ['inspect_neighbors', 'read_character', 'inspect_work', 'recall_memory', 'list_capabilities'].includes(call.function.name) || moduleTool(call.function.name)?.method === 'GET';
    const key = readOnly ? callId : effectKey(runId, call.function.name, args);
    const old = db.prepare('SELECT * FROM god_tool_calls WHERE effect_key=?').get(key);
    if (old) return parseJson(old.result_json) || { ok: false, error: '这项工作已发起但结果尚不确定，请查询执行记录，不要重复执行。' };
    const row = { id: callId, run_id: runId, name: call.function.name, args, status: 'running' };
    db.prepare('INSERT INTO god_tool_calls(id,run_id,effect_key,name,args_json,status,created_at) VALUES (?,?,?,?,?,?,?)').run(callId, runId, key, row.name, JSON.stringify(args), 'running', repo.timestamp());
    repo.emit(runId, 'tool', row);
    let result;
    try {
      const value = await dispatch(row.name, args, { runId, effectKey: key, callId, signal });
      result = { ok: true, value };
    } catch (err) {
      const saved = parseJson(db.prepare('SELECT result_json FROM god_tool_calls WHERE id=?').get(callId)?.result_json);
      result = saved ? { ok: true, value: saved } : { ok: false, error: err.message === 'ALREADY_ACTIVE_EVENT' ? '这位角色已有进行中的奇遇，请先完成当前奇遇。' : err.message, ...(err.uncertain ? { uncertain: true } : {}) };
    }
    const status = result.ok ? 'done' : result.uncertain ? 'uncertain' : 'failed';
    db.prepare('UPDATE god_tool_calls SET status=?,result_json=? WHERE id=?').run(status, JSON.stringify(result), callId);
    repo.emit(runId, 'tool', { ...row, status, result });
    return result;
  }
  return { definitions: GOD_TOOLS, execute };
}
