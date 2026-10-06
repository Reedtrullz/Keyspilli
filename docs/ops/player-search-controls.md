# Audio-only Player search controls — 06-10-2026

This follows [paired Player signal controls](player-signal-controls.md). The
matching authored renderer model can now be searched without target notes,
velocity bands, durations or sampler-start times. The search remains a private
development prototype; no Player detector, threshold relaxation or repair
authority is added to the maintained production tools.

The prototype uses 40 previously captured stereo compressor-input references:
eight pitches across five velocity bands. Only isolated reference labels and
their recorded alignment are supplied. Each target uses its first 1.2 seconds,
including leading silence. Stereo waveform cross-correlation searches unknown
start frames, followed by nonnegative amplitude refits. It reconsiders sample
bands and release envelopes after other voices have been fitted. At most eight
events are selected; candidate starts must retain at least 128 ms of history.
Timing and release refinements use the target signal, never its authored score
or transport receipt. Current note presence and completeness remain unknown.

Three development attempts are retained. The first incorrectly favored nearly
empty template fragments at the end of the search interval; a minimum-history
bound corrected this. The second recovered ten of fourteen sets, withholding
four poor fits. Reconsidering the band and release after fitting other voices
recovered all fourteen development pitch sets. This development result does
not measure independent accuracy, event timing, velocity or note-off accuracy.

The subsequent study freezes the algorithm, reference identities, seed 510528,
28 cases and gates before new capture or scoring. Twenty cases use the registered
inventory, with varied velocities, buses, overlaps, octaves, repeats and releases.
Four contain unregistered pitches alone; four mix quiet unregistered notes with
strong registered notes. A low residual that misses one of those quiet notes
must fail the out-of-inventory gate. Coverage requires at least 18/20 exact
registered sets, no accepted incorrect registered sets, and all eight foreign
controls withheld. Fit p95 must be at most 15 seconds and process RSS at most
2 GiB. Silence must refuse. Deliberately reinterpreted compressed outputs provide
separate signal-domain controls. These gates do not admit general transcription
or full piano coverage even if the limited screen passes.

The frozen screen recovered all 20 registered pitch sets, with no accepted
incorrect registered set. All four unregistered single-note clips were withheld.
However, all four quiet foreign-note mixtures returned only the two strong
registered pitches, omitting MIDI 49, 61, 69 or 73. Their relative residuals were
3.18–4.52%, below the unchanged 5% guard. The out-of-inventory gate therefore
failed. The candidate is not admitted; the study is closed without retuning.

Silence refused, and all fourteen deliberately compressed-output domain
controls stayed uncertain. The measured fresh-case fit p95 was 5.61 seconds,
maximum 12.56 seconds, with process maximum RSS 1,590,870,016 bytes. This includes
reference/dictionary setup and the later domain-control work in process RSS;
fit latency covers each fresh `fit(data)` call only. It does not qualify
30-second clips, full-command latency or an 88-pitch dictionary. Full-range
work needs bounded or streamed dictionary storage and a new resource screen.

This failure distinguishes matching the dominant signal from establishing all
notes. A fuller reference inventory must be searched and checked independently;
an energy residual alone cannot prove that a quiet note is absent. The next
candidate needs the complete piano range, the same velocity/release alternatives,
and new frozen controls at multiple quiet-note levels. Previously scored cases
can guide development but cannot become a replacement validation set. Unknown
completeness and current presence remain mandatory in any portable evidence.

One capture attempt stopped after seven valid cases because a voice start offset
of 173 ms exceeded the unchanged 150 ms limit. A separate, disjoint retry captured
the remaining 21 cases and passed both clock and capture tests. Valid receipts
and audio were merged with their attempt provenance; the failed log and trace
remain. During pre-capture standalone-module extraction, a missing digest helper
was restored before import or scoring. Its initial source/freeze are retained;
search settings, case list and gates did not change.

The evaluator calls `fit(data)` before reading the authored answer. The fixed
fit prefix excludes later target samples. Note-set scoring concerns the union
of authored events in that history interval, including released notes; it does
not interpret key-up as acoustic absence or establish a current pitch set.
Selected reference velocity identifies a template, not an independently
measured physical velocity or hand assignment.

The primary [context-dependent piano transcription paper](https://labsites.rochester.edu/air/publications/cogliati2016Context.pdf)
supports investigating waveform dictionaries specific to a piano and environment.
It also discusses how dynamic and duration mismatch can produce extra
activations. This prototype uses bounded nonnegative pursuit and explicit band
and release alternatives; it is not the paper's complete convolutional sparse
coding solver. That paper's results do not qualify this implementation.

All processing stays in Keyspilli. Anti remains standalone Gemini advisory
support through a connected Google AI account. This study uses no Gemini calls,
uploads or new owner listening. Installed adoption, signing, merge and deployment
remain deferred.

Private reproducibility root:
`output/music-review/20261005-afk/player-search-solution/20261006-014631`.
