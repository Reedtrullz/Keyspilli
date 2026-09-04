# Keyspilli product pipeline status — 2026-09-04

## Current posture

Candidate A (`BEGINNER_SPARSE_OFFGRID_RH_BUDGET_VALIDATED`) remains the
promoted off-grid learner-policy change, and the separately frozen density
Candidate A is now validated under the public five-level contract and wired in
the learner production ladder. The semantic-harmony/source-lineage work and
the candidate-intake work below are additive; no benchmark material entered
generation and no production data was written.

The preceding intake/shadow mission started at
`d284b911b2a1ce3e22ce701f0ca02588f1f2b238`. The current real-timing
hardening slice started at
`1ea2118675a2f75c17440a481a7dc8b55fcfca8f`; this score-to-recording
alignment mission was preregistered at checkpoint
`93127f1db268cf343ef76640af5e800795af4cd4`.
The CLaMP3 sparse-landmark investigation started from the remote-backed
`76a39cd53329286a4a494058fa6434515c982525` checkpoint.

## Stage status

| Stage | Status | Evidence boundary |
|---|---|---|
| Source intake | VALIDATED (local + approved direct URL seam) | Native MIDI/MusicXML/MXL parsing, bounded bytes, magic/content checks, HTML/error rejection, path-safe provenance, and candidate firewall tests pass. MSCZ is recognized but explicitly unsupported. |
| Parse/provenance | VALIDATED | Native adapter records SHA-256/size/parser metadata; unknown provenance is not generation-eligible. |
| Role inference | VALIDATED (shadow override) | The single-stem Guitar-TECHS MIDI is explicitly mapped to guitar for the shadow arrangement; no drum pitches reached output. |
| Alignment | PARTIAL — V2 RESOURCE FIXED; NON-DTW SKF MIXED; CLaMP3 SPARSE RETRIEVAL RESOURCE-BLOCKED | Frozen V2 completes all four revealed ASAP/MAESTRO pairs but leaves regional accuracy unresolved. Matchmaker SKF is mixed and was not promoted. The one approved CLaMP3 reference was not evaluated because its pinned weights exceed the bounded footprint before download; no CLaMP3 production candidate was created. |
| Region ownership / fallback | VALIDATED (deterministic contract) | Explicit source/target regions, role ownership, timing authority, alignment state, provenance/firewall, fallback precedence, overlap/merge behavior, and no-owner withholding are enforced before semantic-band arrangement. |
| Arrangement | PASS (real native symbolic lane) | The user-supplied native performance completed the existing canonical arrangement path in scratch; downstream learner normalization now clears the unchanged production playability gate without changing arrangement policy. |
| Six physical difficulties | VALIDATED | All six physical variants are generated, serialized, independently validated, and round-trip through MIDI/MusicXML. Frozen density Candidate A changes only Easy/Medium/Advanced; Very Easy remains a legacy physical row. |
| Artifact writing | PASS (scratch persisted) | All six physical variants produced MIDI and MusicXML bytes, passed existing validators/reparsers, and were atomically persisted in an isolated temporary data directory. |
| Catalog/public projection | PASS (scratch persisted; non-production) | One grouped scratch song and five public levels were read through the catalog API; no production catalog write or publishability claim was made. |
| Player entry links | LOCAL_EXERCISED | Scratch-only browser flow resolved the Easy link, public five-level links, legacy Very Easy route, and MIDI/MusicXML exports against an isolated temporary catalog. |

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

### Fresh production-candidate validation

The candidate was frozen before any fresh result was inspected. The deterministic
selection and metadata are in
`asap-fresh-validation-selection-2026-09-03.json`; the result report is
`asap-fresh-validation-results-2026-09-03.json` with canonical hash
`3b4c7a3cd0cafe683804fd3e625c35e29ef5d220889b6a435bc9c5b6d6232c2f` (repeat
run canonical-identical). Schubert and Chopin completed the candidate path with
100% annotation coverage but failed the preregistered p95 threshold; Rachmaninoff
and Bach were rejected before matrix allocation by the frozen 32M-cell bound.
The resulting decision is `SCORE_ALIGNMENT_PRODUCTION_PARTIAL`; no fresh-result
tuning, deployment, or shadow generation route was performed.

Closeout verification: workspace `1,582/1,582` tests passed
(web89/catalog1015/engrave8/midi336/player-core92/transcribe42), all six
workspace typechecks passed, both alignment and downstream route reports were
canonical-identical on repeat, JSON validation passed, and `git diff --check`
passed. Disk free at close was 62 GiB.

### Memory-bounded regional V2 stop

`PRODUCTION_SCORE_ALIGNMENT_CANDIDATE_V2` was frozen and pushed at
`2ee00f18c1b30b07bc7e814410e2efa22077e174`, with fingerprint
`69df115d9c24fc3be3c5c1f8736fd73b80edd70ff57f62f3029d6f2fa05a231`. It keeps
the existing chroma-plus-onset features and replaces the full fine matrix with
an 8x coarse pass, a 96-frame corridor, and at most one deterministic 192-frame
expansion. The fine pass uses rolling cost rows plus a bounded backtrace; it
reports evaluated cells, dense-equivalent cells, edge pressure, weak regions,
working-set estimates, and confidence signals.

