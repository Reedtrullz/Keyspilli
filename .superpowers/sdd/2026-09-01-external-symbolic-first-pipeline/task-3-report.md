# Task 3 report: frozen symbolic generation candidates and route coverage

## Delivered

- Added `packages/catalog/src/external-symbolic-pipeline.ts` with a pure
  generation freeze boundary, immutable selected/rejected records, deterministic
  order and metadata-only digest, explicit identity/hash/local-acquisition
  checks, parser/generation/alignment/confidence gates, and section metadata.
- Benchmark/reference records are rejected before selection and are filtered
  again at the realization seam. Candidate metadata is path-safe and strips raw
  note/event/byte fields; normalized score events remain available only as the
  local realization input.
- Added an optional realization adapter around the existing section-aware
  piano builder. It consumes only frozen sources, requires explicit windows (or
  frozen primary sections), and returns symbolic, fallback, or unavailable
  without fabricating notes.
- Added explicit evidence-class route coverage. Note attribution is accepted
  only through class/index records supplied by the caller; `Note.identitySource`
  is never interpreted as an evidence class. Missing or incomplete attribution
  returns null percentages and deterministic diagnostics.
- Review hardening requires realization to receive a deeply immutable,
  schema-1, digest-consistent frozen set; the `candidates` alias cannot bypass
  this boundary. Frozen candidate metadata now removes compound raw
  note/event/byte payload keys, record content hashes must be valid and match
  candidate hashes, malformed section rows reject without throwing, and route
  coverage rejects malformed, negative, or non-finite totals/attributions.
- Exported the new boundary from `packages/catalog/src/index.ts` and added
  synthetic in-memory tests covering benchmark exclusion, order-invariant
  digest, roles/sections, malformed/non-parsed/low-confidence/misaligned
  rejection, path-safe immutability, symbolic realization/fallback, and route
  coverage with and without attribution.

## Verification

Commands run from `/Users/reidar/Projectos/Keyspilli`:

```text
./node_modules/.bin/vitest run packages/catalog/test/external-symbolic-pipeline.test.ts
  1 file, 13 tests passed

./node_modules/.bin/vitest run packages/catalog/test/external-symbolic-pipeline.test.ts packages/catalog/test/external-evidence.test.ts packages/catalog/test/external-research.test.ts packages/catalog/test/piano-section-builder.test.ts packages/catalog/test/route-funnel.test.ts packages/catalog/test/arrangement-evaluation.test.ts
  6 files, 87 tests passed

pnpm --filter @keyspilli/catalog exec tsc --noEmit
  passed

./node_modules/.bin/vitest run packages/catalog/test
  79 files; 710 passed, 6 failed (pre-existing environment failures)

git diff --check
  passed
```

The initial focused test was run before implementation and failed as expected
because `../src/external-symbolic-pipeline.js` did not exist. The six full-suite
failures are unchanged subprocess-environment failures in
`restore-curated.test.ts` and `verify-catalog.test.ts`: they invoke
`/Users/reidar/.hermes/node/bin/node --import tsx` with cwd `/Users/reidar`,
where `tsx` cannot be resolved (`ERR_MODULE_NOT_FOUND`). No changed test or
neighboring research, builder, route, or arrangement test failed.

## Boundaries and caveats

This task is local and pure. It does not acquire external media, access
benchmark/reference files, perform network requests, alter the production
worker, change `Note`/IR/public payload contracts, or claim musical
recognizability. Symbolic output remains an automated structural candidate;
human listening and acceptance are separate gates. The fallback result is an
explicit route status, not generated audio or fabricated notes.

## Commit

Implementation commit: `feat(catalog): freeze symbolic generation candidates`
