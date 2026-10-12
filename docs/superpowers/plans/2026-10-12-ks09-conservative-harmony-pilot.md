# KS-09 Conservative Harmony Pilot Implementation Plan

> **For agentic workers:** Execute this bounded authorized pilot in its isolated worktree using test-driven development. Root coordinates independent review and integrated validation. User authorized implementation of the recovered Wave 2 plan; no additional approval gate is introduced.

**Goal:** Give source-supported generated backing an opt-in fifth-only/unknown policy without forcing unsupported thirds or basses.

**Architecture:** Extend the existing harmony DP candidate admission, using the current `5` chord parser, strict vocal/lyric exclusion, held-stack continuity and explicit `N.C.`/`reviewReason` output. Deliver these labels through the existing Player replay and source-rhythm resolver. Keep ordinary defaults unchanged and expose the pilot through a maintained read-only evaluation CLI.

**Tech Stack:** TypeScript, existing MIDI/player-core/web packages, Vitest; Node 22.22.3. No new dependencies or inference providers.

**Spec:** KS-09 in the recovered 2026-10-12 implementation roadmap and musical-quality blueprint; this file records the bounded design selected for the authorized implementation.

## Global constraints

- Base: `7d4aa00e2e076586947b67bf78c5488f2c91068b`, verified Wave 1 integration.
- Opt-in `inferHarmonyTimeline(notes, measures, { policy: "conservative-backing-v1" })`; no default/catalog admission.
- Existing `ChordLabel` contract: `sourceKind: "generated"`, `inferenceType: "harmony-window"`; unknown uses `N.C.`, empty notes and a reason. This is source-supported inference, never `learner-harmonization`, an authored chart or a calibrated probability claim.
- Realized pitch classes and observed bass are the fidelity boundary; octave/register changes remain generated voicing. No claim of recovered performance timing or authored harmony.
- Reuse deterministic score margin only to disambiguate supported alternatives. Its value is not a posterior or calibrated confidence.
- Existing held triads/sevenths/suspensions/inversions, source releases, repeated attacks and explicit rests must remain intact.
- No catalog artifact, accepted pin, provider, plugin, publication, merge or deployment changes.

## Bounded admission design

1. The new policy implies backing-only evidence filtering. A lyric or explicit vocal note cannot supply a missing root, third or fifth.
2. Add the existing parser's `5` and `sus2` qualities only to this opt-in candidate set. A power chord requires both root and fifth; a bare singleton, semitone, conflicting third or incomplete triad can remain unknown.
3. Preserve complete played stacks across held boundaries. Where there is no retained complete stack, require all candidate pitch classes in actual local source support, with role support from the existing stack/arpeggio checks. Inferred pedal extension alone must not establish a missing tone.
4. Segment at source attack clusters and releases so new contradictory bass and released defining tones are not concealed by the beat grid. A bass outside the chosen candidate requires abstention; a supported chord-member bass is retained as an inversion.
5. Never reattack a newly named chord when no source attack supports it. The actual Player resolver remains the timing authority and may be silent inside a supported label. Audible coverage measures this loss.

## Frozen evidence

`packages/midi/test/fixtures/ks09-harmony-pilot-v1.json` contains 24 original synthetic compositions, 12 development and 12 holdout, frozen and committed before algorithm changes. IDs do not cross splits; holdout compositions use distinct phrases, rhythm/quality combinations and failure contexts, rather than only transpositions of development cases. These are synthetic contract examples, not independent human/listening validation or estimates of real-catalog prevalence.

Reference spans identify supported/unknown/rest, allowed pitch classes and supported actual bass. An intended arpeggio's incomplete prefix remains in the supported coverage denominator. A released third's safe fifth-only tail also remains in that denominator even if no source reattack allows playback. This avoids making the denominator easier after seeing the implementation.

Metrics use exact event boundaries and union duration, not sample counts: wrong-harmony beats (any unsupported realized pitch class/bass or notes in unknown spans), audible supported coverage, label abstention over non-rest reference spans, generated notes in reference rests, and per-event realized pitches/classes/bass. Label correctness is supplementary. Report both baseline and pilot, development and holdout separately.

## Review focus

- Root/fifth and semitone dyads need distinct outcomes in both labels and actual Player events.
- Incompatible low pedal evidence cannot be replaced with a generated chord root.
- Vocal/lyric material and an unrelated upper attack cannot create a missing accompaniment third or overwrite a held stack.
- Pedalled/arpeggiated evidence must expose coverage loss before complete support exists.
- Repeated attacks, partial member releases, bass releases and terminal rests cannot gain new source-free attacks.

## Tasks

- [x] Read current APIs, recovery scope and repository workflow; verify focused harmony baseline.
- [x] Freeze the development/holdout compositions and record this design before product code.
- [x] Write failing development-policy tests and watch expected label/pitch/bass failures.
- [x] Implement bounded candidate admission in `packages/midi/src/harmony.ts`, leaving legacy default behavior intact.
- [x] Add actual `replayChordsBacking` and `resolveAccompaniment` checks plus the read-only evaluator/CLI; verify duration metrics with hand-calculated examples before trusting reports.
- [x] Run development checks and focused existing suites; freeze algorithm before first holdout evaluation. Any later algorithm change would disclose holdout contamination and require a new holdout for broad admission.
- [ ] Evaluate frozen holdout once, preserve raw event receipts and report remaining failure/coverage identities.
- [ ] Run focused typechecks, hand off integrated suite and independent review to root, commit cohesive patches, recommend only the admitted scope supported by evidence.

## Development observations before holdout

The seven expected algorithm regressions failed first, then all 39 MIDI tests and 63 Player/evaluation/held-harmony tests passed. The hand-calculated duration tests distinguish wrong harmony, rest intrusion, audible supported coverage and label abstention.

Actual Player replay revealed a stronger arpeggio limitation than the initial test expected: the first supported label starts after the source root attack, and the existing resolver has no supported attack inside it. It emits no chord. The test expectation was corrected to the existing source-rhythm contract; the algorithm and frozen reference were not changed to conceal this loss. The 3-beat arpeggio remains entirely in the coverage denominator. A released third similarly leaves a 2.5-beat silent fifth-only tail because there is no fresh source attack.

Development results before holdout: legacy 18.25 wrong-harmony beats and 32.75/35.25 supported audible beats (92.91%); conservative 0 wrong-harmony beats and 29.75/35.25 supported audible beats (84.40%). Both have zero notes in reference rests. These small synthetic results justify inspection, not default admission.
