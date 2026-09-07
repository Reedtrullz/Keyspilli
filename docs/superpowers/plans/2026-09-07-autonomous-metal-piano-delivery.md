# Autonomous Metal-to-Piano Delivery Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` inline, task by task. No subagents are required. This plan is awaiting Reidar's execution approval. After approval, complete authorized work without routine checkpoints requiring his presence. Failed experiments select the next branch below; they do not silently end execution.

**Goal:** Ship the strongest demonstrably working, commercially usable, free/local song-to-playable-piano beta for new imports, using verified alternate sources when necessary, while preserving existing songs. Separately determine whether direct metal audio meets the stronger musical acceptance target.

**Architecture:** Reuse source discovery/intake, native parsers, the separated-audio worker, `MetalArrangementIR`, variants and player. Prefer a verified playable symbolic source; otherwise use a supported piano tutorial/recording, then a measured direct-audio route. All routes produce explicit source/arrangement provenance and owned timing. Select a melody phrase before hand assignment, then generate accompaniment and difficulties. Unsupported inputs produce an actionable review/error outcome.

**Tech Stack:** Existing Node22.22.3/TypeScript, Python3.11 private runtime, FFmpeg, Demucs/Basic Pitch, NumPy/SoundFile/librosa, SQLite, Vitest, Playwright. Add no model or platform without the experiment and license checks below.

**Spec:** `docs/research/keyspilli-evidence/metal-recovery-decision-2026-09-07.md`, `metal-delivery-progress-2026-09-07.md`, and the decisions below. This plan supersedes the execution order of `2026-09-07-reliable-metal-to-piano.md`; its completed evidence and untouched holdouts remain valid.

## 1. Agreed product and autonomy decisions

Confirmed by Reidar on7 September2026:

- A good playable version takes priority over reproducing the original metal recording exactly. Automatically choose a verified same-song MIDI/score/piano tutorial when necessary; clearly label the actual arrangement and follow its form/timing.
- Free/local resources only. No purchases, subscriptions, rented GPU, paid API usage or new paid accounts. Use existing configured free resources only within known free quotas. A provider requiring spending is skipped.
- Production code **and weights** must permit commercial use. MuScriptor's noncommercial weights are excluded from production selection; its historical results remain evidence, not a candidate to promote under this plan. Unknown weight terms mean ineligible until verified.
- Merge and deploy after the applicable gates pass. A clearly labelled beta for **new imports only** may ship before Reidar's final listening review. Existing songs, versions, plays and approved Livgardet/ABBA arrangements stay unchanged.
- Default product output is a recognizable theme plus useful accompaniment. Preserve explicit accompaniment-only requests such as the prior ABBA repair. An accompaniment-only alternate may be offered with that label, but does not count as a successful melody-bearing conversion in the acceptance denominator.
- No human musical acceptance may be fabricated. Beta verification and later musical certification are separate statuses. Reidar's final listening is not a prerequisite for continuing engineering or for the explicitly authorized labelled beta.
- Publicly downloadable does not establish redistribution rights. Retain source/license provenance; use eligible sources for production and keep research-only media private. Do not relabel unknown source rights as commercial permission.

## 2. Starting state and preservation

- Worktree: `/Users/reidar/Projectos/.keyspilli-worktrees/metal-delivery`; branch `codex/metal-delivery`. Original `/Users/reidar/Projectos/Keyspilli` WIP must not be bundled or overwritten.
- Starting evidence commits: `fd8e6ba` piano preservation/evaluator parity; `2934f1f` native timeline fix; `831e8b2` identity isolation/recovery decision. Verify current HEAD/status before proceeding.
-38 original recordings are downloaded and SHA256-frozen.12 development recordings have baseline/repaired predictions.20 supported and6 challenge recordings have no predictions and remain held out.
- Existing A/B candidates failed Reidar's listening gate.22/24 structural passes do not qualify them. Both Silent Lucidity candidates fail9 versus8 sounding-note limit.
- Private artifacts/runtime: `output/metal-development/` (~2.1GiB at checkpoint). Reuse cached audio, role MIDI, model weights, traces and scripts. Do not rerun separation when a selector-only change can replay MIDI.
- Controlled invented16-note riff: clean16/16 attacks survive across hands; with6 false upper notes,15/16 survive across hands and only8/13 RH attacks match. A hand split itself is not a failure; extra/incorrect identity is.
- CPU pipeline diagnostic912.9s, separation745.1s, peak child RSS2.20GiB. Local12-song A/B median61.5s. Do not extrapolate either into a universal runtime promise.

