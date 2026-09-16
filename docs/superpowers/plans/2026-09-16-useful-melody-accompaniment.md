# Useful Melody + Accompaniment Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans, executing one milestone at a time. Parent review is required at the musical pilot and final integration checkpoints. Do not create new tasks or delegate unless separately authorized.

**Goal:** Selecting Melody + accompaniment produces a recognizable melody with newly generated, playable harmonic support on supported real songs, with an actionable correction path for ambiguous sources.

**Architecture:** Build a separate derived learning arrangement from an explicitly selected melodic line and existing harmonic timeline. Preserve the original song. Reuse melody selection, chord parsing and protected-note accompaniment helpers, but record which source notes and selection decisions produced the result. Runtime playback, guidance and grading consume the same derived result.

**Tech Stack:** Existing TypeScript MIDI/catalog/player-core packages, React/Next.js, Vitest and Playwright. No new model service, dependency or general-purpose arrangement framework initially.

**Spec:** The product contract, milestones and release gates in this document. Supersedes the earlier plan's acceptance of an always-fallback default.

## Product contract and boundaries

- This is an intentional simplified arrangement, not a claim to reproduce the source pianist exactly.
- Preserve a selected recognizable melodic line, including important rhythm and rests, and add harmonic support. Hand labels do not determine musical roles.
- Source accompaniment can be replaced as part of this explicitly selected derived arrangement; do not require perfect classification of every source note. Protect any explicitly selected identity/riff in addition to melody. Do not silently discard an essential hook and claim faithful melody preservation.
- Original arrangement remains available and unchanged. Bass + chords keeps its current purpose.
- Opening the mode must show the generated preview on a supported song. Selecting an unavailable mode must explain what is missing and provide a usable next action; a repeated passive warning is not the feature.
- Source/track selection, algorithmic inference and user confirmation are distinct provenance. Confidence is evidence-based, not an invented probability.
- Do not reinterpret sourceLane, identitySource, staff, highest pitch or hand as authoritative melody on its own.
- Do not infer unsupported harmony from melody alone. Preserve explicit N.C. and chart gaps.
- No mass catalogue regeneration, production changes, merge or deployment under this planning request. Implementation and release require subsequent authorization.
- Preserve canonical checkout/WIP. All tests use disposable data copies; never point upload/player test suites at canonical data. Node22 PATH: /Users/reidar/.nvm/versions/node/v22.22.3/bin. Check free disk >=30GiB before long builds.

## Known evidence and reuse points

- Player.tsx currently calls resolveAccompaniment without replaceableSourceIds; default melody-accompaniment therefore always falls back.
- packages/player-core/src/accompaniment.ts currently gives generated non-bass chord notes RH suggestions. Its upper-register shape is not a finished melody-accompaniment arranger.
- packages/midi/src/simplify.ts exports melodyOnly and contains selectEasyMelody. melodyOnly chooses the highest non-pad onset and changes durations; these are candidate selectors, not ground truth or source-preserving identity maps.
- packages/midi/src/metal-arrange.ts has MetalArrangementIR.identity and harmony. Identity can be vocals or an instrumental riff; retain that distinction.
- packages/midi/src/piano-accompaniment.ts accepts protectedNotes and excludes them from harmony inference. Reuse its low-register and note-count controls where suitable.
- packages/catalog/src/ingest.ts constructs per-variant notes.json and publishes artifacts. Validate source identity through reduction rather than adding IDs only at playback.
- Existing engine gradingNotes separation, displayChords, source provenance, timing, transpose and hand-filter tests must remain intact.

## Milestone 1 — Audit source coverage and establish musical truth

Deliverable: a read-only inventory and frozen pilot fixtures, before editing production logic.

- [x] Inventory available original sources, track/voice retention, current variants, harmonic coverage and provenance. Count song bases separately from difficulty variants. Record missing sources and unsupported formats without claiming completeness.
- [x] Select at least eight actual-song excerpts, collectively covering clean multitrack MIDI, mixed piano, MusicXML if available, tutorial import, melody crossing hands, melody below a decorative upper voice, an essential riff, slash/extended chords and a chart gap. If a category is absent, say so and add a synthetic edge fixture separately.
- [ ] Save immutable excerpt source hashes and expected melody/onset/rest selections. Inspect notation/audio to justify each selection. Uncertain examples are explicitly ambiguous rather than assigned guessed truth.
- [x] Record baseline output from current melodyOnly/selectEasyMelody and existing arranger identity. Measure selected-note recall/precision only against genuinely reviewed examples; inspect phrase continuity and false high-note jumps.
- [ ] Present 2–3 short original-versus-candidate comparisons for user musical feedback at the pilot checkpoint. Continue source plumbing/tests while feedback is pending; do not fabricate human acceptance.

