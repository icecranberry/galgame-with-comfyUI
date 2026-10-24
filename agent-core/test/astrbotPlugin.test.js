import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const python = process.env.PYTHON || 'python';
function missingDependencies(modules) {
  const result = spawnSync(python, ['-c', `import ${modules}`], { encoding: 'utf8', timeout: 10000 });
  return result.status === 0 ? false : `需要 Python 与 ${modules}；设置 PYTHON 可指定解释器`;
}
test('AstrBot plugin: registration, stable persona, permissions, task delivery and HTTP client', { skip: missingDependencies('aiohttp') }, () => {
  const result = spawnSync(process.env.PYTHON || 'python', ['-c', String.raw`
import asyncio, importlib.util, json, sys, types
from pathlib import Path
from types import SimpleNamespace as NS
from aiohttp import web

def module(name, **attributes):
    value = types.ModuleType(name)
    value.__dict__.update(attributes)
    sys.modules[name] = value
    return value

class Tool:
    def __init__(self, **kwargs): self.__dict__.update(kwargs)
class Star:
    def __init__(self, context): self.context = context
class Media:
    @staticmethod
    def fromBase64(data): return ('media', data)
module('astrbot'); module('astrbot.api', AstrBotConfig=dict, logger=NS(warning=lambda *a: None))
module('astrbot.api.event', filter=NS(on_llm_request=lambda: lambda fn: fn), AstrMessageEvent=object)
module('astrbot.api.provider', ProviderRequest=object)
module('astrbot.api.star', Context=object, Star=Star, register=lambda *a: lambda cls: cls)
module('astrbot.api.message_components', Image=Media, Record=Media)
module('astrbot.core'); module('astrbot.core.agent'); module('astrbot.core.agent.tool', FunctionTool=Tool)
package = module('linshe_fixture')
package.__path__ = [str(Path('agent-core/src/astrbot-bridge/plugin').resolve())]
from linshe_fixture.main import LinshePlugin, CATALOG
from linshe_fixture.client import LinsheClient

class Event:
    unified_msg_origin = 'qq:GroupMessage:123'
    message_obj = NS(message_id='message-1')
    def __init__(self): self.sent = []
    async def send(self, result): self.sent.append(result)
    def chain_result(self, value): return value
    def plain_result(self, value): return value

class FakeClient:
    def __init__(self): self.calls = []; self.enabled = True; self.closed = False
    async def request(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        if path == '/bootstrap':
            if not self.enabled: raise RuntimeError('offline')
            return {'persona': {'system_prompt': '你是星星', 'name': '星星', 'character_id': 37}, 'tools': [CATALOG[0]]}
        if path == '/generate': return {'task_id': 7, 'status': 'running'}
        if path == '/tts': return {'id': 'voice-1', 'status': 'queued'}
        return {'content': '真实数据'}
    async def wait_job(self, path, **kwargs):
        await asyncio.sleep(0)
        return {'image': {'url': '/images/a.png'}, 'audio_url': '/api/tts/audio/generated/a.wav'}
    async def media_base64(self, path): return 'YWJj'
    async def close(self): self.closed = True

async def main():
    registered = []
    plugin = LinshePlugin(NS(add_llm_tools=lambda *tools: registered.extend(tools)), {})
    plugin.client = FakeClient()
    assert len(registered) == len(CATALOG) and len({t.name for t in registered}) == len(CATALOG)
    assert all(t.parameters == spec['parameters'] for t, spec in zip(registered, CATALOG))
    event = Event()
    original_tools = NS(tools=[NS(name=t['name']) for t in CATALOG] + [NS(name='external')])
    req = NS(system_prompt='AstrBot existing rules', func_tool=original_tools, contexts=[{'role':'user','content':'hello'}])
    await plugin.inject_persona(event, req)
    first = req.system_prompt
    assert first.startswith('【邻舍初始角色人格】\n你是星星')
    assert '"character_id": 37' in first and '"name": "星星"' in first
    assert '省略工具参数 character_id 即使用当前角色' in first
    assert first.endswith('AstrBot existing rules')
    await plugin.inject_persona(event, req)
    assert req.system_prompt == first
    assert len(original_tools.tools) == len(CATALOG) + 1
    assert {t.name for t in req.func_tool.tools} == {'linshe_characters', 'external'}
    assert req.contexts == [{'role':'user','content':'hello'}]
    plugin.client.enabled = False
    req = NS(system_prompt='original', func_tool=original_tools)
    await plugin.inject_persona(event, req)
    assert req.system_prompt == 'original' and [t.name for t in req.func_tool.tools] == ['external']
    plugin.config['allowed_sessions'] = ['other']
    before = len(plugin.client.calls)
    assert '未启用' in await plugin.call_tool(event, CATALOG[0], {})
    assert len(plugin.client.calls) == before
    plugin.config['allowed_sessions'] = []
    image = next(t for t in CATALOG if t['group'] == 'images')
    for i in range(2): await plugin.call_tool(event, image, {'requirement': '花园'})
    await asyncio.gather(*plugin.jobs)
    assert len(event.sent) == 1
    calls = [call for call in plugin.client.calls if call[1] == '/generate']
    assert calls[0][2]['json']['request_id'] == calls[1][2]['json']['request_id']
    assert calls[0][2]['json']['session_id'] == event.unified_msg_origin
    tts = next(t for t in CATALOG if t['group'] == 'tts')
    await plugin.call_tool(event, tts, {'text': '你好'})
    await asyncio.gather(*plugin.jobs)
    assert len(event.sent) == 2
    detail = next(t for t in CATALOG if t['name'] == 'linshe_event')
    await plugin.call_tool(event, detail, {'event_id': 'town:12'})
    assert plugin.client.calls[-1][1] == '/events/by-id/town%3A12'
    await plugin.terminate()
    assert plugin.client.closed

    seen = []
    async def health(request):
        seen.append(request.headers.get('Authorization'))
        return web.json_response({'ok': True})
    async def denied(request): return web.json_response({'error': 'Token 无效'}, status=401)
    async def job(request): return web.json_response({'status':'completed','audio_url':'/media'})
    async def media(request): return web.Response(body=b'abc')
    application = web.Application()
    application.router.add_get('/api/astrbot/health', health)
    application.router.add_get('/api/astrbot/denied', denied)
    application.router.add_get('/api/astrbot/speech/1', job)
    application.router.add_get('/media', media)
    runner = web.AppRunner(application); await runner.setup()
    site = web.TCPSite(runner, '127.0.0.1', 0); await site.start()
    address = 'http://127.0.0.1:' + str(site._server.sockets[0].getsockname()[1])
    client = LinsheClient(address, 'secret')
    assert (await client.request('GET', '/health'))['ok'] and seen == ['Bearer secret']
    assert (await client.wait_job('/speech/1'))['status'] == 'completed'
    assert await client.media_base64('/media') == 'YWJj'
    try: await client.request('GET', '/denied')
    except RuntimeError as error: assert 'Token 无效' in str(error)
    else: raise AssertionError('HTTP errors must propagate')
    try: client.media_url('https://other.example/a.png')
    except ValueError: pass
    else: raise AssertionError('Media must stay on configured origin')
    await client.close(); await runner.cleanup()
    print('plugin: 13 tools; stable persona; isolated permissions; image/audio delivery; HTTP authentication OK')

asyncio.run(main())
`], { cwd: root, encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' }, timeout: 30000 });
  assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
});

test('AstrBot launcher: isolated install, plugin copy, Qt page and child process stop', { skip: missingDependencies('PySide6, psutil') }, () => {
  const result = spawnSync(process.env.PYTHON || 'python', ['-c', String.raw`
import os, sys, tempfile, time, shutil
from pathlib import Path
from unittest.mock import patch
from PySide6.QtWidgets import QApplication
from PySide6.QtCore import QProcess
sys.path.insert(0, str(Path('launcher').resolve()))
from launcher.astrbot_runner import AstrbotRunner, astrbot_installed, copy_bridge_plugin, ASTRBOT_VERSION
from launcher.astrbot_page import AstrbotPage
app = QApplication([])

def wait_until(predicate):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        app.processEvents()
        if predicate(): return
        time.sleep(.01)
    raise AssertionError('Qt condition timed out')

with tempfile.TemporaryDirectory(prefix='linshe-astrbot-test-') as folder:
    root = Path(folder)
    source = root / 'agent-core/src/astrbot-bridge/plugin'
    shutil.copytree('agent-core/src/astrbot-bridge/plugin', source, ignore=shutil.ignore_patterns('__pycache__'))
    page = AstrbotPage(folder)
    assert not page.start_btn.isEnabled()
    page.set_values(True, False)
    assert page.autostart.isChecked() and not page.open_browser.isChecked()
    runner = AstrbotRunner(folder)
    with patch.object(runner, '_next_step'), patch('launcher.astrbot_runner.shutil.which', side_effect=lambda name: '/fake/' + name), patch('launcher.astrbot_runner.find_bundled_git', return_value=None):
        runner.install()
        assert runner.any_active()
        assert any(ASTRBOT_VERSION in args for cmd, args, cwd in runner._steps)
        assert runner._steps[-1][1] == ['sync','--no-dev','--no-install-project','--python','3.12']
        runner.stop_all()
    bot = root / 'AstrBot'
    (bot / '.venv/Scripts').mkdir(parents=True)
    (bot / '.venv/Scripts/python.exe').write_text('fixture')
    (bot / 'main.py').write_text('import time; time.sleep(60)')
    assert astrbot_installed(folder)
    copy_bridge_plugin(folder)
    plugin = bot / 'data/plugins/astrbot_plugin_linshe'
    assert (plugin / 'main.py').is_file() and (plugin / 'tools.json').is_file()
    config = bot / 'data/config/astrbot_plugin_linshe_config.json'
    config.parent.mkdir(parents=True); config.write_text('preserve credentials')
    copy_bridge_plugin(folder)
    assert config.read_text() == 'preserve credentials'
    page.detect(); assert page.start_btn.isEnabled()
    page.update_status('astrbot','installing',None)
    assert not page.install_btn.isEnabled() and page.stop_btn.isEnabled()
    runner._worker._def['get_cmd'] = lambda _: sys.executable
    runner._worker._health_check = lambda: None
    # Keep lifecycle checks independent of a real AstrBot already using 6185.
    with patch('socket.socket') as socket_factory:
        socket_factory.return_value.__enter__.return_value.connect_ex.return_value = 0
        runner.start_all()
        assert not runner.any_active()
        socket_factory.return_value.__enter__.return_value.connect_ex.return_value = 111
        runner.start_all()
    wait_until(lambda: runner._worker.pid is not None)
    assert runner.any_active()
    process = runner._worker._proc
    runner.start_all(); assert runner._worker._proc is process
    runner.stop_all()
    wait_until(lambda: not runner.any_active())
    assert process.state() == QProcess.NotRunning and runner._worker.status == 'stopped'
    # Missing uv is installed under the private prefix, never into shared Python.
    with patch.object(runner, '_next_step'), patch('launcher.astrbot_runner.shutil.which', return_value=None):
        runner.install()
        assert '--prefix' in runner._steps[0][1]
        assert str(root / 'runtime/astrbot-bootstrap') in runner._steps[0][1]
        runner.stop_all()
    page.deleteLater(); runner.deleteLater(); app.processEvents()
print('launcher: install isolation, UI states, plugin/config preservation, start/stop OK')
`], { cwd: root, encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1', QT_QPA_PLATFORM: 'offscreen' }, timeout: 30000 });
  assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
});
