#!/usr/bin/env python3
"""Offline monophonic pitch estimates and explicit scale-membership evidence."""
import argparse
import json
import math
import os
import statistics
import sys
import time
from pathlib import Path

import onset_evidence

CONFIG = {
    'method': 'librosa-pyin', 'sampleRate': 22050, 'hopLength': 256,
    'frameLength': 2048, 'fminHz': 65.406391, 'fmaxHz': 2093.004522,
    'windowStartAfterOnsetSeconds': .08, 'windowEndAfterOnsetSeconds': .28,
    'minimumVoicedProbability': .8, 'minimumRmsDbfs': -50,
    'minimumAcceptedFrames': 6, 'maximumSpreadSemitones': .35,
    'maximumCentsFromNearestMidi': 35, 'maximumOnsets': 60,
    'resampling': 'soxr_hq', 'center': True,
}
LIMITATIONS = [
    'Requires caller-asserted monophonic audio; texture is not detected or verified.',
    'Overlapping piano tails, chords, pedal, reverb and other sources can invalidate single-F0 estimates.',
    'Voiced probability measures periodicity, not calibrated pitch accuracy; octave errors remain possible.',
    'Scale membership uses supplied pitch classes only; it does not identify the key, prove a wrong note or authorize repair.',
    'Short post-onset windows estimate pitch presence, not note releases or complete transcription.',
    'Source correctness, independent Gemini hearing and musical acceptance remain unestablished.',
]


def validate_scale(scale):
    if scale is not None and (not isinstance(scale, list) or not 1 <= len(scale) <= 12 or
            any(type(x) is not int or not 0 <= x <= 11 for x in scale) or len(set(scale)) != len(scale)):
        raise ValueError('scale must contain unique integer pitch classes 0..11')
    return None if scale is None else sorted(scale)


def summarize(midis, voiced, probabilities, levels):
    accepted = [m for m, v, p, level in zip(midis, voiced, probabilities, levels)
                if v and math.isfinite(m) and p >= CONFIG['minimumVoicedProbability']
                and level >= CONFIG['minimumRmsDbfs']]
    median = statistics.median(accepted) if accepted else None
    spread = max(accepted) - min(accepted) if accepted else None
    cents = (median - round(median)) * 100 if median is not None else None
    stable = (len(accepted) >= CONFIG['minimumAcceptedFrames'] and
              spread <= CONFIG['maximumSpreadSemitones'] and
              abs(cents) <= CONFIG['maximumCentsFromNearestMidi'])
    midi = round(median) if stable else None
    return {'status': 'estimated' if stable else 'uncertain',
            'midiEstimate': midi, 'pitchClassEstimate': None if midi is None else midi % 12,
            'medianMidiFloat': median, 'centsFromNearestMidi': cents,
            'spreadSemitones': spread, 'acceptedFrames': len(accepted), 'frames': len(midis)}


