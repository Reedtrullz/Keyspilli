# Keyspilli Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The user requested one GPT-6-Sol implementer; do not create additional children or substitute another model without user direction. The user already authorized planning followed by implementation, so do not insert a second plan-approval gate.

**Goal:** Correct all 23 audit defects, implement the ten-item polish backlog to its stated acceptance boundary, and resolve or explicitly disposition the eight additional risk areas with evidence.

**Architecture:** Repair the existing parser, publication, job, playback and UI contracts at their owning boundaries. Keep the current npm workspace architecture, shared catalog ingestion, SQLite publication safeguards and private single-user deployment model. Prefer guards, existing helpers and native browser features to new dependencies or broad rewrites.

**Tech Stack:** Node 22.22.3, TypeScript, Next.js/React, SQLite, Vitest, Playwright, Web Audio, Verovio, existing Python/Ansible operational fixtures.

**Spec:** [Initial audit](/Users/reidar/Projectos/Keyspilli/docs/audits/2026-09-27-project-review.md), [complex audit](/Users/reidar/Projectos/Keyspilli/docs/audits/2026-09-27-complex-review.md), and GitHub issues #113–#136 in Reedtrullz/Keyspilli. #119 contains ten checklist items, not one defect.

## Global Constraints

- Audited source is main `cd4e42822dd48963d982c270e4f0b93594ac7993`, located at `/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli`. Verify current main and inspect any subsequent changes before implementation.
- The primary checkout `/Users/reidar/Projectos/Keyspilli` is older `codex/organ` with WIP. Never reset, clean, regenerate its catalog, or implement there.
- Read the global and applicable project AGENTS instructions. Local guides in the primary checkout describe its older branch; verify their source-specific claims against the actual implementation checkout.
- Prepare a clean isolated `codex/audit-remediation` branch. Inspect attached worktrees first and reuse a suitable free checkout; otherwise use the managed create_worktree tool. Do not overwrite or switch a checkout another process is using.
- Use `export PATH=/Users/reidar/.hermes/node/bin:$PATH` and verify `node --version` is v22.22.3. Pin the supported runtime in the repository during Task 1.
- Run `df -h /System/Volumes/Data` before substantial build/test work; stop build loops below 30 GiB. Keep scratch data bounded and clean only task-owned artifacts.
- Never read .env/credential files. Tests must use isolated synthetic catalogs, dummy tokens and local fake providers; do not run production imports or worker media jobs.
- Preserve mutation authentication, source provenance/licensing, artifact journals/locks, curated references and current owner-approved musical evidence.
- Do not merge, deploy, change production storage, or silently approve/re-pin musical outputs. Code/tooling completion is distinct from listening approval and live backup measurements.
- No new framework, broad rewrite, automatic storage deletion, or broad dependency upgrade. Use an installed parser only if its existing security and workload properties fit; otherwise reject unsupported formats cleanly.
- Each substantive fix gets one focused regression in an existing suite where possible. Port the audit's defect-asserting probes to assertions of correct behavior; do not retain passing assertions that celebrate a bug.
- Produce coherent local commits with issue references, an implementation status ledger and verification results. A draft PR is allowed once checks pass; attach any created PR to this chat. Do not close issues before the fixes are integrated and acceptance is satisfied.

## Review Focus

1. Cancellation/abort immediately before and after irreversible publication: no successful cancellation followed by an untracked committed song (Task 4).
2. Malformed count fields and misleading archive metadata: entry/size limits apply to actual extraction, not merely declared values (Task 2).
3. Cross-song resource reuse and late async completions: a disposed request cannot overwrite a new score or close another export (Task 5).
4. Input note ownership with repeated pitch, sustain, grading completion and instrument switching: no stuck or prematurely terminated voices (Task 6).
5. Loop/seek boundaries with tempo changes, delayed frames and short chords: notes, chords and clicks obey the same interval and transpose contracts (Tasks 7–8).

## Scope and dependency map

