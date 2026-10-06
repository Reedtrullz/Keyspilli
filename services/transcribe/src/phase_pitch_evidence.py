#!/usr/bin/env python3
"""Optional offline waveform-pattern evidence; current note presence stays unknown."""
import argparse
import json
import math
import os
import stat
import sys
import time
from pathlib import Path

import bank_pitch_evidence
import onset_evidence

PROFILE = {'renderer': 'FluidSynth', 'rendererVersion': '2.6.0', 'gain': .4,
           'reverb': False, 'chorus': False, 'unnormalizedPcm': True,
           'referenceVelocity': 76, 'referenceOnsetSeconds': .25, 'referenceHoldSeconds': 2.2}
CONFIG = {'method': 'phase-preserving-waveform-matching-pursuit', 'sampleRate': 16000,
          'referenceVelocity': 76, 'onsetGridSeconds': .002, 'onsetRadiusSteps': 12,
          'sampleCount': 4096, 'sampleSeed': 510526, 'maximumOnsets': 4,
          'maximumEvents': 12, 'maximumLookbackSeconds': 1.2,
          'minimumAmplitudeRatio': .15, 'minimumImprovementRatio': .001,
          'maximumRawResidual': .05, 'minimumRmsDbfs': -50,
          'referenceOnsetSeconds': .25, 'referenceHoldSeconds': 2.2,
          'futureFitSamplesAllowed': False}
LIMITATIONS = [
    'Waveform patterns depend on the same bank, phase, renderer, gain and capture conditions; only dry TimGM6mb/FluidSynth2.6.0 gain0.4 held-note renders were screened.',
    'Bank, template labels, velocity, hold duration and renderer profile are caller assertions. Hashes verify bytes, not provenance; false matching assertions can invalidate this diagnostic.',
    'These are history-pattern candidates, not a current pitch set. Current presence, acoustic absence, completeness, releases, pedal and repeated attacks remain unknown.',
    'Amplitudes and residuals are uncalibrated fit statistics, not pitch confidence. Gain changes, normalization, phase shifts, recordings and other instruments can invalidate estimates.',
    'Onset detection and resampling read the full clip. No fitting samples after the declared target end are used; this is not causal online tracking.',
    'Shared renderer defects, source correctness, independent Gemini hearing, repair authority and musical acceptance remain unestablished.',
]


