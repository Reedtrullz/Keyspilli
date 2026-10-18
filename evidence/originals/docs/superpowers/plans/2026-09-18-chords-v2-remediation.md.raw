# Chords v2 Musical Usability Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PR100's Melody + accompaniment path musically useful and physically safer while preserving the single deterministic producer, ordinary Note stream, source provenance, and fail-closed boundaries.

**Architecture:** Extend `buildMelodyAccompaniment` rather than adding a second arrangement framework. Select between source-derived reduction and supported, phase-aware sparse backing per coherent phrase; allocate support after mandatory melody/retained events are known; keep source IDs, interval accounting, playback, guidance, grading, and role audition projected from the same events. Treat generated-note count as descriptive, never as a quota.

**Tech Stack:** Existing TypeScript, `@keyspilli/player-core`, `@keyspilli/midi`, React/Next.js, Vitest, Playwright, Node 22. No new dependency, model service, catalogue rebuild, or production mutation.

**Spec:** `docs/superpowers/plans/2026-09-17-musically-useful-chords-mode.md`; corrected audit `docs/superpowers/evidence/2026-09-18-pr100-chords-v2-skeptical-audit.md`.

## Global Constraints

- Keep original source notes, catalogue variants, source MIDI/XML, user data, and the unrelated untracked deployment report recoverable and unchanged.
- Use the existing isolated worktree and branch `codex/musically-useful-chords-mode`; do not merge, deploy, rebuild the catalogue, mutate live data, or publish production artifacts.
- Preserve the fail-closed harmony policy: only aligned authored/validated chart evidence may synthesize support; notes-derived contaminated harmony remains label-only.
- Preserve selected melody pitch, onset, duration, and velocity exactly. Support is dropped, shortened, revoiced, or classified before melody is changed.
- Do not force generated pitches, attack counts, or a difference quota. A useful source reduction or unchanged simple phrase is valid.
- A melody rest does not imply a backing rest: preserve the source/phrase rest intention, and let supported backing continue under a melody rest when that is the selected phrase candidate.
- Keep one `buildMelodyAccompaniment` producer and one ordinary Note event stream for playback, display, guidance, grading, and role audition.
- Use source hand when physically feasible; never use hand labels as melody proof; allocate support to the available hand/register or classify the phrase when no safe allocation exists.
- Distinguish written key occupancy from acoustic pedal overlap. Do not claim pedal ringing means fingers must remain depressed.
- Write tests first and watch each new regression fail before implementing its fix. Run Node 22 from `/Users/reidar/.nvm/versions/node/v22.22.3/bin`.
- Preserve and extend the full audit ledger: unsupported paths, source provenance, worker/stale results, audio/guidance/grading, extended harmony, held-note seams, and UX reset/persistence.

## Task 1: Make support hand allocation and balance role-aware

**Files:**

- Modify: `packages/player-core/src/accompaniment.ts` around `accompanimentNote`, `enforceAccompanimentSoundingLimits`, and the final event pipeline.
- Test: `packages/player-core/test/melody-accompaniment.test.ts`.
- Evidence: update the remediation evidence under `docs/superpowers/evidence/` only after tests establish the behavior.

**Interfaces:** Consume selected melody and retained-unclassified events plus source support lineage. Produce final `ArrangementEvent[]` with support assigned to `L` or `R`, preserving mandatory events and source IDs.

