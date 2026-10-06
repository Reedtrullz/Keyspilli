# Music Evidence Next Phase to GitHub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Native parent execution; no subagents.

**Goal:** Deliver improved, honestly qualified Keyspilli music evidence and reusable bound-account Gemini review through tested GitHub artifacts, then deploy the accepted exact revision with verified rollback.

**Architecture:** Three independently reviewable lanes share a narrow portable evidence contract. Keyspilli owns audio/source/repair and human packs; Anti owns connected-Google Gemini transport and optional interpretation; release work consumes exact-head CI and separate acceptance receipts. Failed research can ship only as an explicitly limited experimental candidate.

**Tech Stack:** Existing Node22.22.3/TypeScript/Playwright and Python runtime pins; GitHub Actions, deterministic plugin ZIP, Python wheel/sdist, native amd64 containers, GHCR, existing VPS Ansible/backup/restore tools.

**Spec:** [Qualification design](../specs/2026-10-06-music-evidence-qualification-design.md).

## Global Constraints

- Anti contains reusable Gemini-through-Antigravity capabilities for connected eligible Google accounts; other music processing belongs in Keyspilli. Preserve unrelated Anti routes.
- Compact review: one clip/claim,2048tokens default/4096maximum,90seconds,oneattempt. Twelve proposed serial jobs are an upper bound, not upload authorization.
- Controlled admission: core>=30/32, quiet>=14/16, repeat>=10/12, refusal12/12, zero accepted wrong sets, end-to-end p95<=20seconds, peakRSS<=2GiB.
- Preserve5% maximum raw residual, -50dBFS level floor,0.05 weak coefficient floor,8events,128ms minimum history,1.2second interval,16atom batches and1GiB immutable FFT cache.
- Source, structural, musical and runtime are separate exact-commit reviewed gates. Before promotion all four must pass. Rehearsal runtime and postdeployment runtime receipts have distinct scopes.
- Production operation is deploy_only. Preserve catalog, queues, owner state, credential stores, primary WIP, old evidence and published candidate assets. Automatic directAudioAmt remains false unless separately qualified and approved.
- New work is opt-in and bounded. Check available storage before heavy work; do not repeat the resolved disk cleanup or delete preserved studies. No unbounded scratch or model acquisition.
- Do autonomous code/tests/artifacts first. New ears/source/keyboard review, live uploads, installed adoption and exact promotion choices wait for the final concrete packet. No external reviewer outreach without explicit instruction.

## Review Focus

1. A correct software build with an incorrect octave fit cannot produce production readiness (K2/K4/R2).
2. A source checksum with unknown role/timing cannot authorize repair (K5/K6/R2).
3. An account index/reference drifting after preparation cannot change the upload account (A1–A3).
4. A newer pending/cancelled check or a different merge SHA cannot inherit green CI (R1/R3/R5).
5. A healthy new web container with wrong worker/data/auth state must roll back the image pair (R4/R6).

## Execution map

| Lane | Detailed plan | Delivery / dependency |
|---|---|---|
| Keyspilli | [K1–K7](2026-10-06-music-evidence-keyspilli-qualification.md) | Support identity → audio ambiguity checks → full-resource runner → fresh screen; positive source and silent Chords work can proceed independently |
| Anti | [A1–A3](2026-10-06-music-evidence-anti-account-binding.md) | Exact account acquisition → gateway enforcement → packaged helper and pinned portable jobs |
| Release | R0–R7 below | Promotion sequencing can be implemented before studies; release assets follow code freeze; human gates precede stable/production |

Critical path: R0 → K1/K2/K3 → K4; K5 → K6; A1 → A2 → A3; all software lanes + R1 → R2/R3 → final review R4 → R5 → R6 → R7. K7 is optional and cannot delay or replace the controlled/acceptance gates. Serial parent execution is the default; independent work means it can continue while a different lane awaits external evidence, not automatic provider fan-out.

## Baselines and protected paths

