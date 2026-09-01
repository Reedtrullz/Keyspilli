# External Symbolic-First Evidence Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the approved `EXTERNAL_SYMBOLIC_FIRST` conclusion into a leak-safe, provenance-aware, locally reproducible evidence pipeline that can select and evaluate external symbolic/piano evidence without changing production behavior or importing protected benchmark MIDI.

**Architecture:** Reuse the existing `song-research`, `native-score-adapter`, `symbolic-alignment`, `piano-region-selector`, `arrangement-evaluation`, and local renderer APIs. Add a small provider-neutral evidence model and firewall, a frozen generation-side candidate set, a local seven-song inventory/evaluation orchestrator, and a bounded Red Baron stage-survival evaluator. Keep benchmark references and acquired media outside the repository.

**Tech Stack:** TypeScript, `@keyspilli/midi`, existing catalog pure APIs, Node `crypto`/`fs`, Vitest, tsx, deterministic JSON, local-only CLI.

**Spec:** approved external-symbolic-first specification supplied with this task

## Global Constraints

- `BENCHMARK_REFERENCE` assets are evaluation-only and must be rejected by generation-side ingestion.
- No benchmark MIDI, protected external MIDI/audio, model weights, secrets, or personal absolute paths may enter the repository or public/API payloads.
- Source research may record metadata-only leads, but musical bytes affect generation only after permitted local acquisition and strict parsing.
- The target recording remains the timing authority; external candidates align to explicit role/section windows.
- Drums are timing-only and never become pitched piano notes.
- Existing `Note`, IR, manifest, and API payload contracts remain compatible; new diagnostics are additive.
- Automated metrics never claim human recognizability; the human gate remains separate and requires at least two raters.
- All implementation and verification are local. Do not push, merge, deploy, replay production, or upload references.

---

### Task 1: Freeze the architecture boundary and evidence model

**Files:**
- Create: `docs/architecture/external-symbolic-first.md`
- Create: `packages/catalog/src/external-evidence.ts`
- Modify: `packages/catalog/src/index.ts`
- Test: `packages/catalog/test/external-evidence.test.ts`

**Interfaces:**
- `EvidenceClass`, `EvidencePurpose`, `CandidateStatus`, `EvidenceRole`.
- `ExternalEvidenceCandidate` with logical provenance, content hash/metadata, confidence fields, role evidence, and status/rejection reasons.
- `assertGenerationEvidence(candidate)` rejects `purpose: "BENCHMARK_REFERENCE"`, disallowed acquisition, missing hash, or failed parse status.
- `canonicalEvidenceCandidateSet(candidates)` and `evidenceCandidateSetDigest(candidates)` sort and hash metadata without note arrays or physical paths.

- [ ] **Step 1: Write failing tests** for class/status validation, benchmark-purpose rejection, independent candidate acceptance, path redaction, and candidate-set digest order invariance.
- [ ] **Step 2: Run the focused test** and confirm the new API is absent/fails.
- [ ] **Step 3: Implement the pure model/firewall** with finite-field normalization, logical source references, SHA-256 identity, and deterministic canonical JSON.
- [ ] **Step 4: Run focused tests and catalog typecheck.**
- [ ] **Step 5: Commit** `feat(catalog): add external evidence firewall`.

### Task 2: Connect permitted symbolic ingestion, roles, and research records

**Files:**
- Modify: `packages/catalog/src/research-report.ts`
- Modify: `packages/catalog/src/song-research.ts`
- Modify: `packages/catalog/src/native-score-adapter.ts`
- Create: `packages/catalog/src/external-research.ts`
- Test: `packages/catalog/test/external-research.test.ts`

**Interfaces:**
- `ExternalResearchRecord` and `ExternalResearchInventory` retain provider-neutral discovery, acquisition policy, parser metadata, role diagnostics, identity/alignment status, and rejection reasons.
- `researchExternalCandidates(song, options)` accepts injected discovery results and local bytes; it performs no implicit network call in tests.
- `ingestExternalSymbolicCandidate(input)` delegates MIDI/MusicXML/MXL parsing to existing adapters and returns a firewall-checked candidate plus normalized score.
- `classifyExternalRoles(score)` maps track metadata/register/monophony/density/percussion to uncertain role records.

- [ ] **Step 1: Add failing synthetic tests** for MIDI/MusicXML/MXL normalization, malformed rejection, percussion exclusion, provider-neutral records, metadata-only leads, role confidence, and path-safe serialization.
- [ ] **Step 2: Run focused tests to confirm failure.**
- [ ] **Step 3: Implement the adapter around existing parsers**; do not add a bespoke Guitar Pro parser or download behavior.
- [ ] **Step 4: Run focused tests/typecheck and verify existing research tests remain green.**
- [ ] **Step 5: Commit** `feat(catalog): model external symbolic research evidence`.

### Task 3: Freeze generation-side candidates and expose route coverage