- [ ] Add failing tests for source-R support at Hell beat 23.5 / MIDI 91 and Oops beat 80 / MIDI 88: preserve a feasible source hand or choose the available hand/register; never blindly relabel it L. Evaluate the full held interval, overlapping support, and temporal transitions, keep a fixed assignment for the note, add a low-melody crossing case that must classify/fallback rather than move melody, and cover support-vs-support opposite-hand collisions when no melody overlaps.
- [ ] Add failing tests that support velocity is below the active local melody velocity by a bounded margin across the entire held support interval; when one held support spans loud then soft melody, use a conservative full-interval bound so the soft phrase is not overrun by the absolute cap, with no reattack added just to rebalance.
- [ ] Add a failing provenance test for allocator-only rejection: when a source-rhythm candidate is removed by the final sounding guard, realized `supportModes` must include `fallback` rather than reporting only attempted source rhythm.
- [ ] Run the focused player-core test file and record the expected failures.
- [ ] Implement the smallest allocator over the existing events: evaluate mandatory L/R notes first, retain source hand when the candidate fits the hand's sounding/span limits, try the other hand when available, and trim/classify support when neither is safe. Use one mirrored relative-order rule for opposite-hand melody crossings, add both register directions and a bounded support-vs-support collision check to tests, and keep written limits separate from pedal audio tails.
- [ ] Make generated and source support use the same allocator and melody-relative velocity policy; preserve source melody velocity and source IDs.
- [ ] Re-run focused tests, then existing sounding/held-note/same-pitch/extended-harmony tests.

## Task 2: Select a coherent phrase backing strategy

**Files:**

- Modify: `packages/player-core/src/accompaniment.ts` in source reduction, sparse support, phrase/event selection, and provenance.
- Test: `packages/player-core/test/melody-accompaniment.test.ts`.
- Reproduce: `docs/superpowers/evidence/2026-09-18-pr100-chords-v2-skeptical-audit-reproduce.ts` and its JSON output.

**Interfaces:** Consume supported harmonic events, source attack groups, selected melody/protected hooks, validated meter/phase when present, and prior voicing. Produce one chosen phrase candidate with honest `strategy`, `change`, `supportModes`, fallback spans, and exact event lineage.

- [ ] Add failing tests for an authored-chart phrase with dense source support where source reduction and sparse harmonic candidates differ; score the actual merged candidate (sparse notes plus retained/protected source notes) for attack union and occupancy, preserve only explicit reviewed bass/hook identity, carry protection across adjacent chord seams, preserve source rests, and never invent unsupported harmony.
- [ ] Add a real-fixture regression comparing the full final backing stream and attack locations against the preserved baseline/source, especially Oops `[64,108]`; every density increase must be explained by the selected candidate and protected identity, not accepted by a generated-note quota.
- [ ] Add failing tests for a simple source phrase where unchanged/source reduction remains the winner; assert no generated-note quota and no blanket “needs review”.
- [ ] Add failing tests for unsupported/generated-only harmony: preserve source/fallback and never synthesize from notes-derived contaminated chords.
- [ ] Run the focused test file and confirm the new strategy tests fail for the current “sparse only when source is empty” implementation.
- [ ] Implement one bounded phrase candidate comparison using existing source timing and sparse phase metadata. Use measured attack complexity, source identity, rest preservation, supported chord quality, hand allocation feasibility, and prior-voicing motion as deterministic tie-breaks; do not add a pattern library or blanket pulse.
- [ ] Build the merged candidate once before scoring and rendering; do not treat `sourceLane` metadata alone as reviewed hook identity, and do not regenerate a repeated sparse span with only the current event's protected set.
- [ ] Improve generated-only real controls through safer source attack reduction/correction where defensible, without synthesizing unsupported harmony. The current Oops `479/479` final/source attack-location equality remains an open regression until a real candidate changes it or the limitation is explicitly retained. An authored-only synthetic winner is a test of the selector, not a fix claim for actual Oops backing.
- [ ] Require a meaningful rhythm/reduction path for generated-only real controls when supported source timing exists; if no defensible candidate exists, retain source/fallback and state the limitation rather than claiming the authored-only synthetic test fixes the real song.
- [ ] Keep sparse harmonic support limited to validated structural attacks; carry phase across chord boundaries; allow `original`/`source-reduction`/`harmonic-backing`/`silence` honestly.
- [ ] Re-run producer tests and the exact fixture reproduction. Update evidence with before/after strategy/attack counts, not musical acceptance claims.
- [ ] Keep real-song fixture assertions in the exact evidence reproduction/checkpoint; synthetic unit cases are mechanism tests and must not be labelled as Hell/Oops musical acceptance.

