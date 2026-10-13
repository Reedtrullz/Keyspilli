# Source validation and exact repair authority

Source fidelity, agreement between exported scores, musical acceptance, and
publication authorization are separate results. A passed source landmark
describes that landmark. It does not authorize changing the rest of a phrase.

## Versioned reviewer receipts

`SourceValidationReceiptV2` adds `semanticBinding` to the existing source,
selection, reviewer, scope and timing fields. The binding contains:

- `schemaVersion: 1` for the semantic encoding.
- `timebase: "source-native-seconds"`, also declared by the source anchors.
- `clockSha256`, the hash of the score review's opened clock evidence file.
- `reviewedAnchorIds`, the exact reviewed event identities.
- `reviewedIntervals`, with phrase/occurrence identity and start/end seconds.
- `sha256`, computed by `sourceValidationSemanticHash(source, receipt)`.

The semantic hash covers the source identity, timebase, selection, mode and
difficulty, clock pin, reviewed IDs/intervals, and all note labels. A label
includes ID, phrase, occurrence, role, optional hand, pitch, onset, duration,
required status and ambiguity. Array order does not change the binding. Missing
`ambiguous` and `false` have the same meaning. The receipt-file hash separately
pins the reviewer assertion; it is not included in the semantic hash, avoiding a
self-referential digest.

Computing a digest is not reviewing music. A new or changed label set requires
new review evidence. Existing human assertions must never be rewritten by an
agent or automatically migrated to V2. V1 files remain readable historical
evidence. Offline score review reports their source authority as unknown and
does not produce source-authorized pitch previews from them.

Validate an existing receipt without writing an assertion:

```bash
node --import tsx apps/web/scripts/validate-music-source.mts \
  --receipt /absolute/reviewer-receipt.json --source /absolute/source-anchors.json
```

The command distinguishes `historical` V1 evidence (`repairAuthority: "none"`)
from a valid V2 binding (`repairAuthority: "exact-reviewed-events-only"`). A
source review is for its pinned source performance. Matching supplied MIDI
events does not identify a different requested recording or approve generated
accompaniment.

## Repair eligibility

The offline reviewer resolves each required, unambiguous reviewed label to
exactly one delivery event with the same role, occurrence, pitch, onset and key
release (and hand when the label declares one). Source-native seconds are
converted using the opened clock; transposition is applied once. Fuzzy landmark
matches, optional omissions, unreviewed neighbors, duplicate correspondences and
censored releases do not create repair authority.

That event must also have exactly one replay counterpart with identical onset,
key release, occurrence, role and declared hand. Multiple delivery notes sharing
those non-pitch attributes are ambiguous too. The software diagnostic's 5ms
tolerance and maximum matching algorithm never select a target for source
repair authority. Both the expected event and independently resolved replay
event are pinned into the authorization.

Only an eligible wrong-pitch discrepancy between supplied symbolic files can
become a bounded pitch preview. Player scheduling findings stay software
reproducers; provider observations stay advisory. The action pins the specific
expected and target events, source labels, clock, source/delivery/replay files and assignment
evidence. Preview creation requires that evidence and the unchanged target's
pitch, role, hand, onset, duration and occurrence. Historical actions lacking an
exact event authorization are refused.

The preview changes one pitch, preserves neighboring events, requires fresh
checks, makes zero catalog mutations and leaves musical acceptance
`not-established`. It grants no publication permission. The lower-level
`previewMusicRepair` is a local proposal compiler, not a source-validation or
publication gate; automated score-review repairs must use
`buildScoreReviewRepairActions` and `createScoreReviewRepairPreview`.

Regression controls include the unchanged V1 receipt with a rehashed pitch
label, a valid V2 note at 0 seconds beside an unreviewed note at 1 second,
label/coverage/clock mutation, duplicate correspondence, and an exact positive
repair with unchanged neighboring music. All reviewer identities in those
fixtures are explicitly synthetic.
