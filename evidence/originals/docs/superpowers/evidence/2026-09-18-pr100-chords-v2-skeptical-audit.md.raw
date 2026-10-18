# PR100 / Chords v2 skeptical audit

## Review boundary

- Reviewed PR #100 at exact head `a7087b1e5c3862a31abee66cd536330ac5c4a321`.
- Base reviewed: `main` at `89f4ce7d547f765d70691b3712fc500745a97b45`.
- Diff size: 89 files, 162,025 insertions, 244 deletions. The large addition is mostly fixtures, captures, and evidence; this review still traced the production path end to end.
- Worktree: `codex/musically-useful-chords-mode`.
- Node runtime used for fresh producer checks: Node `v22.22.3`.
- No runtime, API, catalogue, deployment, merge, or source-artifact changes were made during this audit. The pre-existing untracked deployment evidence file was left untouched. This report is preserved as an audit snapshot; the later Task 5 evidence and finding ledger are recorded separately.

## Executive verdict

The implementation is a defensible conservative engineering prototype, but it is not a completed solution to the stated goal: “a recognizable melody with noticeably simpler, musically coherent and physically playable accompaniment.” It improves provenance, fail-closed behavior, exact change accounting, and written-event collision limits. On the three current real-song controls, the default `auto` path produces zero newly generated backing notes and uses source-derived reduction or fallback only. That is allowed by the plan: a useful source reduction or an already-simple passage need not add new pitches. The unresolved issue is that the current evidence does not show either a musically useful source-reduction phrase or a competing sparse phrase strategy being selected and reviewed.

Engineering CI and parent code review are complete, but G2, G3, and G4 are not passed. The correct status is experimental / musical listening pending, not musically accepted or release-ready.

## Four direct answers

| Question | Answer |
|---|---|
| Does it solve the original goal? | Partially. It preserves melody candidates and can reduce source density, but the current default controls do not produce generated harmonic support, do not prove correct melody identity, and do not establish a simpler phrase-level backing strategy. |
| Does the output sound good? | Not assessed here. I did not audition the WebM/audio captures through a supported audio-listening path during this audit. Waveform, duration, hash, event-count, and PCM comparisons are not listening evidence. |
| Does it make musical sense? | The safety and accounting decisions make sense; the current real-song output is mostly source-note thinning with source timing, not a demonstrated harmonic arrangement. Musical usefulness remains unproven. |
| Is it human-playable? | Not established. Written-event limits cap some overlap, but there is no available-hand allocator, no tempo/repeated-attack acceptance, no pedal-aware sounding budget, no fingering claim, and no human playability rating. |

## Verification performed

I independently:

1. Read the original useful-melody plan and the Chords v2 plan, including T1–T9, G1–G4, the playability constraints, and the definition of done.
2. Inspected the full `main..a7087b1` inventory and traced the source fixture → chord-source resolver → Player → synchronous/worker producer → ordinary note stream → playback/guidance/grading/role audition path.
3. Recomputed the current Player-equivalent path against the frozen Blackbird, Oops, and Hell fixtures. The run used `resolveChordSources(...).auto`, `harmonicSupport: "authored-only"`, automatic melody selection, `allowRests: true`, and `soundingPolicy: "coherent-phrase"`.
4. Ran focused tests read-only:
   - `@keyspilli/player-core`: 64/64 passed for melody-accompaniment and arrangement-change tests.
   - `@keyspilli/midi`: 13/13 passed for piano-role tests.
5. Inspected existing capture/evaluation packets. No human musical ratings were treated as present. Exact current-head CI `35346537439` and container/tutorial verification `35346537440` passed; the parent independently completed the engineering handoff review. Those are engineering results, not musical acceptance.

### Current real-fixture result

| Fixture | Source notes / chart events | Output notes | Melody / source-support / generated notes | Fallback beats / duration | Support modes |
|---|---:|---:|---:|---:|---|
| Blackbird | 1,069 / 68 | 1,025 | 554 / 416 / **0** | 60.375 / 296 | `source-rhythm`, `fallback` |
| Oops | 1,891 / 74 | 1,298 | 583 / 466 / **0** | 123.875 / 336 | `source-rhythm`, `fallback` |
| Hell | 1,130 / 103 | 1,085 | 538 / 418 / **0** | 96.375 / 352 | `source-rhythm`, `fallback` |

