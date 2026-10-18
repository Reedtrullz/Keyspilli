# Opt-in source hand lanes: implementation and candidate gate

Implemented neutral tutorial `sourceLane` retention in `parseMidi` and an opt-in `inferSourceHands` source-profile option in `buildVariants`. The parser recognizes only the extractor's exact palette track labels (`blue/green/yellow/purple keys`); it assigns no hand from color. Inference compares the two complete unlabeled lanes: at least eight notes each, median pitches at least an octave apart, and disjoint middle50% pitch ranges. Any existing hand metadata, missing lane, extra lane, sparse data, invalid pitch, or overlapping central ranges abstains. The lower lane becomes L, the upper R, including their outlying notes. Hand inference runs before quantization, using the existing hand-preserving reducer; notes are never octave-revoiced.

This is a conservative statistical hypothesis, not verified staff assignment. The variant warning states whether inference applied or abstained. Existing callers do not opt in, so accepted/default arrangements are unchanged. No catalog/worker setting enables this automatically.

`build-source-lane-candidates.mts` produced 24 candidate note JSONs and hand-preserving MIDIs under `output/tutorial-recovery/source-lane-candidates-v1`. The committed `source-lane-candidates-2026-09-08.json` records full before/after hand metrics, worst half-second windows, SHA256 input receipts and the flagged passages. All24 default regenerations have exactly the accepted v10 note events; source MIDI and persisted accepted JSON hashes remain unchanged. Every candidate ladder validates; every candidate MIDI reparses to the same pitch/onset/duration/velocity/hand events.

| Passage | Default | Opt-in candidate | Gate |
|---|---|---|---|
| Second Metallica Easy229–233s | RH31-semitone movement in375ms | RH11-semitone movement in1.5625s | Concrete lane-separation improvement; listening pending |
| Queen Beginner166–170s | RH peak4 attacks/sec; leap9 in812.5ms | Same passage metrics | No difficulty improvement claimed |
| Accepted old Metallica Easy58–62s | RH peak2/sec; leap2 in2.0625s | RH peak4/sec; leap7 in375ms | Candidate changes accepted passage; do not replace it |
| AC/DC whole Beginner/Easy | Worst RH leap17 semitones | Worst RH leap26 semitones | Candidate needs source/phrase review |

All six candidates pass the inference hypothesis, but this does not establish easier or more recognizable arrangements globally. The new Metallica candidate keeps the genuine high melody and separates blue accompaniment crossing middle C; the source's two colors never had to be hardcoded to a hand. Other candidates demonstrate why this option remains gated. Structural limits pass for all24 candidates and cannot decide subjective difficulty or melody identity. No production activation, accepted-note replacement, source-rights claim or listening acceptance is included.

Validation:139 focused MIDI/parser/audit/timing tests pass; MIDI package typecheck and diff whitespace checks pass. New tests include color-order reversal, high accompaniment preserved in its inferred lane, explicit/missing/sparse/overlapping/invalid evidence abstention, no inference outside source opt-in, deterministic ordering and exact unchanged input events.

Reproduce from the repository root with Node22 and installed dependencies:

```sh
node node_modules/tsx/dist/cli.mjs docs/research/keyspilli-evidence/build-source-lane-candidates.mts > docs/research/keyspilli-evidence/source-lane-candidates-2026-09-08.json
node node_modules/vitest/vitest.mjs run packages/midi/test/source-hand-lanes.test.ts packages/midi/test/playability-audit.test.ts packages/midi/test/source-tempo-normalization.test.ts packages/midi/test/midi.test.ts
node node_modules/typescript/bin/tsc --noEmit -p packages/midi/tsconfig.json
```

## Bounded listening comparisons

Generated eight approximately four-second before/candidate WAV clips for new Metallica Easy229–233s, accepted old Metallica Easy58–62s, Queen Beginner166–170s and AC/DC Easy41–45s. `output/tutorial-recovery/source-lane-listening-v1/review.html` provides paired playback controls, metrics and download links with an explicit no-activation notice. Total new listening bundle:2,838,992 bytes (2.71MiB), below the20MiB cap. Existing local FluidSynth/TimGM6mb and the existing render/slice helpers were reused; no installation or download occurred.

Actual starts of notes already held during the crop lead-in are retained; each bounded render uses the same piano and peak normalization0.8, and each crop is four seconds within one audio sample. Temporary render WAV/MIDI files were removed. All eight WAVs decode to non-silent PCM. The local HTTP server returned exact bytes for the HTML, metrics and all eight WAVs. Browser verification was attempted but Chrome automation was blocked by another extension UI; browser playback and human listening acceptance remain unverified. Accepted artifacts were not written.

Reproduce with `node node_modules/tsx/dist/cli.mjs docs/research/keyspilli-evidence/render-source-lane-review.mts`. The local listening receipt is `source-lane-listening-v1/metrics.json`; committed decoding/HTTP evidence is `source-lane-listening-2026-09-08.json`.