def analyze(path, expected_sha, *, texture='unknown', scale=None):
    started = time.monotonic()
    if texture != 'monophonic':
        raise ValueError('explicit monophonic texture assertion required; chords/unknown texture unsupported')
    scale = validate_scale(scale)
    onset_receipt, bundle = onset_evidence.analyze(path, expected_sha)
    onsets = onset_receipt['onsetEstimateSeconds']
    if len(onsets) > CONFIG['maximumOnsets']:
        raise ValueError('pitch evidence supports at most60 estimated onsets per clip')
    pcm, audio = onset_evidence.decode(path, expected_sha)
    import librosa
    import numpy as np
    samples = librosa.resample(np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768,
        orig_sr=audio['sampleRate'], target_sr=CONFIG['sampleRate'], res_type=CONFIG['resampling'])
    f0, voiced, probabilities = librosa.pyin(samples, sr=CONFIG['sampleRate'],
        fmin=CONFIG['fminHz'], fmax=CONFIG['fmaxHz'], frame_length=CONFIG['frameLength'],
        hop_length=CONFIG['hopLength'], center=CONFIG['center'])
    rms = librosa.feature.rms(y=samples, frame_length=CONFIG['frameLength'],
        hop_length=CONFIG['hopLength'], center=CONFIG['center'])[0]
    levels = 20 * np.log10(np.maximum(rms, 1e-12))
    times = np.arange(len(f0)) * CONFIG['hopLength'] / CONFIG['sampleRate']
    midis = librosa.hz_to_midi(f0)
    windows = []
    # The scope is asserted by the caller, never inferred from a successful F0 track.
    for index, onset in enumerate(onsets):
        start = min(onset + CONFIG['windowStartAfterOnsetSeconds'], audio['durationSeconds'])
        end = min(onset + CONFIG['windowEndAfterOnsetSeconds'], audio['durationSeconds'],
                  onsets[index + 1] if index + 1 < len(onsets) else audio['durationSeconds'])
        end = max(start, end)
        mask = (times >= start) & (times < end)
        row = summarize(midis[mask].tolist(), voiced[mask].tolist(),
                        probabilities[mask].tolist(), levels[mask].tolist())
        pc = row['pitchClassEstimate']
        row.update(onsetEstimateSeconds=onset, startSeconds=start, endSeconds=end,
                   inSuppliedScale=None if pc is None or scale is None else pc in scale)
        windows.append(row)
    analysis = {**CONFIG, 'librosaVersion': librosa.__version__,
                'codeSha256': onset_evidence.digest(Path(__file__).read_bytes()),
                'onsetAnalysisConfigSha256': onset_receipt['analysisConfigSha256']}
    config_sha = onset_evidence.digest(json.dumps(analysis, sort_keys=True, separators=(',', ':')).encode())
    receipt = {'schemaVersion': 1, 'kind': 'keyspilli-pitch-evidence', 'audio': audio,
               'texture': {'value': texture, 'origin': 'caller-asserted', 'verified': False},
               'suppliedScalePitchClasses': scale, 'windows': windows, 'analysis': analysis,
               'analysisConfigSha256': config_sha, 'onsetReceipt': onset_receipt,
               'track': [{'timeSeconds': float(t), 'f0Hz': float(f) if math.isfinite(f) else None,
                          'voiced': bool(v), 'voicedProbability': float(p), 'rmsDbfs': float(level)}
                         for t, f, v, p, level in zip(times, f0, voiced, probabilities, levels)
                         if t < audio['durationSeconds']],
               'providerCalls': 0, 'calibrated': False, 'musicalAcceptance': 'not-established',
               'elapsedSeconds': time.monotonic() - started, 'limitations': LIMITATIONS}
    def claim(ident, text, origin='authored', start=0, end=audio['durationSeconds']):
        return {'id': ident, 'clipId': 'A', 'startSeconds': start, 'endSeconds': end,
                'text': text, 'origin': origin, 'uncertainty': ' '.join(LIMITATIONS[:4])}
    bundle['claims'].append(claim('asserted-texture', 'Caller asserts a monophonic clip; this assumption is unverified.'))
    if scale is not None:
        bundle['claims'].append(claim('supplied-scale', f'Caller-supplied scale pitch classes (C=0): {scale}. No key inferred.'))
    for index, row in enumerate(windows):
        presentation = {k: round(v, 6) if type(v) is float else v for k, v in row.items()}
        bundle['claims'].append(claim(f'pitch-{index}',
            f'Monophonic pitch window estimate: {json.dumps(presentation, allow_nan=False)}. '
            f'Analysis configuration SHA256: {config_sha}.', 'measurement', row['startSeconds'], row['endSeconds']))
    bundle['limitations'] = LIMITATIONS
    if len(json.dumps(bundle, ensure_ascii=True).encode()) > 65536:
        raise ValueError('portable pitch evidence exceeds64KiB')
    return receipt, bundle


def write_report(path, expected_sha, output, **options):
    if not output.is_absolute():
        raise ValueError('absolute output directory required')
    if output.exists():
        raise FileExistsError('output directory already exists')
    receipt, bundle = analyze(path, expected_sha, **options)
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
    parser.add_argument('--texture', choices=['unknown', 'monophonic', 'polyphonic'], default='unknown')
    parser.add_argument('--scale-pitch-classes', help='Explicit comma-separated integers0..11; no inferred key')
    args = parser.parse_args()
    def offline(event, _args):
        if event in ('socket.connect', 'socket.getaddrinfo', 'socket.bind'):
            raise RuntimeError('pitch evidence is offline-only')
    sys.addaudithook(offline)
    scale = None if args.scale_pitch_classes is None else [int(x) for x in args.scale_pitch_classes.split(',')]
    receipt, _ = write_report(args.audio, args.sha256, args.output, texture=args.texture, scale=scale)
    print(json.dumps({'receipt': str(args.output / 'receipt.json'),
                      'antiEvidence': str(args.output / 'anti-evidence.json'),
                      'estimatedWindows': sum(x['status'] == 'estimated' for x in receipt['windows']),
                      'uncertainWindows': sum(x['status'] == 'uncertain' for x in receipt['windows']),
                      'providerCalls': 0, 'musicalAcceptance': 'not-established'}))


if __name__ == '__main__':
    main()