def _fit(data, start, end_seconds, onsets, references, config=None):
    import numpy as np
    from scipy.optimize import nnls
    config = CONFIG if config is None else config
    selected_onsets = [o for o in onsets if o <= start + .03 and start - o <= config['maximumLookbackSeconds']]
    if len(selected_onsets) > config['maximumOnsets']:
        raise ValueError('phase onset bound exceeded; no partial output')
    if not selected_onsets:
        return {'pitches': None, 'reason': 'no-onsets', 'onsets': selected_onsets}
    begin = max(0, round((min(selected_onsets) - .064) * config['sampleRate']))
    # Floor to the declared boundary: nearest-sample rounding can exceed it.
    end = math.floor(end_seconds * config['sampleRate'])
    if not begin < end <= len(data):
        raise ValueError('phase fit interval outside decoded samples')
    current = data[round(start * config['sampleRate']):end]
    level = float(20 * np.log10(max(np.sqrt(np.mean(current ** 2)), 1e-12)))
    if level < config['minimumRmsDbfs']:
        return {'pitches': None, 'reason': 'below-level', 'onsets': selected_onsets, 'rmsDbfs': level}
    rng = np.random.default_rng(config['sampleSeed'])
    indices = np.sort(rng.choice(np.arange(begin, end), min(config['sampleCount'], end - begin), replace=False))
    labels = []
    column_count = len(selected_onsets) * len(references) * (2 * config['onsetRadiusSteps'] + 1)
    # One float32 dictionary, at most 358MiB for 4 onsets/88 pitches/65 shifts.
    matrix = np.empty((len(indices), column_count), dtype=np.float32, order='F')
    for onset_id, estimated in enumerate(selected_onsets):
        center = round(estimated / config['onsetGridSeconds']) * config['onsetGridSeconds']
        for pin, reference in references:
            grid = np.arange(len(reference))
            for offset in range(-config['onsetRadiusSteps'], config['onsetRadiusSteps'] + 1):
                event_start = center + offset * config['onsetGridSeconds']
                positions = indices + (config['referenceOnsetSeconds'] - event_start) * config['sampleRate']
                matrix[:, len(labels)] = np.interp(positions, grid, reference, left=0, right=0)
                labels.append({'midi': pin['midi'], 'onsetId': onset_id, 'estimatedOnsetSeconds': estimated,
                               'fittedPatternStartSeconds': event_start, 'referenceSha256': pin['sha256']})
    norms = np.linalg.norm(matrix, axis=0)
    norms[norms < 1e-10] = 1
    matrix /= norms
    target = data[indices]
    target_norm = np.linalg.norm(target)
    residual = target.copy()
    previous = target_norm
    active = []
    coefficients = np.array([])
    excluded = set()
    for _ in range(config['maximumEvents']):
        correlations = matrix.T @ residual
        if excluded:
            correlations[list(excluded)] = -np.inf
        choice = int(np.argmax(correlations))
        if correlations[choice] <= 0:
            break
        proposed = active + [choice]
        next_coefficients, error = nnls(matrix[:, proposed], target, maxiter=1000)
        if (previous - error) / target_norm < config['minimumImprovementRatio']:
            break
        active = proposed
        coefficients = next_coefficients
        previous = error
        residual = target - matrix[:, active] @ coefficients
        value = labels[choice]
        excluded.update(i for i, label in enumerate(labels) if (label['midi'], label['onsetId']) == (value['midi'], value['onsetId']))
    events = [{**labels[i], 'amplitudeRatioToReference': float(c / norms[i])} for i, c in zip(active, coefficients)]
    by_pitch = {}
    for event in events:
        by_pitch[event['midi']] = max(by_pitch.get(event['midi'], 0), event['amplitudeRatioToReference'])
    proposed = sorted(p for p, amplitude in by_pitch.items() if amplitude >= config['minimumAmplitudeRatio'])
    all_indices = np.arange(begin, end)
    reconstruction = np.zeros(end - begin)
    ref_map = {pin['midi']: reference for pin, reference in references}
    for event in events:
        reference = ref_map[event['midi']]
        reconstruction += event['amplitudeRatioToReference'] * np.interp(
            all_indices + (config['referenceOnsetSeconds'] - event['fittedPatternStartSeconds']) * config['sampleRate'],
            np.arange(len(reference)), reference, left=0, right=0)
    raw_residual = float(np.linalg.norm(reconstruction - data[begin:end]) / np.linalg.norm(data[begin:end]))
    return {'pitches': proposed if raw_residual <= config['maximumRawResidual'] else None,
            'proposed': proposed, 'events': events, 'rawResidual': raw_residual, 'onsets': selected_onsets,
            'fitInterval': {'startSeconds': begin / config['sampleRate'], 'endSeconds': end / config['sampleRate']},
            'sampledPoints': len(indices), 'sampledResidual': float(np.linalg.norm(residual) / target_norm), 'rmsDbfs': level}


