#!/usr/bin/env python3
"""Recover provisional pitches inside source-supported native-time attacks, not piano bytes."""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import statistics
import sys
from normalize_ug_score import fields, number, require, text, unique_object


def recover(packet):
    fields(packet, 'schemaVersion sourceSha256 clock tuningCents tuningBasis trackers attacks', 'packet',
           'schemaVersion sourceSha256 clock tuningCents tuningBasis trackers attacks')
    require(type(packet['schemaVersion']) is int and packet['schemaVersion'] == 1, 'schemaVersion must be 1')
    require(packet['clock'] == 'native-seconds', 'native recording seconds required')
    digest = text(packet['sourceSha256'], 'sourceSha256')
    require(len(digest) == 64 and all(c in '0123456789abcdef' for c in digest), 'source SHA256 required')
    tuning = number(packet['tuningCents'], 'tuningCents', -100)
    require(tuning <= 100, 'tuning offset outside +/-100 cents')
    text(packet['tuningBasis'], 'tuningBasis')
    trackers = packet['trackers']
    require(isinstance(trackers, list) and len(trackers) >= 2, 'two pitch methods required')
    names = set()
    for track in trackers:
        fields(track, 'method threshold frames', 'tracker', 'method threshold frames')
        name = text(track['method'], 'method')
        require(name not in names, 'distinct pitch methods required')
        names.add(name)
        threshold = number(track['threshold'], 'threshold')
        require(threshold <= 1, 'threshold > 1')
        require(isinstance(track['frames'], list), 'frames must be an array')
        previous = -1
        for frame in track['frames']:
            require(isinstance(frame, list) and len(frame) == 3, 'frame: [native seconds, MIDI float/null, confidence]')
            t, pitch, confidence = frame
            number(t, 'frame time')
            require(t > previous, 'frame times must strictly increase')
            previous = t
            if pitch is not None:
                require(number(pitch, 'pitch') <= 127, 'pitch > 127')
            require(number(confidence, 'confidence') <= 1, 'confidence > 1')
    require(isinstance(packet['attacks'], list), 'attacks must be an array')
    notes, gestures, unresolved, seen, previous_end = [], [], [], set(), 0
    for attack in packet['attacks']:
        fields(attack, 'id start end kind boundaryEvidence pitchWindow pitchEvidence', 'attack',
               'id start end kind boundaryEvidence')
        identifier = text(attack['id'], 'attack id')
        require(identifier not in seen, 'duplicate attack id')
        seen.add(identifier)
        start, end = number(attack['start'], 'attack start'), number(attack['end'], 'attack end')
        require(end > start and start >= previous_end, 'ordered, positive, nonoverlapping attack intervals required')
        previous_end = end
        text(attack['boundaryEvidence'], 'boundaryEvidence')
        pitch_start, pitch_end = start, end
        require(('pitchWindow' in attack) == ('pitchEvidence' in attack), 'pitchWindow and pitchEvidence required together')
        if 'pitchWindow' in attack:
            window = attack['pitchWindow']
            require(isinstance(window, list) and len(window) == 2, 'pitchWindow: [native start, end]')
            pitch_start, pitch_end = (number(t, 'pitchWindow time') for t in window)
            require(start <= pitch_start < pitch_end <= end, 'pitchWindow must lie inside attack')
            text(attack['pitchEvidence'], 'pitchEvidence')
        require(attack['kind'] in ('singing', 'speech', 'bleed', 'unknown'), 'explicit passage kind required')
        reasons, estimates = [], []
        if attack['kind'] != 'singing':
            reasons.append('not-established-singing')
        for track in trackers:
            values = [f[1] - tuning / 100 for f in track['frames']
                      if pitch_start <= f[0] < pitch_end and f[1] is not None and f[2] >= track['threshold']]
            if not values:
                reasons.append(track['method'] + ':no-pitch')
                continue
            values.sort()
            centre = statistics.median(values)
            steps = [b[0] - a[0] for a, b in zip(track['frames'], track['frames'][1:])]
            cadence = statistics.median(steps) if steps else 0
            coverage = min(1, len(values) * cadence / (pitch_end - pitch_start))
            gesture_values = sorted(f[1] - tuning / 100 for f in track['frames']
                                    if start <= f[0] < end and f[1] is not None and f[2] >= track['threshold'])
            # ponytail: robust core only; gesture interpretation remains source review, not a hidden quantizer.
            spread = values[int((len(values) - 1) * .9)] - values[int((len(values) - 1) * .1)]
            estimates.append({'method': track['method'], 'midiFloat': centre, 'coreSpread': spread,
                              'frames': len(values), 'supportedFrameCoverage': coverage,
                              'gestureSupportedFrameCoverage': min(1, len(gesture_values) * cadence / (end - start)),
                              'gestureCoreSpread': gesture_values[int((len(gesture_values) - 1) * .9)] -
                                                   gesture_values[int((len(gesture_values) - 1) * .1)],
                              'pitchWindowFraction': (pitch_end - pitch_start) / (end - start)})
            if coverage < .5:
                reasons.append(track['method'] + ':insufficient-pitch-coverage')
            if spread > 1:
                reasons.append(track['method'] + ':slide-or-unstable-pitch')
        if len(estimates) == len(trackers):
            pitches = [e['midiFloat'] for e in estimates]
            if max(pitches) - min(pitches) > .5:
                reasons.append('pitch-or-octave-disagreement')
            pitch = statistics.median(pitches)
            midi = math.floor(pitch + .5)
            if not reasons:
                gestures.append({**attack, 'midiFloat': pitch, 'estimates': estimates,
                                 'adjacentPianoKeys': sorted({math.floor(pitch), math.ceil(pitch)}),
                                 'pianoDecisionRequired': abs(pitch - midi) > .35})
            if abs(pitch - midi) > .35:
                reasons.append('between-piano-pitches')
        if reasons:
            unresolved.append({**attack, 'reasons': reasons, 'estimates': estimates})
        else:
            notes.append({**attack, 'midi': midi, 'estimates': estimates})
    return {'status': 'provisional', 'sourceSha256': digest, 'clock': packet['clock'], 'tuningCents': tuning,
            'notes': notes, 'gestures': gestures, 'unresolved': unresolved,
            'fallback': 'Instrumental Original; omit unresolved vocal passages explicitly. Chords has no vocal melody.',
            'qualification': 'Gestures retain continuous sung pitch; notes retain the conservative piano triage. Neither is note-boundary truth, listening or piano acceptance.'}


