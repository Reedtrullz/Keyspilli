# Recovery continuation — Wave 4

The user authorized continued implementation of the recovered audit. Implement
the bounded source-supported stack correction (#278) and MusicXML per-note
velocity round-trip (#279). Do not merge, deploy or alter accepted musical pins.

## Task 1: Correct staggered source-supported Chords delivery

Read `../specs/2026-10-12-supported-stack-onsets.md` and issue #278. Freeze the
specification/development controls; reproduce RED on unchanged Wave 3. Introduce
an explicit opt-in timing policy through existing evaluator and Player producer;
implement one bounded source-group strike with actual support/bass/release checks.
Run focused core, replay, CLI and actual export checks. Record implementation
revision 3 and compare unchanged historical references as regressions. Freeze the
algorithm before independently authored validation. Commit and obtain review.

## Task 2: Preserve explicit MusicXML note velocities

Separate worktree and implementer. Read issue #279 and the MusicXML velocity brief
under the current session's `evidence/wave4-discovery/`. Verify the standard unit,
reproduce velocity flattening, implement the writer/parser and current/legacy
fidelity boundaries, and test actual artifacts and active export. No historical
repins or acoustic claims. Commit, then obtain independent review.

## Task 3: Integrate, verify and deliver

Assemble exact reviewed commits on a new Wave 4 integration branch. Verify full
workspace tests, typechecks, production build and applicable Python/plugin smoke
against committed code. Independent review checks exact assembly and regression
scope. Publish two draft PRs with exact base/head mappings, update the two issues
to In Review without closing them, and deliver a source-backed report/evidence
archive. Preserve the bounded host diagnostic result and all failed gates.
