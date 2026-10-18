# Metal-to-MIDI release-gap reassessment — 2026-09-04

## Decision

The bounded symbolic product remains the only validated release path. The
original promise—metal URL or recording in, useful recognizable piano MIDI out
without user-supplied symbolic material—still has an upstream evidence gap.

- Strategic route: `EXTERNAL_SYMBOLIC_FIRST_RELEASE_PATH`
- Cross-modal alignment: `CROSS_MODAL_ALIGNMENT_REOPEN_NOT_JUSTIFIED`
- Audio AMT: `AUDIO_AMT_REOPEN_JUSTIFIED` for a bounded research evaluation only
- Next task: `GENERIC_REAL_SONG_SOURCE_DISCOVERY_AND_CANDIDATE_RANKING`

This is an evidence/architecture decision, not a musical-policy change. Musical
quality remains `MUSICAL_QUALITY_NOT_OBJECTIVELY_ESTABLISHED`. Human listening is
`NOT_REQUESTED` / `NOT_REQUIRED_BY_DEFAULT`; no deployment or VPS mutation was
performed.

## What is already real

The private symbolic-upload MVP accepts MIDI, MusicXML and MXL with native
authoritative timing, validates/provenances the source, emits six physical
levels and five public levels, persists artifacts, opens the player and exports
MIDI/MusicXML/PDF. Worker-off, fresh-volume, restart, backup/restore and the
private edge boundary were validated in the preceding release work.

That does not imply arbitrary audio-to-MIDI quality. Existing source-aware
cleanup, semantic guitar harmony, GAPS Guitar-TECHS and AMT-oracle experiments
are bounded components; they do not supply a reliable generation-grade lead for
dense metal.

## Historical evidence and remaining gaps

The complete machine-readable record is
[`metal-to-midi-release-gap-reassessment-2026-09-04.json`](./metal-to-midi-release-gap-reassessment-2026-09-04.json).
Its byte SHA-256 is
`5c23c167ad3ec586d59e51b9b55ee875270d09b42eba5a4231ad50b4746a2a93`.
The recurring pattern is:

| Area | Status | First blocker |
|---|---|---|
| Native symbolic intake/provenance/firewall | Ready for bounded input | Discovery must populate the contract |
| Same-performance symbolic timing | Ready | None when the user supplies authoritative timing |
| Independent score/audio alignment | Partial | Regional timing confidence and coverage |
| Audio-only dense-metal AMT | Blocked for release | No cold-transfer result that is reproducible and rights-safe |
| External symbolic discovery | Partial | Rights-aware acquisition and parser evidence |
| Candidate ranking | Partial | Generic identity/version/role/timing/risk ranker missing |
| Arrangement/difficulties/artifacts/player | Ready when timing is owned | Upstream evidence ownership |

The deterministic metadata-only sample from the repository's non-benchmark
`ug-tabs.json` order contains 20 rock/metal leads: 20 tab/chord-only, 0
provenance-safe structured symbolic candidates, and 0 confirmed piano-cover
records in that sample. Those zeros mean “not confirmed by this scan”, not
internet-wide absence. The prior protected seven-song metadata audit found
piano-cover or structured-harmony aids for 7/7, but 0 independent aligned
generation candidates; it remains diagnostic-only and never entered generation
or tuning.

## Bounded technology scan

The scan used official GitHub/arXiv/primary pages on 2026-09-04, without model
downloads. Exa was unavailable locally because its Node shim was invalid; the
available primary-source paths were sufficient for this bounded scan.

- [U-MuST paper](https://arxiv.org/abs/2505.12863) and [official code](https://github.com/MALerLab/U-MusT): unified score/image/MIDI/audio translation, with AMT results on MusicNet/MAESTRO and a classical/piano-heavy data focus. It is not demonstrated as a continuous dense-metal timing authority.
- [TriScore code](https://github.com/lemur-project/triscore-code) and [paper/data note](https://www.sciencedirect.com/science/article/pii/S0031320326008915): strong cross-modal retrieval/classification framing, not symbolic generation or continuous timing alignment.
- [CLaMP3 code](https://github.com/sanderwood/clamp3) and [paper](https://arxiv.org/abs/2502.10362): relevant retrieval architecture, but the pinned local footprint was about 4.064 GB before evaluation; it remains `RESOURCE_BLOCKED_BEFORE_EVALUATION`, not a quality failure.
- [MuScriptor code](https://github.com/muscriptor/muscriptor) and [paper](https://arxiv.org/abs/2607.08168): materially newer multi-instrument AMT, trained on real recordings including heavy metal. The code is MIT, but weights are CC BY-NC 4.0; the official project warns about distorted electric-guitar generalization and stem drift, and Keyspilli has no cold transfer result. This justifies one later bounded research evaluation, not release authority.
- [2025 AMT Challenge report](https://arxiv.org/abs/2603.27528): useful benchmark context; remaining polyphony/timbre issues and no production-ready checkpoint were identified in this scan.

## Route comparison

| Route | Evidence | Runtime/effort | Failure detectability | Reuse of validated path | Conclusion |
|---|---|---|---|---|---|
| External symbolic first | Medium | Medium / low | High | High | Best current route; fail closed on weak candidates |
| Cross-modal alignment | Low–medium | High / high | Medium | Medium | Do not reopen now |
| Hybrid region evidence | Medium–low | High / medium-high | High | Medium-high | Useful after discovery, not a current authority |
| Audio-only AMT | Low–medium | High / high | Low–medium | Medium | Research candidate only; MuScriptor is next AMT lead |

## Objective gates

Generation requires a known generation candidate with usable provenance, valid
parser evidence, identity/version confidence, timing ownership (native or a
passing independent alignment), explicit region/role ownership, and a passing
arrangement/variant/artifact/player chain. Any missing evidence produces an
explicit withheld/insufficient result. Benchmark references remain
`BENCHMARK_REFERENCE` and cannot enter generation or tuning.

## Product boundary and next task

The next task is exactly `GENERIC_REAL_SONG_SOURCE_DISCOVERY_AND_CANDIDATE_RANKING`.
It should turn legitimate public leads into deterministic candidate records with
identity/version, format/role, parser/hash, duration/structure,
rights/provenance, timing authority/alignment, region coverage, confidence and
firewall classification. It must not implement arbitrary-song discovery in this
mission's closeout, tune against protected benchmark songs, or reopen human
listening.

The achievable post-task scope is a private alpha for evidence-augmented metal
only. Full arbitrary-metal URL/audio conversion remains research-only until a
candidate can own its timing and musical roles.
