# Cover RH Identity Cliff Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a deterministic, source-backed diagnosis of the current Cover Very Easy→Beginner RH identity cliff without changing musical generation behavior.

**Architecture:** Reuse `buildVariants`' existing opt-in lineage trace and `evaluateDifficultyLadder` metrics. Add a small pure diagnostic module that matches RH events one-to-one, attributes first loss, characterizes onset/voice/reattack geometry, and runs one equal-budget RH oracle plus one bounded diagnostic bypass. A CLI will generate a path-free JSON report for the three project-owned fixtures; a durable Markdown/JSON evidence report will record the decision.

**Tech Stack:** TypeScript, `@keyspilli/midi`, existing catalog evaluator, Vitest, `tsx`.

**Spec:** User-provided `CURRENT_COVER_RH_IDENTITY_CLIFF_ATTRIBUTION` mission in `/Users/reidar/.codex/attachments/c8d1e66b-ae53-4067-afb3-01b7ee6b9241/pasted-text.txt`.

## Global Constraints

- Do not alter public five-level projection or promoted Beginner sparse-LH policy.
- Do not change musical generation behavior unless the explicit CASE-A gate is proven; default behavior is `NO_MUSICAL_BEHAVIOR_CHANGE`.
- Use only project-owned Classical/Cover/Pop fixtures and synthetic in-memory tests; no supplied/reference MIDI, upstream research, audio, human audit, deploy, or production replay.
- Keep reports deterministic, path-free, and one-to-one in event matching.
- Preserve six physical levels and five public levels.

---

### Task 1: Freeze current outputs and add the diagnostic data contract

**Files:**
- Modify: `packages/midi/src/simplify.ts` (trace-only Beginner stage snapshots)
- Modify: `packages/catalog/src/arrangement-evaluation.ts` (only reusable trace-stage/type exports if required)
- Create: `packages/catalog/src/cover-rh-cliff.ts`
- Test: `packages/catalog/test/cover-rh-cliff.test.ts`

**Interfaces:**
- Consumes: `buildVariants(..., { arrangementProfile: "learner", trace })`, `evaluateDifficultyLadder`, `Variant`, `Note`, `ProvenanceTraceEvent`.
- Produces: `evaluateCoverRhIdentityCliff(input)`, deterministic `CoverRhCliffReport`, and one-to-one `matchRhEvents`/`analyzeRhStructure` helpers for the CLI and report.

- [x] **Step 1: Add failing synthetic tests** for one-to-one RH matching, same-onset collapse accounting, first-loss stage attribution, onset-vs-event survival, repeated-attack classification, and deterministic output under reversed input order.
- [x] **Step 2: Run the focused catalog test** and confirm the new diagnostic API is absent/fails.
- [x] **Step 3: Emit trace-only Beginner snapshots** around the existing `beginnerRhSource`, `beginnerRh`, `beginnerSource`, `beginner`/playability, and ladder/final arrays; do not change arrays or public output.
- [x] **Step 4: Implement the pure report types/helpers** with stable sorting, 0.08-beat onset grouping, one-to-one matching, structural descriptors, and explicit unavailable values.
- [x] **Step 5: Run the focused test** and confirm all diagnostic assertions pass without changing variant bytes.
- [x] **Step 6: Commit** `feat: add cover rh cliff attribution diagnostics`.

### Task 2: Add the current-budget oracle, counterfactual, and CLI

**Files:**
- Modify: `packages/catalog/src/cover-rh-cliff.ts`
- Create: `packages/catalog/scripts/evaluate-cover-rh-cliff.ts`
- Modify: `packages/catalog/package.json`
- Modify: `package.json`
- Test: `packages/catalog/test/cover-rh-cliff.test.ts`

**Interfaces:**
- Consumes: Task 1 report contract and the three existing fixture JSON files.
- Produces: `evaluate:cover-rh-cliff` CLI with `--revision`/`--out`, equal-budget RH oracle, one generic diagnostic counterfactual, and Beginner→Easy separation metrics.

- [x] **Step 1: Add failing tests** for equal-budget replacement never increasing notes/onsets/density/span/max simultaneity, deterministic oracle output, and a single-stage diagnostic bypass evaluated on Classical/Cover/Pop.
- [x] **Step 2: Implement the transparent oracle** using structural value only; allow equal-cost replacements, never add LH or relax Beginner limits, and report recoverable versus constraint-bound events.
- [x] **Step 3: Implement one counterfactual** that bypasses only the measured dominant Beginner RH loss stage; keep it diagnostic-only and generic, with no fixture IDs or note lists.
- [x] **Step 4: Implement the CLI** loading the three project-owned fixtures, tracing current variants, emitting path-free deterministic JSON, and reporting revision/hash/counts.
- [x] **Step 5: Add the package/root script entries and run focused tests plus CLI determinism twice.**
- [x] **Step 6: Commit** `feat: report cover rh identity cliff attribution`.

### Task 3: Generate the evidence report and close the decision

**Files:**
- Create: `docs/superpowers/plans/2026-09-03-cover-rh-identity-cliff-attribution.md` (this plan is retained as implementation record)
- Create: `docs/superpowers/plans/2026-09-03-cover-rh-identity-cliff-attribution-report.md`
- Create: `docs/superpowers/plans/2026-09-03-cover-rh-identity-cliff-attribution.json`

**Interfaces:**
- Consumes: deterministic CLI output, fresh six-level fixture builds, trace/funnel metrics, oracle/counterfactual results.
- Produces: one exact decision from the mission list and explicit `NO_MUSICAL_BEHAVIOR_CHANGE` unless CASE A is met.

- [x] **Step 1: Run the CLI at the frozen revision** and retain the deterministic JSON outside the repository while inspecting it.
- [x] **Step 2: Write the Markdown report** with fresh reproduction, exact stages, first-loss funnel, structural/loss semantics, playability binding, oracle, one counterfactual, Beginner→Easy distance, characterization, decision, and non-claims.
- [x] **Step 3: Add the path-free deterministic JSON snapshot** with fixture hashes and no raw copyrighted/reference data.
- [x] **Step 4: Verify the report against the CLI output** and document that no generation behavior changed.
- [x] **Step 5: Commit** `docs: record cover rh identity cliff attribution`.

### Task 4: Final verification and evidence ledger

**Files:**
- Modify: `/Users/reidar/Obsidian/Hermes/Hermes/Personal/Projects/Keyspilli/Keyspilli.md` (external durable log)

- [x] **Step 1: Run focused MIDI/catalog tests, full workspace tests, all six typechecks, and `git diff --check`.**
- [x] **Step 2: Rerun the diagnostic CLI and compare canonical hashes byte-for-byte.**
- [x] **Step 3: Reconfirm public five-level/physical six-level outputs and unchanged variant digests.**
- [x] **Step 4: Verify local HEAD equals `origin/codex/metal-inference-lane-lock`, disk free remains at least 30 GiB, and only approved commits are pushed.**
- [x] **Step 5: Append a concise evidence-backed Obsidian entry naming the final SHA, decision, non-claims, and one follow-up task.**
- [x] **Step 6: Commit/push any final report changes and verify remote SHA parity.**
