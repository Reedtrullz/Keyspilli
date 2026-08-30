# Section-aware Piano Candidate Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the recognizable PianoPaul05 melody, replace muddy piano-cover accompaniment with conservative semantic harmony, and select Pøsle melody only in objectively stronger aligned regions while producing a new local listening comparison.

**Architecture:** Keep the existing renderer/evidence pipeline and public `Note`/`Variant` contracts. Add pure MIDI helpers for role decomposition, protected melody masks, conservative accompaniment realization, and deterministic region selection; integrate them into a local-only candidate builder/preview path so production imports remain unchanged. Keep candidate provenance and human evaluation metadata in local evaluation manifests.

**Tech Stack:** TypeScript, `@keyspilli/midi` pure `Note[]`/`ParsedMidi` helpers, existing catalog piano evaluation/alignment APIs, Vitest, tsx, and the committed optional FluidSynth listening renderer.

**Spec:** `/Users/reidar/.codex/attachments/b6ac03dc-309f-4115-99ca-23d858b62a2a/pasted-text-1.txt`

## Global Constraints

- Do not change Basic Pitch tuning, semantic guitar harmony, direct-metal DP, source ranking, or learner simplification.
- Do not invent missing melody pitches; use only notes present in candidate inputs.
- Keep production startup/import behavior unchanged; local evaluation and preview orchestration is opt-in.
- Do not upload/deploy/replay, mutate catalog data, or commit private reference MIDI, audio, or SoundFonts.
- Protect selected melody notes from accompaniment cleanup, transposition, replacement, or destructive quantization.
- Use deterministic sorting, thresholds, region smoothing, and canonical manifests; preserve source tags and attack timing.
- Human scores remain blank/pending; automated metrics never claim recognizability.

---

### Task 1: Establish a reproducible PianoPaul/Pøsle baseline

**Files:**
- Create: `packages/catalog/scripts/diagnose-piano-candidates.ts`
- Test: `packages/catalog/test/diagnose-piano-candidates.test.ts`
- Create (local ignored output only): `/private/tmp/keyspilli-piano-section-baseline/`

**Interfaces:**
- Consumes local `ParsedMidi` candidates and optional explicit beat windows.
- Produces deterministic JSON metrics for lower-register density, close intervals, hand overlap/crossing, melody contour, and stage labels (`raw`, `aligned`, `easy`, `medium`).

- [x] **Step 1: Write failing metric tests** for notes-per-attack, pitch-class/span, close low intervals, overlap, and protected top-line contour using synthetic `Note[]`.
- [x] **Step 2: Run the focused test and confirm the missing diagnostic API failure.**
- [x] **Step 3: Implement pure metric helpers and a CLI that reads only explicit local MIDI paths, redacts paths in canonical JSON, and records stage names.**
- [x] **Step 4: Run tests and execute the CLI against the retained PianoPaul05/Pøsle/Gabi preview MIDIs; save output under `/private/tmp/keyspilli-piano-section-baseline/`.**
- [x] **Step 5: Review the report to identify the first muddy stage before changing arrangement code.**

### Task 2: Add melody/accompaniment role decomposition and protection

**Files:**
- Create: `packages/midi/src/piano-roles.ts`
- Test: `packages/midi/test/piano-roles.test.ts`
- Modify: `packages/midi/src/index.ts`

**Interfaces:**
- `PianoRoleConfig`, `ProtectedMelodyNote`, `PianoRoleSplit`.
- `splitPianoRoles(notes: readonly Note[], config?: PianoRoleConfig): PianoRoleSplit`.
- `protectMelody(notes: readonly Note[], config?: PianoRoleConfig): ProtectedMelodyNote[]`.

- [x] **Step 1: Write failing tests** for a continuous upper melody over lower accompaniment, polyphonic local top voice, high triad not being wholly melody, deterministic reordered input, and immutable protected note IDs.
- [x] **Step 2: Verify the focused role tests fail for the absent module.**
- [x] **Step 3: Implement deterministic onset grouping, voice continuity/salience/duration scoring, role assignment, and stable source-index keys without changing note values.**
- [x] **Step 4: Run role tests, package typecheck, and confirm protected melody count/identity is stable under input reorder.**
- [x] **Step 5: Export only the new pure APIs and commit the task.**

### Task 3: Add conservative semantic accompaniment realization

**Files:**
- Create: `packages/midi/src/piano-accompaniment.ts`
- Test: `packages/midi/test/piano-accompaniment.test.ts`
- Modify: `packages/midi/src/index.ts`

**Interfaces:**
- `PianoAccompanimentConfig` with centralized low-register boundary, note/span caps, open-fifth threshold, and high-register triad threshold.
- `PianoHarmonyEvidence`, `PianoSemanticHarmony`, `PianoAccompanimentDiagnostics`.
- `inferPianoHarmony(attacks, bassEvidence?, config?): PianoSemanticHarmony[]`.
- `realizePianoAccompaniment(harmony, config?): Note[]`.
- `simplifyPianoAccompaniment(notes, options): { notes: Note[]; diagnostics: PianoAccompanimentDiagnostics }`.

