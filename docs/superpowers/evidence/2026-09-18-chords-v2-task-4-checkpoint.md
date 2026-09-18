# Chords v2 Task 4 checkpoint — truthful status and current audio evidence

Date: 2026-09-18
Worktree: `/Users/reidar/.codex/worktrees/musically-useful-chords-mode`
Branch: `codex/musically-useful-chords-mode`
Code/evidence checkpoint: `773e52c` (`test(web): record decoded capture durations`)

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
- Complete Blackbird phrase capture: `1/1` passed on `9549980`.
- Corrected Oops phrase capture: `1/1` passed on `773e52c`.

## Current local audio evidence

The disposable browser captures used the actual Player path and browser
`AudioEngine` synth. They are engineering evidence only; hashes and event
counts are integrity/coverage observations, not listening or quality scores.
The durable copies and provenance are in
`docs/superpowers/evidence/2026-09-18-task-5-audio/README.md`.

### Oops `[64,108)` at 95 BPM

Manifest:
`docs/superpowers/evidence/2026-09-18-task-5-audio/oops-64-108/final-capture/oops-section-2-audio-comparison.json`

Candidate `773e52c`, source fingerprint from the frozen Oops fixture. Each
capture has `decodedPcm.samples = 1272726` at `44100 Hz`, which is `28.86 s`.
The separate `signal.samples = 212121` value is a decimated probe count and
must not be used as the duration:

| Capture | Browser events | Decoded PCM | Probe samples | Bytes | SHA-256 | RMS |
|---|---:|---:|---:|---:|---|---:|
| Original | 1011 | 1,272,726 / 44,100 Hz = 28.86 s | 212,121 | 464,942 | `7b20c3d299e1f874bdad75fc52e1ca9ef709c0558ad54eca375dba2957bff3e4` | 0.07144 |
| Coherent | 735 | 1,272,726 / 44,100 Hz = 28.86 s | 212,121 | 450,669 | `2fc4fc2cf4755eabb2d677e4373636ea73415cbee4d96d483e8bcd3ff6039cde` | 0.05643 |
| Resume | 735 | 1,272,726 / 44,100 Hz = 28.86 s | 212,121 | 458,917 | `fbb4f4ff32a2abe51be0ea30f8a2d8f7d73ca6114a02cfda22eeb2bc29c255c9` | 0.05621 |

The three captures are non-empty and differ in scheduled events/hash. Human
listening, recognizability, accompaniment usefulness, and physical comfort are
pending; `humanListening` remains `pending` in the manifest.

### Blackbird `[14,26.5]` at 120 BPM

Manifest:
`docs/superpowers/evidence/2026-09-18-task-5-audio/blackbird-14-26.5/capture/blackbird-phrase-14-26.5-audio-comparison.json`

Candidate `9549980` captured a complete source window plus 0.5 seconds of
lead-in and 1 second of tail. Original and automatic both passed non-empty
audibility/decoded-duration checks and have different hashes/events. Original
decoded PCM is `320166 / 44100 = 7.26 s`; automatic is
`322811 / 44100 ≈ 7.32 s`. This is phrase-level wiring evidence, not a human
musical rating; `humanListening` remains `pending`.

### Blackbird/Hell role and practice flow

The earlier combined run produced non-empty decoded captures under the
disposable test-results directory and is preserved only by the short wiring
copies under
`docs/superpowers/evidence/2026-09-18-task-5-audio/blackbird-short-wiring/`.

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
| Task 5 release handoff | Partial | Local commits/checks and durable captures complete; push, draft-PR update, and exact-head CI still pending; no merge, deploy, or production mutation |

No production or catalogue data was changed. Pre-existing untracked audit,
deployment, and plan artifacts remain preserved.
