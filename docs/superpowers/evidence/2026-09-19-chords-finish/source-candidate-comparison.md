# Source candidate comparison — 2026-09-19

This is a read-only comparison of the pinned canonical artifacts under
`/Users/reidar/Projectos/Keyspilli/data`. The “candidate” is derived in memory
from the current MusicXML `staff=1/voice=1` lane, mapped to the stored R-hand
notes, and run through the existing `selection: "right-hand"` producer path.
It is a hand-override comparison, not independent source recovery, semantic
approval, or a production data change.

Reproduce it with Node `v22.22.3`:

```sh
export PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH
npx tsx docs/superpowers/evidence/2026-09-19-chords-finish/source-candidate-comparison.ts
```

The full-song comparison and the algorithmically selected worst 12-beat
window use a shared controlled comparison tempo of `108 BPM` (`6.667 seconds`
per 12-beat window). Physical playability diagnostics are also reported at the
target tempos: Queen `108 BPM`, Oops `95 BPM`, and Blackbird `120 BPM`.
Chord labels are held constant from the canonical `auto` source; this isolates
melody identity selection and does not treat inferred chord labels as
independent harmonic truth.

## Candidate versus current

| Target | Target BPM | Current automatic: melody / output / unresolved / fallback beats | Derived upper-staff hand override: melody / output / unresolved / fallback beats | Shared / differing melody source IDs | Worst 12-beat window: current / derived / shared / differing IDs |
|---|---:|---:|---:|---:|---:|
| Queen — Somebody To Love | 108 | 784 / 2072 / 182.375 / 223.625 | 1234 / 2345 / 0 / 160 | 592 / 834 | `[48,60)`: 35 / 76 / 31 / 49 |
| Oops I Did It Again | 95 | 572 / 1438 / 42.625 / 114.25 | 1435 / 1895 / 0 / 78.25 | 455 / 1097 | `[240,252)`: 25 / 92 / 25 / 67 |
| Blackbird | 120 | 554 / 1041 / 38.125 / 54.75 | 548 / 1067 / 0 / 17.75 | 460 / 182 | `[264,276)`: 29 / 34 / 20 / 23 |

The derived candidate’s zero unresolved beats are expected from forcing the
existing staff/voice lane through right-hand override semantics. They are not
evidence that the original melody has been recovered.

### Queen raw `-CANTO-` candidate A/B

The raw MIDI provides a second, materially different candidate that does not
depend on the stored L/R split: FF01 `-CANTO-`, track `5`, channel `3`, with
`278` notes. It is evaluated as a disposable raw vocal-lane candidate, not
declared to be the learner melody.

| Whole-song 108 BPM diagnostic | Current automatic A | Raw `-CANTO-` candidate B |
|---|---:|---:|
| Melody / output events / attacks | `784 / 2072 / 963` | `278 / 278 / 278` |
| Unresolved / fallback beats | `182.375 / 223.625` | `0 / 540` |
| Median IOI / max simultaneous-sounding | `0.277778s / 6/7` | `0.289444s / 1/2` |
| Worst top-voice leap | `32 st @ 84.722s` | `12 st @ 13.041s` |
| Worst 0.5-second attack window | `30.833–31.333s / 8` | `74.505–75.005s / 4` |

Raw candidate B covers only `167.333333` active beats of the `540`-beat song,
with `17.494792` intro-rest beats, `116.807292` outro-rest beats, `372.666667`
total rest beats, maximum polyphony `2`, and `0.427083` overlapping beats.
The `540` fallback beats are expected because the candidate has no separate
source-support lane; this is a raw vocal line, not a finished accompaniment.

At the existing current-vs-derived bounded window `[48,60)` beats (selected
before evaluating CANTO and therefore not a CANTO holdout), A has `92` notes /
`40` attacks, median IOI `0.069444s`, and max simultaneous/sounding `6/6`;
B has `17` notes / `17` attacks, median IOI `0.280556s`, and max
simultaneous/sounding `1/2`. This is an honest bounded A/B diagnostic, not a
musical acceptance result.

