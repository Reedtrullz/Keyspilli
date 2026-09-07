# Metal-to-piano execution checkpoint — 7 September 2026

Status: **listening gate failed; candidates rejected; not release-ready**. Work is isolated on `codex/metal-delivery` in `/Users/reidar/Projectos/.keyspilli-worktrees/metal-delivery`. Original workspace WIP and approved catalog songs are preserved. No production application deployment or catalog mutation occurred.

## Implemented and verified

- Commit `fd8e6ba`: preserve the six-source separator's piano evidence in the residual stream; evaluator uses actual stem provenance and production-equivalent serialized MIDI/variant settings. Real-WAV regression covers float mixing, block boundaries, mismatch rejection and four-source compatibility.
- Shared arranger now converts differing stem/native tempo timelines through elapsed seconds before combining events. Covers half-tempo encoding and notes crossing tempo changes; input objects are preserved. This is transport correctness, not a transcription improvement.
- Same cached source: correcting evaluator semantics changes RH note count from 323 to152 (1012 to800 total). This is an evaluation discrepancy, not musical progress.
- Latest verification: complete MIDI package361 tests; evaluator55 tests; earlier service42 tests and Python waveform regression; MIDI/catalog/transcribe typechecks. No live publication or player acceptance claim.

## Frozen evidence and controlled comparison

All38 selected recordings downloaded and SHA256-frozen:12 development,20 supported holdouts,6 challenges. Only development recordings have predictions. No held-out score or MIDI reference was inspected. Composition identity is based on source metadata; independent full-song recording verification remains pending. The Opeth challenge exceeds the current600-second limit and tests that boundary.

All12 development songs completed full separation, role transcription, canonical MIDI and six internal variants (five public levels). Baseline and piano-preserved candidates share the same separation and settings; only residual piano inclusion differs. Both include the timeline repair. All144 difficulty MIDI exports parse and have the expected normalized variant tempo. A private runner typo gave the first song's initial difficulty exports an incorrect tempo; those12 files were repaired and rechecked. Canonical A/B audio was unaffected. Existing variant integer-BPM normalization is retained.

| Song | RH notes baseline → repaired | Repaired maximum RH inter-attack gap (s) | Local A/B run (s) |
|---|---:|---:|---:|
| Army of the Night |598 →604|4.356|56.9|
| Holy Diver |551 →552|5.517|63.4|
| Still Loving You |539 →534|3.613|71.8|
| Stand My Ground |753 →747|1.534|57.9|
| Balls to the Wall |270 →266|11.721|64.3|
| Breaking the Law |272 →282|4.531|44.2|
| Eden |763 →756|2.150|64.3|
| Hearts on Fire |497 →495|4.098|110.1|
| Silent Lucidity |1208 →1210|1.789|84.7|
| Hunting High and Low |755 →755|3.543|59.6|
| Nemo |762 →773|4.867|57.5|
| Symphony of Destruction |579 →580|4.915|57.6|

Counts and gaps are diagnostics, not note-accuracy scores.22/24 canonical candidates pass the structural gate. Both Silent Lucidity candidates fail its maximum-sounding-simultaneity rule (9 versus8); no threshold was relaxed. Reidar rejected the initial A/B previews after brief listening as far below acceptable quality. This rejects promotion; it is not an exhaustive twelve-song score. Section labels, source-supported rests and independently verified full-song references are unavailable, not implicitly passing.

A preliminary visual check against [the artist-hosted Breaking the Law tab, page1](https://judaspriest.com/tabs/images/breakingthelaw_1.jpg) found the opening guitar prediction contains recognizable low-register riff material alongside extra high pitches; the arranged RH includes those competing pitches around4–6seconds. This is a specific upstream-plus-selection defect requiring review, not a completed objective reference score or proof that the entire transcription is wrong. The reference was consulted after generation and only for development. Do not promote the piano repair as solving this failure.

## Resource measurement

A separate255.8-second diagnostic ran in an isolated directory inside deployed worker image `ghcr.io/reedtrullz/keyspilli-worker:c36680100de9`, leaving `/app` and the job queue untouched. It completed pipeline → MIDI → variants without variant errors. Including tempo estimation:912.9seconds (~15.2minutes); separation745.1seconds (~12.4minutes), peak child RSS2303692KiB (~2.20GiB). Other stage RSS was below520000KiB. This is one CPU diagnostic, not queue/restart/retry/publication verification or a latency percentile.

Local MPS A/B median61.5seconds, maximum110.1seconds for this12-song set. Local and VPS timings are not directly comparable: different recordings, hardware and an additional residual A/B transcription locally. Local free disk was67GiB at the last heavy-run check; no new model backend was selected. Exact peak scratch disk was not sampled and remains unavailable. Private stage logs retain per-stage measurements; first two macOS stage records used a mislabeled KiB field containing bytes and must be interpreted as bytes.

## Next gate and retained work

The approved plan requires musical/source evidence before source-route selection and release. Continue with independent section references and human full-song/level review; use those to isolate separation, transcription and selection faults. Resolve Silent Lucidity's nine-note overlap without hiding it via a looser gate. No backend should be added merely because the outputs remain imperfect.

WP1 is substantially complete; peak scratch disk and full worker failure paths remain unmeasured. WP2 has frozen sources and listening material, but lacks full section/reference and musician acceptance. WP3 has evidence/timing repairs and12-song A/B generation, but no musical promotion decision. WP4–7 remain gated. The20 holdouts are not a tuning set; do not run them until a candidate is frozen.18/20 release acceptance has not been attempted or achieved.

Private evidence lives under `output/metal-development/`: per-song `runs/`, canonical MIDI/MP3, role MIDI, reports, acquisition/source hashes, scripts, tests and VPS measurements. The versioned JSON scorecard and source manifests are alongside this report. Listening pages use the same soundfont and loudness target; A/B labels are concealed in presentation but not a secure blinded study. Initial3-song page is preserved; `listening-all.html` adds all12 without discarding any open review form.

## Listening rejection and traced failure

Reidar heard enough of the initial A/B previews to reject both as far from good enough. No additional exhaustive listening is required to reject this candidate. The automatic upstream/selection quality requirement remains unmet.

The existing provenance trace confirms that, in the Breaking the Law opening around3.4–6.4seconds, three low guitar events are marked `rhythm-only` and excluded from lead eligibility. Competing high guitar predictions remain eligible and appear in RH output. Other low riff events survive selection but are displaced downstream. This implicates both noisy transcription and role/identity selection; a global note-density or pitch cutoff would not establish a correct fix. Private trace: `output/metal-development/breaking-opening-trace.json`. No song-specific override was added.
