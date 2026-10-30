"""Trim only known non-inference files from the bundled IndexTTS runtime."""
import argparse
import hashlib

from deployment import ROOT, child, installation_error, model_directory, source_directory


def removable_files(root=ROOT):
    bundle = (root / 'runtime').resolve()
    # The adapter disables DeepSpeed and custom CUDA kernels. Keep every DLL,
    # but omit static/import libraries used only when compiling extensions.
    library = source_directory(root, '2.0') / '.venv/Lib/site-packages/torch/lib'
    candidates = list(library.glob('*.lib'))
    candidates.append(root / 'runtime/tools/ffmpeg/bin/ffplay.exe')
    models = model_directory(root, '2.0')
    duplicate = models / 'hf_cache/semantic_codec/model.safetensors'
    canonical = models / 'hf_cache/semantic_codec_model.safetensors'
    for path in (duplicate, canonical):
        child(bundle, path.absolute().relative_to(bundle))
    if duplicate.is_file() and canonical.is_file() and duplicate.stat().st_size == canonical.stat().st_size:
        def digest(path):
            with path.open('rb') as stream:
                return hashlib.file_digest(stream, 'sha256').digest()
        if digest(duplicate) == digest(canonical):
            candidates.append(duplicate)
    result = []
    for path in candidates:
        # Resolve and check every target before either packaging or deletion;
        # reject symlinks/junctions that lead outside this specific runtime.
        child(bundle, path.absolute().relative_to(bundle))
        if path.is_file():
            result.append(path)
    return result


def compact_runtime(root=ROOT, *, apply=False):
    error = installation_error(root, '2.0')
    if error:
        raise ValueError(error)
    files = removable_files(root)
    total = sum(path.stat().st_size for path in files)
    for path in files:
        print(path.relative_to(root).as_posix())
    if apply:
        for path in files:
            child(root / 'runtime', path.relative_to(root / 'runtime'))
            path.unlink()
    print(f"{'Removed' if apply else 'Removable'}: {len(files)} files, {total / 1024 ** 3:.3f} GiB")
    return total


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Delete the listed non-inference files; default is preview only')
    compact_runtime(apply=parser.parse_args().apply)
