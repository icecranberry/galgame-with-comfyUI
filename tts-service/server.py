"""Loopback HTTP adapter. GPU state lives in one killable, reusable worker.

Run in the pinned IndexTTS environment; see README.md. No web framework needed.
"""
import hmac
import json
import multiprocessing as mp
import os
from pathlib import Path
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = Path(__file__).resolve().parent
VERSIONS = json.loads((HERE / "versions.json").read_text(encoding="utf-8"))
MODEL_VERSION = f"IndexTTS-2.5:{VERSIONS['model_revision']}:{VERSIONS['code_revision']}"
AUDIO_ROOT = Path(os.environ.get("TTS_AUDIO_DIR", HERE.parent / "agent-core/data/audio")).resolve()
MODEL_DIR = Path(os.environ.get("TTS_MODEL_DIR", HERE / "checkpoints")).resolve()
TOKEN = os.environ.get("TTS_SERVICE_TOKEN", "")


def controlled_path(relative, kind):
    relative = Path(relative)
    path = (AUDIO_ROOT / relative).resolve()
    if relative.is_absolute() or not path.is_relative_to(AUDIO_ROOT / kind) or path.suffix != ".wav":
        raise ValueError("Invalid controlled audio path")
    return path


def installation_error():
    try:
        import importlib.util
        spec = importlib.util.find_spec("indextts")
        if not spec or not spec.origin:
            return "IndexTTS 尚未安装，请按 tts-service/README.md 部署"
        root = Path(spec.origin).parent.parent
        revision = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True, timeout=10).strip()
        if revision != VERSIONS["code_revision"]:
            return "IndexTTS 代码版本不匹配"
        manifest = json.loads((MODEL_DIR / "linshe-model-version.json").read_text(encoding="utf-8"))
        if manifest != VERSIONS or not (MODEL_DIR / "config.yaml").is_file():
            return "模型版本不匹配或文件不完整"
    except Exception as error:
        return str(error)
    return None


def worker(pipe):
    # CUDA libraries are imported in the child only; terminating it releases the
    # complete CUDA context, including hidden/global caches in upstream code.
    try:
        from indextts.infer_v2_5 import IndexTTS2
        model = IndexTTS2(cfg_path=str(MODEL_DIR / "config.yaml"), model_dir=str(MODEL_DIR),
                          use_bf16=True, use_cuda_kernel=False, use_qwen_emo=False)
        pipe.send({"loaded": True})
        while True:
            args = pipe.recv()
            output = controlled_path(args["output"], "generated")
            output.parent.mkdir(parents=True, exist_ok=True)
            # An incomplete file never becomes playable.
            temporary = output.with_name(output.stem + ".partial.wav")
            try:
                model.infer(spk_audio_prompt=str(controlled_path(args["reference"], "references")),
                            text=args["text"], lang=args["language"], output_path=str(temporary),
                            duration_factor=args["duration_factor"], use_emo_text=False)
                temporary.replace(output)
                pipe.send({"ok": True})
            finally:
                temporary.unlink(missing_ok=True)
    except BaseException as error:
        try:
            pipe.send({"error": str(error)})
        except (BrokenPipeError, EOFError):
            pass
    finally:
        pipe.close()


class Engine:
    def __init__(self):
        self.lock = threading.RLock()
        self.inference = threading.Lock()
        self.process = None
        self.pipe = None
        self.loaded = False

    def unload(self):
        with self.lock:
            if self.process:
                self.process.terminate()
                self.process.join(10)
                if self.process.is_alive():
                    self.process.kill()
                    self.process.join(10)
                if self.process.is_alive():
                    raise RuntimeError("Worker exit not confirmed")
                self.process.close()
                self.process = None
            if self.pipe:
                self.pipe.close()
                self.pipe = None
            self.loaded = False
        return {"unloaded": True}

    def receive(self, pipe, seconds):
        if not pipe.poll(seconds):
            raise TimeoutError("TTS 推理超时，工作进程已回收")
        response = pipe.recv()
        if response.get("error"):
            raise RuntimeError(response["error"])
        return response

    def synthesize(self, args):
        if not self.inference.acquire(blocking=False):
            raise RuntimeError("TTS busy")
        started = time.monotonic()
        try:
            error = installation_error()
            if error:
                raise RuntimeError(error)
            with self.lock:
                if not self.process:
                    self.pipe, child = mp.Pipe()
                    self.process = mp.Process(target=worker, args=(child,), daemon=True)
                    self.process.start()
                    child.close()
                pipe = self.pipe
            if not self.loaded:
                self.receive(pipe, 240)
                self.loaded = True
            pipe.send(args)
            self.receive(pipe, 300)
            return {"ok": True, "elapsed_seconds": round(time.monotonic() - started, 3)}
        except BaseException:
            self.unload()
            raise
        finally:
            try:
                controlled_path(args["output"], "generated").with_name(Path(args["output"]).stem + ".partial.wav").unlink(missing_ok=True)
            except OSError:
                pass
            finally:
                self.inference.release()


ENGINE = Engine()


class Handler(BaseHTTPRequestHandler):
    timeout = 15
    def respond(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        host = self.headers.get("Host", "").split(":")[0].lower()
        return host in ("127.0.0.1", "localhost") and hmac.compare_digest(self.headers.get("X-TTS-Token", ""), TOKEN) and not self.headers.get("Origin")

    def do_GET(self):
        if not self.authorized():
            return self.respond(403, {"error": "Forbidden"})
        if self.path != "/health":
            return self.respond(404, {"error": "Not found"})
        error = installation_error()
        self.respond(200, {"model_version": MODEL_VERSION, "ready": error is None, "error": error,
                           "loaded": ENGINE.loaded, "worker_alive": bool(ENGINE.process and ENGINE.process.is_alive()),
                           "busy": ENGINE.inference.locked()})

    def do_POST(self):
        if not self.authorized():
            return self.respond(403, {"error": "Forbidden"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            if not 0 < length <= 16384:
                raise ValueError("Invalid body length")
            body = json.loads(self.rfile.read(length))
            if self.path == "/unload":
                return self.respond(200, ENGINE.unload())
            if self.path != "/synthesize":
                return self.respond(404, {"error": "Not found"})
            if body.get("model_version") != MODEL_VERSION:
                raise ValueError("Model version mismatch")
            if not isinstance(body.get("text"), str) or not 1 <= len(body["text"]) <= 1000:
                raise ValueError("Invalid text length")
            if body.get("language") not in ("zh", "en", "ja") or not 0.5 <= float(body.get("duration_factor", 0)) <= 2:
                raise ValueError("Invalid synthesis parameters")
            if not controlled_path(body["reference"], "references").is_file():
                raise ValueError("Reference file missing")
            controlled_path(body["output"], "generated")
            self.respond(200, ENGINE.synthesize(body))
        except Exception as error:
            self.respond(400, {"error": str(error)})


if __name__ == "__main__":
    mp.freeze_support()
    server = ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("TTS_PORT", "7861"))), Handler)
    try:
        server.serve_forever()
    finally:
        ENGINE.unload()
        server.server_close()
