# Backing-rhythm repair checkpoint

Date: 2026-09-17
Branch: `codex/backing-rhythm-repair`
Base: deployed `origin/main` at `0a30d357ca3d646a817ac63380549fea9cdecee8`
Scope: read-only source/runtime reproduction and a bounded implementation contract. No production code, catalogue data, or deployment was changed.

## Checkpoint status

This is the pre-implementation contract requested after the first root-cause report. The evidence supports a narrow repair:

- preserve a reviewed source voice and its rests;
- preserve source accompaniment attacks/voicings as ordinary timed `Note` events where they are credible;
- use a named, beat-aware approximation only when a credible accompaniment lane is absent;
- keep chord names as harmonic annotation for this style;
- send melody-mode support through the existing `noteOn` path exactly once;
- fix false UG classification in a separate small change and regression.

The contract is not yet a catalogue-wide melody rule. The raw source MIDI for Blackbird and Oops does not carry semantic hand/voice labels; the two-staff MusicXML in the published variant is useful bounded artifact evidence, not independent musical acceptance.

## Reproduction boundary and actual selected source

The probe followed the player path rather than inspecting only raw `notes.json`:

```text
getSongDetail(id)
  -> resolveChordSources(data)
  -> selectChordSource(resolution, "auto")
  -> buildMelodyAccompaniment(data.notes, selected.chords, ...)
```

The selected source for all three songs is a generated fallback derived from the selected `a/notes.json`. There is no verified UG chart for any of these three target artifacts.

| Song | Manifest source | Selected player source | Current selected events | Current fallback reason |
| --- | --- | --- | ---: | --- |
| Blackbird | `standard`, `manifest:the-beatles-blackbird.mid` | `auto`, provenance `variant:a:notes.json` | 68 | `chart artifact unavailable; derived from a/notes.json` |
| Oops I Did It Again | `standard`, `manifest:britney-spears-oops-i-did-it-again.mid` | `auto`, provenance `variant:a:notes.json` | 65 | `chart artifact unavailable; derived from a/notes.json` |
| Hell You Call a Dream | `youtube`, `youtube-job:re2-hellyoucall` | `auto`, provenance `variant:a:notes.json` | 118 | `chart artifact unavailable; derived from a/notes.json` |

The raw detail bundle has `chordSources.ug = null` for all three. The current web resolver nevertheless reports a non-null `resolution.ug` because its source-map scan sees the auto label `UG + generated fallback`; this is the separate false-UG defect below. The current catalog builder also gives a fallback-only auto projection that same misleading label.

## Oops diagnosis — the third reported failure

Canonical manifest facts:

- source: standard MIDI, `manifest:britney-spears-oops-i-did-it-again.mid`;
- arrangement profile: learner;
- tempo: 95 BPM, 4/4;
- selected `a` variant: 1,897 notes, 462 labeled `L`, 1,435 labeled `R`;
- `variant.xml` contains two staff/voice lanes; MusicXML parsing yields the same 1,897 notes, with 462 staff-2/`L` notes and 1,435 staff-1/`R` notes.

The original seed MIDI is format 0 with one track and 3,343 notes and carries no hand labels. Therefore the two-staff evidence is an artifact-level realization of the selected learner variant. It is strong enough for a bounded source-lane contract, but not a license to treat `hand` as universal melody truth.

### Identifiable intro voice and rest

The published two-staff artifact has no upper/staff-1 note in beats 0–16. The lower/staff-2 figure has 23 events in 15 attack groups:

```text
attack starts: 0, 0.5, 1.5, 2.5, 3, 5, 5.5, 5.75, 6,
               8, 8.5, 9.5, 10.5, 11, 12
representative notes: (37,0,.375), (44,0,.5), (49,0,.5),
                      (59,.5,.125), (37,1.5,.5), (44,1.5,.5),
                      (49,1.5,.5), ... , (47,12,6), all lower/L
```

This is the relevant voice-level proof. It is not “L is low, therefore L is accompaniment”; it is “the identifiable upper source lane is resting for the entire intro, while the lower lane contains the repeated phrase.”

The next two bounded windows show the lane relationship changing in the source artifact:

