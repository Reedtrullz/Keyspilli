# Draft PR — worker-backed melody arrangement verification

Draft only. Do not merge or deploy from this branch. Candidate code is frozen at `ea68729045e82ef9ced14e0e0916c86991eeba4a` before the four reserved evaluation bases are run.

## Summary

- Keeps Original playback on the source-note view and moves large melody arrangements to the existing worker path.
- Keys worker state and results by the exact serialized input so stale errors/results do not leak across selection, mode, or source changes.
- Handles worker constructor and `postMessage` failures with an explicit Original-retained fallback and retry.
- Adds browser trace coverage for render-path execution, audible Full/Melody/Accompaniment auditions, A/B position preservation, correction/reset/reload persistence, mobile controls, and real-audio fallback.
- Adds a same-synth complete Oops section-2 capture comparing Original, the frozen `coherent-phrase` candidate, and a test-only `resume` candidate.

## Verification

All commands used Node 22.22.3 from the frozen worktree:

```text
npm test -w @keyspilli/web -- --run     205 passed
npm run typecheck -w @keyspilli/web   passed
npm run build -w @keyspilli/web       passed
npm run e2e:melody-scratch -w @keyspilli/web
                                        7 passed, 1 skipped
```

The skipped case is the reserved T1 freeze-only test. The disposable suite uses copied artifacts and a fresh SQLite database; canonical catalogue data was not changed.

## Browser capture evidence

The complete Oops `[64,108]` phrase at 95 BPM was captured through the browser `AudioEngine` synth with the same viewport and seek path:

| Candidate | Bytes | Oscillator events | RMS | SHA-256 |
| --- | ---: | ---: | ---: | --- |
| Original | 464,629 | 1,011 | 0.0711761 | `bd45041f…45ced6c` |
| Coherent phrase | 448,462 | 657 | 0.0539915 | `d9e44b28…d1572c6` |
| Resume comparison | 456,699 | 660 | 0.0540589 | `6749f9ed…9e6407` |

Full values and source fingerprint are in [the candidate freeze manifest](./2026-09-17-chords-v2-candidate-freeze.json). The generated WebM/JSON artifacts are ignored Playwright outputs under `apps/web/test-results/`. These signal/hash differences prove rendered audio candidates exist and differ; they do not prove recognizability, harmonic plausibility, playability, or preference. Human listening is still pending.

## Acceptance status

- Engineering/runtime integration: verified by unit, typecheck, build, and disposable browser checks.
- Original fallback and error recovery: verified with real browser audio capture.
- Reserved four-song evaluation: not run after freeze.
- Source-semantic review and human musical rubric: pending.
- Merge, deployment, and catalogue rebuild: not performed.

## Review requests

1. Inspect the exact frozen code head and the worker/source fallback boundary.
2. Audit the complete-phrase audio captures before assigning any musical rating.
3. Run the reserved evaluation only from the frozen manifest; if it drives tuning, invalidate this freeze and reserve fresh examples.
