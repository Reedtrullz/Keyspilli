# Keyspilli product pipeline status — 2026-09-03

## Current posture

Candidate A (`BEGINNER_SPARSE_OFFGRID_RH_BUDGET_VALIDATED`) remains the only
promoted learner-policy change. The semantic-harmony/source-lineage work and
the candidate-intake work below are additive; no benchmark material entered
generation and no production data was written.

Mission start revision: `d284b911b2a1ce3e22ce701f0ca02588f1f2b238`.

## Stage status

| Stage | Status | Evidence boundary |
|---|---|---|
| Source intake | VALIDATED (local + approved direct URL seam) | Native MIDI/MusicXML/MXL parsing, bounded bytes, magic/content checks, HTML/error rejection, path-safe provenance, and candidate firewall tests pass. MSCZ is recognized but explicitly unsupported. |
| Parse/provenance | VALIDATED | Native adapter records SHA-256/size/parser metadata; unknown provenance is not generation-eligible. |
| Role inference | VALIDATED (shadow override) | The single-stem Guitar-TECHS MIDI is explicitly mapped to guitar for the shadow arrangement; no drum pitches reached output. |
| Alignment | BLOCKED (real shadow measured, independent timing authority missing) | Independent audio onset detection ran on the real DI recording. The duration-derived diagnostic map produced F1 `0.610328`, p95 error `0.116502` beats / `0.063550` seconds, coverage `0.691489` symbolic and `0.546218` measured audio, but did not materially improve the naïve global-tempo baseline. No independently supplied beat anchors or tempo map were available, so this is not a production alignment validation. |
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

## Decisions

- `GENERATION_CANDIDATE_INTAKE_READY` for bounded local symbolic input and the
  opt-in approved-direct-URL seam. A parsed candidate without known provenance
  or aligned evidence remains explicitly ineligible for generation.
- `REAL_SYMBOLIC_ALIGNMENT_BLOCKED`: the real recording was measured, but the
  only available beat map was derived from duration. It is diagnostic evidence,
  not independent timing authority.
- `REAL_SHADOW_BLOCKED_AT_ALIGNMENT`: downstream arrangement, six-level
  generation, artifact roundtrips, and five-level grouped public projection
  all completed in memory, but the first product-path blocker remains real
  alignment. Player links were not exercised because no catalog row was saved.

## Acceptance boundary

Automated structural evidence is the active gate. `MUSICAL_QUALITY_NOT_OBJECTIVELY_ESTABLISHED`.
Human listening is `NOT_REQUESTED` / `NOT_REQUIRED_BY_DEFAULT`; no listening
pack or rater gate was created. Deployment is `NOT_DEPLOYED`.

The next single engineering task is
`REAL_SYMBOLIC_TIMING_ALIGNMENT_HARDENING`; it is recorded as a decision only
and is not implemented in this checkpoint.

Detailed machine evidence is recorded in the
`generation-candidate-intake-and-real-alignment-v1-2026-09-03`
`experiment-ledger.json` entry. The local runner is
`packages/catalog/scripts/evaluate-real-shadow-pair.ts`.
