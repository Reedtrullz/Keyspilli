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
- Held source support that crosses into the first resolved chord span is normalized to L ownership once, while retaining its source duration and velocity.
- `MelodyAccompanimentProvenance` now distinguishes `sourceSupportNoteCount` from `generatedNoteCount`/`generatedBeats`; `supportModes` exposes `source-rhythm`, `quarter-note-pulse`, and `fallback` to the UI.
- A valid source bundle with `ug: null` is authoritative. Fallback-only Auto is labelled `Generated fallback` and is not reclassified as UG.

## Original vs deployed vs candidate — default automatic selection

`Original` is the complete source-note baseline. It is not a completion target: the candidate is allowed to reduce accompaniment density. `Deployed notes-only` is the pre-change `buildMelodyAccompaniment(...).notes` result at the base commit; its generated chord spans were a separate audio channel. `Candidate notes` is the post-change melody-mode note result; its generated chord objects remain annotation and are not scheduled as audio in melody mode.

| Song | Original source note events | Deployed notes-only events | Deployed generated chord events | Candidate note events | Candidate source support notes | Candidate pulse note events | Candidate fallback beats |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Blackbird | 1,069 | 827 | 41 | 1,038 | 376 | 0 | 125 |
| Oops I Did It Again | 1,897 | 1,487 | 35 | 1,698 | 378 | 0 | 232.75 |
| Hell You Call a Dream | 1,452 | 1,320 | 36 | 1,395 | 560 | 0 | 269.75 |

These are fresh post-voicing-gate-removal metrics from the canonical note hashes in the checkpoint. The candidate restores source-derived support to the note path while still removing dense source events under resolved chord spans. The default target artifacts did not need the pulse approximation because each resolved automatic span had source support; the pulse path is exercised by fixtures and by explicit selections below. Deployed chord events are intentionally not added to its note-only count, and candidate chord events are intentionally not counted as audio.

## Bounded source-window comparison

Counts are `notes / distinct attack starts` in each window. Deployed rows are notes-only; any separately generated chord event is called out in the observation. Candidate melody starts were checked against the original source starts; no candidate melody start was invented.

| Song / window | Original | Deployed projection | Candidate | Candidate observation |
| --- | ---: | --- | ---: | --- |
| Blackbird 14–26.5 | 47 / 30 | 30 / 30 notes-only + one Am event | 43 / 30 | All 17 lower source attack starts remain represented; 13 remain support after automatic role inference claims 4 lower notes as melody |
| Blackbird 36.5–40 | 15 / 8 | 8 / 8 notes-only + one Cm event | 14 / 8 | Source attack grid remains unchanged |
| Blackbird 40–45.25 | 28 / 15 | 15 / 15 notes-only + one G5 event | 27 / 15 | Source attack grid remains unchanged |
| Oops 0–16, automatic | 23 / 15 | 23 / 15 notes-only; no chord event, no chord coverage | 23 / 15 | Default automatic selection still promotes the lower figure; this is reported, not claimed fixed |
| Oops 16–32, automatic | 37 / 25 | 37 / 25 notes-only; no chord event, no chord coverage | 37 / 25 | Full source attack grid remains represented |
| Oops 48–68, automatic | 55 / 30 | 55 / 30 notes-only; no chord event; no playable support voicing | 46 / 30 | Lower/upper source timing remains; density is reduced |
| Hell 9.25–15.5 | 11 / 5 | 5 / 5 notes-only + one C5 event | 8 / 5 | Sparse source support is preserved; no claim of recording reproduction |
| Hell 15.5–18 | 8 / 4 | 4 / 4 notes-only + one Fm7 event | 6 / 4 | Source attack grid remains unchanged |
| Hell 28–45.25 | 17 / 13 | 13 / 13 notes-only + one C5 event | 17 / 13 | One lower source event is retained; the source R-dominant lane is not generalized |
| Hell 45.25–56.25 | 51 / 33 | 45 / 33 notes-only + Csus4/C5 events, then fallback at 51.75 | 50 / 33 | Source events are retained/reduced through the bridge; unresolved fallback remains explicit |

## Explicit RH comparison — Oops rest contract

This is a user-confirmed comparison, not the default automatic result.

| Window | Original source | Deployed explicit-RH result | Candidate explicit-RH result |
| --- | ---: | ---: | ---: |
| 0–16 | 23 / 15 | 23 / 15 notes-only; no chord event and no chord coverage | 23 / 15; zero selected melody events, lower source figure remains timed support, and no chord audio |
| 16–32 | 37 / 25 | 37 / 25 notes-only; no chord event and no chord coverage | 37 / 25; 4 selected melody events plus source support, and no chord audio |
| 48–68 | 55 / 30 | 29 / 11 notes-only plus one C#5 chord event | 55 / 30; 29 selected melody events plus source support, with C#5 annotation only |

The explicit RH result has `sourceSupportNoteCount = 382`, `generatedNoteCount = 6`, `generatedBeats = 2`, and `fallbackBeats = 48` across the full Oops artifact. The generated notes are actual pulse events, not a count of source-reduced spans.

