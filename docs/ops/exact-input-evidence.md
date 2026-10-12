# Exact local inputs and full-output review preparation

This workflow implements bounded local recovery support for KS-17 and prepares
evidence for the remaining independent musical review in #119 / KS-10. It reads
explicit local files, verifies exact bytes, and creates a new private report
directory. It does not recover unavailable music by substitution or change
accepted corpus pins.

Use the checkout's supported Node, currently 22.22.3:

```sh
KEYSPILLI_NODE=/absolute/path/to/node
"$KEYSPILLI_NODE" --import tsx packages/catalog/scripts/exact-input-evidence.ts --help
```

The workspace script is `npm run audit:exact-inputs -w @keyspilli/catalog -- ...`.
Its `node --import tsx` invocation avoids the TSX executable's IPC-server startup.

## Resolve an exact local registry

Keep the real registry and musical assets in private local storage. Register
SHA-256 identities and explicit relative paths under named roots. A conventional
object path is `sha256/<first-two-hex>/<full-sha256>`; `exactObjectPath()` computes
it. The resolver reads only listed locations. It never enumerates a source root,
extracts archives, downloads assets, or changes the object store.

```sh
"$KEYSPILLI_NODE" --import tsx packages/catalog/scripts/exact-input-evidence.ts audit \
  --manifest /private/run/registry.json \
  --purpose audit \
  --root inputs=/private/authorized-inputs \
  --output /private/run/new-audit
```

`resolve` is an alias for `audit`. Both verify the bytes before reporting a
location as available. Multiple identical copies are acceptable. Conflicting
observed bytes at listed candidate locations yield `ambiguous`, even when one
candidate happens to match the requested pin. Missing candidates are never
replaced by similarly named files.

The `keyspilli-exact-input-registry` schema is defined in
`packages/catalog/src/exact-input-evidence.ts`. An asset has:

| Field | Meaning |
| --- | --- |
| `id`, `sha256`, `bytes` | Stable logical ID, exact raw-byte SHA-256, expected byte length or explicit `null` when not recorded |
| `role` | `source`, `output`, `code`, `config`, `renderer`, `receipt`, `clock` or `metadata` |
| `permission` | Explicit basis, permitted `audit` / `review` scopes, and the supporting statement; `null` or omission remains blocked |
| `locations` | At most eight `{rootId, path}` candidates; paths are relative and cannot escape an explicitly supplied root |
| `snapshots` | Declared `{snapshotId, member}` memberships; the member pin must equal this exact asset hash |
| `transformation` | Optional input IDs and separate code/config/renderer IDs; dangling references, cycles and wrong identity roles are rejected |

Permission assertions describe the supplied authorization; they do not
authenticate a rights holder or establish legal rights. For example, an existing
authorization limited to isolated local auditing can be represented as:

```json
{
  "basis": "user-authorized-local",
  "scopes": ["audit"],
  "evidence": "Identified authorization for these specific files and this local audit."
}
```

This declaration does not permit review or redistribution. The command requires
the requested scope before opening asset bytes. A missing/unknown basis, blank
supporting statement or missing scope yields `permission-blocked` per asset.
Supported basis values are `self-authored`, `licensed`, `user-authorized-local`
and `unknown`.

Snapshots contain their identifying manifest digest and a bounded member list.
The member list records declared membership. Byte availability and an optional
archive-container check are separate observations; an exact archive digest alone
does not prove an extracted file was read or that it matches today's input pin.

The fixed limits are 256 assets, 32 snapshots, 1,024 members per snapshot,
16 named roots, 256 MiB per file and 1 GiB of inspected bytes per audit. Files must
be regular and remain unchanged while read. Symlinks cannot escape the supplied
root. Module callers can lower the byte budgets, not raise them.

`audit.json` lists every asset as `available`, `unavailable`, `mismatch`,
`ambiguous`, `permission-blocked` or `historical-mismatch`, with candidate hashes
and specific read reasons. Its stable digest binds the normalized registry,
purpose, statuses and observations. The report omits absolute local paths;
`local-roots.json` retains the explicit mapping privately for another local run.

## Verify an earlier audit

```sh
"$KEYSPILLI_NODE" --import tsx packages/catalog/scripts/exact-input-evidence.ts audit \
  --manifest /private/run/registry.json --purpose review \
  --root inputs=/private/authorized-inputs \
  --previous /private/run/prior/audit.json \
  --output /private/run/rechecked
```

