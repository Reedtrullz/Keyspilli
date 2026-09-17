# Chords v2 G1 review packet

Status: T1/G1 source capture and amendments accepted by parent; T2 accounting is committed. T3/T4 corrective checkpoints, the continued T5 source-rhythm checkpoint, and a partial T6 sounding-limit checkpoint are recorded, while real-song tuning and G2 remain gated.

## Execution boundary

- Worktree: `/Users/reidar/.codex/worktrees/musically-useful-chords-mode`
- Branch: `codex/musically-useful-chords-mode`
- Base/head: `main` / `89f4ce7d547f765d70691b3712fc500745a97b45`
- Runtime: Node 22.22.3 at `/Users/reidar/.nvm/versions/node/v22.22.3/bin`
- No catalog rebuild, merge, deploy, or production mutation was performed.
- Browser tests used a fresh disposable SQLite/artifact copy populated from captured API fixtures.

## Source freeze

The exact API responses, source fingerprints, artifact hashes, chord-timeline hashes, timing, variants, and fixture-file hashes are in [the machine-readable baseline](./2026-09-17-chords-v2-baseline.json). The durable fixture copies are in:

- `docs/superpowers/evidence/2026-09-17-chords-v2-fixtures/` — Blackbird, Oops, and Hell.
- `docs/superpowers/evidence/2026-09-17-chords-v2-evaluation-fixtures/` — four reserved source-only evaluation bases.

The live/runtime source chain is:

`raw source/artifact -> manifest and a/notes.json -> GET /api/songs/<id> -> getSongDetail -> resolveChordSources/selectChordSource -> Player.tsx -> buildMelodyAccompaniment`.

The three control fixtures have no UG chart. Their chord metadata is explicitly `midi-derived`, `fallback: true`, and `chart artifact unavailable; derived from a/notes.json`; the UI label is `Generated fallback`. Live notes contain L/R hand labels but no `sourceLane` or `identitySource` lineage fields.

The external local checkout is not interchangeable with the captured runtime: Oops is 1,897 local notes versus 1,891 live notes; Hell is 1,452 local notes versus 1,130 live notes and has a different source artifact hash. Blackbird note arrays match, although its serialized notes file metadata differs.

## Current producer baseline

Change counts below use the exact audible event multiset `(midi, start, dur, vel)`; hand metadata is deliberately excluded. The producer is run through the Player-equivalent pipeline: `arrangementEnd = max(note end, measure end)`, `resolveChordSources` selects the fallback auto source, then generated chords are deduped and duration-completed before `buildMelodyAccompaniment`. This is structural evidence, not a musical rating.

| Fixture | Source | Automatic output | User right-hand output |
|---|---:|---:|---:|
| Blackbird | 1,069 notes / 657 attacks; runtime end 296 beats | 1,042 notes; 657 melody; 378 source support; 49 fallback spans / 155.75 beats; removed 28, added 1 | 1,069 notes; 548 melody; 516 source support; 19 fallback spans / 17.75 beats; removed 0, added 0 |
| Oops | 1,891 notes / 625 attacks; runtime end 336 beats | 1,668 notes; 625 melody; 438 source support; 40 fallback spans / 238.875 beats (UI 238.9); removed 223, added 0; 30 unresolved spans | 1,897 notes; 1,425 melody; 451 source support; 6 generated; 11 fallback spans / 9.125 beats (UI 9.1); removed 0, added 6 |
| Hell | 1,130 notes / 717 attacks; runtime end 352 beats | 1,113 notes; 717 melody; 368 source support; 88 fallback spans / 279.25 beats; removed 20, added 3; ambiguity at 18.5–19.75 and 258–258.875 beats | 1,161 notes; 535 melody; 578 source support; 31 generated; 21 fallback spans / 18.875 beats; removed 0, added 31 |

Representative windows were measured before any algorithm edit:

- Blackbird `[14,26.5]`: source 47/30 notes/attacks; Automatic 43/30; RH 47/30. `[36.5,40]`: 15/8 for source, Automatic, and RH.
- Oops `[0,16]`: source 24/18; Automatic 24/18; RH 24/18, but RH melody count is zero. `[16,32]`: 32/28; 31/28; 32/28. `[32,48]`: 25/23; 24/23; 25/23. `[48,68]`: 56/30; 47/30; 56/30.
- Hell `[15.5,18]`: 9/6 for source, Automatic, and RH. `[28,45.25]`: 24/18 for all three. `[45.25,56.25]`: source 39/29; Automatic 38/29; RH 43/29. `[56.25,59.5]`: source 18/9; Automatic 17/9; RH 18/9.

## Oops phrase evidence

The initial single 2.4-second intro capture is retained as a control only. It is not the phrase baseline.

The corrected matrix uses 19 separate 90-second-bounded tests: six source-section windows for Original, Automatic, and RH selection, plus one Automatic-then-Left-hand UI-filter control on Section 4. All 19 passed:

```text
PATH=/Users/reidar/.nvm/versions/node/v22.22.3/bin:$PATH \
npx --no-install playwright test \
  --config=apps/web/playwright.chords-v2.t1.config.ts \
  --grep 'T1 captures Oops'
```

The aggregate manifest is [2026-09-17-chords-v2-oops-phrase-captures.json](./2026-09-17-chords-v2-oops-phrase-captures.json). The test config is repo-relative and uses `reuseExistingServer: false`. Captures are full mix browser audio with non-silent signal and Web Audio event assertions; they do not prove recognizability, harmonic correctness, or playability.

The source only exposes `Intro 1` and generic `Section 2`, `Section 3`, and `Section 4` labels. Therefore `verse`, `transition`, and `chorus` are recorded as provisional semantic labels, not confirmed source truth. The left-filter capture explicitly says it is not an isolated accompaniment stem.

The runtime normalization explains the earlier discrepancy with the screenshot: raw note ends are Oops 332.375 and Hell 350.75, but Player measure ends extend them to 336 and 352. With normalized/deduped chords, Oops Automatic fallback is 238.875 beats (`238.9` in the UI) and RH fallback is 9.125 (`9.1`), rather than the raw-duration probe values 235.25 and 5.5.

Hash and capture validation is runnable and read-only:

```text
node apps/web/scripts/validate-chords-v2-t1-evidence.mjs
T1 evidence hashes valid: 40 files; 19 captures
```

This verifies all 21 production/evaluation fixture files and all 19 captured audio SHA-256/byte counts. The corrected C. V. Alkan Prelude `notes.json` hash is the full 64-character `7fe0f9b6464a1727c74f3f25d1f81777d2e916b6c7e11ebeaf9733cc5043b05d`.

## RH-part candidate evidence (not automatic melody truth)

[2026-09-17-oops-proposed-melody-expectations.json](./2026-09-17-oops-proposed-melody-expectations.json) contains explicit RH-part override/candidate-anchor evidence for every development window, not automatic melody labels. The intro control says the RH part rests across `[0,16]`; this does not assert that the musical melody rests. The `[16,32]` window records four exact R-labelled re-entry IDs and RH-part rest intervals `[18,24]` and `[25.875,32]`. Sections 2, 3, and 4 contain candidate R anchors with duration `>=0.5` beats and no asserted automatic rest because the source is R-dense and lacks semantic lane truth. The ambiguity window is explicitly contextual: only `[83.5,83.875]` is inside the target; the other path spans are labelled outside-window context.

These are review hypotheses derived from source hand/duration/onset evidence, not labels generated by or certified against the current selector. The live payload cannot recover `sourceLane` or `identitySource`; a read-only backup MusicXML does expose staff/voice ownership, documented in [the original-source findings](./2026-09-17-oops-original-source-findings.md), but it still lacks a semantic melody legend. No automatic Oops tuning uses these annotations.

## T2 frozen-fixture event-multiset replay

To check that the T2 producer refactor preserved audible behavior, I ran the same frozen live Oops fixture through `buildMelodyAccompaniment` at pre-T2 commit `e5bd087` and T2 commit `4f42143`, using the Player-equivalent options: automatic selection, normalized duration `336`, and the captured source fingerprint. For each result, I sorted the rendered `(midi, start, dur, vel)` events with multiplicity and SHA-256 hashed the canonical JSON.

Both commits produced exactly:

