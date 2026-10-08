# Printed stanzas and explicit score form

This batch adds five stored and served bases to the named-section map and extends Doane's existing map. Expected coverage rises from 27 to 32 stored maps and from 25 to 30 of 441 served bases. The remaining 423 stored bases have no substantiated map; named bases can also retain estimated gaps. Processing or rejecting a candidate does not complete its naming.

Every entry pins the captured original source hash, actual production Advanced-note bytes and playback tempo. External score evidence remains `chart`; this batch contains no new FF06/FF07 source-marker maps, owner metadata, estimator changes or learner-block changes.

## Supported excerpts

| Base | Label and playback quarter beats | Evidence |
|---|---|---|
| Grieg, Ich liebe dich | Stanza1 excerpt 9..53.5 | Literal German stanza 1 block, ending at the next printed stanza change; complete text uniquely matches one retained timed lyric track. The parallel English text does not match and is excluded. |
| Comeau, Ellen's Song | To Ellen stanza excerpt 1.75..22.25 | Literal printed `To Ellen:` label and its entire multi-line lyric block uniquely match one track. The `To John:` block contains unsupported controls and is excluded. |
| Doane, Near the Cross | Stanza1 excerpt 0..45 | Complete labelled text before the explicit Refrain comment uniquely matches one timed track. Existing Refrain 48..96 and its previous evidence are preserved. Printed stanzas 2–4 share the same music and are not assigned sequential spans. |

The score companion MIDI for each excerpt matches the retained source bytes exactly. Independent Mido tick/pitch checks match every production pitched onset within 1/16 quarter beat on the source clock. Endpoints are the first and last matched lyric-cue onsets; the last syllable release and full form boundaries remain unresolved. These printed stanzas do not establish sequential performed verses or owner musical acceptance.

