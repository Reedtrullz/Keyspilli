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

The fit uses measured spectral onsets and a2ms onset grid. The default timing
profile `narrow-24ms` searches within±24ms; explicitly adding
`"phaseTimingProfile": "wide-64ms"` to the request searches within±64ms.
Unknown timing profiles refuse locally; neither profile changes the level or
residual guard. Both use at most four
onsets in1.2seconds of lookback, and at most12 pattern events. Every registered
pitch is searched. A fixed4096-point sample selection drives nonnegative
matching pursuit with joint amplitude refits; all observed PCM samples in the
fit interval then check the reconstruction. Raw residuals above0.05 or target
levels below−50dBFS remain uncertain. Pattern amplitudes above0.15 relative to
the declared velocity76/gain0.4 references are candidates; this is not calibrated
confidence. The default constructs at most8,800 columns by4,096 optimization
points; the wide profile at most22,880. Dictionary storage uses one preallocated
float32 array (about358MiB at the wide cap); this is not a peak process-memory
bound. Normalization and the rest of the pipeline require additional memory.
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


## Optional wider timing profile

A subsequent development experiment recovered the three known timing failures
with±64ms while preserving the quiet-target refusal. It did not reopen or
retune the original84-case study. A new84-case list, configuration and gate were
frozen before rendering with generator seed510527 (the copied driver's literal
seed metadata retained510526; a separate erratum records the actual source seed).
The wide profile recovered70/72 new held-note sets: overlap24/24, harmonic
chords11/12, new quiet note12/12, no-bass11/12, timing jitter12/12. Zero false
pitches were reported. The two uncertainties were a quiet target and a poor
harmonic fit whose spurious raw proposals were withheld by the residual guard.
All12 release challenges again remained uncertain. Prototype p95 was2.15seconds,
maximum3.12seconds; these are short-clip fit measurements, not end-to-end bounds.

The wider profile is explicit because a larger search can introduce ambiguous
alignments and costs more resources. It remains limited to the declared dry
FluidSynth profile. Keyspilli's actual Player uses smplr SplendidGrandPiano,
velocity layers, bus gains and a shared dynamics compressor. Its post-compressor
captures require separate evidence; this timing change does not admit a Player
profile or qualify transfer. See the
[smplr source](https://github.com/danigb/smplr) for the sampler design; the locally
inspected dependency for the Player controls was1.0.0.


## Actual Player transfer controls

Sixteen fresh sampled-Player captures included eight isolated velocity76
references, two velocity controls and six mixture/repeated-note controls. The
existing frame-clock/sampler readiness harness passed on a sequential retry;
the first run's clock/start-offset failures remain recorded and were not admitted.
The inspected Player uses smplr1.0.0 SplendidGrandPiano, the backing gain0.4,
sustain enabled and the normal shared compressor.

With these eight references, a private0.5ms timing grid returned uncertainty for
all eight targets. A subsequent development-only sample-accurate grid recovered
one exact upper-trio control; the other seven remained uncertain. No Player
configuration is shipped or admitted by this command. These already-known
controls are not a fresh qualification benchmark and their limited inventory
cannot establish completeness.

An explicitly authored oracle supplied the correct notes and measured sampler
start groups, then fitted amplitudes to the isolated post-compressor references.
Same-velocity chord/overlap residuals were about4.1–6.9%; velocity changes were
substantially worse, and the repeated-note control remained poor. The results
show that finer timing alone is insufficient. They do not isolate compression
from velocity-layer, envelope or capture-phase differences; attributing all
remaining error to the compressor would require a pre-compressor control.
The residual guard was not relaxed to admit these failures.

The next Player-specific experiment should pin every velocity layer and bus,
record the summed signal before and after the compressor, and test a matching
forward rendering model before a fresh independent screen. Keep all of that
DSP/renderer work in Keyspilli. Gemini via Anti can interpret exported evidence
within its limits; it is not a substitute for a qualified acoustic detector.
