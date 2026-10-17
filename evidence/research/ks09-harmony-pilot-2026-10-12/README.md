# KS-09 conservative harmony pilot — 2026-10-12

## Outcome and admission

The opt-in `conservative-backing-v1` policy removes the forced major/minor choices in the frozen power-dyad and ambiguous-cluster examples. It reuses the existing harmony path, strict role filtering, `5` parser and actual Player backing resolver. Selected source-supported labels are **not** a guarantee of an audible event: the resolver still requires a real supported source attack.

**Admit only the explicit read-only pilot and its bounded replay API. Do not enable it as the catalog/upload default.** There are no live-song, independent musician, acoustic listening, transcription-model or prevalence results here. The evaluation exposes a substantial arpeggio coverage loss and does not establish broadly calibrated harmony recovery. No catalog artifact, accepted source pin, publication or provider changed.

## Frozen protocol

- Baseline repository: `7d4aa00e2e076586947b67bf78c5488f2c91068b`, the verified Wave 1 integration.
- Corpus/design committed before implementation: `3e0b585`.
- Algorithm, metric implementation and CLI committed before first holdout evaluation: `7bd6891c1388104533ac7c337b5fd80e3f3cc2e6`.
- [pre-holdout-freeze.json](pre-holdout-freeze.json) records the original algorithm,
  evaluator and CLI before the first holdout run. The original corpus and first
  receipts remain unchanged. Independent review subsequently required input
  validation and an opt-in timing correction; later implementation revisions are
  reported separately and cannot claim an untouched holdout.
- [The corpus](../../../packages/midi/test/fixtures/ks09-harmony-pilot-v1.json) has 24 original synthetic composition IDs: 12 development and 12 holdout. Composition IDs do not cross splits. Holdout phrases use different rhythms, event combinations and harmonic contexts rather than only transpositions of development phrases.
- Both splits were written by the implementer before coding. “Holdout” therefore means unused for algorithm tuning, not independently annotated or blinded listening evidence. The related harmonic families are intentionally shared so the holdout tests the stated contract.

Ground truth is a complete partition into supported, unknown and rest spans. Supported spans specify permitted accompaniment pitch classes and the actual bass pitch class. Unknown spans call for abstention. Reference labels explain intent but are not exact-string scoring targets: enharmonic spellings and pitch-equivalent suspension names do not create artificial errors.

The reference denominator stays fixed when source-supported labels fail to produce attacks. It includes the whole intended arpeggio, even its initially incomplete evidence, and the safe fifth-only tail following a released third. These spans were not removed after playback results were observed.

## Original implementation revision 1: actual Player results

These are the original pre-review results. Implementation revision 2 produces
identical results on all 48 corpus/policy combinations, but that later run is an
exposed regression run, not new holdout evidence. Its separate report appears
below.

| Split / policy | Wrong harmony (beats) | Notes in reference rests (beats) | Audible supported duration | Supported audible coverage | Label abstention / non-rest reference |
|---|---:|---:|---:|---:|---:|
| Development — legacy backing | 18.25 | 0 | 32.75 / 35.25 | 92.91% | 4 / 45.75 = 8.74% |
| Development — conservative pilot | 0 | 0 | 29.75 / 35.25 | 84.40% | 11.5 / 45.75 = 25.14% |
| Holdout — legacy backing | 24.25 | 0 | 32.5 / 32.5 | 100% | 1.5 / 46 = 3.26% |
| Holdout — conservative pilot | 0 | 0 | 28.5 / 32.5 | 87.69% | 14 / 46 = 30.43% |

Development includes 54 total beats (35.25 supported, 10.5 unknown and 8.25 rest). Holdout includes 70 total beats (32.5 supported, 13.5 unknown and 24 rest). Raw event-by-event results, selected labels, generated MIDI notes, realized pitch classes/basses, guidance notes and fallback spans are in [development-evaluation.json](development-evaluation.json) and [holdout-evaluation.json](holdout-evaluation.json).

### Labels and audible support are different

| Conservative split | Nonempty selected labels on supported references | Actually audible supported duration |
|---|---:|---:|
| Development | 34.25 / 35.25 beats = 97.16% | 29.75 / 35.25 beats = 84.40% |
| Holdout | 32 / 32.5 beats = 98.46% | 28.5 / 32.5 beats = 87.69% |

Counting selected chord names as delivered backing would conceal the following cases:

