# KS-16: bounded deterministic preparation host

Implementation ticket: [#273](https://github.com/Reedtrullz/Keyspilli/issues/273).
This implements the authorized thin deterministic host from the recovery roadmap.
The documented experimental `song-workflow`/`arrange-song` drivers are absent; their
decision and selection contracts are not this command's interface.

## Contract and boundary

`prepare-workflow.mts` exposes `capabilities`, `prepare REQUEST NEW_RUN [--until prepared]`,
`resume RUN [--until prepared]`, and read-only `verify RUN`. Version 1 admits one
actual MIDI with an explicit SHA-256, an optional explicitly selected PhrasePlan
with its file SHA-256, one to eight instruction files with explicit hashes, and
title/artist strings. Unknown fields and arbitrary stages, models, audio, provider
routes, and output destinations are rejected. Instructions are pinned context;
the host does not interpret them as executable commands or musical approval.

Limits before run reservation: request 64 KiB, MIDI 16 MiB, PhrasePlan 2 MiB,
instructions 1 MiB each. The MIDI parser and source workload guard validate actual
bytes. The maintained PhrasePlan compiler validates source hash, native clock,
events, and selected required protection. The canonical plan hash is also pinned.
The source base is `upload-<sha256>`; an existing entry for it in the repository's
global chord-source map is refused before any output is created.

A new private run is exclusively owned below this checkout's `output/song-prep/`.
Paths containing traversal, symlink ancestors, or nonregular files are refused.
The host snapshots exact input bytes and records original absolute paths. Resume
rechecks both originals and snapshots: a changed or missing original requires a
new run. Implementation scopes include ordinary workflow source scopes, catalog
data, and consumed package/tsconfig metadata. The hash describes actual working
bytes; Git HEAD/tree are separate provenance. A metadata-only commit with unchanged
effective bytes can resume. Node executable/path/version/ABI/platform and the
resolved TSX loader bytes are pinned; the lockfile is not an attestation of every
installed dependency byte.

## State machine and evidence

`admitted -> preparing -> prepared -> sealed` is the successful path. A preparation
attempt invokes the maintained `prepare-song.mts` in a new `prepare-NNN/work`
directory, then invokes the maintained bundle verifier before closing the stage.
That stage includes six-tier source intake, Chords preparation, bundle packing,
fresh installation, and the identical second installation. Its success additionally
requires expected fixed paths, six rows/tiers, bundle hashes, and the verified
installation marker. The host never adopts arbitrary paths from `result.json`.

Each prepared checkpoint already inventories and hashes the entire successful
payload, including SQLite files and any remaining sidecars. Finalization seals
those same bytes without repeating preparation. Inventory limits are 4,096 regular
files and 1 GiB aggregate. Missing, extra, changed, or symlinked payload files fail
integrity checking. Host `verify` parses bounded state/pins/checkpoints and hashes
bytes only: no lock, stage processes, catalog/SQLite imports, writes, or repairs.
Read-only Git enumeration (with optional locks disabled) discovers effective
source paths; it does not execute a preparation stage or open a catalog.

State replacement is atomic and mutation has an exclusive lock. Attempt count and
running state are durable before spawning. Three preparation attempts are allowed
over the entire run, at most one per invocation, with no automatic retries. A known
failed exit, timeout (10 minutes), or handled SIGINT/SIGTERM can become retryable
only after the owned process group is terminated and the direct child reaped.
Stdout/stderr are independently bounded to 1 MiB and record truncation explicitly.
An ambiguous running state, an abandoned lock, or uncertain descendant cleanup
fails closed. Timestamps and missing parent PIDs never justify lock stealing.
This supports known failure, handled interruption, and completed-stage resume;
arbitrary crash recovery is intentionally unsupported.

Completion means sealed provisional structural artifacts. Source identity,
listening, keyboard assessment, and musical acceptance remain unknown/provisional.
Offline score review is unavailable here because it still requires a real audio
manifest; no manifest, audio, bank, renderer, or acceptance is fabricated. There
are no model/provider calls, production admission, merge/deploy, or adoption of
the installed skill. Hashes are local change detection, not signatures against an
attacker who can rewrite the entire run and its implementation.

## Validation

Use authored synthetic MIDI with and without an actual selected PhrasePlan for
CLI integration through six tiers and both installations. Test prepared checkpoint
resume, unchanged verify at every stable state, exact pin/config/code/catalog
checks, payload/SQLite mutation, admission bounds and symlink/traversal refusal.
Use a controlled module runner for known failure/exhaustion and actual bounded
processes for concurrency, timeout, interruption, and process-group cleanup.
Fault controls are dependency injection in tests, never production CLI options.