The four already-revealed development fixtures all completed: Rachmaninoff
(`2,818,102` fine / `54,671,115` dense cells, p95 `0.255922 s`) and Bach
(`2,644,962` / `48,094,104`, p95 `1.281471 s`) no longer hit V1's 32M-cell
rejection. Schubert remained at p95 `0.320047 s` and Chopin at `0.623680 s`,
with 56 and 69 weak regional runs respectively; all four retained 100% usable
beat coverage and zero monotonic violations. The repeated evaluator report is
canonical-identical (`ae1d6682164bd68d5c34bc36d6da4bf25ff5ebddaa56607e0f218617ab4533b4`).

Because the diagnosed regional mechanism did not improve, the mission stop rule
applies: no new unseen validation set, no downstream reroute, no alignment
parameter tuning, and no deployment. Decision:
`SCORE_ALIGNMENT_V2_ARCHITECTURE_INSUFFICIENT`. The resource ceiling is fixed
for these lengths, but classical coarse-to-fine DTW is not an adequate next
architecture for regional accuracy; the follow-up must be materially different.

### Hidden-tempo SKF reference stop

The single non-DTW reference was pinned to Matchmaker `v0.3.0`, commit
`0d106d07d96f9def77de116b29690c262b51b9ee`, Apache-2.0, in an isolated local
Python 3.11 environment. Only its official `audio`/`skf` path was evaluated:
`raw_spectrum`, 8 kHz, 128-sample hop, 512-point FFT, 200 hypotheses,
`sigma_eps_scale=0.05`, `sigma_eta_scale=0.01`, and `unfold_score=false`. The
score axis correction is a parser-interface correction (`onset_quarter /
onset_beat`, Bach `0.5`), not a fitted alignment parameter. The reference
report is `asap-matchmaker-skf-reference-2026-09-03.json`, canonical SHA
`85bb94f33d78ce0b2599887ee9d9f9109979209310537f9e10603e53fc0fe544`; its two
full reruns were canonical-identical.

Matchmaker models a switching `(chord, age)` state with a Gaussian hidden
tempo (seconds per whole note), updates tempo on chord advances, and scores
raw spectral observations against synthesized chord templates. It assumes a
strict linear score sequence; repeats/jumps are not modeled. The official
posterior argmax moved backward in 106/162/327/19 frames for
Schubert/Rachmaninoff/Chopin/Bach respectively; the evaluator uses a
deterministic monotone projection only for score-to-time inversion and reports
the reversals separately.

| Fixture | V2 p95 | SKF p95 | SKF median | SKF >.25 run | SKF >.5 run | Runtime | Peak RSS |
|---|---:|---:|---:|---:|---:|---:|---:|
| Schubert | 0.320047 s | 0.559260 s | 0.039093 s | 6 beats | 6 beats | 40.9 s | 672 MiB |
| Rachmaninoff | 0.255922 s | 0.596664 s | 0.075547 s | 3 beats | 2 beats | 54.7 s | 791 MiB |
| Chopin | 0.623680 s | 0.726767 s | 0.114824 s | 10 beats | 10 beats | 38.5 s | 791 MiB |
| Bach | 1.281471 s | 0.099203 s | 0.019730 s | 2 beats | 2 beats | 28.4 s | 791 MiB |

SKF therefore clears the existing `p95 <= 0.250 s` gate on none of the four,
and improves V2 by at least 20% on only Bach (0.922587 improvement ratio). Its
tempo-state summaries show large local excursions and increasing uncertainty
around failures, but the mixed regional result does not satisfy the
preregistered three-of-four headroom criterion. Decision:
`HIDDEN_TEMPO_ARCHITECTURE_NO_HEADROOM`; production decision:
`NON_DTW_SCORE_ALIGNMENT_ARCHITECTURE_INSUFFICIENT`. No internal SKF port,
fresh validation set, causal ablation, or downstream reroute was authorized.

### CLaMP3 sparse-landmark reference stop

The single cross-modal reference was frozen to the official CLaMP3 SAAS
implementation at repository commit `9016d2b0c8d12d1aa79c2e0ab201e6822bdc83a8`
(MIT). Its checkpoint was pinned to the Hugging Face `sander-wood/clamp3`
revision `355625cc1c6f73726bbcd0eb9276ac7152d56426`, with the SAAS file hash
`5033f868e3977be3945ee416b5a1718d5589a173c7ba8982231d8c94a6441d80` and size
`2,571,027,658` bytes. The official implementation converts MIDI to MTF,
MusicXML to interleaved ABC, extracts 24-kHz mono MERT features in five-second
windows, and projects symbolic/audio globals into a shared 768-dimensional
space scored by cosine similarity.

The required MERT-v1-95M and XLM-R-base dependencies add `377,552,987` and
`1,115,567,652` bytes respectively. The estimated weight footprint is therefore
`4,064,148,297` bytes (`3.785 GiB`) before Python/PyTorch, tokenizer, cache, and
temporary extraction overhead, exceeding the mission's `2 GiB` preferred bound.
No model weights or runtime environment were downloaded or initialized. The
four revealed ASAP fixtures consequently have no CLaMP3 retrieval, anchor-chain,
timing-map, or resource measurements; nulls mean `not-run`, not zero quality.

