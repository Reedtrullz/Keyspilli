# SDD ledger — plan: docs/superpowers/plans/2026-08-30-section-aware-piano-candidates.md

Spec source: `/Users/reidar/.codex/attachments/b6ac03dc-309f-4115-99ca-23d858b62a2a/pasted-text-1.txt` (read in full before implementation). The supplied brief is treated as the user's approval/specification for this autonomous continuation; no production or external side effects are authorized.

## Pre-flight task/interface scan

| Scope | Shared files/interface | Check | Ruling |
|---|---|---|---|
| Task 1 ↔ Task 5 | `packages/catalog` diagnostics consumed by the local builder | Task 1 is diagnostic-only; Task 5 may consume its metric shapes but must not make production selection depend on the CLI. | Keep Task 1 pure/local and make Task 5 consume only stable pure helpers or duplicate no formulas. |
| Task 2 ↔ Task 3 | `Note[]`, stable role keys, protected melody mask | Task 3 must accept protected keys/notes without rewriting them. | Define role output around immutable source indices and pass protection as an explicit option. |
| Task 2 ↔ Task 4 | melody role notes and protected keys | Task 4 selects only melody candidates and must preserve protected notes at boundaries. | Selector consumes `PianoRoleSplit.melody`/mask and never edits source note values. |
| Task 2 ↔ Task 5 | `packages/midi/src/index.ts` exports and role APIs | Both tasks add exports to the same index. | Integrate export lines after each task; no wildcard collisions. |
| Task 3 ↔ Task 5 | accompaniment config/harmony/diagnostics | Task 5 must use semantic accompaniment only for C/shared harmony and retain a fallback when confidence is low. | Keep all harmony functions pure and expose fallback diagnostics; do not alter `ChordLabel`/public `Variant` contracts. |
| Task 4 ↔ Task 5 | `CandidateRegion` and region selection result | Task 5 supplies explicit aligned windows and two role-separated candidates. | Region selector remains candidate-name agnostic; builder records reasons/regions in local diagnostics. |
| Task 5 ↔ Task 6 | local builder output and listening bundle CLI | Task 6 renders explicit MIDI outputs and must not alter production import. | Add an opt-in local input/output path; preserve existing bundle behavior and renderer config. |
| Task 1 | own tests/CLI/report | Tests exercise real metric behavior, not mocks or subjective scores. | Proceed; reports remain diagnostic and path-redacted. |
| Task 2 | own module/tests | Tests prove melody protection and deterministic reorder behavior. | Proceed. |
| Task 3 | own module/tests | Tests cover low/high voicing and root stability without inventing notes. | Proceed. |
| Task 4 | own module/tests | Tests cover hysteresis and boundary clipping. | Proceed. |
| Task 5 | own integration tests | Tests must verify C melody preservation and independent D melody/accompaniment roles. | Proceed. |
| Task 6 | own bundle tests | Tests must verify required files, canonical path safety, blind aliases, and pending human scores. | Proceed. |

## Rulings

- Ruling: treat the externally supplied continuation brief as pre-approved design authority — the user explicitly requested continuation from the named commit and implementation of the described slice; pausing for a redundant approval would not advance the active goal.
- Ruling: keep candidate-specific human labels in local evaluation metadata only — generic region scoring must consume features, because the brief forbids song/candidate hard-coding in production logic.
- Ruling: build the new candidate outputs through pure MIDI helpers and existing `writeMidi`/FluidSynth orchestration — preserving public MIDI/API compatibility is more important than modifying the existing importer path in this slice.

## Verification

- Pure MIDI role, accompaniment, and region modules are exported and covered by deterministic synthetic tests.
- The local C/D section builder rejects malformed/overlapping windows, clips aligned notes crossing beat zero, preserves protected melody notes, and rejects direct-metal sources.
- The diagnostics CLI fails closed on malformed/overlapping windows and redacts local paths.
- The arrangement evaluator fails closed on malformed variant metadata instead of throwing; malformed measures/time signatures/tempo/difficulty are reported as gate failures.
- The listening bundle records renderer/SoundFont/normalization provenance and per-window excerpt hashes without local paths, validates path-safe window IDs, hides blind mappings from the guide, and leaves human evaluation pending.
- Full workspace verification: 789 tests passed and all workspace typechecks passed; `git diff --check` passed.
- Two fresh rendered C/D bundles were byte-identical across the canonical manifest, seven MIDI outputs, seven full WAV outputs, and 21 per-window excerpt WAVs. The verified canonical manifest SHA is `4a63a62fac7e195f995439d8311fe43c24fb0e9b75069e66c6311a7c7e2a7ff8`.
- Deferred by scope: production importer changes, metal revision A/B orchestration, reference-MIDI upload, catalog mutation, deployment, and subjective listening acceptance.
