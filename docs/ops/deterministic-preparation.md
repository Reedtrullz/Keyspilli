# Deterministic preparation host (KS-16)

`apps/web/scripts/prepare-workflow.mts` is an optional bounded wrapper around the
maintained `prepare-song.mts` workflow. Its separate v1 contract accepts one pinned
MIDI, optional selected PhrasePlan, instruction files, and title/artist. It provides
durable preparation checkpoints and local byte verification. Ordinary preparation
remains available directly; this is not the absent experimental arranging driver.

Run from this host's own checkout root with the supported Node runtime and installed
locked dependencies. `capabilities` describes software support only. It neither
checks a musical result nor establishes provider, bank, renderer, or model access.

```bash
node --import tsx apps/web/scripts/prepare-workflow.mts capabilities
node --import tsx apps/web/scripts/prepare-workflow.mts prepare /absolute/request.json output/song-prep/my-new-run --until prepared
node --import tsx apps/web/scripts/prepare-workflow.mts verify output/song-prep/my-new-run
node --import tsx apps/web/scripts/prepare-workflow.mts resume output/song-prep/my-new-run
```

Select the explicit supported Node binary when the shell's `node` differs from the
checkout requirement. `TSX_DISABLE_CACHE=1` avoids TSX's optional loader cache. The
host constructs the preparation child's environment from a fixed list; it does not
forward Node/TSX hooks, provider credentials, or production data destinations.

## Request

The request JSON has exactly these fields. Replace each placeholder with the actual
lowercase SHA-256 of the original file. Missing pins are errors; the host does not
silently calculate and adopt a different input for an already written request.

```json
{
  "schemaVersion": 1,
  "kind": "keyspilli-deterministic-preparation",
  "sourceMidi": {
    "path": "/absolute/source.mid",
    "sha256": "<actual 64-character lowercase file SHA-256>"
  },
  "phrasePlan": {
    "path": "/absolute/selected-phrase-plan.json",
    "sha256": "<actual 64-character lowercase file SHA-256>"
  },
  "instructions": [
    {
      "path": "/absolute/instructions.txt",
      "sha256": "<actual 64-character lowercase file SHA-256>"
    }
  ],
  "title": "Supplied title",
  "artist": "Supplied artist"
}
```

Omit `phrasePlan` when none is selected. An unselected proposal is rejected: a plan
must bind the exact source, its native clock and real source events, and contain
explicit required protection. Instruction files are exact pinned context, not
executable instructions for the wrapper. They do not establish music acceptance.

| Input or inventory | Bound |
| --- | --- |
| Request JSON | 64 KiB |
| Actual MIDI bytes | 16 MiB |
| PhrasePlan file and canonical plan | 2 MiB each |
| Instructions | 1–8 files, 1 MiB each |
| JSON nesting | 64 levels; duplicate object keys refused |
| Title / artist | 256 characters each; nonempty and no controls |
| Working implementation | 4,096 files; 16 MiB per file; 128 MiB total |
| Payload | 4,096 regular files and 4,096 directories; 1 GiB total file bytes |
| Each attempt's stdout / stderr | 1 MiB each; discarded excess is counted explicitly |
| Preparation attempt | 10 minutes, plus bounded process-group cleanup |
| Whole run | 3 total preparation attempts; at most 1 per invocation |

Actual bytes determine the MIDI format, regardless of filename extension. Paths
must not contain traversal or symlink components. Original input descriptors are
absolute paths. A new run must be below `output/song-prep/`, outside fingerprinted
source scopes, and is reserved exclusively with mode 0700. An already mapped
`upload-<source SHA-256>` base in `catalog/chord-sources.json` is refused: the existing
Chords preparer reads that repository map even during an isolated run.

## Checkpoints and resume

Admission preserves original request/source/plan/instruction bytes under `inputs/`
and writes `admission.json` and `state.json`. Both original paths and snapshots must
remain present and unchanged for every later action. Moving a run or changing an
original, instruction, configuration, runtime or effective implementation requires
a new run. A metadata-only Git commit is compatible when effective bytes match;
the initial HEAD/tree remain provenance in the admission record.

Each attempt owns a new `attempts/prepare-NNN/work/`. The maintained command performs
six-tier Original intake, Chords preparation, bundle packing, fresh isolated install,
and an identical second install. The host then runs the maintained bundle verifier
inside that attempt, validates expected paths, rows, bundle manifest hashes and the
verified installation marker, and records a closure receipt. It never adopts a path
returned by the preparation command as a new destination.

Before `--until prepared` returns, `prepared.json` already seals the entire attempts
inventory, including source and installed SQLite files, retained sidecars, logs and
failed attempts. `resume` verifies those same bytes and writes the provisional final
seal without running preparation again. Completed-stage resume is also idempotent.

| Observed state | Permitted next step |
| --- | --- |
| `admitted` | Read-only verify, or one preparation attempt |
| `failed`, fewer than 3 attempts | Read-only verify, or explicit resume in a fresh attempt directory |
| `failed`, 3 attempts | Read-only verify; a new run is required for further preparation |
| `prepared` | Read-only verify, or seal the existing checked payload |
| `sealed` | Read-only verify or an idempotent resume |
| `invalid` | Inspect evidence and create a new run after addressing the cause |
| Mutation lock or ambiguous `preparing` | Preserve evidence and use a new run; no force, lock stealing or partial-output adoption |

A known failed exit or a handled SIGINT/SIGTERM/timeout is retryable only after the
owned child has been reaped and its inherited process group has demonstrably ended.
If cleanup cannot be proved, the lock and running state remain as evidence. A missing
leader PID or old timestamp is never proof that descendants stopped. This is bounded
failure/interruption/checkpoint resume, not arbitrary crash recovery.

## Verification and interpretation

`verify` is read-only for run and catalog bytes. It does not acquire a lock, increment
attempts, write reports, repair files, run preparation, import a catalog module, or
open SQLite. Read-only Git enumeration with optional locks disabled discovers
current working source paths; the rest is bounded JSON parsing and byte hashing.
Missing, extra, changed, symlinked or nonregular payload entries are rejected.

A valid incomplete run has JSON `status: "incomplete"`; a prepared checkpoint has
`status: "prepared"`. A sealed result has `status: "complete"`, `provisional: true`
and `completion: "structural-artifacts"` in its seal. `verify` exits successfully
for valid stable incomplete/prepared/sealed states; failed mutation attempts and
invalid/ambiguous checks return a nonzero exit status. Diagnostics are JSON on stderr.

Completion does not establish source identity, listening, keyboard assessment or
musical acceptance. Offline score review is explicitly unavailable for this request:
the existing offline review still needs a real audio manifest. No audio, reference
bank, renderer receipt, or approval is fabricated. The host makes zero provider calls
and performs no production admission or installed-skill adoption.

Implementation identity is SHA-256 of compact UTF-8 JSON `[[path,fileSha256],...]`,
using deduplicated sorted Git cached/untracked nonignored paths from the declared
workflow/catalog/package/tsconfig scopes. Actual working bytes, the selected Node
executable/version/ABI/platform and resolved TSX entry file are checked separately.
The lockfile is pinned as metadata; this does not attest every installed dependency
byte or enforce a network sandbox. Local hashes detect changes; they are not external
signatures against an actor able to rewrite the run, state and implementation together.