| Task | Issues/checklist items | Depends on |
| --- | --- | --- |
| 1. Execution baseline and runtime | #119 runtime pin | none |
| 2. Safe and truthful import | #124, #125, #126, #127; format-coverage risk | 1 |
| 3. Preserve prepared backing | #113 | 1 |
| 4. Atomic job/handoff publication | #120, #132, #136; reconciliation risk | 3 |
| 5. Async resources and notation | #118, #134, #135; #119 notation deadline; warm-up risk | 1 |
| 6. Audio ownership and routing | #121, #122, #128, #129, #130, #131; cross-engine risk | 1 |
| 7. Timing and preview parity | #115, #116, #123 | 6 |
| 8. Pitch/display/export contract | #114, #117; #119 transpose bound/native dialog | 5, 7 |
| 9. Catalog and import UI | #133; #119 uploads/progress/formatting; storage/JSON risks | 4, 5, 8 |
| 10. Musical regression evidence | #119 full-output pin/portable fixtures | 2–9 |
| 11. Retention and operational evidence | #119 retention; backup-growth risk | 4 |
| 12. Integration review and handoff | all issues; complexity risk disposition | all |

Implement sequentially with one worker. Dependency-independent tasks need not be parallelized. Keep the status ledger at `docs/audits/2026-09-27-remediation-status.md` inside the implementation checkout; record issue/checklist ID, commit, test, remaining acceptance and disposition.

## Task 1: Prepare the implementation baseline and pin Node

**Files:** root package.json and package-lock.json; create .nvmrc; existing contributor setup documentation and .github/workflows/ci.yml only where they disagree with the pin.

**Interfaces:** Keep existing workspace scripts. Contributor runtime and CI must resolve Node 22.22.3 consistently; no native-module rebuild in an unrelated checkout.

- [ ] Record branch, HEAD, remote main, status and disk space; preserve the original checkout inventory.
- [ ] Copy the two audit reports and this plan into the isolated implementation checkout for durable review. Read local audit probes at `/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/output/project-review-2026-09-27`; port relevant cases into tracked package tests as each fix lands.
- [ ] Set .nvmrc to `22.22.3`, align the root Node engines floor/major with supported Node 22, and keep CI/setup instructions consistent. Update lockfile metadata only if required; do not refresh dependencies.
- [ ] Run `node --version`, `npm run typecheck` and `npm test` once as baseline. Investigate failures before attributing them to a new patch; retain prior WIP separation.
- [ ] Commit the plan/runtime baseline with a #119 reference.

## Task 2: Validate archives and reject unsupported musical semantics

**Files:** packages/catalog/src/ingest.ts and test/ingest.test.ts; packages/midi/src/parse.ts, src/parseXml.ts, test/parseXml.test.ts; add packages/midi/test/parse-format.test.ts only if no existing MIDI parser suite is suitable; existing upload error-mapping tests.

**Interfaces:** Preserve `parseMidi(buf: Uint8Array): ParsedMidi`, `parseMusicXmlNotes(xml: string): ParsedMidi` and the `ingestSource` result shape. Unsupported source semantics must fail before publication with an actionable message.

- [ ] Port both MXL probes. Assert rejection of 201 entries, aggregate declared expansion above 64 MiB, mismatched EOCD +8/+10 counts, spanning/unsupported ZIP64 and central-directory inconsistencies. Small ordinary MXL must still ingest successfully.
- [ ] Inspect installed fflate extraction behavior. Reject unsupported structures and validate every entry using the same directory interpretation as extraction. Bound actual extraction at 200 entries and 64 MiB, including lying uncompressed-size metadata; stop before excess allocation using the existing library's bounded/streaming facilities where necessary. Merely checking declared sizes twice is not acceptance.
- [ ] Add parser tests: four real notes plus a commented note yields exactly four notes/four beats; comments around measures/tempo cannot alter music. Keep entity expansion/network resolution disabled and reject malformed XML rather than silently truncating.
- [ ] Reject MusicXML repeat/ending/navigation constructs whose playback order is unsupported, with clear unsupported-form errors. The repeat-times=2 fixture must fail explicitly until expansion is implemented; do not expand repeats as an unrequested feature.
- [ ] Reject MIDI format 2 and unknown formats; validate format-0 track count. Valid format-0/1 fixtures must remain unchanged.
- [ ] Run `npm test -w @keyspilli/midi` and `npm test -w @keyspilli/catalog -- test/ingest.test.ts`; verify upload routes translate unsupported-input errors consistently. Commit #124–#127.
- [ ] Document supported/unsupported playback semantics. List additional notation constructs requiring investigation rather than declaring all MusicXML fidelity solved.

