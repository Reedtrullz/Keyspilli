# Keyspilli audit remediation — 16 September 2026

Implementation is on `codex/audit-hardening`, based on main `211a4b6198b80ab5ea6839f6bdf113ab00c0c0ed`, in `/Users/reidar/Projectos/.keyspilli-worktrees/audit-hardening`. The original `codex/organ` checkout and its existing work are preserved. No production deployment or owner listening verdict is implied.

## Changes

| Audit finding | Resolution |
| --- | --- |
| F01: MusicXML rests shift later notes | Rests advance the cursor; backup, forward, chords and separate voices retain their timing. |
| F02: pickup, divisions and tempo errors | Pickup measures use actual extent; ordinary bars preserve meter and tolerate one division of serialization rounding. Divisions change in stream order. Sound tempo is recognized. Unsupported multipart, changing-meter and changing-tempo scores fail explicitly. |
| F03: accompaniment disappears after looping; long frames bypass song end | Looping resets both scheduling cursors. Stalled frames share end handling, skip missed attacks and wrap in constant time. Invalid loop bounds are rejected. |
| F04: inconsistent cached learner policy | All reads use one file-signature-aware loader. Malformed JSON/schema throws even on cold start; corrected atomic replacements take effect without restart. Existing owner verdicts are unchanged. |
| F05: unbounded synchronous ingestion | Shared arranger guards bound notes, timeline, measure count, tempo-event work and grid work. Imports reject over 16 MiB; web uploads retain their 10 MiB cap, admit one operation through completion, and cancel slow bodies after a total deadline. |
| F06: dependency advisories | Next.js, Sharp, PostCSS and Vitest are patched. The existing Vite 7 transform is retained for test compatibility. The lockfile and workspace requirements are updated together. |
| F07: broken live rebuild verification | Authenticated version/target verification uses bounded pagination. Workflow inputs pass through environment variables, SSH uses `IdentitiesOnly`, and policy transfer is atomic. |
| F08: incoherent/torn backups | A host runner serializes backups, pauses both writers, runs a separate backup container, and restores only pauses it owns. Checksummed database/archive pairs publish a manifest last. Monitoring and retention use complete pairs. A non-destructive restore drill verifies copied data. |
| F09: live publication lock can be stolen | Persistent per-base SQLite OS locks replace age-based directory eviction. Process death releases ownership automatically; files are never unlinked as lock cleanup. |
| F10: post-swap failure loses recovery material | A durable journal precedes replacement; previous artifacts and upload sources survive failures. Mutations and playback/export fail closed while reconciliation is pending. The recovery command replays the source/database commit idempotently, with portable source names and play-count preservation. |
| F11: PDF page/resource leak | Both layouts preflight their song, admit at most two renders per process, and share a total deadline across launch, navigation and capture. Cancellation closes late-created pages; failed browser launches can recover. |
| F12: invalid pagination reaches SQL | Route and shared database helpers normalize finite safe integers and cap limits. Direct callers receive the same safety boundary. |

Source discovery also discards responses belonging to a previous target, including selection/confirmation responses. Production browser checks cover target edits, upload, playback links, and both PDF layouts.

## Catalogue repair

The original stored catalogue had 36 failing bases and 3,998 difficulty-ladder diagnostics. Rebuilding exactly those bases from their available MIDI sources in an isolated copy succeeded for all 36. Verification of the copy reports **0 failures across 464 bases, 0 data warnings**. All 149 enabled cached manifest sources pass the calibrated workload guard.

Local evidence under `output/audit-hardening/`:

- `catalog-snapshot/`: repaired database/artifacts; the original catalogue is unchanged.
- `catalog-repair-backup/`: original database and the 36 original artifact trees.
- `catalog-repair-manifest.json`: before/after checksums for 684 artifact files.
- `catalog-rebuild.log`, `catalog-repaired-verify.log`, `catalog-source-limits.json`: reproducible repair and validation results.
- `chord-verify.log`: all 464 bases resolve chord sources; 1 chart, 463 generated fallbacks and 4 empty timelines. This checks resolution, not harmony quality.

The snapshot retains local source-directory links and is a review/repair working copy, not a portable deployment bundle. The hash manifest identifies the exact repair scope. Use the current application/runtime for these artifacts: the old checkout predates the persisted Beginner off-grid metadata contract.

## Recovery and verification boundaries

### Final local results

| Check | Result | Evidence in `output/audit-hardening/` |
| --- | --- | --- |
| Workspace unit/integration suites | 1,933 tests in 199 files pass | `integration-tests-final.log` |
| TypeScript and production build | Pass | `typecheck-final.log`, `build-final.log` |
| Python audio/transcription tests | 35 pass; model execution mocked | `python-tests.log` |
| Production player browser suite | 44 pass | `e2e-player-production.log` |
| Existing app/mobile/usage browser suites | 37 pass; includes overlapping player-mobile checks | `e2e-remaining-production.log` |
| Isolated upload/PDF browser suite | 5 pass, real PDFs for both layouts | `e2e-scratch-pdf.log` |
| Production reverse-proxy browser suite | 5 pass | `e2e-proxy.log` |
| Backup/restore and live-verifier fixtures | 10 backup scenarios and 6 verifier scenarios pass | `ops-backup.log`, `ops-live-verifier.log` |
| Monitoring and private edge canary | Pass | `ops-monitor.log`, `ops-access-boundary.log` |
| Dependency audit | Zero reported vulnerabilities | `dependency-final-audit.json` |
| Clean lockfile install | `npm ci` passes with Node 22 / npm 10 | `npm-ci-final.log` |
| Repaired catalogue calibration | All six difficulty levels pass unchanged limits | `calibration.log` |

The calibration command now respects `KEYSPILLI_DATA_DIR`. Browser fixtures also use the configured source directory, search for the target song instead of assuming its first-page position, and allow CSS subpixel rounding at the mobile height boundary. These changes preserve the existing functional assertions and full CI browser suite.

For a pending publication, use `KEYSPILLI_DATA_DIR=/path/to/data npm run reconcile-artifacts -w @keyspilli/catalog -- BASE_ID`. Do not delete its journal or backup by hand. Before upgrading old writers, stop them and investigate any legacy `.BASE.lock` directories; the new code refuses to steal those locks.

Validation evidence is recorded in `output/audit-hardening/`. Unit/integration tests exercise real policy reads, database failure injection, cross-process lock exclusion/death, parser round-trips, admission/deadline cleanup and pagination. Python audio tests mock model execution. Browser PDF checks use real Chromium. Backup tests use controlled Docker fixtures and a real temporary SQLite/archive pair; they do not pause the VPS.

Deployment, a real VPS restore, live authenticated post-deploy verification, MIDI hardware, actual transcription model runs and subjective listening/playability acceptance remain separate checks. No human review flags or source approvals were invented to make validation pass.

Primary references: [Next.js AVIF advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4), [Node Web Streams reader contract](https://nodejs.org/api/webstreams.html#readablestreamdefaultreaderread). The local npm audit JSON is the exact dependency result for this branch.