| Composition | Source/selected label | Actual resolution | Interpretation |
|---|---|---|---|
| `dev-overlap-arpeggio` | Intended C arpeggio over beats 0–3; policy admits C at beat 1 | No played chord, 0/3 supported beats audible | The original bass attack precedes the admitted label; there is no supported new attack inside it. |
| `dev-third-release` | C at 0–1.5, then C5 at 1.5–4 after the third releases | C only at 0–1.5, 1.5/4 supported beats audible | Source has no fresh attack at 1.5; a new generated bass/chord attack would be fabricated. This audible loss is also present in the legacy baseline. |
| `holdout-pedalled-suspension` | Intended D suspension over 0–4; policy has a supported fifth/suspension label after evidence accumulates | No played chord, 0/4 supported beats audible | Same source-rhythm limitation on a different composition; this coverage loss remains in revision 2. |

The first development replay test initially expected a C event at beat 1 of the arpeggio. Actual inspection showed that this would contradict the existing supported-attack contract. The test was corrected to assert the no-attack behavior and retain the full coverage penalty. The fixture annotation and algorithm were not changed to make the measured result easier.

### Representative realized pitch classes

| Holdout material | Conservative actual output | Bass pitch class | Result |
|---|---|---:|---|
| Modal dyad riff | D5 `[2,9]`, F5 `[0,5]`, E5 `[4,11]` | 2, 5, 4 | No invented thirds; source attacks and release gaps retained. |
| Conflicting Bb thirds, then fifth | First span silent; later Bb5 `[5,10]` | 10 for the supported attack | Conflicting thirds do not force a quality. |
| Chromatic inversion phrase | B/Eb `[3,6,11]`, Gm/Bb `[2,7,10]` | 3, 10 | The existing spelling is enharmonically equivalent to B/D#; bass pitches are preserved. |
| Held seventh with upper decoration | Gmaj7/B `[2,6,7,11]` | 11 | Held durations 4 and 2.75 beats remain intact. |
| Long lyric note over pulses | C#5 `[1,8]` on all three source attacks | 1 | The lyric-bearing E does not establish an accompaniment third or fill release gaps. |
| Inverted fifth then semitone | A5/E `[4,9]`, followed by silence | 4 | The inverted source bass survives; the unrelated semitone cluster remains unknown. |
| Complete sus2 then major resolution | Gsus2 `[2,7,9]`, G `[2,7,11]` | 7, 7 | Positive suspension and ordinary-triad controls remain playable. |
| Root/third dyad with vocal fifth | Silent | — | A vocal note cannot supply the missing accompaniment fifth. |

## Metric definitions and limitations

The evaluator partitions time at every reference, label and realized-note boundary. It counts union duration, so multiple notes and overlapping events do not inflate the denominator.

- **Wrong-harmony duration:** any audible unsupported pitch class, wrong actual lowest pitch class, or any generated notes in an unknown reference span. Missing permitted tones are not penalized as wrong notes; they may be an intentional reduction. This is fidelity to the frozen conservative annotations, not a claim that no alternative musical interpretation exists.
- **Rest violation:** audible generated notes in an explicit reference rest, reported separately from harmonic error. All four runs have zero.
- **Supported audible coverage:** audible duration within supported reference spans divided by all supported reference duration. Wrong notes still count as audible, so high coverage can coexist with poor harmony; the two columns must be read together.
- **Audible coverage over all non-rest references:** the JSON additionally reports this denominator, including unknown material. Conservative values are 65.03% development and 61.96% holdout; deliberate unknown-span silence lowers this figure.
- **Label abstention:** empty/missing selected chord-label duration divided by all non-rest reference duration. It does not count a supported label with no actual source attack as abstention; those gaps appear in audible coverage and raw fallback spans.

The score retains the existing 5% pitch-presence rule and 0.08 ranking-margin threshold. Neither is a calibrated probability. Bass evidence, full-template support and the bounded vocabulary can still choose a musically debatable root or miss a plausible partial chord. Unclassified melody ownership, non-chord bass, dense overlapping harmony, time-varying voicings and dry arpeggios require richer evidence or a separately evaluated arrangement policy. This pilot deliberately has no new source-role model and never invokes the composed `learner-harmonization` path.

A source `5` symbol specifies root/fifth neutrality. Its audible voicing may duplicate or move those pitches into the Player's generated register; that is arrangement, not recovered source performance. No additional pitch class or unsupported bass is admitted in these evaluated outputs.

## Reproduce and inspect an explicit source

Use the repository-supported Node 22.22.3 runtime and installed dependencies. From the repository root:

```bash
node --import tsx apps/web/scripts/evaluate-harmony-pilot.mts --split development --policy compare
node --import tsx apps/web/scripts/evaluate-harmony-pilot.mts --split holdout --policy compare
node --import tsx apps/web/scripts/evaluate-harmony-pilot.mts --source /absolute/path/to/song-data.json --policy conservative-backing-v1
```

