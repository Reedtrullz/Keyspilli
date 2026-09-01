# Keyspilli Upstream Guitar Attribution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quantify whether the current audio-to-MIDI failure is transcription-, timbre-, mixture-, or separation-limited using a small, legally usable Guitar-TECHS evaluation slice, without changing the production decoder.

**Architecture:** Keep evaluation truth and route orchestration outside the MIDI arranger. A pure catalog evaluator will normalize MIDI truth, match raw candidate events one-to-one, compute paired route metrics and loss decomposition, and emit deterministic path-redacted reports. A local-only runner will acquire a frozen manifest, create bounded mixtures, invoke the existing Basic Pitch/Demucs/BS-RoFormer routes when reproducible, and store only compact metrics/manifests.

**Tech Stack:** TypeScript, existing `@keyspilli/midi` parser/types, existing `direct-amt-evaluation`/fixture hash helpers, `tsx`, `ffmpeg`, current Basic Pitch and Demucs environments, optional local Python route adapters.

**Spec:** User-supplied continuation brief for the Guitar-TECHS upstream attribution mission.

## Global Constraints

- Use Guitar-TECHS first; acquire only a deterministic 12–20-item slice and retain no more than 1.5 GiB (prefer <750 MiB).
- Freeze item selection, truth normalization, route configuration, mixture gains, and budgets before scoring.
- Do not use the seven commercial benchmark MIDI files for development or tuning; they may only be compared descriptively after the controlled experiment is frozen.
- Do not modify eligibility, selector, semantic melody/harmony, canonical, Easy, Medium, Advanced, separator, Basic Pitch, or source-extraction production behavior.
- Raw transcription output is evaluated before arranger post-processing; no route-specific post-processing may enter the comparison.
- Keep dataset/media/model artifacts outside Git and outside ordinary CI; reports must be deterministic and path-redacted.
- Stop when one attribution decision is sufficiently clear; do not implement the follow-up task selected by the report.

---

### Task 1: Freeze Guitar-TECHS acquisition manifest

**Files:**
- Create: `/private/tmp/keyspilli-upstream-20260901/guitar-techs-manifest.json` (local-only, never commit)
- Create: `/private/tmp/keyspilli-upstream-20260901/guitar-techs-research.md`
- Test: `packages/catalog/test/upstream-attribution.test.ts` (manifest/hash fixtures only)

**Interfaces:**
- Produces a frozen manifest with dataset/version/license, selected item IDs, technique labels, modality URLs/paths, annotation/audio hashes, durations, and acquisition status.

- [x] **Step 1: Research the canonical Guitar-TECHS source and item-level files using agent-reach.** Record version, CC BY 4.0 terms, paired DI/amp/MIDI availability, and exact item IDs without downloading a bulk archive.
- [x] **Step 2: Choose 12–20 items before running Basic Pitch.** Cover single notes, scales, fast passages, palm mute, harmonics/pinch harmonics, three/four-note chords, excerpts, and multiple recording setups where available. Record the selection rationale from dataset metadata only.
- [x] **Step 3: Normalize and hash the manifest.** Use stable sorted IDs and SHA-256 fields; redact personal paths in the committed/report form and retain acquisition paths only in the ignored local manifest.
- [x] **Step 4: Add deterministic manifest tests.** Reordered item input must produce the same canonical JSON/hash; missing modality or invalid license metadata must fail closed.
- [x] **Step 5: Commit the manifest/schema test implementation only after the synthetic test passes.**

### Task 2: Implement pure upstream metric evaluator

**Files:**
- Create or modify: `packages/catalog/src/upstream-attribution.ts`
- Modify: `packages/catalog/src/index.ts` only if a stable pure evaluator export is needed
- Test: `packages/catalog/test/upstream-attribution.test.ts`

**Interfaces:**
- `normalizeUpstreamTruth(notes, metadata): UpstreamTruth`
- `evaluateUpstreamRoute(truth, candidate, options): UpstreamRouteMetrics`
- `compareUpstreamRoutes(truth, routes): UpstreamAttributionReport`
- `canonicalUpstreamReport(report): string`

- [x] **Step 1: Write failing synthetic tests for MIDI truth normalization and one-to-one matching.** Cover duplicate same-onset notes, jitter tolerance, exact pitch, pitch class, octave displacement, duration, and unsupported candidate rate.
- [x] **Step 2: Implement deterministic normalization.** Preserve pitch/onset/duration/string/fret/technique where available; stable-sort notes by onset, pitch, duration, and source index; reject malformed notes rather than repairing them.
- [x] **Step 3: Implement route metrics.** Emit onset/exact/PC precision-recall-F1, octave matches, duration/onset residuals, candidate density, unsupported/sec, octave flips, and per-technique aggregates. Use one-to-one matching, not many-to-one nearest-neighbor reuse.
- [x] **Step 4: Implement paired deltas and loss decomposition.** Define transcription floor, DI→amp timbre loss, isolated amp→mixture loss, mixture→separator recovery/loss, and residual gap with explicit nulls when a route is unavailable.
- [x] **Step 5: Implement stable, path-free JSON canonicalization and tests.** Exclude timestamps/runtime paths from the determinism hash; include route/config/source hashes and availability statuses.
- [x] **Step 6: Run the focused evaluator tests and commit this pure slice.**

