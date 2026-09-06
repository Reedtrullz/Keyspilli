# Task 4 report: Red Baron decoder-survival diagnostics

## Delivered

- Added `packages/catalog/src/red-baron-survival.ts`, a pure stage-survival
  evaluator for `raw -> decoder -> semantic -> canonical -> easy`.
- Stage and reference inputs are normalized from finite Note-like rows while
  invalid rows and rejection reasons remain visible as diagnostics. Adjacent
  stages are matched one-to-one with deterministic stable IDs, parent links,
  pitch/timing tolerances, and mutually exclusive retained, pitch-modified,
  octave-shifted, timing-shifted, rejected, replaced, obscured, addition, and
  unsupported-canonical-expansion categories.
- Reports require all five stages, a valid supplied reference, and explicit
  validated windows before producing transitions. Reference and stage bounds
  remain separate, and absent windows block rather than trigger a global
  comparison. Reference note arrays and internal normalized note arrays are
  omitted from deterministic JSON; provenance and physical paths are
  diagnostics-only and path-redacted.
- Added `packages/catalog/scripts/evaluate-red-baron-survival.ts` and the
  `evaluate-red-baron-survival` package script. The opt-in CLI reads only
  explicit local `.mid`, `.midi`, or note-array `.json` files, rejects URLs,
  directories, missing/duplicate/unknown inputs, supports explicit windows,
  and emits deterministic JSON.
- Added the pure module as a direct local evaluation import and synthetic
  tests covering duplicate-onset accounting, loss categories,
  provenance, unsupported expansions, permutation determinism, fail-closed
  validation, generic decoder-fix gates, and CLI validation.

## Verification

Commands run from the repository root:

```text
./node_modules/.bin/vitest run packages/catalog/test/red-baron-survival.test.ts
  1 file, 13 tests passed

./node_modules/.bin/vitest run packages/catalog/test/red-baron-survival.test.ts packages/catalog/test/external-symbolic-pipeline.test.ts packages/catalog/test/external-research.test.ts packages/catalog/test/external-evidence.test.ts packages/catalog/test/piano-alignment.test.ts
  5 files, 59 tests passed

pnpm --filter @keyspilli/catalog exec tsc --noEmit
  passed (pnpm emitted existing workspace-field warnings)

git diff --check
  passed

./node_modules/.bin/tsx packages/catalog/scripts/evaluate-red-baron-survival.ts --help
  passed; local-only usage printed

./node_modules/.bin/vitest run packages/catalog/test
  80 files; 728 passed, 6 failed
```

The initial focused test was run before implementation and failed because the
new module did not exist. No real Red Baron/reference asset was read, copied,
uploaded, committed, or passed to any decoder.

The six full-suite failures are the existing subprocess-environment failures in
`restore-curated.test.ts` and `verify-catalog.test.ts`: the Hermes subprocess
runtime cannot resolve the workspace `tsx` package. All 13 new tests and all neighboring focused
tests passed.

## Boundaries and caveats

This is structural stage-survival evidence only. It does not establish human
recognizability, musical usefulness, or a generic decoder fix. The fix gate
returns `apply` only when source-independent invariant, synthetic regression,
cross-song improvement, and no-material-regression evidence are all explicitly
true; otherwise it returns `defer` with blockers. The package's existing
workspace setup emits warnings for direct package-script execution, so the
verification invocation used the root `tsx` binary directly; the package
script remains additive and follows the repository's existing script pattern.

Implementation commit: `35d45fc`; final hardening is `6db6a3d`. The module is
kept as a direct local evaluation import by the final boundary commit
`d167a2c`.
