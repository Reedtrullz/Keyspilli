# Original-link piano pipeline hardening

Approved execution: 8 September2026. Branch codex/metal-delivery; baseline e7f35a8. Preserve existing catalogue and accepted source note events. Free/local resources only. Commercially usable production dependencies; source permissions remain separately required. Merge/deploy authorized only after release gates; development preview remains gated meanwhile.

## Gates frozen before evaluation

- Corpus30 original recording links:20development,10held-out. No held-out extraction/tuning before release candidate freeze. Results distinguish structurally completed candidate, correctly declined, incorrect, and listening acceptance. Declines do not count as success.
- At least8/10 held-out links complete automatically. Zero wrong-song/known incomplete publications. All4 exports validated for every completed import.
- Accepted extraction note events unchanged unless separately documented correction; geometry corruption/unsupported colours/ambiguous octave rejected.
- Musical usability requires listening acceptance of unfamiliar outputs; objective artifact consistency alone cannot pass that gate.
- Native note timings preserved to <=1ms when tempo encoding changes. Confidence and unknown rhythm explicit; no invented verified120BPM.
- Operational checks: duplicates, interruption, cancellation, low disk, missing sources, extraction failure; no partial publication or existing-song replacement.
- Clean environment import/export smoke, package/license review, catalogue preservation, rollback required before production.

## Execution ledger

1. Baseline/corpus/evaluator — frozen 30 inputs; repeatable HTTP receipts and four MIDI exports; development recovery ongoing, held-out untouched.
2. Whole-video extraction — layout/audio/colour/octave checks plus bounded terminal-card exclusion implemented; 26 Python regressions pass. Broader live coverage remains open.
3. Discovery — title identity, excerpt rejection and six bounded alternatives implemented; remaining development failures being retried.
4. Beat/tempo timing — source tempo normalization and native-time tests implemented; pulse evidence and provisional UI explicit. Reference-verified musical measures remain open.
5. Difficulty — worst-passage diagnostics and comparison clips prepared. Hand-lane inference remains opt-in because some passages regress; no global replacement approved.
6. Operations — transactional deduplication, bounded snapshot reuse, cancellation, refresh recovery, progress and disk guards implemented. UI cancellation and completed-job recovery checked locally.
7. Packaging/release — pinned runtime and manual Linux smoke definition prepared. Clean Linux execution, source rights, held-out and musical acceptance remain open; no merge/deploy.

Ruling: local disk guard30GiB retained. Serial media extraction avoids multiplying scratch use. Synthetic tests and read-only inspection may run alongside independent code tasks. Held-out inputs are not substitutes for a listening gate.

## Checkpoint — 8 September 2026, 01:46

- Frozen 30-link manifest and real HTTP evaluator implemented. Development v2: 13 links attempted, four structural candidates with all 16 exports validated, nine terminal failures; disk guard stopped before link14. Held-out remains unexecuted. No release pass.
- Failures expose unsupported keyboard geometry/colours and two empty discovery results. Do not weaken extraction gates to improve the score.
- Whole-video layout sampling and independent audio-gap checks implemented. Queen and For I Am Death reference note events preserved in local checks.
- Progress, cancellation/lease checks and safe diagnostics implemented. Validated local snapshot reuse wired into resolver; all difficulties rebuilt. Cross-process enqueue race remains open.
- Timing estimator remains evidence-only; metrical tempo unknown and UI marks provisional beat positions. End-to-end variable-tempo preservation remains open.
- Worst-passage audit diagnosed loss of colour-lane hand identity in Metallica. Reviewed lane candidate improves one jump but is not a generic validated hand inference implementation.
- Pinned tutorial runtime and CI smoke definition prepared; clean Linux build not executed. No merge/deploy.
- Latest focused validation: 22 Vitest tests passed; transcribe typecheck passed. Earlier Node test-runner invocation was invalid and superseded by the Vitest run.
- Evaluation receipt: output/tutorial-recovery/development-evaluation-v2/receipt.json. Running evaluator predates returned-song identity check: audit these outputs separately before any identity claim.
- Local free space fell to29.989GiB. Stop further media/build loops under the30GiB rule. Next: obtain cleanup scope, fix development failures, integrate timing/hand handling, rerun development, freeze candidate, then held-out/listening/release checks.

## Source-only continuation — 8 September 2026, 01:56