The one-to-one raw-to-canonical comparison used `0.125` beat onset and
duration tolerances. Of 278 raw CANTO notes, `233` found an onset-aligned
canonical note: `116` matched pitch/onset/duration, `117` required a transform,
including `88` onset-aligned pitch conflicts and `29` duration mismatches.
`45` raw notes had no onset-aligned match; `2140` canonical notes remained
outside this one-lane candidate. Mean matched onset and duration deltas were
`0.025192` and `0.351529` beats. These losses are evidence for review, not an
automatic rejection or promotion.

The raw PIANO/CHOIR activity comparison is also preserved without assigning
either role as melody: PIANO has `415.9375` active beats (intro `4.994792`,
outro `5.140625`, max polyphony `6`), CHOIR has `186.453125` (intro
`47.994792`, outro `5.390625`, max polyphony `4`), with PIANO-only
`246.052083`, CHOIR-only `16.567708`, and shared-active `169.885417` beats.
This is a source-layer handoff comparison only.

### Current importer replay and source lineage

The diagnostic now replays the real standard-MIDI path in memory: `parseMidi` →
tempo normalization → `buildVariants` with the current learner profile and
development-only trace. It pins the canonical notes, MusicXML, and raw MIDI
input hashes for all three targets before evaluating them. Queen’s MIDI tempo
events require the same normalized beat-clock conversion used by the importer;
the CANTO sidecar therefore carries FF01 `-CANTO-`, raw track `5`, channel `3`,
and maps its raw note tuples to the current trace roots after that conversion.
All 278 CANTO roots map uniquely; no track identity was inferred from nearest
canonical pitch.

The current replay and stored artifact are not byte-equivalent: replayed
Advanced has `2369` notes while the stored artifact has `2373`. That drift is
reported rather than used to back-project current trace lineage onto the older
artifact.

| Replay stage | selected | rejected | notes / operation evidence |
|---|---:|---:|---|
| raw | 4718 | 0 | source input |
| cleaned | 4464 | 254 | sanitizer |
| learner-arranged | 3300 | 28 | 919 merges, 2381 replacements |
| advanced-candidates | 2369 | 931 | candidate pruning |
| advanced-playable | 2369 | 0 | 2134 retained, 235 duration changes |

For the 278 CANTO roots in the current replay, the trace-backed final
classification is: `111` verified 1/8-grid mappings, `0` verified octave
mappings, `38` verified transforms outside that simple grid/octave class, and
`129` genuinely rejected before selected Advanced output. There are `0`
ambiguous source roots; one root has no Advanced-candidate event because it was
already rejected earlier, so it is not counted as an unclassified drop. The
stored artifact has a separate numeric-only fallback classification—`107` grid-like,
 `3` octave-like, `123` same-onset coincidences, and `45` no-onset matches—but
 those are not importer lineage and must not be called source transformations.

The 38 non-grid replay transforms are retained as a separate bucket rather than
being mislabeled as quantization; 24 final trace events report
`DURATION_CHANGED`, while the remaining cases include upstream arrangement
changes. The old `116 exact + 29 duration mismatch + 88 pitch conflict + 45
loss` table remains a nearest-onset comparison against the stored artifact, not
an importer-transform table.

The 38 non-grid transforms break down by verified trace path as `13` raw
retained → learner merged → Advanced retained → Advanced-playability duration
changed, `16` raw retained → learner merged → Advanced retained → final retained
but not explainable as a pure 1/8-grid endpoint mapping, and `9` raw retained →
learner replaced → Advanced retained → Advanced-playability duration changed.
The separate `111` grid mappings are the only roots called quantization here.

The first-rejection causes are now pinned:

| First rejection | Count | Trace reason |
|---|---:|---|
| learner-arranged | 1 | `range-and-hand-arrangement-rejected` |
| advanced-candidates | 128 | `advanced-candidate-construction-rejected` |

