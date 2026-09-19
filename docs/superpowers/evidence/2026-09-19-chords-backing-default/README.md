# Chord mode backing-only default — 19 September 2026

This packet records the scoped default change on branch `codex/finish-chords-mode`.
Chord mode now resolves the existing `bass-chords` producer by default: supported
chart events emit generated backing voicings, while source notes are omitted from
the backing stream and uncovered spans are reported as unavailable. An explicit
`Melody + accompaniment` selection remains available and is persisted through a
separate intent marker.

## Code and commands

- Captured runtime/test head: `2c8353c` (`test: compare backing against current original captures`)
- Node: `v22.22.3`
- Frozen resolver diagnostic:
  `node --import tsx --input-type=module` with `resolveChordSources()` and
  `resolveAccompaniment(..., "bass-chords")`
- Current canonical loader diagnostic uses the same resolver path against
  `/Users/reidar/Projectos/Keyspilli/data` and the current Blackbird, Oops, and
  Queen `notes.json` inputs.
- Default browser capture:
  `npm run e2e:melody-scratch -w @keyspilli/web -- --grep='backing-only default' --workers=1`
- Result: 1 browser test passed; the test verified default `Bass + chords`, no
  melody worker request, no melody controls, audible accompaniment preview, and
  the full default transport capture.
- Current-player comparison:
  `npm run e2e:melody-scratch -w @keyspilli/web -- --grep='current Player compares Original' --workers=1`
- Result: 1 browser test passed; it captured current-head Original and fresh
  default backing on Blackbird, Oops, and Queen with the same source, window,
  instrument, speed, transpose, hand, and gain settings for each pair.

## Full-song structural diagnostic

| Source | Notes | Selected chart events | Realized backing chords | Backing notes | Coverage | Uncovered/fallback | Source notes emitted | Non-silent |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Blackbird frozen fixture | 1,069 | 68 | 68 | 246 | 278.25 / 296 beats | 17.75 beats / 19 spans | 0 | yes |
| Oops frozen fixture | 1,891 | 74 | 74 | 251 | 326.875 / 336 beats | 9.125 beats / 11 spans | 0 | yes |
| Queen canonical source | 2,373 | 110 | 110 | 401 | 534 / 540 beats | 6 beats / 1 span | 0 | yes |

The backing output is therefore not an all-silence pass, but it is not complete
coverage either. The uncovered regions remain silent and are surfaced as
`Backing unavailable — source melody omitted`. Generated voicings from inferred
or notes-derived labels are not validated harmony.

The frozen fixture table above is retained for the previously reviewed
structural boundary. The current canonical loader path used by the Player
comparison has these full-song results:

| Canonical input | Notes | Selected source | Selected/effective chords | Generated backing notes | Coverage | Uncovered/fallback | Source notes emitted | Non-silent |
|---|---:|---|---:|---:|---:|---:|---:|---|
| Blackbird | 1,069 | `auto` / Generated fallback | 68 / 68 | 246 | 282 / 296 beats | 14 beats / 1 span | 0 | yes |
| Oops | 1,897 | `auto` / Generated fallback | 65 / 65 | 217 | 288 / 336 beats | 48 beats / 1 span | 0 | yes |
| Queen | 2,373 | `auto` / Generated fallback | 110 / 110 | 401 | 534 / 540 beats | 6 beats / 1 span | 0 | yes |

These canonical counts are recorded in [`manifest.json`](./manifest.json).

## Player captures

The before clip is the earlier actual Player capture of the previous default
automatic Melody + accompaniment path. It is historical comparison evidence,
not an Original-arrangement control and not a same-head pair.

- [Before — previous Melody + accompaniment default](./audio-review/blackbird-14-26.5-before-melody-accompaniment.webm)
- [After — backing-only default](./audio-review/blackbird-14-26.5-after-backing-only-default.webm)
- [After — accompaniment audition, current passage](./audio-review/blackbird-current-passage-accompaniment-preview.webm)

The before clip is copied from the prior packet’s Player capture at candidate
commit `36bed6e1b9ea66aceb6fb3291131dd2d33c2e07e`; it is comparison evidence,
not a claim that the old melody selection was semantically verified.

The current-head paired captures are the acceptance-boundary evidence for this
scoped change:

| Input | Window | Original | Fresh default backing |
|---|---|---|---|
| Blackbird | beats 14–26.5 @ 120 BPM | [audio](./audio-review/current-blackbird-original.webm) | [audio](./audio-review/current-blackbird-backing-only.webm) |
| Oops | beats 48–64 @ 95 BPM | [audio](./audio-review/current-oops-original.webm) | [audio](./audio-review/current-oops-backing-only.webm) |
| Queen | beats 6–18 @ 108 BPM | [audio](./audio-review/current-queen-original.webm) | [audio](./audio-review/current-queen-backing-only.webm) |

The machine-readable comparison is
[current-player-canonical-comparisons.json](./current-player-canonical-comparisons.json).
For Blackbird, the test derives source note MIDI 60 at beat 14, verifies the
same timed attack in Original, and verifies that the fresh backing-only
transport does not schedule it. The source note is excluded by exact beat/MIDI
attack identity against the resolved backing attack set; this is not a
pitch-only absence check.

## Source inputs

- Blackbird: frozen fixture under
  `docs/superpowers/evidence/2026-09-17-chords-v2-fixtures/the-beatles-blackbird/a/notes.json`
  (`sha256 5aa5671d42bd93c2ac65c1fd21c87aa049b8baead3dfb48ae265213e6f445c75`)
- Oops: frozen fixture under
  `docs/superpowers/evidence/2026-09-17-chords-v2-fixtures/britney-spears-oops-i-did-it-again/a/notes.json`
  (`sha256 346c168afa388c8582fbd631a1e0d79ba8bd585caa49ad7a1082492b5ecb7f98`)
- Queen: read-only canonical source at
  `/Users/reidar/Projectos/Keyspilli/data/artifacts/queen-somebody-to-love/a/notes.json`
  (`sha256 4faced9af0bc543fd4f054c731a16ed58e977d8623f947ff6925b482f8b3ec7d`)

The current Player comparison uses these canonical loader inputs from the same
data root: Blackbird `notes.json` SHA-256
`70f29a617731fd982e54592d98fb37c74d964ea6d275c011f04579f14b871256`, Oops
`337834fcd339a67e2aebbae3a8d3c3ae8eb8eb55c8529610e748c40bf80ca60a`, and
Queen `4faced9af0bc543fd4f054c731a16ed58e977d8623f947ff6925b482f8b3ec7d`.

No catalog file was edited. Queen’s canonical source remains outside this
worktree and was only read for the diagnostic.

## Limits and non-claims

- Counts prove resolver/player routing and coverage boundaries, not recognizable
  melody, harmonic correctness, comfortable fingering, or musical usefulness.
- The current-head browser packet proves non-silent backing scheduling for three
  canonical inputs and one exact source-note scheduling distinction on
  Blackbird; it does not identify a human singing line or replace listening
  review.
- Source roles, pickup/downbeat phase, and semantic melody identity remain
  unverified for the required repertoire.
- No merge, deploy, production verification, or catalog mutation was performed.
