# Task 5 audio evidence

Date: 2026-09-18
Worktree: `/Users/reidar/.codex/worktrees/musically-useful-chords-mode`

These files are bounded, disposable Chromium captures from the actual Player
and browser `AudioEngine` synth. They prove capture integrity and flow
coverage only. `humanListening` is `pending`; no file here is musical,
recognizability, or physical-playability acceptance evidence.

## Oops `[64,108)` at 95 BPM

The final capture ran with candidate `773e52c` and the frozen Oops source
fingerprint recorded in the manifest. The Player path uses automatic melody,
`allowRests: true`, `soundingPolicy: "coherent-phrase"`, and the current
automatic chord-source policy (`authored-only` for harmonic synthesis).

Manifest and raw captures:

- `oops-64-108/final-capture/oops-section-2-audio-comparison.json`
- `oops-64-108/final-capture/oops-section-2-original.{json,webm}`
- `oops-64-108/final-capture/oops-section-2-coherent.{json,webm}`
- `oops-64-108/final-capture/oops-section-2-resume.{json,webm}`

Each capture contains `decodedPcm.samples = 1272726` at `44100 Hz`, which is
`28.86 s`. The separate `signal.samples = 212121` value is a decimated probe
sample count used for bounded RMS/peak calculation; it is not the duration.

### Oops default versus source-only preview

The complete three-way comparison manifest is
`oops-64-108/source-preview-capture/oops-section-2-source-preview-comparison.json`.
It reuses the already-preserved Original and default/coherent files above and
adds only the new source-only preview capture; the default candidate was not
rerendered.

- `oops-64-108/source-preview-capture/oops-section-2-source-preview.{json,webm}`

| Candidate | Source-backing mode | Events | WebM SHA-256 | Decoded PCM |
|---|---|---:|---|---:|
| Original | `n/a` | 1011 | `7b20c3d299e1f874bdad75fc52e1ca9ef709c0558ad54eca375dba2957bff3e4` | 1,272,726 / 44,100 Hz = 28.86 s |
| Default Automatic | `default` | 735 | `2fc4fc2cf4755eabb2d677e4373636ea73415cbee4d96d483e8bcd3ff6039cde` | 1,272,726 / 44,100 Hz = 28.86 s |
| Source-only preview | `conservative` | 780 | `56b2939cbdca1d59669ad455a587084a4918d68b852c2c67a2ed880f075f2273` | 1,272,726 / 44,100 Hz = 28.86 s |

The preview capture starts at beat `63.2083` and ends at `108.7925`, so the
requested `[64,108)` phrase is fully present with the same lead-in/tail
window. The preview is still pending human listening and musical acceptance.

## Blackbird `[14,26.5]` at 120 BPM

The complete phrase pair ran with candidate `9549980`, the exact source
fingerprint in the manifest, seek start `6.5 s`, and a `7250 ms` capture
window. The producer options are automatic melody, `allowRests: true`,
`soundingPolicy: "coherent-phrase"`, and `authored-only` harmonic synthesis
resolved from the automatic chord source.

Manifest and raw captures:

- `blackbird-14-26.5/capture/blackbird-phrase-14-26.5-audio-comparison.json`
- `blackbird-14-26.5/capture/blackbird-phrase-14-26.5-original.{json,webm}`
- `blackbird-14-26.5/capture/blackbird-phrase-14-26.5-automatic.{json,webm}`

The current capture has non-empty, differing hashes and decoded PCM. The
capture starts at beat `13` and ends at beat `27.5`: this is `0.5 s` of
pre-roll before beat `14` and `0.5 s` of tail after beat `26.5`, so the requested
phrase is fully present. The original is `320166 / 44100 = 7.26 s`; automatic
is `322811 / 44100 ≈ 7.32 s`.
The manifest also records the decimated probe count separately.

## Preserved short Blackbird wiring capture

The prior short default-vs-automatic wiring artifacts remain under
`blackbird-short-wiring/initial-capture/`. They are retained for provenance,
but their roughly two-second windows are not complete phrase evidence and must
not be used as the requested phrase-level musical comparison.