The `auto` sources are labelled Generated fallback and contain notes-derived chord events, but there is no UG/authored timeline in these three fixtures. The runtime policy correctly treats that source as label-only for generated harmonic playback. The displayed chord metadata therefore must not be read as audible generated accompaniment.

Fallback and review durations are accounting results, not musical-quality scores. Current fresh unresolved melody spans are 25 / 38.125 beats for Blackbird, 55 / 50.375 beats for Oops, and 63 / 60.5 beats for Hell.

## Pipeline trace and key observations

1. `resolveChordSources` normalizes the fixture bundle. `melodyHarmonicSupportPolicy("auto")` returns `authored-only`; notes-derived generated events are not allowed to synthesize support in Melody + accompaniment mode.
2. `Player.tsx` sends the same options to sync or worker execution. The large-input worker threshold and stale request-key checks are structurally sound.
3. `splitPianoRoles` runs a generic Viterbi-like candidate path over onset groups. It uses pitch/context/velocity/duration/continuity and an opt-in rest state, but the fixture has no semantic melody gold and no source-note identity from `chordsAt` that can prove the selected path.
4. `reduceSourceSupport` caps each source onset at up to three tones and collapses only exact repeated stacks. It intentionally retains the source attack grid; it is not a phrase-level rhythmic candidate selector.
5. Sparse generated support is only appended when both `reducedSupport` and `sourceSupport` are empty. A source-support phrase therefore cannot compare source reduction against sparse harmonic backing.
6. `accompanimentNote` assigns every retained/generated support note to `hand: "L"` and applies a fixed velocity cap of 70. No support allocator chooses the available hand or a playable register for support.
7. `enforceAccompanimentSoundingLimits` enforces written-event limits by existing hand: at most three sounding notes and a 12-semitone span, preserving melody and retained-unclassified events while trimming accompaniment. It does not model pedal tails or optimize repeated attacks/fingering.
8. Player Melody + accompaniment uses the ordinary note stream and does not schedule a second `playChord` stream. Guidance is the derived event projection filtered only by the selected L/R hand, and role audition explicitly includes retained-unclassified notes rather than pretending to provide an isolated stem.
9. The UI offers Automatic melody and whole-part Use right-hand part. Phrase overrides are accepted and persisted by the producer/storage contract, but this UI does not provide a phrase-level candidate/rest editor.

## Severity-ranked findings

### P1 — No competing phrase strategy is exercised on the current real controls

All three current real controls produce `generatedNoteCount: 0` and `generatedBeats: 0`. That is not, by itself, a failure: the plan explicitly permits source reduction or an unchanged simple passage to win. The finding is that every current control takes the source-support/fallback route, so the implementation does not exercise a competing sparse phrase candidate whose rhythm and usefulness can be compared against source reduction.

Root cause:

- `auto` is `authored-only` for harmonic synthesis.
- `reduceSourceSupport` succeeds whenever source support exists.
- Sparse support is gated behind `sourceSupport.length === 0` and `reducedSupport.length === 0`.
- Melody-mode Player integration sets `audioChords` to an empty list; only the ordinary derived Note stream is audible.

Consequence: the current real-song candidate can claim source reduction only where source events were reduced; it cannot claim that a sparse harmonic alternative was evaluated or that displayed generated chord metadata became audible support. Whether the source reduction itself is musically useful remains a listening question.

Smallest architectural fix: keep the single producer, but make source reduction and sparse harmonic backing actual competing phrase candidates when harmony is supported. For the three current controls, either supply a validated authored/UG chart or honestly classify the result as source-reduction/partial. Do not use a generated label or displayed chord voicing as proof of audible support.

### P1 — The current evidence does not establish a useful competing rhythm strategy

The reducer is a per-onset tone cap, not a phrase-level strategy selector. In the current Oops output:

