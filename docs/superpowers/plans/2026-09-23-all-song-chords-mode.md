# All-Song Chords Mode Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` task by task. Check each work package against exact source bytes and the musical gate before promotion.

**Goal:** Every visible song has one useful, recognizable backing-only Chords arrangement based on its Advanced source, independent of the selected difficulty. A song with insufficient evidence must say so rather than present a wrong arrangement as successful.

**Architecture:** Keep the existing Advanced-data routing and player transport. Improve the common backing producer using source-supported harmony and accompaniment rhythm, with an authored chart and reliable source-role path where present. Preserve source identity through ingestion and use reviewed, fingerprinted source corrections only for cases that remain ambiguous. The Winner helper remains a pilot, not a universal rule.

**Tech Stack:** TypeScript, `@keyspilli/midi`, `@keyspilli/player-core`, Next.js player, Vitest, Playwright, Node 22 for the release-equivalent run.

**Spec:** `docs/decisions/0004-release-gates.md` (Chords backing-only interpretation), `docs/superpowers/plans/2026-09-19-chords-backing-default.md`, and the user's 23 September 2026 correction: all songs, one global Chords arrangement from Advanced, backing without the sung piano line, recognizable enough to sing over, usable by a beginner without a physical piano test.

## Current boundary, 23 September 2026

- Production health from the private loopback endpoint: healthy, SHA `661a5aa8e2a9495b503b9cb59dc8c54feb5cf660`, 2,622 visible variant rows, or 437 complete six-level song bases. The read-only database has 2,706 rows / 451 bases; 14 bases are hidden by learner or manifest policy. There are 452 Advanced artifact directories, including one unlisted artifact. Do not count that orphan as a visible song.
- Across the 451 database bases, Advanced has 548,911 notes and 38,028 stored chord events. 438 bases have only generated chord events; three have none. Only 26 bases have *any* `identitySource` notes and none have complete role labels; three have complete neutral `sourceLane` labels. The local catalogue is a different snapshot and must not be conflated with these production counts.
- Draft PR #105 at `b80f9014fc0dcd142e3a765d31ff598c6ff25c2d` routes Chords from Advanced for every difficulty, but its musically revised backing is fingerprint-gated to Winner. The other songs still use the sparse generated timeline. One-song listening acceptance does not satisfy this goal.
- A disposable whole-measure pitch-class probe of exact production Oops, Queen and Blackbird payloads recovered some local changes but also proposed unsupported or dubious sus/power chords and gaps. Existing `inferPianoHarmony` on source attack clusters also missed Winner's known C# and F# change positions. Neither algorithm is ready to become a catalogue-wide default.

## Global constraints

- Preserve the canonical repository's unrelated WIP and use isolated worktrees.
- No production mutation, catalogue rebuild, merge or deployment under the review/pilot authorization. Obtain release authorization only after a concrete candidate passes its gates.
- Never use hand, register, staff or source track name alone as proof of sung-melody ownership. Never let unknown source notes reappear as backing.
- Chord labels, audible events, guidance and practice targets must agree; unsupported passages cannot look playable while silent.
- Preserve real rests, pickups, meter/tempo changes, section transitions and endings. Avoid a fixed 4/4 pulse when source phase is unverified.
- Do not ask the beginner user for a physical keyboard test. Arrange an independent pianist or teacher for that gate.
- Check `df -h /System/Volumes/Data` before long loops; stop below 30 GiB free. Keep scratch bounded and ignored.

## Review focus

1. A mixed-role hand must not leak a vocal line into backing; test a labeled vocal note inside an L-hand stack.
2. A long stale generated chord must not cover active source harmony changes; test Oops beats 48–112.
3. A source rest must stay silent; test an intro and an N.C. span with nearby notes.
4. A meter change or pickup must not reset an invented pulse; test Queen's 2/4-to-6/8 boundary and a synthetic pickup.
5. A loop, difficulty switch or reload must keep audio, highlighted keys and practice targets on the same Advanced-derived arrangement; test Winner plus one non-Winner source.

## Work package 1: Freeze and measure the visible catalogue

**Files:** `apps/web/scripts/evaluate-all-song-chords.mts` and `apps/web/src/lib/chords-evaluation.ts` (Player-replay coverage and evaluation, with a focused test), `docs/listening-review.md` for the evaluation index.

- [x] Add a read-only command that enumerates visible song bases using the same hidden-base policy as `countSongs()`. For each Advanced source record the base ID, exact artifact hash/fingerprint, acquisition type, measures/meter, source roles, chord event count/kind, and missing-chord status. Keep song-level output local/ignored if it contains private uploads; commit only aggregate counts and safe test fixtures.
- [x] Write a fixture with one visible base, one hidden base and one unlisted artifact. Assert the command reports exactly the visible base, plus a separate hidden/orphan count. Run the focused test on Node 22.
- [x] Run the command against the current catalogue snapshot, then compare aggregate counts with a read-only production scan. Record snapshot identity; never present local counts as production counts.

**Done when:** every visible base has an exact, reproducible inventory row and hidden/orphan data is not silently counted as a shipped song. Local run: 459 visible, 5 hidden, 0 orphan, 455 generated-only, 4 without chords. The local snapshot differs from production; this does not establish musical quality.

