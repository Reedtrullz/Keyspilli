# Finished Chords Mode Implementation Plan

> **For agentic workers:** Use executing-plans for implementation and independent parent review at each gate. The user explicitly authorized this plan followed by Luna execution; no further planning approval is required.

**Goal:** Finish automatic Melody + accompaniment for the declared acceptance repertoire, with simple controls, reliable comparison and honest unsupported-source behavior.

**Architecture:** Extend the existing single producer and ordinary Note stream. Investigate source provenance before enabling timing or rhythm changes. Keep runtime ownership in one implementation task; use a second Luna task for independent source evidence and acceptance review, not overlapping code edits.

**Tech Stack:** Existing TypeScript, React/Next, Vitest, Playwright, Node22. No new service or dependency.

**Spec:** `docs/superpowers/plans/2026-09-19-finish-chords-mode.md` (completion contract; read in full). Prior audit: `/Users/reidar/.codex/worktrees/a1f8/Keyspilli/docs/reviews/2026-09-19-chord-mode-deployed-audit.md`.

## Global constraints

- Baseline main `881881b8f9b9f8bc75f70dd4d6a551de6e62de6e`; implementation directory `/Users/reidar/.codex/worktrees/finish-chords-mode/Keyspilli`, branch `codex/finish-chords-mode`.
- Preserve all canonical and older worktree WIP. All browser test databases/artifacts are disposable; do not point test seeders at production or canonical data.
- Node `/Users/reidar/.nvm/versions/node/v22.22.3/bin`; check disk >=30GiB before heavy work. No unbounded temporary outputs or automatic cleanup of others' files.
- Implement, verify, commit, push and create/update draft PR. No merge/deploy/catalogue-wide rebuild or production mutation in this authorization. Read-only source investigation is allowed; SSH must use IdentitiesOnly=yes and never log secrets.
- No hand-label-as-melody proof, fabricated downbeat, contaminated inferred-harmony promotion, change quota or human acceptance fabricated from test results.
- Unknown-source Original fallback is correct handling, but not evidence that required target songs are finished. Manual fixes in browser settings cannot satisfy automatic-default acceptance.
- Engineering continues while human review is pending. If source evidence blocks musical work, finish independent UI/transport work and document the specific blocker; do not call the feature complete.

## Ownership and gates

Primary Luna owns all implementation, tests and integration. Evidence Luna writes only its own report/packet and reviews fixed commits; it must not edit the implementation worktree. Parent resolves evidence disputes and verifies changes.

G1: source contract and feasible automatic path for targets. G2: producer/player integration and complete-song structural evidence. G3: default UX, A/B and consistent practice behavior. G4: final diff, all finding coverage, musical packet and actual acceptance. A failed gate is remaining work, not a reason to relabel the target unsupported.

## Review focus

1. Pickup and unknown/partial chart coverage → T1/T2 tests retain unknown provenance.
2. Melody rests, held hooks and strategy seams → T3 complete-song checks and seam fixtures.
3. Rapid seek/toggle while workers or A/B are active → T2/T5 latest-result and cancellation E2E.
4. Saved legacy preferences and song/variant changes → T4 migration/reset tests, no silent reset of mix.
5. Dense mandatory notes and tempo-dependent jumps → T3 diagnostic cases and T7 keyboard gate.

## Commands and verification discipline

Run from the implementation root with Node22 on PATH:

```sh
export PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH
df -h /System/Volumes/Data
node --version
npm ci
npm run test -w @keyspilli/player-core -- test/melody-accompaniment.test.ts test/engine.test.ts
npm run test -w @keyspilli/web -- src/components/player/SoundControls.test.tsx
```

Capture baseline failures before edits, distinguishing missing fixture/config from actual defects. Investigate deterministic failures; do not repeatedly rerun an unchanged full suite. Use existing installed dependencies only if they are valid for this worktree's lockfile; no mutation through shared node_modules symlinks.

