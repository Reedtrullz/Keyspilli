# Guitar-TECHS GAPS tie-breaker — 2026-09-02

## Scope and decision

This was the single pre-registered A/B test requested by the guitar-AMT
diagnosis. It compares the frozen current Basic Pitch route with the one
permitted alternative, `xavriley/hf_midi_transcription` using its released
GAPS guitar checkpoint. The test is transcription-only: no Keyspilli selector,
semantic harmony, arranger, learner variant, separator, production replay, or
human listening was run.

**Decision: `GUITAR_SPECIFIC_AMT_VALIDATED`.** Both isolated modalities clear
the frozen aggregate and multi-technique criteria, with zero GAPS unsupported
events per second and a lower octave-flip rate. This validates a guitar
transcription backend on this diagnostic corpus; it does not establish that a
GAPS-generated Keyspilli song is recognizable or playable.

## Frozen corpus and identities

The exact 14-item Guitar-TECHS v1 selection and order were retained:

1. `p1-singlenotes-all` — single-note
2. `p2-singlenotes-all` — single-note
3. `p1-scale-c` — scale
4. `p2-scale-gb` — scale
5. `p1-tech-palm-mute` — palm-mute
6. `p2-tech-palm-mute` — palm-mute
7. `p1-tech-harmonics` — harmonics
8. `p2-tech-harmonics` — harmonics
9. `p1-tech-pinch` — pinch-harmonics
10. `p2-tech-pinch` — pinch-harmonics
11. `p1-chord-set1-major` — major-chord
12. `p2-chord-drop3-7` — dominant-seventh-chord
13. `p3-music-12` — musical-excerpt
14. `p3-music-08` — musical-excerpt

Frozen identities:

| Identity | SHA-256 / value |
| --- | --- |
| Keyspilli evaluation base | `957fa371f70e63d3c3f517ffcc613ff73db178d0` |
| GAPS code | `96f6797881e9497cbfc8f8e5deccea9c1f2f7adc` |
| GAPS model revision | `xavriley/midi-transcription-models@b7bec65a2b860aca72856b0feef58b5df407b777/guitar-gaps.pth` |
| Checkpoint bytes | `99,178,877` |
| Checkpoint SHA-256 | `65483e7c0e340a90415b15b520687587698c8c728f5fa470a205f13ee45c6513` |
| Guitar-TECHS selection digest | `fa354513c6b57ec07c223b57b85c5a64eed548b0fb770d09323af3053f6d1062` |
| Frozen Basic Pitch report | `44b8dec04526c6cd04421abc8198ab66fa6509d40a663ea69a18deb04f754adc` |
| Frozen pre-registration | `d821ec8dd829e6d1a90af5b337afbbbe7e49c661df34b6a4d4fd56cd0c8d49e4` |
| Final report bytes | `cd5c2e9a126f4391eccc88f33d927fe8c04b44225ff85f3512463f68d563cad4` |
| Embedded canonical report | `d6f1c048587cc262fd6a438dfa15737bfdb196606b61a9aff2f0466f6222b106` |

The two deterministic report runs were byte-identical. The checkpoint was
SHA-256 verified before loading. The supplied/reference MIDI and all benchmark
audio stayed outside the repository and were not uploaded or staged.

## Backend and evaluation configuration

The pinned wrapper is MIT-licensed `xavriley/hf_midi_transcription`, backed by
`piano-transcription-inference` commit
`cfe28ed26be892ad7d4e8a9aadcf95cb904c9320`. The isolated environment used
Python 3.12.13, torch 2.13.0, librosa 0.11.0, scipy 1.14.1, numpy 2.2.6, and
MPS. Audio was loaded mono at 16 kHz with the library defaults; GAPS used batch
8, 10-second segments, 0.5 overlap, onset/offset/frame thresholds 0.3/0.3/0.1,
pedal offset threshold 0.2, and wrote MIDI at 120 BPM/384 ticks per beat.
Truth timelines were normalized by `truthTempoBpm / 120`; no alignment,
transposition, threshold sweep, pruning, or post-processing was applied.

The frozen pre-registration's human-readable invocation string says
`device="cpu"`, while its explicit inference field and the actual run say
`mps`. This inconsistency is retained and disclosed; it does not change the
recorded output or hashes.

## Aggregate A/B metrics

`Unsupported/s` is `null` for the frozen Basic Pitch report because that report
did not provide a per-second denominator; GAPS measured zero. Candidate counts
are included to make density effects visible.

| Modality | Backend | Onset F1 | Exact F1 | PC F1 | Candidate notes | Exact precision | Exact recall | Octave-flip rate | Unsupported/s |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| DI | Basic Pitch | 0.514 | 0.462 | 0.479 | 4,258 | 0.344 | 0.704 | 0.173 | null |
| DI | GAPS | 0.735 | 0.701 | 0.711 | 1,574 | 0.813 | 0.616 | 0.025 | 0 |
| Amp/mic | Basic Pitch | 0.508 | 0.466 | 0.481 | 4,272 | 0.347 | 0.712 | 0.159 | null |
| Amp/mic | GAPS | 0.768 | 0.738 | 0.749 | 1,628 | 0.840 | 0.658 | 0.030 | 0 |

