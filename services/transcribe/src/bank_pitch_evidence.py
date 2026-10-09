#!/usr/bin/env python3
"""Offline, bank-informed pitch-set evidence for one selected128ms window."""
import argparse
import hashlib
import json
import math
import os
import re
import stat
import sys
import time
from pathlib import Path

import onset_evidence
import renderer_verification

CONFIG = {'method': 'bank-template-nnls', 'analysisSampleRate': 16000,
          'windowSeconds': .128, 'activityThreshold': .25, 'maximumResidualRatio': .25,
          'minimumRmsDbfs': -50, 'maximumTemplates': 88, 'resampling': 'soxr-HQ'}
REPORTING = {'minimumWeakCoefficient': .04, 'maximumPortableWeakCandidates': 12}
HISTORY = {'anchorOffsetSeconds': .03, 'maximumLookbackSeconds': 1.2,
           'maximumPriorWindows': 8, 'windowSeconds': .128, 'futureFitWindowsAllowed': False}
HISTORY_LIMITATION = ('Earlier detections can share harmonic errors and do not establish current presence, '
                      'note duration, releases or repeated attacks. Onsets scan the full clip; this is not causal online tracking.')
LIMITATIONS = [
    'Renderer-informed evidence; shared bank/renderer can share defects. Not independent source truth.',
    'Bank provenance and template MIDI labels are caller assertions; hashes verify bytes, not those assertions.',
    'One128ms window estimates pitch presence only; releases, re-attacks, pedal and complete transcription are not established.',
    'Coefficients and spectral residual are uncalibrated fit statistics, not pitch confidence or proof of a correct chord.',
    'Pitch-set completeness and acoustic absence remain unknown. Below-threshold candidates can be harmonics or fit artifacts, not recovered notes.',
    'Unknown banks, timbres, velocity layers, out-of-inventory pitches and overlapping harmonics can invalidate estimates.',
    'Source correctness, independent Gemini hearing, repair authority and musical acceptance remain unestablished.',
]


def pin_path(pin):
    path = Path(pin['path'])
    if not path.is_absolute() or not re.fullmatch('[0-9a-f]{64}', pin['sha256']):
        raise ValueError('absolute path and lowercase hash required')
    return path


def verify_bank(pin):
    path = pin_path(pin)
    with path.open('rb') as f:
        before = os.fstat(f.fileno())
        if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= 64 * 1024 * 1024:
            raise ValueError('regular bank asset of at most64MiB required')
        raw = f.read(before.st_size + 1)
        after = os.fstat(f.fileno())
    identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    if identity(before) != identity(after) or len(raw) != before.st_size or hashlib.sha256(raw).hexdigest() != pin['sha256']:
        raise ValueError('changed bank bytes or hash')


