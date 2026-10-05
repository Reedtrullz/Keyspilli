# Phase-preserving piano pattern evidence

This optional Keyspilli diagnostic preserves waveform phase while fitting
isolated piano-note references across a short observed history. It addresses
a failure in magnitude-only matching: simultaneous notes can cancel shared
harmonics, so adding their individual magnitude spectra can misrepresent the
mixture and favor an octave substitution.

Anti remains standalone connected-account Gemini transport and generic evidence
interpretation. This DSP command runs in Keyspilli's pinned optional environment;
it makes no provider call, installs no bank/model and never starts the worker.

```sh
/absolute/worktree/.venv-audio/bin/python services/transcribe/src/phase_pitch_evidence.py \
  --request /absolute/phase-request.json --output /absolute/new-phase-report
```

Use the bank/audio/window/expected-set request from
[bank-pitch-evidence.md](bank-pitch-evidence.md), with these additions:

```json
{
  "phaseProfile": {
    "renderer": "FluidSynth",
    "rendererVersion": "2.6.0",
    "gain": 0.4,
    "reverb": false,
    "chorus": false,
    "unnormalizedPcm": true,
    "referenceVelocity": 76,
    "referenceOnsetSeconds": 0.25,
    "referenceHoldSeconds": 2.2
  }
}
```

Each isolated template additionally asserts `velocity: 76`, `holdSeconds: 2.2`
and `attackSeconds: 0.25`. Its pinned mono PCM16 WAV must include the complete
onset-plus-hold interval. The earlier700ms bank-study templates are insufficient.
Register every pitch that can be searched, including potential unexpected notes;
one to88 unique MIDI pitches21..108 are accepted. Expected score context never
limits either search. Profile/template labels and hold durations are assertions,
not facts established by byte hashes. Matching metadata can be false.

The exact profile is required. Only dry TimGM6mb/FluidSynth2.6.0 gain0.4,
unnormalized held-note renders have been screened. Other banks, effects,
velocity layers, gain/normalization, recordings, source phase and sample-rate
changes remain unqualified. A low residual alone cannot qualify their transfer.
The command accepts the existing32/44.1kHz byte contract; accepting a format is
not evidence that its renderer/capture conditions match.

The fit uses measured spectral onsets, a2ms onset grid within±24ms, at most four
onsets in1.2seconds of lookback, and at most12 pattern events. Every registered
pitch is searched. A fixed4096-point sample selection drives nonnegative
matching pursuit with joint amplitude refits; all observed PCM samples in the
fit interval then check the reconstruction. Raw residuals above0.05 or target
levels below−50dBFS remain uncertain. Pattern amplitudes above0.15 relative to
the declared velocity76/gain0.4 references are candidates; this is not calibrated
confidence. At most8,800 columns by4,096 optimization points are constructed.
Worst-case resource use and30second transcription are not qualified.

No fitting sample extends beyond the declared target end, including nonaligned
sample boundaries. Onset detection and resampling read the full clip; this is
offline analysis, not causal tracking. The existing single-window diagnostic is
retained separately and remains unchanged. A history fit may include a note
that was subsequently released, or fail because the reference's held envelope
no longer matches. Neither outcome establishes acoustic absence.

`receipt.json` retains the full fit, raw events/amplitudes, searched inventory,
profile/byte/code identities, and unchanged single-window diagnostic.
`patternPitchCandidates` is deliberately separate from
`currentPitchSetEstimate`, which is always null. Current presence and pitch-set
completeness stay unknown. Output is an exclusive private directory; stale
hashes, bank mismatches, incomplete references and excess onsets refuse locally
without a partial report. The CLI denies socket connection, lookup and binding.

`anti-evidence.json` includes caller assertions separately from the measurement,
uses the actual history-fit interval, omits local paths and evaluator answers,
and preserves unknown source authority. For an authorized handoff, first use
Anti `review-music --model gemini-pro --evidence-json ... --dry-run` with the
identical full WAV. Interpretation remains advisory and does not establish
independent listening, current presence, source truth, repairs or musical quality.

## Recorded scope and failures

Development oracle experiments used authored note events solely to diagnose the
representation error. Across six known failures, summing isolated PCM reproduced
the mixture with0.23–0.61% relative error, whereas summing magnitudes had5–111%
error. Even correct-note magnitude NNLS suppressed an octave note entirely in
two cases. Attack/decay magnitude prototypes remained inadequate. The phase
prototype recovered all six, which are development evidence only.

The configuration/source/bank/templates, seed510526,84-case list and admission
rule were frozen before fresh rendering/scoring. Of72 new held-note cases,
68 were exact with zero observed false pitches and four uncertain results:
overlap22/24, harmonic chords12/12, new quiet note12/12, no-bass11/12,
timing jitter11/12. The original single-window baseline recovered14/72 exact
sets with one false pitch. No threshold was tuned after scoring. All12 separate
release challenges were uncertain; MIDI key release was not labeled acoustic
absence. Prototype fit p95 was0.62seconds, maximum1.76seconds on short clips;
these are not whole-command/worst-case/30second latency claims.

Three held-note uncertainties had backtracked onset estimates more than24ms
before the authored attack, outside the frozen timing search; one target fell
below the level floor. Raw proposals remain in private receipts, including
spurious fits that the residual guard withheld. No search radius, level floor
or case was changed to remove these failures.

This supports a narrow renderer-specific history-pattern diagnostic. It does
not qualify the current Splendid Player bank, all88 pitches, repeated attacks,
offsets/pedal, real songs, full transcription, independent Gemini hearing or
musical acceptance. The frozen report and later current-source replay retain
all four held-note uncertainties rather than substituting new cases.

The research direction is supported by
[Cogliati, Duan and Wohlberg's context-dependent waveform transcription paper](https://brendt.wohlberg.net/publications/pdf/cogliati-2016-context.pdf),
which requires references for the specific piano/environment. This bounded
matching-pursuit implementation is not their full convolutional sparse-coding
solver. Earlier temporal reasoning came from
[Ewert and Sandler's spectro-temporal model](https://arxiv.org/abs/1606.00785) and
[Cheng et al.'s attack/decay model](https://archives.ismir.net/ismir2016/paper/000085.pdf);
their reported benchmark accuracy is not evidence for this implementation.
