# Keyspilli project review — 27 September 2026

Reviewed revision: `cd4e42822dd48963d982c270e4f0b93594ac7993`, verified against GitHub `refs/heads/main` with `git ls-remote`. Source checkout: `/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli`.

The original `/Users/reidar/Projectos/Keyspilli` checkout is the older `codex/organ` branch at `6aa776fa` with pre-existing changes. Those changes were preserved. Findings below refer to current main, not that older branch.

The most urgent fix is preserving approved Chords backing during metadata edits. Next, align visible notation with transposed playback and correct seek/loop scheduling. The architecture already has useful publication locks, reconciliation journals, upload bounds, input lifecycle handling, and backup recovery checks; retain those safeguards.

## Confirmed findings

### F1 · P1 · Metadata edits delete persisted Chords backing

**Location:** [song-update.ts:575](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/apps/web/src/lib/song-update.ts:575), [ingest.ts:542](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/packages/catalog/src/ingest.ts:542), [chord-timeline.ts:714](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/packages/catalog/src/chord-timeline.ts:714).

Approved packages store `artifacts/<baseId>/chord-timeline.json`. `applySongMetadata` stages only the six variant directories and manifest, then replaces the entire base directory. The old directory is subsequently removed. Changing only a title therefore deletes the prepared backing, and the loader falls back to another chart or generated chords. Re-ingestion has the same omission.

**Evidence:** In an isolated synthetic catalog, ingested six variants, added a schema-valid prepared timeline, changed only the title, and confirmed that the timeline file no longer existed. No real catalog was modified.

**Smallest fix:** Make auxiliary backing preservation part of the publication contract for metadata-only changes. A musical/source change should explicitly preserve a compatible backing or mark it for review, never silently discard it. Merely copying the file is insufficient if an edit changes the source fingerprint: reconcile that identity for genuinely unchanged musical content. Add a regression that checks both retained bytes and actual loader selection.

### F2 · P2 · Transposition changes notes but leaves chord symbols in the old key

**Location:** [Player.tsx:806](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/apps/web/src/components/player/Player.tsx:806), [chord-practice.ts:11](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/apps/web/src/components/player/chord-practice.ts:11), [LeadSheetView.tsx:101](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/apps/web/src/components/player/LeadSheetView.tsx:101), [BeginnerView.tsx:84](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/apps/web/src/components/player/BeginnerView.tsx:84).

The visual chord projection transposes MIDI pitches but retains `name`; Note letters and Lead Sheet receive untransposed chord names directly. A learner hears/plays D major after +2 semitones while the visible symbol still says C. The separate chord-practice target builder already transposes symbols correctly.

**Evidence:** Rendered a C fixture at +2 with the real LeadSheetView: the note label was D4 and the chord aria-label remained C. Existing transpose-parity tests use empty chord arrays, so this case is not covered.

**Smallest fix:** Reuse the existing `transposeChordSymbol` helper at the display boundary, including slash basses, and keep raw playback pitches untransposed until scheduling. Extend the existing parity test with nonempty chords.

### F3 · P2 · Seeking into a chord replays its entire duration

**Location:** [engine.ts:435](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/packages/player-core/src/engine.ts:435), [engine.ts:455](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/packages/player-core/src/engine.ts:455).

The active chord selected after a seek is passed to `playChord` with its original duration, without subtracting the elapsed portion. It can continue sounding under the next harmony. Sampled playback schedules the supplied duration directly.

**Evidence:** With a C chord spanning 0–2 seconds followed by G, seeking to 1.9 seconds scheduled C for another 2 seconds, although only 0.1 seconds remained. This is a deterministic scheduler reproduction, not an audible listening test.

**Smallest fix:** Schedule only the intersection of the chord interval and the remaining playback window, as `previewPlan` already attempts. Test seeking just before a chord change and into a rest.

### F4 · P2 · Loop lookahead includes notes beyond the selected passage

**Location:** [engine.ts:386](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/packages/player-core/src/engine.ts:386), [engine.ts:132](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/packages/player-core/src/engine.ts:132).

`schedule` clamps to a grading endpoint but not a loop endpoint. Audio lookahead can schedule the next bar before the React frame loop notices the wrap. A late frame can let those unwanted attacks sound. Normal wraps also discard elapsed overshoot instead of preserving phase.

**Evidence:** For a loop ending at 1.0 seconds, starting at 0.95 scheduled a note at 1.02. The existing loop test explicitly expects a normal wrap to reset to exactly zero and does not inspect scheduled event boundaries.

