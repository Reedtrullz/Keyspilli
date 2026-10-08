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

- [ ] Run all prescribed local gates and one independent whole-branch review; address material findings.
- [ ] Open a focused PR, attach it to this task, verify both required checks and CLEAN state, merge and verify main deployment.
- [ ] Check deployed samples, full public catalog label sweep and selected store-field preservation.
- [ ] Reconcile remaining bases explicitly and continue additional substantiated batches. Do not claim complete naming while unresolved bases remain.

## Evidence status, 2026-10-08

Every stored base has an acquisition/source disposition; this is not completed
naming. PR226 through PR229 are merged, deployed and live-verified. Latest verified
commit d52f6efde7ce1f417f4f8f2f449ac2e673defae8 has 1,764 variants / 441 bases /
31 named bases, zero numbered labels/errors and preserved selected store fields.
PR230 merged after exact-head checks and CLEAN state at
 ec75564a3976f16cd9526c9a0f18a244ae5d4c64; deployment acceptance is pending.

The archived-score/opening-text batch adds twelve candidates: 47 stored / 45 served
maps expected, with 408 stored / 396 served bases still lacking a substantiated
map. Dukas provides literal rehearsal locations; six Czerny scores print named
second parts; Glover's fixed opening text excerpt preserves the failed full-stanza
study. Three explicitly named movements and a complete Verse lyric excerpt also
qualify, with the Nomy/Clapton caption conflict unresolved. Archived bodies now include 61 source members in 11 matched ZIP archives.
The three structured Songsterr studies admitted no maps. See
`docs/research/2026-10-08-section-archived-score-followup.md`.

Current broader evidence covers 234 captured UG chart bases, 227 harmony trials,
108 byte-matched scores and 418 original-source byte matches. Shallow and What Was
I Made For have no eligible stable minimum-cost harmony span. Ten Sabaton recording
clock studies, Status Quo's conflicting roles, 37 unfound original sources and two
raw parse errors remain unresolved. Catalog-wide naming remains incomplete;
Task4 continues with additional evidence and the release gates above.