`comparison.json` reports `unchanged` only for complete, valid, identical audits.
Changed bytes, permission declarations, configuration, review receipts or other
registry content invalidate reproducibility. Repeating an incomplete audit is
still blocked. The command does not rewrite the original receipt or expected
hash to match new bytes.

## Inspect current goldens and an explicitly supplied historical snapshot

```sh
"$KEYSPILLI_NODE" --import tsx packages/catalog/scripts/exact-input-evidence.ts golden \
  --golden catalog/chord-golden-corpus.json \
  --sources catalog/chord-sources.json \
  --permission /private/local-audit-permission.json \
  --root current=/absolute/Keyspilli \
  --historical /private/selected-archive/selection-manifest.json \
  --root archive=/private/selected-archive \
  --archive-file /private/keyspilli-chords-review-data-2026-09-27.tar.gz \
  --output /private/new-golden-inventory
```

The historical input uses the existing audit selection format:
`{archiveSha256, files: [{name, bytes, sha256}]}`. `--archive-file` is optional and
checks that exact local container without extraction. The adapter registers only
the historical note members relevant to the current golden entries. It also
pins the raw corpus, source-map, permission and historical-index bytes.

`golden-report.json` preserves each current notes/timeline pin and each accepted
backing/playback pin independently. It lists current input availability,
historical input availability, and historical/current mismatch separately.
An `acceptedBackingSha256` or a bounded `acceptedEndBeatExclusive` cannot become
full playback acceptance.

The command also writes one finite `review-request.json` and
`review-package.json`. By default it reserves the first three composition IDs in
the supplied corpus. Up to three explicit `--select BASE_ID` flags can choose a
different initial batch. Selection does not imply representative coverage or
reviewer approval. Unknown performance, clock, renderer and delivered-file
identities remain `null`, with individual blockers. No sentinel hash stands in
for missing real evidence.

## Prepare a complete package for an independent evaluator

The `FullOutputReviewRequest` type in
`packages/catalog/src/full-output-review.ts` accepts one to three distinct
composition families. Alternate performances of the same composition belong in
one family, not separate batch slots. Each piece binds its selected performance,
source asset, source-native time extent, source clock file, code/config/renderer,
and exactly one Original and one Chords mode.

Each mode declares the existing `MusicalOutputIdentity`, the complete output
extent, and independent asset IDs for:

- Original/Chords MIDI;
- Original/Chords MusicXML;
- actual Player snapshot;
- actual Player capture receipt;
- captured final PCM16 WAV;
- the capture plan identifying mode and variant.

The existing `keyspilli-player-capture` receipt omits mode, so the separate plan
is required. Its `mode` and `songId` must match the mode's receipt identity.
Recorder frame clock, sample asset pins, WAV byte hash, sample rate, frame count,
duration, capture offset and complete output coverage are checked. Digital-zero
captures remain diagnostic. Both audio and recorder metadata must match the
actual WAV frames. Native tempo, meter, note/chord inventory and any supported
source-pedal timeline are validated in the existing snapshot shapes. Original
may omit `chords`; Chords includes its independently resolved note and chord
streams, with explicit chord durations and suggested hands. Malformed, empty or
out-of-extent sounding inventories cannot count as complete evidence.

Required recording time is derived from the snapshot as
`endBeatExclusive * 60 / tempoBpm`, then combined with the separate capture
offset. Echoing a shorter duration in several files cannot establish coverage.
The currently maintained legacy recorder explicitly sets speed to `1` and
transpose to `0`. Other speed/transpose claims are blocked because that recorder
does not apply corresponding plan options. A snapshot with a native tempo map
is also unsupported; current Player snapshots already use a constant beat clock.

MIDI and MusicXML must parse, use the snapshot's tempo, and cover the declared
beat extent. Every sounding exported event and supported pedal tail must fit
within it (allowing one 480th of a beat for export tick rounding). Extra silent
container padding does not extend the declared playback. Musical correspondence
between those exports, the source and recorded audio remains a separate review
gate. Both modes must identify the same base and publication revision. Original
can use a different difficulty tier; modes using the same tier must also agree
on its source fingerprint.

The pinned output clock JSON has `basis: "resolved-playback-seconds"`,
`endBeat`, `endSeconds`, `captureOffsetSeconds`, `speed`, `transpose`,
`audioSha256` and `snapshotSha256`. The last field identifies the raw snapshot
file. Preserve any pre-existing event/tempo clock metadata as additional fields;
an event digest is not silently reinterpreted as a snapshot digest. The source
clock file is independently pinned opaque metadata: the command does not infer
a source/output alignment from its title or an output tempo.

