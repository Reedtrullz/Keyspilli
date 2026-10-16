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

From the skill directory, use the packaged helper to create the existing
version-1 request directly from the selected files. Keep those files available
for later host admission, resume and verification.

```sh
python3 scripts/pin_preparation_request.py \
  --source /absolute/source.mid \
  --instruction /absolute/instructions.md \
  --title "Title" --artist "Artist" \
  --output /absolute/new-request.json
```

Use the returned `requestPath` as the host input, not the helper's stdout JSON.
The helper computes actual SHA-256 values, normalizes relative paths without a
shell, preserves instruction order and writes a new private request file. It
never overwrites an output, follows symlinks, writes inside its own package,
creates missing parents, or accepts parent traversal or ambiguous leading slashes.
Single-value options may appear only once; only `--instruction` is repeatable.
Its `--help` and `--self-test` require no checkout, provider or network access.

Repeat `--instruction` for one to eight real task instruction files. Their hashes
record those files, not the assistant's complete active instructions. When a
source hash is already frozen, pass `--expected-source-sha256` with that exact
value; a mismatch refuses the request instead of silently selecting new bytes.
A computed hash alone does not identify the composition, performance or rights.

For explicitly selected protected events, add `--phrase-plan /absolute/plan.json`
and follow [phrase protection](phrase-protection.md). This pins the raw plan;
it neither selects notes nor validates musical roles. An unselected inspector
proposal is not an approved protection plan. The maintained host still performs
MIDI/workload parsing, canonical source/plan binding and catalog collision checks.
A `pinned` result explicitly says `semanticAdmission: not-run`: it is request
construction, not preparation, musical acceptance or publication.

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
