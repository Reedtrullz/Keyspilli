# Chords v2 G1 review packet

Status: T1/G1 source capture and amendments accepted by parent; T2 accounting is committed. T3 synthetic implementation is checkpointed, while real-song tuning and G2 remain gated.

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

The replay used only `docs/superpowers/evidence/2026-09-17-chords-v2-fixtures/oops/notes.json` and the pure player-core producer in isolated temporary Git worktrees; no catalog or production data was touched. This is a T2 preservation check, not a claim that the current uncommitted T3 selector has identical output or that the Oops melody is musically correct.

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

Parent has accepted the frozen sources, provisional windows, and reserved set. The remaining G1 amendments are the corrected 21/21 hash validation, Player-equivalent runtime normalization, and the concrete proposed source-ID expectations above. T2 accounting may proceed after this packet is reviewed; do not start T3 melody tuning until the expectations and normalization are accepted. Human musical acceptance remains a separate later gate.
