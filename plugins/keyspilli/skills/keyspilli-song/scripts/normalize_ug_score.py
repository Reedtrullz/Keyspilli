#!/usr/bin/env python3
"""Normalize a bounded, manually observed score packet; never fetch UG or certify music."""
import argparse
import copy
import hashlib
import json
import sys
from pathlib import Path
import tempfile


def require(condition, message):
    if not condition:
        raise ValueError(message)


def number(value, label, minimum=0):
    require(type(value) in (int, float) and minimum <= value <= sys.float_info.max,
            f'{label}: finite number >= {minimum} required')
    return value


def integer(value, label, low, high):
    require(type(value) is int and low <= value <= high, f'{label}: integer {low}..{high} required')
    return value


def fields(value, allowed, label, required=''):
    require(isinstance(value, dict), f'{label}: object required')
    unknown = set(value) - set(allowed.split())
    require(not unknown, f'{label}: unknown fields {", ".join(sorted(unknown))}')
    missing = set(required.split()) - set(value)
    require(not missing, f'{label}: missing fields {", ".join(sorted(missing))}')


def text(value, label):
    require(isinstance(value, str) and bool(value.strip()), f'{label}: nonempty text required')
    return value


def rows(packet, key, allowed, required):
    value = packet[key]
    require(isinstance(value, list) and bool(value), f'{key}: nonempty array required')
    for index, item in enumerate(value):
        fields(item, allowed, f'{key}[{index}]', required)
        if 'id' in required.split():
            text(item['id'], f'{key}[{index}].id')
    return value


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f'duplicate JSON field: {key}')
        result[key] = value
    return result


