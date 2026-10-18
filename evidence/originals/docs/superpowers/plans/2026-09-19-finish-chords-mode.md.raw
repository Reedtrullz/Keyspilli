# Finished Chord Mode Completion Plan

> Completion contract and implementation sequence; supersedes the earlier four-step review recommendation. Execute using the existing Luna task with parent review. This document does not authorize a production deployment.

**Goal:** Deliver an automatic melody-plus-accompaniment learning mode that is understandable, musically useful and demonstrably playable at a stated tempo on the acceptance repertoire, with honest conservative handling of unsupported sources.

**Architecture:** Preserve the single arrangement producer and derived Note stream. Complete the source-to-player timing path, improve source-backed reduction where evidence supports it, then simplify the controls around the realized result. Do not create a second engine or invent musical evidence to unlock a branch.

**Tech stack:** Existing TypeScript, React, player-core, MIDI types, Vitest and Playwright, Node22.

**Inputs:** Parent Obsidian review `Chord mode usability review 19-09-2026.md`; Luna report `/Users/reidar/.codex/worktrees/a1f8/Keyspilli/docs/reviews/2026-09-19-chord-mode-deployed-audit.md`; reviewed main881881b8f9b9f8bc75f70dd4d6a551de6e62de6e.

## What finished means

- One ordinary action enables melody + accompaniment. No source selection, phrase correction or hidden saved override is required on acceptance songs.
- Recognizable melody, useful simpler backing, and coherent transitions are verified over whole arrangements, not selected successful clips.
- A declared practice tempo accompanies physical-playability acceptance; full-speed claims require full-speed checks. Supported does not mean universally beginner-friendly.
- Oops I Did It Again, Blackbird and Somebody To Love are required user-regression songs. Add Your Song for partial authored-chart coverage and one genuinely unsupported source as a negative control. Pin exact song IDs, variants and source hashes before implementation. Do not substitute an easier variant silently.
- Unchanged simple passages are valid; unchanged difficult backing, blanket fallback, manual overrides, volume-only changes and passing CI cannot satisfy the musical improvement gate.
- Unsupported material remains audible as Original with a concise honest status. It is a handled boundary, not a successful simplified arrangement.
- If a required song cannot pass because its source is inadequate, investigate/repair the bounded source or report the specific remaining blocker. Do not close the round as finished by reclassifying the target song unsupported.

## Constraints

- Preserve canonical WIP, source artifacts, user settings and rollback evidence. Isolated implementation branch from current main.
- Node22; check free disk >=30GiB before build/test loops. Disposable browser data. No new dependencies without demonstrated need.
- Source hand is not melody truth. Time signature is not downbeat proof. Generated chord labels are not validated harmonic evidence.
- Preserve the protected melody unless a separately reviewed source correction establishes why it is wrong. Do not silently simplify melody to pass a backing test.
- No catalogue-wide rebuild, source mutation, merge or deployment implicitly follows this planning task. If a bounded source repair is needed, make it reviewable and preserve its original.

## Review focus

1. Pickup/unknown meter or partial chart: never fabricate phase or harmonic coverage.
2. Retained/generated seams, melody rests and long held notes: no lost hooks, doubled attacks or arbitrary interruptions.
3. Rapid toggle/seek/loop/source changes during worker computation: no stale arrangement, lingering preview, gain reset or wrong grading targets.
4. Existing saved overrides, song/variant switches and reset: preserve data and expose the actual selected configuration.
5. Dense retained melody, wide consecutive jumps and fast repetitions: do not certify playability from simultaneous span alone.

## Stage 1 — Freeze evidence and remove source blockers first

Files: existing source fixtures and evidence under docs/superpowers/evidence; apps/web/src/components/player/chord-sources.ts; player source-loading path; packages/midi/src/types.ts if validated metadata is missing.

- [ ] Pin the five controls above, current Original output, source fingerprint, timing provenance, chart coverage and melody identity risks. Inspect complete song timelines and all fallback boundaries.
- [ ] Determine exactly which source artifact establishes downbeat/pickup, melody identity, rests and harmony for each target. Reuse available metadata only after verifying its meaning.
- [ ] Add the smallest missing source contract for validated phase; unknown stays unknown. Carry fingerprint/version so stale source information invalidates derived results.
- [ ] For source-only songs, implement a defensible reduction path that can reduce unnecessary attack complexity while preserving identified hooks/rests, or obtain a bounded validated source. Do not require the learner to annotate notes for routine use.
- [ ] Gate: required songs have a concrete automatic path to the musical goal. Missing evidence is tracked as remaining work, not deferred behind UI warnings.

## Stage 2 — Complete and verify the musical path

Files: packages/player-core/src/accompaniment.ts; packages/player-core/test/melody-accompaniment.test.ts; apps/web/src/components/player/Player.tsx; apps/web/src/workers/melody-accompaniment.worker.ts.

