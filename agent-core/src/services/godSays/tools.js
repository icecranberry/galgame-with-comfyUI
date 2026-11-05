import { createChangeSets } from './changeSets.js';
import { createBatchTasks } from './batchTasks.js';
import { createChangePolicy, PREPARED_TOOLS } from './changePolicy.js';
import { capabilityBoundary } from './capabilityBoundary.js';
import { effectKey, parseJson } from './repository.js';
import { GOD_MODULE_TOOLS, moduleTool, moduleToolCatalog, executeModuleTool } from './moduleTools.js';

const string = (description, maxLength = 2000) => ({ type: 'string', description, minLength: 1, maxLength });
const id = description => ({ type: 'integer', minimum: 1, description });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const definition = (name, description, parameters) => ({ type: 'function', function: { name, description, parameters } });

export const GOD_TOOLS = [
  definition('inspect_neighbors', '查询真实角色/群聊编号、近期世界事件。指代不清先查询，不能猜编号。query 可空串。', object({ query: { type: 'string', maxLength: 100 } }, [])),
  definition('read_character', '读取角色资料摘要和当地日期，默认不查询日程。仅在任务涉及今日安排或当前活动时传 include_schedule=true；日程是计划，不代表已执行。修改人设、外观或设计服装请用 read_character_source 读取完整原文。', object({ character_id: id('角色编号'), include_schedule: { type: 'boolean', description: '是否读取今日完整日程与当前活动，默认 false；仅日程相关任务需要' } }, ['character_id'])),
  definition('set_schedule', '安排角色今天或未来的活动。只代表已安排，不因活动涉及服务或相遇就自动另开奇遇；用户需要角色反馈时优先朋友圈或群聊。时间用角色日程所在主机的当地日期，不支持已过去的日期或跨日时段。', object({
    character_id: id('角色编号'), date: string('YYYY-MM-DD；先 read_character 确认当地日期', 10),
    start_time: string('HH:MM', 5), end_time: string('HH:MM，晚于开始时间', 5), activity: string('活动名', 60), location: string('地点', 60), description: string('活动安排，不写已经完成', 200),
  })),
  definition('publish_moment', '让指定角色按自己的性格发布朋友圈，任务入队，可能含配图；查询执行状态确认实际完成。角色个人反馈、感受分享、生活片段和外观展示的首选渠道，普通反馈优先使用本工具而非开启奇遇。instruction 写的是这次发帖的真实动因，不是复述神的命令。', object({
    character_id: id('角色编号'),
    instruction: string('这次发帖的真实动因与要求：先写清这件事为什么在此刻发生——可以是一个意料之外的契机、角色自己都说不清的冲动、其他角色（绝非天使或神）的提议或要求、环境或身体的偶然触动，或别的自然缘由；再自然落到要分享的具体画面、语气与配图。用角色自身的经历口吻写，不写成「神/天使让角色去做某事」的转述，不在动因里点破授意者，也不刻意解释这是安排。', 2000),
  })),

  definition('discuss_in_group', '让指定群聊结合最近上文讨论一个话题；入队等待群聊空闲，不伪造用户发言。多人反馈、讨论和角色之间相互回应的首选渠道，普通互动优先使用本工具而非开启奇遇；排队不构成改开奇遇的理由。instruction 写的是这场讨论的真实起因，不是复述神的命令。', object({ group_id: id('群聊编号'), instruction: string('这场讨论的真实起因与要求：先写清话题为何在此刻自然出现——上文正好聊到、某个角色顺口提起、刚发生的一件小事、角色自己突然想聊的冲动、环境或身体的偶然触动等自然缘由；再写要聊的具体方向、语气或边界。用群成员各自的处境口吻写，不写成「神/天使让群里讨论某事」的转述，不在起因里点破授意者。', 2000) })),
  definition('create_encounter', '为指定角色开启可以在奇遇页推进的叙事事件，用户自己选择选项。仅限用户明确要求奇遇，或明确希望亲自参与并通过选项推进现场剧情；普通角色反馈、展示、分享或互动优先使用 publish_moment / discuss_in_group，不调用本工具，也不因这些渠道排队或失败而改开奇遇。已有活跃奇遇时不可重复开启。instruction 写的是这段奇遇的真实起因，不是复述神的命令。', object({ character_id: id('角色编号'), instruction: string('这段奇遇的真实起因、场景与要求：先写清它为何在此刻自然发生——意料之外的契机、角色自己都说不清的冲动、其他角色（绝非天使或神）的提议或要求、环境或身体的偶然触动等自然缘由；再写场景、参与者与推进方向。用角色自身经历口吻写，不写成「神/天使安排了一场奇遇」的转述，不在起因里点破授意者。', 2000) })),
  definition('create_world_event', '让一件世界事实生效，并随机触发朋友圈和群聊反应。默认全体角色感知；character_ids 只用于用户明确指定感知范围。发帖/群聊数量为零表示该渠道不触发。后续变化可用 supersedes_id 结束之前的事件。', object({
    title: string('简短事件标题', 80), fact: string('准确描述已经被神谕设定为现实的事实与范围，不包含工具指令'),
    duration_minutes: { type: 'integer', minimum: 1, maximum: 10080, description: '生效分钟数；默认180' },
    character_ids: { type: 'array', items: id('角色编号'), maxItems: 100 },
    moment_count: { type: 'integer', minimum: 0, maximum: 8 }, group_count: { type: 'integer', minimum: 0, maximum: 5 }, supersedes_id: id('被替代的世界事件编号'),
  }, ['title', 'fact'])),
  definition('inspect_work', '读取神谕实际投递结果。event_id 不填时返回最近事件与任务；区分 pending、running、done、failed、uncertain。', object({ event_id: id('事件/任务编号') }, [])),
  definition('recall_memory', '查找神与天使往日对话的摘要和长期记忆；不包含其他角色私人记忆。', object({ query: string('要回忆的内容', 150) })),
  definition('list_capabilities', '按模块查看天使已接入的真实能力。module 可填聊天、群聊、朋友圈、信箱、日记、日程、奇遇、背包、关系、记忆、相册、角色、立绘、表情包、媒体、日报、世界观、预设、素材库、语音；省略返回全部。', object({ module: string('功能模块名', 30) }, [])),
  definition('inspect_changes', '查询当前对话的批量任务与待确认变更，确认后的实际状态优先于历史工具结果。', object({}, [])),
  definition('read_character_source', '读取角色完整原始人设和外观，用于修改外观、人设或设计服装。不查询日程，不使用摘要覆盖原文。', object({ character_id: id('角色编号') })),
  definition('update_character', '按字段准备角色修改，确认后生效。仅改名字只传 display_name，不复制或重传人设；未提供字段保持原样。', { ...object({ character_id: id('角色编号'), display_name: string('修改后的显示名', 100), base_prompt: string('仅修改人设时提供完整新版原文', 50000) }, ['character_id']), minProperties: 2 }),
  definition('apply_character_appearance', '仅修改基础外观；私服、居家服、睡衣请用 generate_scene_outfits，不用本工具。按要求修订角色原始“你的外观”：提取原文、生成完整新版，卡片展示原文与新版供用户确认，仅确认后替换该段。批量时逐个角色按各自原文生成。', object({ character_id: id('角色编号'), instruction: string('具体修改要求，例如仅把发色改红，其他细节保留', 4000) })),
  definition('apply_angel_appearance', '修改天使自己的默认外观，先读取 read_angel；生成完整替换草稿，用户确认后仅修改天使外观段，不操作普通角色。', object({ instruction: string('仅修改天使默认外观的具体要求', 4000) })),
  definition('generate_angel_outfits', '为天使自己设计或修改私服、居家服、睡衣。复用天使服装生成器，展示完整草稿，确认后只保存指定槽位，不自动生图，不修改普通角色或默认外观。', object({ scenes: { type: 'array', items: { type: 'string', enum: ['casual', 'home', 'sleep'] }, minItems: 1, maxItems: 3, uniqueItems: true }, instruction: string('款式、颜色或修改要求', 4000) }, ['scenes'])),
  definition('rewrite_world_setting', '按要求修订指定世界观，读取完整原文并生成完整新版，确认卡展示前后全文，用户确认后才替换。', object({ world_id: id('世界观编号'), instruction: string('对世界观原文的修改要求', 4000) })),
  definition('batch_characters', '对固定角色集合逐项执行同一工具。省略 character_ids 表示当前全体角色。长期修改先汇总内容供用户确认一次。arguments_json 是共用参数 JSON 对象，不含 character_id；可用 per_character_json 按角色编号覆盖具体内容。只支持含 character_id 的工具，禁止嵌套批量。', object({
    tool_name: string('已注册的角色工具名称', 80), arguments_json: string('完整 JSON 对象，例如 {"instruction":"仅把发色改为红色"}', 50000),
    per_character_json: string('按角色编号提供参数覆盖，例如 {"1":{"instruction":"改成深红色长发"}}', 100000),
    character_ids: { type: 'array', items: id('角色编号'), minItems: 1, maxItems: 1000, uniqueItems: true }, title: string('任务标题', 100),
  }, ['tool_name', 'arguments_json'])),
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
    if (Object.keys(value).length < (schema.minProperties || 0)) throw new Error(`${path}至少需要提供一个待修改字段`);
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
      case 'inspect_changes': { const session = db.prepare('SELECT session_id FROM god_runs WHERE id=?').get(ctx.runId); const summary = rows => rows.map(({ id, title, status, items }) => ({ id, title, status, count: items.length, completed: items.filter(i => i.status === 'done').length, unresolved: items.filter(i => !['done', 'pending'].includes(i.status)).map(i => ({ character_id: i.args.character_id, status: i.status, error: i.error })) })); return { changes: summary(changes.list(session.session_id)), batches: summary(batches.list(session.session_id)) }; }
      case 'batch_characters': return batches.start(args, ctx);
      case 'read_character_source': {
        const c = character(args.character_id);
        return { id: c.id, name: c.name, display_name: c.display_name, base_prompt: c.base_prompt };
      }
      case 'update_character': character(args.character_id); return services.api({ method: 'PUT', path: `/api/characters/${args.character_id}`, body: { ...(args.base_prompt !== undefined ? { base_prompt: args.base_prompt } : {}), ...(args.display_name !== undefined ? { display_name: args.display_name } : {}) } }, ctx);
      case 'inspect_neighbors': {
        const q = `%${args.query || ''}%`;
        return { characters: db.prepare('SELECT id,display_name FROM characters WHERE display_name LIKE ? OR name LIKE ? ORDER BY id LIMIT 100').all(q, q),
          groups: db.prepare('SELECT id,name,topic FROM group_chats WHERE name LIKE ? ORDER BY id LIMIT 60').all(q),
          events: world.list().slice(0, 5), localDate: services.localDate(), angelDate: repo.day() };
      }
      case 'read_character': {
        const c = character(args.character_id);
        return { id: c.id, name: c.display_name, persona: c.short_prompt || c.base_prompt, localDate: services.localDate(),
          ...(args.include_schedule === true ? { scheduleEnabled: services.scheduleEnabled(), schedule: services.getSchedule(c.id) || [], currentActivity: services.getActivity(c.id) } : {}) };
      }
      case 'set_schedule': {
        const c = character(args.character_id);
        services.assertScheduleIdle?.(c.id);
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
      case 'list_capabilities': {
        const matched=moduleToolCatalog().filter(t=>!args.module||t.module===args.module);
        return {tools:matched,core:GOD_TOOLS.filter(t=>!moduleTool(t.function.name)).map(t=>({name:t.function.name,description:t.function.description})),...(args.module && args.module!=='神说' && !matched.length?{unavailable:true,note:'吾神，该模块没有接入，不能用其他模块写工具代替操作。'}:{})};
      }
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
      if (!def) return { ok: false, stop: true, code: 'CAPABILITY_UNAVAILABLE', error: '这项能力尚未接入，不能用其他写工具替代执行。' };
      args = JSON.parse(call.function.arguments);
      validateToolArgs(def.function.parameters, args);
      const input = db.prepare('SELECT input FROM god_runs WHERE id=?').get(runId)?.input || '';
      validateBusinessOperation(call.function.name,args,input);
      signal?.throwIfAborted();
      const boundary = capabilityBoundary(input);
      if (boundary) return { ok: false, stop: true, code: 'CAPABILITY_UNAVAILABLE', error: boundary };
    } catch (err) { return { ok: false, error: err.message }; }
    const readOnly = ['inspect_changes', 'inspect_neighbors', 'read_character', 'read_character_source', 'inspect_work', 'recall_memory', 'list_capabilities'].includes(call.function.name) || moduleTool(call.function.name)?.method === 'GET';
    const key = readOnly ? callId : effectKey(runId, call.function.name, args);
    const old = db.prepare('SELECT * FROM god_tool_calls WHERE effect_key=?').get(key);
    if (old) return parseJson(old.result_json) || { ok: false, error: '这项工作已发起但结果尚不确定，请查询执行记录，不要重复执行。' };
    const row = { id: callId, run_id: runId, name: call.function.name, args, status: 'running' };
    db.prepare('INSERT INTO god_tool_calls(id,run_id,effect_key,name,args_json,status,created_at) VALUES (?,?,?,?,?,?,?)').run(callId, runId, key, row.name, JSON.stringify(args), 'running', repo.timestamp());
    repo.emit(runId, 'tool', row);
    let result;
    try {
      const ctx = { runId, effectKey: key, callId, signal };
      const value = await dispatchOperation({ name: row.name, args }, ctx);
      result = value?.unavailable ? {ok:false,stop:true,code:'CAPABILITY_UNAVAILABLE',error:value.note} : { ok: true, value };
    } catch (err) {
      const saved = parseJson(db.prepare('SELECT result_json FROM god_tool_calls WHERE id=?').get(callId)?.result_json);
      result = saved ? { ok: true, value: saved } : { ok: false, error: err.message === 'ALREADY_ACTIVE_EVENT' ? '这位角色已有进行中的奇遇，请先完成当前奇遇。' : err.message, ...(err.uncertain ? { uncertain: true } : {}),...(err.code==='CAPABILITY_UNAVAILABLE'?{stop:true,code:err.code}:{}) };
    }
    const status = result.ok ? 'done' : result.uncertain ? 'uncertain' : 'failed';
    db.prepare('UPDATE god_tool_calls SET status=?,result_json=? WHERE id=?').run(status, JSON.stringify(result), callId);
    repo.emit(runId, 'tool', { ...row, status, result });
    return result;
  }
  const policy = createChangePolicy(db, services.api, services.generateReplacement, services);
  const frozenTools=new Set([...PREPARED_TOOLS,'apply_character_appearance','rewrite_world_setting','generate_scene_outfits','apply_angel_appearance','update_angel','generate_angel_outfits','regenerate_schedule','generate_diary','generate_emoji_prompt','generate_emoji_image','generate_emoji_images']);
  const applyOperation = async (item, ctx) => {
    if (frozenTools.has(item.name) && !item.replacement) throw new Error('旧版草稿未包含冻结结果，请重新生成');
    if (item.name==='update_character' && item.args.display_name!==undefined && !item.preview?.some(field=>field.label==='显示名称' && field.after===item.args.display_name)) throw new Error('旧版草稿未展示新名字，请重新生成');
    if (item.name==='recruit_character' && item.args.description===undefined) throw new Error('旧版招募草稿已失效，请重新提出招募要求');
    if (!item.replacement) return dispatch(item.name, item.args, ctx);
    const response=await services.api(item.replacement,ctx);
    const accepted=response.status===202 || response.data?.started===true || response.data?.queued===true;
    return {status:accepted?'accepted':'returned',data:response.data,note:accepted?'已提交原功能模块，后台仍在处理，请查询实际结果。':'已保存准备好的内容。'};
  };
  const changes = createChangeSets(repo, { ...policy, apply: applyOperation });
  const batches = createBatchTasks(repo, { changes, needsConfirmation: (name, args) => policy.needsConfirmation({ name, args }), execute: dispatchOperation,
    validate(operation,ctx) {
      const def = GOD_TOOLS.find(t => t.function.name === operation.name);
      if (!def) throw Object.assign(new Error('该能力没有接入，不能执行或用其他写操作替代'),{code:'CAPABILITY_UNAVAILABLE'});
      if (!def?.function.parameters.properties.character_id || operation.name === 'batch_characters') throw new Error('该工具不支持按角色批量执行');
      validateToolArgs(def.function.parameters, operation.args);
      validateBusinessOperation(operation.name,operation.args,db.prepare('SELECT input FROM god_runs WHERE id=?').get(ctx.runId)?.input||'');
    },
  });
  function validateBusinessOperation(name,args,input) {
    if (args.date!==undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)||Number.isNaN(Date.parse(args.date))||new Date(args.date).toISOString().slice(0,10)!==args.date)) throw new Error('需要有效的 YYYY-MM-DD 日期');
    if (name==='create_outfit' && !!args.description===!!args.instruction) throw new Error('instruction 与 description 必须且只能提供一个');
    if (name==='create_outfit' && args.description && !input.includes(args.description)) throw new Error('description 只能原样使用本轮用户提供的完整正文；设计要求请传 instruction，调用原外观生成器');
    if (name==='update_angel' && args.display_name===undefined && args.persona===undefined) throw new Error('至少提供一个待修改字段');
    if (name==='set_schedule') {
      const c=character(args.character_id);
      if (!services.scheduleEnabled()||c.schedule_enabled===0) throw new Error('这位角色的日程尚未启用，暂时无法安排');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)||Number.isNaN(Date.parse(args.date))||new Date(args.date).toISOString().slice(0,10)!==args.date||args.date<services.localDate()) throw new Error('需要有效的今天或未来日期');
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(args.start_time)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(args.end_time)||args.end_time<=args.start_time) throw new Error('请使用当天开始时间早于结束时间的 HH:MM 时段，跨日安排需分成两段');
    }
  }
  async function dispatchOperation(item, ctx) {
    if (policy.needsConfirmation(item)) return changes.create(ctx.runId, moduleTool(item.name)?.label || '资料修改', [item], ctx.signal);
    if (PREPARED_TOOLS.has(item.name)) {
      const before = policy.snapshot(item);
      const prepared = await policy.prepare(item, ctx.signal, before);
      const assertCurrent = () => { if (JSON.stringify(policy.snapshot(prepared)) !== JSON.stringify(before)) throw new Error('生成期间原数据已改变，请重试'); };
      assertCurrent();
      return applyOperation(prepared, { ...ctx, assertCurrent });
    }
    return dispatch(item.name, item.args, ctx);
  }
  return { definitions: GOD_TOOLS, execute, changes, batches, boundary: capabilityBoundary };
}
