# Source-bound phrase contract implementation plan

> **For agentic workers:** Use the executing-plans workflow task by task.

**Goal:** Make required musical events and rests survive an explicit, bounded
source-profile arrangement, with exact input binding and inspectable reports.

**Architecture:** Shared source-origin contract in `@keyspilli/midi`; ordinary
`buildVariants` is the first consumer. Catalog verifies source bytes and stores
reports; the maintained CLI exposes the opt-in. Existing musical approval
contracts remain authoritative.

**Tech stack:** TypeScript, Node 22.22.3, Vitest, existing MIDI/XML serializers.

**Spec:** `docs/superpowers/specs/2026-10-12-phrase-contract-design.md`.

## Global constraints

- No default-policy change, new dependency, accepted pin, provider call or release.
- Preserve original source bytes, origins, pickup/ending maps and fidelity reports.
- Reject unsupported or conflicting requirements before catalog publication.
- Role-selection accuracy and source-event retention are separate observations.

## Review focus

- Repeated occurrences and merged origins must not authorize a different note.
- Native-tempo clocks must be checked before normalization and mapped once.
- Role rests must not silence unrelated accompaniment or hide an extended note.
- Restoring protected notes must not silently bypass mechanical limits.
- Re-import/fingerprints must bind the plan, including evidence and policy.

### Task 1: Shared contract and actual reducer consumer

**Files:** `packages/midi/src/phrase-plan.ts`, `types.ts`, `index.ts`,
`simplify.ts`; `packages/midi/test/phrase-plan.test.ts` and authored fixtures.

**Interfaces:** `PhrasePlanV1`, `PhraseProtectionReport`,
`sourcePhraseClock(ParsedMidi)`, `compilePhrasePlan(ParsedMidi, PhrasePlanV1,
sourceSha256)`, `applyPhrasePlan(Variant[], compiled)`.
`buildVariants` accepts optional `phrasePlan` plus verified `sourceSha256`.

- [x] Write integration tests for ignored protection and stale-plan refusal.
- [x] Run focused Vitest; expect real protected-event/status assertions to fail.
- [x] Implement strict bounded compilation, source restoration, rest/policy checks
  and per-tier reports using existing lineage and hand assignment.
- [x] Run focused and MIDI suite; inspect exact output and negative controls.
- [x] Commit the tested contract/consumer together.

### Task 2: Verified intake and reachable source workflow

**Files:** `packages/catalog/src/ingest.ts`, artifact manifest fields as needed,
`apps/web/scripts/prepare-song.mts`, `phrase-plan.mts`, related tests.

**Interfaces:** `IngestInput.phrasePlan`; actual input SHA goes to Task 1.
Preserved plan/report sidecars and plan-sensitive config fingerprint.

- [x] Write failing fresh-catalog tests for plan propagation, mismatch refusal
  and six-row no-write behavior after a protection conflict.
- [x] Wire ingestion and CLI with optional flags, retaining old commands.
- [x] Run actual synthetic preparation/import/reparse and mutation controls.
- [x] Commit the tested workflow and its usage documentation.

### Task 3: Finite evidence and independent review

- [x] Execute fixed authored controls; report retention and selector precision/recall
  separately. All cases were exercised during implementation, so the split labels
  do not establish untouched holdout or musical acceptance.
- [ ] Run combined workspace tests/typecheck/build once all tracks integrate.
- [x] Run canonical-plugin validation for the documented commands.
- [ ] Obtain fresh independent whole-diff review; resolve material findings.
- [ ] Publish exact tested trees as draft PRs, leaving first-wave dependencies
  and independent musical acceptance explicit.