## Task 3: Preserve prepared backing through metadata publication

**Files:** apps/web/src/lib/song-update.ts and song-update.test.ts; packages/catalog/src/ingest.ts, chord-timeline.ts and relevant publication/ingest tests.

**Interfaces:** Preserve `applySongMetadata(id: string, patch: SongPatch): Promise<SongRow[]>` and the existing base writer lock, staged directory swap and reconciliation journal.

- [ ] Add a metadata regression with a valid prepared chord-timeline: after changing only title, backing bytes remain present and the real timeline loader still selects prepared backing.
- [ ] Cover ordinary re-ingestion, unchanged musical source, changed source and concurrent metadata/source updates. A changed source must not silently reuse an incompatible accepted timeline or discard evidence.
- [ ] Preserve compatible sidecars as part of staging under the existing publication lock. Reconcile any metadata-induced identity changes without weakening true musical-source fingerprint checks. Keep incompatible evidence with an explicit review-needed outcome.
- [ ] Run `npm test -w @keyspilli/web -- src/lib/song-update.test.ts` and the catalog publication/ingest tests. Verify rollback retains the old complete base on failure; commit #113.

## Task 4: Make cancellation, retry and source confirmation atomic

**Files:** services/transcribe/src/worker.ts and test/worker-tutorial.test.ts; catalog publication/DB helpers and source-candidate-handoff.ts; API routes under youtube/jobs/[id], youtube/jobs/[id]/retry and source-handoffs/[id]/confirm; their colocated tests (create missing route.test.ts files).

**Interfaces:** Keep public route shapes where possible. Retry returns 409 for non-retryable active/completed states. Confirmation cannot move a terminal accepted handoff backward. Successful cancellation means publication has not committed.

- [ ] Port the controlled publication/cancellation interleaving: cancellation before commit leaves no published variants; cancellation after commit reports too late and preserves the job's song link. No successful cancellation with six published orphan variants.
- [ ] Coordinate cancellation with the same commit decision/lock used by publication. Check every result from owned-job updates. Reuse current lease/journal logic; another early cancellation check alone is insufficient.
- [ ] Add an atomic retry transition from explicitly retryable terminal error states only. Test active processing, queued, completed, absent and retryable jobs; active retry must not issue a second lease.
- [ ] Port the delayed confirmation probe. Parse the body before loading current state, then enforce the state transition atomically in SQLite; test duplicate confirmation and accepted-upload races. Preserve uploadedSourceSha256 and intake binding.
- [ ] Preserve structured ARTIFACT_RECONCILIATION_REQUIRED outcomes through the worker; do not auto-requeue them. Test a recovery-needed publication fixture and actionable UI error classification.
- [ ] Run worker tests, catalog handoff/publication tests and affected API suites; commit related fixes with #120/#132/#136 references.

## Task 5: Bound async work and isolate notation/export resources

**Files:** packages/catalog/src/source-candidate-provider.ts and provider tests; packages/engrave/src/verovio-worker.ts and test/verovio-worker.test.ts; apps/web/public/verovio/render-worker.mjs; SheetMusicView.tsx; api/song/[id]/export/route.ts and route.test.ts. Add a focused render-worker protocol test beside existing web worker tests if necessary.

**Interfaces:** Retain existing worker request/session/disposal APIs. Export `VEROVIO_REQUEST_TIMEOUT_MS = 30_000`, clear timers after settlement, and allow explicit retry by creating a fresh worker. A timeout invalidates every session owned by that worker; a late error from a disposed worker must not dispose its replacement.