- Oops beats 64–108 contain 241 source-support notes across 85 distinct support attack positions.
- The candidate contains 84 support notes across 55 distinct attack positions in the same window.
- The full candidate averages 3.6 support attack positions per 4-beat measure and reaches 8 in several measures.
- The minimum support attack gap is 0.125 beat, about 79 ms at 95 BPM.

The note count is lower, but the output is not the planned sparse harmonic alternative and there is no phrase-level choice that asks whether the remaining rhythm is actually simpler or useful. These counts are risk signals, not proof that the output sounds bad or is unplayable. The plan explicitly says source-derived reduction must not increase attack rate and sparse harmony should normally use no more than two structural attacks per complete measure; the current path does not implement that as a selectable real-song candidate.

Smallest fix: retain this conservative source reducer as one candidate, add one bounded phrase attack-plan candidate using validated meter/phrase phase, and choose it only when it lowers attack complexity without deleting reviewed identity events. Add a fixture-level attack-rate assertion for the actual Oops/Blackbird development windows.

### P1 — Support has no available-hand allocator

`accompanimentNote` forces every source-reduced and sparse-generated support note to `hand: "L"`. The sounding guard then groups notes by that forced label; it does not move support to the available hand.

Concrete current outputs:

- Hell beat 23.5: source MIDI 91, source hand `R`, output hand `L`, simultaneous selected melody MIDI 79, hand `R`.
- Oops beat 80: source MIDI 88, source hand `R`, output hand `L`, simultaneous selected melody MIDI 92, hand `R`.
- The same Oops source-R-to-output-L pattern recurs at beats 160 and 240.

These are not merely labels: Player hand filtering and the learner’s physical assignment consume the output hand. A left-hand assignment at MIDI 91/88 is a physical-crossing risk even if the written-event span check passes; the example alone does not prove that a person cannot play it.

Smallest fix: allocate support after mandatory melody/retained notes are known. Preserve source hand when feasible; otherwise choose the available hand/register and re-run the per-hand sounding check. If neither hand is safe, retain/classify the phrase instead of forcing support left.

### P1 — Melody identity remains inferred, and correction is not phrase-actionable

The DP is a useful abstaining heuristic, but the current controls have no semantic melody gold. The three fresh runs expose 25, 55, and 63 unresolved spans respectively. The Oops source review explicitly treats right-hand candidates as anchors, not proven melody. The chord derivation path also has no selected-melody/source-note identity, so historical notes-derived harmony cannot prove that protected melody was excluded.

The UI offers only whole-part Automatic or Use right-hand part. It displays a current phrase and permits seek/loop, but it does not let the user select a candidate or “Melody rests here” for that phrase. Phrase overrides are a producer/storage capability, not an available correction workflow.

Smallest fix: expose one phrase-local action for candidate selection or rest, fingerprint it to the source, and keep unresolved spans visible until corrected. Add real fixture expectations for at least the Oops ambiguous windows and an explicit test that the selected source IDs are excluded from any inferred backing evidence.

### P1 — Written-event playability checks are not human-playability acceptance

The implementation correctly checks some upper bounds: three sounding notes and a 12-semitone span per assigned hand, with melody/retained notes taking priority. That is a good safety floor and the plan itself calls it an upper bound, not a beginner guarantee. It does not establish playability, however:

- No hand allocator addresses crossings before the guard trims support.
- Source attacks remain as short as 0.125 beat in the Oops/Hell support output. A written stream can satisfy overlap limits while still presenting rapid reattack risk; this is not, by itself, a human-playability verdict.
- Default sustain is on. Audio paths add decay/tail behavior and the sampler follows CC64, while the arrangement guard counts written note intervals only. Acoustic pedal overlap is not part of the written-event budget, but pedal ringing does not mean the player must hold the keys down; the gap is sonic-overlap acceptance, not proof of extra finger occupancy.
- Fixed cap 70 is not relative to the local melody. Oops beat 204 has support MIDI 49 at output velocity 70 while simultaneous melody MIDI 106 is velocity 60; Hell beat 10.125 has support MIDI 56 at 70 while melody MIDI 84 is 68.
- No fingering optimization is promised, which is acceptable as an explicit exclusion, but then human listening/playability evidence is mandatory.

