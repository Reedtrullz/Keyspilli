# Ultimate Guitar score intake

Use this path when UG is a supplied or useful source. An Official score is source evidence, not automatic authority over a different performance. Keep score material private in the song run; do not bundle copied scores, lyrics, cookies or account details with this skill.

## Acquire and establish scope

1. Reuse the authorized signed-in browser. Inspect the actual notation/tablature, selected track and passage. A title, Official badge, rating, public HTML or Pro onboarding is **not** retrieved score data. Record access outcome, URL, selected track, notation mode, passage/bar numbers, displayed tuning/capo/key/tempo/meter, and capture only relevant visible evidence. Hash these run-local files. Session expiry blocks acquisition; browser-control interruption is a separate transport problem. Neither permits hidden application-state or cookie extraction.
2. Inspect **PRO**, **CHORDS**, the instrument pane and playback **…** menu. Use each track's own tuning and octave convention. Do not apply the guitar header to bass, vocals, synth or drums. Track selection and Solo/Mute are different actions: verify that the displayed staff actually changed. Undo temporary playback settings after inspection.
3. Inspect actual visible export controls. UG's [Official-tab help](https://help.ultimate-guitar.com/en/articles/6749040-website-can-i-download-the-official-tab) says Official tabs cannot be downloaded. Its [Guitar Pro/Power download instructions](https://help.ultimate-guitar.com/en/articles/6749046-website-how-to-download-guitar-pro-and-power-tabs) apply to different tab types: website Download controls for `.gp`, `.gpx`, `.gp3`, `.gp4`, `.gp5`, `.ptb`; they explicitly exclude Official. Never invent Official MIDI, MusicXML or Guitar Pro export. Print is a notation surface, not a structured score export. Verify actual print/save result before claiming a PDF, then check pages, tracks and readability; a print receipt alone says nothing about MIDI fidelity.
4. For legitimate supplied MusicXML/MXL/MIDI use existing intake, `native-score-adapter.ts`, `parseMusicXmlNotes`/`parseMidi`, provenance and source clocks in the [implementation map](keyspilli-workflow.md). Preserve originals. Do not create a second parser. Unsupported repeats/alternate endings/navigation must be explicitly unfolded into a checked occurrence itinerary or remain unresolved; the current MusicXML parser rejects those constructs.

### Manual fallback when structured export is unavailable

Read one bounded passage at a time from authorized visible notation. Transcribe attacks, releases, rests, ties, track identity and source bars, with evidence pins. Compare standard notation and tab. If they disagree by an octave, keep sounding pitch unresolved until the clef/transposition or actual sounding track verifies it; never choose an octave from a familiar guitar convention or a prior piano lift.

`scripts/normalize_ug_score.py` checks a manually authored packet and produces a provisional source-note JSON model. It does not fetch UG, infer harmony, align performances, detect missing melody or approve music. Its hashes verify file bytes, not that a screenshot supports the stated pitch/role/tuning or actually contains a score. The acting agent must inspect that content and cite the relevant track/bar/location. Do not use it as a quality score. Missing fields, wrong JSON types, unknown fields and duplicate JSON keys are refused with repair diagnostics. Boolean flags are not interchangeable with 0/1; IDs and observed basis fields must be nonempty text. It requires:

| Field | Contract |
|---|---|
| `schemaVersion` | `1` |
| `source` | `url`, named `performance`, `scoreVisible: true`, `evidenceIds` referencing actual visible evidence |
| `evidence` | `{id,path,sha256}`; relative paths inside this private run; pins checked against files |
| `tracks` | `{id,role,evidenceIds}`; role is `unknown` unless an observed musical `roleBasis` supports melody/accompaniment |
| Tab track fields | `tuningMidi` is sounding open pitches; `stringOrder` low-to-high or high-to-low; one-based `string` indexes this declared order; explicit `capo` and `fretReference` capo-relative or nut-relative |
| `tempoEvents` | Ordered `{beat,bpm}` from beat zero; score tempo, not live tempo |
| `timeSigEvents` | Ordered `{beat,timeSig:[numerator,denominator]}` from beat zero |
| `orderExpanded`, `itinerary` | `true`, and contiguous `{id,startBeat,endBeat,sourceBars}` occurrences, including every performed repeat/ending in this bounded passage |
| `events` | Unique `{id,track,occurrence,startBeat,durationBeats,evidenceIds}` plus either **sounding** `midi`, `string`+`fret`, or `rest:true` |
| Ties | `tieFrom` references the immediately preceding contiguous same-pitch segment on the same track; no fork/reuse of an older predecessor; split at occurrence boundaries, then merge into one attack with all origin IDs retained |
| `unresolved` | Array of nonempty text naming missing coverage, identity, tuning, pitch, form, timing and technique questions |