Aggregate gains were DI exact `+0.239`, PC `+0.232`, onset `+0.221`; and
amp/mic exact `+0.271`, PC `+0.268`, onset `+0.260`. GAPS emits about 0.76× the
truth note count while Basic Pitch emits about 2.05×, so the gain is not
recall-only note inflation: precision rises from about 0.34–0.35 to 0.81–0.84,
while recall falls moderately from 0.70–0.71 to 0.62–0.66.

## Technique results

The full per-item and per-technique metrics are in the deterministic JSON
report. Values below are exact-pitch F1, onset F1, and pitch-class F1 shown as
`Basic Pitch → GAPS (delta)`.

| Technique | DI exact | DI onset | DI PC | Amp/mic exact | Amp/mic onset | Amp/mic PC |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| scale | .218 → .493 (+.275) | .220 → .496 (+.276) | .219 → .493 (+.275) | .217 → .480 (+.263) | .220 → .483 (+.263) | .218 → .480 (+.262) |
| single-note | .120 → .253 (+.133) | .120 → .253 (+.132) | .120 → .253 (+.133) | .119 → .264 (+.146) | .120 → .265 (+.145) | .120 → .264 (+.144) |
| dominant-seventh-chord | .074 → .182 (+.108) | .081 → .184 (+.103) | .077 → .182 (+.105) | .076 → .185 (+.109) | .081 → .186 (+.105) | .077 → .185 (+.108) |
| major-chord | .044 → .123 (+.079) | .055 → .123 (+.068) | .047 → .123 (+.076) | .043 → .118 (+.075) | .054 → .118 (+.065) | .046 → .118 (+.072) |
| palm-mute | .094 → .190 (+.096) | .098 → .190 (+.091) | .095 → .190 (+.095) | .094 → .204 (+.110) | .095 → .205 (+.110) | .095 → .204 (+.109) |
| musical-excerpt | .028 → .048 (+.021) | .043 → .071 (+.028) | .036 → .057 (+.021) | .038 → .085 (+.047) | .049 → .105 (+.056) | .044 → .094 (+.050) |
| harmonics | .014 → .021 (+.007) | .022 → .031 (+.009) | .017 → .024 (+.008) | .013 → .024 (+.010) | .018 → .033 (+.015) | .016 → .027 (+.011) |
| pinch-harmonics | .043 → .011 (-.032) | .070 → .044 (-.026) | .049 → .020 (-.029) | .040 → .015 (-.024) | .061 → .039 (-.022) | .044 → .025 (-.019) |

The five families clearing both frozen per-technique thresholds on both
modalities are dominant-seventh-chord, major-chord, palm-mute, scale, and
single-note. Harmonics and musical-excerpt improve, but do not clear the
per-technique exact threshold on every modality. Pinch-harmonics regress in
both modalities.

The paired item-level exact-pitch deltas (the report also retains paired onset
and PC deltas) are:

| Item | DI exact delta | Amp/mic exact delta |
| --- | ---: | ---: |
| `p1-singlenotes-all` | +.304 | +.370 |
| `p2-singlenotes-all` | +.276 | +.369 |
| `p1-scale-c` | +.055 | +.093 |
| `p2-scale-gb` | +.076 | +.045 |
| `p1-tech-palm-mute` | +.219 | +.450 |
| `p2-tech-palm-mute` | +.562 | +.600 |
| `p1-tech-harmonics` | +.084 | +.068 |
| `p2-tech-harmonics` | +.349 | +.343 |
| `p1-tech-pinch` | -.084 | -.080 |
| `p2-tech-pinch` | -.120 | -.102 |
| `p1-chord-set1-major` | +.471 | +.457 |
| `p2-chord-drop3-7` | +.252 | +.211 |
| `p3-music-12` | -.049 | -.061 |
| `p3-music-08` | -.029 | +.101 |

## Octaves, failures, and interpretation

GAPS reduced aggregate octave-displaced error from 0.173 to 0.025 on DI and
from 0.159 to 0.030 on amp/mic. The p2 pinch-harmonics items are exceptions:
their per-item octave rates rise under GAPS (DI .405→.600; amp/mic .412→.500),
which is why the report retains item-level metrics instead of hiding them in
the aggregate.

This is consistent with a domain-specific AMT result: the pinned GAPS model
has a real-guitar training/benchmark lineage, while Guitar-TECHS includes
electric-guitar techniques such as pinch harmonics and distorted excerpts.
That interpretation is explanatory only; no thresholds were tuned to it.

## Boundaries and retention

- No third AMT, alternate checkpoint, separator, mixture, cold-song transfer,
  production MIDI integration, catalog mutation, deploy, or listening pass was
  run.
- The result does not authorize replacing Basic Pitch in the Keyspilli
  production path yet. Productization requires a separate transfer experiment
  and human musical acceptance.
- The compact path-free report, pre-registration, run manifest, and hashes are
  retained locally as named artifacts; reacquirable audio, checkpoint, virtual
  environments, and feature/cache material are disposable after verification.
- The opaque frozen selection digest is treated as a pre-registration identity
  token coupled to the exact ordered IDs, raw pre-registration hash, and frozen
  baseline manifest identity; it is not recomputed from private bytes in this
  repository.

## Verification

The closeout gate is: focused GAPS attribution tests, full workspace tests,
all six workspace typechecks, `git diff --check`, two byte-identical report
runs, local checkpoint hash verification, and remote branch SHA verification.
The final commit and remote SHA are reported with the closeout; no production
runtime claim is made.
