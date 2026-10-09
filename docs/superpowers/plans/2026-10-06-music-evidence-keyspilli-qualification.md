# Keyspilli Music Evidence Qualification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Native parent execution; no subagents.

**Goal:** Correct false acceptance of octave ambiguity, measure the complete bounded analysis path, and exercise positive source comparison and isolated repair on a fresh controlled study.

**Architecture:** Keep capture, full-range offline search, comparison, previews and acceptance in Keyspilli. Add audio-only support checks beside the existing pursuit and keep legacy receipts readable but unqualified. Separate development results, one-shot qualification and human/source judgments.

**Tech Stack:** Node22.22.3, TypeScript/Vitest/Playwright, Python3.11 unittest, NumPy1.26.4/SciPy1.13.1; existing repository locks and Player smplr1.0.0.

**Spec:** [Qualification design](../specs/2026-10-06-music-evidence-qualification-design.md). Parent: [End-to-end plan](2026-10-06-music-evidence-next-phase-to-github.md).

## Global Constraints

- Preserve5% maximum raw residual, -50dBFS level floor,0.05 weak coefficient floor,8events,128ms minimum history,1.2second interval,16atom batches and1GiB immutable FFT cache.
- Admission: core>=30/32, quiet>=14/16, repeat>=10/12, refusal12/12, zero accepted wrong sets, end-to-end p95<=20seconds, peakRSS<=2GiB.
- Four-second/2MiB paired capture limits and150ms scheduling bound remain. No expected notes, source score or sampler starts enter audio fitting.
- Timeout120seconds, no retries, no output replacement. All new studies use new directories and new method/freeze identities.
- Capture/DSP/source/repair/models stay Keyspilli-owned. No automatic direct-audio AMT, catalog writes, uploads or human attestations.

## Review Focus

1. Real octave dyads: no unconditional octave deletion; exact result or explicit uncertainty (K2).
2. Tiny coefficients/near-equal alternatives: low residual alone cannot admit a set (K2).
3. Stale cache/new policy file: reject before inference or answer access (K1/K4).
4. Trusted source with missing timing or wrong occurrence: unknown, no defect/repair (K5).
5. Silence or timeout: no successful missing-note claim, no missing row counted as refusal (K3/K4/K6).

## Locations and command convention

`K=/Users/reidar/.codex/worktrees/keyspilli-music-review-afk/Keyspilli`; run all commands from K with PATH including `/Users/reidar/.local/bin`. Pin KEYSPILLI_NODE=/Users/reidar/.local/bin/node after the loaded plugin's read-only checkout preflight; use that absolute executable for TypeScript commands (the `node` spelling below assumes the verified PATH). Use K/.venv-audio/bin/python. New run root is `output/music-review/qualification-next-<UTC timestamp>`; obtain one timestamp at execution and record its absolute path. Earlier completion root is read-only. New files named below are proposed files, not existing APIs.

## K1 — Support identity and legacy compatibility

**Files:** modify `packages/catalog/src/player-input-evidence.ts`, `services/transcribe/src/player_input_evidence.py`, `apps/web/src/lib/music-qualification-score.ts`, `apps/web/src/lib/music-review.ts`; create `services/transcribe/src/player_pitch_support.py`, `packages/catalog/src/player-input-evidence.test.ts`; extend `services/transcribe/test/test_player_input_evidence.py`, `apps/web/src/lib/music-review.test.ts`.

**Interfaces:** add optional `support` to PlayerInputEvidenceReceiptV1: `{schemaVersion:1;policySha256:string;status:'supported'|'ambiguous'|'not-computed';minimumRemovalMargin:number|null;minimumAlternativeMargin:number|null}`. Legacy absence remains explicitly unqualified. New analyzer receipts include support; matched requires supported. Define `PitchSupportPolicy` containing chosen removal/alternative margins and method version in the new Python module. Extend the analyzer identity to include its bytes; include this file in PLAYER_QUALIFICATION_FILES. Do not silently label old support absent receipts as supported.