### Task 3: Add bounded local route and mixture runner

**Files:**
- Create: `packages/catalog/scripts/evaluate-upstream-guitar.ts`
- Create or modify: `packages/catalog/src/upstream-attribution-runner.ts`
- Test: `packages/catalog/test/upstream-attribution-runner.test.ts`

**Interfaces:**
- `buildControlledMixture(inputs, recipe): MixtureArtifact`
- `runBasicPitchRoute(audio, config): RouteOutput`
- `runDemucsRoute(mixture, config): RouteOutput`
- `runExistingBsRoformerRoute(mixture, config): RouteOutput | unavailable`
- `evaluateUpstreamExperiment(manifest, options): Promise<UpstreamAttributionReport>`

- [x] **Step 1: Write failing tests for exact route input identity, Basic Pitch config equality, deterministic gain/SNR mixture hashes, and fail-closed unavailable routes.**
- [x] **Step 2: Reuse the current Basic Pitch flags from `services/transcribe/src/stem-pipeline.ts`/`packages/catalog/scripts/audio-ab.ts`; record executable/config/version hashes without changing them.**
- [ ] **Step 3: Implement bounded mixture creation.** Use project-owned/generated distractor stems, a fixed guitar-dominant/balanced/buried gain matrix, one sample-rate policy, and hashes for every input/output; reject oversized inputs and enforce the disk floor.
- [ ] **Step 4: Invoke direct DI, amp/mic, direct mixture, Demucs→Basic Pitch, and only the already-tested BS-RoFormer route when its exact checkpoint/config is locally reproducible.** Do not search for or install another model in this task.
- [x] **Step 5: Emit one compact report per run plus a path-safe manifest.** Keep all WAV/stem intermediates in one bounded `KEYSPILLI_ARTIFACT_ROOT` directory and delete reacquirable bulky files after scoring.
- [x] **Step 6: Run runner tests with mocked commands, then commit the runner.**

### Task 4: Execute frozen benchmark and attribution decision

**Files:**
- Create: `/private/tmp/keyspilli-upstream-20260901/upstream-attribution-report.json`
- Create: `/private/tmp/keyspilli-upstream-20260901/closeout.md`
- Modify: `.superpowers/sdd/2026-09-01-keyspilli-upstream-attribution/progress.md`

- [x] **Step 1: Freeze the manifest, truth normalization, route configs, and mixture recipe; hash each before live inference.**
- [x] **Step 2: Acquire only the selected Guitar-TECHS files and independently verify duration/offset/last event; fail problematic items instead of manually nudging them.**
- [x] **Step 3: Run DI→Basic Pitch and amp/mic→Basic Pitch first.** If DI is clearly poor, stop at `TRANSCRIPTION_LIMITED` and do not spend time on separation routes.
- [ ] **Step 4: If justified, run the fixed mixture matrix and current Demucs route; run existing BS-RoFormer only if reproducible without new acquisition.**
- [x] **Step 5: Aggregate paired technique/modal metrics and map the controlled signatures descriptively to Final Solution, Gott Mit Uns, and Red Baron without reference tuning.**
- [x] **Step 6: Choose exactly one or more of `TRANSCRIPTION_LIMITED`, `TIMBRE_LIMITED`, `MIXTURE_INTERFERENCE_LIMITED`, `SEPARATION_LIMITED`, or `MULTIPLE`; answer all 14 questions in the closeout.**
- [x] **Step 7: Delete bulky reacquirable media/models, retain compact manifests/reports/hashes, and record bytes acquired/deleted/retained.**

### Task 5: Final verification and project logging

**Files:**
- Modify: Hermes Obsidian project note `Personal/Projects/Keyspilli/Keyspilli.md`
- Modify: Hermes daily note `Daily/01-09-2026.md`

- [x] **Step 1: Run focused upstream tests, full workspace tests, all six typechecks, `git diff --check`, and a deterministic report rerun.**
- [x] **Step 2: Verify remote SHA parity, clean tracked status, artifact size <500 MiB (prefer <100 MiB), and free disk ≥30 GiB.**
- [x] **Step 3: Confirm no commercial reference leakage, protected-media push, merge, deploy, production replay, catalog mutation, decoder/arranger tuning, or unapproved model/source work.**
- [x] **Step 4: Log the evidence-backed decision and deferred follow-up in the project note and daily note.**
- [x] **Step 5: Commit and push only code/tests/docs from this mission; never stage dataset audio, MIDI, checkpoints, or personal paths.**
