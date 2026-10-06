# Compressed Player output controls — 06-10-2026

The [full-range study](player-full-range-controls.md) fits stereo audio before
Player's shared compressor. Listening WAVs contain final compressed mono audio.
These are different analysis inputs. This follow-up tests six previously scored
paired controls, so every result here is development evidence.

All six mono downmixes of compressor-input audio recovered the authored history
pitch sets. Relative waveform error ranged from 0.0045% to 0.629%. With the same
references and search settings, all six actual compressed mono outputs withheld:
their errors ranged from 5.35% to 13.28%. Both quiet controls proposed an incorrect
pitch and omitted the actual quiet note. Downmix alone did not reproduce that
failure; applying the compressor changed the waveform enough to invalidate the
linear input-side fit.

The pinned Chromium 151.0.7922.34 implementation applies a shared changing gain
to delayed stereo input. An independent offline impulse measured 264 samples of
delay at 44.1 kHz. The Player profile is threshold −24 dB, knee 12 dB, ratio 3,
attack 5 ms and release 150 ms. The [Chromium source](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.34/third_party/blink/renderer/platform/audio/dynamics_compressor.cc)
and [Web Audio processing specification](https://www.w3.org/TR/webaudio/#DynamicsCompressorNode)
explain the delay and time-varying gain; the specification permits implementation
variation, so these browser measurements are not universal compressor constants.

Private native OfflineAudioContext experiments fit amplitudes, starts and
release alternatives against the original compressed recording. They receive
the target audio and pinned reference library, without authored target notes,
velocities, starts or input-side target recordings. An initial optimizer stopped
early because its step tolerance was unsuitable for sample-index coordinates;
the original source/freeze/results are retained, followed by a separate corrected
attempt. Native gain correction then produced an inferred mono input for a second
search, followed by another physical forward fit against the original output.
Failed shape handling and both gain-inference attempts are retained separately.

The correction remains unsuitable for admission. In both quiet controls, fitting
only the two dominant notes achieved approximately 0.27–0.29% output error while
omitting MIDI 49 or 73. Lowering the proposal improvement floor did not recover
those notes. Searching inferred input also produced false low-pitch activations
in other controls; physical forward refitting removed some, but a small output
residual still could not establish a complete pitch set. These proposals are not
accepted musical findings, automatic repairs, or a qualified compressed detector.
No threshold or result in the earlier closed studies changed.

For controlled Player review, use the existing paired capture plan with
`capturePreCompressor: true`. Keep the stereo Float32 input, audible mono PCM16
output and measured-input forward-compressor control tied to their own hashes
and common frame clock. The independently screened private full-range search
applies only to authentic compressor-input audio. Its 53/54 history-set result
does not transfer to the final listening WAV, an inferred input, microphone
audio, or a recording from another renderer. The prototype and reference bank
remain private; there is no production detector invocation for this profile.

An input-side finding is evidence about signal entering the compressor. It does
not establish that a quiet voice is perceptually audible in the final recording.
Preserve final-output measurements and any authorized listening separately.
If only final output is available, retain uncertainty about weak or missing
notes; do not infer acoustic absence, completeness, current-key state or a
missing-note repair from a good aggregate reconstruction. Authored-score forward
comparison, when used, must disclose its supplied note/timing assumptions and
remain separate from blind transcription.

The next compressed-output candidate must pass separately frozen quiet, repeated,
velocity-band and false-pitch controls before admission. It must verify proposals
against original output, account for browser/profile identity and unknown gain
history, and expose uncertain support. Further tuning of these six known cases
would be development, not independent validation.

All DSP belongs in Keyspilli. Anti remains independent Gemini advisory support
for connected Google AI accounts. This experiment uses no provider calls, uploads,
new captures or owner listening. It changes no runtime Player or detector and
does not authorize installed adoption, publication, merge or deployment.

Private reproducibility root:
`output/music-review/20261005-afk/player-output-solution/20261006-085322`.
