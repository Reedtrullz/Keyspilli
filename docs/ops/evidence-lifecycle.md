# Test and restore storage lifecycle

`deploy/keyspilli-evidence.py` owns new disposable test resources. Production
retention remains in `keyspilli-storage.py`; its backup lock, 6 GiB reserve,
image ceilings and recovery protections still apply. No blanket prune, volume
prune or Docker/containerd directory deletion is permitted.

## Entry points and ownership

| Producer | Lifecycle |
|---|---|
| `deploy/restore-drill.sh --ephemeral MANIFEST [--verify-app ID SHA SONG]` | Admits expanded archive + one acquired archive + three DB copies (input pool, snapshot and runtime) + 128 MiB overhead; plans reconstruction before extraction; reads the verified archive in place; seals results and releases scratch on every ordinary exit. |
| Positional `restore-drill.sh MANIFEST FRESH_DESTINATION ...` | Deliberate durable recovery export; checks destination space before creation and refuses existing destinations. It is **not** a disposable test API. Use `--ephemeral` for tests or run it inside a managed command when further pipeline/browser checks need the restored tree. |
| `.github/workflows/ci.yml` public-seed restore | Job ownership admission, unique image and builder, scratch-contained backup/restore, `always()` cleanup and evidence upload. |
| `.github/workflows/runtime-rehearsal.yml` | Same ownership across pinned piano-input acquisition, both native image builds, worker shutdown, restore canary and in-container sampled Player/export checks at1.5CPU. Verified piano bytes and allowlisted test sources are read-only; uploads mutate only the owned restore copy. Recordings, exports, raw results and reconstruction receipts stay outside disposable input trees. |
| `.github/workflows/tutorial-runtime-candidate.yml` | Same ownership across geometry/worker builds, CLI, synthetic tests and worker shutdown. |
| `deploy/test/access-boundary.sh` | Managed wrapper, isolated binds, registered Caddy containers, preserved results/configuration. |
| One-off preserved-production restores, dual pipeline runs and browser recorders | Use `run` below, with all copied inputs and writable catalogs inside `KEYSPILLI_SCRATCH`, and recordings/results inside `KEYSPILLI_EVIDENCE`. Historical scripts/trees under the October 16/17 evidence roots are frozen records, **not reusable entry points**. |
| `apps/web/scripts/evaluate-upload-chords.mts`, Playwright scratch catalogs, routing/fixture builders | On a shared host, launch under `run`; `TMPDIR` points inside owned scratch. Their managed teardowns leave generated catalog/database changes for sealing. CI reserves before edge/E2E and bundles traces/results. |
| `render-prepared-chords.mts`, `benchmark-score.ts` Audiveris scratch | Managed runs retain raw renderer attempts and OMR intermediates before disposal. Give the benchmark an output inside managed scratch/evidence outside the repository, as its existing contract requires. |
| `scripts/check-keyspilli-plugin.py` | Under `run`, duplicate package staging uses managed `TMPDIR`. Its required checkout-local synthetic smoke directory registers an exact same-filesystem inode lease before writing. Its `finally` collects the verified whole directory into managed scratch before ordinary teardown can remove the marker; raw controls are then sealed. Refused collection leaves the registered directory intact for recovery. Replaced paths and changed/missing markers still stop collection/export. The scrubbed child environment still excludes provider credentials and production data paths. |
| `scripts/retain-keyspilli-plugin.py` | Duplicate package staging uses managed `TMPDIR` when wrapped; verified exclusive candidate outputs are durable. The separate GitHub-hosted plugin compatibility lane retains its explicit reports and candidate artifacts for 14 days and discards its runner. It does not claim shared-host periodic recovery without `run`. |
| Prepared-song delivery, qualification corpora, benchmark/listening packs, catalog ingest/reingest and source acquisition | Their explicit outputs are durable product/evaluation inputs. They are not swept. Test copies belong inside a managed run. Existing qualified baselines and approval pins remain protected. |
| Production backup runner / publication buildx action | Existing scoped backup staging traps, verified cohort retention, deployment image pins, and buildx-action builder cleanup remain responsible. Release images and shared GitHub Actions dependency caches are not experimental test images. |

Replication's `.keyspilli-offhost-*` holds link committed immutable backup pairs
for reading only, under the existing backup/replication locks. They are recovery
pins, never writable test inputs or targets of this manager. Crash-held pairs
remain protected and reported by the existing storage policy.

Every new shared-host test/copy/build command must use this entry point. Adding
another ad-hoc `cp -a`, unregistered Docker build or persistent restore tree is
not an alternative. Never point it at an old evidence tree to adopt that tree.

```sh
sudo python3 deploy/keyspilli-evidence.py run --peak-bytes 4294967296 -- \
  python3 my-qualification.py

# Inside that command: verified, exclusive writable copies, never hardlinks.
python3 deploy/keyspilli-evidence.py copy /protected/input.mid case/input.mid
# Write mutable catalogs below $KEYSPILLI_SCRATCH.
# Write recordings, diagnostics and raw results below $KEYSPILLI_EVIDENCE.

sudo bash deploy/restore-drill.sh --ephemeral /backups/backup-manifest-STAMP.json
```

