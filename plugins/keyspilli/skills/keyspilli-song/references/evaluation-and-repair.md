# Maintained evaluation and repair workflow

Inspected and exercised 2026-09-27 on `codex/chords-golden-audit` (draft PR #110). These commands are not assumed present in main or production. Run from a capable checkout root with its pinned Node/tsx. Reuse preflight's absolute `node_executable` with `--import tsx` for the scripts below; a tsx shebang or a later bare `node` can select another ABI. Never repair an accepted digest to silence a regression.

## Resumable host preparation

Prefer this path when preflight reports `host_workflow.status: compatible`. Discovery reads existing worktrees, checks the Node/SQLite runtime and compares the driver's implementation hash with an independent file fingerprint. It does not change branches or certify music.

Use actual file pins in a request (replace these example paths/hashes, never invent them):

```json
{
  "schemaVersion": 1,
  "title": "TITLE", "artist": "ARTIST", "decisionMode": "baseline",
  "source": {"path": "/absolute/source.mid", "sha256": "actual 64-character SHA256"},
  "soundfont": {"path": "/absolute/sampled-grand.sf2", "sha256": "actual 64-character SHA256"},
  "instructionPin": {"path": "/absolute/loaded-skill/SKILL.md", "sha256": "actual 64-character SHA256"}
}
```

Compute pins with the existing host tools, for example `shasum -a 256 /absolute/source.mid`. MIDI intake is bounded to 16 MiB. Native MusicXML/MXL still uses ordinary intake below; do not relabel it as MIDI. Baseline uses no model and preserves the input; unqualified harmony uses the ordinary inferred backing engine. This is an engineering baseline, not a source-confirmed arrangement.

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/song-workflow.mts prepare /absolute/request.json output/song-prep/NEW-RUN
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/song-workflow.mts respond output/song-prep/NEW-RUN SPAN_ID /absolute/response.json
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/song-workflow.mts resume output/song-prep/NEW-RUN
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/song-workflow.mts verify output/song-prep/NEW-RUN
```

`plan` additionally accepts pinned v2 `evidence` and actual `referenceAssets`; each response is one strict ArrangementPlan for its owned span. `selection` requires pinned `referenceCorpus` plus `referenceCaseId`; each response selects a finite choice ID from that span's packet. Use the existing reference checker to prepare these facts. Known source-confirmed no-chord phrases are handled by the host even while Original sounds; source authority is never a model field.

Read `workflow.json.pending` and each listed `SPAN_ID/decision-packet.json` (maximum 512 events/32 KiB). Return only the declared response schema. `respond` retains the initial response and at most two repairs, with precise validation errors; no new orchestration code or binary MIDI generation is needed. Submitted files do not prove a model call: comparisons additionally require independently verified exact session route/effort and final-turn receipts.

Copy each actual pending ID exactly; an interface/arm label such as `A` is not a span ID. A plan's sounding chord uses `sourceKind:"inferred",inferred:true`; unknown silent harmony uses `name:"N.C.",notes:[],sourceKind:"unknown",inferred:false` with its actual bounds/evidence IDs. The host derives unresolved warnings even if the response has `unresolved:[]`. Never apply the sounding-chord provenance recipe to N.C. Confirmed source rests are owned and authenticated by the host, not by a model claim.

The host writes compiled source/lineage, warnings, six-tier portable bundle, second isolated installation, protected-event audit, checked Player replay, actual Original/Chords MP3s and `index.html`. Its finite local stages resume without reissuing model/audio requests. Interrupted owned directories are preserved and deterministic stage retries are bounded. `verify` checks existing pins and completed imports without advancing unfinished stages. Changed source, evidence, code or pinned instructions requires a new run. A missing bank keeps the useful prepared bundle `review-required` (exit 2); other failures remain `blocked` with receipts. `complete` means the provisional artifacts exist, never musical readiness. Retain the entire run and its actual inputs; see the musical gate for independent listening/keyboard requirements.

## Intake and preparation

For a bare YouTube URL, resolve metadata first with the installed `yt-dlp --dump-single-json --skip-download --no-playlist URL`, using a bounded timeout/retry. Read title, uploader and duration; uploader is not necessarily composer or original artist. Record the target cover/performance. Supply the resolved artist/title/version to `research:song`. The underlying research CLI's bare-URL fallback uses placeholder metadata; that fallback is not successful identity resolution. A title search returns source leads, not acquired musical bytes. Continue acquisition through the existing implementation map.

Once the source has been arranged into suitable symbolic piano input:

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/prepare-song.mts \
  /absolute/source.mid output/song-prep/NEW-RUN 'TITLE' 'ARTIST'
```

Accepts MIDI/MusicXML/MXL via `ingestSource`. Creates six variants under the exact upload-byte hash base ID, prepared backing, MIDI/XML, diagnoses, a portable bundle, and a second isolated installation. Re-import proves musical idempotence. The existing source/learner arrangement logic still needs musical assessment; this command deliberately writes `provisional`.

Original exports are `bundle/artifacts/a/variant.mid` and `variant.xml`; Chords exports are `bundle/chords.mid` and `chords.musicxml`. Export aliases may be supplied for convenience. `bundle.json` pins every file, complete six-level publication and exact Player snapshot. Keep the directory intact.

For the existing catalog, use the implementation map's frozen inventory/snapshot and append `--repair` to `prepare-catalog-chords.mts`. Existing mapped backings and explicit `harmonizations.json` overrides are preserved. Repair only tries bass/stack-anchored harmony windows; it retains a candidate only with a material improvement in sounding LH support and no measured dead-air, clash, duplicate-attack or wide-hand regression. It does not invent chart evidence. One rejected proposal is a stopping condition for that automatic method; the agent may pursue a different source-backed correction.

`diagnosis.json` records actual beat/second intervals for duplicate attacks, hand spans, semitone proxies and unsupported spans. `repair.json` preserves before/after evidence and rejection reason. Do not classify all semitone findings as wrong notes: inspect reference harmony, passing tones and suspensions. Record any explained proxy in the run's assessment with the exact finding interval, source hash/URL and musical reason. Leave unproven cases unresolved. No numeric coverage target establishes pleasant sound.

Prepared `inferred/learner-harmonization` events use the existing bass/voicing engine and preserve whole-source rests of at least half a beat. Phrase entrances resume at their actual offbeat position. This is a bounded heuristic, not formal phrase recognition; inspect long cadences, pedal resonance, rubato and sparse melody-only sections. The provenance stays inferred.

## Audio verification

```sh
KEYSPILLI_SOUNDFONT=/installed/piano.sf2 "$KEYSPILLI_NODE" --import tsx \
  apps/web/scripts/render-prepared-chords.mts output/RUN/prepared
# Optional: BASE_ID --mode original|chords|both. Original/both additionally require
# KEYSPILLI_DATA_DIR pointing at the actual prepared source catalog.
```

The command checks raw clipping before normalization, retries lower gain at most twice, checks non-silence/full duration, hashes the inputs and MP3, and deletes bounded scratch WAVs. The shared renderer reads samples in place instead of building an expanding JS number array; still allow memory for the WAV buffers. Check free disk before long batches. SF2 timbre is not the app sampler, although note events come from actual Player scheduling.

For Reidar's piano previews, a sampled acoustic grand is installed at `/Users/reidar/.local/share/keyspilli/soundfonts/SalamanderGrandPiano-SF2-V3+20200602/SalamanderGrandPiano-V3+20200602.sf2` ([FreePats source](https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html), Alexander Holm, CC BY 3.0). Check the file and hash before use. It is about 1.2 GB unpacked: render it with the existing FluidSynth CLI and FFmpeg rather than loading the entire bank through the JS renderer. Measure the WAV peak, apply a fixed gain with headroom during MP3 encoding, then verify decoding, duration, non-silence, clipping and hashes. Keep MIDI unchanged when only replacing preview timbre. On another host, choose a licensed sampled acoustic piano bank and record its identity; do not substitute an electronic piano or generic synth for a requested piano preview.

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
![Original piano preview](/absolute/delivery/original-preview.mp3)

Chords — backing-only piano preview
![Chords backing preview](/absolute/delivery/chords-preview.mp3)
```

Replace the example paths with real files. Previews that exist only in a folder or manifest have not been surfaced to the user. Keep MIDI/MusicXML downloads, mode statuses, the tested import command and material limitations below the players. Preserve provisional statuses; embedding audio does not mean the agent listened. Never require installation, a terminal command or another application merely to hear a prepared song. If this surface cannot embed audio, provide and verify an accessible player page using existing local preview tooling.

After previews for a ready song, add the approval follow-up described in [approval and publication](approval-and-publication.md). Bind its prompt to the actual delivery path and manifest/bundle hashes. For provisional/blocked songs, report the remaining evidence and continue repairs where possible; do not replace agent review with an owner listening assignment or offer default publication approval. Once publication is already authorized, execute it and return the verified live player link instead of offering another approval action.

For catalog batches, provide a browsable playback index with labeled per-song players using existing preview tooling; avoid hundreds of inline embeds. Verify the index points to the delivered audio and surface its link in the final response.

Do not end at a plan, ask for another listening pass, or claim any live upload that was not performed.

For the optional raw-acoustic/model comparison workflow and isolated repair
previews, see [music review support](music-review-workflow.md). Its reports remain
diagnostic; the existing human-only source, listening and keyboard gates apply.
