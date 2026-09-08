# Reliable Metal-to-Piano Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement each approved work package inline. Do not dispatch subagents by default. Research gates precede downstream implementation; a failed gate is not permission to tune against held-out references.

**Goal:** A supported metal YouTube recording produces a recognizable, playable, full-song piano arrangement with five useful difficulties, without per-song operator fixes; unsupported inputs receive an honest failure/review result.

**Architecture:** Preserve the existing worker, separated-role transcription, metal arranger, native symbolic intake and variant/export pipeline. Evaluate source recovery separately from arrangement; use existing source adapters only when identity and timing are demonstrably correct. Promote only measured improvements through the actual worker-to-player boundary.

**Tech Stack:** Existing TypeScript/Node 22 monorepo, Python audio environment, Demucs/Basic Pitch baseline, Vitest and existing local evaluators. No new model dependency selected by this plan.

**Spec:** `docs/research/keyspilli-evidence/metal-to-midi-audit-2026-09-07.md` and the user's requirement that the metal-to-piano system actually works automatically.

## Global Constraints

- Retain melody/riff identity, useful LH accompaniment, full-song structure and all five public difficulties.
- Preserve original sources, approved Livgardet/ABBA artifacts and existing catalog cleanup.
- No automatic replacement of existing catalog songs during research.
- Keep source audio, stems and reference scores private; commit manifests, hashes, code and aggregate evidence only.
- Never tune against frozen evaluation references or reinterpret historical failed gates as passes.
- Measure full-song behavior, not only openings; report per-section failures and worst cases alongside averages.
- Machine integrity, source correctness, musical acceptance and production operation are separate gates.
- Before expensive jobs, require at least 30 GiB local free space; serialize heavy inference and set per-run storage/time limits.
- Current audit fixes are local/uncommitted, not deployed. This document plans work; it does not authorize execution by itself.

## What “just works” will mean

Input: a public, downloadable, single-song URL within the supported duration range. Output: one correct arrangement/version, recognizable lead or riff, coherent accompaniment, source-faithful form, reliable timing, audible balanced hands, valid exports and five usable levels. A native symbolic or piano-cover source may be used only if it matches the intended composition/version and its timing is owned. Never silently substitute a different cover structure for the requested recording.

Initial supported class: clean-vocal melodic/power/heavy metal and reasonably distinct riff-led recordings. Dense extreme metal, unpitched vocals, live crowd-heavy recordings and changing meters are explicitly tested as challenge cases; include them in the supported class only when they pass. This is a proposed starting scope, not an assumption that existing code already handles it.

Initial release target: **at least 18 of 20 previously unseen, supported-class full songs acceptable without per-song intervention**, with no critical defect among outputs marked ready. Acquisition failures and review/withheld results count against end-to-end success; also report source-generation success separately so YouTube access failures cannot hide AMT failures. This is an engineering acceptance target, not a statistical guarantee of universal reliability. Repeat over later unseen cohorts before making broader claims.

Critical defects: wrong song/version, missing or plainly wrong main theme, omitted/repeated musical sections, sustained tempo drift, noisy invented lead, unplayable required hand pattern, missing audible hand, corrupted output. A long RH rest alone is a review signal, not proof of failure.

## Work package 1 — Establish trustworthy baseline evidence

**Files:** `packages/catalog/scripts/evaluate-metal.ts`, `packages/catalog/src/arrangement-evaluation.ts`, their existing tests; `services/transcribe/src/separate_stems.py` and `services/transcribe/test/test_separate_stems.py`; audit report above. Store new private run evidence under one bounded `output/metal-development/` directory.

- [x] Review and retain the two local audit repairs. Run the documented 253 TypeScript checks, Python waveform regression and package typechecks. Do not bundle the unrelated catalog policy change into a code patch.
- [x] Replay identical cached stems through baseline and corrected evaluators. Record role mappings, source hashes, MIDI hashes and effective variant settings. Evaluation corrections must not be represented as musical improvements.
- [ ] Capture the currently deployed model/config/source identities and one full conversion's stage timings, peak memory, disk use and failure path. Never log credentials.
- [x] Separate report conclusions into operational, structural, source-accuracy and musical-acceptance fields; a structural pass must not be labelled overall musical success.

**Exit:** reproducible baseline artifacts and matching worker/evaluator semantics; every claimed pass names what was measured. The existing 15.8-second RH-gap canary remains a diagnostic example, not a new tuning target.

## Work package 2 — Build a small, useful development and holdout set

**Files:** reuse `packages/catalog/src/arrangement-evaluation.ts`, `packages/catalog/src/dense-metal-amt-evaluation.ts`, `packages/catalog/src/cold-metal-transfer.ts`, existing listening/export tools. Add one versioned private-source manifest and one acceptance worksheet beside the audit report, with no copyrighted media embedded.

