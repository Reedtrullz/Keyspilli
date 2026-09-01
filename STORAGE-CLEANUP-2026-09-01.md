# Storage cleanup and remote durability — 2026-09-01

Status: complete with caveat: the data volume is above the 30 GiB safety floor
but below the preferred 40 GiB target; protected, active, shared-cache, and
unknown material was intentionally retained.

## Initial state

* Branch: `codex/metal-inference-lane-lock`; local HEAD `52a6541c859007349d24a70beb37dcd890e12756`.
* Data-volume free space: approximately 15.4 GiB (97% used), below the 30 GiB verification floor.
* Repository: approximately 1.61 GiB allocated; `.git` approximately 22 MiB; ignored runtime `data/` approximately 818 MiB; ignored `output/` approximately 34 MiB.
* Keyspilli-named `/private/tmp` artifacts: approximately 23.85 GiB across 234 top-level directories. The full measured inventory is `docs/research/keyspilli-evidence/storage-inventory.json`.
* The topic branch was 153 commits ahead of the remote topic ref; no remote-only commits were found.

## Ponytail audit

The whole-repository audit identified dead/possibly redundant code (`analyze2.ts`,
unused `drizzle-orm`/direct `smplr`, likely redundant `verovio`, a dead color
re-export), 79 local-only alias declarations, untracked package-manager files,
and 17 `.DS_Store` files. The debt scan found seven `ponytail:` markers; one
audio-tail marker has no explicit upgrade trigger. These findings are advisory:
the code/dependency removals are deferred because they do not materially solve
the storage incident and could affect package/API compatibility. No musical code
was changed.

Applied during this mission: precise ignores for local retention/inventory
manifests, and removal of only verified scratch/package-manager files after the
retention checkpoint. No speculative framework or dependency refactor was
applied. Final Ponytail review is recorded in the final section.

## Git durability and safety audit

At mission start `origin/codex/metal-inference-lane-lock` pointed to
`5d8728757a5f8b97bd301a7237b1c9cdccda7aac`; the local tip was a strict
fast-forward of it by 153 commits. The unpublished range contains source,
tests, docs, and synthetic JSON/TS only: no MIDI/WAV/MP3/FLAC/PDF/image/model
binary, private key, credential, or protected source asset was found. The top
unpublished blobs are source files (largest `metal-arrange.ts`, about 175 KiB),
not media. Secret scanning found only intentional synthetic redaction fixtures.
There are benign local attachment/user-home path strings in a few historical
planning documents; no file bytes or credentials are embedded. They are retained
to avoid a non-fast-forward history rewrite during this backup.

## Research preservation

The durable path-free ledger is under
`docs/research/keyspilli-evidence/`: chronology, experiment JSON, reproduction
provenance, storage policy, and measured inventory. It preserves the direct-metal
failure, Defence reference/listening findings, OMR decision, seven-song benchmark
status (0/7 independent aligned candidates), AMT A/B evidence, and the
`EXTERNAL_SYMBOLIC_FIRST` boundary without copying protected notes or media.

## Private assets

The seven human-validated MIDI references, available score PDFs, supplied
Defence audio/reference files, and private recording/source directories remain
in private Downloads/work directories. SHA-256 values and retention decisions
are in the ignored `.local-artifact-retention-20260901.json`. No configured
independent private remote destination was found (no rclone remote, external
drive, or matching Drive/Dropbox/iCloud archive), so no private archive was
uploaded or copied.

## Cleanup disposition

Deletion is allowed only after branch/tag verification, the retention manifest,
and an open-handle check. Generated WAV/stem/listening packs, deterministic
twins, temporary OMR/raster output, and reacquirable model caches are candidates.
Active runtime/catalog data, private originals, accepted compact reference
corpus, unknown `/private/tmp` directories, and dirty worktrees are retained.
Bytes actually reclaimed and final free space are added after cleanup.

## Cleanup accounting and incident

The explicit deletion accounting is:

* generated/ephemeral first pass: `21,649,494,016` bytes;
* score/OMR/cache/duplicate second pass: `2,003,927,040` bytes;
* generated web build cache: `259,334,144` bytes;
* scratch/package-manager artifacts: `33,083` bytes;
* explicitly accounted total: `23,912,788,283` bytes (about 22.27 GiB).

The measured data-volume change was approximately 15.4 GiB free to 38.4 GiB
free (about 23.1 GiB more available; filesystem allocation and deletion
accounting differ because of APFS accounting). No private originals, active
catalog/runtime data, unknown paths, or shared package caches were deleted.

During cleanup, Finder's global **Empty Trash** action was accidentally
invoked. Generated Keyspilli Trash content was removed, but unrelated Trash
contents were not verified beforehand. No further Trash operations were
performed.

## Final verification (fill after cleanup)

* Remote branch before: `5d8728757a5f8b97bd301a7237b1c9cdccda7aac`;
  post-ledger checkpoint branch: `b426507589108c10cf42d58ca6e995ff38d5a048`;
  report-only closeout pushes advanced it through `c3653cb` and
  `2b9e728`; the terminal tip was verified by comparing
  `git rev-parse HEAD` with `git rev-parse origin/codex/metal-inference-lane-lock`.
* Checkpoint tag: `research-metal-evidence-2026-09-01`; remote tag object
  `2e7b05c920b07faec4775c699047ebb1e7fb48b1`, peeled target
  `b426507589108c10cf42d58ca6e995ff38d5a048`.
