# All-song Chords implementation checkpoint — 24 September 2026

## Decision

Chords mode now has one shared, deterministic backing for every visible song, built from its Advanced arrangement. It uses whole-arrangement harmony labels and strikes in the source pianist's left-hand rhythm. Checks replace per-song listening: a reference-chord benchmark (POP909-CL) and a catalogue gate. `docs/chords-tuning.md` describes the pipeline, every setting and both checks. Settings live in `packages/midi/src/chords-tuning.ts` for listening-based fine-tuning.

The earlier rejected probes below stay as history. Keyboard playability still needs an independent pianist or teacher; the learner cannot provide a physical piano test.

## Identity and evidence

- Current main and production health both reported 661a5aa8e2a9495b503b9cb59dc8c54feb5cf660 on 24 September; production reported healthy and 2,622 visible variant rows. Draft PR #105 remained at b80f9014fc0dcd142e3a765d31ff598c6ff25c2d. The isolated implementation branch starts from that PR, not current main.
- The local canonical data snapshot differs from production: 459 visible bases, 5 hidden and no orphan Advanced artifacts; 455 bases have generated-only chords and 4 have none. Only one visible base has a non-fallback catalogue chord chart. The new read-only evaluator found 429 bases with at least one unsupported span on the raw Advanced artifact timeline. Its default is explicitly not an exact Player Auto hybrid replay.
- Exact ignored API snapshot SHA-256: Oops 0ae0bfb2f5032ee6d45fd29a2a7208a57380dc13e2cf429fa6b4b0f2affcb903; Queen ab88c13729549e1964aafa3f3eb808b72df590666d8d824ded610e805033f5ac; Blackbird 90e3da1075e1eb78bf80ce2f237b0c3a31785c2733a7604266bb21802813872e. Winner Advanced notes: 9d9ae9b17b3bd10ebc973d549b12d1102606e66a9342a4702d449e7f73afd664.
- Those exact Oops, Queen and Blackbird snapshots have 1,891 / 2,364 / 1,069 Advanced notes and no semantic source role labels. A hand or register cannot prove vocal ownership. New MIDI track and MusicXML staff/voice origins survive parse, quantization, Advanced selection and JSON; co-onset same-pitch notes from different sources become one playable note carrying every origin. They affect future imports only. The current catalogue has not been rebuilt.

### Read-only production Advanced corpus — 24 September

Copied only production `*/a/notes.json` files to ignored local scratch; the 452-file tar is 39,208,960 bytes with SHA-256 `051193a56f3c8f4d5ae6f322cc9461903f3b189aaded4bc4214d0ac31fd48b50`. A separate read-only SQLite and visibility-policy query found 451 database bases, 14 hidden bases, 437 visible bases and one orphan Advanced artifact. The per-base source-hash and raw-artifact resolver report is in ignored `output/chords-all-songs-review/production-artifact-baseline-20260924.json`; this is not an atomic database/artifact snapshot and does not replay Player Auto's hybrid chart choice.

Among the 437 visible Advanced artifacts, 432 have generated chord labels only, three have no source chord labels, and two have only non-generated labels. Their 522,056 notes include 505,888 without a semantic source role; only eight songs have any note marked `vocals`. No current production note has the new `sourceOrigins` field. The raw-artifact backing resolver reports unsupported spans in 425 songs, with three emitting no audio attacks and 26 covering under 80% of the artifact duration. Its median covered fraction is 93.7%, which cannot establish correct harmony, rhythm, source-role separation or singability. The Winner artifact hash matches the earlier experimental source (`9d9ae9b17b3bd10ebc973d549b12d1102606e66a9342a4702d449e7f73afd664`); the Oops, Queen and Blackbird API-snapshot hashes above describe different serialized payloads and must not be substituted for their production artifact hashes.

## Rejected implementation probes

| Candidate | Result | Why not promoted |
| --- | --- | --- |
| Authored-chart-only shared helper | Only one current local base has a non-fallback chart; no Player chart-coverage input exists | Would remove backing for nearly all visible songs |
| Existing attack-cluster harmony detector | Mostly single/power evidence for Oops and Blackbird; localized Queen triads | Does not establish whole-song harmony, rhythm or source role |
| Conservative low/middle triad experiment | Oops beats 48–112: 2/64 supported beats; Queen 6–36: 14/30; Blackbird 14–30: 4.38/16 with questionable Cm; Winner 60–84: 1.5/24 | Large musical gaps and unresolved role/ending evidence. Synthetic rest and labeled-vocal checks pass, but that is insufficient |

The ignored scratch implementation and full diagnostic are at output/chords-all-songs-experiment/prototype.py and report.txt in the isolated worktree. They are not shipped code. Current generated charts can show high beat coverage by holding a stale or wrong chord; coverage is not harmonic correctness.