`--policy` accepts `legacy-backing`, `conservative-backing-v1` and `compare`. `--split` accepts `development`, `holdout` and `all`; development is the default. `--summary` suppresses raw event rows. `--corpus /absolute/path/to/corpus.json` selects an explicit annotated corpus.

The source form consumes the existing Player `SongData` fields used by the pilot
and validates them before inference: integer MIDI pitches/velocities in 0–127,
finite note intervals inside the complete measure extent, a nonempty string key,
tempo 20–400 BPM, valid meter, and indexed contiguous measures starting at zero.
Optional hand, lyric and role fields must have their declared types. Empty notes
with an explicit valid clock remain honest silence. Authored chord timelines are
not inputs to this generated projection. The command does not mutate the input,
open a catalog connection or persist a choice. Source mode reports
`referenceMetrics: null`; a valid C5 smoke input produces actual MIDI
`[36,67,72]` (pitch classes `[0,7]`).

The bounded pilot accepts regular JSON files up to 8 MiB, at most 64 corpus cases
and 16,384 total source notes. Each case/source allows at most 4,096 notes,
1,024 beats, 256 measures and 1,024 reference spans. At most 256 notes may overlap
any harmony context window, and unique boundaries multiplied by source note
count must not exceed 16 million. These are conservative computational limits
for this inspection tool, not musical difficulty or quality thresholds. All
corpus cases, including an unselected split, must have string identities and
complete valid reference partitions before any inference occurs.

### Post-holdout input-validation checkpoint

Independent review found that the original CLI accepted missing/string/out-of-range
pitches, nonnumeric velocities, missing/invalid clocks, oversized durations and
object-valued composition identities. The shared admission gate now rejects those
inputs without a musical receipt; direct replay and duration-metric calls use the
same applicable checks. The review also measured a dense release pattern that
exceeded ten seconds at only 1,600 source notes, motivating the local-context and
boundary-work limits in addition to the total note cap.

The first correction changed only input admission. Its 35 boundary tests first
produced 30 failures and five positive passes; after the fix, all 35 plus the
18 existing evaluation tests passed. Web and song-tool typechecks passed. Both
original split reports regenerated byte-for-byte identically, with the harmony
algorithm and corpus hashes unchanged at this checkpoint. Exact hashes are in
[post-holdout-input-validation.json](post-holdout-input-validation.json). This
checkpoint precedes the separately disclosed implementation revision 2 timing fix.

### Implementation revision 2: reviewed timing correction

The public opt-in name remains `conservative-backing-v1`; **implementation
revision 2** identifies the reviewed code at
`73af13c068e8d14b465b6f37572170f2141867df`. The original implementation is retained
at `7bd6891c1388104533ac7c337b5fd80e3f3cc2e6`. Exact current file hashes,
the original receipt comparisons, validation results and review-control metrics
are recorded in [revision2-regression-report.json](revision2-regression-report.json).

The reviewer supplied a C/G stack with repeated attacks 0.07 beats apart and an E
that first starts at beat 0.49. The detector treats adjacent jitter transitively,
so its attack cluster included the later E at the first cluster onset. Revision 1
therefore realized a C major chord from beat zero: **0.49 beats of an unsupported
third**. This was outside the frozen corpus and disproved a universal timing
claim that the original small synthetic results could not establish.

The opt-in path now includes every actual member onset among its segment
boundaries. Evidence from a later member cannot enter an earlier segment. The
existing source-rhythm Player remains unchanged. In these controls it retains
fifth-only backing when a later upper third joins a held C/G stack; that is a
supported reduction, not a claim to reproduce every played chord tone. A later
incompatible bass terminates the earlier supported chord at the bass's real onset
and leaves the incompatible interval silent. The extra `5`/`sus2` vocabulary also
now requires the explicit policy even when a legacy caller supplies custom
quality costs.

Five known post-review controls were recorded before the timing correction and
replayed through the actual Player afterward. They are in
[ks09-harmony-review-v2.json](../../../packages/midi/test/fixtures/ks09-harmony-review-v2.json);
their `development` split value is a corpus-schema convention, not a new
development/holdout experiment.

