"""Shared on-disk contract for online installation and extracted offline bundles."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MODEL_FILES = (
    "config.yaml", "gpt.pth", "codec.pth", "s2mel.pth", "feat1.pt", "feat2.pt",
    "wav2vec2bert_stats.pt", "multilingual_zh_ja_yue_char_del.tiktoken", "pinyin.vocab",
    "hf_cache/w2v-bert-2.0/config.json", "hf_cache/w2v-bert-2.0/preprocessor_config.json",
    "hf_cache/w2v-bert-2.0/model.safetensors", "hf_cache/campplus_cn_common.bin",
    "hf_cache/bigvgan/config.json", "hf_cache/bigvgan/bigvgan_generator.pt",
)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def child(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError("部署清单路径越界")
    return path


def seal_source(root=ROOT):
    upstream = root / "runtime/index-tts"
    files = sorted((upstream / "indextts").rglob("*.py"))
    files += [upstream / "pyproject.toml", upstream / "uv.lock"]
    if not (upstream / "indextts/infer_v2_5.py").is_file():
        raise ValueError("缺少 IndexTTS 源码")
    write_json(upstream / "linshe-code-version.json", {
        "code_revision": read_json(root / "versions.json")["code_revision"],
        "files": {p.relative_to(upstream).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
    })


def seal_models(root=ROOT):
    model = root / "runtime/checkpoints"
    sizes = {name: (model / name).stat().st_size for name in MODEL_FILES}
    if not all(sizes.values()):
        raise ValueError("模型文件为空")
    write_json(model / "linshe-model-files.json", sizes)
    write_json(model / "linshe-model-version.json", read_json(root / "versions.json"))


def check_source(root=ROOT):
    upstream = root / "runtime/index-tts"
    source = read_json(upstream / "linshe-code-version.json")
    if source["code_revision"] != read_json(root / "versions.json")["code_revision"]:
        raise ValueError("IndexTTS 代码版本不匹配")
    files = source["files"]
    if not all(name in files for name in ("indextts/infer_v2_5.py", "pyproject.toml", "uv.lock")):
        raise ValueError("源码清单不完整")
    for name, digest in files.items():
        if hashlib.sha256(child(upstream, name).read_bytes()).hexdigest() != digest:
            raise ValueError(f"源码损坏或已修改：index-tts/{name}")


def installation_error(root=ROOT):
    try:
        versions = read_json(root / "versions.json")
        check_source(root)
        model = root / "runtime/checkpoints"
        if read_json(model / "linshe-model-version.json") != versions:
            raise ValueError("模型版本不匹配")
        sizes = read_json(model / "linshe-model-files.json")
        for name in MODEL_FILES:
            size = (model / name).stat().st_size
            if size <= 0 or size != sizes.get(name):
                raise ValueError(f"模型文件不完整：checkpoints/{name}")
    except Exception as error:
        return f"TTS 部署不完整：{error}。请运行 tts-service/setup.ps1，或将完整离线包解压到 tts-service。"
    return None


def prepare_runtime(root=ROOT):
    """Repair generated venv paths after a bundle is moved to another PC."""
    runtime = read_json(root / "runtime/runtime.json")
    base = child(root / "runtime", runtime["python_home"])
    if not (base / "python.exe").is_file():
        raise ValueError("缺少随包 Python，请解压完整离线包")
    upstream = root / "runtime/index-tts"
    venv = upstream / ".venv"
    if not (venv / "Scripts/python.exe").is_file():
        raise ValueError("缺少 Python 依赖环境，请解压完整离线包")
    config = venv / "pyvenv.cfg"
    old = config.read_text(encoding="utf-8")
    lines = [line for line in old.splitlines() if line.split("=", 1)[0].strip() not in ("home", "executable", "command")]
    content = f"home = {base}\n" + "\n".join(lines) + "\n"
    if old != content:
        config.write_text(content, encoding="utf-8")
    editable = venv / "Lib/site-packages/_editable_impl_indextts.pth"
    if editable.exists():
        editable.write_text(str(upstream) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("seal-source", "check-source", "seal-models", "prepare", "check", "check-runtime", "record-python"))
    parser.add_argument("--python-home")
    args = parser.parse_args()
    if args.action == "seal-source":
        seal_source()
    elif args.action == "check-source":
        check_source()
    elif args.action == "check-runtime":
        for name in ("torch", "torchaudio", "transformers", "soundfile", "librosa", "omegaconf", "wetext", "fugashi", "unidic_lite"):
            if importlib.util.find_spec(name) is None:
                raise SystemExit(f"Missing Python dependency: {name}")
    elif args.action == "seal-models":
        seal_models()
    elif args.action == "record-python":
        relative = Path(args.python_home).resolve().relative_to(ROOT / "runtime").as_posix()
        write_json(ROOT / "runtime/runtime.json", {"python_home": relative})
    elif args.action == "prepare":
        prepare_runtime()
    else:
        error = installation_error()
        if error:
            raise SystemExit(error)
        print("TTS source and models are ready (offline).")
