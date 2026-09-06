# Task 5 report: melody bootstrap review pack

Status: implemented locally; no source-note or catalog/runtime changes.

## Files

- `packages/catalog/src/melody-review-pack.ts`
  - Pure path-redacted planner for readiness/corpus JSON-shaped projections.
  - Normalizes melody review regions, role groups, queue items, and quality rows without traversing or copying raw note arrays.
  - Deterministically ranks units by unlock value, human cost, priority/state, and evidence; seeds up to three score lanes and caps bootstrap work at 20 (with fewer than 10 preserved honestly when evidence is sparse).
  - Emits canonical JSON, `MELODY-REVIEW.md` content, and lightweight HTML content.
  - Adds a private correction-ledger schema/validator/application seam. Ledger entries carry score hash, group/unit/event identifiers, explicit decision, rationale, and bounded corrected values; stale hashes and mismatched event IDs fail closed; repeated application is idempotent.
- `packages/catalog/scripts/report-melody-review.ts`
  - Local-only JSON-to-JSON/Markdown/HTML CLI with input/output repository-boundary checks, optional ledger application, and redacted errors.
- `packages/catalog/test/melody-review-pack.test.ts`
  - Six focused tests covering ordering determinism, grouping, bootstrap cap/score spread, stale ledger rejection/idempotence, redaction, and empty/unavailable cases.

## Verification

- `./node_modules/.bin/vitest run packages/catalog/test/melody-review-pack.test.ts --reporter=dot`: 6/6 passed.
- `./node_modules/.bin/tsx packages/catalog/scripts/report-melody-review.ts --help`: passed.
- `git diff --check` for Task-5 files: passed.
- `./node_modules/.bin/tsc --noEmit -p packages/catalog/tsconfig.json`: blocked by pre-existing/concurrent Task-2 errors in `packages/catalog/src/harmony-evaluation.ts` (`notesPerAttack`, `lowRegisterCloseIntervalRate`, and a readonly union argument); no Task-5 diagnostic was reported.

## Deliberate boundaries

- No extraction, generation, melody selection, MIDI/MusicXML reading, source-score copying, production mutation, or catalog barrel/package-script edits.
- Automated readiness/OMR evidence remains explicitly non-human; no human decisions are fabricated.
- A correction ledger is an application seam over the path-free review projection, not an automatic correction of source notes.
