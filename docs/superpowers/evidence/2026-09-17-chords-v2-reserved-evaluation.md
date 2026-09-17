# Chords v2 reserved evaluation — 17 September 2026

Candidate code was frozen at `ea68729045e82ef9ced14e0e0916c86991eeba4a` before playback. The four reserved fixtures were hash-checked before the browser started. All captures used the same browser `AudioEngine synth`, with Original, Automatic melody, and User-confirmed right-hand melody kept as separate outcomes. No reserved output was used for tuning. Human ratings remain pending.

The preserved packet is [2026-09-17-chords-v2-capture-packet](2026-09-17-chords-v2-capture-packet/), with portable relative paths and a verified [SHA256SUMS.txt](2026-09-17-chords-v2-capture-packet/SHA256SUMS.txt). The tracked structured summary is [2026-09-17-chords-v2-reserved-evaluation.json](2026-09-17-chords-v2-reserved-evaluation.json).

| Reserved phrase | Source-only window | Original | Automatic melody | User-confirmed right hand |
|---|---:|---:|---:|---:|
| Near the Cross | 24–48 beats, 4×6/4 | captured · 223,777 B / 162 oscillator events | captured · 223,776 B / 150 oscillator events · event multiset changed · PCM RMS error 0.1224 | captured · 223,143 B / 153 oscillator events · event multiset changed · PCM RMS error 0.1149 |
| Prélude | 16–32 beats, 4×4/4 | captured · 272,736 B / 357 oscillator events | captured · 274,009 B / 267 oscillator events · event multiset changed · PCM RMS error 0.1565 | captured · 273,056 B / 327 oscillator events · event multiset changed · PCM RMS error 0.1716 |
| Pay Me My Money Down | 28–44 beats, 4×4/4 | captured · 118,169 B / 114 oscillator events | captured · 118,487 B / 111 oscillator events · event multiset changed · PCM RMS error 0.0999 | captured · 118,169 B / 114 oscillator events · event multiset changed · PCM RMS error 0.0989 |
| Dear God | 96–128 beats, 8×4/4 | captured · 429,534 B / 531 oscillator events | captured · 429,200 B / 492 oscillator events · event multiset changed · PCM RMS error 0.1020 | captured · 429,200 B / 531 oscillator events · event multiset changed · PCM RMS error 0.1051 |

PCM comparison used decoded mono audio sampled every 128 samples, aligned over the best overlapping shift within ±32 sample-grid bins, with an RMS tolerance of 0.02. WebM SHA-256 is retained for file integrity only and is not used as audible-difference proof. The table demonstrates complete same-instrument capture and engineering-level output separation; oscillator events, PCM divergence, and file size do not establish recognizability, plausible harmony, easier fingering, or musical usefulness. Human listening is the remaining acceptance input.