## Initial short-window control captures

These 2.2-second captures are retained as the unchanged Oops intro control. They are not sufficient phrase-rhythm evidence. The filtered files are left-hand-filtered captures, not isolated backing stems; source hand ownership can put melody or support in the L lane. The JSON sidecars and [control manifest](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-comparison-2026-09-17/manifest.json) record bytes, RMS/peak signal, SHA-256, and an oscillator event trace.

| Song / seek | Original | Deployed | Candidate |
| --- | --- | --- | --- |
| Blackbird / 7s | [full 54](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-comparison-2026-09-17/the-beatles-blackbird-original-full.webm) · [left-filtered 18](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-comparison-2026-09-17/the-beatles-blackbird-original-backing.webm) | [full 42](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-comparison-2026-09-17/the-beatles-blackbird-deployed-full.webm) · [left-filtered 12](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-comparison-2026-09-17/the-beatles-blackbird-deployed-backing.webm) | [full 48](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-comparison-2026-09-17/the-beatles-blackbird-candidate-full.webm) · [left-filtered 18](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-comparison-2026-09-17/the-beatles-blackbird-candidate-backing.webm) |
| Oops I Did It Again / 0s | [full 27](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-comparison-2026-09-17/britney-spears-oops-i-did-it-again-original-full.webm) · [left-filtered 27](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-comparison-2026-09-17/britney-spears-oops-i-did-it-again-original-backing.webm) | [full 27](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-comparison-2026-09-17/britney-spears-oops-i-did-it-again-deployed-full.webm) · [left-filtered 27](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-comparison-2026-09-17/britney-spears-oops-i-did-it-again-deployed-backing.webm) | [full 27](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-comparison-2026-09-17/britney-spears-oops-i-did-it-again-candidate-full.webm) · [left-filtered 27](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-comparison-2026-09-17/britney-spears-oops-i-did-it-again-candidate-backing.webm) |
| Hell You Call a Dream / 10.7s | [full 42](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-comparison-2026-09-17/aria-ellys-music-the-warning-hell-you-call-a-dream-piano-cover-by-aria-ellys-mslzwo1d-original-full.webm) · [left-filtered 6](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-comparison-2026-09-17/aria-ellys-music-the-warning-hell-you-call-a-dream-piano-cover-by-aria-ellys-mslzwo1d-original-backing.webm) | [full 55](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-comparison-2026-09-17/aria-ellys-music-the-warning-hell-you-call-a-dream-piano-cover-by-aria-ellys-mslzwo1d-deployed-full.webm) · [left-filtered 22](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-comparison-2026-09-17/aria-ellys-music-the-warning-hell-you-call-a-dream-piano-cover-by-aria-ellys-mslzwo1d-deployed-backing.webm) | [full 39](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-comparison-2026-09-17/aria-ellys-music-the-warning-hell-you-call-a-dream-piano-cover-by-aria-ellys-mslzwo1d-candidate-full.webm) · [left-filtered 6](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-comparison-2026-09-17/aria-ellys-music-the-warning-hell-you-call-a-dream-piano-cover-by-aria-ellys-mslzwo1d-candidate-backing.webm) |

## Complete phrase captures — primary automatic comparison

These are the required complete phrase clips, generated on 2026-09-17 at candidate head `5c01dc677c90b5123779652b5e7133e4ef2f4964` against deployed base `0a30d357ca3d646a817ac63380549fea9cdecee8`. Every Original/Deployed/Candidate row for a song uses the same synth settings (`speed = 1`, `transpose = 0`), 1440×900 viewport, UI seek, and clip duration. Each clip contains a 0.5-second lead-in and 0.5-second tail around the requested phrase window. The UI seek input accepts 0.01-second steps, so the exact UI seek is recorded alongside precise phrase boundaries in the [phrase manifest](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-phrase-comparison-2026-09-17/manifest.json).

`Original` uses Original arrangement on the candidate server; `Deployed` uses `origin/main` with Chord mode + Automatic melody; `Candidate` uses this branch with Chord mode + Automatic melody. `full` means Both hands and `left-filtered` means the Player Left hand filter. The latter is not guaranteed backing isolation because source hand ownership can be L for melody or support. The sidecars record bytes, RMS/peak, SHA-256, and oscillator starts; oscillator counts are probe evidence, not musical note counts. All 20 phrase captures have nonzero bytes and nonzero decoded signal. Human listening remains the acceptance boundary.