Thus the current causal route is Advanced candidate construction / voice
pruning, not wholesale loss in the importer sanitizer or learner arrangement.
At that rejection stage, `88/128` roots had at least one selected note within
the same 1/8-beat onset window; `56` had a higher selected pitch, `86` had a
lower selected pitch, and `72` had a selected note with the same inferred hand
(`R=67`, `L=61`). These sets overlap and carry no role labels, so this supports
“candidate pruning among simultaneous texture” but does not prove “vocal line
removed in favor of accompaniment.”

Representative trace roots make the boundary concrete. A normalized CANTO
`59` at beat `20.984165` becomes learner `L59` at beat `21`, then is rejected
at Advanced candidates while `L40/L52` and `R64/R67` remain at that onset. A
normalized CANTO `60` at beat `29.458039` becomes learner `R60`, is rejected at
Advanced candidates, and has `L38/L48` retained nearby. Conversely, CANTO `62`
at beat `19.484180` becomes learner `R62`, survives Advanced candidates, and
is shortened from `1.5` to `0.5` beats by the Advanced-playability duration
cap. These are trace examples, not semantic role judgments.

No audio artifact is claimed here. The direct CANTO hand-override candidate is
not a useful full arranged result (`540` fallback beats and large source
gaps), so the A/B figures remain numerical/structural diagnostics only.

The concrete producer/import boundary is now clear: `parseMidi` flattens raw
track/channel/FF01 identity before the public `Note` stream reaches
`buildVariants`. A future source-preserving repair should carry that identity
as a private per-note sidecar through sanitize, quantize, deduplication, and
playability pruning, then expose it only in provenance diagnostics. This audit
uses the smallest external tuple sidecar needed to prove the boundary and does
not promote any role into runtime data.

Worst-window selection scans every 12-beat window from the start plus a final
tail-aligned window, maximizes differing melody source IDs, then candidate
melody count, then chooses the earliest tie. It is not a hand-selected musical
example.

## Physical diagnostics

These are structural playability measurements, not musical acceptance. Values
are `median IOI seconds; max simultaneous/sounding; worst top-voice leap at
source seconds; worst 0.5-second attack window and count`.

| Target / tempo | Current automatic | Derived upper-staff hand override |
|---|---|---|
| Queen / 108 | `0.277778; 6/7; 32 st @ 84.722s; 30.833–31.333s / 8` | `0.277778; 7/7; 32 st @ 81.667s; 30.833–31.333s / 8` |
| Oops / 95 | `0.315789; 6/6; 38 st @ 132.316s; 128.842–129.342s / 7` | `0.315789; 6/6; 38 st @ 132.316s; 128.842–129.342s / 7` |
| Blackbird / 120 | `0.1875; 4/4; 18 st @ 56.875s; 4.375–4.875s / 4` | `0.1875; 4/4; 18 st @ 56.875s; 4.375–4.875s / 4` |

For the shared controlled `108 BPM` comparison, final attack counts were
Queen `963/963`, Oops `614/614`, and Blackbird `657/657` for current/derived.
The corresponding current/derived median IOI values were Queen
`0.277778/0.277778`, Oops `0.277778/0.277778`, and Blackbird
`0.208333/0.208333`. These diagnostics do not prove recognizability, comfort,
balance, or musical acceptance.

## Phase and identity evidence

| Target | Raw MIDI evidence | Current score/runtime evidence | What the derived lane actually establishes |
|---|---|---|---|
| Queen | `4718` notes; FF03 track name `Somebody T`; `2/4` at beat `0`, `6/8` at beat `12`; first note ≈ `4.994792` | MusicXML declares only `6/8` at beat `0`; `notes.json` measures start `0,3,6,9,…`; staff/voice counts `1366/1153`; no lyrics | A concrete raw meter timeline and a reproducible structural lane. It does not supply validated source measure-boundary provenance or a melody legend. |
| Oops | `3343` notes; FF03 track name `Oops! I Did It Again - Britney Spears`; `4/4` at beat `0` | MusicXML and runtime agree on `4/4`; staff/voice counts `1443/465`; no lyrics | A reproducible structural lane, but no semantic melody legend. |
| Blackbird | `1112` notes; FF03 tracks `Remixed` ×6 and `GS/RESET`; `4/4` at beat `0`; first note at beat `4` | MusicXML and runtime agree on `4/4`; staff/voice counts `623/604`; no lyrics | An upper structural lane, but track names and stored L/R do not prove melody identity or pickup semantics. |