## Implemented preparation and checks

- Added a read-only all-visible-song Chords evaluator, `npx tsx apps/web/scripts/evaluate-all-song-chords.mts [--rows]` from the repository root (`KEYSPILLI_DATA_DIR` selects a frozen snapshot; the database is opened read-only). It loads each visible Advanced variant through the Player's own `loadSongArtifact` and `withChordSources`, then replays the Player's Chords path (`replayChordsBacking`: chord-source resolution, Auto selection, reviewed source backing, `bass-chords` resolution). It reports source inventory, role/lane/origin labels, the selected chord source, both audio streams, duplicate onset attacks, unsupported spans and register/onset geometry, and accepts an injected candidate producer on identical inputs. The raw-artifact figures above predate this replay and were not re-run against production.
- Preserved neutral source note origins. Every same-pitch/same-onset merge (quantize, the learner-level overlap trim, MusicXML ties) keeps one note, unions its origins and keeps a semantic role only when all parents agree, so Advanced never asks for one key twice at once. Player correction IDs use those origins when present, preserving legacy IDs for records without them.
- A catalogue rebuild adds `sourceOrigins` to every note, which changes each Advanced notes hash, every origin-based correction ID and the Winner pilot's exact `sourceFingerprint`. Re-pin or re-review the Winner gate in the same reviewed rebuild.
- Node 22 checks: MIDI 19 files / 413 tests passed; player-core 18 files / 295 tests passed; focused catalogue ingestion, coverage and evaluator 3 files / 26 tests passed; MIDI, player-core, catalogue and web typechecks passed. Draft PR #106's only triggered `Tutorial runtime candidate` container-smoke passed; it is neither a Chords musical check nor full release CI. No human listening gate or real-keyboard test was completed for this branch.
- Canonical checkout WIP, production data, catalogue artifacts, PR #105, merge and deployment were left untouched.

## Whole-arrangement harmony labels — 24 September (later)

The weak link was the chord labels, not the backing realizer. The stored generated labels name each onset from the notes struck there, so arpeggios and single-note bass lines hold stale chords and bare left-hand fifths become power chords. On the staged all-song snapshot (upstream `d359a20b`, 464 Advanced artifacts, not production), 37% of generated events were power chords and minor outnumbered major two to one. Only 61% of sounding note-time inside each chord was a chord tone, and 38% of chord beats sat under a label with less than half chord tones.

`inferHarmonyTimeline` (`packages/midi/src/harmony.ts`) scores triads, sevenths, sus4 and dim against every note sounding in each half bar (whole bar in odd meters), weighted by duration plus the lowest sounding note, with a mild diatonic prior and a best-path change penalty. Silent segments and a short pickup bar become N.C. It uses the sung line as evidence but copies no source note into the backing. The web projection uses it for Advanced chords whenever the artifact has only generated labels (authored labels and learner levels are unchanged), so Chords mode picks it up without a catalogue rebuild.

| Snapshot, 464 artifacts | Stored labels | Harmony labels |
| --- | --- | --- |
| Mean chord-tone share per song | 0.59 | 0.88 |
| Chord beats under a label with <50% chord tones | 37.9% | 0.04% |
| Chord events | 33,619 | 26,717 |

Chord-tone share is partly what the labeller optimizes, so it is not proof. Spot checks against well-known progressions: Canon in D, Let It Be, Imagine, Wonderwall, Perfect, Radioactive and River Flows in You come out as their textbook progressions; Blackbird recovers C–Cm–G and A7–D7; Yesterday is close. Someone You Loved is partial (slash chords become Fm7), and drivers license holds Bb for 58 beats. The Your Song UG chart is a fixed four-beat grid, not aligned to the cover, so it cannot score timing. Winner, Oops, Queen and Blackbird were the tuning songs; Yesterday, Someone You Loved, drivers license, River Flows, Radioactive and Another Love were held out and checked once.

Player-replay evaluator on the snapshot, before → after: songs with gaps 429 → 180, silent songs 4 → 0, songs under 80% covered 24 → 1 (Lovely, whose source is 42% rests); gap beats 7,603 ("no chord coverage" and "unsupported chord") → 2, plus 1,500 beats of explicit N.C. over source silence. The Winner reviewed-source pilot still overrides its exact production fingerprint.

A blind A/B listening page with ten songs (four tuning songs, Let It Be, and five held-out songs) collects verdicts; the synthesized clips judge chord fit, not tone. No listening verdict, pianist review or production run exists yet.

## Strikes in the source rhythm, and checks that replace listening — 24 September (later)