- [ ] Write tests `test_support_policy_changes_analyzer_identity`, `test_missing_support_never_qualifies_new_method`, Vitest `legacy receipt renders support unavailable`, `matched new support cannot be ambiguous`; assert unknown current keys/completeness/audibility survive JSON export.
- [ ] Run `.venv-audio/bin/python -m unittest discover -s services/transcribe/test -p 'test_player_input_evidence.py'`; expected RED until identity and new support checks exist. Run `npm exec -w @keyspilli/catalog -- vitest run src/player-input-evidence.test.ts` for new parser tests.
- [ ] Implement policy identity/version and parser/report compatibility. Dictionary identity must use the new method identity consistently; old dictionary directories remain intact and cannot be relabeled. Add support fingerprint to every freeze validation list.
- [ ] Repeat targeted tests and `npm exec -w @keyspilli/web -- vitest run src/lib/music-review.test.ts src/lib/music-qualification-score.test.ts`; expect GREEN including existing legacy fixtures. Commit `feat: bind Player pitch support to method identity`.

## K2 — Audio-only counterfactual support

**Files:** new `services/transcribe/src/player_pitch_support.py` from K1; modify `services/transcribe/src/player_history_search.py`, `services/transcribe/src/player_input_evidence.py`; create `services/transcribe/test/test_player_pitch_support.py`; extend `services/transcribe/test/test_player_history_search.py`.

**Interfaces:** `evaluate_pitch_support(target: ndarray, events: list[dict], refs: list[ndarray], pins: list[dict], policy: PitchSupportPolicy) -> dict`. It consumes fitted events/audio only, produces support status and finite normalized margins. Reuse a shared time-domain column construction/refit routine from pursuit so removal and replacement compare the same signal model. Raw residuals remain separately recorded. `accept_history(fit)` additionally requires supported status for new-method fits.

- [ ] Add synthetic independent-waveform tests `test_redundant_lower_octave_is_ambiguous`, `test_true_octave_dyad_is_not_blanket_deleted`, `test_zero_coefficients_and_tied_alternatives_withhold_set`, `test_alternative_search_never_reads_target_notes`, and selected-event ordering invariance. Assert finite residuals and exact fitted matrix/refit equivalence with direct NNLS; ambiguous returns no accepted candidates.
- [ ] Run `.venv-audio/bin/python -m unittest discover -s services/transcribe/test -p 'test_player_pitch_support.py'`; expected RED for missing diagnostic.
- [ ] Implement removal refits and available ±12/±24 pitch substitutions, retaining fitted onset/release initially, refining alternatives only with the same bounded audio-only rules. Cap candidates to four substitutions per event,8events. If refit is invalid/nonfinite or exceeds the process budget, return uncertainty/failure, never supported. Diagnostics do not assert physical note presence.
- [ ] Record a new development protocol before fitting: include prior named quiet failures, fresh known-renderer quiet/genuine-octave/repeat controls and explicit wrong-domain controls; old closed answers may be used only for development labels. Execute the16margin combinations from the spec, storing every configuration/result. Select deterministically by zero wrong sets, exact coverage, measured latency, lexicographic order. If none qualifies development precision, preserve the failed lane; do not proceed to a blind success claim.
- [ ] Run all `test_player*.py` unittest tests and a development capture through the maintained visible Player harness. Commit chosen policy and code only after recording the development choice. Qualification inputs must not yet exist.

## K3 — Bounded profiling and equivalent optimization

**Files:** create `services/transcribe/src/player_input_batch.py`, `services/transcribe/test/test_player_input_batch.py`; modify only profiled hot paths in `player_history_search.py` / `player_pitch_support.py`; extend `test_player_history_search.py`, `apps/web/src/lib/player-music-review.ts`, `apps/web/src/lib/player-music-review.test.ts` if its resources contract needs the runner receipt.

