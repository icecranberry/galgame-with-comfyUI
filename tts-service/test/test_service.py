import importlib.util
from pathlib import Path
import sys
import types
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


adapter = load("tts_adapter", ROOT / "server.py")


class ServiceTests(unittest.TestCase):
    def test_http_requires_loopback_host_and_rejects_browser_origin(self):
        handler = object.__new__(adapter.Handler)
        handler.headers = {"Host": "127.0.0.1:7861", "X-TTS-Token": adapter.TOKEN}
        self.assertTrue(handler.authorized())
        handler.headers["Origin"] = "https://example.com"
        self.assertFalse(handler.authorized())
        handler.headers.pop("Origin")
        handler.headers["Host"] = "example.com"
        self.assertFalse(handler.authorized())

    def test_paths_are_confined_to_audio_kind(self):
        valid = adapter.controlled_path("references/abc.wav", "references")
        self.assertEqual(valid.parent, adapter.AUDIO_ROOT / "references")
        for bad in ("../secrets.wav", "references/../../secret.wav", "generated/test.wav", "references/test.mp3", str(valid)):
            with self.assertRaises(ValueError):
                adapter.controlled_path(bad, "references")

    def test_unload_waits_for_worker_exit(self):
        calls = []

        class Process:
            def terminate(self): calls.append("terminate")
            def join(self, timeout): calls.append("join")
            def is_alive(self): return False
            def close(self): calls.append("close")

        engine = adapter.Engine()
        engine.process = Process()
        engine.loaded = True
        self.assertEqual(engine.unload(), {"unloaded": True})
        self.assertEqual(calls, ["terminate", "join", "close"])
        self.assertFalse(engine.loaded)
        self.assertIsNone(engine.process)


class GuardTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.saved_modules = {key: sys.modules.get(key) for key in ("aiohttp", "server", "comfy", "comfy.model_management")}
        self.queue = ([], [])
        self.unloaded = []
        web = types.SimpleNamespace(middleware=lambda fn: fn, json_response=lambda data, status=200: {"status": status, **data})
        server = types.SimpleNamespace(PromptServer=types.SimpleNamespace(instance=types.SimpleNamespace(
            app=types.SimpleNamespace(middlewares=[]), routes=types.SimpleNamespace(post=lambda path: lambda fn: fn),
            prompt_queue=types.SimpleNamespace(get_current_queue=lambda: self.queue))))
        mm = types.ModuleType("comfy.model_management")
        mm.unload_all_models = lambda: self.unloaded.append("models")
        mm.soft_empty_cache = lambda: self.unloaded.append("cache")
        comfy = types.ModuleType("comfy")
        comfy.model_management = mm
        sys.modules.update({"aiohttp": types.SimpleNamespace(web=web), "server": server, "comfy": comfy, "comfy.model_management": mm})
        self.guard = load("tts_guard_test", ROOT / "comfy_guard/__init__.py")

    def tearDown(self):
        for key, value in self.saved_modules.items():
            if value is None: sys.modules.pop(key, None)
            else: sys.modules[key] = value

    def request(self, body=None):
        async def data(): return body or {"token": "test-token"}
        return types.SimpleNamespace(json=data, method="POST", path="/api/prompt")

    async def test_acquire_refuses_running_queued_and_validating_prompts(self):
        for queue in (([1], []), ([], [1])):
            self.queue = queue
            self.assertEqual((await self.guard.acquire(self.request()))["status"], 409)
        self.queue = ([], [])
        self.guard.submissions = 1
        self.assertEqual((await self.guard.acquire(self.request()))["status"], 409)
        self.assertEqual(self.unloaded, [])

    async def test_lease_blocks_external_prompt_until_release(self):
        self.assertTrue((await self.guard.acquire(self.request()))["acquired"])
        self.assertEqual(self.unloaded, ["models", "cache"])
        async def forbidden(request): self.fail("prompt entered during speech lease")
        response = await self.guard.protect_prompts(self.request(), forbidden)
        self.assertEqual(response["status"], 423)
        self.assertEqual((await self.guard.release(self.request({"token": "wrong"})))["status"], 409)
        self.assertTrue((await self.guard.release(self.request()))["released"])
        self.assertIsNone(self.guard.lease)

    async def test_prompt_validation_race_is_counted(self):
        async def handler(request):
            self.assertEqual(self.guard.submissions, 1)
            self.assertEqual((await self.guard.acquire(self.request()))["status"], 409)
            raise RuntimeError("validation failed")
        with self.assertRaises(RuntimeError):
            await self.guard.protect_prompts(self.request(), handler)
        self.assertEqual(self.guard.submissions, 0)


if __name__ == "__main__":
    unittest.main()