For each task: add focused regression, observe its expected failure, implement minimal shared fix, run the relevant check, inspect diff, checkpoint scoped files. Parent/evidence review consumes exact commit SHA and report. Broaden once at T7, and again only after changes warrant it.

## T1 — Freeze full-song evidence and source contracts

**Files:** create `docs/superpowers/evidence/2026-09-19-chords-finish/manifest.json`, `findings.md`, `source-contract.md`; reuse frozen fixtures under `2026-09-17-chords-v2-fixtures` and existing capture tools. Read `packages/midi/src/types.ts`, `apps/web/src/lib/catalog-api.ts`, `apps/web/src/components/player/chord-sources.ts`, source import/normalization callers identified there.

**Interface:** manifest records exact song ID/variant, source file hashes, baseline SHA, original note/chord files, tempo, timing evidence, melody/harmony evidence, and decision/blocker. No empty acceptance cells interpreted as pass.

- [ ] Primary starts baseline checks; evidence Luna independently identifies source feasibility. Pin Oops advanced `britney-spears-oops-i-did-it-again-a`, exact Blackbird variant from previous accepted control, Queen Somebody To Love advanced108BPM from user's clip, Your Song `the-theorist-elton-john-your-song-piano-cover-jz6ugvghbt8-a`, and one clearly unsupported-source negative control. Resolve ambiguous IDs from catalogue records, not guessed slugs.
- [ ] Preserve complete originals and inspect all measures, chart coverage, melody/rest ambiguities and source/generated transition boundaries. Record missing data explicitly.
- [ ] Trace whether measure boundaries were authored or generated arithmetically; establish pickup/downbeat evidence. A timeSig tuple alone cannot be marked validated.
- [ ] Agree minimal source metadata transport at G1. If existing artifacts cannot support a target, investigate existing original MIDI/XML/score and make a bounded source repair reviewable. Do not make user annotation a prerequisite. Do not insert per-song exceptions into the general algorithm merely to satisfy tests.
- [ ] Write `findings.md` rows for every parent/Luna audit finding, owning task, check and unresolved limit. Retain original reports as history; do not overwrite their results.

## T2 — Wire verified timing through every player path

**Files:** `packages/midi/src/types.ts` only if transport requires it; actual loader found in T1; `Player.tsx`, `melody-accompaniment.worker.ts`, `packages/player-core/src/accompaniment.ts`; existing tests plus `apps/web/e2e/melody-accompaniment.spec.ts`.

**Interfaces:** reuse `SparseBackingTiming { timeSig, measureStartBeat, provenance }` and `MelodyAccompanimentOptions.sparseBackingTiming`. Resolve from source metadata once; pass identical immutable options to sync/worker; include timing and its provenance/fingerprint in request key. Absent evidence returns undefined. Do not create a second arrangement builder.

- [ ] Add pickup, unknown, changed timing and sync/worker parity regressions. Use existing producer test helpers; exercise source-backed player fixture as well.

```ts
it("does not invent validated meter from an absent timing option", () => {
  const notes = [note(72, 0, 2, 100, "R"), note(48, 0, .5, 65, "L")];
  const chords = [chord(0, "C", 2)];
  expect(build(notes, chords, "automatic", 2)).toEqual(
    build(notes, chords, "automatic", 2,
      { timeSig: [4, 4], measureStartBeat: 0, provenance: "unknown" }));
});
```

- [ ] Implement source validation at its ingestion boundary. Reject nonfinite phase, invalid signature, source mismatch and unsupported provenance rather than silently coercing.
- [ ] Pass validated option in both current Player build sites, request key and memo dependencies. Verify delayed old worker response is discarded after timing/source changes.
- [ ] Inspect actual output events/attacks in browser trace: a dense supported case can select sparse, an already simple source stays simple, unknown source stays conservative.
- [ ] Gate G1/G2 review: timing branch is exercised from the real loader/player, not only a synthetic producer call.

