"""Loopback HTTP adapter. GPU state lives in one killable, reusable worker.

Run in the selected model's independent environment; see README.md.
"""
import hmac
import importlib
import json
import math
import multiprocessing as mp
import os
import subprocess
from pathlib import Path
import sys
import threading
import time
import traceback
import warnings
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = Path(__file__).resolve().parent
# Direct launches and multiprocessing children use the same local source tree.
sys.path.insert(0, str(HERE))
from deployment import CATALOG, installation_error, model_id, model_versions, model_directory, source_directory
from voice_effects import voice_effects, adjust_voice

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
MODEL_ID = model_id()
VERSIONS = model_versions(HERE, MODEL_ID)
MODEL_VERSION = f"{CATALOG[MODEL_ID]['label'].replace(' ', '-')}:{VERSIONS['model_revision']}:{VERSIONS['code_revision']}"
SOURCE_DIR = source_directory(HERE, MODEL_ID)
sys.path.insert(0, str(SOURCE_DIR))
AUDIO_ROOT = Path(os.environ.get("TTS_AUDIO_DIR", HERE.parent / "agent-core/data/audio")).resolve()
MODEL_DIR = model_directory(HERE, MODEL_ID)
TOKEN = os.environ.get("TTS_SERVICE_TOKEN", "")
DEFAULT_GENERATION_OPTIONS = {"num_beams": 3, "temperature": 0.8, "top_p": 0.9, "top_k": 30}


def generation_options(value=None):
    if value is None:
        return dict(DEFAULT_GENERATION_OPTIONS)
    if not isinstance(value, dict) or set(value) - set(DEFAULT_GENERATION_OPTIONS):
        raise ValueError("Invalid generation parameters")
    result = DEFAULT_GENERATION_OPTIONS | value
    for key, (low, high) in {"temperature": (0.1, 1.5), "top_k": (0, 100), "top_p": (0.1, 1), "num_beams": (1, 5)}.items():
        number = result[key]
        if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number) or not low <= number <= high:
            raise ValueError(f"Invalid {key}")
        if key in ("top_k", "num_beams"):
            if int(number) != number:
                raise ValueError(f"Invalid {key}")
            result[key] = int(number)
    return result


def configure_stdio():
    # Redirected Windows output can default to GBK. Upstream prints the input
    # text during inference, so logging a music note/emoji must not abort a job.
    for stream in (sys.stdout, sys.stderr):
        if callable(getattr(stream, "reconfigure", None)):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")


def emotion_vector(value):
    if value is None:
        return None
    if not isinstance(value, list) or len(value) != 8 or any(
            isinstance(number, bool) or not isinstance(number, (int, float))
            or not math.isfinite(number) or not 0 <= number <= 0.8 for number in value):
        raise ValueError("Invalid emotion vector")
    if sum(value) > 0.800001:
        raise ValueError("Emotion intensity exceeds 0.8")
    return value


def controlled_path(relative, kind):
    relative = Path(relative)
    path = (AUDIO_ROOT / relative).resolve()
    if relative.is_absolute() or not path.is_relative_to(AUDIO_ROOT / kind) or path.suffix != ".wav":
        raise ValueError("Invalid controlled audio path")
    return path


def synthesize_to_file(model, args, temporary, *, generation_options=None):
    # The pinned upstream warns when EOS is missing, but then decodes all 1500
    # tokens anyway. Turn ONLY that warning into an error before vocoding or
    # publishing. Retry once with shorter segments and deterministic decoding;
    # never truncate a bad waveform and present it as a complete utterance.
    # The worker supplies the production profile; standalone comparisons may
    # supply their own settings without changing the service defaults.
    base_options = dict(generation_options or {})
    vector = emotion_vector(args.get("emo_vector"))
    if vector is not None:
        base_options.update(emo_vector=vector, use_random=False)
    attempts = (base_options, {**base_options, "max_text_tokens_per_segment": 24, "do_sample": False})
    for attempt, options in enumerate(attempts):
        temporary.unlink(missing_ok=True)
        try:
            with warnings.catch_warnings():
                warnings.filterwarnings("error", message=r"WARN: generation stopped due to exceeding `max_mel_tokens`", category=RuntimeWarning)
                model.infer(spk_audio_prompt=str(controlled_path(args["reference"], "references")),
                            text=args["text"], output_path=str(temporary), use_emo_text=False, **options)
            effects = voice_effects(args.get("voice_effects"))
            if any(effects.values()):
                adjust_voice(temporary, effects, 1 / args["duration_factor"])
            elif MODEL_ID == "2.0" and args["duration_factor"] != 1:
                adjust_audio_speed(temporary, 1 / args["duration_factor"])
            return
        except RuntimeWarning as error:
            if not str(error).startswith("WARN: generation stopped due to exceeding `max_mel_tokens`"):
                raise
            temporary.unlink(missing_ok=True)
            print(f"TTS attempt {attempt + 1}: missing audio stop token; output rejected", file=sys.stderr, flush=True)
            if attempt == len(attempts) - 1:
                raise RuntimeError("语音未正常结束，自动重试后仍异常，已丢弃结果。请换一段清晰、无背景音乐的参考音频后重试。") from error