- [x] Select 12 development full songs: four clean-vocal melodic/power, four riff-led heavy/thrash, four ballad/keyboard-layered. Include already known failures here; they cannot later count as unseen proof.
- [x] Freeze 20 unfamiliar supported-class songs and at least six challenge songs before tuning. Record source/recording identity and exact hashes. Keep scoring references inaccessible to generation/tuning. Any exposed holdout becomes development material and must be replaced before final evaluation.
- [ ] For each development song, annotate opening, verse, chorus, instrumental/solo where present, transitions and ending. Obtain independently checked lead/riff and bass/harmony references for representative sections; do not use the candidate's own MIDI as ground truth.
- [ ] Produce comparable source and piano previews with consistent gain, plus full-song playback. Assign a musician to judge note/phrase correctness and playability. Reidar's recognizable/useful judgment is product acceptance, not a substitute for ground-truth transcription scoring.
- [ ] Record lead pitch/onset errors, extra-note rate, source-supported rests, section coverage, drift, hand balance, hand-span/leap issues and levels' retained theme. Report each song separately, plus medians and worst cases.

**Exit:** baseline scorecard exposing where each failure begins. If references are unavailable, label that measurement unavailable and use explicit listening assessment; do not invent objective accuracy.

## Work package 3 — Fix evidence loss before replacing models

**Files:** `services/transcribe/src/separate_stems.py`, `stem-pipeline.ts`, `tempo.py`, `metal-routing.ts`; corresponding service tests; `packages/midi/src/metal-arrange.ts` only where a reproduced downstream boundary defect exists.

- [ ] A/B the piano-preservation repair on development recordings with identical baseline settings. Check both recovered musical material and extra bleed. Preserve the old configuration/artifacts for comparison.
- [ ] Inspect vocal, guitar/residual and bass predictions separately before arrangement. Locate whether false/missing notes originate in separation, transcription or selection.
- [x] Reproduce and fix timeline disagreement: all role events must share an explicit seconds/beat interpretation. Test half/double-tempo representation and stem mismatch; do not simply relabel BPM while leaving note times wrong.
- [ ] Reproduce any source-to-arrangement drop with a small synthetic regression; fix the shared boundary rather than adding title-specific overrides.
- [ ] Compare all 12 development songs after each meaningful change. Reject gains that introduce a critical regression elsewhere.

**Exit:** corrected evidence transport and a measured list of remaining upstream AMT failures. If notes are still wrong before the arranger, stop tuning arrangement heuristics for those cases.

## Work package 4 — Select the automatic source route using measured evidence

**Files:** `services/transcribe/src/stem-pipeline.ts`, `piano-transcriber.ts`, `external-symbolic-route.ts`, `worker.ts`; `packages/catalog/src/external-symbolic-pipeline.ts` and existing source-candidate intake/ranking contracts after their current callers are verified.

- [ ] Compare the repaired separated Basic Pitch baseline with at most two justified alternatives on development material. Check current model/license/runtime constraints before acquiring dependencies. Existing MuScriptor synthetic results alone do not qualify it for promotion.
- [ ] Score upstream lead/riff accuracy before scoring the piano reduction; retain configuration and per-role timing provenance. Set an explicit compute/storage budget from package 1's runtime measurements.
- [ ] Test a symbolic/piano-source route where an eligible matching source exists. Verify song identity, version, parser success, structure and timing ownership. Reject title-only matches and absent/uncertain alignments.
- [ ] Prefer a route only when its full-song development evidence beats the baseline without a critical regression. If no candidate succeeds, retain the supported boundary and report the unmet research requirement rather than adding another speculative backend.
- [ ] Integrate the selected route into the actual worker once proven; adapter unit tests alone are insufficient. Persist the selected route and actual fallback reason.

**Exit:** at least one automatic, adequately accurate upstream route for each claimed supported class. Without this, the overall promise remains blocked regardless of downstream tests.

## Work package 5 — Turn correct evidence into a coherent piano piece

**Files:** `packages/midi/src/metal-arrange.ts`, `simplify.ts`, existing harmony/arrangement tests, `services/transcribe/src/metal-midi.ts`, and `packages/catalog/src/ingest.ts` only for demonstrated handoff defects.

- [ ] Compare selected identity against source/reference section by section. Check whether vocals should remain the lead and where a guitar riff legitimately takes over; test repeated choruses for consistent treatment.
- [ ] Preserve supported chromatic notes and power-chord ambiguity. Require evidence before adding a major/minor third. Avoid global octave/note-density deletion as a substitute for musical roles.
- [ ] Check LH is useful and playable without masking the lead. Review long jumps, repeated pulses and hand conflicts in context rather than treating all flagged events as errors.
- [ ] Inspect all five public difficulties. Each must preserve the recognizable theme and form; easier levels simplify accompaniment/rhythm without deleting essential melody merely to satisfy note-count monotonicity.
- [ ] Verify serialized MIDI, exported MusicXML and actual player notes/timing/hand assignment agree. Include the user's organ/Piano-Voice balance case in playback checks.