`midi` must already be verified sounding pitch; written pitch is insufficient. Preserve dead/muted notes, slides, bends, hammer-ons/pull-offs and other techniques in private raw evidence. Nonempty `techniques` is refused until a source-supported sounding interpretation exists. Whole-track rests cannot overlap sounding notes; separate voices or ambiguous voice rests need existing score intake or manual resolution. Silent gaps are not automatically proven rests. This helper intentionally checks an explicitly unfolded bounded passage, not general guitar notation.

```sh
python3 /absolute/loaded-skill/scripts/normalize_ug_score.py RUN/manual-score.json --output RUN/score-model.json
python3 /absolute/loaded-skill/scripts/normalize_ug_score.py --self-test
```

Use `--output` for repairs: validation precedes an atomic file replacement, so a failed repair preserves the previous result. The helper refuses overwriting its input packet or pinned evidence. Standard output remains available for inspection; shell redirection can truncate an existing result before validation.

If normalization fails, keep the raw packet and named error, repair only the named fields from the visible source, or retain an unresolved passage. Allow at most two packet repairs per passage; after that retain the unresolved error. Do not coerce an invalid flag, invent missing evidence or relax the validator to obtain a pass. Never fill missing notes with a guessed chord or transposed old transcription.

Reuse the selected checkout's `writeMidi`/`writeMusicXml` after review. Keep track names **and** explicit role evidence: parser origin IDs must be reconciled after encoding; hand/name alone does not verify a role. Feed the result and checked role receipts to `buildArrangementContext` and the existing phrase/host workflow. Preserve score JSON beside MIDI/XML. The current `writeMidi` accepts an initial tempo and meter events, not a variable tempo-event export: do not pass an ignored `tempoEvents` option. For performance-aligned notes, encode verified native live seconds on an exactly encodable coordinate clock (e.g. 160 BPM, beats = seconds × 160/60), and retain original score tempo/meter and alignment separately. Coordinate notation is not a recovered beat grid; native-score notation stays separate if its metric timing differs.

## Interpret harmony and roles

Use existing `tryParseChordSymbol`/`chordPitchClasses` and timeline helpers. In chord-label context **E5 is E–B**, E major is E–G♯–B, Em is E–G–B, and C/E is C major over E bass. In scientific pitch notation E5 instead names a single pitch: record which namespace a field uses. No silent power-chord → major conversion. A third, inversion, register, pulse or sustain added for piano is an arrangement choice; cite supporting source or label it inferred. Unknown thirds may remain root/fifth voicings.

Vocal track + verified lyric/note correspondence is role evidence; the name alone is not. Instrumental hooks and bass need their own passage evidence. Original retains recognizability, silence, form and ending while reducing density. Chords excludes the vocal stream, leaves room for singing and preserves useful bass/harmonic motion. Choose pulse, inversions, span, register, dynamics and release for piano feasibility; source guitar fingering is not keyboard feasibility.

For reused transcription, inspect every vocal phrase for missing attacks, short fragments, rests and octave shifts. Compare source voiced intervals/onsets and actual aligned audio to delivered notes. A frame threshold, ASR mask, fixed minimum duration, median smoothing or same-pitch gap joining can remove syllables or merge repetitions. A 339/339 retention result only certifies the retained input events, not the completeness/correctness of a singer's melody. Do not delete fragments based on size alone or preserve errors based on hashes.

## Align the requested performance

Maintain four separate clocks: score beats/seconds, requested recording native seconds, symbolic coordinate beats and delivered playback seconds. Pin source URL and bytes; document studio/live/version differences before transferring form or harmony. Never stretch a whole recording to make its duration match a score.

Use bounded phrase anchors with `{scoreBars,liveStartSec,liveEndSec,evidenceIds,status,disagreements}`. Check opening, each repeated section, breaks/interlude and ending against actual source audio. Interpolate only inside a reviewed phrase with supported anchors; retain expressive timing and local disagreement. Bass-root matches and ASR are candidate anchors, not qualified alignment. Unreviewed anchors stay unresolved and the arrangement provisional.

Skeleton caution: Official 5578563 displays 148 BPM, 4/4 and ~216 s; Audiotree 4fo0ir_FSkI is 207.765333 s. The existing recipes use 160 BPM as a coordinate clock and 161.5 as an estimated pulse. Neither establishes live tempo. Official power-chord facts differ from chord chart 1408134 (notably C/E); Am/G and triad expansions in the prior candidate are inferred. The inherited 339-note pYIN line still needs coverage and octave review.

## Freeze, compare and gate

Pin source/evidence, recipe/code/plugin/prompt, precise route/effort, MIDI/XML, acoustic bank, preview and bundle hashes. Do not retroactively describe old source/prompt versions as current. Compare rejected, owner-liked and revised versions by the same native phrase windows. Keep per-phrase melody/hook/bass/harmony/groove/continuity/contrast/ending/singability/playability evidence and unresolved issues. Owner feedback is evidence for the exact candidate only.

