# Easy-difficulty preservation — results

Date: 2026-09-02  
Baseline revision: `3a2af9a4dc2894f47c3caace29d403df2a38b548`  
Implementation revision: `ca622a2`  
Profile: `learner`  
Options: `maxDurBeats: null`; deterministic digest is SHA-256 over sorted
`[midi,start(6),dur(6),vel,hand,identitySource]` tuples.

## Decision

`EASY_PRESERVATION_PARTIAL`

The two measured Easy defects are improved: a principal melody now wins over
quiet co-onset decorations, and learner LH pitch classes are no longer replaced
by the global tonic. The scope deliberately stops short of claiming a complete
musical solution: the trace does not yet attribute every conflict/rate/range/
revoice loss, and there was no human listening gate in this slice.

## Scope and safety

- Only trusted symbolic fixtures and one existing project-owned synthetic shadow
  fixture were used. The supplied external reference MIDI was not read, copied,
  generated from, staged, or uploaded.
- No AMT, Basic Pitch, GAPS, separation, routing, decoder, OMR, benchmark,
  deployment, replay, catalog, or audio-rendering changes were made.
- Behavioral changes are learner-profile-only. Advanced and Medium outputs are
  byte-identical to the baseline on every frozen fixture.
- The optional learner lineage sink is path-free and does not change variants or
  API payloads. It now connects the raw learner stage to the existing difficulty
  parent keys.

## Frozen generation-truth corpus

| ID | Logical source | SHA-256 | Tempo / meter | Source notes / onsets | RH / LH |
|---|---|---|---|---:|---:|
| classical | `data/artifacts/c-debussy-suite-bergamasque-clair-de-lune/a/notes.json` | `e7e0fd260e049e338120cc4ee35c1a998ef616c01529a4c1a79837d6bb914039` | 60 / 9/8 | 1309 / 715 | 740 / 569 |
| cover | `data/artifacts/paul-gassa-yiruma-river-flows-in-you-emotional-piano-cover-msl98ing/a/notes.json` | `eb8a1cf8f0076a548acaa206b67d19123814e1167d654496afa24c0458dc6f9d` | 144 / 4/4 | 1400 / 938 | 954 / 446 |
| pop | `data/artifacts/adele-hello/a/notes.json` | `87915f6b8dce035951af2ddc89c9c36ce105fde8e79ba6f936e31b7f80ef7fd6` | 79 / 4/4 | 1016 / 555 | 522 / 494 |

The existing project-owned shadow fixture is `synthetic-full-band` (32 notes,
12 onsets, 7.75 beats; source SHA-256
`c8672d6923c8701408d54cc2e4dde671fbc0e9f0ca635c033e6b3a2ab7325518`). The
complete freeze record and baseline digests are in
[`2026-09-02-easy-preservation-baseline.json`](./2026-09-02-easy-preservation-baseline.json).

## Baseline → final outputs

Counts are `total (RH/LH)` from the same direct-piano harness and configuration.

| Fixture | Advanced | Medium | Easy baseline | Easy final | Easy delta |
|---|---:|---:|---:|---:|---:|
| classical | 1309 (740/569) | 1283 (722/561) | 908 (433/475) | 962 (435/527) | +54 |
| cover | 1400 (954/446) | 1371 (932/439) | 1197 (785/412) | 1225 (786/439) | +28 |
| pop | 1016 (522/494) | 1011 (517/494) | 823 (374/449) | 847 (375/472) | +24 |

Advanced and Medium final digests equal the baseline digests in the freeze
record. Final Easy digests are, respectively,
`6ea1fbdc1abb9c81035dfb1b9a03e9e314e0680d4a8873f4ac354e2c067ca8db`,
`6145eceb987d9a90000133581aad6093b69d6b658277f7fb2af094ee07a3974d`, and
`fa0209e68463f11165c08909ed1523e472fe6c22799ed585cd96680016c82c53`.

## Measured loss funnel

The development trace is intentionally compact, but the controlled funnel
identifies the dominant loss stage. Values below are Medium RH → Easy selector
decision → published Easy RH; LH is shown as input → decision → final.

