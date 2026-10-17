#!/usr/bin/env python3
"""Print a ready chordsBridges block for the gaps Original fills in a Chords delivery.

Reads the matching Original and Chords MIDI exports (through find_chords_gaps.py)
and an event map {EVENT_ID: {"role", "startBeat", "durationBeats"}} in source
quarter beats. Window seconds are converted to quarter beats with the Original
tempo map, and endBeat is computed here as the last kept event's start plus
duration. Only melody events wholly inside a bridgeable window are kept, as one
non-overlapping voice. It first runs the capability check (check_bridge_capability.py) and, when
bridge support is unavailable, prints an empty plan with the unavailable line instead. Structural selection only: it validates no harmony, makes
no musical claim and is not a substitute for the maintained phrase-plan inspector.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys

TOLERANCE_BEATS = 0.05
EPS = 1e-6
BASIS = 'Source-linked instrumental connecting voice; arrangement selection, not validated harmony'


def load_gap_finder():
    path = Path(__file__).with_name('find_chords_gaps.py')
    spec = importlib.util.spec_from_file_location('find_chords_gaps', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def to_beats(finder, clock, seconds):
    return finder.seconds_ticks(clock, seconds) / clock['division']


def read_events(path):
    raw = json.loads(Path(path).read_text())
    if not isinstance(raw, dict) or not raw:
        raise ValueError('event map must be a non-empty object keyed by event ID')
    events = {}
    for key, value in raw.items():
        if not isinstance(value, dict) or not {'role', 'startBeat', 'durationBeats'} <= set(value):
            raise ValueError(f'event {key} needs role, startBeat and durationBeats')
        start, duration = float(value['startBeat']), float(value['durationBeats'])
        if duration <= 0:
            raise ValueError(f'event {key} has a non-positive duration')
        events[str(key)] = {'role': value['role'], 'start': start, 'end': start + duration}
    return events


def plan(original, chords, events_path):
    finder = load_gap_finder()
    report = finder.analyze(original, chords)
    result = {'schemaVersion': 1, 'kind': 'keyspilli-chords-bridge-plan', 'chordsBridges': [], 'skipped': [],
              'scope': 'Structural selection from event roles and beats; no harmony or musical claim. Quarter beats are converted from seconds with the Original tempo map.'}
    if report['warnings']:
        result['refused'] = report['warnings']
        return result
    _, clock = finder.parse_midi(Path(original).read_bytes())
    events = read_events(events_path)
    limits = report['limits']
    for number, gap in enumerate(report['backingGaps'], 1):
        label = f'gap {number} ({gap["backingEndsSeconds"]}-{gap["backingResumesSeconds"]} s)'
        if not gap['withinBridgeBounds']:
            result['skipped'].append({'gap': label, 'reason': 'beyond the six-second or eight-beat bridge bounds'})
            continue
        for window in gap['bridgeableWindows']:
            low, high = to_beats(finder, clock, window['startSeconds']), to_beats(finder, clock, window['endSeconds'])
            inside, excluded = [], []
            for key, event in events.items():
                if event['end'] <= low - TOLERANCE_BEATS or event['start'] >= high + TOLERANCE_BEATS:
                    continue
                if event['role'] != 'melody':
                    excluded.append({'eventId': key, 'reason': f'role is {event["role"]}, not melody'})
                elif event['start'] < low - TOLERANCE_BEATS or event['end'] > high + TOLERANCE_BEATS:
                    excluded.append({'eventId': key, 'reason': 'crosses the window edge'})
                else:
                    inside.append((event['start'], event['end'], key))
            kept, last_end = [], None
            for start, end, key in sorted(inside):
                if last_end is not None and start < last_end - EPS:
                    excluded.append({'eventId': key, 'reason': 'overlaps the previous kept event; one voice only'})
                    continue
                kept.append((start, end, key))
                last_end = end
            kept = kept[:limits['maximumEventsPerGap']]
            where = {'gap': label, 'windowBeats': [round(low, 4), round(high, 4)]}
            if not kept:
                result['skipped'].append({**where, 'reason': 'no melody event wholly inside the window', 'excluded': excluded})
                continue
            if kept[-1][1] - kept[0][0] > limits['maximumGapQuarterBeats'] + EPS:
                result['skipped'].append({**where, 'reason': 'selection would exceed eight quarter beats', 'excluded': excluded})
                continue
            result['chordsBridges'].append({'id': f'gap-{number}-link', 'startBeat': round(kept[0][0], 6), 'endBeat': round(kept[-1][1], 6),
                                            'basis': BASIS, 'events': [{'eventId': key} for _, _, key in kept]})
            if excluded:
                result['skipped'].append({**where, 'reason': 'events left out of the bridge', 'excluded': excluded})
    return result


def guarded_plan(original, chords, events_path, checkout=None, node=None, verdict=None):
    if verdict is None:
        spec = importlib.util.spec_from_file_location('check_bridge_capability', Path(__file__).with_name('check_bridge_capability.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        verdict, node = module.verdict, node or os.environ.get('KEYSPILLI_NODE') or 'node'
    ok, detail = verdict(checkout, node)
    if not ok:
        return {'schemaVersion': 1, 'kind': 'keyspilli-chords-bridge-plan', 'chordsBridges': [], 'skipped': [],
                'bridgeSupport': f'Bridge support unavailable: {detail}.',
                'instruction': 'Declare no chordsBridges and copy the bridgeSupport line verbatim into your answer. Keep the existing backing.'}
    result = plan(original, chords, events_path)
    result['bridgeSupport'] = f'Bridge support available: {detail}'
    return result


def self_test():
    import tempfile
    with tempfile.TemporaryDirectory() as folder:
        finder = load_gap_finder()
        a, b, e = Path(folder, 'o.mid'), Path(folder, 'c.mid'), Path(folder, 'e.json')
        a.write_bytes(finder.encode_midi([(0, 2, 40), (2, 2.5, 70), (3, 3.5, 72), (3.1, 3.3, 50), (4, 6, 40)]))
        b.write_bytes(finder.encode_midi([(0, 2, 40), (4, 6, 40)]))
        e.write_text(json.dumps({'a': {'role': 'melody', 'startBeat': 4, 'durationBeats': 1}, 'b': {'role': 'melody', 'startBeat': 6, 'durationBeats': 1},
                                 'h': {'role': 'hook', 'startBeat': 6.2, 'durationBeats': 0.4}, 'z': {'role': 'melody', 'startBeat': 40, 'durationBeats': 1}}))
        out = plan(a, b, e)
        bridge = out['chordsBridges'][0]
        assert (bridge['startBeat'], bridge['endBeat'], [x['eventId'] for x in bridge['events']]) == (4.0, 7.0, ['a', 'b']), out
        blocked = guarded_plan(a, b, e, verdict=lambda checkout, node: (False, 'no checkout'))
        assert blocked['chordsBridges'] == [] and blocked['bridgeSupport'] == 'Bridge support unavailable: no checkout.', blocked
        allowed = guarded_plan(a, b, e, verdict=lambda checkout, node: (True, 'source-gap-bridges-v1'))
        assert allowed['chordsBridges'] and allowed['bridgeSupport'].startswith('Bridge support available'), allowed
    print(json.dumps({'selfTest': 'passed'}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('original', nargs='?', help='Original MIDI export')
    parser.add_argument('chords', nargs='?', help='matching Chords MIDI export')
    parser.add_argument('events', nargs='?', help='event map JSON in source quarter beats')
    parser.add_argument('--checkout', default=None, help='Keyspilli checkout for the capability check (default: KEYSPILLI_CHECKOUT, else the nearest parent of the current directory that contains it)')
    parser.add_argument('--node', default=None)
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if not (args.original and args.chords and args.events):
        parser.error('original, chords and events paths are required')
    result = guarded_plan(args.original, args.chords, args.events, args.checkout, args.node)
    print(json.dumps(result, indent=2))
    if result['bridgeSupport'].startswith('Bridge support unavailable'):
        sys.exit(1)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        print(f'plan_chords_bridges: {error}', file=sys.stderr)
        sys.exit(2)
