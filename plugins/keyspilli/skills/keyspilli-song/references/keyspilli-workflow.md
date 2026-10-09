# Keyspilli implementation map

Source inspected on 2026-09-27 in a capable local checkout. Re-read the relevant definitions at the checkout used for the run: some capabilities may be unmerged or absent in production. Do not switch branches, deploy, or rewrite accepted catalog work merely to make this map match.

## Capable checkout

Run the loaded skill's `check_checkout.py CHECKOUT --node /absolute/node --discover`. Use its returned checkout/runtime; the host workflow must report a matching implementation/schema fingerprint. Preserve primary WIP. Ambiguous candidates require an explicit compatible path. The [resumable driver](evaluation-and-repair.md#resumable-host-preparation) is the preferred local MIDI path; ordinary preparation remains supported after its own successful preflight.

## Acquisition

From the repository root, inspect each script before executing. Use the installed runtime/tsx; do not install a parallel toolchain by default.

```sh
npm run research:song -- --artist 'ARTIST' --title 'TITLE' --out '/absolute/run/research.json'
npm run research:song -- --url 'YOUTUBE_URL' --artist 'ARTIST' --title 'TITLE' --out '/absolute/run/research.json'
```

`packages/catalog/scripts/research-song.ts` supports repeatable `--candidate FILE`, `--reference FILE`, and `--no-network`. A URL without artist/title may produce a metadata-limited report. Its human-verdict options are for real prior human decisions; never use them to turn an agent assessment into acceptance. Protected evaluation/reference bytes must stay out of generation candidates.

Relevant acquisition implementations:

| Route | Existing implementation and boundary |
| --- | --- |
| Native symbolic | `services/transcribe/src/automatic-symbolic.ts`: `loadAutomaticSourceIndex`, `resolveAutomaticSymbolic`; verified source index requires recording identity, content hash and license evidence. An unverified search hit is not an index entry. |
| Piano tutorial | `services/transcribe/src/tutorial-route.ts`: `resolveTutorialLink`. `services/transcribe/scripts/prove-tutorial-link.ts URL WORKDIR` is a CLI wrapper. Inspect its result/receipt and completeness; a local candidate status is not musical acceptance. |
| Audio transcription | Follow `services/transcribe/src/worker.ts` for acquisition, stem separation, transcription, tempo, cleanup and provenance. Inspect module startup before importing it; running the worker can claim real jobs. Use a run-local database and job workspace if executing the worker path. |
| External retrieval | `packages/catalog/src/external-retrieval.ts`, `external-symbolic-pipeline.ts`, `source-candidate-handoff.ts`; preserve their URL, size, format and source-evidence checks. |

Use installed search/browser/media tools as needed for discovery. Do not fabricate capability when downloads or audio analysis are unavailable, bypass access controls, or treat an inaccessible source as verified. Continue with a viable alternate source, recording the substitution.

## Ingestion and clocks

`packages/catalog/src/ingest.ts` exports `ingestSource`. Set `KEYSPILLI_DATA_DIR` to the run's isolated catalog **before importing catalog/database modules**. Run with cwd at the chosen repo root because `packages/catalog/src/paths.ts` derives `ROOT` from cwd.

Useful input fields, subject to the current type:

```ts
await ingestSource({
  buf, baseId, title, artist,
  contentType: "upload", acquiredVia: "upload",
  cleanTranscription: false, maxDurBeats: null,
  arrangementProfile: "source",
  // chords: validated harmony labels in THIS input's normalized beat grid,
  // sourceRef/sourceArrangement: real, validated provenance when applicable.
});
```

This example is for a finished piano MIDI/MusicXML source. Follow the worker's provenance and cleanup inputs for audio-derived material. `sourceArtifactHash` and `sourceArrangement` have validation contracts; do not fill them with unrelated hashes or invented classifications. Check returned `error` and actual artifacts, not just a fulfilled promise.

Ingest creates six difficulty variants. Original uses a real variant (normally Advanced, suffix `-a`); Chords is a Player projection, not a seventh level. Prefer `getSongsByBase`/returned IDs to guessed filenames.

`buildVariants` in `packages/midi/src/simplify.ts` integrates variable-tempo source timing into its playback grid. Normalize before authoring harmony in that grid. Never apply a source-beat chart unchanged after timing normalization, borrow a previous song's BPM, or flatten a MIDI tempo map by writing raw beats at one tempo. Account for pickup, count-in, meter changes, trimmed silence and the final release. `preserveSourceBeats` is a specific tempo-override feature, not a general fix.

## The actual Chords result

Load `getSongDetail(advancedId)` from `apps/web/src/lib/catalog-api.ts`; reject unavailable artifacts or `chordUnavailableReason`. Let `playerData = detail.chordData ?? detail.data`, then call `replayChordsBacking(playerData)` from `apps/web/src/components/player/chords-backing.ts`.

