# Beginner Sparse-LH Promotion Evidence Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the promotion evidence boundary for the already-frozen `COLLISION_AWARE_SPARSE_LH` Beginner policy without changing musical behavior, then issue one truthful promotion decision.

**Architecture:** Keep the production policy and prior failed preregistration immutable. Reconcile the historical synthetic hash from tracked source, inventory existing symbolic controls, and add exactly one tracked deterministic control only if existing controls cannot exercise normal validation and the required safety cases. Freeze the control and a fresh preregistration before running the unchanged candidate on the three trusted fixtures and the repaired synthetic control; record the result as CASE A/B/C/D.

**Tech Stack:** TypeScript/JavaScript monorepo, Vitest, pnpm workspace scripts, Git, JSON manifests, existing lower-tier evaluator helpers, local `/private/tmp` scratch reports, and the Hermes Obsidian project note.

**Spec:** `/Users/reidar/.codex/attachments/87caee3a-d692-4386-9e22-6956e6c4f72b/pasted-text.txt`

## Global Constraints

- Do not change collision-aware sparse-LH semantics, RH selection, Beginner budgets, maxSim, density/timing/grid/LH eligibility, defer/suppress behavior, or any other difficulty level.
- Do not edit the historical preregistration, relax validators, use EVAL_ONLY MIDI, run human/audio/production replay, deploy, or upload any reference MIDI.
- Preserve the historical outcome `BEGINNER_SPARSE_TWO_HAND_CONTRACT_PARTIAL` and deferred `COVER_RH_IDENTITY_CLIFF` / `DIFFICULTY_DIFFERENTIATION_CONCERN`.
- Only `BEGINNER_SPARSE_TWO_HAND_PROMOTION_EVIDENCE_CLEAN` authorizes promotion; all other outcomes require `NO_PRODUCTION_BEHAVIOR_CHANGE`.
- Keep the supplied reference MIDI outside the repository and use it only for explicitly aligned local diagnostics; no reference comparison is needed for this evidence repair.
- Never stage or delete existing untracked `.tmp-source-audit/` or `pnpm-lock.yaml`.

---

### Task 1: Forensic baseline and control inventory

**Files:**
- Create: `.superpowers/sdd/2026-09-02-beginner-sparse-lh-promotion-evidence-repair/task-1-report.md`
- Modify: `.superpowers/sdd/2026-09-02-beginner-sparse-lh-promotion-evidence-repair/progress.md`

**Interfaces:**
- Consumes: `packages/catalog/scripts/calibrate-difficulty-ladder.ts`, prior preregistrations and reports, existing synthetic tests, and the baseline commit `29906dff7f454fb6120928a4f57906ee5c05ea02`.
- Produces: an evidence table identifying the authoritative synthetic bytes/hash, the first divergence, the exact two validator errors and classifications, and a `PROMOTION_CONTROL_ELIGIBLE` / `TOO_SMALL` / `MISSING_REQUIRED_BEHAVIOR` / `NOT_PROJECT_OWNED` / `EVAL_ONLY` inventory used by Task 2.

- [ ] **Step 1: Verify baseline and disk floor**

Run `git status --short`, `git rev-parse HEAD`, `git fetch origin`, `git ls-remote origin refs/heads/codex/metal-inference-lane-lock`, and `df -h /System/Volumes/Data`. Record that local and remote both equal `29906dff7f454fb6120928a4f57906ee5c05ea02` and available space is at least 30 GiB.

- [ ] **Step 2: Recompute and trace the historical synthetic hash**

Serialize the tracked `syntheticFullBandNotes()` payload exactly as `inlineBytes()` does, hash it twice, inspect its history, and compare every prior report/preregistration occurrence of `...dc6` and `...dc8`. Record the ruling `SYNTHETIC_HASH_TRANSCRIPTION_ERROR` only if the tracked bytes are unchanged and `...dc8` was copied incorrectly; otherwise use the exact applicable cause from the spec.

- [ ] **Step 3: Extract exact validator failures**

Read the fixed prior report and record each error verbatim with its validator rule, observed value, required value, and classification. Do not collapse two errors into one “minimum-note warning.” Separate mechanical safety, difficulty monotonicity, minimum musical content, corpus adequacy, and other rules.