| Fixture | RH funnel | LH funnel | Interpretation |
|---|---|---|---|
| classical | 722 → 438 → 435 | 561 → 527 → 527 | one-voice melody choice dominates |
| cover | 932 → 786 → 786 | 439 → 439 → 439 | melody choice dominates; LH preserved |
| pop | 517 → 376 → 375 | 494 → 472 → 472 | melody choice dominates; LH preserved |

Rate/conflict caps did not account for the large Easy RH loss in this harness.
The stage trace records `raw`, `cleaned`, `selector-input`, `decision`, and
`final`, plus the existing per-level `difficulty` events. It is an opt-in
development sink; serialized notes remain unchanged in shape.

## Ablation summary

These runs used the same fixtures and learner configuration. FIX A is the
pad-aware principal-melody selector. FIX B preserves learner LH source voicing
instead of re-rooting every attack to the global key. FIX A+B is the shipped
combination.

| Run | classical Easy (RH/LH) | cover Easy (RH/LH) | pop Easy (RH/LH) |
|---|---:|---:|---:|
| BASELINE | 433 / 475 | 785 / 412 | 374 / 449 |
| FIX A | 435 / 475 | 786 / 429 | 375 / 382 |
| FIX B | 433 / 527 | 785 / 439 | 374 / 472 |
| FIX A+B | 435 / 527 | 786 / 439 | 375 / 472 |

## Answers to the 14 review questions

1. **Largest Easy loss.** The dominant measured loss is the one-voice RH
   melody selection: classical 722→438, cover 932→786, and pop 517→376
   before final trimming. Separately, LH identity was damaged by global-key
   re-rooting.
2. **Why repeated notes disappeared.** Same-grid/co-onset winner selection and
   overlap/merge logic treated distinct re-attacks as redundant instead of
   distinguishing articulation from detector duplication.
3. **What the fix proves.** The synthetic principal-melody regression preserves
   all 16 intended principal re-attacks and rejects the short quiet decorations;
   Advanced and Medium retain the richer input. Existing overlap tests still
   cover genuinely duplicate/sustained overlaps.
4. **Why octave flips happen.** Range fitting/revoice and global-key LH revoice
   operate without enough phrase/contour context, so a locally plausible note
   can be moved to the wrong octave or voice.
5. **Whether octave flips improved.** No. This slice does not change octave
   fitting; existing octave tests pass, but a real-fixture octave-flip reduction
   was not measured.
6. **Why harmony retention was low.** Easy previously re-rooted nearly every
   LH attack to the global key and also thinned voicing detail, erasing genuine
   harmonic changes.
7. **Harmony evidence for the fix.** On the synthetic harmonic-change fixture,
   final Easy preserves the Medium pitch-class set `[0,4,7,11]` instead of the
   baseline tonic-only set. Broad source-fixture root/bass survival remains
   unmeasured.
8. **Same-harmony restrikes.** Unchanged/unmeasured; neither shipped behavioral
   fix targets that case directly.
9. **Melody identity.** Clearly improved on the synthetic contour. On the three
   trusted fixtures the controlled ablation changes RH by only 0–2 notes, so no
   broad contour-improvement claim is made.
10. **Playability.** No measured regression: Easy remains below Medium in total
    notes, RH remains one-voice in the learner path, tested fixture max
    simultaneity is 3, and validation/monotonicity checks pass with the stated
    `maxDurBeats: null` configuration.
11. **Difficulty ordering.** Easy remains simpler: 962<1283, 1225<1371, and
    847<1011 for classical, cover, and pop respectively.
12. **Regressions.** No tested fixture regression was found. A broad musical
    adjudication across all songs was not performed in this slice.
13. **Decision.** `EASY_PRESERVATION_PARTIAL`.
14. **Follow-up (not implemented).** Extend the optional lineage through the
    actual conflict/WIS, rate, range, and revoice stages, then use that evidence
    to decide whether a richer contour-preserving Easy selector is justified.

## Shadow and deterministic checks

The existing shadow fixture remains Advanced 27, Medium 26, Easy 18 under the
final learner path; no reference or commercial-song benchmark was used. Reversed
input produces the same digest for every frozen fixture and every level.

The final verification record is intentionally generated after the last code
edit and includes focused MIDI tests, the full workspace suite, all workspace
typechecks, whitespace validation, deterministic output parity, remote SHA
parity, and the disk-floor check.
