# Maintained evaluation and repair workflow

The default is the ordinary supported `prepare-song.mts` route returned by preflight. Run from its selected checkout with its absolute Node executable and `--import tsx`. Do not repin an accepted digest to silence a regression. The [experimental host workflow](experimental-host-workflow.md) is optional and loads only when its matching capability is present and the task needs it.

## Intake and preparation

For a bare YouTube URL, resolve metadata first with the installed `yt-dlp --dump-single-json --skip-download --no-playlist URL`, using a bounded timeout/retry. Read title, uploader and duration; uploader is not necessarily composer or original artist. Record the target cover/performance. Supply the resolved artist/title/version to `research:song`. The underlying research CLI's bare-URL fallback uses placeholder metadata; that fallback is not successful identity resolution. A title search returns source leads, not acquired musical bytes. Continue acquisition through the existing implementation map.

Once the source has been arranged into suitable symbolic piano input:

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/prepare-song.mts \
  /absolute/source.mid output/song-prep/NEW-RUN 'TITLE' 'ARTIST'
```

Accepts MIDI/MusicXML/MXL via `ingestSource`. Creates six variants under the exact upload-byte hash base ID, prepared backing, MIDI/XML, diagnoses, a portable bundle, and a second isolated installation. Re-import proves musical idempotence. The existing source/learner arrangement logic still needs musical assessment; this command deliberately writes `provisional`.

For explicitly selected source events that must survive ordinary reduction,
use the optional [phrase protection pilot](phrase-protection.md) when its
inspector is present. Inspect exact source bytes first, review the uncertain
roles, and supply the selected plan with `--phrase-plan FILE`. Its preservation
report is separate from source-role accuracy and full musical acceptance.

Original exports are `bundle/artifacts/a/variant.mid` and `variant.xml`; Chords exports are `bundle/chords.mid` and `chords.musicxml`. Export aliases may be supplied for convenience. `bundle.json` pins every file, complete six-level publication and exact Player snapshot. Keep the directory intact.

For the existing catalog, use the implementation map's frozen inventory/snapshot and append `--repair` to `prepare-catalog-chords.mts`. Existing mapped backings and explicit `harmonizations.json` overrides are preserved. Repair only tries bass/stack-anchored harmony windows; it retains a candidate only with a material improvement in sounding LH support and no measured dead-air, clash, duplicate-attack or wide-hand regression. It does not invent chart evidence. One rejected proposal is a stopping condition for that automatic method; the agent may pursue a different source-backed correction.

`diagnosis.json` records actual beat/second intervals for duplicate attacks, hand spans, semitone proxies and unsupported spans. `repair.json` preserves before/after evidence and rejection reason. Do not classify all semitone findings as wrong notes: inspect reference harmony, passing tones and suspensions. Record any explained proxy in the run's assessment with the exact finding interval, source hash/URL and musical reason. Leave unproven cases unresolved. No numeric coverage target establishes pleasant sound.

Prepared `inferred/learner-harmonization` events use the existing bass/voicing engine and preserve whole-source rests of at least half a beat. Phrase entrances resume at their actual offbeat position. This is a bounded heuristic, not formal phrase recognition; inspect long cadences, pedal resonance, rubato and sparse melody-only sections. The provenance stays inferred.

## Audio verification

```sh
KEYSPILLI_SOUNDFONT=/installed/piano.sf2 "$KEYSPILLI_NODE" --import tsx \
  apps/web/scripts/render-prepared-chords.mts output/RUN/prepared
# Optional: BASE_ID filters the prepared Chords batch. This command renders Chords only.
```

This command renders Chords only. It checks raw clipping before normalization, retries lower gain at most twice, checks non-silence/full duration, hashes inputs and MP3, and deletes bounded scratch WAVs. The shared renderer reads samples in place; still allow memory for WAV buffers. Check free disk before long batches. SF2 timbre is not the app sampler, although note events come from actual Player scheduling.

For Original, use the existing FluidSynth CLI adapter on the exact exported MIDI:

```sh
"$KEYSPILLI_NODE" --import tsx packages/catalog/scripts/render-midi.ts \
  --input /absolute/original.mid --output /absolute/NEW-original.wav \
  --soundfont /installed/piano.sf2 --gain 0.2
