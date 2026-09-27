# Song preparation workflow hardening — 27 September 2026

The owner approved implementing the six proposed skill improvements, with no repeat owner listening assignment. Work uses the existing ingest, publication, Player, harmony and rendering paths. No new dependency, production mutation, acceptance repin or separate variant system.

## Research and resulting decisions

- Google's [audio-understanding documentation](https://ai.google.dev/gemini-api/docs/generate-content/audio) supports actual inline audio and timestamped analysis. The new runner sends bounded aligned reference/Original/Chords clips, pins their bytes, validates returned intervals, and requires provider-reported AUDIO input tokens. It never substitutes text for unavailable audio. **No process audio-model credentials were available**, so the live capability check explicitly blocked without sending media. Request/response validation is tested; successful live model assessment remains unverified.
- [mir_eval chord evaluation](https://mir-eval.readthedocs.io/latest/api/chord.html) separates root, chord quality, bass/inversion and segmentation comparisons. Accordingly, sounding LH support is labeled a source-support proxy, not chord-recognition accuracy or pleasantness. Timing, hand spans, raw clipping and semantic musical findings remain separate. A semitone against a passing tone is unresolved without contextual evidence, not automatically a defect.
- A newly acquired public-domain [Mutopia Pathétique first-movement MIDI](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=299) exercises six real tempo events. It is forward input, not a held-out musical-quality benchmark. Existing catalog examples remain regression material.

## Maintained commands

Run at the capable repository root with installed Node/tsx. Commands live in `apps/web/scripts/`:

| Command | Result and boundary |
| --- | --- |
| `prepare-song.mts INPUT NEW_RUN TITLE ARTIST` | Existing ingest creates six levels; prepares Chords, packages both modes, installs in a second empty catalog and verifies idempotence. Explicitly provisional until musical assessment. |
| `prepare-catalog-chords.mts INVENTORY PREPARED --repair` | Existing snapshot/base-ID inventory; preserved mappings and explicit overrides stay intact. Adds timestamped diagnoses and one bounded source-anchored candidate per eligible song. |
| `render-prepared-chords.mts PREPARED [BASE_ID]` | Actual Player-export MIDI to MP3; full duration, non-silence and pre-normalization clipping checks; up to two lower-gain retries, bounded cleaned scratch. Requires installed SoundFont. |
| `review-song-audio.mts MANIFEST OUTPUT --send-audio` | Actual audio assessment when process credentials/model are available. Alignment evidence, input hashes, 60-second maximum segments, provider AUDIO token evidence, interval validation, partial-results retention. No musical approval from empty findings. |
| `song-bundle.mts pack BASE_ID PREPARED BUNDLE` | Pins complete Original publication, rows, normalized chart, actual Chords MIDI/XML and playback snapshot. Refuses stale prepared playback. |
| `song-bundle.mts install BUNDLE NEW_DATA` | Offline isolated catalog inside a capable checkout, with existing strict publisher and DB reconciliation. Refuses unrelated content. Fresh-process Original and Chords verification. |
| `song-bundle.mts verify BUNDLE DATA` | All artifact hashes, one six-level base, Original notes/clock/fingerprint, exact Chords replay. An incompatible loader or changed artifact fails. |
| `song-bundle.mts rollback BUNDLE DATA` | Ownership-checked rename to a digest-named backup. Preserves bytes even when newer playback code rejects an old bundle or package payload is damaged. |

Original exports are `bundle/artifacts/a/variant.mid` and `variant.xml`; Chords exports are `bundle/chords.mid` and `chords.musicxml`. The bundle is portable between capable checkouts; it is not a browser ZIP upload or a production deployment command. The isolated importer does not merge into a running catalog.

New CLI code is included in workspace typechecking through `apps/web/tsconfig.song-tools.json`. Preparation cache keys hash actual source files and the dependency lock, including untracked implementation changes; committing unchanged code no longer invalidates every song.

## Musical changes and full-catalog evidence

Private run: `output/song-workflow-2026-09-27/`. Inputs remain the frozen 437-song visible inventory and reconciled private catalog from the previous batch.

- **437/437** preparations and fresh-process delivered-map replays succeed: **419 prepared, 18 preserved**. Both export formats round-trip through parsers; transport captures both audio streams.
- **316** backings change musically through source-rest/phrase-entrance treatment. Existing bass and voicing selection remains in use. All **18 mapped backings are byte-equivalent as playback snapshots**; all Original publication bytes remain untouched.
- Prepared inferred harmony now releases across whole-source gaps of at least half a beat and resumes at actual phrase entrances, including offbeats. It stays labeled inferred. This is a limited source-rest heuristic, not formal phrase recognition or a claim about every pedal release/cadence.
- An early implementation dropped offbeat entrances after rests. The catalog caught 36 new proxy failures; interval intersection fixed the cause, and the regression test includes an offbeat entrance. Final proxies are **353 pass / 84 flagged**, **9 dead-air onsets**, **zero newly failing songs**. Coverage median is **98.36%**, not a target or quality verdict.
- The repair pass evaluated **330** untuned candidates, preserving **89** prior explicit harmonizations. **Zero new harmonic replacements** met the stricter source-support/no-regression criteria after the phrase fix. Rejected proposals and before/after evidence remain in per-song `repair.json`; no threshold was lowered to manufacture improvement.
- `diagnosis.json` files preserve **25,898 timestamped observations**. Many are semitone proxies, not established defects. They are not silently classified as false positives. No new human/keyboard acceptance or autonomous listening claim.
- All twelve golden observations remain unchanged: nine historical MATCH and three historical DRIFT. No pin changed.
- All **437 full-duration previews** rendered successfully: non-silent, raw and normalized PCM clipping both zero, MIDI/MP3 hashes verified. The formerly failing 49-minute Brahms case also completes through the maintained renderer.

## Real inputs and negative checks

Private `forward-cases.json` pins inputs, actual routes and results.

| Case | Actual result |
| --- | --- |
| Title: Elton John — Your Song | Live discovery returned nine candidates. Discovery remains a lead-finding step, not automatic acquisition/arranging. |
| Bare YouTube link `JZ6uGVghbT8` | Initial CLI report exposed placeholder metadata. Agent-owned `yt-dlp` resolution identified The Theorist's 240-second cover. Resolved research verified an existing native symbolic candidate; complete source-to-bundle/fresh-import path passed. No worker/audio transcription job claimed. |
| Real Dear God MIDI | Six-level ingest, both-mode exports, fresh import and repeat-import equivalence passed. |
| Real Chopin MusicXML | Same complete path passed; no XML-to-MIDI label-only shortcut. |
| Real monophonic Nyan Cat source | Complete import/export/replay path passed; generic harmonization remains flagged/provisional. A successful import does not recover an original accompaniment from solo melody. |
| Newly acquired variable-tempo Pathétique | Six tempo events, 4,285 input notes. Native elapsed end 375.283641s; Advanced end 375.227273s, difference 0.056368s. Advanced contains 3,128 notes: material reduction still needs melody/phrase assessment. Timing success is not source-note fidelity. |
| Damaged package | Hash failure before destination creation; unrelated destination bytes preserved. |
| Rollback | Complete isolated installation retained under digest-named backup. Works after engine changes invalidate prior playback, and with a corrupted package payload. |
| Missing audio capability | Explicit blocked report; no network media request. Unit checks reject missing AUDIO usage evidence and out-of-range model timestamps. |

The small synthetic CLI integration test is a reproducible negative-path check, not substituted for these real inputs. All new/changed nontrivial paths have focused or end-to-end checks. Final local validation: **2,235 tests pass**, full workspace typecheck passes including the new CLI scripts, and skill validation passes. CI status is recorded on the draft PR.

## Skill and remaining limits

Installed `/Users/reidar/.codex/skills/keyspilli-song/SKILL.md` now routes to `references/evaluation-and-repair.md`, with tested commands, metadata-resolution behavior, correct source/clock checks, audio evidence requirements, preserved raw findings, and the newly observed failure cases. Skill validation passes. No owner listening assignment was added.

The workflow is substantially more repeatable and testable. It does **not** establish that all 437 songs sound pleasant, that the 84 proxy flags are harmless, or that audio-model review is live. Detailed reference/phrase assessment still belongs to the agent. The older below-threshold 20-song musical benchmark remains a limitation; this work does not change its acceptance result. Production remains untouched.
