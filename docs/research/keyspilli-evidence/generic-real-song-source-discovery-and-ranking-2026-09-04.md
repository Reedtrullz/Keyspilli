# Generic real-song source discovery and ranking

Frozen mission: `GENERIC_REAL_SONG_SOURCE_DISCOVERY_AND_CANDIDATE_RANKING`
Starting revision: `d63e013ea99a8ca6155243f862ab3525d36f0c57`
Retrieval date: 2026-09-05

## Scope

The exact 20-song non-benchmark corpus from the release-gap reassessment was
searched once with the provider-scoped query family
`<artist> "<title>" MIDI`. Only public result metadata was captured: one top
result per query, 20 search calls, 17 URLs, no page fetches, and no bytes.
The protected seven-song benchmark set was not searched or used for ranking.

The search surfaced explicit MIDI-result pages such as [BitMidi's Bon Jovi
entry](https://bitmidi.com/bon-jovi-bed-of-roses-mid), [MidiFind's Crazy Train
entry](https://midifind.com/files/o/osbourne_ozzy/osbourne_ozzy_crazy_train/1472-1-0-46579),
and [MidiFiles' Journey entry](https://midifiles.com/midi/journey/don-t-stop-believin).
Those pages establish discovery evidence only; no license or native recording
timing was inferred from the search result.

## Frozen result

| Measure | Result |
| --- | ---: |
| Songs with any result | 17/20 |
| Strong structured leads | 13/20 |
| MIDI leads | 13/20 |
| MusicXML/MXL leads | 0/20 |
| Guitar Pro leads | 0/20 |
| Piano-symbolic leads | 0/20 |
| Piano-cover leads | 1/20 |
| Tab/chord-only support | 2/20 |
| No useful result | 3/20 |
| Automatic acquisition eligible | 0/20 |
| User-mediated structured candidate | 13/20 |
| Native/performance timing potential | 0/20 |
| Unknown timing among structured leads | 13/13 |

The full per-song and per-candidate snapshot is in
[`generic-real-song-source-discovery-and-ranking-2026-09-04.json`](./generic-real-song-source-discovery-and-ranking-2026-09-04.json).

## Ranker and controls

`packages/catalog/src/generic-source-ranking.ts` adds a pure, path-safe
metadata contract and deterministic lexicographic ranker. It reuses the
existing generation-candidate class/firewall vocabulary and SHA helper; it
does not fetch, parse, or publish a source. Ranking keeps the best relevant
lead separate from the best automatically eligible candidate. The control
corpus covers exact/open, mismatch, live, rights-blocked, instrument-only,
section-only, unsupported Guitar Pro, and HTML masquerade cases.

The control run had zero firewall violations, zero wrong-version automatic
promotions, zero rights-blocked automatic promotions, zero benchmark/diagnostic
promotions, zero HTML masquerade acceptances, and byte-stable repeated ranking.

## Decision

The pre-registered automatic gate (6/20) is not met. The user-mediated gate
(10/20) is met at 13/20, and structured discovery is not insufficient (13/20
is above the 10/20 floor).

Primary decision: `USER_MEDIATED_SOURCE_DISCOVERY_HEADROOM_PROVEN`
Strategic consequence: `NARROWED_TO_USER_MEDIATED`
Near-term scope: `DISCOVERY_ASSISTED_USER_UPLOAD_PRIVATE_ALPHA`
Exactly one next task: `USER_MEDIATED_SOURCE_CANDIDATE_HANDOFF`

The route remains `EXTERNAL_SYMBOLIC_FIRST_RELEASE_PATH`, narrowed to a flow
where Keyspilli surfaces a likely source and the owner supplies an authorized
copy through the already validated bounded symbolic intake. Unknown rights,
unsupported formats, and unverified timing remain fail-closed. This report does
not upgrade `REAL_SYMBOLIC_ALIGNMENT_PARTIAL` and does not establish musical
quality.

Human listening: `NOT_REQUESTED_NOT_REQUIRED_BY_DEFAULT`
Deployment: `NO_DEPLOYMENT`
