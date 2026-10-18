# Melody + accompaniment pilot checkpoint

Date: 2026-09-16
Branch: `codex/useful-melody-accompaniment`
Scope: read-only canonical inspection, implementation, bounded real-song dry runs, and isolated browser checks. No canonical files, database rows, or production artifacts were changed.

## Source coverage

The canonical inventory was checked with `sqlite3 -readonly` and bounded filesystem scans:

| Evidence | Count |
| --- | ---: |
| song rows | 2,784 |
| distinct base IDs | 464 |
| standard rows | 2,328 |
| upload rows | 228 |
| YouTube rows | 228 |
| rows with a YouTube URL | 228 |
| rows per difficulty (`advanced`, `beginner`, `easy`, `medium`, `very-beginner`, `very-easy`) | 464 each |
| seed MIDI files | 387 |
| upload MIDI/XML files | 38 |
| transcribed job directories | 72 |
| artifact `notes.json` variants | 2,784 |
| artifact base manifests | 464 |

The implementation pilot therefore covers two currently available import categories: standard MIDI and YouTube-transcribed MIDI. Upload XML remains catalogued but is not a pilot input because the useful transformation boundary is already exercised by two categories and the XML fixtures are sparse.

The two available upload XML files are one-measure C-major scale fixtures, not actual-song sources. The real-song artifact chord corpus contains extended/suspended labels but no slash-chord labels. MusicXML and slash-chord behavior are therefore explicitly deferred to synthetic edge fixtures; they must not be presented as real-song evidence.

## Reviewed pilot selection

My bounded structural inspection checked that every selected item is a real catalogue song, has a source-linked artifact manifest, has usable note/chord data, and contains a concrete 32-beat excerpt with simultaneous onsets or rests. The `Baseline candidate notes` stream below is the existing `splitPianoRoles` algorithm output, not a claim of musical correctness or a reviewed oracle; the tuples make later independent correction/acceptance comparisons reproducible.

`sourceArtifactHash` is the hash recorded by the canonical artifact manifest. The raw source path is included for traceability; it is never copied into this repository.

| Category / song | Source path | `sourceArtifactHash` | Excerpt (beats) | Source notes | Baseline candidate notes | Rests (gaps / beats) | Baseline candidate notes `(midi,start,dur,hand)` |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| standard / The Beatles — Blackbird | `seed-midi/the-beatles-blackbird.mid` | `3fc3fd74d567da56dd10ff05689ef2f57641efbbe200532aabc0ea5fbcea1e75` | 4–36 | 103 | 72 | 0 / 0 | `(43,4,1.25,L)`, `(55,4.625,0.625,L)`, `(60,5.25,0.625,R)`, `(55,5.875,1.875,L)`, `(47,6.5,1.25,L)` |
| standard / The Beatles — Blackbird | `seed-midi/the-beatles-blackbird.mid` | `3fc3fd74d567da56dd10ff05689ef2f57641efbbe200532aabc0ea5fbcea1e75` | 68–100 | 123 | 74 | 0 / 0 | `(69,68.125,0.25,R)`, `(67,68.375,0.625,R)`, `(69,69,0.375,R)`, `(69,69.375,0.25,R)`, `(69,69.625,1.25,R)` |
| standard / Ed Sheeran — Perfect | `seed-midi/ed-sheeran-perfect.mid` | `9eedc213c406e42a15d734b8f561111331f29c7c62be74a815ed3724777a8eeb` | 0–32 | 131 | 99 | 2 / 2.375 | `(72,0,0.75,R)`, `(63,0.25,0.25,R)`, `(68,0.5,0.25,R)`, `(70,0.75,0.75,R)`, `(58,1,0.25,L)` |
| standard / Ed Sheeran — Perfect | `seed-midi/ed-sheeran-perfect.mid` | `9eedc213c406e42a15d734b8f561111331f29c7c62be74a815ed3724777a8eeb` | 32–64 | 220 | 120 | 0 / 0 | `(72,32,0.75,R)`, `(51,32.25,0.25,L)`, `(56,32.5,0.25,L)`, `(63,32.75,0.75,R)`, `(51,33,0.25,L)` |
| standard / Massive Attack — Teardrop | `seed-midi/massive-attack-teardrop.mid` | `5f953470ade890c3b1996f8cbacc49fc36f5dd6d27be1f2032a69316406432ec` | 0–32 | 71 | 65 | 3 / 1.5 | `(57,0.5,0.5,R)`, `(64,1,0.5,R)`, `(57,1.5,0.5,R)`, `(62,2,0.5,R)`, `(57,2.5,0.5,R)` |
| standard / Avenged Sevenfold — Dear God | `seed-midi/dadebrayant-avenged-sevenfold-dear-god-piano-cover-msm014zo.mid` | `8e4d4b9114800d69904dc4af35376b95ccd1d8c537aac3adbe812c72f0cf482e` | 0–32 | 162 | 74 | 10 / 4.5 | `(53,0,0.5,L)`, `(65,0.5,0.625,R)`, `(69,1,0.625,R)`, `(67,1.625,0.5,R)`, `(65,1.875,0.25,R)` |
| YouTube / The Warning — Hell You Call a Dream | `transcribed/job-mslzvbcz-fje0fv/audio_basic_pitch.mid` | `13e9cd2ed273c7bf9f9a8a14a480ae5b8505e52d85eb3cfacdc51d6cb9f3af0a` | 0–32 | 80 | 47 | 9 / 7.375 | `(84,0.625,0.625,R)`, `(48,0.75,0.25,L)`, `(84,2,0.5,R)`, `(84,3.25,0.625,R)`, `(87,5.5,0.875,R)` |
| YouTube / Pay Me My Money Down | `transcribed/job-mslzvbcz-n8xcem/audio_basic_pitch.mid` | `d23d483fc894672c72256603ec03132bb90fc79cfa79dc28e2f2f174f0726d9a` | 0–32 | 54 | 37 | 2 / 6.375 | `(48,0.25,0.5,L)`, `(48,0.75,0.375,L)`, `(64,1.125,0.875,R)`, `(67,2,0.875,R)`, `(71,2.875,0.75,R)` |
| YouTube / Hozier — Too Sweet | `transcribed/job-mslzvbcz-ysykq5/audio_basic_pitch.mid` | `31bf0d0a4de3c961e497806f421948186e287883f475b3b4941e9d9468403c1a` | 0–32 | 38 | 36 | 7 / 7.25 | `(67,0.375,0.5,R)`, `(60,0.625,0.375,R)`, `(55,0.875,0.25,R)`, `(46,1.125,0.625,R)`, `(53,1.25,0.375,R)` |
| YouTube / Sabaton — En livstid i krig | `transcribed/job-mslzvbcz-ysxx9s/audio_basic_pitch.mid` | `f0de275015e35aca9e6eb83b7b3038b40c7917a4c99f806f607f12dd991d46c3` | 0–32 | 78 | 31 | 11 / 8.25 | `(79,0,0.625,R)`, `(70,1.5,1.375,R)`, `(50,1.75,1.25,L)`, `(46,2.625,0.375,L)`, `(74,3,0.75,R)` |