## T3 — Useful automatic reduction, coherent rhythm and mechanical safety

**Files:** `packages/player-core/src/accompaniment.ts`, `packages/player-core/test/melody-accompaniment.test.ts`, frozen fixture evaluation script under the new evidence directory. Change source normalization only where T1 proves a source defect.

**Interface:** existing `buildMelodyAccompaniment` → `MelodyAccompanimentResolution` remains authoritative for all consumers. Preserve source IDs, selected melody and realized provenance. Add target-tempo diagnostic input only when needed; keep written occupancy distinct from acoustic pedal tails.

- [ ] Reproduce real full-song shortcomings before tuning. Record regions with unnecessarily repeated backing, source-retained dense melody, large sequential jumps and all transition seams.
- [ ] Correct melody/rest selection from defensible source evidence; after two failed melody iterations investigate source identity rather than continuing heuristic guesses. No right-hand shortcut asserted as semantic truth.
- [ ] Improve source-backed reduction where identified non-hook repeats can be removed safely; compare source and sparse candidates over coherent spans. Carry bass/hooks/rests and voicing across adjacent boundaries. Never delete rhythm simply to meet an attack quota.
- [ ] Add exact regression cases for long held melody over chord change, melody rest with continuing backing, retained-to-generated-to-retained seams, one support note spanning soft/loud melody, high R support and low L melody, and disjoint large hand movement at declared tempo.
- [ ] Evaluate final allocated events, not the pre-allocation candidate. If mandatory notes exceed physical constraints, report the problem honestly and fix the source/selection where justified; don't certify the remaining stream as playable.
- [ ] Check synth, Grand Piano and Cathedral/Rock balance using actual engine outputs. Relative velocity may be nearly flat in organ; measure/listen before any gain change, keep hand sliders authoritative and preserve intentional timbre.
- [ ] G2 packet: full-song before/after structural summaries, worst passages, exact hashes, and remaining musical questions. Generated-note counts and waveform hashes are integrity/descriptive evidence only.

## T4 — Simple controls, truthful outcomes and saved-state behavior

**Files:** `SoundControls.tsx`, `SoundControls.test.tsx`, `Player.tsx`, `globals.css` only as needed; existing preference helpers/callers.

**Interface:** default mode remains melody-accompaniment. Render concise status from final events/change summary, never selected source alone. Keep existing callbacks and one Advanced disclosure; don't add a configuration framework.

- [ ] Default visible actions: Original/Chord, short result summary, Compare Original, ordinary instrument/gain/pedal controls. Hide technical provenance, source selection, melody correction and role auditions inside Advanced. Bass+chords stays optional and explicitly says it omits melody for accompanying singing.
- [ ] Add component/browser assertions that ordinary controls precede advanced choices, Advanced is closed on fresh entry, keyboard disclosure works and warnings do not expand the transport.
- [ ] Distinguish reduction, balance-only, partly retained, unchanged, unavailable/pending. A generated chord label is not generated backing; user-selected melody is not validated melody. Long beat lists stay in diagnostics.
- [ ] Physical hand gain labels describe their actual routing. Keep input-volume meaning clear; do not reroute role audio just to match old labels.
- [ ] Preserve saved choices; show an unobtrusive modified indicator with explicit scope. Reset this song's arrangement choices predictably without erasing instrument or mix. Avoid hidden global chord source overriding the default: migrate or disclose it with tests for old storage and variant switching.
- [ ] Group adjacent problems by readable measures, pin selection during edit, and add next/previous/loop/revert. A grouped UI interval must still apply overrides only to explicitly selected underlying intervals, preserving unrelated overrides and fingerprints.
- [ ] Check 390x844, 926x390,1550x560 and 200% zoom, focus restoration and accessible status announcements. Retain PR101 geometry regression.

## T5 — Same-passage A/B without transport surprises