## 3. Finish lines

### A. Required engineering completion

A reproducible branch containing source-route selection, supported import path(s), melody preservation fixes, five public levels, honest status/provenance, worker recovery and verified exports/player behavior; exact test/evidence report; no existing-song mutation. If publication is ineligible, leave a complete runnable review candidate and explain the precise failed gate.

### B. Autonomous labelled-beta release gate

All of the following are required:

1. Full CI and relevant local checks pass at the exact release commit; immutable images, backup and rollback are prepared.
2. At least6 **new full-song** end-to-end development imports succeed, across at least2 independent artists and at least2 input/source families where available. Each enabled non-native route contributes at least2 full-song cases, including one not used for its tuning. A native-only source-assisted beta qualifies only if a requested song URL automatically resolves to an eligible verified native arrangement through the new route; merely retesting existing manual MIDI upload does not count as delivering this task. Do not advertise unsupported discovery/video/audio routes.
3. Every released route passes its fixed objective reference checks, complete duration/form checks, five-level identity retention, MIDI/MusicXML/player round trips, and no known critical defect. A known-bad song must be review/error, never included as a successful beta case.
4. Tested timeout/acquisition/parse/restart/duplicate/retry paths cannot silently publish a wrong-source or stale full-mix result or overwrite a good song.
5. Display a clear beta label, actual source/arrangement, and whether vocal melody is included. Preserve all existing catalog rows/artifacts, confirmed by before/after hashes and counts.
6. Production private-canary import exercises the real queue→worker→catalog→player/export chain; verify restart/rollback behavior without disrupting unrelated services. Promote new imports only after it passes.

These are engineering beta gates, **not human musical approval**. Record unresolved listening separately and provide a compact review page for Reidar's return.

### C. Strong musical claim (separate, never inferred)

The original18/20 untouched supported full songs acceptable automatically, zero critical defects among accepted outputs, human full-song/level acceptance, and honest challenge handling. Acquisition/review failures count in the denominator. Do not claim this while Reidar is AFK. A failed held-out cohort cannot be retuned and relabelled unseen.

## 4. Resource and experiment limits

- Before heavy jobs: `df -h /System/Volumes/Data`; require30GiB free. One heavy inference/build at a time. Private task storage ceiling15GiB incremental; keep valuable MIDI/reports/hashes and remove only owned regenerable scratch after jobs finish. No broad Docker/cache cleanup.
- Download at most3 candidate sources per development song, each at most10minutes and250MiB.38 original recordings already exist; do not redownload them. Unsupported challenge duration is a rejection test, not permission to bypass limits.
- Search at most4 queries/song,10 results/query,3 candidate acquisitions/song. Prefer source-native MIDI/MusicXML, then supported tutorial, then clean piano audio. A search result alone is not usable evidence.
- At most2 alternative transcription algorithms/backends beyond existing baseline. First: existing librosa monophonic pitch tracking for vocal/bass roles. Second: a commercially eligible instrument-aware/piano-specific model only if official code/weights/runtime terms are verified. Allow at most90minutes setup per challenger and2 configuration trials on development excerpts. Never use a monophonic tracker for polyphonic chords.
- At most3 meaningful development selection/arrangement iterations before choosing the best valid route and completing integration. No hundreds-of-threshold-search loop. Every iteration records its hypothesis and per-case outcomes; reject a gain with a new critical regression.
- Per acquisition timeout120s with at most2 transient retries; separator900s locally/1200s CPU; per role transcription300s locally/600s CPU. Queue lease/heartbeat must exceed/recover real stage behavior rather than assuming a whole conversion fits15minutes.
- No paid resources. Provider authentication unavailable, commercial terms unclear, or setup budget exceeded: mark unavailable and use the next eligible route. Do not ask the AFK user to unlock a backend.
- These are ceilings, not quotas to consume. Stop an experiment early when its evidence is decisive, then continue the next productive task.