def adjust_audio_speed(file, speed):
    adjusted = file.with_name(file.stem + ".speed.wav")
    try:
        tool = HERE / "runtime/tools/ffmpeg/bin/ffmpeg.exe"
        subprocess.run([str(tool), "-nostdin", "-y", "-v", "error", "-i", str(file), "-af", f"atempo={speed}", str(adjusted)],
                       check=True, timeout=60, capture_output=True,
                       **({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}))
        adjusted.replace(file)
    finally:
        adjusted.unlink(missing_ok=True)


def load_model():
    prepare_index_text_normalizer()
    cls = importlib.import_module("indextts.infer_v2").IndexTTS2
    precision = {"use_fp16": True, "use_deepspeed": False,
        "aux_paths": {"w2v_bert": str(MODEL_DIR / "hf_cache/w2v-bert-2.0"),
                      "campplus": str(MODEL_DIR / "hf_cache/campplus_cn_common.bin"),
                      "semantic_codec": str(MODEL_DIR / "hf_cache/semantic_codec_model.safetensors"),
                      "bigvgan": str(MODEL_DIR / "hf_cache/bigvgan")}}
    return cls(cfg_path=str(MODEL_DIR / "config.yaml"), model_dir=str(MODEL_DIR),
               use_cuda_kernel=False, use_qwen_emo=False, **precision)


def load_native_fst(factory, file):
    """Kaldi's narrow Windows fopen cannot open a Unicode absolute path."""
    file = Path(file)
    if file.is_absolute() and not str(file).isascii():
        previous = Path.cwd()
        try:
            os.chdir(file.parent)
            return factory(file.name)
        finally:
            os.chdir(previous)
    return factory(str(file))


def prepare_index_text_normalizer():
    if os.name != 'nt':
        return
    prepare_sentencepiece_paths()
    # All FSTs are read eagerly during wetext import. This runs only in the
    # dedicated single-inference worker, before other model imports. Preserve
    # upstream sources and restore both cwd and the native API after loading.
    native = importlib.import_module('kaldifst')
    factory = native.TextNormalizer
    native.TextNormalizer = lambda file: load_native_fst(factory, file)
    try:
        importlib.import_module('wetext')
    finally:
        native.TextNormalizer = factory


def prepare_sentencepiece_paths():
    cls = importlib.import_module('sentencepiece').SentencePieceProcessor
    if getattr(cls, '_linshe_unicode_paths', False):
        return
    original = cls.LoadFromFile
    def load_file(processor, file):
        filename = os.fsdecode(file)
        if not filename.isascii():
            return processor.LoadFromSerializedProto(Path(filename).read_bytes())
        return original(processor, file)
    cls.LoadFromFile = load_file
    cls._linshe_unicode_paths = True


def worker(pipe):
    # CUDA libraries are imported in the child only; terminating it releases the
    # complete CUDA context, including hidden/global caches in upstream code.
    try:
        # Windows uses spawn: configuring only the HTTP parent is insufficient.
        configure_stdio()
        model = load_model()
        pipe.send({"loaded": True})
        while True:
            args = pipe.recv()
            output = controlled_path(args["output"], "generated")
            output.parent.mkdir(parents=True, exist_ok=True)
            # An incomplete file never becomes playable.
            temporary = output.with_name(output.stem + ".partial.wav")
            try:
                synthesize_to_file(model, args, temporary, generation_options=generation_options(args.get("generation_params")))
                temporary.replace(output)
                pipe.send({"ok": True})
            finally:
                temporary.unlink(missing_ok=True)
    except BaseException as error:
        if not isinstance(error, (EOFError, BrokenPipeError)):
            traceback.print_exc(file=sys.stderr)
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

    def unload(self, idle_only=False):
        if idle_only:
            if not self.inference.acquire(blocking=False):
                raise RuntimeError("TTS 正在合成，请等待当前任务完成后重试")
            try:
                return self.unload()
            finally:
                self.inference.release()
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
        self.respond(200, {"local_model": MODEL_ID, "model_version": MODEL_VERSION, "voice_effects_version": 2, "emotion_vector_version": 1, "generation_defaults": DEFAULT_GENERATION_OPTIONS, "ready": error is None, "error": error,
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
                return self.respond(200, ENGINE.unload(idle_only=body.get("idle_only") is True))
            if self.path != "/synthesize":
                return self.respond(404, {"error": "Not found"})
            if body.get("model_version") != MODEL_VERSION:
                raise ValueError("Model version mismatch")
            if not isinstance(body.get("text"), str) or not 1 <= len(body["text"]) <= 1000:
                raise ValueError("Invalid text length")
            if body.get("language") not in ("zh", "en", "ja") or not 0.5 <= float(body.get("duration_factor", 0)) <= 2:
                raise ValueError("Invalid synthesis parameters")
            if MODEL_ID == "2.0" and body["language"] == "ja":
                raise ValueError("IndexTTS 2.0 支持中英文，请将语音语言调整为中文或英文")
            body["generation_params"] = generation_options(body.get("generation_params"))
            body["emo_vector"] = emotion_vector(body.get("emo_vector"))
            body["voice_effects"] = voice_effects(body.get("voice_effects"))
            if not controlled_path(body["reference"], "references").is_file():
                raise ValueError("Reference file missing")
            controlled_path(body["output"], "generated")
            self.respond(200, ENGINE.synthesize(body))
        except Exception as error:
            self.respond(400, {"error": str(error)})


if __name__ == "__main__":
    configure_stdio()
    mp.freeze_support()
    server = ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("TTS_PORT", "7861"))), Handler)
    try:
        server.serve_forever()
    finally:
        ENGINE.unload()
        server.server_close()