Preserve both `replay.resolution.notes` and `replay.resolution.chords`. The latter contains realized MIDI pitches, `beat`, `durationBeats`, and `suggestedHands`. `guidanceNotes` are not the audio contract. Read `Player.tsx`, `packages/player-core/src/engine.ts` and the active audio backend when rendering: notes and synthetic chord attacks have separate scheduling and dynamics. For exact preview capture, use the existing PlaybackEngine with a recording audio adapter or the app's real renderer; do not silently invent strums/releases.

`apps/web/src/lib/chords-evaluation.ts` provides `snapshotChordsBacking` and `evaluateChordsBacking`. A snapshot preserves both streams and the Chords clock. Source-backed exceptions can have no synthetic chords while still sounding correctly; do not reject them on chord count alone. Original and Chords may legitimately have different clocks for different declared target performances.

For portable exports, use `writeMidi` and `writeMusicXml` from `packages/midi`, passing actual notes, tempo, meter/events, measures and hand assignments. `writeMusicXml` takes a `Variant`; build it from actual prepared data. Use `getArtifactFile(advancedId, "variant.mid" | "variant.xml")` for Original. The generic `/api/song/[id]/export` endpoint exports variant files; it does not automatically export realized Chords playback.

## Attaching prepared harmony to one song

Choose the existing mechanism that represents the preparation, then prove it on re-import:

- `ingestSource({ chords, ... })` accepts validated `ChordLabel[]` as supplied harmony. This is useful only when the resulting Player selects and realizes the intended backing. Check event-level provenance; derived labels must not be upgraded to human-authored evidence.
- Catalog charts use `catalog/chord-sources.json` plus normalized artifacts in `catalog/chord-timelines/`. Read `packages/catalog/src/chord-sources.ts` and `chord-timeline.ts` for the current schemas, validators, source selection and artifact-path rules. `KEYSPILLI_CHORD_SOURCE_MAP` can point at an isolated map; `artifactPath` is relative to the catalog/repo root, not automatically relative to that map. Test the same layout/configuration the import recipe will install.
- Timeline fields include `schemaVersion`, `baseId`, title/artist, `timeSig`, `durationBeats`, `chords`, provenance, and optional key/tempo/coverage. Events distinguish harmonic span from optional `strikeSpacingBeats` and `maxStrikeDurationBeats`. Do not claim a label timeline preserves arbitrary performed backing if replay proves otherwise.

Use the same base ID for source and mapping. The raw upload route currently derives `upload-<source SHA256>` from the uploaded bytes, whereas direct ingest can use an explicit base ID. Hash the **exact intended upload file** when preparing a mapping for that route. Re-exported bytes may differ from the initial source.

An import recipe must validate its inputs/hashes, reject conflicting existing content, preserve other map entries, and use existing ingest/publication helpers instead of overwriting SQLite or hand-editing notes manifests. Keep needed harmony settings and source bytes in the package so it does not depend on a disposable worktree path. Record checkout capabilities if portability across versions is unverified.

## Verification before declaring ready

Use a second empty data directory to run the delivered import recipe. Load Original and Chords through `getSongDetail` and replay again; compare canonical musical events, clocks, source selection and full-song extent against the prepared outputs. Re-import the same package and verify musical idempotence; ignore expected timestamp-only changes. Reparse MIDI and MusicXML to catch missing notes, meter changes, hand/voice loss, broken sustains and export truncation.

Check finite pitch/time/velocity, duration and arrangement boundaries, melody coverage in Original, harmony and section alignment, backing melody leakage, hand spans/density, attacks, releases, rests and ending. Compare musical questions to actual source evidence. A source that contains only melody cannot justify an arbitrary harmonization as recovered original backing. Automated harmony is fallible: resolving an uncertainty flag by inventing notes is not a repair.

