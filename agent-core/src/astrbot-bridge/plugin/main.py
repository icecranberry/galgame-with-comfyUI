import asyncio
import hashlib
import json
from pathlib import Path
from urllib.parse import quote

from astrbot.api import AstrBotConfig, logger
from astrbot.api.event import filter, AstrMessageEvent
from astrbot.api.provider import ProviderRequest
from astrbot.api.star import Context, Star, register
from astrbot.api.message_components import Image, Record
from astrbot.core.agent.tool import FunctionTool

from .client import LinsheClient

CATALOG = json.loads(Path(__file__).with_name('tools.json').read_text(encoding='utf-8'))


class LinsheTool(FunctionTool):
    def __init__(self, plugin, spec):
        super().__init__(name=spec['name'], description=spec['description'], parameters=spec['parameters'])
        self.plugin, self.spec = plugin, spec

    async def call(self, context, **kwargs):
        return await self.plugin.call_tool(context.context.event, self.spec, kwargs)


@register('astrbot_plugin_linshe', 'Linshe', '邻舍角色人格与生活工具', '1.0.0')
class LinshePlugin(Star):
    def __init__(self, context: Context, config: AstrBotConfig):
        super().__init__(context)
        self.config = config
        self.client = LinsheClient(config.get('linshe_url', 'http://127.0.0.1:3099'), config.get('token', ''))
        self.jobs = set()
        self.deliveries = {}  # (session, kind, task id) prevents duplicate sends on model retries
        self.context.add_llm_tools(*(LinsheTool(self, spec) for spec in CATALOG))

    def allowed(self, event):
        sessions = self.config.get('allowed_sessions', [])
        return not sessions or event.unified_msg_origin in sessions

    @filter.on_llm_request()
    async def inject_persona(self, event: AstrMessageEvent, req: ProviderRequest):
        names = {spec['name'] for spec in CATALOG}
        enabled = set()
        if self.allowed(event):
            try:
                bootstrap = await self.client.request('GET', '/bootstrap', timeout=5)
                enabled = {tool['name'] for tool in bootstrap['tools']}
                persona = bootstrap.get('persona')
                if persona and persona.get('system_prompt'):
                    # Stable identity prefix. Keep AstrBot's original instructions and history intact.
                    identity = json.dumps({
                        'name': persona.get('name'),
                        'character_id': persona.get('character_id'),
                    }, ensure_ascii=False, sort_keys=True)
                    prefix = ('【邻舍初始角色人格】\n' + persona['system_prompt'] +
                              '\n【角色人格结束】\n以以上角色身份进行对话，后续同类身份描述以此为准。\n' +
                              '邻舍当前角色标识：' + identity + '\n' +
                              '查询或生成当前角色的内容时，省略工具参数 character_id 即使用当前角色；' +
                              '不要猜测角色 ID。用户指定其他角色时，先用 linshe_characters 查询对应 ID。\n\n')
                    if not (req.system_prompt or '').startswith(prefix):
                        req.system_prompt = prefix + (req.system_prompt or '')
            except Exception as error:
                logger.warning(f'邻舍集成不可用，本轮保留 AstrBot 人格: {type(error).__name__}')
        # Per-request copy: never mutate AstrBot's shared persona tool set.
        if req.func_tool:
            import copy
            req.func_tool = copy.copy(req.func_tool)
            req.func_tool.tools = [tool for tool in req.func_tool.tools if tool.name not in names or tool.name in enabled]

    async def call_tool(self, event, spec, arguments):
        if not self.allowed(event):
            return '当前会话未启用邻舍工具。'
        try:
            if spec['name'] == 'linshe_moment_images':
                return await self.send_moment_images(event, arguments)
            args = dict(arguments)
            path = spec['path']
            for name in list(args):
                placeholder = '{' + name + '}'
                if placeholder in path:
                    path = path.replace(placeholder, quote(str(args.pop(name)), safe=''))
            if '{' in path:
                raise ValueError('工具缺少必填参数')
            if spec['name'] == 'linshe_generate_image':
                args['session_id'] = event.unified_msg_origin
                message_id = str(getattr(event.message_obj, 'message_id', '') or id(event))
                args['request_id'] = hashlib.sha256((message_id + json.dumps(arguments, sort_keys=True, ensure_ascii=False)).encode()).hexdigest()
            data = await self.client.request(spec['method'], path, **({'params': args} if spec['method'] == 'GET' else {'json': args}))
            if spec['group'] in ('images', 'tts'):
                kind = spec['group']
                task_id = data['task_id'] if kind == 'images' else data['id']
                key = (event.unified_msg_origin, kind, str(task_id))
                if key not in self.deliveries:
                    if len(self.deliveries) >= 1000:
                        completed = next((k for k, v in self.deliveries.items() if v == 'done'), None)
                        if completed:
                            del self.deliveries[completed]
                    self.deliveries[key] = 'pending'
                    task = asyncio.create_task(self.deliver(event, kind, task_id, key))
                    self.jobs.add(task)
                    task.add_done_callback(self.jobs.discard)
                return json.dumps({'task_id': task_id, 'status': self.deliveries[key], 'message': '任务已提交，完成后自动送达，回复时不要描述任务进度或预计时间。'}, ensure_ascii=False)
            return json.dumps(data, ensure_ascii=False)
        except Exception as error:
            return '邻舍工具调用失败：' + str(error)

    async def send_moment_images(self, event, arguments):
        paths = [p for p in (arguments.get('paths') or []) if isinstance(p, str) and p]
        post_id = arguments.get('post_id')
        if not paths and not post_id:
            return '需要提供 post_id 或 paths。'
        if not paths:
            data = await self.client.request('GET', f"/moments/{quote(str(post_id), safe='')}/images")
            paths = [p for p in (data.get('images') or []) if isinstance(p, str) and p]
            if not paths:
                return '这条朋友圈没有配图。'
        paths = paths[:9]
        message_id = str(getattr(event.message_obj, 'message_id', '') or id(event))
        token = post_id if post_id else hashlib.sha256(json.dumps(paths).encode()).hexdigest()[:16]
        key = (event.unified_msg_origin, 'moment_images', f'{message_id}:{token}')
        if self.deliveries.get(key) == 'done':
            return json.dumps({'sent': 0, 'message': '配图刚刚已经发送。'}, ensure_ascii=False)
        if len(self.deliveries) >= 1000:
            completed = next((k for k, v in self.deliveries.items() if v == 'done'), None)
            if completed:
                del self.deliveries[completed]
        self.deliveries[key] = 'pending'
        try:
            media = [Image.fromBase64(await self.client.media_base64(path)) for path in paths]
            await event.send(event.chain_result(media))
        except Exception:
            self.deliveries.pop(key, None)
            raise
        self.deliveries[key] = 'done'
        return json.dumps({'sent': len(paths), 'message': f'配图 {len(paths)} 张已发送到会话，回复时不要再提发送动作或任务进度。'}, ensure_ascii=False)

    async def deliver(self, event, kind, task_id, key):
        try:
            path = f'/tasks/{task_id}' if kind == 'images' else f'/speech/{task_id}'
            data = await self.client.wait_job(path, timeout=max(30, min(3600, int(self.config.get('task_timeout', 600)))))
            media = await self.client.media_base64(data['image']['url'] if kind == 'images' else data['audio_url'])
            if kind == 'images':
                await event.send(event.chain_result([Image.fromBase64(media)]))
            else:
                await event.send(event.chain_result([Record.fromBase64(media)]))
            self.deliveries[key] = 'done'
        except asyncio.CancelledError:
            self.deliveries.pop(key, None)
            raise
        except Exception as error:
            self.deliveries.pop(key, None)
            try:
                await event.send(event.plain_result('邻舍任务未能送达：' + str(error)))
            except Exception:
                logger.warning(f'邻舍任务结果发送失败，任务 ID: {task_id}')

    async def terminate(self):
        tasks = list(self.jobs)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await self.client.close()