- [ ] **Step 4: Inventory existing controls**

Inspect the tracked calibrator fixture, shadow-evaluation fixture, lower-tier evaluator tests/helpers, and any other project-owned symbolic controls. For each, record coverage of RH melody, LH anchors, RH/LH collision, two-RH blocking, LH-only activity, rest, harmonic change, filler, drums/provenance, ordinary validator content, and whether it is reusable without changing policy.

- [ ] **Step 5: Write the forensic report and ledger rulings**

The report must state the historical mismatch and exact validator errors, distinguish safety from corpus adequacy, and recommend reuse or one new fixture. The ledger must begin with the plan identity and contain a row for every task plus every shared-file/interface pair, including rulings for any conflict before Task 2 starts.

### Task 2: One promotion control, only if inventory requires it

**Files:**
- Create only if Task 1 finds no suitable control: `packages/catalog/test/fixtures/beginner-sparse-lh-promotion-control.json`
- Create: `packages/catalog/test/beginner-sparse-lh-promotion-control.test.ts` (or extend one existing focused test file if that is the established fixture convention)
- Create: `.superpowers/sdd/2026-09-02-beginner-sparse-lh-promotion-evidence-repair/task-2-report.md`

**Interfaces:**
- Consumes: Task 1’s inventory/ruling and the unchanged candidate policy.
- Produces: exactly one deterministic, project-owned control (or a documented reuse decision), stable bytes/hash, explicit role/provenance counts, normal validator suitability, and focused assertions for every required synthetic safety case.

- [ ] **Step 1: Write the failing control-shape test**

If a new fixture is required, define one short 16–32-measure symbolic structure with sections A–G covering RH melody plus sparse roots, LH-only activity, one legal RH/LH collision, a two-RH blocking collision, a true rest, repeated filler, and drum provenance. The test must assert deterministic serialization, RH/LH/source counts, no drum-derived pitch, enough notes for ordinary validation, and the expected safety cases before the evaluator is run.

- [ ] **Step 2: Create the minimum fixture**

Use only deterministic JSON note data already accepted by the project’s parser/test conventions. Include hand, start, duration, velocity, MIDI pitch, and source/role metadata where the existing types support it. Do not encode song-specific pitches, production exceptions, or policy changes.

- [ ] **Step 3: Run focused tests and the normal validator**

Run the new focused test and the same normal validator used by the prior experiment. A validator failure is not fixed by weakening a rule; redesign the fixture if it is still too small or classify a genuine candidate failure as CASE B.

- [ ] **Step 4: Review and report**

Record fixture path, byte length, SHA-256 computed from two fresh reads, notes, onsets, duration, tempo, meter, RH/LH counts, roles, and suitability. If Task 1 finds an existing eligible fixture, create no new fixture and record the reuse rationale instead.

### Task 3: Freeze provenance and preregistration before evaluation

**Files:**
- Create: `docs/superpowers/plans/beginner-sparse-lh-promotion-evidence-repair-preregistration.json`
- Create: `.superpowers/sdd/2026-09-02-beginner-sparse-lh-promotion-evidence-repair/task-3-report.md`
- Modify: `.superpowers/sdd/2026-09-02-beginner-sparse-lh-promotion-evidence-repair/progress.md`

**Interfaces:**
- Consumes: Task 1 forensic report and Task 2 control/hash (or reuse decision).
- Produces: a fresh preregistration containing unchanged-policy identity, real fixture IDs/hashes, corrected/new synthetic hash, all gates, and explicit CASE A/B/C/D decision rules, committed and pushed before evaluation.

- [ ] **Step 1: Freeze fixture bytes and policy identity**

Hash the selected control twice, record its exact byte length and metadata, and hash/record the unchanged collision-aware sparse-LH implementation/config identity. Confirm `git diff` contains no production-policy files and that the historical preregistration remains byte-identical.

- [ ] **Step 2: Write the fresh preregistration**

Include starting revision, historical outcome, hash-cause ruling, real fixture hashes, control details, validator and RH/non-Beginner parity gates, structural-recovery and neighbor-separation gates, synthetic safety gates, deferred concerns, and the exact four decision strings. Do not include personal paths, reference binaries, or EVAL_ONLY artifacts.

