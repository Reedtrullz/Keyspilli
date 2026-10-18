# Automatic upload Chords — 27 September 2026

**Status: implemented as a draft; engineering checks pass, musical release threshold fails.** Reidar clarified that he has already spent two days listening to the golden songs and will not repeat manual review. Existing acceptance stands. No further owner listening is requested or used to block engineering. The three historical drifted candidates remain unrepinned; their exact accepted reconstructions remain available as the baseline.

## Behavior and scope

The existing `ingestSource` → `buildVariants` → `getSongDetail` → Player Chords route remains the sole path. MIDI, MusicXML and MXL uploads, and the worker's transcription/tutorial/verified-native contracts, all use it. No new dependency, model service, difficulty variant, database schema or production mutation was added.

- Advanced generated harmony uses the existing contextual labeler with source-backed boundaries. Complete played stacks can justify sevenths, suspensions and inversions; role evidence is local and can move between hands. Explicit vocal/lyric notes do not drive the backing. Inferred LH assignment alone cannot turn an entirely monophonic upload into chord evidence.
- Ambiguous accompaniment spans carry `reviewReason`, an empty `N.C.` voicing and a visible “Chords · review needed” explanation. This is a product status describing unsupported output, not an assignment to the owner. It is not a calibrated probability. Known source rests and uncertainty are distinguishable in the event metadata.
- Generated strikes come from matching source stacks or bass roots. They no longer fill silent bars automatically, retain a held stack just because a bass note repeats, or sustain through the pianist's actual release. Chord changes remain separate from re-strike spacing. The upper generated voicing is capped at MIDI 79 with an octave span; authored choices retain their existing register.
- Explicit inferred durations/short harmonic events survive both Auto and Generated source selection. Sampled and synth chord playback honor positive finite durations, including short passing chords and holds longer than eight seconds; the old 0.2–8 second duration clamp is removed.
- Curated charts, reviewed source-backed exceptions, Advanced artifacts and acceptance digests are unchanged. All 12 golden symbolic playback observations remain byte-identical to the audit checkpoint: **9 MATCH, 3 pre-existing DRIFT**. Fix You remains bounded to `[0,177.875)` as calibration material; Journey, Dreamer and Kings & Queens remain excluded.

## Executable checks

- `upload-chords.test.ts`: actual authenticated local upload route for MIDI/MusicXML/MXL and variable-tempo MIDI; actual `ingestSource` with all three worker input contracts; six variants; Easy request resolving to the actual Advanced Chords payload; expected C/F/G/C progression, attacks, rests and durations; actual full `PlaybackEngine` scheduling; second-ingest musical event equality, MIDI byte equality and stable source/config fingerprints. Manifest timestamps are intentionally not byte-idempotent.
- A second ingest-to-Player regression keeps an entirely monophonic upload silent even when the arranger assigns it to LH. The local HTTP upload also returned 200 and the browser visibly rendered the review-needed explanation and silent Chords result.
- 314 player-core tests, 78 focused web tests, 25 catalog ingest tests and 7 harmony tests pass. Workspace typecheck passes. These include the new short/long sampled-audio duration check; synth follows the same validated duration contract.
- 81 full transport comparisons (12 golden candidates, 3 reconstructed accepted baselines and 33 new before/after pairs) checked **17,848 scheduled events**. This checks scheduling, not agent hearing or physical keyboard playability.
- All 18 checked-in chart artifacts validated in the earlier audit. The catalog-wide verification still cannot pass against the partial private snapshot: 447 original bases lack artifacts. The golden index and chart files are untouched.

The worker-contract checks start with resulting symbolic data. They do **not** claim a fresh YouTube download, Basic Pitch transcription, native-index lookup, or tutorial-video extraction job. Those acquisition paths were traced to their actual `ingestSource` calls. Their transcription quality remains a separate limit.

## Separate development and held-out evidence