| Window | Source events / attacks | Source lane evidence | Automatic melody | Right-hand selection |
| --- | ---: | --- | --- | --- |
| 0–16, `Intro 1` | 23 / 15 | 23 `L`, 0 `R`; upper lane is a rest | 15 notes, all `L` | 0 notes; rest preserved |
| 16–32, opening | 37 / 25 | 33 `L`; upper dyads at beats 16 and 24, 4 `R` notes | 25 notes, all `L`; all 4 upper events omitted | 4 notes, all `R`, starts 16 and 24 |
| 32–48 | 26 / 22 | 24 `L`, 2 `R`; upper entry at beat 32 | 22 notes, all `L` | 2 notes, all `R` |
| 48–68, `C#5` span | 55 / 30 | 26 `L`, 29 `R` | 30 notes, 20 `L` / 10 `R`; no generated support | 29 notes, all `R`; one 20-beat chord block |

The source opening includes the recognizable upper dyads `(73,16,2)`, `(85,16,2)`, `(73,24,1.875)`, `(85,24,1.875)` while the lower repeated figure continues. Automatic selection protects the lower attack groups instead of the upper lane. The right-hand selection protects the four upper events and leaves the intro rest empty.

The current `C#5` span demonstrates the rhythm loss independently of the melody-role issue:

```text
source:       55 events, 30 attack groups, 26 L / 29 R
automatic:    no support event; fallback for the span
right-hand:   one C#5 block [49,56], start 48, duration 20 beats
```

That block is the current chord playback projection, not the source accompaniment rhythm. It replaces 55 source events with one sustained attack when the right-hand correction is selected.

### Correct aggregate metrics

These counts are descriptive only; they do not prove a wrong melody by themselves:

| Selection | Melody | Melody lanes | Generated support | Generated/fallback beats |
| --- | ---: | --- | ---: | ---: |
| automatic | 614 | 152 `L`, 462 `R` | 34 chord events / 94 support tones | 100.25 / 235.75 |
| right-hand | 1,435 | 0 `L`, 1,435 `R` | 65 chord events / 174 support tones | 288 / 48 |

The evidence for the automatic failure is the bounded staff/phrase comparison above, not the low-pitch or left-hand totals.

## Blackbird bounded comparison

Blackbird is a standard learner artifact at 120 BPM in 4/4. Its two-staff variant has 521 lower/`L` and 548 upper/`R` notes. The raw seed MIDI is format 1 with seven tracks but no hand labels, so the same bounded-artifact caveat applies.

The `Am/Em` phrase at beats 14–26.5 contains 47 source events in 30 attack groups: 17 lower/`L` accompaniment candidates and 30 upper/`R` phrase events.

| Output | Melody events | Support realization in the current code |
| --- | ---: | --- |
| Source window | 47, 17 `L` / 30 `R` | 17 lower-lane attack events with the source rhythm |
| Automatic current | 30, 4 `L` / 26 `R` | one `Am` block `[45,48,52]`, start 14, duration 12.5 beats |
| Right-hand current | 30, all `R` | one `Am` block `[45,48,52,57]`, start 14, duration 12.5 beats |

The current generated block is a useful harmonic label/voicing check, but it does not represent the 17 lower-lane source attacks. The candidate should retain the upper phrase and lower source events for this bounded phrase, with `Am`/`Em` labels remaining annotation.

The `Cm/G` window at 36.5–40 gives the same pattern at a shorter scale: 15 source events, 7 lower/`L` and 8 upper/`R`; current automatic output is one `Cm` block `[36,39,43]` for 3.5 beats, while the source lower lane has seven timed attacks.

## Hell bounded comparison

Hell is a legacy YouTube/Basic Pitch import at 99 BPM in 4/4. Its manifest has no source arrangement metadata or verified chart. The selected source is explicitly `youtube-job:re2-hellyoucall`, but the chord timeline is still the generated `a/notes.json` fallback.

The source is R-dominant in useful bounded phrase windows, but its L events are not a verified semantic accompaniment track. This supports a conservative, windowed contract only:

