# All-song Chords implementation checkpoint — 24 September 2026

## Decision

The shared backing producer has **not** been replaced. The source evidence available to the current Player does not yet support a recognizable, vocal-free backing arrangement for every visible song. The authored-only candidate was reverted: it would silence almost all generated-only songs. A conservative unlabeled-source experiment was also rejected after exact-phrase replay. Neither the current route nor these rejected candidates satisfy the user's all-song goal.

Chords remains one Advanced-derived arrangement per song on PR #105, independent of the selected difficulty. The user accepted the experimental full-song Winner backing for singing, with residual sung-line uncertainty; that result does not generalize to the catalogue. The learner cannot provide a physical piano test, so keyboard playability requires an independent pianist or teacher.

## Identity and evidence

- Current main and production health both reported 661a5aa8e2a9495b503b9cb59dc8c54feb5cf660 on 24 September; production reported healthy and 2,622 visible variant rows. Draft PR #105 remained at b80f9014fc0dcd142e3a765d31ff598c6ff25c2d. The isolated implementation branch starts from that PR, not current main.
- The local canonical data snapshot differs from production: 459 visible bases, 5 hidden and no orphan Advanced artifacts; 455 bases have generated-only chords and 4 have none. Only one visible base has a non-fallback catalogue chord chart. The new read-only evaluator found 429 bases with at least one unsupported span on the raw Advanced artifact timeline. Its default is explicitly not an exact Player Auto hybrid replay.
- Exact ignored API snapshot SHA-256: Oops 0ae0bfb2f5032ee6d45fd29a2a7208a57380dc13e2cf429fa6b4b0f2affcb903; Queen ab88c13729549e1964aafa3f3eb808b72df590666d8d824ded610e805033f5ac; Blackbird 90e3da1075e1eb78bf80ce2f237b0c3a31785c2733a7604266bb21802813872e. Winner Advanced notes: 9d9ae9b17b3bd10ebc973d549b12d1102606e66a9342a4702d449e7f73afd664.
- Those exact Oops, Queen and Blackbird snapshots have 1,891 / 2,364 / 1,069 Advanced notes and no semantic source role labels. A hand or register cannot prove vocal ownership. New MIDI track and MusicXML staff/voice origins survive parse, quantization, Advanced selection and JSON; they affect future imports only. The current catalogue has not been rebuilt.

### Read-only production Advanced corpus — 24 September

Copied only production `*/a/notes.json` files to ignored local scratch; the 452-file tar is 39,208,960 bytes with SHA-256 `051193a56f3c8f4d5ae6f322cc9461903f3b189aaded4bc4214d0ac31fd48b50`. A separate read-only SQLite and visibility-policy query found 451 database bases, 14 hidden bases, 437 visible bases and one orphan Advanced artifact. The per-base source-hash and raw-artifact resolver report is in ignored `output/chords-all-songs-review/production-artifact-baseline-20260924.json`; this is not an atomic database/artifact snapshot and does not replay Player Auto's hybrid chart choice.

Among the 437 visible Advanced artifacts, 432 have generated chord labels only, three have no source chord labels, and two have only non-generated labels. Their 522,056 notes include 505,888 without a semantic source role; only eight songs have any note marked `vocals`. No current production note has the new `sourceOrigins` field. The raw-artifact backing resolver reports unsupported spans in 425 songs, with three emitting no audio attacks and 26 covering under 80% of the artifact duration. Its median covered fraction is 93.7%, which cannot establish correct harmony, rhythm, source-role separation or singability. The Winner artifact hash matches the earlier experimental source (`9d9ae9b17b3bd10ebc973d549b12d1102606e66a9342a4702d449e7f73afd664`); the Oops, Queen and Blackbird API-snapshot hashes above describe different serialized payloads and must not be substituted for their production artifact hashes.

## Rejected implementation probes

| Candidate | Result | Why not promoted |
| --- | --- | --- |
| Authored-chart-only shared helper | Only one current local base has a non-fallback chart; no Player chart-coverage input exists | Would remove backing for nearly all visible songs |
| Existing attack-cluster harmony detector | Mostly single/power evidence for Oops and Blackbird; localized Queen triads | Does not establish whole-song harmony, rhythm or source role |
| Conservative low/middle triad experiment | Oops beats 48–112: 2/64 supported beats; Queen 6–36: 14/30; Blackbird 14–30: 4.38/16 with questionable Cm; Winner 60–84: 1.5/24 | Large musical gaps and unresolved role/ending evidence. Synthetic rest and labeled-vocal checks pass, but that is insufficient |

The ignored scratch implementation and full diagnostic are at output/chords-all-songs-experiment/prototype.py and report.txt in the isolated worktree. They are not shipped code. Current generated charts can show high beat coverage by holding a stale or wrong chord; coverage is not harmonic correctness.

## Implemented preparation and checks

- Added a read-only visible-base inventory and candidate evaluator. The evaluator counts both note and chord audio streams and reports duplicate scheduled attacks rather than hiding them. It records source hashes, unsupported spans, register and onset geometry, and labels raw-artifact versus injected-candidate inputs.
- Preserved neutral source note origins and cleared semantic role on mixed quantize lineage. Player correction IDs now use those origins when present, preserving legacy IDs for records without them.
- Node 22 checks: MIDI 19 files / 413 tests passed; player-core 18 files / 295 tests passed; focused catalogue ingestion, coverage and evaluator 3 files / 26 tests passed; MIDI, player-core, catalogue and web typechecks passed. Draft PR #106's only triggered `Tutorial runtime candidate` container-smoke passed; it is neither a Chords musical check nor full release CI. No human listening gate or real-keyboard test was completed for this branch.
- Canonical checkout WIP, production data, catalogue artifacts, PR #105, merge and deployment were left untouched.

## Next implementation boundary

1. Use the read-only production Advanced corpus above as the comparison input for a new producer. Separate source rests and N.C. from missing harmony; retain exact meter/pickup boundaries. Refresh the corpus and verify Player's actual chart input before a release decision.
2. Make source-role evidence available to the Player through a separately reviewed import/catalogue change. Where the original score lacks role proof or harmonic thirds, prepare fingerprinted per-song chart or accompaniment corrections and human review. No generic hand mute, power-chord carry or threshold relaxation can stand in for that evidence.
3. Build the smallest shared producer only after complete Oops, Queen, Blackbird and Winner phrase timelines pass matched listening, including bar endings and sung-line exclusion. Use the same realized events for audio, labels, guidance and grading. Keep the optional melody path separate.
4. Run candidate diagnostics on every visible base, then the existing minimum ten-song musical gate across source types, all known unsupported controls, and independent pianist/teacher keyboard review. All-song completion requires each visible song to be reviewed or an explicitly agreed exception policy; honest silence is not completion.
5. Any catalogue rebuild, merge or production deployment needs a concrete reviewed batch and separate release authorization. No release approval is inferred from the Winner sing-along or passing tests.

General music-theory principles used in the rejected experiment: [triads and inversion](https://openmusictheory.github.io/triads.html), [embellishing tones](https://openmusictheory.github.io/embellishingTones.html), [meter](https://openmusictheory.github.io/meter.html), and [keyboard voice leading](https://openmusictheory.github.io/melodicKeyboardStyle.html). These principles do not prove the imported song harmony.
