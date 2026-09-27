# Whole-catalog Chords preparation — 27 September 2026

Local coverage: 437/437 songs, with 419 newly prepared learner backings and 18 existing mapped backings preserved. Every song has MIDI, MusicXML, a Player snapshot and a piano recording. This is preparation coverage, **not proof that every arrangement sounds good**. There was no audio-capable agent listening or new human acceptance. The owner is not assigned another listening task. Production has not changed.

## Scope and source versions

- Live health version: `1b6595df1fe7944509f992213bc8e926236a1c4c`; 2,622 visible difficulty rows.
- Live grouped API pages: 200 + 200 + 37 = 437 unique base IDs. The consistent private SQLite snapshot contains 2,706 rows / 451 bases, integrity `ok`; hidden/orphan bases are not silently counted as visible songs.
- The deployed map contains one chart. The working branch contains 18 mapped backings, including pending accepted work. “Preserved” alone is not an acceptance verdict.
- Final source-pin verification exposed older live sources for Fix You (136 BPM, 1,948 notes versus accepted 68 BPM, 1,587 notes) and I Will Survive (115 versus accepted 117 BPM). The live copies and DB were backed up under `output/all-song-chords/live-before-accepted-overlay`. The already accepted complete publications were reconciled into the private staging snapshot; `accepted-overlay.json` records their hashes. This is not a newly authored Original edit or a production mutation.
- The same source-selection check caught Aerosmith: its pending curated source/chart is 61 BPM while the live source was 120 BPM. Its matching existing publication was also restored into private staging, with the live copy retained. This is a curated candidate, not a golden acceptance. The batch now rejects a preserved map whose source reference is not actually selected by Player; a negative check against the older live source proves that guard.
- All other Original artifacts remain the live snapshot's bytes. Neither golden acceptance hashes nor charts were repinned.

## Result and verification

| Check | Result |
| --- | --- |
| Frozen visible songs | 437 |
| New prepared candidates / existing mapped backings | 419 / 18 |
| Silent or blocked exports | 0 |
| Actual PlaybackEngine schedule capture | 437/437 |
| MIDI and MusicXML pitch/start/duration round trips | 437/437, at 480/960 ticks respectively |
| Fresh-process delivered-map loader and Player replay | 437/437 exact serialized snapshots |
| Golden observations against the existing checkpoint | 12/12 unchanged; 9 MATCH, 3 historical DRIFT |
| Structural proxy pass / flagged | 353 / 84 |
| Source-onset dead-air count | 4,743 baseline → 9 |
| Duplicate backing onset attacks | 0 |
| Median sounding coverage | 50.1% baseline → 99.6%; coverage is not a musical-quality target |
| Tests | 2,229 workspace tests and workspace typecheck passed |
| Skill syntax validation | passed |

The three originally silent sources now have explicit inferred learner harmonizations. Six initially flagged arrangements received source-anchor timing corrections. A further 80 arrangements received source-aligned windows after comparisons against played bass/left-hand stacks: pitch support improved by at least eight percentage points without added dead air or a material increase in the melody-clash proxy. Those corrections sometimes introduce real short harmonic changes, so the final proxy-pass count is lower than the intermediate 377/437. Thresholds were not relaxed, and no passing score was promoted to listening acceptance.

All recordings pin their input MIDI and SoundFont hashes. They are normalized, non-silent, untruncated relative to their MIDI event duration, and have unclipped final PCM; that does not prove perceptual quality or rule out all upstream distortion. FluidSynth's release/reverb tail is about 2.6 seconds beyond the MIDI in many files. The longest source is Brahms Horn Trio, about 49 minutes; it was rendered in full. Browser verification established visible catalog coverage and sampled Player transport advancing and resetting. It did not establish agent hearing.

The previous 20-song upload-automation reference set remains a regression set, not fresh held-out evidence: about 82.1% major/minor and 84.6% root, still below the existing 85% gate. The explicit prepared arrangements do not make that separate automatic-upload claim pass.

## Generalizable lessons and fixes