| Known review control | Revision 1 wrong harmony | Revision 2 wrong harmony | Revision 2 actual backing |
|---|---:|---:|---|
| E enters at 0.07 after C/G | 0.07 beats | 0 | C5 over 0–4, pitch classes `[0,7]` |
| Transitive attack chain; E enters at 0.49 | 0.49 beats | 0 | C5 over 0–4, pitch classes `[0,7]` |
| Longer chain; E enters at 0.98 | 0 | 0 | C5 over 0–4; positive existing-behavior control |
| Db bass enters at 0.07 after C major | 0, but entirely silent | 0 | C major over 0–0.07, then silence |
| Db bass enters at 0.49 after repeated C/G support | 0, but entirely silent | 0 | C major over 0–0.49, then silence |

The exact before/after selected labels, MIDI notes, pitch classes, basses, source
attack gaps and duration metrics are retained in
[review-controls-implementation1.json](review-controls-implementation1.json) and
[review-controls-implementation2.json](review-controls-implementation2.json).
The correction passed seven inference/custom-tuning controls and five actual
Player controls after six inference and two Player checks failed first. The
whole MIDI package passed 548 tests in 32 files; 67 focused web tests and all
three relevant typechecks passed. Forty-eight ordinary non-policy calls matched
the Wave 1 baseline, including a separate custom-power-tuning reproduction.

The previously exposed 24-composition corpus was rerun for both policies. All
48 rows and both complete JSON receipts remain byte-for-byte identical to the
original files; the report records those comparisons without overwriting the
original evidence. **There is no fresh untouched holdout for revision 2.** The
independent review improved a concrete correctness boundary but supplies no
independent musical acceptance or real-song error estimate. Admission remains
the same bounded opt-in scope.

#### Observed coverage cost for small onset jitter

A subsequent reviewer control uses a standard C triad with C3 at beat 0, E3 at
0.02 and G3 at 0.04, all released at beat 4. Revision 2 correctly withholds the
complete C label until 0.04. The existing Player still groups that source attack
at zero, so the later supported label has no new eligible attack: **0 of 3.96
supported beats are audible, with zero wrong-harmony beats**. The unchanged
frozen-corpus results therefore do not imply that the correction has no coverage
cost. This limitation extends beyond dry arpeggios to small onset jitter in an
ordinary complete triad.

The exact self-authored input, source hash, current algorithm hash, labels,
actual resolution and duration metrics are retained in
[revision2-jitter-observation.json](revision2-jitter-observation.json). It is a
known post-review observation, separate from the original corpus and the five
earlier review controls. No retuning followed. Recovering such delayed supported
stacks while preserving justified attack timing needs a separately evaluated
policy; it is outside the present opt-in admission.

The bounded programmatic entry point uses the same admission checks as the CLI:

```typescript
import { replayHarmonyPolicy } from "./apps/web/src/lib/harmony-pilot-evaluation";

const replay = replayHarmonyPolicy(songData, "conservative-backing-v1");
```

The lower-level `inferHarmonyTimeline(notes, measures, { key, policy:
"conservative-backing-v1" })` helper remains available inside the MIDI package.
It does **not** validate external JSON, clocks or workload limits; its caller must
admit valid bounded input first. Directly calling it is not equivalent to using
the bounded CLI/replay entry point. Use the replay adapter when inspecting local
`SongData` so both input admission and actual Player realization are exercised.

The opt-in implies backing-only vocal/lyric exclusion. Existing callers without
the policy retain their behavior. Results use existing generated
`harmony-window` provenance; source-supported inference remains separate from
authored evidence and composed `learner-harmonization`. The CLI receipt retains
the selected policy for review.

## Original validation and remaining work

- Focused baseline: 26/26 existing MIDI harmony/metal tests.
- Algorithm RED: 7 expected failures in 13 new development tests before implementation, including power, semitone, voice exclusion, incompatible bass, arpeggio prefix, repeated fifth and released third cases.
- Algorithm GREEN plus existing harmony/metal: 39/39 tests.
- Real Player replay, hand-calculated metrics, held-harmony and chords-backing: 63/63 tests.
- Full MIDI package: 541/541 tests across 31 files.
- Full player-core package: 383/383 tests across 36 files.
- MIDI typecheck and web typecheck (including the separate song-tools project containing the CLI): passed.
- The Node/npm environment emits its existing experimental proxy/config warnings. No failures remained in these focused or package runs.
- Root is responsible for the combined Wave 2 whole-repository run and independent review. These package results do not replace that integration gate; the known baseline includes ten TSX IPC/listen `EPERM` startup failures in the full repository environment.

The bounded implementation is ready for code review. Broad KS-09 remains open: source-bound real-song evidence, independent labels/listening, principled ambiguity calibration, bass/role alternatives, and arpeggio recovery that preserves actual attacks without gratuitous new bass strikes. Default admission requires that evidence and an explicit joint error/coverage decision.