The preregistered protocol remains recorded for reproducibility: four- and
eight-beat symbolic windows, four-beat landmark spacing, five- and ten-second
audio search windows at 2.5-second stride, Top-5 retrieval, 0.25/0.5/1-second
tolerances, three confidence signals, monotone candidate-chain consensus,
median-absolute-deviation outlier rejection, and a monotone piecewise-linear
map with explicit unaligned gaps.

Decision: `SPARSE_LANDMARK_RETRIEVAL_INSUFFICIENT`, qualified as
`RESOURCE_BLOCKED_BEFORE_EVALUATION`; this is not a claim about CLaMP3 retrieval
quality. No production alignment code, candidate, downstream rerun, or
deployment was created. The next single engineering task is
`EXPLICIT_SCORE_REGION_ALIGNMENT_FALLBACK_CONTRACT`. This evidence checkpoint
was recorded at `3b5769aabdcd8664ebaa62a3ec644c249c777347`.

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
- `REAL_SYMBOLIC_ALIGNMENT_PARTIAL`: V2 removes the dense-cell rejection on all
  four revealed real recordings, but coarse-to-fine corridor refinement leaves
  the known regional p95 failures unchanged. The official hidden-tempo SKF
  reference is mixed and fails the preregistered headroom criterion, so no
  non-DTW production candidate was frozen. The V2 decision is
  `SCORE_ALIGNMENT_V2_ARCHITECTURE_INSUFFICIENT` and the non-DTW decision is
  `NON_DTW_SCORE_ALIGNMENT_ARCHITECTURE_INSUFFICIENT`. The CLaMP3 sparse-
  landmark reference was stopped before evaluation because its pinned model
  footprint exceeds the bounded download limit; its decision is
  `SPARSE_LANDMARK_RETRIEVAL_INSUFFICIENT` with a resource-blocked qualifier.
- The prior ASAP route remains `REAL_SHADOW_BLOCKED_AT_ALIGNMENT`: its symbolic
  candidate completed the downstream arrangement, six-level generation,
  artifact roundtrips, and five-level grouped public projection in memory, but
  production score-to-recording alignment remains partial. The current native
  performance rehearsal and its downstream validation result are documented
  below. Player links were not exercised because no catalog row was saved.

## Acceptance boundary

Automated structural evidence is the active gate. `MUSICAL_QUALITY_NOT_OBJECTIVELY_ESTABLISHED`.
Human listening is `NOT_REQUESTED` / `NOT_REQUIRED_BY_DEFAULT`; no listening
pack or rater gate was created. Deployment is `NOT_DEPLOYED`.

The region-aware real-shadow rehearsal is now recorded below. The next single
engineering task is `REAL_SYMBOLIC_TIMING_ALIGNMENT_HARDENING`; no further
retrieval-model, classical-DTW, or state-space score-following work is
authorized by this checkpoint.

### Explicit score-region ownership / fallback contract

This checkpoint adds `packages/catalog/src/region-ownership.ts` as the single
pure ownership decision surface. Claims name a source/target region, semantic
role, source class, timing authority, alignment state, confidence, and fallback
eligibility. Benchmark/reference and diagnostic classes are always withheld;
partial or rejected melody timing cannot become direct notes; semantic-only
harmony/bass support is explicitly marked partial; drum evidence can own only
`timing-only` regions. Primary generation candidates win deterministic overlaps,
fallback candidates may own only uncovered regions, and adjacent compatible
decisions merge without crossing owners or roles. Missing or invalid ownership
is a valid `WITHHELD` result rather than an inferred timing map.

`buildExternalSymbolicArrangement` applies the resolved contract before
semantic-band notes are passed to `buildMetalArrangement` (and bounds direct
piano source notes when claims are supplied). The resolution is retained in
additive diagnostics; existing intake, frozen-candidate, difficulty, MIDI, and
public-level contracts remain unchanged. The ASAP oracle report
`region-ownership-asap-oracle-2026-09-03.json` is policy-only and diagnostic;
it does not tune thresholds or authorize benchmark material for generation.

Ownership inventory: `generation-candidate-intake.ts` remains responsible for
format/provenance/firewall readiness; `external-symbolic-pipeline.ts` selects
frozen candidates and routes semantic-band/direct-piano evidence; the piano
section builder owns explicit window fusion; and `buildMetalArrangement` owns
downstream semantic arrangement. Region claims are now resolved once at the
catalog-to-arrangement boundary, so these existing owners do not each invent
fallback rules. The contract emits stable reason codes including
`NATIVE_TIMING_AUTHORITY`, `HIGH_CONFIDENCE_ALIGNMENT`,
`PARTIAL_ALIGNMENT`, `ALIGNMENT_REJECTED`, `NO_TARGET_TIMING`,
`FALLBACK_TIMING_AUTHORITY`, `FALLBACK_LOWER_PRIORITY`,
`BENCHMARK_FIREWALL`, `DIAGNOSTIC_FIREWALL`, `PROVENANCE_BLOCKED`,
`DRUM_TIMING_ONLY`, `ROLE_NOT_ELIGIBLE`, and `INVALID_REGION`.