Smallest fix: add a melody-relative support level/gain policy, a real attack-density/repeated-pitch check at the target tempo, and a pedal-on/off acceptance fixture or an explicit product limitation. Do not promote the 3/12 written bounds to “human-playable” without a human rubric.

### P2 — Phrase status is structural, not musical phrase quality

`buildArrangementPhrases` gets boundaries from chord events, ambiguity/fallback spans, confirmed overrides, and planning spans. It does not use song sections or musical phrase boundaries. `already-simple` is an accounting label derived from unchanged output with no reasons; it is not a human judgment that the original passage is simple or useful.

This is acceptable as transparent engineering status if labelled that way. It must not be used as a musical success metric. Current phrase counts are 167/421/293 for Blackbird/Oops/Hell, with 77/243/165 review phrases; those counts mostly reflect the producer’s boundaries and unresolved/fallback intervals.

Smallest fix: keep the structural status, but name it “derived interval status,” and add a separate human-reviewed phrase result. Do not collapse the two.

### P2 — Role audition is honest but cannot prove a clean backing stem

The UI correctly warns that Accompaniment includes retained source notes and is not an isolated stem. The implementation filters `event.role !== "melody"`, so `retained-unclassified` remains audible in that audition. Hand filtering can also omit role events whose assigned hand is not selected. This is not a hidden bug; it is a limitation that should remain part of the acceptance record.

Smallest fix: leave the honest warning in place and add a “source-derived / unclassified included” count to the audition result. Do not call this an isolated backing audition until role coverage is complete.

### P2 — Focused tests prove contracts, not the real musical claim

The focused suite passed, but it does not cover the current frozen real-song fixtures, human melody correctness, pedal-held sounding, or available-hand allocation. The test named “owns the inferred melody and generates support instead of falling back” explicitly expects `generatedNoteCount: 0` and `supportModes: ["source-rhythm"]`; that is a valid source-reduction contract, but its title and the product wording can be read as stronger than the assertion.

Synthetic tests do cover sparse harmonic generation, extended shells, slash basses, held-overlap trimming, reattack accounting, same-stream playback, and fail-closed unverified harmony. Those are valuable engineering checks, not evidence that the three real controls sound useful.

Smallest fix: add a deterministic fixture-level report/assertion for generated-vs-source support, hand assignments, attack rate, and unresolved ranges. Keep human listening and normal CI as separate gates.

## What works well

- The implementation keeps the ordinary Note stream as the playback/guidance/grading source and avoids a duplicate chord scheduler in Melody + accompaniment mode.
- Original source notes remain available; unknown or unverified harmony fails closed instead of silently inventing support.
- Selected melody values and source lineage are retained through the derived events; source fingerprints and stale worker request keys reduce persistence/async corruption risk.
- The change summary compares audible event content rather than treating hand labels or generated metadata as sound changes.
- Sounding-limit enforcement accounts for held written notes, retained-unclassified notes, same-pitch collision, and coherent phrase trimming before it emits the final event stream.
- UI copy explicitly warns that the Accompaniment audition is not an isolated stem and exposes the source-support/generated/fallback counts.
- The plan’s strongest honesty boundary is respected in the evidence: no human rating, waveform, CI health, or nonzero generated label is used as musical acceptance.

These are meaningful engineering wins. They are not substitutes for G2/G3 listening or the remaining source/role/attack-plan work.

## T1–T9 and gate status

