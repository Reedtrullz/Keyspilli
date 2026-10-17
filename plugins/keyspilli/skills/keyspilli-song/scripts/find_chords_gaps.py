#!/usr/bin/env python3
"""Advisory Chords review: find backing gaps Original fills, and screen for lead notes leaking into Chords.

Reads the matching Original and Chords MIDI exports of one delivery. Output is
structural evidence only: it never edits music, never chooses bridge events and
cannot establish melody roles, harmony or musical quality.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
from typing import Any

MAX_BYTES = 8 * 1024 * 1024
MAX_NOTES = 200000
EPS = 1e-6
MAX_GAP_SECONDS = 6.0
MAX_GAP_QUARTER_BEATS = 8.0
MAX_EVENTS_PER_GAP = 16
MIN_WINDOW_SECONDS = 0.25
GENUINE_REST_SECONDS = 0.5
LEAD_FLOOR_MIDI = 60


def vlq(data, pos):
    value = 0
    for _ in range(4):
        if pos >= len(data):
            raise ValueError('truncated MIDI variable-length value')
        byte = data[pos]
        pos += 1
        value = (value << 7) | (byte & 0x7F)
        if not byte & 0x80:
            return value, pos
    raise ValueError('oversized MIDI variable-length value')


def parse_midi(data):
    if len(data) > MAX_BYTES or data[:4] != b'MThd' or len(data) < 14:
        raise ValueError('not a bounded Standard MIDI File')
    header_len = int.from_bytes(data[4:8], 'big')
    tracks = int.from_bytes(data[10:12], 'big')
    division = int.from_bytes(data[12:14], 'big')
    if header_len < 6 or division & 0x8000 or division == 0:
        raise ValueError('SMPTE or invalid MIDI division is unsupported')
    pos = 8 + header_len
    tempos = {0: 500000}
    raw = []
    for _ in range(tracks):
        if data[pos:pos + 4] != b'MTrk':
            raise ValueError('missing MIDI track chunk')
        end = pos + 8 + int.from_bytes(data[pos + 4:pos + 8], 'big')
        if end > len(data):
            raise ValueError('truncated MIDI track')
        pos += 8
        tick, status, active = 0, 0, {}
        while pos < end:
            delta, pos = vlq(data, pos)
            tick += delta
            first = data[pos]
            if first == 0xFF:
                kind = data[pos + 1]
                size, pos = vlq(data, pos + 2)
                if kind == 0x51 and size == 3:
                    tempos[tick] = int.from_bytes(data[pos:pos + 3], 'big')
                pos += size
                continue
            if first in (0xF0, 0xF7):
                size, pos = vlq(data, pos + 1)
                pos += size
                continue
            if first & 0x80:
                status = first
                pos += 1
            elif not status:
                raise ValueError('MIDI running status without a status byte')
            width = 1 if status & 0xF0 in (0xC0, 0xD0) else 2
            args = data[pos:pos + width]
            pos += width
            if len(args) != width:
                raise ValueError('truncated MIDI event')
            key = (status & 0x0F, args[0])
            if status & 0xF0 == 0x90 and args[1] > 0:
                active.setdefault(key, []).append(tick)
            elif status & 0xF0 == 0x80 or (status & 0xF0 == 0x90 and args[1] == 0):
                if active.get(key):
                    raw.append((active[key].pop(0), tick, key[1]))
            if len(raw) > MAX_NOTES:
                raise ValueError('too many MIDI notes')
        for key, starts in active.items():
            raw.extend((start, tick, key[1]) for start in starts)
        pos = end
    marks = sorted(tempos.items())
    segments, seconds = [], 0.0
    for index, (tick, micros) in enumerate(marks):
        segments.append((tick, seconds, micros))
        if index + 1 < len(marks):
            seconds += (marks[index + 1][0] - tick) * micros / division / 1e6
    clock: dict[str, Any] = {'division': division, 'segments': segments}
    notes = sorted((tick_seconds(clock, a), tick_seconds(clock, b), pitch) for a, b, pitch in raw if b > a)
    return notes, clock


def tick_seconds(clock, tick):
    tick0, base, micros = [s for s in clock['segments'] if s[0] <= tick][-1]
    return base + (tick - tick0) * micros / clock['division'] / 1e6


def seconds_ticks(clock, seconds):
    tick0, base, micros = [s for s in clock['segments'] if s[1] <= seconds + EPS][-1]
    return tick0 + (seconds - base) * 1e6 * clock['division'] / micros


def quarter_beats(clock, start, end):
    return (seconds_ticks(clock, end) - seconds_ticks(clock, start)) / clock['division']


def merge(spans, hole=0.0):
    merged = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1] + hole + EPS:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged


def r(value):
    return round(value, 3)


def find_gaps(original, chords, clock, min_gap):
    cover = merge([(s, e) for s, e, _ in chords])
    gaps = []
    for (_, left_end), (right_start, _) in zip(cover, cover[1:]):
        length = right_start - left_end
        if length < min_gap - EPS:
            continue
        inside = [n for n in original if n[0] >= left_end - EPS and n[1] <= right_start + EPS]
        crossing = [n for n in original if n[1] > left_end + EPS and n[0] < right_start - EPS and n not in inside]
        clusters = [c for c in merge([(s, e) for s, e, _ in inside], GENUINE_REST_SECONDS) if c[1] - c[0] >= MIN_WINDOW_SECONDS - EPS]
        windows = []
        for start, end in clusters:
            members = [n for n in inside if n[0] >= start - EPS and n[1] <= end + EPS]
            peak = max((sum(1 for m in members if m[0] <= t + EPS < m[1]) for t in {m[0] for m in members}), default=0)
            windows.append({'startSeconds': r(start), 'endSeconds': r(end),
                'maximumSimultaneousNotes': peak,
                'candidateOriginalNotes': [{'startSeconds': r(a), 'durationSeconds': r(b - a), 'midi': p} for a, b, p in members]})
        rests, cursor = [], left_end
        for start, end in [(w['startSeconds'], w['endSeconds']) for w in windows] + [(right_start, right_start)]:
            if start - cursor >= 0.05:
                rests.append({'startSeconds': r(cursor), 'endSeconds': r(start)})
            cursor = max(cursor, end)
        beats = quarter_beats(clock, left_end, right_start)
        reasons = []
        if length > MAX_GAP_SECONDS + EPS:
            reasons.append('gap exceeds six native seconds')
        if beats > MAX_GAP_QUARTER_BEATS + EPS:
            reasons.append('gap exceeds eight source quarter beats')
        if not windows:
            reasons.append('Original is silent or only crosses the gap boundaries: genuine rest or no bridgeable note')
        if sum(len(w['candidateOriginalNotes']) for w in windows) > MAX_EVENTS_PER_GAP:
            reasons.append('more than sixteen candidates: select a sparse voice, never all of them')
        gaps.append({'backingEndsSeconds': r(left_end), 'backingResumesSeconds': r(right_start),
            'gapSeconds': r(length), 'gapQuarterBeats': r(beats),
            'withinBridgeBounds': length <= MAX_GAP_SECONDS + EPS and beats <= MAX_GAP_QUARTER_BEATS + EPS,
            'bridgeableWindows': windows, 'genuineRestSeconds': rests,
            'originalNotesCrossingBoundary': len(crossing), 'notes': reasons})
    return gaps


def lead_shadow(original, chords, tolerance, window):
    """Proxy only: Chords attacks that repeat Original's highest voice at the same onset."""
    tops, cluster = [], []
    for note in sorted(original):
        if cluster and note[0] - cluster[0][0] > tolerance:
            tops.append(max(cluster, key=lambda n: n[2]))
            cluster = []
        cluster.append(note)
    if cluster:
        tops.append(max(cluster, key=lambda n: n[2]))
    tops = [t for t in tops if t[2] >= LEAD_FLOOR_MIDI]

    def shadows(note):
        return any(abs(note[0] - t[0]) <= tolerance and abs(note[2] - t[2]) % 12 == 0
                   and abs(note[2] - t[2]) <= 24 for t in tops)

    buckets: dict[int, list[int]] = {}
    for note in chords:
        bucket = buckets.setdefault(int(note[0] // window), [0, 0])
        bucket[0] += 1
        bucket[1] += shadows(note)
    rows = [{'startSeconds': r(k * window), 'chordsAttacks': total, 'repeatingOriginalTopVoice': hits,
             'ratio': r(hits / total), 'suspect': total >= 3 and hits >= 4 and hits / total >= 0.5}
            for k, (total, hits) in sorted(buckets.items())]
    suspects = [row for row in rows if row['suspect']]
    return {'method': 'proxy: same onset and pitch class as the highest Original voice at or above MIDI 60; not a role label',
            'windowSeconds': window, 'firstSuspectSeconds': suspects[0]['startSeconds'] if suspects else None,
            'suspectWindows': suspects, 'windows': rows}


def digest(path):
    data = Path(path).read_bytes()
    return {'path': str(Path(path).resolve()), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def analyze(original_path, chords_path, min_gap=1.0, window=5.0, tolerance=0.03) -> dict[str, Any]:
    original, o_clock = parse_midi(Path(original_path).read_bytes())
    chords, c_clock = parse_midi(Path(chords_path).read_bytes())
    warnings = []
    if not original or not chords:
        raise ValueError('both exports need at least one note')
    if [round(s[2]) for s in o_clock['segments']] != [round(s[2]) for s in c_clock['segments']] or o_clock['division'] != c_clock['division']:
        warnings.append('Original and Chords tempo maps differ: window times are on separate clocks; do not bridge until the clocks are reconciled')
    return {'schemaVersion': 1, 'kind': 'keyspilli-chords-gap-report', 'status': 'advisory-structural-evidence',
        'inputs': {'original': digest(original_path), 'chords': digest(chords_path)},
        'warnings': warnings,
        'backingGaps': find_gaps(original, chords, o_clock, min_gap),
        'leadShadow': lead_shadow(original, chords, tolerance, window),
        'limits': {'maximumGapSeconds': MAX_GAP_SECONDS, 'maximumGapQuarterBeats': MAX_GAP_QUARTER_BEATS,
                   'maximumEventsPerGap': MAX_EVENTS_PER_GAP},
        'scope': 'Seconds and pitches only. Map any chosen note to an exact retained melody event ID with the phrase-plan inspector; '
                 'this report cannot name roles, choose a bridge, validate harmony or claim musical acceptance.'}


def encode_midi(notes, tempo_bpm=120, division=480):
    def number(value):
        out = [value & 0x7F]
        value >>= 7
        while value:
            out.append(0x80 | (value & 0x7F))
            value >>= 7
        return bytes(reversed(out))
    ticks_per_second = division * tempo_bpm / 60
    events = []
    for start, end, midi in notes:
        events.append((round(start * ticks_per_second), 1, bytes([0x90, midi, 80])))
        events.append((round(end * ticks_per_second), 0, bytes([0x80, midi, 0])))
    body = number(0) + b'\xff\x51\x03' + int(60000000 / tempo_bpm).to_bytes(3, 'big')
    last = 0
    for tick, _, message in sorted(events):
        body += number(tick - last) + message
        last = tick
    body += number(0) + b'\xff\x2f\x00'
    return b'MThd' + (6).to_bytes(4, 'big') + (0).to_bytes(2, 'big') + (1).to_bytes(2, 'big') + division.to_bytes(2, 'big') \
        + b'MTrk' + len(body).to_bytes(4, 'big') + body


def self_test():
    import tempfile
    original = [(0, 6, 40), (6, 6.8, 72), (7, 7.8, 74), (8, 8.8, 76), (9, 9.3, 77), (9.4, 14, 40), (14, 14.5, 77), (15.2, 20, 40)]
    chords = [(0, 6, 40), (9.4, 14, 40), (15.2, 20, 40)]
    leak = [(t, t + 0.4, 72) for t in (10.5, 11.5, 12.5, 13.5)]

    def run(top, backing):
        with tempfile.TemporaryDirectory() as folder:
            a, b = Path(folder, 'o.mid'), Path(folder, 'c.mid')
            a.write_bytes(encode_midi(top))
            b.write_bytes(encode_midi(backing))
            return analyze(a, b)
    report = run(original, chords)
    first, second = report['backingGaps']
    window = first['bridgeableWindows'][0]
    assert (window['startSeconds'], window['endSeconds'], len(window['candidateOriginalNotes'])) == (6.0, 9.3, 4)
    assert first['withinBridgeBounds'] and first['gapSeconds'] == 3.4 and first['gapQuarterBeats'] == 6.8
    assert second['bridgeableWindows'][0]['endSeconds'] == 14.5
    assert second['genuineRestSeconds'] == [{'startSeconds': 14.5, 'endSeconds': 15.2}]
    assert report['leadShadow']['firstSuspectSeconds'] is None and not report['warnings']
    assert run(original + leak, chords + leak)['leadShadow']['firstSuspectSeconds'] == 10.0
    print(json.dumps({'selfTest': 'passed'}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('original', nargs='?', help='Original MIDI export of the delivery')
    parser.add_argument('chords', nargs='?', help='matching Chords MIDI export')
    parser.add_argument('--min-gap-seconds', type=float, default=1.0)
    parser.add_argument('--window-seconds', type=float, default=5.0)
    parser.add_argument('--tolerance-seconds', type=float, default=0.03)
    parser.add_argument('--output', help='new JSON report path; existing files are never overwritten')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if not args.original or not args.chords:
        parser.error('original and chords MIDI paths are required')
    if not 0 < args.min_gap_seconds <= 60 or not 0 < args.window_seconds <= 60 or not 0 < args.tolerance_seconds <= 0.5:
        parser.error('thresholds outside bounded ranges')
    text = json.dumps(analyze(args.original, args.chords, args.min_gap_seconds, args.window_seconds, args.tolerance_seconds), indent=2)
    if args.output:
        with open(args.output, 'x') as handle:
            handle.write(text + '\n')
    print(text)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        print(f'find_chords_gaps: {error}', file=sys.stderr)
        sys.exit(2)

