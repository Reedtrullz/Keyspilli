# Cold guitar AMT transfer rerun — 2026-09-02

## Decision

**NO_PROMOTION.** The three-song, common-stem rerun completed with frozen
Basic Pitch and GAPS predictions, but GAPS was not a consistent improvement:
Final Solution regressed on every reported metric, Gott Mit Uns gained a small
exact-pitch F1 amount while losing onset and pitch-class F1, and The Red Baron
regressed substantially. Keep GAPS research-only and do not replace the
current backend globally.

This is an evaluation-only result. No arranger, learner variant, API payload,
production replay, deployment, or upload was run.

## Frozen boundary

* Experiment: `cold-transfer-20260902-common-stems-rerun`
* Revision: `3724d0eb08aeaf8690d0852f842d76d75de3f591`
* Songs: `final-solution`, `gott-mit-uns`, `red-baron`
* Source recordings were recovered by exact SHA-256 identity from the local
  recording archive. The guitar WAVs were regenerated with Demucs rather than
  recovered as the historical frozen bytes, so they are
  `PROVENANCE_EQUIVALENT_STEM_REGENERATED`, not historical-stem recovery.
* Both inference backends consumed the same frozen guitar WAV for each song.
  Predictions were hashed and frozen before any reference MIDI was opened.

Separator configuration was Demucs 4.0.1, `htdemucs_6s`, CPU, shifts `1`,
overlap `0.25`, with checkpoint SHA-256
`34c22ccb381c6f9fdbf324f04e1e2fe21aaaf293f5ded163a162697ff9a02ddd`.
The host's torchaudio backend was unavailable, so the pinned model output was
written as PCM-16 WAV with soundfile 0.14.0; this writer limitation is part of
the frozen record.

Basic Pitch used ONNX, version `0.4.0` (the historical version was unknown),
onset `0.45`, frame `0.30`, tempo `120`. GAPS used code revision
`96f6797881e9497cbfc8f8e5deccea9c1f2f7adc`, checkpoint SHA-256
`65483e7c0e340a90415b15b520687587698c8c728f5fa470a205f13ee45c6513`, MPS,
10-second segments, 0.5 overlap, thresholds onset/offset/frame/pedal
`0.3/0.3/0.1/0.2`, batch 8, and MIDI writer tempo/PPQ `120/384`.

Prediction-freeze SHA-256:
`4f35dac532a5fd68fcb27ba26c0efbe6e393a3aba58b3d4dd19fc619f134b13e`.

## Frozen artifact hashes

| Song | Source audio SHA-256 | Guitar WAV SHA-256 | Basic Pitch MIDI SHA-256 | GAPS MIDI SHA-256 |
| --- | --- | --- | --- | --- |
| Final Solution | `8f92584c0561dfee67f4166bcdd3e6c6eced609f3df8f41839a7191bcebd3412` | `e7d48a43d3df707f12ed097d7f9c360cc269605f2b0533debb48bd13fb67afa1` | `7fe3a7580e76495b8f248dbccab00aa6e5242bf564d225d7168983a53fdada48` | `bcf40e5af6d8a0613fd311cf4b33d1f461c0f4a12093178f61d1ea870ce5668c` |
| Gott Mit Uns | `2f48c1933d59f7945add6d211dedccc41166e480b690678689b8b177f5d9b6f4` | `68fb18bda8748605e46f2aed4d1d394cd0f463a0e671f8bcb0ecf3a51236b03b` | `237aede73d553cfd54d8dbee3d6c0ddcdb557d92e0b144d18b5aac1754447fbf` | `74b9caa157f10096df632489f0f1aea3fe7b0ffde93a76a3ca01b1bb2f92baf3` |
| The Red Baron | `9c511537c8cbaa18005cfe6638d450b88a5dced412faad99e5bf5f741c16f9dd` | `9d4f41432c093e78420e16a728f3636ee65287b5f2e9773efc0bbd70b87a6605` | `c3af35128acd7dfdcf7ddb39a5e6345c912b923cfbe1e0a3228995da9e88842b` | `c16832183d977323f91644de99eeb4702451d663556a79887a74d6ef998996e9` |

## Evaluation result

The evaluator report SHA-256 is
`7eceadb7bc0b560fd97c01135bc0d212c6192e04967116a492d85e9d050f9fa8` and its
canonical deterministic SHA-256 is
`991e11b7e86287ab3fce2618955cc5073aef6ebcde5002eb0c170b3d244966aa`.
Repeating the evaluator with the same manifest produced the same report and
canonical hashes.

| Song | Basic exact F1 | GAPS exact F1 | Basic pitch-class F1 | GAPS pitch-class F1 | Basic onset F1 | GAPS onset F1 | Classification |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Final Solution | 0.0347 | 0.0321 | 0.0782 | 0.0595 | 0.3391 | 0.2502 | `no-transfer` |
| Gott Mit Uns | 0.0550 | 0.0649 | 0.1628 | 0.1314 | 0.5183 | 0.4496 | `no-transfer` |
| The Red Baron | 0.1871 | 0.0566 | 0.2603 | 0.0793 | 0.4823 | 0.1839 | `mixed` |

Global report classification is `GAPS_COLD_TRANSFER_MIXED` with architecture
`TEXTURE_DEPENDENT`; it is not a promotion signal. The evaluator used
deterministic maximum-cardinality one-to-one matching in absolute seconds,
with a 0.08-second onset tolerance, no alignment, and no transposition.
References were read only after the prediction freeze. They are accepted
normalized local corpus artifacts, and this full-note comparison is diagnostic,
not a role-aware lead-quality or recognizability score.

## Limits and follow-up

The rerun establishes a reproducible paired-backend baseline, not a musical
winner. It does not justify feeding GAPS output into the arranger, changing
global thresholds, or claiming that a human reference has been matched. Any
future use should be a deliberately scoped, song/texture-specific experiment
with the same freeze-before-reference boundary and a separate listening gate.

The frozen media and reports remain outside Git under a run-local artifact
root. Only this path-free summary, the preregistration/report hashes, and the
ledger entry are durable.