**Smallest fix:** Bound the scheduling horizon at the loop end and handle wrapped scheduling with a consistent time remainder. Check note, chord and metronome events, including delayed frames. Do not rely on a later UI frame to cancel already-scheduled out-of-loop attacks.

### F5 · P2 · Sheet Music silently disagrees with transposed playback

**Location:** [Player.tsx:1878](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/apps/web/src/components/player/Player.tsx:1878), [SheetMusicView.tsx:125](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/apps/web/src/components/player/SheetMusicView.tsx:125), [DownloadDialog.tsx:98](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/apps/web/src/components/player/DownloadDialog.tsx:98).

The Sheet Music view loads stored MusicXML using only the song ID. Changing transpose changes the audio and other views, but not this score. The existing warning appears only in Chords mode. Standard downloads likewise remain stored Original files, with no specific notice about ignored transposition.

**Evidence:** Traced the settings → timed notes → engine path and the independent song ID → stored MusicXML path. No browser screenshot or audio comparison was performed.

**Smallest fix:** Explicitly label score/downloads as original key whenever playback transpose is nonzero, or disable unsupported controls for that view. Full transposed score/export generation can follow if desired; a clear truthful boundary is the smaller immediate fix.

### F6 · P2 · Source-search timeout excludes reading the response body

**Location:** [source-candidate-provider.ts:153](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/packages/catalog/src/source-candidate-provider.ts:153), [source-candidate-provider.ts:173](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/packages/catalog/src/source-candidate-provider.ts:173).

The AbortController timer is cleared after `fetch` receives headers. `response.json()` runs afterward without that deadline. A provider that sends headers but stalls the body can leave source discovery pending indefinitely.

**Evidence:** A local fake provider returned headers immediately and delayed each body for 180ms under a 100ms timeout. All four requests completed with un-aborted signals. No external provider call was made.

**Smallest fix:** Keep the timer active until body consumption completes; release/cancel unused response bodies before retrying. Add one stalled-body test beside the existing provider tests.

## Further improvements and polish

These are targeted improvements, not claims of additional reproduced production failures.

| Priority | Improvement | Evidence and suggested scope |
| --- | --- | --- |
| P2 | Pin complete audible output in the golden corpus | [audit-golden-chords.mts:44](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/apps/web/scripts/audit-golden-chords.mts:44): full-song legacy acceptance hashes omit generated note events; the complete playback hash is logged but not compared to an accepted value. Generator changes can alter note backing without changing the legacy digest. Introduce a separately reviewed full-snapshot pin; keep historical approvals intact. No current 12-song replay or drift count was established in this review. |
| P2 | Make musical browser regressions portable | [playwright.melody.scratch.config.ts:8](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/apps/web/playwright.melody.scratch.config.ts:8) hardcodes two Reidar-specific directories; [playwright.config.ts:9](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/apps/web/playwright.config.ts:9) excludes this suite by default. Accept explicit fixture roots and keep private musical cases opt-in, while adding small synthetic seek/loop/transpose cases to ordinary CI. |
| P2 | Bound stalled notation-worker requests | [verovio-worker.ts:91](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/packages/engrave/src/verovio-worker.ts:91): pending promises have no request deadline, and disposal occurs on an error event. A wedged worker can leave Sheet Music loading forever. Add a bounded failure/retry path using the existing worker disposal function, rather than another worker-management layer. No actual WASM hang was reproduced. |
| P3 | Make uploads recoverable and keep their state coherent | [UploadsForm.tsx:202](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/apps/web/src/app/uploads/UploadsForm.tsx:202): the request has no abort/unmount lifecycle, eagerly reads the whole file, and does not distinguish busy from reconciliation responses. Add client size checking, a request guard, and clear retry/reconciliation messaging; freeze or version file/details changes during an active request. Client abort must not claim that server publication was rolled back. |
| P3 | Pin the contributor runtime in a machine-readable file | Root `engines.node` allows Node 20 while documentation and CI require 22.22.3. This review's first npm run selected Node 20 and failed loading SQLite compiled for Node 22; explicit Node 22 passed. Add a runtime pin matching CI and use it in setup. This is a local tooling mismatch, not a failing product test on the supported runtime. |
| P3 | Use the native dialog already used elsewhere | [DownloadDialog.tsx:34](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/apps/web/src/components/player/DownloadDialog.tsx:34) manually handles Escape/focus trapping/Tab; [PracticeSetupDialog.tsx:34](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/apps/web/src/components/player/PracticeSetupDialog.tsx:34) already uses `dialog.showModal()`. Reuse that platform pattern and preserve close animation/focus return. `native:` remove the manual modal behavior; estimated net: -30 lines possible. |
| P3 | Clarify tutorial progress copy | [ImportProgress.tsx:6](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/apps/web/src/app/youtube/ImportProgress.tsx:6) tells users to keep their Mac awake although the deployed worker runs on the VPS. Say that processing continues on the server and the saved job can be revisited; reserve local-machine instructions for local operation. |
| P3 | Reformat compact async import code before extending it | [TutorialImport.tsx](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/apps/web/src/app/youtube/TutorialImport.tsx) compresses polling, submit/cancel state and JSX into 70 lines; tutorial-route.ts uses similarly dense control flow. Ordinary formatting and named state transitions improve reviewability without adding a state-machine dependency or new architecture. |
| P3 | Bound transpose controls consistently | [Player.tsx:2130](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/apps/web/src/components/player/Player.tsx:2130) permits unlimited +/- clicks, while persisted preferences clamp to ±24. Apply one shared bound so the current session and reloaded session behave consistently and pitches stay within the supported instrument range. |
| P3 | Review retained tutorial-media growth before increasing use | Tutorial attempts retain downloaded video and intermediate files; the 24-hour snapshot reuse age is not a deletion policy. Backups include `transcribed`, and the host runner pauses both writers while archiving and checking retention. Define an explicit preservation/retention policy and measure backup duration before broadening imports. No storage deletion or live capacity claim is proposed. |