| Window | Source events / lanes / attacks | Current automatic output | Current chord replacement |
| --- | --- | --- | --- |
| 15.5–18, `Fm7` | 8 events, 1 `L` / 7 `R`, 4 attacks | 4 melody events, all `R` | one `[41,44,48,51,53]` block for 2.5 beats |
| 28–45.25, `C5` | 17 events, 1 `L` / 16 `R`, 13 attacks | 13 melody events, all `R` | one `[48,55]` block for 17.25 beats |
| 45.25–56.25, bridge | 51 events, 18 `L` / 33 `R`, 33 attacks | 33 melody events, 5 `L` / 28 `R`; later fallback | `Csus4`/`C5` blocks, then fallback at 51.75 |
| 56.25–59.5, `A#5/Fm` | 19 events, 13 `L` / 6 `R`, 7 attacks | 7 melody events, all `L` | `A#5` block, then fallback |

The `Fm7` and `C5` windows show why a global “L is accompaniment” rule is unsafe even though R-dominance is useful evidence: the legacy transcription has only one L event in each window. The candidate may preserve those source events, but it must not claim that the sparse source lane reproduces the recording. If a bounded window has no credible source accompaniment material, the fallback must be explicitly named `quarter-note chord-quality pulse`: one compact parseable-chord support attack on each integer beat, with a short beat-bounded duration. This is a playable approximation, not a promise to recreate the song.

## Candidate contracts

### Shared contract

1. Melody selection is source- and window-aware. Hand counts, low-note counts, highest pitch, or a single generic splitter are not acceptance evidence.
2. A reviewed source lane owns its attacks and rests. No support generator may invent melody events in a selected melody rest; source accompaniment may continue through that rest.
3. Where a credible accompaniment lane exists, retain its source `(midi,start,dur,vel)` attacks after a bounded density reduction and route the support through the L note path. Do not collapse them into one event per chord span.
4. Where no credible accompaniment lane exists, use the named `quarter-note chord-quality pulse` only in the explicitly bounded gap and report it as an approximation.
5. Chord names and their source/inference provenance remain harmonic annotation. They are not a second audio channel for Melody + accompaniment.
6. Original arrangement mode remains unchanged. Bass + chords keeps its existing chord playback purpose unless separately changed.

### Blackbird contract — `B1-source-lane-rhythm`

- Treat upper/staff-1 and lower/staff-2 as bounded source lanes only for the reviewed standard artifact windows above.
- Preserve the upper phrase, including its exact attack timing and rests.
- Emit a reduced lower-lane projection as ordinary `Note` support events, preserving source onset, duration, velocity, and L hand styling at actual attacks.
- Keep `Am`, `Em`, `Cm`, and `G/B` labels for annotation/chord practice; do not also schedule their generated voicings for this style.
- Comparison window: 14–26.5 should contain the 30 upper phrase events and 17 lower source support events, rather than one sustained `Am` audio block.

### Oops contract — `B3-staff-rest-and-rhythm`

- For this standard two-staff learner artifact, the explicit user-confirmed RH selection may use staff-1/R as the melody lane in the reviewed sections and preserve an empty staff-1 lane as an actual melody rest. Automatic selection remains inferred and must be reported separately; this is not a universal R==melody rule.
- With explicit RH selection in beats 0–16, melody output must be empty; the 23 lower/staff-2 events remain timed support events with their 15 source attack groups. The default automatic selection currently protects 15 lower events instead, which is a known semantic limitation rather than a resolved acceptance claim.
- With explicit RH selection in beats 16–48, preserve the upper dyads/entries at 16, 24, and 32 while retaining the repeated lower figure as support.
- With explicit RH selection in beats 48–68, preserve the 29 upper-lane events and 26 lower-lane source events. The current one-block `[49,56]` C#5 realization is not acceptable as the audio realization for this candidate.
- Keep C#5/G#5/B5 labels as annotation. No chord-event playback may be added alongside the retained support notes.
- The automatic selector may remain generic for unreviewed sources; this contract must not be generalized to every artifact with `hand` fields.

### Hell contract — `B4-r-dominant-windowed`

