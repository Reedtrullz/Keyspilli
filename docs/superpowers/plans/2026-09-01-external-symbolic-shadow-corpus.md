# External Symbolic Shadow-Corpus Mission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the `EXTERNAL_SYMBOLIC_FIRST` architecture on a disk-safe, open-data shadow corpus while preserving the seven-song benchmark firewall and completing generic evidence/lineage diagnostics.

**Architecture:** Add a provider-neutral, local-only shadow-corpus manifest and evaluator around the existing catalog research, alignment, MIDI ingestion, and arrangement APIs. Shadow truth is explicitly `SHADOW_GENERATION_TRUTH`; protected seven-song references remain `BENCHMARK_REFERENCE` and cannot enter generation. Acquisition, alignment, and Red Baron tracing are opt-in local commands with deterministic JSON reports; dataset media never enters git.

**Tech Stack:** TypeScript, `@keyspilli/catalog`, `@keyspilli/midi`, Vitest, `tsx`, Node `fs/promises`, existing MIDI parser/writer and symbolic-alignment utilities.

**Spec:** `/Users/reidar/.codex/attachments/5dc70daa-141a-47ac-89ee-ba5dcbff4b00/pasted-text.txt`

## Global Constraints

- Keep the seven supplied human references evaluation-only; never use them as generation candidates.
- Require explicit `alignment.status: "aligned"` for real benchmark generation candidates; never weaken the 3-window/32-bar gate.
- Use only bounded, openly licensed/local-authorized shadow data; no full Slakh download, no model weights, and no media committed.
- Before dataset acquisition or long loops, require at least 30 GiB free; with less, use synthetic fixtures and metadata-only research.
- No production replay, catalog mutation, push, merge, deploy, or upload.
- Keep reports deterministic, path-redacted by default, and write temporary artifacts under one bounded `/private/tmp` run directory.

---

### Task 1: Establish disk and corpus acquisition boundary

**Files:**
- Create: `/private/tmp/keyspilli-shadow-mission-<run>/DISK-REPORT.json` (local only)
- Create: `/private/tmp/keyspilli-shadow-mission-<run>/CORPUS-RESEARCH.md` (local only)
- Test: `packages/catalog/test/shadow-corpus.test.ts` (created in Task 2)

**Interfaces:**
- Consumes: `df -h /System/Volumes/Data`, official dataset metadata, existing `external-evidence.ts` purpose constants.
- Produces: a bounded byte budget and a recorded decision to acquire a tiny Slakh subset only when the budget permits; otherwise a synthetic-only shadow run.

- [x] **Step 1: Record available disk and existing local caches.**

  Run `df -h /System/Volumes/Data` and `du -sh` only on explicitly named `/private/tmp/keyspilli-*` and known dataset cache directories. Do not delete anything in this step.

- [x] **Step 2: Verify licenses and tiny-subset URLs from primary dataset documentation.**

  Record Slakh2100, MAESTRO, and GuitarSet license/source metadata without downloading media. Classify each as `metadata-only`, `downloadable`, or `blocked`.

- [x] **Step 3: Choose one bounded run directory.**

  Create one `mktemp -d /private/tmp/keyspilli-shadow-mission.XXXXXX` directory, set a cleanup trap for owned intermediates, and record the byte budget. If free space remains below 30 GiB, do not acquire corpus media.

- [x] **Step 4: Commit no data.**

  Keep all reports outside the repository and record only provider-neutral rules in the tracked manifest schema from Task 2.

---

### Task 2: Add provider-neutral shadow-corpus manifest and purpose firewall

**Files:**
- Create: `packages/catalog/src/shadow-corpus.ts`
- Modify: `packages/catalog/src/external-evidence.ts`
- Create: `packages/catalog/test/shadow-corpus.test.ts`
- Modify: `packages/catalog/src/index.ts` only if the public type export is required by existing barrel conventions

**Interfaces:**
- Consumes: `ExternalEvidenceCandidate`, `assertGenerationEvidence`, `canonicalEvidenceCandidateSet`, `sha256Hex`, and parsed MIDI metadata.
- Produces: `ShadowCorpusItem`, `ShadowCorpusManifest`, `SHADOW_GENERATION_TRUTH`, `createShadowCorpusItem`, `validateShadowCorpusManifest`, `shadowCorpusDigest`, `readShadowCorpusManifest`.

- [x] **Step 1: Write failing tests for purpose separation and deterministic manifest hashing.**

  Test that a `SHADOW_GENERATION_TRUTH` item is accepted, a `BENCHMARK_REFERENCE` item is rejected by generation validation, missing hashes/paths/track metadata fail closed, reordered items produce the same digest, and absolute paths are redacted from canonical JSON.

