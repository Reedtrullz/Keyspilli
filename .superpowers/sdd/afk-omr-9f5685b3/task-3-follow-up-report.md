# Task 3 follow-up report — review hardening

## Review findings addressed

- Replaced ambiguous insertion labels with explicit `candidate-missing`
  (reference-only measure) and `reference-missing` (candidate-only measure)
  relations and diagnostics.
- Applied `phraseBreakBeats` to split/merge guards so those transitions cannot
  cross a configured phrase gap.
- Tracked the second-best local DP transition at every bounded cell. A local
  alternative within `ambiguityMargin` marks the page and overall alignment
  ambiguous, while retaining deterministic precedence for the selected path.
- Replaced greedy lane consumption with a deterministic rectangular assignment:
  bitmask dynamic programming for up to 12 candidate lanes, with a bounded
  deterministic pair fallback above that cap. Close lane evidence remains
  ambiguous/fail-closed.
- Validated raw and normalized timing/page metadata before alignment. Invalid
  starts, durations, event timing, or pages return `unavailable` with all
  measures unmatched rather than an apparent perfect match.
- Duplicate non-contiguous explicit page identities remain represented as
  invalid/unmatched page groups, including duplicate candidate pages.
- Replaced Cartesian event-pair construction with bounded monotone one-to-one
  matching. `maxEventTokens` defaults to 8,192 and emits an explicit region
  diagnostic when exceeded.

## Tests and verification

Added six synthetic review regressions to
`packages/catalog/test/omr-hierarchical-alignment.test.ts` for corrected
missing/extra semantics, phrase gaps, near-tied DP paths, malformed raw
timing, duplicate candidate pages, and the event-token cap. The complete
hierarchical test file now has 16 tests.

- `../../node_modules/.bin/vitest run test/omr-hierarchical-alignment.test.ts`
  — 16/16 passed.
- Focused OMR suite (`omr-hierarchical-alignment`, `omr-canonical`,
  `omr-consensus`, `omr-musicxml`) — 57/57 passed.
- `../../node_modules/.bin/tsc --noEmit -p tsconfig.json` — passed after the
  concurrent role-reference module became available.
- `git diff --check` — passed for the follow-up work.

## Boundaries

No consensus defaults, corpus adapter, production runtime, PDF/MIDI/corpus
artifact, or protected workspace file was changed. The original Task 3
commit remains `121bfbd`; this follow-up is a separate review-hardening
commit.