- K: `/Users/reidar/.codex/worktrees/keyspilli-music-review-afk/Keyspilli`, published source `172248cb8d07706f05611cadb24e717d6958e392`.
- A: `/Users/reidar/Projectos/.worktrees/anti-music-review-afk`, published source `1ac54cc15cb80c3d13ce80f2815052d2c26025b6`.
- Protected primaries: `/Users/reidar/Projectos/Keyspilli`, `/Users/reidar/Projectos/codex-antigravity-auth`.
- Protected owner evidence: `/Users/reidar/Downloads/listening-observations.json`; canonical `/Users/reidar/plugins/keyspilli`; loaded cache `/Users/reidar/.codex/plugins/cache/personal/keyspilli/0.1.0+codex.20261006outputguard`.
- Prior packet: K/`output/music-review/completion-20261006-115005`; prior ledger `.superpowers/sdd/2026-10-06-music-evidence-to-github-deployment`. Preserve both, including failed studies and logs.
- Latest fully checked candidate Keyspilli CI37471766922, offline37471766702, container37471766746; Anti PR37462505925/push37462499828/tag37469371569. Baseline evidence only; new changes require new runs.
- Production prior readback: main46e7b666799de4f7b18ba714ea12d44549b7ad29,2,730songs, directAudioAmt=false; actual loopback web port3008. Read current image pair and backup details from PRODUCTION_BASELINE.json, never copy abbreviated/detached hashes from prose.

## R0 — Reproducible successor and scope record

**Files:** create new private run ledger under `.superpowers/sdd/2026-10-06-music-evidence-next-phase/`; use these plan/spec files; do not edit the old completed packet.

- [ ] At execution, recall context and applicable repository/skill instructions. Inspect K/A status, branch/head, worktrees and current remote main/PR ancestry. Reuse suitable clean isolated checkouts or create successor codex/ branches; do not reset primary WIP. Pin the starting source and method identities.
- [ ] Create a bounded new run directory and read-only preimages of primary status/HEAD, owner export and canonical/loaded plugin file inventories. Hash artifacts without dumping credentials or account stores. Record protected identities and available disk once; do not let old disk-stop notes replace the current observation.
- [ ] Read current packet summaries, score and the three named false-octave traces. Inventory K4 method-file identities, existing source controls and proposed Gemini jobs. Record each as closed evidence or new development input. Validate all required local paths exist.
- [ ] Record study ceilings before running: one new72case screen after development freeze,16finite support-margin combinations, one serial provider study only if finally approved, and one optional model candidate. Expand scope only through a revised reviewable protocol. Commit successor planning/scope documentation, no science success claim.

## R1 — Separate checks from promotion, retain fail-closed readiness

**Files:** modify K/`.github/workflows/ci.yml`, `scripts/check-music-release.py`, `scripts/test_check_music_release.py`; create `scripts/test_music_promotion_workflow.py`; update `docs/ops/music-evidence-release-qualification.md`, `docs/decisions/0004-release-gates.md` only to clarify runtime-rehearsal scope, not waive any gate.

**Interfaces:** new workflow_dispatch boolean `promote_reviewed`, defaultfalse. Ordinary push/PR/dispatch executes Automatic checks and never publishes/deploys. Approved main promotion with promote_reviewed=true and operation=deploy_only skips rerunning Automatic checks; readiness validates latest exact-head completed check against the detached manifest. For this promotion invocation only, name the skipped checks job `Promotion prerequisites` using the inputs context: a newer skipped check named Automatic checks would itself invalidate the old pin. GitHub permits inputs in job names and needs/status predicates in job conditions ([official context availability](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability)). Publication/deploy use explicit result predicates permitting only that intended skipped checks job and successful readiness. Use full GITHUB_SHA for both image tags and full appVERSION/OCI revision labels.

- [ ] Add guard tests for missing/failed/pending gates; wrong commit; stale/older check IDs; newer pending/cancelled/skipped check; non-GitHub Actions app; removed required check; duplicate/oversized JSON; non-deploy_only operation; omitted runtime scope. Add workflow tests for PR/push/normal dispatch producing no publication, promotion on non-main refusing, and readiness failure preventing both image builds/deploy.
- [ ] Run `python3 scripts/test_check_music_release.py` and `python3 scripts/test_music_promotion_workflow.py`; expect RED for new mode and scope checks. Preserve every existing guard test, especially latest check-ID validation.
- [ ] Implement minimal workflow conditions; account for skipped needs with always() only plus explicit allowed-results/main/event/input predicates. Do not use unconditional always() as permission to build/deploy. Pin prepromotion runtime receipt scope `isolated-candidate-rehearsal`; production scope is recorded only after live deployment. Source/structural/musical receipt claims stay unchanged.
- [ ] Read all paginated GitHub check-runs for the commit before selecting the latest named check; do not let per_page100 truncation hide a newer required result. Run both guard suites GREEN. Exercise pending manifest refusal in native candidate CI. On the successor non-main branch, execute the promotion-mode negative workflow check: no publication/deployment, skipped prerequisite named Promotion prerequisites, and no newer Automatic checks created. Inspect the final workflow graph and exact head/run IDs; commit `fix: separate reviewed music promotion from CI validation`.

