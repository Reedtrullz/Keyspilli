# Anti Score Review Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for native execution, task by task. Preserve the user's preference for zero subagents. Mark checkboxes complete only with retained evidence.

**Goal:** Deliver an agent-operated Keyspilli score review workflow with automatic score/playback/playability checks, an optional bound Gemini audio observation, located findings and verified repair previews, without requiring Reidar to listen, label voices or recruit a pianist.

**Architecture:** Keyspilli owns pinned inputs, native score parsing, clocks, symbolic checks, structural playability, reports and repairs. Anti owns reusable Gemini audio transport and private account binding. Offline review works independently; one fresh live smoke verifies integrated transport/schema after all local prerequisites pass.

**Tech Stack:** Existing TypeScript/Vitest, `@keyspilli/midi`, catalog native-score adapter, player-core resolver, Python/pytest Anti helper/gateway, deterministic Python packaging and existing Playwright tooling. No mandatory new provider or transcription model.

**Spec:** [Completion design](../specs/2026-10-08-anti-score-review-completion-design.md). [Earlier design](../specs/2026-10-06-music-evidence-qualification-design.md) is historical context; its studies and human-review assignments are superseded for this scope.

**Revision:** 2026-10-08. Replaces the previous six-task plan. Existing work and failed evidence remain retained. Task numbering here is internal to this plan, not the user's earlier resolved Task 1.

## Review Corrections

| Gap in the previous plan | Current source evidence | Correction |
| --- | --- | --- |
| Live smoke before local controls | Adapter validates provider results only after dispatch | Move live work to Task 9 |
| Binding success asserted without a pairwise binding path | `audio-review.ts` builds `listen`; Anti exposes binding only on `review-music` | Share listen binding and validate receipts in Task 3 |
| Landmark comparison called an exact-note oracle | `music-correspondence.ts` does not check all extras/releases | Add independent complete event comparison in Tasks 4-5 |
| Replay pins assumed to be typed event JSON | Queen noteEvents are MIDI; replaySnapshot is an artifact manifest | Parse declared formats and validate clocks in Task 4 |
| Playability left waiting for a pianist | Existing MIDI library measures spans/density/IOIs | Add a structural screen in Task 6 |
| Changed plugin packaged without refreshing inventory | Packager rejects stale source-member hashes | Refresh exact inventory and build twice in Task 10 |
| Closeout is receipts plus page HTTP 200 | No unified CLI or burden-free results page | Add workflow, repairs and end-to-end checks |
| Older spec still requires studies and owner reviews | User explicitly ruled those out | Governing completion addendum changes the scope |
| Historical test counts treated as current expected totals | New WIP can change suite sizes | Record actual current counts; require all tests to pass |

## Global Constraints

- No new qualification study, owner listening assignment, voice/chord labeling assignment or pianist prerequisite.
- Native parent execution; zero subagents. Preserve dirty primary checkouts and isolated WIP.
- Never retry, resume, replace, edit or relabel as successful the old `queen-original-replay` attempt or a frozen failed study.
- At most one new live job, one reserved attempt and one backend attempt; 90 seconds; no refresh/retry/fallback/rotation/account or model substitution.
- At most two PCM16 WAVs, 2 MiB each, 4 MiB combined, 30 seconds each. Output ceiling 4096 tokens. Optional scoreContext is nonempty and at most 4,000 characters.
- Evidence-v2 limitations is 1-20 nonempty strings, each at most 500 characters. Never coerce, repair invalid output or dispatch again after rejection.
- Node `>=22.22.3 <23`; use the absolute executable returned by checkout preflight. Stop long runs below 30 GiB free.
- Offline mode makes zero HTTP/provider calls and no catalog mutations. No automatic source acquisition, credential setup or dependency installation to force a check.
- Preserve legacy prompt bytes. New schema/binding pins are opt-in; changed fingerprints cannot resume old runs.
- Authority-dependent checks with unknown authority/timing never pass. Equality to supplied bytes is a narrower mechanical claim, always identified as such.
- Keep listeningAttestation/providerListeningAttestation unverified, listeningCalibration unqualified, musicalAcceptance not-established and productionAdmission false.
- No merge, publication, installed adoption, canonical plugin edit or deployment. Prepare exact artifacts and integration instructions for later decisions.

## Review Focus

1. Identity drift: changed clip/schema/helper/binding/receipt bytes, gateway restart, inventory reorder or busy account refuses before a new backend attempt (Tasks 2-3, 9).
2. Incorrect comparison: duplicate/unmatched notes, wrong duration, repeats, tempo changes and boundary-crossing notes yield a located discrepancy or unresolved scope (Tasks 4-5).
3. Circular evidence: candidate-derived references, MIDI called Player capture, inferred roles and copied receipt hashes cannot establish source fidelity or hearing (Tasks 4-7).
4. Partial failure: corrupt/silent media, malformed JSON, cancellation and truncated stdout retain local results and spent-attempt state without replay (Tasks 2-3, 7, 9).
5. Delivery drift: package inventory, compatibility probe, report links and redaction refer to the actual candidate bytes (Tasks 7, 10-12).

## Workspace and Execution

Reuse these isolated worktrees; no new checkout is needed just to follow a generic skill:

