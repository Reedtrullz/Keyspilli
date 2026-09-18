# Chords v2 Task 4 checkpoint — truthful status and current audio evidence

Date: 2026-09-18
Worktree: `/Users/reidar/.codex/worktrees/musically-useful-chords-mode`
Branch: `codex/musically-useful-chords-mode`
Code checkpoint: `5347cc3` (`fix(web): keep phrase status neutral`)

## Implemented truthfulness boundary

The Player phrase summary now reports only neutral `changed` and `unchanged`
counts, plus `need review` when applicable. The removed `already simple` label
was not a musical judgment; the producer already emits `change: "unchanged"`
with empty reasons for exact source/output intervals.

The source-backing control now states its bounded dependency explicitly:
temporal backing reduction is unavailable without reviewed source-lane or
phrase identity, so the opt-in source preview remains source-timed. This is a
dependency disclosure, not a claim that the current voicing preview repairs
the Oops rhythm.

## Verification

- Player-core full suite: `15 files / 258 tests passed`.
- Player-core and web typechecks: passed.
- SoundControls focused suite: `7/7` passed.
- Web production build: passed.
- Targeted phrase/status/source-preview Chromium flow: `3/3` passed.
- Combined current audio flow: `2/2` passed:
  `complete Oops phrase captures Original, coherent and resume candidates with
  the same synth` and `real audio events cover mode, hand filtering, seek,
  transpose, correction, and practice flow`.

## Current local audio evidence

The disposable browser capture used the actual Player path and browser
`AudioEngine` synth. It is engineering evidence only; hashes and event counts
are integrity/coverage observations, not listening or quality scores.

### Oops `[64,108)` at 95 BPM

Manifest:
`apps/web/test-results/melody-accompaniment-compl-5ca33-didates-with-the-same-synth-chromium/oops-section-2-audio-comparison.json`

Candidate `5347cc3`, source fingerprint from the frozen Oops fixture, decoded
sample count `212121` at `44100 Hz` for each capture (`28.86 s`):

| Capture | Browser events | Bytes | SHA-256 | RMS |
|---|---:|---:|---|---:|
| Original | 1011 | 462725 | `4d98da3c47a593bb1de85f0c594850e7ba954c7d2b357b9e5e5c1c92de0b9503` | 0.07135 |
| Coherent | 735 | 450989 | `eab905544579920940d823e562c17efe49bda9afc67971ea2163628cbb2b146a` | 0.05640 |
| Resume | 735 | 458917 | `1d1021d1e977792696d99940d0e878adb382d59b240f3afd1394474fc011a316` | 0.05641 |

The three captures are non-empty and differ in scheduled events/hash. Human
listening, recognizability, accompaniment usefulness, and physical comfort are
pending; `humanListening` remains `pending` in the manifest.

### Blackbird/Hell role and practice flow

The same combined run produced non-empty decoded captures under:
`apps/web/test-results/melody-accompaniment-real--17f5e-orrection-and-practice-flow-chromium/`

Observed coverage: Blackbird Original/Automatic `51/45` events, left-hand and
both-hands filters `12/33`, and Hell automatic/right-hand corrected `36/51`;
all captured windows passed the test's audibility and decoded-duration gates.
The flow also covered transpose and chord-practice acceptance. These results
verify wiring and playable-event projection, not musical quality.

## Completion ledger

| Area | Status | Boundary |
|---|---|---|
| Task 1 hand allocation/balance | Fixed and structurally tested | Not global voice-leading, pedal, or human-playability proof |
| Task 2 phrase/source strategy | Partial | Source-linked reduction/fallback works; real Oops attack grid remains unchanged at `479/479` |
| Task 3 phrase-local correction UI | Fixed and browser-tested | Source hands are user-selected candidates, not melody truth |
| Task 4 truthful status/audio coverage | Fixed and locally verified | Human listening and semantic usefulness remain pending |
| Task 5 release handoff | Partial | Local commits/checks only; no push, merge, deploy, or production mutation |

No production or catalogue data was changed. Pre-existing untracked audit,
deployment, and plan artifacts remain preserved.