- [ ] Port stalled HTTP-body reproduction; keep the existing source-provider timeout active through body consumption and cleanup/retry. Verify both headers and a never-ending body respect the deadline.
- [ ] Test a worker that never responds: pending request rejects by its deadline, all owned promises settle, worker is disposed, a subsequent fresh request can succeed, and late responses cannot revive old sessions.
- [ ] Port A -> oversized B -> A: cached and uncached A pages must both come from A. Invalidate cache ownership before mutating the shared toolkit, including oversized and failed loads.
- [ ] Add a SheetMusic warm-up rejection test; handle initial prefetch failure through existing error state and avoid unhandled promises/stale readiness.
- [ ] Port two-export cancellation: abort B while its page is pending; A succeeds, B's late page is closed, shared browser stays usable. Cover abort before browser creation and export timeout without sibling cancellation.
- [ ] Run affected web/provider suites and `npm test -w @keyspilli/engrave`. Commit #118/#134/#135 and notation checklist work.

## Task 6: Unify audio lifetime behavior without a new audio framework

**Files:** packages/player-core/src/audio.ts, sampler-audio.ts, organ-audio.ts and engine.ts; test/engine.test.ts, sampler-audio.test.ts, organ-audio.test.ts; add test/audio.test.ts for oscillator-only behavior if absent; Player.tsx microphone lifecycle only where needed.

**Interfaces:** Preserve existing AudioEngine/PlaybackEngine APIs, noteOff/all-notes-off/dispose ownership and separate hand gains. Physical input is held until release; microphone feedback is finite; scheduled playback uses its bounded duration.

- [ ] Convert pending-sampler chord-only probe into an assertion that fallback attacks occur. Reuse one fallback initialization path from noteOn and playChord; synchronize all current gains and sustain at creation.
- [ ] Test an R-hand/input note with RH=1/LH=0 and an L-hand accompaniment with the inverse. Correct sampled routing and live gain updates without destroying sustained voices.
- [ ] Make microphone feedback use finite duration rather than held-key semantics; ensure grading completion cannot start a new orphan feedback voice afterward. Test repeated pitch, silence, pitch change and final accepted input.
- [ ] For oscillator physical input, remove fixed scheduled termination while preserving envelope character and explicit release. Test holding beyond 0.6 seconds, noteOff, pedal behavior, instrument switch and disposal.
- [ ] Track sampled metronome oscillators using the existing click lifecycle pattern. cancelAll must cancel scheduled clicks and disconnect resources.
- [ ] Run the same small ownership cases against synth/sampler/organ where the contract is shared. Run `npm test -w @keyspilli/player-core`; commit #121/#122/#128–#131. Record real listening as separate acceptance.

## Task 7: Correct scheduling intervals and preview parity

**Files:** packages/player-core/src/engine.ts and test/engine.test.ts; Player.tsx accompaniment-only preview and its existing tests.

**Interfaces:** Reuse existing beat/second conversion and preview interval logic. Keep source pitches untransposed until the existing scheduling boundary.

- [ ] Seek to 1.9 seconds inside a 0–2 second chord: assert exactly 0.1 seconds of remaining chord duration; seeking into a rest schedules no stale chord.
- [ ] For loop end 1.0 seconds, starting at 0.95 must not schedule the 1.02 attack. Apply interval intersection to notes, chords and metronome clicks.
- [ ] Preserve delayed-frame overshoot modulo loop length and schedule wrapped windows without double attacks. Cover tempo change, speed change, seek, zero-length/invalid loop and grading endpoint precedence.
- [ ] A valid 0.125-second chord must appear in both normal playback and both preview paths. Remove obsolete 0.2-second exclusion while retaining positive-duration/window clipping.
- [ ] Run engine/preview tests and player-core suite; commit #115/#116/#123.

## Task 8: Align visible pitch and disclose original-key assets

**Files:** Player.tsx, chord-practice.ts, LeadSheetView.tsx, BeginnerView.tsx, DownloadDialog.tsx, transpose-parity.test.tsx; shared preferences bounds in packages/player-core/src/prefs.ts and test/prefs.test.ts.

**Interfaces:** Reuse transposeChordSymbol and current playback transpose boundary. Stored Sheet Music/download files remain in their original key; label that fact explicitly rather than implementing a new transposed export pipeline.

