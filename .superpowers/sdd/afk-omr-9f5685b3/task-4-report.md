# Task 4 report — role-specific consensus and grouped review references

Date: 2026-08-30

## Delivered

- Added `packages/catalog/src/omr-role-reference.ts`, a pure additive projection over `OmrConsensusReport`.
- Exported the module from `packages/catalog/src/index.ts`.
- Added `packages/catalog/test/omr-role-reference.test.ts` with six synthetic cases.

The projection emits deterministic melody, harmony, and rhythm lanes; explicit unknown masks; role-specific trusted/eligible/unknown beat coverage; sanitized source metadata; and native, dual-engine-consensus, or single-engine provenance. Explicitly role-null events are omitted from every lane and represented as `role-unassigned` evidence when the role cell is otherwise trusted. Tied segments are collapsed into one role attack while retaining source segment IDs.

The optional `RoleAlignmentRegion` adapter accepts aligned/split/merged regions and fails closed for ambiguous, unmatched, or low-confidence regions. Without an adapter, the reference marks `alignment: "flat-fallback"` so consumers cannot mistake the temporary measure-order projection for hierarchical alignment.

`groupOmrReviewRegions` is diagnostic only. It derives root causes from structured disagreement kinds, groups only adjacent compatible items, preserves raw `report.reviewItems` unchanged, and exposes stable measure/page/confidence/event-count/priority metadata. `summarizeOmrReviewGroups` provides raw/grouped/critical counts for later corpus consumers.

## Verification

- `npm exec -- vitest run packages/catalog/test/omr-role-reference.test.ts` — 6 tests passed.
- `npm run typecheck -w @keyspilli/catalog` — passed.
- `npm run test -w @keyspilli/catalog` — 50 test files, 446 tests passed.
- `git diff --check` — run before commit.

## Boundaries

No consensus thresholds, `OmrConsensusReport` fields, raw review items, corpus I/O, production state, or corpus artifacts were changed. Role-vote comparison was intentionally deferred: this task consumes existing trusted role states and leaves independent event-vote semantics for a later alignment-backed task.
