"""Download the locked model snapshot, then record the successful revision."""
import json
import os
from pathlib import Path
from huggingface_hub import hf_hub_download, snapshot_download

here = Path(__file__).resolve().parent
versions = json.loads((here / "versions.json").read_text(encoding="utf-8"))
target = Path(os.environ.get("TTS_MODEL_DIR", here / "checkpoints")).resolve()
snapshot_download(repo_id=versions["model_repo"], revision=versions["model_revision"], local_dir=target)
# Fetch dependencies before starting the bounded GPU worker. A first-run network
# download must not consume the worker's model-loading timeout.
aux = target / "hf_cache"
snapshot_download(repo_id="facebook/w2v-bert-2.0", local_dir=aux / "w2v-bert-2.0",
                  allow_patterns=["*.json", "*.safetensors"])
hf_hub_download(repo_id="funasr/campplus", filename="campplus_cn_common.bin", local_dir=aux)
for filename in ("config.json", "bigvgan_generator.pt"):
    hf_hub_download(repo_id="nvidia/bigvgan_v2_22khz_80band_256x", filename=filename,
                    local_dir=aux / "bigvgan")
(target / "linshe-model-version.json").write_text(json.dumps(versions), encoding="utf-8")
