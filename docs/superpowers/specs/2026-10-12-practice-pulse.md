# Explicit practice pulse and metrical grouping

Scope: KS-18 / [#271](https://github.com/Reedtrullz/Keyspilli/issues/271), authorized by the Recovery Report implementation and the user's
subsequent Continue instruction. The integration owner approved this design
before product edits. Baseline: `238fd827d30e34aa84b1016fbe5254a7b2672a9a`.

## Contracts

1. Existing settings without a `practicePulse` field keep the current quarter
   click scheduler, existing accents, audio parameters and preference bytes.
   New pulse choices are explicit: quarter, eighth or dotted quarter. A meter
   does not choose a pulse or a grouping automatically.
2. An optional practice setting contains a pulse and meter-specific beat groups.
   A group counts denominator notes; positive integer groups must sum to the
   numerator (for example, an explicitly chosen `2+3` in 5/8). A meter occurs
   only once in the setting. The contract bounds meter/group counts, supported
   fractions and timing duration before playback. Invalid explicit settings are
   rejected; malformed saved settings recover to the unchanged default with a
   visible message in the Player.
3. The engine receives descriptive meter events and, when available, the
   already-validated initial measure phase from the Player. A metadata update
   keeps explicit clicks aligned with the current source/navigation map. The
   original constructor metadata remains unchanged for legacy playback. The
   timing contract also carries the actual arrangement end so transport padding
   cannot create extra explicit click measures.
   Existing source-validation and navigation policies do not change. An
   unsupported alignment blocks explicit practice pulses with an actionable
   setup message instead of inventing source phase.
4. Explicit clicks use quarter-note coordinates. They combine the chosen pulse,
   displayed bar starts and declared group starts. Coincident clicks deduplicate
   with bar accents taking precedence over group accents, then plain pulses.
   Group starts may add a click between pulse clicks. A validated pickup clips
   the initial pattern at zero while retaining its real phase. Meter changes,
   seek, loops and speed use the same scheduler/transport bounds.
5. An optional group-accent argument extends the existing audio boundary. All
   current calls and default click sounds retain their meaning; synth, sampled
   and organ outputs get the same additional accent. Source notes, velocities,
   grading targets, export data and music-acceptance claims remain unchanged.
6. The existing practice setup dialog provides a metronome toggle, an explicit
   pulse selection and an optional grouping entry for each distinct meter. No
   grouping is preselected. Start validates and installs the settings before
   grading begins. Cancel makes no persistent change. Only the existing
   per-song preferences remember grouping. The unchanged four-beat count-in is
   labeled as four quarter-note beats.

## Verification

Keep failing and passing receipts under the task evidence directory. Exercise
actual `PlaybackEngine` audio events for legacy parity, explicit 6/8 and 9/8,
additive 5/8 (2+3) and 7/8 (2+2+3), changing meter, source pickup phase, seek,
loops, speed scaling, live setting changes and clipped final windows. Reject
malformed, duplicate, over-budget and out-of-meter settings before scheduling.
Check all three instrument implementations for legacy and new accent sounds.

Verify rendered setup controls and the shared integration functions used by
`Player` for timing, application and persistence; reload per-song settings and
exercise corrupt storage and unsupported source alignment. Compare source note
and export data before and after a practice choice. Run the focused core/web
tests and both workspace typechecks on supported Node 22.22.3. Independent review
and canonical Issue/PR publication belong to the integration owner.

No merge, deployment, provider calls, production data changes, music acceptance
or installed plugin release is part of this work.

## Implementation decisions and limits

- `practice-pulse.ts` validates supported meter fractions, at most 32 distinct
  grouping choices, at most 32 positive integer groups per choice, 512 ordered
  meter events, 2048 displayed bar starts, 4096 quarter-note beats and a bounded
  click allocation. Sparse/missing group values are invalid. The engine builds
  a plan at settings/timing boundaries and uses binary search in its actual
  half-open scheduling windows; notes and grading remain on their original
  paths.
- `Player` supplies its existing displayed measure map and validated source
  pickup phase. Meter events must align with that map; an unverified or
  unsupported partial bar offers default clicks with an actionable message.
  Full bars must match the declared meter, except a validated opening pickup
  and a clipped final bar. This change does not broaden source timing authority
  or repair the existing navigation policy. An internally consistent displayed
  arithmetic grid remains an explicit practice option; the UI states that its
  source downbeat phase is unverified. Source-verified phase is labeled
  separately. No blanket source-verification requirement is introduced.
- `setSettings` accepts incoming optional click timing and timeline duration
  together, so a speed/source update cannot validate against half of the old
  clock. The source tempo still follows the existing engine lifecycle. A failed
  setting/timing update leaves the previous valid engine state intact.
- The optional audio accent is a middle click pitch (1479 Hz); existing bar and
  pulse pitches (1760/1174 Hz), gains and envelopes remain unchanged in all three
  instruments. Bar accents take precedence at coincident events.
- Grouping applies to every occurrence of a chosen meter in that song. This
  bounded UI does not support different patterns for separate passages sharing
  the same meter. No swing, tempo-unit inference or automatic compound-meter
  grouping is introduced.
- The four-quarter-note count-in is unchanged. Real browser audio or teacher
  acceptance is not asserted by the deterministic scheduler and rendered UI
  checks. UI interaction and audio device qualification remain separate from
  this implementation's source/scheduler tests.

## Implementation verification — 2026-10-12

Supported runtime: Node 22.22.3. The complete player-core suite passed 427 tests
in 37 files, including the focused late-metadata default-scheduler regression.
The targeted Player, setup, source-navigation and active-export suite passed 52
tests in eight files. Both player-core and web typechecks passed; the web check
also includes its song-tools TypeScript project. `git diff --check` passed.

The evidence directory retains the original scheduler, audio, persistence and
UI RED receipts. Additional failing controls found during implementation cover
sparse groups, default timing updates and damaged preference containers; each
was corrected before the final GREEN run. No test invokes a live audio device,
provider, production service or browser session. The integration owner still
performs independent diff review and the final combined-workspace gates.

## Independent-review correction — delayed score navigation

Review of `c5a5dfeedd89536be988d07cbf57d71d1a8cdd13` found that the Player
persistently removed a valid saved pulse when its temporary arithmetic map
failed alignment, before the accepted score map arrived. Runtime resolution now
supplies safe default settings only to the engine. The Player retains the
user's choice in state and per-song storage, including during unrelated settings
saves, and revalidates it whenever the current bar map changes. The visible
notice describes the current fallback and retained choice; it disappears when
the choice becomes usable. A genuinely unsupported current map remains on
default clicks until supported timing or an explicit user choice is available.
Malformed stored settings remain visibly excluded at the existing load boundary.
No planner, source-timing authority or alignment check was relaxed.

The review also identified redundant synchronization after an unchanged
no-count-in start. The start adapter now retains the existing settings identity,
and the Player skips the no-op settings update. Real setting changes still reach
the engine before grading starts.

Five new lifecycle checks replay the actual Player resolution/effects and
settings callbacks from its syntax tree, with real storage, MusicXML export,
score-navigation validation and playback scheduling. They cover delayed map
success, unrelated settings saves during fallback, an unsupported map with
explicit return to default clicks, malformed saved settings, and one opening
note/click with no redundant cancellation on an unchanged start. This remains
callback replay rather than a DOM mount or physical listening qualification.
The retained RED run fails four of these checks on the reviewed implementation;
the corrected focused suite passes all 23 tests and the web/song-tools typecheck
passes. The expanded Player/navigation/export suite includes all five new cases.
It passes 57 tests in nine files on Node 22.22.3.
