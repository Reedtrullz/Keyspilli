# Chords Backing-Only Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Chord mode default to a source-melody-free backing arrangement while preserving explicit Melody + accompaniment choices and keeping unsupported backing visibly fail-closed.

**Architecture:** Reuse the existing `resolveAccompaniment(..., "bass-chords")` producer, but make that style own the final note stream: supported chart events emit generated bass/chord voicings and uncovered/unsupported spans emit no source notes plus `fallbackSpans`. Change the persisted default in `prefs.ts`, then route Player transport, guidance, practice, display, full preview, and accompaniment audition through the same resolved backing result. Keep the existing Melody + accompaniment producer and its worker path unchanged except for explicit selection and shared control wording.

**Tech Stack:** TypeScript, React/Next.js, Vitest, Playwright, Node 22, existing MIDI/player-core chord and accompaniment utilities.

**Spec:** User-authorized product clarification in the task; existing engineering contract in `docs/superpowers/evidence/2026-09-19-chords-finish/pr-103-coverage.md`.

## Global Constraints

- Default Chord mode leaves out sung/source melody and plays backing bass/chords where the existing chart producer can support it.
- A new explicit-style intent marker preserves a user-selected `"melody-accompaniment"`; old `keyspilli.prefs.v1` melody values without that marker are treated as the old auto-saved default and migrate to backing-only.
- A physical hand filter is not a musical-role selector and must not be used to solve melody leakage.
- Unsupported backing is silent and clearly reported; it must not silently replay original/unclassified source notes under a backing-only label.
- Reuse the existing producer; do not add source-separation, semantic-melody, or catalog changes.
- Scope is committed code/tests/docs, pushed branch, and draft PR only; no merge, deploy, production catalog mutation, or live production claim.
- Use Node `v22.22.3`, keep disposable outputs outside tracked source, and stop long work if `/System/Volumes/Data` falls below 30 GiB free.

## Review Focus

- Missing versus explicit persisted style: test that absent style loads as `bass-chords` while explicit `melody-accompaniment` survives.
- Chart gaps, unsupported symbols, no-chord spans, and source notes crossing chart boundaries: test that backing output contains no source notes and exposes fallback spans.
- Chord events with no overlapping source notes: test that a supported chart still realizes bass/chords rather than treating source ownership as a prerequisite.
- Physical hand filtering versus musical role: test that `hand` only filters the already-resolved backing notes and never reintroduces source melody.
- Cross-surface consistency: test that transport, guidance, practice/display chord targets, full preview, and accompaniment audition consume the same backing resolution.

### Task 1: Freeze the new preference contract

**Files:**
- Modify: `packages/player-core/src/prefs.ts`
- Test: `packages/player-core/test/prefs.test.ts`

**Interfaces:**
- `DEFAULT_SETTINGS.accompanimentStyle` becomes `"bass-chords"`.
- `loadSettings()` uses the explicit-style intent marker when present; otherwise it treats legacy stored melody values like a missing style and uses the backing-only default.
- `saveAccompanimentStyleIntent(style)` persists only a deliberate style-button choice; unrelated `saveSettings()` calls do not create intent.

- [x] **Step 1: Write failing preference tests**

  Add assertions that `DEFAULT_SETTINGS.accompanimentStyle` is `"bass-chords"`, a stored record with only `{ backgroundMode: "chord" }` loads `"bass-chords"`, a legacy stored `{ accompanimentStyle: "melody-accompaniment" }` without intent migrates to `"bass-chords"`, and the same value with the explicit intent marker remains `"melody-accompaniment"`.

- [x] **Step 2: Run the preference test and verify the expected failure**

  Run `npm run test -w @keyspilli/player-core -- test/prefs.test.ts`.
  Expected: the new default/migration assertions fail because the current fallback is `"melody-accompaniment"`.

- [x] **Step 3: Change only the default fallback**

  Set `DEFAULT_SETTINGS.accompanimentStyle` to `"bass-chords"`; add the versioned intent-marker read/write helper; keep unrelated preference fields and old storage keys unchanged.

- [x] **Step 4: Run the preference test and package suite**

  Run `npm run test -w @keyspilli/player-core -- test/prefs.test.ts` and then `npm run test -w @keyspilli/player-core`.
  Expected: both pass with no unrelated preference behavior changes.

- [x] **Step 5: Commit**

  `git add packages/player-core/src/prefs.ts packages/player-core/test/prefs.test.ts && git commit --no-gpg-sign -m "feat: default chord mode to bass and chords"`

