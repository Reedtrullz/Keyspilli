# All-base section coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Pursue substantiated section names for all 455 stored bases, while keeping every unresolved span visibly estimated.

**Architecture:** Freeze production source, note and tempo identities before acquiring charts and scores. Reuse ordered harmony alignment and independently validate eligible spans; exact retained MIDI form markers use the existing source tier. Add a frozen identity inventory so uploaded bases participate in the integrity audit without changing generation manifests.

**Tech Stack:** Node 22.22.3, TypeScript, Vitest, Python read-only research helpers, saved Ultimate Guitar charts, Mutopia LilyPond scores, production SQLite/artifacts.

**Spec:** `docs/superpowers/plans/2026-10-08-section-naming-autonomous-handoff.md`, extended by the owner's instruction to continue through all bases.

## Global Constraints

- Never write `evidence: "source"` for anything other than timed FF06/FF07 markers retained from the exact source MIDI.
- Do not write bulk owner metadata, change `inferSongForm`, edit the primary checkout, read credentials, or remove blocked maps.
- No musical acceptance, recognizability or playability claim.
- An alignment cost gap below 0.15 remains ambiguous; stronger names require actual independent correspondence.
- Check source hash, actual production Advanced-note hash and playback tempo for every new map.
- A rejected candidate is recorded as unresolved, not as completed naming.
- Release only after audit, typecheck, unit tests, build, successful required CI and CLEAN merge state. Verify deployed identities, health, labels, preserved selected store fields and absence of numbered section labels.

## Review Focus

- Uploaded bases absent from the seed manifest must resolve only with a valid captured production identity.
- Compound or unrecognized markers terminate certainty; a preceding known marker must not swallow the unknown passage.
- Pickup lyrics and late first lines cannot establish the full section boundary.
- Repeated harmony and repeated text must retain occurrence ambiguity rather than choose a convenient path.
- A matching external title or score URL without source correspondence cannot establish form or clock identity.

### Task 1: Capture and acquire all-base evidence

**Files:** Private `output/section-all-bases/production-inventory.json`, `production/`, `midi-scan.json`, `ug-acquisition.json`, `mutopia-acquisition.json`, `all-base-ledger.json`.

**Interfaces:** Capture all 455 production base identities and notes; verify each retained source file against the manifest hash. Acquisition ledgers record exact URLs, hashes, identity outcomes and explicit remaining scope.

- [x] Capture all 455 notes files and 405 exact retained sources; verify every captured hash.
- [x] Complete chord-chart and score acquisition attempts across the full inventory, preserving prior rejected studies.
- [x] Scan every captured MIDI for usable FF06/FF07 markers, timed lyrics and parse failures.
- [x] Inspect missing source identities without substituting a generated arrangement for the original.

### Task 2: Extend the integrity audit to captured bases

**Files:** Create `catalog/section-base-identities.json`; modify `packages/catalog/scripts/audit-sections.ts`; test `packages/catalog/test/audit-sections.test.ts`.

**Interfaces:** `CapturedSectionBase` contains `baseId`, `sourceArtifactHash`, `advancedNotesSha256`, `playbackTempoBpm`, `servedAtCapture`; a pure validator accepts a frozen inventory, rejects malformed/duplicate identities and checks a map against its captured identity.

- [x] Write failing tests for valid uploaded identity, unknown target, malformed/duplicate capture, stale source/notes/tempo and seed compatibility.
- [x] Add captured bases to the known inventory and use captured values to validate applicable map pins.
- [x] Preserve seed/learner identities and blocked warnings; capture time does not promise current public service.
- [x] Run catalog tests and audit, commit the tested change.

### Task 3: Produce and independently check candidate maps

**Files:** Private per-base receipts; modify `catalog/song-sections.json`; research report under `docs/research/`.

**Interfaces:** Existing `alignChartSections` receives saved charts and pinned production notes. Retained markers and real score annotations use a separately verified source-to-playback clock. New evidence methods need a bounded design and adversarial tests before use.

- [ ] Harvest newly found usable source markers with independently checked clock correspondence and conservative endpoints.
- [ ] Solve saved charts on eight- and four-bar grids, inspect alternatives, verify isolated eligible spans independently.
- [ ] Inspect exact matching Mutopia scores for named form annotations and independently check any occurrence itinerary.
- [ ] Investigate full multi-line lyric correspondence where harmony is ambiguous; do not equate a vocal onset with a form boundary.
- [ ] Write only substantiated entries; keep every weak span unresolved in the 455-base ledger.

### Task 4: Review, release and continue remaining bases

**Files:** PR description, bounded release receipts, all-base ledger and Obsidian log.

- [x] Run all prescribed local gates and one independent whole-branch review; address material findings.
- [x] Open a focused PR, attach it to this task, verify both required checks and CLEAN state, merge and verify main deployment.
- [x] Check deployed samples, full public catalog label sweep and selected store-field preservation.
- [ ] Reconcile remaining bases explicitly and continue additional substantiated batches. Do not claim complete naming while unresolved bases remain.

## Evidence status, 2026-10-08

PR226 through PR229, PR232, PR235, PR236, PR237, PR238, PR239 and PR240 are
merged, deployed and live-verified. Latest complete proof
aaa6adadfd6da01d4e5749d8cc0f3ab7413cd495 has1,764variants/441bases/100named
served bases, zero numbered labels/errors,80samples across20source/note/tempo
pins, stable healthy exact-commit containers, and unchanged selected2730row/455base
store fields. Main37866047422SUCCESS. The deployed catalog has102stored/100served
maps;353stored/341served bases remain unmapped. The reviewed Gounod/Bach Prelude
addition raises the working state to103stored/101served maps;
352stored/340served bases remain unmapped. That addition is integrated but
awaits its own main deployment and exact-commit live proof.
The independent storage repair PR234 completed its deployment/retention audit.

A reviewed two-map Bach371 follow-up plus the Cornelius Op.3 addition brings the
working ledger to102stored/100served maps.353stored/341served bases remain
unmapped before the Gounod addition; it adds one partial map, leaving76partial
and27numeric-extent maps. Numeric extent does not imply completed internal
form. The two Bach entries and the Cornelius entry are deployed; Gounod awaits
release. Their source, opening, endpoint and correspondence receipts pass;
No.39 remains rejected and immutable. See
`docs/research/2026-10-08-section-printed-parent-supplements.md`.

Four strict first opening trials fail (Alkan1, Brahms118, GriegAlbumblatt,
DebussyPreludeIV) and remain unchanged/unaccepted despite full clock matches.
No fingerprint, duration or cutoff is retuned. Further actual printed-parent
acquisition is prospective research, not new naming or completed disposition.

Broader evidence includes235captured UG-chart bases,227harmony trials,
108byte-matched scores and418original byte matches:403MIDI files
(401parsed/two retained parse errors), two MusicXML and13audio/video.
A read-only scan of581primary local music assets finds zero additional
original matches for37unfound bases. Earlier lyric/harmony/TAB/score failures
remain preserved. Gerudo's initial origin-checker defect remains unqualified;
its control-only repair admits no map and source qualification was not rerun.
All-base naming remains incomplete; Task4 continues.