This is ten distinct pilot excerpts across eight songs and two categories. The selection is structurally inspected and ready for implementation; it is not musically reviewed. Independent notation/track audition or listening is still required before assigning a reviewed melody expectation, and uncertain examples remain unreviewed rather than assigned guessed truth.

## Honest baseline result

For every pilot, the current player-core call was run by the reproducible diagnostic at [`2026-09-16-useful-melody-accompaniment-baseline.ts`](./2026-09-16-useful-melody-accompaniment-baseline.ts). Its core call is:

```ts
resolveAccompaniment(notes, chords, "melody-accompaniment", { durationBeats })
```

with no ownership producer. It generated zero accompaniment chords for every item and emitted fallback spans for every chord event (69, 23, 25, 172, 121, 12, 108, and 280 spans respectively for the eight songs). Reasons included `accompaniment ownership unavailable`, plus `no chord coverage` and `unsupported chord` on some songs. This confirms the reported failure mode: the default melody mode has no producer-owned source-note selection, so it cannot transform the passage.

The existing selector did return non-empty candidate streams for all ten excerpts. Those streams are diagnostic snapshots only: they can select low notes between upper attacks (for example in `Perfect` and `Too Sweet`) and therefore cannot be used as the oracle for a selector built on the same helper. The snapshots expose the required test pressure—cross-hand candidates, rests, and extended labels such as `C#maj7`, `A#7`, `Dm7`, `Gsus47`, and `D#sus2maj7`. The pilot implementation must make ownership explicit, preserve an independently confirmed line, generate only owned support, and surface ambiguous spans for correction instead of silently treating the whole song as unavailable.

The diagnostic reads the canonical raw files and artifact manifests directly. It records manifest hashes plus note tuples; it does not copy source media into the repository and it never writes to canonical data. Independent musical expectations, original-versus-candidate audio/notation comparisons, and user feedback are intentionally absent from this checkpoint.

## Checkpoint status

- [x] Canonical source coverage recorded without mutation.
- [x] Ten source-linked real-song excerpts selected across two import categories; structural selection only.
- [x] Baseline selector and current all-fallback behavior recorded with reproducible tuples/counts.
- [x] New producer, correction sidecar, generated support, and parity checks implemented.
- [x] Real Play/audio preview, visual display, grading, and saved-correction evidence captured.
- [x] Bounded read-only selective dry-run produced with no changed paths; it does not publish or backfill.

