# Exact-input recovery execution — 2026-10-12

This is execution evidence for bounded KS-17 and the KS-10 preparation support
for #119. It does not establish independent musical acceptance or close #119.
The implementation baseline was Wave 1 integration tree
`ce26eb0351f291c716a5fe37681c3c03714a9b2b` (local commit
`7d4aa00e2e076586947b67bf78c5488f2c91068b`). Node was 22.22.3.

## Actual current and historical inputs

The new `golden` CLI was executed against the actual checked-out
`catalog/chord-golden-corpus.json` and `catalog/chord-sources.json`, the explicitly
related October audit's retained `archive-selection.json`, the already available
September container, and the selected extracted note files. No archive was
downloaded or extracted during this implementation. Source files were read only
under the explicitly related local roots.

The retained container was exactly 33,227,049 bytes and matched SHA-256
`895426d0c86167f9aab5f432da9a8d60f3c24009c98e7278b45ab1053f451c8c`.

| Current golden composition | Current Advanced notes | Current timeline | Historical notes | Historical vs current notes |
| --- | --- | --- | --- | --- |
| Adele — Skyfall | Unavailable | Exact match | Exact historical match | Different bytes |
| Frank Sinatra — My Way | Unavailable | Exact match | Exact historical match | Different bytes |
| John Lennon — Imagine | Unavailable | Exact match | Exact historical match | Different bytes |
| The Beatles — Let It Be | Unavailable | Exact match | Exact historical match | Different bytes |
| Coldplay — Clocks | Unavailable | Exact match | Exact historical match | Different bytes |
| Katherine Cordova — Fix You cover | Unavailable | Exact match | Exact historical match | Different bytes |
| Gloria Gaynor — I Will Survive | Unavailable | Exact match | Exact historical match | Different bytes |
| Mary Hopkin — Those Were the Days | Unavailable | Exact match | Exact historical match | Different bytes |
| ABBA — The Winner Takes It All | Unavailable | Exact match | Exact historical match | Different bytes |
| Rousseau — All of Me cover | Unavailable | Exact match | Exact historical match | Different bytes |
| The Beatles — Help | Unavailable | Exact match | Exact historical match | Different bytes |
| The Theorist — Your Song cover | Unavailable | Exact match | Exact historical match | Different bytes |

Result: **0/12 current entries reproducible**, **12/12 current timelines exact**,
**12/12 historical note files exact for their declared historical membership**,
and **12/12 historical note hashes different from today's pins**. The older
snapshot is not a replacement input or evidence of a musical regression.
All existing corpus source/output pins remained unchanged; there are still
**zero `acceptedPlaybackSha256` pins**.

The finite initial request reserved the first three composition IDs: Skyfall,
My Way and Imagine. Both Original and Chords remain blocked for each. Missing
performance identity, source clock, current note bytes, output files,
code/config/renderer evidence and independent evaluators were not invented.
The local audit authorization deliberately had only `audit` scope, so review
permissions also remain explicitly blocked. No source correctness, source
completeness, listening or keyboard judgment was generated.

The `golden` command exited **2**, its documented useful blocked-report result.
The report retains every current and historical per-asset state, plus one
three-piece request and six separate mode bindings.

## Synthetic software package

The distributable fixture generator and the real `review` CLI were both run.
The fixture is self-authored one-note symbolic material plus generated sine
audio and simulated capture metadata. Its two MIDI/MusicXML streams parse, all
registered bytes resolve, and both mode packages have complete declared
software evidence. The package reports `synthetic-only`, zero provider calls,
and `musicalAcceptance: not-established`. The fixture supplies no actual Player
recording or musical evaluation.

## Validation

- Focused pre-change baseline: **34 tests passed in four files**, covering the
  existing artifact, fixture, listening and musical-review contracts.
- New tests: **26 passed in three files**, including exact/changed/missing bytes,
  ambiguity, absent/insufficient permission, root escape, read limits, historical
  mismatch, transformation dependencies, source-vs-code confusion, current
  golden inventory, distinct composition/mode constraints, source-only and
  partial receipts, changed renderer/receipt bindings, playback digest vs raw
  snapshot identity, complete synthetic CLI delivery, and private/no-overwrite
  output behavior. Test-first failures were retained before implementation.
- Catalog typecheck: **passed**.
- Full catalog suite: **1,312 passed, 10 failed; 139 files passed, 3 failed**.
  All ten failures reproduce the known environment's TSX executable Unix-IPC
  `listen EPERM` startup restriction. Eight are in `evaluate-metal.test.ts`, one
  in `research-song-cli.test.ts`, and one in `score-consensus-cli.test.ts`.
  No new evidence-tooling test failed. The new command uses `node --import tsx`.

Full repository integration is owned by the integration workstream. The results
above are catalog coverage and do not claim a fully passing repository suite.
No accepted pin repin, publication, deployment, catalog mutation, provider call,
installed-plugin replacement or copyrighted asset commit occurred.

## Independent review and completeness corrections

Independent review reproduced two material false-completeness cases through
the maintained CLI: a four-beat, 120 BPM snapshot with only half a second of
audio, and a malformed snapshot with a declared extent but no valid native
clock or note inventory. Self-consistently repinning the supplied declarations
had allowed both to prepare. The original reproductions and their earlier
successful CLI receipts were retained unchanged.

The corrected gate derives the required two-second duration from that actual
snapshot clock and validates the maintained Original and Chords event shapes.
It also checks recorder duration and sample rate against actual PCM frames,
rejects events outside the full output extent, checks export tempo and sounding
extent, and binds both modes to one publication family. The legacy recorder's
supported speed and transpose remain explicitly fixed at one and zero. Silent
export container padding and separately pinned tiers of the same publication
remain supported.

Follow-up validation used Node 22.22.3:

- **14 new regression cases failed before the correction** and passed after it.
  Three additional compatibility controls then passed.
- **43 focused tests passed in three files**, including all original exact-input,
  full-output and CLI tests; catalog typecheck passed.
- Re-running both retained malformed and truncated packages through the
  maintained CLI now exited **2**, with `status: blocked` and incomplete Original
  evidence. The unmodified valid synthetic package still exited **0**, with
  `status: prepared`, `synthetic-only`, and no musical acceptance.

These checks establish bounded structural and clock integrity. They do not
authenticate a supplied capture's origin, establish musical correspondence
between independently pinned files, or provide listening, source-correctness,
keyboard, or acceptance judgments. The actual 12-entry recovery inventory and
its unavailable current source bytes remain unchanged. Combined full-suite
verification belongs to the integration workstream; the historical full-catalog
result above was not reclassified as a new fully passing run.