### Raw track, text, channel, and program evidence

The comparison script preserves each raw event’s absolute tick and quarter-note
beat. The following is a compact rendering of that output; General MIDI
program numbers are reported as raw numbers and are not treated as semantic
role proof.

Queen’s FF01 labels and channel/program timing are:

| MIDI track | FF03 / FF01 at beat | program changes (`channel=program @ beat`) | note-ons (`channel:count, first–last beat`) |
|---:|---|---|---|
| 1 | FF03 `Somebody T` | — | — |
| 2 | FF01 `PIANO @ 0` | `0=0 @ 2.5` | `0:1348, 4.994792–527.880208` |
| 3 | FF01 `BASS @ 0` | `1=35 @ 2.5` | `1:751, 6–536.994792` |
| 4 | FF01 `ORGAN @ 0` | `2=18 @ 2.5; 2=17 @ 191.973958; 2=18 @ 221.872396` | `2:187, 68.994792–518.994792` |
| 5 | FF01 `-CANTO- @ 0` | `3=73 @ 2.5` | `3:278, 17.494792–414.755208` |
| 6 | FF01 `OVERD.GT.1 @ 0` | `4=29 @ 2.5` | `4:698, 15.494792–536.994792` |
| 7 | FF01 `OVERD.GT.2 @ 0` | `5=29 @ 2.5` | `5:75, 191.994792–227.984375` |
| 8 | FF01 `CHOIR @ 0` | `6=52 @ 2.5` | `6:651, 47.994792–518.994792` |
| 9 | FF01 `SYNVOX @ 0` | `7=54 @ 2.5` | `7:32, 41.994792–284.994792` |
| 10 | FF01 `DIST. GT. @ 0` | `8=30 @ 2.447917` | `8:698, 15.536458–537.036458` |
| 11 | FF01 `DRUM @ 0` | `9=0 @ 2.5` | percussion note-ons excluded |

For Oops, the raw file has one FF03 track name at beat `0`, ten FF01 credit /
metadata strings at beat `0`, and channel/program data beginning at beat `0`
with later changes at beats `7.016667`, `28`, `32`, `80`, `112`, `116`, `117`,
`160`, `192`, `193`, `196`, `204`, `208`, `232`, and `236`. Its raw note-on
channels are `0,1,2,3,4,5,6,7,8,10,11,12,13,14,15`; no semantic melody label is
present.

For Blackbird, tracks 1–6 carry FF03 `Remixed` and track 7 carries FF03
`GS/RESET`. Program changes occur at beat `4`: channel 0 (`0,0`), channel 1
(`1,0`), channel 2 (`73,1`), channel 6 (`48,0`), channel 4 (`49,0`), and
channel 5 (`0`). Their note-on counts are respectively `525,232,203,134,17,1`;
the reset track has no notes. No FF01 semantic role label is present.

The labels are source evidence only. In particular, `PIANO`, `BASS`, `ORGAN`,
`-CANTO-`, and `CHOIR` do not identify a learner melody lane without a reviewed
role mapping.

## Importer provenance and source URL

