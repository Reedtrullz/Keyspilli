# Task 5 report: seven-song external symbolic benchmark orchestration

## Scope delivered

- Added `packages/catalog/src/external-benchmark.ts` with the inventory-only
  seven-song ID constant, provider-neutral local candidate/reference inputs,
  fail-closed window/input validation, candidate discovery/acquisition/usable
  counts, immutable generation freeze metadata, symbolic/fallback/unavailable
  output status, reference alignment diagnostics, human-rater readiness, and a
  deterministic canonical SHA-256 report hash.
- Added `packages/catalog/scripts/evaluate-external-symbolic.ts` and the
  `evaluate:external-symbolic` package script. The command accepts only an
  explicitly supplied absolute local manifest and optional output path. It does
  not download, upload, copy, stage, replay, or publish source/benchmark bytes.
- Added synthetic tests covering inventory completeness, missing/metadata-only
  evidence, parsed local candidates, benchmark/reference exclusion,
  freeze-before-reference ordering, deterministic reordered-input hashes,
  explicit windows, missing evidence, human rater thresholds/conflicts, and
  CLI local-path validation. Follow-up hardening adds role-filtered alignment,
  malformed manifest fail-closed reporting, arbitrary POSIX/relative path
  redaction, duplicate candidate/reference ID rejection, anonymous/duplicate
  rater blocking, and keeps the module out of the public catalog barrel.

## Verification

Commands run from the repository root:

```text
./node_modules/.bin/vitest run packages/catalog/test/external-benchmark.test.ts
  1 file, 10 tests passed

./node_modules/.bin/vitest run packages/catalog/test/external-benchmark.test.ts packages/catalog/test/external-symbolic-pipeline.test.ts packages/catalog/test/external-research.test.ts packages/catalog/test/external-evidence.test.ts packages/catalog/test/arrangement-evaluation.test.ts packages/catalog/test/piano-section-builder.test.ts
  6 files, 98 tests passed

pnpm --filter @keyspilli/catalog exec tsc --noEmit
  passed (pnpm emitted the existing workspace-field warnings)

git diff --check
  passed

./node_modules/.bin/tsx packages/catalog/scripts/evaluate-external-symbolic.ts --help
  passed; local-only usage printed

./node_modules/.bin/vitest run packages/catalog/test
  79 passed test files, 734 passed tests, 6 failed unchanged
```

The six full-catalog failures are the existing Hermes subprocess-environment
failures in `restore-curated.test.ts` and `verify-catalog.test.ts`: that runtime
cannot resolve the workspace `tsx` package. The new test and all focused
neighboring tests pass. The direct repository `tsx` binary passed the package
CLI smoke command.

## Boundaries and non-claims

- Candidate research and freezing happen in a separate phase before any
  reference evaluation alignment. Reference records are marked
  `BENCHMARK_REFERENCE`, rejected by the existing generation firewall, and
  never passed to candidate selection, freezing, arrangement construction, or
  generation alignment as input. Post-freeze evaluation alignment is allowed
  only for diagnostics.
- Reports omit physical paths, raw bytes, raw note/event arrays, timestamps,
  and local executable details. Inventory IDs are labels only and are not
  added to leak-guard logic.
- The automated report is structural/evaluation evidence only. It does not
  establish musical recognizability, usefulness, or human acceptance; human
  readiness stays blocked until two or more supplied raters agree without
  conflict.
- No external media, protected references, credentials, or generated
  benchmark artifacts were added to the repository.

## Commit

Implementation commit: `8487b7d`; final hardening is `78fd86d`, with the
local-only barrel boundary in `d167a2c`.
