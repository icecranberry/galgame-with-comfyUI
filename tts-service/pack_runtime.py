"""Produce one ZIP64 archive containing just runtime/, including hidden .venv."""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from deployment import ROOT, CATALOG, child, installation_error, read_json, model_id
from compact_runtime import removable_files

EXCLUDED = {".git", ".cache", "__pycache__", "outputs"}


def portable_pyvenv(text):
    """Drop the builder's absolute Python paths; prepare_runtime rewrites home."""
    lines = [line for line in text.splitlines()
             if line.split("=", 1)[0].strip() not in ("home", "executable", "command")]
    return "home = python\n" + "\n".join(lines) + "\n"


def portable_editable():
    """prepare_runtime rewrites this file with the extracted checkout path."""
    return ""


def portable_direct_url():
    """Never ship the builder's editable-install source path in metadata."""
    return '{"url":"file:///","dir_info":{"editable":true}}'


def pack_runtime(root, output, version=None, *, model_only=False):
    version = model_id(version)
    error = installation_error(root, version)
    if error:
        raise ValueError(error)
    bundle = root / "runtime"
    non_inference = set(removable_files(root))
    output = output.resolve()
    if output.is_relative_to(bundle.resolve()):
        raise ValueError("压缩包不能写入 runtime 内部")
    # A model-only bundle must not be mistaken for a complete installation.
    for relative in ("runtime.json", f"{CATALOG[version]['directory']}/source/.venv/Scripts/python.exe",
                     "tools/ffmpeg/bin/ffmpeg.exe", "tools/ffmpeg/bin/ffprobe.exe"):
        if not (bundle / relative).is_file():
            raise ValueError(f"运行包缺少 {relative}")
    base = child(bundle, read_json(bundle / "runtime.json")["python_home"])
    if not (base / "python.exe").is_file():
        raise ValueError("运行包缺少完整 Python 解释器")
    if output.exists():
        raise FileExistsError(f"已有同名压缩包，请换一个输出文件名：{output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + ".partial")
    created = False
    try:
        with temporary.open("xb") as staging:
            created = True
            print("正在打包 runtime（包含模型和 Python 依赖）…", flush=True)
            packed_bytes = 0
            next_report = 1024 ** 3
            with ZipFile(staging, "w", compression=ZIP_DEFLATED, compresslevel=1, allowZip64=True) as archive:
                allowed = {CATALOG[version]['directory']} if model_only else {CATALOG[version]['directory'], 'python', 'tools', 'runtime.json'}
                paths = (path for name in sorted(allowed) for path in
                         ([bundle / name] if (bundle / name).is_file() else sorted((bundle / name).rglob('*'))))
                if not model_only:
                    archive.writestr('runtime/selected-model.json', json.dumps({'model': version}))
                for path in paths:
                    relative = path.relative_to(bundle)
                    # Include exactly one engine, even if many are installed.
                    if relative.parts[0] not in allowed:
                        continue
                    if EXCLUDED.intersection(relative.parts) or path.suffix == ".pyc" or not path.is_file() or path in non_inference:
                        continue
                    if not path.resolve().is_relative_to(bundle.resolve()):
                        raise ValueError(f"运行包包含外部文件链接：{relative}")
                    target_name = "runtime/" + relative.as_posix()
                    if relative.name == "pyvenv.cfg":
                        content = portable_pyvenv(path.read_text(encoding="utf-8-sig"))
                        archive.writestr(target_name, content)
                        packed_bytes += len(content.encode("utf-8"))
                        continue
                    if relative.name == "_editable_impl_indextts.pth":
                        content = portable_editable()
                        archive.writestr(target_name, content)
                        packed_bytes += len(content.encode("utf-8"))
                        continue
                    if relative.name == "direct_url.json" and len(relative.parts) >= 2 and "indextts" in relative.parts[-2].lower():
                        content = portable_direct_url()
                        archive.writestr(target_name, content)
                        packed_bytes += len(content.encode("utf-8"))
                        continue
                    archive.write(path, target_name)
                    packed_bytes += path.stat().st_size
                    if packed_bytes >= next_report:
                        print(f"已处理 {packed_bytes / 1024 ** 3:.1f} GiB", flush=True)
                        next_report = packed_bytes + 1024 ** 3
        temporary.rename(output)
    except BaseException:
        if created:
            temporary.unlink(missing_ok=True)
        raise
    with output.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    output.with_suffix(output.suffix + ".sha256").write_text(f"{digest}  {output.name}\n", encoding="utf-8")
    print(f"离线包已生成：{output}", flush=True)
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "dist/linshe-tts-runtime.zip")
    parser.add_argument("--model", choices=tuple(CATALOG))
    parser.add_argument("--model-only", action="store_true", help="Only the selected engine, for a PC with shared Python/tools installed")
    args = parser.parse_args()
    pack_runtime(ROOT, args.output, args.model, model_only=args.model_only)
