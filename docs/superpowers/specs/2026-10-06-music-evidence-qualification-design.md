# Music evidence qualification and promotion design

Status: proposed next phase; planning only. Date: 2026-10-06.

## Intended outcome

Help determine what Keyspilli actually plays, compare it with an authoritative source and an intended learner arrangement, and produce useful, reviewable fixes. Use Gemini through Antigravity for bounded interpretation of supplied evidence for anyone connecting an eligible Google account. Scientific failure must remain visible through GitHub publication and production decisions.

The user's ownership boundary is explicit: reusable Gemini/Antigravity transport and interpretation belong in Anti; capture, DSP, transcription models, arrangement/source rules, repairs and listening packs belong in Keyspilli. Assumption for this proposed phase: native parent execution, no subagents, optional features remain opt-in. The request authorizes producing this design and its complete implementation plan; it does not itself authorize executing the new studies or deployment.

## Verified starting point

Keyspilli candidate `172248cb8d07706f05611cadb24e717d6958e392` and Anti candidate `1ac54cc15cb80c3d13ce80f2815052d2c26025b6` are published experimental prereleases:

- https://github.com/Reedtrullz/Keyspilli/releases/tag/music-evidence-candidate-20261006
- https://github.com/Reedtrullz/codex-antigravity-auth/releases/tag/music-evidence-2.4.3-candidate-20261006

These artifacts are immutable baselines. The previous complete software CI and downloaded artifact checks are evidence for those revisions, not for future changes. Draft PR219 includes Keyspilli216/218 ancestry; Anti170 includes169. Integrate each tree once.

Private evidence root: `output/music-review/completion-20261006-115005/`. Its REVIEW.md, CI_EVIDENCE.json, RELEASE.json, EVIDENCE_INDEX.json, OWNER_DECISIONS.md and PRODUCTION_BASELINE.json are the starting receipts. Do not run its packet builder again or change its studies.

The closed seed610674 study failed: core32/32, quiet6/16, repeat11/12, refusal12/12, three accepted wrong pitch sets, p95 26.873s and peakRSS1,458,651,136bytes. In quiet cases07/08/13 the extra lower octave survived a residual below5%. The legacy94/96 exact replay is regression evidence only. Known-renderer first1.2second input history is distinct from current keys, full note events, quiet completeness, audible-output perception, microphone transcription and provider hearing.

Ten real source pins and twenty Original/Chords phrase recordings exist in `real-piece-review-v3/`. Two Chords clips are silent. Source authority/roles/timing and held-out status remain unvalidated; rights provenance does not establish them. All120 controls abstained because authority was unknown. That proves refusal, not successful defect detection. MIDI/XML roundtrips are structural diagnostics; the advanced arrangements are not approved learner lessons.

The local review page is http://127.0.0.1:3242/index.html. Historical r09/r29/r33 and Candidate preference do not approve its new recordings. No fresh provider study or independent hearing passed. Exact live account binding is not implemented. Current production was healthy on the retained main image pair with2,730songs and directAudioAmt=false at the prior baseline readback; refresh it before relying on it for deployment.

## Alternatives and decision

| Approach | Benefit | Limit / decision |
|---|---|---|
| Audio-only ambiguity checks on the maintained renderer fit, then new blinded qualification | Directly addresses the observed false lower octave; reuses bounded native-rate captures | Recommended first. May abstain more and still fail quiet coverage; success is not promised |
| Increase Pro quota / prompt size | Could improve assisted interpretation of valid supplied measurements | Does not fix incorrect local measurements or prove hearing. Keep optional compact study separate |
| Replace the fitter with a general transcription model | Could cover source recordings beyond the renderer | Code/checkpoint terms, safe loading, native parity and resource admission unresolved. One bounded feasibility lane only, not the critical path |

## Keyspilli method boundary

Keep the existing full-range88-key bank and audio-only request. Do not give expected notes, score pitches, target sampler starts or source answers to the fitter. Preserve5% maximum raw residual, -50dBFS level floor,0.05 weak coefficient floor,8events,128ms minimum history,1.2second interval,16atom batches and1GiB immutable FFT cache. An octave combination is not automatically a defect: test genuine two-octave mixtures and admit uncertainty when evidence cannot distinguish them.

