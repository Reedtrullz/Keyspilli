# Chords Mode Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task in the separately created implementation task. Track the checkboxes and record evidence. No subagent fan-out is necessary.

**Goal:** Make chords mode teach and play intentional piano arrangements without equating the left hand with harmony, and make practice feedback describe what it actually measures.

**Architecture:** Retain chord-source selection, absolute MIDI chord events and the existing scheduler. Resolve accompaniment into one playback/guidance result before consumers use it; replacement ownership must be explicit and independent of hand. Reuse existing chord parsing and accompaniment realization rather than introduce an arrangement framework.

**Tech Stack:** TypeScript, React/Next.js, workspace MIDI/player-core libraries, Vitest and Playwright; no new dependencies.

**Spec:** The product contract and acceptance matrix below are the implementation specification, based on the 16 September investigation in this task and the Keyspilli Obsidian project note, section “Chords-mode foundation investigation”.

## Global constraints

- Implement in an isolated `codex/` worktree based on freshly fetched `origin/main`. Preserve the canonical checkout and its WIP. The investigation checkout is `/Users/reidar/Projectos/.keyspilli-worktrees/audit-hardening`, examined at `0de9460777c583fa077ea6672e870f1e28dbf04e`; it is reference material, not the implementation base. Previously deployed main was `e1ae882fe5877b105f46814083fd290603010a7a`; verify current ancestry.
- Use `/Users/reidar/.nvm/versions/node/v22.22.3/bin` first in PATH. Read applicable AGENTS.md files. Check `df -h /System/Volumes/Data` before builds; do not begin long loops below 30 GiB free.
- No production deployment, merge, catalogue regeneration, schema migration or source rewrites. A scoped branch and draft PR are authorized implementation deliverables. Do not send Slack/email messages.
- Preserve chord-source provenance, partial-chart warnings, explicit no-chord gaps, source fallback, inversion/bass meaning, duration, transpose-once behavior, seeking and looping.
- Musical role, source instrument and assigned hand are distinct. `identitySource: vocals|guitar|other` and `sourceLane` are evidence of origin, not proof that a note is replaceable accompaniment. Do not invent confident roles from pitch, hand, or simultaneous attacks alone.
- Preserve unknown source notes by default. Do not layer replacement chords on top of unknown material and call that safe preservation: fall back to the original passage instead, with a concise explanation.
- Human playability/listening acceptance is separate from automated correctness. Never claim either without doing it.

## Product contract

1. Keep original playback available. Label it “Original arrangement” if this accurately describes the resolved data; it may already be a learner arrangement, so never imply original source performance.
2. Name the present accompaniment choice “Melody + accompaniment”. Prefer retaining melody, bass identity and riffs while replacing only explicitly owned accompaniment notes. When ownership cannot be established, preserve original playback for that passage and explain “Original passage retained — accompaniment could not be separated reliably.”
3. Offer an explicit “Bass + chords” choice for accompanying singing or another musician. This produces chord-chart accompaniment and intentionally omits the source melody inside covered passages. State that purpose beside the choice. Preserve original playback in uncovered chart gaps with an honest fallback indicator; never claim continuous generated accompaniment when coverage is partial.
4. Retain “Find the chord tones” as the forgiving practice exercise. Any octave/order is accepted; percentage means target completion. Show extra/wrong notes separately. Do not call this accuracy, held-chord performance, fingering or rhythm grading.
5. Reference voicings must identify suggested hands. A shape spread over two octaves must not be represented as a single-hand grip. MIDI note input does not reveal the physical hand used; hand guidance is a suggestion, not measured performance.
6. Both accompaniment choices use the same resolved notes, durations and hand suggestions for sound and note guidance. Harmony labels retain source meaning even if the chosen realization omits a redundant chord tone.
7. Keep settings persistence backwards compatible. Old `backgroundMode: "chord"` selects Melody + accompaniment with safe fallback; old piano settings preserve existing behavior. Invalid/missing new settings use the safe default.

## Evidence and file map

Verify callers before editing; names below are current investigation paths.

- `packages/player-core/src/engine.ts:315-322`: currently suppresses any L note covered by a chord. `:377-390` already preserves absolute MIDI voicings/durations.
- `packages/player-core/src/types.ts`, `prefs.ts`, `timeline.ts`, `views/falling.ts`: settings, scheduled events and note views.
- `packages/midi/src/types.ts`: Note has hand/sourceLane/identitySource but no authoritative general musical-role field. Avoid treating an added optional field as a solution without an actual trusted producer and consumer.
- `packages/midi/src/chords.ts`: chord symbol parsing, slash bass and compact MIDI realization. `piano-accompaniment.ts:1166` exposes `realizePianoAccompaniment`; its current limits are specifically for LH realization. Reuse where suitable, do not force its LH assumptions onto RH accompaniment.
- `apps/web/src/components/player/Player.tsx`: selected chord source, engine construction, practice targets and visual transpose integration.
- `SoundControls.tsx`: current background choice/copy. `FallingCanvas.tsx`, `ChordStrip.tsx`, `ChordPracticePanel.tsx`: player guidance and practice labels.
- `packages/player-core/src/chord-practice.ts`: pitch-class grader and reference voicing; panel currently presents completed/targets as “shape accuracy”.
- Tests: `packages/player-core/test/{engine,chord-practice,prefs}.test.ts`, `packages/midi/test/chords.test.ts`, web `chord-sources.test.ts`, `chord-practice.test.ts`, `transpose-parity.test.tsx`, `end-to-end-contract.test.ts`, `FallingCanvas.test.tsx`; browser specs under `apps/web/e2e/`.