- Do not claim a universal source voice. Apply the reviewed R-dominant selection only to named windows where the phrase evidence supports it.
- Retain source L events as support when present and reviewed; preserve R rests and exact source onsets.
- In a window such as C5 28–45.25, where one L event is not enough to establish a credible backing rhythm, use the explicitly named `quarter-note chord-quality pulse` approximation only after the source-lane decision is recorded. A C5 shell is root/fifth only; thirds or sevenths appear only when the chord symbol supplies them, and slash bass is preserved.
- Never describe that pattern as recreating the Hell recording. Its acceptance is playability, beat alignment, chord-label compatibility, and honest approximation status.
- Keep the existing user correction path available; unresolved/weak windows stay visible rather than being silently promoted to faithful accompaniment.

## Playback path decision

The existing types already carry everything this candidate needs:

```text
Note       { midi, start, dur, vel, hand }
TimedNote  { midi, startSec, durSec, vel, hand }
AudioLike.noteOn(note, when)
```

`noteOn` already applies velocity, duration, per-hand gain routing, synth envelopes, sampled-piano velocity/duration, and organ velocity/duration. The same derived `guidanceNotes` are already consumed by the falling view, Note letters, and grading.

The minimal audio boundary is therefore:

```text
melody-accompaniment result.notes
  = retained melody + retained source support + named fallback Note events

melody-accompaniment result.guidanceNotes
  = the same derived timed-note set used by the existing display/grading path

melody-accompaniment chord labels
  = display/chord annotation only; no playChord scheduling

bass-chords
  = existing chord-event path, unchanged
```

The Player must not send Melody + accompaniment chord events to `PlaybackEngine` while the same support is present in `notes`. The preview path must likewise preview those notes through `noteOn` and must not call `playChord` for the same arrangement. This avoids adding velocity/duration parity work to the synth, sampler, and organ `playChord` implementations and prevents duplicate sounding support.

One small engine/UI regression should assert that a melody-accompaniment preview/playback spy receives support through `noteOn` and zero `playChord` calls, while the existing Bass + chords test continues to cover `playChord`.

## Separate false-UG fix

This is independent of the backing-rhythm change.

Root cause has two parts:

1. `buildAutoChordSource` labels any fallback merge `UG + generated fallback`, even when `timeline.provenance.kind` is `midi-derived` and `ugSource` is null.
2. `findUgTimeline` scans a valid `chordSources` object as a generic source map and treats the auto display label containing `UG` as an authored UG source.

Minimal fix contract:

- a valid versioned bundle with `ug: null` is authoritative and must not fall through to classify `auto` as UG;
- fallback-only auto labels must say `Generated fallback`;
- a true UG source must still require the explicit `ug` bundle entry or an explicit UG source/provenance path.

Regression fixture: valid bundle with `generated`, `ug: null`, and `auto.label = "UG + generated fallback"` must resolve `sources.ug === null`; a separate catalog-builder fixture with a MIDI-derived fallback and no chart must produce auto label `Generated fallback`. Keep this regression separate from the rhythm-event tests.

## Later implementation acceptance and non-claims

Before implementation is called complete, the focused tests should prove:

- Oops intro with explicit RH selection has zero selected melody events and retains the source lower attack starts; automatic output must be reported separately;
- Oops 16–32 and 48–68 preserve the reviewed upper lane and source support timing;
- Blackbird 14–26.5 retains the reviewed 17 lower support events instead of one chord block;
- Hell uses only the named window contract and labels the shell as an approximation when source support is insufficient;
- source rests remain empty in melody output;
- derived support is scheduled through `noteOn` exactly once and does not also schedule a chord event;
- velocity, duration, transpose, hand filtering, display, and grading remain on the existing `Note`/`TimedNote` path;
- false UG classification is fixed by its own regression.

This checkpoint does not prove human listening acceptance, exact reproduction of any recording, a universal melody selector, broad legacy-source voice semantics, production safety, or release readiness. No code, canonical data, deployment, merge, or full CI run was performed in this phase.

## Review gate

Parent review is required before writing implementation code. The decisions to approve are the three named contracts (`B1`, `B3`, `B4`), the note-only Melody + accompaniment audio boundary, and the separate false-UG fix/regression. Any unapproved Hell pattern remains a documented candidate, not an implemented promise.