- [x] **Step 2: Implement exact manifest types.**

  Use fields `{ schemaVersion, corpus, datasetVersion, license, sourceRecord, audio, symbolic, tracks, durationBeats, generationEligibility, evaluationEligibility }`; each media record contains `{ status, sha256, byteLength, logicalRef }` and never stores an absolute path in canonical output.

- [x] **Step 3: Add the explicit purpose constant and validation.**

  Extend the evidence-purpose union with `SHADOW_GENERATION_TRUTH` only if current callers remain exhaustive; otherwise keep it as a shadow-only literal and map it to generation validation through a dedicated `assertShadowGenerationTruth`. `BENCHMARK_REFERENCE` must always fail generation.

- [x] **Step 4: Implement stable sort/hash and JSON roundtrip.**

  Sort items by corpus/id, normalize optional fields, hash canonical JSON with `sha256`, and reject duplicate IDs, invalid byte hashes, missing license/source records, or media paths that resolve inside the repository.

- [x] **Step 5: Run focused tests and typecheck.**

  Run `./node_modules/.bin/vitest run packages/catalog/test/shadow-corpus.test.ts --reporter=dot` and `npm run typecheck -w @keyspilli/catalog`.

---

### Task 3: Build a bounded Slakh/local MIDI adapter

**Files:**
- Create: `packages/catalog/src/shadow-corpus-adapter.ts`
- Create: `packages/catalog/scripts/build-shadow-corpus.ts`
- Create: `packages/catalog/test/shadow-corpus-adapter.test.ts`

**Interfaces:**
- Consumes: a local manifest of item directories, `parseMidi`, `ExternalRoleDiagnostic`, and `ShadowCorpusItem`.
- Produces: deterministic item metadata, track/program/percussion summaries, role tags (`drums`, `bass`, `guitar`, `piano`, `other`), and a JSON report. The CLI accepts only explicit local paths and never downloads.

- [x] **Step 1: Write failing synthetic adapter tests.**

  Build temporary MIDI bytes with named/programmed tracks for drums, bass, guitar, piano, and another pitched instrument. Assert parsed counts, duration, tempo, percussion detection, role mapping, source hashes, and rejection of malformed/non-MIDI bytes.

- [x] **Step 2: Implement local adapter and role mapper.**

  Parse each file once, preserve track names/programs, classify percussion by channel/program, classify instrument families from General MIDI program ranges, and return `SHADOW_GENERATION_TRUTH` only when audio and symbolic records are both present and the dataset license/source record is supplied.

- [x] **Step 3: Implement CLI with explicit `--root`, `--out`, and `--limit`.**

  Validate regular local paths, enforce the bounded item limit (default 20), reject repository paths, redact paths in output, and return exit code 2 for malformed data. Do not add a package download dependency.

- [x] **Step 4: Run focused adapter tests and typecheck.**

  Run `./node_modules/.bin/vitest run packages/catalog/test/shadow-corpus-adapter.test.ts --reporter=dot` and `npm run typecheck -w @keyspilli/catalog`.

---

### Task 4: Exercise full-band semantic-to-piano generation on shadow fixtures

**Files:**
- Create: `packages/catalog/src/shadow-evaluation.ts`
- Create: `packages/catalog/scripts/evaluate-shadow-corpus.ts`
- Create: `packages/catalog/test/shadow-evaluation.test.ts`

**Interfaces:**
- Consumes: `ShadowCorpusManifest`, parsed role-tagged notes, `buildMetalArrangement`/existing external symbolic arrangement entry points, `buildVariants`, and `evaluateArrangementNotes`.
- Produces: per-item `SHADOW_ENGINEERING_READY` report with canonical/Advanced/Medium/Easy availability, role-semantic metrics, drum-pitch violations, playability/texture diagnostics, and explicit failures.

- [x] **Step 1: Write failing end-to-end tests.**

  Use synthetic full-band MIDI with melody, sustained harmony, bass, and drums. Assert drums never become pitched piano notes, vocals/lead contour survive, bass/root evidence exists, Easy has fewer notes than Advanced, Medium is intermediate, and repeated full-chord restrikes are not multiplied.

- [x] **Step 2: Implement role-preserving input conversion.**

  Keep drums timing-only, map bass to root evidence, preserve guitar/piano/other source lineage, and pass a single semantic source per role into the existing arranger rather than flattening tracks.

- [x] **Step 3: Implement deterministic per-item evaluator.**

  Report counts and tri-state metrics for melody pitch-class/contour/onset survival, harmony/root timing, bass agreement, drum-derived pitch count, low-register mud, chord walls, restrikes, hand spans, jumps, polyphony, and attack density. Never label synthetic success as real-song recognition.