The existing `identity.playbackSha256` remains the SHA-256 of
`JSON.stringify(snapshot)` used by `owner-admission.musicalHash`. Raw snapshot
file bytes are pinned independently in the registry. Pretty-printing a snapshot
therefore changes its evidence binding while preserving the established
playback-identity convention. No accepted playback digest is repinned.

```sh
"$KEYSPILLI_NODE" --import tsx packages/catalog/scripts/exact-input-evidence.ts review \
  --manifest /private/complete-inputs/registry.json \
  --request /private/complete-inputs/review-request.json \
  --root inputs=/private/complete-inputs \
  --output /private/new-review-package
```

The package includes a `full-output-PIECE-MODE.json` binding for each mode, with
exact hashes for all supplied evidence and its transformation dependencies. The
file is written in canonical JSON without a trailing newline, so its raw-byte
SHA-256 equals the binding reference in the generated receipt template. The
`pending-full-output-PIECE-MODE.json` template uses the existing
`musical-review-receipt` schema with blank reviewer identity, role, independence,
date and rationale. It becomes a valid receipt only after the responsible
reviewer supplies those fields and their actual scoped judgments. The tool never
fills them on the reviewer's behalf.

To examine completed existing receipts, register each immutable receipt as a
`receipt` asset and list its ID in that mode's `receiptAssetIds`. Every completed
source/listening/keyboard check must reference the unchanged full-output binding;
other referenced evidence must also resolve to its exact local bytes. The
command reuses `parseMusicalReviewReceipt`, `sameMusicalOutput` and
`summarizeMusicalReviews`; it does not install a parallel approval system.
Coverage beyond the exact output is refused. Partial coverage remains partial,
and Original and Chords judgments cannot approve each other.

The separate reported fields are:

| Field | What it can establish |
| --- | --- |
| `evidenceCompleteness` | Required exact files, provenance dependencies and declared full-output extent are present and consistent |
| `sourceCorrectness` | The existing source-check result in current, independently declared, version-bound receipts |
| `sourceCompleteness` | Always `not-established` by this preparation tool; source labels or artifact retention do not prove the chosen source is complete |
| `listening`, `keyboard` | The existing independent receipt checks, with mode, tier and coverage preserved |
| `declaredReviewStatus` | Summary of supplied attestations, including pending, partial, rejection and conflict |
| `musicalAcceptance` | Always `not-established` by package generation |

Reviewer identity and independence are declarations, not authenticated by these
commands. Legacy non-independent owner observations remain available as pinned
receipt files and are identified as observations, without being counted as the
missing independent evaluation. Changed exports, renderer/configuration,
upstream dependencies or evidence bindings invalidate old checks even when the
existing playback digest happens to stay unchanged. Source approval alone never
approves newly composed backing.

## Distributable synthetic example

The fixture generator is entirely self-authored and uses one four-beat source
with both MIDI/MusicXML outputs. Its WAV is generated sine audio and its capture
receipt is simulated; it is not an actual Player capture. The fixture is
explicitly `synthetic`, creates no completed review receipts, and cannot establish
musical acceptance. It exercises the complete software package without shipping
copyrighted songs or sample banks.

```sh
"$KEYSPILLI_NODE" --import tsx packages/catalog/test/fixtures/create-full-output-fixture.ts \
  /private/new-synthetic-inputs
"$KEYSPILLI_NODE" --import tsx packages/catalog/scripts/exact-input-evidence.ts review \
  --manifest /private/new-synthetic-inputs/registry.json \
  --request /private/new-synthetic-inputs/review-request.json \
  --root local=/private/new-synthetic-inputs \
  --output /private/new-synthetic-review
```

Expected result: two complete software evidence modes, `synthetic-only`,
`musicalAcceptance: "not-established"`, and zero provider calls. Real preparation
uses the actual source and delivered output files; a simulated receipt cannot be
reclassified into real evidence.

## Exit and write behavior

- Exit 0: requested software report/package was prepared with its applicable
  byte gates satisfied; a synthetic package is still explicitly synthetic.
- Exit 2: usable report written with unavailable/blocked/incomplete evidence or
  an invalidated prior audit. This is the expected current-golden recovery result.
- Exit 1: malformed request, unsupported option, read/validation exception or an
  existing output directory. No existing output file is overwritten.

Reports use a new directory with mode `0700` and files with mode `0600`. The
manifest, root mapping and receipt files can contain private source identities.
There are no network/provider calls, automatic repair retries, catalog writes,
reviewer contacts or publication operations in this command.
