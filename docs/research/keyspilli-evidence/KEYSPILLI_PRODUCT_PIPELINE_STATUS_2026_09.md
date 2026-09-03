# Keyspilli product pipeline status — 2026-09-03

## Current posture

Candidate A (`BEGINNER_SPARSE_OFFGRID_RH_BUDGET_VALIDATED`) remains the only
promoted learner-policy change. The semantic-harmony/source-lineage work and
the candidate-intake work below are additive; no benchmark material entered
generation and no production data was written.

The preceding intake/shadow mission started at
`d284b911b2a1ce3e22ce701f0ca02588f1f2b238`. The current real-timing
hardening slice started at
`1ea2118675a2f75c17440a481a7dc8b55fcfca8f`; this score-to-recording
alignment mission was preregistered at checkpoint
`93127f1db268cf343ef76640af5e800795af4cd4`.

## Stage status

| Stage | Status | Evidence boundary |
|---|---|---|
| Source intake | VALIDATED (local + approved direct URL seam) | Native MIDI/MusicXML/MXL parsing, bounded bytes, magic/content checks, HTML/error rejection, path-safe provenance, and candidate firewall tests pass. MSCZ is recognized but explicitly unsupported. |
| Parse/provenance | VALIDATED | Native adapter records SHA-256/size/parser metadata; unknown provenance is not generation-eligible. |
| Role inference | VALIDATED (shadow override) | The single-stem Guitar-TECHS MIDI is explicitly mapped to guitar for the shadow arrangement; no drum pitches reached output. |
| Alignment | PARTIAL — REFERENCE HEADROOM PROVEN | Three real ASAP score/audio pairs were evaluated from original MAESTRO carrier bytes. The current Keyspilli monotonic-DTW method is partial on two held-outs; official SyncToolbox MrMsDTW reaches 100% annotated-beat coverage with median `0.009–0.018 s` and p95 `0.035–0.270 s`, materially beating the naïve global-tempo mapping. This proves headroom, not production readiness. |
| Arrangement | PASS (real shadow) | The real pair completed `buildMetalArrangement`; semantic guitar diagnostics and source-tagged output were produced in memory. |
| Six physical difficulties | PASS (real shadow) | Advanced, Medium, Easy plus the remaining physical levels were generated and validated. |
| Artifact writing | PASS (in-memory roundtrip) | All six physical variants produced MIDI and MusicXML bytes in memory; existing artifact validators and reparsers passed. No files were persisted. |
| Catalog/public projection | PASS (in-memory) | One grouped shadow song and five public levels were projected from scratch rows without catalog writes. |
| Player entry links | NOT_EXERCISED | Link resolution requires a persisted catalog item; this path performs no catalog writes and no deployment was authorized. |

## Real non-synthetic shadow pair

The current mission froze three independent ASAP v2.1.1 pairs (one DEV and two
held-outs), using the original MAESTRO carrier bytes and the official ASAP
crop/padding rule. The metadata-only report is
`asap-score-alignment-2026-09-03.json`; the raw audio, score, and performance
MIDI remain outside Git. The current score-to-recording method is
`SCORE_ALIGNMENT_PARTIAL`; the official SyncToolbox reference is
`SCORE_ALIGNMENT_REFERENCE_PROVES_HEADROOM`.

The ASAP DEV pair has source audio SHA-256
`1216c05f0532e6c3c81e299068d9d757709c8d3a71ad30277533705f41925a75`, score
SHA-256 `153f4bbb2a1cdbe7fde43a83e80e8b0aa8194e1c8180a6e2755778f2736f7807`,
and 111 usable annotated beats. Current Keyspilli median/p95 timing error is
`0.020764/0.059316 s`; the official reference is `0.008750/0.034896 s`.
Held-out current p95 errors are `1.796573 s` and `0.994780 s`, while the
official reference reports `0.071514 s` and `0.269892 s`.

The DEV symbolic candidate was also routed through the actual external-symbolic
arrangement path with the independently supplied ASAP aligned status. The
semantic-band route produced all six physical levels, validated MIDI and
MusicXML artifacts, and projected one grouped song with five public levels in
private scratch. Because the current production alignment method is still
partial, the product-path decision remains `REAL_SHADOW_BLOCKED_AT_ALIGNMENT`;
the downstream proof is not a production readiness claim.

The real-pair mission report records source hashes, deterministic rerun hashes,
alignment metrics, and the route report hash. No benchmark material entered
generation or tuning.

Closeout verification: workspace `1,579/1,579` tests passed
(web89/catalog1012/engrave8/midi336/player-core92/transcribe42), all six
workspace typechecks passed, both alignment and downstream route reports were
canonical-identical on repeat, JSON validation passed, and `git diff --check`
passed. Disk free at close was 62 GiB.

### Prior Guitar-TECHS shadow pair

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
- `SCORE_ALIGNMENT_REFERENCE_PROVES_HEADROOM`: the preregistered ASAP real-pair
  comparison shows the official SyncToolbox reference materially outperforms
  the current production-intended method on held-out recordings, although one
  held-out p95 remains above the strict provisional threshold. This is evidence
  for the next implementation slice, not a production-readiness claim.
- `REAL_SHADOW_BLOCKED_AT_ALIGNMENT`: the ASAP symbolic candidate completed the
  downstream arrangement, six-level generation, artifact roundtrips, and
  five-level grouped public projection in memory using independently annotated
  alignment status. The current Keyspilli alignment method remains partial on
  two held-outs, so the first blocker is production score-to-recording
  alignment. Player links were not exercised because no catalog row was saved.

## Acceptance boundary

Automated structural evidence is the active gate. `MUSICAL_QUALITY_NOT_OBJECTIVELY_ESTABLISHED`.
Human listening is `NOT_REQUESTED` / `NOT_REQUIRED_BY_DEFAULT`; no listening
pack or rater gate was created. Deployment is `NOT_DEPLOYED`.

The next single engineering task is
`IMPLEMENT_SCORE_ALIGNMENT_PRODUCTION_HARDENING`; it is a decision only and is
not implemented in this checkpoint.

Detailed machine evidence is recorded in the
`asap-score-alignment-2026-09-03.json` evidence file and the matching
`experiment-ledger.json` entry. The local runners are
`packages/catalog/scripts/evaluate-asap-score-alignment.py` and
`packages/catalog/scripts/evaluate-asap-synctoolbox.py`.