## 5. Task 1 — Freeze execution inputs and runnable evidence

**Files:** existing cohort/source/development JSONs; `packages/catalog/scripts/evaluate-metal.ts`; create one bounded runner `packages/catalog/scripts/run-metal-development.ts` only by promoting/reducing the existing private `run-development.mts`; associated `packages/catalog/test/run-metal-development.test.ts`.

- [ ] Verify branch, Node, disk, current jobs, original WIP and deployment identity; snapshot only relevant public metadata and SHA256s. Do not print environment secrets.
- [ ] Copy the existing private runner into the maintained script, replacing hardcoded paths with required CLI paths. Reuse `transcribePitchedStems`, `parseMidi`, `buildMetalArrangement`, `buildVariants`, `evaluateArrangement`.
- [ ] Reject any manifest selection outside the explicit development split; check source hashes before inference; skip completed matching hash/config runs. Record code/model/config/source hashes, stage timings and failures.
- [ ] Add the smallest CLI regression proving a held-out entry cannot run in development mode and changed hashes invalidate cache. Use mock subprocesses, not real model downloads in CI.
- [ ] Record the command and environment needed to replay every candidate; fix the private initial variant-tempo typo in the maintained runner. Preserve per-hand MIDI tracks and normalized variant tempo.

Run:
```sh
export PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH
npm test -w @keyspilli/catalog -- test/run-metal-development.test.ts test/evaluate-metal.test.ts
npm run typecheck -w @keyspilli/catalog
```
**Exit:** one repeatable bounded development command; no holdout invocation or production mutation.

## 6. Task 2 — Build independent melody targets and source-assisted controls

**Files:** reuse `local-reference-builder.ts`, `local-reference-readiness.ts`, `dense-metal-amt-evaluation.ts`, `score-reference-corpus.ts`, `piano-alignment.ts`; create evidence manifest `metal-recovery-reference-manifest-2026-09-07.json` without score/media contents.

- [ ] Choose three initial development targets: Breaking the Law (riff), Hearts on Fire (clean vocal), Nemo (layered). For each acquire a main-theme20–30s reference and a transition/secondary passage; record exact original recording offsets and arrangement identity.
- [ ] Start with the artist-hosted Breaking the Law tab already downloaded. Find independent source-native score/MIDI or visible tutorial material for others; do not use Basic Pitch, MuScriptor or the candidate arranger output as truth.
- [ ] Align reference to audio using existing alignment helpers plus independent onset/score checks at beginning, middle and end. Distinguish octave transposition from wrong pitch class. Mark ambiguous transcription uncertain and exclude it from decisive scoring, reporting excluded coverage.
- [ ] If a target lacks a defensible reference after its search budget, substitute another **development** song and record why. After at most6 development targets, if insufficient independent real references exist, retain clean source-assisted controls and withhold direct-audio promotion; continue source route integration.
- [ ] Create3 clean controls from eligible native symbolic pieces: render to piano and compare transcription to the original note events. These verify piano intake/round trip, not dense-metal accuracy.
- [ ] Keep reference note files outside generation inputs and out of git. Reference manifests contain hashes, windows, source terms, confidence and scorer policy. Do not let generator scripts read them.
- [ ] Freeze objective policy **before** running alternatives: exact pitch/onset precision and recall plus octave-tolerant pitch-class/onset;80ms onset tolerance, one-to-one matching; report offsets separately. Proposed excerpt gate: precision≥0.95 and recall≥0.90 for the selected theme, no critical phrase error. Thresholds are engineering requirements, not a promise of perceived quality; do not relax after failures.

**Exit:** at least3 independently supported melody targets or an explicit direct-audio no-promotion decision; source-assisted controls always continue. Automated reference confidence is not musician approval.