## Task 3: Add phrase-local melody candidate/rest correction

**Files:**

- Modify: `apps/web/src/components/player/Player.tsx` and `apps/web/src/components/player/SoundControls.tsx`.
- Test: `apps/web/src/components/player/SoundControls.test.tsx` and relevant player tests.
- Reuse: existing `MelodyPhraseOverride`, source fingerprint validation, local storage sidecar, and reset behavior.

**Interfaces:** Consume the active `ArrangementPhrase`, source notes/IDs, source hand metadata, and source fingerprint. Produce validated local overrides for a selected source candidate or explicit rest, persisted through the existing sidecar and recomputed through the producer.

- [ ] Add failing UI tests for an active ambiguous phrase showing candidate/rest actions, applying a phrase-local override, preserving the source fingerprint, and resetting it without touching unrelated song preferences.
- [ ] Add a failing test that a stale or overlapping override remains visible as `needs-review` and does not alter the melody.
- [ ] Implement only defensible candidates: current automatic path, available source R or L candidate when present, and explicit rest; explain that either source hand may contain chords and is user-selected, not proven melody.
- [ ] Ensure the active phrase action is accessible at desktop and 390px widths, seek/loop remains available, saved selection and source changes invalidate safely, and worker requests include the updated override key.
- [ ] Preserve existing role auditions and grading projections from the recomputed result.

## Task 4: Truthful interval/UI/evaluation coverage

**Files:**

- Modify: `apps/web/src/components/player/Player.tsx`, `apps/web/src/components/player/SoundControls.tsx`, and only the smallest related tests.
- Test: `apps/web/e2e/melody-accompaniment.spec.ts` and `apps/web/src/components/player/SoundControls.test.tsx`.
- Evidence: `docs/superpowers/evidence/2026-09-18-pr100-chords-v2-skeptical-audit.md`, reproduction script/results, and a new remediation checkpoint file.

- [ ] Add failing assertions for actual phrase status: use neutral `unchanged` for unchanged/no-reason intervals, fallback only for real blocked spans, and source-reduction success not presented as generated backing. Do not treat exact equality as musical validation.
- [ ] Add failing assertions that Full/Melody/Accompaniment, audio, guidance, and grading all use the same derived event result and that no duplicate chord audio is scheduled.
- [ ] Add failing responsive/accessibility assertions for phrase-local correction, reset, stale source fingerprint, worker fallback, and retained-unclassified audition disclosure.
- [ ] Implement truthful copy/counts with explicit source-reduction, harmonic-backing, fallback, unavailable, and unchanged outcomes. Do not present attack or generated-note counts as quality scores.
- [ ] Run the targeted browser checks on disposable data only. If audio-capable tooling is unavailable, preserve human listening as pending and state that explicitly.

## Task 5: Full verification, evidence, commit, and PR handoff

**Files:**

- Update: `docs/superpowers/evidence/` checkpoint/report files and the SDD ledger.
- No production/catalogue files or live systems.

- [ ] Re-run the disk guard and Node 22 checks.
- [ ] Run focused MIDI/player/web tests, typechecks, web build, the exact fixture reproduction, and the relevant disposable Playwright flow. Use existing CI evidence for unchanged areas but verify the final diff.
- [ ] Inspect complete current candidate Oops and Blackbird phrase captures where supported. Treat hashes/event counts as integrity only; record listening as pending if no audio-capable review is available.
- [ ] Run `git diff --check`, inspect `git status`, and review the complete diff against the corrected audit and this plan.
- [ ] Commit scoped implementation/evidence changes on `codex/musically-useful-chords-mode`, push the branch, and update the draft PR only after fresh verification. Do not merge/deploy/rebuild/mutate production.
- [ ] Record fixed, tested, disproven, or blocked status for every audit finding and preserve unsupported-source/manual-correction limits; do not present the authored-only synthetic selector case as a fix for actual Oops backing.
