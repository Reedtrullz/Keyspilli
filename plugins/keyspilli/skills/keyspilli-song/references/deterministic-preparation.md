# Deterministic preparation checkpoints

Use this optional workflow for one completed, authorized local MIDI source when
the task benefits from a retained preparation checkpoint. Require
`deterministic_workflow.status: compatible` from `check_checkout.py` and use its
returned command prefix and absolute Node executable. Ordinary MIDI/XML/MXL
preparation remains available through `preparation.command`.

The deterministic wrapper reuses ordinary six-tier preparation, Chords
packaging, a fresh isolated installation and its idempotent second import. It
does not perform arrangement selection, source acquisition, model calls, audio
rendering or publication. The experimental `host_workflow` capability belongs
to a separate protocol; compatibility with one does not imply the other.

## Pin the actual request

Create a version-1 request using absolute paths and SHA-256 hashes computed from
the actual supplied bytes. Replace every example value below. Keep the source
and instruction files available for later resume and verification.

```json
{
  "schemaVersion": 1,
  "kind": "keyspilli-deterministic-preparation",
  "sourceMidi": {
    "path": "/absolute/source.mid",
    "sha256": "ACTUAL_SOURCE_SHA256"
  },
  "instructions": [
    {
      "path": "/absolute/instructions.md",
      "sha256": "ACTUAL_INSTRUCTION_SHA256"
    }
  ],
  "title": "Title",
  "artist": "Artist"
}
```

Use one to eight instruction files that were actually supplied for the task.
Their hashes record those files; they do not attest the assistant's complete
active instructions. To preserve explicitly selected source events, add
`phrasePlan: {"path": "/absolute/phrase-plan.json", "sha256": "ACTUAL_FILE_SHA256"}`
and follow [phrase protection](phrase-protection.md). The supplied hash binds
the raw file; the host also retains the existing canonical plan/source binding.
An unselected inspection proposal is not a valid protection plan.

Admission bounds the request to 64 KiB, MIDI to 16 MiB, PhrasePlan to 2 MiB and
each instruction file to 1 MiB. Unsupported formats or fields, stale pins and
an already mapped `upload-<sourceSHA>` identity are refused. Use ordinary
preparation for other supported source formats.

## Prepare, resume and inspect

Run from the selected checkout. Set `KEYSPILLI_NODE` to the absolute executable
returned by preflight. Choose a new directory under `output/song-prep`.
The checkout and run need consistent exclusive-create, atomic-rename and unlink
visibility between processes. Capability discovery does not certify that
filesystem behavior. If a removed lock or state file reappears, preserve the run
and use a new checkout/run on a consistent local filesystem; do not remove or
steal a lock to make resume succeed.

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/prepare-workflow.mts prepare /absolute/request.json output/song-prep/NEW-RUN --until prepared
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/prepare-workflow.mts resume output/song-prep/NEW-RUN
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/prepare-workflow.mts verify output/song-prep/NEW-RUN
```

Omit `--until prepared` to prepare and seal in the same invocation. The prepared
checkpoint already hashes its outputs. Resume validates that checkpoint and
reuses the same six-tier payload. Inspect the returned status and owned run;
retain the complete run, including failed attempts and exact input snapshots.

The host allows at most three preparation attempts in total, with at most one
attempt per explicit invocation. A known failed exit or handled interruption
may be retried only after its owned child process group has ended. Failed
attempts remain intact in separate directories. An ambiguous running record or
crashed lock requires a new run; there is no force, lock stealing or partial
output adoption. This is bounded checkpoint recovery, not general crash recovery.

Use `verify` for read-only inspection. It compares original inputs, retained
snapshots, working implementation/configuration/runtime pins and the complete
prepared payload. It may enumerate Git metadata but does not run preparation,
advance a stage, repair output or open a writable catalog. Changed or missing
original inputs, code/configuration, installed data or sealed artifacts require
a new run. Git HEAD/tree are provenance; actual working bytes determine drift.
A lockfile identifies declared dependencies, not every installed dependency byte.

## Interpret completion

Successful completion means provisional deterministic artifacts with structural
verification. Source correctness, listening, keyboard assessment and musical
acceptance remain unestablished. This prototype does not produce sampled-piano
previews or establish cost savings or cheap-model reliability.

The existing score-review command requires a real audio/replay manifest even in
offline mode. Keep that review unavailable until its actual evidence exists;
never fill its schema with invented audio, renderer or bank identities. Continue
the existing [delivery and musical gate](musical-quality-gate.md) with real
evidence, and apply existing publication authorization to exact output versions.