## Verification and coverage

| Check | Result |
| --- | --- |
| Remote source identity | GitHub main equals reviewed SHA |
| `npm run typecheck` under Node 22.22.3 | Passed across workspaces, including song tools |
| `npm test` under Node 22.22.3 | 220 files, 2,236 tests passed: web 267, catalog 1,123, engrave 8, MIDI 426, player-core 317, worker 95 |
| Targeted regression probes | Five reproduced behaviors: metadata-sidecar deletion, wrong chord symbol after transpose, full-duration chord tail after seek, out-of-loop scheduling, response-body timeout gap |
| `python3 deploy/test/test-live-verifier.py` | Passed, mocked verification fixtures |
| `python3 deploy/test/test-backup.py` | Passed, backup/restore and failure-path fixtures |
| `bash deploy/test/ops-check.sh` | Passed |
| Working trees | Reviewed source tree remained clean; original WIP preserved; only this report added to the original checkout |

Reproduction script: [reproduce.mts](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/output/project-review-2026-09-27/reproduce.mts). Output: [reproduction-results.txt](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/output/project-review-2026-09-27/reproduction-results.txt). These are ignored, local review artifacts; the script uses a temporary synthetic catalog under the review output folder, closes its SQLite connection, and removes that catalog afterward. Its assertions document the currently reproduced defects, not the expected behavior after fixes.

Coverage included player controls/views, playback/audio/input/grading, upload and source discovery routes, catalog ingest/publication/reconciliation/read-model paths, MIDI/MusicXML contracts, notation/export flow, tutorial worker/cache/cancellation, and CI/deployment/backup source. This is a project-wide cross-layer review, not a claim that every research script received exhaustive line-by-line review.

Not performed: production requests or SSH, fresh production build, Playwright browser run, full production-catalog verification, dependency vulnerability audit, external tutorial imports, corpus-wide listening, or real-keyboard playability review. Passing engineering tests does not establish musical acceptance. The historical 9-match/3-drift memory was used only to orient the review and is not presented as current evidence.

## Suggested implementation order

1. Preserve prepared backing and its compatible identity through metadata edits/re-ingestion.
2. Correct chord labels and disclose the static Sheet Music/download key boundary.
3. Correct chord-tail and loop scheduling, with focused event-boundary tests.
4. Keep network body reads and notation work bounded.
5. Strengthen full-output musical regression pins and portable fixtures.
6. Apply small upload, dialog, progress-copy and runtime-setup polish.

No fixes, commits, PRs, merges, deployments, or musical acceptance changes were made.

## Follow-up audit and GitHub issues — 27 September 2026

Created six issues for the original defects and one checklist for the ten polish opportunities, then continued the audit through sampled-audio routing, preview parity, and cancellation/publication concurrency. Reviewed main remains `cd4e42822dd48963d982c270e4f0b93594ac7993`.