## Task 1 — Correct the practice contract

- [x] Reproduce with an existing Vitest test: target C `[60,64,67]`; feed 61 (wrong), then 48,76,55. Completion is 100%, extra notes is 1. This is not 100% accuracy.
- [x] Rename the public snapshot property to `completionPct` across every caller/test, or preserve a compatibility alias only if a real external consumer requires it. Replace “shape accuracy” with “completed”; name the exercise “Find the chord tones”. Explain octave/order flexibility briefly.
- [x] Retain separate wrong-note and skipped counts. Ensure empty targets show a no-target state instead of a congratulatory performance score.
- [x] Add/adjust assertions equivalent to:

```ts
expect(grader.snapshot()).toMatchObject({ completed: 1, wrong: 1, completionPct: 100 });
expect(grader.finished).toBe(true);
```

- [x] Run `npm run test -w @keyspilli/player-core -- test/chord-practice.test.ts` and `npm run test -w @keyspilli/web -- src/components/player/chord-practice.test.ts`; extend the existing panel test location or add one focused panel test for visible labels.
- [x] Commit this independently reviewable correction.

Acceptance: tone discovery remains forgiving; wrong notes remain visible; nothing calls completion accuracy. No stricter grader in this release.

## Task 2 — Resolve safe accompaniment ownership

- [x] Trace source notes through selected learner arrangement, chord selection, scheduling, view conversion, hand filtering and grading. Record which existing producer, if any, can provide trustworthy replaceable-note ownership. Inspect callers of the MIDI accompaniment helpers before reusing them.
- [x] Define one small pure resolution helper in player-core (suggested `src/accompaniment.ts`) with exported types local to that module. It consumes immutable source notes, the already selected chord timeline and the selected accompaniment style; if trustworthy ownership exists, accept it explicitly. Return resolved notes, effective chord events and fallback spans/reasons for both engine and UI. No registry, factory or new dependency.
- [x] Carry stable source-note identity if ownership requires it. Do not match only MIDI pitch: repeated identical pitches at different beats are different events. If no trustworthy ownership exists, the Melody + accompaniment path falls back; do not manufacture a role detector to make a demonstration succeed.
- [x] Remove the unconditional `hand === "L"` suppression in the scheduler. Schedule the resolved result exactly once. Retain the current original-note/chord-duration conventions; avoid double rendering or double transpose.
- [x] Write engine/resolver regression fixtures before replacement logic:
  - L-tagged melody/riff with unknown role survives unchanged and receives no generated overlay.
  - Known accompaniment ownership replaces only those notes, including R-tagged accompaniment if supplied; protected L melody survives.
  - Repeated same-pitch notes outside a replacement span survive.
  - No source, unsupported chord, explicit no-chord and partial chart gaps fall back without dropped notes.
  - A note sustained across a replacement boundary has a deliberate, tested policy: preserve it and suppress conflicting generated replacement until safe, rather than cutting the sustained note or doubling it.
- [x] Run `npm run test -w @keyspilli/player-core -- test/engine.test.ts` plus the focused resolver test, and web chord-source/end-to-end contract tests.
- [x] Commit with a note explaining actual ownership availability and fallback coverage.

Acceptance: no engine branch equates L with replaceable accompaniment; adding metadata without a functioning producer does not count as role-aware replacement. Safe fallback is an acceptable and visible outcome for legacy material.

## Task 3 — Add intentional Bass + chords realization

