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
- Queen needs an independently identified score/source package with a stable
  URL, license, and hash that preserves the raw `2/4 → 6/8` timeline, plus a
  reviewer-authored measure-boundary, phase, and role legend.
- Oops needs a reviewed staff/voice/color legend for the current source
  version; the backup is structurally equivalent and adds no independent
  semantic evidence.
- Blackbird needs completed labels for the existing review worksheet’s
  source-note IDs (`M/B/H/D/R/U`) and bounded-phrase listening notes; stored
  L/R remains only a structural lane.

Until those artifacts exist, retain Original on unresolved spans and keep the
automatic melody status inferred/reviewable. No source file was copied,
rewritten, imported, catalogued, or used to change runtime data in this audit.
