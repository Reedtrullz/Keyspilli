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
original is `320166 / 44100 = 7.26 s`; automatic is `322811 / 44100 ≈ 7.32 s`.
The manifest also records the decimated probe count separately.

## Preserved short Blackbird wiring capture

The prior short default-vs-automatic wiring artifacts remain under
`blackbird-short-wiring/initial-capture/`. They are retained for provenance,
but their roughly two-second windows are not complete phrase evidence and must
not be used as the requested phrase-level musical comparison.