## 7. Task 3 — Identify which upstream route earns use

**Files:** `services/transcribe/src/stem-pipeline.ts`, `piano-transcriber.ts`, Python audio scripts; `packages/catalog/src/dense-metal-amt-evaluation.ts`; tests `stem-pipeline.test.ts`, `piano-transcriber.test.ts`.

- [ ] Replay baseline raw vocal/guitar/bass/residual predictions on the fixed windows. Save role-isolated piano previews and raw confidence/activation output where Basic Pitch supports it; do not infer confidence from velocity alone.
- [ ] Compare existing librosa pitch tracking on genuinely monophonic vocal/bass lanes, retaining voiced confidence and native seconds. Quantize only after event segmentation. Reject intervals with competing/polyphonic evidence rather than inventing a melody.
- [ ] Check one second challenger against official code and weight licenses before installing. MuScriptor noncommercial weights are ineligible for production. YourMT3+ or a piano-specific model is an option only if commercial eligibility and local inference are established within budget; otherwise skip it without blocking work.
- [ ] Evaluate raw notes and reference-fed arrangement separately. Select per-role/route only on supported improvements; no title-specific thresholds, no training, no fine-tuning, no full-mix union of model notes.
- [ ] Preserve a winner configuration and hashes; if no raw-audio candidate clears the excerpt gate, disable its automatic beta publication and proceed with source-assisted routes. Keep the failed evidence and score breakdown.

Run existing service tests/typecheck after any adapter change. Add a parser/timing failure regression for each actual new adapter. No generic backend framework.
**Exit:** a justified eligible audio route, or a precise decision that audio remains experimental. Either result advances Task4.

## 8. Task 4 — Protect melody before hand assignment

**Files:** `packages/midi/src/metal-arrange.ts`, `simplify.ts`, corresponding existing tests; trace/IR already exists and must be reused.

- [ ] Turn the invented clean/contaminated riff into a failing identity regression. Pair it with the opposite case: a genuine high melody above repetitive low rhythm. Verify the current failure before editing.
- [ ] Trace all callers and all downstream identity mutation stages. Move low-riff eligibility decisions after coherent phrase evaluation; use existing path/contour support. Retain original pitch/timing/source provenance until the final hand assignment.
- [ ] Choose one supported identity phrase; transpose whole phrases by octaves for range if needed. Do not combine incompatible upper/lower contours or fill gaps with unsupported high notes. Remove a superseded filter if its behavior is replaced instead of stacking another heuristic.
- [ ] Ensure the theme survives across hands; do not require all identity in RH. A hand change cannot change pitch class or silently delete an essential attack. Easier levels may simplify ornament/rhythm only against explicit retained-theme lineage.
- [ ] Add restrained bass/root/fifth accompaniment after identity selection. Keep uncertain chord thirds absent. Reproduce Silent Lucidity's overlap in a minimal fixture and fix the shared emission/serialization boundary that causes it.
- [ ] Replay all12 cached development stems and all5 public levels after each meaningful change; compare worst cases and traces. Run known prior preservation tests. Retain a candidate only with no new critical regression.

Minimum regression intent (implemented using existing helpers):
```ts
expect(matchedThemeAttacks(cleanResult, expected)).toBe(expected.length);
expect(matchedThemeAttacks(contaminatedResult, expected)).toBe(expected.length);
expect(unmatchedIdentityAttacks(contaminatedResult, expected)).toBe(0);
// Also check the real high-lead/low-rhythm case; a low-register preference is not a fix.
```
Implement these two small test-local counters with the existing80ms/one-to-one matcher where applicable; never export new production scoring helpers for the test.

Run:
```sh
npm test -w @keyspilli/midi
npm test -w @keyspilli/catalog -- test/evaluate-metal.test.ts test/arrangement-evaluation.test.ts
npm run typecheck -w @keyspilli/midi -w @keyspilli/catalog -w @keyspilli/transcribe
```
**Exit:** reference-fed themes protected; noisy real audio still judged by Task3, never assumed fixed by synthetic success.

