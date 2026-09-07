"""Run with the worker Python: python -m unittest discover -s services/transcribe/test -p 'test_*.py'."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

import numpy as np
import soundfile as sf

spec = importlib.util.spec_from_file_location('separate_stems', Path(__file__).parents[1] / 'src/separate_stems.py')
separator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(separator)


class SeparationTest(unittest.TestCase):
    def test_piano_reaches_residual_without_clipping_or_timing_change(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            audio = root / 'input.wav'
            audio.touch()
            output = root / 'out'
            track = output / 'htdemucs_6s' / 'input'
            track.mkdir(parents=True)
            # Over one processing block, with a silent lead-in and summed peaks >1.
            residual = np.zeros((70000, 2), dtype=np.float32)
            piano = residual.copy()
            residual[32000:33000] = .75
            piano[32000:33000] = .5
            piano[68000:69000] = .25
            for role in ('vocals', 'bass', 'drums', 'guitar', 'other', 'piano'):
                sf.write(track / f'{role}.wav', piano if role == 'piano' else residual, 22050, subtype='FLOAT')
            demucs = types.ModuleType('demucs.separate')
            demucs.main = lambda args: None
            def invoke():
                stdout = io.StringIO()
                with patch.dict('sys.modules', {'demucs': types.ModuleType('demucs'), 'demucs.separate': demucs}), patch.object(separator, 'parse_args', return_value=types.SimpleNamespace(input=str(audio), output=str(output), model='htdemucs_6s', device='cpu')), patch.object(separator.importlib.metadata, 'version', return_value='test'), contextlib.redirect_stdout(stdout):
                    separator.main()
                return json.loads(stdout.getvalue().split('KEYSPILLI_STEMS_JSON:')[1])

            report = invoke()
            samples, rate = sf.read(report['stems']['other'])
            self.assertEqual(rate, 22050)
            np.testing.assert_allclose(samples, residual + piano)
            # Original separator output stays intact for diagnostics.
            original, _ = sf.read(track / 'other.wav')
            np.testing.assert_allclose(original, residual)

            for frames, channels, rate in ((69999, 2, 22050), (70000, 1, 22050), (70000, 2, 44100)):
                with self.subTest(frames=frames, channels=channels, rate=rate):
                    sf.write(track / 'piano.wav', np.zeros((frames, channels)), rate, subtype='FLOAT')
                    with self.assertRaisesRegex(RuntimeError, 'mismatched audio timelines'):
                        invoke()
            (track / 'piano.wav').unlink()
            (track / 'guitar.wav').unlink()
            four_stem = invoke()
            self.assertNotIn('guitar', four_stem['stems'])
            self.assertEqual(Path(four_stem['stems']['other']), (track / 'other.wav').resolve())


if __name__ == '__main__':
    unittest.main()