def analyze(request):
    started = time.monotonic()
    bank, audio_pin, pins = request['bank'], request['audio'], request['templates']
    if not re.fullmatch('[0-9a-f]{64}', bank['sha256']) or audio_pin.get('bankSha256') != bank['sha256']:
        raise ValueError('unknown or mismatched audio bank assertion')
    renderer_verification.check_bank(bank['sha256'], pins)
    if not 1 <= len(pins) <= CONFIG['maximumTemplates'] or any(not 21 <= t['midi'] <= 108 for t in pins):
        raise ValueError('invalid piano template inventory')
    expected = request.get('expectedPitches')
    if expected is not None and (not isinstance(expected, list) or len(expected) > 88 or
            any(type(x) is not int or not 21 <= x <= 108 for x in expected) or len(set(expected)) != len(expected)):
        raise ValueError('invalid expected pitches')
    verify_bank(bank)
    pcm, audio = onset_evidence.decode(pin_path(audio_pin), audio_pin['sha256'])
    start, end = request['window']['startSeconds'], request['window']['endSeconds']
    if (any(type(v) not in (int, float) or not math.isfinite(v) for v in (start, end)) or
            not 0 <= start < end <= audio['durationSeconds'] or
            abs(end - start - CONFIG['windowSeconds']) > 1 / audio['sampleRate']):
        raise ValueError('selected window must be128ms within the pinned clip')
    decoded = []
    for pin in pins:
        data, meta = onset_evidence.decode(pin_path(pin), pin['sha256'])
        attack = pin['attackSeconds']
        if (type(attack) not in (int, float) or not math.isfinite(attack) or attack < 0 or
                attack + CONFIG['windowSeconds'] > meta['durationSeconds']):
            raise ValueError('template attack must leave a complete128ms window')
        decoded.append((pin['midi'], data, meta['sampleRate'], attack))
    import numpy as np
    import scipy
    import soxr
    if (np.__version__, scipy.__version__, soxr.__version__) != ('1.26.4', '1.13.1', '0.5.0.post1'):
        raise ValueError('use the pinned optional onset DSP environment')
    samples = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768
    offset = round(start * audio['sampleRate'])
    selected = samples[offset:offset + round(CONFIG['windowSeconds'] * audio['sampleRate'])]
    level = 20 * math.log10(max(float(np.sqrt(np.mean(selected ** 2))), 1e-12))
    fit = None
    if level >= CONFIG['minimumRmsDbfs']:
        templates = [(m, np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768, sr, attack)
                     for m, raw, sr, attack in decoded]
        fit = renderer_verification.fit_pitch_set(selected, audio['sampleRate'], templates, CONFIG['activityThreshold'])
    estimated = fit is not None and fit['residualRatio'] <= CONFIG['maximumResidualRatio']
    pitches = fit['pitches'] if estimated else None
    weak = None if not estimated else sorted(
        [row for row in fit['strengths'] if REPORTING['minimumWeakCoefficient'] <=
         row['relativeCoefficient'] < CONFIG['activityThreshold']],
        key=lambda row: (-row['relativeCoefficient'], row['midi']))
    searched = sorted(t['midi'] for t in pins)
    comparison = None
    if pitches is not None and expected is not None:
        target, detected, inventory = set(expected), set(pitches), set(searched)
        comparison = {'matchedPitches': sorted(target & detected), 'unexpectedPitches': sorted(detected - target),
                      'missingExpectedPitches': sorted((target & inventory) - detected),
                      'unsearchedExpectedPitches': sorted(target - inventory), 'absenceEstablished': False}
    analysis = {**CONFIG, 'weakCandidateReporting': REPORTING,
                'numpyVersion': np.__version__, 'scipyVersion': scipy.__version__,
                'soxrVersion': soxr.__version__, 'codeSha256': onset_evidence.digest(Path(__file__).read_bytes()),
                'rendererCodeSha256': onset_evidence.digest(Path(renderer_verification.__file__).read_bytes()),
                'decoderCodeSha256': onset_evidence.digest(Path(onset_evidence.__file__).read_bytes())}
    identity = {'analysis': analysis, 'bankSha256': bank['sha256'],
                'templates': [{k: t[k] for k in ('midi', 'sha256', 'bankSha256', 'attackSeconds')} for t in pins]}
    config_sha = onset_evidence.digest(json.dumps(identity, sort_keys=True, separators=(',', ':')).encode())
    receipt = {'schemaVersion': 1, 'kind': 'keyspilli-bank-pitch-evidence', 'audio': audio,
               'window': {'startSeconds': start, 'endSeconds': end}, 'windowRmsDbfs': level,
               'bankSha256': bank['sha256'], 'bankProvenanceVerified': False,
               'templatePins': pins, 'searchedPitches': searched, 'pitchSetEstimate': pitches, 'fit': fit,
               'pitchSetCompleteness': 'unknown', 'belowThresholdCandidates': weak,
               'expectedPitches': expected, 'comparison': comparison, 'analysis': analysis,
               'analysisConfigSha256': config_sha, 'origin': 'renderer-informed',
               'status': 'estimated' if estimated else 'uncertain', 'providerCalls': 0,
               'calibrated': False, 'musicalAcceptance': 'not-established', 'limitations': LIMITATIONS,
               'elapsedSeconds': time.monotonic() - started}
    def claim(ident, text, origin):
        return {'id': ident, 'clipId': 'A', 'startSeconds': start, 'endSeconds': end,
                'text': text, 'origin': origin, 'uncertainty': ' '.join(LIMITATIONS[:2])}
    text = json.dumps({'status': receipt['status'], 'pitchSetEstimate': pitches, 'comparison': comparison,
                       'pitchSetCompleteness': 'unknown',
                       'residualRatio': None if fit is None else round(fit['residualRatio'], 6)}, allow_nan=False)
    claims = [claim('asserted-bank', f'Caller asserts the WAV and labeled templates use bank SHA256 {bank["sha256"]}. '
                   f'Searched MIDI inventory: {searched}. Byte hashes do not verify provenance or labels.', 'authored'),
              claim('bank-pitch-set', f'Renderer-informed128ms pitch-set estimate: {text}. Configuration SHA256: {config_sha}.', 'measurement')]
    if weak:
        portable = [{'midi': row['midi'], 'relativeCoefficient': round(row['relativeCoefficient'], 6)}
                    for row in weak[:REPORTING['maximumPortableWeakCandidates']]]
        claims.append(claim('weak-pitch-candidates',
                            'Unresolved below-threshold spectral candidates, not selected pitches: ' +
                            json.dumps({'candidates': portable, 'omittedCount': len(weak) - len(portable)}, allow_nan=False) +
                            '. These can be overlapping harmonics or fit artifacts. Do not infer note presence, absence or repairs.',
                            'measurement'))
    if expected is not None:
        claims.append(claim('expected-pitch-set', f'Caller-supplied expected pitch set: {sorted(expected)}. This did not restrict spectral search.', 'authored'))
    bundle = {'schemaVersion': 1, 'kind': 'anti-music-evidence',
              'clips': [{'id': 'A', 'sha256': audio['sha256'], 'durationSeconds': audio['durationSeconds']}],
              'claims': claims, 'context': {'sourceAuthority': 'unknown', 'allowedDifferences': []},
              'limitations': LIMITATIONS}
    return receipt, bundle