def self_test():
    def make(pitches, attacks):
        frames = [[i * .01, p, .9] for i, p in enumerate(pitches)]
        return {'schemaVersion': 1, 'sourceSha256': 'a' * 64, 'clock': 'native-seconds', 'tuningCents': 0,
                'tuningBasis': 'synthetic A440', 'trackers': [{'method': name, 'threshold': .5, 'frames': copy.deepcopy(frames)}
                for name in ('a', 'b')], 'attacks': [{'id': str(i), 'start': a, 'end': b, 'kind': k,
                'boundaryEvidence': 'synthetic source attack'} for i, (a, b, k) in enumerate(attacks)]}
    # Brief pickup, repeated syllable, rest and sustained vibrato: exact times, no floor or merging.
    p = make([60 + .2 * math.sin(i) for i in range(120)],
             [(.013, .053, 'singing'), (.06, .2, 'singing'), (.2, .4, 'singing'), (.55, 1.19, 'singing')])
    result = recover(p)
    assert len(result['notes']) == 4 and not result['unresolved']
    assert [(n['start'], n['end']) for n in result['notes']] == [(a['start'], a['end']) for a in p['attacks']]
    assert all(n['midi'] == 60 for n in result['notes'])
    consonant = make([None] * 20 + [60] * 60 + [None] * 20, [(0, 1, 'singing')])
    consonant['attacks'][0].update(pitchWindow=[.2, .8], pitchEvidence='synthetic voiced vowel, unpitched edges')
    n = recover(consonant)['notes'][0]
    assert (n['start'], n['end'], n['midi']) == (0, 1, 60)
    assert n['estimates'][0]['supportedFrameCoverage'] > .99
    assert .59 < n['estimates'][0]['gestureSupportedFrameCoverage'] < .61
    for window in ([-.1, .8], [.2, 1.1], [.4, .4]):
        bad = copy.deepcopy(consonant)
        bad['attacks'][0]['pitchWindow'] = window
        try:
            recover(bad)
        except ValueError:
            continue
        raise AssertionError('invalid vowel core accepted')
    slide = make([60 + i * .03 for i in range(100)], [(0, 1, 'singing')])
    assert not recover(slide)['notes']
    for kind in ('speech', 'bleed', 'unknown'):
        q = make([60] * 100, [(0, 1, kind)])
        assert not recover(q)['notes']  # Two agreeing trackers also track spoken/bleeding pitches.
    octave = copy.deepcopy(p)
    for frame in octave['trackers'][1]['frames']:
        frame[1] += 12
    assert not recover(octave)['notes']
    silence = make([None] * 100, [(0, 1, 'singing')])
    assert not recover(silence)['notes']
    sparse = make([60] + [None] * 99, [(0, 1, 'singing')])
    assert not recover(sparse)['notes']  # A single pitch frame cannot fill a long syllable.
    detuned = make([60.45] * 100, [(0, 1, 'singing')])
    assert not recover(detuned)['notes']
    gesture = recover(detuned)['gestures'][0]
    assert gesture['midiFloat'] == 60.45 and gesture['adjacentPianoKeys'] == [60, 61]
    assert gesture['pianoDecisionRequired'] and 'midi' not in gesture
    assert not recover(slide)['gestures'] and not recover(octave)['gestures']
    assert not recover(sparse)['gestures'] and not recover(silence)['gestures']
    for kind in ('speech', 'bleed', 'unknown'):
        q = make([60.45] * 100, [(0, 1, kind)])
        assert not recover(q)['gestures']
    detuned.update(tuningCents=45, tuningBasis='synthetic measured offset')
    assert recover(detuned)['notes'][0]['midi'] == 60
    for mutate in (lambda p: p.update(clock='score-seconds'), lambda p: p.update(schemaVersion=True),
                   lambda p: p['attacks'][0].update(start=-1), lambda p: p['attacks'][0].update(end=float('nan')),
                   lambda p: p['attacks'][1].update(start=.01), lambda p: p['trackers'][0]['frames'][0].__setitem__(1, float('inf'))):
        bad = copy.deepcopy(p)
        mutate(bad)
        try:
            recover(bad)
        except ValueError:
            continue
        raise AssertionError('invalid packet accepted')
    print('Vocal recovery: pickups/repeats/rests/sustains/vibrato, unresolved slides/octaves/speech/bleed/silence/tuning and invalid controls passed')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('packet', nargs='?', type=Path)
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--source', type=Path, help='Actual source recording, checked against packet SHA256')
    args = parser.parse_args()
    if args.self_test:
        self_test()
    else:
        if not args.packet or not args.source:
            parser.error('packet and --source required')
        try:
            raw = args.packet.read_bytes()
            result = recover(json.loads(raw, object_pairs_hook=unique_object))
            require(hashlib.sha256(args.source.read_bytes()).hexdigest() == result['sourceSha256'], 'source hash mismatch')
            result['packetSha256'] = hashlib.sha256(raw).hexdigest()
            print(json.dumps(result, indent=2, allow_nan=False))
        except (ValueError, TypeError, KeyError, OSError) as error:
            parser.exit(1, f'Vocal recovery unresolved: {error}\n')