No claim is made here that the baseline melody is musically accepted or that the catalogue is safe for production backfill.

## Implementation and real-song dry run

The new producer builds a separate derived learning arrangement: selected source melody notes remain source events, non-melody source notes are subtracted only under successfully generated support, and unresolved spans retain the original content with an actionable selection override. Playback, falling-note display and grading receive the same derived notes/chords. Variant fingerprints include the catalog row identity as well as the manifest hash, so six difficulty variants cannot share a saved selection accidentally.

The API fingerprint boundary now also hashes the actual loaded variant `notes.json` content. `sourceArtifactHash` is the original source-byte identity and may remain unchanged across a regenerated variant; the notes hash therefore prevents a same-row saved override from surviving a middle-note edit. The catalog API regression keeps the manifest and row fixed while changing only the middle note and requires a new fingerprint.

The bounded diagnostic at [`2026-09-16-useful-melody-accompaniment-dry-run.ts`](./2026-09-16-useful-melody-accompaniment-dry-run.ts) read the ten source-linked pilot artifacts and emitted no changed paths. It recorded both manifest `sourceArtifactHash` and raw `notes.json` SHA-256 values per row. Final output was written outside the repository during verification.

With the diagnostic's mutually exclusive status field (`ambiguous` takes precedence over generated support), the final ten-row output contained 7 `success`, 1 `ambiguous`, and 2 `failure` rows; 8 rows still had both selected melody and generated support in the requested excerpt. A rerun against a disposable copy of the ten artifact directories (via `KEYSPILLI_MELODY_DATA_ROOT`) reproduced 7/1/2 with `changedPaths: []`; this status count is a bounded dry-run result, not a catalogue-wide rate.

| Category / excerpt | Generated support (beats) | Retained fallback (beats) | Generated chord events | Fallback / unresolved evidence |
| --- | ---: | ---: | ---: | --- |
| standard / Blackbird 4–36 | 21.00 | 11.00 | 3 | no chord coverage; no playable support voicing |
| standard / Blackbird 68–100 | 25.50 | 6.50 | 7 | no playable support voicing |
| standard / Perfect 0–32 | 18.25 | 13.75 | 4 | no chord coverage; no playable support voicing |
| standard / Perfect 32–64 | 23.25 | 8.75 | 10 | no playable support voicing |
| standard / Teardrop 0–32 | 0.00 | 32.00 | 0 | no chord coverage; no playable support voicing |
| standard / Dear God 0–32 | 15.00 | 17.00 | 7 | no chord coverage; no playable support voicing |
| YouTube / Hell You Call a Dream 0–32 | 19.00 | 13.00 | 6 | no chord coverage; ambiguous melody at 19.25–20.625 |
| YouTube / Pay Me My Money Down 0–32 | 25.00 | 7.00 | 3 | no chord coverage; no playable support voicing |
| YouTube / Too Sweet 0–32 | 0.00 | 32.00 | 0 | no chord coverage; no playable support voicing |
| YouTube / En livstid i krig 0–32 | 9.00 | 23.00 | 7 | no chord coverage; no playable support voicing; unsupported chord |

Eight of ten pilot excerpts had both selected melody and generated support, covering both available real-song import categories. Every emitted event in the dry run had an actual simultaneous support span of at most one octave, no support pitch at or above the selected melody clearance boundary, and an actual lowest pitch class matching the chord root or slash bass. Representative emitted voicings were `Am [45,48,52]` (span 7), `C#maj7 [49,53,56,60]` (span 11), and `Fm7 [41,44,48,51,53]` (span 12). The synthetic edge tests emit `Cadd9 [48,50,52,55]`, `C7/E [40,43,46,48,52]` (actual lowest E2), and `Cmaj7/G [43,47,48,52,55]` (actual lowest G2).

These are structural producer and event results, not human musical acceptance or recognition claims. The browser test used disposable copies of the real Blackbird and Hell artifacts and passed the actual Web Audio preview/Play path at desktop and 390px, plus seek, loop, transpose, left/right/both-hand filtering, chord-practice opening/acceptance, correction, and reload persistence with no page or console errors. This real-artifact suite is intentionally opt-in via `npm run e2e:melody-scratch`; default CI excludes it because those local source fixtures are unavailable there, so this evidence is not a CI result. Original, automatic, corrected, and practice audio/canvas captures are retained in ignored Playwright output under `apps/web/test-results/`. No local SoundFont was available, so the audio evidence uses the configured browser synth/Web Audio graph; no remote media was downloaded and no human listening verdict is inferred.

## Captured audio and real-event evidence

