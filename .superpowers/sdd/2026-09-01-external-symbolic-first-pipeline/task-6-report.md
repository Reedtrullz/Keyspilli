# Task 6 report: mission verification and local-only closeout

## Scope

The EXTERNAL_SYMBOLIC_FIRST infrastructure is implemented as additive,
local-only evaluation tooling. The evidence firewall, native symbolic research
bridge, frozen generation boundary, decoder-survival evaluator, and seven-song
benchmark orchestrator are complete. External evaluation modules are direct
local imports rather than production catalog-barrel exports (`d167a2c`), so
normal production callers cannot accidentally use benchmark tooling as a
generation route.

Milestone commits from the requested starting point include:

- Task 1: `fe1e6a6` through `bfc8210` (evidence firewall and path hardening)
- Task 2: `630d82c` through `07d794d` (native symbolic research bridge)
- Task 3: `93e5398` through `5b2bddd` (frozen generation candidates)
- Task 4: `35d45fc`, `2b3b6bb`, `823b35b`, `6db6a3d` (survival diagnostics)
- Task 5: `8487b7d`, `822ffe3`, `78fd86d` (benchmark orchestration)
- Boundary/docs: `d167a2c` (local-only exports, tests, and usage wording)

## Verification

Fresh repository-root checks:

```text
npm test --workspaces --if-present
  web 85, catalog 745, engrave 8, midi 297, player-core 92,
  transcribe 37 — 1264 tests passed

npm run typecheck --workspaces --if-present
  all six workspaces passed

./node_modules/.bin/vitest run packages/catalog/test/red-baron-survival.test.ts packages/catalog/test/external-benchmark.test.ts
  2 files, 23 tests passed

npm run typecheck -w @keyspilli/catalog
  passed

git diff --check HEAD^ HEAD
  passed

./node_modules/.bin/tsx packages/catalog/scripts/evaluate-red-baron-survival.ts --help
./node_modules/.bin/tsx packages/catalog/scripts/evaluate-external-symbolic.ts --help
  both printed local-only usage successfully
```

The standalone root-level catalog test command currently reports 79 passed
files, 739 passed tests, and 6 failures in two legacy Hermes subprocess cases
whose separate runtime cannot resolve the workspace `tsx` package. The
workspace test command above passes all 745 catalog tests; this invocation
difference is retained as a verification caveat rather than hidden.

Determinism checks passed for reordered candidate/report inputs and the Red
Baron canonical report. The latest Red Baron smoke produced the same canonical
digest on repeated runs (`26d98945faf79024e797da993f19309867fb3d09de663a11be55e0aa583bb098`).
No absolute path, raw note array, byte payload, or timestamp is included in
the canonical report shape; redaction probes cover embedded URLs, POSIX,
Windows/UNC, tilde, quoted, and relative physical locators.

## External-asset and release boundary

No external reference MIDI/audio, model weights, benchmark artifact, or
production recording was read, copied, staged, uploaded, committed, replayed,
pushed, or deployed during this mission. No real seven-song acquisition or
benchmark run was performed; the orchestrator reports unavailable evidence
until an explicit local manifest is supplied. The supplied reference remains
outside the repository and is not required by the test suite.

The evaluator can perform post-freeze, role-aware diagnostic alignment when a
caller explicitly supplies local reference windows. It cannot feed reference
notes into candidate discovery, generation selection, freezing, decoding, or
arrangement construction. The listening bundle/renderer remains a separate
local command and is not represented as a completed audio or A/B acceptance
run here.

## Claims and deferred work

This closeout proves boundary, provenance, serialization, deterministic
diagnostic, and fail-closed infrastructure. It does not prove that any
arrangement is recognizable, musically correct, or playable. Human acceptance
remains `null`/not ready until at least two independent raters supply a
conflict-free listening record. The known residual opening/contour quality gap,
reference alignment coverage requirements, renderer metadata, and legacy
Hermes subprocess setup remain explicit follow-ups rather than release claims.
