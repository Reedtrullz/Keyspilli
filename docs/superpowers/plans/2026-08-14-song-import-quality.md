# Song Import Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make imported songs structurally valid and musically trustworthy from first publication by fixing artifact roundtrips and gating low-quality variants.

**Architecture:** Keep source-note generation and variant reduction intact where possible, but make MIDI and MusicXML serializers lossless for supported piano material. Add quality metrics at validation/import boundaries so broken or suspicious sources are quarantined instead of publishing six misleading levels.

**Tech Stack:** TypeScript, Vitest, `@keyspilli/midi`, catalog ingestion scripts, SQLite-backed catalog.

## Global Constraints

- Preserve existing base IDs and do not delete unrelated uncommitted files.
- Follow test-driven development: each production fix starts with a failing regression test.
- Keep artifact roundtrips deterministic and verify with full test/build/catalog commands.
- Do not silently change source pitches without a measurable warning or rejection path.

### Task 1: Roundtrip Regression Tests

**Files:**
- Modify: `packages/midi/test/midi.test.ts`
- Modify: `packages/midi/test/parseXml.test.ts`
- Test fixtures: inline note arrays only; no generated binaries committed.

- [x] Write a failing test proving overlapping same-pitch notes survive MIDI write/parse with distinct durations.
- [x] Write a failing test proving interleaved right/left-hand notes survive MusicXML write/parse at their original starts and durations.
- [x] Run both tests and record the expected failures before changing production code.

### Task 2: Lossless MIDI Serialization

**Files:**
- Modify: `packages/midi/src/writeMidi.ts`
- Test: `packages/midi/test/midi.test.ts`

- [x] Implement deterministic track/voice partitioning (or equivalent channel-aware pairing) so overlapping same-pitch note-ons never replace one another.
- [x] Preserve note start, duration, pitch, velocity, tempo, and ordering through the existing parser.
- [x] Run focused MIDI tests, then the full `@keyspilli/midi` suite.

### Task 3: Correct Grand-Staff MusicXML

**Files:**
- Modify: `packages/midi/src/writeXml.ts`
- Modify: `packages/midi/src/parseXml.ts` only where needed to consume the valid structure.
- Test: `packages/midi/test/parseXml.test.ts`

- [x] Emit separate staff streams with explicit cursor resets (`backup`/`forward`) and chord markers scoped to a staff/voice.
- [x] Keep measure offsets, cross-staff note timing, and notes crossing boundaries consistent with the parser.
- [x] Run focused XML tests and the full MIDI package suite.

### Task 4: Import Quality Gates

**Files:**
- Modify: `packages/midi/src/validate.ts`
- Modify: `packages/catalog/src/ingest.ts`
- Modify: `packages/catalog/scripts/verify-catalog.ts`
- Test: `packages/catalog/test/ingest.test.ts` and/or a new focused validation test.

- [x] Add artifact roundtrip and suspicious-reduction checks to validation without making tempo-dependent thresholds inconsistent.
- [x] Quarantine or reject sources whose generated variants fail hard structural checks; keep warnings for explainable soft issues.
- [x] Add a regression test showing a clearly broken source is not published as six apparently valid levels.

### Task 5: Catalog-Wide Verification and Documentation

**Files:**
- Retain/refine: `packages/catalog/scripts/audit-catalog.ts`
- Write: audit outputs under `output/` as untracked evidence only.
- Log: today's Obsidian daily note via the `$obsidian` skill.

- [x] Run `npm test`, `npm run typecheck`, `npm run build`, `npm run verify-catalog`.
- [x] Re-run the catalog audit and compare MIDI/XML roundtrip error counts with the baseline.
- [x] Check `/private/tmp` for stale owned Vifty directories and report any remaining blockers.
