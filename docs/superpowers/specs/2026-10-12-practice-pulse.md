# Explicit practice pulse and metrical grouping

Scope: KS-18, authorized by the Recovery Report implementation and the user's
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
   keeps an existing engine aligned with its current source/navigation map.
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