Available focused tools, when present:

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/evaluate-upload-chords.mts '/absolute/run/original.mid'
npm run render:midi -- --input '/absolute/run/original.mid' --output '/absolute/run/original.wav'
```

The evaluator uses its own isolated catalog; inspect its row-level errors and metrics. Its `--reference-track` option strips a designated benchmark chord track and is not for ordinary song imports. It does not validate your packaged chart attachment. The renderer requires a usable installed backend/SoundFont; discover it without reading credentials. Limit additional verification to relevant paths and meaningful failures.

Never alter golden acceptance hashes, backfill a human verdict, or require another owner listening session to finish agent work. If a material issue cannot be resolved with available evidence/tools, deliver the preserved assets with the exact remaining issue and a provisional/blocked status.


## Existing catalog batches

Reuse `apps/web/scripts/prepare-catalog-chords.mts` when this checkout contains it. It prepares missing backings, preserves mapped charts, exports both realized streams through PlaybackEngine, round-trips MIDI/MusicXML and writes a resumable per-song ledger. Its default contextual harmony is an **agent-composed learner arrangement**, not recovered ground truth. Inspect and correct its results; the script is not an automatic musical approval.

For supported native MusicXML/MXL, preserve the original bytes and source notation clock through intake. Original exported XML may use written beats/tempo changes while playback MIDI and Player notes use normalized beats; compare native elapsed seconds through each actual tempo map rather than expecting identical beat numbers. Check `sourceNotation`, arranged-content provenance, exact source spelling where retained, pickup/meter/tie boundaries and any generated-tail warnings. Re-import and test manual playback/calibration edits. MIDI conversion does not establish recovered written notation; see the [supported scope](constrained-arrangement.md#supported-engineering-scope-30-september-2026).

1. Freeze all live grouped API pages and unique `representative.baseId` values. Use an isolated, consistent database/artifact snapshot. On 27 September, 437 visible songs meant 2,622 difficulty variants; the raw database had 451 bases. Never hard-code these counts for later runs.
2. Compare deployed and pending curated source maps **and their source artifact hashes/clocks**. A newer accepted chart over an older live Original is not the accepted backing. Keep the live snapshot, then reconcile already accepted publication bytes into a separate staging snapshot when required; record each overlay and include its source-data prerequisite in activation instructions. Do not change a golden pin or label a mismatch preserved. The batch script must reject a mapped backing when its source reference is not the source actually selected by Player; a valid artifactPath alone is insufficient. Preserve existing accepted choices and golden hashes. A mapped backing may itself be provisional; do not upgrade its status by calling it preserved.
3. Run from the capable repository root, with environment set before modules load:

```sh
KEYSPILLI_DATA_DIR="$PWD/output/RUN/data" "$KEYSPILLI_NODE" --import tsx \
  apps/web/scripts/prepare-catalog-chords.mts \
  output/RUN/live-visible.json output/RUN/prepared

KEYSPILLI_DATA_DIR="$PWD/output/RUN/data" \
KEYSPILLI_CHORD_SOURCE_MAP="$PWD/output/RUN/prepared/chord-sources.json" \
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/prepare-catalog-chords.mts \
  output/RUN/live-visible.json output/RUN/prepared --verify
```

The verification must run in a fresh process against the **delivered map**, not just directly project a timeline in memory. It hashes all exports and compares actual loader/Player replay with the saved snapshot. Canonicalize JSON's omitted `undefined` properties when comparing serialized snapshots; never ignore musical differences.

`prepared/harmonizations.json` optionally maps base IDs to `{ chords, references, rationale }`. Use it for evidence-backed timing corrections and explicitly composed accompaniment. Keep references and rationale meaningful. Inventory, artifacts and overrides are private run inputs; copy required files with the same repository-relative layout if moving them. Reverify after relocation. This mode attaches to existing songs; it neither regenerates Original nor needs a second empty database. A new-song import still requires the empty-catalog test above.

Prepared MIDI-derived timelines use `provenance.sourceRef = "prepared:" + sourceFingerprint`. The capable loader preserves these labels and rejects them if the Advanced source fingerprint changes. Older loaders silently replace MIDI-derived timelines with generated labels; record this capability requirement and do not call such an older deployment compatible. Deployment remains subject to the user's existing authorization.

## Arrangement lessons from the full catalog

- Overlapping broken-chord notes establish polyphony without simultaneous attacks. Octave doubling of one melody pitch does not establish harmony.
- Separate harmonic continuity from articulation. A short gap between identical played chord pitch classes may keep its label while audio releases; do not bridge a genuine rest or a change of harmony.
- Rootless or inverted left-hand arpeggios can support repeated strikes. Reject melody-only attacks; do not require a root on every useful backing onset.
- Integer-grid inference can delay a syncopated chord or misread a grace-note pickup. Compare against actual bass/stack attacks. Source-anchored windows helped many arrangements, but were not universally better; retain a correction only when its source evidence improves and it introduces no concrete regression.
- Compare root/quality, bass support, attacks and releases separately. A melody non-chord tone or a seventh next to its resolution can trip semitone/strong-beat proxies despite correct accompaniment. Conversely, a wrong progression can pass those proxies. Keep raw flags, document their interpretation, and never lower thresholds just to finish a batch.
- Reference charts still need performance alignment. Nyan Cat's local arrangement exposes a one-beat root progression in its second half; copying a two-beat chart rhythm doubled the harmonic period. Record this kind of correction explicitly.
- A monophonic source needs a newly composed harmonization or verified external backing. Preserve its key, phrase structure and rests, and label the result inferred. A rendered file or an inferred label does not prove source-faithful harmony.
- Distinguish uncertain harmony (`reviewReason`) from intentional N.C. when counting silent spans. Rendering to PCM can prove non-silence, clipping and duration only; it cannot establish pleasant sound or listening acceptance. Normalize preview gain, keep bounded temporary WAVs, and pin previews to the MIDI hash so later musical edits invalidate them. The existing JS renderer failed on the 49-minute Brahms source with an array-length error; a bounded FluidSynth/FFmpeg render plus streaming PCM analysis completed it. Avoid silently truncating long songs or keeping all decoded samples in an expanding JS array.

Reconcile every frozen base ID at completion. Report preserved, newly prepared, blocked, proxy-flagged and actually auditioned counts separately. Never substitute 100% export coverage for a claim that every song is musically finished, and do not hand the remaining checks back to the owner as a listening assignment.