- [x] Add a small persisted style enum (suggested `"melody-accompaniment" | "bass-chords"`) under the existing chord background setting. Normalize missing/invalid values in prefs; keep original background mode available.
- [x] Realize Bass + chords from the selected harmonic timeline using the existing parser. Place a single bass note in LH and a compact upper shape in RH. Respect slash-chord bass. Keep the chord source label/provenance separate from the inferred voicing marker.
- [x] Use a bounded set of inversions/octave placements. Suggested initial RH register: C4–C6, each simultaneous RH shape at most 12 semitones; prefer a comfortable central shape and minimum voice movement from the prior chord. Keep a playable LH bass below it. Do not force four notes when fewer preserve chord identity. Preserve altered fifths and defining thirds/sevenths where supported. Use existing helpers/constants where possible and document any conservative omission. Unsupported shapes fall back honestly.
- [x] Resolve each progression deterministically from its beginning, so seeking to a chord produces the same voicing as continuous playback. No dependence on previously sounded audio state.
- [x] In covered spans this explicit preset replaces the source passage, including melody, as described in the UI. In uncovered spans preserve original playback and indicate fallback. Handle sustained source notes at boundaries using Task 2's tested policy.
- [x] Add tests for C–F–G7–C, C/E slash bass, a minor/suspended sequence, invalid symbols, repeated chords, partial spans, and transpose near MIDI bounds. Assert valid MIDI range, suggested hand spans, bass identity, deterministic seeking and no duplicate scheduling; avoid golden fixtures that merely duplicate the algorithm.
- [x] Run focused MIDI chord, resolver, engine and prefs tests. Commit.

Acceptance: the new option is useful even when legacy source roles are unknown because the user explicitly chose a chart-based accompaniment. It is not presented as a faithful transcription.

## Task 4 — Integrate guidance and truthful controls

- [x] Wire SoundControls and Player to both styles and the shared resolution. Show concise fallback state without exposing implementation jargon. Preserve Auto/UG/generated source controls and coverage warnings.
- [x] Route generated guidance through the same resolved note events used by audio. Clearly distinguish reference/original notation if a static source score cannot reflect the generated arrangement; do not silently present it as the generated part.
- [x] Label LH/RH visual conventions accessibly, including the dim fill/stripe convention that prompted this investigation. Do not rely solely on color. Reuse current visual styling rather than redesign the player.
- [x] Use the selected reference realization for practice guidance where appropriate, but retain pitch-class completion rules. Reject the previous assumption that a two-octave reference is a compact one-hand grip; supply two-hand guidance or a smaller valid reference.
- [x] Review hand-only practice/input filters: selecting a hand must follow the resolved arrangement, not stale source assignments. Do not claim physical hand recognition from MIDI.
- [x] Extend transpose-parity/end-to-end tests to assert rendered pitches and scheduled pitches agree for both styles at nonzero transpose and after source/style changes.
- [x] Add one bounded browser flow to the existing player e2e suite: choose each style, switch source, seek, reopen persisted settings, open tone discovery, inspect labels and fallback, then repeat at 390px width and with keyboard navigation.
- [x] Commit the integrated UI.

Acceptance: a learner can tell what they are hearing, what they should play, which hand is suggested, when original notes are retained, and what their practice score means.

## Task 5 — Verify, review and hand off

- [x] Run `npm run typecheck`, `npm test`, `npm run build`. Run the relevant Playwright specs using existing scratch configuration and fixture instructions; avoid production writes and existing-data mutation. Record exact commands, result counts and failures.
- [x] Build a compact acceptance table: melody crossing hands; bass riff; slash-chord progression; dense low-register chord; partial UG chart; no available chords. Synthetic fixtures prove edge cases. Use representative available catalogue excerpts for integration without claiming a catalogue-wide musical audit.
- [x] Produce a short playable local preview or captured audio for each implemented preset if the existing runtime supports it. Inspect actual visual guidance and listen if tools permit. Mark physical-piano/human musical acceptance pending unless actually performed.
- [x] Review diff for hand/role conflation, stale note ownership, double transpose, stuck notes during mode changes, fallback coverage and score wording. Run additional tests only when fixes or unresolved evidence justify them.
- [x] Commit all scoped changes and open a draft PR if GitHub access permits. Provide before/after behavior, test evidence, remaining human acceptance and no-deploy status. If PR creation is blocked, leave a clean committed branch and report the exact blocker.
- [x] Update this plan's checkboxes and append an evidence-backed Obsidian project/daily note. Return branch/commit, PR link, preview/artifacts and fixed/deferred/blocked table.

## Explicitly deferred

- Held-chord/timed/rhythm grading: requires a separately designed note-off/held-key policy. Current release makes tone discovery honest.
- Arbitrary two-hand style generators, jazz rootless voicings, fingering prediction, ML role detection, a general ArrangementIR rewrite, bulk catalogue regeneration.
- Merge and deployment: await explicit release authorization after review.

## Educational sources

- https://online.berklee.edu/courses/berklee-keyboard-method — LH bass with RH voicings is a normal accompaniment approach.
- https://online.berklee.edu/takenote/basic-piano-voicing-techniques/ — chord identity, spacing and smooth voice leading.
- https://www.berklee.edu/berklee-today/fall-2003/contrapuntal-improvisation — musical lines are not universally assigned by hand.

These motivate the musical direction; they do not validate automatically generated arrangements. Read the current implementation before treating this plan's file locations as fixed.
