# Piano preview duration follows the native MIDI clock

The local FluidSynth renderer checks the full parsed MIDI extent against the
actual PCM frame duration. It integrates each native Set Tempo region using the
maintained MIDI converter, including the default tempo before a delayed first
tempo event and any terminal rest. It does not flatten the song to its initial
BPM or change its notes, tempo map, pedal, synthesis, gain or PCM normalization.

Duration checks are deliberately asymmetric. Up to 10 milliseconds of missing
time is allowed for backend/frame-boundary rounding; a longer deficit is
`fail`, not a release tail. For extra output, the previous tail policy is
unchanged: `max(2 seconds, 5% of expected duration)` passes, up to twice that
allowance warns, and a larger overrun fails. `toleranceSeconds` reports the
applicable directional allowance. The result remains diagnostic: the API still
returns the WAV and metrics, so callers must inspect `duration.status` rather
than treating file creation or successful normalization as completeness.

For example, four beats at 120 BPM followed by twelve at 60 BPM last 14 seconds,
not 8. A complete 14-second render is now checked against 14; an 8-second clip
cannot pass merely because it matches the old scalar estimate. Four PCM frames
also cannot constitute a complete half-second input.

Regression controls use independently written SMF bytes and specified durations
through the actual parser and renderer. Their backend supplies controlled PCM;
it is not a SoundFont or listening evaluation. Constant tempo, delayed/faster/
slower/multiple tempo regions, terminal rests, shortfalls and release tails are
covered. Actual source bytes remain unchanged.

This correction establishes timing diagnostics, not source identity, content
correspondence, audible quality, keyboard suitability or musical acceptance.
Equal duration alone cannot prove that a preview contains the intended music.
Historical acceptance hashes are unchanged. No provider calls or production
catalog updates are involved.