### Task 2: Make Bass + chords own the final note stream

**Files:**
- Modify: `packages/player-core/src/accompaniment.ts`
- Test: `packages/player-core/test/accompaniment.test.ts`

**Interfaces:**
- `resolveAccompaniment(notes, chords, "bass-chords", options)` returns generated chord events for supported chart spans, `notes: []`, generated chord guidance only, and `fallbackSpans` for unsupported/uncovered spans.
- `resolveAccompaniment(..., "melody-accompaniment", ...)` retains its current ownership-safe behavior.

- [x] **Step 1: Write failing resolver tests**

  Add tests for: a supported chord with no overlapping source note still creates a bass/chord event; a source note crossing a supported chord boundary is not returned in backing `notes`; and an unsupported/gap span returns `notes: []` with the existing reason in `fallbackSpans`.

- [x] **Step 2: Run the resolver tests and verify they fail**

  Run `npm run test -w @keyspilli/player-core -- test/accompaniment.test.ts`.
  Expected: the current resolver retains source notes, rejects no-source chart events, or records boundary-crossing spans as fallback.

- [x] **Step 3: Implement the smallest style-specific resolver change**

  Keep the existing generated voicing code. For `bass-chords`, allow supported events regardless of source overlap, do not fail merely because a source note crosses a boundary, and return no source notes or source-derived guidance. Keep the existing early no-source fallback for Melody + accompaniment; allow chart-backed Bass + chords to resolve without source-note ownership.

- [x] **Step 4: Run resolver and engine regressions**

  Run `npm run test -w @keyspilli/player-core -- test/accompaniment.test.ts test/engine.test.ts` and then `npm run test -w @keyspilli/player-core`.
  Expected: Bass + chords has no source-note leakage; generated chord MIDI remains valid; Melody + accompaniment tests retain their previous ownership-safe behavior.

- [x] **Step 5: Commit**

  `git add packages/player-core/src/accompaniment.ts packages/player-core/test/accompaniment.test.ts && git commit --no-gpg-sign -m "fix: fail closed when chord backing is unavailable"`

### Task 3: Route Player surfaces through the resolved backing arrangement

**Files:**
- Modify: `apps/web/src/components/player/Player.tsx`
- Modify: `apps/web/src/components/player/SoundControls.tsx`
- Test: `apps/web/src/components/player/SoundControls.test.tsx`
- Test: `apps/web/src/components/player/melody-arrangement-runtime.test.ts`

**Interfaces:**
- The existing `accompaniment` memo remains the single resolved arrangement for Chord mode.
- `previewSound("full")` uses the transport/chord timeline; `previewSound("accompaniment")` uses the resolved backing output for Bass + chords and the existing non-melody event projection for Melody + accompaniment.
- `updateSettings()` records a style intent only when the user activates the style control; the backing-only control copy makes the migration/result obvious.
- UI fallback copy distinguishes `Backing unavailable — source melody omitted` from Melody + accompaniment’s existing retained-source wording.

- [x] **Step 1: Write failing UI/projection tests**

  Update the static SoundControls expectations for the new default and add assertions for backing-only copy and a visible fallback status contract. Add a focused runtime assertion that the non-melody audition projection does not use the Melody + accompaniment resolution when Bass + chords is active.

- [x] **Step 2: Run the focused web tests and verify the expected failure**

  Run `npm run test -w @keyspilli/web -- src/components/player/SoundControls.test.tsx src/components/player/melody-arrangement-runtime.test.ts`.
  Expected: current default labels/copy and preview routing fail the new assertions.

- [x] **Step 3: Implement the shared-surface routing**

  Keep `melodyArrangementRequested` false for Bass + chords, pass `accompaniment.guidanceNotes` to visual/practice surfaces, use `accompaniment.chords` for backing audio preview, and update status/copy without changing the hand filter semantics. Keep Melody + accompaniment controls available when explicitly selected.

- [x] **Step 4: Run focused web tests and typecheck**

  Run the focused Vitest command again, then `npm run typecheck -w @keyspilli/web`.
  Expected: all focused tests and TypeScript checks pass.

- [x] **Step 5: Commit**

  `git add apps/web/src/components/player/Player.tsx apps/web/src/components/player/SoundControls.tsx apps/web/src/components/player/SoundControls.test.tsx apps/web/src/components/player/melody-arrangement-runtime.test.ts && git commit --no-gpg-sign -m "feat: route chord mode through backing arrangement"`

### Task 4: Pin default behavior and explicit Melody + accompaniment in browser tests

