# Keyspilli product pipeline status — 2026-09-03

## Current posture

Candidate A (`BEGINNER_SPARSE_OFFGRID_RH_BUDGET_VALIDATED`) is the only
promoted learner-policy change. Its production Cover output and the corrected
one-pass diagnostic selector emit the same 110 normalized RH events
(`110/110`, recovery ratio `0.5851063829787234`); Beginner LH, Classical,
Pop, and all other physical levels are unchanged. Candidate B and the
remaining Beginner/Very Easy tuning branches are closed.

The redundant `calibrate:ladder` entrypoint was deleted. `review:ladder` is the
single reusable ladder evaluator; historical reports and ledgers remain.

Committed code checkpoint: `72eed97f0012b67e9b38098c325529068c4cfade`.

## Proven product path

```text
input → evidence → parse → roles → alignment → arrangement → difficulties
      → validation → MIDI/MusicXML artifacts → catalog grouping → public API/UI
```

| Stage | Status | Evidence boundary |
|---|---|---|
| Source intake | PARTIAL | Four project-owned synthetic symbolic fixtures work; the seven-song cold inventory has 0 independently aligned generation candidates. |
| Parse/provenance | VALIDATED | Native MIDI and MusicXML adapters reject malformed/unsupported input and preserve source hashes. |
| Role inference | VALIDATED | Full-band synthetic rehearsal passed after exact MIDI-track percussion matching fix. |
| Alignment | PARTIAL | Synthetic self-alignment passes; independent target-recording alignment is still required for real generation. |
| Arrangement/semantic routing | VALIDATED | Direct piano and semantic-band synthetic routes pass; drums remain timing-only. |
| Six physical difficulties | VALIDATED | All four rehearsal fixtures produced six validated levels. |
| Public five-level projection | VALIDATED | `very-easy` is hidden and Easy is the stable representative. |
| Artifact writing | VALIDATED | MIDI and MusicXML roundtrips passed for all rehearsal levels. |
| Catalog/API projection | VALIDATED (in-memory) | Grouping and public projection passed without touching production data. |
| Player entry links | NOT_EXERCISED | No publish/deploy was authorized in this sequence. |

## External-symbolic shadow rehearsal

Four project-owned deterministic fixtures (direct piano, melody plus
accompaniment, full band, and guitar-structured) completed source intake,
parse, provenance, role inference, explicit self-alignment, arrangement, six
levels, artifact roundtrip, catalog grouping, and five-level projection.
Repeated runs produced the same report hash
`9298fc70c89ba850d25d9fa1ef82ed414fc0064312db9de34e4594e3f0905149` and the
same per-artifact MIDI/XML hashes. The first rehearsal exposed a genuine role
bug: a `Drums` track name was matched by `track-1` substring and relabeled all
parts as percussion. The fix is covered by a regression test and the rerun is
green.

This proves the plumbing on synthetic inputs only. Self-alignment is not a
timing-authority claim for a real song, and no benchmark/reference material
entered generation. The durable report is explicitly marked
`VALIDATED_SYNTHETIC_ONLY` for source intake.

## Remaining blockers, ranked

1. **Generation candidate availability / source intake (high impact).** The
   real-song inventory has no independently aligned symbolic candidate. The
   next task is to harden legitimate user-supplied, open-dataset, and approved
   remote symbolic intake with parser, MIME/magic, size, provenance, license,
   and alignment checks. Do not bypass access controls or use benchmark bytes.
2. **Real-song musical quality (evidence-limited).** Audio-AMT arrangements
   remain diagnostically weak; no generic threshold change is justified by the
   current source evidence. This is not a pipeline-publication failure.
3. **Player/public publication exercise (not authorized).** The pure catalog/API
   projection works, but this sequence did not write production rows or deploy.

## Closed / retained

Retained: shared Candidate-A selector/evaluator, source-aware metal routing,
semantic harmony diagnostics, generic ladder evaluator, external evidence
firewall, symbolic adapters, and historical reports/ledgers. Deleted:
experiment-specific `calibrate:ladder` wrapper. Candidate B, Cover cliff
tuning, Very Easy public-ladder changes, and direct-AMT model shopping remain
closed.

## Acceptance boundary

Automated structural evidence is the active gate. Human listening is
`NOT_REQUIRED_BY_DEFAULT` and was not requested; no recognizability claim is
made from these results. Deployment is `NOT_DEPLOYED`. The next single
engineering task is
`GENERATION_CANDIDATE_AVAILABILITY_AND_SOURCE_INTAKE_HARDENING`; it is
recorded here but intentionally not implemented in this checkpoint.

Detailed rehearsal evidence: `external-symbolic-shadow-rehearsal-2026-09-03.json`.