## 9. Task 5 — Make source assistance automatic and honest

**Files:** `apps/web/src/lib/source-candidate-provider.ts`; `packages/catalog/src/generic-source-ranking.ts`, `source-candidate-handoff.ts`, `external-symbolic-pipeline.ts`, `youtube-source.ts`; `services/transcribe/src/external-symbolic-route.ts`, `worker.ts`; existing route/intake tests.

- [ ] Reuse the existing search provider and ranking. If worker access requires moving provider logic into catalog, move it once and leave the web wrapper; do not import web runtime into the worker or duplicate the provider.
- [ ] Resolve composition identity from artist/title plus corroborating source metadata. Search ranking is never validation. Acquire eligible native files under size/time limits and shared URL/redirect protections; reject private-network targets, unexpected file types, malformed archives and ambiguous versions.
- [ ] Native source first: parse with existing MIDI/MusicXML intake, identify melody/accompaniment, preserve source tempo/form and use `freezeGenerationCandidateSet`→`buildExternalSymbolicArrangement`→existing route output. Reject benchmark-reference inputs. A generation source found independently may overlap a composition in evaluation, but it must not be injected from the hidden answer-key path.
- [ ] Piano tutorial second: inspect prior private Livgardet/ABBA scripts, which hardcode video geometry. Support at most2 demonstrably recurring layouts. Infer key positions from keyboard geometry/labels and validate multiple octaves; require stable geometry, two-scanline time-of-flight corroboration and audio onset agreement. No song-title coordinates. Scene change, unresolved pitch calibration or audio/video disagreement means unsupported/review.
- [ ] Add a small `services/transcribe/src/piano-roll.ts` orchestration boundary and `extract_piano_roll.py` only if the existing scripts can be generalized within this support boundary. Add a synthetic moving-note video test covering adjacent black keys, repeated notes, glow/noise, codec holes, timing delay and geometry changes. Do not attempt arbitrary sheet-video recognition or generic OMR from scratch.
- [ ] Piano audio third: use the eligible Task3 piano route. If no audio route is qualified, skip it. Do not force dense-metal settings onto piano recordings.
- [ ] Record requested URL, actual source URL/hash, arrangement title, source kind, timing owner and whether vocal melody is present. If only accompaniment is supplied, label it accompaniment rather than inventing a missing vocal line.
- [ ] If all candidates fail, return a useful review/error result with the failed stage and supported recovery choices. Do not require the AFK user to upload a file to complete the rest of the task.

**Exit:** actual automatic worker path for eligible supported sources. A native-only beta must include automatic resolution from the requested song identity; if only pre-existing manual upload works, this task remains a no-release candidate. Evidence includes acquisition→parse→arrangement, not merely adapter unit tests.

## 10. Task 6 — Job safety, retry and beta UI

**Files:** `services/transcribe/src/worker.ts`; `packages/catalog/src/db.ts`, `db-types.ts`; `apps/web/src/app/api/youtube/jobs/route.ts`, `[id]/route.ts`, `[id]/retry/route.ts`; `apps/web/src/lib/job-error.ts`; existing conversion/player consumers found by `rg`.

- [ ] Trace every `JobRow.status` reader before changing status. Keep queued/processing/done/error if adequate; add a single explicit review outcome only if it cannot be represented honestly with current conventions. Do not label review as done-with-a-good-song.
- [ ] Replace silent legacy full-mix publication on failed stem routing with recorded fallback selection only when the fallback independently passes its route gate. Otherwise retain diagnostic/review failure.
- [ ] Fix15-minute stale-job reclamation with an owned renewable lease/heartbeat using existing DB migration patterns. Add fake-clock integration proving a healthy20-minute job is not reclaimed, a crashed expired job is reclaimed, and a stale worker cannot finalize after losing ownership.
- [ ] Stage artifacts before publication, validate, then atomically publish/update metadata. Retry/cancellation must not replace existing good artifacts. Test duplicate submissions, same-source idempotency, source-version differences, restart and partial-write recovery.
- [ ] Add beta/source/arrangement labels to the smallest existing UI surfaces that explain the result. Preserve the requested-versus-selected source distinction and clear next steps after failure. No broad UI redesign.
- [ ] Verify Piano/Voice volume, LH/RH playback and organ/Cathedral configuration through the actual player path; notes visible must receive audible events. Test event scheduling/gain independently of transcription quality.

