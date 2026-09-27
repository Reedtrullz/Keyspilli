# Golden Chords audit — 27 September 2026

**Status: structural audit and drift reconstruction complete; existing owner acceptance retained.** After this checkpoint, Reidar clarified that two days of owner listening already stand and no additional manual review will be done. Automation engineering proceeded; see the [upload automation follow-up](chords-upload-automation-2026-09-27.md). No new owner acceptance, agent listening or keyboard certification is invented.

## Identity and scope

- Inspected draft [PR #109](https://github.com/Reedtrullz/Keyspilli/pull/109), head `85c6ec51c55a67bd977fbdad7d0dca12fd60ae9b`, base `codex/chords-all-songs`. Its existing [container-smoke run](https://github.com/Reedtrullz/Keyspilli/actions/runs/36284161730) passed at that head. It does not validate this audit's later changes.
- Worked on a separate `codex/chords-golden-audit` branch. Preserved the original checkout's WIP and the PR #109 worktree. Used Node 22.22.3; disk headroom was 40 GiB before execution.
- Made an SQLite online backup and copied the 12 golden artifact directories into ignored `output/golden-audit/data`. SQLite integrity check returned `ok`. All 12 Advanced-note SHA-256 pins and all 12 selected timeline pins match the index. No musical artifact, chart, or accepted digest was changed.
- [Machine-readable ledger](chords-golden-audit-2026-09-27.json) contains exact input, accepted-output and observed-output hashes, source identities, source-check timestamps, beginning/middle/end anchors and structural metrics. Raw arrangements and comparison events remain private in ignored output.
- The snapshot database contains 459 visible bases, but only 12 have local artifacts. The other 447 are **unavailable**, not passed. Clocks is only 164 beats (1:15.69): this is the complete available arrangement, not the full original recording. Fix You's reference is strictly `[0,177.875)`; later notes and tails are excluded from the reference metrics.

## Twelve-song evidence and issue ledger

All selected UG pages were retrieved through the Agent Reach/Jina reader on 27 September. The direct web reader failed for all 12; Imagine's first Jina response was an advertising redirect, and a fresh query retrieved the correct page. Retrieval hashes/timestamps and that failed first response are recorded in the JSON ledger. A fetched chart establishes harmonic reference content; it does not establish recording alignment or listening.

**Evidence columns are independent.** “Pins” means source bytes and authored timeline identity. “Replay” means the historical accepted digest. “Diagnostic” is the existing heuristic applied to the current reference scope, not a musical or physical-keyboard verdict. No new agent listening verdict or independent keyboard verdict was obtained for any row. The nine matches retain their prior indexed owner acceptance; the three drifted candidates remain unrepinned, with their accepted reconstructions retained. No repeat owner listening is requested.

| Song / selected chart | Source/key check | Chords clock and scope | Pins / replay / diagnostic | Issue or remaining review |
| --- | --- | --- | --- | --- |
| [Skyfall](https://tabs.ultimate-guitar.com/tab/adele/skyfall-chords-1186885) | Chart's Cm harmony matches the app's key; exact seed performance unknown. [Adele official reference](https://www.youtube.com/watch?v=DeumyOzKqgI) identified, not listened to in this audit. | 75 BPM; 360 beats / 4:48; 206 strikes | Match / **DRIFT** / pass | Accepted 223-strike version reconstructed. No pitch changes at retained attacks; rhythm/release changed. Voicing reaches MIDI 96: a register concern for listening, not an automatic reason to overwrite the accepted version. |
| [My Way](https://tabs.ultimate-guitar.com/tab/frank-sinatra/my-way-chords-383263) | D, no capo; exact seed performance unknown. [Label's album reference](https://concord.com/concord-albums/frank-sinatra-my-way-40th-anniversary-edition/) distinguishes the 1969 album from later live renditions. | 77 BPM; 352 beats / 4:34.29; 179 strikes | Match / **DRIFT** / pass | Accepted 197-strike version reconstructed. Preserve the 0:36 correction; five off-source coda attacks remain at beats 324/328/340/344/348. Recording/coda alignment still needs review. |
| [Imagine](https://tabs.ultimate-guitar.com/tab/john-lennon/imagine-chords-9306) | C, no capo. Published page discusses added ninths and passing bass; exact seed performance unknown. [Artist recording reference](https://www.johnlennon.com/music/singles/imagine/). | 73 BPM; 224 beats / 3:04.11; 157 strikes | Match / **DRIFT** / pass | Accepted 166-strike version reconstructed. Nine repeats removed, 134 retained attacks have changed durations. Keep short intermediate harmonic changes; whether the new articulation is preferable is unjudged. |
| [Let It Be](https://tabs.ultimate-guitar.com/tab/the-beatles/let-it-be-chords-17427) | C, no capo; published descending bass/chord ladder retained. Exact seed performance unknown. [Official single-version reference](https://www.youtube.com/watch?v=atLK2RIZzWk) identified; album/single solo differences must not be conflated. | 70 BPM; 288 beats / 4:06.86; 255 strikes | Match / MATCH / **70% short-label warning** | Preserve owner-liked F–C/E–Dm7/Dm–C and C–Cmaj7/B–Am motion. Density warning does not justify deleting the ladders. |
| [Clocks](https://tabs.ultimate-guitar.com/tab/coldplay/clocks-chords-1085329) | D/Am/Em fingerings + capo 1 yield Eb/Bbm/Fm. App key metadata says A#m; this is not a verified tonal-center label. Exact seed performance unknown. [Artist video reference](https://www.coldplay.com/video/clocks/). | 130 BPM; **164 beats / 1:15.69 only**; 105 strikes | Match / MATCH / pass | Pinned low source stacks remain MIDI 51–65; RH-only ending reuses opening stacks. Missing original-song sections cannot be reviewed from this artifact. Do not claim full original-song coverage. |
| [Fix You](https://tabs.ultimate-guitar.com/tab/coldplay/fix-you-chords-202592) | Eb, no capo. Manifest identifies [TutorialsByHugo](https://youtu.be/9FJ-xBC81Z8), despite the old Katherine Cordova base ID. Tutorial identity/308 s metadata rechecked. | 68 BPM; **opening to beat 177.875 / 2:36.95 only**; 422 notes, 0 synthetic strikes | Match / MATCH / **28% clash-proxy warning** | Green chord and blue rhythm lanes preserved. Zero strikes is not silence. The source-backed excerpt can clash with its own highest-note proxy; no harmony edit follows from that score. Later section is available separately for review, never included as a golden example. |
| [I Will Survive](https://tabs.ultimate-guitar.com/tab/gloria-gaynor/i-will-survive-chords-154172) | Am, no capo; chart includes seventh/suspended harmony. Exact seed performance unknown. [Artist video reference](https://www.youtube.com/watch?v=vVzA0-QeGnI) identified. | 117 BPM; 388 beats / 3:18.97; 165 strikes | Match / MATCH / **26% clash-proxy warning** | Chord-only; no copied short-key layer. Free intro, source anticipations and final Am7 remain listening targets. Shared chord tones/sevenths can trigger the proxy; do not simplify them merely to pass. |
| [Those Were the Days](https://tabs.ultimate-guitar.com/tab/mary-hopkin/those-were-the-days-chords-81767) | Chart/app Am, no capo; 2/4 source grid. Exact seed performance unknown. [Label recording reference](https://www.youtube.com/watch?v=kXc5Oe_kj8k) identified; original recording key not remeasured. | 90 BPM; 344 beats / 3:49.33; 166 strikes | Match / MATCH / pass | Six first-refrain hits at beats 36/40/41/42/44/46; four refrain groups preserved. One bass + three RH notes; no copied Advanced bassline. |
| [The Winner Takes It All](https://tabs.ultimate-guitar.com/tab/abba/the-winner-takes-it-all-chords-18447) | Page explicitly instructs transposing its G shapes down one semitone to F#. Manifest identifies [TutorialsByHugo](https://youtu.be/WEXCHqCY4js), 308 s. [ABBA reference](https://www.youtube.com/watch?v=92cwKCU8Z5c). | 123 BPM; 592 beats / 4:48.78; 156 strikes | Match / MATCH / pass | Zero copied source notes versus 1,533 Advanced notes; played upper stacks inform compact voicings. Preserve the detailed 2:22–2:49 passage; physical keyboard review remains open. |
| [All of Me](https://tabs.ultimate-guitar.com/tab/john-legend/all-of-me-chords-2469556) | Em/C/G/D shapes + capo 1; sounding Fm/Db/Ab/Eb and richer chart extensions. [John Legend](https://youtu.be/450p7goxZqg), 307 s video; [Rousseau](https://youtu.be/b3E6E6hYSSI), 316 s cover, both metadata verified. | **126 BPM Chords**, 576 beats / 4:34.29; Advanced 129 BPM; 179 strikes | Match / MATCH / pass (tune proxies unavailable on chart-only payload) | Corrected evaluator now uses this separate clock rather than the cover. Prior post-0:45 correction retained. Fresh matched listening/recording onset measurements not performed. |
| [Help](https://tabs.ultimate-guitar.com/tab/the-beatles/help-chords-17269) | A, no capo; exact seed performance unknown. [Beatles 2015-remaster video](https://youtu.be/2Q_ZzBGPdqE), 139 s, metadata verified. | **190 BPM Chords**, 436 beats / 2:17.68; Advanced 173 BPM; 190 strikes | Match / MATCH / pass | No return of beat-10 Bm/A; eight authored A7 attacks retained. Old 0:54–0:59 source-clock discussion maps earlier on the accepted 190 BPM clock. |
| [Your Song](https://tabs.ultimate-guitar.com/tab/elton-john/your-song-chords-2323509) | C shapes + capo 3 → Eb. [The Theorist](https://youtu.be/JZ6uGVghbT8), 240 s, verified. [Owner-linked Elton video](https://youtu.be/CrznwpD-2tk), 242 s, is an NVNCBL upload, not Elton's official channel. | 129 BPM grid / 64.5 felt; 516 beats / 4:00; 101 strikes | Match / MATCH / pass | Prior section-dependent offsets remain unresolved and were not newly measured here. Do not halve BPM without remapping beats or transfer the earlier “alright” verdict to a retimed candidate. |

## Beginning, middle and ending anchors

These are **app event anchors**, not claimed matches to recording timestamps. Full event streams were inspected programmatically, not only these samples. The JSON ledger records exact values and the local comparison includes the whole available arrangement. Fix You's ending anchor is its last accepted onset, whose tail stops at the exclusive boundary.

| Song | Beginning beat → app time | Middle beat → app time | Last onset beat → app time |
| --- | --- | --- | --- |
| Skyfall | 8 → 0:06.400 | 180 → 2:24.000 | 356 → 4:44.800 |
| My Way | 8 → 0:06.234 | 176 → 2:17.143 | 348 → 4:31.169 |
| Imagine | 0 → 0:00 | 112 → 1:32.055 | 220 → 3:00.822 |
| Let It Be | 4 → 0:03.429 | 144 → 2:03.429 | 282 → 4:01.714 |
| Clocks | 0 → 0:00 | 82 → 0:37.846 | 160 → 1:13.846 |
| Fix You excerpt | 1.875 → 0:01.654 | 89.875 → 1:19.301 | 175.875 → 2:35.184 |
| I Will Survive | 8 → 0:04.103 | 194 → 1:39.487 | 379.5 → 3:14.615 |
| Those Were the Days | 8 → 0:05.333 | 172 → 1:54.667 | 342 → 3:48.000 |
| Winner | 0 → 0:00 | 296 → 2:24.390 | 585.5 → 4:45.610 |
| All of Me | 0 → 0:00 | 288 → 2:17.143 | 572 → 4:32.381 |
| Help | 4 → 0:01.263 | 220 → 1:09.474 | 432 → 2:16.421 |
| Your Song | 1.25 → 0:00.581 | 258.375 → 2:00.174 | 501.375 → 3:53.198 |

## Three drifts: cause and preserved comparison

Replayed the resolver from `9de3df545d9abb2d8a6c5c0691fdde9d6f6f06cb` (parent of `1e6d1337`) against the pinned current inputs. All three reconstructed outputs match the **full existing accepted SHA-256 digests**, not just strike counts. Their accepted playback is preserved alongside current playback in ignored local output; no index repinning occurred.

| Song | Accepted → current strikes | Removed / added attacks | Changed durations at retained attacks | Changed pitches at retained attacks |
| --- | ---: | ---: | ---: | ---: |
| Skyfall | 223 → 206 | 22 / 5 | 93 | 0 |
| My Way | 197 → 179 | 26 / 8 | 129 | 0 |
| Imagine | 166 → 157 | 9 / 0 | 134 | 0 |

`1e6d1337` changed shared `sourceRhythmStrikes`: it rejects some isolated non-root/held-stack re-strikes, suppresses some held-stack barline fills, and permits quarter-beat release gaps. Filtering can also change which subsequent onset satisfies spacing, explaining added attacks as well as removals. The current and accepted pitch arrays agree at retained beats; deleted/added beats still change audible phrasing. This is a technical characterization, not a preference for the candidate. All three accepted reconstructions are retained; the later candidates remain unrepinned. No additional owner listening is requested.

## Audit corrections implemented

1. `evaluate-all-song-chords.mts` now loads the same `getSongDetail(...).chordData ?? data` payload as Player. Previously it called `loadSongArtifact` plus `withChordSources`, bypassing the reviewed All of Me/Help clocks. Verified current outputs are All of Me 126 BPM / 576 beats / 179 strikes and Help 190 BPM / 436 beats / 190 strikes.
2. `audit-golden-chords.mts` retains every accepted digest and separately reports a symbolic playback observation covering the clock and both note/chord streams. Legacy full-song hashes omit the clock and source-note stream. A new optional private export makes those omissions visible and allows cross-run comparisons; it does **not** retrospectively certify or replace acceptance. The audit also rejects a Player-level Chords-unavailable reason.
3. The snapshot helper clips both streams at the excerpt boundary without mutating the source. Its regression test detects changed clocks and source notes, preserves exclusion of later notes, and rejects invalid boundaries. No playback, voicing, rhythm, source artifact, or upload behavior was modified.

## Verification and previews

- 49 focused web tests passed across `chords-evaluation`, `catalog-api`, and `chords-backing`; workspace typecheck passed. The new snapshot regression failed before the helper existed and passed after implementation.
- Golden replay: **9 MATCH, 3 DRIFT**; `--require-match` exits 1 intentionally. Two executions produce byte-identical JSONL, including the observed playback hashes. Timestamped private exports are kept separately from deterministic rows.
- All 18 checked-in timeline artifacts validate. `verify-chord-sources` as a whole **fails** its catalog sweep because this is a partial snapshot; do not report the command as passed. The full 459-row evaluator likewise records 447 unavailable inputs.
- Full default Player evaluator: 10/12 heuristic passes. Golden-scoped metrics: 9/12 passes, with Let It Be's density and I Will Survive/Fix You's clash warnings. The difference is Fix You's excerpt versus its full arrangement. All of Me's empty source-note stream makes tune-agreement proxies unavailable, not perfect.
- A deterministic 60 Hz transport simulation fed all 12 current streams and 3 reconstructed baselines into the actual `PlaybackEngine`. Every scheduled note/chord matched the expected event stream; no tested chord duration hit the sampled-audio 0.2–8 s clamp. This checks scheduling under regular ticks, not background-tab behavior, audible timbre, or human playability.
- All 12 `/api/songs/{baseId}-a` endpoints returned 200 and the expected current clock/chart. The comparison UI loaded all 12 selections, and actual sampler playback advanced in the browser. The full Skyfall Player rendered and selected Chords → Bass + chords. Browser playback was not heard by the agent.
- Local comparison: **http://127.0.0.1:3112/**. Select Current Chords, Accepted Chords (three drifts only), or Advanced. Fix You defaults to its accepted excerpt; its full Chords option is explicitly outside the corpus after the cutoff. Full app: **http://127.0.0.1:3111/**. Servers bind loopback only.
- The comparison imports the app's `PlaybackEngine`, `SamplerAudioEngine`, `resolveTimedNotes` and default settings. Raw private JSON and generated browser bundle live in ignored `output/golden-audit/listening`. Playback can fall back to the app's synth if sample loading fails; keep the tab visible. Do not publish this directory.

Reproduce the deterministic audit from this checkout on Node 22, with a privately transferred and identity-verified snapshot:

```sh
export KEYSPILLI_DATA_DIR="$PWD/output/golden-audit/data"
./node_modules/.bin/tsx apps/web/scripts/audit-golden-chords.mts --output-dir output/golden-audit/current
./node_modules/.bin/tsx apps/web/scripts/audit-golden-chords.mts --require-match
./node_modules/.bin/tsx apps/web/scripts/evaluate-all-song-chords.mts --rows
npm test -w @keyspilli/web -- src/lib/chords-evaluation.test.ts src/lib/catalog-api.test.ts src/components/player/chords-backing.test.ts
npm run typecheck
```

Local-only reconstruction and transport scripts are `output/golden-audit/compare.mts` and `check-engine.mts`; the former requires the historical resolver extracted with `git show 9de3df54:packages/player-core/src/accompaniment.ts`. Their licensed source-derived outputs are deliberately absent from Git. Original/revised symbolic hashes and source pins are in the committed JSON ledger. This PR alone does not transfer the private playback corpus.

## Rules, failures and automation boundary

- Keep clock, harmonic labels, strike positions, releases, voicing and source roles separate. A source/chart pin alone cannot identify the played result.
- Apply explicit capo/transposition before comparison. Winner's page even specifies a transposition distinct from the displayed key metadata; Clocks' metadata is not its sounding harmonic description.
- Treat a full available artifact and a full original performance as different coverage claims. Record source performance identity rather than inferring it from a catalog title/base ID.
- Preserve short harmonically meaningful ladders, refrain articulations, source-backed exceptions and purposeful rests. A dense-label or semitone proxy is not authority to overwrite a heard arrangement.
- Do not equate a simultaneous stack, left-hand label, or high proxy score with accompaniment role or comfortable fingering. The measured RH spans reach 11 semitones on several backings; Fix You has octave spans and a 17-semitone LH representative leap. Independent pianist/teacher assessment is still required.
- Keep Kings & Queens, Dreamer and Journey outside calibration. Fix You's later section stays outside; Clocks' original-song coverage remains incomplete.

Read-only tracing confirms the existing extension points: MIDI/MusicXML/MXL upload → `ingestSource` → `buildVariants`; the worker's transcription/tutorial/native-MIDI routes also call `ingestSource`. `buildVariants` already integrates variable source tempos onto its scalar playback grid. At load time `prepareGeneratedChordData` calls `inferHarmonyTimeline` for Advanced generated labels, then source selection and `replayChordsBacking`/`resolveAccompaniment` construct Chords. No second variant system is needed.

**Limits of this audit checkpoint:** matched recording/cover onset and chroma comparisons across all sections, agent hearing of final previews, exact seed performance identities, and independent keyboard assessment were not established. These are not being handed back to the owner as another listening task. The [follow-up implementation and test ledger](chords-upload-automation-2026-09-27.md) records subsequent automatic fallback, uncertainty UI, unseen-song evaluation and ingest-to-Player/idempotency work, including its failed musical release threshold. Acceptance pins remain unchanged. No merge, deploy or production mutation occurred.