```

Its implemented `--help` reports renderer options. FluidSynth and the selected bank are optional runtime dependencies. Record a preview blocker if they are unavailable; neither renderer implies that listening or musical acceptance occurred.

For sampled acoustic piano previews, select the licensed bank explicitly with `KEYSPILLI_SOUNDFONT` and retain its hash. The Salamander Grand Piano is an available option ([FreePats source](https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html), Alexander Holm, CC BY 3.0). It is about 1.2 GB unpacked: render it with the existing FluidSynth CLI and FFmpeg rather than loading the entire bank through the JS renderer. Measure the WAV peak, apply a fixed gain with headroom during MP3 encoding, then verify decoding, duration, non-silence, clipping and hashes. Keep MIDI unchanged when only replacing preview timbre. Choose a licensed sampled acoustic piano bank on each host and record its identity; do not substitute an electronic piano or generic synth for a requested piano preview.

For optional listening triage, use the maintained [pairwise Anti review procedure](audio-listening-review.md). It replaces the retired three-stream Google-specific runner contract. Do not set provider credentials in the environment or infer audio token usage. A synthetic control pack is not a song review or calibration result. Keep the current report, pinned evidence and matching manifest together; changed playback, source, prompt, helper or route requires a new run.

## Portable, reversible local import

```sh
KEYSPILLI_DATA_DIR=/absolute/staging-data "$KEYSPILLI_NODE" --import tsx \
  apps/web/scripts/song-bundle.mts pack BASE_ID output/RUN/prepared output/RUN/bundle
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/song-bundle.mts install output/RUN/bundle output/NEW-CATALOG
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/song-bundle.mts verify output/RUN/bundle output/NEW-CATALOG
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/song-bundle.mts rollback output/RUN/bundle output/NEW-CATALOG
```

Installation is intentionally an **isolated offline catalog** inside the checkout, not a production updater or a browser ZIP upload. It refuses unrelated existing contents, uses the existing strict publisher/reconciliation/SQLite functions, installs repository-relative chart paths, and verifies both modes in a fresh process. All Original artifact hashes and musical clocks/notes must remain exact; harmony metadata legitimately changes with the attached map. Re-installation of the same verified package does not change music. Changed bytes, stale playback or an incompatible loader fail explicitly.

Rollback checks package ownership and renames the isolated installation to a digest-named backup, preserving all bytes. It must remain usable when newer playback code rejects an older package. A publication interrupted after file swap retains the existing reconciliation journal; inspect that journal before resuming. Do not activate a running app against this staging catalog without the user's actual deployment authorization.

## Forward tests and durable learnings

Optional source-linked edits use [the constrained phrase recipe](constrained-arrangement.md) when `arrange-song.mts` is present. It validates before export and supplies an exact-input harmonization override to `prepare-song.mts`. The raw-source transformation receipt is separate from compiled-input retention; test the tutorial gate against the compiled MIDI actually ingested. Unknown/ambiguous roles and harmony remain unresolved. Run the constrained recipe's delivery audit on the actual exported Advanced and second-install MIDI: source-origin counts alone miss changed attacks/releases. An audit failure stays review-required. Valid JSON, origin hashes, import and acoustic-piano rendering do not establish musical quality.

Keep generation/tuning examples separate from evaluation. Record input hashes, acquisition evidence, expected source identity, real route taken, clock changes, note retention, import/playback results, and musical limitations. A title, URL, MIDI, XML, monophonic source and variable-tempo source must exercise their real paths; a mocked URL or a generated fixture is not a real acquisition test.

The catalog is regression material after tuning. The new Mutopia Pathétique input had six tempo events: elapsed duration survived within 0.057 seconds, but Advanced retained 3,128 of 4,285 input notes. This is not proof of melody preservation; slow calibration tempo with fast sections needs note/phrase inspection before calling Original ready. Monophonic Nyan Cat imports/export/replay successfully but generic harmonization remains provisional; use actual source-specific harmonic evidence rather than claiming recovered harmony.

Research basis: [Gemini audio input and timestamp support](https://ai.google.dev/gemini-api/docs/generate-content/audio), [mir_eval's separate root/quality/inversion/segmentation metrics](https://mir-eval.readthedocs.io/latest/api/chord.html), [the real public-domain forward MIDI source](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=299). None certifies subjective arrangement quality.

## Deliver a usable package

For a new song, produce the directory below. For an existing-song Chords batch, preserve Original in place and deliver Chords exports, the merged source map, timelines, receipts and a tested activation command against the existing catalog; omit redundant Original exports and empty-database re-ingestion.

Produce a final directory containing:

- `original.mid` and `original.musicxml` — the full piano arrangement exported from the tested ingest path.
- `chords.mid` and `chords.musicxml` — the realized backing, including both note and chord-event streams. Labels alone are not playable backing.
- A normalized chord timeline, provenance/source mapping, and any actual source input required to reproduce this result. Preserve the distinction between inferred and authored evidence.
- `import.mts` (or an existing supported equivalent) and a short exact import command, tested against a second empty local data directory. It must create **one song with Original and Chords modes**, preserve the prepared harmony, and leave unrelated songs alone. Include required version/capability and configuration details; do not leave the user to implement the integration.
- `manifest.json` with requested/selected source identity, hashes, artifact roles, relevant repo SHA, clocks/keys, generation settings, validation results and unresolved issues, including the tutorial gate receipt when applicable. Mark each mode `ready`, `provisional`, or `blocked`; ready requires actual tested import compatibility and no known material musical defect. Describe readiness as agent-checked, never independently certified.
- Full-song `original-preview.mp3` and `chords-preview.mp3` (or supported WAV equivalents), rendered from the delivered modes using the existing renderer. Reuse verified previews when their input hashes still match. Verify each file exists, decodes, is non-silent, covers the intended duration and matches its manifest hash. Keep the modes clearly labeled. For piano previews, use a sampled acoustic piano SoundFont rather than an electronic/synth patch; verify the MIDI preset and record the bank identity and hash. Honor an explicit timbre preference. If only the timbre changes, rerender the MP3s from the same MIDI and update their receipts and hashes. A piano SoundFont preview need not use the app's exact sampler. Playable previews are part of the delivery, not a listening assignment or proof of musical acceptance. If rendering is genuinely unavailable, report the precise playback blocker and an incomplete preview delivery; do not silently fall back to MIDI-only completion.

Keyspilli's raw upload accepts MIDI/MusicXML/MXL. A ZIP is a transport archive, not a supported upload format. Uploading `chords.mid` separately normally creates another song; it does **not** attach that backing to Original. The tested import recipe must bridge this explicitly. If the target cannot represent the prepared backing, explain the precise compatibility gap and mark that mode provisional rather than claiming upload readiness.

## Playback-first completion

For a single song, lead the final response with the chosen song/version and two playable audio embeds, labeled Original and Chords. In the Codex desktop app, use Markdown image syntax with verified absolute audio paths (ordinary MIDI or MP3 download links do not provide the same inline player):

```markdown
Original — piano preview
![Original piano preview](sandbox:/absolute/delivery/original-preview.mp3)

