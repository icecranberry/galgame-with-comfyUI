"""Download all models into the same layout consumed by offline bundles."""
import os
from pathlib import Path
from deployment import read_json, seal_models

HERE = Path(__file__).resolve().parent


def download_models(root=HERE):
    # Set paths before importing huggingface_hub (it reads environment at import).
    os.environ['HF_HOME'] = str(root / 'cache/huggingface')
    os.environ['HF_HUB_CACHE'] = str(root / 'cache/huggingface/hub')
    os.environ['HF_XET_CACHE'] = str(root / 'cache/huggingface/xet')
    os.environ['HF_HUB_OFFLINE'] = '0'
    from huggingface_hub import hf_hub_download, snapshot_download

    versions = read_json(root / 'versions.json')
    target = root / 'runtime/checkpoints'
    snapshot_download(repo_id=versions['model_repo'], revision=versions['model_revision'], local_dir=target)
    # Pre-download auxiliaries: first speech must never need the network.
    aux = target / 'hf_cache'
    snapshot_download(repo_id='facebook/w2v-bert-2.0', local_dir=aux / 'w2v-bert-2.0',
                      allow_patterns=['*.json', '*.safetensors'])
    hf_hub_download(repo_id='funasr/campplus', filename='campplus_cn_common.bin', local_dir=aux)
    for filename in ('config.json', 'bigvgan_generator.pt'):
        hf_hub_download(repo_id='nvidia/bigvgan_v2_22khz_80band_256x', filename=filename,
                        local_dir=aux / 'bigvgan')
    seal_models(root)


if __name__ == '__main__':
    download_models()
