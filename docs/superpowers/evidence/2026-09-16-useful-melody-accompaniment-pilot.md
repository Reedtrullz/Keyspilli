# Melody + accompaniment pilot checkpoint

Date: 2026-09-16
Branch: `codex/useful-melody-accompaniment`
Scope: read-only inspection of the canonical catalogue plus structural baseline runs. No canonical files, database rows, or production artifacts were changed.

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

The parent review checked that every selected item is a real catalogue song, has a source-linked artifact manifest, has usable note/chord data, and contains a concrete 32-beat excerpt with simultaneous onsets or rests. The `expected` melody stream below is the existing `splitPianoRoles` baseline, not a claim of musical correctness; the tuples make the later correction/acceptance comparison reproducible.

`sourceArtifactHash` is the hash recorded by the canonical artifact manifest. The raw source path is included for traceability; it is never copied into this repository.

| Category / song | Source path | `sourceArtifactHash` | Excerpt (beats) | Source notes | Baseline melody | Rests (gaps / beats) | Expected first notes `(midi,start,dur,hand)` |
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

This is ten distinct pilot excerpts across eight songs and two categories. The selection is structurally reviewed and ready for implementation; subjective musical acceptance and real-audio listening remain explicit follow-up gates.

## Honest baseline result

For every pilot, the current player-core call was run as:

```ts
resolveAccompaniment(notes, chords, "melody-accompaniment", { durationBeats })
```

with no ownership producer. It generated zero accompaniment chords for every item and emitted fallback spans for every chord event (69, 23, 25, 172, 121, 12, 108, and 280 spans respectively for the eight songs). Reasons included `accompaniment ownership unavailable`, plus `no chord coverage` and `unsupported chord` on some songs. This confirms the reported failure mode: the default melody mode has no producer-owned source-note selection, so it cannot transform the passage.

The existing selector did return non-empty candidate melody streams for all ten excerpts. It also exposed the required test pressure: the baseline sometimes selects low notes across hands, stretches no rests, and encounters extended chord labels such as `C#maj7`, `A#7`, `Dm7`, `Gsus47`, and `D#sus2maj7`. The pilot implementation must make ownership explicit, preserve the selected line, generate only owned support, and surface ambiguous spans for correction instead of silently treating the whole song as unavailable.

## Checkpoint status

- [x] Canonical source coverage recorded without mutation.
- [x] Ten source-linked real-song excerpts selected across two import categories.
- [x] Baseline selector and current all-fallback behavior recorded with reproducible tuples/counts.
- [ ] New producer, correction sidecar, generated support, and parity checks implemented.
- [ ] Real Play/audio preview, visual display, grading, and saved-correction evidence captured.
- [ ] Selective-backfill dry-run produced from disposable copies only.

No claim is made here that the baseline melody is musically accepted or that the catalogue is safe for production backfill.
