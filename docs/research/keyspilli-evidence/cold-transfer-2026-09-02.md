# Cold raw guitar AMT transfer — 2026-09-02

## Decision

The preregistered three-song transfer is **unavailable**. The exact frozen
guitar-stem inputs that produced the recorded Basic Pitch outputs are not
retained with verifiable provenance, and no equivalent deterministic
reproduction was available in this checkout. The evaluator therefore returned
`GAPS_COLD_TRANSFER_UNAVAILABLE` with architecture `NO_PROMOTION`.

No GAPS cold inference, reference read, separator run, arranger run, piano
generation, upload, deployment, or production mutation occurred.

## Frozen boundary

* Experiment: `metal-guitar-amt-transfer-2026-09-02`
* Starting revision: `ae4b46a2aa798a397546d966d1143dd0f25ee0fa`
* Songs: `final-solution`, `gott-mit-uns`, `red-baron`
* Basic Pitch: ONNX, onset `0.45`, frame `0.30`, config hash
  `fa0c798525cacacf635d890d88a573be6604419ef77f4bf4d176add33ed430c2`
* GAPS code: `96f6797881e9497cbfc8f8e5deccea9c1f2f7adc`
* GAPS checkpoint SHA-256:
  `65483e7c0e340a90415b15b520687587698c8c728f5fa470a205f13ee45c6513`
* Evaluation: absolute seconds, fixed `0.08`-second onset tolerance,
  deterministic maximum-cardinality one-to-one matching, no alignment or
  transposition.
* Preregistration template SHA-256:
  `817e80b225070f081662072df2d81c03707d439ef7357baf19556c313407cb52`

The local control manifest records the expected frozen stem directories as
missing. Retained Basic Pitch MIDI files and alternate WAVs were not treated as
valid substitutes because their exact source-stem identity could not be
proved. The human reference files remained outside the run and unread.

## Evaluator result

The deterministic report was written to the run-local artifact root and hashed
as:

* status: `unavailable`
* global decision: `GAPS_COLD_TRANSFER_UNAVAILABLE`
* architecture: `NO_PROMOTION`
* references read: `false`
* songs evaluated: `0/3`
* report SHA-256:
  `e286fe4f868ff62f294e5695d5ff3b347c71ba4ccc90af1a6478ddf5c3b49806`

Consequently onset, exact-pitch, pitch-class, octave, density,
complementarity, union, and intersection metrics are null/unavailable rather
than inferred. No replace/complement/research conclusion about GAPS on these
three songs is claimed; the only valid conclusion is that this transfer run
must be reacquired with the exact frozen stems before scoring.

## Re-run boundary

Restore or regenerate the exact three guitar WAVs under the frozen separator
and provenance contract, verify their hashes before mounting any reference,
then run the existing `evaluate:cold-transfer` command unchanged. Keep the
reference files and all model inputs outside the repository and do not route
the raw comparison through the arranger.