def _prior_windows(onsets, rate, start):
    windows = []
    target_offset = round(start * rate)
    frames = round(HISTORY['windowSeconds'] * rate)
    for onset in onsets:
        offset = round((onset + HISTORY['anchorOffsetSeconds']) * rate)
        if (offset + frames > target_offset or (offset + frames) / rate > start or
                start - offset / rate > HISTORY['maximumLookbackSeconds']):
            continue
        windows.append({'onsetSeconds': onset, 'startSeconds': offset / rate,
                        'endSeconds': (offset + frames) / rate})
    if len(windows) > HISTORY['maximumPriorWindows']:
        raise ValueError('history window bound exceeded; no partial history output')
    return windows


def analyze_with_history(request):
    """Opt-in prior measurements; never union historical notes into the target set."""
    started = time.monotonic()
    receipt, bundle = analyze(request)
    audio_pin = request['audio']
    onsets, _ = onset_evidence.analyze(pin_path(audio_pin), audio_pin['sha256'])
    prior = _prior_windows(onsets['onsetEstimateSeconds'], receipt['audio']['sampleRate'],
                           receipt['window']['startSeconds'])
    windows = []
    for i, window in enumerate(prior):
        selected = {k: window[k] for k in ('startSeconds', 'endSeconds')}
        historical, _ = analyze({**request, 'window': selected, 'expectedPitches': None})
        ident = f'prior-window-{i}'
        windows.append({'id': ident, **window, 'status': historical['status'],
                        'pitchSetEstimate': historical['pitchSetEstimate'], 'fit': historical['fit'],
                        'windowRmsDbfs': historical['windowRmsDbfs'],
                        'analysisConfigSha256': historical['analysisConfigSha256']})
        stats = {'status': historical['status'], 'pitchSetEstimate': historical['pitchSetEstimate'],
                 'residualRatio': None if historical['fit'] is None else round(historical['fit']['residualRatio'], 6),
                 'pitchSetCompleteness': 'unknown'}
        bundle['claims'].append({'id': ident, 'clipId': 'A', **selected,
            'text': 'Earlier renderer-informed128ms fit: ' + json.dumps(stats, allow_nan=False) +
                    '. This is an earlier detection, not proof of current pitch presence.',
            'origin': 'measurement', 'uncertainty': HISTORY_LIMITATION})
    weak = receipt['belowThresholdCandidates']
    links = None if weak is None else [{'midi': row['midi'],
        'priorWindowIds': [w['id'] for w in windows if row['midi'] in (w['pitchSetEstimate'] or [])]}
        for row in weak]
    config = {**HISTORY, 'onsetAnalysisConfigSha256': onsets['analysisConfigSha256'],
              'parentAnalysisConfigSha256': receipt['analysisConfigSha256']}
    config_sha = onset_evidence.digest(json.dumps(config, sort_keys=True, separators=(',', ':')).encode())
    receipt['history'] = {'configuration': config, 'analysisConfigSha256': config_sha,
        'onsetEstimateSeconds': onsets['onsetEstimateSeconds'], 'windows': windows,
        'candidateLinks': links, 'pitchPresenceEstablished': False, 'limitation': HISTORY_LIMITATION}
    if links:
        portable = links[:REPORTING['maximumPortableWeakCandidates']]
        bundle['claims'].append({'id': 'candidate-history', 'clipId': 'A', **receipt['window'],
            'text': 'Unresolved current weak-candidate links to earlier fit claims: ' +
                    json.dumps({'candidateLinks': portable, 'omittedCount': len(links) - len(portable)}, allow_nan=False) +
                    f'. History configuration SHA256: {config_sha}. No current presence or absence is established.',
            'origin': 'measurement', 'uncertainty': HISTORY_LIMITATION})
    # Copy: the baseline globals and default profile must not acquire history limitations.
    receipt['limitations'] = [*receipt['limitations'], HISTORY_LIMITATION]
    bundle['limitations'] = [*bundle['limitations'], HISTORY_LIMITATION]
    receipt['elapsedSeconds'] = time.monotonic() - started
    return receipt, bundle


