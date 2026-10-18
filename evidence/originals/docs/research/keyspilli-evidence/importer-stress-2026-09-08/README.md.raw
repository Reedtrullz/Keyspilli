# YouTube importer stress run — 8 September 2026

The first automatic run completed 10/16 original links (62.5%). A separate repair recovered Numb/Encore; five cases remain unsupported. This is a development stress corpus, not a held-out accuracy estimate or listening approval. No test songs were added to production.

## Method and results

Four known regressions plus twelve new identities were selected before tutorial discovery. Each new input was the first result of its original-recording metadata search. Every input was attempted, sequentially, through authenticated HTTP submission, durable queue, native worker, source discovery, extraction, difficulty generation and four MIDI downloads. Before/after candidate hashes matched. The runtime was a production Next build on the Mac with an isolated empty-start data directory, not the VPS or its download relay.

| Song | First run | Separate repair |
| --- | --- | --- |
| Take What You Want | Four exports | Four identical exports |
| Thunderstruck | Four exports; fallback used | Four identical exports |
| Come As You Are | Four exports | Four identical exports |
| Nothing Else Matters | Four exports | Four identical exports |
| My Immortal | Four exports | Not repeated |
| What I've Done | Four exports | Not repeated |
| Du hast | Four exports | Not repeated |
| Wish I Had an Angel | Calibration rejected | Unresolved |
| Hail to the King | Four exports | Not repeated |
| The Sound of Silence | Four exports | Not repeated |
| Dream On (live) | Six source attempts rejected | Unresolved; animated logo covers keyboard in one source |
| Stairway to Heaven | Six source attempts rejected | Unresolved |
| Knocking On Heavens Door (live) | Ambiguous reversed title; no candidates | Unresolved |
| Close My Eyes Forever | Upload-quality suffix breaks discovery | Correct identity, then unsupported keyboard geometry |
| Numb / Encore | Reversed joint credits break discovery | Four exports, source 5NAq_ISB2Tg |

The parser corrections remove trailing upload-quality labels, recognize reversed joint credits when a credited channel supports them, and match explicitly slash-separated collaboration credits in either order. Every full credited artist and the full song title remain required. AC/DC stays a single artist; ampersands and 'and' are not collaboration delimiters. Calibration and colour gates were not weakened.

## Checks

- 1,865 workspace tests and all workspace typechecks passed after the fixes. Three new identity regressions were demonstrated failing before the corresponding fixes.
- All 16 MIDI files from the four repeated controls are byte-identical to their first-run exports. Reruns may reuse validated extraction caches; they are not fresh-download coverage.
- All 40 first-run variants pass existing global structural playability limits. Per-hand and worst-passage metrics remain diagnostic; these do not certify human Beginner playability.
- Separate real HTTP adverse checks passed: unauthenticated/malformed/foreign URL rejection, concurrent duplicate submissions sharing one job, durable status, cancellation and cancellation conflict. Zero songs published by those checks. Worker interruption, storage and subprocess cases are covered by the existing automated suite; no new real disk exhaustion or network outage was induced.
- No automated metadata identity mismatch was detected. Independent acoustic song identity, musical quality, source rights, universal link support, VPS downloads and production import throughput were not established by this run.

## Repeat

Reuse `services/transcribe/scripts/evaluate-tutorial-pipeline.ts`; no new evaluation framework is required. Start a production-built web app and worker from the same checkout, with a NEW isolated `KEYSPILLI_DATA_DIR`, tutorial beta enabled, configured Python extractor and an ephemeral API token shared with the evaluator. Never point the evaluator at the public catalogue.

```sh
export KEYSPILLI_EVALUATION_MANIFEST="$PWD/docs/research/keyspilli-evidence/importer-stress-2026-09-08/manifest.json"
node --import tsx services/transcribe/scripts/evaluate-tutorial-pipeline.ts --freeze-candidate output/NEW-candidate.json
node --import tsx services/transcribe/scripts/evaluate-tutorial-pipeline.ts http://127.0.0.1:3317 output/NEW-run 16 development output/NEW-candidate.json
```

Use a unique output directory and freeze. The runner must finish before changing source files. Keep failures in the denominator. Do not overwrite the historical receipts here or claim repaired development inputs as new held-out evidence.

## Evidence and next coverage work

`first-run.json` is immutable. `repair-run.json` records the first two failed repairs; `repair-v2.json` records Numb/Encore recovery; `repair-regressions.json` and `regression-comparison.json` record the unchanged controls. `manifest.json` and its checksum fix the cohort. Candidate files identify exact source hashes. `operations.json` and `playability-audit.json` cover the supplementary checks.

Raw source/search/extraction diagnostics, 44 distinct MIDI exports and test/build logs remain locally under `output/tutorial-recovery/stress-2026-09-08/`. The five remaining failures should be the next development cases: support verified keyboard geometry and overlay handling without accepting false notes, and resolve reversed unofficial titles only with additional identity evidence. Then evaluate a newly declared untouched cohort before claiming improved general coverage.
