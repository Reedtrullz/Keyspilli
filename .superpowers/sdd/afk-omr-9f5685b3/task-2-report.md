# Task 2 implementation report — canonical score spine

## Scope

Implemented the pure engine-neutral OMR canonical representation in
`packages/catalog/src/omr-canonical.ts`, consuming the existing
`OmrScoreInput`/`normalizeOmrScore` types. The module has no parser, database,
filesystem, network, or production-runtime imports. It is exported additively
from `packages/catalog/src/index.ts`.

## API and behavior

- `RationalBeat` stores reduced integer numerator/denominator pairs with a
  positive denominator. Numeric beats use deterministic decimal/continued-
  fraction conversion, including common triplets such as `1 / 3`.
- `CanonicalNotationEvent` retains absolute and measure-relative beat
  positions, duration, sounding MIDI, pitch class, accidental/spelling,
  tuplet status, source part/measure/staff/voice/role, and normalized tie flags.
- `CanonicalPerformedToken` collapses contiguous tied note segments into one
  performed-duration token while retaining all notation segments, spellings,
  and aggregate tie diagnostics. Unmatched tie stops are retained as events
  and emitted as warnings.
- `measure.fingerprint` is an FNV-1a content hash over canonical duration,
  meter/key, attack positions, performed durations, pitch classes, and note/
  rest token types. Source IDs and topology are excluded.
- `compareCanonicalTokens` sorts input deterministically and compares musical
  content without requiring part/staff/voice/role identity. It exposes
  semantic distance/agreement plus separate pitch, performed-rhythm,
  spelling, and notation-tie diagnostics. Tied segmentation does not add a
  semantic distance penalty.
- Follow-up fix: tie-marked continuation/stop matching tolerates the existing
  six-decimal `normalizeOmrScore` rounding, and a completed tied duration snaps
  to an integer only within that same two-microbeat safety window. Untied notes
  still compare exactly. Three rounded `1/3` segments now collapse to one exact
  one-beat token.

## Tests

Added `packages/catalog/test/omr-canonical.test.ts` covering:

1. equivalent different part/staff/voice IDs;
2. enharmonic pitch agreement with spelling diagnostics;
3. tied segmentation versus a sustained event;
4. true pitch and rhythm disagreement;
5. deterministic reordered input;
6. reduced rational beats;
7. rounded triplet tie adjacency.

TDD evidence: the focused test was first run before the module existed and
failed at import with `Cannot find module '../src/omr-canonical.js'`; it then
passed after the minimal implementation.

## Verification

- `pnpm exec vitest run packages/catalog/test/omr-canonical.test.ts` — 7/7
  passed.
- `pnpm --filter @keyspilli/catalog typecheck` — passed.
- `pnpm exec vitest run packages/catalog/test` — 417/423 passed; six existing
  `restore-curated`/`verify-catalog` failures are caused by their child
  processes resolving `/Users/reidar/packages/...` and failing to locate
  `tsx`, not by this change. The new canonical test passed in this run.
- `git diff --check` — passed.

## Concerns / follow-up boundary

This task intentionally does not implement hierarchical measure alignment,
corpus CLI integration, or production catalog behavior. Tie-chain matching
uses source part plus staff/voice when available to disambiguate simultaneous
same-pitch voices; later alignment can ignore those source fields through the
role-independent token comparator.