def analyze(request):
    started = time.monotonic()
    timing = request.get('phaseTimingProfile', 'narrow-24ms')
    if type(timing) is not str or timing not in ('narrow-24ms', 'wide-64ms'):
        raise ValueError('supported phaseTimingProfile required: narrow-24ms or wide-64ms')
    config = {**CONFIG, 'onsetRadiusSteps': 32 if timing == 'wide-64ms' else 12}
    profile = request.get('phaseProfile')
    if profile != PROFILE or any(type(profile[k]) is not type(v) for k, v in PROFILE.items()):
        raise ValueError('explicit supported phaseProfile required')
    for pin in request['templates']:
        if (pin.get('velocity') != 76 or type(pin.get('velocity')) is not int or
                pin.get('holdSeconds') != 2.2 or pin.get('attackSeconds') != .25):
            raise ValueError('phase references require velocity76, onset0.25 and hold2.2 seconds')
    # Reuse all byte/bank/window/inventory/expected-context checks and retain the
    # unchanged single-window diagnostic. It never guides the phase fit.
    single, _ = bank_pitch_evidence.analyze(request)
    import numpy as np
    import soxr
    def read(pin):
        pcm, meta = onset_evidence.decode(bank_pitch_evidence.pin_path(pin), pin['sha256'])
        samples = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768
        return soxr.resample(samples, meta['sampleRate'], CONFIG['sampleRate'], quality='HQ'), meta
    data, audio = read(request['audio'])
    references = []
    for pin in sorted(request['templates'], key=lambda p: p['midi']):
        signal, metadata = read(pin)
        if metadata['durationSeconds'] < PROFILE['referenceOnsetSeconds'] + PROFILE['referenceHoldSeconds']:
            raise ValueError('phase reference must contain the complete declared hold interval')
        references.append((pin, signal))
    onset_receipt, _ = onset_evidence.analyze(bank_pitch_evidence.pin_path(request['audio']), request['audio']['sha256'])
    fit = _fit(data, request['window']['startSeconds'], request['window']['endSeconds'],
               onset_receipt['onsetEstimateSeconds'], references, config)
    analysis = {**config, 'timingProfile': timing, 'profile': PROFILE, 'codeSha256': onset_evidence.digest(Path(__file__).read_bytes()),
                'parentAnalysisConfigSha256': single['analysisConfigSha256'],
                'onsetAnalysisConfigSha256': onset_receipt['analysisConfigSha256']}
    config_sha = onset_evidence.digest(json.dumps(analysis, sort_keys=True, separators=(',', ':')).encode())
    receipt = {'schemaVersion': 1, 'kind': 'keyspilli-phase-pattern-evidence', 'audio': audio,
               'window': single['window'], 'fit': fit, 'patternPitchCandidates': fit['pitches'],
               'currentPitchSetEstimate': None, 'currentPresenceEstablished': False,
               'pitchSetCompleteness': 'unknown', 'bankSha256': request['bank']['sha256'],
               'bankProvenanceVerified': False, 'templatePins': request['templates'],
               'searchedPitches': single['searchedPitches'], 'expectedPitches': request.get('expectedPitches'),
               'singleWindowDiagnostic': single, 'analysis': analysis, 'analysisConfigSha256': config_sha,
               'status': 'pattern-fit' if fit['pitches'] is not None else 'uncertain',
               'origin': 'renderer-informed', 'providerCalls': 0, 'calibrated': False,
               'musicalAcceptance': 'not-established', 'limitations': LIMITATIONS,
               'elapsedSeconds': time.monotonic() - started}
    interval = fit.get('fitInterval', single['window'])
    def claim(ident, text, origin):
        return {'id': ident, 'clipId': 'A', **interval, 'text': text, 'origin': origin,
                'uncertainty': ' '.join(LIMITATIONS[:4])}
    stats = {'status': receipt['status'], 'patternPitchCandidates': fit['pitches'],
             'currentPresenceEstablished': False, 'pitchSetCompleteness': 'unknown',
             'rawResidual': None if 'rawResidual' not in fit else round(fit['rawResidual'], 6)}
    claims = [claim('asserted-phase-profile', 'Caller asserts matching bank/profile and isolated labeled held references: ' +
                    json.dumps({'bankSha256': receipt['bankSha256'], 'profile': PROFILE, 'timingProfile': timing, 'searchedPitches': single['searchedPitches']}), 'authored'),
              claim('phase-pattern-fit', 'History waveform-pattern fit, not a current pitch set: ' + json.dumps(stats) +
                    f'. Configuration SHA256: {config_sha}. No automatic repairs or source/absence judgments.', 'measurement')]
    if request.get('expectedPitches') is not None:
        claims.append(claim('expected-pitch-set', f'Caller supplied expected set {sorted(request["expectedPitches"])}; this did not restrict search or establish current comparison.', 'authored'))
    bundle = {'schemaVersion': 1, 'kind': 'anti-music-evidence',
              'clips': [{'id': 'A', 'sha256': audio['sha256'], 'durationSeconds': audio['durationSeconds']}],
              'claims': claims, 'context': {'sourceAuthority': 'unknown', 'allowedDifferences': []}, 'limitations': LIMITATIONS}
    return receipt, bundle


def write_report(request, output):
    if not output.is_absolute():
        raise ValueError('absolute output directory required')
    if output.exists():
        raise FileExistsError('output directory already exists')
    receipt, bundle = analyze(request)
    output.mkdir(mode=0o700)
    for name, value in [('receipt.json', receipt), ('anti-evidence.json', bundle)]:
        with (output / name).open('x') as handle:
            os.chmod(handle.name, 0o600)
            json.dump(value, handle, indent=2, allow_nan=False)
            handle.write('\n')
    return receipt, bundle


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not args.request.is_absolute():
        raise ValueError('absolute regular request of at most64KiB required')
    with args.request.open('rb') as handle:
        metadata = os.fstat(handle.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 64 * 1024:
            raise ValueError('absolute regular request of at most64KiB required')
        raw_request = handle.read(64 * 1024 + 1)
        if len(raw_request) > 64 * 1024:
            raise ValueError('request exceeded64KiB while reading')
    def offline(event, _):
        if event in ('socket.connect', 'socket.getaddrinfo', 'socket.bind'):
            raise RuntimeError('phase evidence is offline-only')
    sys.addaudithook(offline)
    receipt, _ = write_report(json.loads(raw_request), args.output)
    print(json.dumps({'receipt': str(args.output / 'receipt.json'), 'antiEvidence': str(args.output / 'anti-evidence.json'),
                      'status': receipt['status'], 'patternPitchCandidates': receipt['patternPitchCandidates'],
                      'currentPresenceEstablished': False, 'providerCalls': 0, 'musicalAcceptance': 'not-established'}))


if __name__ == '__main__':
    main()
