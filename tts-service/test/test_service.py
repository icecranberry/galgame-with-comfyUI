import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import types
import unittest
import warnings
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


adapter = load("tts_adapter", ROOT / "server.py")


class ServiceTests(unittest.TestCase):
    def test_generation_options_validate_and_preserve_defaults(self):
        self.assertEqual(adapter.generation_options({}), adapter.DEFAULT_GENERATION_OPTIONS)
        self.assertEqual(adapter.generation_options({"top_p": 0.95}), adapter.DEFAULT_GENERATION_OPTIONS | {"top_p": 0.95})
        self.assertEqual(adapter.generation_options({"top_k": 0})["top_k"], 0)
        for invalid in ([], "bad", {"top_p": 0}, {"top_p": 1.1}, {"temperature": "0.8"}, {"temperature": float('nan')}, {"top_k": 2.5}, {"num_beams": True}, {"num_beams": 6}, {"do_sample": False}):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                adapter.generation_options(invalid)

    def test_custom_parameters_survive_stop_token_retry(self):
        calls = []
        class Model:
            def infer(self, *, output_path, **kwargs):
                calls.append(kwargs)
                if len(calls) == 1:
                    warnings.warn("WARN: generation stopped due to exceeding `max_mel_tokens` (1500).", RuntimeWarning)
                Path(output_path).write_bytes(b"audio")
        params = adapter.generation_options({"temperature": 0.75, "top_k": 40, "top_p": 0.95, "num_beams": 2})
        with tempfile.TemporaryDirectory() as directory:
            adapter.synthesize_to_file(Model(), {"reference": "references/test.wav", "text": "你好", "language": "zh", "duration_factor": 1}, Path(directory) / "test.wav", generation_options=params)
        self.assertEqual(len(calls), 2)
        for call in calls:
            self.assertEqual({key: call[key] for key in params}, params)

    def test_unterminated_audio_is_retried_without_publishing_bad_output(self):
        calls = []
        class Model:
            def infer(self, *, output_path, **kwargs):
                calls.append(kwargs)
                if len(calls) == 1:
                    Path(output_path).write_bytes(b"partial previous segment")
                    warnings.warn("WARN: generation stopped due to exceeding `max_mel_tokens` (1500). Input text tokens: 38.", RuntimeWarning)
                    raise AssertionError("must abort before decoding runaway tokens")
                self.assert_no_partial = not Path(output_path).exists()
                Path(output_path).write_bytes(b"complete retry")
        model = Model()
        args = {"reference": "references/test.wav", "text": "一句很短的话。", "language": "zh", "duration_factor": 1}
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory) / "test.partial.wav"
            adapter.synthesize_to_file(model, args, temporary, generation_options=adapter.DEFAULT_GENERATION_OPTIONS)
            self.assertEqual(temporary.read_bytes(), b"complete retry")
        self.assertEqual(len(calls), 2)
        self.assertTrue(model.assert_no_partial)
        self.assertEqual(calls[1]["text"], args["text"])
        self.assertEqual(calls[1]["max_text_tokens_per_segment"], 24)
        self.assertFalse(calls[1]["do_sample"])
        for call in calls:
            self.assertEqual(call["top_p"], 0.9)
            self.assertEqual(call["num_beams"], 3)
            self.assertEqual(call["temperature"], 0.8)

    def test_repeated_missing_stop_token_fails_and_removes_partial_audio(self):
        calls = []
        class Model:
            def infer(self, *, output_path, **kwargs):
                calls.append(kwargs)
                Path(output_path).write_bytes(b"bad")
                warnings.warn("WARN: generation stopped due to exceeding `max_mel_tokens` (1500).", RuntimeWarning)
        args = {"reference": "references/test.wav", "text": "你好", "language": "zh", "duration_factor": 1}
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory) / "test.partial.wav"
            with self.assertRaisesRegex(RuntimeError, "自动重试后仍异常"):
                adapter.synthesize_to_file(Model(), args, temporary)
            self.assertFalse(temporary.exists())
        self.assertEqual(len(calls), 2)

    def test_other_inference_errors_are_not_retried(self):
        calls = []
        class Model:
            def infer(self, **kwargs):
                calls.append(kwargs)
                raise RuntimeError("CUDA out of memory")
        args = {"reference": "references/test.wav", "text": "你好", "language": "zh", "duration_factor": 1}
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, "CUDA out of memory"):
                adapter.synthesize_to_file(Model(), args, Path(directory) / "test.partial.wav")
        self.assertEqual(len(calls), 1)

    def test_unrelated_runtime_warning_does_not_reject_valid_synthesis(self):
        class Model:
            def infer(self, *, output_path, **kwargs):
                warnings.warn("unrelated backend warning", RuntimeWarning)
                Path(output_path).write_bytes(b"valid")
        args = {"reference": "references/test.wav", "text": "你好", "language": "zh", "duration_factor": 1}
        with tempfile.TemporaryDirectory() as directory, warnings.catch_warnings(record=True) as captured:
            warnings.simplefilter("always")
            temporary = Path(directory) / "test.partial.wav"
            adapter.synthesize_to_file(Model(), args, temporary)
            self.assertEqual(temporary.read_bytes(), b"valid")
            self.assertEqual(str(captured[0].message), "unrelated backend warning")

    def test_worker_can_log_unicode_with_gbk_redirected_streams(self):
        # Reproduce Windows background launches: both handles start as GBK,
        # and upstream logs the text before generating its WAV.
        text = "诶——？冰乐你终于冒头了！ ♪ 😊 𠮷"
        seen = []
        generation_calls = []

        class Model:
            def __init__(self, **kwargs):
                print("加载音色 ♪", file=sys.stderr)

            def infer(self, *, text, output_path, **kwargs):
                print(f"text after normalization: {text}")
                seen.append(text)
                generation_calls.append(kwargs)
                Path(output_path).write_bytes(b"RIFFtest-wave")

        class Pipe:
            def __init__(self): self.messages = []; self.closed = False; self.received = False
            def send(self, value): self.messages.append(value)
            def recv(self):
                if self.received: raise EOFError()
                self.received = True
                return {"reference": "references/test.wav", "output": "generated/test.wav",
                        "text": text, "language": "zh", "duration_factor": 1, "generation_params": {"top_p": 0.95, "num_beams": 2}}
            def close(self): self.closed = True

        module = types.ModuleType("indextts.infer_v2_5")
        module.IndexTTS2 = Model
        pipe = Pipe()
        with tempfile.TemporaryDirectory() as directory, \
                io.TextIOWrapper(io.BytesIO(), encoding="gbk") as stdout, \
                io.TextIOWrapper(io.BytesIO(), encoding="gbk") as stderr, \
                patch.object(adapter, "AUDIO_ROOT", Path(directory)), \
                patch.dict(sys.modules, {"indextts": types.ModuleType("indextts"), "indextts.infer_v2_5": module}), \
                patch.object(sys, "stdout", stdout), patch.object(sys, "stderr", stderr):
            adapter.worker(pipe)
            self.assertEqual(pipe.messages[:2], [{"loaded": True}, {"ok": True}])
            self.assertEqual(seen, [text])
            self.assertEqual({key: generation_calls[0][key] for key in ("num_beams", "temperature", "top_p", "top_k")},
                             {"num_beams": 2, "temperature": 0.8, "top_p": 0.95, "top_k": 30})
            self.assertEqual((Path(directory) / "generated/test.wav").read_bytes(), b"RIFFtest-wave")
            self.assertFalse((Path(directory) / "generated/test.partial.wav").exists())
            stdout.flush(); stderr.flush()
            self.assertIn(text, stdout.buffer.getvalue().decode("utf-8"))
            self.assertIn("加载音色 ♪", stderr.buffer.getvalue().decode("utf-8"))
        self.assertTrue(pipe.closed)

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