def normalize(packet, root):
    fields(packet, 'schemaVersion source orderExpanded itinerary evidence tracks tempoEvents timeSigEvents events unresolved', 'packet',
           'schemaVersion source orderExpanded itinerary evidence tracks tempoEvents timeSigEvents events')
    require(type(packet['schemaVersion']) is int and packet['schemaVersion'] == 1, 'schemaVersion must be integer 1')
    unresolved = packet.get('unresolved', [])
    require(isinstance(unresolved, list), 'unresolved: array of named questions required')
    for question in unresolved:
        text(question, 'unresolved question')
    source = packet['source']
    fields(source, 'scoreVisible url performance evidenceIds', 'source', 'scoreVisible url performance evidenceIds')
    require(source.get('scoreVisible') is True, 'actual score must be visible; landing/title is insufficient')
    require(text(source['url'], 'source.url').startswith('https://tabs.ultimate-guitar.com/tab/'), 'UG source URL required')
    text(source['performance'], 'source.performance')
    require(packet.get('orderExpanded') is True and isinstance(packet.get('itinerary'), list) and bool(packet['itinerary']),
            'explicit unfolded occurrence itinerary required; no guessed repeats/endings')
    occurrences, previous_end = {}, None
    # ponytail: explicit unfolded itinerary; general score navigation stays in existing parsers/manual review.
    for occurrence in rows(packet, 'itinerary', 'id startBeat endBeat sourceBars', 'id startBeat endBeat sourceBars'):
        start = number(occurrence['startBeat'], 'occurrence start')
        end = number(occurrence['endBeat'], 'occurrence end')
        require(end > start and (previous_end is None or abs(start - previous_end) < 1e-8), 'itinerary must be contiguous')
        text(occurrence['sourceBars'], f"occurrence {occurrence['id']} sourceBars")
        require(occurrence['id'] not in occurrences, 'unique occurrence required')
        occurrences[occurrence['id']] = occurrence
        previous_end = end
    evidence = {}
    for item in rows(packet, 'evidence', 'id path sha256', 'id path sha256'):
        relative = Path(text(item['path'], f"evidence {item['id']} path"))
        require(not relative.is_absolute(), 'evidence path must be relative to the private run')
        text(item['sha256'], f"evidence {item['id']} sha256")
        path = (root / relative).resolve()
        require(path.is_relative_to(root.resolve()), 'evidence must be private run-local files')
        require(item['id'] not in evidence, 'duplicate evidence ID')
        require(path.is_file() and path.stat().st_size <= 10_000_000, 'missing/oversize evidence')
        require(hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256'], 'evidence hash mismatch')
        evidence[item['id']] = item
    require(bool(evidence), 'pinned visible evidence required')

    def cite(ids):
        require(isinstance(ids, list) and bool(ids) and all(isinstance(i, str) and i in evidence for i in ids),
                'evidenceIds: nonempty array of pinned evidence IDs required')
        require(len(set(ids)) == len(ids), 'evidenceIds: duplicate citation')

    cite(source.get('evidenceIds'))
    tracks = {}
    for track in rows(packet, 'tracks', 'id role evidenceIds roleBasis tuningMidi stringOrder capo fretReference', 'id role evidenceIds'):
        require(track['id'] not in tracks, 'duplicate track ID')
        require(track.get('role') in ('melody', 'accompaniment', 'unknown'), 'invalid track role')
        cite(track.get('evidenceIds'))
        if track['role'] != 'unknown' or 'roleBasis' in track:
            text(track.get('roleBasis'), f"track {track['id']} roleBasis")
        tracks[track['id']] = track
    require(bool(tracks), 'actual track data required')
    tempos = rows(packet, 'tempoEvents', 'beat bpm', 'beat bpm')
    require(tempos[0]['beat'] == 0, 'tempo map must start at beat zero')
    previous = -1
    for tempo in tempos:
        fields(tempo, 'beat bpm', 'tempo')
        beat = number(tempo['beat'], 'tempo beat')
        require(beat > previous and number(tempo['bpm'], 'BPM') > 0, 'invalid tempo map')
        previous = beat
    meters = rows(packet, 'timeSigEvents', 'beat timeSig', 'beat timeSig')
    require(meters[0]['beat'] == 0, 'meter map must start at beat zero')
    previous = -1
    for meter in meters:
        fields(meter, 'beat timeSig', 'meter')
        beat = number(meter['beat'], 'meter beat')
        require(isinstance(meter['timeSig'], list) and len(meter['timeSig']) == 2, 'timeSig: [numerator, denominator] required')
        num, den = meter['timeSig']
        integer(num, 'meter numerator', 1, 64)
        integer(den, 'meter denominator', 1, 64)
        require(beat > previous and den & (den - 1) == 0, 'invalid meter map')
        previous = beat

    def seconds(beat):
        total = 0
        for index, tempo in enumerate(tempos):
            end = min(beat, tempos[index + 1]['beat']) if index + 1 < len(tempos) else beat
            if end > tempo['beat']:
                total += (end - tempo['beat']) * 60 / tempo['bpm']
        return total

    events = rows(packet, 'events', 'id track occurrence startBeat durationBeats evidenceIds rest midi string fret tieFrom techniques',
                  'id track occurrence startBeat durationBeats evidenceIds')
    for event in events:
        number(event['startBeat'], f"event {event['id']} startBeat")
        text(event['track'], f"event {event['id']} track")
        text(event['occurrence'], f"event {event['id']} occurrence")
        require('rest' not in event or type(event['rest']) is bool, f"event {event['id']} rest: boolean required")
        if 'tieFrom' in event:
            text(event['tieFrom'], f"event {event['id']} tieFrom")
        require(isinstance(event.get('techniques', []), list), f"event {event['id']} techniques: array required")
    notes, seen, chains, rests = [], set(), {}, []
    for event in sorted(events, key=lambda e: e['startBeat']):
        require(event['id'] not in seen, 'duplicate unfolded event ID')
        seen.add(event['id'])
        cite(event.get('evidenceIds'))
        track = tracks.get(event['track'])
        require(track is not None, 'event has missing track')
        start = number(event['startBeat'], 'attack')
        dur = number(event['durationBeats'], 'duration')
        require(dur > 0, 'duration must be positive')
        occurrence = occurrences.get(event.get('occurrence'))
        require(occurrence is not None and start >= occurrence['startBeat'] and start + dur <= occurrence['endBeat'] + 1e-8,
                'event must fit its explicit unfolded occurrence; split ties at bar boundaries')
        require(not event.get('techniques'), 'technique requires explicit sounding-note interpretation before normalization')
        if event.get('rest') is True:
            require(not any(k in event for k in ('midi', 'string', 'fret', 'tieFrom')), 'rest cannot carry pitch/tie')
            rests.append(event)
            continue
        if 'midi' in event:
            require(not any(k in event for k in ('string', 'fret')), 'choose sounding MIDI or tab, not both')
            midi = integer(event['midi'], 'sounding MIDI', 0, 127)
        else:
            tuning = track.get('tuningMidi')
            require(isinstance(tuning, list) and bool(tuning) and track.get('stringOrder') in ('low-to-high', 'high-to-low'),
                    'per-track sounding tuning and declared string order required')
            for pitch in tuning:
                integer(pitch, 'open-string MIDI', 0, 127)
            require(tuning == sorted(tuning, reverse=track['stringOrder'] == 'high-to-low'), 'tuning contradicts string order')
            capo = integer(track.get('capo'), 'capo', 0, 24)
            require(track.get('fretReference') in ('capo-relative', 'nut-relative'), 'fret reference required')
            string = integer(event.get('string'), 'string index in declared order', 1, len(tuning))
            fret = integer(event.get('fret'), 'fret', 0, 36)
            require(track['fretReference'] != 'nut-relative' or fret >= capo, 'nut-relative fret lies below the capo')
            midi = tuning[string - 1] + fret + (capo if track['fretReference'] == 'capo-relative' else 0)
            integer(midi, 'converted sounding MIDI', 0, 127)
        note = {'id': event['id'], 'track': event['track'], 'role': track['role'], 'midi': midi,
                'start': start, 'dur': dur, 'evidenceIds': event['evidenceIds'], 'originIds': [event['id']]}
        if event.get('tieFrom'):
            old = chains.get(event['tieFrom'])
            require(old is not None and old['originIds'][-1] == event['tieFrom']
                    and old['track'] == note['track'] and old['midi'] == midi
                    and abs(old['start'] + old['dur'] - start) < 1e-8,
                    'tieFrom must name the immediately preceding contiguous same-pitch segment on the same track')
            old['dur'] += dur
            old['originIds'].append(event['id'])
            old['evidenceIds'] = list(dict.fromkeys(old['evidenceIds'] + event['evidenceIds']))
            chains[event['id']] = old
        else:
            notes.append(note)
            chains[event['id']] = note
    require(bool(notes), 'missing actual score notes')
    require(all(rest['startBeat'] + rest['durationBeats'] <= note['start'] + 1e-8
                or rest['startBeat'] >= note['start'] + note['dur'] - 1e-8
                for rest in rests for note in notes if rest['track'] == note['track']),
            'whole-track rest overlaps a sounding note; unresolved voice notation')
    for note in notes:
        note.update(scoreStartSeconds=seconds(note['start']), scoreEndSeconds=seconds(note['start'] + note['dur']))
    return {'schemaVersion': 1, 'status': 'provisional', 'source': source, 'evidence': list(evidence.values()),
            'tracks': list(tracks.values()), 'tempoEvents': tempos, 'timeSigEvents': meters,
            'itinerary': packet['itinerary'], 'notes': notes, 'rests': rests,
            'unresolved': unresolved + ['Manual score accuracy, performance alignment and musical/keyboard acceptance are not certified.'],
            'clock': 'score beats and score seconds only; not the requested live recording'}


def self_test():
    with tempfile.TemporaryDirectory(prefix='keyspilli-ug-') as directory:
        root = Path(directory)
        (root / 'visible.txt').write_text('Authored control, not UG score/music acceptance')
        pin = hashlib.sha256((root / 'visible.txt').read_bytes()).hexdigest()
        packet = {'schemaVersion': 1, 'source': {'scoreVisible': True,
                  'url': 'https://tabs.ultimate-guitar.com/tab/authored-control', 'performance': 'authored', 'evidenceIds': ['e']},
                  'orderExpanded': True, 'itinerary': [{'id': 'p1', 'startBeat': 0, 'endBeat': 4, 'sourceBars': '1'},
                                                       {'id': 'p2', 'startBeat': 4, 'endBeat': 8, 'sourceBars': '1'}],
                  'evidence': [{'id': 'e', 'path': 'visible.txt', 'sha256': pin}],
                  'tracks': [{'id': 'g', 'role': 'unknown', 'evidenceIds': ['e'], 'tuningMidi': [40,45,50,55,59,64],
                              'stringOrder': 'low-to-high', 'capo': 2, 'fretReference': 'capo-relative'}],
                  'tempoEvents': [{'beat': 0, 'bpm': 120}, {'beat': 4, 'bpm': 60}],
                  'timeSigEvents': [{'beat': 0, 'timeSig': [4,4]}],
                  'events': [{'id': 'a', 'occurrence': 'p1', 'track': 'g', 'startBeat': 0.125, 'durationBeats': 0.875, 'string': 5, 'fret': 1, 'evidenceIds': ['e']},
                             {'id': 'b', 'occurrence': 'p1', 'track': 'g', 'startBeat': 1, 'durationBeats': 1, 'string': 5, 'fret': 1, 'tieFrom': 'a', 'evidenceIds': ['e']},
                             {'id': 'r', 'occurrence': 'p1', 'track': 'g', 'startBeat': 2, 'durationBeats': 2, 'rest': True, 'evidenceIds': ['e']},
                             {'id': 'c', 'occurrence': 'p2', 'track': 'g', 'startBeat': 4.125, 'durationBeats': .875, 'string': 5, 'fret': 1, 'evidenceIds': ['e']}]}
        result = normalize(packet, root)
        def extend_tie(p, predecessor):
            p['events'] = [event for event in p['events'] if not event.get('rest')]
            p['events'].append({'id': 'd', 'occurrence': 'p1', 'track': 'g', 'startBeat': 2,
                                'durationBeats': 1, 'string': 5, 'fret': 1, 'tieFrom': predecessor, 'evidenceIds': ['e']})
        chained = copy.deepcopy(packet)
        extend_tie(chained, 'b')
        assert normalize(chained, root)['notes'][0]['originIds'] == ['a', 'b', 'd']
        assert result['status'] == 'provisional' and 'not the requested live recording' in result['clock']
        assert len(result['notes']) == 2 and result['notes'][0]['midi'] == 62
        assert result['notes'][0]['dur'] == 1.875 and result['notes'][1]['scoreStartSeconds'] == 2.125
        nut = copy.deepcopy(packet)
        nut['tracks'][0]['fretReference'] = 'nut-relative'
        for event in nut['events']:
            if 'fret' in event:
                event['fret'] = 3
        assert normalize(nut, root)['notes'][0]['midi'] == 62
        mutations = [('landing', lambda p: p['source'].update(scoreVisible=False)),
                     ('tracks', lambda p: p.update(tracks=[])), ('repeat', lambda p: p.update(orderExpanded=False)),
                     ('pin', lambda p: p['evidence'][0].update(sha256='0'*64)),
                     ('order', lambda p: p['tracks'][0].update(stringOrder='high-to-low')),
                     ('capo', lambda p: p['tracks'][0].update(capo=None)),
                     ('fret', lambda p: p['events'][0].update(fret=-1)),
                     ('tie', lambda p: p['events'][1].update(startBeat=1.1)),
                     ('technique', lambda p: p['events'][0].update(techniques=['bend'])),
                     ('rest', lambda p: p['events'][2].update(startBeat=1.5)),
                     ('occurrence', lambda p: p['events'][3].update(occurrence='p1')),
                     ('unknown-field', lambda p: p['events'][0].update(transpose=12))]
        mutations.extend([
            ('nut-fret', lambda p: p['tracks'][0].update(fretReference='nut-relative')),
            ('boolean-schema', lambda p: p.update(schemaVersion=True)),
            ('numeric-url', lambda p: p['source'].update(url=23)),
            ('numeric-performance', lambda p: p['source'].update(performance=23)),
            ('missing-source', lambda p: p.pop('source')),
            ('non-list-tracks', lambda p: p.update(tracks={'g': p['tracks'][0]})),
            ('missing-track-id', lambda p: p['tracks'][0].pop('id')),
            ('numeric-role-basis', lambda p: p['tracks'][0].update(role='melody', roleBasis=23)),
            ('blank-source-bars', lambda p: p['itinerary'][0].update(sourceBars='  ')),
            ('unhashable-evidence-id', lambda p: p['evidence'][0].update(id=[])),
            ('missing-evidence-path', lambda p: p['evidence'][0].pop('path')),
            ('bad-evidence-path', lambda p: p['evidence'][0].update(path=23)),
            ('bad-citation', lambda p: p['source'].update(evidenceIds=[[]])),
            ('duplicate-citation', lambda p: p['source'].update(evidenceIds=['e', 'e'])),
            ('non-list-tempos', lambda p: p.update(tempoEvents={'beat': 0, 'bpm': 120})),
            ('missing-tempo-bpm', lambda p: p['tempoEvents'][0].pop('bpm')),
            ('missing-meter-beat', lambda p: p['timeSigEvents'][0].pop('beat')),
            ('bad-meter-shape', lambda p: p['timeSigEvents'][0].update(timeSig=[4, 4, 4])),
            ('malformed-event', lambda p: p['events'].insert(0, 'note')),
            ('missing-event-attack', lambda p: p['events'][0].pop('startBeat')),
            ('text-event-attack', lambda p: p['events'][0].update(startBeat='0.125')),
            ('numeric-rest-flag', lambda p: p['events'][0].update(rest=1)),
            ('bad-techniques-type', lambda p: p['events'][0].update(techniques='')),
            ('empty-tie', lambda p: p['events'][1].update(tieFrom='')),
            ('text-unresolved', lambda p: p.update(unresolved='uncertain')),
            ('non-text-unresolved', lambda p: p.update(unresolved=[23])),
            ('oversize-number', lambda p: p['events'][0].update(startBeat=10**1000)),
            ('reused-tie-predecessor', lambda p: extend_tie(p, 'a')),
        ])
        for name, mutate in mutations:
            bad = copy.deepcopy(packet)
            mutate(bad)
            try:
                normalize(bad, root)
            except ValueError:
                continue
            raise AssertionError(f'failed to reject {name}')
        # Exercise the actual CLI: invalid repairs must not destroy a previous good result.
        import subprocess
        packet_path, output_path = root / 'packet.json', root / 'score-model.json'
        packet_path.write_text(json.dumps(packet))
        command = [sys.executable, str(Path(__file__).resolve()), str(packet_path), '--output', str(output_path)]
        completed = subprocess.run(command, capture_output=True, text=True)
        assert completed.returncode == 0, completed.stderr
        assert json.loads(output_path.read_text())['notes'] == result['notes']
        before = output_path.read_bytes()
        for protected in (packet_path, root / 'visible.txt'):
            original_bytes = protected.read_bytes()
            completed = subprocess.run(command[:-1] + [str(protected)], capture_output=True, text=True)
            assert completed.returncode == 1 and 'cannot overwrite' in completed.stderr
            assert protected.read_bytes() == original_bytes and output_path.read_bytes() == before
        bad = copy.deepcopy(packet)
        bad['source']['url'] = 23
        packet_path.write_text(json.dumps(bad))
        completed = subprocess.run(command, capture_output=True, text=True)
        assert completed.returncode == 1 and 'source.url' in completed.stderr and 'Traceback' not in completed.stderr
        assert output_path.read_bytes() == before and not completed.stdout
        for raw in (json.dumps(packet).replace('"schemaVersion": 1', '"schemaVersion": false, "schemaVersion": 1', 1),
                    json.dumps(packet).replace('"scoreVisible": true', '"scoreVisible": false, "scoreVisible": true', 1)):
            packet_path.write_text(raw)
            completed = subprocess.run(command, capture_output=True, text=True)
            assert completed.returncode == 1 and 'duplicate JSON field' in completed.stderr
            assert output_path.read_bytes() == before and not completed.stdout
        assert {p.name for p in root.iterdir()} == {'visible.txt', 'packet.json', 'score-model.json'}
    print(f'UG manual packet: tab/capo, native tempo, rest/tie, explicit repeat controls and {len(mutations)} rejection checks, duplicate JSON and atomic CLI repair checks passed')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('packet', nargs='?', type=Path)
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--output', type=Path, help='Atomically save validated JSON; failures preserve the previous file')
    args = parser.parse_args()
    if args.self_test:
        self_test()
    else:
        if not args.packet:
            parser.error('packet required')
        try:
            packet_bytes = args.packet.read_bytes()
            result = normalize(json.loads(packet_bytes, object_pairs_hook=unique_object), args.packet.parent)
            result['packetSha256'] = hashlib.sha256(packet_bytes).hexdigest()
            payload = json.dumps(result, indent=2, allow_nan=False) + '\n'
            if args.output:
                protected = [args.packet.resolve()] + [(args.packet.parent / e['path']).resolve() for e in result['evidence']]
                require(args.output.resolve() not in protected, 'output cannot overwrite the input packet or pinned evidence')
                pending = None
                try:
                    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=args.output.parent, delete=False) as output:
                        pending = Path(output.name)
                        output.write(payload)
                    pending.replace(args.output)
                finally:
                    if pending is not None:
                        pending.unlink(missing_ok=True)
            else:
                print(payload, end='')
        except (ValueError, KeyError, TypeError, OSError) as error:
            parser.exit(1, f'UG score unresolved: {error}\n')