```sh
KEYSPILLI_ROOT=/Users/reidar/.codex/worktrees/keyspilli-music-review-afk/Keyspilli
ANTI_ROOT=/Users/reidar/Projectos/.worktrees/anti-music-review-afk
KEYSPILLI_NODE=/Users/reidar/.nvm/versions/node/v22.22.3/bin/node
ANTI_PYTHON="$ANTI_ROOT/.venv/bin/python"
ANTI_SCRIPT="$ANTI_ROOT/codex_antigravity_auth/skills/anti/scripts/anti.py"
```

These are verified path candidates; Task 1 still probes runtime/import identity.
Commands run from KEYSPILLI_ROOT unless marked Anti cwd. Invoke Vitest as
`"$KEYSPILLI_NODE" node_modules/vitest/vitest.mjs ...`, which pins process.execPath
in CLI tests. For npm scripts prepend the selected Node bin directory to PATH.
Run `"$ANTI_PYTHON" -m pytest` from Anti's worktree.

Choose one unique RUN_ID and set
`EVIDENCE_ROOT="$KEYSPILLI_ROOT/output/music-review/score-review-completion-$RUN_ID"`.
Every run directory is exclusive. Old roots `r2-next-20261007` and
`completion-20261006-115005` are read-only; do not run their packet builders or
edit their indexes/checksums.

Use ledger `.superpowers/sdd/2026-10-07-anti-score-review-verification/progress.md`.
Record step status, actual commands/results, current commit/hash identities,
blockers and next action. Reference the older ledger without rewriting history.
Stage only named files after reading their diffs, and commit related changes in
their owning repository.

## File and Interface Map

Paths are Keyspilli-relative except Anti rows. New interfaces below are proposed,
not claims that the files already exist.

| File | Responsibility |
| --- | --- |
| `apps/web/src/lib/audio-review.ts` and existing tests | Pairwise validation, schema/binding args and fingerprints |
| `apps/web/scripts/review-song-audio.mts` | Existing bounded adapter and attempt ledger |
| `apps/web/schemas/audio-review-evidence-v2.json` (new) | Keyspilli schema for Anti's generic response-schema transport |
| Anti `codex_antigravity_auth/skills/anti/scripts/anti.py` | Shared binding verification and metadata for listen |
| `apps/web/src/lib/symbolic-review-input.ts` (new) | Input/sidecar and normalized inventory validation; shared types |
| `apps/web/src/lib/symbolic-review.ts` (new) | Independent conformance and authority-aware source receipts |
| `apps/web/src/lib/symbolic-playability.ts` (new) | Existing mechanical playability/range policy adapter |
| `apps/web/src/lib/score-review.ts` (new) | Receipt assembly, located findings, dispositions and static report |
| `apps/web/scripts/review-score.mts` (new) | Offline-first entrypoint and explicit bounded upload |
| `apps/web/src/lib/score-review-repair.ts` (new) | Evidence-backed actions to existing preview/reproducer paths |
| `scripts/package-keyspilli-plugin.py` (existing) | Deterministic packaging; preserve exact-member refusal |
| `scripts/update-keyspilli-plugin-inventory.py` (new) | Check/update tracked release inventory |
| `docs/ops/score-review.md` (new) and plugin references | Commands, capability contracts and scope |

Every new TypeScript library has a same-directory .test.ts. CLI tests:
`apps/web/src/lib/score-review-cli.test.ts`. Browser test:
`apps/web/e2e/score-review-report.spec.ts`. Avoid general module reshuffling.

Dependency order: `1 -> 2 -> 3`; `1 -> 4 -> 5 -> 6`;
`3 + 5 + 6 -> 7 -> 8 -> 9 -> 10 -> 11 -> 12`.
If Task 9 blocks/fails, continue Tasks 10-12 with live readiness explicitly blocked.

---

### Task 1: Reconcile Existing Work and Pin the Baseline

**Files:** Create the plan ledger and EVIDENCE_ROOT/BASELINE.json. Source is read-only.

**Interfaces:** Consumes current status/historical receipts. Produces full HEADs, dirty-file hashes, runtime identities, evidence locations, budget and separate software/live readiness.

- [ ] Read applicable instructions, both specs, status/diffs/logs and the old ledger. Preserve the five modified Keyspilli files. Observed heads: Keyspilli `50555506`, Anti `d2dfbcc`; record full current SHAs at execution.
- [ ] Verify disk headroom. Run tracked `plugins/keyspilli/skills/keyspilli-song/scripts/check_checkout.py` against this explicit checkout with `--node "$KEYSPILLI_NODE"`. Confirm engine/SQLite ABI and existing audio_review/music_review contracts; retain the returned executable.
- [ ] From Anti cwd run `"$ANTI_PYTHON" -c 'import codex_antigravity_auth,sys; print(sys.executable); print(codex_antigravity_auth.__file__)'`. Require this worktree's import path. Record helper/schema hashes and tracked bundle copies from git ls-files.
- [ ] Verify old Queen report/state/response hashes against TASK5_LIVE_SMOKE.json. Read historic attempt totals from the retained packet; unknown totals stay unknown. No provider request occurs.
- [ ] Inventory port/process ownership read-only. Do not assume 51123/3242 is free or running. The old listening page is a legacy artifact, not a closeout gate.
- [ ] Create the exclusive new root/ledger. Prerequisite failures get precise blocked receipts; continue independent local work where possible.

