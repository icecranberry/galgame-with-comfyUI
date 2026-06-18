"""
下载 Jina v2 base zh ONNX 模型 — 最小化版本
仅下载运行时必需的 model_int8.onnx + tokenizer 文件，约 155MB
国内用户自动使用 hf-mirror.com 镜像

用法:
  python download_model.py

环境变量:
  HF_ENDPOINT=https://hf-mirror.com     # 手动指定 HuggingFace 镜像
"""

import os
import sys
import shutil
from pathlib import Path

MODEL_NAME = "Xenova/jina-embeddings-v2-base-zh"
TARGET_DIR = Path(__file__).parent / "models" / "jina-embeddings-v2-base-zh"

# 运行时必需的 7 个文件 (model_int8.onnx + tokenizer)
REQUIRED_FILES = [
    "onnx/model_int8.onnx",
    "tokenizer.json",
    "vocab.json",
    "merges.txt",
    "config.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
]


def download():
    try:
        from huggingface_hub import hf_hub_download
    except ImportError:
        print("[!] 请先安装 huggingface-hub: pip install huggingface-hub")
        sys.exit(1)

    # 国内用户自动走镜像
    if "HF_ENDPOINT" not in os.environ:
        os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
        print("[*] 使用国内镜像: hf-mirror.com")

    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    (TARGET_DIR / "onnx").mkdir(parents=True, exist_ok=True)

    print(f"[*] 下载最小文件集 (7 个文件, 约 155MB)")
    for rel_path in REQUIRED_FILES:
        local_path = TARGET_DIR / rel_path
        if local_path.exists() and local_path.stat().st_size > 0:
            print(f"  [OK] 已存在: {rel_path}")
            continue
        local_path.parent.mkdir(parents=True, exist_ok=True)
        print(f"  [..] 下载: {rel_path} ...")
        hf_hub_download(
            repo_id=MODEL_NAME,
            filename=rel_path,
            local_dir=str(TARGET_DIR),
            local_dir_use_symlinks=False,
        )
        sz = local_path.stat().st_size // 1024 // 1024
        print(f"      完成 ({sz} MB)")

    _cleanup()
    print(f"\n[OK] 模型下载完成 -> {TARGET_DIR}")
    print(f"     总大小: ~155 MB (仅运行时必需文件)")


def _cleanup():
    """删除 sentence-transformers / HF cache 等非必需文件"""
    removable = [
        ".cache", ".gitattributes", "README.md",
        "config_sentence_transformers.json", "modules.json",
        "sentence_bert_config.json", "1_Pooling",
    ]
    count = 0
    for name in removable:
        path = TARGET_DIR / name
        if path.is_dir():
            shutil.rmtree(path)
            count += 1
        elif path.exists():
            path.unlink()
            count += 1
    if count:
        print(f"  [..] 已清理 {count} 个非必需文件")


if __name__ == "__main__":
    download()