Gate: concrete examples and source-availability counts exist. No numerical catalogue-wide success claim from a handful of songs.

## Milestone 2 — Produce a usable melody selection

Likely files: packages/midi/src/parse.ts, types.ts, simplify.ts; existing source metadata/arranger entry points. Add one small selector module only if it is shared by ingestion and preview.

- [ ] Retain stable source event and track/voice references where the format provides them. Map them through per-difficulty reduction, pitch shifts and splits; bind the mapping to source/variant hashes so stale references are rejected.
- [ ] Selection precedence: user-confirmed track/voice or phrase choice; explicit authored melodic voice; source-specific arranger identity; bounded inferred path. Every automatic path retains its evidence and ambiguity state.
- [ ] Adapt the existing selector into phrase-based candidate selection where the pilot demonstrates failures. Use onset strength, duration, voice continuity, range and rests together. Do not simply choose RH or highest note. Preserve selected attack/rest timing unless a declared learning simplification changes it.
- [ ] Return selected melodic events plus optional protected hook events, provenance and unresolved spans. Avoid adding a broad role taxonomy for all notes.
- [ ] Test cross-hand melody, ornament above melody, rests, unison duplicates, track ambiguity and source-reference mapping after reduction. A wrong melodic line should fail a reviewed fixture even when all notes fit the hand.

Gate: all unambiguous pilot phrases select the reviewed tune; ambiguous examples are surfaced with a correction path. Do not turn every legacy song into unavailable merely because metadata is absent.

## Milestone 3 — Generate accompaniment around the melody

Likely files: packages/midi/src/piano-accompaniment.ts, chords.ts; packages/player-core/src/accompaniment.ts and focused tests.

- [ ] Construct a separate generated arrangement from selected melody/protected identity plus the selected harmonic timeline. Use the trusted-source selection, not an arbitrary caller-supplied set of fake IDs in tests.
- [ ] Start with one simple style: sparse bass and compact sustained chord support. No arpeggio/style catalogue in this release.
- [ ] Preserve defining thirds, sevenths, suspended/altered tones and slash bass. Reuse the corrected chord-quality extraction and deterministic inversion selection.
- [ ] Choose register and hand assignment after considering melody. Keep dense intervals out of deep bass, avoid crossing/crowding the tune, use difficulty-appropriate note/span/density limits, and give melody audible dynamic priority.
- [ ] First try simpler voicings or bass-only support when a full chord conflicts; if necessary retain a clearly labeled original phrase. Do not silently change chord quality to fit a span.
- [ ] Treat overlapping protected melodic sustains separately from replaced accompaniment: a melody held across chord changes should not disable every chord. Preserve its note-off while support changes underneath. Explicitly test this.
- [ ] Resolve deterministically from the phrase/song beginning; seek/loop entry must reproduce the same voicing. Validate MIDI bounds after transpose and avoid duplicate sounding events.

Gate: real pilot excerpts have preserved recognizable tune AND newly generated support. Record generated/fallback beats and reasons. No “success” when generated support is empty.

## Milestone 4 — Persist and wire the whole product

Likely files: catalog ingest/publication validation and artifact types; Player.tsx, SoundControls.tsx, chord-practice.ts, engine.ts and view adapters.

- [ ] Persist a versioned derived arrangement or selection sidecar beside existing variants, containing source fingerprint, generator version, melody provenance and unresolved spans. Reuse existing publication/manifest validation. Keep existing notes/MIDI/XML intact unless explicitly publishing the new separate arrangement.
- [ ] Cache by source/variant fingerprint, selection, algorithm version and harmonic-source input. Changing UG/generated source must recompute support without unexpectedly changing the selected melody. No stale cache reuse.
- [ ] For old songs, generate a preview from available source on demand through the same producer; use existing worker/job handling if work exceeds a bounded request. Do not build a second browser-only inference algorithm.
- [ ] Allow track/voice audition and selection when available. Provide a clearly named “Use right-hand part” manual override where appropriate; identify that it retains a part and may include chords. Allow resetting a saved selection.
- [ ] Show inferred/user-selected status and useful availability. When only one phrase is ambiguous, identify that phrase instead of repeating a song-wide warning.
- [ ] Playback, Fall Down, Note letters, practice targets, keyboard range and hand filters consume the same generated events. Static sheet view is labeled as source notation until generated sheet export is supported.
- [ ] Selecting the mode gives an immediate preview or explicit generation progress/error. Preserve playback position across changes and cancel stale requests/audio.