Add a separate audio-only support diagnostic. For each selected component compute normalized residual degradation when it is removed and refitted; also compare pitch-distinct alternatives replacing that component by available pitches at ±12/±24 semitones, refitting coefficients against the same PCM. Zero-coefficient/invalid counterfactuals remain explicit. A small residual margin or negligible removal support withholds the accepted set. These are uncalibrated diagnostics, not probabilities, physical velocity or note-off estimates.

Develop and lock numerical support margins before creating the new qualification set. Use a finite development sweep of removal/alternative margins {0.001,0.002,0.005,0.01} in normalized residual units; choose the pair with zero accepted wrong sets and highest exact development coverage, then lower measured latency, then lexicographic order. If no pair satisfies precision, stop the lane as failed. The finite sweep is a proposed development protocol, not evidence of an optimal threshold. Preserve old failures as named development regressions; never rescore them as qualification.

Support calculation and policy must enter analyzer identity, dictionary/method identity where relevant, and the freeze's complete file inventory. Old receipts remain visibly legacy/unqualified and cannot be imported as new-method support. Add a bounded serial runner recording child process end-to-end time/RSS, including validation/loading and support work; report warm-cache internals separately. Timeout120seconds, no retries, no output replacement. Ensure the scorer counts a missing result as incomplete, an accepted wrong refusal case as wrong, and validates memory explicitly rather than relying only on receipt parsing.

New controlled screen:72cases,32core/16quiet/12repeat/12refusal, new seed and disjoint event schedules from the closed study. The current generator changes only core pitch order with its seed; quiet/repeat schedules are fixed. Implement seeded sampling in those groups before calling the next screen fresh, retaining the declared quiet/weak/repeat domain and all six refusal classes. Preserve admission thresholds: core>=30/32, quiet>=14/16, repeat>=10/12, refusal12/12, zero accepted wrong sets, end-to-end p95<=20seconds, peakRSS<=2GiB. A passed screen still has productionAdmission=false until the separate release gates. Additional genuine-octave and wrong-domain development controls remain separately reported. One frozen evaluation per method; changed methods require another independently identified study, never relabeling the failed run.

## Source and repair boundary

Use existing compareMusicalIntent/previewMusicRepair interfaces. Self-authored positive controls can exercise trusted roles, phrase occurrence, explicit timing and approved transformations autonomously. Publisher assets remain authority unknown until reviewed anchors exist. Require timingKnown===true for trusted comparisons; absent timing cannot silently become known. Bind human authority receipts to source bytes, selected occurrence/roles/timing, arrangement mode, validation scope and reviewer assertion; a checksum alone is not validation.

Trace each silent Chords clip through source, intended harmony, Advanced events, API hydrated chordData, planned chord events, visible Player scheduling, input PCM and output PCM. Fix a software fault with a reproducer; make authored edits only when an authoritative source and mode intent support them. Keep a legitimate rest or unknown passage explicit. Every preview stays isolated, at most8edits in one phrase, neighbors preserved, and requires fresh captures and listening before catalog publication. Backing-only Chords permits melody omission but must retain useful accompaniment. Provide appropriate difficulty variants before requesting beginner acceptance; ten advanced score exports cannot satisfy the ladder or keyboard gate.

## Anti boundary

Add opt-in request-scoped exact account binding for eligible native Gemini requests. Resolve a private opaque account reference stable within one gateway instance plus redacted inventory digest; reject gateway restart, stale inventory, ambiguous/missing reference, ineligible account, insufficient token lifetime or an observed active lease before generation. Existing process_logs.account_ref is salted per process, so a helper-generated reference or account-2 inventory index is not a stable dispatch identity. Read references from the serving gateway. Bound mode does not refresh credentials, mutate preferred account, rotate, retry, fall back or dispatch BYOK. Ordinary unbound behavior remains covered by regression tests. Lease acquisition/release and cancellation must remain correct.

