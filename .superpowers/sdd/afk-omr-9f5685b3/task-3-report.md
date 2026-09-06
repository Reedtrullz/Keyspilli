# Task 3 implementation report — hierarchical page/staff/measure alignment

## Scope

Implemented the pure additive hierarchical OMR alignment surface in
`packages/catalog/src/omr-hierarchical-alignment.ts`, exported from
`packages/catalog/src/index.ts`. It consumes canonical scores (and accepts
the existing normalized score shape or raw `OmrScoreInput` as adapters), and
does not perform PDF, MusicXML, MIDI, corpus, filesystem, network, or database
I/O. The existing flat `alignOmrScores()` and consensus defaults are unchanged.

## API and behavior

- `alignHierarchicalOmrScores()` returns page alignments, staff/lane mappings,
  page-local measure relations, event references, unmatched indices, a score,
  and diagnostics. `alignOmrScoresHierarchical()` and
  `alignOmrScoresHierarchically()` are discoverable aliases.
- Explicit positive page numbers pair only with the same page number. Missing
  page metadata remains unmatched unless `allowPageOrdinalFallback` is
  explicitly enabled. Invalid and non-contiguous duplicate page identities
  are diagnosed and fail closed.
- Staff/lane evidence uses rhythm, pitch-class histogram, register range,
  topology, and weak role hints. Candidate ties within `ambiguityMargin` are
  reported as ambiguous rather than arbitrarily mapped; role-null mappings
  are marked as inferred diagnostics.
- Each paired page uses a bounded monotone DP with one-to-one,
  reference-split (1:2), candidate-merge (2:1), and explicit insertion/deletion
  transitions. Split/merge candidates require duration-sum and boundary-attack
  guards. `maxPageCells` prevents an unbounded matrix and returns an ambiguous
  page diagnostic when exceeded.
- Event alignment compares performed canonical tokens in a page-local beat
  domain, returning references to canonical token IDs and preserving
  tie-segmentation differences as notation diagnostics. No event payload is
  fabricated or selected as consensus.

## Tests

Added `packages/catalog/test/omr-hierarchical-alignment.test.ts` with synthetic
fixtures covering:

1. explicit page-first pairing and deterministic reordered input;
2. renamed/reordered staff lanes and role-null inference;
3. indistinguishable lane ambiguity;
4. middle-measure deletion without later drift;
5. guarded 1:2 split and 2:1 merge event offsets;
6. false split rejection;
7. missing page metadata and opt-in ordinal fallback;
8. malformed metadata and bounded cell guard;
9. tie-safe performed events with notation diagnostics; and
10. unchanged flat alignment defaults.

TDD evidence: the focused test was first run before the module existed and
failed at import with `Cannot find module '../src/omr-hierarchical-alignment.js'`.
It passed after the minimal implementation and subsequent strictness fixes.

## Verification

- `../../node_modules/.bin/vitest run test/omr-hierarchical-alignment.test.ts` —
  10/10 passed.
- `../../node_modules/.bin/vitest run test/omr-hierarchical-alignment.test.ts
  test/omr-canonical.test.ts test/omr-consensus.test.ts test/omr-musicxml.test.ts`
  — 51/51 passed.
- `../../node_modules/.bin/tsc --noEmit -p tsconfig.json` — passed.
- Full catalog `vitest run` — 399 passed, 9 skipped, 26 failures in existing
  DB-backed tests. Those failures are environment/toolchain failures: the
  checked-in `better-sqlite3` binary has `NODE_MODULE_VERSION 127`, while the
  spawned Node 20.20.2 runtime requires 115. No failing test exercised the
  new pure module.
- `git diff --check` — passed for tracked changes; final staged diff check is
  performed before commit.

## Release boundary

This task intentionally does not wire hierarchical evidence into
`buildOmrConsensus()`, corpus adapters, role-specific consensus, or production
runtime defaults. Those remain later mission tasks so uncertain alignment
cannot silently change existing trust counts.