| Target | Catalog provenance | Current artifact provenance |
|---|---|---|
| Queen | `https://bitmidi.com/g-michae-queen-somebody-to-love-mid`; `queen-somebody-to-love.mid`; BitMidi free MIDI archive, private use; source `ug-tabs`; verified title `G.MICHAE-QUEEN.Somebody to love.mid` | `sourceArtifactHash=4505d3a7…c7a74e`; `kind=standard`; `sourceRef=manifest:queen-somebody-to-love.mid`; no score URL; tempo calibration/playback `108` from MIDI meta |
| Oops | `https://bitmidi.com/britney-spears-oops-i-did-it-again-k-mid`; `britney-spears-oops-i-did-it-again.mid`; BitMidi free MIDI archive, private use; source `ug-tabs`; verified title `BRITNEY SPEARS.Oops I Did It Again k.mid` | `sourceArtifactHash=64d18aa4…225ad4`; `kind=standard`; `sourceRef=manifest:britney-spears-oops-i-did-it-again.mid`; no score URL; tempo calibration/playback `95` from MIDI meta |
| Blackbird | `https://bitmidi.com/blackbird-1-mid`; `the-beatles-blackbird.mid`; BitMidi free MIDI archive, private use; source `ug-tabs`; verified title `Blackbird-1.mid` | `sourceArtifactHash=3fc3fd74…1e75`; `kind=standard`; `sourceRef=manifest:the-beatles-blackbird.mid`; no score URL; tempo calibration/playback `120` from MIDI meta |

The local catalog URLs identify MIDI archive entries, not an independently
identified original score or notation package. The generated/current
MusicXML contains no semantic role legend, and the artifact notes provenance
retains the MIDI manifest reference rather than a score URL.

## Decision and exact missing artifact

- Do not promote the derived upper-staff hand override. Its identity deltas
  are large, especially Queen and Oops, and zero unresolved beats are an
  expected consequence of the forced right-hand selection semantics.
- Queen now has a concrete raw-vocal candidate to review, but it still needs a
  provenance-preserving decision on the `-CANTO-` role mapping, the
  onset/pitch/duration losses, and the PIANO/CHOIR handoffs. An independently
  identified score/source package is one useful way to resolve that review,
  but it is not the only admissible route; source-level role evidence or an
  authorized bounded listening worksheet could also resolve it. The raw
  `2/4 → 6/8` timeline and phase remain explicit review inputs.
- Oops needs a reviewed staff/voice/color legend for the current source
  version; the backup is structurally equivalent and adds no independent
  semantic evidence.
- Blackbird needs completed labels for the existing review worksheet’s
  source-note IDs (`M/B/H/D/R/U`) and bounded-phrase listening notes; stored
  L/R remains only a structural lane.

Until those artifacts exist, retain Original on unresolved spans and keep the
automatic melody status inferred/reviewable. No source file was copied,
rewritten, imported, catalogued, or used to change runtime data in this audit.

## Frozen `ba9e5a5` matching review addendum — 2026-09-19

The raw CANTO one-to-one comparison does not establish 117 importer
transformations. At the committed `0.125`-beat tolerance, 278 raw CANTO notes
produce 116 exact matches, 29 same-pitch duration mismatches, 88 pitch
conflicts, and 45 onset losses. A separate one-to-one check found 145 as the
maximum same-pitch onset matching, exactly `116 + 29`; reversed matching-order
variants were unchanged. Raw CANTO also has no simultaneous note-on groups,
and all 88 pitch conflicts had no same-pitch canonical note within tolerance.
They are nearest-onset cross-role matches against canonical R/L chord notes,
not proven pitch transforms.

Tolerance sensitivity confirms the classification risk: `0.0625` beats gives
222 matched / 77 pitch conflicts / 29 duration conflicts / 56 losses, while
`0.125` gives 233 / 88 / 29 / 45. The 11 additional matches are all pitch
conflicts. The raw candidate covers 167.333 of 540 active beats, with 372.667
rest beats, 17.494792 intro rest, 116.807292 outro rest, maximum polyphony 2,
and 0.427083 overlapping beats. Its `fallbackBeats=540` and zero unresolved
beats are right-hand selection semantics, not full-song melody coverage.

The candidate manually parses FF01 `-CANTO-`, strips track/channel, forces
`hand=R`, and bypasses the real importer/quantizer lineage. The A/B is numeric
event/playability comparison only; its `[48,60)` window is inherited from the
current-vs-derived worst-window selection, not a CANTO holdout, and no audio
acceptance is established. The read-only diagnostic now keeps the raw
track/channel/FF01 identity in a sidecar, follows unique source roots through
the current importer replay, asserts pinned input hashes, and includes a small
1/16-versus-1/8 grid/chord correspondence regression.
