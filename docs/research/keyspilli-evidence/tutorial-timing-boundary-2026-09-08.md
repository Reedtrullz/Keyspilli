# Tutorial timing boundary — 2026-09-08

Phase 4 remains incomplete. Offline attack-pulse evidence and MIDI clock helpers are tested; the source reduction now normalizes a variable tempo map through native elapsed seconds into its fixed output clock, but the catalogue/player chain does not preserve the variable musical beat grid. No musical BPM, meter, bar alignment, real-source beat accuracy, or end-to-end variable-tempo playback acceptance is established by these checks.

## Verified code boundary

Anchors below refer to the inspected working tree and can shift with subsequent edits.

| Anchor | Observed behavior and implication |
| --- | --- |
| `services/transcribe/src/tutorial_keys.py:179` | `save_midi` currently writes 500000 microseconds/quarter and converts seconds with 1920 ticks/second at 960 PPQ. This preserves elapsed event time at a fixed encoding clock; 120 BPM is not detected song tempo. |
| `packages/midi/src/parse.ts:231` and `:261` | `midiTickToNativeSeconds` and `midiBeatToNativeSeconds` integrate source tempo events, including MIDI's default before the first event. These are reusable for explicit normalization. |
| `packages/midi/src/types.ts:112` and `:178` | `ParsedMidi` carries `tempoEvents`; `Variant` only carries scalar `tempoBpm` and `timeSig`. The map has no variant representation. |
| `services/transcribe/src/tutorial-route.ts:128` | Tutorial structural validation calls `buildVariants(parseMidi(midi), ..., {arrangementProfile:'source', maxDurBeats:null})`. This is the affected route. |
| `packages/midi/src/simplify.ts:2745`, `:2794`, `:3238` | `buildVariants` now integrates differing source tempo events into a scalar source clock before reduction, including supplied chord endpoints and total duration. It subsequently quantizes notes to 0.125 beats and returns scalar tempo. Equivalent mapped and constant-clock sources now yield identical variants; variants remain transformed rather than exact accepted source events. |
| `packages/midi/src/metal-arrange.ts:3343` | The separate metal path demonstrates native-seconds normalization into a constant reference clock and explicitly clears `tempoEvents`. This preserves elapsed timing during normalization but intentionally loses the variable beat grid; the source reduction now uses the same existing native-seconds integration utility. |
| `packages/midi/src/writeMidi.ts:85` and `:99` | Variant MIDI writing accepts a single BPM and emits its constant tempo. |
| `packages/player-core/src/engine.ts:38` and `:322` | Player song configuration uses a scalar tempo; chord timing uses scalar `beatToSec`. Full map-aware musical scheduling is not established. |
| `packages/catalog/src/ingest.ts:378` | Catalogue calibration/playback provenance accepts transcription tempo source but otherwise treats YouTube as detected. Encoding-only tutorial timing must explicitly use `default`, not that inferred detected label. |
| `packages/catalog/src/artifact-manifest.ts:19` | Existing `TempoSource` includes `default`; it does not encode unknown meter, pulse confidence, or variable-tempo acceptance. |

## Offline interface and evidence

`services/transcribe/src/tutorial_timing.py` adds three helpers:

- `estimate_timing(audio, rate=22050)` accepts finite mono audio up to 600 seconds. It returns `unknown` for silence, insufficient attacks, irregular subdivisions, and unsupported local variation. Regular strong attacks can produce `pulse-estimated`, `pulseBpm`, attack timestamps and provisional tempo segments. `bpm` remains null and `metricalTempoStatus` remains `unknown`. Confidence explicitly concerns attack-pulse regularity, not the metrical interpretation or calibrated musical correctness.
- `tempo_events(timing, ppq=960)` converts provisional segments to absolute MIDI `{tick, tempo}` points. Unknown evidence produces the 500000 microseconds/quarter encoding default. Duplicate segment times and segments collapsing to the same tick are rejected.
- `seconds_to_tick(seconds, events, ppq=960)` integrates the exact rounded tempo map before quantizing each note endpoint. Invalid/nonfinite and duplicate MIDI tempo points are rejected. It is available for offline experiments, not integrated into source variants.

Only existing numpy and mido were used. Scipy and librosa are absent from the inspected environment. No dependencies were installed and no remote audio was downloaded. Disk check before work reported 31 GiB free.

Run:

```sh
output/tutorial-recovery/venv/bin/python services/transcribe/test/test_tutorial_timing.py
```

Result: **6 tests passed**. Coverage: constant synthetic 100 BPM clicks; sustained smoothly changing click spacing; silence and irregular attacks returning unknown; real mido serialization/readback of event seconds across three tempo segments within 0.4 ms; invalid audio; nonfinite/duplicate/collapsed tempo points. These synthetic checks do not establish recognition quality on piano tutorials. Equal attack spacing alone cannot distinguish quarter notes from subdivisions or determine a downbeat.

## Safe staged integration

1. Keep the accepted extraction's original note seconds and fixed encoding-clock MIDI unchanged. Store timing evidence separately in the extraction/receipt metadata; label 120 as encoding/default and musical tempo/meter as unknown. Do not activate provisional bar, metronome or quantization claims from pulse regularity.
2. Implemented: `buildVariants` integrates every mapped note/chord start and end through `midiBeatToNativeSeconds` before reduction. Preserve the exact extraction separately and identify variants as simplified/quantized. Existing explicit tempo overrides remain intentional playback-speed changes. Three regression cases verify equivalent mapped/fixed-clock reduction, delayed first tempo, and supplied chords. Grid-aligned advanced MIDI endpoints retain elapsed times within 1 ms after writing and parsing; this does not excuse or hide off-grid quantization.
3. Before enabling variable-tempo delivery, carry a validated tempo map through variant schema, artifact writers, catalogue provenance and player scheduling. Test note endpoints, initial silence, tempo boundaries, chord/metronome/measure alignment and playback-speed scaling together. Establish meter/downbeat interpretation independently and review against the same tutorial audio.

The authorized scalar-clock normalization is implemented and tested. The MIDI package typecheck and 122 tests across `midi.test.ts` and `source-tempo-normalization.test.ts` pass. Variable musical-grid delivery and real-audio/listening acceptance remain pending; phase 4 must not be described as complete on these structural checks. No provisional pulse is promoted to verified musical BPM.