## Work package 2: Preserve source identity for future backing decisions

**Files:** `packages/midi/src/parse.ts`, `packages/midi/src/parseXml.ts`, `packages/midi/src/types.ts`, transformation points in `packages/midi/src/simplify.ts`, and focused parser/round-trip tests. Reuse the current `identitySource` and `sourceLane` fields where their meanings fit; retain raw track/staff/voice as neutral evidence, not an inferred role.

- [ ] First write a synthetic multitrack MIDI and two-staff MusicXML test. A vocal-labeled note and an accompaniment note share pitch/onset; both source origins must survive parse, normalization, Advanced selection and serialization on one playable note, never as two simultaneous strikes of one key and never swapped; the conflicting parents leave it without a semantic role. Relabel the source as unknown and assert no vocal/accompaniment semantic claim is made.
- [ ] Trace every transformation that merges or replaces notes and record its parent IDs before implementing identity propagation. A merged event with conflicting parents must be explicitly mixed/unknown, never promoted to accompaniment.
- [ ] Implement the narrowest sidecar or note metadata path that makes those tests pass. Pin a Queen CANTO replay as a diagnostic, not a global synonym for vocals.

**Done when:** source IDs survive each transformation, conflicting lineage remains unresolved, and no current catalogue payload is silently rewritten.

## Work package 3: Build one shared backing producer

**Files:** `packages/player-core/src/accompaniment.ts`, a focused producer test, `apps/web/src/components/player/Player.tsx`, `apps/web/src/components/player/chord-practice.ts` only if target projection changes.

- [x] Create a failing producer test from the exact Oops/Queen/Blackbird development phrases and synthetic authored, labeled, unlabeled, rest, pickup and meter-change examples. The expected output is an independently checked chord/attack timeline, not the old generator's labels.
- [x] Use an authored chart for its stated coverage only. Use role-labeled accompaniment source attacks where identity is proved. For unlabelled material, admit a harmonic event only when local source evidence supports its root and quality; use source attack timing or validated measure phase, and leave ambiguous intervals unavailable. Do not copy unknown Advanced notes into `notes` or guidance.
- [x] Keep audio, labels, hand assignment, guidance and grading derived from the same realized events. A repeated bass gesture may have a separate note event, but its guidance/practice contract must include it. Keep optional Melody + accompaniment explicit.
- [x] Compare the candidate to current Chords with matched source/window/tempo/instrument/levels. The known Oops stale B5 span must change only where source evidence supports a correction; the Blackbird figure and Queen meter change must not be flattened into generic blocks. Reject a candidate that merely raises note counts or sound level.

Status, 24 September: implemented as whole-arrangement harmony labels (`packages/midi/src/harmony.ts`) and source-rhythm strikes (`resolveAccompaniment` `sourceRhythmMeasures`). They are compared by the POP909-CL reference benchmark and the catalogue gate instead of per-song listening. Unlabelled material uses every note as harmonic evidence and copies none into the backing; source-role separation is no longer required for backing-only Chords. Settings: `packages/midi/src/chords-tuning.ts`; guide: `docs/chords-tuning.md`.

**Done when:** the shared path is exercised for every eligible visible song, with exact unsupported spans reported and no silent reversion to current generated backing. It is a candidate until the musical gate passes.

## Work package 4: Whole-catalogue quality and release

**Files:** `docs/listening-review.md`, `docs/decisions/0004-release-gates.md` only if the contract genuinely changes, focused E2E in `apps/web/e2e/melody-accompaniment.spec.ts`.

- [ ] Run a bounded all-visible-song diagnostic on the exact candidate revision: audio coverage, vocal-role exclusion where labeled, chord change timing, rests, unsupported spans, register/holds/leaps, duplicate attacks, and song ending. Do not convert diagnostics into a musical score.
- [ ] Freeze at least ten complete Advanced sources across acquisition types: Winner, Oops, Blackbird, Queen, the partial Your Song chart, labeled multitrack MIDI, voice-and-piano score, sparse source, audio-derived source and an unsupported control. Keep development songs distinct from holdouts. Record exact hashes and matched A/B clips.
- [ ] Have human listeners judge complete phrases and endings for recognizability, harmonic accuracy, accompaniment rhythm and room to sing; use the existing minimum ten-song musical gate. An independent pianist/teacher checks real-keyboard span, releases, leaps and hand changes. Ask the learner only whether the guided short passage is understandable and whether the backing works for singing.
- [ ] Repair source/catalogue outliers through separately reviewed, fingerprinted changes. Rebuild only after explicit authorization and source-gate preparation. Re-run the all-song diagnostic after each batch.
- [ ] Before any merge/deploy: automatic checks, exact candidate image, backup/restore and rollback evidence, deployment SHA, representative live browser checks and post-release monitoring. A release decision must say which songs are supported, unsupported or still unreviewed; "all songs improved" requires zero unreviewed visible bases or an explicitly agreed, visible exception policy.

**Done when:** every visible base has a reviewed, musically useful backing arrangement, all release gates pass, and the user authorizes promotion. Explicitly unavailable spans are an honest interim state, not completion of the all-song goal. The Winner sing-along result alone does not close this work package.
