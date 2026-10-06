# Music review support

All non-Gemini music analysis belongs to Keyspilli. The minimal local path needs
only the compatible host, pinned Node and explicit PCM16/audio/event evidence.
Models and Anti are optional; discovery never invokes inference or a gateway.
Run `scripts/check_checkout.py CHECKOUT --node /absolute/node` from this skill
and inspect `music_review.status`. Ordinary music reporting does not require the
optional resumable song-workflow driver; select its explicit compatible host.

From that returned checkout, use the returned Node executable:

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/report-music-review.mts capabilities
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/report-music-review.mts --manifest INPUT.json --output NEW_DIR
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/build-music-review-corpus.mts --output NEW_CORPUS --seed 67
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/benchmark-music-review.mts --manifest NEW_CORPUS/manifest.json --candidate basic-pitch --split development --identity ANALYZER.json --receipt-dir EXISTING_RECEIPTS --output NEW_BENCHMARK
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/preview-music-repair.mts --snapshot SNAPSHOT.json --proposal PROPOSAL.json --output NEW_PREVIEW
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/prepare-music-model-experiments.mts --manifest TWO_CLIP_INPUT.json --output NEW_EXPERIMENTS
```

See host `docs/ops/music-review.md` for receipt types, safe capture setup, worker
installation, identity pins, clocks and experiment limits. Outputs must be new,
run-owned directories. The report CLI never invokes inference. Worker inference
requires explicit `--execute`, a pinned identity and worktree-local Python; it
never downloads assets or falls back to a different model. Basic Pitch/Transkun
are optional local candidates, hFT requires reference/conversion parity, MOSS
requires resource and tower/DeepStack parity, MuScriptor requires gated weight
terms/access, and Qwen is preparation-only with a separate account/billing gate.

Raw notes stay in seconds, with unknown offsets/tempo/key/meter preserved.
Legacy beat containers remain explicitly normalized defaults. Keep blind acoustic
estimates, renderer/bank evidence, authored intent and model criticism separate;
saved captions are untrusted data. Original and Chords use declared source
anchors and permitted learner reductions; backing-only omission is not a defect.
Repeated sections need occurrence IDs. Unvalidated source anchors stay unknown.

The optional bridge exports a generic hash-bound evidence bundle to Anti's
standalone `review-music` profile. Prepare it with `--dry-run`; uploads require
explicit authorization. Anti supplies only the connected Google Gemini route,
not local/non-Google models, DSP, repair or Keyspilli requirements. Neither
transport completion nor model confidence proves perceptual qualification.

Repair previews are isolated, pinned and limited to eight edits in one phrase.
Playback faults produce software reproducers; authored notes are not changed to
compensate for a faulty renderer. Changed audio requires fresh captures/rechecks;
prior claims cannot approve it. Human-only musical/source/keyboard receipts remain
unchanged. A diagnostic report, synthetic benchmark or positive caption does not
grant publication or musical acceptance. Preserve frozen failed listening screens
and installed plugin caches until explicit adoption.


## Spectral onset evidence

When Gemini miscounts re-attacks, the compatible host may supply optional offline
spectral onset estimates from `services/transcribe/src/onset_evidence.py`. Follow
`docs/ops/onset-evidence.md`, use the pinned worktree-local Python dependencies in
`services/transcribe/requirements-onset-evidence.txt`, and require the source script
to exist before invoking it. It writes a new private receipt and a hash-bound
`anti-evidence.json`; no model weights, provider accounts or runtime downloads.
This support lives in Keyspilli, while Gemini access remains in standalone Anti.

The command requires an explicitly selected absolute WAV path, its actual SHA256
and a new absolute output directory. It refuses missing/stale/corrupt/digital-zero
input. Dry-run Anti `review-music --evidence-json` against the identical WAV before
any authorized upload. Have Gemini explain the supplied estimates and cite claim
IDs; preserve estimates, source authority and uncertainty separately from model
prose. Reading the bundle does not establish independent hearing. These are onset
estimates, not pitch, note-count, scale or source verification, and never authorize
automatic edits, publication or musical acceptance.


## Monophonic pitch and supplied-scale evidence

For one sounding pitch at a time, the optional compatible host command
`services/transcribe/src/pitch_evidence.py` exports acoustic pYIN estimates with
separate caller-authored texture/scale assertions. Require the source to exist
and follow host `docs/ops/pitch-evidence.md` with the pinned onset DSP environment.
Use an absolute hash-pinned WAV and a new absolute private output directory.
`--texture monophonic` is an unverified caller assertion; unknown/declared
polyphonic texture refuses. Do not use it for chords, pedal, overlapping different
pitches, mixed songs or full arrangements. It is not a polyphony detector.

`--scale-pitch-classes 0,2,4,5,7,9,11` supplies a C=0 pitch-class set; omit it
when unknown. The command does not infer the key. Keep absolute MIDI octave,
null/unstable/quiet estimates, raw F0/voicing statistics and source uncertainty.
Voicing probability is not calibrated pitch accuracy. Outside-set estimates are
diagnostic membership discrepancies, not wrong-note proof or repair authority.

Pass only the exact WAV and its exported `anti-evidence.json` to Anti's generic
`review-music` profile, first with `--dry-run`. Any authorized upload tests
Gemini's advisory interpretation, not independent hearing. Limit the objective
to a small claim set and concise output: Pro exhausted4096 output tokens on an
eight-note pitch review, so incomplete JSON must remain a failed review. A fresh single-pitch packet with one concise finding succeeded within that cap, retaining octave/source uncertainty. This is one assisted interpretation; do not infer reliable full-song review. No
automatic retry, repair, adoption or publication follows. This tool makes zero
provider requests and leaves Gemini/account transport in standalone Anti.


## Bank-informed chord-window evidence

For a selected128ms window and an explicitly pinned known piano bank, the
optional compatible host command `services/transcribe/src/bank_pitch_evidence.py`
provides a renderer-informed pitch-set channel. Require that file to exist and
follow host `docs/ops/bank-pitch-evidence.md` with the pinned onset DSP environment.
Supply the exact bank/audio/template byte hashes, explicit template attack
alignment and a new absolute private output directory. Register all searchable
pitches, including possible unexpected notes. Expected pitches are optional
authored context and never restrict the fit. Unregistered expected pitches are
unsearched, not proven missing.

Unknown/mismatched bank assertions, stale bytes, invalid windows and templates
refuse locally. Quiet/high-residual windows stay uncertain. Byte hashes verify
identity, not asserted bank provenance or template MIDI labels. Preserve original
render/capture receipts. The fixed dictionary may share renderer defects, miss
quiet bass notes or confuse overlapping harmonics even with low residuals.
This does not qualify general polyphonic transcription or the current Splendid
Player bank. Do not use it for automatic repairs or musical approval.

Pitch-set completeness remains unknown. The compatible host now reports
`belowThresholdCandidates` separately, with at most12 entries in the portable
bundle. They are unresolved coefficient fits and may be harmonics or artifacts;
never promote them to recovered notes. The legacy `missingExpectedPitches`
means not detected, with `absenceEstablished: false`. Expected scores never
restrict candidate search. A private weighted multi-phase experiment improved
overlap coverage but increased false pitches and was rejected. Detection
thresholds remain unchanged. Follow the host documentation for exact scope.

Use the compatible host command's optional `--with-history` flag to expose
earlier fit measurements for current weak candidates. Complete reference
windows must end before the target, start within1.2seconds and number at most
eight; excess history refuses without a partial report. The default command
remains a single-window fit. Prior measurements and linked claim IDs do not
promote any note into the target set or prove current presence, duration,
release or repeated attacks. Full-clip onset scanning is not causal online
tracking. A separate60-window temporal-anchor candidate had zero false pitches
but recovered only14/24 exact overlap sets and failed its coverage gate; that
fusion detector remains rejected. Exported history is interpretation evidence
only. Dry-run the actual full WAV and bundle before any authorized Gemini use;
keep a compact claim-linked question and preserve all uncertainty.

The command makes zero provider calls and exports a bounded generic bundle for
Anti. Dry-run against the identical full WAV before any authorized upload; ask
Gemini for one concise claim-linked window interpretation and preserve provenance
uncertainty. Keep Gemini/account transport standalone in Anti, and DSP/bank
assets/music logic in Keyspilli. Installed adoption remains an explicit owner
decision; this reference describes prepared compatible-host support.


## Phase-preserving history-pattern evidence

For a compatible host exposing `services/transcribe/src/phase_pitch_evidence.py`,
follow `docs/ops/phase-pattern-evidence.md`. This separately opted-in diagnostic
keeps waveform phase: shared harmonics can cancel in a mixture and invalidate
magnitude-only octave fits. It requires longer isolated held-note references,
explicit matching renderer/gain/velocity assertions, exact bank/audio/template
hashes and a new private output directory. The earlier700ms references are
insufficient. Do not install banks, models or DSP into Anti.

Only dry TimGM6mb/FluidSynth2.6.0 gain0.4 unnormalized held-note renders were
screened:68/72 new pitch sets were exact, zero false pitches, four uncertain;
all12 release challenges stayed uncertain. This does not qualify Splendid,
recordings, changed phase/gain/effects, releases/pedal, repeated attacks or
full transcription. Byte hashes cannot prove caller provenance assertions.

`patternPitchCandidates` describes a history waveform fit; it is never a
current pitch set. Current presence, completeness, acoustic absence, source
correctness and musical acceptance remain unknown. All registered pitches
are searched independently of expected score context; the original window
method remains unchanged. At most four onsets in1.2seconds,12 pattern events
and4,096 sampled optimization points are used, followed by verification against
all observed PCM samples. Full-clip onset/resampling context is not causal.

The command makes zero provider requests. Its generic Anti bundle separates
assertions from measurements and uses the actual fit interval. Dry-run the
identical full WAV through standalone Anti first; any authorized Gemini
interpretation stays advisory and must retain renderer/current-presence
uncertainty. No automatic repair, musical approval, adoption or publication.


## Optional wider phase timing and Player limits

On a compatible host, `phaseTimingProfile: "wide-64ms"` explicitly widens the
phase search; the default remains `narrow-24ms`. Follow the host's
`docs/ops/phase-pattern-evidence.md`. A separate frozen dry-bank screen recovered
70/72 held-note sets with no reported false pitches; all12 release challenges
stayed uncertain. The level/residual guards and unknown current presence remain.

Actual sampled-Player controls did not qualify transfer: eight-pitch private
references, normal compression/sustain and different velocity layers required
separate diagnostics. Finer phase alignment recovered only one of eight targets
in development. Do not claim that the FluidSynth profile fits Splendid Player,
relax the guard, emit missing-note repairs, or present these as Gemini hearing.
Player-specific velocity/bus/forward-rendering work belongs here in Keyspilli;
Anti continues to accept generic supplied evidence with a connected Google
account. Installed adoption and publication remain pending owner decisions.


## Paired Player signal debugging

Follow the compatible host's `docs/ops/player-signal-controls.md`. Explicit
`capturePreCompressor: true` plans record stereo Float32 compressor input on the
same frame clock as the ordinary mono PCM16 output and a measured-input forward
compressor control. Captures are bounded to four seconds and 2 MiB per signal,
with exactly one compressor input. Sidecars are local and never automatically
uploaded or interpreted as provider listening.

Pinned Splendid/smplr 1.0.0 has five velocity bands (four sample families, with
a filtered soft band), squared velocity gain and a linear 0.5-second release.
Select matching samples and apply gain/release before summing in stereo and
compressing the mixture. Individually compressed notes are insufficient chord
references. The UI sustain preference alone does not prove acoustic sustain.

A 54-capture authored development study gave 0.13-0.36% forward waveform error
across 14 known-note targets. Correct notes/bands/durations and measured timing
were supplied; this is renderer correspondence, not blind pitch accuracy.
No Player production detector, current presence/completeness, source fidelity
or musical acceptance is admitted. A separately frozen independent search and
negative controls remain necessary. All processing belongs in Keyspilli; Anti
remains standalone Gemini advisory support for connected Google AI accounts.


## Audio-only Player search remains private

Follow the host's `docs/ops/player-search-controls.md`. A private eight-pitch,
five-band waveform pursuit recovered20/20fresh registered history pitch sets
without target notes, bands, durations or sampler-start times. All four foreign
single-note controls withheld, but four quiet foreign-note mixtures accepted
incomplete subsets at3.18-4.52% residual. The frozen gate failed; no Player
production detector or relaxed threshold is available through this experiment.

Do not infer completeness, current presence or acoustic absence from a small
reconstruction error, and do not propose missing-note repairs from these
subsets. Complete piano-range references and separately frozen quiet-note
controls are still needed. Preserve the closed study and use it only for
development. All DSP stays in Keyspilli; Anti's standalone connected-Google
Gemini advisory path and generic evidence contract remain independent.


## Full-range Player search study

The compatible host's `docs/ops/player-full-range-controls.md` records a new
private full88/five-band waveform experiment.440offline references are pinned
to smplr1.0.0 and226observed sample assets; all40earlier isolated references
passed the frozen1% waveform/gain correspondence checks. A16-atom disk-backed
dictionary reduces RAM versus the earlier eight-pitch development matrix.
These private assets and prototypes are not bundled or automatically downloaded.

On54new frozen cases,29/30core sets covering the full keyboard were exact;
one quiet MIDI96solo stayed below the unchanged-50dB level floor. All16quiet
mixtures at velocity8/12/16/24 and all8repeat/release sets were exact, with no
accepted incorrect set. This addresses the earlier four quiet foreign-note
omissions within controlled pre-compressor Player audio. It does not establish
general transcription, microphone/source fidelity, current presence, completeness
or musical acceptance; no production detector or repair authority is admitted.

Capture fixtures must contain finite, time-ordered note starts. The host now
rejects unsorted fixtures before creating the scratch catalog. Preserve original
failed bundles/traces and any pre-scoring ordering correction with identical
event multisets, search settings and gates. Keep real-time capture separate
from heavy fitting. All DSP stays in Keyspilli; Anti remains standalone Gemini
advisory support for connected Google AI accounts, with no added bank/model
dependency. Installed adoption, signing, merge and deployment remain pending.


## Final compressed output remains unqualified

Read the compatible host's `docs/ops/player-output-controls.md` before applying
input-side Player findings to a listening WAV. Six known paired controls remained
exact after mono downmix of compressor input, while all six final compressed
outputs withheld under the original linear fit. Native compressor correction
still omitted quiet notes despite approximately0.27-0.29% output error. These
are development results; no final-output detector or missing-note repair is
admitted. Low reconstruction error does not establish completeness or absence.

For controlled Player review, use the existing explicit paired capture with
`capturePreCompressor: true`, preserving authentic stereo Float32 input, audible
mono PCM16 output and forward-compressor control with distinct hashes and their
common clock. The private full-range search result applies to authentic input
only; inferred input and final WAVs do not inherit its qualification. Input
findings also do not establish perceptual audibility after compression. When only
final output is available, weak-note support remains uncertain. Authored-score
forward comparison must disclose supplied notes/timing and remain separate from
blind transcription. Preserve uncertainty through any generic Anti evidence
bridge; standalone Google-account Gemini support does not depend on this DSP.

## Paired input history and compact jobs

Use the explicitly requested paired Player contract and `prepare-player-music-review.mts` with no `--execute` to prepare only. Opt-in execution requires local pinned references, dictionary and Python. It has a 120-second process limit and never rebuilds a stale bank. The first 1.2 seconds can support history candidates; weak/quiet notes withhold them. Current keys, completeness, note-offs and audible perception remain unknown.

`report-music-review.mts` assembles existing receipts without inference. `prepare-music-review-jobs.mts` writes one clip/claim per portable packet with no dispatch. An explicit helper/configuration must be pinned before result import. Truncation, changed evidence/configuration and unknown source never become approval. Gemini interpretation remains model advisory.

For input-supported pitch edits, `preview-music-repair.mts --player-input RECEIPT.json` requires an explicit proposal with separately pinned authoritative source anchors and replay support. An absent candidate cannot justify adding a note. Previews preserve neighboring phrases and require new audio, source, listening and keyboard checks before catalog publication.