| Phrase window / exact clip | Original | Deployed automatic | Candidate automatic |
| --- | --- | --- | --- |
| Blackbird, beats 14–26.5; phrase 7.000–13.250s; seek 6.50s; clip 7.250s | [full 162](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-phrase-comparison-2026-09-17/blackbird-original-full.webm) · [left-filtered 60](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-phrase-comparison-2026-09-17/blackbird-original-left-filtered.webm) | [full 120](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-phrase-comparison-2026-09-17/blackbird-deployed-automatic-full.webm) · [left-filtered 30](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-phrase-comparison-2026-09-17/blackbird-deployed-automatic-left-filtered.webm) | [full 150](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-phrase-comparison-2026-09-17/blackbird-candidate-automatic-full.webm) · [left-filtered 60](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-phrase-comparison-2026-09-17/blackbird-candidate-automatic-left-filtered.webm) |
| Oops I Did It Again, beats 48–68; phrase 30.315789–42.947368s; seek 29.82s; clip 13.632s | [full 198](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-phrase-comparison-2026-09-17/oops-i-did-it-again-original-full.webm) · [left-filtered 81](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-phrase-comparison-2026-09-17/oops-i-did-it-again-original-left-filtered.webm) | [full 180](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-phrase-comparison-2026-09-17/oops-i-did-it-again-deployed-automatic-full.webm) · [left-filtered 84](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-phrase-comparison-2026-09-17/oops-i-did-it-again-deployed-automatic-left-filtered.webm) | [full 162](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-phrase-comparison-2026-09-17/oops-i-did-it-again-candidate-automatic-full.webm) · [left-filtered 123](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-phrase-comparison-2026-09-17/oops-i-did-it-again-candidate-automatic-left-filtered.webm) |
| Hell You Call a Dream, beats 28–45.25; phrase 16.969697–27.424242s; seek 16.47s; clip 11.455s | [full 72](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-phrase-comparison-2026-09-17/hell-you-call-a-dream-original-full.webm) · [left-filtered 12](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-phrase-comparison-2026-09-17/hell-you-call-a-dream-original-left-filtered.webm) | [full 64](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-phrase-comparison-2026-09-17/hell-you-call-a-dream-deployed-automatic-full.webm) · [left-filtered 16](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-phrase-comparison-2026-09-17/hell-you-call-a-dream-deployed-automatic-left-filtered.webm) | [full 72](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-phrase-comparison-2026-09-17/hell-you-call-a-dream-candidate-automatic-full.webm) · [left-filtered 24](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-phrase-comparison-2026-09-17/hell-you-call-a-dream-candidate-automatic-left-filtered.webm) |

The candidate retains Blackbird's reviewed source attack grid in the left-filtered phrase while deployed exposes fewer starts. In the Oops phrase, automatic candidate output is intentionally the primary comparison; the candidate right-hand correction below is separate. Hell's deployed left-filtered count reflects generated chord support, while candidate support follows sparse source rhythm rather than recreating the recording.

## Oops phrase — separately labeled candidate RH correction

This is an additional candidate-only listening clip using the same Oops phrase window, seek, duration, synth, speed, transpose, viewport, and full/left-filtered captures as the automatic row above. It is user-confirmed `Use right-hand part`, not an automatic-selection claim.

| Phrase window | Candidate right-hand selection |
| --- | --- |
| Oops I Did It Again, beats 48–68; seek 29.82s; clip 13.632s | [full 198](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-phrase-comparison-2026-09-17/oops-i-did-it-again-candidate-right-hand-full.webm) · [left-filtered 81](/Users/reidar/.codex/worktrees/backing-rhythm-repair/apps/web/test-results/backing-rhythm-phrase-comparison-2026-09-17/oops-i-did-it-again-candidate-right-hand-left-filtered.webm) |

The automatic Oops intro control remains unchanged and has no chord coverage. The phrase capture above is the longer backing-rhythm evidence; the RH clip is only the explicit correction comparison.

## Playback and provenance checks

- Melody-mode support is scheduled through `AudioLike.noteOn` exactly once in the focused spy regression; its chord list is empty, so `playChord` is not called for the same support.
- The existing direct chord playback tests remain unchanged for the Bass + chords path.
- UI status now says `source support notes` for source-derived support and `pulse notes (quarter-note approximation)` when the pulse path is used.
- Canonical source resolution after the fix reports `auto.label = "Generated fallback"` and `ug = null` for Blackbird, Oops, and Hell. The base behavior incorrectly exposed a non-null UG resolution by scanning the auto label.

## Verification

```text
@keyspilli/player-core: 14 files, 183 tests passed
@keyspilli/web:        35 files, 202 tests passed
@keyspilli/player-core typecheck: passed
@keyspilli/web typecheck: passed
PR99 exact-head CI run 35163125970: passed; deploy, image publication, and catalog rebuild jobs skipped
Real-artifact phrase capture matrix: 20/20 WebM files nonzero with nonzero decoded signal
```

The catalog suite was run under Node 22 because the workspace `better-sqlite3` binary is Node-22 ABI 127; Node 20 reports ABI mismatch and is not a valid verification runtime for this checkout.

## Non-claims and remaining acceptance boundaries

- Automatic melody selection is not universally corrected. Oops beats 0–16 still select the lower figure by default; the explicit RH option preserves the actual upper-lane rest. Staff/hand tags in generated MusicXML are not independent source truth.
- The per-onset cap of three source tones does not cap total sounding polyphony or hand span when held source notes overlap. Held source notes are preserved, and no octave-playability claim is made from the onset cap alone.
- Hell has no verified chart and remains a legacy YouTube/Basic Pitch import. The chord-quality pulse is a playable approximation, not a recreation of the recording.
- This branch was not deployed or merged.