- Owner resumed work after disk cleanup;36GiB available. Servers, worker, media extraction, Docker and installs remain stopped.
- Fixed partial cache-copy rollback: a failed second exclusive write removes the MIDI created by that attempt while retaining pre-existing JSON. Regression reproduced before fix; now passes.
- Added SQLite IMMEDIATE transaction for new-import enqueue deduplication across processes. Existing-song update jobs remain separate; terminal jobs allow retry. Preview fast-path also excludes existing-song jobs.
- Saved receipts show Linkin Park identities reversed: Numb/In The End were treated as artists. Parser now resolves reversed titles using explicit artist metadata or an exact title-segment match to channel/uploader. Unrelated channel names remain ignored. Fixture tests pass; live retry not performed.
- Validation:116 tests across18 files pass; web/catalog/transcribe typechecks pass. These checks do not establish successful extraction or musical quality of the failing development songs.
- Release remains blocked on development failures, timing/hand integration, held-out/listening acceptance and clean runtime verification. Changes remain uncommitted; no deployment.

## Resume blocker — dependency environments removed

Owner authorized continuation after the stop. Data volume now reports52GiB free. Worktree node_modules, apps/web/node_modules and output/tutorial-recovery/venv are absent; tsx, vitest and next cannot start. Source edits, lockfiles, evaluation receipts and candidate evidence remain. No dependencies restored under the standing no-large-install instruction.

Required restoration is concrete: npm ci from package-lock.json in this isolated worktree, recreate the Python3.12 tutorial venv and install services/transcribe/requirements-tutorial.txt with --require-hashes. No Docker build or push is needed for this restoration. Check free space before and after; retain30GiB minimum and31GiB download preflight.

Latest interrupted development-v4 receipt has four structural candidates, nine failures and source14 pending. Do not count the interrupted row as a completed result. DB retains the processing row; worker lease recovery must reconcile it on authorized restart. Held-out remains unexecuted.

Additional implemented work since prior checkpoint: partial boundary key clipping; bounded image-endpoint detector tolerance; fractional24000/1001fps; missing/silent audio completeness rejection; fullphrase and explicit-excerpt filters; six bounded source alternatives with18-minute operation deadline; source tempo-map normalization; opt-in neutral-lane hand inference; cancellation/refresh recovery; wrong-publication veto in release scoring. Numb1733 and EnterSandman1501 local candidate extractions succeeded, not proof of automatic original-link success. Eight short difficulty comparison clips are preserved; automatic hand inference remains off due regressions in other passages.


## Authorized restoration and development recovery

User consent authorized the exact Node/Python restoration. npm ci and the hash-pinned Python3.12 environment completed; uv pip check passes. Workspace suite passed1837 tests and all workspace typechecks. Subsequent extraction changes pass26 Python tests; metadata regression passes8 identity tests. Data volume has53GiB available. Docker remains unused.

Development-resume-v5 produced6/9 structural candidates. Source19 generated the correct title plus `(Remastered)`, triggering the strict metadata identity veto; track edition normalization is now fixed without relaxing the evaluator or changing the frozen manifest. Original receipt remains unchanged. Sources10 and20 failed extraction. Development-recovery-v6 retries10,19,05,06,07,11,12,13,14,20 through HTTP. Results pending.

In The End local replay preserves511 notes and excludes only a bounded terminal card interval after measured quiet and whole-frame keyboard-structure absence. Relocated-keyboard regression and independent source review completed; this remains conservative image evidence, not universal semantic proof. No held-out evaluation or production publication has occurred.


## Candidate freeze and held-out execution

Final development recovery: v6 completes4/10 previously failing inputs; final identity v7 recovers For Whom The Bell Tolls after preserving original recording search terms while canonicalizing displayed metadata. Across latest per-input development receipts,15/20 have structural candidates; this is a mixed-development-version coverage observation, not a frozen benchmark score. All original receipts retained.

Validation:1839 workspace tests,4 evaluator tests,27 Python tests and all workspace typechecks pass. All24 accepted difficulty note files unchanged in regeneration check. Narrow red support uses observed RGB bounds; unknown colors and audio completeness still reject. Cache version includes pinned Python requirements. Independent focused review found no concrete remaining regressions.

Candidate frozen in output/tutorial-recovery/candidate-freeze-v1.json after final worker restart. All10 held-out inputs now executing via HTTP into output/tutorial-recovery/heldout-candidate-v1. No candidate source edits or held-out tuning permitted during this evaluation. Production gates remain open; no Docker/merge/deploy.


## Frozen candidate result — not releasable