**Files:**
- Modify: `apps/web/e2e/melody-accompaniment.spec.ts`
- Modify: `apps/web/e2e/app.spec.ts`

**Interfaces:**
- Existing melody-focused tests explicitly select `Melody + accompaniment` before opening advanced melody controls.
- New browser coverage starts Chord mode with no style override and asserts `Bass + chords`, no melody worker request, no source-note fallback audio in a supported/gap fixture, and truthful fallback status.
- Preview and practice assertions use the final selected arrangement rather than assuming the old default.

- [x] **Step 1: Write failing browser assertions**

  Add a default-Chord-mode test that checks Bass + chords is selected, the backing-only copy is visible, the advanced melody controls are absent until Melody + accompaniment is selected, and the fallback message says source melody is omitted. Update old melody tests to select the explicit style.

- [x] **Step 2: Run the focused browser tests and verify the expected failure**

  Run `npm run e2e:melody-scratch -w @keyspilli/web -- --grep='backing-only default|real artifact produces|role audition|fallback and phrase metadata' --workers=1`.
  Expected: the new default test fails against the old default and old fallback copy; existing melody tests fail until they explicitly choose their style.

- [x] **Step 3: Implement only test setup/expectation changes**

  Make the shared `selectArrangement` helper choose `Melody + accompaniment` only when a melody argument is supplied; keep all fixture paths and source evidence unchanged. Add the explicit style click before melody tests so the intent marker is created by the same path as a real user choice.

- [x] **Step 4: Run the focused browser suite**

  Run the same command and inspect output artifacts for actual Player captures, not only DOM assertions.

- [x] **Step 5: Commit**

  `git add apps/web/e2e/melody-accompaniment.spec.ts apps/web/e2e/app.spec.ts && git commit --no-gpg-sign -m "test: cover backing-only chord default"`

### Task 5: Evaluate real fixtures, package evidence, and hand off the draft PR

**Files:**
- Create: `docs/superpowers/evidence/2026-09-19-chords-backing-default/README.md`
- Create: `docs/superpowers/evidence/2026-09-19-chords-backing-default/manifest.json`
- Create: `docs/superpowers/evidence/2026-09-19-chords-backing-default/audio-review/` generated Player captures
- Modify: `docs/superpowers/evidence/2026-09-19-chords-finish/pr-103-coverage.md`

**Interfaces:**
- The evidence packet records exact branch/code SHA, commands, fixture hashes/paths, source-note versus generated-backing counts, fallback spans, limitations, and non-claims.
- The audio packet contains before/after Player captures for Blackbird and bounded full-song/default evaluations for Oops and Queen; Queen’s canonical source is read from the existing data tree and no catalog file is changed.

- [x] **Step 1: Run a disposable full-song diagnostic before capture**

  With Node 22, evaluate the current and changed resolver on Blackbird, Oops, and Queen using the existing fixture/canonical paths. Record source-note count, generated chord count, fallback duration, and whether output notes contain source events.

- [x] **Step 2: Capture actual Player before/after audio**

  Run the Playwright melody scratch harness with the existing audio probe, copy only the generated Player clips and JSON summaries into the evidence packet, and record the exact test command and SHA. Do not treat symbolic counts or a browser capture as musical acceptance.

- [x] **Step 3: Run the full relevant verification**

  Run `npm run test -w @keyspilli/player-core`, `npm run test -w @keyspilli/web`, `npm run typecheck`, `npm run build`, `git diff --check`, and the focused/full Chord-mode E2E slice required by the changed tests.

- [x] **Step 4: Update the coverage packet and draft PR**

  Record the new default contract, exact local/CI evidence, the three-song limitations, and the explicit non-claims. Keep PR #103 draft; do not merge, deploy, or mutate catalog data.

- [x] **Step 5: Commit, push, and request review**

  `git add docs/superpowers/plans/2026-09-19-chords-backing-default.md docs/superpowers/evidence/2026-09-19-chords-backing-default docs/superpowers/evidence/2026-09-19-chords-finish/pr-103-coverage.md && git commit --no-gpg-sign -m "docs: record backing-only chord evaluation" && git push origin codex/finish-chords-mode`

## Self-review

- The plan changes only the existing preference, shared accompaniment resolver, Player projections, focused browser setup, and evidence packet.
- It preserves explicit Melody + accompaniment and avoids source-separation or catalog work.
- It tests all five review-focus failure modes before claiming completion.
- It leaves musical recognizability, source-role truth, physical-keyboard comfort, and overall acceptance as human review questions.