Decision: `REGION_OWNERSHIP_FALLBACK_CONTRACT_VALIDATED`. The real alignment
decision remains `REAL_SYMBOLIC_ALIGNMENT_PARTIAL`; this contract checkpoint's
prior ASAP shadow remains `REAL_SHADOW_BLOCKED_AT_ALIGNMENT`.
`MUSICAL_QUALITY_NOT_OBJECTIVELY_ESTABLISHED`;
human listening remains `NOT_REQUIRED_BY_DEFAULT`; deployment remains
`NOT_DEPLOYED`.

Detailed machine evidence is recorded in the
`asap-score-alignment-2026-09-03.json`,
`asap-revealed-v2-validation-2026-09-03.json`, and
`asap-matchmaker-skf-reference-2026-09-03.json`, and
`clamp3-sparse-landmark-reference-2026-09-03.json` evidence files and the
matching `experiment-ledger.json` entry. The local runners are
`packages/catalog/scripts/evaluate-asap-score-alignment.py` and
`packages/catalog/scripts/evaluate-asap-synctoolbox.py`, plus the local-only
`packages/catalog/scripts/evaluate-matchmaker-skf.py` adapter.

### Region-aware real shadow rehearsal — 2026-09-04

The region-ownership contract was exercised with one real user-supplied pair,
without copying its media into Git. The path-free report is
`region-aware-real-shadow-rehearsal-2026-09-04.json`; the runner is
`packages/catalog/scripts/evaluate-region-shadow-rehearsal.ts`.

Lane A is a native performance-symbolic source (`USER_SUPPLIED_PRIVATE`) with
7,266 parsed events, 360 beats, and symbolic timing marked
`NATIVE_AUTHORITATIVE`. The paired audio is independently present
(4,351,097 bytes, 181.219 seconds). A global-tempo onset probe matched 634 of
649 detected audio onsets (precision 0.976888, recall 0.332459, F1 0.496087;
median/p90/p95 error 0.021042/0.053575/0.058046 seconds), but no independent
audio-to-beat anchors were supplied, so production alignment remains null and
the result is `REAL_SYMBOLIC_ALIGNMENT_PARTIAL` rather than a synchronization
claim. Region ownership still marked all 7,266 source events owned.

The native source reached arrangement, all six physical difficulty builders,
MIDI/MusicXML artifact validation, and five-level in-memory public projection.
The route is blocked at the existing playability validator for this dense
source: Advanced, Easy, and Medium report a 0.063-second median inter-onset
against the 0.08-second floor. No artifact serialization errors occurred, and
the controlled half-song withholding test retained zero events beyond the
withheld boundary through canonical output and all variants.

Lane B (732-event ASAP score plus its real audio) and Lane C (732-event score
plus 739-event performance MIDI) remain benchmark/evaluation-only. Their
provenance is recorded as `OPEN_LICENSE`, but the candidate class is
`BENCHMARK_REFERENCE`; the firewall withheld every event (732 and 1,471
respectively), emitted zero downstream events, and did not use these sources
for generation or tuning. Lane C source ordering was deterministic, while
native-vs-partial priority was intentionally not exercised outside the
benchmark firewall.

Decision: `GENERATION_CANDIDATE_INTAKE_READY`,
`REAL_SYMBOLIC_ALIGNMENT_PARTIAL`, and
`REGION_AWARE_REAL_SHADOW_BLOCKED` for this source because downstream
playability validation is not green. The capability envelope is therefore
partial for native performance-symbolic input, blocked for partial/rejected
score timing, and not yet supported for arbitrary audio-only rock/metal.
`MUSICAL_QUALITY_NOT_OBJECTIVELY_ESTABLISHED`; human listening remains
`NOT_REQUIRED_BY_DEFAULT`; deployment remains `NOT_DEPLOYED`.

The rehearsal report canonical hash is
`9c32be1c1aa3d5b540977a3025750435623e48d09d68139a57d4de290ea2e7a6` and was
identical across two runs. The next single engineering task is
`REAL_SYMBOLIC_TIMING_ALIGNMENT_HARDENING`; no timing-model or musical-policy
change was made in this rehearsal.

### Authoritative symbolic playability-gate audit — 2026-09-04

The first downstream blocker was audited against the frozen Lane A native
performance-symbolic source (7,266 notes, `USER_SUPPLIED_PRIVATE`, 120 BPM) at
implementation checkpoints `b96e05ce9f13ccb20eaac601af609e36be11d29a` and
`2f1a6cf1794d200ca2224d6953dcfd261891edbf`. The
report-only diagnostic is
`authoritative-symbolic-playability-gate-audit-2026-09-04.json`, with companion
method/report notes in
`authoritative-symbolic-playability-gate-audit-2026-09-04.md`.

The existing validator's semantics were left unchanged: distinct onset groups,
seconds-based median IOI, max simultaneous/sounding notes, and attacks/sec.
Lane A fell from 7,266 source notes to 3,843 canonical notes and passed the
density and simultaneity limits at every learner level. Advanced, Medium, and
Easy still report a 0.0625-second global median IOI against the 0.08-second
floor; their RH/LH medians are both 0.125 seconds. Very Easy, Beginner, and
Very Beginner pass. Trusted Clair de Lune, River Flows in You, Hello, and the
synthetic full-band control pass all measured levels. Seven synthetic causal
controls and a 60/90/120/150/180 BPM matrix separate global coordination,
same-hand rapid lines, localized bursts, and average-density effects.