Use the [musical gate](musical-quality-gate.md) capability checks before any audio review. Budget at most twelve aligned ≤30-second pairs, one critique and one bounded repair per pair unless separately authorized; record actual source/preview transport, request route and coverage. No audio capability → no listening call or subjective ranking; retain acoustic previews and structural comparisons, provisional modes and the missing qualified evidence. The agent owns this review; do not transfer a checklist to the owner.

Require both-mode MIDI/XML, six tiers, isolated fresh/idempotent import, checked Chords replay, source loss audits, actual Player timing/notation/practice/transpose/loops/ending and qualified musical/keyboard evidence before `ready`. Reuse repository tests for chord semantics, XML ties/repeat rejection, native timing and Player release. Keep source-note completeness separate from input retention.

Inspect actual engraving warnings and readability. Source timing encoded on a coordinate clock can produce tiny fractional note/rest values that render with warnings or impractical notation. Preserve native attacks/releases; do not round the approved performance to hide warnings. A checked piano notation reduction needs its own source-linked rhythm decisions and comparison, not a hash-preserving renderer pass.

Check exact current target compatibility before later publication. Skeleton's historical `fe2913b7977805b92310d638c2e0bf50f2783895` comparison rounded 98/99 chord spans (attack drift up to 10.9375 ms, duration up to 18.75 ms). Local publication receipts subsequently record release `d9aff249900e053b4a9ee21cd40df6e1419541f3` (PR191, run36864335930) with exact Original notes/clock and realized Chords replay. That resolves the recorded compatibility failure for that package/release; it does not prove a future target or musical readiness. Recheck instead of treating the old SHA as a continuing block. Do not alter approved files or repin transformed outputs as their approved preview.

## Observed feature guide — 2026-10-01

Coverage is the authorized Skeleton Official page, its PRO/CHORDS surfaces and playback menu. Additional contrasting Official scores were not inspected: Chrome subsequently reported an extension UI blocking automation. Session expiry was not observed. This table distinguishes rendered content, exposed controls and unverified operations; it does not assert every UG score supports every feature.

| Feature | Observed UI path and scope |
|---|---|
| PRO vs CHORDS | Top PRO/CHORDS switch worked. PRO showed staff/tab; CHORDS showed lyric alignment, C5/E5/F5/G5/A#5/A5 labels, Guitar/Ukulele/Piano buttons and Whole Song 148 BPM strumming control. Piano-button voicing fidelity not tested. |
| Instrument pane | Left instrument icon → expanded mixer: Vocal, Backing Vocal, Acoustic Guitar, Solo Guitar, Additional Guitar (FX), Synth Lead, Synth Pad, Bass Guitar, Drums; Solo/Mute and volume exposed. Clicking a name did not verify staff selection; require the displayed staff to change before claiming a different track. |
| Standard/tab | Playback … → Notation offered Standard, Tablature, Standard + Tablature. Combined view rendered vocal staff, fret lines and lyrics. It exposed a one-octave staff/tab discrepancy that remains unresolved for sounding pitch. |
| Tuning/capo/key/tempo/meter | Header E A D G B E, no capo, C; displayed score quarter=148 and 4/4; duration3:36. Per-track alternate tuning, tempo/meter changes and capo changes not established by this sample. |
| Lyrics, parts, rhythm | Visible lyric alignment, Verse/Bridge labels and roadmap Intro→Verse1→Verse2→Bridge→Chorus→Break→Verse3→Bridge→Chorus→Break→Interlude→Chorus→Outro. Vocal intro multibar rest, note/rest durations and cross-bar ties rendered. Roadmap labels alone do not encode repeat counts or live form. |
| Other techniques | Muted/dead notes, slides, bends, alternate endings and articulated guitar techniques were not verified in this bounded sample. Keep unavailable material unresolved; no claimed parser coverage. |
| Playback | Play/reset, volume, Loop, Speed1.00/slider, Metronome, Fretboard, Listen Backing Track exposed. Backing toggle changed visibly. These controls do not prove downloaded track availability or qualified listening. |
| Playback menu | Pitch ±1, Transpose ±1, Autoscroll, Count-in, Left handed, notation selection and Fretboard Beat + Bar exposed. Musical behavior of pitch/transpose and loop accuracy not tested here. |
| Print/export | Print exposed a rendered score document with image pages. Completed Save PDF, track completeness and PDF fidelity not verified; browser control stalled around printing. No structured Official export observed; primary UG help explicitly excludes Official downloads. |

Repeat these checks for a new score rather than carrying sample assumptions forward. Retain only relevant source screenshots/observations and explicit limitations, not unrelated browser/account state.