**Acceptance:** All inherited WIP, frozen evidence and runtimes are identified without moving primary checkouts or consuming quota.

### Task 2: Finish Evidence-v2 and Local Controls

**Files:** Modify audio-review.ts/test/CLI test, review-song-audio.mts, docs/ops/player-audio-evidence-v2.md, and plugin references/audio-listening-review.md. Create apps/web/schemas/audio-review-evidence-v2.json.

**Interfaces:** Retain buildEvidenceV2ReviewPrompt, validateListenEnvelope and AUDIO_REVIEW_LIMITS. Extend AntiCommandInput with optional `responseSchemaJson: string`. CLI loads/hashes/retains the schema and fingerprints it; legacy calls omit it.

- [ ] Inspect the existing scoreContext/4096/limitations patch. Add `rejects_string_empty_and_overlong_limitations`, `pins_evidence_schema_in_dry_run_and_resume` and `keeps_legacy_prompt_bytes`. Assert Global Constraints, valid compared/abstained results and unchanged retained provider text.
- [ ] Retain/add controls for digital-zero, corrupt, missing and changed WAVs with zero helper invocation and zero /v1/models lookup. Quiet nonzero clips remain measurable; wrong attachment order/hash and out-of-clip findings reject.
- [ ] Add no-resume cases for profile/schema/prompt/helper/route/media/cap changes and submitted/ambiguous jobs. Count generation POSTs separately from dry-run helper calls and metadata GETs.
- [ ] Run current focused tests for baseline, then each new test to show the intended red failure before implementing missing behavior. Do not invent a red phase for already implemented behavior.
- [ ] Pass serialized JSON to Anti's existing --response-schema; it accepts JSON text, not a filename. Use supported native fields. Strict local validation still owns length/cardinality/cross-field rules.
- [ ] Update dry-run validation for Anti's exact appended `Requested output schema: ...` text. Verify full assembled prompt/schema bytes; do not reduce this to substring checks. Preserve raw encoding/fences.
- [ ] Run `"$KEYSPILLI_NODE" node_modules/vitest/vitest.mjs run apps/web/src/lib/audio-review.test.ts apps/web/src/lib/audio-review-cli.test.ts`, typecheck and git diff --check. Record actual passing counts.
- [ ] Commit reviewed contract/schema/tests/docs only. Document that 4096 is the current transport ceiling and legacy prompt bytes remain stable; do not claim old argument budgets were unchanged if inherited WIP changed them.

**Acceptance:** Prompt, schema, validator, retained bytes and fingerprint agree; input failures remain local.

### Task 3: Connect Exact Binding to Pairwise Listen

**Files:** Anti helper, tests/test_account_binding_helper.py, tests/test_wav_audio.py, tests/test_gemini_music_review.py and bundled MUSIC_REVIEW.md. Keyspilli audio library/CLI/tests.

**Interfaces:** Anti listen gains --account-binding-json via existing load_account_binding_file/verify_gateway_binding. Shared bounded-audio metadata includes account_binding_config_sha256, account_binding_gateway_instance and account_binding_verified_before_attempt. Keyspilli evidence-v2 live requires this flag and verifies all three fields. "Before attempt" means before backend generation, not before adapter reservation.

- [ ] Add `bound_listen_verifies_inventory_and_posts_once` and `bound_listen_refuses_stale_busy_or_unsupported_binding`. Preserve model query parameters in HTTP bridges. Assert one selected lease, no refresh/rotation, header-only binding, release on failure/cancellation and no raw identity in output/Google payload.
- [ ] Add Keyspilli `evidence_v2_live_requires_binding`, `refuses_binding_file_drift_before_dispatch`, `rejects_mismatched_binding_receipt` and `binding_change_cannot_resume`. Legacy unbound tests pass; dry-run makes no network call.
- [ ] Run new cases red. Expose the existing binding parser on listen and move binding metadata outside the review-music-only branch. Keep the pairwise listen response contract; do not switch to the incompatible music profile.
- [ ] Extend AntiCommandInput with optional `accountBindingJson: string`. Require absolute bounded nonsymlink file/exact existing fields. Hash sorted compact JSON consistently with Anti; re-read before invocation and enforce successful verification metadata.
- [ ] Fingerprint private config digest/gateway instance/schema. Raw binding JSON goes only to the private header, never manifest/prompt/report/package. Recover a prior authorized account only if exactly one current eligible row matches; otherwise retain a pre-dispatch block.
- [ ] Test through the real helper/gateway stub bridge, not fabricated success metadata. Anti cwd: `"$ANTI_PYTHON" -m pytest tests/test_account_binding.py tests/test_server_account_binding.py tests/test_account_binding_helper.py tests/test_wav_audio.py tests/test_gemini_music_review.py`. Run Keyspilli focused audio tests.
- [ ] Sync only tracked Anti release bundle copies discovered in Task 1, verify parity, preserve installed/canonical copies, and commit both repositories separately with dependency SHAs.

