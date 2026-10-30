"""Deterministic CPU voice adjustments using the bundled FFmpeg/Rubber Band.

Resample by q to shift the spectral envelope, then undo q's pitch/time change
with formant-preserving Rubber Band. Pitch and resonance remain independent.
"""
import math
import os
from pathlib import Path
import subprocess

DEFAULTS = {"pitch": 0, "resonance": 0, "brightness": 0, "thickness": 0, "clarity": 0, "air": 0}
LIMITS = {"pitch": 4, "resonance": 15, "brightness": 6, "thickness": 6, "clarity": 6, "air": 6}


def voice_effects(value=None):
    if value is None:
        return dict(DEFAULTS)
    if not isinstance(value, dict) or set(value) - set(DEFAULTS):
        raise ValueError("Invalid voice effects")
    result = DEFAULTS | value
    for key, number in result.items():
        if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number) or abs(number) > LIMITS[key]:
            raise ValueError(f"Invalid voice effect: {key}")
    return result


def effect_filter(effects, speed=1):
    effects = voice_effects(effects)
    if isinstance(speed, bool) or not isinstance(speed, (int, float)) or not math.isfinite(speed) or not 0.5 <= speed <= 2:
        raise ValueError("Invalid voice speed")
    pitch = 2 ** (effects["pitch"] / 12)
    resonance = 1 + effects["resonance"] / 100
    filters = ["aresample=24000"]
    if resonance != 1:
        # Account for the integer sample rate so duration/pitch stay accurate.
        rate = round(24000 * resonance)
        resonance = rate / 24000
        filters += [f"asetrate={rate}", "aresample=24000"]
    if pitch != 1 or resonance != 1:
        filters.append(f"rubberband=tempo={speed / resonance:.9f}:pitch={pitch / resonance:.9f}:formant=preserved:pitchq=quality:window=standard:transients=crisp:detector=compound")
    elif speed != 1:
        filters.append(f"atempo={speed:.9f}")
    brightness = effects["brightness"]
    headroom = abs(brightness) + sum(max(0, effects[key]) for key in ("thickness", "clarity", "air"))
    if headroom:
        filters.append(f"volume={-headroom:.6f}dB")
    if brightness:
        filters += [f"bass=g={-brightness / 2:.6f}:f=250", f"treble=g={brightness:.6f}:f=3000"]
    if effects["thickness"]:
        filters.append(f"bass=g={effects['thickness']:.6f}:f=180:t=s:w=1")
    if effects["clarity"]:
        filters.append(f"equalizer=g={effects['clarity']:.6f}:f=2800:t=q:w=0.9")
    if effects["air"]:
        filters.append(f"treble=g={effects['air']:.6f}:f=8000:t=s:w=1")
    filters.append("alimiter=limit=0.95:level=false:latency=true")
    return ",".join(filters)


def adjust_voice(file, effects, speed=1, tool=None):
    file = Path(file)
    adjusted = file.with_name(file.stem + ".effects.wav")
    tool = tool or Path(__file__).resolve().parent / "runtime/tools/ffmpeg/bin/ffmpeg.exe"
    try:
        subprocess.run([str(tool), "-nostdin", "-y", "-v", "error", "-i", str(file),
                        "-af", effect_filter(effects, speed), "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", str(adjusted)],
                       check=True, timeout=120, capture_output=True,
                       **({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}))
        adjusted.replace(file)
    except subprocess.CalledProcessError as error:
        detail = error.stderr.decode("utf-8", errors="replace")
        if "rubberband" in detail.lower() and ("no such filter" in detail.lower() or "not found" in detail.lower()):
            raise RuntimeError("当前 FFmpeg 缺少变声组件，请安装包含 rubberband 的 FFmpeg，并恢复到语音运行目录。") from error
        raise RuntimeError(f"音色处理失败：{detail[-800:]}") from error
    finally:
        adjusted.unlink(missing_ok=True)