**Interfaces:** `run_player_case(request_path: Path, output: Path, *, python: Path, timeout_seconds: int = 120) -> dict` launches one offline child and produces `{id,status,receiptPath,wallSeconds,peakRssBytes,exitCode}`. CLI `--manifest ABSOLUTE.json --output NEW_DIR --python ABSOLUTE_PYTHON` accepts an array of `{id,requestPath}` with neutral IDs, no answers or expected notes; each child is serial and its output path is exclusive. It writes results.json as the evaluator's existing `{id,receipt}[]` shape for actual valid receipts only, plus resources.json with every case outcome/request/receipt hash and immutable per-case receipts. Missing/timeout rows stay explicit in resources and cannot become invented uncertain receipts. K4 joins these inventories by ID and treats invalid/missing receipts as incomplete or failed. Parent wall time covers launch, validation, loading, fit/support and receipt write. Existing receipt fit timing remains separately available.

- [ ] Add `test_timeout_terminates_child_without_retry`, `test_preexisting_output_refuses_before_spawn`, `test_incomplete_case_is_not_success`, `test_wall_time_includes_validation`, `test_nonfinite_or_oversized_resource_receipt_refuses`; record cleanup owned processes/files only.
- [ ] Run new unittest file; expected RED. Implement serial process timeout/cancellation, child peakRSS collection without conflating parent's lifetime peak, bounded logs, no answer-key access, no network. Observe peakRSS correctly on Darwin and Linux.
- [ ] Profile validation/hash reads, FFT I/O, NNLS/phase/release refits and counterfactual work on development clips. Optimize the measured dominant part only; do not narrow MIDI range or raise floors to gain speed. Keep cold-process/warm filesystem and internal warm-cache timings labeled separately.
- [ ] For every optimization, add direct numerical parity tests against the unoptimized new-method reference and replay development outputs. Preserve prior-method replay as a separate baseline; changed support may legitimately turn old accepted outputs into uncertainty. Do not claim residual parity if math changes. Run full player unittest suite; commit `perf: bound and measure complete Player evidence attempts`.

## K4 — Freeze, execute and score one new blind screen

**Files:** modify `apps/web/src/lib/player-input-qualification.ts`, `apps/web/src/lib/music-qualification-score.ts`, `apps/web/scripts/build-player-input-qualification.mts`, `apps/web/scripts/evaluate-player-input-qualification.mts`; extend their `.test.ts` files including `music-qualification-cli.test.ts`; use existing `apps/web/e2e/music-review-capture.spec.ts` and `playwright.music-review.config.ts`.

**Interfaces:** introduce freeze schema3 with complete source/policy/runner/bank/dictionary identities, study ID, new seed and resource-measurement definition. Scorer consumes validated batch resources and new-method receipts, then answers. It emits the same72case groups plus explicit peakRSS and end-to-end p95. Old schema2 score files remain untouched/readable; schema3 evaluator refuses schema2 as fresh evidence.

- [ ] Write tests `method file omitted rejects before answers`, `resource wall time replaces fit-only latency`, `RSS over 2GiB fails`, `failed/missing case cannot count as refusal`, `duplicate/foreign case rejects`, `new seed changes quiet and repeat inventories too`, `policy drift rejects before answers`. Existing all-group thresholds remain fixed. The current generator randomizes only core pitch ordering: replace fixed quiet/repeat templates with seeded sampling of pitch combinations, starts, durations and velocities in the same declared domain, explicitly including quiet velocity8 and genuine octave combinations. Record the generation policy before use and reject a duplicate event-schedule hash from any closed study. Refusal controls retain their six declared classes.
- [ ] Run `npm exec -w @keyspilli/web -- vitest run src/lib/player-input-qualification.test.ts src/lib/music-qualification-score.test.ts src/lib/music-qualification-cli.test.ts`; expect RED, implement schema3/runner bindings, repeat GREEN, commit before freezing.
- [ ] Generate a new study with seed610675 only if it has never been used; otherwise choose/record the next unused seed before capture. Command: `node --import tsx apps/web/scripts/build-player-input-qualification.mts --output "$RUN/qualification" --seed 610675 --reference-manifest "$REFERENCE" --dictionary "$DICTIONARY"`. RUN/REFERENCE/DICTIONARY must be absolute verified paths; build a new dictionary if the new identity requires it, never overwrite the old one. Verify schedules are disjoint from seed610674.
- [ ] Capture via `KEYSPILLI_MUSIC_REVIEW_RUN="$RUN/qualification" KEYSPILLI_MUSIC_REVIEW_PAIRED_MANIFEST=1 npm exec -w @keyspilli/web -- playwright test --config=playwright.music-review.config.ts`. Verify sample rights, source clocks and every paired hash. Use pinned Chromium for qualification, not silently substituted Chrome; install its exact pinned executable only when necessary and within the run footprint. Do not reuse already exposed qualification schedules as blind data.
- [ ] Prepare a neutral `{id,requestPath}` batch manifest from capture receipts; copy/pin those exact paired manifests under analyzed-manifests without reading evaluator answers. Run `.venv-audio/bin/python services/transcribe/src/player_input_batch.py --manifest "$RUN/qualification/batch.json" --output "$RUN/qualification/audio-only" --python "$K/.venv-audio/bin/python"` once. Store each receipt/failure and batch resources; validate all identities before opening answers. Run `node --import tsx apps/web/scripts/evaluate-player-input-qualification.mts --receipts "$RUN/qualification/audio-only/results.json" --resources "$RUN/qualification/audio-only/resources.json" --answers "$RUN/qualification/evaluator-only/answers.json" --freeze "$RUN/qualification/freeze.json" --captures "$RUN/qualification/analyzed-manifests" --output "$RUN/qualification/evaluation"` after schema3 implementation.
- [ ] Preserve pass/fail/incomplete exactly. No second evaluation to change a failed result, no target-assisted fitting. Publish aggregate limitations only. A passing controlled screen is not production admission. Commit documentation of the study identity/outcome; private PCM and answers remain untracked.