**Acceptance:** Bound pairwise calls use the selected current lease; stale binding produces no backend call or silent recovery.

### Task 4: Normalize Scores, Replay Events and Clocks

**Files:** Create symbolic-review-input.ts/test. Reuse catalog native-score-adapter, MIDI parsers and Player resolver/capture contracts without changing defaults.

**Interfaces:** `validateScoreReviewInput(value: unknown): ScoreReviewInputV1`; `loadSymbolicReviewInput(input: ScoreReviewInputV1): Promise<NormalizedScoreReviewInput>`. Input types are defined in the completion spec. Define NormalizedScoreReviewMode with expected/replayed event arrays, pins, intent, occurrence, basis, clock, coverage and unavailable reasons; NormalizedScoreReviewInput contains input/manifest hashes, source authority/relationship/validated anchors and the mode map. Events retain id, occurrenceId, midi, onsetSeconds, keyReleaseSeconds, originalBeat, nullable role/hand and provenance.

- [ ] Build genuine small MIDI/XML/MXL fixtures with existing test writers. Add `parses_pinned_midi_and_xml_without_import`, `preserves_duplicates_and_occurrences`, `integrates_native_tempo_changes`, `refuses_unsupported_repeat_clock`, `handles_cross_boundary_releases`. Assert actual pitches/times, 16 MiB/20,000 event limits and zero catalog/provider access.
- [ ] Add cases for wrong mode/occurrence, stale sidecar, artifact manifest masquerading as event JSON, mislabeled MIDI, unsupported controls and unknown role/hand. Sidecars bind event IDs/source/delivery/replay hashes/mode/occurrence. Track/right-hand/highest-pitch is never semantic authority.
- [ ] Run new cases red. Read/hash bytes and use existing parsers. XML/MXL uses adaptNativeSymbolicBytes's bounded byte API; no ingestSource/catalog write. MIDI native time uses parseMidi/midiBeatToNativeSeconds.
- [ ] Define resolved-events-v1 with source hash, occurrence, attack/key release, speed/transpose/tempo/sustain/settings pins and resolver/capture provenance. MIDI-only comparisons stay supplied-symbolic-files; validated resolver evidence permits resolved-player-events.
- [ ] Define clock/role/hand sidecar validators in this module. Verify actual clock mappings, apply origins/speed/transpose once, select half-open phrase attacks and retain crossing notes. Unknown clocks give in-clock measurements and not-run cross-clock conformance. Retain full-file validation and explicit release coverage.
- [ ] Derive new Queen inventories from actual bytes. Reused documentary timing/settings digests without physical receipts are provenance gaps; do not rewrite the old manifest. Keep its VintageDreams audio classified synthetic-control.
- [ ] Run normalization tests plus relevant existing native adapter/MIDI timing/Player tests; retain sample input/inventories and commit the read-only layer.

**Acceptance:** Real bytes become typed inventories with honest clocks/basis; unknown Queen authority does not prevent a partial diagnosis.

### Task 5: Build Independent Symbolic Receipts

**Files:** Create symbolic-review.ts/test. Reuse music-correspondence.ts, music-source-validation.ts and catalog matching primitives.

**Interfaces:** `buildSymbolicReviewReceipt(input: NormalizedScoreReviewInput): SymbolicReviewReceiptV1`. Define schemaVersion=1, kind=keyspilli-symbolic-review, input/manifest/code/policy hashes, per-mode scoreConformance/sourceFidelity/structuralPlayability, findings, coverage, limitations, musicalAcceptance=not-established and productionAdmission=false. Each check has CheckStatus, basis, evidence hashes and reason; playability starts not-run until Task 6 supplies it.

- [ ] Add `detects_missing_extra_wrong_pitch_and_wrong_release`, `does_not_merge_repeated_identical_notes`, `comparison_is_order_independent`, `unknown_authority_never_passes_fidelity`, `cannot_promote_self_roundtrip`, `empty_or_partial_coverage_is_explicit`. Assert event/occurrence/time and fixed 5 ms attack/release boundaries.
- [ ] Add source cases for unknown timing, estimated roles, changed/missing reviewer receipt, wrong mode/difficulty/occurrence, Chords melody omission and unresolved alternate voicing. Empty anchors never pass fidelity; a receipt hash alone is insufficient.
- [ ] Run red. Compare independently parsed delivery intent and replay with multiplicity-preserving one-to-one matching. Reuse matching primitives where applicable, explicitly verify releases/unmatched events, and keep ambiguous pairing unresolved.
- [ ] Define stable finding IDs from input hash/mode/occurrence/check/event IDs. Findings contain expected/actual pitch/attack/release, location/basis and next action. A completed comparison with a discrepancy is failed, not an invalid-input exception.
- [ ] Use compareMusicalIntent only for scoped landmarks. Read/hash/validate actual human receipts and scope before use. Unknown roles stay outside trusted anchors with incomplete coverage; never cast nullable roles into MusicalEvent or invent human/self-authored authority for a real song.
- [ ] Score conformance names the supplied-delivery basis and cannot certify song fidelity/audible realization. Partial/boundary-censored checks show checked scope plus unresolved coverage, not full-phrase passed. Approved transforms are separate from literal equality.
- [ ] Run symbolic/correspondence/source-validation tests. Retain Queen's actual measured differences and authority limits plus self-authored local positive/negative software controls; commit the checker.