* Deleted categories/bytes: generated experiments and duplicate outputs
  `21,649,494,016` B; score/OMR/cache/duplicate set `2,003,927,040` B;
  web build cache `259,334,144` B; scratch/package files `33,083` B.
* Final free space: `40,289,048` KiB (about 38.4 GiB; `df -h` rounds to
  39 GiB).
* Fresh `npm test --workspaces --if-present`: passed — web 85, catalog 887,
  engrave 8, midi 306, player-core 92, transcribe 42; 1,420 tests total.
* Fresh `npm run typecheck --workspaces --if-present`: all six workspaces
  passed.
* `git diff --check`, final status, worktree prune dry-run, and branch/tag
  remote checks passed. The only retained untracked working file is the
  private `.tmp-source-audit/` directory; local manifests and runtime data
  remain ignored.
* Final Ponytail review: no executable was available, so the review was
  manual against the audit. The policy is one small ignored manifest plus
  path-free docs; no duplicate cleanup framework or code/dependency refactor
  was introduced. Package scratch files were removed; code/dependency
  simplifications remain deferred.

## Answers to the mission questions

1. Initial free disk: approximately 15.4 GiB.
2. Largest offenders: upstream-model experiment (6.60 GiB), shared uv cache (3.42 GiB), piano-final (1.63 GiB), repository (1.61 GiB), npm cache (1.20 GiB), pnpm cache (1.08 GiB), piano-coverage (1.04 GiB), section-listening (0.87 GiB), unknown melband-site (0.84 GiB), repository `data/` (0.80 GiB); see the measured JSON for the complete ranked list.
3. Major measured categories: Keyspilli `/private/tmp` 23.85 GiB, registered worktrees 2.45 GiB, selected shared caches approximately 6.12 GiB, repository 1.61 GiB, private Keyspilli Downloads about 265 MiB. The inventory's measured category totals were `EPHEMERAL_EXPERIMENT` 20.10 GiB, `PACKAGE_CACHE` 5.69 GiB, `GIT` 1.61 GiB, `UNKNOWN` 1.41 GiB, `WORKTREE` 0.45 GiB, and `MODEL_CACHE` 0.45 GiB.
4. Local commits missing from GitHub: 153 commits in the active topic range at mission start. Ten stale local branch names were separately audited; every tip was already reachable from another pushed origin ref, so no redundant branch refs were created.
5. Protected/private assets in unpublished history: none found.
6. Final verified GitHub branch SHA: the terminal remote topic ref was verified
   equal to local `HEAD` with `git rev-parse`; the exact terminal SHA is
   reported in the closeout response. The immutable checkpoint remains
   `research-metal-evidence-2026-09-01` at `b426507...`.
7. Checkpoint tag: `research-metal-evidence-2026-09-01` (verified remotely; peeled commit `b426507589108c10cf42d58ca6e995ff38d5a048`).
8. Preserved evidence: `docs/research/keyspilli-evidence/README.md` records direct-metal/source-aware and semantic-harmony conclusions, Defence reference/listening findings, the OMR/Audiveris/HOMR decision, seven benchmark status, AMT route results, architecture decisions, and alignment/readiness gates. `experiment-ledger.json` carries stable experiment IDs, commits, metrics, decisions, and report hashes; `reproduction-manifest.md` records model/tool/config boundaries; `storage-inventory.json` and `storage-policy.md` preserve measured storage and retention rules. Raw reports are represented by summaries/hashes, not media or copyrighted note arrays.
9. Private irreplacable assets: seven benchmark MIDI files, available score PDFs, supplied/reference Defence files, and private recordings/source stems still under active review.
10. Storage: private Downloads and bounded private work directories; no independent private remote was configured.
11. Deleted: generated WAV/stems/listening packs, deterministic twins, temporary OMR/raster/XML/transcription outputs, duplicate benchmark experiment outputs, selected reacquirable model/cache material, stale registered worktrees via `git worktree remove`, the generated web build cache, and untracked package-manager/scratch files. Private originals, active runtime data, unknown paths, accepted compact corpus, and protected output13 were retained.
12. Reclaimed per category: generated/ephemeral first pass `21,649,494,016` B; score/OMR/cache/duplicate set `2,003,927,040` B; build cache `259,334,144` B; scratch/package files `33,083` B; explicit total `23,912,788,283` B. The measured free-space delta was about 23.1 GiB.
13. Final free disk: `40,289,048` KiB, approximately 38.4 GiB (39 GiB in human-readable `df -h` output), above the 30 GiB floor but below the preferred 40 GiB.
14. Fresh full workspace tests: yes; web 85, catalog 887, engrave 8, midi 306, player-core 92, transcribe 42, all passing (1,420 total).
15. Initial Ponytail recommendations: remove dead `analyze2.ts`, unused/redundant dependencies/re-exports, untracked package-manager artifacts, `.DS_Store`, and consider alias shrinkage.
16. Applied recommendations: only precise local-manifest ignore rules and safe scratch/package-manager cleanup; code/dependency suggestions deferred.
17. Final Ponytail audit/review: no executable was available; manual final review found the new cleanup infrastructure minimal — one ignored local manifest, precise ignore rules, and four small path-free docs/JSON artifacts. No over-built storage framework, duplicate ledger, or new dependency was introduced; safety/provenance checks were retained.
18. Retention behavior: one external `KEYSPILLI_ARTIFACT_ROOT`, metadata on each run, 7-day ordinary expiry, immediate determinism-twin expiry, 30-day maximum for unreviewed listening packs, no expiry for private references, a 30 GiB disk guard, and fail-closed handling of unknown/active/private paths.