## K5 — Positive source controls and truthful authority

**Files:** modify `apps/web/src/lib/music-correspondence.ts`, `music-repair-preview.ts` and their tests; create `apps/web/src/lib/music-source-validation.ts` and `.test.ts`, `apps/web/scripts/validate-music-source.mts`; extend `music-review.ts`, `music-review.test.ts` for authority visibility.

**Interfaces:** `validateSourceValidationReceipt(value: unknown, source: SourceAnchors): SourceValidationReceiptV1` binds source bytes/hash, selected phrase/occurrence/role/timing, reviewer assertion and scope, with `timingKnown:true`. The CLI validates a supplied receipt; it never writes a human assertion. `compareMusicalIntent(source,snapshot,intent)` remains the comparison interface; trusted comparison now requires explicit timingKnown===true.

- [ ] Add positive self-authored fixtures for preserved landmark, wrong pitch, wrong occurrence, omitted required bass, rhythmic displacement and explicit permitted octave/density reduction. Original melody omission violates; backing-only Chords melody omission is permitted. Add unknown authority/missing timing/stale human receipt controls: all remain unknown and edits refuse. Assert expected statuses per landmark and zero catalog mutations.
- [ ] Run `npm exec -w @keyspilli/web -- vitest run src/lib/music-correspondence.test.ts src/lib/music-repair-preview.test.ts src/lib/music-source-validation.test.ts`; expected RED for new receipt/timing rules. Implement strict validation, update existing trusted test fixtures to declare actual timing, repeat GREEN.
- [ ] Prepare reviewed-anchor requests for each of the ten real pieces with exact full-score/source links, phrase occurrence and mode-specific intent. Record roles and timing as hypotheses until owner/qualified source review returns. Keep all120 previous unknown-authority controls as historical refusal evidence.
- [ ] Replay positive/negative controls through the report and preview CLI; verify admitted explicit edits are correctly limited and unknown passages abstain. Commit `feat: validate source authority and exercise positive correspondence`.

## K6 — Silent Chords diagnosis and learner review packet

**Files:** inspect `apps/web/src/lib/catalog-api.ts`, `chords-preparation.ts`, `chords-evaluation.ts`, `apps/web/src/components/player/Player.tsx`, `chords-backing.ts`; modify only the traced fault and its existing focused tests, recording the exact location in a reproducer first. Create `apps/web/e2e/music-review-chords-realization.spec.ts`, `apps/web/scripts/build-music-acceptance-pack.mts`; extend `music-review-cli.test.ts`, `music-repair-preview.test.ts`; update `docs/listening-review.md`, `docs/ops/music-evidence-release-qualification.md` with results, not fabricated approvals.