All10 held-out original links completed evaluation:4 structural candidates,6 terminal failures,0 invalid publications. Candidate hashes verified before and after the run. The8/10 gate failed. Musical acceptance remains pending, so successful exports are not counted as listening approval. Immutable receipt and candidate fingerprint copied into docs/research/keyspilli-evidence/tutorial-heldout-v1-2026-09-08.json and tutorial-candidate-freeze-v1-2026-09-08.json. Do not alter these receipts or tune against their sources. Further development must remain separate and cannot claim a fresh held-out score from this used cohort. No release.


## Development repairs and fresh prospective freeze — 8 September 2026

All20 original development links now have four-level structural candidates across repair runs, not a single frozen20/20 score. Fixed stationary keyboard edge-width noise, RGB-channel geometry fallback, bounded dim-red activation with neutral-state evidence, slashless AC/DC identity and explicit-tutorial ranking. Review caught warm-ivory false activation; bounded red intensity and regression now preserve blue events. Existing octave, unknown-colour and audio-gap vetoes remain.

Validation:1841 workspace tests,32 Python checks,5 evaluator checks and workspace typechecks pass. Regeneration preserves24 accepted difficulty note files. Fresh prospective10 selected deterministically from a declared20-song pool excluding prior30 identities, with no replacements after execution. Metadata-only original-link selection and manifest sealed under output/tutorial-recovery/prospective-v2; candidate freeze verified before HTTP run. Evaluation active, no new result claimed. Original4/10 held-out receipt remains immutable. No Docker, merge or deploy.


## Verified pipeline checkpoint — 8 September 2026

Frozen prospective v2:9/10 fresh original-link imports,36 exports,0 identity-check failures, source hashes unchanged. All9 successes freshly downloaded source media. Original v1 4/10 remains immutable. Prospective36 levels pass existing structural checks; wide fast Beginner/Easy movements remain review findings. Full36 piano renders and timestamped passage shortcuts are available at http://127.0.0.1:8874/tutorial-recovery/prospective-v2/http/review.html (66MiB local output).

Full frozen development v2 was19/20. The repeat failure came from a validated source dropping below six discovery candidates after ranking changed. Fixed shared snapshot validation to support a no-copy ranking check; fully validated snapshots now rank ahead of fresh alternatives, after an explicitly requested source. Full hash/freshness/version/identity/confinement checks remain and selected assets are checked again before copying. Targeted12 retry succeeds first attempt with1977 cached notes and4 exports. Independent review found no concrete blockers.

Final frozen development v3:20/20,80 exports,0 failures/identity-check failures, hashes unchanged. All20 reused validated snapshots: repeatability proof, not20 fresh extractions. Candidate code84d5ff3. Final workspace1843 tests and transcribe typecheck pass;32 Python checks and5 evaluator checks passed earlier without subsequent Python/evaluator changes.24 accepted note files preserved. Immutable v2/v3 receipts and candidate hashes committed under docs/research/keyspilli-evidence. Fresh9/10 result belongs to v2, before the subsequent cache-priority-only fix; do not present it as a fresh v3 benchmark.

Remaining: one prospective extraction rejection, practical difficulty/listening acceptance, source-rights resolution, clean Linux runtime and deployment gates. No Docker, merge or deploy. Standing no-Docker restriction retained. Existing catalogue unchanged.


## Linux runtime and complete HTTP smoke — 8 September 2026

Owner explicitly authorized local Docker smoke execution, superseding the earlier no-Docker restriction for this scope. No production image push, merge or deployment. CLI image passes34 Python checks and full development-video extraction;1140 notes and raw MIDI bytes match the saved macOS reference exactly. Early chroma-aligned scanline cropping preserves full scanline bytes across all20 development videos. Reference-aware RGB fallback resolves a Linux grayscale geometry discrepancy without changing comparison limits.24 accepted difficulty files remain unchanged;89 worker tests pass.

Added isolated combined web/worker smoke Dockerfile. Default amd64-QEMU esbuild crashes in Go GC; smoke-only GOGC=off permits startup. Two2GiB development web OOMs remain recorded failures. Their workers finish without data loss; first-job recovery verifies all four downloads. Final empty-data run with3GiB web/2GiB worker completes automatic original-link discovery, fresh download,1140-note extraction and four HTTP exports B177/E548/M1119/A1119, with zero restarts/OOM. Export hashes match the recovered run;175 image source files match checkout. Evidence: tutorial-linux-runtime-2026-09-08.json and tutorial-linux-http-2026-09-08.json.

One clean Linux development-preview import is proven. Native production capacity, source-rights/redistribution obligations, musical/playability acceptance and deployment gates remain open. Prior frozen4/10 and fresh9/10 receipts remain unchanged; this development smoke is not a new benchmark. Existing app3103 and review8874 still return200.
