# Chords v2 Task 1 checkpoint — current-song before/after

Date: 2026-09-18

This checkpoint compares the preserved historical audit result at `a7087b1` with a fresh run of the same disposable fixture reproduction at final implementation head `e739cf7`. `6d0b560` and `28bdba1` are superseded ancestors; `7e532f7` and `e739cf7` are follow-up provenance/refactor commits. The historical JSON was not modified. The reproduction script still contains the historical `reviewedHead` label, so this file records the current implementation head explicitly instead of relabelling that artifact.

## Current-song engineering comparison

| Fixture | Output notes | Source support | Generated notes | Fallback beats | Max attacks/measure | Min gap (beats) |
|---|---:|---:|---:|---:|---:|---:|
| Blackbird | 1025 → 1041 | 416 → 432 | 0 → 0 | 60.375 → 53.625 | 9 → 10 | 0.25 → 0.25 |
| Oops | 1298 → 1433 | 466 → 601 | 0 → 0 | 123.875 → 111 | 8 → 14 | 0.125 → 0.125 |
| Hell | 1085 → 1110 | 418 → 443 | 0 → 0 | 96.375 → 88.125 | 11 → 11 | 0.125 → 0.125 |

All current fixtures report `source-rhythm` plus realized `fallback`; none synthesize generated support under the authored-only reproduction policy. The changed counts are diagnostics, not musical quality scores. In particular, Oops density rose from 8 to 14 attacks/measure and source support from 466 to 601; this remains an open Task 2 usability regression until the full backing/attack locations are explained by a phrase candidate or the limitation is stated.

## Targeted real-source checks

- Hell beat 23.5 / MIDI 91: historical output assigned the source-R support to L; current output keeps the source note on R at velocity 52 beside the R-hand melody MIDI 79 at velocity 109, with no fallback at that interval.
- Oops beat 80 / MIDI 88: historical output emitted the source-R support as L at velocity 70 beside R-hand melody MIDI 92. Current output emits no MIDI 88 support at that beat and records a `sounding limit exceeded` fallback span for `80..80.125`; the melody remains unchanged. This is a fail-safe classification, not a claim that the Oops phrase is musically fixed.
- Current direct target queries found no support velocity counterexample in the reproduction summary; the historical counterexamples (Oops MIDI 49 at 204 against melody velocity 60; Hell MIDI 56 at 10.125 against melody velocity 68) remain preserved as audit context.

## Verification

Fresh Node 22 checks at `e739cf7`:

```text
focused player-core (melody-accompaniment + arrangement-change): 2 files, 75 passed
full player-core: 15 files, 242 passed
player-core typecheck: exit 0
web component tests: 12 files, 54 passed
web typecheck: exit 0
git diff --check a7087b1..e739cf7: clean
disk guard: 73 GiB available on /System/Volumes/Data
```

The run used `docs/superpowers/evidence/2026-09-18-pr100-chords-v2-skeptical-audit-reproduce.ts` with Node 22 and disposable evidence fixtures. No browser audio audition, pedal-on acceptance, catalogue mutation, merge, push, deployment, or live verification was performed. Human listening remains pending.

## Interpretation boundary

Task 1 establishes bounded written-interval allocation, fixed support hand assignment, melody-relative support velocity, support-vs-support collision handling, and truthful fallback provenance. It does not establish global voice leading, fingering, physical playability, or musical acceptance of Blackbird, Oops, or Hell.
