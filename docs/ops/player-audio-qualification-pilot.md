# Player audio qualification pilot corpus

This pilot freezes 24 pairwise tasks and keeps its answer key separate from reviewer inputs. The corpus is self-authored synthetic material derived from the existing `audio-review-demo-20261003/demo/note-events.json` study fixture. It is one phrase family with excerpts and deliberate mutations; it is not a real-song set, an aesthetic gold set, or evidence that any route can approve music automatically.

## Rebuild and capture

From the repository root, use the checkout's Node 22 runtime:

```sh
export KEYSPILLI_PLAYER_CORPUS_SOURCE_MIDI=output/song-prep/audio-review-demo-20261003/demo/note-events.json
export KEYSPILLI_PLAYER_CORPUS_SPEECH_1=/absolute/path/to/authored-speech/speech-1.wav
export KEYSPILLI_PLAYER_CORPUS_SPEECH_2=/absolute/path/to/authored-speech/speech-2.wav
node apps/web/scripts/build-player-qualification-corpus.mjs --output-dir output/song-prep/player-qualification-20261003
cd apps/web
../../node_modules/.bin/playwright test --config playwright.player-corpus.config.ts
cd ../..
node apps/web/scripts/finalize-player-qualification-corpus.mjs
node apps/web/scripts/create-player-qualification-preview.mjs
```

The source note-event file and both synthetic speech controls are required inputs. Pass them through `KEYSPILLI_PLAYER_CORPUS_SOURCE_MIDI`, `KEYSPILLI_PLAYER_CORPUS_SPEECH_1`, and `KEYSPILLI_PLAYER_CORPUS_SPEECH_2`, or the corresponding `--source-midi`, `--speech-1`, and `--speech-2` options. Relative paths resolve from the repository root. `--output-dir` / `KEYSPILLI_PLAYER_CORPUS_RUN` selects the output directory. If using a custom output directory, set `KEYSPILLI_PLAYER_CORPUS_RUN` to the same path for Playwright, finalization, and preview generation. The run is written under ignored `output/song-prep/player-qualification-20261003/` by default. The Playwright config creates a fresh temporary catalog and artifact tree, starts a dedicated local web server, and removes only that exact scratch directory on teardown. It does not use or alter the primary catalog.

To rebuild the offline audio page after capture and finalization, run the last command above. It checks every WAV against the model-facing manifest and writes `model-facing/preview.html`; the page shows only pair number and mode, and omits fault/control labels and the evaluator key. Open the page in a local browser. It makes no provider request.

Normal Playwright discovery is safe without generated ignored files: the corpus test opts out before reading fixtures unless the dedicated `playwright.player-corpus.config.ts` explicitly enables it. That dedicated config still requires a previously generated fixture bundle.

The E2E probe taps the final output of the actual Player Web Audio graph, writes mono PCM16 WAV directly, and records buffer-source scheduled times and hashes of the loaded `smplr` SplendidGrandPiano OGG responses. The capture gate requires non-silent unclipped PCM, actual sampler buffer starts, no oscillator fallback, and one-to-one bus-specific onset groups after a single per-bus capture-clock offset; each onset residual and the initial offset must be at most 150 ms. Same-time sample-layer starts within 25 ms form one attack group. Fixture notes are sorted by start beat and MIDI pitch before the Player handoff because its scheduler uses binary search. The Player defaults are pinned at voice gain 1.0, backing gain 0.4, compressor threshold -24 dB, knee 12 dB, ratio 3:1, attack 5 ms, release 150 ms; the corpus also records sample rate, duration, output peak/RMS, sampled-buffer starts with their bus/context, and per-response SHA-256.

The audio bank is the app's existing `smplr` `SplendidGrandPiano` instrument (Steinway samples, four velocity layers), whose source set is distributed by [smpldsnds](https://github.com/smpldsnds) and identified by the [SplendidGrandPiano source project](https://github.com/sfzinstruments/SplendidGrandPiano). This is not Salamander. Each actual fetched response used by a clip is pinned in its capture receipt.

## Frozen task shape

- Eight clean comparisons: four Original pairs and four Chords tasks. The Chords references are full Original Player captures; their candidates are actual Player Chords captures with the lead removed.
- Eight one-mutation comparisons: two wrong-note, two rhythm, two locally missing-melody, and two locally intrusive-backing variants. Each evaluator entry freezes its clip-local target interval and pitch/time mutation.
- Eight controls: the four mandatory gates below, an identical pair, contour contrast, repeated attack versus held note, and major versus minor triad.

Mandatory gates are **MISSING AUDIO**, **PIANO versus SILENCE**, **UNRELATED SPEECH**, and **SWAPPED ORDER**. Missing audio has an empty `audioPaths` array for a pre-read-free consult. The silence and two locally generated speech files are explicitly non-Player controls; speech files carry their approved generator provenance. The other musical controls are captured by the Player sampler.

`model-facing/cases.json` contains only opaque case IDs, mode, and attachment paths with SHA-256 and duration pins (except the empty missing-audio case). Keep `evaluator-only/answer-key.json`, the capture fixture bundle, and `capture-receipts/` out of reviewer context. Model-facing audio filenames are content hashes. Source notes, mutation labels, and expected windows stay evaluator-only.

The exploratory screen is: all four mandatory gates pass, at least 7/8 controls correct, zero unsupported defect claims on the eight clean pairs, and at least 6/8 seeded faults correctly identified and localized. Each seeded fault records both its onset-only window and its full affected span after the production Chords resolver. A correct full-span finding remains grounded detection; if its width exceeds the claim-width cap, it receives no localization credit, not an unsupported-claim or fault-miss label. The cap is `min(5 seconds, 25% of the final candidate PCM duration)` and is computed during finalization from the pinned audio. These are development screens on a small correlated synthetic set, not broad accuracy or production qualification.

The frozen study stopped at its first mandatory gate, `g-missing-audio`. The one response made audible claims while zero audio was attached; the native grade failed the gate. The remaining tasks were not sent, so the exploratory thresholds were not evaluated and there is no paired-comparison result. The route remains unqualified. Do not retry this study, change the default review prompt, or infer that empty findings mean approval. The saved Player WAVs are available for offline human comparison; see the [stop receipts](player-audio-qualification-study-stop.md) and [user playback package](/Users/reidar/Projectos/anti-keyspilli-player-study-20261003/README.md).

## Provenance boundary

The original input was authored specifically for the existing workflow fixture. Derived note edits are deterministic test controls, not independent compositions. The speech clips are synthetic macOS speech with separately recorded generator arguments and PCM/hash receipts; they contain no private voice. Silence is zero-valued PCM16. Do not describe any of these controls as human-performed recordings, real songs, independently approved arrangements, or user acceptance evidence. The fixture builder asserts exactly 24 tasks split into 8 clean, 8 known-fault, and 8 control cases. Both Original and Chords onset pilots passed, then all 40 unique Player clips passed sampled-asset, bus-specific onset, clock, PCM, and hash checks. The corpus preceded the stopped provider study; its failed mandatory-gate grade is documented separately.