## R2 — Finish acceptance preparation and candidate runtime rehearsal

**Files:** new private `GATES.json`, `QUALIFICATION.json`, `ACCEPTANCE_PACK.json`, `RUNTIME_REHEARSAL.json`; maintain K/`docs/listening-review.md`; use `deploy/restore-app.py`, `deploy/restore-app-verifier.mjs`, `deploy/validate-release-operation.py` and their existing tests.

**Interfaces:** four gate receipts carry reviewedCommit, evidence inventory/hash, status passed/failed/pending and explicit scope. The detached release manifest references receipt hashes; it does not create approval. Scientific qualification is a separate prerequisite for promoting the changed analyzer.

- [ ] Collect K4 and K5/K6 results plus A3 offline contracts. Record any failed controlled gate, unknown source anchor or pending human result explicitly. Keep currentPitchSetEstimate null, completeness unknown and audibility/provider-hearing not-established in portable output.
- [ ] Complete source/catalog verification, MIDI/XML roundtrip, variant monotonicity/playability bounds, chord diagnostics, types/build/tests. Run any pipeline idempotency check twice only against a bounded isolated fixture/public seed, never production catalog. Distinguish this fixture proof from owner-data preservation.
- [ ] Build exact candidate web+worker images locally/native amd64 without production publication. Restore a verified production backup into an owned isolated volume, network disabled where supported; test expected inventories and persisted owner-state samples without exposing them. Run health/Player/export/API/auth/worker lifecycle checks on that candidate pair. Production image restore proof from the old packet is not a substitute.
- [ ] Record what candidate rehearsal proves and what still requires live production readback. If anything fails, retain the log and refuse runtime acceptance. Remove only owned rehearsal containers/directories after handle checks; keep rollback images and receipts. Commit results documentation with aggregate evidence, no private data.

## R3 — Current CI, integrated PRs and unique GitHub candidates

**Files:** K `plugins/keyspilli/**`, `scripts/package-keyspilli-plugin.py`, `scripts/test_package_keyspilli_plugin.py`, package version files; A `pyproject.toml`, bundled skill/schema copies, `scripts/check_artifacts.py`, `scripts/check_installed.py`; new public release manifests/notes generated in the new private run.

- [ ] Integrate existing candidate ancestry once: Keyspilli219 already contains216/218 and Anti170 contains169. Refresh bases; resolve conflicts in successor trees. Prepare one focused source/diagnostic PR per independently reviewable lane and one integration PR if needed. Do not duplicate-merge ancestors. Attach every new PR to this chat after creation. Keep scientific/source/ear outcomes visible in descriptions; update descriptions around final code, not abandoned approaches.
- [ ] Run local focused suites, K `npm run typecheck`, `npm test`, `npm run build`, catalog/chord/calibration checks and relevant browser tests. Include Practice cancellation/focus in all four Player views under normal/reduced motion, CSS200%zoom/forced-colors; retain unchanged assertions. A `python scripts/run_tests.py -q`, compile/artifact checks, exact wheel/sdist installed tests. Run native amd64 container smoke and current public-seed restore CI. No test count copied from the baseline is a future pass claim.
- [ ] Run complete current-head GitHub CI: K Automatic checks + Offline music evidence contracts + actual container-smoke; A quality, six Python/OS matrix entries and packaging/installed checks. Require completed success, investigate any failure, then rerun only changed/failed concerns. Distinguish PR synthetic merge SHA from branch source and final main merge SHA. Pin check IDs/results, log hashes and artifact IDs for each.
- [ ] Pick unused version/tag names after checking current GitHub/PyPI state at execution. Preserve existing Keyspilli plugin0.1.0+codex.20261006musicevidence and Anti2.4.3 candidate assets. Use new non-v* experimental tags pointing to the exact checked source; never overwrite/relabel the prior tag. A new semantic package version must be consistent in wheel/sdist/metadata.
- [ ] Produce deterministic plugin ZIP/manifest with complete required member inventory, exact wheel/sdist, compatibility/migration/rollback notes, release JSON, qualification aggregates and SHA256SUMS. Test extracted plugin preflight and installed wheel/rebuilt sdist using those exact bytes. Scrub private paths, recordings, source assets, answer keys, weights, bindings and account details from public assets.
- [ ] Publish an explicitly limited experimental GitHub release if that lane is ready; download every published asset, compare SHA256 and inventory byte-for-byte, resolve tag commit, verify prerelease status and links. No v* Anti tag/PyPI upload, installed adoption, main merge or production deployment yet. This is the completed GitHub path if acceptance remains failed/pending.