Required failure matrix: source404; timeout; separator failure; unsupported tutorial layout; wrong-song candidate; corrupt MIDI; invalid duration; no melody; unavailable backend; low disk; lease expiration; duplicate job; cancellation; retry after prior good result. Each outcome names whether retry is useful and preserves prior output.
**Exit:** honest outcomes and no stale/duplicate destructive publication.

## 11. Task 7 — Full verification and evidence freeze

**Files:** existing evaluator/listening/export tools and CI; create `metal-beta-acceptance-2026-09-07.json` and a concise report.

- [ ] Reuse existing development originals; obtain alternate sources only where useful. Run full-song generation for qualifying routes, at least6 beta cases and at least2 cases per enabled non-native route. One case per route must be unused for tuning; use a new development-validation recording rather than silently consuming the20 release holdouts.
- [ ] Validate all5 public levels, complete arrangement duration, openings/endings, repeats and transitions. Exact timing is relative to the chosen source arrangement; do not penalize an explicitly chosen cover for differing from the metal recording.
- [ ] Round-trip MIDI and MusicXML; compare sounding pitch/onset/duration/hand events to player data within serialization tolerance. Exercise exported files from the actual API, not only writer unit tests.
- [ ] Run package tests/typechecks and the same CI commands in an isolated test catalog. Never run a catalog rebuilding command against live data merely to satisfy CI.
- [ ] Build a local full-song listening page with source, old/new melody-only and final piano. Normalize playback gain consistently, preserve entered feedback, include concise defect timestamps. Do not ask Reidar to review known rejected candidates again.
- [ ] Freeze code/model/config/source hashes and enabled route scope. Store per-song pass/failure and denominators; no missing results dropped from aggregates.
- [ ] If a route fails, remove that route from beta eligibility and rerun affected integration checks. Do not alter score thresholds to rescue it. If all routes fail, complete the branch/review artifact and issue a precise no-release report.
- [ ] Do not run the20+6 musical-certification holdouts merely to fill AFK time. Run them only when source references/scoring are ready and the candidate is frozen; otherwise retain them for human acceptance after return.

Run exact existing CI checks from `.github/workflows/ci.yml`, including web build and Playwright on isolated data. Capture exit codes and names, not just a test-count claim.
**Exit:** immutable beta acceptance decision, explicit enabled routes, complete review bundle.

## 12. Task 8 — PR, merge, canary and release

**Files:** `.github/workflows/ci.yml` and existing deployment scripts discovered from that workflow; do not create a parallel deploy system.

- [ ] Review the final diff against the agreed scope, remove scratch/generated media from git, preserve original WIP, and commit coherent patches. Ensure source/model terms and provenance are recorded.
- [ ] Create a PR with concrete before/after behavior, supported beta scope, tests, failures and non-claims. No musical success claim beyond the evidence. Wait for exact-head CI; fix failures and rerun appropriate checks.
- [ ] Inspect whether merge triggers production deployment. If so, stage/guard the new route as beta-disabled until canary verification, or run canary before merging; do not accidentally deploy ahead of the gate through the existing push-to-main workflow.
- [ ] Back up live SQLite consistently (`.backup` or existing application backup), record current image digests and catalog/artifact inventory, and confirm a rollback command before deployment. SSH always uses `-o IdentitiesOnly=yes` with the selected key.
- [ ] Use an isolated canary job/catalog path or existing restricted beta path for one real new import per enabled route. Exercise real API/queue/worker/player/export and a bounded restart/retry check. Do not restart unrelated services or reprocess approved songs.
- [ ] If canary passes, merge/deploy immutable images through the existing workflow and enable labelled beta for new imports only. Verify the public behavior and unchanged prior-song hashes/counts. A health200 alone is insufficient.
- [ ] If canary/public verification fails, disable beta/roll back to recorded image/config, verify restoration and retain the failed diagnostics. Do not loop on blind deploys.
- [ ] Log exact commits, CI/deploy runs, live checks, enabled scope, unresolved listening and next actions in Obsidian project and daily notes.

