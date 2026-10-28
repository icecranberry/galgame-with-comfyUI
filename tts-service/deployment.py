"""Independent engine folders; only the selected engine is required offline."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_MODEL = "2.0"
MODEL_20_FILES = (
    "config.yaml", "gpt.pth", "s2mel.pth", "feat1.pt", "feat2.pt", "wav2vec2bert_stats.pt", "bpe.model",
    "hf_cache/w2v-bert-2.0/config.json", "hf_cache/w2v-bert-2.0/preprocessor_config.json",
    "hf_cache/w2v-bert-2.0/model.safetensors", "hf_cache/campplus_cn_common.bin",
    "hf_cache/bigvgan/config.json", "hf_cache/bigvgan/bigvgan_generator.pt",
    "hf_cache/semantic_codec_model.safetensors",
)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


CATALOG = {entry["id"]: entry for entry in read_json(ROOT / "local-models.json")}


def model_id(value=None):
    value = value or os.environ.get("TTS_LOCAL_MODEL", DEFAULT_MODEL)
    # Normalize selections saved before IndexTTS 2.0 became the only engine.
    if value in ("2.5", "voxcpm-2.0"):
        return DEFAULT_MODEL
    if value not in CATALOG:
        raise ValueError("Unsupported local TTS model")
    return value


def engine_directory(root=ROOT, model=None):
    return root / "runtime" / CATALOG[model_id(model)]["directory"]


def source_directory(root=ROOT, model=None):
    return engine_directory(root, model) / "source"


def model_directory(root=ROOT, model=None):
    return engine_directory(root, model) / "checkpoints"


def model_versions(root=ROOT, model=None):
    return read_json(root / CATALOG[model_id(model)]["manifest"])


def model_files(model=None):
    model_id(model)
    return MODEL_20_FILES


def child(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError("部署清单路径越界")
    return path


def source_entries(version=None):
    model_id(version)
    return ("indextts/infer_v2.py", "pyproject.toml", "uv.lock")


def seal_source(root=ROOT, version=None):
    upstream = source_directory(root, version)
    files = sorted((upstream / "indextts").rglob("*.py"))
    files += [upstream / name for name in source_entries(version)[1:]]
    if not (upstream / source_entries(version)[0]).is_file():
        raise ValueError("缺少所选模型的源码")
    write_json(upstream / "linshe-code-version.json", {
        "code_revision": model_versions(root, version)["code_revision"],
        "files": {p.relative_to(upstream).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
    })


def seal_models(root=ROOT, version=None):
    model = model_directory(root, version)
    sizes = {name: child(model, name).stat().st_size for name in model_files(version)}
    if not all(sizes.values()):
        raise ValueError("模型文件为空")
    write_json(model / "linshe-model-files.json", sizes)
    write_json(model / "linshe-model-version.json", model_versions(root, version))


def check_source(root=ROOT, version=None):
    upstream = source_directory(root, version)
    source = read_json(upstream / "linshe-code-version.json")
    if source["code_revision"] != model_versions(root, version)["code_revision"]:
        raise ValueError("代码版本不匹配")
    files = source["files"]
    if not all(name in files for name in source_entries(version)):
        raise ValueError("源码清单不完整")
    for name, digest in files.items():
        if hashlib.sha256(child(upstream, name).read_bytes()).hexdigest() != digest:
            raise ValueError(f"源码损坏或已修改：{name}")


def check_shared(root=ROOT):
    bundle = root / "runtime"
    base = child(bundle, read_json(bundle / "runtime.json")["python_home"])
    for file in (base / "python.exe", bundle / "tools/ffmpeg/bin/ffmpeg.exe", bundle / "tools/ffmpeg/bin/ffprobe.exe"):
        if not file.is_file():
            raise ValueError(f"缺少共用运行文件：{file.name}")
    return base


def installation_error(root=ROOT, version=None):
    try:
        check_shared(root)
        check_source(root, version)
        if not (source_directory(root, version) / ".venv/Scripts/python.exe").is_file():
            raise ValueError("缺少所选模型的独立依赖环境")
        model = model_directory(root, version)
        if read_json(model / "linshe-model-version.json") != model_versions(root, version):
            raise ValueError("模型版本不匹配")
        sizes = read_json(model / "linshe-model-files.json")
        for name in model_files(version):
            size = child(model, name).stat().st_size
            if size <= 0 or size != sizes.get(name):
                raise ValueError(f"模型文件不完整：checkpoints/{name}")
    except Exception as error:
        return f"TTS 部署不完整：{error}。请运行 tts-service/setup.ps1 -ModelVersion {model_id(version)}，或解压对应离线包。"
    return None


def migrate_legacy(root=ROOT):
    """Move the old IndexTTS 2.0 installation once, without touching recordings."""
    legacy = root / "runtime/index-tts"
    target = source_directory(root, "2.0")
    if legacy.is_dir() and not target.exists():
        manifest = read_json(legacy / "linshe-code-version.json")
        if manifest["code_revision"] != model_versions(root, "2.0")["code_revision"]:
            raise ValueError("旧版 IndexTTS 源码版本不匹配，未迁移")
        for name, digest in manifest["files"].items():
            if hashlib.sha256(child(legacy, name).read_bytes()).hexdigest() != digest:
                raise ValueError(f"旧版源码已修改，未迁移：{name}")
        target.parent.mkdir(parents=True, exist_ok=True)
        legacy.rename(target)
    old_models = root / "runtime/checkpoints-2.0"
    models = model_directory(root, "2.0")
    if old_models.is_dir() and not models.exists():
        models.parent.mkdir(parents=True, exist_ok=True)
        old_models.rename(models)
    obsolete = child(root, 'runtime/checkpoints')
    archive = child(root, 'cache/retired-indextts-2.5')
    manifest = obsolete / 'linshe-model-version.json'
    if obsolete.is_dir() and manifest.is_file() and not archive.exists():
        if read_json(manifest).get('model_repo') == 'IndexTeam/IndexTTS-2.5':
            archive.parent.mkdir(parents=True, exist_ok=True)
            obsolete.rename(archive)


def prepare_runtime(root=ROOT, version=None):
    """Repair only the selected venv when an offline package is relocated."""
    base = check_shared(root)
    upstream = source_directory(root, version)
    venv = upstream / ".venv"
    if not (venv / "Scripts/python.exe").is_file():
        raise ValueError("缺少所选模型的 Python 依赖环境，请解压对应离线包")
    config = venv / "pyvenv.cfg"
    old = config.read_text(encoding="utf-8")
    lines = [line for line in old.splitlines() if line.split("=", 1)[0].strip() not in ("home", "executable", "command")]
    content = f"home = {base}\n" + "\n".join(lines) + "\n"
    if old != content:
        config.write_text(content, encoding="utf-8")
    editable = venv / "Lib/site-packages/_editable_impl_indextts.pth"
    if editable.exists():
        # Python 3.11 reads .pth using the Windows locale even in UTF-8 mode.
        # ASCII escapes keep Chinese/moved installation paths portable.
        editable.write_text(f"import sys; sys.path.insert(0, {ascii(str(upstream))})\n", encoding="ascii")


def check_dependencies(version=None):
    names = ("torch", "torchaudio", "transformers", "soundfile", "librosa", "huggingface_hub", "safetensors")
    model_id(version)
    names += ("omegaconf", "wetext", "fugashi", "unidic_lite")
    for name in names:
        if importlib.util.find_spec(name) is None:
            raise ValueError(f"Missing Python dependency: {name}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("seal-source", "check-source", "seal-models", "prepare", "check", "check-runtime", "record-python", "inspect", "migrate"))
    parser.add_argument("--model", choices=tuple(CATALOG))
    parser.add_argument("--python-home")
    args = parser.parse_args()
    if args.action == "seal-source": seal_source(version=args.model)
    elif args.action == "check-source": check_source(version=args.model)
    elif args.action == "check-runtime": check_dependencies(args.model)
    elif args.action == "seal-models": seal_models(version=args.model)
    elif args.action == "migrate": migrate_legacy()
    elif args.action == "record-python":
        relative = Path(args.python_home).resolve().relative_to(ROOT / "runtime").as_posix()
        write_json(ROOT / "runtime/runtime.json", {"python_home": relative})
    elif args.action == "prepare": prepare_runtime(version=args.model)
    elif args.action == "inspect":
        print(json.dumps([{ "id": key, "label": entry["label"], "directory": f"runtime/{entry['directory']}",
                           "installed": (error := installation_error(version=key)) is None, "error": error }
                          for key, entry in CATALOG.items()], ensure_ascii=False))
    else:
        error = installation_error(version=args.model)
        if error: raise SystemExit(error)
        print("Selected TTS source, environment and models are ready (offline).")
