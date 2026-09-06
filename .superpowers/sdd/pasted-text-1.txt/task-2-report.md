# Task 2 report

Implemented a pure, additive harmony evaluator in `packages/catalog/src/harmony-evaluation.ts` and exported it from `packages/catalog/src/index.ts`.

## Included

- Explicit per-window and aggregate types for chroma, root/bass, chord/quality, change timing, LH attacks and notes-per-attack, low-register mud and close intervals, octave/fifth duplication, span/jumps, repeated walls, root/quality jitter, unsupported changes, and tri-state evidence availability (`available`, `unavailable`, `malformed`).
- Deterministic, input-order-independent note/attack/change normalization. Notes are restricted to each supplied window and the evaluator never mutates caller-owned input.
- Chroma agreement uses duration-weighted pitch-class cosine similarity. Candidate semantic harmony events are accepted when supplied; otherwise conservative root/quality events are inferred from candidate LH attacks for evaluation only. Melody extraction/generation is not called or changed.
- Playability metrics are reported independently from reference agreement. Missing candidate/reference evidence remains null/unavailable rather than being treated as a pass.
- `evaluateHarmonyGate` is opt-in and disabled by default. When enabled it returns `null` for unavailable evidence, fails closed for malformed evidence, and fails for configured threshold violations. Gate options can be passed as the second argument or as `input.gate`.

## Tests and verification

- Added synthetic, network-free tests in `packages/catalog/test/harmony-evaluation.test.ts` covering healthy/pathological voicings, deterministic input reordering, caller-input immutability, missing versus malformed evidence, and disabled/enabled strict gate behavior.
- Focused verification: `pnpm exec vitest run packages/catalog/test/harmony-evaluation.test.ts packages/catalog/test/arrangement-evaluation.test.ts packages/midi/test/piano-accompaniment.test.ts` — 54/54 passed.
- Catalog typecheck: `pnpm exec tsc --noEmit -p packages/catalog/tsconfig.json` — passed.

## Deferred gaps

- This groundwork does not add a catalog rebuild, runtime route, CLI, reference download, or production gate wiring. Callers must map trusted reference windows and candidate LH/semantic evidence into the pure API.
- Harmony evidence is intentionally limited to the supported semantic quality set already used by the MIDI accompaniment layer; unsupported external labels are malformed rather than guessed.
