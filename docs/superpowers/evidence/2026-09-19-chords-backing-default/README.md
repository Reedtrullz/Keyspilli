# Chord mode backing-only default — 19 September 2026

This packet records the scoped default change on branch `codex/finish-chords-mode`.
Chord mode now resolves the existing `bass-chords` producer by default: supported
chart events emit generated backing voicings, while source notes are omitted from
the backing stream and uncovered spans are reported as unavailable. An explicit
`Melody + accompaniment` selection remains available and is persisted through a
separate intent marker.

## Code and commands

- Captured code head: `9d0a037` (`test: capture backing-only player output`)
- Node: `v22.22.3`
- Resolver diagnostic:
  `node --import tsx --input-type=module` with `resolveChordSources()` and
  `resolveAccompaniment(..., "bass-chords")`
- Browser capture:
  `npm run e2e:melody-scratch -w @keyspilli/web -- --grep='backing-only default' --workers=1`
- Result: 1 browser test passed; the test verified default `Bass + chords`, no
  melody worker request, no melody controls, audible accompaniment preview, and
  no duplicate source-note oscillator starts.

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

## Player captures

The before clip is the earlier actual Player capture of the previous default
automatic Melody + accompaniment path. The after clip uses the same Blackbird
beat window (13–27.5 beats captured, with the requested comparison window at
beats 14–26.5) and the new default backing-only path.

- [Before — previous Melody + accompaniment default](./audio-review/blackbird-14-26.5-before-melody-accompaniment.webm)
- [After — backing-only default](./audio-review/blackbird-14-26.5-after-backing-only-default.webm)
- [After — accompaniment audition, current passage](./audio-review/blackbird-current-passage-accompaniment-preview.webm)

The before clip is copied from the prior packet’s Player capture at candidate
commit `36bed6e1b9ea66aceb6fb3291131dd2d33c2e07e`; it is comparison evidence,
not a claim that the old melody selection was semantically verified.

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

No catalog file was edited. Queen’s canonical source remains outside this
worktree and was only read for the diagnostic.

## Limits and non-claims

- Counts prove resolver/player routing and coverage boundaries, not recognizable
  melody, harmonic correctness, comfortable fingering, or musical usefulness.
- The browser oscillator probe proves the selected Player path scheduled backing
  audio and did not schedule duplicate source-note voices in the tested passage;
  it does not identify a human singing line or replace listening review.
- Source roles, pickup/downbeat phase, and semantic melody identity remain
  unverified for the required repertoire.
- No merge, deploy, production verification, or catalog mutation was performed.
