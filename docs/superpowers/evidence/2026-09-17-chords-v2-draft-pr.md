# Draft PR — worker-backed melody arrangement and Chords v2 verification

Draft only. Do not merge or deploy from this branch. Candidate code is frozen at `ea68729045e82ef9ced14e0e0916c86991eeba4a` before the four reserved evaluation bases are run.

## Summary

- Keeps Original playback on the source-note view and moves large melody arrangements to the existing worker path.
- Keys worker state and results by the exact serialized input so stale errors/results do not leak across selection, mode, or source changes.
- Handles worker constructor and `postMessage` failures with an explicit Original-retained fallback and retry.
- Adds browser trace coverage for render-path execution, audible Full/Melody/Accompaniment auditions, A/B position preservation, correction/reset/reload persistence, mobile controls, and real-audio fallback.
- Adds same-synth complete-phrase capture coverage for the four reserved evaluation bases, with Original, Automatic melody, and User-confirmed right-hand outcomes kept separate.
- Preserves the reserved packet outside disposable Playwright output with portable paths, per-file SHA-256 integrity checks, canonical oscillator-event multisets, and aligned decoded PCM comparisons.

## Verification

All commands used Node 22.22.3 from the frozen worktree:

```text
npm test -w @keyspilli/player-core -- --run  229 passed
npm test -w @keyspilli/web -- --run           205 passed
npm run typecheck -w @keyspilli/web           passed
npm run build -w @keyspilli/web               passed
npm run e2e:melody-scratch -w @keyspilli/web
                                        12 passed, 1 skipped
```

The skipped case is the reserved T1 freeze-only control. The disposable suite uses copied artifacts and a fresh SQLite database; canonical catalogue data was not changed. The standalone Next.js server warning is pre-existing and did not fail the run.

## Browser capture evidence

The reserved packet contains four complete source-selected phrases, each captured through the browser `AudioEngine` synth with separate Original, Automatic melody, and User-confirmed right-hand outcomes:

| Phrase | Source-only window | Original / Automatic / Manual oscillator events | Automatic / Manual aligned PCM RMS error |
| --- | ---: | ---: | ---: |
| Near the Cross | 24–48 beats, 4×6/4 | 162 / 150 / 153 | 0.1224 / 0.1149 |
| Prélude | 16–32 beats, 4×4/4 | 357 / 267 / 327 | 0.1565 / 0.1716 |
| Pay Me My Money Down | 28–44 beats, 4×4/4 | 114 / 111 / 114 | 0.0999 / 0.0989 |
| Dear God | 96–128 beats, 8×4/4 | 531 / 492 / 531 | 0.1020 / 0.1051 |

Full values, source fingerprints, event-multiset hashes, aligned PCM comparisons, and portable packet paths are in [the reserved evaluation summary](./2026-09-17-chords-v2-reserved-evaluation.json) and [the preserved capture packet](./2026-09-17-chords-v2-capture-packet/). WebM SHA-256 values are integrity checks only, not audible-difference proof. Oscillator events and PCM divergence establish engineering-level output separation, not recognizability, harmonic plausibility, playability, or preference. Human listening is still pending.

## Acceptance status

- Engineering/runtime integration: verified by unit, typecheck, build, and disposable browser checks.
- Original fallback and error recovery: verified with real browser audio capture.
- Reserved four-song evaluation: 4/4 complete phrases captured; Automatic and User-confirmed outcomes are separate; no reserved-output tuning performed.
- Source-semantic review and human musical rubric: pending.
- Merge, deployment, and catalogue rebuild: not performed.

## Review requests

1. Inspect the exact frozen code head and the worker/source fallback boundary.
2. Audit the complete-phrase audio captures before assigning any musical rating.
3. Apply the human rubric to the preserved Original/Automatic/User-confirmed packet. Any tuning would invalidate this freeze and require fresh evaluation examples.
