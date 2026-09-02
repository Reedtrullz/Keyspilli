# Texture-conditional AMT routing experiment — 2026-09-02

## Decision

**`ROUTING_CEILING_LOW`; `router: not-built`; `NO_PROMOTION`.** A perfect
reference-informed oracle choosing Basic Pitch or GAPS independently in fixed
four-second windows did not reach the preregistered material-gain bar on any
song/metric combination. Keep the frozen GAPS result research-only. Do not
replace Basic Pitch, build a production router, or union the two note streams.

This is a post-freeze evaluation only. No separator or AMT model was rerun, no
arranger/variant/API path was invoked, and no production behavior changed.

## Frozen and preregistered boundary

* Experiment: `cold-transfer-20260902-texture-routing`
* Parent prediction freeze: `4f35dac532a5fd68fcb27ba26c0efbe6e393a3aba58b3d4dd19fc619f134b13e`
* Routing preregistration: `e5b956e2eddd306b65f155f8790d7000895887a3e09c4affd924f694d8fd7fe3`
* Routing plan file: `631ca3a0304a65f3409ab776d644a16c0dc06be8b143fc394a339ee126069071`
* Canonical routing plan: `4abd04811e3f0b913843d1174b1e09bb8528191f807cf8bb5af98a74e9e01aba`
* Evaluation report: `0b2af06b1397246950ba0e90f85e4a80e03e1a7a1e73130c906eef8612e26007`
* Canonical report: `15c30f88d40ace83699c684bddb6bb59a11bfe61052eb72f382718bed012afce`

Windows are half-open, fixed at four seconds, and cover candidate source
duration. Onset tolerance is 0.08 seconds. Truth is clipped to the candidate
duration for the full-song metrics so fixed backends and the oracle use the
same evaluated support.

## Per-song result

F1 columns are `onset / exact-pitch / pitch-class`.

| Song | Basic fixed | GAPS fixed | Oracle | Oracle gain over better fixed |
| --- | ---: | ---: | ---: | ---: |
| Final Solution | 0.3528 / 0.0361 / 0.0813 | 0.2601 / 0.0334 / 0.0619 | 0.3791 / 0.0428 / 0.0900 | +0.0263 / +0.0067 / +0.0087 |
| Gott Mit Uns | 0.5183 / 0.0550 / 0.1628 | 0.4496 / 0.0649 / 0.1314 | 0.5267 / 0.0762 / 0.1699 | +0.0084 / +0.0113 / +0.0071 |
| The Red Baron | 0.4823 / 0.1871 / 0.2603 | 0.1839 / 0.0566 / 0.0793 | 0.4945 / 0.1953 / 0.2676 | +0.0122 / +0.0082 / +0.0072 |

The oracle criterion required at least two songs to gain `>=0.03` exact or
pitch-class F1 over the better fixed backend. It reached zero songs. The
window winners were correspondingly mixed: Basic won most onset windows, while
GAPS won a minority of exact/pitch-class windows, especially on Gott Mit Uns;
that mixture is not enough to justify a transparent rule without using the
held-out reference labels.

## Complementarity and generation-side evidence

The note-union ceiling remains a separate diagnostic. Union recall is higher in
some cases, but its precision is poor and it is not equivalent to selecting one
backend per region. For example, the final-solution union F1 is
`0.2197 / 0.0262 / 0.0579`, versus the oracle's
`0.3791 / 0.0428 / 0.0900`; retaining every candidate is not a safe routing
architecture.

The preregistered descriptors were candidate density, onset density, stack
multiplicity, duration/short-note rate, register, rhythmic regularity,
candidate-side agreement, and deterministic texture classes. They remain
descriptive only. The small corpus does not support fitting thresholds or a
classifier from reference outcomes. The detailed generation-side values and
reference-support counts are in the companion JSON, including per-backend
precision/recall, texture-class summaries, and agreement classes.

The texture classes were not a hidden routing rule. Across the fixed windows,
Final Solution was mostly `RHYTHM_CHUG` (29) and `POWER_CHORD` (25), Gott Mit
Uns was mostly `POWER_CHORD` (23) and `RHYTHM_CHUG` (18), and The Red Baron was
mostly `POWER_CHORD` (27) and `RHYTHM_CHUG` (18). Exact shared-candidate
precision was only 3.1%, 5.8%, and 29.5% respectively; pitch-class shared
precision was 5.4%, 16.5%, and 35.7%. Basic-only and GAPS-only support was
material, especially on The Red Baron (406 and 40 exact matches), so the
signals are complementary but not a safe region-level switch.

## Limits and next boundary

This experiment measures raw transcription agreement, not musical
recognizability, playable arrangement quality, or lead-role correctness. It
has three songs, frozen model outputs, fixed windows, no alignment or
transposition, and no human listening gate. A reference-supported oracle is an
upper-bound diagnostic, not deployable logic. The result therefore stops at
**no router/no promotion**; any future AMT work needs an independently frozen
development corpus and a separate human listening decision.

The supplied reference MIDI and all frozen media remain outside Git. The
machine-readable companion is
`texture-amt-routing-2026-09-02-metrics.json`.