Primary diagnosis: `AUTHORITATIVE_SOURCE_DENSITY_REQUIRES_TRANSFORM`. The audit
adds no musical-policy change and does not lower the 0.08-second threshold;
Lane-A-specific logic is `NONE`. Product decision:
`TIMED_SYMBOLIC_MVP_CONDITIONAL` for native authoritative timed symbolic input
whose generated variants pass the existing gate. Alignment remains
`REAL_SYMBOLIC_ALIGNMENT_PARTIAL`; the exact shadow decision is
`REAL_SHADOW_BLOCKED_AT_DIFFICULTIES` because validation is the first failed
downstream stage. Musical quality remains
`MUSICAL_QUALITY_NOT_OBJECTIVELY_ESTABLISHED`, human listening remains
`NOT_REQUIRED_BY_DEFAULT`, and deployment remains `NOT_DEPLOYED`.

The deterministic report canonical SHA is
`4094e7fc12a78e2c4f387080f9f233a3e8bcda426505c7ae4ff5f9d791086bd8`; report
bytes SHA is
`7807a641be94aad899ec1d60ff7678d2c8261587ed8bdbd4640a998fb6344324`.
The next single engineering task is
`LEVEL_CONTRACT_REVIEW_FOR_AUTHORITATIVE_DENSITY`; no alignment research,
benchmark tuning, listening, deployment, or production write occurred.

### Authoritative symbolic density normalization — 2026-09-04

The report-only checkpoint `a68fd1e0caa837ed4de868d4be31483c19b75c0c` evaluates
the unchanged six-level contract on the frozen Lane A native performance
symbolic source. Easy, Medium, and Advanced fail only the existing global
0.08-second median inter-onset floor; Very Easy, Beginner, and Very Beginner
pass. A protected semantic deletion pass clears the local validator but
removes 471/480/421 attacks and breaks the Very Easy → Easy ladder. The
bounded P2-only oracle reaches the median while leaving roughly half of all
gaps rapid, so it is diagnostic rather than a production policy.

Decision: `NO_GENERIC_DENSITY_TRANSFORM_JUSTIFIED`. No validator limits,
retiming, note creation, arrangement policy, alignment, or catalog behavior
changed. The deterministic report is
`authoritative-symbolic-density-normalization-2026-09-04.json`; its canonical
SHA is `f1432f35a7ce5433c1f8cb0ea4905939811e44376bcba2bf5fee436fbc55c330`.
The next task is `LEVEL_CONTRACT_REVIEW_FOR_AUTHORITATIVE_DENSITY`. Musical
quality remains `MUSICAL_QUALITY_NOT_OBJECTIVELY_ESTABLISHED`; human listening
is `NOT_REQUIRED_BY_DEFAULT`; deployment is `NOT_DEPLOYED`.

### Difficulty contract review — 2026-09-04

The report-only audit
`difficulty-contract-review-2026-09-04.json` compares the unchanged physical
six-level validator with a public five-level diagnostic. Existing code/history
confirm six physical artifacts remain required for storage and legacy access,
while normal public navigation is Very Beginner → Beginner → Easy → Medium →
Advanced with Easy as the representative. Very Easy is checked independently;
the public diagnostic has no Very Easy → Easy ordering edge.

Across the three production-owned fixtures (Clair de lune, River Flows in You,
and Hello), every public edge passes individual validation, note-count nesting,
RH ancestry, and difficulty-score ordering; Very Easy independently validates.
The synthetic full-band control remains diagnostic-only because its VB/Beginner
rows are below the existing eight-note minimum. Historical calibration records
VE/E redundancy for Classical and Pop and a Cover attack-count non-monotonicity.

The frozen Candidate A output remains unpromoted: its unchanged Easy/Medium/
Advanced outputs pass the public-edge diagnostic and independent VE validation,
but fail the six-level VE → Easy raw note-count edge (2,560 VE notes versus
2,130 Easy notes). No playability limits, musical policy, artifacts, or
catalog data changed.

Decision: `PUBLIC_FIVE_LEVEL_CONTRACT_VALIDATED` (report-only). The timed
symbolic consequence is `TIMED_SYMBOLIC_MVP_READY_FOR_NORMALIZATION_REEVALUATION`;
normalization still requires a separate task. Real alignment remains
`REAL_SYMBOLIC_ALIGNMENT_PARTIAL`, and the real shadow remains
`REAL_SHADOW_BLOCKED_AT_DIFFICULTIES`. Human listening is
`NOT_REQUIRED_BY_DEFAULT`; deployment is `NOT_DEPLOYED`.

The next single engineering task is
`IMPLEMENT_PUBLIC_FIVE_LEVEL_DIFFICULTY_CONTRACT`; no implementation is made
in this checkpoint.

### Public five-level difficulty contract implementation — 2026-09-04

Revision `971974231016bded91769fc938850fce38ea7827` implements the validated
public/physical split in production validation only. Six physical rows remain
generated, serialized, individually validated, and legacy-accessible. The
normative cross-level edges are now Very Beginner → Beginner → Easy → Medium →
Advanced; Very Easy has no public ordering edge. The generation ladder and all
playability/density limits are unchanged.