- [ ] **Step 3: Commit and push the evidence freeze**

Commit only the plan, ledger/report, fixture/test if needed, and new preregistration; leave unrelated untracked files untouched. Push the branch and verify `git ls-remote` equals the new local commit before any candidate evaluation.

### Task 4: Re-evaluate unchanged candidate and select the decision

**Files:**
- Create: `.superpowers/sdd/2026-09-02-beginner-sparse-lh-promotion-evidence-repair/task-4-report.md`
- Create: `.superpowers/sdd/2026-09-02-beginner-sparse-lh-promotion-evidence-repair/final-evaluation.json`

**Interfaces:**
- Consumes: the pushed preregistration and frozen control.
- Produces: deterministic fixed reports for Classical, Cover, Pop, the synthetic control, and Very Beginner/Very Easy/Easy/Medium/Advanced neighbors, with exact decision evidence and no production side effect.

- [ ] **Step 1: Reconfirm real fixtures**

Run the unchanged evaluator on Classical, Cover, and Pop. Require exact RH parity, non-Beginner parity, candidate maxSim `<=2`, and all mechanical gates. Any unexpected difference is a real-regression investigation, not a tuning opportunity.

- [ ] **Step 2: Evaluate the frozen control**

Run the normal validator and assert true-rest no-LH, LH-only legal event, one-RH-plus-LH collision allowance, two-RH collision suppression/defer, filler exclusion, maxSim, density/IOI/grid, and provenance/drum safety. Record exact values and failures.

- [ ] **Step 3: Check neighbor separation and determinism**

Compare Very Beginner, Beginner, Very Easy, Easy, Medium, and Advanced notes/onsets/attack rate/max and median simultaneity/LH-active percentage/RH+LH overlap/hand alternation. Repeat the same evaluation twice and require identical canonical bytes and fixture hashes.

- [ ] **Step 4: Select exactly one outcome**

Choose `BEGINNER_SPARSE_TWO_HAND_PROMOTION_EVIDENCE_CLEAN` only when every preregistered gate passes; choose `...SYNTHETIC_SAFETY_FAILURE` for a genuine candidate defect; `...EVIDENCE_STILL_INSUFFICIENT` for unresolved control/provenance evidence; or `...REAL_REGRESSION` for trusted-fixture/parity failure. Do not infer human recognizability or audio quality.

### Task 5: Closeout, broad review, and durable log

**Files:**
- Create: `docs/superpowers/plans/2026-09-02-beginner-sparse-lh-promotion-evidence-repair-results.md`
- Modify: `.superpowers/sdd/2026-09-02-beginner-sparse-lh-promotion-evidence-repair/progress.md`
- Modify: `/Users/reidar/Obsidian/Hermes/Hermes/Personal/Projects/Keyspilli/Keyspilli.md`

**Interfaces:**
- Consumes: all task reports and final evaluation JSON.
- Produces: a concise truthful closeout with the exact outcome, no production action unless CASE A is fully authorized, full verification evidence, deferred concerns, and one follow-up recommendation without implementing it.

- [ ] **Step 1: Run final verification**

Run focused tests, full `@keyspilli/midi` tests, workspace tests, relevant typechecks, `git diff --check`, policy identity checks, deterministic hash comparison, and local/remote SHA checks. Do not stage unrelated files.

- [ ] **Step 2: Dispatch the broad review**

Review the complete branch against the spec, especially the frozen-policy prohibition, old-prereg immutability, fixture/hash provenance, validator integrity, exact decision string, and no-production boundary. Resolve only load-bearing findings; do not begin a new mission after closeout.

- [ ] **Step 3: Write results and ledger completion**

The results document must include starting/checkpoint/final revisions, historical hash mismatch and cause, exact validator errors, fixture evidence, all gate outcomes, exact decision, production state, deferred concerns, and one follow-up task. Mark every task complete in the ledger.

- [ ] **Step 4: Log the meaningful work**

Append one evidence-backed section to the Keyspilli Obsidian project note. Mention the new preregistration, final outcome, hashes, verification, and explicit non-claims; never log secrets, personal paths, reference binaries, or production credentials.