## R4 — One final concrete review packet

**Files:** new run `REVIEW.md`, `OWNER_DECISIONS.md`, `GATES.json`, `EVIDENCE_INDEX.json`, `MIGRATION_AND_ROLLBACK.md`, `proposed-gemini-study.json`; optional adoption scripts prepared in the isolated checkout, never applied during AFK.

- [ ] Assemble exact source heads, new frozen results, positive source-control counts, silent-Chords dispositions, ten-song/mode/difficulty review pack, source/score/MIDI links, repair before/after captures and UI forms bound to bytes. Exported observations preserve unknowns and reviewer roles. Keep old3242pack available; a revised pack gets a new output directory/available loopback port, no overwriting old fields.
- [ ] Prepare the optional Gemini plan with the actual new helper/schema/configuration and serving-instance binding requirement, strict attempt ceiling and stop policy. Prepare install target choices with current canonical/loaded preimages and rollback, and exact PR/merge/tag/deploy actions with current checks. Keep optional installed adoption from blocking standalone GitHub delivery.
- [ ] Ask for only the still-required choices after this packet exists: listening/source/qualified keyboard results, optional new upload/account choice, optional installed target, and exact stable/main/deploy promotion. A failed acoustic or source gate is not an approval question: state it must be fixed or kept disabled. Do not ask the owner to certify piano playability they cannot judge.
- [ ] Import returned observations against exact hashes and update only the corresponding gates. Revisions to audio/events invalidate affected prior human acceptance. If authorized, run/import A3's bounded live study now; any failure remains separate. Installation, if selected, preserves preimages, tests selected launcher/gateway/plugin path and proves actual loaded revision; publishing does not imply installation.

## R5 — Exact main revision and stable publication

- [ ] Proceed only when changed-feature qualification and all four reviewed gates pass and the owner has approved exact promotion. Otherwise finish the experimental path and leave main/runtime unchanged. Record Anti's independent transport acceptance separately; its optional hearing study is never assumed passed.
- [ ] Merge the reviewed ancestry once. First main run executes validation only under R1; no GHCR/deploy yet. Verify exact main commit, tree/source equality to reviewed candidate, full current-main Automatic checks and latest check ID. Any changed product/method invalidates affected studies/gates; metadata-only rebindings require documented tree/content equality, never blind copying.
- [ ] Generate a detached manifest for that exact main SHA, deploy_only, all four passing receipt hashes, explicit rehearsal runtime scope and latest successful Automatic checks ID. Test `python3 scripts/check-music-release.py --manifest "$RUN/RELEASE.json" --checks "$RUN/main-checks.json" --commit "$MAIN_SHA"`; expect the exact passing message. Only now set the reviewed repository variable through a body file, without printing secrets. No check-ID placeholders.
- [ ] For stable Keyspilli publication use new exact-main tag/assets and byte readback. For Anti, a stable v<version> tag triggers PyPI: create it only if that specific publication is approved and the version is unused, full tag CI and exact installed artifacts pass, trusted-publisher environment requirements are satisfied, then verify PyPI filenames/hashes/version by readback. GitHub-only candidate publication never triggers that path. Attach/update final PR status and superseded ancestor dispositions after merge, not before.

## R6 — GitHub production deployment and measured readback