The existing `LADDER_TOL` values remain authoritative (`.26`, `.02`, `.02`,
`.02` on the public edges). The audit's `.08` onset matching tolerance remains
diagnostic-only. Trusted Classical, Cover, and Pop fixtures pass the production
validator, and their six-level note sets are byte-identical to the starting
checkpoint. Lane A remains blocked by the existing Easy/Medium/Advanced
individual median-IOI floor; Candidate A remains diagnostic-only and
unpromoted.

Decision: `PUBLIC_FIVE_LEVEL_CONTRACT_IMPLEMENTED`. Timed symbolic status is
`TIMED_SYMBOLIC_MVP_READY_FOR_NORMALIZATION_REEVALUATION`; real alignment is
`REAL_SYMBOLIC_ALIGNMENT_PARTIAL`; the real shadow remains
`REAL_SHADOW_BLOCKED_AT_DIFFICULTIES`. Musical quality is
`MUSICAL_QUALITY_NOT_OBJECTIVELY_ESTABLISHED`, human listening is
`NOT_REQUIRED_BY_DEFAULT`, and deployment is `NOT_DEPLOYED`.

The deterministic implementation report is
`difficulty-contract-implementation-2026-09-04.json` (canonical SHA
`b4285e94b984bbd1445f818313533293dabadeee3bacd70c56967bbed2f69f03`; bytes
SHA `4a80c3279efe31382c0d1581fa62ee216b7c1406d1f995a1cf88c2fb862af18b`).
The next task is
`BOUNDED_MVP_PRODUCTIZATION_READINESS`.

### Frozen density normalization under the public contract — 2026-09-04

The exact frozen Candidate A from `a68fd1e0caa837ed4de868d4be31483c19b75c0c`
was re-evaluated against the production five-level order
`Very Beginner → Beginner → Easy → Medium → Advanced`. The production
checkpoint is `eb23129`; the shared implementation is the single
`selectProtectedSemanticLocalThinning` selector in
`packages/midi/src/density-normalization-audit.ts`, called once after the
learner ladder in `packages/midi/src/simplify.ts` for Easy, Medium, and
Advanced. No validator limit, difficulty score, public edge, retiming rule, or
Candidate-A tie-break changed.

On the private Lane A native MIDI (7,266 notes; source SHA-256
`ec5010896c00a0541b34b0843a20f455707ac647ae4a222aee71e2ad43e8017e`), the
frozen output is exact: Easy 2,130 notes / 1,195 attacks, Medium 2,269 / 1,235,
Advanced 2,846 / 1,490. The pass removes 471 / 480 / 421 support attacks and
713 / 797 / 714 notes respectively, raises global median IOI to 0.125 seconds,
and reduces rapid fractions to 0.161642 / 0.182334 / 0.394896. Individual
validation, public note-count ordering, public RH ancestry, and difficulty
score ordering all pass with the production tolerances. Very Easy, Beginner,
and Very Beginner are exact no-ops. The old physical Very Easy → Easy count
edge remains non-normative by contract.

Trusted Classical, Cover, and Pop fixtures are exact six-level no-ops. All six
Lane A MIDI and MusicXML artifacts round-trip with zero errors; repeated lane
and artifact runs are byte-identical; withheld-event resurrection is zero.
The canonical report is
`frozen-density-normalization-public-contract-2026-09-04.json` with SHA-256
`f1c83004bf51d53054fbbe8a140423dfe1a6c0b634e24e282e886b350cf35060` and
canonical digest
`9a95a6e67827de2ee2c6472161451dd45f9aca3fd3f696fe2ab9de6a642bea0f`.

Decision: `FROZEN_DENSITY_NORMALIZATION_VALIDATED`. Timed-symbolic status is
`TIMED_SYMBOLIC_MVP_READY`; native authoritative symbolic shadow status is
`NATIVE_TIMED_SYMBOLIC_REAL_SHADOW_VALIDATED`. Independent audio↔symbolic
alignment remains `REAL_SYMBOLIC_ALIGNMENT_PARTIAL`, musical quality remains
`MUSICAL_QUALITY_NOT_OBJECTIVELY_ESTABLISHED`, human listening is
`NOT_REQUESTED_NOT_REQUIRED_BY_DEFAULT`, and deployment remains
`NOT_DEPLOYED`. Player entry links remain not exercised because this run made
no catalog writes.

### Bounded MVP productization readiness — 2026-09-04

The productization checkpoint keeps the existing catalog ingest and artifact
publisher as the single native-symbolic generation owner. The `/uploads` route
now accepts same-origin browser bytes without exposing the maintainer bearer
token, retains bearer auth for machine callers, rejects cross-origin metadata,
enforces a bounded 10 MB body (including streaming/chunked bodies), and uses a
stable `upload-<sha256>` base id for retries. Native upload manifests and each
level's `notes.json` provenance carry `GENERATION_CANDIDATE`,
`USER_SUPPLIED_PRIVATE`, `NATIVE_AUTHORITATIVE`, and
`READY_FOR_GENERATION`; the source hash and upload bytes remain local/private.

