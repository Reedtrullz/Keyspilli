#!/usr/bin/env python3
"""Read-only, source-origin gate for a colored-keyboard tutorial song bundle."""

import argparse
from collections import defaultdict
import hashlib
from itertools import permutations
import json
import math
from pathlib import Path
import shutil
import subprocess
import tempfile


def read(path):
    return json.loads(path.read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def parsed_source_notes(midi_path, bundle_dir):
    checkout = next((path for path in (bundle_dir, *bundle_dir.parents)
                     if (path / 'packages/midi/package.json').is_file()), None)
    node = shutil.which('node')
    if not checkout or not node:
        raise RuntimeError('--source-midi requires a Keyspilli checkout and Node on PATH')
    program = ('import {readFileSync} from "node:fs"; '
               'import {parseMidi} from "@keyspilli/midi"; '
               'const notes=parseMidi(new Uint8Array(readFileSync(process.argv[1]))).notes; '
               'process.stdout.write(JSON.stringify(notes.map(n=>({id:n.sourceOrigins?.[0]?.id,'
               'track:n.sourceOrigins?.[0]?.track,midi:n.midi,start:n.start,dur:n.dur}))));')
    result = subprocess.run([node, '--import', 'tsx', '--input-type=module', '-e', program,
                             str(midi_path.resolve())], cwd=checkout, capture_output=True, text=True,
                            check=True, timeout=30)
    return json.loads(result.stdout)


def midi_origin_candidates(notes, colors, parsed):
    tracks = sorted({note['track'] for note in parsed if note['track'] is not None})
    if len(tracks) != len(colors) or len(parsed) != len(notes):
        return []
    candidates = []
    for order in permutations(colors) if len(colors) <= 3 else ():
        source = {}
        source_matches = 0
        for track, color in zip(tracks, order):
            expected = sorted((note for note in notes if note['color'] == color),
                              key=lambda note: (round(note['startSec'] * 1920), note['midi'],
                                                note.get('durationSec', 0)))
            actual = sorted((note for note in parsed if note['track'] == track),
                            key=lambda note: (round(note['start'] * 1920), note['midi'], note['dur']))
            if len(expected) != len(actual):
                break
            for midi_note, extracted in zip(actual, expected):
                if midi_note['midi'] == extracted['midi']:
                    source_matches += 1
                source[midi_note['id']] = extracted
        if len(source) == len(notes):
            candidates.append((source_matches, order, source))
    return candidates


def inspect(extraction_path, bundle_dir, delivery_root=None, source_midi=None):
    extraction = read(extraction_path)
    bundle = read(bundle_dir / 'bundle.json')
    advanced_path = bundle_dir / 'artifacts/a/notes.json'
    advanced = read(advanced_path)
    root = bundle_dir.parent
    delivery_root = delivery_root or root
    notes = extraction['notes']
    colors = sorted({note['color'] for note in notes})
    lanes_by_color = {color: sorted((note for note in notes if note['color'] == color),
                                    key=lambda note: (round(note['startSec'] * 1920), note['midi']))
                      for color in colors}
    origins = [(origin['id'], note.get('midi')) for note in advanced['notes']
               for origin in note.get('sourceOrigins', [])]
    source_sha = digest(source_midi) if source_midi else None
    expected_sha = bundle['baseId'].removeprefix('upload-')
    fingerprint_ok = not source_midi or len(expected_sha) != 64 or source_sha == expected_sha
    source_matches = None
    if source_midi and fingerprint_ok:
        candidates = midi_origin_candidates(notes, colors, parsed_source_notes(source_midi, bundle_dir))
        source_matches, track_colors, source = max(candidates, default=(0, (), {}),
                                                   key=lambda row: row[0])
        mapping_method = 'source-midi-parser'
        identity_consistent = bool(origins) and source_matches == len(notes) and len(source) == len(notes)
    else:
        candidates = []
        for order in permutations(colors) if len(colors) <= 3 else ():
            lookup = {f'midi:{track}:{index}': note
                      for track, color in enumerate(order)
                      for index, note in enumerate(lanes_by_color[color])}
            mapped_count = sum(source_id in lookup for source_id, _ in origins)
            matches = sum(source_id in lookup and midi == lookup[source_id]['midi']
                          for source_id, midi in origins)
            candidates.append((matches, mapped_count, order, lookup))
        _, _, track_colors, source = max(candidates, default=(0, 0, (), {}),
                                         key=lambda row: (row[0], row[1]))
        mapping_method = 'attack-ordinal-heuristic'
        identity_consistent = False if source_midi else bool(origins) and sum(
            source_id in source and midi == source[source_id]['midi'] for source_id, midi in origins
        ) / len(origins) >= 0.99 and sum(source_id in source for source_id, _ in origins) / len(origins) >= 0.99
    mapped = sum(source_id in source for source_id, _ in origins)
    pitch_matches = sum(source_id in source and midi == source[source_id]['midi']
                        for source_id, midi in origins)
    kept = {origin['id'] for note in advanced['notes'] for origin in note.get('sourceOrigins', [])}
    unknown = kept - source.keys()
    missing = source.keys() - kept
    windows = defaultdict(lambda: {'input': 0, 'kept': 0, 'dropped': 0})
    lanes = defaultdict(lambda: {'input': 0, 'kept': 0, 'dropped': 0})
    dropped = []
    for source_id, note in source.items() if identity_consistent else ():
        lane = note['color'] + ' keys'
        window = f"{int(note['startSec'] // 30) * 30}-{int(note['startSec'] // 30) * 30 + 30}s"
        for bucket in (windows[window], lanes[lane]):
            bucket['input'] += 1
            bucket['dropped' if source_id in missing else 'kept'] += 1
        if source_id in missing:
            dropped.append({'id': source_id, 'seconds': note['startSec'], 'midi': note['midi'], 'lane': lane})

    unresolved = []
    def flag(code, evidence):
        unresolved.append({'code': code, 'evidence': evidence})

    if extraction.get('status') != 'validated':
        flag('extraction-review', f"extractor status: {extraction.get('status')}")
    if extraction.get('containsMelody') is not True:
        flag('melody-unverified', f"containsMelody: {extraction.get('containsMelody')}")
    timing = extraction.get('timingEvidence') or {}
    if timing.get('metricalTempoStatus') != 'verified':
        flag('tempo-unverified', f"metrical tempo: {timing.get('metricalTempoStatus')}; encoding BPM is not musical tempo")
    gaps = (extraction.get('audioCoverage') or {}).get('unrepresentedAudioIntervals') or []
    if gaps:
        flag('audio-coverage', f'{len(gaps)} unrepresented active-audio intervals; inspect opening and ending')
    if extraction.get('sourceRights') != 'verified':
        flag('source-rights', f"source rights: {extraction.get('sourceRights')}")
    if source_midi and not fingerprint_ok:
        flag('source-midi-fingerprint-mismatch', 'source MIDI SHA-256 differs from upload base ID; origin map not trusted')
    if not identity_consistent:
        flag('source-origin-map-unverified',
             f'{pitch_matches}/{len(origins)} output origin references match extraction pitch; '
             f'source MIDI pitch reconciliation: {source_matches}/{len(notes)}; '
             'retention cannot be counted until actual parser IDs are reconciled')
    elif missing or unknown:
        flag('source-origin-loss', f'{len(missing)} dropped; {len(unknown)} output origins not mapped to extraction; classify by musical role')
    if identity_consistent and source_midi and pitch_matches < len(origins):
        flag('source-pitch-changed', f'{len(origins) - pitch_matches} retained origin references changed pitch; inspect musical role')

    timeline_path = bundle_dir / 'timeline.json'
    if timeline_path.is_file():
        chords = read(timeline_path).get('chords', [])
        inferred = sum(chord.get('inferred') is True or chord.get('sourceKind') == 'inferred' for chord in chords)
        if inferred:
            flag('harmony-unverified', f'{inferred}/{len(chords)} labels inferred; align an independent chart or source bass')
    else:
        inferred = None
        flag('chords-missing', 'no timeline.json in bundle')

    diagnosis_path = root / 'prepared' / bundle['baseId'] / 'diagnosis.json'
    if diagnosis_path.is_file():
        findings = read(diagnosis_path).get('findings', [])
        flagged = [finding for finding in findings if finding.get('classification') == 'unresolved']
        if flagged:
            flag('proxy-review', f'{len(flagged)} unresolved diagnostic intervals; classify against source, not by threshold')
    else:
        flagged = []
        flag('diagnosis-missing', 'prepared diagnosis not found')

    alignment_path = delivery_root / 'previews/source-alignment-check.json'
    if alignment_path.is_file():
        alignment = read(alignment_path)
        method = str(alignment.get('method', '')).lower()
        if any(term in method for term in ('chroma', 'pitch-class', 'onset')):
            controls = alignment.get('negativeControls')
            windows_checked = alignment.get('localWindows')
            required = ('shifted', 'shuffled', 'constantProfile')
            valid_controls = isinstance(controls, dict) and set(required) <= controls.keys()
            valid_controls = valid_controls and all(
                isinstance(controls[key], (int, float)) and math.isfinite(controls[key]) for key in required)
            if not valid_controls or not isinstance(windows_checked, list) or not windows_checked:
                flag('alignment-unproven', 'alignment score lacks numeric shifted/shuffled/constant-profile controls and local phrase comparisons')
            else:
                score_key = 'onsetCorrelation' if 'onset' in method else 'meanChromaSimilarity'
                score = (alignment.get('bestFit') or {}).get(score_key)
                if not isinstance(score, (int, float)) or not math.isfinite(score) or score <= max(controls[key] for key in required):
                    flag('alignment-nondiscriminating', 'true alignment does not exceed every negative control')
                details = alignment.get('shiftDetails') or alignment.get('shiftedControlScoresByOffsetSeconds') or controls.get('shiftedDetail')
                if isinstance(details, dict) and any(
                    isinstance(value, (int, float)) and math.isfinite(value) and value > controls['shifted']
                    for value in details.values()):
                    flag('alignment-unproven', 'shifted control summary is weaker than a detailed shifted score')
                searched = 'grid search' in method or \
                    'searchRangeSeconds' in (alignment.get('bestFit') or {})
                if searched and alignment.get('negativeControlsMatchedSearch') is not True:
                    flag('alignment-unproven', 'best fit was searched, but negative controls lack the same search budget')
    else:
        flag('alignment-missing', 'no source-alignment-check.json')
    for name in ('phrase-map.md', 'musical-assessment.md', 'manifest.json'):
        if not (delivery_root / name).is_file():
            flag('delivery-file-missing', name)
    if not any((directory / name).is_file() for directory in (delivery_root, delivery_root.parent)
               for name in ('import.mts', 'import-command.txt', 'import-recipe.md', 'README.md')):
        flag('delivery-file-missing', 'import recipe')
    for mode in ('original', 'chords'):
        if not any((delivery_root / name).is_file() for name in
                   (f'{mode}-preview.mp3', f'{mode}-preview.wav', f'previews/{mode}.mp3', f'previews/{mode}.wav',
                    f'previews/{mode}-preview.mp3', f'previews/{mode}-preview.wav')):
            flag('delivery-file-missing', f'{mode} preview')

    return {
        'status': 'provisional',
        'scope': 'structural triage only; this script never certifies musical quality or source rights',
        'inputs': {'extraction': str(extraction_path), 'extractionSha256': digest(extraction_path),
                   'sourceMediaSha256': extraction.get('sourceSha256'), 'advancedNotes': str(advanced_path),
                   'advancedNotesSha256': digest(advanced_path), 'baseId': bundle['baseId'],
                   'deliveryRoot': str(delivery_root), 'sourceMidi': str(source_midi) if source_midi else None,
                   'sourceMidiSha256': source_sha},
        'retention': {'status': ('source-midi-reconciled' if source_midi else 'pitch-consistent')
                      if identity_consistent else 'unverified',
                      'input': len(notes), 'kept': len(source.keys() & kept) if identity_consistent else None,
                      'dropped': len(missing) if identity_consistent else None,
                      'unknownOutputOrigins': sorted(unknown) if identity_consistent else [],
                      'mapping': {'method': mapping_method, 'trackColors': list(track_colors),
                                  'sourceMidiPitchMatches': source_matches,
                                  'originReferences': len(origins), 'mappedReferences': mapped,
                                  'pitchMatches': pitch_matches},
                      'byLane': dict(sorted(lanes.items())),
                      'by30SecondWindow': dict(sorted(windows.items(), key=lambda item: int(item[0].split('-')[0]))),
                      'droppedEvents': sorted(dropped, key=lambda row: (row['seconds'], row['id']))},
        'unrepresentedAudioIntervals': gaps, 'inferredChordLabels': inferred,
        'unresolvedDiagnosticIntervals': [
            {key: finding.get(key) for key in ('kind', 'startSeconds', 'endSeconds')}
            for finding in flagged],
        'unresolved': unresolved,
    }


def self_test():
    with tempfile.TemporaryDirectory(prefix='keyspilli-gate-') as directory:
        root = Path(directory)
        bundle = root / 'bundle'
        (bundle / 'artifacts/a').mkdir(parents=True)
        extraction = root / 'extracted.json'
        extraction.write_text(json.dumps({'status': 'experimental-review-required', 'containsMelody': None,
            'sourceRights': 'unverified', 'timingEvidence': {'metricalTempoStatus': 'unknown'},
            'audioCoverage': {'unrepresentedAudioIntervals': [{'rangeSeconds': [0, 4]}]},
            'notes': [{'color': 'blue', 'startSec': 0, 'midi': 48},
                      {'color': 'green', 'startSec': 35, 'midi': 72}]}))
        (bundle / 'bundle.json').write_text(json.dumps({'baseId': 'example'}))
        (bundle / 'artifacts/a/notes.json').write_text(json.dumps({'notes': [
            {'midi': 48, 'sourceOrigins': [{'id': 'midi:0:0'}]}]}))
        (bundle / 'timeline.json').write_text(json.dumps({'chords': [{'inferred': True}]}))
        (root / 'previews').mkdir()
        (root / 'previews/source-alignment-check.json').write_text(json.dumps({
            'method': 'pitch-class cosine', 'bestFit': {'meanChromaSimilarity': 0.94}}))
        report = inspect(extraction, bundle)
        assert report['retention']['dropped'] == 1
        assert report['retention']['status'] == 'pitch-consistent'
        assert report['retention']['byLane']['green keys']['dropped'] == 1
        assert {'melody-unverified', 'tempo-unverified', 'audio-coverage',
                'harmony-unverified', 'alignment-unproven'} <= {
            row['code'] for row in report['unresolved']}
        assert {'import recipe', 'original preview', 'chords preview'} <= {
            row['evidence'] for row in report['unresolved'] if row['code'] == 'delivery-file-missing'}
        assert report['status'] == 'provisional'
        (root / 'previews/source-alignment-check.json').write_text(json.dumps({
            'method': 'pitch-class cosine', 'bestFit': {'meanChromaSimilarity': 0.94},
            'negativeControls': {'shifted': 0.93, 'shuffled': 0.92, 'constantProfile': 0.95},
            'localWindows': [{'sourceSeconds': [0, 30]}]}))
        assert 'alignment-nondiscriminating' in {row['code'] for row in inspect(extraction, bundle)['unresolved']}
        alignment = read(root / 'previews/source-alignment-check.json')
        alignment['method'] += '; grid search over offsets'
        (root / 'previews/source-alignment-check.json').write_text(json.dumps(alignment))
        assert 'alignment-unproven' in {row['code'] for row in inspect(extraction, bundle)['unresolved']}
        alignment['negativeControlsMatchedSearch'] = True
        alignment['shiftDetails'] = {'10': 0.98}
        (root / 'previews/source-alignment-check.json').write_text(json.dumps(alignment))
        assert 'alignment-unproven' in {row['code'] for row in inspect(extraction, bundle)['unresolved']}
        delivery = root / 'delivery'
        (delivery / 'previews').mkdir(parents=True)
        for name in ('phrase-map.md', 'musical-assessment.md', 'manifest.json', 'import-recipe.md'):
            (delivery / name).touch()
        for mode in ('original', 'chords'):
            (delivery / 'previews' / f'{mode}-preview.mp3').touch()
        report = inspect(extraction, bundle, delivery)
        assert not any(row['code'] == 'delivery-file-missing' for row in report['unresolved'])
        assert report['inputs']['deliveryRoot'] == str(delivery)
        (bundle / 'artifacts/a/notes.json').write_text(json.dumps({'notes': [
            {'midi': 48, 'sourceOrigins': [{'id': 'midi:1:0'}]},
            {'midi': 72, 'sourceOrigins': [{'id': 'midi:0:0'}]}]}))
        reversed_tracks = inspect(extraction, bundle, delivery)
        assert reversed_tracks['retention']['status'] == 'pitch-consistent'
        assert reversed_tracks['retention']['mapping']['trackColors'] == ['green', 'blue']
        (bundle / 'artifacts/a/notes.json').write_text(json.dumps({'notes': [
            {'midi': 70, 'sourceOrigins': [{'id': 'midi:0:0'}]},
            {'midi': 49, 'sourceOrigins': [{'id': 'midi:1:0'}]}]}))
        bad = inspect(extraction, bundle, delivery)
        assert bad['retention']['status'] == 'unverified' and bad['retention']['dropped'] is None
        assert 'source-origin-map-unverified' in {row['code'] for row in bad['unresolved']}
        parsed = [{'id': 'midi:0:0', 'track': 0, 'midi': 72, 'start': 1, 'dur': 2},
                  {'id': 'midi:1:0', 'track': 1, 'midi': 48, 'start': 0, 'dur': 3}]
        mapped = midi_origin_candidates(read(extraction)['notes'], ['blue', 'green'], parsed)
        assert max(mapped, key=lambda row: row[0])[0] == 2
        assert max(mapped, key=lambda row: row[0])[2]['midi:0:0']['midi'] == 72
        overlapping = [{'color': 'blue', 'startSec': 0, 'durationSec': 4, 'midi': 48},
                       {'color': 'blue', 'startSec': 1, 'durationSec': 1, 'midi': 50}]
        completion_order = [{'id': 'midi:0:0', 'track': 0, 'midi': 50, 'start': 1, 'dur': 1},
                            {'id': 'midi:0:1', 'track': 0, 'midi': 48, 'start': 0, 'dur': 4}]
        mapped = midi_origin_candidates(overlapping, ['blue'], completion_order)
        assert mapped[0][0] == 2 and mapped[0][2]['midi:0:0']['midi'] == 50
    print('Tutorial gate self-test passed.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('extraction', nargs='?', type=Path)
    parser.add_argument('bundle', nargs='?', type=Path)
    parser.add_argument('--output', type=Path, help='write a new JSON receipt without replacing existing work')
    parser.add_argument('--delivery-root', type=Path, help='directory containing the final manifest, phrase map, import recipe and previews')
    parser.add_argument('--source-midi', type=Path, help='exact MIDI ingested to make this bundle; reconciles parser origin IDs')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        self_test()
    else:
        if not args.extraction or not args.bundle:
            parser.error('Provide extracted.json and the prepared bundle directory.')
        result = json.dumps(inspect(args.extraction.resolve(), args.bundle.resolve(),
                                    args.delivery_root.resolve() if args.delivery_root else None,
                                    args.source_midi.resolve() if args.source_midi else None), indent=2) + '\n'
        if args.output:
            with args.output.open('x') as destination:
                destination.write(result)
            print(args.output)
        else:
            print(result)