**Acceptance:** Exact-note output has an independent checker receipt detecting extras/releases; source fidelity remains scoped.

### Task 6: Automate Structural Playability

**Files:** Create symbolic-playability.ts/test; connect into symbolic-review.ts. Existing MIDI policy constants remain authoritative.

**Interfaces:** `buildStructuralPlayability(mode: NormalizedScoreReviewMode): StructuralPlayabilityReceiptV1`. Bind delivery/replay/tempo/hand/policy hashes/difficulty; include overall CheckStatus, component metrics/statuses, located failures, fingering=not-assessed, keyboardAcceptance=not-established and limitations.

- [ ] Add `screens_range_density_and_hand_span`, `missing_hands_or_tempo_blocks_only_affected_metrics`, `variable_tempo_is_not_flattened`, `invalid_notes_cannot_disappear_from_metrics`, `silence_does_not_imply_a_musical_defect`. Assert piano range 21-108, explicit maximumHandSpan and current difficulty limits.
- [ ] Run red. Reuse measurePlayability/assessPlayability/PLAYABILITY_AUDIT_CONFIG/PLAYABILITY_LIMITS. Locate range, simultaneous/sounding span, density, rapid-region and leap issues.
- [ ] Validate events before metrics because existing helpers can filter invalid rows. Unknown hands block hand-specific metrics; measure global range where possible without assigning hands.
- [ ] Use native elapsed times and constant-tempo segments for variable tempo, with explicit cross-boundary intervals. Unsupported components stay not-run and incomplete screens cannot pass overall. No fingering/hand-size/pianist claim is created.
- [ ] Run structural/symbolic tests, emit Queen's mechanical receipt where supported and name missing pins as agent data-recovery actions; commit.

**Acceptance:** Actionable mechanical checks work without a pianist or owner review.

### Task 7: Deliver One Entry Point and Results Page

**Files:** Create score-review.ts/test, review-score.mts, score-review-cli.test.ts, score-review-report.spec.ts and docs/ops/score-review.md. Extend existing capabilities/reports only to expose/link the new workflow.

**Interfaces:** `buildScoreReviewReport(input: ScoreReviewReportInput): ScoreReviewReportV1` consumes pinned input, Task 5 receipt, per-mode Task 6 receipts and optional validated Anti result. Report contains lane readiness, coverage, located findings/actions, receipt refs, limitations and constant non-admission fields. `writeScoreReviewReport(report: ScoreReviewReportV1, outputDir: string): Promise<void>` writes exclusively.

CLI: `review-score.mts INPUT.json OUTPUT_DIR --offline [--anti-result REPORT.json]`, or `--send-audio --max-requests 1 --anti-python PATH --anti-script PATH --base-url URL --model ID --account-binding-json PATH`. Modes are exclusive; no flag defaults offline. `capabilities` requires no inputs and exposes versioned contracts.

- [ ] Add `offline_review_works_without_anti`, `joins_only_matching_saved_observations`, `retains_local_results_when_audio_fails`, `escapes_text_and_refuses_output_overwrite`, `reports_partial_coverage_without_overall_approval`. Assert zero offline network/helper calls, matching saved job/manifest/profile/media pins and no private binding identity in pages.
- [ ] Add invalid-input/no-mode/absent-Anti/multiple-jobs-under-cap/stale-receipt/ambiguous-result CLI cases. Exit 0 means a valid completed diagnosis, even with failed musical checks; exit 2 invalid input/prerequisite; exit 3 attempted provider rejection/failure with local results retained. Keep child adapter semantics internal.
- [ ] Run red. Compose existing modules and execFile argument arrays, never shell interpolation. Saved results are read-only and never authorize uploading. Media checks precede gateway metadata reads. Live mode explicitly selects evidence-v2 and Task 3 binding requirements.
- [ ] Emit input.json, symbolic-review.json, structural-playability.json (per-mode receipt map), report.json/report.md/index.html and repair-queue.json with real hashes. Retain media/evidence under safe local names. Old reports remain visibly legacy.
- [ ] Do not trust manifest-declared exactNotes/playability passed statuses. Admit them only through an opened, hash-verified, semantically compatible checker receipt bound to the same mode/input/scope. Show legacy declarations separately when that receipt is absent; never let them overwrite the newly computed checks.
- [ ] Lead the page with severity, phrase/occurrence/time, evidence origin, scope and next actions. Playback/score links are optional. No mandatory listening textarea, role/chord quiz, reviewer-recruitment task or overall correct badge. Expert limits are informational.
- [ ] Verify desktop/mobile in the existing Playwright harness: text fits, links/assets load, keyboard focus works, no uncaught errors, empty/blocked/error states are readable and untrusted text is escaped. HTTP 200 alone cannot pass this task.
- [ ] Run focused libraries/CLI/browser tests and selected-Node capabilities; commit commands and workflow.

**Acceptance:** One offline command returns useful results without Anti and asks the user for no musical labor.

### Task 8: Verify Repairs and Playback End to End

