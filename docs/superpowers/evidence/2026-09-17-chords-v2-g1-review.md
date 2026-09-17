# Chords v2 G1 review packet

Status: ready for parent review. T1 is complete; T2 algorithm edits have not started.

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

Change counts below use the exact audible event multiset `(midi, start, dur, vel)`; hand metadata is deliberately excluded. This is structural evidence, not a musical rating.

| Fixture | Source | Automatic output | User right-hand output |
|---|---:|---:|---:|
| Blackbird | 1,069 notes / 657 attacks | 1,042 notes; 657 melody; 378 source support; 48 fallback spans / 153.75 beats; removed 28, added 1 | 1,069 notes; 548 melody; 516 source support; removed 0, added 0 |
| Oops | 1,891 notes / 625 attacks | 1,668 notes; 625 melody; 438 source support; 39 fallback spans / 235.25 beats; removed 223, added 0; 30 unresolved spans | 1,897 notes; 1,425 melody; 451 source support; 6 generated; removed 0, added 6 |
| Hell | 1,130 notes / 717 attacks | 1,113 notes; 717 melody; 368 source support; 87 fallback spans / 278 beats; removed 20, added 3; ambiguity at 18.5–19.75 and 258–258.875 beats | 1,161 notes; 535 melody; 578 source support; 31 generated; removed 0, added 31 |

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
| T1-F01 | High | Confirmed | Oops Automatic removes 223 source events and exposes a reported ambiguity at 83.5–89.5 beats, with additional ambiguity spans | Automatic melody cannot be treated as trustworthy full-song truth |
| T1-F02 | High | Confirmed | Oops local/live note counts are 1,897/1,891 | All later acceptance must use the frozen live fixture |
| T1-F03 | High | Confirmed | Hell local/live note counts are 1,452/1,130 with different artifact hashes | Prior local Hell evidence is stale for this gate |
| T1-F04 | Medium | Confirmed | UG chart is null for all three controls; chords are generated fallback from notes | Harmony/rhythm work must retain provenance and uncertainty |
| T1-F05 | Medium | Confirmed | Automatic changes the audible event multiset on all controls; RH preserves source events except generated fallback additions | T2 needs explicit change accounting and source-melody protection |

## G1 decision requested

Please review and accept or amend the frozen sources, six Oops windows, four reserved evaluation bases, and finding ledger. Until accepted, no T2 melody/harmony/rhythm algorithm edit is authorized. Human musical acceptance remains a separate later gate.