Listening result reported by the user: the harmony labels won on nearly every song. The one loss was drivers license, where the backing held one B♭ chord for 58 beats over a B♭ pedal. The labels there were plausible; the backing simply never struck again. Few clips sounded good because every chord was one held block.

Bass + chords now re-strikes each chord where the source pianist's left hand strikes (the lowest note's onsets when a source has no hands). A beginner cap allows at most one strike per beat, including the next chord's strike. Wherever the source leaves more than a bar between strikes, the chord is struck again on the next downbeat. The evaluator gained listener checks that need no listening: dead air (a source note starts while the last backing strike is a bar or more back), strikes landing on source onsets, the tune's strong-beat chord-tone share and its semitone clash share, with the highest right-hand note standing in for the tune.

| Snapshot, 464 artifacts | Today | Harmony labels, held | Harmony labels, struck |
| --- | --- | --- | --- |
| Songs with dead air | 460 | 453 | 36 |
| Dead-air onsets | 92,113 | 89,588 | 123 |
| Strikes on a source onset | 91.6% | 81.3% | 93.4% |
| Strikes under a beat apart | 0 | 0 | 0 |
| Median strong-beat tune chord-tone share | 0.51 | 0.82 | 0.82 |
| Median tune semitone-clash share | 0.17 | 0.14 | 0.14 |

The dead-air check flags drivers license under the held version (347 dead-air onsets, a 57.75-beat wait) and clears it when struck (0 onsets). That matches the listener's only loss. The remaining dead air includes short-bar songs where the one-strike-per-beat cap blocks the fill (verified for Adam's Song, all 2-beat bars). Through the Player path on the 459 visible songs: 37 songs and 124 onsets.

## Reference benchmark and tuned defaults — 24 September (later)

POP909-CL (MIT; 909 pop songs as piano MIDI with expert-reviewed chords) is scored by `packages/midi/scripts/chord-benchmark.ts`. Each song's score track goes through the catalogue's own `buildVariants`, so both labellers see exactly the Advanced notes the app would have. Every fifth song is held out. Settings were chosen by sweeping only the 728 tuning songs:
- a possible chord change every beat,
- change penalty 0.3,
- bass weight 0.4,
- major and minor triads only (sevenths, sus4 and dim cost accuracy),
- notes held to the end of their half bar when naming chords (the pedal setting).

The pedal costs one point of accuracy on POP909. It cuts one-beat chords on the sparser catalogue from 28% to 12%, against 14% in the reference, and raises the gate pass count from 328 to 387.

| POP909-CL, 181 held-out songs | Stored labels | Harmony labels |
| --- | --- | --- |
| Right root | 48.0% | 88.0% |
| Right major/minor | 17.3% | 87.3% |
| Right sevenths vocabulary | 15.7% | 80.5% |
| Chord-change agreement | 65.9% | 79.9% |

Tuning songs score within a point of the held-out songs. The earlier sections' catalogue numbers used the first half-bar, sevenths-enabled settings and are superseded by these.

Catalogue gate (`evaluate-all-song-chords.mts --gate`) with the tuned defaults on the staged snapshot:
- 387 of 459 visible songs pass. The failures are mostly classical and sparse pieces where major/minor triads fit poorly: 55 fall short on tune fit, 25 on clashes, 5 on flicker and 3 on dead air.
- No song is silent, and 28 have some dead air.
- Medians: the tune fits the chord on 76% of strong beats, clashes by a semitone on 12% of notes, and 8% of chords last a beat or less.

A dev-server run on the snapshot served `harmony-window` labels in the Player's data for Blackbird (Advanced) and drivers license (learner level, Chords from Advanced). The same page also carried the raw notes.json text in a development-only React debug payload, which the Player does not use.

## Next implementation boundary

1. Listening-based fine-tuning of `CHORDS_TUNING` by the product owner. Re-run the benchmark (`--gate`) and the catalogue gate after each change.
2. Decide what the Player does with songs that fail the gate: keep playing, label the backing as unverified, or hide it. The gate is a report today.
3. Re-run the catalogue gate on a read-only production freeze before release. The staged snapshot is not production.
4. Independent pianist or teacher review of keyboard span, releases and hand changes.
5. Any merge or production deployment needs separate release authorization. The Winner fingerprint pilot still overrides production's exact Winner file.

General music-theory principles used in the rejected experiment: [triads and inversion](https://openmusictheory.github.io/triads.html), [embellishing tones](https://openmusictheory.github.io/embellishingTones.html), [meter](https://openmusictheory.github.io/meter.html), and [keyboard voice leading](https://openmusictheory.github.io/melodicKeyboardStyle.html). These principles do not prove the imported song harmony.