**Exit:** verified labelled beta or safely rolled-back/no-release candidate, with no ambiguity about which occurred.

## 13. Failure branches and AFK behavior

| Condition | Autonomous action | What must not happen |
|---|---|---|
| Reference unavailable | Try next development target within budget; withhold direct-audio promotion and continue source-assisted work | Invent reference truth or stop all engineering |
| Model license/runtime unavailable | Skip challenger; use eligible existing tools | Request paid unlock, accept incompatible terms, or add speculative infrastructure |
| Direct audio still poor | Keep it review/experimental; complete proven native/piano beta | Publish noisy output as ready or keep tuning indefinitely |
| Tutorial calibration uncertain | Reject layout; try next eligible candidate | Hardcode coordinates by song or guess note mapping |
| Search provider unavailable | Use eligible local/indexed sources and expose limited scope | Pretend automatic web discovery works |
| No route meets beta gate | Complete tested branch/report/review bundle, do not deploy | Call the original musical goal achieved |
| Disk below30GiB | Stop heavy jobs; remove only owned regenerable inactive scratch; continue light work | Delete user caches/volumes/WIP without authorization |
| No human listening while AFK | Use authorized beta gate; mark musical acceptance pending | Claim musician approval or18/20 musical success |
| CI/deployment failure | Diagnose, bounded fix/retest, or rollback | End with broken production or an unexplained partial deploy |

Do not ask routine questions after execution approval. Use this decision table. Ask only for a truly new required permission/scope decision; continue independent work. Persist state and checkpoints across context compaction in the plan/evidence files. No scheduled automation or extra user-owned task is needed.

## 14. Final deliverable checklist

- [ ] Code and runnable bounded evaluation command committed; exact branch/PR/release status.
- [ ] At least one honestly supported route or a specific evidence-backed no-release result.
- [ ] Per-source/per-song objective scorecard, failures, coverage and limitations.
- [ ] One compact review page of best candidates, including melody-only comparisons and final5 levels.
- [ ] Commercially eligible production dependencies/weights; source provenance retained.
- [ ] Existing songs unchanged; retries/restarts/duplicate processing and exports verified.
- [ ] Live canary/public beta proof and rollback evidence if deployed.
- [ ]20 supported +6 challenge holdout status explicit; no false human acceptance.
- [ ] Obsidian project/daily log and final user summary stating what works, what does not, and exactly what requires listening.

## 15. Plan review

This plan permits one uninterrupted execution attempt through research, implementation, integration and release. It does not promise an unsolved transcription problem will necessarily pass. Failure has a productive endpoint: a supported source-assisted beta when proven, otherwise a complete tested candidate and a precise failed gate. Scope decisions and spending/deployment authority are settled above; execution begins only after Reidar approves this document.

## 16. Research sources and constraints already checked

- Spotify Basic Pitch: https://github.com/spotify/basic-pitch — instrument-agnostic polyphonic transcription, best on one instrument at a time; Apache2.0 code. Recheck distribution/weight notices when packaging.
- MuScriptor: https://github.com/muscriptor/muscriptor — current model weights require CC BY-NC4.0 acceptance, so excluded from production under Reidar's commercial-use requirement.
- YourMT3+: https://github.com/mimbres/YourMT3 and https://arxiv.org/abs/2407.04822 — an instrument/vocal-aware research candidate, not a selected dependency; commercial weight eligibility and packaging must be established before a trial.
- Breaking the Law reference: https://judaspriest.com/tabs/images/breakingthelaw_1.jpg — independent development reference only; retain provenance and keep the score private.
- Existing successful video extractors are private `output/livgardet-review/extract-visual.py` and `output/abba-review/extract.py` in the original workspace. Their hardcoded coordinates are evidence of the generalization work required, not a production capability.