```json
{"notes":1668,"audibleEventMultisetSha256":"8be9d8554886dea6dbeff580ff30ad46385aeba3616b3f94976acc65c7c854ce"}
```

The replay used only `docs/superpowers/evidence/2026-09-17-chords-v2-fixtures/oops/notes.json` and the pure player-core producer in isolated temporary Git worktrees; no catalog or production data was touched. This is a T2 preservation check, not a claim that the later T3/T4 producer has identical output or that the Oops melody is musically correct.

## T3 corrective checkpoint

The first T3 review found two concrete correction cases: a partial phrase override could suppress the entire overlapping ambiguity span, and the right-hand early return could bypass phrase overrides. The corrective tests now cover both cases plus phrase-local review provenance. Valid overrides subtract only their covered interval from selected-path uncertainty; phrase overrides take precedence over a global right-hand selection, while source accompaniment remains present. Arrangement phrases split at override/uncertainty boundaries so an automatic phrase is not labelled user-selected merely because a different phrase was corrected.

The backward continuation calculation now rolls one exact map of reachable predecessor identities instead of materialising an all-song identity table for every group. A Node 22 one-shot on the frozen 1,891-note Oops fixture (`splitPianoRoles(notes, { preferSustainedLine: true, allowRests })`, four samples after one warm-up) measured warm median `9.7 ms` with rests disabled and `706.3 ms` with the opt-in rest state. This is a local measurement, not a benchmark claim; it demonstrates that legacy/default callers no longer pay the rest-history table cost. Exact rest-aware histories remain intentionally unpruned to preserve re-entry correctness, and the code records the T7 worker/cancellation upgrade path if the opt-in path remains above the 50 ms budget. No evaluation-song output or musical conclusion was drawn from this measurement.

After the correction, the focused phrase suite has 23 passing player-core tests; the full player-core suite has 195 passing tests, the full MIDI suite has 395 passing tests, the catalog piano-section-builder suite has 9 passing tests, and MIDI/player-core/catalog typechecks pass.

## T4 local uncertainty and phrase/harmony checkpoint

The T4 implementation is in `a8943bb` with additional boundary coverage in `0a37afd`. A chord-planning event is split at each unresolved interval boundary; fallback spans include those boundaries, so a 0.3-beat ambiguity inside a 16-beat event does not make the remaining 15.7 beats unavailable. Protected melody source events remain intact and source reduction without a chart remains a separate fallback path.

Phrase strategy and change are now calculated per local interval from the rendered event roles and exact audible event comparison. Review reasons take precedence over `user-selected`; an invalid override or fallback reason therefore remains visible even when it overlaps a valid correction. A right-hand request with no RH events and a partial valid override keeps automatic selection and an explicit unavailable-part warning outside the correction range.

Verification after T4: full player-core `15 files / 200 tests PASS`; focused `melody-accompaniment` `28/28`; full MIDI `17 files / 395 tests PASS`; focused catalog piano-section-builder `9 tests PASS`; MIDI/player-core/catalog typechecks pass. These are structural checks only. No UI success wiring, Oops musical tuning, evaluation-song output, catalog rebuild, merge, deployment, or production mutation was performed.

## T5 source-rhythm and complete-phrase checkpoint

The parent accepted `de9cfd0` as a partial density/silence fix, not as T5 completion. Commit `55690fb` continues that checkpoint with exact synthetic fixtures for syncopated/pickup source attacks, repeated protected hooks, redundant source stacks, repeated chart chords, off-grid changes, 3/4-like, 6/8-like and unknown-meter grids. Commit `043dcf6` adds explicit source-phase provenance, segmentation invariance, interval-local sounding re-attack diagnostics, and bounded voicing/shell/hand regressions. Local partial-chart gaps and one uncertain no-chart interval now reduce independently; a single global unresolved span no longer disables unrelated no-chart intervals. Exact repeated source stacks are reduced after their first attack, while broader motif protection still depends on explicit phrase selection.