Gate: browser test starts from a real published pilot artifact, selects Melody + accompaniment, and proves generated event pitches reach playback, visuals and grading. No test-only ownership injection.

## Milestone 5 — Evaluate and roll out selectively

- [ ] Run focused MIDI/catalog/player tests, typecheck, full suite and build; then isolated browser checks at desktop/390px with actual Play, source/style changes, seek, loop, transpose, LH/RH practice and reload persistence.
- [ ] Capture original-versus-derived audio and notation excerpts for each pilot category. Report melody preservation, hand span/density, accompaniment activity, fallback coverage and subjective judgments separately.
- [ ] Expand the read-only/offline evaluation to a stratified sample beyond the pilot; inspect failures before claiming wider support. Report exact numerator/denominator per import category and generator version.
- [ ] Dry-run a selective backfill for supported existing songs, showing hashes, generated metadata, success/ambiguity/failure counts and changed paths. The new producer makes this backfill useful; rerunning the old catalogue generator does not.
- [ ] Prepare a draft PR and deployment/backfill procedure with backup, rollback and small canary batch. Implementation readiness does not authorize release. Keep source files recoverable and invalidate only derived caches.
- [ ] After separately authorized deployment, verify actual public songs transform as expected. Enable the mode as a supported default only when useful coverage has been demonstrated; otherwise present it as preview with clear per-song support.

## Non-negotiable acceptance checks

1. At least six distinct real-song pilot excerpts, across at least two available import categories, render BOTH selected melody and newly generated accompaniment. Every pilot has a documented result, including ambiguous cases.
2. A melody crossing hands and one below an upper decoration survive correctly; no blanket LH deletion or RH-equals-melody rule.
3. A held melody can span a harmony change without muting all support; N.C./gaps remain explicit.
4. Cadd9, C7/E and Cmaj7/G retain defining tones and bass meaning.
5. Mode on/off produces a real, intentional difference on supported songs, with captured audio and event evidence.
6. Displayed/generated pitches and practice targets match sounding pitches after hand filtering, transpose, seeking and reload.
7. At least one ambiguous source is corrected through the UI, and the choice survives reload with provenance.
8. No canonical-data test writes. No deleted originals. No universal fallback presented as working support.
9. Parent independently reviews evidence. User musical feedback is recorded as received or explicitly pending, never inferred from CI.

## Deferred

New transcription models/stem separation, universal melody recognition, arbitrary accompaniment styles, advanced fingering, perfect polyphonic voice separation and blanket catalogue regeneration. Reconsider only when measured pilot failures justify the added work.

## Execution status — 2026-09-16

- [x] Milestone 1 inventory, source-linked pilot selection, and honest all-fallback baseline recorded. Independent notation/audio review and human melody expectations remain pending.
- [x] Milestones 2–3 producer implementation and structural edge coverage completed: cross-hand selection, sustained-line preference, ambiguity spans, held melody across harmony changes, N.C. gaps, octave-bounded collision-safe support, extended tones, and actual slash-bass lows.
- [x] Milestone 4 runtime/UI wiring completed: on-demand derived arrangement, versioned variant-bound local sidecar, actionable right-hand correction, reset/reload persistence, shared playback/display/grading inputs, and bounded preview plan.
- [ ] Milestone 4 server-published derived artifacts and harmonic-input cache are intentionally not implemented; no production mutation was authorized.
- [x] Milestone 5 focused/full tests, typecheck, build, real-artifact desktop/390px browser checks, and bounded read-only pilot dry run completed. The dry run reports `changedPaths: []`.
- [ ] Offline original-versus-derived audio/notation listening, broader stratified evaluation, production canary/backfill procedure, merge, deployment, and default enablement remain pending.