| Finding | GitHub issue |
| --- | --- |
| F1 | [[P1] Metadata edits delete persisted Chords backing](https://github.com/Reedtrullz/Keyspilli/issues/113) |
| F2 | [[P2] Transposition changes notes but leaves chord symbols in the old key](https://github.com/Reedtrullz/Keyspilli/issues/114) |
| F3 | [[P2] Seeking into a chord replays its entire duration](https://github.com/Reedtrullz/Keyspilli/issues/115) |
| F4 | [[P2] Loop lookahead includes notes beyond the selected passage](https://github.com/Reedtrullz/Keyspilli/issues/116) |
| F5 | [[P2] Sheet Music silently disagrees with transposed playback](https://github.com/Reedtrullz/Keyspilli/issues/117) |
| F6 | [[P2] Source-search timeout excludes reading the response body](https://github.com/Reedtrullz/Keyspilli/issues/118) |
| polish | [Track project-review quality, reliability and UX improvements](https://github.com/Reedtrullz/Keyspilli/issues/119) |
| F7 | [[P2] Tutorial cancellation can succeed while the worker still publishes the song](https://github.com/Reedtrullz/Keyspilli/issues/120) |
| F8 | [[P2] Chord-only sampled playback is silent until another note initializes fallback audio](https://github.com/Reedtrullz/Keyspilli/issues/121) |
| F9 | [[P2] Sampled piano routes right-hand notes through the left-hand volume control](https://github.com/Reedtrullz/Keyspilli/issues/122) |
| F10 | [[P2] Sound previews omit valid short chords that normal playback schedules](https://github.com/Reedtrullz/Keyspilli/issues/123) |

### F7 · P2 · Cancellation reports success while publication continues

A deterministic interleaving runs the real cancellation PATCH after the publication ownership fence, immediately after writing `.publication-id`. The route returns HTTP 200 / `cancelled: true`, but publication continues through filesystem awaits and database insertion. Six variants remain while the job is marked `TUTORIAL_PREVIEW_CANCELLED` with no song ID. The final owned-job update fails without being handled.

Coordinate the cancellation and publication commit decision. A successful cancellation must prevent publication; if publication has committed, cancellation must report that it is too late and the job must retain its song link. Another earlier check alone does not close the race.

### F8 · P2 · Cold chord-only sampled playback silently drops attacks

The sampler creates its oscillator fallback only from `noteOn`. Chords mode can have no source note events, so `playChord` returns without producing sound while samples are pending or failed. Reuse fallback initialization for both note and chord entry points. The isolated pending-sample reproduction observed zero sampled and zero fallback attacks after PlaybackEngine.start().

### F9 · P2 · Sampled piano ignores the right-hand volume bus

The sampled instrument connects exclusively to `pianoGainNode`; every sampled note uses it regardless of hand. With right-hand gain 1 and left-hand gain 0, an R-hand note reaches an instrument with destination gain 0. Honor the existing independent hand/input and accompaniment controls, including live input and transitions from fallback.

### F10 · P2 · Sound previews omit short chords

Both PlaybackEngine.previewPlan and the accompaniment-only Player preview retain an obsolete 0.2-second threshold. Normal playback schedules a 0.125-second passing chord, while the preview omits it entirely. Remove the obsolete threshold in both callers while retaining positive-duration and window-intersection checks.

### Follow-up verification

Four targeted Vitest probes passed assertions of the existing defects, in two files under [deeper](/Users/reidar/.codex/worktrees/repository-cleanup/Keyspilli/output/project-review-2026-09-27/deeper). These tests demonstrate bugs, not fixed behavior. The cancellation test uses an isolated synthetic catalog and actual worker/publication/cancellation code with a mocked source resolver and controlled filesystem interleaving; sampled audio uses a fake AudioContext/instrument. No audible listening result is claimed.

Run from the reviewed checkout with Node 22.22.3:

```sh
node node_modules/vitest/vitest.mjs run --config output/project-review-2026-09-27/deeper/vitest.config.mts
```

The earlier full-suite/typecheck results above were not rerun in this follow-up because application source was unchanged. Published issue bodies were read back against their local drafts. No fixes, commits, PRs, deployments, production imports or musical acceptance changes were made. Review artifacts are ignored and the reviewed source checkout remains clean; original WIP is preserved.

## Complex audit follow-up

The [complex code and lifecycle audit](/Users/reidar/Projectos/Keyspilli/docs/audits/2026-09-27-complex-review.md) adds thirteen reproduced findings F11–F23, filed as GitHub #124–#136. Fourteen focused probes across eight files cover MXL guard bypass, import fidelity, audio lifetimes, worker retries, recent-song selection, export cancellation, notation cache identity and stale handoff confirmation. The report also separates source-observed hardening candidates, rejected hypotheses and unverified runtime/musical acceptance. Production npm dependency audit reported zero advisories; this does not certify the whole system. All thirteen new issue bodies were read back successfully.