The sparse harmonic candidate now retains each supported adjacent harmonic boundary and adds at most two meter-specific phase attacks per complete measure only when the caller supplies a validated source measure boundary. The supported gestures are 4/4 `[0,2]`, 3/4 `[0,2]`, 6/8 `[0,1.5]`, and 2/4 `[0,1]` in quarter-note beats, translated from the supplied phase. The current Player payload has no independently validated pickup/phase provenance, so its runtime path deliberately remains boundary/source-timed. Adjacent equivalent chord segments are regenerated over their combined span, preventing segmentation-dependent pulses; off-grid chord changes remain off-grid. `generatedNoteCount` and `generatedBeats` are measured from rendered events after sounding-limit filtering.

The complete dense synthetic phrase has this exact structural output:

```text
source: 15 notes (3 selected melody + 12 support), attacks at 0, 1, 2
output: 12 notes (3 melody + 9 source-rhythm support), no generated chords
phrase: [0,3] strategy=source-reduction change=changed review=needs-review
reason: no chord coverage
support starts: 0,0,0,1,1,1,2,2,2
```

Phrase planning now splits at confirmed/uncertain spans, fallback spans, and chord-planning event boundaries. The regression with notes only at the edges of `[1,3]` confirms that an empty midpoint is not enough to call a phrase `silence`; the phrase remains `original` when either its source or output overlaps the interval.

T4 harmonic evidence remains separately bounded. `buildMelodyAccompaniment` consumes a supplied chord timeline and does not infer harmony from its selected melody; the producer-level regression confirms that a missing chart returns no generated chords. The actual frozen catalog path is different: `packages/catalog/src/ingest.ts` calls `buildVariants` from `@keyspilli/midi`; when `inp.chords` is absent, `packages/midi/src/simplify.ts` calls `chordsAt(notes, grid, src.durationBeats, opts.audioDerived !== true)` for each final difficulty variant, then `ingest.ts` writes `v.chords` into every level's `notes.json`. Standard seed imports and YouTube re-ingests therefore persist this notes-derived projection before the player runs melody selection. `packages/catalog/src/chord-timeline.ts` later reads that stored `notes.json.chords` as the generated fallback, and `apps/web/src/lib/catalog-api.ts` exposes it as `data.chords`; only after that does `Player.tsx` call `buildMelodyAccompaniment`.

The focused `buildVariants` regression `records the real notes.json chord fallback origin before player melody selection` verifies the generated/inferred/voicing provenance at the actual origin. `chordsAt` prefers a two-pitch-class-or-more LH cluster, but its fallback uses the final variant's available notes and has no selected v2 melody identity. Therefore selected-melody exclusion is unverified for the frozen seed/YouTube generated harmony; the earlier role-separated `buildSectionAwarePianoCandidate` check was removed because it covered a different producer. Existing generic MIDI harmony tests remain useful local invariants, not proof of the runtime catalog projection. No musical harmony acceptance is claimed.

## Full development-fixture structural comparison

The current producer was run over the complete frozen Blackbird, Oops, and Hell development fixtures with Player-equivalent normalized durations and automatic selection. Because the Player has no validated phase provenance, this run intentionally omits meter-phase timing and exercises the boundary/source fallback. These are exact source/output accounting and phrase-status comparisons, not listening results:

| Fixture | Source → output notes | Changed / unchanged / silent beats | Review beats | Phrases; changed phrases | Strategy counts (`source-reduction`, `harmonic-backing`, `original`, `silence`) |
|---|---:|---:|---:|---:|---|
| Blackbird | 1,069 → 1,034 | 20.875 / 269.125 / 6.000 | 21.500 | 133; 26 | 113 / 0 / 19 / 1 |
| Oops | 1,891 → 1,382 | 109.000 / 171.125 / 55.875 | 44.375 | 415; 272 | 283 / 13 / 112 / 7 |
| Hell | 1,130 → 1,109 | 24.250 / 290.500 / 37.250 | 22.500 | 222; 68 | 153 / 4 / 63 / 2 |

The output also retained explicit fallback/unresolved provenance: Blackbird 80 fallback spans and 20 unresolved spans; Oops 267 fallback spans and 54 unresolved spans; Hell 170 fallback spans and 27 unresolved spans. Sounding-limit trimming created source-linked re-attacks in Oops `40` times and Hell `10` times, and none in Blackbird; these are rhythm changes requiring review, not proof of retained source rhythm. The increased structural reduction and sparse backing counts are not a success score; no automatic melody gold, harmonic review, playability review, or human musical acceptance exists for these fixtures.