- [ ] Add regressions for real player timing delivery, pickup/unknown provenance and sync/worker parity before changing those paths. Include timing/source changes in request keys and memo dependencies.
- [ ] Exercise competition between source reduction and sparse support through the player with validated evidence; retain simple source passages when they already work.
- [ ] Check strategy consistency across adjacent measures and source/generated boundaries, held bass/hook continuity, explicit rests and no duplicate attacks. Avoid switching strategy every tiny processing interval.
- [ ] Add bounded target-tempo checks for repetitions and consecutive hand movement alongside existing occupancy/span checks. Treat diagnostics as risk detection, not proof of fingering.
- [ ] Verify melody prominence under synth, sampled piano and organ; relative MIDI velocity is not an instrument-independent loudness guarantee. Preserve manual hand gains and intentional organ timbre.
- [ ] Gate: current automatic output is musically plausible across complete controls, source truth is preserved and known mechanical defects are fixed. Tests alone do not close listening/playing acceptance.

## Stage 3 — Build the simple everyday experience

Files: apps/web/src/components/player/SoundControls.tsx; Player.tsx; corresponding component tests and globals.css only where needed.

- [ ] Default surface: Original/Chord choice, one honest result summary and Compare Original. Keep normal instrument, hand volume and pedal controls readily accessible.
- [ ] Advanced disclosure contains review/correction/source options. Bass + chords remains a separately explained accompaniment-for-singing choice, not a required decision or silent default that removes melody.
- [ ] Classify final outcomes separately: backing reduction, balance-only adjustment, partial retention, unchanged and unavailable. Counts/provenance stay in details. No unsupported 'generated' or 'corrected melody' promise.
- [ ] Label physical hand buses accurately. Show when saved arrangement choices are active; provide a clearly scoped reset. Preserve old settings instead of silently erasing them or letting hidden legacy settings override the normal experience.
- [ ] Group issues into readable measure passages and pin the editing target; keep exact intervals and fingerprints underneath. Add next/previous issue, loop and revert without introducing a general score editor.
- [ ] Gate: fresh and returning users can enable and compare without technical decisions. Keyboard, narrow-screen and zoom flows stay usable and transport does not jump.

## Stage 4 — Reliable comparison and consistent learning behavior

Files: Player.tsx preview/transport paths; existing engine projection tests; apps/web/e2e/melody-accompaniment.spec.ts; inspect DownloadDialog.tsx and sheet/practice paths.

- [ ] Compare the same selected loop or readable passage with identical instrument/speed/transpose/mix. Restore the prior playhead, loop and playback state predictably; do not persist temporary A/B state as a song preference.
- [ ] Remove generic C-major fallback from arrangement preview. Intentional rests stay silent. Separate instrument sound tests.
- [ ] Verify cancellation on mode/source/song/instrument changes, rapid toggles and worker failures. Ensure no stale or duplicate notes survive transitions.
- [ ] Assert audio, falling notes, note labels, hand filtering, guidance and grading use the same active arrangement. Inspect sheet/download behavior: implement consistent derived output where already supported or label Original exports/views explicitly; never silently present Original material as the Chord arrangement.
- [ ] Gate: a user can hear, see and practise the same notes, and comparison cannot mislead them about the song.

## Stage 5 — Full-song musical acceptance and final review

- [ ] Run full-song structural checks for all required controls, recording source/derived fingerprints, arrangement coverage, unresolved regions and every fallback transition. Do not cherry-pick windows or use a generated-note quota.
- [ ] Prepare reproducible Original/Chord comparisons of complete arrangements, with targeted loops at the most difficult sections and every strategy transition. No mandatory technical settings for the reviewer.
- [ ] Listen for recognizable melody, appropriate harmony, useful coherent backing, preserved rests/hooks, clean seams and instrument balance; evaluate pedal on/off where relevant.
- [ ] Obtain keyboard playability review at declared tempos for required songs; record comfortable/uncomfortable passages explicitly. User review asks only musical questions, not source IDs or internal settings.
- [ ] Fix reported failures and repeat affected acceptance checks; do not replace the review with another 'preview available' handoff. Two failed melody iterations trigger source investigation instead of further blind heuristic tuning.
- [ ] Parent reviews the entire final diff and finding ledger. Each item is fixed/verified, disproven with evidence, or an explicit blocker. No open defect preventing the required default experience may be called complete.
- [ ] Run relevant workspace tests/typechecks/build and focused real-player E2E on the final tree. Retain PR101 layout and PR102 gain regressions. Record exact commit and evidence limitations.

## Stage 6 — Release closure when authorized

- [ ] Publish the reviewed PR and honest acceptance record. Merge/deploy only under explicit release authorization.
- [ ] Fresh backup and restore validation, rollback image/config and disk/pull headroom precede the existing immutable deployment path.
- [ ] Verify actual deployed SHA, runtime health, normal Chord enable/compare flow and representative target-song output on production. CI is not deployment proof.
- [ ] Close only after engineering, musical acceptance and authorized live verification are separately recorded. If human playing/listening is pending, say exactly that; do not claim the whole feature finished.

## Deliberate exclusions

No universal music-transcription claim, automatic perfect fingering, style library, new AI service or catalogue-wide rebuild. These exclusions do not excuse failures on the declared acceptance repertoire or weaken source safety.
