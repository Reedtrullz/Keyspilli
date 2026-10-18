# Keyspilli artifact retention policy

Use one external root for generated work:

```text
KEYSPILLI_ARTIFACT_ROOT=/private/tmp/keyspilli-artifacts-<run-id>
```

The root is a convention, not a service. Every run should write a small
`metadata.json` containing `createdAt`, `gitCommit`, `purpose`, `reproducible`,
`protected`, and `retainUntil`. Keep paths out of tracked reports.

## Categories

* `DURABLE`: source, tests, small reports, hashes, ledgers, and decisions in
  Git.
* `PRIVATE_DURABLE`: user-provided benchmark MIDIs/PDFs/audio that must remain
  local and are never uploaded to the public repository.
* `CACHE`: reacquirable models, datasets, package caches, and downloaded
  candidates; remove when idle and a source/manifest remains.
* `EPHEMERAL`: WAV renders, stems, listening packs, intermediate MIDI/XML,
  determinism twins, and temporary OMR output.
* `UNKNOWN`: keep and investigate; no automated deletion.

## Expiry

Ordinary experiments expire after 7 days. Determinism twins expire immediately
after comparison. Unreviewed listening packs are retained until reviewed, for a
maximum of 30 days. Reviewed packs are deleted after the conclusion enters the
ledger. Private benchmark assets have no automatic expiry.

Before deleting any material, require: a measured size, a provenance/recovery
decision, no active file handle, a complete ignored retention manifest, and
verified Git branch/tag durability. Never delete tracked files, private assets,
unknown paths, or active runtime/catalog data by glob.

## Disk guard

Do not start expensive inference/rendering below 30 GiB free on the data volume.
Prefer at least 40 GiB before a large run. Inventory first, estimate expected
output, and stop on insufficient headroom. The cleanup mission does not install
a cleanup framework; standard `du`, `lsof`, Git worktree commands, and explicit
paths are sufficient.
