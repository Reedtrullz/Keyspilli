# Local storage policy

The host keeps the **two newest complete, verified Keyspilli artifact cohorts**.
Each cohort includes a SQLite snapshot, artifacts/source archive and completion
manifest. Timestamp order determines retention; file mtime and a failed new
backup do not expire good recovery points. SHA-256, full archive readability,
gzip EOF and immutable read-only SQLite integrity are checked before retirement.
Unrecognized, corrupt, linked or open files are preserved and reported.

The archive includes artifacts, hidden reconciliation journals, seed MIDI,
uploads/transcriptions and the existing review/harmony stores. Live data is
never a retention target. A second backup within the same timestamp refuses to
overwrite a cohort. Canceled backups clean their own staging via traps; an
abandoned staging directory, uncommitted payload or unverified manifest blocks further backups until inspected. Retirement
persists verified identities in the manifest before unlinking payloads. A
subsequent locked cleanup resumes partial retirement only while two newer
verified cohorts exist. Remaining manifests continue to pin their images.

## Image protection and coordination

The original `/run/lock/keyspilli-backup.lock` serializes backups, pulls,
retention, image cleanup and layer reports. The full Ansible deployment also
owns `/var/lib/keyspilli-storage/deployment.json`, bridging separate SSH tasks.
Other backups/deployments/cleanup refuse while it exists. It never expires
automatically. A failed or canceled pull/deploy preserves the record and image
references. Healthy rollback can explicitly resolve it; a healthy accepted
candidate finishes it. Cleanup failure after service acceptance is reported
without rolling back a healthy release.

Cleanup protects:

- Every running or stopped container's exact image ID, across all projects.
- `keyspilli:rollback` and `keyspilli-worker:rollback`.
- Image IDs in all remaining backup manifests, including corrupt payload or
  partially retired cohorts and offhost replication's hardlinked manifests.
- The pending deployment's current/rollback/recovery images and candidates.
- Any image with an alias or digest outside the two Keyspilli GHCR repositories.

Only source-labeled Keyspilli images without those references are eligible.
The policy refreshes protections and aliases immediately before deletion and
uses Docker's exact IDs and checked aliases with `--no-prune`, without force.
No blanket prune, volume removal or Docker/containerd directory write occurs.
Ordinary successful operation retains at most four release pairs: current,
designated rollback and two backup pairs (often these overlap). Additional
stopped containers/operator aliases/ambiguous evidence are explicit exceptions
to the bound, reported instead of silently deleting recovery references.

## Admission and observation

Before a backup, eligible retention/cleanup runs first. The policy reserves
6 GiB plus 110% of apparent source bytes and 128 MiB overhead, and requires
10,000 free inodes. It checks again after pausing writers. Writers resume
before host retention verification. Insufficient remaining space refuses with
required/available byte and inode counts.

CI measures uncompressed image sizes from the published immutable registry
digests. Releases are limited to 2 GiB web / 4 GiB worker. Before each new pull
the VPS cleans eligible data and requires 3x that role's ceiling plus 6 GiB;
the multiplier covers transfer/extraction/store coexistence. Pulls use the
admitted registry digest and independently enforce the same role ceiling
on the VPS, logging both CI and host bytes. Docker's native overlay diff walks
extracted files while its naive path counts tar payload bytes: the reported
`Size` can differ for the same digest. CI therefore refuses unsupported image
stores rather than treating compressed containerd Size as uncompressed admission.
Already installed immutable releases can be reused without new extraction.
Manual new releases need the same `--sizes` and `--digests` admission.
Shared-host writes can still consume the reserve; admission is a conservative
precondition, not a filesystem quota or a bound on other applications.

The hourly timer runs cleanup and the read-only layer report. On overlay2 the
report reconciles API images, disk image configs, container mount records,
ancestor chains, process mounts and open file/mapping references. Unreferenced
registered layers are investigation candidates, with allocated bytes. Unknown
cache directories are reported separately. Unsupported drivers or incomplete
inventory never claim zero orphans. Orphan candidates make the service fail
visibly; no daemon restart/import/recovery deletion is automated. Interrupted
pulls/imports were plausible in the October 8 incident, but their cause was
not established. The report also compares retained releases' shared layer
prefixes. The production worker already separates its large dependencies;
the web build now isolates Chromium and avoids VERSION invalidating npm/apt.

## Commands

Install the policy without app recreation or secret access:

```sh
ansible-playbook -i deploy/inventory/hosts.yml deploy/storage-policy.yml
```

Inspect before cleanup (default is dry run), then apply:

```sh
sudo python3 /opt/apps/keyspilli/keyspilli-storage.py cleanup
sudo python3 /opt/apps/keyspilli/keyspilli-storage.py cleanup --apply
sudo python3 /opt/apps/keyspilli/keyspilli-storage.py status
sudo systemctl status keyspilli-storage.service keyspilli-storage.timer
```

For canceled work, inspect the pending record, running images/health, candidate
pull state and journals first. Confirm no pull/import remains active; never
delete the record to bypass a live operation. An explicit recovery command
requires its exact token and two healthy containers on protected images:

```sh
sudo python3 /opt/apps/keyspilli/keyspilli-storage.py resolve --token TOKEN
```

Inspect any `.keyspilli-backup-*` staging before removing only that failed
operation's files. Preserve unknown cohort payloads/sidecars and unique
recovery references. Replication hardlinks can temporarily pin an extra cohort.
The original script copies are in `/opt/apps/keyspilli/storage-policy-original`;
restoring them reintroduces the former growth policy and requires stopping the
storage timer and taking the shared lock. No offhost policy is changed here.

Focused tests: `python3 deploy/test/test-storage.py` and
`python3 deploy/test/test-backup.py`; run as root on Linux for full `/proc` open
file safety coverage. Fixtures include corrupt-but-hash-matching backups,
partial unlink/resume, container/rollback/manifest pins, unknown aliases,
lock contention, insufficient headroom and twelve bounded healthy cycles.
Live filesystem deltas and fresh layer/service inventories are recorded in
the task's deployment evidence, separately from fixture proof.

Docker semantics: [image removal](https://docs.docker.com/reference/cli/docker/image/rm/),
[build cache invalidation](https://docs.docker.com/build/cache/invalidation/).