The test-only probe in [`melody-accompaniment.spec.ts`](../../apps/web/e2e/melody-accompaniment.spec.ts) duplicates the player master bus into a `MediaStreamAudioDestinationNode`, records WebM, decodes the recording in-browser, and logs oscillator starts as rounded MIDI events. It does not change production audio code or canonical data. The following values are from the latest Node 22 Chromium three-test scratch run whose artifacts are under `apps/web/test-results/melody-accompaniment-real--17f5e-orrection-and-practice-flow-chromium/`; recorder byte counts and hashes are run-specific.

| Real excerpt / capture | Window | WebM bytes | Decoded RMS / peak | Oscillator events (all / triangle) | Unique triangle MIDI events |
| --- | ---: | ---: | ---: | ---: | --- |
| Blackbird original | 7.0s / 2.0s | 32,826 | 0.1107 / 0.6728 | 51 / 34 | 45,47,55,60,65,67,71,74 |
| Blackbird automatic melody + accompaniment | 7.0s / 2.0s | 32,826 | 0.1252 / 0.5293 | 39 / 25 | 45,48,52,55,65,67,71,74 |
| Hell automatic, unresolved window | 10.7s / 2.2s | 35,724 | 0.0955 / 0.5981 | 55 / 34 | 41,44,48,51,53,68,72,77,79,84 |
| Hell right-hand correction | 10.7s / 2.2s | 35,724 | 0.1034 / 0.6278 | 60 / 36 | 41,44,48,51,53,55,68,72,77,79,84 |
| Hell chord-practice first accepted note | input event | 2,880 | 0.1675 / 0.8467 | 3 / 2 | 60 |

The two Blackbird arrangement captures differ in both decoded signal and event content; left-hand-only capture produced 3 triangle events versus 17 for both hands over the same 1.4-second window. That hand check establishes reduced event output only; it does not establish exact left/right partition parity. The transposed capture matched the complete observed fundamental set from the untransposed window after adding one semitone to every MIDI value. Hell surfaced the known `19.3–20.6 beats` ambiguity in the UI. Around that window, automatic playback had no `[44,48,51,55]` event set, while the corrected capture emitted the `G#maj7 [44,48,51,55]` voicing at approximately 0.99s into the recording. After reload, the sidecar still reported `right-hand` / `user-confirmed`. The practice capture contains a nonzero input voice and the status changed after the first target pitch was entered, so this is an actual grading event rather than a panel-visibility assertion.

This proves browser-synth signal and event/display/grading plumbing for two real excerpts. It does not prove that the generated lines sound musically correct to a human, and it is not notation acceptance evidence.

## Bounded stratified read-only evaluation

[`2026-09-16-useful-melody-accompaniment-stratified.ts`](./2026-09-16-useful-melody-accompaniment-stratified.ts) opens the canonical SQLite database read-only, excludes the eight pilot base IDs and synthetic `keyspilli-upload-test-*` rows, then deterministically selects six artifact-backed `a` variants from each available import stratum. Every JSONL row records the manifest source hash, raw notes SHA-256, generator version, selected melody count, generated/fallback coverage, unresolved count, status, and `changedPaths: []`. The output from the bounded run is `/private/tmp/keyspilli-melody-accompaniment-stratified-20260916.jsonl`.

Status is mutually exclusive for this report: an unresolved span is `ambiguous`, otherwise positive generated support is `success`, otherwise `failure`. These are structural coverage statuses, not musical-quality scores or catalogue-wide success claims.

| Import stratum | Sampled | Structural success | Ambiguous | Failure |
| --- | ---: | ---: | ---: | ---: |
| standard | 6 | 4 | 2 | 0 |
| YouTube | 6 | 4 | 2 | 0 |
| upload | 6 | 4 | 1 | 1 |
| **Total** | **18** | **12** | **5** | **1** |

The upload sample includes small usage/import artifacts and is therefore useful for fail-closed behavior, not a claim of broad uploaded-song quality. The run was read-only and reported no changed paths; production publication, derived-artifact backfill, notation review, and human listening remain separate gates.

## Final evidence status

- [x] New producer, protected melody/support split, ambiguity retention, collision-safe voicing, full source fingerprinting, and playback/grading preview parity implemented.
- [x] Focused tests, full workspace suite, typecheck, production build, and isolated desktop/390px browser checks passed with Node 22 at `/Users/reidar/.nvm/versions/node/v22.22.3/bin`.
- [x] Ten real-song excerpts dry-run with generated/fallback coverage; `changedPaths: []` and no canonical mutation.
- [x] Bounded 18-item stratified read-only run across standard, YouTube, and upload artifacts; exact status counts and hashes emitted with `changedPaths: []`.
- [x] Browser-synth original/candidate audio and real oscillator/practice events captured for Blackbird and Hell.
- [ ] Independent notation review and human listening verdicts remain pending; production backfill, merge, deployment, and default enablement remain pending.