- [x] **Step 1: Write failing tests** for E-minor six-note stack, low close-position triad, high triad preservation, weak/ambiguous thirds, missing bass root, passing-bass stability, sustained root change, repeated palm-mute timing, and deterministic reordered input.
- [x] **Step 2: Verify the focused accompaniment tests fail before implementation.**
- [x] **Step 3: Implement onset clustering, root/quality evidence scoring (`power`, `major`, `minor`, `sus2`, `sus4`, `single`, `unknown`), two-attack persistence/strong-margin stabilization, and confidence-based realization.**
- [x] **Step 4: Apply low-register open-interval and simultaneous-note/span caps while preserving original attack start/duration/source tags; never modify protected melody notes.**
- [x] **Step 5: Run tests/typecheck and inspect diagnostics for duplicate/chromatic/low-density counts.**
- [x] **Step 6: Export the pure APIs and commit the task.**

### Task 4: Add deterministic section-aware C/D melody selection

**Files:**
- Create: `packages/midi/src/piano-region-selector.ts`
- Test: `packages/midi/test/piano-region-selector.test.ts`
- Modify: `packages/midi/src/index.ts`

**Interfaces:**
- `CandidateRegion`, `PianoRegionCandidate`, `PianoRegionSelectionOptions`, `PianoRegionSelection`.
- `selectPianoMelodyRegions(candidates, windows, options?): PianoRegionSelection`.
- `clipRegionNotes(notes, region, protectedKeys): Note[]`.

- [x] **Step 1: Write failing tests** for melody-quality-over-density, tiny-score hysteresis, a sustained alternate lead win, minimum region duration, boundary dedupe/no hanging notes, shifted windows, and D melody paired with independent accompaniment.
- [x] **Step 2: Verify the focused selector tests fail before implementation.**
- [x] **Step 3: Implement generic continuity/chroma/coverage/pathology scoring, a minimum-duration/switch-penalty dynamic program, deterministic tie-breakers, and boundary clipping that preserves crossing melody notes exactly once.**
- [x] **Step 4: Run selector tests/typecheck and verify no candidate-name/song/timestamp constants exist.**
- [x] **Step 5: Export the pure APIs and commit the task.**

### Task 5: Extend local evaluation metadata and integrate candidate builder

**Files:**
- Modify: `packages/catalog/src/listening-manifest.ts`
- Modify: `packages/catalog/src/piano-evaluation.ts`
- Create: `packages/catalog/src/piano-section-builder.ts`
- Test: `packages/catalog/test/piano-section-builder.test.ts`
- Modify: `packages/catalog/src/index.ts`

**Interfaces:**
- `HumanEvaluation` optional manifest field with nullable recognition, strengths, weaknesses, ratings, and notes; no defaults.
- `PianoSectionBuildInput`, `PianoSectionBuildResult`, `buildSectionAwarePianoCandidate(input)`.
- Result includes C-original, C-revoiced, CD-fused, C-melody-only, and CD-selected-melody-only `ParsedMidi`/preview notes plus region diagnostics.

- [x] **Step 1: Write failing integration tests** that assert protected C melody survives, revoiced accompaniment is capped/open, D replaces only a materially stronger region, source/role separation is explicit, and output is deterministic.
- [x] **Step 2: Verify the integration tests fail before the builder exists.**
- [x] **Step 3: Add human-evaluation metadata serialization and path-safe canonical handling without populating subjective scores.**
- [x] **Step 4: Integrate `splitPianoRoles`, `simplifyPianoAccompaniment`, and `selectPianoMelodyRegions`; use C accompaniment/shared harmony for D melody regions and preserve direct-metal exclusion.**
- [x] **Step 5: Generate MIDI outputs through existing `writeMidi`/`buildVariants` only after role/harmony selection; preserve vocals, attack timing, and source tags.**
- [x] **Step 6: Run focused/full MIDI and catalog tests, typechecks, and inspect before/after diagnostics.**

### Task 6: Regenerate local listening bundle and verify release boundaries

**Files:**
- Modify: `packages/catalog/scripts/build-listening-bundle.ts`
- Modify: `/private/tmp/keyspilli-piano-final.XMnM72/listening/LISTENING.md` (generated local artifact only)
- Generate only under `/private/tmp/keyspilli-piano-section-listening/`; never commit WAV/MIDI/private reference.

**Interfaces:**
- CLI options select explicit local C/Pøsle paths and windows; output includes descriptive and blind renders, canonical manifest, diagnostics, and blank worksheet.

- [x] **Step 1: Write failing bundle tests** for required filenames, C-original/C-revoiced/CD-fused/melody-only artifacts, blind aliases, path-free canonical JSON, human metadata, and unchanged production boundary.
- [x] **Step 2: Implement orchestration using the existing optional FluidSynth renderer and the new local builder; keep renderer normalization fixed and record all config/hashes.**
- [x] **Step 3: Execute the bundle against retained local candidates with explicit opening/chorus/solo/full windows; do not use or copy the private reference MIDI.**
- [x] **Step 4: Run all focused tests, full workspace tests, all typechecks, `git diff --check`, and repeat the local build to verify deterministic manifest/audio hashes.**
- [x] **Step 5: Review `LISTENING.md` and leave all score fields blank with `Human listening acceptance: pending.`**
- [x] **Step 6: Commit only source/tests/docs; verify generated audio/reference/SF2 are outside Git and production remains untouched.**
