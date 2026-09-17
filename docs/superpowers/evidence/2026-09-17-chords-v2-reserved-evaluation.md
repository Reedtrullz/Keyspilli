# Chords v2 reserved evaluation — 17 September 2026

Candidate code was frozen at `ea68729045e82ef9ced14e0e0916c86991eeba4a` before playback. The four reserved fixtures were hash-checked before the browser started. All captures used the same browser `AudioEngine synth`, with Original, Automatic melody, and User-confirmed right-hand melody kept as separate outcomes. No reserved output was used for tuning. Human ratings remain pending.

The preserved packet is [2026-09-17-chords-v2-capture-packet](2026-09-17-chords-v2-capture-packet/), with portable relative paths and a verified [SHA256SUMS.txt](2026-09-17-chords-v2-capture-packet/SHA256SUMS.txt). The tracked structured summary is [2026-09-17-chords-v2-reserved-evaluation.json](2026-09-17-chords-v2-reserved-evaluation.json).

| Reserved phrase | Source-only window | Producer events Original / Automatic / Manual | Decoded / requested seconds | Producer multiset changed |
|---|---:|---:|---:|---:|
| Near the Cross | 24–48 beats, 4×6/4 | 50 / 46 / 47 | 13.92 / 13.858 | Automatic yes; manual yes |
| Prélude | 16–32 beats, 4×4/4 | 115 / 86 / 105 | 17.04 / 17.000 | Automatic yes; manual yes |
| Pay Me My Money Down | 28–44 beats, 4×4/4 | 34 / 34 / 34 | 7.38 / 7.316 | Automatic yes; manual yes (hashes differ despite equal counts) |
| Dear God | 96–128 beats, 8×4/4 | 165 / 154 / 165 | 26.64 / 26.600 | Automatic yes; manual yes (hash differs despite equal count) |

The deterministic producer comparison uses the exact Player duration `max(note end, measure end)` (96, 40, 84, and 504 beats respectively), the frozen source fingerprint, the selected automatic/right-hand path, `allowRests=true`, `coherent-phrase`, and empty phrase overrides. It clips each `[midi,start,dur,vel]` event to the reserved phrase window before hashing. Full hashes and per-capture metadata are in [the structured summary](2026-09-17-chords-v2-reserved-evaluation.json) and [packet](2026-09-17-chords-v2-capture-packet/).

The Blackbird Original repeat control decoded 2.58 / 2.58 seconds for a 2.5-second request. Its scheduled-event multiset changed and aligned PCM RMS error was 0.0737, so the packet labels oscillator/PCM/file-size differences as observed capture variation only. WebM SHA-256 remains an integrity check, not audible-difference proof. The deterministic producer multiset is the arrangement-change check; none of this establishes recognizability, plausible harmony, easier fingering, playability, or musical usefulness. Human listening remains pending.
