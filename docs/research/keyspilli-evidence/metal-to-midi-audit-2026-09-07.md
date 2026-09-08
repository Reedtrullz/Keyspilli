# Metal-to-MIDI audit — 7 September 2026

## Verdict

The system has a substantial, working piano-arrangement stage, but **reliable arbitrary metal recording → recognizable piano MIDI is not established**. Valid files, playable difficulty variants and inferred confidence are being asked to stand in for source-note correctness. They cannot do that. The approved Livgardet repair followed an explicit piano tutorial and the ABBA repair followed accompaniment keys; those successes validate a much easier source route, not dense-band audio transcription.

Two concrete defects were reproduced and fixed locally. No production code was changed, no catalog entry was regenerated, and no model was downloaded or promoted in this audit.

## Scope and runtime evidence

Local base: `6aa776f` on the existing `codex/organ` branch. Existing catalog-policy edits and earlier reports were preserved. Production worker image: `ghcr.io/reedtrullz/keyspilli-worker:c36680100de9`. Read-only runtime checks confirmed `auto` mode and `htdemucs_6s`; worker, stem-pipeline and metal-arranger source hashes match this checkout. Runtime identity is captured in `output/metal-audit-20260907/runtime-identity.txt`.

Traced YouTube acquisition → tempo estimation → Demucs separation → per-role Basic Pitch → metal routing → identity/harmony arrangement → MIDI serialization → catalog variant generation → structural evaluation. Reviewed the stored release-gap reassessment and frozen MuScriptor evaluation. Replayed cached four-stem metal evidence through the corrected evaluator without reference scoring or parameter tuning. No protected benchmark references were read into generation or tuning.

## Findings, in priority order

| Priority | Finding | Evidence and consequence | Disposition |
|---|---|---|---|
| High | Failed stem routing still publishes a full-mix transcription | `services/transcribe/src/worker.ts:357`: auto mode catches separator, transcription and suitability failures, then invokes legacy Basic Pitch. It records a warning in provenance, but this is still an ordinary completed conversion. A resource failure and an unsuitable musical source both take this path. | Reported. A reviewed/unreviewed or withheld result is preferable to treating this as equivalent quality, but changing publication policy requires a deliberate product decision and calibrated criteria. |
| High | Musical acceptance is not measured by the publication gate | `worker.ts:298` only requires eight identity notes and sixteen total notes after arrangement. Subsequent validators address file/variant integrity; no reference-backed pitch, phrase coverage or recognizability requirement establishes melody correctness. Section confidence is a heuristic, not calibrated accuracy. | Reported. The next quality effort should measure missing/wrong lead notes across sections, not add another global cleanup threshold. |
| High | Six-source piano evidence was dropped | `services/transcribe/src/separate_stems.py` reported vocals/bass/drums/other/guitar but ignored `piano.wav`, while the default model is six-source. | **Fixed locally:** fold piano back into the existing residual lane before transcription. No new musical role or model. |
| Medium | Local evaluator used the wrong role for four-source residuals | `packages/catalog/scripts/evaluate-metal.ts` read `guitar.mid` without `report.json`. Production marks this file as residual `other`; the arranger intentionally applies stricter residual logic. The evaluator therefore tested a different identity-selection path. | **Fixed locally:** consume and validate source-role provenance, preserving the existing no-report behavior for manually supplied stems. Invalid or duplicate mappings fail explicitly. |
| Medium | Evaluated variants differed from the production boundary | The evaluator built variants from the pre-serialization object, disabled range normalization and omitted the catalog's explicit sustain policy. Production reparses the MIDI, uses `audioDerived: true`, and supplies `maxDurBeats: null` for metal. | **Fixed locally:** build variants from reparsed bytes with matching settings. Regression compares variant metrics with an independently constructed worker-like MIDI round trip. |
| Medium | Timing assumptions remain coarse | `tempo.py` yields one clipped 40–220 BPM estimate; the worker does not preserve a beat/downbeat map or section-specific tempo. `metal-arrange.ts:4023` warns about mismatched stem tempos but still uses their beat positions unchanged. | Reported; no blind tempo/rhythm rewrite. Normally the worker gives all stem transcribers the same tempo, so mismatched metadata is primarily an alternate-input/replay risk. |
| Medium | Experimental adapters are not evidence of the live route | The external-symbolic route and piano-transcription adapter have tests, but the live worker does not import them. The symbolic upload path is separately useful. | Reported; avoid describing experimental modules as deployed automatic source discovery. |

## What the cached replay proves

Using the existing four-source `metal-canary-defence-of-moscow-v2` stem MIDIs, the corrected evaluator emitted:

- 800 canonical notes: 152 RH and 648 LH, approximately 252.7 seconds.
- Structural gate: pass, zero gate warnings; all generated difficulty variants validated.
- Largest RH inter-attack gap: 29.57 beats, approximately **15.8 seconds**.
- Canonical simultaneity maximum: five notes. The diagnostic span metric counted 17 hand-span violations, with eight in Advanced; these counts are not included as hard failures by this gate.

A gap alone can be a legitimate rest, so this does **not** prove an incorrect passage. It does demonstrate that a structural pass cannot establish melody completeness or learner suitability. This is an older cached canary, not the currently retained catalog arrangement and not a fresh six-source inference. Detailed metrics: `output/metal-audit-20260907/cached-stem-evaluation.json`.

## Existing model evidence

The stored frozen 5 September MuScriptor evaluation reports synthetic exact-pitch/onset macro F1 of 0.820 versus Basic Pitch's 0.491, with wins on two of three fixtures. However, its layered melodic fixture regressed by 0.110, failing the preregistered regression gate. The real-metal reference covered kick onsets only (F1 0.673), not full pitched melody/harmony. Downstream arrangement was not run because the raw gate failed.

Consequently neither the good synthetic average nor the drum result supports replacing the production transcriber. These are recorded historical results, not rerun model inference or independently re-certified benchmark claims. Source: `muscriptor-dense-metal-cold-evaluation-2026-09-05.json` beside this report.

## Fix details and verification

The piano repair reads aligned residual and piano WAVs in blocks of 65,536 frames and writes their sum to a float WAV. This preserves timing and peaks above unity without clipping or blockwise gain changes. It rejects unequal sample rates, channel counts or frame counts, retains the original residual WAV during the scratch run, and leaves the four-source path unchanged. It reuses SoundFile already installed in the worker through its audio dependencies.

The regression invokes the actual separation wrapper with synthetic WAVs; only the expensive Demucs inference call is substituted. The old code failed because piano samples disappeared. The corrected code passes exact sample comparison, a cross-block tail, silence, a summed peak of 1.25, three timeline-mismatch cases and the four-source fallback. It was run against isolated copies under `/data/review-metal-audit-20260907/`, using the worker's existing Python environment; `/app` production source and jobs were not altered. **This verifies audio transport, not improved Basic Pitch accuracy or listening preference.** Adding back a poorly separated piano component may also restore bleed, so full-song A/B review remains important before deployment.

Verification this run:

- Transcription service: 42 TypeScript tests passed.
- Metal arrangement, harmony and quality: 156 tests passed.
- Evaluator and arrangement-evaluation: 55 tests passed, including the reproduced provenance regression and malformed-provenance rejection.
- Python separation regression: passed, including boundary subcases above.
- Catalog and transcription TypeScript checks passed; `git diff --check` passed.
- No whole-repository test, new model inference, human listening acceptance, deployment or catalog regeneration is claimed.

Runnable checks:

```sh
npm run test -w @keyspilli/transcribe
npm run test -w @keyspilli/midi -- test/metal-arrange.test.ts test/metal-harmony.test.ts test/arrangement-quality.test.ts
npm run test -w @keyspilli/catalog -- test/evaluate-metal.test.ts test/arrangement-evaluation.test.ts
npm run typecheck -w @keyspilli/catalog -w @keyspilli/transcribe
# Run with the worker's Python/audio dependencies:
python -m unittest discover -s services/transcribe/test -p 'test_*.py'
```

Private execution logs are under `output/metal-audit-20260907/`; source audio and reconstructed MIDI remain uncommitted.

## Most useful next investment

1. Use a small, fixed development set spanning clean-vocal melodic metal, riff-led metal and dense distorted material. Keep evaluation references separate from tuning material. Compare raw source evidence, the selected identity line and each difficulty so the first point of melody loss is visible.
2. A/B the piano-preservation repair on the same full recordings with identical settings. Measure section-level RH coverage and extra-note rate; inspect/listen to intro, verse, chorus and solo rather than accepting whole-song averages. Preserve rests and intentional chromatic notes.
3. Make output status honest when the stem route degrades: review-required output with the actual fallback reason, or withholding for clearly unusable results. Calibrate thresholds against that development set before turning them into hard publication gates.
4. Prefer the already working native MIDI/MusicXML or explicit piano-source route when it exists. Improve discovery/integration only after identity, arrangement version and timing ownership are known; that is separate from proving arbitrary full-mix AMT.

The implemented changes are local and uncommitted. Deploying them is a separate step; the live songs and the preceding duplicate cleanup are unchanged.
