"""
下载 Jina v2 base zh ONNX 模型
来源: HuggingFace — Xenova/jina-embeddings-v2-base-zh

运行: python download_model.py
"""

import os
import sys
from pathlib import Path

MODEL_NAME = "Xenova/jina-embeddings-v2-base-zh"
TARGET_DIR = Path(__file__).parent / "models" / "jina-embeddings-v2-base-zh"


def download_with_huggingface_hub():
    """使用 huggingface_hub 下载（推荐，支持断点续传）"""
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print("请先安装 huggingface_hub: pip install huggingface_hub")
        sys.exit(1)

    print(f"下载 {MODEL_NAME} → {TARGET_DIR}")
    TARGET_DIR.mkdir(parents=True, exist_ok=True)

    snapshot_download(
        repo_id=MODEL_NAME,
        local_dir=str(TARGET_DIR),
        local_dir_use_symlinks=False,
        ignore_patterns=["*.bin", "*.safetensors", "*.msgpack"],
    )
    print("下载完成!")


def download_with_git_lfs():
    """使用 git-lfs 下载"""
    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    url = f"https://huggingface.co/{MODEL_NAME}"

    print(f"克隆 {url} → {TARGET_DIR}")
    os.system(f'git lfs install')
    os.system(f'git clone {url} "{TARGET_DIR}" --depth 1')
    print("下载完成!")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "hub"
    if mode == "git":
        download_with_git_lfs()
    else:
        download_with_huggingface_hub()