The scratch product path was exercised end to end with valid MIDI, MusicXML,
and MXL inputs: parsing, six physical artifacts, five public levels, Easy
player link, legacy Very Easy route, MIDI/MusicXML exports, catalog rows, and
malformed-input rejection all passed. A separate bounded browser run covered
upload, player-level projection, exports, and malformed content against an
empty temporary catalog. The existing catalog intake library remains the
approved direct-remote symbolic seam; no remote URL textbox or network fetch
was added to the private UI, and benchmark/reference classes remain fenced
from generation.

The backup script also passed an explicit scratch restore drill: the SQLite
online backup and artifact/source archive restored six catalog rows. Docker
Engine is available locally, but the Compose v2 plugin is not installed, so a
Compose-stack restart/worker-independence check was not run. Artifact swaps
remain atomic with the existing post-swap DB reconciliation boundary.

Decision: `BOUNDED_MVP_PRODUCTIZATION_READY` for native authoritative symbolic
uploads within the private single-user app. This does not upgrade independent
audio↔symbolic alignment, which remains `REAL_SYMBOLIC_ALIGNMENT_PARTIAL`, and
does not establish musical recognizability:
`MUSICAL_QUALITY_NOT_OBJECTIVELY_ESTABLISHED`. Human listening is
`NOT_REQUESTED_NOT_REQUIRED_BY_DEFAULT`; deployment is `NOT_DEPLOYED`.
Player links are `LOCAL_EXERCISED`. The next single engineering task is
`REAL_SYMBOLIC_TIMING_ALIGNMENT_HARDENING`; no benchmark tuning, deployment,
production write, or audio/listening task was performed.

### Bounded MVP release candidate — 2026-09-04

This release-candidate audit starts from `89e2b6767b0cebe7e4248dba4513ec6992519a65`.
The code/image checkpoint is `ff3f39e2be4926e1f4aeffb8bbe7f401838a3b69`;
the immutable local web image is `keyspilli:web-rc-ff3f39e` with digest
`sha256:d8c416090e4ddf7f4843917bea833af4e07b2cf09aec197cfbecd235c4ce03e`
and size 458002486 bytes. A clean Node 22.22.3/npm 10.9.8 install, production
build, workspace tests/typechecks, and the two bounded Playwright tests passed.

The Docker evidence is intentionally split: the production web image build and
worker-off web-container smoke both passed, while local Docker Compose smoke was
not run because this host has no `docker compose` plugin. The earlier
productization ledger statement that Compose was not run remains factual; it is
not a Compose pass. The final container used an empty scratch data directory,
`HOSTNAME=0.0.0.0`, and reported the exact checkpoint through `/api/health`.
MIDI, MusicXML, and MXL uploads each persisted six physical rows and five public
levels; Easy/legacy Very Easy/player routes and MIDI/MusicXML/PDF exports passed.
Malformed/HTML-masquerading symbolic bodies, malformed MXL, and an 11 MB body
failed closed without new rows. Same-origin browser metadata, cross-origin
rejection, wrong bearer rejection, stable SHA retry behavior, restart durability,
and the scratch backup/restore drill passed. The worker, Demucs, Basic Pitch,
and yt-dlp were not needed for this bounded path.

Static deployment review and a read-only live check classify the configured
posture as public internet with no application-account system and no Caddy
edge/network restriction. Same-origin upload checks are CSRF protection, not a
private access boundary: an arbitrary visitor can reach `/uploads` and submit a
valid symbolic file. The live domain was healthy on a newer production revision,
so it was not treated as evidence for this candidate. This is the first release
blocker: `PUBLIC_WRITE_SURFACE_WITHOUT_PRIVATE_ACCESS_BOUNDARY` /
`PRIVATE_ACCESS_BOUNDARY_REQUIRED`. The Ansible playbook does retain immutable
previous image tags and the data volume during rollback, but no deployment or
rollback was executed.

Release scope is frozen to private single-user MIDI/MusicXML/MXL upload with
`NATIVE_AUTHORITATIVE` symbolic timing, six physical levels, and five public
levels. YouTube/audio conversion remains a separate experimental capability;
independent score↔audio alignment remains `REAL_SYMBOLIC_ALIGNMENT_PARTIAL`, and
musical quality remains `MUSICAL_QUALITY_NOT_OBJECTIVELY_ESTABLISHED`.

Decision: `BOUNDED_MVP_RELEASE_CANDIDATE_PARTIAL`, first blocker
`PRIVATE_ACCESS_BOUNDARY_REQUIRED`. Deployment decision:
`DEPLOYMENT_NOT_READY_PRIVATE_ACCESS_BOUNDARY`. Human listening is
`NOT_REQUESTED_NOT_REQUIRED_BY_DEFAULT`; deployment is `NOT_DEPLOYED`. The next
single task is `ESTABLISH_PRIVATE_DEPLOYMENT_ACCESS_BOUNDARY`.

### Private deployment access boundary — 2026-09-04

The boundary implementation is checkpoint `155d8964ba31a8de729629b5fa3bd8bcd896d8f2`.
Production Ansible now renders a Caddy 2.6.2 `basicauth` block for the complete
application domain, generates a bcrypt hash from operator-provided environment
secrets, strips the edge `Authorization` header before the web container, and
keeps the existing bearer token available through the explicit
`X-Keyspilli-Api-Token` transport header for machine callers. Missing or unsafe
edge credentials fail before any deployment mutation. No plaintext password or
hash is committed or logged.

