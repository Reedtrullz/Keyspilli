# Full piano Player search controls — 06-10-2026

This follows the closed [eight-pitch search](player-search-controls.md), whose
quiet foreign-note mixtures returned incomplete subsets. The new experiment
uses the full MIDI 21–108 piano range and five velocity bands. It is a private
known-renderer diagnostic; no production detector or automatic repair changes.

The reference generator pins the installed self-contained smplr 1.0.0 module,
all 226 previously observed sample assets, and the Player's sample/bus/gain/release
behavior. Each of 440 references is rendered with a fresh stereo 44.1 kHz
OfflineAudioContext, MIDI 21–108, velocity 32/56/76/92/112, backing gain 0.4,
onset 50 ms and duration 2.2 seconds. Each unclipped Float32 WAV lasts 2.3 seconds.
The decoded sample loader is shared; voice/output nodes are disposed per render.
The generator permits only the exact pinned local module and sample URLs. It
makes no provider requests and does not record microphone or personal audio.

Before model development, all 440 references passed finite/nonzero format,
rate, frame-count and digest checks. All 40 earlier isolated live Player
references passed the predeclared 1% waveform correspondence and 0.98–1.02 gain
bounds, with maximum relative error 0.831%. Alignment uses those isolated
reference labels and recorded starts, with at most one native-sample refinement.
This establishes renderer correspondence, not blind pitch or musical accuracy.

The search uses the first 1.2 seconds of stereo compressor-input audio, including
leading silence. Native-rate waveform correlation selects up to eight events;
nonnegative refits reconsider velocity bands, phase and release after other
voices have been fitted. It receives no target score, note list, transport
start or velocity/duration labels. Selected bands are template alternatives,
not measured physical velocity or hand assignment. Results describe history
pitch sets; current note presence, completeness and acoustic absence are unknown.

A disk-backed dictionary holds 1,760 coarse atoms in 16-atom blocks. FFT and
lag-dependent normalization arrays occupy approximately 1.86 GB; each block is
mapped, copied and released during correlation. The full matrix is never kept
in RAM. Cache identity binds module source, reference manifest and configuration;
a partial or stale cache refuses. Construction checks the 30 GiB disk reserve
before every block. The private bank and cache are evidence, not bundled plugin
assets or an implicit download on user invocation.

Known development replays comprise 14 earlier signal targets and 28 previously
scored search cases. The new full bank recovered 41/42 complete authored history
sets, including all four earlier quiet omitted notes and all four foreign solos.
One octave case withheld because a tiny extra MIDI 72 activation duplicated an
already identified pitch. That ambiguity is retained. Process maximum RSS was
298,647,552 bytes. Previously scored cases remain development evidence.

Seed 610654 freezes 54 independent cases, source identities, configuration and
pass criteria before capture or scoring. Thirty mixtures cover all 88 pitches,
with varied velocities, buses, overlap and releases. Sixteen quiet-note cases
use MIDI 49/61/69/73 at velocity 8/12/16/24 on the backing bus against MIDI 64/72
at velocity 112 on the melody bus. Eight cases test repeated notes and releases.
Coverage requires at least 27/30 exact core sets, 14/16 exact quiet sets and
7/8 exact repeat sets, with no accepted incorrect set. Silence must refuse;
fit p95 must be at most 20 seconds and process maximum RSS at most 2 GiB.
The minimum candidate amplitude is 0.05; nominal velocity 8 relative to filtered
reference velocity 32 has gain 0.0625. Any positive weaker fitted activation
withholds the accepted set. Earlier studies retain their original settings.

The evaluator validates capture hashes and the paired input/output frame clock,
then calls `fit(data)` before reading each authored answer. Per-case latency
covers fitting only; process RSS includes imports, references and later controls.
Fourteen earlier mono compressed outputs, deliberately duplicated to stereo,
are separate wrong-signal-domain controls. They are not authentic input captures.
This finite corpus does not establish universal quiet-note recall, microphone
transcription, full-command/30-second throughput, source fidelity, event timing,
physical note-offs, or current-key state.

The frozen screen passed every predeclared gate: 29/30 exact core history sets,
16/16 exact quiet mixtures and 8/8 exact repeat/release sets. One MIDI 96 solo
refused at −55.54 dBFS, below the unchanged −50 dBFS level floor. No accepted
incorrect set, added false pitch or omitted authored pitch occurred among the
53 accepted cases. All 88 pitches were tested; the accepted core cases cover
87 pitches, with MIDI 96 withheld. Silence refused, and all fourteen wrong-signal
domain controls withheld. No search setting or study gate changed after scoring.

Fresh fit p95 was 10.51 seconds, maximum
10.89 seconds. Process maximum RSS was
390,070,272 bytes, including imports, references and the later
negative controls. The exact constrained screen qualifies these measurements;
production profile admission remains false. It does not establish universal
quiet-note recall or input-domain authentication from waveform fit alone.

Two capture attempts rejected the first unsorted repeat fixture after the initial
47 valid cases. The fixture generator serialized an early backing note after a
later melody note. Player preserves source order and binary-searches note times,
so that array produced a delayed extra backing attack. Before any pitch scoring,
four remaining repeat arrays were stably sorted by start beat. Every event
multiset, pitch, start, duration, velocity, hand, case ID, expected capture timing,
search setting and gate remained unchanged. Original bundles, failed traces and
logs are retained. The corrected disjoint seven-case retry passed both clock and
capture tests; 54 valid receipts retain their attempt provenance.

The maintained capture configuration now rejects unordered or nonfinite note
starts before creating a scratch catalog. Regression checks use the actual bad
repeat fixture and a nonfinite-start control: both refuse without a catalog.
The same fixture with ordered simultaneous attacks lists both tests successfully.
This prevents misleading captures; it does not change runtime Player scheduling.

All renderer and signal processing stays in Keyspilli. Anti remains standalone
Gemini advisory support for connected Google AI accounts and generic supplied
evidence. No Gemini calls, uploads or new owner listening are used. Installed
adoption, signing, merge and deployment remain deferred.

Private reproducibility root:
`output/music-review/20261005-afk/player-full-range/20261006-020611`.

The separate [compressed-output follow-up](player-output-controls.md) confirms
that mono downmix alone succeeds on six known controls, while final compression
invalidates the linear fit. Native compressor correction still omits quiet notes
despite very small output error. Keep paired input-side findings and final audible
output evidence distinct; this study does not qualify final-WAV transcription.

## Maintained explicit preparation

`apps/web/scripts/build-player-reference-bank.mts --sample-assets PINNED.json --module LOCAL.mjs --output NEW_BANK` renders only explicitly permitted local pinned assets. It does not fetch missing samples. Dictionary generation is separate: `services/transcribe/src/player_input_evidence.py --build-dictionary MANIFEST.json --output NEW_DIR`. Completion publishes the dictionary identity atomically; inference refuses stale/partial arrays and never rebuilds them.

The maintained fitter consumes only capture/bank/dictionary paths. Use the pinned small Python requirements and single BLAS/OMP thread. `prepare-player-music-review.mts` defaults to no execution; explicit `--execute` validates all paired bytes, applies a 120-second local process limit, and saves failures as unavailable/failed channels. Current keys, audible completeness and musical/source acceptance remain unknown. See [release qualification](music-evidence-release-qualification.md) for the new study's failed capture and pending admission; old 53/54 evidence is not fresh qualification.
