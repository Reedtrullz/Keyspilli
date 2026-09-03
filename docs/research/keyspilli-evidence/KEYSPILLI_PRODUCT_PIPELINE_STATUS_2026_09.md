# Keyspilli product pipeline status — 2026-09-03

## Current posture

Candidate A (`BEGINNER_SPARSE_OFFGRID_RH_BUDGET_VALIDATED`) remains the only
promoted learner-policy change. The semantic-harmony/source-lineage work and
the candidate-intake work below are additive; no benchmark material entered
generation and no production data was written.

The preceding intake/shadow mission started at
`d284b911b2a1ce3e22ce701f0ca02588f1f2b238`. The current real-timing
hardening slice started at
`1ea2118675a2f75c17440a481a7dc8b55fcfca8f`.

## Stage status

| Stage | Status | Evidence boundary |
|---|---|---|
| Source intake | VALIDATED (local + approved direct URL seam) | Native MIDI/MusicXML/MXL parsing, bounded bytes, magic/content checks, HTML/error rejection, path-safe provenance, and candidate firewall tests pass. MSCZ is recognized but explicitly unsupported. |
| Parse/provenance | VALIDATED | Native adapter records SHA-256/size/parser metadata; unknown provenance is not generation-eligible. |
| Role inference | VALIDATED (shadow override) | The single-stem Guitar-TECHS MIDI is explicitly mapped to guitar for the shadow arrangement; no drum pitches reached output. |
| Alignment | VALIDATED_MATCHED_PERFORMANCE_ONLY | A bounded MAESTRO real audio+MIDI pair provides independent native MIDI timing truth. The fixed chroma+onset monotonic-DTW candidate recovers offset, ±4% scale, piecewise drift, and combined drift challenges at 100% note coverage with p95 residuals `0.051–0.092 s` and zero monotonic violations. A score-like 1/8-second representation is within the absolute `0.250 s` ceiling but is worse than the naïve `0.059 s` p95 baseline, so arbitrary external-score alignment remains open. |
| Arrangement | PASS (real shadow) | The real pair completed `buildMetalArrangement`; semantic guitar diagnostics and source-tagged output were produced in memory. |
| Six physical difficulties | PASS (real shadow) | Advanced, Medium, Easy plus the remaining physical levels were generated and validated. |
| Artifact writing | PASS (in-memory roundtrip) | All six physical variants produced MIDI and MusicXML bytes in memory; existing artifact validators and reparsers passed. No files were persisted. |
| Catalog/public projection | PASS (in-memory) | One grouped shadow song and five public levels were projected from scratch rows without catalog writes. |
| Player entry links | NOT_EXERCISED | Link resolution requires a persisted catalog item; this path performs no catalog writes and no deployment was authorized. |

## Real non-synthetic shadow pair

`guitar-techs:p3-music-08` is Guitar-TECHS v1 (Zenodo record `14963133`),
licensed CC BY 4.0. The paired item is a real DI WAV plus its supplied MIDI
performance truth, not a Keyspilli-rendered synthetic mix. Metadata-only
evidence retained for the pair:

- symbolic: 1,496 bytes, SHA-256 `329b128e6cb86cc2c43502ecdf8ae89e0049f69b564e29e41ef55b7b54411250`, 143 notes, 50.111458 beats;
- audio: 7,872,690 bytes, SHA-256 `f58cd8dcd68eeec7c9e58839e7161671ba3af9963957e35f1f04a1f2644d3ff3`, 48 kHz stereo 24-bit, 27.333333 seconds;
- onset detector: 121 measured onsets, 119 after the configured 0.02-second deduplication;
- canonical report SHA-256 (excluding the determinism field): `51501cfc9362e161d6c48586251f1ea972ded4aa7434aba06a21532edac524dd`;
- report bytes SHA-256: `e5e7503c7b44414f06726b85a1ccb02ce509d952ac361c698f68dc8421bf785b`.

The real bytes remain outside the repository. The checked-in report contains
no physical paths, note arrays, or source bytes.

## Real timing calibration pair

`maestro:v3:2015-prelude-3` is one bounded MAESTRO v3.0.0 performance,
licensed CC BY-NC-SA 4.0. Its native MIDI tempo map is the timing ground truth;
the supplied Disklavier WAV is independent recording evidence. Metadata-only
evidence retained for the pair:

- symbolic: 5,920 bytes, SHA-256 `c72281527ca6588836bd1e109de848a8fd2ac246bbf06e25a58939d3168468fe`, 629 notes, PPQ 480, 90.310417 beats / 45.161458 seconds;
- audio: 8,142,740 bytes, SHA-256 `040e85a32b576074dc3af60fa8175472d6584bd76fb6156808449df66ecfb77e`, 46.160408 seconds;
- fixed challenge report canonical SHA-256 `73f05f44a2e8809efcb9b4c259a437c65c74fbcafcd4e09c23c55249c081152d`;
- the research runner is `packages/catalog/scripts/calibrate-real-alignment.py`; media stays outside Git.

Matched-performance calibration passed every fixed challenge gate. The
score-like challenge did not materially beat the direct baseline, producing the
decision `REAL_ALIGNMENT_MATCHED_ONLY` rather than claiming external-score
alignment readiness.

## Decisions

- `GENERATION_CANDIDATE_INTAKE_READY` for bounded local symbolic input and the
  opt-in approved-direct-URL seam. A parsed candidate without known provenance
  or aligned evidence remains explicitly ineligible for generation.
- `REAL_ALIGNMENT_MATCHED_ONLY`: matched-performance calibration is reproducible
  on the MAESTRO pair, but score-like symbolic timing is not materially better
  than the naïve baseline. Native Guitar-TECHS timing is preserved as source
  evidence, with absolute sample-zero latency still unproven.
- `REAL_SHADOW_BLOCKED_AT_ALIGNMENT`: the Guitar-TECHS downstream arrangement,
  six-level generation, artifact roundtrips, and five-level grouped public
  projection complete in memory using the native tempo map, but the first
  product-path blocker remains robust external-score alignment. Player links
  were not exercised because no catalog row was saved.

## Acceptance boundary

Automated structural evidence is the active gate. `MUSICAL_QUALITY_NOT_OBJECTIVELY_ESTABLISHED`.
Human listening is `NOT_REQUESTED` / `NOT_REQUIRED_BY_DEFAULT`; no listening
pack or rater gate was created. Deployment is `NOT_DEPLOYED`.

The next single engineering task is
`SCORE_TO_RECORDING_ALIGNMENT_HARDENING`; it is a decision only and is not
implemented in this checkpoint.

Detailed machine evidence is recorded in the
`real-symbolic-timing-hardening-2026-09-03.json` evidence file and the matching
`experiment-ledger.json` entry. The local runners are
`packages/catalog/scripts/evaluate-real-shadow-pair.ts` and
`packages/catalog/scripts/calibrate-real-alignment.py`.