## T6 sounding-limit checkpoint

The current T6 work in `043dcf6` adds a shared post-projection sounding pass. It counts melody and retained-unclassified events in each hand budget, preserves them as mandatory, and trims accompaniment only over rejected intervals before exceeding three simultaneously sounding notes per physical hand or a 12-semitone active span. Surviving pieces retain their `sourceNoteIds`; same-pitch melody/support collisions are removed even across hand labels; late collisions no longer erase earlier held support. It records `sounding limit exceeded` over the rejected interval, counts source-linked re-attacks created by interior trims, and reports source/generated counts after trimming. Voicing candidates preserve supported bass/slash identity, prefer prior-voicing motion after bass feasibility, reject duplicate pitch classes, and can expose an explicit omitted-fifth shell. Synthetic tests cover held overlap, same-pitch collision, retained-unclassified overlap, late/interior collision, low-register feasibility, shell/slash/cross-hand behavior, same-instrument full-phrase note playback, segmentation invariance, and validated meter gestures; pedal semantics and velocity policy remain open.

Verification for the continued T5/T6 checkpoint: focused player-core `55/55`, full player-core `15 files / 227 tests PASS`, full MIDI `17 files / 396 tests PASS`, full catalog `120 files / 1,102 tests PASS`, full web `35 files / 202 tests PASS`, full transcribe `14 files / 95 tests PASS`, and all workspace typechecks pass. The full suite emitted only expected negative-fixture diagnostics. These are synthetic and structural checks. They do not establish syncopation, pickup, 3/4, 6/8, total sounding playability, recognizability, harmonic plausibility, UI status correctness, real-song usefulness, or musical acceptance.

## Reserved evaluation set

Selection occurred from source traits before candidate output inspection and is frozen in the baseline:

1. `w-h-doane-near-the-cross-a` — standard 6/4 mixed-hand, held texture.
2. `c-v-alkan-prelude-a` — standard 4/4 upper decoration and off-grid timing.
3. `beginner-piano-tutorial-easy-piano-jumbo-songbook-pay-me-my-money-down-mslzx940-a` — YouTube 4/4 weak mixed-onset/off-grid/held stress case.
4. `dadebrayant-avenged-sevenfold-dear-god-piano-cover-msm014zo-a` — YouTube 4/4 upper-decoration/off-grid mixed-hand stress case.

Expected melody annotations remain proposed and unreviewed. No algorithm output was used to select these bases, and no label is being treated as gold.

## Finding ledger

| ID | Severity | Status | Evidence | Consequence |
|---|---|---|---|---|
| T1-F01 | High | Amended | The 223 removed Oops events are expected under the current one-melody-note-per-onset/source-support reduction and are not proof of a bad melody. Separately, the pre-T3 heuristic emitted 30 ambiguity spans including the reported 83.5–89.5 region; it had no rest state or source-lane truth. | T2 separates intentional reduction accounting; T3 synthetic rest/path tests are generic; Oops musical usefulness remains unjudged |
| T1-F02 | High | Confirmed | Oops local/live note counts are 1,897/1,891 | All later acceptance must use the frozen live fixture |
| T1-F03 | High | Confirmed | Hell local/live note counts are 1,452/1,130 with different artifact hashes | Prior local Hell evidence is stale for this gate |
| T1-F04 | Medium | Confirmed | UG chart is null for all three controls; chords are generated fallback from notes | Harmony/rhythm work must retain provenance and uncertainty |
| T1-F05 | Medium | Confirmed | Automatic changes the audible event multiset on all controls; RH preserves source events except generated fallback additions | T2 needs explicit change accounting and source-melody protection |

## G1 decision requested

Parent has accepted the frozen sources, provisional windows, and reserved set. G1 is structurally accepted with RH-part candidate evidence explicitly excluded from automatic-melody gold. T2, corrective T3, T4 local-interval work, and the T5 synthetic source-rhythm checkpoint are committed; real-song tuning, G2 source/musical review, and human musical acceptance remain separate later gates.