**Files:** Create score-review-repair.ts/test. Reuse music-repair-preview.ts, player-music-review.ts, existing render/capture commands and tests. Keep generated evidence under EVIDENCE_ROOT.

**Interfaces:** `buildScoreReviewRepairActions(report: ScoreReviewReportV1): ScoreReviewRepairAction[]` returns software-reproducer, bounded-preview, advisory-only or data-recovery actions with finding/input/evidence hashes. `createScoreReviewRepairPreview(input: { snapshot: ReplaySnapshot; proposal: RepairProposal }, action: ScoreReviewRepairAction): RepairPreview` verifies action binding and delegates eligible edits to previewMusicRepair.

- [ ] Add controls for trusted authored wrong/extra notes, a scheduling fault, unknown authority, provider-only chord advice and stale target snapshot. Assert 1-8 edits/one phrase, protected neighbor hash, correct source/finding scope, zero catalog writes/provider calls.
- [ ] Run red. Route confirmed checker findings without relaxing existing repair authority. Playback faults create software reproducers, not pitch edits. Self-authored controls can exercise edits without making Queen self-authored.
- [ ] Exercise one full control: input -> report -> preview -> fresh MIDI/Player resolver -> new report. Intended mismatch disappears, neighbors remain and no new discrepancy appears. This is the required software repair proof.
- [ ] Extend the control through existing rendering/paired capture with the known compatible sampled piano. Pin bank/settings, scheduled notes, key release/sustain and capture clock. Missing tools block this distinct realization subgate, with completed software repair proof retained; never substitute a synthetic/MIDI-only hearing claim.
- [ ] Process Queen into a located queue. Unknown-source/provider-only actions remain suggestions/data recovery; no catalog edit or renewed pitch-fit study. All rechecks here are local, with no second Gemini request.
- [ ] Run repair/Player/CLI integration tests, retain before/after receipts and commit.

**Acceptance:** A supported automatic repair is demonstrated; unsupported edits are refused with a concrete reason.

### Task 9: Run One Fresh Bound Live Smoke

**Files:** Create EVIDENCE_ROOT/live-smoke/manifest.json, input.json, exclusive dry/live directories and LIVE_SMOKE.json. Preserve every old run.

**Interfaces:** Consumes passing Tasks 2-3/7-8. Receipt separates adapter reservation, helper invocation, observed gateway/backend generation, valid response, comparison/abstention and binding identity. Unknown observed dispatch counts stay unknown.

- [ ] Verify final prerequisite hashes. Create one-job Queen manifest with ID `queen-original-replay-completion-$RUN_ID`, retaining old audio pins/synthetic classification, unverified alignment and phrase limits. Build input.json with this new manifest hash and Task 4-6 evidence. Never relabel old outcomes.
- [ ] Run a pre-gateway adapter dry-run with an explicitly synthetic valid local binding fixture and real schema pins. Expect one job, zero reserved attempts, no HTTP, exact assembled prompt/config digest and 4096 ceiling. This checks local assembly only; the synthetic binding cannot be dispatched.
- [ ] Use existing explicit session upload/account authorization at execution; do not request it again merely for a new directory. This plan-editing turn performs no upload. Without an unambiguously authorized eligible account, record blocked-before-dispatch and continue other work.
- [ ] Confirm a free loopback port. From Anti cwd start `"$ANTI_PYTHON" -m codex_antigravity_auth.cli start --host 127.0.0.1 --port SELECTED_PORT`. Do not use anti.py start to prove source identity: find_cli may choose an installed PATH executable. Record owned PID/import/health/catalog/source pins.
- [ ] Read /v1/account-bindings?model=gemini-3.1-pro from that serving instance. Preserve the exact native model/account selection. Write only the existing four binding fields to an exclusive private mode-0600 file; never print references/inventory or read encrypted credentials. Busy/expired/stale/auth/capability failure blocks with zero generation.
- [ ] Run a separate fresh no-HTTP dry-run with the actual binding file, verify its canonical identity and final code/media/schema pins, then freeze the input. Set ANTI_BASE_URL and PRIVATE_BINDING_PATH from these verified values. The synthetic dry-run is not the live dispatch pin.
- [ ] Submit exactly once through the integrated command:

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/review-score.mts \
  "$EVIDENCE_ROOT/live-smoke/input.json" "$EVIDENCE_ROOT/live-smoke/live" \
  --send-audio --max-requests 1 \
  --anti-python "$ANTI_PYTHON" --anti-script "$ANTI_SCRIPT" \
  --base-url "$ANTI_BASE_URL" --model gemini-3.1-pro \
  --account-binding-json "$PRIVATE_BINDING_PATH"
