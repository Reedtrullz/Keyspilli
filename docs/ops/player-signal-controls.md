# Player signal controls — 06-10-2026

The earlier Player experiment compared chords against individually compressed
note recordings. That model left substantial residuals even when supplied with
the correct notes. A new development study isolates the signal before and after
the compressor. It establishes a matching renderer model for these controls;
it does not qualify a blind detector, current note presence or automatic repair.

The installed `smplr` 1.0.0 source and its sample assets are pinned in the private
study. Splendid Grand Piano has five velocity bands: 1–40, 41–67, 68–84, 85–100
and 101–127. These use four sample families; the softest band uses the PP samples
through a 1000 Hz low-pass filter. Velocity gain is squared. The measured Player
bus gains are 0.4 for backing and 1 for voice. A velocity-76 reference cannot
stand in for the other bands merely by changing its volume.

Scheduled note durations start a linear 0.5-second release in this sampler.
`setCC(64)` updates sample-selection state; the pinned piano regions have no
CC64 constraints. The UI sustain preference therefore does not establish
acoustic sustain in this installed sampler. This study measures authored
durations and release separately. It does not change Player sustain behavior.

The capture harness now offers an explicit `capturePreCompressor: true` plan
option. One worklet records the final mono output and stereo compressor input on
the same frame clock. Input is Float32 WAV, retaining values above unity. The
normal output remains PCM16 WAV. A measured-input control replays the captured
stereo input through a fresh `OfflineAudioContext` compressor with the exact
recorded parameter values, including their Float32 rounding. The paired clock
test also checks an above-unity impulse without clipping the input sidecar.

The development corpus contains 40 reference captures (eight pitches across
five bands), two voice-bus controls and twelve mixture, overlap, velocity-boundary,
repeated-note and release controls. All 54 passed the frame-clock, sample-readiness,
bus/schedule and no-fallback checks. These are authored controls, not a fresh
blind acceptance set. Reference alignment uses recorded sampler starts and a
predeclared refinement of at most one native sample. Correct notes, durations,
bands and buses are supplied to the oracle. Its comparisons use a prefix ending
128 ms after the declared target window; no source samples after that endpoint
enter the reconstruction.

Across the 14 targets, matching the band and release produces 0.14–0.34% relative
waveform error before compression. Free amplitude fitting is not the sole
explanation: nominal velocity-squared and bus gains give 0.16–0.36% error. In the
repeated-note and release controls, omitting the release envelope leaves about
16.2% and 18.9% error. Velocity-76-only references leave 60–100% error in several
mixed-band controls.

Forward-rendering the reconstructed stereo mixture through the compressor
produces 0.13–0.36% output error across all 14 targets. Summing individually
compressed reference notes instead leaves 1.18–17.59% error. Replaying the actual
measured input through a fresh compressor gives 0.014–0.475% error across all
54 captures (0.014–0.088% among the 14 targets). These are relative waveform
norms, not pitch accuracy or perceptual scores. Results apply to this pinned
sampler and Chromium 151.0.7922.34; they do not establish cross-browser parity.

The resulting design is to select the matching sample band, apply note gain and
release, sum in stereo, then compress the mixture. An independent pitch search
must search unknown notes, bands, timing and release without authored answers,
retain alternatives and an uncertainty gate, and pass a separately frozen
corpus including wrong-pitch, omitted-note, release and out-of-domain controls.
Current presence/completeness and musical acceptance remain unknown. No Player
profile is admitted to the production detector by this study.

All signal processing stays in Keyspilli. Anti continues to provide standalone
Gemini-through-Antigravity advisory support for connected Google AI accounts.
This study used zero Gemini calls, zero uploads and no new owner listening.

Private reproducibility root: `output/music-review/20261005-afk/player-signal-solution/20261006-011344`.
It contains frozen capture code, sampler sources, media and hash receipts,
predeclared analysis configuration, oracle inputs, forward renders and retained
failed attempts. The initial analysis stopped because it compared browser
Float32 parameters against decimal literals; the corrected analysis pins the
actual Float32 values. No scoring thresholds were changed after seeing results.