The immutable local image `keyspilli:web-rc-155d896` built successfully with
digest `sha256:5baadcbe87c103f78f4cb16332376c1033e23378309b56b5424ab6d5007da5db`.
A fresh-data, worker-off disposable Caddy canary passed anonymous HTTP 401,
wrong-password rejection, authenticated exact-version health, same-origin
MIDI/MusicXML/MXL upload, six physical rows/five public levels, Easy and legacy
Very Easy player routes, MIDI/MusicXML/PDF exports, restart durability, stable
SHA retry behavior, cross-origin rejection, and atomic malformed/oversized/
playability failures. The app bearer contract and browser token non-exposure
were preserved. The canary used no benchmark material and retained no source
bytes. The full path-free manifest is
`private-deployment-access-boundary-2026-09-04.json`.

Evidence is intentionally split: Docker web-image/container smoke passed;
Docker Compose smoke was not executed because the local Compose v2 plugin is
unavailable (`COMPOSE_LOCAL_SMOKE_NOT_EXECUTED`). The prior ledger's
Compose-not-run statement is therefore reconciled, not rewritten as a pass.
The production VPS/domain was not changed; its current read-only posture remains
public internet with no deployed edge restriction until an owner-authorized
deployment applies this checkpoint.

Decision: `PRIVATE_DEPLOYMENT_ACCESS_BOUNDARY_VALIDATED_LOCALLY` and
`BOUNDED_MVP_RELEASE_CANDIDATE_READY`. Deployment decision:
`DEPLOYMENT_READY_NOT_DEPLOYED` (the live domain remains unchanged). The bounded
capability is private MIDI/MusicXML/MXL upload with native symbolic timing,
validated six physical variants, five public levels, persistence, player entry,
and exports. Independent audio↔symbolic alignment remains
`REAL_SYMBOLIC_ALIGNMENT_PARTIAL`; musical quality remains
`MUSICAL_QUALITY_NOT_OBJECTIVELY_ESTABLISHED`. Human listening is
`NOT_REQUESTED_NOT_REQUIRED_BY_DEFAULT`. The next single task is
`BOUNDED_MVP_DEPLOYMENT_CANARY`, which requires explicit owner deployment
authorization and was not executed.

### Bounded MVP deployment canary — 2026-09-04

The owner-authorized canary deployed web release
`03d19473aea27b8a7dbe494826a27f0b4870d900` with immutable image
`ghcr.io/reedtrullz/keyspilli:03d19473aea2` (manifest digest
`sha256:9de9d7904b9ecea2502576e310140b72327b5eef43344561885ce9e7d87ca6a9`).
The deployment configuration/verifier checkpoint is `3b5bac5`; it also forces
SSH public-key authentication and uses a binary-safe PDF signature check. The
first deployment attempt rolled back cleanly when Ansible's URI verifier tried
to decode a PDF as UTF-8. The corrected retry completed successfully
(`ok=32 changed=7 failed=0`), with the existing worker image
`ghcr.io/reedtrullz/keyspilli-worker:17f997600b9f` intentionally unchanged.

The live domain remains internet-routable, but Caddy Basic Auth now protects
the complete HTTPS edge. Anonymous `/api/health` returns HTTP 401; authenticated
health is healthy and reports the exact release revision. The application stays
single-user with its existing bearer/custom-header machine contract; the edge
credential is stored in the operator's macOS Keychain and no plaintext or hash
is retained in the repository.

The earlier disposable RC canary proved the bounded symbolic path with the ML
worker off; the live deployment kept the existing worker image unchanged and
running. A deterministic MIDI upload exercised six physical rows, five public
levels, Easy and legacy Very Easy player routes,
MIDI/MusicXML/PDF exports, retry idempotency, container-restart durability, and
cleanup. A deliberately over-dense fixture was rejected with HTTP 422 before
publication, confirming the playability failure path. The final catalog count
returned to 2760 and no canary source bytes remain. The backup timer is enabled
and active; a manual backup completed and its SQLite/artifact archives validated.

Docker evidence is split accurately: local Docker Engine is available, but the
local Compose plugin was unavailable (`COMPOSE_LOCAL_SMOKE_NOT_EXECUTED`). The
remote deployment host has Docker Compose 5.1.3 and its Compose topology passed.
The VPS retained at least 34 GiB free after deployment. No musical policy,
generated musical bytes, benchmark/reference material, or alignment behavior
changed in this operations canary.

Decision: `BOUNDED_MVP_RELEASE_CANDIDATE_READY` and
`DEPLOYED_CANARY_VERIFIED`. This is an owner-authorized canary, not a claim of
unrestricted production readiness beyond the now-applied private edge. Native
symbolic intake remains the bounded capability; independent audio↔symbolic
alignment remains `REAL_SYMBOLIC_ALIGNMENT_PARTIAL`, and musical quality remains
`MUSICAL_QUALITY_NOT_OBJECTIVELY_ESTABLISHED`. Human listening is
`NOT_REQUESTED_NOT_REQUIRED_BY_DEFAULT`. Deployment is recorded as completed
for this authorized canary; no further deployment action was performed.
