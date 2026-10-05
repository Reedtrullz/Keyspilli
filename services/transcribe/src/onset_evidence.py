#!/usr/bin/env python3
"""Offline spectral onset estimates and portable Gemini evidence, never note truth."""
import argparse
import hashlib
import io
import json
import os
import re
import stat
import sys
import time
import wave
from pathlib import Path

CONFIG = {
    'method': 'librosa-spectral-flux', 'sampleRate': 22050,
    'hopLength': 256, 'delta': .07, 'backtrack': True,
    'resampling': 'soxr_hq', 'maxOnsets': 256,
}
LIMITATIONS = [
    'Spectral onset times/counts are estimates, not independently verified key strikes.',
    'A chord can have several notes at one onset; this is not per-note transcription.',
    'No acoustic pitch, source correctness, musical acceptance or repair authority is established.',
    'Evaluation covers short synthetic clips from one sampled Player piano bank only.',
]


def digest(value):
    return hashlib.sha256(value).hexdigest()


def decode(path, expected_sha):
    if not path.is_absolute() or not re.fullmatch('[0-9a-f]{64}', expected_sha):
        raise ValueError('absolute audio path and lowercase SHA256 required')
    with path.open('rb') as handle:
        before = os.fstat(handle.fileno())
        if not stat.S_ISREG(before.st_mode) or not 44 <= before.st_size <= 2 * 1024 * 1024:
            raise ValueError('audio must be a regular WAV of at most2MiB')
        raw = handle.read(before.st_size + 1)
        after = os.fstat(handle.fileno())
    identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    if identity(before) != identity(after) or len(raw) != before.st_size:
        raise ValueError('audio changed while reading')
    if digest(raw) != expected_sha:
        raise ValueError('audio hash pin changed')
    try:
        with wave.open(io.BytesIO(raw), 'rb') as handle:
            rate, frames = handle.getframerate(), handle.getnframes()
            if (handle.getnchannels() != 1 or handle.getsampwidth() != 2 or
                    handle.getcomptype() != 'NONE' or rate not in (32000, 44100) or
                    not 0 < frames / rate <= 30):
                raise ValueError('requires mono PCM16 WAV at32/44.1kHz, up to30seconds')
            pcm = handle.readframes(frames)
            if len(pcm) != frames * 2:
                raise ValueError('truncated PCM samples')
    except (wave.Error, EOFError) as exc:
        raise ValueError('invalid PCM WAV') from exc
    if not any(pcm):
        raise ValueError('digital silence; no acoustic onset review')
    return pcm, {'sha256': expected_sha, 'bytes': len(raw), 'sampleRate': rate,
                 'channels': 1, 'frames': frames, 'durationSeconds': frames / rate}


def analyze(path, expected_sha):
    started = time.monotonic()
    # Refuse absent/stale/malformed input before optional dependencies are imported.
    pcm, audio = decode(path, expected_sha)
    import librosa
    import numpy as np
    if librosa.__version__ != '0.10.2.post1':
        raise ValueError('use the pinned optional onset environment (librosa0.10.2.post1)')
    samples = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768
    samples = librosa.resample(samples, orig_sr=audio['sampleRate'],
                              target_sr=CONFIG['sampleRate'], res_type=CONFIG['resampling'])
    onsets = librosa.onset.onset_detect(y=samples, sr=CONFIG['sampleRate'],
        hop_length=CONFIG['hopLength'], delta=CONFIG['delta'],
        backtrack=CONFIG['backtrack'], units='time').tolist()
    if len(onsets) > CONFIG['maxOnsets'] or any(not 0 <= t < audio['durationSeconds'] for t in onsets):
        raise ValueError('onset estimates exceed clip/time bounds')
    analysis = {**CONFIG, 'librosaVersion': librosa.__version__,
                'codeSha256': digest(Path(__file__).read_bytes())}
    config_sha = digest(json.dumps(analysis, sort_keys=True, separators=(',', ':')).encode())
    receipt = {'schemaVersion': 1, 'kind': 'keyspilli-onset-evidence', 'audio': audio,
               'onsetEstimateSeconds': onsets, 'analysis': analysis,
               'analysisConfigSha256': config_sha, 'elapsedSeconds': time.monotonic() - started,
               'acousticPitch': None, 'providerCalls': 0, 'calibrated': False,
               'musicalAcceptance': 'not-established', 'limitations': LIMITATIONS}
    bundle = {'schemaVersion': 1, 'kind': 'anti-music-evidence',
              'clips': [{'id': 'A', 'sha256': expected_sha, 'durationSeconds': audio['durationSeconds']}],
              'claims': [{'id': 'spectral-onsets', 'clipId': 'A', 'startSeconds': 0,
                          'endSeconds': audio['durationSeconds'], 'origin': 'measurement',
                          'text': f'Spectral onset estimate: {len(onsets)} energy/spectral transients '
                                  f'at clip-local seconds {json.dumps(onsets)}. '
                                  f'Analysis configuration SHA256: {config_sha}.',
                          'uncertainty': LIMITATIONS[0]}],
              'context': {'sourceAuthority': 'unknown', 'allowedDifferences': []},
              'limitations': LIMITATIONS}
    return receipt, bundle


def write_report(path, expected_sha, output):
    if output.exists():
        raise FileExistsError('output directory already exists')
    receipt, bundle = analyze(path, expected_sha)
    output.mkdir(mode=0o700)
    for name, value in [('receipt.json', receipt), ('anti-evidence.json', bundle)]:
        with (output / name).open('x') as handle:
            os.chmod(handle.name, 0o600)
            json.dump(value, handle, indent=2, allow_nan=False)
            handle.write('\n')
    return receipt, bundle


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('audio', type=Path)
    parser.add_argument('sha256')
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    if not args.output.is_absolute():
        raise ValueError('absolute output directory required')
    def offline(event, _args):
        if event in ('socket.connect', 'socket.getaddrinfo', 'socket.bind'):
            raise RuntimeError('onset evidence is offline-only')
    sys.addaudithook(offline)
    receipt, _ = write_report(args.audio, args.sha256, args.output)
    print(json.dumps({'receipt': str(args.output / 'receipt.json'),
                      'antiEvidence': str(args.output / 'anti-evidence.json'),
                      'onsetEstimates': len(receipt['onsetEstimateSeconds']),
                      'providerCalls': 0, 'musicalAcceptance': 'not-established'}))


if __name__ == '__main__':
    main()