`run` prints its ID, outcome and remaining usage. Writer defaults use
`scratch/ID/data` and `scratch/ID/backups`; inherited catalog paths cannot
silently select live data. A child waits for durable ownership acknowledgement
before executing the requested command. The command's combined raw
stdout/stderr is retained in `evidence/ID/command.log`. The exit code survives
successful cleanup, including failure and cancellation; cleanup failure itself
is nonzero and recorded in `runs/ID/run.json`. Do not pass credentials in command
arguments. Docker output is streamed to its original stdout/stderr and retained
in separate raw log files. Only test tags are accepted for builds; aliases map
to unique run tags/names. Containers carry the exact run label. Each run gets a
private buildx builder and its state is removed through buildx, not filesystem
deletion. After each successful image import, the wrapper releases unused cache
from that exact private builder before the next image build. It verifies the
run is running and unpinned, the daemon identity, and the recorded builder
container/volume references. A foreign or replaced builder is refused. This
builder-scoped operation preserves imported images and their pins; no global
Docker prune is allowed. Failure or cancellation keeps the original build
result and leaves teardown to the existing finalizer/recovery path. Cache
release failures remain nonzero. Raw output and before/after free-byte readings
are durable evidence; those readings can also include unrelated host activity.
`BUILDX_CONFIG` is inside that run's scratch and is used explicitly by
both the original client and a different-user/root recovery finalizer. Writable binds must be inside that run's scratch; other binds are
read-only. All container references, extra image aliases/digests, backup image
pins and pending deployment metadata prevent image retirement.
Inherited mounts are rejected. Image-declared volumes receive owned writable
binds when the caller has not supplied a checked bind/tmpfs, so anonymous volumes
cannot accumulate. Container cleanup stops the writer, retains both final output
streams and exit state, then removes only that exact owned container.

## Bounds and retention

Default root: `/var/lib/keyspilli-evidence/managed-v1`, mode 0700. At most **one
unreleased run**; pins and unresolved cleanup errors retain the reservation.
Default aggregate managed evidence/scratch admission budget: **16 GiB**, with
**6 GiB free reserve** beyond each declared peak, and a **100,000 entry** ceiling.
Accounting uses the greater of apparent and allocated file size, includes leased
external fixtures, and never follows links. File-only runs attribute growth to
their owned paths; unrelated host writers still affect the minimum free reserve.
Runs with Docker resources also charge the filesystem's total free-space drop
as a conservative upper bound on image/cache growth outside the managed root.
CI image jobs reserve **12 GiB**
before building. Hosted admission additionally reserves a second copy of all
existing evidence plus the full writer peak, 16 KiB per permitted entry for tar
headers, and 16 MiB overhead. This protects bundle creation even if sealing
refuses; the finalizer uses this reserved capacity and uploads the bundle.
Each managed shell step uses the existing command supervisor to enforce the
reservation, retain its script/output, and stop its writer on overrun. Playwright
reports, recordings and traces are inside managed evidence. Buildkit has a private 4 GiB GC target; this is a cache target,
not a hard quota. Docker clients and `run` check filesystem headroom while
running and terminate their owned writer when the admitted peak/reserve is
exceeded. Checks can overshoot between observations; other host writers are not
under this policy's control. Choose a peak including source copies, extraction,
DB/sidecars, outputs, Docker transfer/uncompressed images and builder cache.
Nested copies and restores recheck headroom. Lack of headroom refuses before the
next copy/restore/build; it never triggers deletion of unrelated resources.

One verified, read-only content-addressed input copy is retained per distinct
SHA-256 in `inputs/`; reuse never depends on an external source or backup staying
available. These inputs are durable reconstruction pins and count against the
16 GiB budget. Retained experimental images referenced by recovery metadata are
reported as `retainedResources` and count at conservative uncompressed size;
periodic recovery rechecks them after the reference is explicitly retired.
Recognized backup manifests copied or used for a restore also receive a small
named snapshot under `evidence/ID/recovery-references/SHA/`. Its checksum is
verified at image retirement, so deduplicating or renaming a scratch manifest
cannot hide its image pins. These reference snapshots have no automatic expiry.
Unresolved image IDs hold image retirement; a data-only backup remains usable
for restoration. Native rehearsal records both actual web and worker IDs.

Scratch has zero retention after sealing. Unique data and reconstruction maps
have **no automatic expiry**. They count against admission, so repeated unique
results eventually stop new work instead of deleting evidence. Archive evidence
to an owner-approved durable destination and verify reconstruction before any
separate retirement decision. GitHub-hosted job artifacts have the explicit
workflow retention period (90 days); export required long-lived evidence before expiry.
CI runners themselves are disposable; shared-host recovery uses the timer.

Fixture-only budget overrides are `KEYSPILLI_EVIDENCE_LIMIT_BYTES`,
`KEYSPILLI_EVIDENCE_RESERVE_BYTES` and `KEYSPILLI_EVIDENCE_MAX_ENTRIES`. Production/default values must not be reduced
to make a real run pass. The former blanket 30 GiB test floor is replaced by
estimated peak plus the existing 6 GiB production reserve, as authorized by the
owner. This does not change any production image-size/deadline acceptance check.

