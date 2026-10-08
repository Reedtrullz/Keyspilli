# Archived scores and fixed opening lyric excerpts

This batch adds twelve pinned chart maps, increasing expected coverage from 35 to
47 stored bases and from 33 to 45 of 441 served bases. The 455-base ledger still
contains 408 stored / 396 served bases without a substantiated map. Most mapped
bases also retain estimated gaps. Naming across the whole catalog is incomplete.

## Archived score sources

The previous flat text scan missed archived LilyPond bodies, including the older
`.lyi` extension. A bounded inspection now covers 61 source members in 11 matched
score archives; the earlier incomplete scan remains preserved. Archive bytes and
member hashes are retained separately. This closes a research gap, without
turning acquisition or a rejected candidate into completed naming.

[Dukas Villanelle's archived score](https://www.mutopiaproject.org/ftp/DukasP/DukasVillanelle/DukasVillanelle-lys.zip)
prints eight actual rehearsal marks: A54, B253, C365, D469, E693, F797, G885 and
H1076 in quarter beats. F uses the explicit letter formatter with “a Tempo”.
Textual tempo commands are excluded from the mark count. The score's six meter
transitions at 0, 111, 151, 157, 997 and 1024 independently equal retained MIDI
events. All 2,274 producer pitched onsets match raw source pitches and quarter
beats within 1/16 beat, maximum error 0.041667. The map runs from each literal mark
to the next, ending H at the measured source/producer note end 1161. Opening
0..54 and the unpitched score/producer tail 1161..1164 remain estimated.

An independent review caught two issues in the private candidate generator:
accepted override prefixes could silently swallow appended music, and a field
called the producer count a source count. The reader now accepts only complete
supported statements, rejects hidden suffixes and passes seven controls. The
field is `producerPitchedOnsets`; the original failed checks and candidate are
preserved. The current pinned outline had no hidden suffix, so its anchors did
not change. Integrated recording-time correspondence failed and is excluded.

## Printed Czerny second-part headings

Six exact companion-matched Op840 archives print distinct second-part headings
using actual `mark markup` statements. These labels retain the score's language:

| Base | Literal heading | Conservative excerpt start | End |
|---|---|---:|---:|
| [No.1](https://www.mutopiaproject.org/ftp/CzernyC/O840/op840-1/op840-1-lys.zip) | C Moll. | 64.111979167 | 127.5 |
| [No.2](https://www.mutopiaproject.org/ftp/CzernyC/O840/op840-2/op840-2-lys.zip) | B Dur. | 48 | 95.5 |
| [No.3](https://www.mutopiaproject.org/ftp/CzernyC/O840/op840-3/op840-3-lys.zip) | C Dur. | 48 | 72 |
| [No.4](https://www.mutopiaproject.org/ftp/CzernyC/O840/op840-4/op840-4-lys.zip) | G Dur. | 96 | 191 |
| [No.5](https://www.mutopiaproject.org/ftp/CzernyC/O840/op840-5/op840-5-lys.zip) | C moll. | 48 | 79.5 |
| [No.6](https://www.mutopiaproject.org/ftp/CzernyC/O840/op840-6/op840-6-lys.zip) | A Dur. | 48.111979167 | 95.611979167 |

The heading and adjacent key command contain no intervening music. A matching
key event on each raw pitched track and a complete printed opening RH pitch and
rhythm landmark independently locate each passage. Six controls verify unique
two-track anchors, exclusion of zero/EOF events, textual-only intervening
commands, hidden suffix rejection, quote-aware heading braces and preservation
of landmark notes, rhythm and multiplicity. All producer pitched onsets match
the source within 1/16 beat, with maximum error across these bases 0.054688.

Each label ends with “passage excerpt” and uses custom/chart. The start is the
later of the two track key-event times: No.1 preserves its 64 versus 64.111979
track discrepancy, and No.6 retains the encoded delayed key event. The end is the
lesser of raw MIDI extent and actual producer note end. Earlier grace time,
initial parts and silent padding stay estimated. No.5 literally prints C moll
while its key command uses es major and MIDI metadata says E-flat; the label
reports the printed heading and does not claim an independently measured tonal
center. No first-part heading or unencoded repeat is invented.

## Fixed opening text

[Glover's score](https://www.mutopiaproject.org/ftp/GloverCW/thinkhome/thinkhome.ly)
explicitly attaches stanza 1 to `textA`. A separately specified study selects
exactly the first two nonempty lyric-source lines before matching, with no
alternate prefix lengths or word corrections. All 86 normalized characters
match one contiguous complete lyric-event window on MIDI track 2, at beats 0..24.
The map labels only “Stanza 1 opening lyric excerpt”. These source-code lines
are not asserted to be staff/system boundaries. All 236 producer pitched onsets
match source quarter beats within 1/16 beat. The last lyric-note release,
subsequent text and complete stanza boundary remain unresolved. Three selection
controls and ten existing lyric-event controls pass. The original full-stanza
failure remains unchanged and rejected; Adams's fixed prefix remains unqualified.

## Explicit named movements

Fischer's printed hierarchy is Muse of poetry / Erato / Allemande or Praeludium,
with movement numbers 2 and 1. The companion-matched scores support only those
explicit movement names, rather than generic tempo or standalone genre metadata.
The complete printed opening pitch/rhythm landmarks locate the retained traversal.
Erato Allemande runs 0..87.75, including only the score's encoded unfolded volta
repeats; Erato Praeludium runs 0..60. All 489 and 309 producer onsets respectively
match raw source quarter beats without error.

Streabbog's Les étoiles d'or / No. 1 Valse hierarchy supports No. 1 Valse from
3..241. Both MIDI staves explicitly begin with a silent `r2.` bar, so 0..3 remains
estimated. Their explicit C-G-C traversal is retained; the commented-out
`unfoldRepeats` command is not performed. All 431 producer onsets match within
1/16 beat, maximum error 0.010417. These three custom/chart maps name whole
explicit movements and establish no internal Verse/Chorus division. Leading
silence and padded tails remain estimated.

## Caption conflict and exact lyric correspondence

The retained base `nomy-cocaine` is captioned Nomy, while its raw lyrics match a
complete six-line Verse paragraph in the captured
[Eric Clapton/Cocaine chart](https://tabs.ultimate-guitar.com/tab/eric-clapton/cocaine-chords-63555).
All 85 normalized characters match one complete 26-event window on MIDI track 0
at 31..55.5. All 1,577 producer onsets match source pitches and quarter beats
within 1/16 beat. The map labels only “Verse lyric excerpt”, without the chart's
occurrence ordinal, releases or full Verse boundary. Its provenance explicitly
retains both artist captions and the unresolved identity conflict. It neither
establishes a source performer nor validates the Nomy caption or Nomy-specific
form; artist credits are unchanged.

Both original Nomy charts and the alternative Clapton chart remain unqualified.
The primary chart's 37-character Chorus matches textually but fails the unchanged
minimum-length rule. Failed original studies are not converted into acceptance.

## Release evidence and remaining scope

PR229 is fully live-verified at d52f6efde7ce1f417f4f8f2f449ac2e673defae8: eight
sample reads/two pins, 1,764 variants/441 bases/31 named bases, zero numbered
labels or read errors and a stable health commit. Both containers are healthy.
Selected identity fields remain 2,730 rows/455 bases with SHA-256
730063c30ac2039480e0f4ecbaa38108fb214d5f8f3dc146d7cc9da66cce3fd6.
The following worker build reused 13 cached steps and completed its bounded
cache export in 3.2 seconds; this is build evidence, not attribution of unrelated
VPS free-space changes.

PR230 merged at ec75564a3976f16cd9526c9a0f18a244ae5d4c64 after exact-head
Automatic checks/container smoke succeeded with CLEAN state. Its first CI attempt
failed the Practice-dialog keyboard-focus assertion. Two unchanged local focused
repetitions passed, followed by one successful failed-job rerun. The original
failure remains retained; assertions/timeouts were not weakened. Its deployment
and live acceptance remain pending here.

Public structured Songsterr scores were acquired for Keane, Girls/Girls/Boys and
What Was I Made For, using public musical metadata and source-referenced asset
URLs. No account credentials, paid activation or transcription calls were used.
Keane's complete correspondence was too weak. The supported Girls/Girls/Boys
synth-string passages had no complete literal rhythm/pitch match; unsupported
techniques and drum parts remain unqualified. What Was I Made For had no literal
form marks. Seven reader controls pass; no map was admitted from these scores.

All additions pin original source bytes, actual production Advanced-note bytes
and playback tempo. Confidence 1 describes uncalibrated correspondence, not
musical probability, full-boundary certainty or owner acceptance. Evidence remains
chart. No owner metadata, learner blocks or estimator changes are made.
Independent whole-diff review passed with all 35 previous entries unchanged and
all twelve additions exactly matching reviewed candidates. The prescribed local
section audit passed with zero errors and two pre-existing blocked-map warnings;
typecheck, 2,558 tests across 282 files and production build passed. CI and live
acceptance remain pending for this batch. The broader inventory remains 234 captured UG
chart bases, 227 harmony trials, 108 matched score sources, 418 original byte
matches, 37 original sources unfound in inspected paths and two preserved parse
errors. Further source acquisition and correspondence work remains necessary.
