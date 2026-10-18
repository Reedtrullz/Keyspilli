# T3 canonical loader evaluation

Revision: `d4e4006`

Run from the repository root with Node `v22.22.3`:

```sh
export PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH
./node_modules/.bin/tsx docs/superpowers/evidence/2026-09-19-chords-finish/t3-canonical-loader-evaluation.ts
```

The evaluator copied the pinned production `manifest.json`, `notes.json`,
`variant.mid`, and `variant.xml` bytes from
`/Users/reidar/Projectos/Keyspilli/data` into a disposable
`KEYSPILLI_DATA_DIR`. It hashed the copied bytes and asserted every hash
against the pinned target values before calling `loadSongArtifact`. It then
used the same nullable `projectChordSources` projection called by
`loadSongDetail` for both chart and no-chart targets. This is a local canonical
replay, not a deployed-runtime or database claim: the synthetic row only
selects the pinned `baseId`/`a` artifact, and no catalog database was opened or
mutated. The disposable loader root is removed in `finally`.

The repository-owned chart map and `catalog/chord-timelines/your-song.json`
were copied into the same disposable root and loaded through
`loadChordTimeline`. Their copied-byte hashes were:

| Resource | SHA256 |
|---|---|
| `catalog/chord-sources.json` | `b81f86719506a72346555615733cdcafbbfe6bc5997059ee024cc3145d9615ac` |
| `catalog/chord-timelines/your-song.json` | `44dfa65604e63d288ba96e231a84de65a8e496459e186ca56fa596f99e6c680b` |

All five targets returned `artifactStatus: valid`; all copied manifest,
notes, MIDI, and MusicXML hashes matched. The runtime source-timing fields
were absent for these five canonical artifacts, so no unvalidated phase
metadata entered the producer. Your Song loaded the verified partial chart
`ultimate-guitar:elton-john/your-song` with `opening-section` coverage and a
128-beat timeline.

The default lane is the unchanged player default. The conservative lane is a
diagnostic source-only preview; it does not change defaults or turn a preview
into an acceptance result. Both lanes use automatic selection,
`allowRests`, coherent-phrase sounding limits, validated `playbackTiming`,
the selected `auto` source, and its shared harmonic-support policy.

## Default lane

| Target | Source notes | Events / attacks | Fallback / review beats | Unresolved beats | Mandatory R sim/sounding | Mandatory L sim/sounding | Final event SHA256 |
|---|---:|---:|---:|---:|---:|---:|---|
| Oops I Did It Again | 1897 | 1438 / 614 | 114.25 / 114.25 | 42.625 | 4 / 5 | 3 / 4 | `2bdf2abb9ef92c7cdf1ee5fedf46575b57000dda39148698fc24c83f705e0fe7` |
| Blackbird | 1069 | 1041 / 657 | 54.75 / 54.75 | 38.125 | 2 / 3 | 3 / 3 | `39b3b190ce46ca471a2ca597a57750680605b75edc5408a9f86081a3072e289e` |
| Somebody To Love | 2373 | 2072 / 963 | 223.625 / 223.625 | 182.375 | 4 / 5 | 3 / 3 | `556ec5a6e0ddabc0fbfe057c730dd2bdc49c82afa91a840eb4fffa0b8fa6f39e` |
| Your Song | 1068 | 1072 / 723 | 83.25 / 83.25 | 57.5 | 3 / 3 | 2 / 3 | `cc376d7f4c9d1f3f995b28548bdf9509d7c64e1592ae8599b14bab1f81ec2a1d` |
| Hell You Call A Dream | 1452 | 1404 / 812 | 91 / 91 | 68.5 | 3 / 4 | 3 / 4 | `dd2ab4c00fb20e02ed378e4cabeb63ab5efde5363e8cdc2a25f6122fae3f0f31` |

## Conservative source-only lane

| Target | Source notes | Events / attacks | Fallback / review beats | Unresolved beats | Mandatory R sim/sounding | Mandatory L sim/sounding | Final event SHA256 |
|---|---:|---:|---:|---:|---:|---:|---|
| Oops I Did It Again | 1897 | 1528 / 614 | 123.5 / 123.5 | 42.625 | 4 / 5 | 3 / 4 | `0b6d1f9b250e7e155117e45247df859b6d0bb61af7b56d6b63f541e0169cdb10` |
| Blackbird | 1069 | 1069 / 657 | 54.75 / 54.75 | 38.125 | 2 / 3 | 3 / 3 | `25e6a4bf67b77237e956e9ee9c21bc5ca3dd7ab28a639664be4f969fa0588b7f` |
| Somebody To Love | 2373 | 2312 / 963 | 290.625 / 290.625 | 182.375 | 4 / 5 | 3 / 3 | `d24e73a9ddd69a211f4946fe8bbcd7b77f56026d4e86baef8c6130a657ef325b` |
| Your Song | 1068 | 1068 / 721 | 75 / 75 | 57.5 | 3 / 4 | 3 / 3 | `765e2c380f813e73365aab2826b054a3a449876fde80a6ade0896339308832ec` |
| Hell You Call A Dream | 1452 | 1451 / 812 | 89.75 / 89.75 | 68.5 | 3 / 4 | 3 / 4 | `1256a8ee5816d92646bd7b2495a86fd34134a29895bd8dbeb6b18fd26397c14e` |