| Work item | Independent status at `a7087b1` | Remaining proof |
|---|---|---|
| T1 / G1 source truth | Evidence and exact current fixtures are pinned. Structural source review is useful. G1 is not a semantic/musical acceptance pass. | Confirm source identity, melody ownership, chart provenance, and selected-melody exclusion on reviewed phrases. |
| T2 accounting | Engineering contract is substantially passing; fresh output has complete change/review accounting. | Keep review duration orthogonal to musical quality; add real-fixture regression assertions. |
| T3 melody selection / G2 | Rest-aware DP and ambiguity evidence exist, but real melody replay is unaccepted. | Human/semantic review of Oops, Blackbird, Hell; phrase-local correction; gold or reviewed expectations. |
| T4 harmony / uncertainty | Fail-closed `none`/`authored-only`/`all` policy is a good safety boundary. General `chordsAt` protected-melody exclusion remains unproven. | Carry selected IDs into inference or keep generated harmony unavailable until the evidence exists. |
| T5 backing rhythm | Source reduction and synthetic sparse candidate tests pass. Real current candidates are source-rhythm/fallback only; sparse backing is not selected when source notes exist. | Actual phrase strategy selection and a musical pilot with attack-rate/identity results. |
| T6 sounding/playability | Written overlap/span tests pass; support velocity and sampler plumbing are covered structurally. | Available-hand allocation, repeated-attack/tempo review, pedal-aware limits, and human playability ratings. |
| T7 single stream/persistence | Same-stream, no-duplicate, worker/stale-key and persistence behavior are structurally covered by existing evidence. Exact current-head CI `35346537439` and container/tutorial `35346537440` passed; parent engineering review is complete. | A real mobile/device check remains separate. |
| T8 status/audition/correction | Status disclosure, role audition, reset, and honest non-isolation copy exist. | Phrase-level correction authoring and actual listening; whole-part correction is insufficient for bounded ambiguities. |
| T9 evaluation / G4 | Reserved packet and integrity evidence exist; human results remain pending. Exact-head CI and parent engineering review are complete. | Complete human rubric and musical readiness review. G4 is not passed. |
| G3 musical pilot | **Not passed.** | Useful Oops verse/chorus and Blackbird phrase plus no critical melody regression, judged by a person. |

## Smallest path to a genuinely satisfying architecture

The one-producer/one-stream architecture is not fundamentally wrong. The minimum changes are:

1. Make harmonic evidence real for the phrases that claim generated backing: use authored/validated chart events or keep the result explicitly source-reduction/partial.
2. Turn the two planned backing strategies into real phrase candidates. Source reduction may win unchanged; sparse harmonic backing may win only with supported harmony, known phase, lower attack complexity, and preserved identity events.
3. Add support hand allocation after melody selection and before final sounding enforcement. A forced-left convention is not enough for mixed-hand melodies.
4. Add phrase-local melody/rest correction and selected-source IDs to the harmony evidence path. Keep automatic inference visibly inferred.
5. Add acceptance tests against the current real fixtures for source-vs-generated support, hand assignment, attack density, unresolved spans, and pedal/tempo limits. Generated-note count should describe the chosen strategy, not serve as a quota. Then obtain human ratings for recognizability, useful backing, physical comfort, and melody audibility.

Do not add more pattern types, a new model, mass catalogue regeneration, or release work before these bounded gaps are resolved. The existing producer and result contract are sufficient for the next iteration.

## Runnable reproduction and machine-readable result

The exact-song metrics and counterexamples are reproducible without a new dependency or runtime edit:

```sh
cd /Users/reidar/.codex/worktrees/musically-useful-chords-mode
PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH \
  npm exec --no -- tsx docs/superpowers/evidence/2026-09-18-pr100-chords-v2-skeptical-audit-reproduce.ts
```

The read-only script resolves the actual `auto` source, runs `buildMelodyAccompaniment` with the Player options, and prints JSON tagged with reviewed head `a7087b1e5c3862a31abee66cd536330ac5c4a321`. The captured machine-readable output is [2026-09-18-pr100-chords-v2-skeptical-audit-results.json](/Users/reidar/.codex/worktrees/musically-useful-chords-mode/docs/superpowers/evidence/2026-09-18-pr100-chords-v2-skeptical-audit-results.json).

Key fields from that output: Blackbird `generatedNotes=0`, `maxSupportAttacksPerMeasure=9`; Oops `generatedNotes=0`, `maxSupportAttacksPerMeasure=8`, `[64,108]` window `84` support notes / `55` attack positions, minimum support gap `0.125` beat; Hell `generatedNotes=0`, `maxSupportAttacksPerMeasure=11`, with source-R MIDI 91 emitted as output-L at beat 23.5. These are structural risk/strategy metrics, not musical or playability verdicts.