**Files:** `Player.tsx`, existing preview/engine tests, `apps/web/e2e/melody-accompaniment.spec.ts`.

**Interface:** comparison uses existing loop when present, otherwise a readable current measure span. Both sides use identical start/end, speed, transpose, hand filter and sound settings. Temporary comparison does not write persistent preferences. Reuse engine scheduling and cancelAll rather than a second audio engine.

- [ ] Add regressions: an intentional empty window schedules zero notes; Original and Chord preview share bounds; comparison stops on navigation, mode change or new preview; prior loop/playhead/play state restores deterministically.
- [ ] Remove hard-coded60/64/67 fallback from arrangement preview. Any instrument test remains separately labelled.
- [ ] Show which side is playing; provide stop/repeat. No cumulative playhead drift or duplicate note scheduling across rapid alternating clicks.
- [ ] Filtered role audition remains advanced and warns about retained-unclassified notes. Actual arrangement stream remains the source for full preview.
- [ ] Test failed/pending worker, repeated A/B with pedal tails, seek while previewing and instrument switch with100/100 gains. Retain PR102 graph regression.

## T6 — Consistent practice, sheet and export contracts

**Files:** `Player.tsx`, `DownloadDialog.tsx`, `packages/player-core/src/engine.ts` only for verified projection bugs; existing grading/guidance/render tests.

- [ ] Trace derived events through playback, falling notes, labels, hand filtering, guidance and grading. Add one end-to-end fixture that would fail if any path grades or displays Original while Chord audio plays.
- [ ] Inspect current sheet/export endpoints. Minimum supported contract: downloads and sheet views that still use stored Original say so explicitly while Chord mode is selected. Do not build new engraving/export infrastructure for this round.
- [ ] Verify speed/transpose/source/mode changes update all projections together, cancel stale previews and preserve gain state. Test both small sync and large worker arrangements.
- [ ] G3 parent review covers actual geometry, accessibility and audio scheduling evidence, not only snapshots or labels.

## T7 — Complete verification, musical review and honest PR

**Files:** new evidence directory manifest/findings and capture packet; relevant tests; PR description.

- [ ] Run final focused checks, then `npm test`, `npm run typecheck`, `npm run build` with Node22. Use existing scratch Playwright config with all required local fixtures explicitly seeded; missing fixture404 is not silently ignored or treated as feature failure.
- [ ] Run full-song structural evaluation for every required variant. Include unchanged sections and all seams. Add one source outside development controls to catch overly tailored behavior.
- [ ] Capture repeatable complete Original/Chord examples at declared tempos, plus useful difficult-section loops. Give the user only musical questions: melody recognizable, backing useful, balance clear, comfortable to play. Do not ask for source IDs, hand annotation or testing every advanced option.
- [ ] Record listening and physical keyboard judgments separately. Continue all independent engineering while waiting. Any needed reviewer input is a precise playable comparison, not an open-ended debug request.
- [ ] Evidence Luna audits a frozen final commit and packet; parent independently verifies severe findings and corrections. Full ledger maps every audit/completion requirement to fixed/tested, disproven, or actual blocker.
- [ ] `git diff --check`, scoped commit/push, draft PR with exact tests/limits and links to evidence. Never claim finished musical acceptance if a required song remains unresolved, even when all CI passes.
- [ ] Report engineering readiness, listening acceptance and physical acceptance separately. Release work follows explicit merge/deploy authorization with backup/restore, rollback and actual live-flow verification from the completion contract.

## Sequence and continuation

Primary executes T1 baseline while evidence Luna investigates G1, then T2/T3 when evidence is usable. T4/T5/T6 can proceed independently if source evidence is still under investigation; keep runtime edits with the primary. Parent checks G1–G4 and resumes stopped safe work. Do not stop at a plan, at green unit tests or at a preview packet when authorized engineering remains. User acceptance cannot be fabricated or bypassed; provide review-ready audio/UI when genuinely required.