```

- [ ] Require ordered audio pins, complete bounded output, strict domain JSON, matching binding digest/instance and pre-backend verification. Valid abstention admits only the response contract; compared coverage stays zero. Neither compared nor abstained establishes hearing.
- [ ] On auth/capability/429/5xx/timeout/cancellation/schema/transport failure retain raw output and last-known state. No retry/resume/rotation/model change/budget increase/cleanup generation. Record terminal success/abstention/block/failure honestly.
- [ ] Stop only the owned temporary gateway/helpers, preserving user services and the old page. Separate historical totals from this run's at-most-one reserved attempt.

**Acceptance:** One budgeted attempt or explicit pre-dispatch block is retained; live readiness reflects only demonstrated transport/schema.

### Task 10: Package Actual Candidate Bytes and Compatibility

**Files:** Tracked plugin SKILL/references/README/check_checkout.py/source-members.json as needed. Create scripts/update-keyspilli-plugin-inventory.py and tests. Use existing package script/test. New archives/manifests go in EVIDENCE_ROOT/packages.

**Interfaces:** Inventory tool `--source DIR --check` refuses stale/missing/extra/unsafe members. `--source DIR --update` hashes the reviewed declared member list, excludes self-hash and writes sorted inventory. It does not bless undeclared files or accept installed/canonical paths. Existing packager flags stay --source/--output/--manifest.

- [ ] Add inventory tests for stale hash, undeclared/private/symlink/traversal/missing members, idempotent update and read-only check. Run red; reuse packager exclusions/limits, preserving undeclared-file refusal.
- [ ] Extend plugin preflight with versioned score_review offline/binding/receipt capabilities and absent/incompatible/compatible host self-tests. Old ordinary preparation still works; compatible never means provider available.
- [ ] Document Task 7 commands and automatic findings/repair limits. New workflow has no manual-form prerequisite. Preserve historic study stops and host/application ownership.
- [ ] Review source diff, refresh inventory and run --check, test_package_keyspilli_plugin.py and plugin self-tests. Use available frontmatter/JSON/link validation; do not install dependencies merely to run an optional validator.
- [ ] Build twice into distinct new paths:

```sh
python3 scripts/package-keyspilli-plugin.py --source plugins/keyspilli \
  --output "$EVIDENCE_ROOT/packages/keyspilli-a.zip" \
  --manifest "$EVIDENCE_ROOT/packages/keyspilli-a.json"
python3 scripts/package-keyspilli-plugin.py --source plugins/keyspilli \
  --output "$EVIDENCE_ROOT/packages/keyspilli-b.zip" \
  --manifest "$EVIDENCE_ROOT/packages/keyspilli-b.json"