[POP909-CL](https://github.com/AndyWeasley2004/POP909-CL-Dataset/tree/be9094392903c471a930519e1c0bacf8b6be5d62), revision `be9094392903c471a930519e1c0bacf8b6be5d62`, supplies independent reference chord tracks. The last track is removed **before ingestion** and used only for scoring. File SHA-256 pins, timestamps and full structural metrics are in [the JSON ledger](chords-upload-automation-2026-09-27.json). Source files remain private/ignored.

The first ten sampled files (005–050, every fifth) exposed excessive abstention in an initial candidate. They became development diagnostics and are **not** claimed as final held-out evidence. The retained contextual labeler corrected that problem. Twenty different files (055–150, every fifth) were then selected before their first execution. A later monophonic-input regression fix has no effect on these polyphonic inputs; the public evaluator reproduced their same results. Three local non-golden files (Moonlight Sonata, Happier and Somebody to Love) are additional diagnostics, not independently labeled accuracy data and not newly owner-accepted songs.

For the final 20 songs, all **5,085** strikes coincide with source onsets and the source-note playback stream contains **zero** copied events. Mean sounding coverage is **53.7%**; silence is not counted as correctness. Mean uncertain timeline coverage is **4.5%**. The old heuristic listener checks pass 11/20; these are diagnostic proxies.

**The musical gate fails:** major/minor accuracy is **82.1%** (required 85%) and root accuracy **84.6%** (required 85%). On these same files, the prior harmony labeler scored 86.6% and 88.8%. Abstention is counted as wrong by these time-weighted reference measures; it explains part of the drop but does not turn failure into a pass. These figures measure labels over the full reference timeline, not listener recognition, fingering, or conditional accuracy only where the backing plays. No claim of universal good-quality upload backing is made.

| Held-out file | Prior major/minor | Candidate major/minor | Uncertain time | Strikes |
| --- | ---: | ---: | ---: | ---: |
| 055.mid | 90.9% | 87.9% | 2.7% | 303 |
| 060.mid | 91.7% | 84.7% | 11.2% | 136 |
| 065.mid | 92.6% | 91.7% | 1.8% | 386 |
| 070.mid | 76.8% | 69.0% | 7.1% | 137 |
| 075.mid | 80.7% | 77.1% | 1.9% | 232 |
| 080.mid | 80.0% | 79.0% | 7.9% | 279 |
| 085.mid | 78.9% | 72.7% | 0.0% | 292 |
| 090.mid | 93.3% | 92.0% | 0.7% | 202 |
| 095.mid | 90.3% | 85.5% | 3.3% | 291 |
| 100.mid | 90.1% | 72.0% | 22.5% | 128 |
| 105.mid | 98.5% | 84.3% | 12.5% | 342 |
| 110.mid | 67.6% | 70.8% | 4.3% | 169 |
| 115.mid | 91.1% | 86.1% | 1.9% | 256 |
| 120.mid | 94.1% | 91.0% | 3.2% | 203 |
| 125.mid | 89.6% | 80.7% | 0.3% | 356 |
| 130.mid | 92.2% | 90.2% | 0.4% | 255 |
| 135.mid | 90.6% | 87.0% | 2.2% | 389 |
| 140.mid | 64.5% | 71.8% | 1.7% | 367 |
| 145.mid | 88.8% | 81.2% | 4.7% | 123 |
| 150.mid | 88.9% | 86.7% | 0.0% | 239 |

## Remaining limits and previews

The automatic path is usable with explicit uncertainty, but musical quality needs further engineering before release. Sparse/ambiguous roles, accompaniment patterns without simultaneous stacks, sus2/augmented/altered extensions and source/transcription errors remain limits. Local Moonlight Sonata is 42.0% uncertain, Happier 16.3%, and Somebody to Love 3.0%. Do not silently relax uncertainty or repin accepted music to improve those numbers. No independent keyboard certification or new human listening verdict is claimed. None is being requested from Reidar as follow-up work.

Private previews at **http://127.0.0.1:3112/** contain the 12 references and all 33 new before/after comparisons, using the actual app sampler and PlaybackEngine. New rows are labelled `Automation · …`; “Before automation changes” uses the pre-change harmony and resolver from `d9dd0db4`. These files are available for inspection, not a new owner-review task. The source/reference and generated bundles under `output/golden-audit/` must not be published. The full loopback app remains at http://127.0.0.1:3111/.

## Reproduction

Run from the worktree on Node 22.22.3. The evaluator creates and removes an isolated temporary catalog, reports hashes/metrics only, and never touches the configured production catalog. For POP909 scoring, pass only the chosen evaluation files and `--reference-track`; ordinary uploads omit that flag.

```sh
./node_modules/.bin/tsx apps/web/scripts/evaluate-upload-chords.mts --reference-track output/golden-audit/final-holdout/*.mid
./node_modules/.bin/tsx apps/web/scripts/evaluate-upload-chords.mts /private/path/song.mid /private/path/score.musicxml /private/path/score.mxl
npm test -w @keyspilli/midi -- test/harmony.test.ts
npm test -w @keyspilli/player-core
npm test -w @keyspilli/web -- src/lib/upload-chords.test.ts src/lib/catalog-api.test.ts src/lib/chords-evaluation.test.ts src/components/player/chords-backing.test.ts src/components/player/chord-sources.test.ts src/components/player/chord-practice.test.ts
npm test -w @keyspilli/catalog -- test/ingest.test.ts
npm run typecheck
```

The existing `packages/midi/scripts/chord-benchmark.ts` also accepts `--backing-only`; its direct `buildVariants` fixture path is distinct from this ingest-to-Player report. Do not substitute one result for the other. No merge or deploy is authorized by this report.