Expose binding in helper dry-run and private dispatch receipt. Binding is never sent to Google or placed in public artifacts; tokens/emails are never printed. Skip background refresh scheduling for bound requests. Existing credential store/diagnostic representation should supply the reference; do not invent a persistent second credential database. Local lease observations do not prove account-wide or cross-host concurrency.

Compact review remains one clip/claim,2048tokens default/4096maximum,90seconds,oneattempt. Repin portable helper/schema/configuration after implementation. Twelve proposed serial jobs are an upper bound, not a requirement to consume quota; malformed and stale inputs refuse locally. Stop the affected live study on auth/capability/429/5xx/timeout/schema failure. Freeze an interpretation rubric before upload, checking supplied-evidence consistency, abstention and unsupported certainty separately. Failure does not revive m04/m05 or make a provider fallback necessary for Keyspilli.

## Release and runtime boundary

Produce new unique non-v* experimental tags and byte-verified assets; never replace the existing prereleases. Full current-head CI, installed package tests, deterministic plugin packaging and native amd64 smoke must pass. PR success on a synthetic merge revision is distinct from actual final integration revision. Refresh main ancestry, exact check names, latest check IDs and unused package versions at execution time.

All four ADR0004 gates are distinct: source, structural, musical and runtime. Prepare a candidate runtime receipt in an isolated restore/canary before promotion; it is evidence of rehearsal, never of production deployment. A release guard may consume that explicitly scoped prepromotion runtime acceptance. After deployment, collect a separate production runtime receipt. Automated tests never create listening or keyboard attestations.

Main publication/deployment runs require an exact-commit detached manifest and the latest successful Automatic checks ID. Separate validation from promotion with a new boolean workflow_dispatch input promote_reviewed, default false. Main pushes and ordinary dispatches run Automatic checks but publish/deploy nothing. An explicitly approved promote_reviewed=true, operation=deploy_only dispatch skips rerunning Automatic checks and validates the latest completed exact-main check through the existing guard. Name that invocation's skipped prerequisite Promotion prerequisites; emitting a newer skipped Automatic checks would invalidate the pin. Conditional needs handling must permit that specific skipped prerequisite only after readiness succeeds. A failed, cancelled, missing, newer-pending or stale check still blocks; an unchecked commit cannot be promoted. This removes the check-ID timing cycle without relaxing the validator or adding repeated manual CI approvals.

Build/publish the immutable web+worker pair only after readiness. Refresh backup service success, manifest/archive/DB hashes, isolated candidate restore, rollback image availability, target ports and volume identity immediately before cutover. Deploy via the existing GitHub Ansible workflow with deploy_only; preserve live catalog, queues and owner state. Verify digest pair, full appVERSION, health/auth boundary, song inventory, owner-state samples, exports, worker and browser behavior immediately and after10minutes of actual elapsed time. Claim24hour stability only after a real later observation; create no monitor unless asked.

Automatic rollback is limited to the authorized prior image pair with the same data volume; trigger on failed version/health/auth/inventory/state/export/worker checks. Verify rollback live. Restoring data from backup is a separate reviewed action, not a routine image rollback. A failed acceptance gate permits an honest experimental GitHub delivery and leaves production unchanged. Stable Anti/PyPI and installed plugin/gateway adoption are separate final choices, not consequences of creating a GitHub prerelease.

## Final review and success states

Autonomous implementation prepares local diagnostic results, exact artifacts/CI, source-review forms, fresh preview audio and offline provider jobs. At the end present one concrete packet for owner listening, independent keyboard/source review, optional upload/account choice, installation target and exact merge/stable/deploy choices. If an ear/source result is missing, leave the gate pending. Do not contact reviewers without explicit authorization.

Completion states are explicit: (1) software-ready candidate; (2) failed/pending study with experimental release only; (3) all acceptance gates passed and approved production deployment verified. No plan can guarantee a research result. Preserve failures and provide actionable diagnostics if the method cannot meet its fixed gates.