**Files:**
- Create: `packages/catalog/src/external-symbolic-pipeline.ts`
- Modify: `packages/catalog/src/route-funnel.ts`
- Modify: `packages/catalog/src/arrangement-evaluation.ts`
- Test: `packages/catalog/test/external-symbolic-pipeline.test.ts`

**Interfaces:**
- `freezeGenerationCandidateSet(records, config)` filters benchmark-purpose records, validates status/identity/alignment, sorts by role/section, and returns a digest plus immutable selected records.
- `buildExternalSymbolicArrangement(input)` consumes only the frozen set and delegates role/section realization to existing MIDI arrangement/builders; absent evidence uses the existing audio fallback lane.
- `evaluateRouteCoverage(result)` reports duration/note percentages by evidence class and confidence, with `null` for unavailable attribution.

- [ ] **Step 1: Add failing tests** proving benchmark candidates cannot influence selection, candidate order does not change the digest, role/section selection is possible, fallback remains available, and route coverage is additive/path-safe.
- [ ] **Step 2: Run focused tests and confirm failure.**
- [ ] **Step 3: Implement the frozen-set boundary**; never pass benchmark notes into alignment or arrangement functions.
- [ ] **Step 4: Run focused tests, typecheck, and existing route/evaluation tests.**
- [ ] **Step 5: Commit** `feat(catalog): freeze symbolic generation candidates`.

### Task 4: Add Red Baron decoder-survival diagnostics and generic-fix gate

**Files:**
- Create: `packages/catalog/src/red-baron-survival.ts`
- Create: `packages/catalog/scripts/evaluate-red-baron-survival.ts`
- Test: `packages/catalog/test/red-baron-survival.test.ts`

**Interfaces:**
- `evaluateStageSurvival(stages, reference, windows)` scores raw→decoder→semantic→canonical→Easy one-to-one stage transitions without passing reference notes into decoding.
- `classifyStageLoss` labels retained/pitch-modified/octave-shifted/timing-shifted/rejected/replaced/obscured with counts and unsupported additions.
- `genericDecoderFixDecision(report)` returns `defer` unless a source-independent invariant, synthetic regression, cross-song improvement, and no material regression are all present.

- [ ] **Step 1: Write failing synthetic tests** for one-to-one stage accounting, provenance preservation, unsupported canonical expansion, and fail-closed missing stages.
- [ ] **Step 2: Run focused tests to verify failure.**
- [ ] **Step 3: Implement the pure evaluator/CLI**; treat real Red Baron files as opt-in local paths only and never commit them.
- [ ] **Step 4: Run focused tests/typecheck.**
- [ ] **Step 5: Commit** `feat(catalog): add decoder survival diagnostics`.

### Task 5: Add seven-song inventory, candidate freeze, and local evaluation CLI

**Files:**
- Create: `packages/catalog/scripts/evaluate-external-symbolic.ts`
- Create: `packages/catalog/src/external-benchmark.ts`
- Test: `packages/catalog/test/external-benchmark.test.ts`
- Modify: `packages/catalog/package.json`

**Interfaces:**
- `SEVEN_SONG_BENCHMARK_IDS` contains the seven logical fixtures only as inventory identifiers, never as leak-guard logic.
- `buildExternalBenchmarkReport(input)` records discovered/acquired/usable candidates, frozen candidate-set digest, generation route, output availability, role-aware reference diagnostics, and failure taxonomy.
- CLI accepts explicit local manifest paths and candidate/reference selectors, redacts paths by default, and never copies benchmark files.

- [ ] **Step 1: Add failing tests** for all-seven inventory completeness, missing-evidence reporting, freeze-before-evaluation ordering, deterministic report hashes, explicit reference windows, and fail-closed human readiness.
- [ ] **Step 2: Run focused tests to verify failure.**
- [ ] **Step 3: Implement the local-only orchestration** over existing research/alignment/evaluation APIs; do not fabricate candidate generations or auto-download protected content.
- [ ] **Step 4: Run the CLI against synthetic/local metadata fixtures only, then run focused tests/typecheck.**
- [ ] **Step 5: Commit** `feat(catalog): add external symbolic benchmark orchestration`.

### Task 6: Verify the full mission and log evidence

**Files:**
- Modify: `packages/catalog/package.json` if scripts need registering.
- Modify: `README.md` or `docs/native-symbolic-adapter.md` with local-only usage and non-claims.
- Modify: the Keyspilli project note in the local Obsidian vault via the Obsidian skill.

- [ ] **Step 1: Run focused catalog/midi/transcribe tests and all workspace tests.**
- [ ] **Step 2: Run all workspace typechecks and `git diff --check`.**
- [ ] **Step 3: Run deterministic report/candidate-set reruns and verify exact hashes.**
- [ ] **Step 4: Run the local seven-song inventory/evaluation only where permitted artifacts exist; record unavailable evidence honestly.**
- [ ] **Step 5: Audit git status for protected artifacts, paths, debug output, and accidental benchmark references.**
- [ ] **Step 6: Log exact commits, counts, reports, and non-claims in the Keyspilli project note.**
- [ ] **Step 7: Commit documentation/verification only after fresh evidence.**