def write_report(request, output, *, with_history=False):
    if not output.is_absolute():
        raise ValueError('absolute output directory required')
    if output.exists():
        raise FileExistsError('output directory already exists')
    receipt, bundle = analyze_with_history(request) if with_history else analyze(request)
    output.mkdir(mode=0o700)
    for name, value in [('receipt.json', receipt), ('anti-evidence.json', bundle)]:
        with (output / name).open('x') as f:
            os.chmod(f.name, 0o600)
            json.dump(value, f, indent=2, allow_nan=False)
            f.write('\n')
    return receipt, bundle


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--with-history', action='store_true', help='Include bounded earlier-window measurements; no new detected pitches')
    args = parser.parse_args()
    if not args.request.is_absolute():
        raise ValueError('absolute request path required')
    def offline(event, _args):
        if event in ('socket.connect', 'socket.getaddrinfo', 'socket.bind'):
            raise RuntimeError('bank pitch evidence is offline-only')
    sys.addaudithook(offline)
    with args.request.open('rb') as f:
        raw = f.read(65537)
    if len(raw) > 65536:
        raise ValueError('request exceeds64KiB')
    receipt, _ = write_report(json.loads(raw), args.output, with_history=args.with_history)
    print(json.dumps({'receipt': str(args.output / 'receipt.json'), 'antiEvidence': str(args.output / 'anti-evidence.json'),
                      'status': receipt['status'], 'providerCalls': 0, 'musicalAcceptance': 'not-established'}))


if __name__ == '__main__':
    main()
