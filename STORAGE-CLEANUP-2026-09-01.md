# Storage cleanup and remote durability — 2026-09-01

Status: in progress until the final verification block is filled below.

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

## Final verification (fill after cleanup)

* Remote branch before/after and verified SHA: pending.
* Checkpoint tag and verified target: pending.
* Deleted categories/bytes: pending; unknown/private paths were not deleted.
* Final free space: pending.
* Fresh `npm test --workspaces --if-present`: pending.
* Fresh `npm run typecheck --workspaces --if-present`: pending.
* `git diff --check`, branch/tag checks, and final status: pending.
* Final Ponytail audit/review: pending.

## Answers to the mission questions

1. Initial free disk: approximately 15.4 GiB.
2. Largest offenders: upstream-model experiment (6.60 GiB), shared uv cache (3.42 GiB), piano-final (1.63 GiB), repository (1.61 GiB), npm cache (1.20 GiB), pnpm cache (1.08 GiB), piano-coverage (1.04 GiB), section-listening (0.87 GiB), unknown melband-site (0.84 GiB), repository `data/` (0.80 GiB); see the measured JSON for the complete ranked list.
3. Major measured categories: Keyspilli `/private/tmp` 23.85 GiB, registered worktrees 2.45 GiB, selected shared caches approximately 6.12 GiB, repository 1.61 GiB, private Keyspilli Downloads about 265 MiB.
4. Local commits missing from GitHub: 153.
5. Protected/private assets in unpublished history: none found.
6. Final verified GitHub branch SHA: pending until push.
7. Checkpoint tag: planned `research-metal-evidence-2026-09-01`, pending until push.
8. Preserved evidence: direct-metal/source-aware and semantic-harmony conclusions, Defence reference/listening findings, OMR/Audiveris/HOMR decision, seven benchmark status, Demucs/Basic Pitch/BS-RoFormer/YourMT3+ oracle results, architecture and alignment gates.
9. Private irreplacable assets: seven benchmark MIDI files, available score PDFs, supplied/reference Defence files, and private recordings/source stems still under active review.
10. Storage: private Downloads and bounded private work directories; no independent private remote was configured.
11. Deleted: pending; only explicitly classified generated artifacts and safe scratch will be removed.
12. Reclaimed per category: pending.
13. Final free disk: pending.
14. Fresh full workspace tests: pending.
15. Initial Ponytail recommendations: remove dead `analyze2.ts`, unused/redundant dependencies/re-exports, untracked package-manager artifacts, `.DS_Store`, and consider alias shrinkage.
16. Applied recommendations: only precise local-manifest ignore rules and safe scratch/package-manager cleanup; code/dependency suggestions deferred.
17. Final Ponytail review: pending; it must confirm the ledger/policy is not an over-built storage framework.
18. Retention behavior: one external `KEYSPILLI_ARTIFACT_ROOT`, metadata on each run, 7-day ordinary expiry, immediate determinism-twin expiry, 30-day maximum for unreviewed listening packs, no expiry for private references, a 30 GiB disk guard, and fail-closed handling of unknown/active/private paths.