```

- [ ] Require identical archive hashes, exact inventories and extracted byte parity. Check actual commands/schema/binding/relative links and absence of private paths/accounts/credentials/recordings. Probe the pinned host from the extracted plugin offline.
- [ ] Build Anti wheel/sdist from Anti cwd with `"$ANTI_PYTHON" -m build --sdist --wheel --outdir "$EVIDENCE_ROOT/packages/anti"`, using the already available build runtime. Run `"$ANTI_PYTHON" scripts/check_artifacts.py --dist "$EVIDENCE_ROOT/packages/anti"` and `"$ANTI_PYTHON" scripts/check_installed.py --dist "$EVIDENCE_ROOT/packages/anti"`. Verify helper/schema bytes in isolated temporary environments with account/keyring access stubbed; dependency installation into those temporary test environments follows the existing maintained script, never the installed gateway. Preserve gateway/package versions and record artifact/host hashes. A missing required build tool remains a concrete blocker, not a waived packaging gate.
- [ ] Commit reviewed release-source/inventory/docs. Adoption remains false and existing prereleases/canonical/loaded copies stay unchanged.

**Acceptance:** Reproducible artifacts reference compatible host code and cannot bypass inventory pins.

### Task 11: Verify the Current Candidate and Prepare Integration

**Files:** Create EVIDENCE_ROOT/VERIFICATION.json and INTEGRATION.md. Source fixes require a demonstrated failed check.

**Interfaces:** Consumes final candidate heads/artifacts/receipts/live disposition. Produces per-lane readiness and exact integration/dependency order.

- [ ] Run final Keyspilli full tests, workspace typecheck and production build with selected Node; run full Anti pytest with existing credential/network isolation. Retain actual commands/counts. Repeat only affected checks after a necessary new fix.
- [ ] Re-run the focused final-head report browser check/extracted plugin probe. Verify all input/media pins, no catalog/canonical-installed changes and no unauthorized account configuration/credential setup. Disclose expected gateway lease/cooldown bookkeeping separately if the live attempt produced it. A diagnosis containing defects is not an approval.
- [ ] Review both branch diffs natively for schema/legacy compatibility, reservation/cancellation, binding redaction, clock conversion, multiplicity, coverage, renderer provenance and repair authority. Verify meaningful fixes with discriminating tests; no subagent/provider review required.
- [ ] Refresh main/PR ancestry read-only. Prepare exact candidate dependency/integration order and rollback/adoption instructions without merging or discarding WIP. New CI is not-run unless actual exact-head checks were observed; old CI is historic.
- [ ] Record software-ready, live-contract-ready|blocked|failed, scope-dependent source fidelity, musicalAcceptance not-established, installedAdoption false and productionAdmission false separately.
- [ ] Future requested production adoption uses refreshed ADR0004 and existing release/restore/deploy guards. Prepare current concrete gaps; add no generic approval checklist or automatic deployment.

**Acceptance:** Required local software gates pass at final candidate heads; unresolved required software failures stay incomplete.

### Task 12: Freeze the Evidence Handoff and Close the Ledger

**Files:** New EVIDENCE_INDEX.json, REVIEW.md, NEXT_ACTIONS.md, SHA256SUMS_NATIVE.txt and COMPLETION.json; plan ledger and Obsidian daily/project notes.

**Interfaces:** COMPLETION.json records task/software/live status, unresolved source/realization scope, package identities and actual external non-actions. NEXT_ACTIONS.md lists concrete agent tasks or optional adoption decisions, never listening homework.

- [ ] Validate every receipt's exact input/code/policy pins. Index leaf artifacts with path/hash/lane/status; inaccessible/legacy evidence stays identified, never fresh success.
- [ ] Finalize mutable leaves before checksums. Exclude checksum self-hash and recursive index hashes; include finalized index in checksums and freeze afterward. Verify from the evidence root with `shasum -a 256 -c SHA256SUMS_NATIVE.txt`.
- [ ] Present dispositions for input integrity, literal conformance, source fidelity, structural playability, Player realization, transport/schema/provider interpretation and expert limits. Link located findings/repair previews/new offline page.
- [ ] Finish ledger incrementally with actual counts, reservation versus observed dispatch, package hashes and remaining tasks. A blocked live smoke completes a diagnostic task, not a live capability. Missing implementation/build/test remains incomplete.
- [ ] Use Obsidian skill to log evidence-backed summary in today's Oslo daily note and existing Anti music-review project note. No raw binding or invented attestation is stored.
- [ ] Open new local static HTML through open_in_codex when useful. No dev/listening server is required. Stop owned temporary processes, preserve user services and inspect bounded temp leftovers.
- [ ] Return usable CLI/report and candidate/package paths, software/live status and next actual action. Owner choices concern concrete optional adoption/publication/deployment outside this scope.

**Acceptance:** Offline workflow and evidence/fixes are reproducible without listening exercises.

## Completion Matrix

| Outcome | Required evidence | Disposition |
| --- | --- | --- |
| Offline implementation complete | Tasks 1-8/10-12, final tests/types/build, package/CLI/browser proof | Usable software candidate |
| Live contract ready | Bound identity, ordered media, complete schema-valid response | Optional interpretation for demonstrated route |
| Live blocked/failed | Precise immutable block/failure, no retry, local results | Offline candidate usable; live capability blocked/failed |
| Fidelity/keyboard judgment unknown | Missing authoritative anchors/timing/expert evidence | Limit claim, keep diagnosis available, assign no owner review |
| Adoption/release/deployment | Separate exact-artifact authorization/refreshed gates | Outside plan, not implied by local completion |

## Plan Self-review

Use this focused verification map as tasks land. Run from the stated worktree;
new paths become runnable only after their owning task creates them. Every
command must exit 0 with all selected tests passing; retain actual test counts.

| Task | Focused verification |
| --- | --- |
| 2-3 Keyspilli | `"$KEYSPILLI_NODE" node_modules/vitest/vitest.mjs run apps/web/src/lib/audio-review.test.ts apps/web/src/lib/audio-review-cli.test.ts` |
| 3 Anti | `"$ANTI_PYTHON" -m pytest tests/test_account_binding.py tests/test_server_account_binding.py tests/test_account_binding_helper.py tests/test_wav_audio.py tests/test_gemini_music_review.py` |
| 4 | `"$KEYSPILLI_NODE" node_modules/vitest/vitest.mjs run apps/web/src/lib/symbolic-review-input.test.ts` |
| 5-6 | `"$KEYSPILLI_NODE" node_modules/vitest/vitest.mjs run apps/web/src/lib/symbolic-review.test.ts apps/web/src/lib/symbolic-playability.test.ts apps/web/src/lib/music-correspondence.test.ts apps/web/src/lib/music-source-validation.test.ts` |
| 7-8 | `"$KEYSPILLI_NODE" node_modules/vitest/vitest.mjs run apps/web/src/lib/score-review.test.ts apps/web/src/lib/score-review-cli.test.ts apps/web/src/lib/score-review-repair.test.ts apps/web/src/lib/music-repair-preview.test.ts apps/web/src/lib/player-music-review.test.ts` |
| 10 | `python3 scripts/test_package_keyspilli_plugin.py` plus new inventory tests and existing plugin self-tests |
| 11 Keyspilli | `PATH="$(dirname "$KEYSPILLI_NODE"):$PATH" npm test`, then the same pinned PATH for `npm run typecheck` and `npm run build` |
| 11 Anti | `"$ANTI_PYTHON" -m pytest` |
| 12 | `shasum -a 256 -c SHA256SUMS_NATIVE.txt` from the finalized evidence root; `git diff --check` in both worktrees |

- Every required capability maps to concrete files/interfaces, meaningful tests and retained outputs.
- Local controls/binding precede the one live request; failure does not stop independent offline/package work.
- MIDI/XML/MXL, repeats, nullable roles/hands, variable tempo, multiplicity, releases and coverage are explicit inputs.
- Authority, score reproduction, audible realization, structural difficulty and musical approval remain separate claims.
- New CLI flags/interfaces are proposed explicitly; commands match current parser semantics and pinned runtimes.
- Historic studies/indexes/releases/installed artifacts remain immutable; new packaging refreshes its exact inventory.
- No listening/expert review, new research lane or model training is a required implementation step.
