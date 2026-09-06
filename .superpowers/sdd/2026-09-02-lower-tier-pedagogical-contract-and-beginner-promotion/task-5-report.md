# Task 5 — Final verification and closeout

Status: complete. Outcome B is `BEGINNER_SPARSE_TWO_HAND_CONTRACT_PARTIAL`.

```text
Production: NO_PRODUCTION_BEHAVIOR_CHANGE
```

No production source, tests, metadata, evaluator behavior, or preregistration
was changed by Task 5. The pre-verification revision was
`1a64b4b6c79bca09ef59a82beed72cd7139c107f`; only this report and the progress
ledger are intended for the closeout commit.

## Fresh verification evidence

All commands ran in `/Users/reidar/Projectos/Keyspilli` on 2026-09-02.

### Workspace tests

Command:

```text
npm test --workspaces --if-present
```

Exit: `0`.

Exact Vitest summary counts:

```text
@keyspilli/web       Test Files 20 passed (20), Tests 85 passed (85)
@keyspilli/catalog   Test Files 97 passed (97), Tests 946 passed (946)
@keyspilli/engrave   Test Files 2 passed (2),  Tests 8 passed (8)
@keyspilli/midi      Test Files 9 passed (9),  Tests 324 passed (324)
@keyspilli/player-core Test Files 7 passed (7), Tests 92 passed (92)
@keyspilli/transcribe Test Files 7 passed (7), Tests 42 passed (42)
```

Total: `142` test files and `1,497` tests passed; `0` failed. The suite emitted
expected negative-path diagnostics for PDF Chromium availability and local
reference/evaluate-metal guards; these did not fail the suite.

### Workspace typechecks

Command:

```text
npm run typecheck --workspaces --if-present
```

Exit: `0`. All six workspace typechecks ran (`web`, `catalog`, `engrave`,
`midi`, `player-core`, `transcribe`) with no TypeScript diagnostics.

### Focused evaluator regression

Command:

```text
./node_modules/.bin/vitest run packages/catalog/test/lower-tier-task2-evaluator.test.ts --reporter=dot
```

Exit: `0`.

```text
Test Files  1 passed (1)
Tests       6 passed (6)
```

### Deterministic scratch evaluator rerun

Commands:

```text
node_modules/.bin/tsx /private/tmp/keyspilli-lower-tier-eval-20260902-a1/evaluator.ts --out /private/tmp/keyspilli-lower-tier-eval-20260902-a1/fixed-3.json
node_modules/.bin/tsx /private/tmp/keyspilli-lower-tier-eval-20260902-a1/evaluator.ts --out /private/tmp/keyspilli-lower-tier-eval-20260902-a1/fixed-4.json
cmp -s /private/tmp/keyspilli-lower-tier-eval-20260902-a1/fixed-3.json /private/tmp/keyspilli-lower-tier-eval-20260902-a1/fixed-4.json
```

Exit: `0` for both evaluator runs and `cmp`. The two output files are
byte-identical. Their raw pretty-JSON SHA-256 is
`767241a7cd7f59e9c9fb2df86b771de9410966881797dd67e43a9932d5f8aa23`.
The embedded canonical JSON SHA-256 remains the expected
`97fd0fef8f2b4cca289b683e15ca2c58d3e6e325c17c5efe2662f726498079ae` in both
outputs (and matches fixed-1/fixed-2).

The evaluator reports:

```text
frozen-level mismatches: classical 0, cover 0, pop 0, synthetic-full-band 0
non-Beginner parity unequal rows: classical 0, cover 0, pop 0, synthetic-full-band 0
RH parity: classical true, cover true, pop true, synthetic-full-band true
```

The known preregistration freeze failure remains unchanged and is reported
truthfully:

```text
synthetic-full-band expected source SHA-256: fba496e372f8962967b5e08903fa4883d6f4be1bde046f0eb3a06e1a1dcc8dc8
synthetic-full-band actual source SHA-256:   fba496e372f8962967b5e08903fa4883d6f4be1bde046f0eb3a06e1a1dcc8dc6
allSourceHashesMatch: false
```

Its candidate Beginner validator has `2` errors; the three frozen real
fixtures have `0` candidate validation errors and all candidate gates pass.

### Diff, source, and metadata checks

Command:

```text
git diff --check
```

Exit: `0`; output was empty.

The tracked working-tree production runtime source diff is empty for
`apps/**`, `packages/**/src/**`, and `services/**/src/**`. The tracked
`data/**` metadata diff is empty. The lower-tier evaluator support files and
tests were already present before Task 5; Task 5 adds docs only. The excluded
untracked paths remain untouched and unstaged: `.tmp-source-audit/` and
`pnpm-lock.yaml`.

### Branch and disk checks

Before the closeout commit, local, tracking, and remote branch SHA all matched:

```text
local    1a64b4b6c79bca09ef59a82beed72cd7139c107f
tracking 1a64b4b6c79bca09ef59a82beed72cd7139c107f
remote   1a64b4b6c79bca09ef59a82beed72cd7139c107f
```

```text
df -h /System/Volumes/Data
/dev/disk3s5  460Gi  351Gi  55Gi  87%  ...  /System/Volumes/Data
```

Free space was `55 GiB`, above the required `30 GiB` floor.

## Limitations and closeout

Outcome B remains partial because the synthetic source hash mismatch and its
four-note validator failure are hard evidence failures under the frozen
promotion rule. No promotion is authorized. This verification does not claim
recognizability, musical quality, human playability, audio/listening
acceptance, or human acceptance. It did not render audio, inspect EVAL_ONLY or
excluded material, use network/source research, replay production, deploy, or
alter the frozen preregistration. Deferred concerns remain
`COVER_RH_IDENTITY_CLIFF` and `DIFFICULTY_DIFFERENTIATION_CONCERN`.