1. Freeze the grouped live denominator. Database rows, manifest entries, artifact directories and visible songs differ; six difficulty levels share one Chords backing.
2. Compare pending and deployed charts **and source bytes/clocks**. Applying an accepted chart to an older Original is not preserving accepted playback. Keep both versions; reconcile staging and verify actual golden observations.
3. Overlapping broken-chord pitches can establish polyphony without co-onset stacks. A monophonic tune or octave unison cannot establish its own harmony. The shared detector now recognizes overlapping polyphony while retaining monophonic abstention.
4. A rootless/inverted LH arpeggio can articulate thirds/fifths usefully. The shared rhythm resolver no longer requires the root on every such attack.
5. Short articulation gaps between identical chord pitch classes can retain harmony while the rhythm path releases audio. An initial broader bridge crossed a real change of harmony; the regression check forced the bridge to identical pitch-class sets.
6. Unknown harmony must not masquerade as an intentional rest. `reviewReason` now yields `uncertain harmony`, separately from explicit N.C., in silence diagnostics.
7. Inference on an integer grid can delay a syncopated change or misread a grace-note pickup. Source bass/stack anchors improve some arrangements, not all. For Maps, the source changes to C-sharp minor at 3.5 beats rather than 4. Keep source comparisons, not just a score improvement.
8. Chord identity, attacks and release lengths are separate decisions. Prepared backings are simplified learner arrangements, not literal reconstructions of the source's every articulation.
9. The loader previously replaced MIDI-derived prepared harmony with generated labels. A `prepared:<sourceFingerprint>` reference now preserves the supplied timeline and rejects it after source replacement. This is a capability requirement for activation; older deployed code is not compatible.
10. Verify the delivered mapping through a fresh `getSongDetail` process. Direct timeline projection alone would have missed that loader defect. Serialized JSON drops `undefined`; normalize that serialization difference without discarding musical fields.
11. Capture **both** actual Player streams. A backing can contain source notes with zero synthetic chords. MIDI chord velocity is explicitly 80 for portable exports; it does not reproduce the app sampler's exact timbre/dynamics.
12. A semitone or non-chord melody note can be a legitimate extension, suspension or passing tone. Whole-beat scoring is also misleading after grace-note timing shifts. Conversely a wrong progression can pass. Retain raw flags and evidence, and do not tune the metric until it approves the music.
13. Reference identity is insufficient without alignment. Nyan Cat's second-half root sequence supports one-beat chord changes and a two-beat tonic, not the initially guessed double-length cycle. Earlier melody and the ending remain inferred harmonization.
14. The existing JS WAV decoder failed with an array-length error on the 49-minute Brahms recording. FluidSynth plus FFmpeg and bounded streaming PCM analysis completed it without truncation or a new dependency. Raw peak was also checked on this fallback render.
15. Pin previews to exact MIDI hashes, verify that inputs did not change during rendering, and finish generation before starting a renderer that reads the ledger. The ledger can contain an intermediate prefix during preparation; the final denominator must be reconciled again.
16. Preserve accepted choices without requiring another owner listening session. Agent preparation, proxy checks, actual listening and independent keyboard certification remain distinct facts.

## Musical references actually inspected

- [Nyan Cat chord reference](https://ja.chordwiki.org/wiki/Nyanyanyanyanyanyanya!): harmony context; timing matched against the local source rather than borrowed blindly.
- [Mutopia: Ellen's Song](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=853): source identity. The local monophonic melody received a new inferred folk harmonization, not a claim of recovered original accompaniment.
- [Dan Bruno's Ocarina of Time analysis](https://danbruno.net/writing/ocarina/): context for the unaccompanied modal chant. Temple of Time received sparse D-Dorian harmony, preserving its irregular opening phrases.

## Private deliverables and reproduction

Run from a checkout containing this change, with Node 22 and installed workspaces. Private files remain ignored under `output/all-song-chords/`; do not commit or publish source MIDI, MusicXML, audio, snapshots or licensed arrangements.

```sh
KEYSPILLI_DATA_DIR="$PWD/output/all-song-chords/data" ./node_modules/.bin/tsx \
  apps/web/scripts/prepare-catalog-chords.mts \
  output/all-song-chords/live-visible.json output/all-song-chords/prepared

KEYSPILLI_DATA_DIR="$PWD/output/all-song-chords/data" \
KEYSPILLI_CHORD_SOURCE_MAP="$PWD/output/all-song-chords/prepared/chord-sources.json" \
./node_modules/.bin/tsx apps/web/scripts/prepare-catalog-chords.mts \
  output/all-song-chords/live-visible.json output/all-song-chords/prepared --verify
```

The prepared directory contains `ledger.json`, `summary.json`, `verified-import.json`, `chord-sources.json`, per-song receipts/exports/timelines, audio receipts and a local Player preview at `http://127.0.0.1:3113/`. The map's artifact paths are repository-relative. Activation must include the matching private source publications for the two accepted overlays and the Aerosmith curated overlay and the capable loader; uploading each Chords MIDI separately would create duplicate songs, not attach a mode. No deploy or release is claimed. The 84 proxy flags and unavailable listening evidence keep the requested universal musical-quality outcome unverified.
