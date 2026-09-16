# Backing-rhythm repair implementation evidence

Date: 2026-09-17
Branch: `codex/backing-rhythm-repair`
Base: deployed `origin/main` at `0a30d357ca3d646a817ac63380549fea9cdecee8`
Data: canonical Keyspilli data at the point-in-time hashes recorded in the checkpoint report.

## Implemented contract

- Melody selection remains source-aware and unchanged by default. Automatic selection is still an inference; explicit `right-hand` selection is user-confirmed.
- Source accompaniment is reduced at its real attack groups: lowest source tone plus up to two higher tones within one octave. Chosen source durations and velocities remain intact, and source crossings are preserved rather than re-attacked at chord boundaries.
- A parseable chord with no source accompaniment gets an explicit `quarter-note chord-quality pulse`. A power chord supplies root/fifth only; thirds and sevenths come from the chord symbol, and slash bass is retained.
- Melody-mode support is returned as ordinary `Note` events and the Player passes no melody-mode chord timeline to `PlaybackEngine`. `bass-chords` retains the existing `playChord` path.
- `MelodyAccompanimentProvenance` now distinguishes `sourceSupportNoteCount` from `generatedNoteCount`/`generatedBeats`; `supportModes` exposes `source-rhythm`, `quarter-note-pulse`, and `fallback` to the UI.
- A valid source bundle with `ug: null` is authoritative. Fallback-only Auto is labelled `Generated fallback` and is not reclassified as UG.

## Original vs deployed vs candidate — default automatic selection

`Original` is the complete source-note baseline. It is not a completion target: the candidate is allowed to reduce accompaniment density. `Deployed` is the pre-change `buildMelodyAccompaniment` result at the base commit; its chord audio was a single generated chord event per covered span. `Candidate` is the post-change melody-mode note result.

| Song | Original source notes | Deployed melody-mode notes | Candidate notes | Candidate source support | Candidate generated pulse | Candidate fallback beats |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Blackbird | 1,069 | 827 | 1,038 | 376 notes | 0 notes / 0 beats | 125 |
| Oops I Did It Again | 1,897 | 1,509 | 1,708 | 368 notes | 0 notes / 0 beats | 235.75 |
| Hell You Call a Dream | 1,452 | 1,325 | 1,387 | 560 notes | 0 notes / 0 beats | 273.5 |

The candidate restores source-derived support to the note path while still removing dense source events under resolved chord spans. The default target artifacts did not need the pulse approximation because each resolved automatic span had source support; the pulse path is exercised by fixtures and by explicit selections below.

## Bounded source-window comparison

Counts are `notes / distinct attack starts` in each window. Candidate melody starts were checked against the original source starts; no candidate melody start was invented.

| Song / window | Original | Deployed projection | Candidate | Candidate observation |
| --- | ---: | --- | ---: | --- |
| Blackbird 14–26.5 | 47 / 30 | 30 retained melody notes plus one sustained Am chord block | 43 / 30 | All 17 lower source attack starts remain represented; 13 remain support after automatic role inference claims 4 lower notes as melody |
| Blackbird 36.5–40 | 15 / 8 | 8 retained melody notes plus one Cm block | 14 / 8 | Source attack grid remains unchanged |
| Blackbird 40–45.25 | 28 / 15 | 15 retained melody notes plus one G5 block | 27 / 15 | Source attack grid remains unchanged |
| Oops 0–16, automatic | 23 / 15 | 15 lower-line melody notes; generated chord support was separate | 23 / 15 | Default automatic selection still promotes the lower figure; this is reported, not claimed fixed |
| Oops 16–32, automatic | 37 / 25 | 25 retained melody notes; chord support was separate | 37 / 25 | Full source attack grid remains represented |
| Oops 48–68, automatic | 55 / 30 | 30 retained melody notes; one-block C#5 projection in the covered span | 46 / 30 | Lower/upper source timing remains; density is reduced |
| Hell 9.25–15.5 | 11 / 5 | 5 retained melody notes plus a C5 block | 8 / 5 | Sparse source support is preserved; no claim of recording reproduction |
| Hell 15.5–18 | 8 / 4 | 4 retained melody notes plus one Fm7 block | 6 / 4 | Source attack grid remains unchanged |
| Hell 28–45.25 | 17 / 13 | 13 retained melody notes plus one C5 block | 17 / 13 | One lower source event is retained; the source R-dominant lane is not generalized |
| Hell 45.25–56.25 | 51 / 33 | Generated blocks followed by fallback; source support was absent from the audio note result | 50 / 33 | Source events are retained/reduced through the bridge; unresolved fallback remains explicit |

## Explicit RH comparison — Oops rest contract

This is a user-confirmed comparison, not the default automatic result.

| Window | Original source | Deployed explicit-RH result | Candidate explicit-RH result |
| --- | ---: | ---: | ---: |
| 0–16 | 23 / 15 | 0 / 0 note events plus a generated chord block | 23 / 15; zero selected melody events and the lower source figure remains timed support |
| 16–32 | 37 / 25 | 4 / 2 upper events plus chord replacement | 37 / 25; upper entries remain and lower source rhythm remains |
| 48–68 | 55 / 30 | 29 / 11 upper melody events plus chord replacement | 55 / 30; source timing remains represented |

The explicit RH result has `sourceSupportNoteCount = 382`, `generatedNoteCount = 6`, and `generatedBeats = 2` across the full Oops artifact. The generated notes are actual pulse events, not a count of source-reduced spans.

## Playback and provenance checks

- Melody-mode support is scheduled through `AudioLike.noteOn` exactly once in the focused spy regression; its chord list is empty, so `playChord` is not called for the same support.
- The existing direct chord playback tests remain unchanged for the Bass + chords path.
- UI status now says `source support notes` for source-derived support and `pulse notes (quarter-note approximation)` when the pulse path is used.
- Canonical source resolution after the fix reports `auto.label = "Generated fallback"` and `ug = null` for Blackbird, Oops, and Hell. The base behavior incorrectly exposed a non-null UG resolution by scanning the auto label.

## Verification

```text
@keyspilli/player-core: 14 files, 182 tests passed
@keyspilli/web:        35 files, 202 tests passed
@keyspilli/player-core typecheck: passed
@keyspilli/web typecheck: passed
```

The catalog suite was run under Node 22 because the workspace `better-sqlite3` binary is Node-22 ABI 127; Node 20 reports ABI mismatch and is not a valid verification runtime for this checkout.

## Non-claims and remaining acceptance boundaries

- Automatic melody selection is not universally corrected. Oops beats 0–16 still select the lower figure by default; the explicit RH option preserves the actual upper-lane rest. Staff/hand tags in generated MusicXML are not independent source truth.
- The per-onset cap of three source tones does not cap total sounding polyphony or hand span when held source notes overlap. Held source notes are preserved, and no octave-playability claim is made from the onset cap alone.
- Hell has no verified chart and remains a legacy YouTube/Basic Pitch import. The chord-quality pulse is a playable approximation, not a recreation of the recording.
- This branch was not deployed or merged.