**Files:** existing K `.github/workflows/ci.yml`, `deploy/playbook.yml`, `deploy/templates/compose.production.yml.j2`, `deploy/inventory/hosts.yml`, backup/restore/live verifier tools. New private `DEPLOYMENT.json`, `PRODUCTION_READBACK.json`, `ROLLBACK.json`.

- [ ] Immediately before cutover refresh VPS identity/access with `ssh -o BatchMode=yes Racknerd-Deploy`; inspect actual ports/containers, disk/inodes, backup Result/exit, manifest/archive/DB hashes and rollback image availability. Preserve the keyspilli_keyspilli_data volume and all referenced backups. Validate current backup under candidate image; do not rely on the morning service timestamp. If stale relative to accepted owner state, take a fresh backup through the existing bounded service and verify it.
- [ ] Verify SSH inventory has IdentitiesOnly=yes and IdentityAgent=none, configured host-key pin, production auth/edge values present, and deploy_only selection. Do not change root SSH, ports/Caddy, catalog rebuild settings or unrelated containers. Capture the exact current web+worker rollback digest pair and volume/state inventories directly from runtime into the receipt.
- [ ] Dispatch R1 promotion using `gh workflow run ci.yml --repo Reedtrullz/Keyspilli --ref main -f operation=deploy_only -f promote_reviewed=true`. Pin the resulting runID/headSHA, verify readiness checks the approved completed-main check, GHCR pair uses full SHA tags/OCI revision, and deploy uses those immutable images. A skipped/stale/failed readiness or partial image build must stop before cutover. No rebuild_target/rebuild_all.
- [ ] After deployment, resolve registry digests and both running imageIDs; compare full appVERSION/labels to the exact approved main SHA. Run health, configured unauthenticated edge refusal, authenticated song inventory/count, owner-state samples, export content validation, worker queue/SIGTERM lifecycle and browser Player checks. Short monitored audio captures can verify software output; no unsolicited audible playback replaces human acceptance.
- [ ] Record immediate and10minute readbacks using actual elapsed time; communicate while waiting in intervals<=60seconds. Compare against predeploy owner/catalog baseline. A24hour observation is a separate later measured check, never an immediate completion claim; schedule it only on user request.
- [ ] On failed health/version/auth/count/owner/export/worker checks, use the preauthorized prior image pair with the same volume, then verify both services/version/data/auth again. Do not restore/delete data as part of image rollback. If a data/schema incompatibility blocks safe rollback, stop writes only under the separately reviewed incident scope and present the concrete recovery decision. Retain the failed deployment evidence.

## R7 — Closeout, adoption readback and durable handoff

- [ ] Re-download final public assets/checksum them; verify release/tag/main/CI/GHCR/deployed revision identity chain. Verify no draft or experimental limitation was silently removed. List every task disposition: delivered, failed experiment, pending human review, optional deferred or deployed.
- [ ] Read back any selected installed canonical/loaded plugin and gateway revision; preserve rollback preimages. If no adoption was approved, explicitly retain the prior loaded copies. Ensure packages contain no weights or extra-account requirement.
- [ ] Verify protected primary WIP, original owner export and previous evidence remain unchanged except explicitly selected adoption targets. Check owned scratch/process leftovers and remove only verified inactive owned resources; preserve deliverable listening servers and review artifacts.
- [ ] Log an evidence-backed project/daily Obsidian entry with exact heads, CI/run IDs, artifacts, gate dispositions and actual deployment/rollback readbacks. No memory writes or external messages unless separately instructed. Final response links final GitHub releases/PRs, brief tests/results, remaining acceptance and Obsidian section.

## Completion criteria and limits

Software delivery is complete when new code/contracts, exact artifacts and current CI are verified and GitHub release assets read back. Scientific success requires the fixed fresh screen, independently of software tests. Production completion requires all reviewed gates, approved exact main promotion, immutable image-pair deployment and live readback/rollback proof. If a gate fails, finish the honest experimental GitHub path and identify the next concrete failure; do not claim the musical problem solved.

Planning review: file/API boundaries, dependency ordering, five adverse input classes and tests, resource/answer separation, account-instance drift, CI check-ID sequencing, artifact privacy, final human decisions and rollback were self-reviewed. Implementation and all new research remain pending.
