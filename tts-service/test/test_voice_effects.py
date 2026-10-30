import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from voice_effects import voice_effects, effect_filter, adjust_voice

FFMPEG = ROOT / 'runtime/tools/ffmpeg/bin/ffmpeg.exe'


class VoiceEffectsTests(unittest.TestCase):
    def test_validation_rejects_invalid_values_including_boolean_and_unknown_fields(self):
        self.assertEqual(voice_effects(), {'pitch': 0, 'resonance': 0, 'brightness': 0, 'thickness': 0, 'clarity': 0, 'air': 0})
        for value in ([], '', {'pitch': True}, {'pitch': float('nan')}, {'pitch': 4.01}, {'resonance': -16}, {'brightness': 7}, {'thickness': 7}, {'clarity': True}, {'air': float('nan')}, {'unknown': 1}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                voice_effects(value)

    def test_failed_processing_keeps_original_and_cleans_partial_output(self):
        import subprocess
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.wav'; source.write_bytes(b'original')
            with patch('voice_effects.subprocess.run', side_effect=subprocess.CalledProcessError(1, [], stderr=b'bad filter')):
                with self.assertRaisesRegex(RuntimeError, 'bad filter'):
                    adjust_voice(source, {'pitch': 1})
            self.assertEqual(source.read_bytes(), b'original')
            self.assertFalse(source.with_name('source.effects.wav').exists())

    @unittest.skipUnless(FFMPEG.is_file() and importlib.util.find_spec('numpy') and importlib.util.find_spec('soundfile'), 'requires bundled audio runtime')
    def test_real_audio_pitch_resonance_and_speed_remain_independent(self):
        import numpy as np
        import soundfile as sf
        sr = 24000
        time = np.arange(sr * 2) / sr
        signal = .2 * np.sin(2 * np.pi * 200 * time)
        with tempfile.TemporaryDirectory(prefix='音色处理 ') as directory:
            for effects, speed in [({'pitch': 3}, 1), ({'resonance': 12}, 1), ({'pitch': -3, 'resonance': -10, 'brightness': 3}, 1.25), ({'brightness': -6}, .8)]:
                with self.subTest(effects=effects, speed=speed):
                    source = Path(directory) / 'audio.wav'; sf.write(source, signal, sr)
                    adjust_voice(source, effects, speed, tool=FFMPEG)
                    result, actual_sr = sf.read(source)
                    self.assertEqual(actual_sr, sr)
                    self.assertAlmostEqual(len(result) / sr, 2 / speed, delta=.07)
                    middle = result[int(.2 * sr):-int(.2 * sr)]
                    spectrum = abs(np.fft.rfft(middle * np.hanning(len(middle))))
                    peak = np.argmax(spectrum) * sr / len(middle)
                    self.assertAlmostEqual(peak, 200 * 2 ** (effects.get('pitch', 0) / 12), delta=3)
                    self.assertLessEqual(np.max(abs(result)), .951)
                    self.assertGreater(np.std(result), .005)

    def test_filter_keeps_formants_when_correcting_pitch_and_duration(self):
        self.assertIn('formant=preserved', effect_filter({'resonance': 10}))
        for speed in (False, 0, float('inf'), 3):
            with self.assertRaises(ValueError): effect_filter({}, speed)

    @unittest.skipUnless(FFMPEG.is_file() and importlib.util.find_spec('numpy') and importlib.util.find_spec('soundfile'), 'requires bundled audio runtime')
    def test_new_equalizers_change_their_frequency_bands_without_changing_duration(self):
        import numpy as np
        import soundfile as sf
        sr = 24000
        time = np.arange(sr * 2) / sr
        frequencies = [80, 900, 2800, 10000]
        signal = sum(.035 * np.sin(2 * np.pi * hz * time) for hz in frequencies)
        with tempfile.TemporaryDirectory(prefix='音色均衡 ') as directory:
            for control, frequency in [('thickness', 80), ('clarity', 2800), ('air', 10000)]:
                for gain in (-4, 4):
                    with self.subTest(control=control, gain=gain):
                        source = Path(directory) / 'equalizer.wav'; sf.write(source, signal, sr)
                        adjust_voice(source, {control: gain}, tool=FFMPEG)
                        result, actual_sr = sf.read(source)
                        self.assertEqual(actual_sr, sr)
                        self.assertAlmostEqual(len(result) / sr, 2, delta=.01)
                        middle = result[sr // 2:-sr // 2]
                        spectrum = abs(np.fft.rfft(middle * np.hanning(len(middle))))
                        contrast = 20 * np.log10(spectrum[round(frequency * len(middle) / sr)] / spectrum[round(900 * len(middle) / sr)])
                        self.assertGreater(contrast * (1 if gain > 0 else -1), 2)
                        self.assertTrue(np.all(np.isfinite(result)))
                        self.assertLessEqual(np.max(abs(result)), .951)

    @unittest.skipUnless(FFMPEG.is_file() and importlib.util.find_spec('numpy') and importlib.util.find_spec('soundfile'), 'requires bundled audio runtime')
    def test_resonance_moves_spectral_envelope_without_moving_the_harmonic_grid(self):
        import numpy as np
        import soundfile as sf
        sr = 24000
        time = np.arange(sr * 3) / sr
        source_audio = sum(np.exp(-((h * 100 - 900) / 150) ** 2) * np.sin(2 * np.pi * h * 100 * time) for h in range(1, 45)) * .05
        with tempfile.TemporaryDirectory() as directory:
            for resonance in (-12, 12):
                source = Path(directory) / 'formants.wav'; sf.write(source, source_audio, sr)
                adjust_voice(source, {'resonance': resonance}, tool=FFMPEG)
                result, _ = sf.read(source); middle = result[sr // 2:-sr // 2]
                spectrum = abs(np.fft.rfft(middle * np.hanning(len(middle))))
                peak = np.argmax(spectrum) * sr / len(middle)
                self.assertAlmostEqual(peak, 900 * (1 + resonance / 100), delta=40)
                self.assertAlmostEqual(peak, round(peak / 100) * 100, delta=2)


if __name__ == '__main__':
    unittest.main()