## Recommendation on live human testing

The evidence warrants a bounded internal listening experiment as the next diagnostic, not a release or a claim that the candidate is teachable. Use complete Oops verse/chorus and Blackbird phrases, compare Original against the current candidate, audition Melody/Accompaniment/Full, and record the four rubric outcomes: recognizability, backing usefulness, hand comfort, and melody audibility. Since the current `auto` path takes source reduction/fallback on these controls, the listener should evaluate that actual strategy honestly rather than expecting newly generated harmony.

Keep the candidate labelled experimental and retain Original as the default/recovery path. No evidence here warrants broad live-user adoption, production deployment, or a musical “fixed” claim.

## Exact source and fixture pointers

These are the primary line-level pointers used for the findings above:

- Harmonic policy: `apps/web/src/components/player/chord-sources.ts:52-56` (`auto` → `authored-only`); event-level gate: `packages/player-core/src/accompaniment.ts:471-483`.
- Source reduction keeps onset groups and only collapses repeated stacks: `packages/player-core/src/accompaniment.ts:882-923`.
- Forced support hand and fixed velocity cap: `packages/player-core/src/accompaniment.ts:1256-1267`.
- Written sounding budget, existing-hand grouping, and support-only trimming: `packages/player-core/src/accompaniment.ts:620-719`.
- Sparse support is gated behind empty source support: `packages/player-core/src/accompaniment.ts:1540-1561`; generated support is projected only from `generatedSupportNotes`: `packages/player-core/src/accompaniment.ts:1616-1668`.
- Automatic melody scoring/rest state and ambiguity evidence: `packages/midi/src/piano-roles.ts:244-273`, `:342-380`, and `:469-508`.
- Player ordinary-note/guidance projection and no melody-mode `audioChords`: `apps/web/src/components/player/Player.tsx:644-675`.
- Role audition includes every non-melody role and applies hand filtering: `apps/web/src/components/player/Player.tsx:1188-1225`.
- UI only offers whole-part Automatic/Use right-hand selection and explicitly warns that accompaniment is not an isolated stem: `apps/web/src/components/player/SoundControls.tsx:95-153`; the phrase disclosure says overrides may exist but exposes seek/loop only: `apps/web/src/components/player/Player.tsx:1572-1606`.
- Current real-fixture inputs: `docs/superpowers/evidence/2026-09-17-chords-v2-fixtures/the-beatles-blackbird/a/notes.json`, `.../britney-spears-oops-i-did-it-again/a/notes.json`, and `.../aria-ellys-music-the-warning-hell-you-call-a-dream-piano-cover-by-aria-ellys-mslzwo1d/a/notes.json`.
- Current candidate summary and comparison provenance: `docs/superpowers/evidence/2026-09-17-chords-v2-current-candidate-development.json`.
- Read-only exact-head reproduction script: `docs/superpowers/evidence/2026-09-18-pr100-chords-v2-skeptical-audit-reproduce.ts`; captured machine-readable output: `docs/superpowers/evidence/2026-09-18-pr100-chords-v2-skeptical-audit-results.json`.
- Source/semantic limitations and Oops expectations: `docs/superpowers/evidence/2026-09-17-chords-v2-g1-review.md`, `docs/superpowers/evidence/2026-09-17-oops-original-source-findings.md`, and `docs/superpowers/evidence/2026-09-17-oops-proposed-melody-expectations.json`.
- Reserved capture evidence explicitly leaves human musical ratings pending: `docs/superpowers/evidence/2026-09-17-chords-v2-reserved-evaluation.md` and `docs/superpowers/evidence/2026-09-17-chords-v2-reserved-evaluation.json`.

## Non-claims

- I did not audition the audio captures during this audit.
- I did not claim that a decoded waveform, hash, duration, event count, or passing test sounds good.
- I did not claim automatic melody correctness for any control fixture.
- I did not claim pedal-on human playability or beginner playability.
- I did not claim that historical/reserved capture packets prove current-head musical acceptance.
- I did not change PR #100, merge, deploy, rebuild the catalogue, or mutate live data.