- [ ] Extend nonempty chord parity tests: C at +2 displays D; slash-bass symbols and note labels transpose once in all applicable views. Raw playback sources remain unmodified.
- [ ] Show an original-key notice whenever nonzero playback transpose is used with static Sheet Music or downloads, including Original mode. Clear it at zero.
- [ ] Apply the existing persisted ±24-semitone bound to all UI entry points and disable controls at endpoints. Ensure reload matches the live value; handle out-of-instrument-range output according to existing scheduler policy.
- [ ] Convert DownloadDialog to the native showModal pattern already used by PracticeSetupDialog; preserve Escape, focus return, keyboard traversal, accessible naming and close animation.
- [ ] Run relevant web/prefs tests and a browser keyboard/focus check; commit #114/#117 and #119 transpose/dialog items.

## Task 9: Correct recent-song selection and import/UI boundaries

**Files:** packages/catalog/src/db.ts, db-types.ts and query tests; apps/web/src/app/page.tsx; uploads/UploadsForm.tsx; youtube/ImportProgress.tsx and TutorialImport.tsx; services/transcribe/src/tutorial-route.ts; API youtube/route.ts and songs/[id]/route.ts; packages/player-core/src/prefs.ts.

**Interfaces:** Add `"newest"` to the existing SongFilters sort union, sorting grouped creation timestamps descending before limit/offset and breaking ties by base ID. Home requests `listSongsGrouped({ sort: "newest", limit: 12 })`.

- [ ] Test 201 grouped songs with 200 old played entries and one new unplayed entry: Recently added includes the new entry; popularity queries remain unchanged. Commit #133.
- [ ] Reject client files above the existing 10 MiB server limit before reading; retain authoritative server enforcement. Prevent duplicate submit, freeze/version details during submission, abort on unmount, and ignore late results from superseded requests.
- [ ] Distinguish busy/retry from reconciliation-required outcomes. Copy must explain that client cancellation is not proof of server rollback.
- [ ] Use deployment-neutral progress copy: processing continues on the server and the saved job can be revisited. Format dense tutorial async code while preserving control flow; avoid a state-machine dependency.
- [ ] Guard API JSON null/array/non-object bodies and return 400, retaining authentication checks first. Add direct route tests.
- [ ] Validate favorite/learned arrays and saved mode enums at existing preference read boundaries. Corrupt but valid JSON must fall back safely; valid old preferences remain compatible.
- [ ] Run affected query/API/UI/prefs suites; verify upload error/retry and navigation in a local synthetic browser catalog. Commit #119 upload/progress/formatting work and additional hardening.

## Task 10: Make regression coverage portable and full-output acceptance explicit

**Files:** apps/web/scripts/audit-golden-chords.mts and current golden corpus manifest; playwright.melody.scratch.config.ts, playwright.config.ts, e2e synthetic fixtures/specs and .github/workflows/ci.yml where necessary.

**Interfaces:** Keep `acceptedBackingSha256` and its legacy behavior intact. Add optional `acceptedPlaybackSha256` to corpus entries, compare it with the existing `observedPlaybackSha256`, and report `playbackStatus: "UNPINNED" | "MATCH" | "DRIFT"`. Add `--require-playback-match` as a distinct strict gate; missing full-output approval must fail that gate. Preserve accepted beat-window scope and snapshot identity.

- [ ] Add a synthetic mutation test: changing a generated backing note changes the full digest even when a legacy digest would remain unchanged.
- [ ] Implement validation/reporting for the full-output approval field. Missing pins must remain review-needed, never implicitly pass or inherit approval from a different digest.
- [ ] Produce candidate digests/listening evidence for owner review where available. Do not replace existing approvals or auto-pin today's output; actual musical acceptance remains open until independently reviewed.
- [ ] Replace hardcoded private fixture roots with `KEYSPILLI_E2E_SOURCE_ROOT` and `KEYSPILLI_E2E_RESERVED_FIXTURE_ROOT`, with actionable missing-fixture messages. Keep private corpus cases opt-in; use the existing scratch teardown for cleanup.
- [ ] Add small synthetic seek/loop/transpose/short-chord and navigation cases to ordinary CI. They must run in a checkout without private source files or real catalog data.
- [ ] Run portable Chromium cases and existing mobile WebKit checks relevant to changed controls; record missing browser/runtime dependencies explicitly. Commit #119 full-output/portable-test work, distinguishing implemented mechanism from pending approvals.