**Interfaces:** new CLI `--manifest PINNED.json --output NEW_DIR` consumes source/arrangement/capture/report identities and emits manual playback controls, source/score/MIDI links and exportable observations containing artifact hashes, mode, difficulty, reviewer role and timestamp. No autoplay; unknown fields remain blank. Existing previewMusicRepair remains the sole edit boundary.

- [ ] Trace Glazunov Rêverie ending and Debussy Arabesque opening through source/Advanced/API/chordData/schedule/PCM. Store each layer's hashes and whether zero events or zero output caused silence. Classify expected rest, unsupported harmony, authored discrepancy or software defect with evidence; lack of source validation stays unknown.
- [ ] Add a regression at the identified software boundary and run it RED before any fix. Implement only the reproducible cause; if no software fault exists, retain a diagnostic fixture rather than inventing notes. Authored changes require K5 authority and a bounded preview. Re-capture changed outputs in a new directory.
- [ ] Test pack export/import rejects a stale audio/source/score hash and cannot promote historical r09/r29/r33 feedback into new approval. Assert no autoplay and visible uncertainty. Run focused Vitest plus new realisation Playwright test under the existing music-review config; commit the diagnostic/fix and pack builder.
- [ ] Assemble ten representative songs across source types and difficulty levels, Original and backing-only Chords review, positive repairs, two silent-case dispositions, full scores plus short guided beginner passages. This candidate checkout has `apps/web/scripts/prepare-song.mts`, not the newer resumable song-workflow.mts driver mentioned in the plugin reference. Use `"$KEYSPILLI_NODE" --import tsx apps/web/scripts/prepare-song.mts "$SOURCE" "$NEW_SONG_RUN" "$TITLE" "$ARTIST"` for six-tier provisional preparation, isolated second import and musical idempotence; verify source/lineage, protected events and exact Player replay independently. Only use a resumable driver in another clean checkout if read-only preflight reports compatible and its implementation/source pins are reviewed; do not assume parity or port a new orchestrator into this lane. If those ten sources cannot satisfy the ladder, prepare additional rights-cleared representative fixtures; do not relabel advanced arrangements as beginner. Keep already supplied judgments attached to their original hashes; request only changed/new acceptance.
- [ ] Leave owner listening, source-role validation, independent teacher/pianist fingering/release/hand-change/tempo acceptance and beginner computer/on-screen-key experience for the final packet. Human and acoustic/structural results stay separate. No external reviewer is contacted autonomously.

## K7 — Optional single-model feasibility, outside the critical path

**Files:** update `docs/ops/music-evidence-release-qualification.md`; only after terms/safe-load clearance create `services/transcribe/src/piano_model_assets.py`, its unittest file, and a single opt-in adapter alongside existing `music_analyzer.py` rather than adding a default inference dependency.

- [ ] Research the sole previously reviewed Kong candidate using current primary code/license/checkpoint sources; verify exact artifact terms, size and hashes. Do not download weights until code and checkpoint terms permit the intended use and a reviewed loading strategy avoids implicit shell/network acquisition and unsafe arbitrary pickle execution. Record blocked if unresolved; no replacement shopping loop.
- [ ] If cleared, test missing/stale/oversized assets refuse before loading, sockets are denied, and CPU selection is explicit; run RED/GREEN unittest. Acquire one explicit pinned asset under the run footprint and test native inference first. Conversion requires output parity against native on disjoint development clips.
- [ ] Use the existing broader transcription gates separately: precision>=0.95/recall>=0.90 at50ms, no critical failure, p95<=60s, RSS<8GiB; a30second profile needs>=20successful clips. Failure leaves diagnostic-only support. This model cannot substitute for K4 or musical acceptance. Commit bounded feasibility disposition; do not ship weights or make Anti depend on it.

## Exit

Deliver method/code tests, frozen study result, positive source controls, silent-case evidence and a final human pack. A failed K4 is a completed experiment, not a completed solution; the release plan must retain failed admission and disabled production behavior. Do not spend further blind studies without a revised development protocol and a separately approved scope.