## Sealing and reconstruction

The manager inventories regular files, rejects links/special files, records
hashes, ownership, modes and mtimes, then writes the reconstruction map **before**
moving or unlinking anything. A retry merges the earlier map. Unchanged inputs
are removed only while their acquired reconstruction source still verifies; changed
inputs, missing/tampered references, unknown files, databases/sidecars and raw
results move to `evidence/ID/files/` on the same filesystem. Sources inside the
scratch tree are redirected to their retained evidence location first. There
are no writable hardlinks. Archive references record the archive SHA, member
name and member SHA. The original archive is never a deletion target.

```sh
sudo python3 deploy/keyspilli-evidence.py recover
sudo python3 deploy/keyspilli-evidence.py pin RUN_ID 'current qualified candidate'
sudo python3 deploy/keyspilli-evidence.py unpin RUN_ID
sudo python3 deploy/keyspilli-evidence.py reconstruct RUN_ID /fresh/owned/destination
sudo python3 deploy/keyspilli-evidence.py bundle /fresh/evidence.tar.gz
sudo python3 deploy/keyspilli-evidence.py --root /fresh/imported import-bundle /path/evidence.tar.gz
```

Reconstruction verifies all references before creating the fresh destination,
refuses overwrites, writes independent files and verifies their hashes. It
restores metadata (ownership when root). Treat a reconstruction destination as
a deliberate durable export, or choose a managed run's scratch destination.
Do not remove a source/archive named in a retained reconstruction map.
Bundles contain the acquired inputs, raw results, run records, maps and any
unsealed scratch, without following symlinks. Import rebases owned references;
unsafe link/special-file entries remain diagnostic records rather than being
followed or activated. Import does not claim ownership of the origin host's
Docker resources or checkout-local fixture leases. Keep matching application images separately for an app replay.
CI attempts this preservation in `finally`, even when sealing fails; the job
remains failed. Export refuses to omit an uncollected checkout-local lease,
identifies its path, and leaves the original untouched; finish/recover it before
creating a portable bundle. Native run records/maps/payloads use file and directory fsync
ordering; tests simulate interrupted sealing, not physical power loss.

Cleanup and pin updates share one nonblocking flock. Managed VPS operations
also take the existing backup/deployment flock. Recovery checks owner PID/start
identity/boot identity. Live supervisors and pins are held. After a supervisor
crash, its verified child group is stopped before sealing; an unresolved group
keeps the run held. No claim about arbitrary escaped descendant trees is made.
After owned Docker resources are closed, native Linux cleanup checks process
FDs, mappings, working directories and remaining container mounts before file
release. Use root on shared Linux hosts; inability to inspect is a failure,
not proof of inactivity. The macOS fixture suite does not prove Linux `/proc`
or Docker behavior. Run the native qualification too.

`keyspilli-evidence.timer` runs recovery five minutes after boot and hourly.
It logs retained usage, free bytes and cleanup failures to the journal;
failures leave the unit failed and retain the reservation. Both Ansible entry
points stage/install the helper and units on a future authorized policy rollout.
Preparing this change does not install or activate them.

## Historical recovery exclusions

The October 17 cleanup report reclaimed 15.56 GiB across 18 inactive datasets.
Those partial trees remain intentionally incomplete; restore missing members
using their existing no-overwrite instructions before reuse. No legacy tree,
image or cache is implicitly owned by the new manager. Explicitly excluded:

- `/var/lib/keyspilli-evidence/305-native-20261016/preserved/runtime`
- `/var/lib/keyspilli-evidence/305-readiness-15cpu-20261016/final-native/data`
- `/var/lib/keyspilli-evidence/305-native-20261016/preserved/artifacts-2026-10-16-031337.tar.gz`
  (SHA-256 `57105581af88d27377bdd86a6f9a9c18cf9c3ff1ef69cdeb749e93a76547897e`)
- `/var/lib/keyspilli-evidence/storage-cleanup-20261017T005832Z/`, its
  `intent.json.gz`, member lists, completion records and `RESTORE.txt`.
- All existing reconstruction-map references, current candidates, qualified
  baselines, production/rollback images and unregistered resources.

## Verification

```sh
sudo python3 -B deploy/test/test-evidence.py
python3 -B deploy/test/test-storage.py
python3 -B deploy/test/test-backup.py
sudo python3 -B deploy/test/qualify-evidence.py /fresh/owned/qualification \
  --image sha256:EXISTING_VERIFIED_NODE_CAPABLE_IMAGE --source-tree "$(git write-tree)"
```

The last command builds tiny experimental images, runs a borrowed immutable
image without app/data access, repeats success/failure/success with a 32 MiB
immutable input, measures available filesystem and retained allocated bytes,
asserts no owned containers/images/builders remain, and proves reconstruction.
Supply `--source-tree "$(git write-tree)"`; the receipt also hashes every executed
helper/test source and checks that those hashes did not change during the run.
It retains raw results, one immutable fixture and the reconstruction proof;
the verified reconstruction scratch is released. It does not install a
policy, restart a service, publish an image, or change production data.