Fallback/review reasons remain separate from chart coverage:

| Target / lane | Ambiguous melody | No chart coverage | No playable support voicing | Sounding limit | Unverified source |
|---|---:|---:|---:|---:|---:|
| Oops / default | 35.25 | 47.25 | 0 | 15.375 | 16.375 |
| Oops / conservative | 35.25 | 47.25 | 0 | 24.625 | 16.375 |
| Blackbird / default | 36.875 | 14 | 0 | 0 | 3.875 |
| Blackbird / conservative | 36.875 | 14 | 0 | 0 | 3.875 |
| Somebody To Love / default | 163.5 | 6 | 0 | 32.75 | 21.375 |
| Somebody To Love / conservative | 163.5 | 6 | 0 | 99.75 | 21.375 |
| Your Song / default | 57.375 | 4.5 | 11.5 | 0.625 | 9.25 |
| Your Song / conservative | 57.25 | 4.5 | 0 | 1.125 | 12.125 |
| Hell / default | 66.375 | 9.25 | 0 | 3.5 | 11.875 |
| Hell / conservative | 66.625 | 9.25 | 0 | 2 | 11.875 |

Pinned source identities and copied-byte checks:

| Target | Source artifact SHA256 | Manifest SHA256 | Notes SHA256 | `variant.mid` SHA256 | `variant.xml` SHA256 |
|---|---|---|---|---|---|
| Oops I Did It Again | `64d18aa4c23f7625a6eb0a7a234843a7a2278003d75cba9ea04efde7d8225ad4` | `de8f40b8cf7fdbdfd38dacf3b0feb1fa8cf24f615eb118c768c8f308f357173d` | `337834fcd339a67e2aebbae3a8d3c3ae8eb8eb55c8529610e748c40bf80ca60a` | `001c03ee99636dc6c9f6eda9feeeeec060507c35d5a5431f0d1a586de6ea9d76` | `6e52b06ee3499f2c51031e1405b0b6def622c0b90349b62050e4c1e007306930` |
| Blackbird | `3fc3fd74d567da56dd10ff05689ef2f57641efbbe200532aabc0ea5fbcea1e75` | `bd3c983a1f88134bb276145fa0d3a8f91241107a4525295eb3d96109d0b82c2f` | `70f29a617731fd982e54592d98fb37c74d964ea6d275c011f04579f14b871256` | `eaa46a8de0eb088a41c3d17ab1a18dbc06fd3f9f1899cad990e365f1c756ab1c` | `2deba24d628ea9b80b3770e7984228a4b45c918549ae404f1db5c98822879395` |
| Somebody To Love | `4505d3a7cb3c24788e51905eb29a40c501a31f7bd07596d489f63f7430c7a74e` | `0093613fd0f404fca931090163ab2a9f96272aa82eef729f4da68587929a9135` | `4faced9af0bc543fd4f054c731a16ed58e977d8623f947ff6925b482f8b3ec7d` | `83be6c85627d6d861cd209d8b9411053ffe585712f142c8c0a83744ca1068d51` | `2e5f254a2d88aa4427e47d6d2773c956fd9d4c890a3edb7d54563f7e1fa6d594` |
| Your Song | `bcdbb1eef809fbf0bee0824a874e98ad3cea321e44d0d87ed0a9633b72371f0e` | `3c995622d4d7cdb2fd6d067e3c51e141fbe919deb93dfc53d8be57ec97f2bd4b` | `5bc202eecbcff8597163eb9fd154af01e07f4682989bc2e7aa5bd3d573e8fb99` | `1a67b0e425a4056051759e92f5f3f2bacf5f7f6dbc86ec47772d19b57365d811` | `985b02c621a1c84a921ad359b92ea41eb5f893be833075c0f119581eedeb1421` |
| Hell You Call A Dream | `13e9cd2ed273c7bf9f9a8a14a480ae5b8505e52d85eb3cfacdc51d6cb9f3af0a` | `f14790db8b0742a752cf4b6dd571fc56d49a9dfa27dc36263628a3a67fe8900c` | `6c03998a78c9ba1052feafc87476e6ba38c47f4c824c96855684212cf04fb265` | `e930e6c3a6c346a9277be23fa5aac01a068fb51efe69bd121b10343da6d4e567` | `5bbb4de5ad46728d22ede35d8c6a2eb5de120cc6e2f53bb88c22e9b5a7033acb` |

The real browser checkpoint selected Blackbird `Chord mode` + `Automatic
melody` in the scratch loader, waited for the actual worker response, and
compared its compact resolution signature with the same Node producer built
from the copied scratch bytes and frozen options. It passed. The same run
verified that advanced arrangement controls start collapsed while `Compare
Original` is visible. This establishes browser/worker producer parity and UI
state, not musical or keyboard acceptance.

These captures do not prove recognizable melody, comfortable fingering,
instrument balance, pedal cleanliness, target-tempo performance, human
listening acceptance, or public production deployment. The earlier
`t3-structural-evaluation.md` remains historical compatibility evidence only;
it is not substituted for this canonical capture.