Chords — backing-only piano preview
![Chords backing preview](sandbox:/absolute/delivery/chords-preview.mp3)
```

Replace the example paths with real files. Previews that exist only in a folder or manifest have not been surfaced to the user. Keep MIDI/MusicXML downloads, mode statuses, the tested import command and material limitations below the players. Preserve provisional statuses; embedding audio does not mean the agent listened. Never require installation, a terminal command or another application merely to hear a prepared song. If this surface cannot embed audio, provide and verify an accessible player page using existing local preview tooling.

After previews for a ready song, add the approval follow-up described in [approval and publication](approval-and-publication.md). Bind its prompt to the actual delivery path and manifest/bundle hashes. For provisional/blocked songs, report the remaining evidence and continue repairs where possible; do not replace agent review with an owner listening assignment or offer default publication approval. Once publication is already authorized, execute it and return the verified live player link instead of offering another approval action.

For catalog batches, provide a browsable playback index with labeled per-song players using existing preview tooling; avoid hundreds of inline embeds. Verify the index points to the delivered audio and surface its link in the final response.

Do not end at a plan, ask for another listening pass, or claim any live upload that was not performed.

For the optional raw-acoustic/model comparison workflow and isolated repair
previews, see [music review support](music-review-workflow.md). Its reports remain
diagnostic; the existing human-only source, listening and keyboard gates apply.