- [x] **Step 4: Implement CLI and fail-closed readiness.**

  Require a valid shadow manifest, explicit item IDs, and local output path. Emit `READY_FOR_ENGINEERING_LISTENING` only when provenance, alignment, semantic coverage, structural checks, and playability bounds pass; keep failures for intentionally adversarial fixtures.

- [x] **Step 5: Run focused tests and typecheck.**

  Run `./node_modules/.bin/vitest run packages/catalog/test/shadow-evaluation.test.ts --reporter=dot` and both catalog/midi typechecks.

---

### Task 5: Add deterministic symbolic-alignment corruption/recovery calibration

**Files:**
- Create: `packages/catalog/src/shadow-alignment.ts`
- Create: `packages/catalog/scripts/calibrate-shadow-alignment.ts`
- Create: `packages/catalog/test/shadow-alignment.test.ts`

**Interfaces:**
- Consumes: paired shadow MIDI/audio timing metadata, `alignSymbolicScores`, and normalized candidate/reference windows.
- Produces: corruption cases for offsets, tempo scales, transposition, truncation, repeat insertion, and section removal with recovered mapping, timing error, coverage, and false-alignment status.

- [x] **Step 1: Write failing corruption fixtures.**

  Generate a deterministic eight-bar symbolic score and transformed candidates (`+5 sec` equivalent beats, `0.8x`, `1.25x`, transpose ±2, removed/duplicated sections). Assert the expected transform is represented in the fixture and that invalid windows fail closed.

- [x] **Step 2: Implement calibration wrapper.**

  Keep ground truth outside the aligner call, invoke the existing alignment API with no transform hint, and compare the recovered result only after the call. Preserve reference-domain starts and one-to-one note identity.

- [x] **Step 3: Report gate calibration without changing thresholds.**

  Summarize whether the 3-window/32-bar gate is supported by independent shadow cases; do not change the production threshold based on seven-song outcomes.

- [x] **Step 4: Run focused tests and typecheck.**

  Run `./node_modules/.bin/vitest run packages/catalog/test/shadow-alignment.test.ts --reporter=dot` and `npm run typecheck -w @keyspilli/catalog`.

---

### Task 6: Continue seven-song research and retrieval classification

**Files:**
- Modify: `packages/catalog/src/external-research.ts`
- Modify: `packages/catalog/src/external-evidence.ts` only for generic status enums/validation
- Modify: `packages/catalog/test/external-research.test.ts`
- Create: `packages/catalog/src/external-retrieval.ts`
- Create: `packages/catalog/test/external-retrieval.test.ts`
- Create: `packages/catalog/scripts/research-seven-song-evidence.ts`

**Interfaces:**
- Consumes: explicit discovered URLs/local inputs and HTTP response metadata supplied by the caller; never benchmark-reference bytes.
- Produces: `FOUND_ACCESSIBLE_SYMBOLIC`, `FOUND_METADATA_ONLY`, `FOUND_PIANO_COVER`, `NO_EXTERNAL_SOURCE`, `USER_EVIDENCE_AVAILABLE`, and acquisition diagnostics `{ initialUrl, redirects, finalUrl, contentType, contentLength, magic, authRequired }`.

- [x] **Step 1: Write failing response-classification tests.**

  Cover valid MIDI magic with wrong MIME, HTML with `.mid` extension, login/paywall HTML, redirects, 404, empty body, valid MusicXML, and authentication-required responses. Assert HTML never reaches the MIDI parser and metadata-only results remain explicit.

- [x] **Step 2: Implement bounded retrieval classifier.**

  Inspect Content-Type, magic/header bytes, extension, status, redirect chain, and final URL. Do not bypass authentication or download benchmark references. Make network acquisition opt-in and local reports path-redacted.

- [x] **Step 3: Re-run seven-song inventory.**

  Use the existing seven logical IDs, classify each song, and preserve the strict aligned-candidate freeze. Do not call any candidate usable merely because it parses.

- [x] **Step 4: Add piano-cover/chord-tab metadata states without inventing symbolic bytes.**

  Record discoverable metadata-only evidence and leave generation unavailable until a candidate has legitimate bytes and independent alignment.

- [x] **Step 5: Run focused external tests and typecheck.**

  Run the external research/benchmark/retrieval test files and `npm run typecheck -w @keyspilli/catalog`.

---

### Task 7: Complete generic event-lineage diagnostics and Red Baron survival audit