**Exit:** all 12 development songs reviewed end to end; no unresolved critical defects within the claimed supported class. Fixes remain general, with regression tests and per-song before/after evidence.

## Work package 6 — Honest output decisions and operational behavior

**Files:** `services/transcribe/src/worker.ts`, existing catalog job/provenance types and conversion UI after tracing all readers. Reuse existing job/error conventions; add only a status distinction that the product actually needs.

- [ ] Test separator timeout, insufficient disk, bad acquisition, missing identity, wrong-duration output and invalid source candidate through the full worker path.
- [ ] Separate “ready” from “needs review” or failure. Do not convert failed stem routing into an indistinguishable ready full-mix result. Show the actual useful recovery step.
- [ ] Calibrate review signals using development cases. Source coverage, stage failure and missing identity can justify review; uncalibrated heuristic confidence must not claim percentage accuracy.
- [ ] Prevent a failed retry from overwriting a good existing song. Exercise cancellation, duplicate jobs and restart recovery. Retain source/artifact lineage and recoverable prior output.
- [ ] Measure completion latency and resource ceilings under intended hardware; set the user-facing completion expectation from observed results, not estimates.

**Exit:** ready means the defined gates passed; review/failure remains visible and actionable. Safety gating is reported separately from conversion success so hiding poor outputs cannot inflate the success rate.

## Work package 7 — Freeze, test unseen songs, then release gradually

**Files:** existing evaluator/listening reports, service integration tests, deployment workflow/runbook; record a new immutable acceptance report with code/model/config hashes.

- [ ] Freeze the entire candidate before scoring the 20 holdouts and six challenge cases. Run the same end-to-end process with no per-song fixes.
- [ ] Score every song against the fixed rubric. Require at least18/20 supported full songs acceptable automatically, zero critical defects in ready outputs, and accurate challenge-case review/failure handling. Inspect every section and all levels; include human musical review.
- [ ] If the gate fails, publish the failure breakdown. Do not retune and rescore the same set as unseen evidence; reserve a fresh cohort for the next claim.
- [ ] On passing evidence, deploy an immutable version to a private canary path, verify a live conversion and exports, restart/retry behavior and rollback. Keep current approved catalog songs intact.
- [ ] Release to new imports first. Reprocess existing songs only as a separate, backed-up operation with regression comparison.
- [ ] Track ready/review/failure and user-reported incorrect-note rates on subsequent unfamiliar cohorts. Expand scope only after evidence supports it.

**Exit:** a bounded “just works” claim supported by independent full-song evidence and live operation. Arbitrary metal remains outside that claim until additional styles pass the same process.

## Order, effort and stop conditions

Execute1→2→3→4→5→6→7; maintain the same full-chain diagnostics throughout. The largest uncertainty is package4, not implementation time in the arranger. Packages1–2 should produce an early go/no-go diagnosis before major model engineering. Runtime measurements and reference availability are prerequisites for a credible calendar estimate.

Most engineering and evaluation can be automated. Musical-reference creation, recognizing whether a theme is right, and confirming playable learner arrangements require human review; budget that explicitly rather than asserting automatic scoring can replace it. Use short A/B previews to locate failures, followed by full-song acceptance.

If no tested route recovers sufficiently correct notes, stop feature expansion. Deliver a reliable symbolic/piano-source-assisted product while treating arbitrary metal audio as research. That is a scope decision, not completion of the original broader promise.

## Plan self-review

- Scope includes source accuracy, arrangement, difficulties, playback, acquisition, failure behavior, persistence and deployment.
- Existing implementations are reused; no speculative model or new architecture is mandated.
- Each work package has an observable exit and can be rejected independently.
- No promise of universal recognition, no arbitrary release date, no benchmark leakage, and no masking failures by withholding them from the denominator.
- This is a gated delivery plan. Exact code patches for research-dependent packages follow their measured decisions; inventing them before selecting a successful route would create false implementation certainty.

## Execution checkpoint — 7 September 2026

See `docs/research/keyspilli-evidence/metal-delivery-progress-2026-09-07.md` and its development scorecard.12 full-song A/B pairs generated;22/24 structural passes, musical/source-accuracy gate incomplete. Reidar rejected the initial A/B previews as far below acceptable quality. Independent reference coverage remains incomplete; musical promotion failed. No release holdout predictions or deployment. Unchecked tasks remain open even where generation is finished.