## Task 11: Define retention boundaries and measure synthetic backup cost

**Files:** docs/ops.md and existing backup documentation; existing tutorial cache helpers and deploy backup scripts only if the policy exposes a specific code defect.

**Interfaces:** Preserve all referenced source/output/evidence and backups. Cache freshness is not deletion authority. Retention remains dry-run/report-only in this task.

- [ ] Document file classes and ownership: active jobs, accepted artifacts, review-needed attempts, reconstructible cache and unreferenced intermediates. State references and recovery evidence required before deletion.
- [ ] Add a minimal dry-run inventory mode only if existing tools cannot report those classes; ambiguous ownership always means retain. Do not add a scheduled janitor.
- [ ] Measure archive/hash/retention stages on a bounded synthetic fixture and record fixture size/time; clearly label it as non-production.
- [ ] Run `python3 deploy/test/test-backup.py` and `bash deploy/test/ops-check.sh` if relevant scripts changed. Record live backup duration/freshness and actual retention activation as pending operational verification; do not claim #119 retention fully accepted from synthetic data.
- [ ] Commit the explicit policy, measurement method and outstanding evidence.

## Task 12: Integrate, verify, and account for every issue

**Files:** implementation status ledger; applicable docs; source touched by prior tasks only for review corrections.

- [ ] Audit every modified boundary for sibling callers, resource leaks and races. In particular review publication lock ordering, stale owned-job writes, archive-size enforcement, shared toolkit identity, and input release across all instruments.
- [ ] Address code concentration by keeping each fix local and removing obsolete duplicated logic when directly justified. Record broad file splitting as not justified solely by line count; do not rewrite the generator/player to satisfy a cosmetic metric.
- [ ] Ensure each of the 23 defect issues, all ten #119 checklist entries and all eight additional risk areas has an explicit status and evidence. Human approval/live-operation dependencies must remain pending, not checked off.
- [ ] Run `npm run typecheck`, `npm test`, the relevant local production build/browser suite and affected backup/ops fixtures after integration. Run the catalog verifier only against the synthetic fixture, after reading its script. Retain logs and exact SHA.
- [ ] Use a local browser for upload error/retry, original-key notices, transpose bounds, dialog focus, recent-song listing and multi-page score navigation. Do not test live mutation endpoints.
- [ ] Review final diff and issue coverage; preserve original checkout WIP and clean task-owned scratch. Produce coherent commits and a draft PR if all required engineering gates pass; attach it to this chat. Include “Refs #...” for partial checklist/acceptance items rather than claiming automatic closure.
- [ ] Update Obsidian project and daily logs with exact commits/tests, remaining acceptance, and PR link if created. Return changed paths, issue-by-issue status, test results and blockers. No merge/deployment.

## Executor handoff

The requested executor is one `gpt-6-sol` subagent at `xhigh` effort. It owns implementation changes in the prepared clean branch; the parent owns review, integration and user updates. The executor should make progress through the tasks without asking for repeated authorization, but must not invent musical approval, production measurements or unavailable test results.

Read this plan and both reports first. Reuse the existing audit probes as reproduction input, then implement correct-behavior regressions. Keep the progress ledger updated between tasks. If tool availability prevents the requested model from starting, preserve this plan and report that launch blocker explicitly; do not silently run a different model.

## Launch status — 27 September 2026

Plan coverage checked: all 24 issue IDs (#113–#136, including the ten-item #119 backlog) map to the twelve tasks. No implementation task is marked complete.

After `ocx sync`, `ocx agent status --json` still reports `subagents.catalogState.state = "stale"`. GPT-6-Sol appears in `available`, but not `chosen` or `pickerAvailable`; the active spawn tool's advertised overrides also omit it. `/Users/reidar/.codex/AGENTS.md:48` requires failing closed for a stale catalog. No spawn was attempted, no substitute model was launched, and no implementation branch or application edit was made. A refreshed session exposing the requested Sol route is required before launch. Do not treat an installed/static catalog entry as proof that this session can spawn it.
