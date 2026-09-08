# Metal recovery decision — 7 September 2026

## Decision

The next milestone is accurate melody-only output on independently checked development excerpts. Do not spend another full-song inference cycle generating five polished difficulties from an unverified lead. The failed candidate needs both better note recovery and less destructive source/role selection. Neither the piano-stem repair nor a model swap alone establishes a fix.

## New isolation evidence

Ran `output/metal-development/isolate-identity.mts` at `2934f1f` using an invented16-note riff, fixed120BPM, and optional known bass/upper-note contamination. Matching is pitch class plus onset within0.125beat (octave changes allowed). This is a controlled diagnostic, not real-song accuracy or a held-out benchmark.

| Input | Intended attacks matched anywhere | Matched in RH | Total RH attacks |
|---|---:|---:|---:|
| Clean low guitar riff |16/16|12/16|12|
| Same riff with clean bass |16/16|12/16|12|
| Same riff two octaves higher with bass |16/16|16/16|16|
| Low riff plus six false upper notes and bass |15/16|8/16|13|
| Clean vocal melody with bass |16/16|16/16|16|

A split between hands is not inherently an error; the clean low riff remains complete across hands. The contaminated case demonstrates fragility: five RH notes do not match intended pitch-class/onset, while intended notes are displaced or moved into LH. This supports the real Breaking the Law trace, where some low riff events are marked rhythm-only and high competing predictions reach RH. It does not prove a particular future selector will solve full-song transcription.

## Concrete work, in order

1. **Create a small real accuracy target before further tuning.** Use three development recordings spanning riff-led, clean-vocal and keyboard-layered material. Annotate20–30seconds each, including a main theme and handoff where practical, with independent score/ear verification and exact source offsets. Start with the available artist-hosted Breaking the Law opening tab; obtain melody references for the other two rather than treating existing output as truth. No prepared user MIDI is required, but annotation quality must be checked. Keep the20 release holdouts sealed.
2. **Compare raw recovery before arrangement.** For the same excerpts, measure missed, extra, octave and onset errors per role. Compare separated Basic Pitch with the already-evaluated MuScriptor as a development challenger; its previous synthetic regression still forbids promotion. Use YourMT3+ only as the second challenger if necessary and runnable/licensable. No new model dependency is selected today. If raw melody is inaccurate, change the transcription route rather than compensating with arrangement filters. Preserve raw confidence/activation evidence where available; current MIDI loses that information.
3. **Establish one protected identity phrase before assigning hands.** Reuse `MetalArrangementIR.identity` and existing trace facilities. Select coherent melody/riff phrases using source timing and contour evidence, allowing low guitar to be the theme. Do not decide rhythm-only from register before evaluating the phrase. Constrain later simplification to preserve the selected identity's pitch-class/onset sequence; move a whole phrase by octaves when needed rather than assembling notes from competing registers. Test high true melody over low rhythm as well as low true riff with high false partials; a global preference for low or high notes is not sufficient.
4. **Add accompaniment only after the lead passes.** Use verified bass/root evidence for restrained LH accompaniment, retaining power-chord ambiguity. Confirm the result against a reference-fed arrangement so transcription and arrangement errors remain distinguishable. Then check all12 full development songs and five public levels for retained theme and form. Resolve the existing Silent Lucidity9-note overlap separately; do not relax its structural threshold.
5. **Make the product's source route useful.** Reuse existing symbolic/piano adapters, but connect discovery/acquisition, identity/version checks, parsing and worker execution: the current route adapter accepts an already-realized frozen output and performs no acquisition, so it is not automatic source discovery. The piano transcriber is an injectable command adapter, not an installed proven piano model. Verified user MIDI/score or a clearly selected piano tutorial is a viable source route; silently replacing the requested recording with a cover is not. The successful Livgardet/ABBA examples support exploring that route, not claiming universal coverage.
6. **Only then certify automation.** Remove indistinguishable ready full-mix fallback after stem failure; preserve good prior outputs. Freeze the successful candidate and apply the existing20-song18/20 acceptance gate, including full-song, five-level, export and worker/player checks. Report supported-source coverage and conversion quality separately.

## Why these model choices

Spotify explicitly says [Basic Pitch works best with one instrument at a time](https://github.com/spotify/basic-pitch). Separated stems can still contain multiple parts and artifacts; this is consistent with the observed contamination, not proof that every stem is unusable.

[MuScriptor](https://github.com/muscriptor/muscriptor) is a multi-instrument model already exercised in this repository. Historical macro synthetic exact-pitch/onset F1 improved from0.491 to0.820, but layered material regressed0.110 and failed its fixed gate. That evidence justifies a bounded diagnostic trial on these different development clips, not deployment or reinterpretation of the failed evaluation. Its model weights require CC BY-NC4.0 acceptance; production suitability must be resolved before adoption.

[YourMT3+](https://arxiv.org/abs/2407.04822) reports direct vocal transcription and instrument-aware decoding. It is a second comparison candidate, not a promised fix. The [official repository](https://github.com/mimbres/YourMT3) still routes to pre-release code/demo instructions and notes YouTube access problems, so runtime packaging and local-file inference must be verified before selecting it.

## Exit that would justify the next expensive run

A independently verified melody-only excerpt should have no plainly wrong main-theme pitch, missing phrase or spurious competing line; retain numeric error counts and listening evidence. The reference-fed arrangement must preserve that theme through hand assignment and difficulty generation. If those fail, additional full-song rendering is premature. Passing excerpts is necessary but not sufficient: full12-song development and untouched holdout acceptance remain required.

No production code changed in this follow-up. No new backend installed, source accuracy percentage established, held-out inference run or deployment made. The runnable diagnostic and detailed output remain in private `output/metal-development/`; this report contains only aggregate measurements and implementation decisions.