**Files:**
- Modify: `packages/midi/src/metal-arrange.ts`
- Modify: `packages/midi/src/simplify.ts` only for trace propagation, not musical thresholds
- Modify: `packages/catalog/src/red-baron-survival.ts`
- Modify: `packages/catalog/scripts/evaluate-red-baron-survival.ts`
- Create: `packages/midi/test/metal-lineage.test.ts`
- Modify: `packages/catalog/test/red-baron-survival.test.ts`

**Interfaces:**
- Consumes: existing private trace hooks and stage outputs.
- Produces: stable IDs and stage records `{ rawEventId, groupId, decodedEventId, semanticEventId, canonicalEventIds, difficultyEventIds, reason, transform }` plus supported/unsupported survival counts.

- [ ] **Step 1: Write failing synthetic lineage tests.** *(partial: existing private trace coverage; full difficulty-ladder lineage remains unavailable)*

  Assert a raw lead note can be traced through decoder/semantic/canonical/Advanced/Medium/Easy, merged and rejected events have explicit reasons, octave/timing/duration changes are recorded, reordered input is deterministic, and missing stages produce a blocked report rather than a crash.

- [x] **Step 2: Propagate stable lineage IDs without changing note selection.**

  Use stable source/start/midi identifiers and attach only private trace references. Preserve public `Note`, IR, manifest, and API payload compatibility.

- [x] **Step 3: Run the frozen local Red Baron audit.** *(blocked when the semantic stage is absent)*

  Use only explicit local stage files and the protected reference after instrumentation is complete. Classify first loss as `RAW_EVIDENCE_MISSING`, `DECODER_REJECTION`, `SEMANTIC_CONVERSION_LOSS`, `CANONICAL_NOISE_EXPANSION`, or `DIFFICULTY_LOSS`; keep the report blocked if any required stage is absent.

- [x] **Step 4: Run focused lineage/survival tests and typecheck.**

  Run `./node_modules/.bin/vitest run packages/midi/test/metal-lineage.test.ts packages/catalog/test/red-baron-survival.test.ts --reporter=dot` and both package typechecks.

---

### Task 8: Produce mission reports and bounded verification

**Files:**
- Create: `packages/catalog/scripts/report-shadow-mission.ts`
- Create: `docs/architecture/shadow-corpus.md`
- Modify: `docs/architecture/external-symbolic-first.md`
- Test: `packages/catalog/test/shadow-mission-report.test.ts`

**Interfaces:**
- Consumes: shadow, alignment, retrieval, benchmark, and Red Baron JSON reports.
- Produces: one decision-oriented, path-redacted report distinguishing `SHADOW_ENGINEERING_READY`, `BENCHMARK_READY_FOR_HUMAN_LISTENING`, and `PRODUCTION_READY`.

- [x] **Step 1: Write report tests.**

  Assert report sections include disk/corpus provenance, per-item shadow outputs and failures, alignment recovery, seven-song inventory, candidate freeze order, Red Baron first loss, readiness states, and safety actions. Assert no protected paths or binary payloads appear.

- [x] **Step 2: Implement deterministic report aggregation.**

  Use stable ordering and fixed rounding; keep unavailable metrics null; never turn missing evidence into zero coverage or a recognizability claim.

- [x] **Step 3: Run all bounded focused gates.** *(full workspace rerun deferred below the disk threshold)*

  Run the affected MIDI/catalog suites, package typechecks, `git diff --check`, deterministic reruns of shadow/benchmark reports, and the firewall tests. Run the full workspace only if disk headroom is safely restored; otherwise record the deferral.

- [ ] **Step 4: Log evidence and commit locally.** *(in progress at closeout)*

### Closeout status

Tasks 1–6 and the report portions of Task 8 are implemented and bounded-tested.
Task 7 remains intentionally partial at the canonical-to-difficulty lineage
boundary; the local Red Baron report fails closed when its semantic stage is
missing. Real corpus acquisition and a fresh full-workspace loop are deferred
because free disk remains below 30 GiB. Task 8 Step 4 is the current closeout
operation: Obsidian logging, intentional-file staging, and the local commit.

  Append one concise entry to the Keyspilli Obsidian project note, stage only intended tracked code/docs/tests, commit coherent local changes, and leave corpus bytes/scratch files untracked.

---

## Stop Conditions and Non-Claims

- If Slakh acquisition would violate the disk budget or requires unavailable access, use synthetic shadow fixtures and report `metadata-only`/`blocked`; do not download large substitutes.
- If no real benchmark candidate has independent alignment, report zero real-song symbolic outputs and do not create a listening pack.
- A shadow engineering pass does not imply Sabaton/Free Bird recognizability or production readiness.
- Do not change the 3-window/32-bar gate without independent shadow evidence.
- Do not implement the “next highest-value task” from the final report during this plan; only identify it.