Sources: [Grieg](https://www.mutopiaproject.org/ftp/GriegE/O5/grieg-ich-liebe-dich/grieg-ich-liebe-dich.ly), [Comeau](https://www.mutopiaproject.org/ftp/ComeauO/ellens_song/ellens_song.ly), [Doane](https://www.mutopiaproject.org/ftp/DoaneWH/NearTheCross/NearTheCross.ly). The exact acquisition URLs and SHA-256 receipts are retained in each catalog entry; the private acquisition ledger preserves the original files.

## Explicit Verse/Chorus itinerary

Emmett's *Oh! Boatman, Haste!* score explicitly sequences `soloVerseA`, `soloChorusA`, `soloVerseB`, `soloChorusB`, `soloVerseC`, `soloChorusC`. Its seven opening bars and three-bar lead-ins remain estimated. In the printed 2/4 meter, each 17-bar verse occupies 34 quarter beats and each 8-bar chorus occupies 16:

| Label | Start | End |
|---|---:|---:|
| Verse 1 |14 |48 |
| Chorus 1 |48 |64 |
| Verse 2 |70 |104 |
| Chorus 2 |104 |120 |
| Verse 3 |126 |160 |
| Chorus 3 |160 |176 |

The four-bar tail 176..184 is also estimated. All six literal opening pitch/onset motifs uniquely match the retained MIDI at the calculated score starts. Independent Mido inspection matches 1228/1228 actual producer pitched onsets within 1/16 beat. The companion MIDI exactly matches the retained source bytes. Ordinals describe this explicit score sequence, and confidence 1 is an uncalibrated correspondence score rather than musical probability. The exact score URL, score hash, source hash and motif receipts are retained in the entry.

## Printed rehearsal locations

Fauré's *Les Djinns* score prints fourteen boxed rehearsal marks, A through N. Its explicit `format-mark-box-alphabet` includes I; the [LilyPond notation reference](https://lilypond.org/doc/v2.23/Documentation/notation/bars) describes that formatter. The unrepeated soprano voice uses a fixed 4/4 clock. A bounded duration reader locates the actual marks at beats 40,72,100,140,176,200,232,256,296,324,360,384,420 and 456, with the source ending at 496. The catalog labels are `Rehearsal A` through `Rehearsal N`; no conventional Verse/Chorus roles are inferred. Opening 0..40 remains estimated.

The score's MIDI companion exactly matches the retained source hash. Independent Mido inspection matches 3025/3025 actual producer pitched onsets within 1/16 beat, with maximum error 0.041667 beat. Seven parser tests cover inherited durations, explicit naturals, multi-bar rests, nested text markup and rejection of unsupported musical controls or comments without actual printed marks. Initial tokenization errors and their fixes are retained in private receipts. The [exact score](https://www.mutopiaproject.org/ftp/FaureG/O12/djinns/djinns.ly), its hash, formatter and all rehearsal beat anchors are pinned in the map.

## Preserved rejected research

Ten Sabaton *Defence of Moscow* stored bases share one verified original audio hash. Two complete chart paragraphs match publisher captions, and literal local ASR anchors corroborate the caption timeline. This establishes neither the original-audio-to-producer beat clock nor full musical boundaries. Independent review identified that missing link. A fixed original-audio attack test failed to distinguish the native clock from alternative offsets and scales for all ten bases. Those candidates remain unpublished and estimate-only; no offset was fitted, threshold relaxed or transcription retried.

Five chorus caption proposals were separately rejected for overlapping complete paragraphs or insufficient independent cue anchors. The original 13-map proposal, review finding, audio test and rejected candidates remain in the private research output.

The exploratory harmony inventory also exposed a research cost-comparison error: the helper already weights four-bar trials into eight-bar-equivalent units, so costs must be compared directly. A secondary inventory had incorrectly applied that factor twice. Both inventories and the correction are retained; no new public harmony map was derived from the invalid inventory.

## Validation and remaining scope

Fresh local audit passed with zero errors and the two preserved blocked-map warnings; typecheck, production build and all 2555 tests in 282 files passed for all five score maps and the 455-base ledger. Independent review passed the four initial maps and the Fauré/ledger addendum. The deployment layer repair also passed bounded independent review. CI, merge and live acceptance remain pending for this batch.

The bounded Fauré duration parser has seven adversarial checks. The private labelled-stanza parser has four adversarial checks; the complete-caption matcher has eleven; the separate audio-clock test has two, with its recording qualification explicitly failing; the score-itinerary helper has two. None replaces the repository audit, typecheck, test, build, independent review or live release gates.

The checked-in [455-base ledger](2026-10-08-section-all-base-ledger.csv) records every captured base, including the 14 hidden bases, map status, acquired evidence, parse errors and unresolved scope. Service flags refer to capture time. Harmony flags refer to the all-base solver pass, and rejection leaves naming unresolved. All 455 bases remain in the evidence ledger. This batch does not claim complete catalog naming, recording-time authority, artist form annotations, recognizability, playability or musical acceptance.

## Deployment storage repair

The preceding release stopped before container recreation because the VPS root filesystem filled during image acquisition. Its worker image copied the entire `/app` tree, including roughly 1.7 GB of Node dependencies, into one content-dependent layer. The production tutorial Dockerfile now copies the dependency directory separately from application and catalog files, preserving the same runtime tree and package versions. This allows unchanged dependencies to share a layer between releases; actual physical reclaim and live health require separate release evidence. An obsolete test candidate pair is being archived and verified before scoped removal; active images, explicit rollback tags, volumes, databases and backups are preserved.

Eight additional bases acquired two identity-checked saved charts each in the fourth acquisition pass. All eight were evaluated against the captured production notes. None has an eligible stable span in its minimum raw-cost assignment. Apparent stable spans in a higher-cost trial were not selected to force admission.

## Newly acquired complete lyric paragraphs

Sia’s *Chandelier* adds three `chart` excerpts: Bridge233.502083..298.002083, Verse301.002083..321.502083, and Bridge489.502083..554.002083 quarter beats. Complete normalized paragraphs (241 characters over five lines, and 78 over three) match exact retained MIDI lyric cue edges; repeated text receives no occurrence ordinal. Both acquired charts agree on the shorter Bridge paragraph; the Verse role is also consistent. A longer 445-character final Bridge overlaps the shorter paragraph and is excluded. All producer pitched onsets match raw MIDI quarter beats within1/16 beat, with maximum error0.04375 beat. These are bounded lyric excerpts; releases, full section downbeats and form boundaries remain estimated. The unchanged complete-paragraph matcher passes ten adversarial tests.

The fifth acquisition pass acquired twelve more bases and left twelve canonical chart searches unresolved. All twelve acquired bases were evaluated; none has an eligible stable span in its minimum raw-cost harmony assignment. Status Quo’s *Whatever You Want* has complete timed lyric correspondence, but the two acquired charts label the same paragraph Verse and Chorus. That disagreement rejects publication even though one chart’s notation prevents an exact normalized-text hash match in the other. In total,226 captured bases now have saved charts and219 have all-base harmony trials; acquisition and rejection do not establish naming completion.

The Sia and extractor addendum review passed after correcting two reporting findings: chart coverage now counts only captured bases, and the private current ledger includes acquisition passes four and five. Fresh audit, typecheck, all2558 tests in282 files, and production build pass for the final six-map edit scope, extractor regression fix and worker copy separation. Coverage is32 stored/30 served named bases;423 stored/411 served bases still lack a substantiated map.

The offline extractor now excludes exact `[Chords]` and `[Chord diagrams]` reference headings and clears the active passage at such a header. Three regression tests fail against the prior extractor and all six focused tests pass after repair. Five captured bases have affected charts; corrected trial sets are saved separately and none provides an eligible span at its minimum raw cost. A follow-up receipt destination initially pointed at the prior directory: its mixed snapshot was preserved, then all five original and corrected trial sets were reconstructed from unchanged inputs and checked for exact equality against their preserved ledgers. No map was admitted from these corrected trials.
